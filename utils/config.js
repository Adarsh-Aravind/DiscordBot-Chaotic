// Every server-specific ID the bot needs, in one place.
// Each one can be overridden from .env without touching code — the values
// below are the current server's defaults so nothing breaks if .env is bare.

module.exports = {
    prefix: process.env.PREFIX || '.',

    // Role allowed to use mod / chaos commands.
    allowedRoleId: process.env.ALLOWED_ROLE_ID || '1322261748895711353',

    // User who always has access, regardless of roles.
    allowedUserId: process.env.ALLOWED_USER_ID || '1135904133145178242',

    // Bot owner — receives forwarded DMs.
    ownerId: process.env.OWNER_ID || '',

    // Where .hof posts messages.
    hallOfFameChannelId: process.env.HOF_CHANNEL_ID || '1488848396298096692',

    // Passive reaction: this user's messages get spelled at.
    reactionUserId: process.env.REACTION_USER_ID || '753892329982787624',
    reactionEmojis: ['🇬', '🇦', '🇾'],

    // How often .drag yanks someone to a new channel, in ms.
    dragIntervalMs: Number(process.env.DRAG_INTERVAL_MS) || 2500,

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

        get enabled() {
            return Boolean(this.apiKey);
        }
    },

    // YouTube upload notifications. Uses each channel's public RSS feed,
    // so there's no API key and no quota to worry about.
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
            return this.channelIds.length > 0 && Boolean(this.announceChannelId);
        }
    }
};
