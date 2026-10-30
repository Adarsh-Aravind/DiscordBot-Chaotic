const BASE_URL = 'https://api.jolpi.ca/ergast/f1/current';

// Ergast itself was retired at the end of 2024; api.jolpi.ca is the community
// mirror that replaced it. Every F1 command goes through fetchData, and none of
// this data changes more than once a race weekend, so an uncached `.f1` spam
// meant a burst of identical requests at a free, volunteer-run service.
const CACHE_TTL_MS = 10 * 60 * 1000;

// A hanging request used to hang the command with it — there was no timeout at
// all, so a stalled connection left the user staring at nothing indefinitely.
const REQUEST_TIMEOUT_MS = 10_000;

const cache = new Map();

// Requests in flight, keyed the same way. Three people running `.f1` at once
// should be one request, not three.
const inFlight = new Map();

async function request(url, endpoint) {
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'BitBot/1.0 (DiscordJS)' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.error(`Error fetching F1 data for ${endpoint}:`, e.message);
        return null;
    }
}

async function fetchData(endpoint) {
    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}/${endpoint}`;

    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

    // Join an identical request already on its way rather than starting another.
    const pending = inFlight.get(url);
    if (pending) return pending;

    const promise = request(url, endpoint).finally(() => inFlight.delete(url));
    inFlight.set(url, promise);

    const data = await promise;

    // Only cache a success. Caching a null would mean one blip left every F1
    // command broken for the next ten minutes.
    if (data !== null) cache.set(url, { at: Date.now(), data });

    return data;
}

/** Drop everything cached. Tests, and anything that wants a forced refresh. */
function clearCache() {
    cache.clear();
}

function getCircuitImageUrl(circuitId) {
    const baseUrl = 'https://media.formula1.com/image/upload/f_auto/q_auto/v1677244985/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9';
    const mapping = {
        bahrain: 'Bahrain_Circuit.png', jeddah: 'Saudi_Arabia_Circuit.png',
        albert_park: 'Australia_Circuit.png', suzuka: 'Japan_Circuit.png',
        shanghai: 'China_Circuit.png', miami: 'Miami_Circuit.png',
        imola: 'Emilia_Romagna_Circuit.png', monaco: 'Monaco_Circuit.png',
        villeneuve: 'Canada_Circuit.png', catalunya: 'Spain_Circuit.png',
        red_bull_ring: 'Austria_Circuit.png', silverstone: 'Great_Britain_Circuit.png',
        hungaroring: 'Hungary_Circuit.png', spa: 'Belgium_Circuit.png',
        zandvoort: 'Netherlands_Circuit.png', monza: 'Italy_Circuit.png',
        baku: 'Baku_Circuit.png', marina_bay: 'Singapore_Circuit.png',
        americas: 'USA_Circuit.png', rodriguez: 'Mexico_Circuit.png',
        interlagos: 'Brazil_Circuit.png', vegas: 'Las_Vegas_Circuit.png',
        losail: 'Qatar_Circuit.png', yas_marina: 'Abu_Dhabi_Circuit.png'
    };
    // Unknown circuit (e.g. a newly added venue like madring/Madrid): return null
    // so the embed simply omits the image, rather than showing the wrong track.
    if (!mapping[circuitId]) {
        console.warn(`[F1] No circuit map image for "${circuitId}" — add it to f1Helper.js`);
        return null;
    }
    return `${baseUrl}/${mapping[circuitId]}`;
}

async function getDriverStandings() {
    const data = await fetchData('driverStandings.json');
    try { return data.MRData.StandingsTable.StandingsLists[0].DriverStandings.slice(0, 10); } 
    catch { return []; }
}

async function getConstructorStandings() {
    const data = await fetchData('constructorStandings.json');
    try { return data.MRData.StandingsTable.StandingsLists[0].ConstructorStandings.slice(0, 10); } 
    catch { return []; }
}

async function getNextRace() {
    const data = await fetchData('races.json');
    try {
        const races = data.MRData.RaceTable.Races;
        const now = new Date();
        for (const race of races) {
            const utcTimeStr = `${race.date}T${race.time || '00:00:00Z'}`;
            const raceEnd = new Date(new Date(utcTimeStr).getTime() + (2.5 * 60 * 60 * 1000));
            if (now < raceEnd) {
                return formatRaceInfo(race);
            }
        }
        return null;
    } catch { return null; }
}

function formatRaceInfo(race) {
    const utcTimeStr = `${race.date}T${race.time || '00:00:00Z'}`;
    const dateObj = new Date(utcTimeStr);
    let dateStr = race.date;
    if (!isNaN(dateObj.getTime())) {
        dateStr = dateObj.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'long', timeStyle: 'short' }) + ' IST';
    }
    return {
        name: race.raceName,
        circuit: race.Circuit.circuitName,
        circuit_id: race.Circuit.circuitId,
        date: dateStr,
        round: race.round,
        rawDate: race.date
    };
}

module.exports = {
    fetchData,
    clearCache,
    CACHE_TTL_MS,
    getCircuitImageUrl,
    getDriverStandings,
    getConstructorStandings,
    getNextRace,
    formatRaceInfo
};
