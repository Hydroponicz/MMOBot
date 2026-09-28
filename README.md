# MMOBot: an RPG skilling chatbot for Kick

Viewers type commands in your Kick chat to train skills, collect loot and level up their character. Everything runs on **Kick's official public API** (OAuth 2.1 login, `chat.message.sent` webhooks, and the Chat API for replies) as **one Railway service**. A companion website lets them **log in with Kick** to see their character sheet, inventory, leaderboards and a live activity feed. Progress made in chat syncs automatically, because chat and the website both identify players by their Kick user ID.

## Features

- **16 skills**, each levelling from 1 to 500:
  | Command | Skill | What it does |
  |---|---|---|
  | `!fish` | 🎣 Fishing | Shrimp → Shark |
  | `!mine` | ⛏️ Mining | Copper/Tin → Runite ore |
  | `!chop` | 🪓 Woodcutting | Logs → Redwood |
  | `!dig` | 🏺 Digging | Old bones → Dragon relics |
  | `!smelt` | 🔥 Smelting | Turns ores from your backpack into ingots (one ore) and alloys (mixed ores, e.g. copper + tin → bronze) |
  | `!skin` | 🔪 Skinning | Animal hides, from Rabbit to Celestial Fleece. Needs a Skinning Knife in your backpack (shop, 500 pts, or smith it at Smithing 20 from a Sterling Alloy, which is silver + copper ore at Smelting 20) |
  | `!plant` / `!harvest` | 🌱 Farming | Everyone starts with 1 free plot; buy more (750 pts each, up to 100) and seeds, plant one seed per plot, harvest 1 crop per plot when grown (carrots: 20 min). 201 vegetables, herbs, fruits and magical plants from Carrot (1) to World Tree Fruit (500), a new one every 2-3 levels. Planting and harvesting each use a stamina charge. `!farm` shows your plots |
  | `!smith <item>` | ⚒️ Smithing | Turns alloys into weapons and armor, e.g. `!smith bronze sword`. Needs a Smithing Hammer in your backpack |
  | `!lightfire [log]` | 🔥 Firemaking | Burns a log from your backpack (the best one you can, or `!lightfire oak`) for XP and 🌫️ Ashes. Better logs give more XP; each log unlocks at the level it takes to chop it. Needs a Flint and Steel (shop, 50 pts), which lasts 250 fires. Sometimes the fire won't catch: nothing is used up, try again |
  | `!cook [food]` | 🍳 Cooking | Cooks on your fire: `!lightfire` first (it burns 5 minutes, a minute longer per log tier; `!fire` shows what's left). Lighting the fire uses a stamina charge, but cooking on it is free: you can `!cook` as fast as you like while it burns and you have raw food. Fish, vegetables, Raw Chicken from fights and the raw meat you get from `!skin` (every skinned animal now gives meat too). Each food unlocks at the level it takes to get it, and better food gives more XP. Food burns sometimes (30% at the food's level, down to 2% 50 levels above it). Cooked food sells for more and `!eat` heals HP |
  | `!craft <item>` | 🧵 Crafting | Leather armor from skinned hides (coif, chaps and body in 10 hide tiers; a bit less defence than metal but adds to your attack with a bow), Large and Huge quivers (1,000 / 2,000 arrows) and Magic Runes (`!craft runes`: 1 Ashes + 1 Tin Ore makes 10) |
  | `!fletch <item>` | 🪶 Fletching | Arrows (`!fletch arrows`: 1 Oak Logs + 1 Feathers + 1 Iron Ingot makes 10; better arrows from better wood and metal), bows (`!fletch oak shortbow`: 2 Oak Logs, 10 bows up to the Elder Bow) and a Quiver (2 Rabbit Hides) |
  | `!brew [potion]` | ⚗️ Alchemy | Brews health and mana potions from farmed crops, e.g. 2 Carrots → Minor Health Potion, up to the Elixir of Life at 300. Also **undead potions** from Ashes plus something dead, which give timed effects when you `!drink` them: Bone Brew (+20% XP, 30 min), Vampire Draught (heal after wins), Wraith Tonic (stamina refills twice as fast, 10 min), Banshee Brew (+25% attack), Grave Luck Tonic (double rare chances) and Lich's Elixir (survive one knockout on 1 HP). `!buffs` shows what's active |
  | `!fight [monster]` | 🗡️ Swords | Fight monsters (Chicken at 1 up to Elder Dragon at 500) for XP and loot. Costs HP. Needs a sword |
  | `!cast [monster]` | 🔮 Magic | Fight the same monsters with a staff (Oak Staff in the shop, or fletch one from logs). Each cast uses a Magic Rune (no backpack slot) and 1 mana. Ten spells unlock with level, from Wind Strike to Starfall, each adding attack. `!heal` also trains Magic |
  | `!shoot [monster]` | 🏹 Archery | Fight the same monsters with a bow. Needs a quiver; each fight uses one arrow, and better arrows add damage. Arrows sit in the quiver (500 max), not the backpack. `!quiver` shows them |
