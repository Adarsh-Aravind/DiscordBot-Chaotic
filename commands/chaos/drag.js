const { PermissionsBitField } = require('discord.js');
const stateManager = require('../../utils/stateManager');
const roastManager = require('../../utils/roastManager');
const { isAuthorized } = require('../../utils/permissions');
const config = require('../../utils/config');

module.exports = {
    name: 'drag',
    guildOnly: true,
    restricted: true,
    description: 'Drags a self-muted or self-deafened user randomly across voice channels.',
    async execute(message, args) {
        if (!isAuthorized(message)) {
            const roast = roastManager.getRandomRoast(message.guild?.id);
            return message.reply(`Nice try, but you don't have the permissions. ${roast}`);
        }

        const target = message.mentions.members.first();
        if (!target) return message.reply('Please mention a valid user to drag.');

        // Verify target is in a voice channel
        const voiceState = target.voice;
        if (!voiceState.channelId) {
            return message.reply('The target user is not in a voice channel.');
        }

        // Verify target is self-muted or self-deafened
        const isSelfMuted = voiceState.selfMute;
        const isSelfDeafened = voiceState.selfDeaf;

        if (!isSelfMuted && !isSelfDeafened) {
            return message.reply('The user must be self-muted or self-deafened to be dragged.');
        }

        if (stateManager.has(target.id)) {
            return message.reply('This user is already being dragged!');
        }

        const originalChannelId = voiceState.channelId;
        const guildId = message.guild.id;

        // Get all voice channels the user can be moved to
        const allChannels = message.guild.channels.cache.filter(c => 
            c.isVoiceBased() &&
            c.permissionsFor(target).has(PermissionsBitField.Flags.Connect)
        );

        if (allChannels.size < 2) {
            return message.reply('Not enough voice channels available to drag the user between.');
        }

        const channelsArray = Array.from(allChannels.values());

        // Start interval
        const intervalId = setInterval(async () => {
            try {
                // Fetch latest state just to be safe
                const currentVoiceState = target.voice;
                
                // If the user left voice completely, fallback to stop moving
                // voiceStateUpdate handles primary cleanups, but this is a fail-safe
                if (!currentVoiceState.channelId) {
                    clearInterval(intervalId);
                    stateManager.remove(target.id);
                    return;
                }

                const currentChannelId = currentVoiceState.channelId;
                let nextChannel;
                
                // Pick a random channel that isn't their current one
                do {
                    nextChannel = channelsArray[Math.floor(Math.random() * channelsArray.length)];
                } while (nextChannel.id === currentChannelId && channelsArray.length > 1);

                await target.voice.setChannel(nextChannel);
            } catch (error) {
                console.error(`Error dragging user ${target.id}:`, error);
                // Clear on permanent error to avoid infinite loop
                clearInterval(intervalId);
                stateManager.remove(target.id);
            }
        }, config.dragIntervalMs);

        // Save state
        stateManager.set(target.id, {
            originalChannelId,
            intervalId,
            guildId
        });

        message.reply(`Started dragging ${target.user.tag}. They must unmute and undeafen to break free!`);
    },
};
