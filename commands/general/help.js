const { EmbedBuilder } = require('discord.js');
const config = require('../../utils/config');
const liveNickname = require('../../utils/liveNickname');
const reactionManager = require('../../utils/reactionManager');

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

// It also caps the whole embed at 6000 characters across every field, and at 25
// fields. Now that help covers passive features and owner commands as well as
// the command list, it is close enough to those to be worth guarding.
const EMBED_LIMIT = 6000;
const MAX_FIELDS = 25;

// Commands that only work in the bot's DMs, so they never appear in
// client.commands and would otherwise be missing from help entirely.
const DM_ONLY_COMMANDS = [
    {
        name: 'reply',
        usage: 'reply <user_id> <message>',
        description: 'Answers a forwarded DM as the bot. Owner only, in the bot\'s DMs.'
    }
];

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

/**
 * Everything the bot does without being asked, with whether it is actually
 * switched on. The state matters more than the description: a feature listed
 * flatly as present, while its env var is blank and it silently does nothing,
 * is what made the live-nickname flag look broken rather than unconfigured.
 *
 * @param {import('discord.js').Client} client
 * @returns {string[]}
 */
function passiveLines(client) {
    const mark = on => (on ? '✅' : '❌');
    const lines = [];

    lines.push(
        `${mark(config.ai.enabled)} **Riri** — mention <@${client.user.id}> to talk to her, ` +
        `then just reply to keep going. Lives in <#${config.ai.homeChannelId}>; ` +
        `mentioned elsewhere she points back there. \`${config.prefix}forget\` wipes the thread.`
    );

    lines.push(
        `${mark(config.ai.interjectEnabled)} **Riri butting in** — joins her home channel uninvited, ` +
        `roughly 1 in ${Math.round(1 / (config.ai.interjectChance || 1))} messages, ` +
        `at most once every ${Math.round(config.ai.interjectCooldownMs / 60000)} min.`
    );

    const targets = reactionManager.list();
    lines.push(
        `${mark(targets.length > 0)} **${config.reactionEmojis.join(' ')} reactions** — ` +
        `${targets.length ? `spelling at ${targets.map(id => `<@${id}>`).join(', ')}` : 'nobody targeted'}. ` +
        `Toggle with \`${config.prefix}gay @user\`.`
    );

    lines.push(
        `${mark(config.youtube.enabled)} **YouTube uploads** — ${config.youtube.channelIds.length} channel(s) ` +
        `watched via RSS, posted to <#${config.youtube.announceChannelId}> every ` +
        `${Math.round(config.youtube.pollIntervalMs / 60000)} min. Pings @everyone.`
    );

    lines.push(
        `${mark(config.twitch.enabled)} **Twitch go-live** — ${config.twitch.logins.length} streamer(s) ` +
        `watched, posted to <#${config.twitch.announceChannelId}> every ` +
        `${Math.round(config.twitch.pollIntervalMs / 60000)} min. Pings @everyone.`
    );

    const nick = liveNickname.diagnose();
    lines.push(
        `${mark(nick.enabled)} **🔴 live nickname** — prefixes a live streamer's nickname` +
        (nick.enabled ? `, ${nick.mapped} user(s) mapped.` : `. ${nick.reason}.`)
    );

    lines.push(
        `${mark(Boolean(config.ownerId))} **DM relay** — DMs to the bot are forwarded to the owner` +
        (config.ownerId ? '.' : ' (no `OWNER_ID` set).')
    );

    lines.push(
        `${mark(config.status.enabled)} **Status heartbeat** — reports uptime and latency to the Live Ops panel.`
    );

    return lines;
}

module.exports = {
    name: 'help',
    chunkLines,
    passiveLines,
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

        const restrictedCount = [...client.commands.values()].filter(c => c.restricted).length;

        const embed = new EmbedBuilder()
            .setColor('#2B2D31')
            .setTitle('Commands')
            .setDescription(
                `Prefix: \`${config.prefix}\` — ${client.commands.size} commands, ` +
                `${restrictedCount} of them 🔒 staff-only. ` +
                'Everything the bot does is listed here, including the locked ones.'
            )
            .setFooter({
                text: `Requested by ${message.author.tag}`,
                iconURL: message.author.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();

        // Collected first so the 6000-character and 25-field caps can be
        // enforced across the whole embed before anything is sent.
        const fields = [];

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
                fields.push({
                    name: index === 0 ? label : label + ' (cont.)',
                    value,
                    inline: false
                });
            }
        }

        // Owner-only, DM-only: real commands that live outside client.commands.
        for (const [index, value] of chunkLines(
            DM_ONLY_COMMANDS.map(cmd => `\`${config.prefix}${cmd.usage}\` 👑 — ${cmd.description}`)
        ).entries()) {
            fields.push({
                name: index === 0 ? '👑 Owner (in DMs)' : '👑 Owner (in DMs) (cont.)',
                value,
                inline: false
            });
        }

        for (const [index, value] of chunkLines(passiveLines(client)).entries()) {
            fields.push({
                name: index === 0 ? '✨ Passive Features' : '✨ Passive Features (cont.)',
                value,
                inline: false
            });
        }

        // If something didn't load, say so here rather than leaving a silent gap.
        const failures = client.commandLoadFailures || [];
        if (failures.length > 0) {
            fields.push({
                name: '⚠️ Failed to load',
                value: chunkLines(failures.map(f => '`' + f.file + '` — ' + f.reason))[0],
                inline: false
            });
        }

        // Discord rejects the whole embed if either cap is exceeded, so drop
        // trailing fields and say so rather than sending nothing at all.
        let used = (embed.data.description || '').length + (embed.data.footer?.text || '').length;
        let dropped = 0;

        for (const field of fields) {
            const cost = field.name.length + field.value.length;
            if (embed.data.fields?.length >= MAX_FIELDS - 1 || used + cost > EMBED_LIMIT - 200) {
                dropped++;
                continue;
            }
            embed.addFields(field);
            used += cost;
        }

        if (dropped > 0) {
            embed.addFields({
                name: '…',
                value: `${dropped} more section(s) didn't fit in one message.`,
                inline: false
            });
        }

        await message.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
};
