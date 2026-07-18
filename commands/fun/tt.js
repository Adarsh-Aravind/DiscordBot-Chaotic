const { isAuthorized } = require('../../utils/permissions');

// We point to the raw version of the upstream `preload.js` file, which contains the giant list of insults.
const rawUrl = "https://raw.githubusercontent.com/daviseford/trashtalk_generator/master/src/preload.js";
let cache = [];

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

// Function to fetch and cache the external insults
async function fetchInsults() {
    try {
        const res = await fetch(rawUrl);
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

        if (parsed.length > 0) {
            cache = parsed.map(applyFilter);
            console.log(`[TT Command] Loaded ${cache.length} insults from daviseford's repo!`);
        }
    } catch (error) {
        console.error(`[TT Command] Failed to fetch external insults: ${error.message}`);
    }
}

// Fetch immediately on startup
fetchInsults();

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
