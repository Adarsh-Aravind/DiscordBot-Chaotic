const test = require('node:test');
const assert = require('node:assert');

const liveNickname = require('../utils/liveNickname');

const { withFlag, hasFlag, PREFIX, MAX_NICKNAME } = liveNickname;

test('adds the prefix to a short name', () => {
    assert.strictEqual(withFlag('nova'), `${PREFIX}nova`);
});

test('flagging is idempotent', () => {
    assert.strictEqual(withFlag(withFlag('nova')), `${PREFIX}nova`);
});

test('handles a missing name', () => {
    assert.strictEqual(withFlag(null), PREFIX);
    assert.strictEqual(withFlag(''), PREFIX);
});

test('result never exceeds the limit Discord actually enforces', () => {
    // The cap is validated against `.length`, i.e. UTF-16 code units, and the
    // red circle is a surrogate pair. Budgeting by code point produced 33 units
    // for a long name and Discord rejected the rename outright.
    for (const length of [20, 28, 29, 30, 31, 32, 40, 100]) {
        const out = withFlag('a'.repeat(length));
        assert.ok(
            out.length <= MAX_NICKNAME,
            `a 'a'.repeat(${length}) name gave ${out.length} code units`
        );
    }
});

test('a name of astral characters also stays inside the limit', () => {
    const out = withFlag('🎮'.repeat(40));
    assert.ok(out.length <= MAX_NICKNAME, `got ${out.length} code units`);
});

test('never cuts a surrogate pair in half', () => {
    const out = withFlag('🎮'.repeat(40));
    // A lone surrogate would survive an encode/decode round trip as U+FFFD.
    assert.strictEqual(out, Buffer.from(out, 'utf8').toString('utf8'));
    assert.ok(!/[\uD800-\uDFFF]/.test(out.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')));
});

test('uses as much of the budget as it can', () => {
    const out = withFlag('a'.repeat(40));
    assert.ok(out.length >= MAX_NICKNAME - 1, `only used ${out.length} of ${MAX_NICKNAME}`);
});

test('hasFlag only matches the real prefix', () => {
    assert.ok(hasFlag(`${PREFIX}nova`));
    assert.ok(!hasFlag('nova'));
    assert.ok(!hasFlag('🔵 nova'));
    assert.ok(!hasFlag(null));
    assert.ok(!hasFlag(undefined));
});

test('diagnose explains an empty map rather than staying silent', () => {
    // The shipped default has no mapping, which is exactly the state that made
    // the feature look broken instead of unconfigured.
    const result = liveNickname.diagnose();

    assert.strictEqual(typeof result.enabled, 'boolean');
    assert.strictEqual(typeof result.mapped, 'number');
    if (!result.enabled) {
        assert.ok(result.reason, 'a disabled feature must say why');
        assert.match(result.reason, /\S/);
    }
});

test('renameBlockedReason names the missing permission', () => {
    const member = {
        id: '1',
        guild: {
            ownerId: '999',
            members: { me: { permissions: { has: () => false }, roles: { highest: { name: 'Bot' } } } }
        },
        roles: { highest: { name: 'Member' } }
    };

    assert.match(liveNickname.renameBlockedReason(member), /Manage Nicknames/);
});

test('renameBlockedReason refuses the server owner', () => {
    const member = {
        id: '999',
        guild: {
            ownerId: '999',
            members: {
                me: {
                    permissions: { has: () => true },
                    roles: { highest: { name: 'Bot', comparePositionTo: () => 1 } }
                }
            }
        },
        roles: { highest: { name: 'Member' } }
    };

    assert.match(liveNickname.renameBlockedReason(member), /server owner/);
});

test('renameBlockedReason refuses a role at or above the bot', () => {
    const make = comparison => ({
        id: '1',
        guild: {
            ownerId: '999',
            members: {
                me: {
                    permissions: { has: () => true },
                    roles: { highest: { name: 'Bot', comparePositionTo: () => comparison } }
                }
            }
        },
        roles: { highest: { name: 'Admin' } }
    });

    // Equal counts as blocked: Discord's check is strictly greater-than.
    assert.match(liveNickname.renameBlockedReason(make(0)), /at or above/);
    assert.match(liveNickname.renameBlockedReason(make(-1)), /at or above/);
    assert.strictEqual(liveNickname.renameBlockedReason(make(1)), null);
});
