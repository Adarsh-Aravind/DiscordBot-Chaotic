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
function buildPayload(client) {
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
        stopping: false
    };
}

async function beat(client) {
    if (client.ws.status !== Status.Ready) return;

    try {
        const res = await fetch(config.status.url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.status.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(buildPayload(client)),
            signal: AbortSignal.timeout(10_000)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

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

module.exports = { start, stop, buildPayload };
