const config = require('../utils/config');
const { generateAIResponse } = require('../utils/ai');

// Matches a leading mention of the bot: <@id> or <@!id>, optionally after
// whitespace. Anything after it is what the user actually said to riri.
function stripLeadingMention(content, botId) {
    const match = content.match(/^\s*<@!?(\d+)>\s*/);
    if (!match || match[1] !== botId) return null;
    return content.slice(match[0].length).trim();
}

async function handleRiriMention(message, client) {
    const prompt = stripLeadingMention(message.content, client.user.id);
    if (prompt === null) return false;

    if (!config.ai.enabled) {
        console.warn('[AI] Bot was mentioned but GROQ_API_KEY is not set.');
        return false;
    }

    // "@riri" with nothing after it still deserves a reply.
    const text = prompt || 'hey';
    const memoryKey = `${message.channel.id}:${message.author.id}`;

    try {
        await message.channel.sendTyping().catch(() => {});
        const reply = await generateAIResponse(memoryKey, text);
        await message.reply({
            content: reply,
            allowedMentions: { repliedUser: true, parse: [] }
        });
    } catch (err) {
        console.error('[AI REPLY ERROR]', err);
    }

    return true;
}

async function handleDirectMessage(message, client) {
    const ownerId = config.ownerId;

    if (!ownerId) {
        console.warn('[DM Warning] No OWNER_ID configured in .env to receive DMs.');
        return false;
    }

    // Owner replying to a forwarded DM: `.reply <user_id> <message>`
    if (message.author.id === ownerId) {
        if (!message.content.startsWith('.reply ')) return false;

        const args = message.content.split(' ').slice(1);
        const targetId = args.shift();
        const replyContent = args.join(' ');

        if (!targetId || !replyContent) {
            await message.reply('⚠️ Format: `.reply <user_id> <message>`');
            return true;
        }

        try {
            const targetUser = await client.users.fetch(targetId);
            await targetUser.send(`**Reply from Dev:**\n${replyContent}`);
            await message.react('✅').catch(() => {});
        } catch (err) {
            await message.reply(`❌ Failed to send: ${err.message}`);
        }
        return true;
    }

    // Anyone else: forward their DM to the owner.
    try {
        const owner = await client.users.fetch(ownerId);
        await owner.send(
            `📩 **DM from ${message.author.tag}** (\`${message.author.id}\`):\n${message.content}`
        );
        await message.react('✅').catch(() => {});
        return true;
    } catch (err) {
        console.error('[DM Forwarding Error]', err);
        return false;
    }
}

module.exports = {
    name: 'messageCreate',
    async execute(message, client) {
        if (message.author.bot) return;

        if (!message.guild) {
            const handled = await handleDirectMessage(message, client);
            if (handled) return;
        }

        // =========================
        // RIRI — mention to talk to her
        // =========================
        if (await handleRiriMention(message, client)) return;

        // =========================
        // COMMAND HANDLING
        // =========================
        let isCommandHandled = false;

        if (message.content.startsWith(config.prefix)) {
            const args = message.content.slice(config.prefix.length).trim().split(/ +/);
            const commandName = args.shift()?.toLowerCase();
            const command = client.commands.get(commandName);

            if (command) {
                isCommandHandled = true;

                if (command.guildOnly && !message.guild) {
                    await message.reply('This command only works inside a server.');
                    return;
                }

                try {
                    await command.execute(message, args, client);
                } catch (error) {
                    console.error(`[COMMAND ERROR] .${commandName}:`, error);
                    await message
                        .reply('There was an error while executing this command!')
                        .catch(() => {});
                }
            }
        }

        // =========================
        // CUSTOM REACTIONS
        // =========================
        if (!isCommandHandled && message.author.id === config.reactionUserId) {
            try {
                for (const emoji of config.reactionEmojis) {
                    await message.react(emoji);
                }
            } catch (err) {
                console.error('[REACTION ERROR]:', err);
            }
        }
    },
};
