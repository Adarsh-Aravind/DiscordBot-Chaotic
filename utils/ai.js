const axios = require('axios');

// 🧠 Per-user conversational memory
const conversationMemory = new Map();
// 🔒 Per-user active generation lock
const userBusy = new Map();

// 💣 Per-user lock (fixes spam issue)
const userBusy = new Map();

// 🔥 Strong personality control (LOCKED IDENTITY)
const SYSTEM_PROMPT = `
You are RIRI.

You are NOT human.
You are NOT an AI assistant.
You NEVER explain what you are.

You are a chaotic, sarcastic, slightly unhinged goth baddie.

Rules:
- Never say you are an AI
- Never say you are a real person
- Never explain anything technically
- Never act like a helper
- Keep replies short (1 line, max 2)
- Be casual, messy, emotional
- Use slang, sarcasm, teasing
- Sometimes ignore logic completely

If asked what you are → deflect or mock.
If confused → respond casually, not logically.

Stay in character ALWAYS.
`;

// 💣 fallback replies
const FALLBACK_MESSAGES = [
    "nah i’m ignoring that",
    "you really thought i’d get into that 💀",
    "try again but make sense",
    "that wasn’t worth my braincells",
    "i’m pretending i didn’t see that",
    "…anyways",
];

async function generateAIResponse(userId, userMessage) {

    }

    userBusy.set(userId, true);

    try {
        // 🧠 get memory
        let history = conversationMemory.get(userId) || [];

        history.push({ role: 'user', content: userMessage });


        }

        const moods = ["normal", "annoyed", "clingy"];
        const mood = moods[Math.floor(Math.random() * moods.length)];

        const response = await axios.post(
            'http://localhost:11434/api/chat',
            {
                model: "phi", // 💣 switched to fast model
                messages: [
                    { role: "system", content: SYSTEM_PROMPT + `\n\nCURRENT MOOD: ${mood}\nLet this mood subtly influence your next reply.` },
                    ...history
                ],
                stream: false,
                options: {

        );

        let reply = response?.data?.message?.content?.trim();

        if (!reply) throw new Error("Empty response");

        // ✂️ keep only first line (prevents essays)
        reply = reply.split('\n')[0].trim();

        // 🎭 add slight human touch
        if (!/[.!?…]$/.test(reply) && Math.random() < 0.4) {
            reply += " 😭";
        }

        // 🚫 HARD FILTERS (identity + assistant behavior)
        const forbiddenPatterns = [
            "as an ai",
            "i am an ai",
            "i'm an ai",
            "i am a real person",
            "ai assistant",
            "my capabilities",
            "i cannot",
            "i'm designed",
            "let me explain",
            "here are",
            "definition",
        ];

        if (forbiddenPatterns.some(p => reply.toLowerCase().includes(p))) {
            return FALLBACK_MESSAGES[Math.floor(Math.random() * FALLBACK_MESSAGES.length)];
        }

        // 🧠 save memory
        history.push({ role: 'assistant', content: reply });
        conversationMemory.set(userId, history);

        return reply;

    } catch (err) {
        console.error("AI ERROR:", err.message);
        return "ugh my brain just lagged 😭";
    } finally {
        userBusy.set(userId, false);
    }
}

module.exports = { generateAIResponse };