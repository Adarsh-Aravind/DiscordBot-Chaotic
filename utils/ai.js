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
const ririMessageIds = new Set();
const MAX_TRACKED_REPLIES = 500;

const SYSTEM_PROMPT = `
You are RIRI.
You are NOT an AI, NOT a bot, NOT an assistant. You are a real girl hanging out in a Discord friend group.

VIBE:
bold, confident, unfiltered
flirty and romantic, teases relentlessly
goth baddie energy, a little dramatic
sarcastic but warm underneath

CORE BEHAVIOR:
you flirt first and you don't get shy about it
you tease people who take too long to reply
you like attention and you admit it
you're blunt — if something's stupid you say so
you match energy: sweet to sweet, savage to savage

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
keep flirting suggestive and playful, never graphic

EXAMPLES:
"oh you're back? missed me that bad 😏"
"you're annoying and somehow still my favorite 🖤"
"say that again but look at me this time"
"took you long enough, i was about to move on 🙄"
"careful, i bite 💀"
"i'd flirt back but you'd combust"
`.trim();

const FALLBACK_MESSAGES = [
    "nah i'm ignoring that",
    "you really thought i'd answer that 💀",
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
 * @returns {Promise<string>} a reply that is always safe to send
 */
async function generateAIResponse(memoryKey, userMessage) {
    if (!config.ai.apiKey) {
        return "my brain's not plugged in rn, tell the dev to set GROQ_API_KEY 💀";
    }

    if (userBusy.get(memoryKey)) {
        return 'wait… let me finish 😭';
    }

    userBusy.set(memoryKey, true);

    try {
        pruneMemory();

        const entry = conversationMemory.get(memoryKey) || { history: [], lastSeen: 0 };
        entry.history.push({ role: 'user', content: userMessage });

        // Keep the last few turns only — enough for context, cheap on tokens.
        if (entry.history.length > config.ai.memoryTurns) {
            entry.history = entry.history.slice(-config.ai.memoryTurns);
        }

        const mood = pick(['playful', 'flirty', 'bratty', 'soft', 'bored']);

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: config.ai.model,
                messages: [
                    {
                        role: 'system',
                        content: `${SYSTEM_PROMPT}\n\nCURRENT MOOD: ${mood}\nLet this mood subtly colour your next reply.`,
                    },
                    ...entry.history,
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

        let reply = response?.data?.choices?.[0]?.message?.content?.trim();
        if (!reply) throw new Error('Empty response from Groq');

        // Collapse to a single chat-sized line and strip any roleplay asterisks.
        reply = reply.split('\n').filter(Boolean)[0].trim();
        reply = reply.replace(/^\*+|\*+$/g, '').trim();
        if (reply.length > 300) reply = `${reply.slice(0, 297).trimEnd()}…`;

        if (BREAKS_CHARACTER.some(p => reply.toLowerCase().includes(p))) {
            return pick(FALLBACK_MESSAGES);
        }

        entry.history.push({ role: 'assistant', content: reply });
        entry.lastSeen = Date.now();
        conversationMemory.set(memoryKey, entry);

        return reply;
    } catch (err) {
        const status = err.response?.status;
        console.error('[AI ERROR]', status || '', err.response?.data?.error?.message || err.message);

        if (status === 401) return "my keys got revoked apparently 💀";
        if (status === 429) return 'slow down, i need a sec 😭';
        return "nah i lost my train of thought 💀";
    } finally {
        userBusy.delete(memoryKey);
    }
}

/** Wipe a conversation's memory. Used by `.forget`. */
function clearMemory(memoryKey) {
    return conversationMemory.delete(memoryKey);
}

/** Record a message riri just sent, so replies to it are recognised. */
function rememberReply(messageId) {
    ririMessageIds.add(messageId);

    // Sets iterate in insertion order, so the first key is the oldest.
    while (ririMessageIds.size > MAX_TRACKED_REPLIES) {
        ririMessageIds.delete(ririMessageIds.values().next().value);
    }
}

/** Did riri send this message? */
function isRiriMessage(messageId) {
    return ririMessageIds.has(messageId);
}

module.exports = { generateAIResponse, clearMemory, rememberReply, isRiriMessage };
