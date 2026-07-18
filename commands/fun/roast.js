const roastManager = require('../../utils/roastManager');

// First words that must keep their capital letter when the roast is appended
// after a mention, e.g. "@user, I'd agree with you, but..."
const KEEPS_CAPITAL = new Set(["I", "I'd", "I'm", "I've", "I'll"]);

function formatForTarget(roast) {
    const firstWord = roast.split(' ')[0];
    if (KEEPS_CAPITAL.has(firstWord)) return roast;
    return roast.charAt(0).toLowerCase() + roast.slice(1);
}

const selfRoastReplies = [
    "Roasting yourself? Bold. Saves me the trouble, though:",
    "Self-aware of you. Here's the confirmation you were after:",
    "You already know, but here it is in writing:"
];

const botRoastReplies = [
    "I'm a bot. I have no feelings and better uptime than your last relationship.",
    "Nice try. I was written by someone who peaked in this exact moment, and even that beats you.",
    "You can't roast me. I don't sleep, I don't lose, and I don't miss."
];

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

module.exports = {
    name: 'roast',
    description: 'Delivers a brutal roast. Optionally mention a user.',
    async execute(message, args, client) {
        const target = message.mentions.users.first();
        const roast = roastManager.getRandomRoast(message.guild?.id);

        if (!target) {
            return message.reply(roast);
        }

        if (target.id === client.user.id) {
            return message.reply(pick(botRoastReplies));
        }

        if (target.id === message.author.id) {
            return message.reply(`${pick(selfRoastReplies)} ${formatForTarget(roast)}`);
        }

        if (target.bot) {
            return message.reply(`${target.toString()} is a bot. Save it for someone who can feel it.`);
        }

        return message.reply(`${target.toString()}, ${formatForTarget(roast)}`);
    },
};
