// Flags a streamer's server nickname with a red dot while they're live.
//
// There's no way to derive Twitch login -> Discord user, so this runs off the
// TWITCH_LIVE_NICKNAME_MAP mapping in config and stays inert until it's filled
// in. It used to stay inert *silently*, which made an empty map and a genuine
// permissions failure look identical from the outside — hence `report()` and
// `diagnose()`, and the logging on every bail-out below.

const fs = require('fs');
const path = require('path');
const { PermissionsBitField } = require('discord.js');
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

/**
 * Prefixed, trimmed to Discord's 32-character nickname cap.
 *
 * The budget is counted in UTF-16 code units, not code points: Discord
 * validates `length`, and the red circle is a surrogate pair, so `'🔴 '` costs
 * 3 there while reading as 2 characters. Counting code points left a long name
 * at 33 units and Discord rejected the rename outright — which looked exactly
 * like a permissions problem.
 */
function withFlag(name) {
    const base = hasFlag(name) ? name.slice(PREFIX.length) : (name || '');

    // Trim by code point so a surrogate pair is never cut in half, but measure
    // the result in code units so the cap is the one Discord actually enforces.
    const chars = [...base];
    let out = '';
    for (const char of chars) {
        if (PREFIX.length + out.length + char.length > MAX_NICKNAME) break;
        out += char;
    }

    return PREFIX + out;
}

// --- diagnostics -----------------------------------------------------------

/**
 * Why the feature is or isn't going to do anything. Pure, so `.twitch` can
 * render it and the tests can assert on it.
 *
 * @returns {{enabled: boolean, mapped: number, reason: string|null}}
 */
function diagnose() {
    const mapped = Object.keys(config.twitch.liveNicknameMap).length;

    if (mapped === 0) {
        return {
            enabled: false,
            mapped: 0,
            reason: 'TWITCH_LIVE_NICKNAME_MAP is empty — set it to "twitchlogin:discordUserId,..." in .env'
        };
    }

    if (!config.twitch.liveNicknameEnabled) {
        return {
            enabled: false,
            mapped,
            reason: 'TWITCH_LIVE_NICKNAME_ENABLED is switched off'
        };
    }

    // A login in the map that nobody is watching will never be flagged, since
    // flagging only happens off a go-live the Twitch watcher noticed.
    const unwatched = Object.keys(config.twitch.liveNicknameMap)
        .filter(login => !config.twitch.logins.includes(login));

    if (unwatched.length > 0) {
        return {
            enabled: true,
            mapped,
            reason: `mapped but not in TWITCH_LOGINS, so never checked: ${unwatched.join(', ')}`
        };
    }

    return { enabled: true, mapped, reason: null };
}

/** Say at startup whether this is actually wired up. */
function report() {
    const { enabled, mapped, reason } = diagnose();

    if (!enabled) {
        console.log(`[LiveNick] Inactive — ${reason}`);
        return;
    }

    console.log(`[LiveNick] Active for ${mapped} mapped user(s).`);
    if (reason) console.warn(`[LiveNick] ${reason}`);
}

// --- applying --------------------------------------------------------------

/**
 * The member behind a twitch login, or null with a logged reason.
 * @param {import('discord.js').Guild} guild
 * @param {string} login
 */
async function resolveMember(guild, login) {
    const key = login.toLowerCase();
    const userId = config.twitch.liveNicknameMap[key];
    if (!userId) {
        console.warn(`[LiveNick] ${key} is live but has no entry in TWITCH_LIVE_NICKNAME_MAP.`);
        return null;
    }

    try {
        return await guild.members.fetch(userId);
    } catch (err) {
        // Nearly always a wrong id, or they left the server.
        console.error(
            `[LiveNick] No member ${userId} in ${guild.name} for ${key} — check the id in TWITCH_LIVE_NICKNAME_MAP (${err.message})`
        );
        return null;
    }
}

/**
 * Can the bot actually rename this member? Checked up front so the reason is
 * specific, rather than surfacing as a bare "Missing Permissions" after a
 * failed API call.
 *
 * @param {import('discord.js').GuildMember} member
 * @returns {string|null} why not, or null if it can
 */
function renameBlockedReason(member) {
    const me = member.guild.members.me;
    if (!me) return 'the bot is not cached in this guild';

    if (!me.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
        return 'the bot is missing the Manage Nicknames permission';
    }

    if (member.id === member.guild.ownerId) {
        return 'Discord does not let a bot rename the server owner';
    }

    // Equal top role counts: the hierarchy check is strictly greater-than.
    if (me.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
        return `their top role (${member.roles.highest.name}) is at or above the bot's (${me.roles.highest.name})`;
    }

    return null;
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

    const blocked = renameBlockedReason(member);
    if (blocked) {
        console.error(`[LiveNick] Cannot flag ${member.user.tag}: ${blocked}.`);
        return;
    }

    const state = loadState();
    // `null` is meaningful: they had no nickname and should end up with none.
    state[member.id] = current ?? null;
    saveState(state);

    try {
        // displayName, not username: with no server nickname set, their global
        // display name is what everyone sees, and basing the flag on the raw
        // handle renamed "Cool Name" to "🔴 coolname_1234" for the stream.
        await member.setNickname(withFlag(current || member.displayName));
        console.log(`[LiveNick] Flagged ${member.user.tag} as live.`);
    } catch (err) {
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

/**
 * Bring every mapped nickname in line with who is actually live.
 *
 * Called at the end of each Twitch check rather than on the live -> offline
 * transition, because a transition-driven rename only works if the bot is
 * running for both halves of it. It wasn't: a stream that ended while the bot
 * was down left the red dot on for good, and a bot that restarted mid-stream
 * never applied one, since the announce had already been recorded and the
 * streamer no longer counted as newly live.
 *
 * Idempotent — flagging someone already flagged is a no-op, so this is safe to
 * run on every poll and repairs itself after any amount of downtime.
 *
 * @param {import('discord.js').Guild} guild
 * @param {Set<string>} liveLogins twitch logins considered live right now
 */
async function sync(guild, liveLogins) {
    if (!config.twitch.liveNicknameEnabled) return;

    for (const login of Object.keys(config.twitch.liveNicknameMap)) {
        if (liveLogins.has(login)) {
            await flag(guild, login).catch(err =>
                console.error(`[LiveNick] flag ${login} failed: ${err.message}`));
        } else {
            await unflag(guild, login).catch(err =>
                console.error(`[LiveNick] unflag ${login} failed: ${err.message}`));
        }
    }
}

/**
 * Clear any flag left on disk, for when the Twitch watcher is switched off
 * entirely and `sync` is never going to run to tidy up after it.
 *
 * @param {import('discord.js').Client} client
 */
async function sweep(client) {
    const state = loadState();
    const ids = Object.keys(state);
    if (ids.length === 0) return;

    for (const userId of ids) {
        for (const guild of client.guilds.cache.values()) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member || !hasFlag(member.nickname)) continue;

            try {
                await member.setNickname(state[userId] ?? null);
                console.log(`[LiveNick] Cleared a stale live flag on ${member.user.tag}.`);
            } catch (err) {
                console.error(`[LiveNick] Could not clear stale flag on ${member.user.tag}: ${err.message}`);
            }
        }

        delete state[userId];
    }

    saveState(state);
}

module.exports = {
    flag,
    unflag,
    sync,
    sweep,
    report,
    diagnose,
    withFlag,
    hasFlag,
    renameBlockedReason,
    PREFIX,
    MAX_NICKNAME
};
