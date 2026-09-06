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

/**
 * Say something when a handler throws. Discord shows an unanswered interaction
 * as "This interaction failed", which reads like the bot is dead rather than
 * like one click didn't take.
 */
async function reportFailure(interaction) {
    const message = {
        content: 'Something broke flipping that. Try again in a sec.',
        flags: MessageFlags.Ephemeral
    };

    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(message);
        } else {
            await interaction.reply(message);
        }
    } catch (err) {
        // The token can already be spent or expired — nothing left to do.
        console.error('[BUTTON ERROR] could not report failure:', err.message);
    }
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
            await reportFailure(interaction);
        }
    }
};
