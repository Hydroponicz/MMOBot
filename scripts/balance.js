#!/usr/bin/env node
// Balance simulator: plays simulated streams with the real game engine and reports how fast players
// level up, how many points they earn and spend, and how often rare things happen.
//
//   npm run balance -- [--players 40] [--days 28] [--streams 4] [--hours 3] [--seed 1] [--out report.md] [--old-rules]
//
// --old-rules turns off the bank limits, the chat points taper, bigger gathering hauls, gathering
// stations and supply-based sell prices, to compare against how things were.
// --no-rewards turns off stream redemptions and community projects (players never use them).
//
// --streams is streams per week, --hours how long each stream lasts. Settings come from your
// environment variables (same as the server), so you can try e.g. STAMINA_MAX=5 before changing it live.
process.env.NODE_NO_WARNINGS = '1';
const fs = require('node:fs');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');
const { SKILL_IDS, SKILLS, ITEMS } = require('../src/game/skills');
const { levelForXp, characterProgress } = require('../src/game/xp');
const config = require('../src/config');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const PLAYERS = Number(arg('players', 40));
const DAYS = Number(arg('days', 28));
const STREAMS = Number(arg('streams', 4));
const HOURS = Number(arg('hours', 3));
const SEED = Number(arg('seed', 1));
const OUT = arg('out', null);
const OLD_RULES = process.argv.includes('--old-rules');
const NO_REWARDS = process.argv.includes('--no-rewards');

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const pick = (list) => list[Math.floor(rnd() * list.length)];

// How the simulated viewers play.
const STYLES = {
  gatherer: (p) => (!OLD_RULES && p.n % 4 === 0 ? '!collect' : pick(['!fish', '!mine', '!chop', '!dig', '!fish', '!mine'])),
  crafter: (p) => (p.n % 4 === 3 ? pick(['!smelt', '!smith bronze sword', '!smith', '!fletch arrows']) : pick(['!mine copper', '!mine tin', '!mine', '!chop'])),
  fighter: () => pick(['!fight', '!fight', '!fight', '!chop']),
  farmer: (p) => (p.n % 3 === 0 ? pick(['!harvest', '!plant']) : pick(['!fish', '!chop', '!dig'])),
  gambler: (p) => (p.n % 3 === 0 ? pick(['!slots 5%', '!roulette red 5%', '!crash 5% 2x']) : pick(['!fish', '!mine'])),
  // Plays like a gatherer in chat; opens card packs and relic cases on the website (see collect()).
  collector: (p) => (!OLD_RULES && p.n % 5 === 0 ? '!collect' : pick(['!fish', '!mine', '!chop', '!dig'])),
};
// How much they play: chance per minute (while their stamina lasts) to use a charge.
const ACTIVITY = { casual: 0.08, regular: 0.25, grinder: 1 };

const game = { ...config.game, replyInChat: false, relicFeedDelayMs: 0 };
if (OLD_RULES) Object.assign(game, { bankDailyLimit: 0, bankFullValue: 0, chatPointsFullPerDay: 0, gatherBonusLevels: 0, priceSupplyScale: 0 });
const repo = openDb(':memory:');
let now = Date.UTC(2026, 0, 5);
const engine = new GameEngine({ repo, config: { ...config, game }, rng: mulberry32(SEED + 1), petRng: mulberry32(SEED + 2), now: () => now });
engine.on('announce', () => {});

const counts = { rares: 0, pets: 0, levelups: 0, knockouts: 0, dungeons: 0 };
engine.on('activity', (a) => {
  if (a.kind === 'rare') counts.rares++;
  if (a.kind === 'pet') counts.pets++;
  if (a.kind === 'levelup') counts.levelups++;
  if (a.kind === 'death') counts.knockouts++;
});

const styles = Object.keys(STYLES);
const levels = Object.keys(ACTIVITY);
const players = Array.from({ length: PLAYERS }, (_, i) => ({
  kickUserId: String(i + 1),
  username: `sim${i + 1}`,
  style: styles[i % styles.length],
  activity: levels[Math.floor(i / styles.length) % levels.length],
  n: 0,
  actions: 0,
  // Everyone watches most streams; casuals miss more.
  attendance: 0.6 + rnd() * 0.4,
}));
const say = (p, content) => engine.handleChat({ kickUserId: p.kickUserId, username: p.username, content }).reply;
// Everyone has a character from the start (someone who misses the first streams still shows in the report).
for (const p of players) repo.upsertUser({ kickUserId: p.kickUserId, username: p.username });