- Target a specific resource you've unlocked: `!mine iron`, `!chop oak`, `!smelt steel`.
- **XP and levels**: every skill goes from 1 to **500**, with new resources unlocking along the way (e.g. woods: Logs → Birch → Oak → Pine → Willow → Spruce → Maple → … → Celestial Timber at 500). An overall **character level** (up to 120) is based on combined XP, with each skill counting up to its level-120 XP, so no single skill can max it alone.
- **Gear & combat**: smith (or buy) swords and armor in 10 metals, from Bronze to Celestial. `!equip` them for attack and defence; weapons need that Swords level to wield, armor needs that Combat level. `!fight` uses your best weapon for the combat skill you're highest in, equipping it if needed, so future weapon types (bows, battleaxes...) slot in. `!equipped` shows your gear, and `!unequip helmet` takes it off. `!sell all` keeps gear and tools.
- **Health and mana**: max HP is 50 + 10 per combat level, max mana 20 + 2 per level. A fight is traded blows: you hit for your level + weapon attack, the monster hits back (less with better armor, much harder the further it outlevels you). Any monster can be fought at any level: one at your level costs about 6% of your HP, one twice your level about half, three times or more will usually knock you out. At 0 HP you're **knocked out**: no fighting until you're back at full HP (24 hours) or you `!drink` a health potion. You keep all items; you get a little XP for the damage you did. HP and mana refill over time (24h / 2h, set on the admin page). `!hp` shows both, `!drink [potion]` drinks the best potion for the moment, and `!heal` spends half your mana to restore 25% HP (it can't revive you). Every monster is **rated for you** from your level, weapon and armor: ⚪ too easy · 🟢 good match · 🟠 tough · 🔴 hard · ☠️ deadly. `!targets` recommends the best fights for your level, gear and current HP (`!targets bow` for archery), `!monsters` lists them all around your level, `!scout troll` shows how a fight would go (rounds, expected HP loss, XP), and the character page shows the same ratings. A plain `!fight` picks your best safe match; beating something far below you says so and points to `!targets`; and a fight that would likely knock you out (with your current HP) is warned about first. Typing it again within 2 minutes fights anyway. Potions are sold in the shop (150 to 3,500 pts) or brewed with Alchemy, and knock-outs show on the feed and overlay.
- **Farming economy**: seeds are bought in the shop (or `!buy carrot seeds 10`) and don't take backpack space. Crops do take space and sell for points; their value and XP rise with the Farming level needed. Admin settings control a crop growth-time multiplier.
- **Emote shortcuts**: a chat message with the `hydroponiczcobble` emote works like `!mine`, and a target after it works too: the emote then `iron` mines iron (with a space in between). It counts as the Kick emote (sent as `[emote:ID:name]`), typed as `:name:`, or the name as the first word of a message, never the name mid-sentence or in a link. Words after the emote that aren't a target are treated as chat, so it just mines. Other emotes in a message are ignored, so `!mine KEKW` still mines. Add more pairs under **Admin → Settings → General → Emote shortcuts** (`emote=command`, optionally with a fixed target like `cobble=mine iron`), or set the starting list with `EMOTE_COMMANDS`; entries there are cleaned up the same way and bad ones are skipped with a warning in the logs.
- **Shop** (website "Shop" page, or `!shop` / `!buy <item>` in chat): Smithing Hammer 500 points, Bronze Sword 1,000 points, Skinning Knife 500 points, Oak Shortbow 500 points, Quiver 250 points, Flint and Steel 50 points (250 fires), and arrows priced per arrow (Iron 6 up to Rune 110; `!buy arrows 50`, 10 if no amount; they go in your quiver). Prices are editable on the admin page. Logged-in players can also equip, unequip and sell from their character page.
- **Backpack**: holds 10 items to start. When it's full, gathering stops until you `!sell`, `!smelt` (always frees space) or `!upgrade backpack`. There are 10 backpack levels, up to 100 slots, and each costs more points than the last.
- **Tools for every skill**: a rod (Fishing), pickaxe (Mining), axe (Woodcutting), shovel (Digging) and furnace (Smelting). Each has 10 tiers. Everyone starts with tier 1, and a new tier unlocks every 50 levels of that skill. `!upgrade rod` / `pickaxe` / `axe` / `shovel` / `furnace` buys the next tier with points (2,000 up to 1,250,000). Better tools fail less often, give bonus XP and improve rare-find odds; better furnaces instead give bonus XP and a chance to smelt two at once. `!gear` shows all your tools; `!rod`, `!axe` and the like show one.
- **Casino** (website "Casino" page, or chat): gamble points on **slots** (Kick-themed reels: 💬 Chat, 💚 Follow, 🎁 Gift Sub, 🎙️ Mic, 🎥 Cam, 🔴 LIVE, 🟩 KICK up to 300x), **roulette** (European wheel: colors, odd/even, halves, dozens or a number), **plinko** (12 rows, low/medium/high risk, up to 170x) **blackjack** (3:2 blackjack, dealer stands on 17, double down, and **split** pairs like 8-8 into up to 4 hands), **crash** (a rocket multiplier climbs from 1x until it crashes, up to 1000x; cash out in time to win bet × multiplier) and **mines** (a 5×5 board with 1-24 mines: every gem you find raises the multiplier, cash out any time, hit a mine and lose the bet). In chat: `!slots 500`, `!slots all`, `!roulette red 1k`, `!plinko half high`, `!bj 500` then `!hit`/`!stand`/`!double`/`!split`, `!crash 500 2x` (cashes out at 2x), `!mines 500 3` then `!pick 7` and `!cashout`, and `!casino` for help. On the website, crash is played live with a Cash out button (plus an optional auto cash-out); rounds and boards are saved, so a refresh doesn't lose them. Bets accept `500`, `1k`, `half`, `all` or `25%`. Outcomes are decided on the server, and the house edge is similar to a real casino (about 95% return on slots, 97% roulette, 99% plinko, blackjack, crash and mines), so points drain slowly. Big wins (10x or more, or 10,000+ points) show on the feed and OBS overlay. A per-viewer bet cooldown (5s, warns once) stops chat spam. **Admin → Settings → Casino** opens/closes it and sets the minimum bet, maximum bet and cooldown; `!casino`, `!slots`, `!roulette`, `!plinko` and `!blackjack` can be switched off individually. Points only, no real money.
- **Points**: viewers earn points for chatting (rate-limited), for every action, and by selling loot (`!sell all`). To stop farming, messages under 3 letters, exact repeats and (optionally) brand-new chatters earn no chat points; subscribers (sub badge in chat) earn 2x. All adjustable in **Admin → Settings → General**.
- **Stream events** (**Admin → Events**, timers in **Settings → Events**):
  - **Follows, subs and gifted subs** (Kick webhooks, subscribed automatically): points for the viewer (a follow pays once per viewer), a thank-you in chat, and gifted subs start a channel-wide **double XP** boost (5 minutes per gifted sub, stacking up to an hour). `!boost` shows it. You can start XP or chat-point boosts yourself on the Events page.
  - **Raid bosses**: a giant monster attacks the channel and everyone types `!attack` (with their best weapon, arrows or spells). Its HP scales with how many people are chatting; beat it in time and the reward pool (5,000 pts) is split by damage, everyone gets loot, and the MVP gets rare loot. Start one from the Events page or set it to appear every N minutes. `!raid` shows its HP; the site and the OBS overlay show a live health bar.
  - **Random events** while chat is active: a 👺 treasure goblin (first to `!catch` it wins points and a treasure) or a 📦 supply drop (first 3 to `!grab`). Every 15 minutes by default.
  - Raids and random events only run while the stream is live (from Kick's live status), and only while people are chatting. Both can be turned off.
  - **Duels**: `!duel @name [bet]`, then they `!accept` (or `!decline`) within a minute. Fought on copies of both players' HP, so nobody gets hurt for real; the winner takes the bet.
- **Every day**: `!daily` pays 100 pts × your streak day (up to 7 days in a row). Three **daily tasks** a day (`!tasks`, e.g. "Catch 10 fish", "Win 5 fights") pay 150 pts each and 300 more for all three.
- **Achievements and titles**: 21 achievements (First Blood, Dragonslayer, level milestones, Millionaire, Raid MVP, Duelist, 7-day streak, museum collections...). Many unlock a title; `!title the Dragonslayer` shows it next to your name on the site and in `!stats`. `!achievements` lists yours; the character page shows them all.
- **Museum**: `!donate` digging finds. Each pays 3x its value; finishing one of 6 collections (coins, relics, fossils, a pirate's haul, royal treasures, wonders of the world) pays 1,500 to 150,000 pts and a title. `!museum` shows your progress.
- **Seasons**: the Season leaderboard counts XP earned this season (`!season`). Ending a season on the Events page gives the top 3 a permanent title and starts everyone at 0 again; nobody loses their levels.
- **Trading**: `!give @name iron ore 5` or `!give @name 500`. Both players need some history in the game (24 hours and 20 actions by default), and each player can give 10,000 points a day. All adjustable.
- Extra commands: `!eat [food]`, `!fire`, `!buffs`, `!targets [bow]`, `!quiver`, `!hp`, `!drink [potion]`, `!heal`, `!monsters`, `!scout <monster>`, `!equip <item>`, `!unequip <slot>`, `!equipped`, `!shop`, `!buy <item>`, `!gear`, `!rod`/`!pickaxe`/`!axe`/`!shovel`/`!furnace`, `!upgrade <tool>`, `!upgrade backpack`, `!stats [name]`, `!inv`, `!sell <item> [amount|all]`, `!points`, `!top [skill|points]`, `!casino`, `!commands`.
- **Races and looks**: every character starts as a random race (Human, Elf, Dwarf, Orc, Halfling or Undead) with a random look, drawn as a portrait on their character page. On the website's **Customize** page players change their skin tone, hairstyle, hair color, facial hair (stubble, mustache, handlebar, goatee, beards), eyes, eyebrows, nose, mouth, extras (freckles, scar, eyepatch, earring...) and outfit color any time, and pick a new race once every 30 days (`RACE_CHANGE_DAYS`). Each race has perks and drawbacks: Humans +5% XP everywhere and +5% sell prices; Elves +15% Archery/Woodcutting/Farming/Alchemy XP and +20% mana but -15% HP; Dwarves +15% Mining/Smelting/Smithing XP, +15% HP and +10% defence but -15% Archery/Magic XP; Orcs +15% attack, +15% Swords/Skinning XP and +10% HP but -10% Cooking/Crafting/Alchemy XP and -10% sell prices; Halflings +1 stamina charge and +15% Fishing/Cooking/Farming XP but -10% attack and HP; Undead +15% Magic/Alchemy XP, +25% mana and +15% rare finds but food heals half as much. `!race` (or `!race elf`) shows them in chat. Admins can switch perks off (`RACE_PERKS`) to make races cosmetic only.
- **Stamina**: every viewer has 3 charges (`STAMINA_MAX`). Every game action (skilling, fighting, farming, raid `!attack`) uses one, except `!cook` on a lit fire; using the first charge from a full bar starts a 5-minute timer (`STAMINA_MINUTES`), and when it runs out the bar is back to full. Out of stamina warns once per refill, so spamming doesn't flood chat. `!stamina` shows your bar, and the character page shows it too. Both numbers are editable on Admin → Settings.
- **Website**: home page with live feed and top players, character sheets, per-skill leaderboards, and a "How to play" guide generated from the game data.
- **Admin page**:
  - **Overview**: Kick connection status and the bot account.
  - **Settings**: edit live, with no redeploy. Covers the command prefix, cooldowns, chat points (and anti-farming rules), reply on/off, extra admins, XP/points/sell multipliers, event rewards and timers, casino limits, switching individual commands on and off, and every tool's, backpack's and shop item's price and stats.
  - **Players**: search players; give or take points and items; ban someone from the game (the bot ignores their chat) or reset their progress.
  - **Economy**: points held and ever earned, where points come from (chat, actions, selling, rewards) and go (shop, casino), the casino's result, and the biggest earners.
  - **Events**: start or end a raid, start or stop a boost, pop a random event, see if the stream is live, and end the season.
  - **Tools**: download a backup of the whole database, or upload one to restore it (the server restarts to load it and keeps the old database as `.before-restore`).
  - **Logs**: chat commands and bot replies, Kick/webhook errors, logins and admin changes. Filter by level, source or text, with live tail. Kept for 14 days.
- **OBS overlay** at `/overlay.html` showing live actions on stream, with level-ups, rare finds, follows, subs, raids and achievements highlighted, a raid boss health bar and boost banner at the top (`&raid=0` hides them), plus a test button on the admin page.
- **Busy chat**: when replies queue up, they're sent combined in one message instead of one every 1.2 seconds, so replies don't arrive late.
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
  game/engine.js   chat handling, player profiles and the guide
  game/features/   game rules by area: skilling, combat, vitals (HP/mana/potions), shop,
                   farming, info, casinoGames, events (raids, duels, follows/subs),
                   museum, progression (dailies, achievements, seasons, trading)
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
| `PUBLIC_URL` | *(optional)* your own domain, e.g. `https://mmo.yourchannel.com` (a bare `mmo.yourchannel.com` works too). Without it, Railway's generated domain is used |

Everything else is optional (see `.env.example`). `PUBLIC_URL`, `DB_PATH` and `SESSION_SECRET` are worked out automatically. Railway redeploys when you save.

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

### Using your own domain
1. In Railway, open the service → **Settings → Networking → Custom Domain**, add your domain (e.g. `mmo.yourchannel.com`) and create the DNS record it shows you at your domain provider.
2. Set `PUBLIC_URL` to that domain in the service's **Variables** tab. The Kick login redirect, the webhook URL, the links the bot posts in chat and the overlay link all use it. **Admin → Settings** shows the site URL in use and where it came from.
3. On kick.com → Settings → Developer, change your app's **Redirect URL** to `https://<your-domain>/auth/callback` and **Webhook URL** to `https://<your-domain>/webhooks/kick`. Kick only accepts the URLs registered there, so login and chat stop working until they match.

The older `BASE_URL` variable still works; `PUBLIC_URL` wins if both are set.

### 5. Add the overlay (optional)
In OBS, go to **Sources → + → Browser** and paste `https://<your-domain>/overlay.html`, with width 400 and height 600. It shows "MMOBot overlay connected" for a few seconds when it loads, then every action as it happens, with level-ups, rare finds and upgrades highlighted. **Admin → Overview → OBS overlay** builds the link for you: every action or only the big moments (`?events=big`), how long each stays on screen and how many show at once. Its **Send test event** button pops a sample message onto every open overlay, so you can check your OBS setup without anyone playing.

### Testing with real Kick chat on your computer
Kick can only deliver webhooks to a public URL. Run a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`), set `PUBLIC_URL` to the tunnel URL in `.env`, and point a second Kick app's redirect and webhook URLs at it. Or just deploy to Railway and test there.

## Customizing

- **Game content**: edit `src/game/skills.js` to change items, XP values, unlock levels, sell prices, rare-drop odds and fail messages. The website's guide page updates automatically.
- **Pacing and prices**: change them on **Admin → Settings**. They take effect immediately and are stored in the database. The `STAMINA_MAX`, `STAMINA_MINUTES`, `CHAT_POINTS` and similar variables only set the starting defaults. Change the level curve in `src/game/xp.js`.
- **Tools**: prices and stats are editable live on **Admin → Settings**. Tool names and icons are in each skill's `tool` block in `skills.js`, and the shared price/stat ladder is `TOOL_LADDER`.
- **Level caps**: set `maxLevel` on a skill (all current skills use 500; the default is 99).
- **New skill**: add an entry to `SKILLS` in `skills.js` (with `command`, `resources` and `rares`), add its items to `ITEMS`, and add a color variable `--<skillid>` in `public/styles.css`. Existing players get the new skill automatically.
- **Quiet mode**: `REPLY_IN_CHAT=false` stops the bot from replying in chat. Progress still tracks and shows on the site and overlay.
