// Tracks who is currently being dragged, and puts them back when it ends.
const state = new Map();

/**
 * structure in the Map:
 * key (userId) -> value: {
 *   originalChannelId: string,
 *   intervalId: NodeJS.Timeout,
 *   timeoutId: NodeJS.Timeout | null,
 *   guildId: string
 * }
 */

module.exports = {
    get(userId) {
        return state.get(userId);
    },
    set(userId, data) {
        state.set(userId, data);
    },

    /** Stop the timers for a drag and forget it. Safe to call twice. */
    remove(userId) {
        const entry = state.get(userId);
        if (entry) {
            clearInterval(entry.intervalId);
            if (entry.timeoutId) clearTimeout(entry.timeoutId);
        }
        state.delete(userId);
    },

    has(userId) {
        return state.has(userId);
    },

    /** Everyone currently being dragged. */
    list() {
        return [...state.keys()];
    },

    /**
     * Put everyone back where they were found and clear the timers.
     *
     * Called on shutdown: a restart used to leave whoever was being dragged
     * wherever they were last thrown, with the interval gone and nothing left
     * in memory to put them back.
     *
     * @param {import('discord.js').Client} client
     */
    async restoreAll(client) {
        const entries = [...state.entries()];
        if (entries.length === 0) return;

        console.log(`Restoring ${entries.length} dragged user(s) before shutdown.`);

        for (const [userId, data] of entries) {
            // Timers first: the move below is awaited, and a tick firing
            // mid-restore would just throw them somewhere else again.
            clearInterval(data.intervalId);
            if (data.timeoutId) clearTimeout(data.timeoutId);
            state.delete(userId);

            try {
                const guild = await client.guilds.fetch(data.guildId);
                const member = await guild.members.fetch(userId);
                // Only if they're still in voice — setChannel on someone who
                // has disconnected throws.
                if (member.voice.channelId) {
                    await member.voice.setChannel(data.originalChannelId);
                }
            } catch (error) {
                console.error(`Could not restore ${userId} on shutdown: ${error.message}`);
            }
        }
    }
};
