// f1Helper holds the subtlest logic in the repo — a 10-minute cache, in-flight
// request de-duplication, and a deliberate refusal to cache failures — against
// a free, volunteer-run mirror that the whole F1 command set shares. None of it
// was covered, and all of it fails quietly: a broken cache just means more
// requests, and a cached failure means every F1 command is dead for ten minutes.

const test = require('node:test');
const assert = require('node:assert');

const {
    fetchData,
    clearCache,
    CACHE_TTL_MS,
    getCircuitImageUrl,
    getDriverStandings,
    getConstructorStandings,
    getNextRace,
    formatRaceInfo
} = require('../utils/f1Helper');

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

/** Stand in for the mirror, counting how many times it was actually called. */
function mockApi(t, handler) {
    const state = { calls: 0, urls: [], inits: [] };

    t.mock.method(globalThis, 'fetch', async (url, init) => {
        state.calls += 1;
        state.urls.push(url);
        state.inits.push(init);
        return handler(url, init);
    });

    return state;
}

function hushLogs(t) {
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'warn', () => {});
}

// --- the cache --------------------------------------------------------------

test('a second identical request inside the window is served from cache', async t => {
    clearCache();
    const api = mockApi(t, () => jsonResponse({ MRData: { ok: 1 } }));

    const first = await fetchData('driverStandings.json');
    const second = await fetchData('driverStandings.json');

    assert.strictEqual(api.calls, 1, 'the mirror should only have been asked once');
    assert.deepStrictEqual(first, second);
    assert.deepStrictEqual(first, { MRData: { ok: 1 } });
});

test('different endpoints are cached separately', async t => {
    clearCache();
    const api = mockApi(t, url => jsonResponse({ url }));

    const drivers = await fetchData('driverStandings.json');
    const constructors = await fetchData('constructorStandings.json');

    assert.strictEqual(api.calls, 2);
    assert.notDeepStrictEqual(drivers, constructors);
});

test('the cache expires, and a stale entry is refetched', async t => {
    clearCache();
    const api = mockApi(t, () => jsonResponse({ MRData: { ok: 1 } }));

    // The entry is stamped with Date.now(), so moving that is enough — no need
    // to sit through ten real minutes.
    const realNow = Date.now();
    let fakeNow = realNow;
    t.mock.method(Date, 'now', () => fakeNow);

    await fetchData('races.json');
    assert.strictEqual(api.calls, 1);

    // Still inside the window.
    fakeNow = realNow + CACHE_TTL_MS - 1;
    await fetchData('races.json');
    assert.strictEqual(api.calls, 1, 'should still be cached a millisecond short of the TTL');

    // Past it.
    fakeNow = realNow + CACHE_TTL_MS;
    await fetchData('races.json');
    assert.strictEqual(api.calls, 2, 'should have refetched once the TTL elapsed');
});

test('clearCache forces the next request back out to the mirror', async t => {
    clearCache();
    const api = mockApi(t, () => jsonResponse({ MRData: { ok: 1 } }));

    await fetchData('races.json');
    clearCache();
    await fetchData('races.json');

    assert.strictEqual(api.calls, 2);
});

// --- de-duplication ---------------------------------------------------------

test('concurrent identical requests become one call', async t => {
    clearCache();

    // Every caller's resolver is kept rather than just the last one. If the
    // de-duplication regresses, three real requests still settle and the test
    // fails on the count instead of hanging on promises nobody resolved.
    const resolvers = [];
    const api = mockApi(t, () => new Promise(resolve => resolvers.push(resolve)));

    // Three people running `.f1` at once. fetchData registers the in-flight
    // promise before its first await, so the later two see it synchronously.
    const all = Promise.all([
        fetchData('races.json'),
        fetchData('races.json'),
        fetchData('races.json')
    ]);

    for (const resolve of resolvers) resolve(jsonResponse({ MRData: { ok: 1 } }));
    const [a, b, c] = await all;

    assert.strictEqual(api.calls, 1, 'should have been a single request');
    assert.deepStrictEqual(a, b);
    assert.deepStrictEqual(b, c);
});

