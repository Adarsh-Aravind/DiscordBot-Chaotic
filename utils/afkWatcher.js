// Auto-AFK: park one specific user in the AFK channel once they have been
// deafened for a stretch. Only ever one watched user, so this is a single
// module-level timer rather than a Map.

const config = require('./config');
const stateManager = require('./stateManager');

let timer = null;

function cancel(reason) {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    console.log(`[AFK] Countdown cancelled — ${reason}.`);
}

/**
 * Should the countdown be running for this voice state?
 *
 * `deaf` is true for a self-deafen and for a moderator's server-deafen; both
 * mean the person isn't listening, which is the thing being acted on.
 *
 * @param {import('discord.js').VoiceState} [voiceState]
 */
function shouldCountDown(voiceState) {
    if (!voiceState?.channelId) return false;                       // not in voice
    if (!voiceState.deaf) return false;                             // listening
    if (voiceState.channelId === config.afk.channelId) return false; // already parked
    // The AFK channel lives in one guild; don't touch them anywhere else.
    if (!voiceState.guild?.channels?.cache?.has(config.afk.channelId)) return false;
    // `.drag` is actively moving them — two features fighting over the same
    // member every couple of seconds helps nobody.
    if (stateManager.has(config.afk.userId)) return false;
    return true;
}

/** Move them, if the reason to is still true now that the wait is over. */
async function park(guild) {
    const current = guild.voiceStates.cache.get(config.afk.userId);
    if (!shouldCountDown(current)) return;

    const member = current.member || await guild.members.fetch(config.afk.userId).catch(() => null);
    if (!member) {
        console.error('[AFK] Could not resolve the member to move.');
        return;
    }

    await member.voice.setChannel(config.afk.channelId);
    console.log(
        `[AFK] Moved ${member.user?.tag || config.afk.userId} to the AFK channel ` +
        `after ${config.afk.deafenGraceMs / 1000}s deafened.`
    );
}

function schedule(guild) {
    timer = setTimeout(() => {
        timer = null;
        park(guild).catch(err => console.error('[AFK] Could not move them:', err.message));
    }, config.afk.deafenGraceMs);

    // Don't hold the process open just for this timer.
    if (typeof timer.unref === 'function') timer.unref();

    console.log(`[AFK] Deafened — parking in ${config.afk.deafenGraceMs / 1000}s unless they undeafen.`);
}

/**
 * Feed every voiceStateUpdate through here.
 * @param {import('discord.js').VoiceState} voiceState the new state
 */
function handle(voiceState) {
    if (!config.afk.enabled) return;
    if (voiceState?.id !== config.afk.userId) return;

    if (shouldCountDown(voiceState)) {
        // Already counting: leave it alone. Restarting here would mean any
        // unrelated voice update — muting, someone else joining, a channel
        // move — resets the clock, and they'd never actually get parked.
        if (!timer) schedule(voiceState.guild);
        return;
    }

    cancel(voiceState.channelId ? 'no longer deafened, or already parked' : 'left voice');
}

/**
 * Catch up on startup: voiceStateUpdate only fires on changes, so someone who
 * was already deafened when the bot booted would otherwise sit there forever.
 * @param {import('discord.js').Client} client
 */
function syncAll(client) {
    if (!config.afk.enabled) {
        console.log('[AFK] Auto-AFK disabled.');
        return;
    }

    for (const guild of client.guilds.cache.values()) {
        const voiceState = guild.voiceStates.cache.get(config.afk.userId);
        if (voiceState) handle(voiceState);
    }

    console.log(
        `[AFK] Watching ${config.afk.userId}; ` +
        `${config.afk.deafenGraceMs / 1000}s deafened means a trip to ${config.afk.channelId}.`
    );
}

/** Drop any pending countdown. */
function stop() {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
}

module.exports = { handle, syncAll, stop, shouldCountDown };
