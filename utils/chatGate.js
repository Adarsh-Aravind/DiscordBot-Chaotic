// Whether a message addressed to riri is worth spending a Groq call on.
//
// Every mention used to buy a request, and every request carries the whole
// system prompt plus the channel's history — a couple of thousand tokens each.
// So one person typing "Hello" ten times in a minute was ten calls and twenty
// thousand tokens, which is how the room ended up over Groq's per-minute limit
// and being told to slow down. The cheapest fix is not making the call.
//
// Three ways a message isn't worth one:
//   duplicate — the same line from the same person again. She said her piece.
//   flood     — one person firing off more than a handful in a few seconds.
//   budget    — the room as a whole is at the per-minute ceiling.
//
// The ceiling is set below Groq's own limit on purpose: a refusal we decide on
// costs nothing, and a 429 costs the request plus the retries plus the apology.

const config = require('./config');

// userId -> { stamps: number[], lastText, lastTextAt, refusedAt, seenAt }
//
// Insertion order is kept as least-recently-heard-from first: an entry is
// re-inserted every time its owner speaks, so `sweep` can evict from the front
// when the map outgrows its cap.
const speakers = new Map();

// Timestamps of calls we've let through, for the whole room.
const callStamps = [];

const MINUTE_MS = 60 * 1000;

// Entries are tiny, but a busy server shouldn't grow this forever.
const MAX_TRACKED_SPEAKERS = 500;

/**
 * Collapse a line to what it would mean if you squinted: case, punctuation and
 * spacing dropped. "Hello", "hello!!!" and "HELLO ..." are one line said three
 * times, and three calls spent arriving at the same answer.
 *
 * Exported because riri's memory has to agree with this on what "the same line
 * again" means. It used to compare the raw text, so "Hello" and "hello!!" an
 * hour apart stacked two near-identical turns into the history — the wall of
 * repeats she reads as a situation escalating.
 *
 * @param {string} text
 */
function normalise(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, ' ')
        .trim();
}

/** Drop timestamps that have fallen out of the window. Oldest are first. */
function prune(stamps, now, windowMs) {
    while (stamps.length > 0 && now - stamps[0] > windowMs) stamps.shift();
}

/**
 * Keep the speaker map inside its cap.
 *
 * Stale entries go first, but a room with five hundred people all talking has
 * none, and the cap used to be a comment rather than a rule: nothing was freed
 * and the map grew for as long as the server stayed busy. So whatever is still
 * over the cap after that is evicted least-recently-heard-from first.
 */
function sweep(now) {
    if (speakers.size <= MAX_TRACKED_SPEAKERS) return;

    const cutoff = now - Math.max(config.ai.duplicateWindowMs, config.ai.floodWindowMs) * 2;
    for (const [key, entry] of speakers) {
        if (entry.seenAt < cutoff) speakers.delete(key);
    }

    // Deleting while iterating a Map is safe, and the front is the oldest.
    for (const key of speakers.keys()) {
        if (speakers.size <= MAX_TRACKED_SPEAKERS) break;
        speakers.delete(key);
    }
}

function speakerState(key, now) {
    let entry = speakers.get(key);

    if (entry) {
        // Re-inserted so it moves to the back: that is what makes the map's
        // own order usable as least-recently-heard-from.
        speakers.delete(key);
    } else {
        entry = { stamps: [], lastText: null, lastTextAt: 0, refusedAt: null, seenAt: now };
    }

    entry.seenAt = now;
    speakers.set(key, entry);
    return entry;
}

/**
 * Record a request we are about to make, whether or not there was room for it.
 *
 * Used for a retry inside a request that already took its slot: the retry is
 * another call carrying the same prompt again, so the room has to be billed
 * for it or `callsPerMinute` bounds messages rather than requests — two
 * retries each turn ten allowed calls into thirty actual ones, which is how
 * the ceiling that exists to avoid a 429 ended up causing them.
 *
 * @param {number} [now]
 */
function charge(now = Date.now()) {
    prune(callStamps, now, MINUTE_MS);
    callStamps.push(now);
}

/**
 * Hand back a slot taken by `reserve` or `admit` when the call it was for never
 * happened — the line was superseded while it waited, or she decided to say
 * nothing. The exact timestamp is removed rather than the newest, so capacity
 * comes back when this slot would have expired and not at some other moment.
 *
 * @param {number} at  the `now` the slot was taken with
 */
