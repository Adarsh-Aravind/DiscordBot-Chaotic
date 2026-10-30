const youtubeWatcher = require('../utils/youtubeWatcher');
const twitchWatcher = require('../utils/twitchWatcher');
const presenceManager = require('../utils/presenceManager');
const heartbeat = require('../utils/heartbeat');

module.exports = {
    name: 'clientReady',
    once: true,
    execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        presenceManager.start(client);

        youtubeWatcher.start(client);
        twitchWatcher.start(client);

        heartbeat.start(client);
    },
};
