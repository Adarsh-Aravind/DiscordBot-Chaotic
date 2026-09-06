const { EmbedBuilder } = require('discord.js');
const { isAuthorized } = require('../../utils/permissions');
const config = require('../../utils/config');
const twitchWatcher = require('../../utils/twitchWatcher');

/** Discord relative timestamp, or null if the feed didn't give us a usable one. */
function relativeTime(iso) {
    const ms = Date.parse(iso ?? '');
    return Number.isNaN(ms) ? null : `<t:${Math.floor(ms / 1000)}:R>`;
}

module.exports = {
    name: 'twitch',
    guildOnly: true,
    restricted: true,
    description: 'Twitch go-live notifier status. Usage: .twitch | .twitch check',
    async execute(message, args, client) {
        if (!isAuthorized(message)) {
            return message.reply('❌ You do not have permission to use this command.');
        }

        if (!config.twitch.enabled) {
            return message.reply('⚠️ The Twitch watcher is not configured.');
        }

        // .twitch check — force an immediate poll.
        if (args[0]?.toLowerCase() === 'check') {
            const thinking = await message.reply('🔍 Checking who is live right now...');
            const result = await twitchWatcher.checkOnce(client);

            let text =
                `✅ ${result.live} of ${config.twitch.logins.length} streamer(s) live. ` +
                `Announced ${result.posted}.`;
            if (result.errors.length > 0) {
                text += `\n⚠️ Issues:\n${result.errors.map(e => `• ${e}`).join('\n')}`;
            }
            return thinking.edit(text);
        }

        // .twitch — show who's being watched, and who's up.
        const state = twitchWatcher.loadState();
        const lines = config.twitch.logins.map(login => {
            const entry = state[login];
            if (!entry) return `• \`${login}\` — offline`;

            const since = relativeTime(entry.startedAt);
            return `• **${entry.name || login}** — 🔴 live${since ? ` since ${since}` : ''}`;
        });

        const embed = new EmbedBuilder()
            .setColor('#9146FF')
            .setTitle('🔴 Twitch Notifications')
            .setDescription(lines.join('\n'))
            .addFields(
                { name: 'Posting to', value: `<#${config.twitch.announceChannelId}>`, inline: true },
                {
                    name: 'Checks every',
                    value: `${config.twitch.pollIntervalMs / 60000} min`,
                    inline: true
                }
            )
            .setFooter({ text: 'Use .twitch check to poll right now' });

        return message.reply({ embeds: [embed] });
    },
};
