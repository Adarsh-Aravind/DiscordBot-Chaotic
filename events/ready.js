const youtubeWatcher = require('../utils/youtubeWatcher');
const twitchWatcher = require('../utils/twitchWatcher');
const presenceManager = require('../utils/presenceManager');
const afkWatcher = require('../utils/afkWatcher');
const deafenTracker = require('../utils/deafenTracker');
const clingyWatcher = require('../utils/clingyWatcher');

module.exports = {
    name: 'ready',
    once: true,
    execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        presenceManager.start(client);

        youtubeWatcher.start(client);
        twitchWatcher.start(client);

        // Voice states are cached by now, so this picks up someone who was
        // already sitting there deafened while the bot was down.
        afkWatcher.syncAll(client);
        deafenTracker.syncAll(client);
        deafenTracker.start(client);
        clingyWatcher.start(client);
    },
};