test('a request that already finished does not leave a stale in-flight entry', async t => {
    clearCache();
    const api = mockApi(t, () => jsonResponse({ MRData: { ok: 1 } }));

    await fetchData('races.json');
    clearCache(); // drop the cache but not the in-flight map
    await fetchData('races.json');

    // If `.finally` stopped deleting the entry, this would hand back the old
    // promise forever and the data would never refresh.
    assert.strictEqual(api.calls, 2);
});

// --- failures ---------------------------------------------------------------

test('a failed request is not cached', async t => {
    hushLogs(t);
    clearCache();

    let fail = true;
    const api = mockApi(t, () => (fail ? jsonResponse({}, 500) : jsonResponse({ MRData: { ok: 1 } })));

    assert.strictEqual(await fetchData('races.json'), null);

    // Caching that null would have left every F1 command broken for ten
    // minutes off one blip.
    fail = false;
    assert.deepStrictEqual(await fetchData('races.json'), { MRData: { ok: 1 } });
    assert.strictEqual(api.calls, 2);
});

test('a dropped connection resolves to null rather than throwing', async t => {
    hushLogs(t);
    clearCache();

    mockApi(t, () => {
        throw new TypeError('fetch failed');
    });

    // Every command does `if (!data)` and edits its "fetching…" message. A
    // throw here would surface as the generic command-error reply instead.
    assert.strictEqual(await fetchData('races.json'), null);
});

test('every request carries a timeout and a user agent', async t => {
    clearCache();
    const api = mockApi(t, () => jsonResponse({ MRData: {} }));

    await fetchData('races.json');

    assert.ok(api.inits[0].signal, 'a request with no timeout can hang the command');
    assert.match(api.inits[0].headers['User-Agent'], /BitBot/);
});

// --- url building -----------------------------------------------------------

test('a bare endpoint is resolved against the current season', async t => {
    clearCache();
    const api = mockApi(t, () => jsonResponse({ MRData: {} }));

    await fetchData('driverStandings.json');

    assert.strictEqual(
        api.urls[0],
        'https://api.jolpi.ca/ergast/f1/current/driverStandings.json'
    );
});

test('an absolute url is used as given', async t => {
    clearCache();
    const api = mockApi(t, () => jsonResponse({ MRData: {} }));

    // `.f1c` looks up past seasons, so it passes a full url through.
    await fetchData('https://api.jolpi.ca/ergast/f1/2021/results.json');

    assert.strictEqual(api.urls[0], 'https://api.jolpi.ca/ergast/f1/2021/results.json');
});

// --- standings --------------------------------------------------------------

function standings(kind, count) {
    const list = Array.from({ length: count }, (_, i) => ({ position: String(i + 1) }));
    return { MRData: { StandingsTable: { StandingsLists: [{ [kind]: list }] } } };
}

test('driver standings are capped at ten', async t => {
    clearCache();
    mockApi(t, () => jsonResponse(standings('DriverStandings', 22)));

    const top = await getDriverStandings();
    assert.strictEqual(top.length, 10);
    assert.strictEqual(top[0].position, '1');
});

test('constructor standings are capped at ten', async t => {
    clearCache();
    mockApi(t, () => jsonResponse(standings('ConstructorStandings', 11)));

    assert.strictEqual((await getConstructorStandings()).length, 10);
});

test('standings come back empty rather than throwing on a shape change', async t => {
    hushLogs(t);
    clearCache();
    mockApi(t, () => jsonResponse({ MRData: {} }));

    // The mirror has changed shape before. An empty list lets the command say
    // so; a TypeError here would reach the user as a generic command error.
    assert.deepStrictEqual(await getDriverStandings(), []);

    clearCache();
    assert.deepStrictEqual(await getConstructorStandings(), []);
});

test('standings come back empty when the request itself failed', async t => {
    hushLogs(t);
    clearCache();
    mockApi(t, () => jsonResponse({}, 503));

    assert.deepStrictEqual(await getDriverStandings(), []);
});

// --- next race --------------------------------------------------------------

