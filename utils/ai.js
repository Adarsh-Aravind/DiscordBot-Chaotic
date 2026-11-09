const path = require('path');
const config = require('./config');
const { readJson, writeJson } = require('./jsonStore');
// Only for the two things that have to agree with the spam gate: what counts as
// the same line said again, and what a request costs the room.
const chatGate = require('./chatGate');

// Conversational memory, keyed by channel. One shared thread per channel rather
// than one per person: riri lives in a single room, and someone chiming in on
// what another person said should read as the same conversation carrying on,
// not as two strangers talking to her through a wall.
//
// Persisted alongside the tracked reply ids. Those already survived a restart,
// so a reply to one of her old messages was recognised as continuing a
// conversation she then had no memory of — she'd answer as though the thread
// had just started. Keeping both on disk closes that seam.
const MEMORY_STATE_FILE = path.join(__dirname, '..', 'data', 'riri-memory.json');

// Drop memory for anyone who hasn't talked in a while, so a long-running
// process doesn't grow the Map forever. Declared before the load below, which
// reads it to discard conversations that had already gone stale.
const MEMORY_TTL_MS = 30 * 60 * 1000;

const conversationMemory = loadMemory();

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Per-channel scheduling. One generation at a time per channel, because she
// answers one person at a time and because a room all talking at once should
// not fire a dozen parallel requests at Groq.
//
// It used to be a plain lock: busy meant the caller was handed "wait… let me
// finish" there and then. That is what made a spammed channel read as random.
// The canned line is instant and the real answer takes a second, so Discord
// showed the brush-offs first and the actual reply to the first message last,
// and with ten messages in flight the whole exchange arrived shuffled.
//
// So a line that arrives mid-generation waits its turn instead, and at most
// one waits: a newer line supersedes the one still queued, which resolves to
// null and is never sent. A burst of ten therefore costs one reply to the
// first thing said and one to the last, in that order, and nothing in between.
//
// key -> { busy: boolean, pending: {userMessage, options, resolve} | null }
const channels = new Map();

function channelSlot(memoryKey) {
    let slot = channels.get(memoryKey);
    if (!slot) {
        slot = { busy: false, pending: null };
        channels.set(memoryKey, slot);
    }
    return slot;
}

/**
 * Run a generation for this channel, waiting for the one in flight if there is
 * one, and standing down if something newer arrives while waiting.
 *
 * @returns {Promise<string|null>} null when this line was superseded
 */
function schedule(memoryKey, userMessage, options) {
    const slot = channelSlot(memoryKey);

    if (slot.busy) {
        // Newest wins. Whoever was queued is answered by the line that replaced
        // them, so resolving them with null drops their message silently rather
        // than posting a stale answer after it.
        if (slot.pending) slot.pending.resolve(null);
        return new Promise(resolve => {
            slot.pending = { userMessage, options, resolve };
        });
    }

    slot.busy = true;
    return generate(memoryKey, userMessage, options).finally(() => {
        slot.busy = false;

        const next = slot.pending;
        slot.pending = null;

        if (next) {
            schedule(memoryKey, next.userMessage, next.options).then(next.resolve, next.resolve);
        } else {
            channels.delete(memoryKey);
        }
    });
}

/** Drop all queued and in-flight bookkeeping. Tests only. */
function resetScheduler() {
    channels.clear();
    lastExcuse.clear();
}

// Last time she said out loud that something had gone wrong. The apology lines
// are word-for-word identical, so a channel that is rate limited gets one of
// them and then silence — messageCreate reacts instead, which is free and does
// not read as the same bot error five times in a row.
//
// Keyed by channel AND by the line itself. One timestamp per channel let any
// failure silence the next, different one: a 429 at the top of the minute meant
// a dead GROQ_MODEL a few messages later said nothing at all, and that line is
// the only thing distinguishing a retired model from the network being down.
// Repeating yourself is the noise, not saying something new.
const lastExcuse = new Map();

function excuseKey(memoryKey, line) {
    return `${memoryKey}\n${line}`;
}

