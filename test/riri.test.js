// Riri's per-message wiring: who she is talking to, and how that changes the
// system prompt. Set before config loads.
process.env.GROQ_API_KEY = 'test-key';
process.env.AI_PARTNER_USER_ID = 'alpha-id';
process.env.AI_DADDY_USER_ID = 'zyco-id';
process.env.AI_RIVAL_USER_ID = 'iris-id';
process.env.CLINGY_SILENCE_MS = '10800000'; // 3h

const test = require('node:test');
const assert = require('node:assert');
const { relationTo, contextLine } = require('../utils/ai');

const THREE_HOURS = 10_800_000;

test('relationTo recognises the people who matter', () => {
    assert.strictEqual(relationTo('alpha-id'), 'partner');
    assert.strictEqual(relationTo('zyco-id'), 'daddy');
    assert.strictEqual(relationTo('iris-id'), 'rival');
    assert.strictEqual(relationTo('someone-else'), 'other');
});

test('relationTo does not match an unknown speaker to a blank id', () => {
    // A missing author id must not collide with an unconfigured relationship.
    assert.strictEqual(relationTo(null), 'other');
    assert.strictEqual(relationTo(''), 'other');
});

test('the partner gets the warm, flirty line', () => {
    const line = contextLine({ relation: 'partner', speakerName: 'Alpha' });
    assert.match(line, /boyfriend/);
    assert.match(line, /flirty/);
});

test('zyco is daddy', () => {
    const line = contextLine({ relation: 'daddy', speakerName: 'zyco', mood: 'bored' });
    assert.match(line, /the one you call daddy/);
});

test('sugar daddy only comes out while she is flirting', () => {
    // Even a guaranteed roll loses if the mood is wrong.
    const bored = contextLine({ relation: 'daddy', speakerName: 'zyco', mood: 'bored' }, () => 0);
    assert.doesNotMatch(bored, /SUGAR DADDY/);

    const flirty = contextLine({ relation: 'daddy', speakerName: 'zyco', mood: 'flirty' }, () => 0);
    assert.match(flirty, /SUGAR DADDY/);
});

test('sugar daddy stays rare even when she is flirting', () => {
    const line = contextLine({ relation: 'daddy', speakerName: 'zyco', mood: 'flirty' }, () => 0.9);
    assert.doesNotMatch(line, /SUGAR DADDY/);
    assert.match(line, /the one you call daddy/);
});

test('the rival gets told to bait and to bite', () => {
    const line = contextLine({ relation: 'rival', speakerName: 'iris' });
    assert.match(line, /rival/);
    assert.match(line, /[Bb]ait/);
    assert.match(line, /bite/);
});

test('anyone else is just a person, by name', () => {
    assert.match(contextLine({ relation: 'other', speakerName: 'nova' }), /nova/);
    // No name available still has to read as a sentence.
    assert.match(contextLine({ relation: 'other' }), /someone else/);
});

test('Alpha is only mentioned as quiet once he actually is', () => {
    const quiet = contextLine({ relation: 'other', speakerName: 'nova', alphaSilentMs: THREE_HOURS });
    assert.match(quiet, /ALPHA HAS BEEN QUIET/);

    // Just under the threshold, and unknown, are both "nothing to say about him".
    const nearly = contextLine({ relation: 'other', speakerName: 'nova', alphaSilentMs: THREE_HOURS - 1 });
    assert.doesNotMatch(nearly, /ALPHA HAS BEEN QUIET/);
    assert.doesNotMatch(contextLine({ relation: 'other', speakerName: 'nova' }), /ALPHA/);
});

test('the quiet-Alpha note reports the hours, not the milliseconds', () => {
    const line = contextLine({ relation: 'other', speakerName: 'nova', alphaSilentMs: 6 * 60 * 60 * 1000 });
    assert.match(line, /about 6 hours/);
});
