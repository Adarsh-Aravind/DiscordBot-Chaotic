const { ActivityType } = require('discord.js');

/**
 * Rotating "Playing <game>" presence.
 *
 * Note: Discord ignores application_id/assets/timestamps on bot presence updates,
 * so the game artwork and elapsed timer real users get are not achievable here —
 * only the activity text renders.
 */

const ROTATION_MS = 60 * 60 * 1000; // 1 hour

const GAMES = [
    'VALORANT',
    'Forza Horizon 6',
    'Phasmophobia',
    'Meccha Chameleon',
    'Minecraft',
    'GTA V',
];

/**
 * Which game the bot should be on right now, derived purely from wall-clock time.
 * This makes the rotation stateless: after a power cut or restart the bot lands on
 * the same slot it would have been on had it never gone down.
 */
function currentIndex() {
    return Math.floor(Date.now() / ROTATION_MS) % GAMES.length;
}

function apply(client) {
    const game = GAMES[currentIndex()];
    client.user.setActivity(game, { type: ActivityType.Playing });
    console.log(`[presence] Playing ${game}`);
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

module.exports = { start, GAMES };
