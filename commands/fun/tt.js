const { setTimeout: sleep } = require('node:timers/promises');
const { isAuthorized } = require('../../utils/permissions');

// We point to the raw version of the upstream `preload.js` file, which contains the giant list of insults.
const rawUrl = "https://raw.githubusercontent.com/daviseford/trashtalk_generator/master/src/preload.js";
let cache = [];

const REQUEST_TIMEOUT_MS = 10_000;
// A boot while the network is still down would otherwise leave the cache empty
// until someone ran `.tt reload` by hand.
const STARTUP_ATTEMPTS = 3;
const STARTUP_RETRY_DELAY_MS = 30_000;

// Fallback lists in case the URL goes down
const fallbackWin = [
    "Nice precise gunplay kid, your Vandal spray is more randomized than your family tree, fk-ing silver trash dog relying on utility.",
    "Sit down kid, your reaction time is worse than my ping, absolute trash bag bottom frag relying on fk-ing utility instead of aim, ez."
];

const fallbackLoss = [
    "Only reason you won is because of fk-ing precise gunplay RNG and shooting through Sage walls like a lucky dog, sit down kid.",
    "Nice RNG kid, imagine needing fk-ing luck and broken Sage walls to win against a god, your aim is dog but your luck is carrying you, silver trash."
];

// Translates CS:GO terms from the dataset into Valorant terms, and applies the toxicity filter
function applyFilter(text) {
    let filtered = text.replace(/fuck/gi, 'fk').replace(/fucking/gi, 'fking');
    
    // Valorant-specific translations
    filtered = filtered.replace(/\bCS:?GO\b/gi, 'Valorant');
    filtered = filtered.replace(/\bGlobal\s?Elite\b/gi, 'Radiant');
    filtered = filtered.replace(/\bSilver\b/gi, 'Iron');
    filtered = filtered.replace(/\bAWP\b/gi, 'Operator');
    filtered = filtered.replace(/\bAK-?47\b/gi, 'Vandal');
    filtered = filtered.replace(/\bAK\b/g, 'Vandal');
    filtered = filtered.replace(/\bM4A1?-?S?\b/gi, 'Phantom');
    filtered = filtered.replace(/\bbomb\b/gi, 'spike');
    filtered = filtered.replace(/\bVAC\b/gi, 'Vanguard');
    filtered = filtered.replace(/\bflashbang\b/gi, 'flash');
    filtered = filtered.replace(/\bterrorist(s)?\b/gi, 'attacker$1');
    filtered = filtered.replace(/\bcounter-?terrorist(s)?\b/gi, 'defender$1');

    return filtered;
}

// Function to fetch and cache the external insults. Returns whether the cache
// was filled, so the startup retry knows when to stop.
async function fetchInsults() {
    try {
        const res = await fetch(rawUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const dataText = await res.text();
        
        // This file is actually a Javascript file exporting an array of strings: `module.exports = [ "str1", "str2" ]`
        // We can safely extract all the strings out of it using a Regex without running arbitrary code!
        const parsed = [];
        const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
        let match;
        
        while ((match = regex.exec(dataText)) !== null) {
            const str = match[1] || match[2];
            // Filter out any small code-related strings just in case
            if (str && str.length > 5 && !str.includes('use strict') && !str.includes('require')) {
                parsed.push(str);
            }
        }

        if (parsed.length === 0) throw new Error('no insults found in the upstream file');

        cache = parsed.map(applyFilter);
        console.log(`[TT Command] Loaded ${cache.length} insults from daviseford's repo!`);
        return true;
    } catch (error) {
        // A failed fetch() reads as a bare "fetch failed" without the cause.
        const reason = error.cause?.message ? `${error.message} (${error.cause.message})` : error.message;
        console.error(`[TT Command] Failed to fetch external insults: ${reason}`);
        return false;
    }
}

// Fetch on startup, retrying a few times so a network blip at boot does not cost
// us the list for the rest of the run.
(async () => {
    for (let attempt = 1; attempt <= STARTUP_ATTEMPTS; attempt++) {
        if (await fetchInsults()) return;
        // { ref: false } so a pending retry is never what keeps the process alive.
        if (attempt < STARTUP_ATTEMPTS) await sleep(STARTUP_RETRY_DELAY_MS, undefined, { ref: false });
    }
    console.warn('[TT Command] Giving up for now — .tt will use the built-in fallbacks until someone runs `.tt reload`.');
})();

module.exports = {
    name: 'tt',
    guildOnly: true,
    restricted: true,
    description: 'External Scraped Trash Talk. Usage: .tt | .tt reload',
    async execute(message, args) {
        if (!isAuthorized(message)) {
            return message.reply("Sit down kid, you don't have permission for this.");
        }

        if (args.length > 0 && args[0].toLowerCase() === 'reload') {
            await message.reply("Fetching latest insults from the Daviseford repo...");
            await fetchInsults();
            return message.reply(`Reload complete. Cache size: ${cache.length} insults loaded.`);
        }

        let winInsult = "";
        let lossInsult = "";

        // If we have externally fetched insults stored in the cache, use them!
        if (cache.length >= 2) {
            const index1 = Math.floor(Math.random() * cache.length);
            let index2 = Math.floor(Math.random() * cache.length);
            while (index2 === index1) index2 = Math.floor(Math.random() * cache.length);
            
            winInsult = cache[index1];
            lossInsult = cache[index2];
        } else {
            // Fallbacks
            winInsult = fallbackWin[Math.floor(Math.random() * fallbackWin.length)];
            lossInsult = fallbackLoss[Math.floor(Math.random() * fallbackLoss.length)];
        }

        return message.reply(`**Win:** ${winInsult}\n**Loss:** ${lossInsult}`);
    },
};
