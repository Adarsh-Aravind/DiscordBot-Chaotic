const config = require('../utils/config');
const {
    generateAIResponse,
    rememberReply,
    isRiriMessage,
    shouldInterject
} = require('../utils/ai');
const reactionManager = require('../utils/reactionManager');
const clingyWatcher = require('../utils/clingyWatcher');

// Matches a leading mention of the bot: <@id> or <@!id>, optionally after
// whitespace. Anything after it is what the user actually said to riri.
function stripLeadingMention(content, botId) {
    const match = content.match(/^\s*<@!?(\d+)>\s*/);
    if (!match || match[1] !== botId) return null;
    return content.slice(match[0].length).trim();
}

// Is this message a Discord reply to something riri said?
//
// The tracked-ID set is persisted now, so this is an exact answer and survives
// restarts. It used to fall back to "any embed-less message from the bot",
// which also matched plain-text command output — the .gay list, the permission
// roast, the generic command-error reply — and pulled riri into replies aimed
// at those. It saves a fetchReference call on every server reply, too.
function isReplyToRiri(message) {
    const referencedId = message.reference?.messageId;
    return Boolean(referencedId) && isRiriMessage(referencedId);
}

// Returns what the user said to riri, or null if she wasn't being addressed.
function resolveRiriPrompt(message, client) {
    // Trigger 1: message starts by mentioning her.
    const mentioned = stripLeadingMention(message.content, client.user.id);
    if (mentioned !== null) return mentioned || 'hey';

    // Trigger 2: message is a reply to one of hers. Commands still win, so
    // `.forget` while replying to riri runs the command instead.
    if (message.content.startsWith(config.prefix)) return null;
    if (isReplyToRiri(message)) return message.content.trim() || 'hey';

    return null;
}

async function handleRiriChat(message, client) {
    const text = resolveRiriPrompt(message, client);
    if (text === null) return false;

    if (!config.ai.enabled) {
        console.warn('[AI] Riri was addressed but GROQ_API_KEY is not set.');
        return false;
    }

    const memoryKey = `${message.channel.id}:${message.author.id}`;

    try {
        await message.channel.sendTyping().catch(() => {});
        const reply = await generateAIResponse(memoryKey, text, {
            isPartner: message.author.id === config.ai.partnerUserId,
            speakerName: message.member?.displayName || message.author.username
        });
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

// Riri butting in on a conversation nobody invited her to. Deliberately placed
// after command handling: an interjection should never eat a command, and a
// one-word message isn't worth spending a Groq call on.
const MIN_INTERJECT_LENGTH = 12;

async function handleInterjection(message) {
    const text = message.content.trim();
    if (text.length < MIN_INTERJECT_LENGTH) return;
    if (!shouldInterject(message.channel.id)) return;

    try {
        await message.channel.sendTyping().catch(() => {});
        const reply = await generateAIResponse(
            `${message.channel.id}:${message.author.id}`,
            text,
            {
                isPartner: message.author.id === config.ai.partnerUserId,
                speakerName: message.member?.displayName || message.author.username
            }
        );
        const sent = await message.reply({
            content: reply,
            allowedMentions: { repliedUser: false, parse: [] }
        });

        rememberReply(sent.id);
        console.log(`[AI] Interjected in #${message.channel.name || message.channel.id}.`);
    } catch (err) {
        console.error('[AI INTERJECT ERROR]', err);
    }
}

async function handleDirectMessage(message, client) {
    const ownerId = config.ownerId;

    if (!ownerId) {
        console.warn('[DM Warning] No OWNER_ID configured in .env to receive DMs.');
        return false;
    }

    // Owner replying to a forwarded DM: `.reply <user_id> <message>`
    if (message.author.id === ownerId) {
        const replyCommand = `${config.prefix}reply `;
        if (!message.content.startsWith(replyCommand)) return false;

        const args = message.content.slice(replyCommand.length).trim().split(/ +/);
        const targetId = args.shift();
        const replyContent = args.join(' ');

        if (!targetId || !replyContent) {
            await message.reply(`⚠️ Format: \`${config.prefix}reply <user_id> <message>\``);
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

        // Resets riri's "he is ignoring me" clock. Any channel counts.
        clingyWatcher.noteActivity(message);

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
        // RIRI — uninvited
        // =========================
        if (!isCommandHandled && message.guild) {
            await handleInterjection(message);
        }

        // =========================
        // CUSTOM REACTIONS
        // =========================
        // Guild-only. With OWNER_ID unset (the shipped default) a DM falls
        // through to here, and spelling at someone in their DMs isn't the joke.
        if (message.guild && !isCommandHandled && reactionManager.isTarget(message.author.id)) {
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
