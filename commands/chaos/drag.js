const { PermissionsBitField } = require('discord.js');
const stateManager = require('../../utils/stateManager');
const config = require('../../utils/config');

module.exports = {
    name: 'drag',
    guildOnly: true,
    restricted: true,
    description: 'Drags a self-muted or self-deafened user randomly across voice channels.',
    async execute(message, args) {
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

        /** Put them back and stop. Shared by the timeout and the error paths. */
        const release = async (reason) => {
            stateManager.remove(target.id);
            try {
                if (target.voice.channelId) {
                    await target.voice.setChannel(originalChannelId);
                }
            } catch (error) {
                console.error(`Failed to restore ${target.id} after ${reason}:`, error.message);
            }
        };

        // Start interval
        const intervalId = setInterval(async () => {
            try {
                // Fetch latest state just to be safe
                const currentVoiceState = target.voice;

                // If the user left voice completely, fallback to stop moving
                // voiceStateUpdate handles primary cleanups, but this is a fail-safe
                if (!currentVoiceState.channelId) {
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
                await release('an error');
            }
        }, config.dragIntervalMs);

        // A hard stop. The escape condition is the target unmuting, so someone
        // who walks away still muted was dragged forever — a voice move every
        // few seconds indefinitely, which is a lot of API calls for a joke and
        // risks rate-limiting the whole bot.
        const timeoutId = setTimeout(async () => {
            console.log(`Drag on ${target.id} hit the ${config.dragMaxMs}ms cap.`);
            await release('the time cap');
            message
                .channel.send(`⏱️ Done dragging ${target.user.tag} — they outlasted it.`)
                .catch(() => {});
        }, config.dragMaxMs);
        timeoutId.unref?.();

        // Save state
        stateManager.set(target.id, {
            originalChannelId,
            intervalId,
            timeoutId,
            guildId
        });

        const capMinutes = Math.round(config.dragMaxMs / 60000);
        message.reply(
            `Started dragging ${target.user.tag}. They must unmute and undeafen to break free ` +
            `— or wait it out for ${capMinutes} min.`
        );
    },
};
