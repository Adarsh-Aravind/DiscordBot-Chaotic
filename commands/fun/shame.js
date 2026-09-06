const deafenTracker = require('../../utils/deafenTracker');
const config = require('../../utils/config');

module.exports = {
    name: 'shame',
    guildOnly: true,
    description: 'Ranks who spends the most time deafened. Usage: .shame [all]',
    async execute(message, args) {
        if (!config.deafenBoard.enabled) {
            return message.reply('⚠️ The deafen board is switched off.');
        }

        const allTime = args[0]?.toLowerCase() === 'all';
        const rows = deafenTracker.leaderboard(allTime ? 'ms' : 'periodMs');

        return message.reply({
            embeds: [deafenTracker.buildEmbed(rows, { allTime })],
            allowedMentions: { parse: [] }
        });
    },
};
