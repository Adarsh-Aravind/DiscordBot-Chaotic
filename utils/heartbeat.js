const { Status } = require('discord.js');
const config = require('./config');

/**
 * Status heartbeat for the "Live Ops" panel on adarsharavind.com.
 *
 * Every minute the bot POSTs a small "I'm alive" ping to the ops-status server
 * on the home server. Pings are only sent while the gateway connection is Ready, so a
 * dropped connection reads as offline even though the process is still up.
 * Inert unless STATUS_HEARTBEAT_URL and STATUS_HEARTBEAT_TOKEN are set.
 */

const startedAt = new Date().toISOString();

let timer = null;
let failing = false;

/**
 * @param {import('discord.js').Client} client
 */
function buildPayload(client, { stopping = false } = {}) {
    const user = client.user;
    const guilds = [...client.guilds.cache.values()];
    const ping = client.ws.ping;

    return {
        id: config.status.botId,
        username: user?.username ?? null,
        avatar_url: user?.displayAvatarURL({ extension: 'png', size: 128 }) ?? null,
        guilds: guilds.length,
        members: guilds.reduce((sum, guild) => sum + (guild.memberCount || 0), 0),
        // ws.ping is -1 until the first heartbeat ack comes back.
        latency_ms: Number.isFinite(ping) && ping >= 0 ? Math.round(ping) : null,
        started_at: startedAt,
        stopping
    };
}

/**
 * @param {import('discord.js').Client} client
 * @param {{stopping?: boolean, timeoutMs?: number}} [options]
 */
async function post(client, { stopping = false, timeoutMs = 10_000 } = {}) {
    const res = await fetch(config.status.url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.status.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildPayload(client, { stopping })),
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function beat(client) {
    if (client.ws.status !== Status.Ready) return;

    try {
        await post(client);

        if (failing) {
            console.log('[heartbeat] recovered');
            failing = false;
        }
    } catch (error) {
        // Once per outage, not once a minute.
        if (!failing) {
            console.warn(`[heartbeat] failed: ${error.message}`);
            failing = true;
        }
    }
}

/**
 * One last ping saying this was deliberate.
 *
 * The payload has always carried a `stopping` field and nothing ever set it,
 * so the Live Ops panel could not tell a clean `pm2 restart` from a crash —
 * both just stopped arriving. Short timeout: a shutdown should not hang waiting
 * on a status server that is itself down.
 *
 * @param {import('discord.js').Client} client
 */
async function farewell(client) {
    stop();
    if (!config.status.enabled) return;

    try {
        await post(client, { stopping: true, timeoutMs: 2000 });
        console.log('[heartbeat] signed off');
    } catch (error) {
        console.warn(`[heartbeat] could not sign off: ${error.message}`);
    }
}

/**
 * @param {import('discord.js').Client} client
 */
function start(client) {
    if (timer) return;
    if (!config.status.enabled) {
        console.log('[heartbeat] disabled (STATUS_HEARTBEAT_URL / STATUS_HEARTBEAT_TOKEN not set)');
        return;
    }

    beat(client);
    timer = setInterval(() => beat(client), config.status.intervalMs);
    // Never the reason the process stays alive.
    timer.unref();
}

function stop() {
    clearInterval(timer);
    timer = null;
}

// `stop` stays internal — farewell() is the only caller, and it owns the
// ordering (stop the timer, then send the final ping).
module.exports = { start, farewell, buildPayload };
