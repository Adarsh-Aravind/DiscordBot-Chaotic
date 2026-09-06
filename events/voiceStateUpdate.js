const stateManager = require('../utils/stateManager');
const afkWatcher = require('../utils/afkWatcher');
const deafenTracker = require('../utils/deafenTracker');

module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState, newState) {
        // Runs first, and off newState.id rather than newState.member, so a
        // missing member object can't stop the AFK countdown from updating.
        afkWatcher.handle(newState);
        deafenTracker.handle(newState);

        // We only care about users currently being dragged
        if (!stateManager.has(newState.member.id)) return;

        // Check if user has un-muted AND un-deafened themselves
        const isSelfMuted = newState.selfMute;
        const isSelfDeafened = newState.selfDeaf;

        if (!isSelfMuted && !isSelfDeafened) {
            // User unmuted and undeafened: restore them to original channel and clear interval
            const dragData = stateManager.get(newState.member.id);
            clearInterval(dragData.intervalId);
            
            try {
                // Ensure they are still in a voice channel to be moved
                if (newState.channelId) {
                    await newState.member.voice.setChannel(dragData.originalChannelId);
                }
            } catch (error) {
                console.error(`Failed to move user ${newState.member.id} back to original channel:`, error);
            } finally {
                // Remove from state manager regardless of success/failure
                stateManager.remove(newState.member.id);
            }
        } else if (!newState.channelId) {
            // User disconnected from voice completely
            const dragData = stateManager.get(newState.member.id);
            clearInterval(dragData.intervalId);
            stateManager.remove(newState.member.id);
        }
    },
};
