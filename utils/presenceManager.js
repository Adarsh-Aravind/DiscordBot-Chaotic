const { ActivityType } = require('discord.js');

/**
 * The bot's presence — one fixed line, no rotation.
 *
 * Note on buttons: a bot cannot have them. Rich Presence buttons are an RPC
 * feature for user accounts running a local app; a bot publishes its presence
 * over the gateway instead, and discord.js only serialises type/name/state/url
 * into that payload — a `buttons` array is dropped before it is ever sent.
 * Same bucket as the artwork and elapsed timer that real users get.
 *
 * ActivityType.Streaming plus a youtube.com/twitch.tv `url` is the one way to
 * make a bot's presence line itself clickable, at the cost of the verb reading
 * "Streaming" rather than "Watching".
 */

const ACTIVITY = {
    type: ActivityType.Watching,
    name: 'Hardstuck Crusaders'
};

let boundClient = null;

/**
 * Set the presence. Also the reconnect handler: Discord drops presence on a
 * fresh IDENTIFY, and with nothing on a timer any more this is the only thing
 * that puts it back after a reconnect.
 */
function apply() {
    if (!boundClient?.user) return;

    boundClient.user.setActivity(ACTIVITY.name, { type: ACTIVITY.type });
    console.log(`[presence] ${ACTIVITY.name}`);
}

/**
 * @param {import('discord.js').Client} client
 */
function start(client) {
    if (boundClient) return;
    boundClient = client;

    apply();

    client.on('shardReady', apply);
    client.on('shardResume', apply);
}

function stop() {
    if (boundClient) {
        boundClient.off('shardReady', apply);
        boundClient.off('shardResume', apply);
        boundClient = null;
    }
}

module.exports = { start, stop, ACTIVITY };
