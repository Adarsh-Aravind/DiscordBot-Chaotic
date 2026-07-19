const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const config = require('./config');

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX_URL = 'https://api.twitch.tv/helix';
const STATE_FILE = path.join(__dirname, '..', 'data', 'twitch-live.json');

let timer = null;

// App access token, cached in memory. Twitch gives these ~60 days, but we
// refresh on expiry (and on any 401) rather than trusting the clock.
let token = null;
let tokenExpiresAt = 0;

// --- state persistence -----------------------------------------------------

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveState(state) {
    try {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
        console.error('[Twitch] Could not save state:', err.message);
    }
}

// --- api -------------------------------------------------------------------

async function getToken(force = false) {
    if (!force && token && Date.now() < tokenExpiresAt) return token;

    const params = new URLSearchParams({
        client_id: config.twitch.clientId,
        client_secret: config.twitch.clientSecret,
        grant_type: 'client_credentials'
    });

    const response = await fetch(`${TOKEN_URL}?${params}`, { method: 'POST' });
    if (!response.ok) {
        throw new Error(`token request returned HTTP ${response.status}`);
    }

    const body = await response.json();
    token = body.access_token;
    // Refresh a minute early so a check never races the expiry.
    tokenExpiresAt = Date.now() + (body.expires_in * 1000) - 60_000;
    return token;
}

async function helix(endpoint, params) {
    const url = `${HELIX_URL}/${endpoint}?${params}`;

    const call = async () => fetch(url, {
        headers: {
            'Client-ID': config.twitch.clientId,
            Authorization: `Bearer ${await getToken()}`
        }
    });

    let response = await call();

    // A revoked or stale token reads as 401 — force a fresh one and retry once.
    if (response.status === 401) {
        await getToken(true);
        response = await call();
    }

    if (!response.ok) {
        throw new Error(`${endpoint} returned HTTP ${response.status}`);
    }
    return (await response.json()).data || [];
}

/** Live streams among the watched logins. Offline streamers are simply absent. */
function fetchLiveStreams(logins) {
    const params = new URLSearchParams();
    for (const login of logins) params.append('user_login', login);
    return helix('streams', params);
}

/** Profile images, keyed by lowercase login, for prettier embeds. */
async function fetchUsers(logins) {
    const params = new URLSearchParams();
    for (const login of logins) params.append('login', login);

    const users = await helix('users', params);
    return Object.fromEntries(users.map(u => [u.login.toLowerCase(), u]));
}

// --- announcing ------------------------------------------------------------

function buildEmbed(stream, user) {
    // Thumbnails come as a template with {width}/{height} placeholders.
    const thumbnail = stream.thumbnail_url
        .replace('{width}', '1280')
        .replace('{height}', '720');

    const embed = new EmbedBuilder()
        .setColor('#9146FF')
        .setAuthor({
            name: `${stream.user_name} is live on Twitch!`,
            iconURL: user?.profile_image_url
        })
        .setTitle(stream.title || 'Untitled stream')
        .setURL(`https://www.twitch.tv/${stream.user_login}`)
        // Twitch caches thumbnails hard; the query param busts it per go-live.
        .setImage(`${thumbnail}?t=${stream.id}`)
        .setTimestamp(stream.started_at ? new Date(stream.started_at) : new Date());

    if (stream.game_name) {
        embed.addFields({ name: 'Playing', value: stream.game_name, inline: true });
    }

    return embed;
}

/**
 * Check every watched streamer once and announce anyone who just went live.
 * @param {import('discord.js').Client} client
 * @returns {Promise<{posted: number, live: number, errors: string[]}>}
 */
async function checkOnce(client) {
    const result = { posted: 0, live: 0, errors: [] };

    const { logins, announceChannelId } = config.twitch;
    if (logins.length === 0) return result;

    const target = await client.channels.fetch(announceChannelId).catch(() => null);
    if (!target) {
        result.errors.push(`announce channel ${announceChannelId} not found or not visible`);
        console.error(`[Twitch] Announce channel ${announceChannelId} not found.`);
        return result;
    }

    let streams;
    try {
        streams = await fetchLiveStreams(logins);
    } catch (err) {
        result.errors.push(err.message);
        console.error(`[Twitch] Failed to fetch streams: ${err.message}`);
        return result;
    }
    result.live = streams.length;

    const state = loadState();
    let stateChanged = false;

    // Only look up profiles when there's actually something to announce.
    const fresh = streams.filter(s => state[s.user_login.toLowerCase()]?.streamId !== s.id);
    let users = {};
    if (fresh.length > 0) {
        try {
            users = await fetchUsers(fresh.map(s => s.user_login));
        } catch (err) {
            // Not fatal — the embed just loses its avatar.
            console.error(`[Twitch] Could not fetch profiles: ${err.message}`);
        }
    }

    for (const stream of fresh) {
        const login = stream.user_login.toLowerCase();
        try {
            await target.send({
                content: `@everyone 🔴 **${stream.user_name}** is live on Twitch!\nhttps://www.twitch.tv/${stream.user_login}`,
                embeds: [buildEmbed(stream, users[login])],
                // Explicit, so the ping can't be widened by a stream title that
                // happens to contain a mention.
                allowedMentions: { parse: ['everyone'] }
            });
            result.posted++;
            console.log(`[Twitch] Announced ${stream.user_name} — "${stream.title}".`);
        } catch (err) {
            result.errors.push(`posting ${login}: ${err.message}`);
            console.error(`[Twitch] Failed to post ${login}: ${err.message}`);
            // Leave state alone so the next check retries this one.
            continue;
        }

        // Keyed by stream id, so a restart mid-stream stays quiet but a genuine
        // new stream (new id) still announces, even back-to-back on the same day.
        state[login] = {
            name: stream.user_name,
            streamId: stream.id,
            startedAt: stream.started_at
        };
        stateChanged = true;
    }

    // Drop anyone who's gone offline so their next go-live is a clean slate.
    const liveLogins = new Set(streams.map(s => s.user_login.toLowerCase()));
    for (const login of Object.keys(state)) {
        if (!liveLogins.has(login)) {
            delete state[login];
            stateChanged = true;
        }
    }

    if (stateChanged) saveState(state);
    return result;
}

function start(client) {
    if (!config.twitch.enabled) {
        console.log('[Twitch] Watcher disabled (missing client id/secret, logins, or announce channel).');
        return;
    }
    if (timer) return;

    const runCheck = () => {
        checkOnce(client).catch(err => console.error('[Twitch] Check failed:', err));
    };

    console.log(
        `[Twitch] Watching ${config.twitch.logins.join(', ')}, ` +
        `posting to ${config.twitch.announceChannelId}, every ${config.twitch.pollIntervalMs / 60000} min.`
    );

    runCheck();
    timer = setInterval(runCheck, config.twitch.pollIntervalMs);
    // Don't hold the process open just for this timer.
    if (typeof timer.unref === 'function') timer.unref();
}

function stop() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

module.exports = { start, stop, checkOnce, loadState };
