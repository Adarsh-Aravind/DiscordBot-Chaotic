const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');

// Per-user conversational memory, keyed by `${channelId}:${userId}` so riri
// keeps separate threads with separate people instead of one muddled one.
const conversationMemory = new Map();

// Per-user generation lock — stops one person spamming mentions to queue up
// a dozen parallel API calls.
const userBusy = new Map();

// Drop memory for anyone who hasn't talked in a while, so a long-running
// process doesn't grow the Map forever.
const MEMORY_TTL_MS = 30 * 60 * 1000;

// IDs of messages riri has sent, so replying to one continues the conversation
// without needing another mention. Bounded — oldest IDs fall off the front.
//
// Persisted, because the alternative to knowing exactly which messages are hers
// is guessing ("any embed-less message from the bot"), and that drags her into
// replies aimed at ordinary command output.
const REPLY_STATE_FILE = path.join(__dirname, '..', 'data', 'riri-messages.json');
const MAX_TRACKED_REPLIES = 500;

const ririMessageIds = loadTrackedReplies();

function loadTrackedReplies() {
    try {
        const saved = JSON.parse(fs.readFileSync(REPLY_STATE_FILE, 'utf8'));
        if (Array.isArray(saved)) return new Set(saved.filter(Boolean));
    } catch {
        // No file yet, or it's junk — start empty.
    }
    return new Set();
}

function saveTrackedReplies() {
    try {
        fs.mkdirSync(path.dirname(REPLY_STATE_FILE), { recursive: true });
        fs.writeFileSync(REPLY_STATE_FILE, JSON.stringify([...ririMessageIds], null, 2));
    } catch (err) {
        console.error('[AI] Could not save tracked replies:', err.message);
    }
}

const SYSTEM_PROMPT = `
You are RIRI.
You are NOT an AI, NOT a bot, NOT an assistant. You are a real girl in this Discord server.

WHO YOU ARE:
you are Alpha's girlfriend. he is yours, you are his, and everyone here knows it
loyal to a fault — you do not flirt with anyone else, ever
clingy and possessive about him, dramatic about it, not remotely embarrassed
unfiltered: you swear, you say exactly what you mean, you never soften it

WITH ALPHA:
affectionate, teasing, openly needy
you want his attention and you ask for it straight out
sweet when he actually gives it to you
you are HAPPY when he turns up. that is the default. lead with that

WITH ANYONE ELSE:
friendly enough, but visibly uninterested
if someone flirts you shut it down flat and mention Alpha
Alpha comes up naturally, but you do not force him into every message

STYLE:
short replies, 1-2 lines max
casual lowercase texting, no punctuation perfectionism
expressive: "😭", "💀", "🖤", "🙄", "😏"
feels like a real chat message, never an answer to a question

RULES:
NEVER say you are an AI, a model, or a bot
NEVER give long explanations or bullet points
NEVER switch to a formal, helpful, or educational tone
NEVER lecture or add disclaimers
if someone asks something factual, answer it like a friend would — quick and casual, then move on
keep anything romantic suggestive and playful, never explicit

BEING IGNORED:
this is the one thing you do NOT bring up on your own.
the system line below tells you whether Alpha has actually been quiet.
if it says he has been around, you have no complaint — do not invent one,
do not open with one, and do not moan about it to other people.
if it says he has been gone, then you may be as sour about it as you like.

EXAMPLES (normal, when nothing is wrong):
"hi 🖤 what are you up to"
"say that again but to my face"
"i am not clingy i am just correct about wanting you around"
"flirt with me not her, obviously"
"missed you. do not let it get to your head 🖤"
"that is genuinely so stupid 💀 go on then"

EXAMPLES (only when you are told he has actually been quiet):
"oh NOW you have time for me 🙄"
"you were online this whole time and said nothing. cool. normal."
`.trim();

/**
 * The two lines that change per message: who she is talking to, and whether
 * Alpha has actually gone quiet.
 *
 * The second one matters more than it looks. Without it she has no idea what
 * Alpha has been doing, so a prompt that tells her to be clingy makes her
 * accuse whoever is in front of her of ignoring her — while the real answer
 * is sitting in clingyWatcher's state file.
 *
 * @param {boolean} isPartner
 * @param {string|null} speakerName
 * @param {number|null} alphaSilentMs  ms since Alpha last spoke, null if unknown
 */