function race(round, date, { time = '13:00:00Z', name = `Race ${round}` } = {}) {
    return {
        round: String(round),
        raceName: name,
        date,
        time,
        Circuit: { circuitId: 'monza', circuitName: 'Monza' }
    };
}

function calendar(...races) {
    return { MRData: { RaceTable: { Races: races } } };
}

test('the next race is the first one not already finished', async t => {
    clearCache();
    mockApi(t, () => jsonResponse(calendar(
        race(1, '2000-03-01'),
        race(2, '2099-05-01'),
        race(3, '2099-06-01')
    )));

    const next = await getNextRace();
    assert.strictEqual(next.round, '2');
    assert.strictEqual(next.circuit_id, 'monza');
});

test('a race still running counts as the next one', async t => {
    clearCache();

    // The 2.5-hour window exists so a race in progress stays on `.f1next`
    // instead of jumping to the following round mid-grand-prix.
    const startedAnHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const date = startedAnHourAgo.toISOString().slice(0, 10);
    const time = `${startedAnHourAgo.toISOString().slice(11, 19)}Z`;

    mockApi(t, () => jsonResponse(calendar(race(7, date, { time }))));

    const next = await getNextRace();
    assert.ok(next, 'a race that started an hour ago has not finished yet');
    assert.strictEqual(next.round, '7');
});

test('a season with nothing left reports nothing', async t => {
    clearCache();
    mockApi(t, () => jsonResponse(calendar(race(1, '2000-03-01'), race(2, '2000-04-01'))));

    assert.strictEqual(await getNextRace(), null);
});

test('next race is null rather than a throw when the feed is unusable', async t => {
    hushLogs(t);
    clearCache();
    mockApi(t, () => jsonResponse({ MRData: {} }));

    assert.strictEqual(await getNextRace(), null);
});

// --- race formatting --------------------------------------------------------

test('a race is formatted with its details and an IST timestamp', () => {
    const info = formatRaceInfo(race(5, '2099-07-04', { time: '13:00:00Z', name: 'British GP' }));

    assert.strictEqual(info.name, 'British GP');
    assert.strictEqual(info.circuit, 'Monza');
    assert.strictEqual(info.circuit_id, 'monza');
    assert.strictEqual(info.round, '5');
    assert.strictEqual(info.rawDate, '2099-07-04');
    assert.match(info.date, /IST$/);
});

test('a race with no listed time is still formatted', () => {
    // Some rounds appear on the calendar before a start time is published.
    const info = formatRaceInfo({
        round: '1',
        raceName: 'TBC GP',
        date: '2099-03-01',
        Circuit: { circuitId: 'monza', circuitName: 'Monza' }
    });

    assert.match(info.date, /IST$/);
    assert.strictEqual(info.rawDate, '2099-03-01');
});

test('an unparseable date falls back to the raw value instead of "Invalid Date"', () => {
    const info = formatRaceInfo({
        round: '1',
        raceName: 'Broken GP',
        date: 'not-a-date',
        Circuit: { circuitId: 'monza', circuitName: 'Monza' }
    });

    assert.strictEqual(info.date, 'not-a-date');
});

// --- circuit maps -----------------------------------------------------------

test('a known circuit maps to its track image', () => {
    const url = getCircuitImageUrl('silverstone');

    assert.match(url, /^https:\/\/media\.formula1\.com\//);
    assert.match(url, /Great_Britain_Circuit\.png$/);
});

test('an unknown circuit returns null and says which one is missing', t => {
    const warnings = [];
    t.mock.method(console, 'warn', msg => warnings.push(msg));

    // A newly added venue should drop the image, not show the wrong track.
    assert.strictEqual(getCircuitImageUrl('madring'), null);
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /madring/);
});

test('every mapped circuit builds a well-formed url', () => {
    // Guards against a typo in the mapping table turning into a broken embed.
    for (const id of ['bahrain', 'monaco', 'monza', 'suzuka', 'vegas', 'yas_marina']) {
        assert.match(getCircuitImageUrl(id), /^https:\/\/media\.formula1\.com\/.+\.png$/);
    }
});
