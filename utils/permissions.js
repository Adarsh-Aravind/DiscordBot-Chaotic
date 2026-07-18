const config = require('./config');

module.exports = {
    /**
     * Whether the message author may use restricted commands.
     * Guild-only: DMs have no member, so they never pass.
     * @param {import('discord.js').Message} message
     * @returns {boolean}
     */
    isAuthorized(message) {
        if (message.author.id === config.allowedUserId) return true;
        return Boolean(message.member?.roles.cache.has(config.allowedRoleId));
    }
};
