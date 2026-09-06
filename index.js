require('dotenv').config();
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');

const fs = require('fs');
const path = require('path');

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

// Commands that could not be loaded. Kept so .help can say so out loud — a
// command that vanishes from the list with only a startup log to explain it
// looks like a bug in the bot.
client.commandLoadFailures = [];

// Load Commands from subfolders
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs
    .readdirSync(foldersPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            const command = require(filePath);
            if (!('name' in command) || !('execute' in command)) {
                console.warn(`[WARNING] The command at ${filePath} is missing a required "name" or "execute" property.`);
                client.commandLoadFailures.push({ file, reason: 'missing name or execute' });
                continue;
            }
            if (client.commands.has(command.name)) {
                console.warn(`[WARNING] Duplicate command name ".${command.name}" at ${filePath} — overwriting the earlier one.`);
            }
            // Remember the folder so .help can group commands by category.
            command.category = folder;
            client.commands.set(command.name, command);
        } catch (error) {
            console.error(`[LOAD ERROR] Could not load ${filePath}:`, error);
            client.commandLoadFailures.push({ file, reason: error.message.split('\n')[0] });
        }
    }
}

console.log(`Loaded ${client.commands.size} commands from ${commandFolders.length} categories.`);
if (client.commandLoadFailures.length > 0) {
    console.warn(`[WARNING] ${client.commandLoadFailures.length} command(s) failed to load and will not appear in .help.`);
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

client.login(process.env.DISCORD_TOKEN);

// Global Error Handlers (prevents bot from crashing on unhandled errors)
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});
