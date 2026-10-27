const { clearMemory } = require('../../utils/ai');

module.exports = {
    name: 'forget',
    description: 'Makes riri forget the conversation in this channel.',
    async execute(message) {
        // One thread per channel now, so this clears the room's conversation
        // rather than just the caller's side of it.
        const had = clearMemory(message.channel.id);

        await message.reply(
            had ? 'who are you again? 🙄' : "i wasn't even thinking about you 💀"
        );
    },
};
