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

// Discord caps an embed field value at 1024 characters and rejects the whole
// embed if one is over — so a single category growing too long would take the
// entire help message down, not just its own section. Split instead.
const FIELD_LIMIT = 1024;

function chunkLines(lines, limit = FIELD_LIMIT) {
    const chunks = [];
    let current = '';

    for (const line of lines) {
        const candidate = current ? current + '\n' + line : line;
        if (candidate.length > limit && current) {
            chunks.push(current);
            current = line;
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current);

    // A single line longer than the cap can't be split further, so trim it.
    return chunks.map(chunk => (chunk.length > limit ? chunk.slice(0, limit - 1) + '…' : chunk));
}

module.exports = {
    name: 'help',
    chunkLines,
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
            .setDescription(
                `Prefix: \`${config.prefix}\` — unlocked commands are open to everyone. ` +
                'Anything marked 🔒 needs a staff role.'
            )
            .setFooter({
                text: `Requested by ${message.author.tag}`,
                iconURL: message.author.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();

        for (const category of categories) {
            const lines = grouped
                .get(category)
                // Open commands first, so a normal user reads their own list
                // before hitting the staff-only block.
                .sort((a, b) =>
                    Number(Boolean(a.restricted)) - Number(Boolean(b.restricted)) ||
                    a.name.localeCompare(b.name))
                .map(cmd => {
                    const lock = cmd.restricted ? ' 🔒' : '';
                    return `\`${config.prefix}${cmd.name}\`${lock} — ${cmd.description}`;
                });

            const label = CATEGORY_LABELS[category] || category;
            for (const [index, value] of chunkLines(lines).entries()) {
                embed.addFields({
                    name: index === 0 ? label : label + ' (cont.)',
                    value,
                    inline: false
                });
            }
        }

        // If something didn't load, say so here rather than leaving a silent gap.
        const failures = client.commandLoadFailures || [];
        if (failures.length > 0) {
            embed.addFields({
                name: '⚠️ Failed to load',
                value: chunkLines(failures.map(f => '`' + f.file + '` — ' + f.reason))[0],
                inline: false
            });
        }

        embed.addFields({
            name: '✨ Passive Features',
            value:
                `Mention <@${client.user.id}> at the start of a message to chat with **riri** — ` +
                `she is <@${config.ai.partnerUserId}>'s girlfriend and will remind you of it. ` +
                'after that just reply to her messages to keep talking.\n' +
                `Stay deafened in voice too long and you get parked in <#${config.afk.channelId}>.\n` +
                `Reacts to messages from a certain someone with 🇬 🇦 🇾 — toggle who with \`${config.prefix}gay @user\`.`,
            inline: false
        });

        await message.reply({ embeds: [embed] });
    },
};