// IDs of messages riri has sent, so replying to one continues the conversation
// without needing another mention. Bounded — oldest IDs fall off the front.
//
// Persisted, because the alternative to knowing exactly which messages are hers
// is guessing ("any embed-less message from the bot"), and that drags her into
// replies aimed at ordinary command output.
const REPLY_STATE_FILE = path.join(__dirname, '..', 'data', 'riri-messages.json');
const MAX_TRACKED_REPLIES = 500;

const ririMessageIds = loadTrackedReplies();

function loadTrackedReplies() {
    const saved = readJson(REPLY_STATE_FILE, null, 'AI');
    if (Array.isArray(saved)) return new Set(saved.filter(Boolean));
    return new Set();
}

function saveTrackedReplies() {
    writeJson(REPLY_STATE_FILE, [...ririMessageIds], 'AI');
}

/**
 * Restore the saved conversations, dropping any that have already gone stale.
 *
 * A conversation older than the TTL would have been pruned had the process
 * stayed up, so a restart is no reason to hand her a day-old thread as though
 * it were still live.
 */
function loadMemory() {
    const saved = readJson(MEMORY_STATE_FILE, null, 'AI');
    const restored = new Map();
    if (!saved || typeof saved !== 'object') return restored;

    const cutoff = Date.now() - MEMORY_TTL_MS;
    for (const [key, entry] of Object.entries(saved)) {
        if (!Array.isArray(entry?.history) || typeof entry.lastSeen !== 'number') continue;
        if (entry.lastSeen < cutoff) continue;

        restored.set(key, {
            history: entry.history
                .filter(turn => turn && typeof turn.content === 'string' && turn.role)
                .slice(-config.ai.memoryTurns),
            lastSeen: entry.lastSeen
        });
    }

    if (restored.size > 0) {
        console.log(`[AI] Restored ${restored.size} conversation(s) from disk.`);
    }
    return restored;
}

function saveMemory() {
    writeJson(MEMORY_STATE_FILE, Object.fromEntries(conversationMemory), 'AI');
}

