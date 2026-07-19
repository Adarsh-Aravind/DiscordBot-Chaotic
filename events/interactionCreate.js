const { MessageFlags } = require('discord.js');
const reactionManager = require('../utils/reactionManager');
const { isAuthorizedInteraction } = require('../utils/permissions');
const { buildPanel, BUTTON_PREFIX } = require('../commands/fun/gay');

async function handleGayToggle(interaction, targetId) {
    if (!isAuthorizedInteraction(interaction)) {
        return interaction.reply({
            content: "That button isn't for you.",
            flags: MessageFlags.Ephemeral
        });
    }

    reactionManager.toggle(targetId);

    // Redraw in place so the panel always shows the live state.
    await interaction.update({
        ...buildPanel(targetId),
        allowedMentions: { parse: [] }
    });
}

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        if (!interaction.isButton()) return;

        const [prefix, targetId] = interaction.customId.split(':');
        if (prefix !== BUTTON_PREFIX || !targetId) return;

        try {
            await handleGayToggle(interaction, targetId);
        } catch (err) {
            console.error('[BUTTON ERROR] gay toggle:', err);
        }
    }
};
