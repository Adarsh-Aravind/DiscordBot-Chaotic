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
- `.tt` - Role-restricted CS:GO / Valorant toxic trash talk generator (fetches dynamically from external repo)
- `.quote` - Generates a styled image quote of the replied message

### Moderation Tools
- `.ban`, `.kick`, `.mute` (timeouts), `.role`

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

Configure via `YOUTUBE_CHANNEL_IDS` and `YOUTUBE_ANNOUNCE_CHANNEL_ID` in `.env`.

### General
- `.help` - Displays all available commands, grouped by category, with 🔒 marking role-restricted ones
- `.hof` - Adds the replied message to the Hall of Fame
- **Passive Features** - Automatically reacts to a specific user's non-command messages with 🇬 🇦 🇾 combinations.

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
