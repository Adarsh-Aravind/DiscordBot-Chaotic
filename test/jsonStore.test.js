const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readJson, writeJson } = require('../utils/jsonStore');

function tmp(name) {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jsonstore-')), name);
}

test('round-trips a value', () => {
    const file = tmp('state.json');
    assert.ok(writeJson(file, { a: 1, b: ['x'] }));
    assert.deepStrictEqual(readJson(file, null), { a: 1, b: ['x'] });
});

test('creates the directory if it is missing', () => {
    const file = path.join(tmp('unused'), '..', 'nested', 'deep', 'state.json');
    assert.ok(writeJson(file, { ok: true }));
    assert.deepStrictEqual(readJson(file, null), { ok: true });
});

test('a missing file returns the fallback', () => {
    assert.deepStrictEqual(readJson(tmp('nope.json'), { fallback: true }), { fallback: true });
});

test('a truncated file returns the fallback instead of throwing', () => {
    // Exactly what a crash mid-write used to leave behind.
    const file = tmp('state.json');
    fs.writeFileSync(file, '{"type":"listen');

    assert.deepStrictEqual(readJson(file, { fallback: true }), { fallback: true });
});

test('a file containing bare null returns the fallback', () => {
    const file = tmp('state.json');
    fs.writeFileSync(file, 'null');

    assert.deepStrictEqual(readJson(file, { fallback: true }), { fallback: true });
});

test('leaves no temp files behind', () => {
    const file = tmp('state.json');
    writeJson(file, { a: 1 });
    writeJson(file, { a: 2 });

    const siblings = fs.readdirSync(path.dirname(file));
    assert.deepStrictEqual(siblings, ['state.json'], `found strays: ${siblings}`);
});

test('an overwrite is all-or-nothing', () => {
    const file = tmp('state.json');
    writeJson(file, { version: 1 });
    writeJson(file, { version: 2 });

    // Never a merge of the two, which is what a truncating write can produce.
    assert.deepStrictEqual(readJson(file, null), { version: 2 });
});

test('returns false rather than throwing when the path is unusable', () => {
    // A directory where the file should be: the write cannot succeed.
    const dir = tmp('state.json');
    fs.mkdirSync(dir, { recursive: true });

    assert.strictEqual(writeJson(dir, { a: 1 }), false);
});
