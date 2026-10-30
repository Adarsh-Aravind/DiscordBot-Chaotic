const { EmbedBuilder } = require('discord.js');
const presenceManager = require('../../utils/presenceManager');
const config = require('../../utils/config');

const VERBS = Object.keys(presenceManager.ACTIVITY_TYPES);

function buildStatusEmbed() {
    const current = presenceManager.get();

    return new EmbedBuilder()
        .setColor('#2B2D31')
        .setTitle('Presence')
        .setDescription(`Showing: **${presenceManager.describe()}**`)
        .addFields(
            {
                name: 'Set it',
                value:
                    `\`${config.prefix}presence <verb> <text>\`\n` +
                    `Verbs: ${VERBS.map(v => `\`${v}\``).join(', ')}`,
                inline: false
            },
            {
                name: 'Online status',
                value:
                    `\`${config.prefix}presence <${presenceManager.STATUSES.join('|')}>\` ` +
                    `(or \`${config.prefix}presence status <…>\`)\n` +
                    'Changes the dot only — the activity stays as it is. ' +
                    '`invisible` reads as offline and hides the activity with it.',
                inline: false
            },
            {
                name: 'Clickable link',
                value:
                    `\`${config.prefix}presence streaming <text> | <twitch/youtube url>\`\n` +
                    'Only `streaming` can carry a link, and only a twitch.tv or youtube.com one.',
                inline: false
            },
            {
                name: 'Back to default',
                value: `\`${config.prefix}presence reset\``,
                inline: false
            }
        )
        .setFooter({ text: 'Survives restarts — saved to data/presence.json' });
}

module.exports = {
    name: 'presence',
    guildOnly: true,
    restricted: true,
    description:
        "Sets the bot's presence. Usage: .presence <verb> <text> | " +
        '.presence <online|idle|dnd|invisible> | .presence reset',
    async execute(message, args) {
        // No args — show what's set and how to change it.
        if (args.length === 0) {
            return message.reply({ embeds: [buildStatusEmbed()] });
        }

        const sub = args[0].toLowerCase();

        if (sub === 'reset') {
            presenceManager.reset();
            return message.reply(`✅ Back to default — **${presenceManager.describe()}**`);
        }

        // Changes only the online dot, keeping the activity. Written either as
        // `.presence status dnd` or just `.presence dnd` — the status names
        // don't collide with any verb, and the bare form is what people
        // actually type.
        if (sub === 'status' || presenceManager.STATUSES.includes(sub)) {
            const wanted = sub === 'status' ? args[1]?.toLowerCase() : sub;
            if (!presenceManager.STATUSES.includes(wanted)) {
                return message.reply(
                    `⚠️ Pick one of: ${presenceManager.STATUSES.map(s => `\`${s}\``).join(', ')}`
                );
            }

            const result = presenceManager.set({ ...presenceManager.get(), status: wanted });
            if (!result.ok) return message.reply(`⚠️ ${result.reason}`);
            return message.reply(`✅ Now **${presenceManager.describe()}**`);
        }

        if (!VERBS.includes(sub)) {
            return message.reply(
                `⚠️ Unknown verb \`${sub}\`. Try: ${VERBS.map(v => `\`${v}\``).join(', ')}\n` +
                `Or a status on its own: ${presenceManager.STATUSES.map(s => `\`${s}\``).join(', ')}\n` +
                `Run \`${config.prefix}presence\` on its own to see the current one.`
            );
        }

        // Everything after the verb is the text, with an optional ` | <url>`
        // on the end for streaming. A pipe is used rather than "last word looks
        // like a URL" so a title can legitimately contain a link.
        const rest = args.slice(1).join(' ').trim();
        if (!rest) {
            return message.reply(`⚠️ Give it something to say: \`${config.prefix}presence ${sub} <text>\``);
        }

        const [namePart, urlPart] = rest.split('|').map(part => part.trim());

        if (urlPart && sub !== 'streaming') {
            return message.reply('⚠️ Only `streaming` can carry a link — Discord ignores it on the others.');
        }

        const result = presenceManager.set({
            ...presenceManager.get(),
            type: sub,
            name: namePart,
            url: urlPart || null
        });

        if (!result.ok) return message.reply(`⚠️ ${result.reason}`);

        // Say so when a link was dropped, rather than silently ignoring it —
        // otherwise it looks like the bot took it and Discord broke it.
        const droppedUrl = urlPart && !result.presence.url;
        const note = droppedUrl
            ? '\n⚠️ Dropped the link — Discord only renders twitch.tv and youtube.com ones.'
            : '';

        return message.reply(`✅ Now **${presenceManager.describe()}**${note}`);
    }
};
