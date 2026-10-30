// What riri does when Groq says no. Set before config loads.
process.env.GROQ_API_KEY = 'test-key';

const test = require('node:test');
const assert = require('node:assert');
const config = require('../utils/config');
const {
    generateAIResponse,
    clearMemory,
    retryAfterMs,
    trimTurn,
    GroqError
} = require('../utils/ai');

/**
 * The refusal postCompletion throws once it has turned a non-2xx into an error.
 * Built directly here so the `retry-after` parsing can be tested on its own,
 * without a round trip through fetch.
 */
function httpError(status, { retryAfter, message = '' } = {}) {
    return new GroqError(status, {
        headers: retryAfter === undefined ? {} : { 'retry-after': String(retryAfter) },
        data: { error: { message } }
    });
}

/** A real Response, so the status/headers/body handling is genuinely exercised. */
function errorResponse(status, { retryAfter, message = '' } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (retryAfter !== undefined) headers['retry-after'] = String(retryAfter);

    return new Response(JSON.stringify({ error: { message } }), { status, headers });
}

function reply(content) {
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    });
}

/** Stand in for Groq. Returns whatever `handler` gives, as fetch would. */
function mockGroq(t, handler) {
    return t.mock.method(globalThis, 'fetch', handler);
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

test('no refusal ever escapes as an exception', async t => {
    hushLogs(t);

    // messageCreate sends whatever comes back straight to Discord, so every
    // one of these has to resolve to a string rather than throw. fetch made
    // this worth stating: a non-2xx is a resolved response, so the throw is
    // hand-written now and a rethrow would surface as a dead mention.
    for (const status of [400, 401, 404, 429, 500, 502, 503, 504]) {
        mockGroq(t, async () => errorResponse(status, { retryAfter: '7200' }));

        const answer = await generateAIResponse(`escape-${status}`, 'hi');
        assert.strictEqual(typeof answer, 'string', `${status} should resolve to a line`);
        assert.ok(answer.length > 0, `${status} resolved to an empty string`);

        t.mock.restoreAll();
    }
});

test('a burst is waited out and she answers anyway', async t => {
    hushLogs(t);

    let calls = 0;
    mockGroq(t, async () => {
        calls += 1;
        if (calls === 1) return errorResponse(429, { retryAfter: '0.05' });
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
    mockGroq(t, async () => {
        calls += 1;
        return errorResponse(429, { retryAfter: '0.05' });
    });

    const answer = await generateAIResponse('spent-channel', 'hi');

    assert.strictEqual(answer, 'slow down, i need a sec 😭');
    assert.strictEqual(calls, config.ai.maxRetries + 1, 'should have used every retry');
});

test('a wait measured in hours is taken at its word, not sat through', async t => {
    hushLogs(t);

    let calls = 0;
    mockGroq(t, async () => {
        calls += 1;
        return errorResponse(429, { retryAfter: '7200' });
    });

    const answer = await generateAIResponse('capped-channel', 'hi');

    // The daily allowance is gone — "i need a sec" would be a lie.
    assert.strictEqual(answer, "i'm all talked out for today, come back tomorrow 😭");
    assert.strictEqual(calls, 1, 'should not have retried');
});

test("a request that is wrong isn't sent again", async t => {
    hushLogs(t);

    let calls = 0;
    mockGroq(t, async () => {
        calls += 1;
        return errorResponse(400, { message: 'model decommissioned' });
    });

    const answer = await generateAIResponse('dead-model-channel', 'hi');

    assert.match(answer, /GROQ_MODEL/);
    assert.strictEqual(calls, 1, 'a 400 is the same 400 every time');
});

test('a 401 is reported as revoked keys, not a network wobble', async t => {
    hushLogs(t);

    let calls = 0;
    mockGroq(t, async () => {
        calls += 1;
        return errorResponse(401, { message: 'Invalid API Key' });
    });

    assert.match(await generateAIResponse('revoked-channel', 'hi'), /keys got revoked/);
    assert.strictEqual(calls, 1, 'a bad key is bad every time');
});

test('a dropped connection is not retried and does not crash', async t => {
    hushLogs(t);

    // fetch rejects rather than resolving, so there is no status to match
    // against RETRY_STATUSES — it falls straight through to the generic line.
    let calls = 0;
    mockGroq(t, async () => {
        calls += 1;
        throw new TypeError('fetch failed');
    });

    assert.strictEqual(
        await generateAIResponse('offline-channel', 'hi'),
        'nah i lost my train of thought 💀'
    );
    assert.strictEqual(calls, 1);
});

test('an unparseable error body still reports the status', async t => {
    hushLogs(t);

    // A gateway in front of Groq can answer 502 with HTML. Reading that as
    // JSON throws, and the status is the useful part, so it must survive.
    mockGroq(t, async () => new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' }
    }));

    const answer = await generateAIResponse('html-error-channel', 'hi');
    assert.strictEqual(answer, 'nah i lost my train of thought 💀');
});

test('the request Groq receives is the chat-completions payload', async t => {
    hushLogs(t);

    let seen;
    mockGroq(t, async (url, init) => {
        seen = { url, init };
        return reply('anyways 😏');
    });

    await generateAIResponse('payload-channel', 'hi', { speakerName: 'nova' });

    assert.match(seen.url, /api\.groq\.com/);
    assert.strictEqual(seen.init.method, 'POST');
    assert.strictEqual(seen.init.headers.Authorization, 'Bearer test-key');
    assert.ok(seen.init.signal, 'the request has to carry a timeout');

    const body = JSON.parse(seen.init.body);
    assert.strictEqual(body.model, config.ai.model);
    assert.strictEqual(body.stream, false);
    assert.strictEqual(body.messages[0].role, 'system');
    assert.strictEqual(body.messages.at(-1).content, 'nova: hi');

    clearMemory('payload-channel');
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
    mockGroq(t, async (url, init) => {
        sent.push(JSON.parse(init.body).messages);
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

    mockGroq(t, async () => errorResponse(429, { retryAfter: '7200' }));

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

    mockGroq(t, async () => reply('your aura is beige today 💅'));

    const butting = await generateAIResponse('chatty-channel', 'anyway so i told him', { unprompted: true });

    assert.strictEqual(butting, 'your aura is beige today 💅');
    clearMemory('chatty-channel');
});

test("an out-of-character reply isn't worth butting in with", async t => {
    hushLogs(t);

    mockGroq(t, async () => reply('As an AI language model, I cannot help with that.'));

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
    mockGroq(t, () => new Promise(resolve => {
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
