const { isAuthorized } = require('../../utils/permissions');

module.exports = {
    name: 'mute',
    guildOnly: true,
    restricted: true,
    description: 'Timeouts a member for a specified duration.',
    async execute(message, args) {
        if (!isAuthorized(message)) {
            return message.reply('You do not have permission to use this command.');
        }

        const target = message.mentions.members.first();
        if (!target) return message.reply('Please mention a valid user to timeout.');

        if (!target.moderatable) {
            return message.reply('I cannot timeout this user. They may have a higher role than me.');
        }

        const durationStr = args[1] || '10'; // Default 10 minutes
        const durationMin = parseInt(durationStr, 10);

        if (isNaN(durationMin) || durationMin <= 0) {
            return message.reply('Please provide a valid duration in minutes.');
        }

        // Discord caps timeouts at 28 days; anything longer is rejected by the API.
        if (durationMin > 28 * 24 * 60) {
            return message.reply('Discord only allows timeouts up to 28 days (40320 minutes).');
        }

        const durationMs = durationMin * 60 * 1000;
        const reason = args.slice(2).join(' ') || 'No reason provided';

        try {
            await target.timeout(durationMs, reason);
            message.reply(`Successfully timed out ${target.user.tag} for ${durationMin} minutes. Reason: ${reason}`);
        } catch (error) {
            console.error(error);
            message.reply('There was an error trying to timeout that user.');
        }
    },
};
