const test = require('node:test');
const assert = require('node:assert');

const { chunkLines } = require('../commands/general/help');

test('keeps a short list in a single field', () => {
    assert.deepStrictEqual(chunkLines(['a', 'b', 'c']), ['a\nb\nc']);
});

test('splits before a field would exceed the limit', () => {
    // Three 40-char lines against a 100-char cap: 2 fit (81), the third starts a new field.
    const line = 'x'.repeat(40);
    const chunks = chunkLines([line, line, line], 100);

    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0], `${line}\n${line}`);
    assert.strictEqual(chunks[1], line);
    for (const chunk of chunks) assert.ok(chunk.length <= 100);
});

test('never emits a chunk over the limit', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `\`.command${i}\` 🔒 — a fairly wordy description`);

    for (const chunk of chunkLines(lines)) {
        assert.ok(chunk.length <= 1024, `chunk was ${chunk.length}`);
    }
});

test('keeps every line, in order, across the split', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line-${i}-${'y'.repeat(30)}`);

    const rejoined = chunkLines(lines).join('\n').split('\n');
    assert.deepStrictEqual(rejoined, lines);
});

test('truncates a single line that cannot be split', () => {
    const [chunk] = chunkLines(['z'.repeat(2000)]);

    assert.strictEqual(chunk.length, 1024);
    assert.ok(chunk.endsWith('…'));
});

test('handles an empty list', () => {
    assert.deepStrictEqual(chunkLines([]), []);
});