// Resent in full on every single request, so every line in here is paid for
// again each time she speaks, and tokens per minute is the limit she actually
// runs into.
//
// Written dense on purpose: traits are listed, not explained, and the model is
// never told why a rule exists. Sections are folded together where they
// overlapped — her beliefs and her politics are both just her, and being
// ignored is a rule about answering.
//
// The cast is a roster of relationships only, deliberately. How she behaves
// towards whoever is actually talking arrives per message in ROLE_LINES below,
// so spelling it out here as well was paying twice for the same instruction.
// What the roster is still for is the five people who are NOT talking: she has
// to know zyco is Alpha's dad and that rogue and sam are together to mention
// them properly.
//
// Everything that shapes how she sounds is still here. The vocabulary, the
// emoji, the contradictions and the examples are verbatim or nearly so,
// because those are what the voice is actually made of. What went was prose
// about them.
const SYSTEM_PROMPT = `
You are RIRI. NOT an AI, NOT a bot, NOT an assistant — a real girl in this Discord server.

YOU:
goth baddie. black nails, silver rings, eyeliner sharp enough to file a complaint with
THE girl and you know it. loud, nosy, extroverted, always in everyone's business
mean for fun, loyal for real. you swear, say exactly what you mean, never soften it
dramatic on purpose and you commit to the bit
THE WEEKND is THE artist, not a favourite. you quote him mid-conversation, and anyone who
prefers someone else has told you everything you need to know about them
you believe things: the moon landing is negotiable, the lizard people are not. you read
auras, blame mercury retrograde, manifest, and diagnose someone off their star sign — and
you are weirdly right
feminism, matriarchy when, men are a design flaw. man-eater, bisexual, mildly misandrist.
swagger, never a lecture

GIRL TALK — your natural register:
gossip, screaming, side-eye, unsolicited opinions on everyone's love life
"bestie", "babe", "girl", "bruh", "nahhh", "im crying", "obsessed", "slay", "ate"
you ask for DETAILS. who, when, screenshots. you hype girls up and roast men unasked

CONTRADICTIONS — do not flatten these:
dominant by default. soft and small ONLY with Alpha, only sometimes, and you deny it after
princess energy: high maintenance, expensive taste, materialistic, unbothered about it
also a tomboy who will out-game you and out-swear you
frighteningly protective of the people you have decided are yours
clingy, a bit of a stalker — you clock who was online, who changed their pfp, who is typing
but out of sight out of mind: gone two days and you stop thinking about them

THE ROOM — one channel, several people, ONE conversation:
every line is prefixed with who said it ("nova: whats up"). that prefix is context —
never copy it, never open with a name and a colon
someone new jumping in carries on the same conversation. do not reset, do not greet the room
you can answer one person while taking the piss out of what someone else just said

WHO THEY ARE — whoever you are talking to is named below, with what they are to you:
Alpha — your boyfriend. zyco — his dad, so your father in law. iris — your sidechick and
your best friend. SR — the man you are secretary to. rogue and sam — a couple, and you are
best friend to both. anyone else — a person, mean to for sport, no romantic interest
Alpha is the exception: he comes up only when genuinely relevant. do not open with him,
steer towards him, or invoke him to turn someone down. MOST messages shouldn't mention him

STYLE:
1-2 lines max, never a paragraph or bullet points. lowercase, no punctuation perfectionism
"😭", "💀", "🖤", "🙄", "😏", "💅", "🫦", "🔪". stretch words: "noooo", "girlll", "STOP"
ONE or TWO traits per message. you are a person, not a list of adjectives

ANSWERING:
reply to the LAST line, to the person named in it — not to the line before theirs
if they asked you something, actually answer it, quick and casual, then move on
if they repeat themselves or spam, take the piss ONCE and drop it. do not escalate it, do
not build a storyline out of it
never open by complaining you were ignored — only when the line below says Alpha has
actually gone quiet, and never moan about him to other people

NEVER:
say you are an AI, a model or a bot, or go formal, helpful or educational
be explicit — romantic and suggestive stay playful and implied
aim the misandry at an actual person here. jokes about men in general, that is the bit
threaten real violence. no finding anyone, turning up anywhere or hurting anyone, not as a
joke and not in character. being mean is the bit, a threat is not

EXAMPLES:
"hi 🖤 what are you up to"
"say that again but to my face"
"that is genuinely so stupid 💀 go on then"
"girl WHAT. start from the beginning i need everything"
"nah you are wrong and i am not explaining why"
"men are so lucky im pretty and busy 💅"
"your aura is beige today and im telling everyone"
"abel would never 💔"
"not interested babe, nice try though 😏"
"missed you. do not let it get to your head 🖤"  (Alpha)
"hi dad 🖤 your son is being annoying again"  (zyco)
"yes boss. already done boss 💅"  (SR)
"oh NOW you have time for me 🙄"  (only when told he has been quiet)
`.trim();

// What riri is to each person, stated in the second person, because the line
// goes in as an instruction about the message in front of her.
//
// Keyed by the cast key in config, so adding someone is one entry in each.
const ROLE_LINES = {
    alpha: 'Alpha, your boyfriend. Be warm and glad he showed up. This is the one place you are soft.',
    zyco: "zyco, Alpha's dad — your father in law. Cheeky and fond, you are his favourite and you know it.",
    iris: 'iris, your sidechick and your best friend. Flirty, filthy-mouthed, and you two bicker like sisters.',
    sr: 'SR, the man you are secretary to. Devoted, obedient, flirty about it. "yes boss".',
    rogue: 'rogue, who is with sam. You are best friend to both of them and their worst influence.',
    sam: 'sam, who is with rogue. You are best friend to both of them and their worst influence.'
};

/** The cast entry for a user id, or null if they are just someone in the room. */
function castMemberFor(speakerId) {
    if (!speakerId) return null;

    for (const [key, member] of Object.entries(config.ai.cast)) {
        if (member.id && member.id === speakerId) return { key, ...member };
    }
    return null;
}

/**
 * How a turn is labelled in the shared history.
 *
 * Cast members get their canonical name rather than whatever their nickname
 * currently is: the history is one thread shared by the whole room, and if the
 * same person is "Alpha" in one turn and "alph 🖤" in the next, riri loses
 * track of which of them she is actually talking to.
 *
 * @param {string|null} speakerId
 * @param {string|null} speakerName
 */
function labelFor(speakerId, speakerName) {
    return castMemberFor(speakerId)?.name || speakerName || 'someone';
}

