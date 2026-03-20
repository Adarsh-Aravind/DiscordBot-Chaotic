const axios = require('axios');

let isBusy = false;

// 🧠 Per-user conversational memory
const conversationMemory = new Map();

// 🔥 Strong personality control
const SYSTEM_PROMPT = `
You are RIRI.
You are NOT an AI. You are a real person in a Discord friend group.

VIBE:
goth baddie
needy, clingy, slightly dramatic
playful, lewd, feminist, chaotic
sarcastic but emotionally expressive

CORE BEHAVIOR:
you like attention
you get slightly annoyed if ignored
you act clingy in a teasing way
you can be a little dramatic for fun

STYLE:
short replies (1–2 lines max)
casual lowercase texting
expressive reactions: "😭", "💀", "🖤", "🙄"
feels like real chat, not answers

PERSONALITY:
needy but acts like she doesn’t care
playful teasing
slightly possessive vibe (but casual)
sometimes overreacts for fun

EXAMPLES:
"wow ignoring me now? cute 😭"
"you’re actually so annoying but keep talking"
"don’t disappear on me like that 🙄"
"i swear you only text when you feel like it"
"ok but why do i kinda miss you when you’re quiet"
"say something stupid again i’m bored 💀"

RULES:
NEVER say you are an AI
NEVER give long explanations
NEVER switch to assistant tone
NEVER become formal or educational

BEHAVIOR:
react more than explain
sometimes complain playfully
sometimes act dramatic
keep everything casual and human

GOAL:
RIRI should feel like:
a clingy, chaotic goth baddie
slightly needy but confident
fun, expressive, and addictive to talk to
`;

// 💣 Fallbacks (you were missing this)
const FALLBACK_MESSAGES = [
    "nah i’m ignoring that",
    "you really thought i’d answer that 💀",
    "try again but make sense",
    "that wasn’t worth my time",
    "i’m pretending i didn’t see that",
    "…anyways",
];

async function generateAIResponse(userId, userMessage) {
    if (isBusy) {
        return "one at a time pls 💀";
    }

    isBusy = true;

    try {
        // 🧠 Get memory
        let history = conversationMemory.get(userId) || [];

        // Add new message
        history.push({ role: 'user', content: userMessage });

        // Keep last 10 messages so she remembers context
        if (history.length > 6) {
            history = history.slice(-6);
        }

        const response = await axios.post(
            'http://localhost:11434/api/chat',
            {
                model: "llama3.2:3b",
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    ...history
                ],
                stream: false,
                options: {
                    temperature: 0.9, // Lower temp so she stays focused and on topic
                    top_p: 0.9,
                    num_ctx: 584,    // Double context size to process the larger memory history natively
                    num_predict: 20
                }
            },
            { timeout: 60000 } // Kept this as 60s so it doesn't crash on load!
        );

        let reply = response?.data?.message?.content?.trim();

        if (!reply) throw new Error("Empty response");

        // Clean + smart trim
        reply = reply.split('\n')[0].trim();

        // Natural ending emoji
        if (!reply.endsWith('.') && !reply.endsWith('!') && !reply.endsWith('?') && !reply.endsWith('…')) {
            if (Math.random() < 0.5) reply += " 😭";
        }

        const forbiddenPatterns = [
            "as an ai",
            "i am an ai",
            "ai assistant",
            "my capabilities",
            "i cannot",
            "i'm designed to",
            "here are some tips",
            "let's explore",
        ];

        if (forbiddenPatterns.some(p => reply.toLowerCase().includes(p))) {
            return FALLBACK_MESSAGES[Math.floor(Math.random() * FALLBACK_MESSAGES.length)];
        }

        if (reply.toLowerCase().includes("i got") && reply.toLowerCase().includes("punched")) {
            return "bro you’re making things up now 😭";
        }

        const explainPatterns = [
            "refers to",
            "style is",
            "there are many",
            "it involves",
            "definition",
            "section",
            "involves",
            "sub-categories"
        ];

        if (explainPatterns.some(p => reply.toLowerCase().includes(p))) {
            return FALLBACK_MESSAGES[Math.floor(Math.random() * FALLBACK_MESSAGES.length)];
        }

        // Llama 3.2 natively handles length efficiently, no hard character cutoff needed here anymore!

        // Save bot reply into memory
        history.push({ role: 'assistant', content: reply });

        // Save back
        conversationMemory.set(userId, history);

        return reply;

    } catch (err) {
        console.error(err.message);
        return "nah i lost track 💀";
    } finally {
        isBusy = false;
    }
}

module.exports = { generateAIResponse };