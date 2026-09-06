const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// Must be set before config is loaded, or the tests would write to real stats.
process.env.DEAFEN_BOARD_STATE_FILE = nodePath.join(os.tmpdir(), `deafen-test-${process.pid}.json`);

const test = require('node:test');
const assert = require('node:assert');
const deafenTracker = require('../utils/deafenTracker');

const MIN_SESSION_MS = 30_000;

function clean() {
    deafenTracker.reset();
    try {
        fs.unlinkSync(deafenTracker.STATE_FILE);
    } catch {
        // never written yet
    }
}

function voiceState({ id = 'u1', deaf = false, channelId = 'vc1', bot = false, name = 'One' } = {}) {
    return { id, deaf, channelId, member: { displayName: name, user: { bot, username: name } } };
}

function setup(t) {
    clean();
    t.mock.timers.enable({ apis: ['Date'] });
    t.after(clean);
}

test('banks a stint once it ends', t => {
    setup(t);

    deafenTracker.handle(voiceState({ deaf: true }));
    t.mock.timers.tick(120_000);
    deafenTracker.handle(voiceState({ deaf: false }));

    const rows = deafenTracker.leaderboard('periodMs');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].ms, 120_000);
});

test('ignores stints shorter than the minimum', t => {
    setup(t);

    deafenTracker.handle(voiceState({ deaf: true }));
    t.mock.timers.tick(MIN_SESSION_MS - 1);
    deafenTracker.handle(voiceState({ deaf: false }));

    assert.deepStrictEqual(deafenTracker.leaderboard('periodMs'), []);
});

test('counts a stint that is still running', t => {
    setup(t);

    deafenTracker.handle(voiceState({ deaf: true }));
    t.mock.timers.tick(60_000);

    // No closing event — the board should still show it.
    const rows = deafenTracker.leaderboard('periodMs');
    assert.strictEqual(rows[0].ms, 60_000);
});

test('repeated deafened updates do not restart the clock', t => {
    setup(t);

    deafenTracker.handle(voiceState({ deaf: true }));
    t.mock.timers.tick(30_000);
    deafenTracker.handle(voiceState({ deaf: true }));  // mic mute, channel move, whatever
    t.mock.timers.tick(30_000);
    deafenTracker.handle(voiceState({ deaf: false }));

    assert.strictEqual(deafenTracker.leaderboard('periodMs')[0].ms, 60_000);
});

test('leaving voice ends the stint', t => {
    setup(t);

    deafenTracker.handle(voiceState({ deaf: true }));
    t.mock.timers.tick(90_000);
    deafenTracker.handle(voiceState({ deaf: true, channelId: null }));

    t.mock.timers.tick(500_000); // gone; this time must not count
    assert.strictEqual(deafenTracker.leaderboard('periodMs')[0].ms, 90_000);
});

test('ranks the worst offender first', t => {
    setup(t);

    deafenTracker.handle(voiceState({ id: 'quiet', deaf: true, name: 'Quiet' }));
    deafenTracker.handle(voiceState({ id: 'loud', deaf: true, name: 'Loud' }));
    t.mock.timers.tick(60_000);
    deafenTracker.handle(voiceState({ id: 'quiet', deaf: false, name: 'Quiet' }));
    t.mock.timers.tick(240_000);
    deafenTracker.handle(voiceState({ id: 'loud', deaf: false, name: 'Loud' }));

    const rows = deafenTracker.leaderboard('periodMs');
    assert.deepStrictEqual(rows.map(r => r.userId), ['loud', 'quiet']);
    assert.strictEqual(rows[0].ms, 300_000);
});

test('does not track bots', t => {
    setup(t);

    deafenTracker.handle(voiceState({ id: 'bot1', deaf: true, bot: true }));
    t.mock.timers.tick(120_000);
    deafenTracker.handle(voiceState({ id: 'bot1', deaf: false, bot: true }));

    assert.deepStrictEqual(deafenTracker.leaderboard('periodMs'), []);
});

test('all-time and period both accumulate before a ranking is posted', t => {
    setup(t);

    deafenTracker.handle(voiceState({ deaf: true }));
    t.mock.timers.tick(120_000);
    deafenTracker.handle(voiceState({ deaf: false }));

    assert.strictEqual(deafenTracker.leaderboard('ms')[0].ms, 120_000);
    assert.strictEqual(deafenTracker.leaderboard('periodMs')[0].ms, 120_000);
});

test('formatDuration reads as hours and minutes', () => {
    assert.strictEqual(deafenTracker.formatDuration(0), '0m');
    assert.strictEqual(deafenTracker.formatDuration(90_000), '1m');
    assert.strictEqual(deafenTracker.formatDuration(3_600_000), '1h 0m');
    assert.strictEqual(deafenTracker.formatDuration(11_580_000), '3h 13m');
});
