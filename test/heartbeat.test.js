const test = require('node:test');
const assert = require('node:assert');

const heartbeat = require('../utils/heartbeat');
const config = require('../utils/config');

function makeClient({ ping = 42, guilds = [{ memberCount: 10 }, { memberCount: 5 }] } = {}) {
    return {
        user: {
            username: 'Riri',
            displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/abc.png?size=128'
        },
        guilds: { cache: new Map(guilds.map((g, i) => [String(i), g])) },
        ws: { ping, status: 0 }
    };
}

test('payload reports identity, guilds, summed members and latency', () => {
    const payload = heartbeat.buildPayload(makeClient());

    assert.strictEqual(payload.id, config.status.botId);
    assert.strictEqual(payload.username, 'Riri');
    assert.strictEqual(payload.avatar_url, 'https://cdn.discordapp.com/avatars/1/abc.png?size=128');
    assert.strictEqual(payload.guilds, 2);
    assert.strictEqual(payload.members, 15);
    assert.strictEqual(payload.latency_ms, 42);
    assert.strictEqual(payload.stopping, false);
    assert.ok(!Number.isNaN(Date.parse(payload.started_at)));
});

test('latency is null before the first gateway heartbeat ack', () => {
    const payload = heartbeat.buildPayload(makeClient({ ping: -1 }));
    assert.strictEqual(payload.latency_ms, null);
});

test('guilds with an unknown member count count as zero', () => {
    const payload = heartbeat.buildPayload(makeClient({ guilds: [{ memberCount: 7 }, {}] }));
    assert.strictEqual(payload.members, 7);
});

test('defaults to the riri id and stays disabled without url and token', () => {
    if (!process.env.STATUS_BOT_ID) assert.strictEqual(config.status.botId, 'riri');
    if (!process.env.STATUS_HEARTBEAT_URL || !process.env.STATUS_HEARTBEAT_TOKEN) {
        assert.strictEqual(config.status.enabled, false);
    }
});
