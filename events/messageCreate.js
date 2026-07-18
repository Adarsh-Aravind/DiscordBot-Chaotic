const config = require('../utils/config');
const { generateAIResponse, rememberReply, isRiriMessage } = require('../utils/ai');

// Matches a leading mention of the bot: <@id> or <@!id>, optionally after
// whitespace. Anything after it is what the user actually said to riri.
function stripLeadingMention(content, botId) {
    const match = content.match(/^\s*<@!?(\d+)>\s*/);
    if (!match || match[1] !== botId) return null;
    return content.slice(match[0].length).trim();
}

// Is this message a Discord reply to something riri said?
async function isReplyToRiri(message, client) {
    const referencedId = message.reference?.messageId;
    if (!referencedId) return false;

    // Fast path — we sent it this process lifetime.
    if (isRiriMessage(referencedId)) return true;

    // Slow path — covers messages sent before the last restart, when the
    // tracked-ID set was empty. Embeds are excluded so replying to a command's
    // output (.help, .hof) doesn't drag riri into it.
    try {
        const referenced = await message.fetchReference();
        return referenced.author.id === client.user.id && referenced.embeds.length === 0;
    } catch {
        return false; // deleted, or not fetchable
    }
}

// Returns what the user said to riri, or null if she wasn't being addressed.
async function resolveRiriPrompt(message, client) {
    // Trigger 1: message starts by mentioning her.
    const mentioned = stripLeadingMention(message.content, client.user.id);
    if (mentioned !== null) return mentioned || 'hey';

    // Trigger 2: message is a reply to one of hers. Commands still win, so
    // `.forget` while replying to riri runs the command instead.
    if (message.content.startsWith(config.prefix)) return null;
    if (await isReplyToRiri(message, client)) return message.content.trim() || 'hey';

    return null;
}

async function handleRiriChat(message, client) {
    const text = await resolveRiriPrompt(message, client);
    if (text === null) return false;

    if (!config.ai.enabled) {
        console.warn('[AI] Riri was addressed but GROQ_API_KEY is not set.');
        return false;
    }

    const memoryKey = `${message.channel.id}:${message.author.id}`;

    try {
        await message.channel.sendTyping().catch(() => {});
        const reply = await generateAIResponse(memoryKey, text);
        const sent = await message.reply({
            content: reply,
            allowedMentions: { repliedUser: true, parse: [] }
        });

        // So replying to this one keeps the conversation going.
        rememberReply(sent.id);
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
        if (await handleRiriChat(message, client)) return;

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