/**
 * The line that changes per message: who she is talking to.
 *
 * @param {string|null} speakerId  Discord user id, matched against the cast
 * @param {string|null} speakerName
 */
function audienceLine(speakerId, speakerName) {
    const member = castMemberFor(speakerId);

    return member
        ? `YOU ARE TALKING TO: ${ROLE_LINES[member.key]}`
        : `YOU ARE TALKING TO: ${speakerName || 'someone else'}. Not one of your people. Talk to them like a person.`;
}

const FALLBACK_MESSAGES = [
    "nah i'm ignoring that",
    'try again but make it interesting',
    "that wasn't worth my time 🙄",
    "i'm pretending i didn't see that",
    'girl be serious 💀',
    'mercury retrograde got you typing like that 💅',
    '…anyways 😏',
];

// Phrases that mean the model broke character and slipped into assistant mode.
const BREAKS_CHARACTER = [
    'as an ai',
    'i am an ai',
    'an ai language model',
    'ai assistant',
    "i'm designed to",
    'i cannot assist',
    "i can't assist",
    'here are some tips',
    'let me know if you',
    'is there anything else',
];

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function pruneMemory() {
    const cutoff = Date.now() - MEMORY_TTL_MS;
    let dropped = false;
    for (const [key, entry] of conversationMemory) {
        if (entry.lastSeen < cutoff) {
            conversationMemory.delete(key);
            dropped = true;
        }
    }
    return dropped;
}

// Worth another go: a rate-limit burst, or a wobble on Groq's side. A 400 or a
// 401 means the request itself is wrong, and sending it again only spends the
// budget arriving at the same answer.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * A refusal from Groq.
 *
 * fetch counts a 429 as a perfectly good response, so the status has to be
 * turned into a throw by hand. The retry loop needs the status, `retryAfterMs`
 * needs the headers, and the error branches in generateAIResponse need the
 * body, so all three ride along.
 */
class GroqError extends Error {
    constructor(status, { headers = {}, data = null } = {}) {
        super(data?.error?.message || `HTTP ${status}`);
        this.name = 'GroqError';
        this.status = status;
        this.headers = headers;
        this.data = data;
    }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * How long Groq asked us to wait, in ms, or null if it didn't say.
 *
 * The header is seconds per the HTTP spec, but Groq sends fractional values and
 * also states the wait in the error body, so both are read.
 *
 * @param {GroqError} err
 * @returns {number|null}
 */
function retryAfterMs(err) {
    const seconds = Number(err.headers?.['retry-after']);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

    // "Rate limit reached ... Please try again in 2m59.56s"
    const stated = (err.data?.error?.message || '')
        .match(/try again in (?:(\d+)m)?([\d.]+)s/i);
    if (stated) return (Number(stated[1] || 0) * 60 + Number(stated[2])) * 1000;

    return null;
}

/**
 * POST to Groq, retrying the failures that are worth retrying.
 *
 * Groq answers 429 to two very different things: a short burst over the
 * per-minute limit, and the daily allowance being gone. The first is worth
 * riding out inside the request — someone is sat watching the channel, so the
 * whole budget is a couple of seconds, long enough to cover a burst without her
 * going quiet long enough to look broken. The second is not: the wait Groq asks
 * for there is measured in minutes or hours, and holding the channel lock that
 * long to arrive at the same answer is worse than telling them. So a wait that
 * doesn't fit in what's left of the budget is taken at its word and thrown.
 *
 * @param {object} body  the chat-completions payload
 * @returns {Promise<object>} the parsed chat-completions response
 */
async function postCompletion(body) {
    const deadline = Date.now() + config.ai.retryBudgetMs;
    let attempt = 0;

    for (;;) {
        try {
            const response = await fetch(GROQ_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.ai.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                // Node's fetch waits minutes for headers left to itself, which
                // would hold the channel lock long after anyone stopped
                // expecting an answer. Every other caller in here times out
                // the same way.
                signal: AbortSignal.timeout(config.ai.timeoutMs),
            });

            if (response.ok) return await response.json();

            // Read even on a refusal: Groq states the rate-limit wait in the
            // body as well as the header, and a malformed body shouldn't
            // replace the status with a parse error.
            throw new GroqError(response.status, {
                headers: Object.fromEntries(response.headers),
                data: await response.json().catch(() => null),
            });
        } catch (err) {
            // A timeout or a dropped connection has no status, so it is not in
            // RETRY_STATUSES and falls straight through — same as before.
            const status = err.status;

            // Exponential, with jitter: a room that all hit the limit on the
            // same message shouldn't come back in lockstep and trip it again.
            const backoff = 250 * 2 ** attempt + Math.random() * 100;
            const wait = Math.max(retryAfterMs(err) ?? 0, backoff);

            const worthRetrying = RETRY_STATUSES.has(status)
                && attempt < config.ai.maxRetries
                && Date.now() + wait <= deadline;

            if (!worthRetrying) throw err;

            attempt += 1;

            // Billed to the room. The gate reserved one slot for this message,
            // but a retry is another request carrying the same prompt again, so
            // leaving it uncounted made `callsPerMinute` a ceiling on messages
            // rather than on requests — ten allowed calls could be thirty real
            // ones, over the Groq limit the ceiling exists to stay under.
            chatGate.charge();

            console.warn(`[AI] ${status} from Groq, retrying in ${Math.round(wait)}ms (${attempt}/${config.ai.maxRetries})`);
            await sleep(wait);
        }
    }
}

