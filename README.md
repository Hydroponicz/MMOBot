# MMOBot: an RPG skilling chatbot for Kick

Viewers type commands in your Kick chat to train skills, collect loot and level up their character. A companion website lets them **log in with Kick** to see their character sheet, inventory, leaderboards and a live activity feed. Progress made in chat syncs automatically, because chat and the website both identify players by their Kick user ID.

## Features

- **5 skills**, each with 8–9 unlock tiers and rare drops:
  | Command | Skill | What it does |
  |---|---|---|
  | `!fish` | 🎣 Fishing | Shrimp → Shark |
  | `!mine` | ⛏️ Mining | Copper/Tin → Runite ore |
  | `!chop` | 🪓 Woodcutting | Logs → Redwood |
  | `!dig` | 🏺 Digging | Old bones → Dragon relics |
  | `!smelt` | 🔥 Smelting | Turns mined ores into bars (e.g. copper + tin → bronze) |
- Target a specific resource you've unlocked: `!mine iron`, `!chop oak`, `!smelt steel`.
- **XP and levels** (1–99 per skill), plus an overall **character level** (up to 120) based on combined XP.
- **Points**: viewers earn points for chatting (rate-limited), for every action, and by selling loot (`!sell all`).
- Extra commands: `!stats [name]`, `!inv`, `!sell <item> [amount|all]`, `!points`, `!top [skill|points]`, `!commands`.
- A per-viewer action cooldown (default 30s) that warns only once, so spamming doesn't flood chat.
- **Website**: home page with live feed and top players, character sheets, per-skill leaderboards, a "How to play" guide generated from the game data, and an admin page.
- **OBS overlay** at `/overlay.html` that pops up level-ups and rare drops on stream.
- **Test mode**: play from the browser (`DEV_MODE=true`) or terminal (`npm run simulate`) without connecting to Kick.

## Tech

Node.js 22.13+ and Express, with SQLite built into Node (a single file, no database server to run). The frontend is plain HTML/CSS/JS with no build step. The only npm dependency is `express`.

```
src/
  server.js        app wiring
  config.js        all settings (from .env)
  db.js            SQLite schema + queries
  game/skills.js   ← all game content: skills, items, XP, unlock levels, prices
  game/xp.js       level curve
  game/engine.js   command handling and game rules
  bot/             Kick API client, webhook receiver, websocket reader, reply queue
  web/             Kick login (OAuth), sessions, JSON API
public/            website + OBS overlay
```

## Quick start (local, no Kick needed)

```bash
npm install
cp .env.example .env        # then set DEV_MODE=true in .env
npm start
```

Open http://localhost:3000 and use **Test chat** to try `!fish`, `!mine copper`, `!mine tin`, `!smelt`, `!stats`, `!sell all`. Run `npm test` to run the test suite.

## Going live on Kick

### 1. Host it somewhere with HTTPS
Kick has to reach your server to deliver chat messages, so it needs a public `https://` URL. Any Node host works (Railway, Render, Fly.io, a VPS behind Caddy/nginx). Two requirements:
- Node **22.13 or newer**.
- A **persistent disk** for `DB_PATH` (the SQLite file). On Railway/Render/Fly, attach a volume and point `DB_PATH` to it (e.g. `/data/mmobot.db`). Without one, progress is wiped on every deploy.

Start command: `npm start`.

### 2. Create a Kick app
Go to **kick.com → Settings → Developer** and create an app:
- **Redirect URL**: `https://YOUR-SITE/auth/callback`
- **Enable webhooks**, with **Webhook URL**: `https://YOUR-SITE/webhooks/kick`
- **Scopes**: `user:read`, `channel:read`, `chat:write`, `events:subscribe`

Copy the Client ID and Client Secret.

### 3. Configure `.env` (or your host's environment variables)
```
BASE_URL=https://YOUR-SITE
SESSION_SECRET=<long random string>
KICK_CLIENT_ID=...
KICK_CLIENT_SECRET=...
KICK_CHANNEL=yourchannelname
CHAT_SOURCE=webhook
DEV_MODE=false
NODE_ENV=production
```

### 4. Connect your channel
1. Open your site and click **Log in with Kick** using your streamer account (the account named in `KICK_CHANNEL`, which is admin automatically).
2. Go to **Admin → Connect channel** and approve. This subscribes the bot to your chat and lets it post replies.
3. Optional: to reply from a dedicated account like `YourChannelBot`, log into that account on kick.com, then click **Connect bot account**.
4. Type `!fish` in your chat. 🎣

The admin page shows whether the chat subscription is active, message counts and the last error.

### 5. Add the overlay (optional)
In OBS, add a **Browser Source** at `https://YOUR-SITE/overlay.html` (about 400×600). Add `?all=1` to show every action instead of only level-ups and rare drops.

### Running locally against real Kick chat
Webhooks can't reach `localhost`. Either use a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) and set `BASE_URL` to the tunnel URL, or set `CHAT_SOURCE=pusher` with `KICK_CHATROOM_ID` (open `https://kick.com/api/v2/channels/<channel>` and copy `chatroom.id`). The pusher option reads chat through Kick's public websocket. It works well but is unofficial, so use webhooks in production.

## Customizing

- **Game content**: edit `src/game/skills.js` to change items, XP values, unlock levels, sell prices, rare-drop odds and fail messages. The website's guide page updates automatically.
- **Pacing**: `ACTION_COOLDOWN_SECONDS`, `CHAT_POINTS`, `CHAT_POINTS_COOLDOWN_SECONDS` in `.env`. Change the level curve in `src/game/xp.js`.
- **New skill**: add an entry to `SKILLS` in `skills.js` (with `command`, `resources` and `rares`), add its items to `ITEMS`, and add a color variable `--<skillid>` in `public/styles.css`. Existing players get the new skill automatically.
- **Quiet mode**: `REPLY_IN_CHAT=false` stops the bot from replying in chat. Progress still tracks and shows on the site and overlay.
