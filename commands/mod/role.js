const { isAuthorized } = require('../../utils/permissions');

module.exports = {
    name: 'role',
    guildOnly: true,
    restricted: true,
    description: 'Adds or removes a role from a member.',
    async execute(message, args) {
        if (!isAuthorized(message)) {
            return message.reply('You do not have permission to use this command.');
        }

        const target = message.mentions.members.first();
        if (!target) return message.reply('Please mention a valid user to modify their role.');

        const roleMention = message.mentions.roles.first();
        if (!roleMention) return message.reply('Please mention a valid role to add/remove.');

        // Verify bot hierarchy
        const botMember = message.guild.members.cache.get(message.client.user.id);
        if (roleMention.position >= botMember.roles.highest.position) {
            return message.reply('I cannot manage this role as it is higher than or equal to my highest role.');
        }

        try {
            if (target.roles.cache.has(roleMention.id)) {
                await target.roles.remove(roleMention);
                message.reply(`Successfully removed \`${roleMention.name}\` from ${target.user.tag}.`);
            } else {
                await target.roles.add(roleMention);
                message.reply(`Successfully added \`${roleMention.name}\` to ${target.user.tag}.`);
            }
        } catch (error) {
            console.error(error);
            message.reply('There was an error trying to modify roles for that user.');
        }
    },
};