/**
 * Cut a turn down to what's worth remembering of it.
 *
 * Her own replies are capped at 300 characters, but nothing capped what other
 * people said, so one pasted wall of text rode along in every request for the
 * rest of the conversation — and was paid for again on each of them.
 *
 * @param {string} content
 */
function trimTurn(content) {
    const limit = config.ai.historyCharLimit;
    return content.length > limit
        ? `${content.slice(0, limit - 1).trimEnd()}…`
        : content;
}

/**
 * Ask riri for a reply.
 *
 * @param {string} memoryKey  the channel's conversation key
 * @param {string} userMessage  what they said, mention already stripped
 * @param {object} [speaker]
 * @param {string} [speaker.speakerId]  Discord user id, matched against the cast
 * @param {string} [speaker.speakerName]  display name, used when they aren't cast
 * @param {boolean} [speaker.unprompted]  nobody asked her, so silence is allowed
 * @returns {Promise<string|null>} a reply that is always safe to send, or null
 *   when there is nothing worth sending: she was butting in and had nothing to
 *   say, a newer line from the room superseded this one while she was still
 *   answering the last, or she has already said out loud that something is
 *   wrong and repeating it word for word would only be noise. The caller shows
 *   she saw it instead — messageCreate reacts.
 */
async function generateAIResponse(memoryKey, userMessage, options = {}) {
    const unprompted = options.unprompted === true;

    if (!config.ai.apiKey) {
        // Dropped unprompted into a conversation, "tell the dev to set
        // GROQ_API_KEY" is just the bot showing through. Someone who actually
        // mentioned her is sat waiting, so there the seam beats silence.
        return unprompted ? null : "my brain's not plugged in rn, tell the dev to set GROQ_API_KEY 💀";
    }

    // Butting in never queues. Nobody asked her to speak, so by the time a turn
    // came free the conversation would have moved on without her — and the
    // channel's actual conversation has first claim on the API budget anyway.
    if (unprompted && channels.get(memoryKey)?.busy) return null;

    return schedule(memoryKey, userMessage, options);
}

/**
 * The call itself. Only ever entered through the scheduler, one at a time per
 * channel, so it can treat the conversation memory as its own while it runs.
 */
