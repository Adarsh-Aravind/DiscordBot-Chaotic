# Chaotic Discord Bot

A modular, production-ready Discord bot built with Node.js and discord.js v14.

## Features

### Core Functionality
- Modular command and event architecture
- Clean separation of concerns for scalability and maintenance
- All server-specific IDs live in `utils/config.js`, overridable via `.env`
- Commands can declare `guildOnly` and `restricted` flags, enforced centrally

### Fun Commands
- `.meme` - Fetches a random meme from meme-api
- `.roast` - Roast system with user targeting. Pulls from a 100+ line pool and
  never repeats until the whole pool has been used, tracked per server.
- `.tt` - Role-restricted CS:GO / Valorant toxic trash talk generator (fetches dynamically from external repo) 🔒
- `.quote` - Generates a styled image quote of the replied message
- `.forget` - Clears conversation history with Riri for the user
- `.gay [@user]` - Dynamically toggle reaction targets

### Moderation Tools
- `.ban`, `.kick`, `.mute` (timeouts), `.role` 🔒
- `.say [#channel] <message>` - Says something as the bot into a channel 🔒

### F1 Commands (Ergast API Integration)
- `.f1` - Current season Drivers/Constructors and Next Race summary.
- `.f1next` - Detailed next race and circuit info.
- `.f1last` - Last completed race results and podium.
- `.f1dri` / `.f1con` - Top 10 Drivers and Constructors standings.
- `.f1cal` - Full season calendar.
- `.f1c <circuit>` - Search for a specific circuit & view the previous winner.
- `.f1res <round>` - Results for a specific race round this season.

### Chaos Features
- `.drag` - Moves muted/deafened users across voice channels periodically
- `.stopdrag` - Stops dragging and restores original state
### Deafen Shame Board
Tracks how long everyone sits deafened in voice, and posts a ranking of the
worst offenders every week.

- `.shame` - The board for the current period
- `.shame all` - All-time totals
- Stints under 30 seconds are ignored, so a fumbled hotkey doesn't count
- A stint still running is counted at its current length, so the board is live
- Posting a ranking zeroes the period counter but never the all-time one

Configure via `DEAFEN_BOARD_*` in `.env`; `DEAFEN_BOARD_ENABLED=false` turns it off.

### Live Nickname Flag
When a watched Twitch streamer goes live, their server nickname gets a 🔴
prefix, restored exactly when they go offline.

Discord and Twitch accounts can't be matched automatically, so this does
nothing until you map them in `TWITCH_LIVE_NICKNAME_MAP`
(`login:userId,login:userId`). The bot needs **Manage Nicknames**, and cannot
rename anyone at or above its own top role — including the server owner.

### Auto-AFK
One nominated user gets moved to the AFK voice channel once they have been
deafened for a full minute. Self-deafen and a moderator's server-deafen both
count.

- The countdown starts when they deafen and is cancelled if they undeafen or
  leave voice — unrelated voice activity does not reset it
- The condition is rechecked before the move, so a missed update can't strand
  someone in AFK
- Skipped while `.drag` has hold of them, and skipped if they are already there
- Someone left deafened across a bot restart is picked up on startup

Configure via `AFK_USER_ID`, `AFK_CHANNEL_ID` and `AFK_DEAFEN_GRACE_MS` in
`.env`; set `AFK_ENABLED=false` to turn it off. The bot needs **Move Members**.

### YouTube Notifications
Announces new uploads from watched channels into a Discord channel. Uses each
channel's public RSS feed, so there is **no API key and no quota** involved.

- Polls every 5 minutes (configurable)
- Remembers what it has already posted in `data/youtube-seen.json`, so restarts
  never re-announce old videos
- A newly added channel is seeded silently — it won't dump the back catalogue
- Posts at most 3 videos per check, so downtime can't flood the channel
- `.yt` - Shows watched channels and notifier status
- `.yt check` - Forces an immediate check

Announcements ping `@everyone`. Configure via `YOUTUBE_CHANNEL_IDS` and
`YOUTUBE_ANNOUNCE_CHANNEL_ID` in `.env`; set `YOUTUBE_ENABLED=false` to turn it
off (blanking the other two just restores the defaults).

### Twitch Go-Live Notifications
Announces when a watched streamer goes live. Needs an app registered at
[dev.twitch.tv](https://dev.twitch.tv/console/apps) for a client id and secret.

- Polls every 2 minutes (configurable) — one API call covers every streamer
- Tracks the live stream id in `data/twitch-live.json`, so a restart mid-stream
  stays quiet while a genuinely new stream still announces
- A streamer has to be missing from a few checks in a row before being treated
  as offline, so a Twitch hiccup can't cause a duplicate announcement
- `.twitch` - Shows watched streamers and who is live
- `.twitch check` - Forces an immediate check

Announcements ping `@everyone`. Configure via `TWITCH_CLIENT_ID`,
`TWITCH_CLIENT_SECRET`, `TWITCH_LOGINS` and `TWITCH_ANNOUNCE_CHANNEL_ID` in
`.env`; set `TWITCH_ENABLED=false` to turn it off.

### General
- `.help` - Displays all available commands, grouped by category, with 🔒 marking role-restricted ones
- `.hof` - Adds the replied message to the Hall of Fame
- `.shame` - Ranks who spends the most time deafened in voice
- `.say [#channel] <message>` - Says something as the bot 🔒
- **Passive Features** - Automatically reacts to a specific user's non-command messages with 🇬 🇦 🇾 combinations.
- **Riri** - Mention the bot to talk to her. She is written as one specific
  person's girlfriend: warm and clingy with him, friendly but uninterested with
  everyone else. Set by `AI_PARTNER_USER_ID`.
- **Riri sulking** - If he hasn't posted anywhere in the server for 3 hours she
  says so in the home channel, and gets sharper about it at 6h and 12h. One
  message per 3-hour window no matter how long the silence runs, and the clock
  resets the moment he speaks. Tuned with `CLINGY_*`, off with `CLINGY_ENABLED=false`.
- **Riri interjections** - She occasionally butts into a conversation unprompted
  (~1 in 80 messages, at most once every 5 minutes per channel). Turn it off with
  `AI_INTERJECT_ENABLED=false`.

---

## Setup Instructions

### 1. Install Dependencies

Ensure Node.js v18+ is installed:

```bash
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env`. Only `DISCORD_TOKEN` is required — every other
value falls back to the default in `utils/config.js`:

```env
DISCORD_TOKEN=your_bot_token_here
```

Set `OWNER_ID` if you want DMs sent to the bot forwarded to you.
See `.env.example` for the full list of overrides.

### 3. Start the Bot

```bash
npm start
```

---

## Deployment (PM2)

Recommended for production:

```bash
pm2 start index.js --name bot
pm2 save
pm2 startup
```

---

## Required Bot Permissions

### Privileged Gateway Intents
* Server Members Intent
* Message Content Intent

### OAuth2 Permissions
* Send Messages
* Read Message History
* Ban Members
* Kick Members
* Moderate Members
* Manage Roles
* Move Members
* Connect

---
