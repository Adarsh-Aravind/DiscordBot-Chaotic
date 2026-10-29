// Riri's per-message wiring: who she is talking to. Set before config loads.
process.env.GROQ_API_KEY = 'test-key';

const test = require('node:test');
const assert = require('node:assert');
const config = require('../utils/config');
const { audienceLine, castMemberFor, labelFor } = require('../utils/ai');

const CAST = config.ai.cast;

test('each of her people is named with what they are to her', () => {
    assert.match(audienceLine(CAST.alpha.id), /boyfriend/);
    assert.match(audienceLine(CAST.zyco.id), /father in law/);
    assert.match(audienceLine(CAST.iris.id), /sidechick/);
    assert.match(audienceLine(CAST.sr.id), /secretary/i);
    assert.match(audienceLine(CAST.rogue.id), /sam/);
    assert.match(audienceLine(CAST.sam.id), /rogue/);
});

test('the cast is matched on id, not on whatever they call themselves', () => {
    // A nickname claiming to be Alpha gets no relationship line.
    const line = audienceLine('999999999999999999', 'Alpha');
    assert.doesNotMatch(line, /boyfriend/);
    assert.match(line, /Not one of your people/);
});

test('anyone else is just a person, by name', () => {
    assert.match(audienceLine('999999999999999999', 'nova'), /nova/);
    // No name available still has to read as a sentence.
    assert.match(audienceLine(null, null), /someone else/);
});

test('every cast member has a role line, so none can resolve to undefined', () => {
    for (const [key, member] of Object.entries(CAST)) {
        const line = audienceLine(member.id);
        assert.doesNotMatch(line, /undefined/, `${key} has no role line`);
    }
});

test('a cast member is found by id and carries their key', () => {
    assert.strictEqual(castMemberFor(CAST.iris.id)?.key, 'iris');
    assert.strictEqual(castMemberFor('999999999999999999'), null);
    assert.strictEqual(castMemberFor(null), null);
});

test('history labels the cast by their real name, not their nickname', () => {
    // So she still knows it is him after he renames himself for the fifth time.
    assert.strictEqual(labelFor(CAST.alpha.id, 'alph 🖤'), 'Alpha');
    assert.strictEqual(labelFor('999999999999999999', 'nova'), 'nova');
    assert.strictEqual(labelFor(null, null), 'someone');
});
