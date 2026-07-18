const { EmbedBuilder } = require('discord.js');
const config = require('../../utils/config');

// Nicer titles than the raw folder names, and the order they appear in.
const CATEGORY_LABELS = {
    general: '📋 General',
    fun: '🎉 Fun',
    chaos: '🔥 Chaos',
    f1: '🏎️ Formula 1',
    mod: '🛡️ Moderation'
};

const CATEGORY_ORDER = ['general', 'fun', 'chaos', 'f1', 'mod'];

module.exports = {
    name: 'help',
    description: 'Lists all available commands.',
    async execute(message, args, client) {
        const grouped = new Map();
        for (const cmd of client.commands.values()) {
            const category = cmd.category || 'other';
            if (!grouped.has(category)) grouped.set(category, []);
            grouped.get(category).push(cmd);
        }

        const categories = [...grouped.keys()].sort((a, b) => {
            const ai = CATEGORY_ORDER.indexOf(a);
            const bi = CATEGORY_ORDER.indexOf(b);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

        const embed = new EmbedBuilder()
            .setColor('#2B2D31')
            .setTitle('Commands')
            .setDescription(`Prefix: \`${config.prefix}\` — commands marked 🔒 need the mod role.`)
            .setFooter({
                text: `Requested by ${message.author.tag}`,
                iconURL: message.author.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();

        for (const category of categories) {
            const lines = grouped
                .get(category)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(cmd => {
                    const lock = cmd.restricted ? ' 🔒' : '';
                    return `\`${config.prefix}${cmd.name}\`${lock} — ${cmd.description}`;
                })
                .join('\n');

            embed.addFields({
                name: CATEGORY_LABELS[category] || category,
                value: lines,
                inline: false
            });
        }

        embed.addFields({
            name: '✨ Passive Features',
            value:
                `Mention <@${client.user.id}> at the start of a message to chat with **riri**.\n` +
                'Reacts to messages from a certain someone with 🇬 🇦 🇾 combinations!',
            inline: false
        });

        await message.reply({ embeds: [embed] });
    },
};
