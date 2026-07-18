const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const config = require('./config');

const FEED_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const STATE_FILE = path.join(__dirname, '..', 'data', 'youtube-seen.json');

// Keep the most recent N video ids per channel. The feed only ever returns 15,
// so 30 is plenty of history to recognise anything that could still show up.
const SEEN_LIMIT = 30;

// If the bot was offline a while, don't dump a wall of videos into the channel.
const MAX_ANNOUNCEMENTS_PER_CHECK = 3;

let timer = null;

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
        console.error('[YouTube] Could not save state:', err.message);
    }
}

// --- feed parsing ----------------------------------------------------------

function decodeEntities(str) {
    return str
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        // Ampersand last, so "&amp;lt;" doesn't become "<".
        .replace(/&amp;/g, '&');
}

function tag(source, name) {
    const match = source.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
    return match ? decodeEntities(match[1].trim()) : null;
}

/**
 * Parse a YouTube channel RSS feed into entries, newest first.
 */
function parseFeed(xml) {
    const channelName = tag(xml.split('<entry>')[0], 'title') || 'YouTube';

    const entries = xml
        .split('<entry>')
        .slice(1)
        .map(chunk => {
            const videoId = tag(chunk, 'yt:videoId');
            if (!videoId) return null;
            return {
                videoId,
                title: tag(chunk, 'title') || 'Untitled',
                author: tag(chunk, 'name') || channelName,
                published: tag(chunk, 'published'),
                url: `https://www.youtube.com/watch?v=${videoId}`,
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
            };
        })
        .filter(Boolean);

    return { channelName, entries };
}

async function fetchFeed(channelId) {
    const response = await fetch(FEED_URL + channelId, {
        headers: { 'User-Agent': 'ChaoticBot/1.0 (DiscordJS)' }
    });
    if (!response.ok) {
        throw new Error(`feed returned HTTP ${response.status}`);
    }
    return parseFeed(await response.text());
}

// --- announcing ------------------------------------------------------------

function buildEmbed(entry) {
    return new EmbedBuilder()
        .setColor('#FF0000')
        .setAuthor({ name: `${entry.author} uploaded a new video` })
        .setTitle(entry.title)
        .setURL(entry.url)
        .setImage(entry.thumbnail)
        .setTimestamp(entry.published ? new Date(entry.published) : new Date());
}

/**
 * Check every watched channel once and post anything new.
 * @param {import('discord.js').Client} client
 * @param {object} [options]
 * @param {boolean} [options.announceFirstRun] Post on a channel's very first check.
 * @returns {Promise<{posted: number, checked: number, errors: string[]}>}
 */
async function checkOnce(client, { announceFirstRun = false } = {}) {
    const result = { posted: 0, checked: 0, errors: [] };

    const channelIds = config.youtube.channelIds;
    if (channelIds.length === 0) return result;

    const target = await client.channels.fetch(config.youtube.announceChannelId).catch(() => null);
    if (!target) {
        result.errors.push(`announce channel ${config.youtube.announceChannelId} not found or not visible`);
        console.error(`[YouTube] Announce channel ${config.youtube.announceChannelId} not found.`);
        return result;
    }

    const state = loadState();
    let stateChanged = false;

    for (const channelId of channelIds) {
        let feed;
        try {
            feed = await fetchFeed(channelId);
            result.checked++;
        } catch (err) {
            result.errors.push(`${channelId}: ${err.message}`);
            console.error(`[YouTube] Failed to fetch ${channelId}: ${err.message}`);
            continue;
        }

        const entry = state[channelId];
        const seen = new Set(entry?.seen || []);
        const isFirstRun = !entry;

        // Newest-first from the feed; announce oldest-first so they read in order.
        const fresh = feed.entries.filter(e => !seen.has(e.videoId)).reverse();

        if (isFirstRun && !announceFirstRun) {
            // Seed silently so we don't announce the whole existing back catalogue.
            console.log(`[YouTube] Tracking "${feed.channelName}" (${feed.entries.length} existing videos seeded).`);
        } else if (fresh.length > 0) {
            const toPost = fresh.slice(-MAX_ANNOUNCEMENTS_PER_CHECK);
            const skipped = fresh.length - toPost.length;
            if (skipped > 0) {
                console.log(`[YouTube] ${feed.channelName}: ${skipped} older video(s) skipped to avoid spam.`);
            }

            for (const video of toPost) {
                try {
                    await target.send({
                        content: `📺 **${video.author}** just uploaded!\n${video.url}`,
                        embeds: [buildEmbed(video)]
                    });
                    result.posted++;
                    console.log(`[YouTube] Announced "${video.title}" by ${video.author}.`);
                } catch (err) {
                    result.errors.push(`posting ${video.videoId}: ${err.message}`);
                    console.error(`[YouTube] Failed to post ${video.videoId}: ${err.message}`);
                }
            }
        }

        // Record everything we saw, announced or not, so it never repeats.
        const updatedSeen = [...feed.entries.map(e => e.videoId), ...(entry?.seen || [])];
        state[channelId] = {
            name: feed.channelName,
            seen: [...new Set(updatedSeen)].slice(0, SEEN_LIMIT),
            lastCheck: new Date().toISOString()
        };
        stateChanged = true;
    }

    if (stateChanged) saveState(state);
    return result;
}

function start(client) {
    if (!config.youtube.enabled) {
        console.log('[YouTube] Watcher disabled (no channel ids or no announce channel configured).');
        return;
    }
    if (timer) return;

    const runCheck = () => {
        checkOnce(client).catch(err => console.error('[YouTube] Check failed:', err));
    };

    console.log(
        `[YouTube] Watching ${config.youtube.channelIds.length} channel(s), ` +
        `posting to ${config.youtube.announceChannelId}, every ${config.youtube.pollIntervalMs / 60000} min.`
    );

    runCheck();
    timer = setInterval(runCheck, config.youtube.pollIntervalMs);
    // Don't hold the process open just for this timer.
    if (typeof timer.unref === 'function') timer.unref();
}

function stop() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

module.exports = { start, stop, checkOnce, parseFeed, loadState };