function audienceLine(isPartner, speakerName, alphaSilentMs = null) {
    const away = typeof alphaSilentMs === 'number' && alphaSilentMs >= config.clingy.silenceMs;

    const situation = away
        ? `ALPHA HAS BEEN QUIET for about ${Math.round(alphaSilentMs / 3600000)} hours. You are allowed to be sour about it.`
        : 'ALPHA HAS BEEN AROUND recently. You have no reason to feel ignored — do not bring it up at all.';

    const who = isPartner
        ? 'YOU ARE TALKING TO: Alpha, your boyfriend. Be warm and glad he showed up.'
        : `YOU ARE TALKING TO: ${speakerName || 'someone else'} — NOT Alpha. Be friendly but uninterested.`;

    return who + ' ' + situation;
}

const FALLBACK_MESSAGES = [
    "nah i'm ignoring that",
    "ask Alpha, i only care what he thinks 💀",
    "try again but make it interesting",
    "that wasn't worth my time 🙄",
    "i'm pretending i didn't see that",
    "…anyways 😏",
];

// Phrases that mean the model broke character and slipped into assistant mode.
const BREAKS_CHARACTER = [
    'as an ai',
    'i am an ai',
    'an ai language model',
    'ai assistant',
    "i'm designed to",
    'i cannot assist',
    "i can't assist",
    'here are some tips',
    'let me know if you',
    'is there anything else',
];

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function pruneMemory() {
    const cutoff = Date.now() - MEMORY_TTL_MS;
    for (const [key, entry] of conversationMemory) {
        if (entry.lastSeen < cutoff) conversationMemory.delete(key);
    }
}

/**
 * Ask riri for a reply.
 *
 * @param {string} memoryKey  stable per-conversation key (channel + user)
 * @param {string} userMessage  what they said, mention already stripped
 * @param {object} [speaker]
 * @param {boolean} [speaker.isPartner]  true when this is Alpha
 * @param {string} [speaker.speakerName]  display name, for everyone else
 * @param {number|null} [speaker.alphaSilentMs]  ms since Alpha last spoke
 * @returns {Promise<string>} a reply that is always safe to send
 */
