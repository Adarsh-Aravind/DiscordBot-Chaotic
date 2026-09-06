const test = require('node:test');
const assert = require('node:assert');

const { parseFeed, decodeEntities } = require('../utils/youtubeWatcher');

function feed(entries, channelTitle = 'Chaotic Chan') {
    const body = entries.map(e => `<entry>${e}</entry>`).join('');
    return `<feed><title>${channelTitle}</title><link/>${body}</feed>`;
}

function entry({ id = 'vid1', title = 'A video', author = 'Bob', published = '2026-01-01T00:00:00+00:00' } = {}) {
    return (
        `<yt:videoId>${id}</yt:videoId>` +
        `<title>${title}</title>` +
        `<author><name>${author}</name></author>` +
        `<published>${published}</published>`
    );
}

test('decodeEntities handles astral-plane numeric entities', () => {
    // fromCharCode would truncate this to a lone surrogate.
    assert.strictEqual(decodeEntities('Rocket &#128640; go'), 'Rocket 🚀 go');
});

test('decodeEntities handles hex numeric entities', () => {
    assert.strictEqual(decodeEntities('Hex &#x1F600; face'), 'Hex 😀 face');
    assert.strictEqual(decodeEntities('Upper &#X1F600; too'), 'Upper 😀 too');
});

test('decodeEntities handles named entities', () => {
    assert.strictEqual(decodeEntities('&lt;b&gt;'), '<b>');
    assert.strictEqual(decodeEntities('&quot;hi&quot;'), '"hi"');
    assert.strictEqual(decodeEntities("it&#39;s &apos;fine&apos;"), "it's 'fine'");
    assert.strictEqual(decodeEntities('caf&#233;'), 'café');
});

test('decodeEntities unescapes ampersands last', () => {
    // Decoding & first would turn "&amp;lt;" into a real "<".
    assert.strictEqual(decodeEntities('&amp;lt;b&amp;gt;'), '&lt;b&gt;');
    assert.strictEqual(decodeEntities('Tom &amp; Jerry'), 'Tom & Jerry');
});

test('decodeEntities drops out-of-range code points instead of throwing', () => {
    assert.strictEqual(decodeEntities('bad &#99999999; cp'), 'bad  cp');
});

test('parseFeed reads the channel name from the feed header', () => {
    assert.strictEqual(parseFeed(feed([entry()])).channelName, 'Chaotic Chan');
});

test('parseFeed falls back to "YouTube" when the header has no title', () => {
    const xml = `<feed><entry>${entry()}</entry></feed>`;
    assert.strictEqual(parseFeed(xml).channelName, 'YouTube');
});

test('parseFeed returns entries newest-first, as the feed orders them', () => {
    const { entries } = parseFeed(feed([
        entry({ id: 'newest' }),
        entry({ id: 'older' })
    ]));

    assert.deepStrictEqual(entries.map(e => e.videoId), ['newest', 'older']);
});

test('parseFeed builds watch and thumbnail urls from the video id', () => {
    const [video] = parseFeed(feed([entry({ id: 'abc123' })])).entries;

    assert.strictEqual(video.url, 'https://www.youtube.com/watch?v=abc123');
    assert.strictEqual(video.thumbnail, 'https://i.ytimg.com/vi/abc123/hqdefault.jpg');
});

test('parseFeed decodes entities in titles', () => {
    const [video] = parseFeed(feed([entry({ title: 'Rocket &#128640; &amp;amp; caf&#233;' })])).entries;
    assert.strictEqual(video.title, 'Rocket 🚀 &amp; café');
});

test('parseFeed skips entries with no video id', () => {
    const xml = feed(['<title>Broken</title>', entry({ id: 'good' })]);
    assert.deepStrictEqual(parseFeed(xml).entries.map(e => e.videoId), ['good']);
});

test('parseFeed falls back to the channel name when an entry has no author', () => {
    const xml = feed([`<yt:videoId>v</yt:videoId><title>T</title>`]);
    assert.strictEqual(parseFeed(xml).entries[0].author, 'Chaotic Chan');
});

test('parseFeed defaults a missing title rather than dropping the video', () => {
    const xml = feed([`<yt:videoId>v</yt:videoId><author><name>Bob</name></author>`]);
    assert.strictEqual(parseFeed(xml).entries[0].title, 'Untitled');
});

test('parseFeed returns no entries for an empty feed', () => {
    assert.deepStrictEqual(parseFeed(feed([])).entries, []);
});
