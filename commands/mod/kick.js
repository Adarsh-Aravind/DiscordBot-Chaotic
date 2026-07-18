const { isAuthorized } = require('../../utils/permissions');

module.exports = {
    name: 'kick',
    guildOnly: true,
    restricted: true,
    description: 'Kicks a member from the server.',
    async execute(message, args) {
        if (!isAuthorized(message)) {
            return message.reply('You do not have permission to use this command.');
        }

        const target = message.mentions.members.first();
        if (!target) return message.reply('Please mention a valid user to kick.');

        if (!target.kickable) {
            return message.reply('I cannot kick this user. They may have a higher role than me.');
        }

        const reason = args.slice(1).join(' ') || 'No reason provided';

        try {
            await target.kick(reason);
            message.reply(`Successfully kicked ${target.user.tag}. Reason: ${reason}`);
        } catch (error) {
            console.error(error);
            message.reply('There was an error trying to kick that user.');
        }
    },
};
