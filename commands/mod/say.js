const { PermissionsBitField } = require('discord.js');
const { isAuthorized } = require('../../utils/permissions');
const config = require('../../utils/config');

// Discord's hard cap on a single message.
const MAX_LENGTH = 2000;

function canSpeakIn(channel, member) {
    const perms = channel.permissionsFor(member);
    return Boolean(
        perms?.has(PermissionsBitField.Flags.ViewChannel) &&
        perms?.has(PermissionsBitField.Flags.SendMessages)
    );
}

module.exports = {
    name: 'say',
    guildOnly: true,
    restricted: true,
    description: 'Says something as the bot. Usage: .say [#channel] <message>',
    async execute(message, args) {
        if (!isAuthorized(message)) {
            return message.reply('❌ You do not have permission to use this command.');
        }

        const words = [...args];
        let channel = message.channel;

        // A channel mention only counts as a target when it leads. Otherwise
        // "everyone check #general" would post itself into the wrong channel.
        const leading = words[0]?.match(/^<#(\d+)>$/);
        if (leading) {
            words.shift();
            channel = message.guild.channels.cache.get(leading[1]);
            if (!channel?.isTextBased()) {
                return message.reply("That isn't a text channel I can see.");
            }
        }

        const content = words.join(' ').trim();
        if (!content) {
            return message.reply(`⚠️ Format: \`${config.prefix}say [#channel] <message>\``);
        }
        if (content.length > MAX_LENGTH) {
            return message.reply(`That's ${content.length} characters — Discord stops at ${MAX_LENGTH}.`);
        }

        // Don't let the bot become a way around a channel someone is locked out
        // of. They have to be able to speak there themselves.
        if (!canSpeakIn(channel, message.member)) {
            return message.reply("You can't post in that channel yourself, so neither will I.");
        }
        if (!canSpeakIn(channel, message.guild.members.me)) {
            return message.reply("I don't have permission to post in that channel.");
        }

        try {
            await channel.send({
                content,
                // The bot may hold Mention Everyone where the person running this
                // does not, so it repeats the text without pinging anyone.
                allowedMentions: { parse: [] }
            });
        } catch (err) {
            console.error('[COMMAND ERROR] .say:', err);
            return message.reply(`❌ Couldn't send that: ${err.message}`);
        }

        // Drop the command itself, so it reads as the bot talking rather than relaying.
        if (message.deletable) {
            await message.delete().catch(() => {});
        }
    },
};
