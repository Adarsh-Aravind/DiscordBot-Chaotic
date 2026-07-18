const { EmbedBuilder } = require('discord.js');
const { isAuthorized } = require('../../utils/permissions');
const config = require('../../utils/config');
const youtubeWatcher = require('../../utils/youtubeWatcher');

module.exports = {
    name: 'yt',
    guildOnly: true,
    restricted: true,
    description: 'YouTube notifier status. Usage: .yt | .yt check',
    async execute(message, args, client) {
        if (!isAuthorized(message)) {
            return message.reply('❌ You do not have permission to use this command.');
        }

        if (!config.youtube.enabled) {
            return message.reply('⚠️ The YouTube watcher is not configured.');
        }

        // .yt check — force an immediate poll.
        if (args[0]?.toLowerCase() === 'check') {
            const thinking = await message.reply('🔍 Checking all channels for new uploads...');
            const result = await youtubeWatcher.checkOnce(client);

            let text =
                `✅ Checked ${result.checked}/${config.youtube.channelIds.length} channel(s). ` +
                `Posted ${result.posted} new video(s).`;
            if (result.errors.length > 0) {
                text += `\n⚠️ Issues:\n${result.errors.map(e => `• ${e}`).join('\n')}`;
            }
            return thinking.edit(text);
        }

        // .yt — show what's being tracked.
        const state = youtubeWatcher.loadState();
        const lines = config.youtube.channelIds.map(id => {
            const entry = state[id];
            if (!entry) return `• \`${id}\` — *not checked yet*`;
            return `• **${entry.name}** — ${entry.seen.length} video(s) tracked`;
        });

        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('📺 YouTube Notifications')
            .setDescription(lines.join('\n'))
            .addFields(
                { name: 'Posting to', value: `<#${config.youtube.announceChannelId}>`, inline: true },
                {
                    name: 'Checks every',
                    value: `${config.youtube.pollIntervalMs / 60000} min`,
                    inline: true
                }
            )
            .setFooter({ text: 'Use .yt check to poll right now' });

        return message.reply({ embeds: [embed] });
    },
};
