# MMOBot: an RPG skilling chatbot for Kick

Viewers type commands in your Kick chat to train skills, collect loot and level up their character. Everything runs on **Kick's official public API** (OAuth 2.1 login, `chat.message.sent` webhooks, and the Chat API for replies) as **one Railway service**. A companion website lets them **log in with Kick** to see their character sheet, inventory, leaderboards and a live activity feed. Progress made in chat syncs automatically, because chat and the website both identify players by their Kick user ID.

## Features

- **5 skills**, each with 8–9 unlock tiers and rare drops:
  | Command | Skill | What it does |
  |---|---|---|
  | `!fish` | 🎣 Fishing | Shrimp → Shark |
  | `!mine` | ⛏️ Mining | Copper/Tin → Runite ore |
  | `!chop` | 🪓 Woodcutting | Logs → Redwood |
  | `!dig` | 🏺 Digging | Old bones → Dragon relics |
  | `!smelt` | 🔥 Smelting | Turns ores from your backpack into ingots (one ore) and alloys (mixed ores, e.g. copper + tin → bronze) |
- Target a specific resource you've unlocked: `!mine iron`, `!chop oak`, `!smelt steel`.
- **XP and levels**: every skill goes from 1 to **500**, with new resources unlocking along the way (e.g. woods: Logs → Birch → Oak → Pine → Willow → Spruce → Maple → … → Celestial Timber at 500). An overall **character level** (up to 120) is based on combined XP, with each skill counting up to its level-120 XP, so no single skill can max it alone.
- **Backpack**: holds 10 items to start. When it's full, gathering stops until you `!sell`, `!smelt` (always frees space) or `!upgrade backpack`. There are 10 backpack levels, up to 100 slots, and each costs more points than the last.
- **Tools for every skill**: a rod (Fishing), pickaxe (Mining), axe (Woodcutting), shovel (Digging) and furnace (Smelting). Each has 10 tiers. Everyone starts with tier 1, and a new tier unlocks every 50 levels of that skill. `!upgrade rod` / `pickaxe` / `axe` / `shovel` / `furnace` buys the next tier with points (2,000 up to 1,250,000). Better tools fail less often, give bonus XP and improve rare-find odds; better furnaces instead give bonus XP and a chance to smelt two at once. `!gear` shows all your tools; `!rod`, `!axe` and the like show one.
- **Points**: viewers earn points for chatting (rate-limited), for every action, and by selling loot (`!sell all`).
- Extra commands: `!gear`, `!rod`/`!pickaxe`/`!axe`/`!shovel`/`!furnace`, `!upgrade <tool>`, `!upgrade backpack`, `!stats [name]`, `!inv`, `!sell <item> [amount|all]`, `!points`, `!top [skill|points]`, `!commands`.
- A per-viewer action cooldown (default 30s) that warns only once, so spamming doesn't flood chat.
- **Website**: home page with live feed and top players, character sheets, per-skill leaderboards, and a "How to play" guide generated from the game data.
- **Admin page**:
  - **Overview**: Kick connection status and the bot account.
  - **Settings**: edit live, with no redeploy. Covers the command prefix, cooldowns, chat points, reply on/off, extra admins, XP/points/sell multipliers (e.g. double-XP events), switching individual commands on and off, and every rod's and backpack's price and stats.
  - **Players**: search players and give or take points.
  - **Logs**: chat commands and bot replies, Kick/webhook errors, logins and admin changes. Filter by level, source or text, with live tail. Kept for 14 days.
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
  bot/             Kick API client, webhook receiver, reply queue
  web/             Kick login (OAuth), sessions, JSON API
