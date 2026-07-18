const { clearMemory } = require('../../utils/ai');

module.exports = {
    name: 'forget',
    description: 'Makes riri forget your conversation in this channel.',
    async execute(message) {
        const memoryKey = `${message.channel.id}:${message.author.id}`;
        const had = clearMemory(memoryKey);

        await message.reply(
            had ? 'who are you again? 🙄' : "i wasn't even thinking about you 💀"
        );
    },
};
