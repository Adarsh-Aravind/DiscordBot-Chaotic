// `.presence` parsing. The manager is stubbed out so these run without
// touching data/presence.json or the gateway — what's under test is how the
// command reads its arguments, not what the manager does with them.

process.env.GROQ_API_KEY = 'test-key';

const test = require('node:test');
const assert = require('node:assert');

const managerPath = require.resolve('../utils/presenceManager');
const real = require(managerPath);

// What set() was last handed, so a test can assert on it.
let lastSet = null;
let stored = { ...real.DEFAULT_PRESENCE };

const stub = {
    ...real,
    get: () => ({ ...stored }),
    describe: () => `${stored.type} ${stored.name} [${stored.status}]`,
    set(input) {
        lastSet = input;
        const next = real.normalise(input);
        if (!next) return { ok: false, reason: 'nope' };
        stored = next;
        return { ok: true, presence: { ...next } };
    },
    reset() {
        stored = { ...real.DEFAULT_PRESENCE };
        return { ...stored };
    }
};

require.cache[managerPath] = {
    id: managerPath,
    filename: managerPath,
    loaded: true,
    exports: stub
};

const presence = require('../commands/general/presence');

function stubMessage() {
    return {
        replies: [],
        async reply(payload) {
            this.replies.push(payload);
            return payload;
        }
    };
}

/** Run the command and hand back the plain-text reply. */
async function run(...args) {
    lastSet = null;
    const message = stubMessage();
    await presence.execute(message, args);
    const reply = message.replies[0];
    return typeof reply === 'string' ? reply : '';
}

test.beforeEach(() => {
    stored = { type: 'watching', name: 'Hardstuck Crusaders', url: null, status: 'online' };
});

test('a bare status name sets the status', async () => {
    for (const status of real.STATUSES) {
        stored.status = status === 'online' ? 'dnd' : 'online';
        const reply = await run(status);
        assert.strictEqual(stored.status, status, `.presence ${status} should set ${status}`);
        assert.match(reply, /^✅/);
    }
});

test('a bare status name is case-insensitive', async () => {
    await run('DND');
    assert.strictEqual(stored.status, 'dnd');
});

test('changing status keeps the activity as it is', async () => {
    stored = { type: 'playing', name: 'with fire', url: null, status: 'online' };
    await run('idle');
    assert.strictEqual(stored.type, 'playing');
    assert.strictEqual(stored.name, 'with fire');
    assert.strictEqual(stored.status, 'idle');
});

test('the explicit status subcommand still works', async () => {
    await run('status', 'invisible');
    assert.strictEqual(stored.status, 'invisible');
});

test('an unusable status is refused without changing anything', async () => {
    const reply = await run('status', 'asleep');
    assert.strictEqual(stored.status, 'online');
    assert.match(reply, /^⚠️/);
    for (const status of real.STATUSES) assert.ok(reply.includes(status));
});

test('status with nothing after it is refused', async () => {
    const reply = await run('status');
    assert.strictEqual(stored.status, 'online');
    assert.match(reply, /^⚠️/);
});

test('a verb is still a verb, not a status', async () => {
    await run('listening', 'to', 'nothing');
    assert.strictEqual(stored.type, 'listening');
    assert.strictEqual(stored.name, 'to nothing');
    assert.strictEqual(stored.status, 'online');
});

test('an unknown word points at both the verbs and the statuses', async () => {
    const reply = await run('vibing');
    assert.match(reply, /^⚠️/);
    for (const verb of Object.keys(real.ACTIVITY_TYPES)) assert.ok(reply.includes(verb));
    for (const status of real.STATUSES) assert.ok(reply.includes(status));
});

test('no status name collides with a verb', () => {
    for (const status of real.STATUSES) {
        assert.ok(!(status in real.ACTIVITY_TYPES), `${status} must not also be a verb`);
    }
});
