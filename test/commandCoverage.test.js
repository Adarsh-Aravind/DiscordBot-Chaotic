// `.help` is the only list of what this bot can do, so a command that loads
// but never appears there is invisible — which is exactly what happened to
// `.presence`: it was added as a command without anything checking that the
// list had grown. These tests render the real embed from the real loader, so
// the next command that goes missing fails here instead of in Discord.

process.env.GROQ_API_KEY = 'test-key';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadCommands } = require('../utils/commandLoader');
const help = require('../commands/general/help');
const config = require('../utils/config');

// displayAvatarURL is validated as a URL by the embed builder, so it has to
// look like one even in a stub.
const AVATAR = 'https://cdn.discordapp.com/avatars/1/a.png';

function stubMessage() {
    return {
        author: { tag: 'tester#0001', id: '1', displayAvatarURL: () => AVATAR },
        replies: [],
        async reply(payload) {
            this.replies.push(payload);
            return payload;
        }
    };
}

/** Render `.help` the way the bot would, and hand back the embed data. */
async function renderHelp({ commands, failures = [] } = {}) {
    const loaded = commands ?? loadCommands().commands;
    const message = stubMessage();

    await help.execute(message, [], {
        commands: loaded,
        commandLoadFailures: failures,
        user: { id: '999' }
    });

    const embed = message.replies[0].embeds[0].data;
    const text = [
        embed.description ?? '',
        ...embed.fields.map(f => `${f.name}\n${f.value}`)
    ].join('\n');

    return { embed, text };
}

test('every command that loads is listed in .help', async () => {
    const { commands, failures } = loadCommands();

    assert.deepStrictEqual(failures, [], 'no command should fail to load');
    assert.ok(commands.size > 0, 'the loader found no commands at all');

    const { text } = await renderHelp({ commands });

    const missing = [...commands.keys()].filter(
        name => !text.includes(`\`${config.prefix}${name}\``)
    );

    assert.deepStrictEqual(missing, [], `missing from .help: ${missing.join(', ')}`);
});

test('.presence in particular is listed', async () => {
    // The regression that started this. Kept as its own case so the failure
    // names the command rather than a list.
    const { text } = await renderHelp();
    assert.match(text, /`\.presence`/);
});

test('the command count in the header matches what was loaded', async () => {
    const { commands } = loadCommands();
    const { text } = await renderHelp({ commands });

    assert.ok(
        text.includes(`${commands.size} commands`),
        `header did not claim ${commands.size} commands`
    );
});

test('nothing is dropped for space at the current command count', async () => {
    const { embed } = await renderHelp();

    assert.ok(
        !embed.fields.some(f => f.name === '…'),
        'help overflowed and dropped a section — the embed is at its cap'
    );
    assert.ok(embed.fields.length <= 25, 'more fields than Discord allows');

    const total =
        (embed.description?.length ?? 0) +
        (embed.footer?.text?.length ?? 0) +
        embed.fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
    assert.ok(total <= 6000, `embed was ${total} characters`);
});

test('a command with no description is marked, not rendered as undefined', async () => {
    const commands = loadCommands().commands;
    commands.set('nodesc', { name: 'nodesc', category: 'fun', execute() {} });

    const { text } = await renderHelp({ commands });

    assert.ok(text.includes('`.nodesc`'), 'the command still has to be listed');
    assert.ok(!text.includes('undefined'), 'help rendered the word "undefined"');
});

test('every listed command carries a lock marker iff it is restricted', async () => {
    const { commands } = loadCommands();
    const { text } = await renderHelp({ commands });

    for (const [name, command] of commands) {
        const line = text
            .split('\n')
            .find(l => l.startsWith(`\`${config.prefix}${name}\``));

        assert.ok(line, `no line for .${name}`);
        assert.strictEqual(
            line.includes('🔒'),
            Boolean(command.restricted),
            `.${name} lock marker disagrees with its restricted flag`
        );
    }
});

test('DM-only commands are listed even though they never load', async () => {
    // `.reply` is handled in messageCreate, not commands/, so it is in neither
    // client.commands nor the loader — help has to carry it by hand.
    const { text } = await renderHelp();
    assert.match(text, /`\.reply <user_id> <message>`/);
});

test('a command that fails to load is reported rather than silently absent', async () => {
    const { text } = await renderHelp({
        failures: [{ file: 'fun/broken.js', reason: 'Unexpected token' }]
    });

    assert.match(text, /Failed to load/);
    assert.match(text, /broken\.js/);
    assert.match(text, /Unexpected token/);
});

// --- the loader itself ------------------------------------------------------

/** Build a throwaway commands/ tree and load it. */
function loadFixture(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdloader-'));

    for (const [relative, source] of Object.entries(files)) {
        const full = path.join(root, relative);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, source);
    }

    try {
        return loadCommands(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test('loader tags each command with the folder it came from', () => {
    const { commands } = loadFixture({
        'mod/thing.js': "module.exports = { name: 'thing', execute() {} };"
    });

    assert.strictEqual(commands.get('thing').category, 'mod');
});

test('loader reports a command missing name or execute', () => {
    const { commands, failures } = loadFixture({
        'fun/nameless.js': 'module.exports = { execute() {} };'
    });

    assert.strictEqual(commands.size, 0);
    assert.strictEqual(failures.length, 1);
    assert.match(failures[0].reason, /missing name or execute/);
});

test('loader reports a file that throws on require', () => {
    const { commands, failures } = loadFixture({
        'fun/broken.js': 'throw new Error("boom");'
    });

    assert.strictEqual(commands.size, 0);
    assert.strictEqual(failures.length, 1);
    assert.match(failures[0].reason, /boom/);
});

test('loader reports a duplicate name instead of overwriting in silence', () => {
    // Two files claiming `.dupe`: the second used to replace the first with
    // only a console warning, so one of them just vanished from .help.
    const { commands, failures } = loadFixture({
        'fun/first.js': "module.exports = { name: 'dupe', description: 'first', execute() {} };",
        'fun/second.js': "module.exports = { name: 'dupe', description: 'second', execute() {} };"
    });

    assert.strictEqual(commands.size, 1);
    assert.strictEqual(commands.get('dupe').description, 'first', 'the first one should win');
    assert.strictEqual(failures.length, 1);
    assert.match(failures[0].reason, /duplicate of \.dupe/);
    assert.match(failures[0].reason, /fun\/first\.js/);
});

test('loader ignores non-js files and loose files outside a category', () => {
    const { commands, failures } = loadFixture({
        'fun/real.js': "module.exports = { name: 'real', execute() {} };",
        'fun/notes.md': '# not a command',
        'stray.js': "module.exports = { name: 'stray', execute() {} };"
    });

    assert.deepStrictEqual([...commands.keys()], ['real']);
    assert.deepStrictEqual(failures, []);
});
