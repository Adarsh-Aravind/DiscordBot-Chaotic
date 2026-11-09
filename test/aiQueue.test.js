// How riri handles a room talking over her. Set before config loads.
process.env.GROQ_API_KEY = 'test-key';
process.env.AI_EXCUSE_COOLDOWN_MS = '60000';

const test = require('node:test');
const assert = require('node:assert');
const { generateAIResponse, clearMemory, resetScheduler } = require('../utils/ai');

function reply(content) {
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    });
}

function errorResponse(status, { retryAfter } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (retryAfter !== undefined) headers['retry-after'] = String(retryAfter);
    return new Response(JSON.stringify({ error: { message: '' } }), { status, headers });
}

function hushLogs(t) {
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'warn', () => {});
}

/** A fetch stand-in you release by hand, so ordering can be controlled. */
function gatedGroq(t) {
    const waiting = [];
    const seen = [];

    t.mock.method(globalThis, 'fetch', (_url, init) => {
        const sent = JSON.parse(init.body).messages.at(-1).content;
        seen.push(sent);
        return new Promise(resolve => waiting.push(() => resolve(reply(`answer to ${sent}`))));
    });

    return {
        seen,
        /** Let the oldest in-flight request finish. */
        release() {
            const next = waiting.shift();
            assert.ok(next, 'nothing was in flight');
            next();
        },
        get inFlight() {
            return waiting.length;
        }
    };
}

test.beforeEach(resetScheduler);

test('a line sent mid-answer waits its turn instead of being brushed off', async t => {
    hushLogs(t);
    const groq = gatedGroq(t);

    const first = generateAIResponse('queue-wait', 'first', { speakerName: 'nova' });
    await new Promise(setImmediate);

    const second = generateAIResponse('queue-wait', 'second', { speakerName: 'nova' });
    await new Promise(setImmediate);

    // The second hasn't been sent to Groq yet, and crucially hasn't been
    // answered with a canned brush-off that would land before the first reply.
    assert.strictEqual(groq.inFlight, 1);

    groq.release();
    assert.strictEqual(await first, 'answer to nova: first');

    await new Promise(setImmediate);
    groq.release();
    assert.strictEqual(await second, 'answer to nova: second');

    // In order, and in the order they were said.
    assert.deepStrictEqual(groq.seen, ['nova: first', 'nova: second']);
    clearMemory('queue-wait');
});

test('a burst costs two replies, the first thing said and the last', async t => {
    hushLogs(t);
    const groq = gatedGroq(t);

    const pending = ['one', 'two', 'three', 'four', 'five'].map(text => {
        const answer = generateAIResponse('queue-burst', text, { speakerName: 'spammer' });
        return answer;
    });
    await new Promise(setImmediate);

    groq.release();
    await new Promise(setImmediate);
    groq.release();

    const answers = await Promise.all(pending);

    // The first is answered, the last is answered, and the three it overtook
    // resolve to nothing at all rather than to a stale reply posted after it.
    assert.strictEqual(answers[0], 'answer to spammer: one');
    assert.strictEqual(answers.at(-1), 'answer to spammer: five');
    assert.deepStrictEqual(answers.slice(1, -1), [null, null, null]);

    assert.deepStrictEqual(groq.seen, ['spammer: one', 'spammer: five']);
    clearMemory('queue-burst');
});

test('channels do not wait on each other', async t => {
    hushLogs(t);
    const groq = gatedGroq(t);

    generateAIResponse('queue-a', 'hi', { speakerName: 'nova' });
    generateAIResponse('queue-b', 'hi', { speakerName: 'nova' });
    await new Promise(setImmediate);

    assert.strictEqual(groq.inFlight, 2, 'one busy channel should not hold up another');

    groq.release();
    groq.release();
    await new Promise(setImmediate);

    clearMemory('queue-a');
    clearMemory('queue-b');
});

