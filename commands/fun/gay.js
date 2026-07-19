const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const reactionManager = require('../../utils/reactionManager');
const roastManager = require('../../utils/roastManager');
const { isAuthorized } = require('../../utils/permissions');
const config = require('../../utils/config');

// Button ids look like `gay:<targetId>` so the handler knows who to flip
// without keeping any state between the click and the original message.
const BUTTON_PREFIX = 'gay';

/**
 * The embed + button pair shown for one target. Shared with the button handler
 * so a click can redraw the exact same panel in its new state.
 */
function buildPanel(targetId) {
    const on = reactionManager.isTarget(targetId);

    const embed = new EmbedBuilder()
        .setColor(on ? '#FF69B4' : '#2B2D31')
        .setTitle(`${config.reactionEmojis.join(' ')} reactions`)
        .setDescription(
            `<@${targetId}> is currently **${on ? 'ON' : 'OFF'}**.\n` +
            'Hit the button to flip it.'
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${BUTTON_PREFIX}:${targetId}`)
            .setLabel(on ? 'Turn OFF' : 'Turn ON')
            .setStyle(on ? ButtonStyle.Danger : ButtonStyle.Success)
    );

    return { embeds: [embed], components: [row] };
}

module.exports = {
    name: 'gay',
    guildOnly: true,
    restricted: true,
    description: 'Toggles the 🇬 🇦 🇾 auto-reactions for a user.',
    buildPanel,
    BUTTON_PREFIX,
    async execute(message, args) {
        if (!isAuthorized(message)) {
            const roast = roastManager.getRandomRoast(message.guild?.id);
            return message.reply(`Nice try, but you don't have the permissions. ${roast}`);
        }

        const target = message.mentions.users.first();

        // No mention — just show who's on the list.
        if (!target) {
            const targets = reactionManager.list();
            const list = targets.length
                ? targets.map(id => `<@${id}>`).join(', ')
                : '*nobody, tragically*';

            return message.reply({
                content: `Currently getting spelled at: ${list}\nUse \`${config.prefix}gay @user\` to toggle someone.`,
                allowedMentions: { parse: [] }
            });
        }

        await message.reply({
            ...buildPanel(target.id),
            allowedMentions: { parse: [] }
        });
    }
};
