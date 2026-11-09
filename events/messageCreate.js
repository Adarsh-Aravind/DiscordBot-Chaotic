const config = require('../utils/config');
const {
    generateAIResponse,
    rememberReply,
    isRiriMessage,
    shouldInterject
} = require('../utils/ai');
const chatGate = require('../utils/chatGate');
const reactionManager = require('../utils/reactionManager');
const roastManager = require('../utils/roastManager');
const { isAuthorized } = require('../utils/permissions');

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

// Riri lives in one channel. Addressed anywhere else she points at it once and
// drops it — silence reads as a broken bot, and answering would mean keeping a
// conversation going in a channel she is not supposed to be in.
const lastRedirect = new Map();

const REDIRECTS = [
    'not in here. come say it in',
    'wrong channel babe. i live in',
    'i dont do this one. im in'
];

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

async function redirectToHomeChannel(message) {
    const last = lastRedirect.get(message.channel.id);
    if (last !== undefined && Date.now() - last < config.ai.redirectCooldownMs) return;
    lastRedirect.set(message.channel.id, Date.now());

    await message
        .reply({
            content: `${pick(REDIRECTS)} <#${config.ai.homeChannelId}> \u{1F644}`,
            allowedMentions: { repliedUser: false, parse: [] }
        })
        .catch(err => console.error('[AI REDIRECT ERROR]', err.message));
}

// What she does instead of answering, when answering isn't worth a Groq call.
// A reaction costs nothing, lands instantly and still says she saw it.
const IGNORED_REACTIONS = {
    duplicate: '🥱',   // you said that already
    flood: '🙄',       // you are typing faster than anyone can care
    budget: '😮‍💨'      // the room has had its fill for the minute
};

async function handleRiriChat(message, client) {
    const text = resolveRiriPrompt(message, client);
    if (text === null) return false;

    if (!config.ai.enabled) {
        console.warn('[AI] Riri was addressed but GROQ_API_KEY is not set.');
        return false;
    }

    if (message.channel.id !== config.ai.homeChannelId) {
        // A DM gets nothing: there is no channel to point at that makes sense
        // there, and OWNER_ID forwarding has already had its go above.
        if (!message.guild) return false;
        await redirectToHomeChannel(message);
        return true;
    }

    // Is this worth spending a Groq call on? The same line again, or one
    // person firing off five in a row, is not: every call carries her whole
    // prompt plus the channel's history, and a spammer burning through the
    // per-minute token limit takes the rest of the room down with them.
    const verdict = chatGate.admit(message.author.id, text);
    if (!verdict.ok) {
        // Only the first refusal of a burst gets a reaction. Ten of them would
        // just be the spam again in a different colour.
        if (verdict.acknowledge) {
            await message.react(IGNORED_REACTIONS[verdict.reason]).catch(() => {});
        }
        console.log(`[AI] Skipped a ${verdict.reason} from ${message.author.tag}.`);
        return true;
    }

    // Keyed by channel, not by channel+user: everyone in here shares one
    // conversation, so someone chiming in on what another person said carries
    // on the same thread instead of starting a private one.
    const memoryKey = message.channel.id;

    try {
        await message.channel.sendTyping().catch(() => {});
        const reply = await generateAIResponse(memoryKey, text, {
            speakerId: message.author.id,
            speakerName: message.member?.displayName || message.author.username
        });

        // Nothing worth sending: this line was superseded by a newer one while
        // she was still answering the last, or she has already said out loud
        // that she's rate limited and repeating it would only be noise. Seen,
        // not answered — which is the honest version of what happened.
        if (!reply) {
            // The gate recorded this line as said when it let it through, so
            // without this the only thing they could do about a 👀 — ask
            // again — came back a duplicate, and they were stuck. Hands the
            // room's budget slot back too: no call was made with it.
            chatGate.forget(message.author.id, text, verdict.at);

            await message.react('👀').catch(() => {});
            return true;
        }

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
    // She lives in one channel, so she butts in there and nowhere else.
    if (message.channel.id !== config.ai.homeChannelId) return;

    const text = message.content.trim();
    if (text.length < MIN_INTERJECT_LENGTH) return;
    if (!shouldInterject(message.channel.id)) return;

    // The people who actually mentioned her have first claim on the minute's
    // allowance, so butting in only happens with room to spare. Checked after
    // the roll on purpose: losing here spends the win and puts her back on
    // cooldown, rather than leaving her re-rolling on every message while the
    // budget is full.
    const slot = Date.now();
    if (!chatGate.reserve(slot)) return;

    try {
        await message.channel.sendTyping().catch(() => {});
        const reply = await generateAIResponse(message.channel.id, text, {
            speakerId: message.author.id,
            speakerName: message.member?.displayName || message.author.username,
            unprompted: true
        });

        // She had nothing worth saying. Nobody asked her to speak, so the roll
        // is simply spent and she stays quiet — better than butting in with an
        // apology for the rate limit. The cooldown was stamped when the roll
        // was won, so this doesn't open the channel up to another go.
        //
        // The minute's allowance is a different matter: it was reserved for a
        // call that never happened, and holding it would refuse someone who
        // actually did mention her. That goes back.
        if (!reply) {
            chatGate.release(slot);
            return;
        }

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

                // The `restricted` flag is enforced here rather than inside each
                // command. It used to be documented as central but wasn't: all
                // thirteen locked commands repeated the check by hand, so the
                // flag only drove the 🔒 in `.help`, and a new command that
                // declared it and forgot the check would have been wide open.
                //
                // Guild-only is checked above, so `message.member` exists by now.
                if (command.restricted && !isAuthorized(message)) {
                    const roast = roastManager.getRandomRoast(message.guild?.id);
                    await message.reply(`Nice try, but you don't have the permissions. ${roast}`);
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
