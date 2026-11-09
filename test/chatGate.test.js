// What riri refuses to spend a Groq call on. Set before config loads.
process.env.GROQ_API_KEY = 'test-key';
process.env.AI_FLOOD_WINDOW_MS = '20000';
process.env.AI_FLOOD_MAX = '4';
process.env.AI_DUPLICATE_WINDOW_MS = '90000';
process.env.AI_CALLS_PER_MINUTE = '10';

const test = require('node:test');
const assert = require('node:assert');
const {
    admit,
    reserve,
    release,
    charge,
    forget,
    reset,
    trackedSpeakers,
    MAX_TRACKED_SPEAKERS
} = require('../utils/chatGate');

const ALICE = '111111111111111111';
const BOB = '222222222222222222';

test.beforeEach(reset);

test('an ordinary line is let through', () => {
    // `at` is the budget slot it took, so a call that never happens can hand
    // the slot back.
    assert.deepStrictEqual(admit(ALICE, 'hey riri what are you doing', 0), { ok: true, at: 0 });
});

test('the same line again is not worth a second call', () => {
    assert.strictEqual(admit(ALICE, 'Hello', 0).ok, true);

    const second = admit(ALICE, 'Hello', 1000);
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.reason, 'duplicate');
});

test('a duplicate is matched past case, punctuation and spacing', () => {
    // Three ways of typing one word is still one word.
    assert.strictEqual(admit(ALICE, 'Hello', 0).ok, true);
    assert.strictEqual(admit(ALICE, 'hello!!!', 500).reason, 'duplicate');
    assert.strictEqual(admit(ALICE, '  HELLO ...  ', 900).reason, 'duplicate');
});

test('saying it again long afterwards is a new message', () => {
    assert.strictEqual(admit(ALICE, 'hello', 0).ok, true);
    assert.strictEqual(admit(ALICE, 'hello', 90_001).ok, true);
});

test('a duplicate from someone else is their first time saying it', () => {
    assert.strictEqual(admit(ALICE, 'hello', 0).ok, true);
    assert.strictEqual(admit(BOB, 'hello', 100).ok, true);
});

test('a flood from one person stops after their allowance', () => {
    for (let i = 0; i < 4; i += 1) {
        assert.strictEqual(admit(ALICE, `line number ${i}`, i * 100).ok, true, `message ${i}`);
    }

    const fifth = admit(ALICE, 'line number 5', 500);
    assert.strictEqual(fifth.ok, false);
    assert.strictEqual(fifth.reason, 'flood');
});

test('the flood allowance refills as the window slides', () => {
    for (let i = 0; i < 4; i += 1) admit(ALICE, `line number ${i}`, i * 100);
    assert.strictEqual(admit(ALICE, 'one more', 500).reason, 'flood');

    // The first of the four has aged out, so there is room for one again.
    assert.strictEqual(admit(ALICE, 'one more', 20_101).ok, true);
});

test('repeating yourself does not eat your allowance of real messages', () => {
    admit(ALICE, 'hello', 0);
    for (let i = 1; i <= 8; i += 1) assert.strictEqual(admit(ALICE, 'hello', i * 100).reason, 'duplicate');

    // Three real messages left, because only the first "hello" was counted.
    for (let i = 0; i < 3; i += 1) {
        assert.strictEqual(admit(ALICE, `something else ${i}`, 1000 + i).ok, true, `message ${i}`);
    }
    assert.strictEqual(admit(ALICE, 'and another thing', 1100).reason, 'flood');
});

test('only the first refusal of a burst is acknowledged', () => {
    admit(ALICE, 'hello', 0);

    assert.strictEqual(admit(ALICE, 'hello', 100).acknowledge, true);
    assert.strictEqual(admit(ALICE, 'hello', 200).acknowledge, false);
    assert.strictEqual(admit(ALICE, 'hello', 19_000).acknowledge, false);

    // Still spamming a window later — one more shrug, not one per message.
    assert.strictEqual(admit(ALICE, 'hello', 40_000).acknowledge, true);
});

test('the room as a whole has a ceiling, whoever is talking', () => {
    const people = Array.from({ length: 12 }, (_, i) => `user-${i}`);

    for (let i = 0; i < 10; i += 1) {
        assert.strictEqual(admit(people[i], `a message from ${i}`, i).ok, true, `call ${i}`);
    }

    const overflow = admit(people[10], 'me too', 11);
    assert.strictEqual(overflow.ok, false);
    assert.strictEqual(overflow.reason, 'budget');
});

