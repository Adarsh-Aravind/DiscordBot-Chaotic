const config = require('../utils/config');
const youtubeWatcher = require('../utils/youtubeWatcher');
const twitchWatcher = require('../utils/twitchWatcher');
const presenceManager = require('../utils/presenceManager');
const liveNickname = require('../utils/liveNickname');
const heartbeat = require('../utils/heartbeat');

module.exports = {
    name: 'clientReady',
    once: true,
    execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        presenceManager.start(client);

        youtubeWatcher.start(client);
        twitchWatcher.start(client);

        // Says out loud whether the nickname flag is actually wired up, since
        // an empty map used to be indistinguishable from a broken feature.
        liveNickname.report();

        // The watcher's own check syncs nicknames, so a sweep is only needed
        // when it is never going to run and could leave a red dot stranded.
        if (!config.twitch.enabled) {
            liveNickname.sweep(client).catch(err =>
                console.error('[LiveNick] Startup sweep failed:', err.message));
        }

        heartbeat.start(client);
    },
};