public/            website + OBS overlay
railway.json       Railway build/deploy settings
```

## Quick start (local, no Kick needed)

```bash
npm install
cp .env.example .env        # then set DEV_MODE=true in .env
npm start
```

Open http://localhost:3000 and use **Test chat** to try `!fish`, `!mine copper`, `!mine tin`, `!smelt`, `!stats`, `!sell all`. Run `npm test` to run the test suite.

## Deploying on Railway (one service)

The website, API, webhook receiver and bot all run in a single Node process, and the database is a SQLite file on a Railway volume. You don't need a separate database service. `railway.json` sets the start command, the health check (`/healthz`) and the restart policy.

### 1. Create the service
1. Push this repo to GitHub, then in Railway choose **New Project → Deploy from GitHub repo** and pick it.
2. Open the service → **Settings → Networking → Generate Domain**. You'll get something like `mmobot-production.up.railway.app`. The app picks the domain up automatically from `RAILWAY_PUBLIC_DOMAIN`.
3. **Attach a volume**: right-click the service (or use the command palette) → **Attach volume**. Any mount path works, e.g. `/data`. The database is stored there automatically via `RAILWAY_VOLUME_MOUNT_PATH`. Without a volume, all player progress is lost on every redeploy, and the logs and admin page warn about it.

Keep the service at **1 replica**. SQLite lives on the volume, and Railway volumes attach to a single instance.

### 2. Create a Kick app
On **kick.com → Settings → Developer**, create an app:
- **Redirect URL**: `https://<your-domain>/auth/callback`
- **Enable webhooks**: on, with **Webhook URL** `https://<your-domain>/webhooks/kick`
- **Scopes**: `user:read`, `chat:write`, `events:subscribe`

Copy the **Client ID** and **Client Secret**.

### 3. Set the variables
In the service's **Variables** tab:

| Variable | Value |
|---|---|
| `KICK_CLIENT_ID` | from your Kick app |
| `KICK_CLIENT_SECRET` | from your Kick app |
| `KICK_CHANNEL` | your channel name (the part after `kick.com/`) |

Everything else is optional (see `.env.example`). `BASE_URL`, `DB_PATH` and `SESSION_SECRET` are worked out automatically. Railway redeploys when you save.

### 4. Go live
1. On startup, the app uses an **app access token** to look up your channel and **subscribe to its chat** (`chat.message.sent`). It re-checks every 30 minutes, because Kick drops subscriptions whose webhook fails for over a day. Chat commands start working straight away and progress is tracked.
2. Log into your site with **Log in with Kick** as your streamer account. The `KICK_CHANNEL` account is admin automatically.
3. **Connect the bot account** that replies come from, e.g. a Kick account called `mmobot`. Kick's login page always uses whichever account is logged into kick.com in that browser, so:
   1. On **Admin → Bot account**, click **Get bot login link** and copy it. The link works once and expires after 30 minutes.
   2. Open a **private/incognito window**, paste the link, log into Kick as `mmobot` and approve.
   3. In your chat, type `/mod mmobot` so slow mode and follower-only mode don't block its replies.

   The site refuses your channel account as the bot account. Without a bot account, replies go out through **Admin → Channel connection** as your Kick app's bot (the API's `type: "bot"`).
4. Type `!fish` in your chat. 🎣

The admin page shows the chat subscription, message and reply counts, storage status and the last error.

Webhook requests are verified against Kick's signature (RSA-SHA256 over `message-id.timestamp.body`). The public key is fetched from the API, with the published key built in as a fallback. Duplicate deliveries are ignored.

### 5. Add the overlay (optional)
In OBS, add a **Browser Source** at `https://<your-domain>/overlay.html` (about 400×600). Add `?all=1` to show every action instead of only level-ups and rare drops.

### Testing with real Kick chat on your computer
Kick can only deliver webhooks to a public URL. Run a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`), set `BASE_URL` to the tunnel URL in `.env`, and point a second Kick app's redirect and webhook URLs at it. Or just deploy to Railway and test there.

## Customizing

- **Game content**: edit `src/game/skills.js` to change items, XP values, unlock levels, sell prices, rare-drop odds and fail messages. The website's guide page updates automatically.
- **Pacing and prices**: change them on **Admin → Settings**. They take effect immediately and are stored in the database. The `ACTION_COOLDOWN_SECONDS`, `CHAT_POINTS` and similar variables only set the starting defaults. Change the level curve in `src/game/xp.js`.
- **Tools**: prices and stats are editable live on **Admin → Settings**. Tool names and icons are in each skill's `tool` block in `skills.js`, and the shared price/stat ladder is `TOOL_LADDER`.
- **Level caps**: set `maxLevel` on a skill (all current skills use 500; the default is 99).
- **New skill**: add an entry to `SKILLS` in `skills.js` (with `command`, `resources` and `rares`), add its items to `ITEMS`, and add a color variable `--<skillid>` in `public/styles.css`. Existing players get the new skill automatically.
- **Quiet mode**: `REPLY_IN_CHAT=false` stops the bot from replying in chat. Progress still tracks and shows on the site and overlay.