test('the ceiling is per minute, not forever', () => {
    for (let i = 0; i < 10; i += 1) admit(`user-${i}`, `a message from ${i}`, i);
    assert.strictEqual(admit('late', 'hello there', 50).reason, 'budget');

    assert.strictEqual(admit('late', 'hello there', 60_001).ok, true);
});

test('an interjection takes from the same budget', () => {
    for (let i = 0; i < 10; i += 1) admit(`user-${i}`, `a message from ${i}`, i);

    assert.strictEqual(reserve(20), false);
});

test('a reserved interjection counts against what the room can spend', () => {
    for (let i = 0; i < 10; i += 1) assert.strictEqual(reserve(i), true, `reserve ${i}`);

    assert.strictEqual(admit(ALICE, 'hey riri', 20).reason, 'budget');
});

test('an unknown speaker is still rate limited, not treated as everyone', () => {
    assert.strictEqual(admit(null, 'hello', 0).ok, true);
    assert.strictEqual(admit(null, 'hello', 100).reason, 'duplicate');
});

test('the duplicate window runs from the answer, not from the last refusal', () => {
    assert.strictEqual(admit(ALICE, 'wyd', 0).ok, true);

    // Refusing it used to restamp the window, which made it slide: asking the
    // same thing once a minute held a ninety-second window permanently open
    // and was never answered again, however long they kept it up.
    assert.strictEqual(admit(ALICE, 'wyd', 60_000).reason, 'duplicate');
    assert.strictEqual(admit(ALICE, 'wyd', 90_001).ok, true);
});

test('a line she never answered can be said again', () => {
    const verdict = admit(ALICE, 'you there', 0);
    assert.strictEqual(verdict.ok, true);

    // The scheduler dropped it for a newer line from someone else, so all she
    // did was react. Asking again is the only move left to them, and the gate
    // used to refuse it as a duplicate of a message it never answered.
    forget(ALICE, 'you there', verdict.at);
    assert.strictEqual(admit(ALICE, 'you there', 1000).ok, true);
});

test('a slot taken for a call that never happened goes back', () => {
    const taken = [];
    for (let i = 0; i < 10; i += 1) taken.push(admit(`user-${i}`, `a message from ${i}`, i).at);

    assert.strictEqual(admit('late', 'hello there', 11).reason, 'budget');

    // The first of those was superseded before it reached Groq, so the minute
    // has room for one after all — the ceiling should count calls made, not
    // messages waved through.
    release(taken[0]);
    assert.strictEqual(admit('late', 'hello there', 12).ok, true);
});

test('a retry is billed to the room like any other request', () => {
    for (let i = 0; i < 9; i += 1) assert.strictEqual(reserve(i), true, `reserve ${i}`);

    // The ninth call got a 429 and was retried once. That retry is a tenth
    // request carrying the same prompt again, so it fills the minute even
    // though only nine messages were let through.
    charge(10);
    assert.strictEqual(reserve(11), false);
});

test('the speaker map is held to its cap even when nobody has gone stale', () => {
    // Everyone inside a second of each other, so none of them is prunable by
    // age — which is exactly the case the old sweep could not free anything in.
    for (let i = 0; i < MAX_TRACKED_SPEAKERS + 120; i += 1) admit(`user-${i}`, `line ${i}`, i);

    assert.ok(
        trackedSpeakers() <= MAX_TRACKED_SPEAKERS,
        `tracking ${trackedSpeakers()} speakers, cap is ${MAX_TRACKED_SPEAKERS}`
    );
});

test('the cap evicts the people who have not spoken in longest', () => {
    admit(ALICE, 'first thing said', 0);

    for (let i = 0; i < MAX_TRACKED_SPEAKERS; i += 1) admit(`user-${i}`, `line ${i}`, 10 + i);

    // Alice spoke before all of them and hasn't since, so she is the one to go
    // — and her line is a fresh message again rather than a duplicate. A
    // minute on, so the room's own ceiling isn't what answers this.
    assert.strictEqual(admit(ALICE, 'first thing said', 70_000).ok, true);
});
