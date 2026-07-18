const youtubeWatcher = require('../utils/youtubeWatcher');
const presenceManager = require('../utils/presenceManager');

module.exports = {
    name: 'ready',
    once: true,
    execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        presenceManager.start(client);

        youtubeWatcher.start(client);
    },
};