function release(at) {
    const index = callStamps.indexOf(at);
    if (index !== -1) callStamps.splice(index, 1);
}

/**
 * Is there room in the per-minute budget, and if so, take it.
 *
 * Used on its own by the unprompted interjection path: nobody asked her to
 * speak, so the budget belongs to the people who did.
 *
 * @param {number} [now]
 * @returns {boolean}
 */
function reserve(now = Date.now()) {
    prune(callStamps, now, MINUTE_MS);
    if (callStamps.length >= config.ai.callsPerMinute) return false;

    callStamps.push(now);
    return true;
}

/**
 * Should this message buy a Groq call?
 *
 * @param {string|null} speakerId
 * @param {string} text  what they said, mention already stripped
 * @param {number} [now]
 * @returns {{ok: true, at: number} | {ok: false, reason: 'duplicate'|'flood'|'budget', acknowledge: boolean}}
 *   `acknowledge` is true only on the first refusal in a burst, so she can show
 *   she saw it once rather than reacting to all ten. `at` is the budget slot
 *   this message took, to hand back with `forget` if the call never happens.
 */
function admit(speakerId, text, now = Date.now()) {
    // After this speaker is on the books, not before, or the cap is really the
    // cap plus whoever just arrived. They are at the back of the map and
    // eviction takes from the front, so this never drops the entry in hand.
    const entry = speakerState(speakerId || 'anonymous', now);
    sweep(now);

    const normalised = normalise(text);

    const refuse = reason => {
        // Only the first refusal of a burst is worth showing. Stamped on every
        // refusal, so a steady drip of spam stays silent rather than ticking
        // over into another acknowledgement every window.
        //
        // Explicit "never" check: a 0 here would read as "refused at the
        // epoch", which only looks like a cleared burst because real clocks
        // are large.
        const acknowledge = entry.refusedAt === null
            || now - entry.refusedAt >= config.ai.floodWindowMs;
        entry.refusedAt = now;
        return { ok: false, reason, acknowledge };
    };

    // Said already, and recently. Checked before the flood counter so that
    // repeating yourself doesn't also use up your allowance of real messages.
    //
    // The window runs from when the line was last ANSWERED, not from the last
    // time it was refused. Refreshing it on a refusal made it slide: one line
    // repeated every minute held a ninety-second window permanently open and
    // was never answered again, however long they kept it up.
    if (normalised !== '' && normalised === entry.lastText
        && now - entry.lastTextAt < config.ai.duplicateWindowMs) {
        return refuse('duplicate');
    }

    // A refused line is not recorded as said. Nothing was answered, so when
    // they try it again once the flood has died down it is a fresh message,
    // not a duplicate of one she never replied to.
    prune(entry.stamps, now, config.ai.floodWindowMs);
    if (entry.stamps.length >= config.ai.floodMax) return refuse('flood');

    // The room's ceiling is last: one person being under their own limit is no
    // reason to push everyone over Groq's.
    if (!reserve(now)) return refuse('budget');

    entry.stamps.push(now);
    entry.lastText = normalised;
    entry.lastTextAt = now;
    return { ok: true, at: now };
}

/**
 * Undo what `admit` recorded for a line that was allowed through and then went
 * unanswered anyway — the scheduler dropped it for a newer one, or she had
 * nothing worth saying.
 *
 * Without this the gate had it both ways: the line counted as said, so saying
 * it again inside the duplicate window was refused with a yawn, and the person
 * who only ever got a 👀 had no way left to ask. The flood stamp stays — they
 * did send the message, and that limit is about how fast one person talks.
 *
 * @param {string|null} speakerId
 * @param {string} text  the same text that was passed to `admit`
 * @param {number} [at]  the slot from the verdict, handed back to the room
 */
function forget(speakerId, text, at) {
    if (at !== undefined) release(at);

    const entry = speakers.get(speakerId || 'anonymous');
    if (!entry) return;

    const normalised = normalise(text);
    if (normalised !== '' && entry.lastText === normalised) {
        entry.lastText = null;
        entry.lastTextAt = 0;
    }
}

/** Drop all tracking. Tests only. */
function reset() {
    speakers.clear();
    callStamps.length = 0;
}

/** How many people are being tracked. Tests only — this is the cap's proof. */
function trackedSpeakers() {
    return speakers.size;
}

module.exports = {
    admit,
    reserve,
    release,
    charge,
    forget,
    normalise,
    reset,
    trackedSpeakers,
    MAX_TRACKED_SPEAKERS
};
