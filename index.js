require('dotenv').config();
const { Client, Collection, DiscordjsErrorCodes, GatewayIntentBits, Partials } = require('discord.js');
const { setTimeout: sleep } = require('node:timers/promises');

const fs = require('fs');
const path = require('path');

const heartbeat = require('./utils/heartbeat');
const presenceManager = require('./utils/presenceManager');
const stateManager = require('./utils/stateManager');
const { loadCommands } = require('./utils/commandLoader');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// Collections
client.commands = new Collection();

// Commands live in commands/<category>/*.js. The walk itself is in
// utils/commandLoader so `.help` and the tests read the same list the bot does.
const { commands, failures, categories } = loadCommands();
for (const [name, command] of commands) {
    client.commands.set(name, command);
}

// Kept on the client so .help can say so out loud — a command that vanishes
// from the list with only a startup log to explain it looks like a bug.
client.commandLoadFailures = failures;

console.log(`Loaded ${client.commands.size} commands from ${categories.length} categories.`);
for (const failure of failures) {
    console.error(`[LOAD ERROR] ${failure.file}: ${failure.reason}`);
}
if (failures.length > 0) {
    console.warn(`[WARNING] ${failures.length} command(s) failed to load and are listed as failures in .help.`);
}

// Load Events
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

// Log in to Discord
if (!process.env.DISCORD_TOKEN) {
    console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.');
    process.exit(1);
}

// A boot while the network is still down — a server reboot, pm2 resurrecting
// before DNS is up — makes login reject with a connect timeout. discord.js
// destroys the client on a failed login, so an unhandled rejection there leaves
// the process alive but permanently disconnected: pm2 sees a healthy bot that is
// never coming back. Retry, then exit so the process manager can restart us.
const LOGIN_ATTEMPTS = 5;
const LOGIN_RETRY_DELAY_MS = 15_000;

async function login() {
    for (let attempt = 1; attempt <= LOGIN_ATTEMPTS; attempt++) {
        try {
            await client.login(process.env.DISCORD_TOKEN);
            return;
        } catch (error) {
            // A rejected token never fixes itself — no point burning retries.
            if (error.code === DiscordjsErrorCodes.TokenInvalid || error.status === 401) {
                console.error('Discord rejected the token. Check DISCORD_TOKEN in .env.');
                process.exit(1);
            }

            // fetch() failures read as a bare "fetch failed" without the cause.
            const reason = error.cause?.message ? `${error.message} (${error.cause.message})` : error.message;
            console.error(`Login attempt ${attempt}/${LOGIN_ATTEMPTS} failed: ${reason}`);

            if (attempt < LOGIN_ATTEMPTS) {
                await sleep(LOGIN_RETRY_DELAY_MS);
            }
        }
    }

    console.error(`Could not reach Discord after ${LOGIN_ATTEMPTS} attempts. Exiting so the process manager restarts us.`);
    process.exit(1);
}

login();

// Clean shutdown.
//
// Without this, a `pm2 restart` and a crash looked identical from the outside:
// the heartbeat simply stopped arriving, and the `stopping` flag it has always
// sent was hardcoded false. Signing off makes the Live Ops panel able to tell a
// deliberate restart from the bot falling over.
//
// Dragged users are also restored here — otherwise a restart mid-`.drag` leaves
// them wherever they were last thrown, with the interval gone and nothing left
// to put them back.
const SHUTDOWN_GRACE_MS = 5000;
let shuttingDown = false;

async function shutdown(signal) {
    // A second Ctrl-C should kill it now, not queue another teardown.
    if (shuttingDown) {
        console.warn(`${signal} again — exiting now.`);
        process.exit(1);
    }
    shuttingDown = true;
    console.log(`${signal} received, shutting down.`);

    // Never hang: if teardown wedges, the process manager should still get its
    // exit rather than waiting on us forever.
    const guard = setTimeout(() => {
        console.warn('Shutdown took too long — exiting anyway.');
        process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    guard.unref();

    try {
        await stateManager.restoreAll(client);
        await heartbeat.farewell(client);
        presenceManager.stop();
        await client.destroy();
    } catch (error) {
        console.error('Error during shutdown:', error);
    }

    clearTimeout(guard);
    process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown(signal));
}

// Global Error Handlers (prevents bot from crashing on unhandled errors)
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});
