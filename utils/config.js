
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

    // A hard stop on .drag. The escape condition is the target unmuting, so
    // without this someone who walks away muted is dragged indefinitely — a
    // voice move every few seconds forever, which risks rate-limiting the bot.
    dragMaxMs: envNumber(process.env.DRAG_MAX_MS, 2 * 60 * 1000),

    // Riri — the AI persona that replies when the bot is mentioned.
    // Runs on Groq's OpenAI-compatible chat completions endpoint.
    ai: {
        apiKey: process.env.GROQ_API_KEY || '',
        // Groq retires models often — check https://console.groq.com/docs/models
        // if riri starts saying her brain model is gone.
        model: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',

        // How many past messages to carry as context. This is one shared thread
        // per channel rather than one per person, so it needs more room than it
        // used to — a handful of turns disappears fast with several people in it.
        memoryTurns: Number(process.env.AI_MEMORY_TURNS) || 14,

        // Replies are 1-2 lines by design, so this stays small and fast.
        maxTokens: Number(process.env.AI_MAX_TOKENS) || 120,

        timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 20000,

        // What a remembered turn is cut to. Her own replies cap at 300, and one
        // pasted essay shouldn't ride along in every later request at ten times
        // that — the whole history is resent on every single call.
        historyCharLimit: Number(process.env.AI_HISTORY_CHAR_LIMIT) || 300,

        // A 429 from Groq is usually a burst over the per-minute limit rather
        // than a wall, so the request waits and tries again instead of giving
        // up. The budget is the ceiling on that waiting: someone is watching
        // the channel, and a daily-cap 429 asks for a wait no one will sit
        // through. 0 retries switches it off.
        maxRetries: envNumber(process.env.AI_MAX_RETRIES, 2),
        retryBudgetMs: envNumber(process.env.AI_RETRY_BUDGET_MS, 3000),

        // Riri butting in unprompted. The chance is rolled per eligible message;
        // the cooldown stops her dominating a busy channel. Set the chance to 0
        // to switch it off without touching the flag.
        interjectChance: envNumber(process.env.AI_INTERJECT_CHANCE, 0.0125), // ~1 in 80
        interjectCooldownMs: envNumber(process.env.AI_INTERJECT_COOLDOWN_MS, 5 * 60 * 1000),

        // Riri is written as this person's girlfriend. She is warm with him and
        // flatly uninterested in everyone else.
        partnerUserId: process.env.AI_PARTNER_USER_ID || '753892329982787624',

        // The people riri actually has a history with. Anyone not in here is a
        // stranger she talks to like a person — the cast is what stops her
        // treating her boyfriend's dad and her best mate's boyfriend the same.
        //
        // `name` is also the label her memory uses for that person's turns, so
        // she follows who said what even when someone changes their nickname.
        cast: {
            alpha: {
                id: process.env.AI_PARTNER_USER_ID || '753892329982787624',
                name: 'Alpha'
            },
            zyco: {
                id: process.env.AI_FATHER_IN_LAW_USER_ID || '671968512935198738',
                name: 'zyco'
            },
            iris: {
                id: process.env.AI_SIDECHICK_USER_ID || '1135904133145178242',
                name: 'iris'
            },
            sr: {
                id: process.env.AI_BOSS_USER_ID || '659030782890737685',
                name: 'SR'
            },
            rogue: {
                id: process.env.AI_ROGUE_USER_ID || '589420254283956224',
                name: 'rogue'
            },
            sam: {
                id: process.env.AI_SAM_USER_ID || '795189057059553300',
                name: 'sam'
            }
        },

        // The one channel riri lives in. She only answers here. Mentions
        // anywhere else get a one-line redirect instead of a conversation.
        homeChannelId: process.env.AI_HOME_CHANNEL_ID || '1322260150761033739',

        // How often she bothers redirecting someone who mentioned her in the
        // wrong channel. Per channel, so it cannot be used to spam.
        redirectCooldownMs: envNumber(process.env.AI_REDIRECT_COOLDOWN_MS, 10 * 60 * 1000),

        get enabled() {
            return Boolean(this.apiKey);
        },

        get interjectEnabled() {
            return envFlag(process.env.AI_INTERJECT_ENABLED) && this.enabled && this.interjectChance > 0;
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
    },

    // Heartbeat for the "Live Ops" panel on adarsharavind.com. The portfolio
    // shows the bot offline once these stop arriving for ~3 minutes.
    status: {
        url: (process.env.STATUS_HEARTBEAT_URL || '').trim(),
        token: (process.env.STATUS_HEARTBEAT_TOKEN || '').trim(),
        botId: (process.env.STATUS_BOT_ID || '').trim() || 'riri',
        intervalMs: 60 * 1000,

        get enabled() {
            return Boolean(this.url) && Boolean(this.token);
        }
    }
};
