// Deafen shame board: how long everyone spends deafened in voice, and a
// periodic ranking of the worst offenders.
//
// Two counters per person. `ms` is all-time and never resets; `periodMs` covers
// the stretch since the last ranking went out and is zeroed when one does, so
// the weekly post means "this week" rather than "since the bot was born".

const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const config = require('./config');

const STATE_FILE = config.deafenBoard.stateFile;

// Stints still running, in memory only: { userId -> { since, name } }.
const open = new Map();

let timer = null;

// --- state persistence -----------------------------------------------------

function loadState() {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        return { totals: saved.totals || {}, lastPostedAt: saved.lastPostedAt || 0 };
    } catch {
        return { totals: {}, lastPostedAt: 0 };
    }
}

function saveState(state) {
    try {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
        console.error('[Deafen] Could not save stats:', err.message);
    }
}

// --- tracking --------------------------------------------------------------

function displayName(voiceState) {
    return voiceState?.member?.displayName || voiceState?.member?.user?.username || null;
}

/** Bank a finished stint. Short ones are a fumbled hotkey, not an insult. */
function close(userId) {
    const session = open.get(userId);
    if (!session) return;
    open.delete(userId);

    const elapsed = Date.now() - session.since;
    if (elapsed < config.deafenBoard.minSessionMs) return;

    const state = loadState();
    const entry = state.totals[userId] || { name: session.name, ms: 0, periodMs: 0 };
    entry.ms = (entry.ms || 0) + elapsed;
    entry.periodMs = (entry.periodMs || 0) + elapsed;
    if (session.name) entry.name = session.name;
    state.totals[userId] = entry;
    saveState(state);
}

/**
 * Feed every voiceStateUpdate through here. Derived from the new state alone,
 * so it's idempotent — a repeated or missed event can't double-count.
 * @param {import('discord.js').VoiceState} voiceState
 */
function handle(voiceState) {
    if (!config.deafenBoard.enabled) return;

    const userId = voiceState?.id;
    if (!userId) return;
    if (voiceState.member?.user?.bot) return;

    if (voiceState.channelId && voiceState.deaf) {
        if (!open.has(userId)) {
            open.set(userId, { since: Date.now(), name: displayName(voiceState) });
        }
        return;
    }

    close(userId);
}

// --- reporting -------------------------------------------------------------

function formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/**
 * Ranked worst-first. Stints still running are folded in at their current
 * length without being closed, so the board reads as live.
 * @param {'ms'|'periodMs'} field
 */
function leaderboard(field = 'periodMs') {
    const state = loadState();
    const now = Date.now();
    const rows = new Map();

    for (const [userId, entry] of Object.entries(state.totals)) {
        rows.set(userId, { userId, name: entry.name, ms: entry[field] || 0 });
    }

    for (const [userId, session] of open) {
        const row = rows.get(userId) || { userId, name: session.name, ms: 0 };
        row.ms += now - session.since;
        if (session.name) row.name = session.name;
        rows.set(userId, row);
    }

    return [...rows.values()].filter(row => row.ms > 0).sort((a, b) => b.ms - a.ms);
}

function buildEmbed(rows, { allTime = false } = {}) {
    const top = rows.slice(0, config.deafenBoard.topN);
    const medals = ['🥇', '🥈', '🥉'];

    const lines = top.length
        ? top.map((row, i) => {
            const rank = medals[i] || `**${i + 1}.**`;
            return `${rank} <@${row.userId}> — ${formatDuration(row.ms)}`;
        }).join('\n')
        : '*Nobody ignored anybody. Suspicious.*';

    return new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(allTime ? '🔇 Deafened — all time' : '🔇 Who ignored us hardest')
        .setDescription(lines)
        .setFooter({
            text: allTime
                ? 'Total time spent deafened in voice.'
                : 'Time spent deafened since the last ranking.'
        })
        .setTimestamp();
}

/** Post the ranking and start a fresh period. */
async function postBoard(client) {
    const target = await client.channels
        .fetch(config.deafenBoard.announceChannelId)
        .catch(() => null);

    if (!target) {
        console.error(`[Deafen] Announce channel ${config.deafenBoard.announceChannelId} not found.`);
        return false;
    }

    const rows = leaderboard('periodMs');
    await target.send({ embeds: [buildEmbed(rows)], allowedMentions: { parse: [] } });

    // Bank every stint still running first, so all-time keeps those minutes,
    // then zero only the period counter and restart the open stints from now.
    // Rewinding `since` without banking would quietly lose the time from the
    // all-time total as well.
    const running = new Map([...open].map(([userId, session]) => [userId, session.name]));
    for (const userId of running.keys()) close(userId);

    const state = loadState();
    for (const entry of Object.values(state.totals)) entry.periodMs = 0;
    state.lastPostedAt = Date.now();
    saveState(state);

    const restartedAt = Date.now();
    for (const [userId, name] of running) {
        open.set(userId, { since: restartedAt, name });
    }

    console.log(`[Deafen] Posted the ranking (${rows.length} on the board).`);
    return true;
}

// --- lifecycle -------------------------------------------------------------

/**
 * Pick up anyone already sitting deafened when the bot booted.
 * voiceStateUpdate only fires on changes, so without this their current stint
 * doesn't start counting until they touch something.
 * @param {import('discord.js').Client} client
 */
function syncAll(client) {
    if (!config.deafenBoard.enabled) return;

    for (const guild of client.guilds.cache.values()) {
        for (const voiceState of guild.voiceStates.cache.values()) {
            handle(voiceState);
        }
    }
}

function start(client) {
    if (!config.deafenBoard.enabled) {
        console.log('[Deafen] Shame board disabled.');
        return;
    }
    if (timer) return;

    // First boot: start the clock now rather than treating epoch 0 as "overdue"
    // and firing a ranking at nobody the moment the bot comes up.
    const state = loadState();
    if (!state.lastPostedAt) {
        state.lastPostedAt = Date.now();
        saveState(state);
    }

    const tick = () => {
        const { lastPostedAt } = loadState();
        if (Date.now() - lastPostedAt < config.deafenBoard.postIntervalMs) return;
        postBoard(client).catch(err => console.error('[Deafen] Could not post:', err.message));
    };

    timer = setInterval(tick, config.deafenBoard.checkIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();

    console.log(
        `[Deafen] Tracking deafened time; ranking every ` +
        `${Math.round(config.deafenBoard.postIntervalMs / 3600000)}h in ${config.deafenBoard.announceChannelId}.`
    );
}

function stop() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

/** Drop in-memory stints. Tests only. */
function reset() {
    open.clear();
}

module.exports = {
    handle,
    syncAll,
    start,
    stop,
    postBoard,
    leaderboard,
    buildEmbed,
    formatDuration,
    reset,
    STATE_FILE
};
