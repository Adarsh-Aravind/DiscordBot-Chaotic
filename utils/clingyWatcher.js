// Riri noticing she is being ignored.
//
// Any message from the partner anywhere in the server counts as "he is around".
// Once he has been quiet past the threshold she posts in the home channel, then
// shuts up for a cooldown however long the silence drags on — the joke dies fast
// if she says it every ten minutes.

const fs = require('fs');
const path = require('path');
const config = require('./config');

const STATE_FILE = config.clingy.stateFile;

// Picked by how long he has been gone, so a three-hour gap and a two-day gap
// don't get the same line.
const TIERS = [
    {
        // 1x the threshold
        multiplier: 1,
        lines: [
            'you have been quiet for hours. i noticed. obviously i noticed 🙄',
            'not even a hi? cool. normal. fine.',
            'hello? i know you are online, it literally says so 💀',
            'so we are just not talking today, got it'
        ]
    },
    {
        multiplier: 2,
        lines: [
            'okay this is actually rude now. say something.',
            'i have been sat here staring at this channel like an idiot. thanks 🙄',
            'ignoring me is a choice and you keep making it 💀',
            'if you are busy just SAY that. the silence is worse.'
        ]
    },
    {
        multiplier: 4,
        lines: [
            'right. cool. i am memorising exactly how long this has been 🖤',
            'genuinely forgot what your typing indicator looks like',
            'i am not upset i am just keeping a list. a long one.',
            'this is the part where you apologise, for reference 😭'
        ]
    }
];

let timer = null;

// --- state persistence -----------------------------------------------------

function loadState() {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        return { lastSeenAt: saved.lastSeenAt || 0, lastNaggedAt: saved.lastNaggedAt || 0 };
    } catch {
        return { lastSeenAt: 0, lastNaggedAt: 0 };
    }
}

function saveState(state) {
    try {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
        console.error('[Clingy] Could not save state:', err.message);
    }
}

// --- logic -----------------------------------------------------------------

function pick(list, random = Math.random) {
    return list[Math.floor(random() * list.length)];
}

/**
 * The angriest tier the silence has earned.
 * @param {number} silentMs
 */
function tierFor(silentMs) {
    const ratio = silentMs / config.clingy.silenceMs;
    let chosen = TIERS[0];
    for (const tier of TIERS) {
        if (ratio >= tier.multiplier) chosen = tier;
    }
    return chosen;
}

/**
 * Should she say something right now?
 * Separated from the posting so it can be tested without a Discord client.
 * @returns {{due: boolean, silentMs: number, line?: string}}
 */
function evaluate(state, now = Date.now(), random = Math.random) {
    if (!config.clingy.enabled) return { due: false, silentMs: 0 };

    // Nothing recorded yet — treat it as "just seen" rather than "gone forever",
    // or a fresh install would open with an accusation.
    if (!state.lastSeenAt) return { due: false, silentMs: 0 };

    const silentMs = now - state.lastSeenAt;
    if (silentMs < config.clingy.silenceMs) return { due: false, silentMs };

    // One sulk per cooldown, no matter how long the silence runs.
    if (state.lastNaggedAt && now - state.lastNaggedAt < config.clingy.cooldownMs) {
        return { due: false, silentMs };
    }

    return { due: true, silentMs, line: pick(tierFor(silentMs).lines, random) };
}

/** Record that the partner said something. Resets the clock. */
function noteActivity(message) {
    if (!config.clingy.enabled) return;
    if (message.author.id !== config.ai.partnerUserId) return;
    if (!message.guild) return;

    const state = loadState();
    state.lastSeenAt = Date.now();
    // He is back, so the next silence starts a fresh escalation.
    state.lastNaggedAt = 0;
    saveState(state);
}

async function check(client) {
    const state = loadState();
    const { due, silentMs, line } = evaluate(state);
    if (!due) return false;

    const target = await client.channels.fetch(config.ai.homeChannelId).catch(() => null);
    if (!target) {
        console.error(`[Clingy] Home channel ${config.ai.homeChannelId} not found.`);
        return false;
    }

    const mention = config.clingy.mention ? `<@${config.ai.partnerUserId}> ` : '';

    try {
        await target.send({
            content: mention + line,
            // Only ever him. Nothing in the line can widen this.
            allowedMentions: { users: config.clingy.mention ? [config.ai.partnerUserId] : [] }
        });
    } catch (err) {
        console.error('[Clingy] Could not post:', err.message);
        return false;
    }

    state.lastNaggedAt = Date.now();
    saveState(state);
    console.log(`[Clingy] Sulked after ${Math.round(silentMs / 3600000)}h of silence.`);
    return true;
}

// --- lifecycle -------------------------------------------------------------

function start(client) {
    if (!config.clingy.enabled) {
        console.log('[Clingy] Disabled.');
        return;
    }
    if (timer) return;

    // First boot: assume he was around just now. Otherwise the very first check
    // reads an empty file as infinite silence and opens with an accusation.
    const state = loadState();
    if (!state.lastSeenAt) {
        state.lastSeenAt = Date.now();
        saveState(state);
    }

    const tick = () => {
        check(client).catch(err => console.error('[Clingy] Check failed:', err.message));
    };

    timer = setInterval(tick, config.clingy.checkIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();

    console.log(
        `[Clingy] Watching ${config.ai.partnerUserId}; ` +
        `${config.clingy.silenceMs / 3600000}h of silence earns a message in ${config.ai.homeChannelId}.`
    );
}

function stop() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

module.exports = { start, stop, check, evaluate, noteActivity, tierFor, TIERS, STATE_FILE };