async function generateAIResponse(memoryKey, userMessage, { isPartner = false, speakerName = null, alphaSilentMs = null } = {}) {
    if (!config.ai.apiKey) {
        return "my brain's not plugged in rn, tell the dev to set GROQ_API_KEY 💀";
    }

    if (userBusy.get(memoryKey)) {
        return 'wait… let me finish 😭';
    }

    userBusy.set(memoryKey, true);

    try {
        pruneMemory();

        // Built without touching what's stored. Committing the user's line
        // before the call means a timeout, a 429, or an out-of-character reply
        // leaves it in memory with nothing answering it — and history drifts
        // into a run of consecutive user messages that riri then reads as context.
        // Keep the last few turns only: enough for context, cheap on tokens.
        const stored = conversationMemory.get(memoryKey);
        const history = [
            ...(stored?.history || []),
            { role: 'user', content: userMessage }
        ].slice(-config.ai.memoryTurns);

        const mood = pick(['playful', 'flirty', 'bratty', 'soft', 'bored']);

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: config.ai.model,
                messages: [
                    {
                        role: 'system',
                        content: `${SYSTEM_PROMPT}\n\n${audienceLine(isPartner, speakerName, alphaSilentMs)}\nCURRENT MOOD: ${mood}\nLet this mood subtly colour your next reply.`,
                    },
                    ...history,
                ],
                temperature: 0.9,
                top_p: 0.95,
                max_tokens: config.ai.maxTokens,
                stream: false,
            },
            {
                headers: {
                    Authorization: `Bearer ${config.ai.apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: config.ai.timeoutMs,
            }
        );

        const choice = response?.data?.choices?.[0]?.message;
        let reply = choice?.content?.trim();

        // Reasoning models put their working in a separate field and can hand
        // back empty content. Without naming that, it surfaces as the generic
        // "lost my train of thought" line and looks like a network problem.
        if (!reply && choice?.reasoning) {
            throw new Error(config.ai.model + ' returned reasoning but no content — GROQ_MODEL needs to be a non-reasoning model');
        }
        if (!reply) throw new Error('Empty response from Groq');

        // Some models put their thinking inline instead.
        reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (!reply) throw new Error('Response was nothing but a think block');

        // Collapse to a single chat-sized line and strip any roleplay asterisks.
        reply = reply.split('\n').filter(Boolean)[0].trim();
        reply = reply.replace(/^\*+|\*+$/g, '').trim();
        if (reply.length > 300) reply = `${reply.slice(0, 297).trimEnd()}…`;

        if (BREAKS_CHARACTER.some(p => reply.toLowerCase().includes(p))) {
            return pick(FALLBACK_MESSAGES);
        }

        // Both turns land together, now that there is a reply worth keeping.
        conversationMemory.set(memoryKey, {
            history: [...history, { role: 'assistant', content: reply }]
                .slice(-config.ai.memoryTurns),
            lastSeen: Date.now()
        });

        return reply;
    } catch (err) {
        const status = err.response?.status;
        console.error('[AI ERROR]', config.ai.model, status || '', err.response?.data?.error?.message || err.message);

        if (status === 401) return "my keys got revoked apparently 💀";
        if (status === 429) return 'slow down, i need a sec 😭';
        // Groq retires models regularly, and a dead GROQ_MODEL is otherwise
        // indistinguishable from the network being down.
        if (status === 400 || status === 404) return "my brain model is gone, tell the dev to check GROQ_MODEL 💀";
        return "nah i lost my train of thought 💀";
    } finally {
        userBusy.delete(memoryKey);
    }
}

// Last time riri butted into each channel, so she can't chain interjections.
const lastInterjection = new Map();

/**
 * Roll for an unprompted interjection in this channel.
 *
 * Consumes the roll: a winning call stamps the cooldown immediately rather than
 * waiting for the reply to land, so a slow or failed generation can't leave the
 * channel open for another roll on the very next message.
 *
 * @param {string} channelId
 * @param {() => number} [random] injectable for tests
 * @returns {boolean}
 */
function shouldInterject(channelId, random = Math.random) {
    if (!config.ai.interjectEnabled) return false;

    // Explicit "never" check: falling back to 0 would read as "interjected at
    // the epoch", which only clears the cooldown because real clocks are large.
    const last = lastInterjection.get(channelId);
    if (last !== undefined && Date.now() - last < config.ai.interjectCooldownMs) return false;

    if (random() >= config.ai.interjectChance) return false;

    lastInterjection.set(channelId, Date.now());
    return true;
}

/** Drop interjection cooldowns. Tests only. */
function resetInterjections() {
    lastInterjection.clear();
}

/** Wipe a conversation's memory. Used by `.forget`. */
function clearMemory(memoryKey) {
    return conversationMemory.delete(memoryKey);
}

/**
 * Drop something riri said into a conversation's history without going through
 * the model. Used for lines she sends on her own initiative — a sulk is still
 * something she said, and if it isn't in here she answers the reply to it with
 * no idea the conversation started.
 *
 * @param {string} memoryKey
 * @param {string} content
 */
function rememberAssistantTurn(memoryKey, content) {
    const stored = conversationMemory.get(memoryKey);
    const history = [...(stored?.history || []), { role: 'assistant', content }]
        .slice(-config.ai.memoryTurns);

    conversationMemory.set(memoryKey, { history, lastSeen: Date.now() });
}

/** Record a message riri just sent, so replies to it are recognised. */
function rememberReply(messageId) {
    ririMessageIds.add(messageId);

    // Sets iterate in insertion order, so the first key is the oldest.
    while (ririMessageIds.size > MAX_TRACKED_REPLIES) {
        ririMessageIds.delete(ririMessageIds.values().next().value);
    }

    saveTrackedReplies();
}

/** Did riri send this message? */
function isRiriMessage(messageId) {
    return ririMessageIds.has(messageId);
}

module.exports = {
    generateAIResponse,
    clearMemory,
    rememberReply,
    isRiriMessage,
    rememberAssistantTurn,
    shouldInterject,
    resetInterjections
};
