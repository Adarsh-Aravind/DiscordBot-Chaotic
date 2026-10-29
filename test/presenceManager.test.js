const test = require('node:test');
const assert = require('node:assert');

const presenceManager = require('../utils/presenceManager');

const { normalise } = presenceManager;

test('accepts every documented verb', () => {
    for (const verb of Object.keys(presenceManager.ACTIVITY_TYPES)) {
        const result = normalise({ type: verb, name: 'something' });
        assert.ok(result, `${verb} should be accepted`);
        assert.strictEqual(result.type, verb);
    }
});

test('verb is case-insensitive', () => {
    assert.strictEqual(normalise({ type: 'WATCHING', name: 'x' }).type, 'watching');
});

test('rejects an unknown verb', () => {
    assert.strictEqual(normalise({ type: 'vibing', name: 'x' }), null);
});

test('rejects empty or whitespace-only text', () => {
    assert.strictEqual(normalise({ type: 'watching', name: '' }), null);
    assert.strictEqual(normalise({ type: 'watching', name: '   ' }), null);
    assert.strictEqual(normalise({ type: 'watching' }), null);
});

test('text is trimmed and capped at the activity-name limit', () => {
    const result = normalise({ type: 'playing', name: '  ' + 'x'.repeat(300) + '  ' });
    assert.strictEqual(result.name.length, presenceManager.MAX_NAME);
});

test('keeps a twitch or youtube link on a streaming presence', () => {
    for (const url of [
        'https://twitch.tv/someone',
        'https://www.twitch.tv/someone',
        'https://youtube.com/watch?v=abc',
        'https://www.youtube.com/@someone'
    ]) {
        const result = normalise({ type: 'streaming', name: 'live', url });
        assert.strictEqual(result.url, url, `${url} should survive`);
    }
});

test('drops a link Discord would not render', () => {
    // Discord silently ignores the whole activity for a non-twitch/youtube url,
    // so it is better dropped than sent.
    for (const url of [
        'https://example.com/stream',
        'http://twitch.tv/someone',
        'https://nottwitch.tv/someone',
        'not a url'
    ]) {
        assert.strictEqual(normalise({ type: 'streaming', name: 'live', url }).url, null, url);
    }
});

test('drops a link on a non-streaming verb', () => {
    const result = normalise({ type: 'watching', name: 'x', url: 'https://twitch.tv/someone' });
    assert.strictEqual(result.url, null);
});

test('falls back to online for a missing or bogus status', () => {
    assert.strictEqual(normalise({ type: 'watching', name: 'x' }).status, 'online');
    assert.strictEqual(normalise({ type: 'watching', name: 'x', status: 'asleep' }).status, 'online');
});

test('keeps every status Discord accepts', () => {
    for (const status of presenceManager.STATUSES) {
        assert.strictEqual(normalise({ type: 'watching', name: 'x', status }).status, status);
    }
});

test('the shipped default is itself valid', () => {
    assert.ok(normalise(presenceManager.DEFAULT_PRESENCE));
});

test('describe reads as a sentence, and omits the verb for a custom status', () => {
    assert.match(presenceManager.describe(), /\[(online|idle|dnd|invisible)\]$/);
});