// Things players do between actions: sell when full, buy the basics, upgrade when rich.
function housekeeping(p) {
  const u = repo.getUserByKickId(p.kickUserId);
  const bag = engine.backpack(u.id);
  if (bag.used >= bag.capacity - 1) say(p, '!sell all');
  if (p.style === 'fighter' && !Object.keys(repo.getInventory(u.id)).some((id) => ITEMS[id]?.weaponType) && !repo.getWorn(u.id).weapon) say(p, '!buy sword');
  if (p.style === 'crafter' && !repo.getInventory(u.id).smithing_hammer) say(p, '!buy hammer');
  if (p.style === 'farmer' && !repo.getInventory(u.id).carrot_seeds) say(p, '!buy carrot seeds 3');
  if (p.style === 'fighter' && engine.vitals(u.id).hp < engine.vitals(u.id).maxHp * 0.3) say(p, '!drink');
  if (rnd() < 0.05) say(p, pick(['!upgrade backpack', '!upgrade rod', '!upgrade pickaxe', '!upgrade axe', '!upgrade shovel']));
}

// Collectors open a pack or a case when they can afford it, then sell everything back to the bank
// (the worst case for the economy: nobody keeps or trades anything).
function collect(p) {
  const u = repo.getUserByKickId(p.kickUserId);
  if (u.points < 3000) return;
  if (rnd() < 0.5) {
    const r = engine.cardOpenPacks(u, pick(['wildlands-booster', 'emberforge-booster', 'abyssal-booster', 'elite']));
    if (r.ok) engine.cardSellBack(u, r.packs.flat().map((c) => c.id));
  } else {
    const r = engine.relicOpen(u, pick(['dragonfire', 'frostbite', 'shadowveil']), 1);
    if (r.ok) engine.relicSellBack(u, r.relics.map((x) => x.id));
  }
}

// Players with points to spare sometimes spend them on the stream: a cheap effect, or a share of what
// they hold into the community project.
function streamRewards(p) {
  if (NO_REWARDS) return;
  const u = repo.getUserByKickId(p.kickUserId);
  if (u.points < 8000) return;
  if (rnd() < 0.5) engine.redeem(u, pick(['fireworks', 'fanfare', 'spotlight', 'fireworks', 'goblin']));
  else engine.projectFund(u, Math.floor(u.points * (0.05 + rnd() * 0.1)));
}

const weekly = [];
const snapshot = (day) => {
  const rows = players.map((p) => {
    const u = repo.getUserByKickId(p.kickUserId);
    const xp = repo.getSkills(u.id);
    const top = Math.max(...SKILL_IDS.map((id) => levelForXp(xp[id], SKILLS[id].maxLevel)));
    return { p, points: u.points, lifetime: u.lifetime_points, char: characterProgress(SKILL_IDS.map((id) => xp[id])).level, top };
  });
  weekly.push({ day, rows });
};

const DAY = 86_400_000;
const streamDays = new Set();
for (let d = 0; d < DAYS; d++) if ((d % 7) < STREAMS) streamDays.add(d);
const t0 = Date.now();
for (let d = 0; d < DAYS; d++) {
  const dayStart = Date.UTC(2026, 0, 5) + d * DAY;
  if (streamDays.has(d)) {
    now = dayStart + 18 * 3_600_000; // streams start at 18:00 UTC
    engine.channelEvent('livestream.status.updated', { is_live: true });
    const here = players.filter((p) => rnd() < p.attendance);
    for (const p of here) say(p, '!daily');
    for (let m = 0; m < HOURS * 60; m++) {
      now += 60_000;
      for (const p of here) {
        if (rnd() < 0.3) say(p, 'hello chat'); // chatting
        const u = repo.getUserByKickId(p.kickUserId);
        if (engine.stamina(u.id, now).charges <= 0 || rnd() > ACTIVITY[p.activity]) continue;
        housekeeping(p);
        p.n++;
        say(p, STYLES[p.style](p));
        p.actions++;
        if (p.style === 'collector' && rnd() < 0.3) collect(p);
        if (rnd() < 0.02) streamRewards(p);
      }
      if (m % 5 === 0) engine.tick();
    }
    engine.channelEvent('livestream.status.updated', { is_live: false });
  }
  if ((d + 1) % 7 === 0 || d === DAYS - 1) snapshot(d + 1);
}
engine.flushEconomy();
const secs = ((Date.now() - t0) / 1000).toFixed(1);

