const config = require('./config');

/**
 * Does this member hold any of the allowed roles?
 *
 * On a cached GuildMember, `roles` is a role manager with a `.cache`. Button
 * interactions can hand back the raw API member instead, where `roles` is a
 * plain array of role ids — reading `.cache.has` on that throws, so handle both.
 *
 * @param {import('discord.js').GuildMember | { roles: string[] } | null} [member]
 * @returns {boolean}
 */
function hasAllowedRole(member) {
    const roles = member?.roles;
    if (!roles) return false;

    if (Array.isArray(roles)) {
        return roles.some(id => config.allowedRoleIds.includes(id));
    }
    return config.allowedRoleIds.some(id => Boolean(roles.cache?.has(id)));
}

module.exports = {
    hasAllowedRole,

    /**
     * Whether the message author may use restricted commands.
     * Guild-only: DMs have no member, so they never pass.
     * @param {import('discord.js').Message} message
     * @returns {boolean}
     */
    isAuthorized(message) {
        if (message.author.id === config.allowedUserId) return true;
        return hasAllowedRole(message.member);
    },

    /**
     * Same check, for interactions (button clicks) which carry `user` instead
     * of `author`.
     * @param {import('discord.js').Interaction} interaction
     * @returns {boolean}
     */
    isAuthorizedInteraction(interaction) {
        if (interaction.user.id === config.allowedUserId) return true;
        return hasAllowedRole(interaction.member);
    }
};
