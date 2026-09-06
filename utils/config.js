const path = require('path');

// Every server-specific ID the bot needs, in one place.
// Each one can be overridden from .env without touching code — the values
// below are the current server's defaults so nothing breaks if .env is bare.

/**
 * Reads a boolean switch from .env. Unset or blank means "on", so existing
 * setups keep working; anything falsy-looking turns the feature off outright.
 */
function envFlag(raw, fallback = true) {
    if (raw === undefined || raw.trim() === '') return fallback;
    return !['false', '0', 'no', 'off'].includes(raw.trim().toLowerCase());
}

/**
 * Reads a number from .env. Unlike `Number(x) || fallback` this keeps an
 * explicit 0, which matters for the chance settings — 0 means "never".
 */
function envNumber(raw, fallback) {
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

/** Parses "key:value,key:value" into an object. Blank yields {}. */
function envPairs(raw) {
    const pairs = {};
    for (const chunk of (raw || '').split(',')) {
        const [key, value] = chunk.split(':').map(part => part?.trim());
        if (key && value) pairs[key.toLowerCase()] = value;
    }
    return pairs;
}

module.exports = {
    prefix: process.env.PREFIX || '.',

    // Roles allowed to use restricted commands — holding any one of them is
    // enough. ALLOWED_ROLE_IDS (comma-separated) overrides the whole list;
    // ALLOWED_ROLE_ID is still read so existing .env files keep working.
    allowedRoleIds: (
        process.env.ALLOWED_ROLE_IDS ||
        [
            process.env.ALLOWED_ROLE_ID || '1322261748895711353', // original mod role
            '1482112143758458953'                                 // full-access staff role
        ].join(',')
    )
        .split(',')
        .map(id => id.trim())
        .filter(Boolean),

    // User who always has access, regardless of roles.
    allowedUserId: process.env.ALLOWED_USER_ID || '1135904133145178242',

    // Bot owner — receives forwarded DMs.
    ownerId: process.env.OWNER_ID || '',

    // Where .hof posts messages.
    hallOfFameChannelId: process.env.HOF_CHANNEL_ID || '1488848396298096692',

    // Passive reaction: this user's messages get spelled at. Only the starting
    // point — `.gay @user` toggles targets at runtime (see reactionManager).
    reactionUserId: process.env.REACTION_USER_ID || '753892329982787624',
    reactionEmojis: ['🇬', '🇦', '🇾'],

    // How often .drag yanks someone to a new channel, in ms.
    dragIntervalMs: Number(process.env.DRAG_INTERVAL_MS) || 2500,

    // Auto-AFK: park this user in the AFK channel once they have been deafened
    // for deafenGraceMs without a break. "Deafened" covers both self-deafen and
    // a moderator's server-deafen.
    afk: {
        userId: process.env.AFK_USER_ID || '623754619784527888',
        channelId: process.env.AFK_CHANNEL_ID || '1322265047220617270',
        deafenGraceMs: Number(process.env.AFK_DEAFEN_GRACE_MS) || 60 * 1000,

        get enabled() {
            return (
                envFlag(process.env.AFK_ENABLED) &&
                Boolean(this.userId) &&
                Boolean(this.channelId)
            );
        }
    },

    // Riri — the AI persona that replies when the bot is mentioned.
    // Runs on Groq's OpenAI-compatible chat completions endpoint.
    ai: {
        apiKey: process.env.GROQ_API_KEY || '',
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',

        // How many past messages (user + riri combined) to carry as context.
        memoryTurns: Number(process.env.AI_MEMORY_TURNS) || 8,

        // Replies are 1-2 lines by design, so this stays small and fast.
        maxTokens: Number(process.env.AI_MAX_TOKENS) || 120,

        timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 20000,

        // Riri butting in unprompted. The chance is rolled per eligible message;
        // the cooldown stops her dominating a busy channel. Set the chance to 0
        // to switch it off without touching the flag.
        interjectChance: envNumber(process.env.AI_INTERJECT_CHANCE, 0.0125), // ~1 in 80
        interjectCooldownMs: envNumber(process.env.AI_INTERJECT_COOLDOWN_MS, 5 * 60 * 1000),

        // Riri is written as this person's girlfriend. She is warm with him and
        // flatly uninterested in everyone else.
        partnerUserId: process.env.AI_PARTNER_USER_ID || '753892329982787624',

        // Where she sulks when he goes quiet.
        homeChannelId: process.env.AI_HOME_CHANNEL_ID || '1322260150761033739',

        get enabled() {
            return Boolean(this.apiKey);
        },

        get interjectEnabled() {
            return envFlag(process.env.AI_INTERJECT_ENABLED) && this.enabled && this.interjectChance > 0;
        }
    },

    // Riri noticing she is being ignored. Counts any message from the partner
    // anywhere in the server as "he is around".
    clingy: {
        // Quiet for this long and she says something.
        silenceMs: envNumber(process.env.CLINGY_SILENCE_MS, 3 * 60 * 60 * 1000),

        // Never more than one sulk per this window, however long the silence runs.
        cooldownMs: envNumber(process.env.CLINGY_COOLDOWN_MS, 3 * 60 * 60 * 1000),

        // How often to look.
        checkIntervalMs: envNumber(process.env.CLINGY_CHECK_INTERVAL_MS, 10 * 60 * 1000),

        // Ping him, or just post into the channel.
        mention: envFlag(process.env.CLINGY_MENTION),

        // Overridable so the tests never scribble on real state.
        stateFile: process.env.CLINGY_STATE_FILE ||
            path.join(__dirname, '..', 'data', 'clingy.json'),

        get enabled() {
            return (
                envFlag(process.env.CLINGY_ENABLED) &&
                Boolean(this.silenceMs > 0)
            );
        }
    },

    // Deafen shame board: how long everyone spends deafened in voice, and a
    // periodic ranking posted to the notification channel.
    deafenBoard: {
        announceChannelId: process.env.DEAFEN_BOARD_CHANNEL_ID || '1162427835059806299',

        // How often a ranking goes out, and how often we check whether one is due.
        postIntervalMs: envNumber(process.env.DEAFEN_BOARD_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000),
        checkIntervalMs: envNumber(process.env.DEAFEN_BOARD_CHECK_INTERVAL_MS, 60 * 60 * 1000),

        topN: envNumber(process.env.DEAFEN_BOARD_TOP_N, 10),

        // Overridable so the tests never scribble on real stats.
        stateFile: process.env.DEAFEN_BOARD_STATE_FILE ||
            path.join(__dirname, '..', 'data', 'deafen-stats.json'),

        // Below this, a stint is someone fumbling their hotkey, not ignoring us.
        minSessionMs: envNumber(process.env.DEAFEN_BOARD_MIN_SESSION_MS, 30 * 1000),

        get enabled() {
            return envFlag(process.env.DEAFEN_BOARD_ENABLED) && Boolean(this.announceChannelId);
        }
    },


    // YouTube upload notifications. Uses each channel's public RSS feed,
    // so there's no API key and no quota to worry about.
    //
    // These announcements ping @everyone, so the kill switch matters: blanking
    // the ids in .env falls back to the defaults below rather than clearing
    // them, which would leave no way to turn the watcher off. Set
    // YOUTUBE_ENABLED=false for that.
    youtube: {
        // Comma-separated in .env; falls back to the list below.
        channelIds: (process.env.YOUTUBE_CHANNEL_IDS || [
            'UCx4uKj-AZYfJNeaOZxRNRFw', // MRG YT
            'UCQiQ_TxQPQvuH61IHQer4gg', // SR GAMER
            'UCy4OrvbbLaGSn5UdKeC2G_g', // ZYCO
            'UCt-9UbluKuxeUaWr90Eoz7w', // N O V A
            'UCJ6HuHlj2i5Wa5RsbqZnwRw'  // Lotta Chan
        ].join(','))
            .split(',')
            .map(id => id.trim())
            .filter(Boolean),

        announceChannelId: process.env.YOUTUBE_ANNOUNCE_CHANNEL_ID || '1162427835059806299',

        // RSS is cheap, but 5 minutes is plenty responsive and stays polite.
        pollIntervalMs: Number(process.env.YOUTUBE_POLL_INTERVAL_MS) || 5 * 60 * 1000,

        get enabled() {
            return (
                envFlag(process.env.YOUTUBE_ENABLED) &&
                this.channelIds.length > 0 &&
                Boolean(this.announceChannelId)
            );
        }
    },

    // Twitch go-live notifications. Unlike YouTube there's no public feed, so
    // this needs an app registered at dev.twitch.tv (client id + secret).
    // TWITCH_ENABLED=false turns it off without unsetting the credentials.
    twitch: {
        clientId: process.env.TWITCH_CLIENT_ID || '',
        clientSecret: process.env.TWITCH_CLIENT_SECRET || '',

        // Twitch logins (the name in the URL), comma-separated in .env.
        logins: (process.env.TWITCH_LOGINS || [
            'r0gue___',
            'srgamerog'
        ].join(','))
            .split(',')
            .map(name => name.trim().toLowerCase())
            .filter(Boolean),

        announceChannelId: process.env.TWITCH_ANNOUNCE_CHANNEL_ID || '1162427835059806299',

        // One call covers every streamer, so 2 minutes is cheap and catches
        // go-lives quickly. Helix allows far more than this.
        pollIntervalMs: Number(process.env.TWITCH_POLL_INTERVAL_MS) || 2 * 60 * 1000,

        // Twitch login -> Discord user id, so going live can flag that person's
        // nickname with a red dot. Format: "login:userId,login:userId".
        // There is no way to derive this mapping, so the feature stays inert
        // until you fill it in.
        liveNicknameMap: envPairs(process.env.TWITCH_LIVE_NICKNAME_MAP),

        get liveNicknameEnabled() {
            return (
                envFlag(process.env.TWITCH_LIVE_NICKNAME_ENABLED) &&
                Object.keys(this.liveNicknameMap).length > 0
            );
        },

        get enabled() {
            return (
                envFlag(process.env.TWITCH_ENABLED) &&
                Boolean(this.clientId) &&
                Boolean(this.clientSecret) &&
                this.logins.length > 0 &&
                Boolean(this.announceChannelId)
            );
        }
    }
};
