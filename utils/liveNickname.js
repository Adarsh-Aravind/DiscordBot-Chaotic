// Flags a streamer's server nickname with a red dot while they're live.
//
// There's no way to derive Twitch login -> Discord user, so this runs off the
// TWITCH_LIVE_NICKNAME_MAP mapping in config and stays inert until it's filled in.

const fs = require('fs');
const path = require('path');
const config = require('./config');

const STATE_FILE = path.join(__dirname, '..', 'data', 'live-nicknames.json');

const PREFIX = '🔴 ';
const MAX_NICKNAME = 32;

// --- state persistence -----------------------------------------------------
// Originals are kept on disk, not derived by stripping the prefix, because a
// long name gets truncated to make room — stripping it back would return a
// shortened version of their name, permanently.

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveState(state) {
    try {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
        console.error('[LiveNick] Could not save state:', err.message);
    }
}

// --- naming ----------------------------------------------------------------

function hasFlag(name) {
    return typeof name === 'string' && name.startsWith(PREFIX);
}

/** Prefixed, trimmed to Discord's 32-character nickname cap. */
function withFlag(name) {
    const base = hasFlag(name) ? name.slice(PREFIX.length) : (name || '');
    const room = MAX_NICKNAME - [...PREFIX].length;
    return PREFIX + [...base].slice(0, room).join('');
}

// --- applying --------------------------------------------------------------

async function resolveMember(guild, login) {
    const userId = config.twitch.liveNicknameMap[login.toLowerCase()];
    if (!userId) return null;
    return guild.members.fetch(userId).catch(() => null);
}

/**
 * Add the red dot. Records whatever they were called first.
 * @param {import('discord.js').Guild} guild
 * @param {string} login twitch login
 */
async function flag(guild, login) {
    if (!config.twitch.liveNicknameEnabled) return;

    const member = await resolveMember(guild, login);
    if (!member) return;

    const current = member.nickname;
    if (hasFlag(current)) return; // already flagged

    const state = loadState();
    // `null` is meaningful: they had no nickname and should end up with none.
    state[member.id] = current ?? null;
    saveState(state);

    try {
        await member.setNickname(withFlag(current || member.user.username));
        console.log(`[LiveNick] Flagged ${member.user.tag} as live.`);
    } catch (err) {
        // Nearly always hierarchy: the bot can't rename anyone at or above its
        // own top role, and never the guild owner.
        console.error(`[LiveNick] Could not rename ${member.user.tag}: ${err.message}`);
        delete state[member.id];
        saveState(state);
    }
}

/**
 * Put their name back exactly as it was.
 * @param {import('discord.js').Guild} guild
 * @param {string} login twitch login
 */
async function unflag(guild, login) {
    if (!config.twitch.liveNicknameEnabled) return;

    const member = await resolveMember(guild, login);
    if (!member) return;

    const state = loadState();
    if (!(member.id in state)) {
        // Nothing recorded. Only touch them if we can see our own prefix.
        if (!hasFlag(member.nickname)) return;
    }

    const original = state[member.id] ?? null;

    try {
        await member.setNickname(original);
        console.log(`[LiveNick] Cleared the live flag on ${member.user.tag}.`);
    } catch (err) {
        console.error(`[LiveNick] Could not restore ${member.user.tag}: ${err.message}`);
        return;
    }

    delete state[member.id];
    saveState(state);
}

module.exports = { flag, unflag, withFlag, hasFlag, PREFIX, MAX_NICKNAME };
