#!/usr/bin/env node
// Load test: a busy stream in one process. Hundreds of chatters send commands (the way Kick's webhook
// delivers them), while overlay/site viewers hold live-event connections and browse the website.
// Uses a throwaway database file, so your real data is never touched.
//
//   npm run loadtest -- [--chatters 200] [--seconds 60] [--rate 6] [--viewers 30]
//
// --rate is messages per chatter per minute (6 = one every 10s, a very busy chat).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const CHATTERS = arg('chatters', 200);
const SECONDS = arg('seconds', 60);
const RATE = arg('rate', 6);
const VIEWERS = arg('viewers', 30);

const COMMANDS = ['!fish', '!mine', '!chop', '!dig', '!fight', '!stats', '!inv', '!sell all', '!daily', '!quest', '!attack', '!slots 10', '!cook all', '!stamina', 'lol', 'gg', 'hello'];

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmobot-load-'));
  const dbPath = path.join(dir, 'load.db');
  const repo = openDb(dbPath);
  const config = {
    port: 0,
    baseUrl: 'http://localhost',
    sessionSecret: 'load-test',
    kick: { clientId: '', clientSecret: '', channel: 'loadtest', verifyWebhooks: false, oauthBase: 'https://id.kick.com', apiBase: 'https://api.kick.com' },
    game: { ...require('../src/config').game, replyInChat: false },
    adminUsers: [],
    devMode: false,
    dbPath,
    persistentStorage: true,
  };
  const quiet = { info() {}, log() {}, warn() {}, error: (...a) => console.error(...a) };
  const { app, engine, bot } = createApp({ config, repo, logger: quiet });
  const server = await new Promise((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  // Give everyone some points and a sword so every command does real work.
  for (let i = 0; i < CHATTERS; i++) {
    const u = repo.upsertUser({ kickUserId: String(i + 1), username: `load${i + 1}` });
    repo.addPoints(u.id, 5000);
    repo.addItem(u.id, 'bronze_sword', 1);
  }
  engine.startRaid({ hpMultiplier: 5000 });

  // Live-event viewers (overlay / site): count what they receive.
  let events = 0;
  const controllers = [];
  for (let i = 0; i < VIEWERS; i++) {
    const ac = new AbortController();
    controllers.push(ac);
    fetch(`${url}/api/events`, { signal: ac.signal })
      .then(async (res) => {
        for await (const chunk of res.body) events += (String(Buffer.from(chunk)).match(/\nevent: /g) || []).length;
      })
      .catch(() => {});
  }

  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const handleTimes = [];
  const httpTimes = [];
  let sent = 0;
  let replies = 0;
  let errors = 0;
  const end = Date.now() + SECONDS * 1000;
  const perSecond = (CHATTERS * RATE) / 60;

  // Chat: spread messages evenly across each second.
  const chat = setInterval(() => {
    const n = Math.round(perSecond / 10 + Math.random() - 0.5);
    for (let k = 0; k < n; k++) {
      const i = Math.floor(Math.random() * CHATTERS);
      const t = performance.now();
      try {
        const r = bot.handleMessage({ kickUserId: String(i + 1), username: `load${i + 1}`, content: COMMANDS[Math.floor(Math.random() * COMMANDS.length)] });
        if (r) replies++;
      } catch (err) {
        errors++;
        if (errors < 5) console.error('handleMessage failed:', err.message);
      }
      handleTimes.push(performance.now() - t);
      sent++;
    }
  }, 100);

  // Website: viewers browsing pages.
  const pages = ['/api/site', '/api/leaderboard/overall?limit=100', '/api/activity', `/api/player/load${1 + Math.floor(Math.random() * CHATTERS)}`, '/api/shop', '/api/hall', '/api/guilds', '/api/market'];
  const browse = setInterval(() => {
    for (let v = 0; v < Math.ceil(VIEWERS / 10); v++) {
      const t = performance.now();
      fetch(url + pages[Math.floor(Math.random() * pages.length)])
        .then((r) => r.arrayBuffer().then(() => (r.ok ? httpTimes.push(performance.now() - t) : errors++)))
        .catch(() => errors++);
    }
  }, 500);
  const ticker = setInterval(() => engine.tick(), 10_000);

  const mem0 = process.memoryUsage().rss;
  process.stdout.write(`Running: ${CHATTERS} chatters × ${RATE}/min (${perSecond.toFixed(1)} msg/s), ${VIEWERS} live viewers, ${SECONDS}s…\n`);
  await new Promise((ok) => setTimeout(ok, end - Date.now()));
  clearInterval(chat);
  clearInterval(browse);
  clearInterval(ticker);
  await new Promise((ok) => setTimeout(ok, 1000));
  loop.disable();
  for (const ac of controllers) ac.abort();
  server.close();

  const pct = (xs, p) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
  };
  const ms = (x) => `${x.toFixed(1)} ms`;
  const dbSize = fs.statSync(dbPath).size + (fs.existsSync(`${dbPath}-wal`) ? fs.statSync(`${dbPath}-wal`).size : 0);
  const lines = [
    '',
    '# Load test',
    '',
    `| | |`,
    `|---|---|`,
    `| Chat messages handled | ${sent.toLocaleString()} (${(sent / SECONDS).toFixed(1)}/s), ${replies.toLocaleString()} replies |`,
    `| Time per chat message | p50 ${ms(pct(handleTimes, 50))} · p95 ${ms(pct(handleTimes, 95))} · p99 ${ms(pct(handleTimes, 99))} · max ${ms(Math.max(0, ...handleTimes))} |`,
    `| Website requests | ${httpTimes.length.toLocaleString()} · p50 ${ms(pct(httpTimes, 50))} · p95 ${ms(pct(httpTimes, 95))} |`,
    `| Live events delivered | ${events.toLocaleString()} to ${VIEWERS} viewers |`,
    `| Event loop delay | p99 ${ms(loop.percentile(99) / 1e6)} · max ${ms(loop.max / 1e6)} |`,
    `| Errors | ${errors} |`,
    `| Memory | ${Math.round(process.memoryUsage().rss / 1048576)} MB (started at ${Math.round(mem0 / 1048576)} MB) |`,
    `| Database size | ${(dbSize / 1048576).toFixed(1)} MB |`,
    '',
    pct(handleTimes, 99) < 20 && loop.percentile(99) / 1e6 < 100 && !errors ? '✅ Keeps up comfortably.' : '⚠️ Under strain: see the numbers above.',
  ];
  console.log(lines.join('\n'));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(errors ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
