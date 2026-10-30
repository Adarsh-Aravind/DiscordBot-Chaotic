const fs = require('fs');
const path = require('path');

// Loading commands used to live inline in index.js, which meant nothing could
// check it without writing a second copy of the same walk — and a test that
// reimplements the loader stops telling you anything the moment the two drift.
// `.help` is built straight off the result, so this is the one place that
// decides which commands exist and therefore which ones get listed.

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

/**
 * Walk commands/<category>/*.js and load every command in them.
 *
 * Anything that can't be loaded comes back in `failures` rather than being
 * dropped on the floor: a command that vanishes from `.help` with only a
 * startup log to explain it looks like a bug in the bot.
 *
 * @param {string} [dir] Root to walk. Defaults to the repo's commands/.
 * @returns {{commands: Map<string, object>, failures: {file: string, reason: string}[], categories: string[]}}
 */
function loadCommands(dir = COMMANDS_DIR) {
    const commands = new Map();
    const failures = [];

    const categories = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);

    for (const category of categories) {
        const categoryPath = path.join(dir, category);
        const files = fs.readdirSync(categoryPath).filter(file => file.endsWith('.js'));

        for (const file of files) {
            const filePath = path.join(categoryPath, file);

            try {
                const command = require(filePath);

                if (!('name' in command) || !('execute' in command)) {
                    failures.push({ file, reason: 'missing name or execute' });
                    continue;
                }

                // A duplicate name silently replaced the earlier command and
                // left a warning in a log nobody reads, so one of the two just
                // went missing from `.help` with no explanation in Discord.
                // Report it where the gap actually shows.
                const clash = commands.get(command.name);
                if (clash) {
                    failures.push({
                        file,
                        reason: `duplicate of .${command.name} already loaded from ${clash.sourceFile}`
                    });
                    continue;
                }

                // Remembered so `.help` can group by category, and so a clash
                // can name the file it lost to.
                command.category = category;
                command.sourceFile = `${category}/${file}`;
                commands.set(command.name, command);
            } catch (error) {
                failures.push({ file, reason: error.message.split('\n')[0] });
            }
        }
    }

    return { commands, failures, categories };
}

module.exports = { loadCommands, COMMANDS_DIR };
