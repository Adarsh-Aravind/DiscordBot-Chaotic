const { ActivityType } = require('discord.js');
const youtubeWatcher = require('../utils/youtubeWatcher');

module.exports = {
    name: 'ready',
    once: true,
    execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        client.user.setActivity('Hardstuck Crusaders', { type: ActivityType.Watching });

        youtubeWatcher.start(client);
    },
};
