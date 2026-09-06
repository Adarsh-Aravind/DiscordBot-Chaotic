// Set before config loads: interjections need a key present to be enabled.
process.env.GROQ_API_KEY = 'test-key';
process.env.AI_INTERJECT_CHANCE = '0.5';
process.env.AI_INTERJECT_COOLDOWN_MS = '300000';

const test = require('node:test');
const assert = require('node:assert');
const { shouldInterject, resetInterjections } = require('../utils/ai');

const COOLDOWN_MS = 300_000;

function setup(t) {
    resetInterjections();
    t.mock.timers.enable({ apis: ['Date'] });
    t.after(resetInterjections);
}

test('a winning roll interjects', t => {
    setup(t);
    assert.strictEqual(shouldInterject('c1', () => 0.4), true);
});

test('a losing roll stays quiet', t => {
    setup(t);
    assert.strictEqual(shouldInterject('c1', () => 0.6), false);
});

test('the chance is exclusive at the boundary', t => {
    setup(t);
    // random() must be strictly under the chance, so 0.5 with chance 0.5 loses.
    assert.strictEqual(shouldInterject('c1', () => 0.5), false);
});

test('a win puts the channel on cooldown', t => {
    setup(t);

    assert.strictEqual(shouldInterject('c1', () => 0.1), true);
    assert.strictEqual(shouldInterject('c1', () => 0.1), false);

    t.mock.timers.tick(COOLDOWN_MS - 1);
    assert.strictEqual(shouldInterject('c1', () => 0.1), false);

    t.mock.timers.tick(1);
    assert.strictEqual(shouldInterject('c1', () => 0.1), true);
});

test('a losing roll does not start a cooldown', t => {
    setup(t);

    assert.strictEqual(shouldInterject('c1', () => 0.9), false);
    assert.strictEqual(shouldInterject('c1', () => 0.1), true);
});

test('cooldowns are per channel', t => {
    setup(t);

    assert.strictEqual(shouldInterject('c1', () => 0.1), true);
    assert.strictEqual(shouldInterject('c2', () => 0.1), true);
    assert.strictEqual(shouldInterject('c1', () => 0.1), false);
});
