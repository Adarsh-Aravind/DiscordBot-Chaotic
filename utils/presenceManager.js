const { ActivityType } = require('discord.js');

/**
 * Rotating bot presence, one line per hour.
 *
 * Note: Discord ignores application_id/assets/timestamps on bot presence updates,
 * so the game artwork and elapsed timer real users get are not achievable here —
 * only the activity text renders.
 */

const ROTATION_MS = 60 * 60 * 1000; // 1 hour

// Cheesy on purpose. Mixed activity types read better than forcing "Playing"
// onto every joke — "Competing in hardstuck purgatory" lands, "Playing" it doesn't.
const STATUSES = [
    { type: ActivityType.Competing, name: 'hardstuck purgatory' },
    { type: ActivityType.Watching, name: 'the Crusaders climb (slowly)' },
    { type: ActivityType.Playing, name: 'Hardstuck Simulator 2026' },
    { type: ActivityType.Competing, name: 'ranked, losing gracefully' },
    { type: ActivityType.Watching, name: 'one more game (it is 4am)' },
    { type: ActivityType.Listening, name: 'enemy team mic feedback' },
    { type: ActivityType.Playing, name: 'aim trainer, missing anyway' },
    { type: ActivityType.Watching, name: 'Crusaders content in glorious 4K' },
    { type: ActivityType.Competing, name: 'the Hardstuck Invitational' },
    { type: ActivityType.Playing, name: 'support diff: the movie' },
];

/**
 * Which game the bot should be on right now, derived purely from wall-clock time.
 * This makes the rotation stateless: after a power cut or restart the bot lands on
 * the same slot it would have been on had it never gone down.
 */
function currentIndex() {
    return Math.floor(Date.now() / ROTATION_MS) % STATUSES.length;
}

function apply(client) {
    const status = STATUSES[currentIndex()];
    client.user.setActivity(status.name, { type: status.type });
    console.log(`[presence] ${status.name}`);
}

/**
 * @param {import('discord.js').Client} client
 */
function start(client) {
    apply(client);

    // Align the first tick to the next hour boundary so slot changes stay in step
    // with the wall clock, then fall into a plain hourly interval.
    const msUntilNextSlot = ROTATION_MS - (Date.now() % ROTATION_MS);
    setTimeout(() => {
        apply(client);
        setInterval(() => apply(client), ROTATION_MS);
    }, msUntilNextSlot);
}

module.exports = { start, STATUSES };
