// The bot's presence, settable at runtime with `.presence` and persisted to
// disk so a restart keeps whatever was last set.
//
// Note on buttons: a bot cannot have them. Rich Presence buttons are an RPC
// feature for user accounts running a local app; a bot publishes its presence
// over the gateway instead, and discord.js only serialises type/name/state/url
// into that payload — a `buttons` array is dropped before it is ever sent.
// Same bucket as the artwork and elapsed timer that real users get.
//
// ActivityType.Streaming plus a youtube.com/twitch.tv `url` is the one way to
// make a bot's presence line itself clickable, at the cost of the verb reading
// "Streaming" rather than "Watching".

const path = require('path');
const { ActivityType } = require('discord.js');
const { readJson, writeJson } = require('./jsonStore');

const STATE_FILE = path.join(__dirname, '..', 'data', 'presence.json');

// The verbs a user can pick, mapped to what the gateway wants. `custom` is the
// odd one out: it shows the text on its own with no verb in front of it.
const ACTIVITY_TYPES = {
    playing: ActivityType.Playing,
    streaming: ActivityType.Streaming,
    listening: ActivityType.Listening,
    watching: ActivityType.Watching,
    competing: ActivityType.Competing,
    custom: ActivityType.Custom
};

// Discord rejects an activity name over 128 characters outright.
const MAX_NAME = 128;

// What ships if nothing has ever been set — the line this bot ran with before
// the presence was settable at all.
const DEFAULT_PRESENCE = {
    type: 'watching',
    name: 'Hardstuck Crusaders',
    url: null,
    status: 'online'
};

// The statuses Discord accepts for a bot. `invisible` reads as offline, which
// is a legitimate thing to want and not the same as the bot being down.
const STATUSES = ['online', 'idle', 'dnd', 'invisible'];

let boundClient = null;
let current = load();

// --- state persistence -----------------------------------------------------

function load() {
    const saved = readJson(STATE_FILE, null, 'presence');
    if (!saved) return { ...DEFAULT_PRESENCE };

    // Merged over the default so a file written by an older version, missing a
    // field added since, still loads instead of being thrown away wholesale.
    //
    // Then validated: neither a hand-edited file nor an older format should be
    // able to wedge the bot on a presence the gateway rejects. Anything invalid
    // falls back to the default rather than leaving the bot with no presence.
    const restored = normalise({ ...DEFAULT_PRESENCE, ...saved });
    if (!restored) {
        console.warn('[presence] Saved presence was not usable, falling back to the default.');
        return { ...DEFAULT_PRESENCE };
    }

    return restored;
}

function save() {
    // Atomic, so a restart in the middle of a write can't leave a truncated
    // file that reads as "nothing was ever saved" on the next boot.
    writeJson(STATE_FILE, current, 'presence');
}

// --- validation ------------------------------------------------------------

/**
 * Coerce a presence into something the gateway will accept, or null if it
 * can't be. Shared by `.presence` and the state-file loader.
 *
 * @param {{type?: string, name?: string, url?: string|null, status?: string}} input
 * @returns {{type: string, name: string, url: string|null, status: string}|null}
 */
function normalise(input) {
    const type = String(input?.type || '').toLowerCase();
    if (!(type in ACTIVITY_TYPES)) return null;

    const name = String(input?.name ?? '').trim().slice(0, MAX_NAME);
    if (!name) return null;

    const status = STATUSES.includes(input?.status) ? input.status : 'online';

    // Discord only renders a streaming link for twitch.tv / youtube.com, and
    // silently ignores the activity entirely for anything else — so a URL that
    // won't work is dropped rather than sent.
    let url = null;
    if (type === 'streaming' && input?.url) {
        const candidate = String(input.url).trim();
        if (/^https:\/\/(www\.)?(twitch\.tv|youtube\.com)\//i.test(candidate)) url = candidate;
    }

    return { type, name, url, status };
}

// --- applying --------------------------------------------------------------

/**
 * Push the current presence to the gateway. Also the reconnect handler:
 * Discord drops presence on a fresh IDENTIFY, so this is what puts it back.
 */
function apply() {
    if (!boundClient?.user) return;

    const activity = { type: ACTIVITY_TYPES[current.type] };
    // A custom status carries its text in `state`; everything else in `name`.
    if (current.type === 'custom') {
        activity.name = 'Custom Status';
        activity.state = current.name;
    } else {
        activity.name = current.name;
    }
    if (current.url) activity.url = current.url;

    boundClient.user.setPresence({
        activities: [activity],
        status: current.status
    });

    console.log(`[presence] ${describe()}`);
}

/** The current presence as a human would say it. */
function describe() {
    const verb = current.type === 'custom' ? '' : `${current.type} `;
    const link = current.url ? ` (${current.url})` : '';
    return `${verb}${current.name}${link} [${current.status}]`;
}

/**
 * Change the presence and push it live. Rejected input leaves the old one
 * untouched, so a typo can't blank the presence.
 *
 * @param {{type?: string, name?: string, url?: string|null, status?: string}} input
 * @returns {{ok: true, presence: object} | {ok: false, reason: string}}
 */
function set(input) {
    const next = normalise(input);
    if (!next) {
        return {
            ok: false,
            reason: `Needs a verb from [${Object.keys(ACTIVITY_TYPES).join(', ')}] and some text.`
        };
    }

    current = next;
    save();
    apply();
    return { ok: true, presence: { ...current } };
}

/** Back to the shipped line, and forget whatever was saved. */
function reset() {
    current = { ...DEFAULT_PRESENCE };
    save();
    apply();
    return { ...current };
}

/** @returns {{type: string, name: string, url: string|null, status: string}} */
function get() {
    return { ...current };
}

/**
 * @param {import('discord.js').Client} client
 */
function start(client) {
    if (boundClient) return;
    boundClient = client;

    apply();

    client.on('shardReady', apply);
    client.on('shardResume', apply);
}

function stop() {
    if (boundClient) {
        boundClient.off('shardReady', apply);
        boundClient.off('shardResume', apply);
        boundClient = null;
    }
}

module.exports = {
    start,
    stop,
    set,
    get,
    reset,
    describe,
    normalise,
    ACTIVITY_TYPES,
    STATUSES,
    MAX_NAME,
    DEFAULT_PRESENCE
};