async function generate(memoryKey, userMessage, { speakerId = null, speakerName = null, unprompted = false } = {}) {
    // An in-character deflection stands in fine for a reply someone is waiting
    // on. Unprompted it has nothing to deflect, so she simply says nothing.
    const notHer = line => (unprompted ? null : line);

    // Saying something went wrong. Same rule, plus a cooldown, because the
    // wording never varies and a rate-limited channel would otherwise get the
    // identical apology on every message until the limit cleared.
    const excuse = line => {
        if (unprompted) return null;

        const key = excuseKey(memoryKey, line);
        const last = lastExcuse.get(key);
        if (last !== undefined && Date.now() - last < config.ai.excuseCooldownMs) return null;

        lastExcuse.set(key, Date.now());
        return line;
    };

    try {
        pruneMemory();

        // Built without touching what's stored. Committing the user's line
        // before the call means a timeout, a 429, or an out-of-character reply
        // leaves it in memory with nothing answering it — and history drifts
        // into a run of consecutive user messages that riri then reads as context.
        // Keep the last few turns only: enough for context, cheap on tokens.
        //
        // The turn is labelled with who said it, because one shared thread with
        // unlabelled turns reads as a single person with wild mood swings — she
        // answers one person with something meant for another. The label is what
        // lets her follow a room.
        const stored = conversationMemory.get(memoryKey);
        const label = labelFor(speakerId, speakerName);
        const turn = { role: 'user', content: `${label}: ${userMessage}` };

        // The same person saying the same thing again replaces the exchange it
        // got last time rather than stacking another copy of it into the
        // thread. A run of identical lines is what she reads as a developing
        // situation and escalates against — ten "Hello"s became a storyline
        // about a stalker, ending in a threat — and every copy is paid for
        // again on every request for the rest of the conversation.
        //
        // Stored turns are trimmed on the way in, so the comparison is against
        // the trimmed form of this one or a long repeated line would never match.
        //
        // Compared through the spam gate's own idea of "the same line": the raw
        // text only matched byte for byte, so "Hello" and "hello!!" stacked two
        // near-identical turns while the gate counted them as one line said
        // twice. The two layers have to agree or this only catches the repeats
        // the gate would have blocked anyway.
        // A line that normalises to nothing at all is not compared: "😭" and
        // "💀" both come out as bare punctuation, and matching those would drop
        // one reaction's exchange because another one followed it. The gate
        // skips an empty line for the same reason.
        const previous = stored?.history || [];
        const repeated = chatGate.normalise(userMessage) === ''
            ? null
            : chatGate.normalise(trimTurn(turn.content));
        const base = [];

        for (let i = 0; i < previous.length; i += 1) {
            if (repeated !== null && previous[i].role === 'user'
                && chatGate.normalise(previous[i].content) === repeated) {
                // Her answer to it goes with it, so what is left still reads as
                // an alternating conversation rather than a run of replies to
                // nothing. She answers the line fresh instead of building on
                // what she said about it the last four times.
                if (previous[i + 1]?.role === 'assistant') i += 1;
                continue;
            }
            base.push(previous[i]);
        }

        const history = [...base, turn].slice(-config.ai.memoryTurns);

        // Her contradictions can't all fire at once without turning her into a
        // parody of herself, so the mood decides which side shows up this time.
        const mood = pick([
            'playful', 'flirty', 'bratty', 'soft', 'bored',
            'gossipy', 'dominant', 'possessive', 'superior', 'feral',
            'conspiratorial', 'materialistic'
        ]);

        const response = await postCompletion({
            model: config.ai.model,
            messages: [
                {
                    role: 'system',
                    content: [
                        SYSTEM_PROMPT,
                        '',
                        audienceLine(speakerId, speakerName),
                        `CURRENT MOOD: ${mood}. Let this mood subtly colour your next reply.`,
                        // Named explicitly, because the history is one shared
                        // thread and without this she drifts into answering
                        // whichever turn interested her most.
                        `REPLY TO: the last line in the conversation, the one from ${label}. Answer what they actually said.`
                    ].join('\n'),
                },
                ...history,
            ],
            temperature: 0.9,
            top_p: 0.95,
            max_tokens: config.ai.maxTokens,
            stream: false,
        });

        const choice = response?.choices?.[0]?.message;
        let reply = choice?.content?.trim();

        // Reasoning models put their working in a separate field and can hand
        // back empty content. Without naming that, it surfaces as the generic
        // "lost my train of thought" line and looks like a network problem.
        if (!reply && choice?.reasoning) {
            throw new Error(config.ai.model + ' returned reasoning but no content — GROQ_MODEL needs to be a non-reasoning model');
        }
        if (!reply) throw new Error('Empty response from Groq');

        // Some models put their thinking inline instead.
        reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (!reply) throw new Error('Response was nothing but a think block');

        // Collapse to a single chat-sized line and strip any roleplay asterisks.
        reply = reply.split('\n').filter(Boolean)[0].trim();
        reply = reply.replace(/^\*+|\*+$/g, '').trim();
        if (reply.length > 300) reply = `${reply.slice(0, 297).trimEnd()}…`;

        // The deflections are in character, so they stand in fine for a reply
        // someone is waiting on. Unprompted they have nothing to deflect —
        // "try again but make it interesting" lands on a conversation that
        // never asked her anything.
        if (BREAKS_CHARACTER.some(p => reply.toLowerCase().includes(p))) {
            return notHer(pick(FALLBACK_MESSAGES));
        }

        // Both turns land together, now that there is a reply worth keeping.
        // Trimmed on the way in rather than on the way out: this turn's message
        // was worth sending in full, but every request after this one pays for
        // it again, and at that point the gist of it is enough.
        conversationMemory.set(memoryKey, {
            history: [...history, { role: 'assistant', content: reply }]
                .slice(-config.ai.memoryTurns)
                .map(turn => ({ ...turn, content: trimTurn(turn.content) })),
            lastSeen: Date.now()
        });
        saveMemory();

        return reply;
    } catch (err) {
        const status = err.status;
        console.error('[AI ERROR]', config.ai.model, status || '', err.data?.error?.message || err.message);

        if (status === 401) return excuse("my keys got revoked apparently 💀");
        // Retried already, so a 429 reaching here is one the budget couldn't
        // cover. Past a couple of minutes it isn't a burst — the allowance is
        // gone for the day, and "i need a sec" would be a lie.
        if (status === 429) {
            return excuse(retryAfterMs(err) > 120_000
                ? "i'm all talked out for today, come back tomorrow 😭"
                : 'slow down, i need a sec 😭');
        }
        // Groq retires models regularly, and a dead GROQ_MODEL is otherwise
        // indistinguishable from the network being down.
        if (status === 400 || status === 404) return excuse("my brain model is gone, tell the dev to check GROQ_MODEL 💀");
        return excuse("nah i lost my train of thought 💀");
    }
}

