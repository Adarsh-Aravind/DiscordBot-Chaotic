const os = require('node:os');
const nodePath = require('node:path');

// Set before config loads.
process.env.CLINGY_STATE_FILE = nodePath.join(os.tmpdir(), `clingy-test-${process.pid}.json`);
process.env.CLINGY_SILENCE_MS = '10800000';   // 3h
process.env.CLINGY_COOLDOWN_MS = '10800000';  // 3h

const test = require('node:test');
const assert = require('node:assert');
const clingy = require('../utils/clingyWatcher');

const HOUR = 3_600_000;
const SILENCE = 3 * HOUR;
const NOW = 1_000 * HOUR; // an arbitrary "now" well clear of the epoch

const always = () => 0; // pick the first line of a tier, deterministically

test('says nothing while he is still around', () => {
    const state = { lastSeenAt: NOW - HOUR, lastNaggedAt: 0 };
    assert.strictEqual(clingy.evaluate(state, NOW, always).due, false);
});

test('says nothing one millisecond early', () => {
    const state = { lastSeenAt: NOW - SILENCE + 1, lastNaggedAt: 0 };
    assert.strictEqual(clingy.evaluate(state, NOW, always).due, false);
});

test('speaks up once the silence is long enough', () => {
    const state = { lastSeenAt: NOW - SILENCE, lastNaggedAt: 0 };
    const result = clingy.evaluate(state, NOW, always);

    assert.strictEqual(result.due, true);
    assert.ok(result.line.length > 0);
});

test('stays quiet during the cooldown, however long the silence runs', () => {
    const state = { lastSeenAt: NOW - 50 * HOUR, lastNaggedAt: NOW - HOUR };
    assert.strictEqual(clingy.evaluate(state, NOW, always).due, false);
});

test('speaks again once the cooldown expires', () => {
    const state = { lastSeenAt: NOW - 50 * HOUR, lastNaggedAt: NOW - 3 * HOUR };
    assert.strictEqual(clingy.evaluate(state, NOW, always).due, true);
});

test('a fresh install does not open with an accusation', () => {
    assert.strictEqual(clingy.evaluate({ lastSeenAt: 0, lastNaggedAt: 0 }, NOW, always).due, false);
});

test('escalates with the length of the silence', () => {
    const [mild, worse, worst] = clingy.TIERS;

    assert.strictEqual(clingy.tierFor(SILENCE), mild);
    assert.strictEqual(clingy.tierFor(2 * SILENCE), worse);
    assert.strictEqual(clingy.tierFor(3 * SILENCE), worse);   // below the 4x step
    assert.strictEqual(clingy.tierFor(4 * SILENCE), worst);
    assert.strictEqual(clingy.tierFor(200 * SILENCE), worst); // never past the top
});

test('picks a line from the tier the silence earned', () => {
    const state = { lastSeenAt: NOW - 4 * SILENCE, lastNaggedAt: 0 };
    const result = clingy.evaluate(state, NOW, always);

    assert.ok(clingy.TIERS[2].lines.includes(result.line));
});

test('every tier has lines, and none are empty', () => {
    for (const tier of clingy.TIERS) {
        assert.ok(tier.lines.length > 0);
        for (const line of tier.lines) assert.ok(line.trim().length > 0);
    }
});
