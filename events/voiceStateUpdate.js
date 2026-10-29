const stateManager = require('../utils/stateManager');

module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState, newState) {
        // We only care about users currently being dragged
        if (!stateManager.has(newState.member.id)) return;

        // Check if user has un-muted AND un-deafened themselves
        const isSelfMuted = newState.selfMute;
        const isSelfDeafened = newState.selfDeaf;

        if (!isSelfMuted && !isSelfDeafened) {
            // User unmuted and undeafened: restore them to their original channel.
            const dragData = stateManager.get(newState.member.id);

            // Stops the timers too, and before the await — otherwise a tick
            // firing mid-restore throws them straight back out again.
            stateManager.remove(newState.member.id);

            try {
                // Ensure they are still in a voice channel to be moved
                if (newState.channelId) {
                    await newState.member.voice.setChannel(dragData.originalChannelId);
                }
            } catch (error) {
                console.error(`Failed to move user ${newState.member.id} back to original channel:`, error);
            }
        } else if (!newState.channelId) {
            // User disconnected from voice completely
            stateManager.remove(newState.member.id);
        }
    },
};