test('saying the same thing twice does not stack in her memory', async t => {
    hushLogs(t);

    const sent = [];
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
        sent.push(JSON.parse(init.body).messages);
        return reply('anyways 😏');
    });

    await generateAIResponse('dupe-memory', 'Hello', { speakerName: 'rolex' });
    await generateAIResponse('dupe-memory', 'Hello', { speakerName: 'rolex' });
    await generateAIResponse('dupe-memory', 'Hello', { speakerName: 'rolex' });

    // By the third, the history holds one "Hello" per exchange rather than a
    // growing wall of them — that run is what she used to read as a situation
    // escalating and answer accordingly.
    const user = sent.at(-1).filter(m => m.role === 'user' && m.content === 'rolex: Hello');
    assert.strictEqual(user.length, 1);

    clearMemory('dupe-memory');
});

test('she says she is rate limited once, then stops saying it', async t => {
    hushLogs(t);
    t.mock.method(globalThis, 'fetch', async () => errorResponse(429, { retryAfter: '7200' }));

    const first = await generateAIResponse('excuse-channel', 'hi', { speakerName: 'nova' });
    assert.match(first, /talked out for today/);

    // Identical wording every time, so the second and third are left unsaid —
    // messageCreate reacts instead of posting the same bot error on a loop.
    assert.strictEqual(await generateAIResponse('excuse-channel', 'hello', { speakerName: 'nova' }), null);
    assert.strictEqual(await generateAIResponse('excuse-channel', 'oi', { speakerName: 'nova' }), null);
});

test('an excuse in one channel does not silence another', async t => {
    hushLogs(t);
    t.mock.method(globalThis, 'fetch', async () => errorResponse(500));

    assert.strictEqual(
        await generateAIResponse('excuse-one', 'hi'),
        'nah i lost my train of thought 💀'
    );
    assert.strictEqual(
        await generateAIResponse('excuse-two', 'hi'),
        'nah i lost my train of thought 💀'
    );
});

test('a different thing going wrong is still said', async t => {
    hushLogs(t);

    let status = 429;
    t.mock.method(globalThis, 'fetch', async () => errorResponse(status, { retryAfter: '5' }));

    assert.match(await generateAIResponse('mixed-errors', 'hi', { speakerName: 'nova' }), /need a sec/);

    // A dead GROQ_MODEL seconds later is new information, and the only thing
    // telling it apart from the network being down. One cooldown for every
    // excuse swallowed it and left the dev with a 👀.
    status = 404;
    assert.match(
        await generateAIResponse('mixed-errors', 'you ok', { speakerName: 'nova' }),
        /GROQ_MODEL/
    );
});

test('a repeat is matched past case and punctuation in her memory too', async t => {
    hushLogs(t);

    const sent = [];
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
        sent.push(JSON.parse(init.body).messages);
        return reply('anyways 😏');
    });

    // The gate counts these as one line said three times, so the history has
    // to as well — comparing the raw text let the near-identical copies stack.
    await generateAIResponse('dupe-loose', 'Hello', { speakerName: 'rolex' });
    await generateAIResponse('dupe-loose', 'hello!!', { speakerName: 'rolex' });
    await generateAIResponse('dupe-loose', 'HELLO ...', { speakerName: 'rolex' });

    const theirs = sent.at(-1).filter(m => m.role === 'user');
    assert.strictEqual(theirs.length, 1, JSON.stringify(theirs));

    clearMemory('dupe-loose');
});

test('two different reactions are two different turns', async t => {
    hushLogs(t);

    const sent = [];
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
        sent.push(JSON.parse(init.body).messages);
        return reply('anyways 😏');
    });

    // Both collapse to nothing once punctuation and symbols are dropped, so a
    // blind normalised compare would read the second as a repeat of the first
    // and drop an exchange that actually happened.
    await generateAIResponse('emoji-turns', '😭', { speakerName: 'rolex' });
    await generateAIResponse('emoji-turns', '💀', { speakerName: 'rolex' });

    const theirs = sent.at(-1).filter(m => m.role === 'user');
    assert.strictEqual(theirs.length, 2, JSON.stringify(theirs));

    clearMemory('emoji-turns');
});

test('the request names the person she is meant to be answering', async t => {
    hushLogs(t);

    let system;
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
        system = JSON.parse(init.body).messages[0].content;
        return reply('anyways 😏');
    });

    await generateAIResponse('reply-to-channel', 'what time is it', { speakerName: 'nova' });

    assert.match(system, /REPLY TO: .*nova/);
    clearMemory('reply-to-channel');
});
