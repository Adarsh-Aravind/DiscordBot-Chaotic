const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const tt = require('../commands/fun/tt');

const VENDORED = path.join(__dirname, '..', 'assets', 'trashtalk.json');

test('the vendored list ships with the bot and is usable', () => {
    // The whole point of vendoring: startup must not depend on the network.
    assert.ok(fs.existsSync(VENDORED), 'assets/trashtalk.json is missing');

    const list = JSON.parse(fs.readFileSync(VENDORED, 'utf8'));
    assert.ok(Array.isArray(list));
    // `.tt` needs two distinct lines to pick a win and a loss.
    assert.ok(list.length >= 2, `only ${list.length} insults`);
    assert.ok(list.every(s => typeof s === 'string' && s.trim().length > 5));
});

test('the vendored list has no duplicates or code artifacts', () => {
    const list = JSON.parse(fs.readFileSync(VENDORED, 'utf8'));

    assert.strictEqual(new Set(list).size, list.length, 'contains duplicates');
    assert.ok(!list.some(s => s.startsWith('./')), 'contains a module path');
    assert.ok(list.every(s => s.includes(' ')), 'contains a non-sentence');
});

test('extractInsults pulls strings without evaluating the source', () => {
    const source = `
        'use strict';
        const x = require('./config');
        module.exports = ["You are bad at this game", 'Your aim is tragic honestly'];
    `;

    const result = tt.extractInsults(source);

    assert.deepStrictEqual(result, ['You are bad at this game', 'Your aim is tragic honestly']);
});

test('extractInsults drops code strings and short fragments', () => {
    const source = `module.exports = ["./config", "use strict", "abc", "ok", "A real insult here"];`;

    assert.deepStrictEqual(tt.extractInsults(source), ['A real insult here']);
});

test('extractInsults de-duplicates', () => {
    const source = `["same line twice over", "same line twice over"]`;
    assert.deepStrictEqual(tt.extractInsults(source), ['same line twice over']);
});

test('extractInsults returns nothing for a source with no strings', () => {
    assert.deepStrictEqual(tt.extractInsults('const a = 1 + 2;'), []);
});

test('applyFilter translates CS:GO terms to Valorant', () => {
    const out = tt.applyFilter('Nice AWP shot, Global Elite, go defuse the bomb in CS:GO');

    assert.match(out, /Operator/);
    assert.match(out, /Radiant/);
    assert.match(out, /spike/);
    assert.match(out, /Valorant/);
    assert.ok(!/AWP|Global Elite|bomb|CS:GO/.test(out), out);
});

test('applyFilter softens the profanity', () => {
    assert.ok(!/fuck/i.test(tt.applyFilter('what the fuck was that')));
});
