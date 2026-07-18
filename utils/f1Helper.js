const { EmbedBuilder } = require('discord.js');

const BASE_URL = 'https://api.jolpi.ca/ergast/f1/current';

async function fetchData(endpoint) {
    try {
        const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}/${endpoint}`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'BitBot/1.0 (DiscordJS)' }
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.error(`Error fetching F1 data for ${endpoint}:`, e);
        return null;
    }
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
    getCircuitImageUrl,
    getDriverStandings,
    getConstructorStandings,
    getNextRace,
    formatRaceInfo
};
