// What riri does when Groq says no. Set before config loads.
process.env.GROQ_API_KEY = 'test-key';

const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const config = require('../utils/config');
const {
    generateAIResponse,
    clearMemory,
    retryAfterMs,
    trimTurn
} = require('../utils/ai');

/** An axios-shaped rejection, the way the real client hands them over. */
function httpError(status, { retryAfter, message = '' } = {}) {
    const err = new Error(message || `HTTP ${status}`);
    err.response = {
        status,
        headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter },
        data: { error: { message } }
    };
    return err;
}

function reply(content) {
    return { data: { choices: [{ message: { content } }] } };
}

/** Quiet the [AI ERROR] lines these tests deliberately provoke. */
function hushLogs(t) {
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'warn', () => {});
}

test('the wait Groq asks for is read off the header', () => {
    assert.strictEqual(retryAfterMs(httpError(429, { retryAfter: '2' })), 2000);
    // Groq sends fractional seconds, which a seconds-only parse would floor to 0.
    assert.strictEqual(retryAfterMs(httpError(429, { retryAfter: '1.5' })), 1500);
});

test('the wait is also read out of the error body, when there is no header', () => {
    const burst = httpError(429, { message: 'Rate limit reached. Please try again in 7.66s' });
    assert.strictEqual(retryAfterMs(burst), 7660);

    const spent = httpError(429, { message: 'Limit reached, please try again in 2m59.56s' });
    assert.strictEqual(retryAfterMs(spent), 179_560);
});

test('a 429 that says nothing about waiting reports nothing', () => {
    assert.strictEqual(retryAfterMs(httpError(429)), null);
});

test('a burst is waited out and she answers anyway', async t => {
    hushLogs(t);

    let calls = 0;
    t.mock.method(axios, 'post', async () => {
        calls += 1;
        if (calls === 1) throw httpError(429, { retryAfter: '0.05' });
        return reply('took you long enough 💅');
    });

    const answer = await generateAIResponse('burst-channel', 'hi');

    assert.strictEqual(answer, 'took you long enough 💅');
    assert.strictEqual(calls, 2, 'should have retried once');
    clearMemory('burst-channel');
});

test('a 429 that outlasts the budget gives up, after using it', async t => {
    hushLogs(t);

    let calls = 0;
    t.mock.method(axios, 'post', async () => {
        calls += 1;
        throw httpError(429, { retryAfter: '0.05' });
    });

    const answer = await generateAIResponse('spent-channel', 'hi');

    assert.strictEqual(answer, 'slow down, i need a sec 😭');
    assert.strictEqual(calls, config.ai.maxRetries + 1, 'should have used every retry');
});

test('a wait measured in hours is taken at its word, not sat through', async t => {
    hushLogs(t);

    let calls = 0;
    t.mock.method(axios, 'post', async () => {
        calls += 1;
        throw httpError(429, { retryAfter: '7200' });
    });

    const answer = await generateAIResponse('capped-channel', 'hi');

    // The daily allowance is gone — "i need a sec" would be a lie.
    assert.strictEqual(answer, "i'm all talked out for today, come back tomorrow 😭");
    assert.strictEqual(calls, 1, 'should not have retried');
});

test("a request that is wrong isn't sent again", async t => {
    hushLogs(t);

    let calls = 0;
    t.mock.method(axios, 'post', async () => {
        calls += 1;
        throw httpError(400, { message: 'model decommissioned' });
    });

    const answer = await generateAIResponse('dead-model-channel', 'hi');

    assert.match(answer, /GROQ_MODEL/);
    assert.strictEqual(calls, 1, 'a 400 is the same 400 every time');
});

test('a remembered turn is cut to a chat-sized line', () => {
    const essay = 'a'.repeat(2000);
    const kept = trimTurn(essay);

    assert.strictEqual(kept.length, config.ai.historyCharLimit);
    assert.ok(kept.endsWith('…'));

    // Anything already short is left exactly as it was said.
    assert.strictEqual(trimTurn('nova: hey'), 'nova: hey');
});

test('a pasted wall of text is not resent in full on the next message', async t => {
    hushLogs(t);

    const sent = [];
    t.mock.method(axios, 'post', async (url, body) => {
        sent.push(body.messages);
        return reply('anyways 😏');
    });

    const essay = 'b'.repeat(2000);
    await generateAIResponse('paste-channel', essay, { speakerName: 'nova' });
    await generateAIResponse('paste-channel', 'still there?', { speakerName: 'nova' });

    // Said once in full, because this turn was worth reading properly.
    const first = sent[0].at(-1).content;
    assert.ok(first.includes(essay), 'the turn itself should go out whole');

    // Every request after that pays for it again, so only the gist is kept.
    const remembered = sent[1].find(m => m.content.startsWith('nova: b'));
    assert.strictEqual(remembered.content.length, config.ai.historyCharLimit);

    clearMemory('paste-channel');
});

test('an interjection nobody asked for stays quiet when Groq says no', async t => {
    hushLogs(t);

    t.mock.method(axios, 'post', async () => {
        throw httpError(429, { retryAfter: '7200' });
    });

    // Butting into a conversation to apologise for a rate limit is the bot
    // showing through, so she says nothing at all.
    const butting = await generateAIResponse('quiet-channel', 'go on then', { unprompted: true });
    assert.strictEqual(butting, null);

    // Someone who actually mentioned her is still told what happened: they are
    // sat waiting on a reply, and silence there looks worse than the seams.
    const asked = await generateAIResponse('asked-channel', 'oi riri');
    assert.match(asked, /talked out for today/);
});

test('an interjection still speaks when the model actually answers', async t => {
    hushLogs(t);

    t.mock.method(axios, 'post', async () => reply('your aura is beige today 💅'));

    const butting = await generateAIResponse('chatty-channel', 'anyway so i told him', { unprompted: true });

    assert.strictEqual(butting, 'your aura is beige today 💅');
    clearMemory('chatty-channel');
});

test("an out-of-character reply isn't worth butting in with", async t => {
    hushLogs(t);

    t.mock.method(axios, 'post', async () => reply('As an AI language model, I cannot help with that.'));

    // Prompted, a deflection stands in for the reply she owes them.
    const asked = await generateAIResponse('ooc-asked', 'what are you');
    assert.ok(asked && asked.length > 0);

    // Unprompted there is nothing to deflect — she had nothing to say.
    const butting = await generateAIResponse('ooc-butting', 'what are you', { unprompted: true });
    assert.strictEqual(butting, null);
});

test('she does not interrupt herself to say wait', async t => {
    hushLogs(t);

    let release;
    t.mock.method(axios, 'post', () => new Promise(resolve => {
        release = () => resolve(reply('anyways 😏'));
    }));

    // The lock is taken synchronously, so the second call sees it immediately.
    const answering = generateAIResponse('locked-channel', 'hi');
    const butting = await generateAIResponse('locked-channel', 'and another thing', { unprompted: true });

    assert.strictEqual(butting, null, '"wait… let me finish" is addressed to no one');

    release();
    assert.strictEqual(await answering, 'anyways 😏');
    clearMemory('locked-channel');
});
