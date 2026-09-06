const test = require('node:test');
const assert = require('node:assert');

const afkWatcher = require('../utils/afkWatcher');
const config = require('../utils/config');
const stateManager = require('../utils/stateManager');

const WATCHED = config.afk.userId;
const AFK_CHANNEL = config.afk.channelId;
const GRACE = config.afk.deafenGraceMs;

function makeGuild() {
    return {
        moves: [],
        channels: { cache: new Map([[AFK_CHANNEL, { id: AFK_CHANNEL }]]) },
        voiceStates: { cache: new Map() },
        members: { fetch: async () => null }
    };
}

function setVoice(guild, { deaf = false, channelId = 'general-vc', userId = WATCHED } = {}) {
    const state = {
        id: userId,
        deaf,
        channelId,
        guild,
        member: {
            user: { tag: 'target#0001' },
            voice: {
                setChannel: async id => {
                    guild.moves.push(id);
                    state.channelId = id; // mirror what Discord would report back
                }
            }
        }
    };
    guild.voiceStates.cache.set(userId, state);
    return state;
}

/** Let the timer callback's async body settle. setImmediate is left unmocked. */
function flush() {
    return new Promise(resolve => setImmediate(resolve));
}

function setup(t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => {
        afkWatcher.stop();
        stateManager.remove(WATCHED);
    });
    return makeGuild();
}

test('parks the user once the grace period elapses while deafened', async t => {
    const guild = setup(t);
    afkWatcher.handle(setVoice(guild, { deaf: true }));

    t.mock.timers.tick(GRACE);
    await flush();

    assert.deepStrictEqual(guild.moves, [AFK_CHANNEL]);
});

test('does not park before the grace period is up', async t => {
    const guild = setup(t);
    afkWatcher.handle(setVoice(guild, { deaf: true }));

    t.mock.timers.tick(GRACE - 1);
    await flush();

    assert.deepStrictEqual(guild.moves, []);
});

test('undeafening cancels the countdown', async t => {
    const guild = setup(t);
    const state = setVoice(guild, { deaf: true });
    afkWatcher.handle(state);

    t.mock.timers.tick(GRACE / 2);
    state.deaf = false;
    afkWatcher.handle(state);

    t.mock.timers.tick(GRACE);
    await flush();

    assert.deepStrictEqual(guild.moves, []);
});

test('unrelated voice updates do not restart the countdown', async t => {
    const guild = setup(t);
    const state = setVoice(guild, { deaf: true });
    afkWatcher.handle(state);

    // Someone toggling their mic repeatedly would otherwise keep the clock at zero.
    for (let elapsed = 0; elapsed < GRACE - 1000; elapsed += 1000) {
        t.mock.timers.tick(1000);
        afkWatcher.handle(state);
    }

    t.mock.timers.tick(1000);
    await flush();

    assert.deepStrictEqual(guild.moves, [AFK_CHANNEL]);
});

test('leaving voice cancels the countdown', async t => {
    const guild = setup(t);
    const state = setVoice(guild, { deaf: true });
    afkWatcher.handle(state);

    state.channelId = null;
    afkWatcher.handle(state);

    t.mock.timers.tick(GRACE);
    await flush();

    assert.deepStrictEqual(guild.moves, []);
});

test('someone already sitting in the AFK channel is left alone', async t => {
    const guild = setup(t);
    afkWatcher.handle(setVoice(guild, { deaf: true, channelId: AFK_CHANNEL }));

    t.mock.timers.tick(GRACE);
    await flush();

    assert.deepStrictEqual(guild.moves, []);
});

test('other users are ignored', async t => {
    const guild = setup(t);
    afkWatcher.handle(setVoice(guild, { deaf: true, userId: '999000999000999000' }));

    t.mock.timers.tick(GRACE);
    await flush();

    assert.deepStrictEqual(guild.moves, []);
});

test('a guild without the AFK channel is ignored', async t => {
    const guild = setup(t);
    guild.channels.cache.delete(AFK_CHANNEL);
    afkWatcher.handle(setVoice(guild, { deaf: true }));

    t.mock.timers.tick(GRACE);
    await flush();

    assert.deepStrictEqual(guild.moves, []);
});

test('stays out of the way while .drag owns the user', async t => {
    const guild = setup(t);
    stateManager.set(WATCHED, { originalChannelId: 'x', intervalId: null, guildId: 'g' });

    afkWatcher.handle(setVoice(guild, { deaf: true }));
    t.mock.timers.tick(GRACE);
    await flush();

    assert.deepStrictEqual(guild.moves, []);
});

test('rechecks at fire time, so a missed update cannot cause a stale move', async t => {
    const guild = setup(t);
    const state = setVoice(guild, { deaf: true });
    afkWatcher.handle(state);

    // Undeafened without a voiceStateUpdate reaching us.
    t.mock.timers.tick(GRACE / 2);
    state.deaf = false;
    t.mock.timers.tick(GRACE);
    await flush();

    assert.deepStrictEqual(guild.moves, []);
});

test('syncAll picks up someone already deafened at boot', async t => {
    const guild = setup(t);
    setVoice(guild, { deaf: true });

    afkWatcher.syncAll({ guilds: { cache: new Map([['g1', guild]]) } });

    t.mock.timers.tick(GRACE);
    await flush();

    assert.deepStrictEqual(guild.moves, [AFK_CHANNEL]);
});
