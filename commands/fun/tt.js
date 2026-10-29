const path = require('path');
const { readJson } = require('../../utils/jsonStore');

// The insult list ships with the bot, in assets/trashtalk.json — 778 lines
// snapshotted from daviseford/trashtalk_generator and run through the filter
// below once.
//
// It used to be fetched from that repo's master branch on every boot, which
// made a third party's branch a live dependency of startup: the list could
// change under us without warning, and a network blip at boot cost us the list
// for the whole run. `.tt reload` still pulls the latest on demand, so nothing
// is lost — it's just no longer on the startup path.
const VENDORED = path.join(__dirname, '..', '..', 'assets', 'trashtalk.json');

const rawUrl = 'https://raw.githubusercontent.com/daviseford/trashtalk_generator/master/src/preload.js';

const REQUEST_TIMEOUT_MS = 10_000;

// Fallback lists in case the vendored file is missing too.
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

/**
 * Pull the strings out of the upstream file.
 *
 * It's a JS module exporting an array of strings, so the strings are extracted
 * with a regex rather than by running it — nothing from the network is ever
 * evaluated.
 *
 * @param {string} source
 * @returns {string[]}
 */
function extractInsults(source) {
    const parsed = [];
    const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
    let match;

    while ((match = regex.exec(source)) !== null) {
        const str = (match[1] || match[2] || '').trim();

        // Skip the file's own code strings. An insult is a sentence, so it has
        // a space in it and never looks like a module path — but a directive
        // like 'use strict' passes both of those, so it is excluded by name.
        const isCode =
            str.includes('use strict') ||
            str.includes('require') ||
            str.startsWith('./');

        if (str.length > 5 && str.includes(' ') && !isCode) {
            parsed.push(str);
        }
    }

    return [...new Set(parsed)];
}

// Loaded from disk at require time. No network, so startup can't fail here.
let cache = readJson(VENDORED, [], 'TT Command').map(applyFilter);
console.log(`[TT Command] Loaded ${cache.length} insults from assets/trashtalk.json.`);

/** Refresh from upstream. Only ever called by `.tt reload`. */
async function fetchInsults() {
    try {
        const res = await fetch(rawUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const parsed = extractInsults(await res.text());
        if (parsed.length === 0) throw new Error('no insults found in the upstream file');

        cache = parsed.map(applyFilter);
        console.log(`[TT Command] Reloaded ${cache.length} insults from upstream.`);
        return true;
    } catch (error) {
        // A failed fetch() reads as a bare "fetch failed" without the cause.
        const reason = error.cause?.message ? `${error.message} (${error.cause.message})` : error.message;
        console.error(`[TT Command] Reload failed: ${reason}`);
        return false;
    }
}

module.exports = {
    name: 'tt',
    guildOnly: true,
    restricted: true,
    description: 'CS:GO/Valorant trash talk. Usage: .tt | .tt reload',
    extractInsults,
    applyFilter,
    async execute(message, args) {
        if (args.length > 0 && args[0].toLowerCase() === 'reload') {
            await message.reply('Pulling the latest insults from the upstream repo...');
            const ok = await fetchInsults();
            return message.reply(
                ok
                    ? `Reload complete. Cache size: ${cache.length} insults loaded.`
                    : `Reload failed — still on the ${cache.length} that shipped with the bot.`
            );
        }

        let winInsult = '';
        let lossInsult = '';

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
