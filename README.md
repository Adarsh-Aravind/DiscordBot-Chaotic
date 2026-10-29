# Chaotic

A Discord bot for a private friends' server, built on Node.js and discord.js v14.

It does four things: runs an AI persona called **Riri** who holds a real
conversation in one channel, announces **YouTube and Twitch** activity, serves
**Formula 1** data, and handles the usual **moderation** and in-jokes.

Prefix-based (`.` by default), modular, and configured almost entirely through
`.env` — only `DISCORD_TOKEN` is actually required.

```
.help          every command and feature, with live on/off state
.presence      change what the bot appears to be doing
@Riri hey      talk to her
```

---

## Contents

- [Features](#features)
  - [Riri — the AI persona](#riri--the-ai-persona)
  - [Notifications](#notifications)
  - [Formula 1](#formula-1)
  - [Fun](#fun)
  - [Moderation](#moderation)
  - [Chaos](#chaos)
  - [Presence](#presence)
  - [Passive behaviour](#passive-behaviour)
- [Command reference](#command-reference)
- [Setup](#setup)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## Features

### Riri — the AI persona

Mention the bot to talk to her; after that, replying to one of her messages
keeps the conversation going without another mention. She runs on Groq's
OpenAI-compatible chat completions endpoint.

**One room, one conversation.** She lives in a single channel
(`AI_HOME_CHANNEL_ID`). Memory is keyed by channel rather than by user, so
everyone in there shares one thread — someone chiming in on what another person
said continues the same conversation instead of starting a private one. Each
turn is labelled with who said it, which is what lets her follow a room.

**She knows who she's talking to**, by user ID rather than nickname, so renaming
yourself after someone else gets you nothing. The cast is configurable:

| Who | Relationship | Variable |
|---|---|---|
| Alpha | her boyfriend — the one place she's soft | `AI_PARTNER_USER_ID` |
| zyco | Alpha's dad, so her father-in-law | `AI_FATHER_IN_LAW_USER_ID` |
| iris | her sidechick and best friend | `AI_SIDECHICK_USER_ID` |
| SR | the man she's secretary to | `AI_BOSS_USER_ID` |
| rogue & sam | a couple; she's best friend to both | `AI_ROGUE_USER_ID`, `AI_SAM_USER_ID` |

Anyone else is a stranger she talks to like a person. Cast members are labelled
in her memory by their canonical name, so she keeps track of who said what even
when someone changes their nickname mid-conversation.

**Behaviour**

- **Stays in her channel.** Mentioned elsewhere she points back there once, then
  goes quiet for 10 minutes per channel so the redirect can't be used to spam.
- **Butts in uninvited** — roughly 1 message in 80 in her home channel, at most
  once every 5 minutes, and never on a message that was a command.
- **Sulks when ignored.** If Alpha hasn't posted anywhere in the server for 3
  hours she says so, getting sharper at 6h and 12h. Hard-limited to once every
  2 days, and that limit is *not* reset by him turning up — otherwise a day of
  on-and-off chatting earns several sulks.
- **Remembers across restarts.** Her memory is persisted, so a reply to one of
  her older messages no longer gets answered as though the conversation had just
  started. Threads already past their 30-minute TTL are dropped rather than
  resumed stale.
- **Stays in character.** Replies that slip into assistant mode ("as an AI…",
  "here are some tips") are caught and replaced with an in-character deflection.
  A random mood is injected per message so her contradictions don't all fire at
  once.

**Reliability.** One generation at a time per channel, so a busy room can't
queue a dozen parallel API calls. Rate limits are ridden out inside the request
with exponential backoff and jitter against a short budget, honouring Groq's
`Retry-After`. A burst limit, an exhausted daily allowance, a revoked key and a
retired model each produce a different, in-character message — Groq retires
models often, so a dead `GROQ_MODEL` says so instead of looking like a network
fault.

### Notifications

**YouTube uploads** — watches channels via their public RSS feeds, so there's
**no API key and no quota**.

- Polls every 5 minutes
- Remembers what it has posted, so restarts never re-announce old videos
- A newly added channel is seeded silently rather than dumping its back catalogue
- At most 3 videos per check, so downtime can't flood the channel
- `.yt` shows status, `.yt check` forces a poll

**Twitch go-live** — needs an app registered at
[dev.twitch.tv](https://dev.twitch.tv/console/apps) for a client ID and secret.

- Polls every 2 minutes; one API call covers every streamer
- Tracks the live stream ID, so a restart mid-stream stays quiet while a
  genuinely new stream still announces
- A streamer must be missing from 3 consecutive checks before being treated as
  offline, so a Twitch hiccup can't cause a duplicate announcement
- `.twitch` shows who's live, `.twitch check` forces a poll

Both ping `@everyone`, with allowed-mentions pinned explicitly so a stream title
containing a mention can't widen the ping.

**Live nickname flag** — a watched streamer's server nickname gets a 🔴 prefix
while they're live, restored exactly when they go offline.

Discord and Twitch accounts can't be matched automatically, so this stays inert
until you map them in `TWITCH_LIVE_NICKNAME_MAP`. A mapped login must **also**
appear in `TWITCH_LOGINS`.

- Reconciled on every poll rather than on the live/offline transition, so a
  restart mid-stream still applies the dot, a stream that ended while the bot
  was down gets it removed, and a missed event repairs itself
- Inherits the watcher's offline tolerance, so a flaky reading can't strip
  someone's dot and immediately restore it
- Originals are stored rather than derived by stripping the prefix — a long name
  is truncated to make room, and stripping it back would shorten their name
  permanently
- Reports at startup and in `.twitch` whether it's actually active, and why not
  if it isn't

Needs **Manage Nicknames** and a role above the target's; Discord never allows
renaming the server owner. All three are checked up front and named in the log.

### Formula 1

Season data from [api.jolpi.ca](https://api.jolpi.ca) — the community mirror
that replaced Ergast when it retired at the end of 2024.

`.f1` gives a season overview, `.f1next` and `.f1last` the surrounding races,
`.f1dri` and `.f1con` the standings, `.f1cal` the full calendar, `.f1c` a
circuit search with its previous winner, and `.f1res <round>` one round's
results. Most come with the circuit map.

Responses are cached for 10 minutes and identical concurrent requests are
deduplicated, so repeated use is one call rather than many to a free,
volunteer-run service. Requests time out after 10 seconds instead of hanging,
and failures aren't cached — one blip doesn't break F1 for the next ten minutes.

### Fun

- **`.roast [@user]`** — from a 101-line pool using a shuffle bag, so nothing
  repeats until the whole pool is used. Tracked per server, and a fresh bag
  never opens with the roast it just served.
- **`.quote`** — renders the replied-to message as a 1200×600 image: the
  author's avatar gradient-masked into black, with wrapped text.
- **`.meme`** — a random meme.
- **`.tt`** — CS:GO trash talk, machine-translated into Valorant terms (AWP →
  Operator, AK-47 → Vandal, Global Elite → Radiant, bomb → spike) with a
  profanity filter. 778 lines ship in `assets/trashtalk.json`, so startup needs
  no network; `.tt reload` pulls the latest from upstream on demand.
- **`.gay [@user]`** — toggles who gets spelled at with 🇬 🇦 🇾, via a panel with
  a live button that redraws in place. Persisted.
- **`.forget`** — wipes the channel's conversation with Riri.

### Moderation

`.ban`, `.kick`, `.mute` (Discord timeouts, default 10 minutes), `.role`
(add/remove by mention), `.say [#channel] <message>`, and `.hof` to add the
replied-to message to the Hall of Fame with its attachments.

Access is role-based: holding any role in `ALLOWED_ROLE_IDS` is enough, and
`ALLOWED_USER_ID` always has access regardless of roles.

### Chaos

**`.drag @user`** yanks a self-muted or self-deafened user between random voice
channels every 2.5 seconds. They escape by unmuting *and* undeafening, which
restores their original channel. `.stopdrag` ends it manually.

Because the escape condition is unmuting, there's a hard 2-minute cap
(`DRAG_MAX_MS`) — otherwise someone who walks away muted is dragged
indefinitely, which is a voice-move API call every few seconds forever. Anyone
being dragged is also restored on shutdown.

### Presence

`.presence` sets what the bot appears to be doing at runtime, instead of it
being a constant in the source. Saved to disk, so it survives a restart, and
reapplied after a reconnect since Discord drops presence on a fresh IDENTIFY.

```bash
.presence                                      # show what's set
.presence watching Hardstuck Crusaders
.presence listening The Weeknd
.presence custom just vibing                   # no verb prefix
.presence streaming live now | https://twitch.tv/someone
.presence status dnd                           # online / idle / dnd / invisible
.presence reset
```

Verbs: `playing`, `streaming`, `listening`, `watching`, `competing`, `custom`.

Only `streaming` can carry a link, and only a `twitch.tv` or `youtube.com` one —
Discord silently ignores the whole activity otherwise, so a link it won't render
is dropped and you're told. Invalid input leaves the current presence untouched.

> A bot cannot have Rich Presence buttons, artwork or an elapsed timer. Those are
> RPC features for user accounts running a local app; a bot publishes presence
> over the gateway, which carries only type, name, state and URL.

### Passive behaviour

Things the bot does without being asked. `.help` lists all of these with whether
each is actually switched on.

| Feature | What it does |
|---|---|
| Riri | Answers mentions and replies in her home channel |
| Riri butting in | Joins conversations uninvited, on a chance and a cooldown |
| Riri sulking | Complains when Alpha goes quiet |
| 🇬 🇦 🇾 reactions | Spells at targeted users' non-command messages |
| YouTube / Twitch | Announces uploads and go-lives |
| 🔴 live nickname | Flags live streamers' nicknames |
| DM relay | Forwards DMs to `OWNER_ID`; reply with `.reply <user_id> <message>` |
| Status heartbeat | Reports uptime, latency and counts to an external ops panel |

---

## Command reference

🔒 marks staff-only. 26 commands, 13 locked.

### General
| Command | 🔒 | Description |
|---|:--:|---|
| `.help` | | Every command and passive feature, with live status |
| `.presence [verb] [text]` | 🔒 | Set the bot's presence |
| `.hof` | 🔒 | Add the replied-to message to the Hall of Fame |
| `.yt` · `.yt check` | 🔒 | YouTube notifier status / force a poll |
| `.twitch` · `.twitch check` | 🔒 | Twitch notifier status / force a poll |

### Fun
| Command | 🔒 | Description |
|---|:--:|---|
| `.roast [@user]` | | A roast, no repeats until the pool is exhausted |
| `.quote` | | Render the replied-to message as an image |
| `.meme` | | A random meme |
| `.forget` | | Make Riri forget this channel's conversation |
| `.gay [@user]` | 🔒 | Toggle 🇬 🇦 🇾 auto-reactions |
| `.tt` · `.tt reload` | 🔒 | Valorant trash talk / refresh from upstream |

### Formula 1
| Command | Description |
|---|---|
| `.f1` | Season overview: standings and next race |
| `.f1next` | Next race and circuit detail |
| `.f1last` | Last completed race and podium |
| `.f1dri` · `.f1con` | Top 10 drivers / constructors |
| `.f1cal` | Full season calendar |
| `.f1c <circuit>` | Circuit search with previous winner |
| `.f1res <round>` | Results for one round |

### Moderation — all 🔒
| Command | Description |
|---|---|
| `.ban @user [reason]` | Ban a member |
| `.kick @user [reason]` | Kick a member |
| `.mute @user [minutes]` | Timeout a member (default 10) |
| `.role @user @role` | Add or remove a role |
| `.say [#channel] <message>` | Speak as the bot |

### Chaos — all 🔒
| Command | Description |
|---|---|
| `.drag @user` | Drag a muted user between voice channels |
| `.stopdrag @user` | Stop and restore them |

### Owner, in the bot's DMs
| Command | Description |
|---|---|
| `.reply <user_id> <message>` | Answer a forwarded DM as the bot |

---

## Setup

### Requirements

- **Node.js 18+** (uses the global `fetch` and `AbortSignal.timeout`)
- A Discord application with a bot token

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
```

Only `DISCORD_TOKEN` is required — every other value falls back to a default in
`utils/config.js`, so the bot starts with a bare `.env`:

```env
DISCORD_TOKEN=your_bot_token_here
```

Then, as needed:

| Want | Set |
|---|---|
| Riri to talk | `GROQ_API_KEY` ([console.groq.com](https://console.groq.com)) |
| DMs forwarded to you | `OWNER_ID` |
| Twitch announcements | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` |
| 🔴 nickname flags | `TWITCH_LIVE_NICKNAME_MAP` |

`.env.example` documents all 49 variables with their defaults.

### Run

```bash
npm start
```

### Discord setup

**Privileged gateway intents** — enable both in the Developer Portal:

- Server Members Intent
- Message Content Intent

**OAuth2 permissions**

| Permission | Needed for |
|---|---|
| Send Messages, Read Message History | everything |
| Add Reactions | 🇬 🇦 🇾 reactions |
| Ban Members | `.ban` |
| Kick Members | `.kick` |
| Moderate Members | `.mute` |
| Manage Roles | `.role` |
| Manage Nicknames | 🔴 live nickname flag |
| Move Members, Connect | `.drag` |
| Mention Everyone | upload and go-live announcements |

---

## Configuration

Every server-specific ID lives in `utils/config.js` and is overridable from
`.env`, grouped by feature. Notes on the conventions:

- **Boolean switches** treat unset or blank as *on*, so an existing `.env` keeps
  working when a new flag is added. `false`, `0`, `no` and `off` turn a feature
  off.
- **Numbers** keep an explicit `0`, which matters for the chance settings —
  `AI_INTERJECT_CHANCE=0` means never, not "use the default".
- **Kill switches matter for anything that pings `@everyone`.** Blanking
  `YOUTUBE_CHANNEL_IDS` falls back to the baked-in defaults rather than clearing
  them, so use `YOUTUBE_ENABLED=false` to actually turn the watcher off. Same
  for Twitch.
- **Every feature reports whether it's on**, at startup and in `.help`. A
  feature that silently does nothing because one variable is blank is
  indistinguishable from a bug, so nothing fails quietly.

### Runtime state

Written to `data/` (gitignored). All writes are atomic — a temp file renamed
over the target — so a restart mid-write can't leave a truncated file that reads
as "nothing was ever saved".

| File | Holds |
|---|---|
| `presence.json` | The presence set by `.presence` |
| `riri-memory.json` | Conversation history per channel |
| `riri-messages.json` | IDs of Riri's messages, so replies are recognised |
| `clingy.json` | When Alpha last spoke, and last sulk |
| `reaction-targets.json` | Who `.gay` is targeting |
| `youtube-seen.json` | Already-announced video IDs |
| `twitch-live.json` | Live stream IDs and miss counts |
| `live-nicknames.json` | Original nicknames to restore |

---

## Deployment

PM2 is recommended:

```bash
pm2 start index.js --name bot
pm2 save
pm2 startup
```

**Startup** retries login 5 times at 15-second intervals before exiting, so a
boot while the network is still down — a server reboot, PM2 resurrecting before
DNS is up — recovers instead of leaving a process that's alive but permanently
disconnected. A rejected token exits immediately rather than burning retries.

**Shutdown** on SIGINT/SIGTERM, which is what `pm2 restart` and `pm2 stop` send:
dragged users are restored, the heartbeat sends a final `stopping: true` so an
ops panel can tell a deliberate restart from a crash, and the gateway connection
is closed cleanly. It gives up after 5 seconds so a wedged teardown can't block
a restart, and a second Ctrl-C exits immediately.

---

## Architecture

```
index.js                 client, command/event loading, login retry, shutdown
commands/<category>/     one file per command; the folder is its .help category
events/                  clientReady, messageCreate, interactionCreate,
                         voiceStateUpdate
utils/                   config, feature modules, shared helpers
assets/trashtalk.json    vendored .tt insult list
data/                    runtime state (gitignored)
test/                    node:test suites
```

**Commands** are plain objects with `name`, `description` and `execute`, loaded
from each subfolder of `commands/`. The folder name becomes the `.help`
category. A command that fails to load is recorded and reported in `.help`
rather than vanishing with only a startup log to explain it.

**Flags** are declared per command and enforced centrally in
`events/messageCreate.js`:

- `guildOnly` — rejected in DMs
- `restricted` — requires `ALLOWED_ROLE_IDS` or `ALLOWED_USER_ID`

Central enforcement means a new locked command cannot be left open by
forgetting an in-body check, and the flag drives the 🔒 in `.help` from the same
source of truth.

**Shared helpers**

| Module | Responsibility |
|---|---|
| `config.js` | Every setting, with `.env` overrides and enabled-state getters |
| `jsonStore.js` | Atomic JSON read/write for all runtime state |
| `permissions.js` | Role checks for both messages and button interactions |
| `stateManager.js` | Active drags, their timers, and restoring everyone |
| `roastManager.js` | The roast pool and its shuffle-bag picker |

Watchers (`youtubeWatcher`, `twitchWatcher`, `clingyWatcher`, `heartbeat`,
`presenceManager`) each expose `start(client)` / `stop()`, are started from
`clientReady`, keep their own persisted state, and unref their timers so none of
them is the reason the process stays alive.

**Error handling.** Command errors are caught per command and reported to the
channel. `unhandledRejection` and `uncaughtException` are logged rather than
fatal. Failed button interactions get a reply, since Discord renders an
unanswered interaction as "This interaction failed", which reads like the bot is
dead rather than like one click didn't take.

---

## Testing

```bash
npm test
```

105 tests on `node:test`, no framework. They cover the logic that's worth
pinning down and awkward to check by hand: nickname length against Discord's
UTF-16 cap, presence validation, atomic-write and corruption recovery, Groq
retry and `Retry-After` parsing, Riri's cast resolution and history labelling,
YouTube feed parsing and HTML entity decoding, the `.tt` extraction filter, and
`.help` field chunking against the 1024-character embed limit.

---

## Troubleshooting

**Run `.help` first.** Every passive feature is listed with ✅ or ❌ and, when
off, the reason — which is usually a blank variable rather than a bug.

| Symptom | Cause |
|---|---|
| Riri doesn't respond | `GROQ_API_KEY` unset, or you're not in `AI_HOME_CHANNEL_ID`. Mentioned elsewhere she redirects once per 10 min |
| "my brain model is gone" | `GROQ_MODEL` has been retired — check [Groq's model list](https://console.groq.com/docs/models) |
| "i'm all talked out for today" | Daily Groq allowance exhausted |
| No 🔴 nickname flag | `TWITCH_LIVE_NICKNAME_MAP` empty, login missing from `TWITCH_LOGINS`, or a role/permission problem. `.twitch` names which |
| No upload announcements | `YOUTUBE_ENABLED=false`, or the announce channel isn't visible. `.yt check` reports errors directly |
| Presence resets on restart | Check `data/` is writable; a corrupt `presence.json` is logged and falls back to the default |
| A command is missing from `.help` | It failed to load — `.help` lists failures with the reason |
| Nickname rename fails | The bot can't rename anyone at or above its own top role, nor the server owner |

Startup logs how many commands loaded, which watchers are active, and why any
inactive one isn't.