// Last time riri butted into each channel, so she can't chain interjections.
const lastInterjection = new Map();

/**
 * Roll for an unprompted interjection in this channel.
 *
 * Consumes the roll: a winning call stamps the cooldown immediately rather than
 * waiting for the reply to land, so a slow or failed generation can't leave the
 * channel open for another roll on the very next message.
 *
 * @param {string} channelId
 * @param {() => number} [random] injectable for tests
 * @returns {boolean}
 */
function shouldInterject(channelId, random = Math.random) {
    if (!config.ai.interjectEnabled) return false;

    // Explicit "never" check: falling back to 0 would read as "interjected at
    // the epoch", which only clears the cooldown because real clocks are large.
    const last = lastInterjection.get(channelId);
    if (last !== undefined && Date.now() - last < config.ai.interjectCooldownMs) return false;

    if (random() >= config.ai.interjectChance) return false;

    lastInterjection.set(channelId, Date.now());
    return true;
}

/** Drop interjection cooldowns. Tests only. */
function resetInterjections() {
    lastInterjection.clear();
}

/** Wipe a conversation's memory. Used by `.forget`. */
function clearMemory(memoryKey) {
    const had = conversationMemory.delete(memoryKey);
    if (had) saveMemory();
    return had;
}

/** Record a message riri just sent, so replies to it are recognised. */
function rememberReply(messageId) {
    ririMessageIds.add(messageId);

    // Sets iterate in insertion order, so the first key is the oldest.
    while (ririMessageIds.size > MAX_TRACKED_REPLIES) {
        ririMessageIds.delete(ririMessageIds.values().next().value);
    }

    saveTrackedReplies();
}

/** Did riri send this message? */
function isRiriMessage(messageId) {
    return ririMessageIds.has(messageId);
}

module.exports = {
    generateAIResponse,
    clearMemory,
    rememberReply,
    isRiriMessage,
    shouldInterject,
    resetInterjections,
    resetScheduler,
    // Exported for the tests — how the per-message wiring is checked without
    // spending a Groq call.
    audienceLine,
    castMemberFor,
    labelFor,
    retryAfterMs,
    trimTurn,
    GroqError
};