// ---- Report --------------------------------------------------------------------------------------
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const lines = [];
const out = (s = '') => lines.push(s);
out(`# Balance simulation`);
out();
out(`${PLAYERS} players · ${DAYS} days · ${STREAMS} streams/week of ${HOURS}h · seed ${SEED} · stamina ${game.staminaMax} per ${game.staminaMinutes} min · ${OLD_RULES ? "old rules (no bank limits, chat taper, stations, bigger hauls or supply prices)" : "current rules"}${NO_REWARDS ? ', no stream rewards' : ''} · ran in ${secs}s`);
out();
out(`## Progress by play style (end of week)`);
out();
out(`| Week | Style | Activity | Avg char level | Avg best skill | Median points held | Avg points earned |`);
out(`|---|---|---|---|---|---|---|`);
for (const w of weekly) {
  for (const s of styles) {
    for (const a of levels) {
      const rows = w.rows.filter((r) => r.p.style === s && r.p.activity === a);
      if (!rows.length) continue;
      out(`| ${Math.ceil(w.day / 7)} | ${s} | ${a} | ${avg(rows.map((r) => r.char)).toFixed(1)} | ${avg(rows.map((r) => r.top)).toFixed(1)} | ${fmt(median(rows.map((r) => r.points)))} | ${fmt(avg(rows.map((r) => r.lifetime)))} |`);
    }
  }
}
const last = weekly[weekly.length - 1].rows;
out();
out(`## Overall at the end`);
out();
out(`- Actions: ${fmt(players.reduce((s, p) => s + p.actions, 0))} (${fmt(avg(players.map((p) => p.actions)))} per player)`);
out(`- Character level: avg ${avg(last.map((r) => r.char)).toFixed(1)}, best ${Math.max(...last.map((r) => r.char))}`);
out(`- Points held: median ${fmt(median(last.map((r) => r.points)))}, richest ${fmt(Math.max(...last.map((r) => r.points)))}, total ${fmt(last.reduce((s, r) => s + r.points, 0))}`);
out(`- Rare finds ${fmt(counts.rares)}, pets ${fmt(counts.pets)}, level-ups ${fmt(counts.levelups)}, knockouts ${fmt(counts.knockouts)}`);
const econ = repo.getSetting('economy_stats') || {};
out();
out(`## Where points came from and went`);
out();
out(`| Flow | Points |`);
out(`|---|---|`);
for (const [k, label] of [
  ['chat', 'Earned chatting'],
  ['actions', 'Earned from actions'],
  ['sold', 'Earned selling'],
  ['rewards', 'Rewards (dailies, quests, events)'],
  ['shop', 'Spent in the shop / upgrades'],
  ['casinoWagered', 'Bet in the casino'],
  ['casinoPaid', 'Paid out by the casino'],
  ['fees', 'Market fees'],
  ['cardPacks', 'Spent on card packs'],
  ['cardGrading', 'Spent grading cards'],
  ['cardBuyback', 'Bank paid for cards'],
  ['relicCases', 'Spent on relic cases'],
  ['relicBuyback', 'Bank paid for relics'],
  ['redeems', 'Spent on stream redemptions'],
  ['projects', 'Given to community projects'],
]) out(`| ${label} | ${fmt(econ[k] || 0)} |`);
// Games of chance count both ways: kept points are spent, extra payouts are earned.
const games = [
  (econ.casinoWagered || 0) - (econ.casinoPaid || 0),
  (econ.cardPacks || 0) + (econ.cardGrading || 0) - (econ.cardBuyback || 0),
  (econ.relicCases || 0) - (econ.relicBuyback || 0),
];
const earned = (econ.chat || 0) + (econ.actions || 0) + (econ.sold || 0) + (econ.rewards || 0) + games.reduce((s, g) => s + Math.max(0, -g), 0);
const spent = (econ.shop || 0) + (econ.fees || 0) + (econ.redeems || 0) + (econ.projects || 0) + games.reduce((s, g) => s + Math.max(0, g), 0);
out();
out(`Earned ${fmt(earned)} vs spent ${fmt(spent)}: ${spent ? `${(earned / spent).toFixed(1)}x` : 'nothing spent'}. ${earned > spent * 1.5 ? 'Points are piling up faster than they are spent.' : 'Roughly balanced.'}`);
const alerts = engine.economyAlerts().alerts;
if (alerts.length) {
  out();
  out(`## Economy alerts`);
  for (const a of alerts) out(`- ${a.title}`);
}

const report = lines.join('\n');
if (OUT) fs.writeFileSync(OUT, `${report}\n`);
console.log(report);
