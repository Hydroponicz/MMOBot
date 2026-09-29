// Relic cases: odds, floats, patterns, SoulTrak™, trade-ups, selling back, the relic market and trades.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');
const { xpForLevel } = require('../src/game/xp');
const R = require('../src/game/relics');

function setup({ game = {}, rng = Math.random } = {}) {
  const repo = openDb(':memory:');
  let t = 1_000_000_000;
  const config = { baseUrl: 'http://localhost', game: { prefix: '!', staminaMax: 100, racePerks: false, petDropMultiplier: 0, chatPoints: 0, replyInChat: true, ...game } };
  const engine = new GameEngine({ repo, config, rng, now: () => t });
  Object.assign(engine.cfg, { tradeMinHours: 0, tradeMinActions: 0, relicFeedDelayMs: 0 });
  const a = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  const b = repo.upsertUser({ kickUserId: '2', username: 'Bob' });
  return { repo, engine, a, b, wait: (ms = 1000) => (t += ms) };
}
// Put a specific relic straight into someone's inventory.
const give = (repo, user, skin, float = 0.2, seed = 500, soul = false) => repo.relicInsert(user.id, { skin, float, seed, soul }, 'case', 1);
const skinsOf = (c, rarity) => Object.values(R.SKINS).filter((s) => s.case === c && s.rarity === rarity).map((s) => s.id);

test('catalog: three cases, every rarity, odds add up, cases return less than they cost', () => {
  assert.equal(R.CASES.length, 3);
  const odds = Object.values(R.RARITIES).reduce((s, r) => s + r.odds, 0);
  assert.ok(Math.abs(odds - 1) < 1e-9);
  for (const c of R.CASES) {
    for (const r of R.RARITY_IDS) assert.ok(skinsOf(c.id, r).length > 0, `${c.name} has ${r}`);
    assert.equal(skinsOf(c.id, 'relic').length, 8, 'two ★ weapons × four finishes');
    assert.ok(c.ev < c.price && c.ev > c.price * 0.75, `${c.id}: EV ${c.ev} vs ${c.price}`);
  }
  // Nothing in the catalog shoots bullets.
  for (const s of Object.values(R.SKINS)) assert.ok(!/gun|rifle|pistol|smg|sniper/i.test(`${s.weaponName} ${s.name}`));
});

test('floats set the exterior; each skin rolls inside its own float range', () => {
  assert.equal(R.exteriorOf(0.01).name, 'Forge Fresh');
  assert.equal(R.exteriorOf(0.1).name, 'Minimal Wear');
  assert.equal(R.exteriorOf(0.2).name, 'Field-Tested');
  assert.equal(R.exteriorOf(0.4).name, 'Well-Worn');
  assert.equal(R.exteriorOf(0.9).name, 'Battle-Scarred');
  let seed = 3;
  const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const counts = {};
  for (let i = 0; i < 20000; i++) {
    const r = R.openCase('frostbite', rng);
    const s = R.SKINS[r.skin];
    assert.ok(r.float >= s.min && r.float <= s.max, `${r.skin} float ${r.float}`);
    assert.ok(r.seed >= 0 && r.seed < 1000);
    counts[s.rarity] = (counts[s.rarity] || 0) + 1;
  }
  assert.ok(counts.adept / 20000 > 0.77 && counts.adept / 20000 < 0.83);
  assert.ok((counts.relic || 0) < 20000 * 0.01);
});

test('patterns: fade %, gem phases and rare patterns change the value', () => {
  const gem = 'dragonfire-fang-gem';
  assert.equal(R.patternOf(gem, 3).label, 'Sapphire');
  assert.equal(R.patternOf(gem, 12).label, 'Ruby');
  assert.equal(R.patternOf(gem, 30).label, 'Black Pearl');
  assert.equal(R.patternOf(gem, 41).label, 'Emerald');
  assert.match(R.patternOf(gem, 500).label, /^Phase [1-4]$/);
  const base = { skin: gem, float: 0.03, soul: false };
  assert.ok(R.valueOf({ ...base, seed: 12 }) > 3 * R.valueOf({ ...base, seed: 500 }));
  const fade = R.patternOf('dragonfire-10', 7);
  assert.match(fade.label, /^\d+% Fade$/);
  assert.ok(fade.fade >= 80 && fade.fade <= 100);
  // SoulTrak™ and very low floats are worth more.
  const x = { skin: 'dragonfire-1', float: 0.05, seed: 1 };
  assert.ok(R.valueOf({ ...x, soul: true }) > R.valueOf(x) * 1.7);
  assert.ok(R.valueOf({ ...x, float: 0.005 }) > R.valueOf(x));
});

test('opening cases costs points and stores each relic; only 1-5 at a time', () => {
  const { repo, engine, a, wait } = setup();
  assert.match(engine.relicOpen(a, 'dragonfire').error, /you need 1,000 pts/);
  repo.addPoints(a.id, 10_000);
  const r = engine.relicOpen(a, 'dragonfire', 3);
  assert.equal(r.ok, true);
  assert.equal(r.relics.length, 3);
  assert.equal(repo.getUser(a.id).points, 7000);
  for (const x of r.relics) {
    assert.equal(x.case, 'dragonfire');
    assert.equal(x.owner, 'Alice');
    assert.ok(x.exterior && x.value > 0);
  }
  assert.match(engine.relicOpen(a, 'dragonfire').error, /easy!/);
  wait();
  assert.match(engine.relicOpen(a, 'dragonfire', 6).error, /1 to 5/);
  assert.equal(engine.relicOpen(a, 'nope').error, 'no such case.');
  engine.cfg.relicsEnabled = false;
  assert.match(engine.relicOpen(a, 'dragonfire').error, /switched off/);
});

test('big unboxings are announced and go on the feed', () => {
  const { repo, engine, a } = setup({ rng: () => 0.9999 });
  const said = [];
  const feed = [];
  engine.on('announce', (t) => said.push(t));
  engine.on('activity', (e) => feed.push(e));
  repo.addPoints(a.id, 10_000);
  const r = engine.relicOpen(a, 'shadowveil');
  assert.equal(r.relics[0].star, true, 'rng 0.9999 lands on the ★ slot');
  assert.match(said[0], /Alice just unboxed .*★/);
  assert.equal(feed.at(-1).kind, 'unbox');
});

test('SoulTrak™ counts fights won while showcased', () => {
  const { repo, engine, a } = setup();
  const id = give(repo, a, 'dragonfire-1', 0.1, 5, true);
  const plain = give(repo, a, 'dragonfire-2');
  assert.equal(engine.relicSetShowcase(a, id).ok, true);
  assert.match(engine.relicSetShowcase(a, 999).error, /not your relic/);
  repo.addXp(a.id, 'swords', xpForLevel(10));
  repo.addItem(a.id, 'bronze_sword', 1);
  assert.match(engine.handleChat({ kickUserId: '1', username: 'Alice', content: '!fight chicken' }).reply, /defeated/);
  assert.equal(repo.relicGet(id).kills, 1);
  engine.relicSetShowcase(a, plain);
  engine.relicKill(a);
  assert.equal(repo.relicGet(plain).kills, 0, 'only SoulTrak™ relics count');
  assert.match(engine.handleChat({ kickUserId: '1', username: 'Alice', content: '!relics' }).reply, /2 relics worth .* showcasing .*#\/relics/);
});

test('trade-up contracts: 10 of a rarity → 1 of the next, float averaged, no mixing', () => {
  const { repo, engine, a } = setup();
  const adepts = skinsOf('frostbite', 'adept');
  const ids = Array.from({ length: 10 }, (_, i) => give(repo, a, adepts[i % adepts.length], R.SKINS[adepts[i % adepts.length]].min));
  assert.match(engine.relicTradeUpPreview(a, ids.slice(0, 9)).error, /exactly 10/);
  const soulId = give(repo, a, adepts[0], 0.1, 1, true);
  assert.match(engine.relicTradeUpPreview(a, [...ids.slice(0, 9), soulId]).error, /can't be mixed/);
  const mixed = give(repo, a, skinsOf('frostbite', 'heroic')[0]);
  assert.match(engine.relicTradeUpPreview(a, [...ids.slice(0, 9), mixed]).error, /same rarity/);
  const pv = engine.relicTradeUpPreview(a, ids);
  assert.equal(pv.ok, true);
  assert.equal(pv.next, 'heroic');
  assert.ok(Math.abs(pv.outcomes.reduce((s, o) => s + o.chance, 0) - 1) < 1e-9);
  for (const o of pv.outcomes) assert.equal(o.float, R.SKINS[o.skin].min, 'lowest-float inputs give the lowest float out');
  const r = engine.relicTradeUp(a, ids);
  assert.equal(r.ok, true);
  assert.equal(r.relic.rarity, 'heroic');
  assert.equal(r.relic.case, 'frostbite');
  for (const id of ids) assert.equal(repo.relicGet(id).status, 'used');
  assert.match(engine.relicTradeUp(a, ids).error, /must be yours/);
  // 5 Exalted make a ★ relic.
  const ex = skinsOf('dragonfire', 'exalted');
  const five = Array.from({ length: 5 }, (_, i) => give(repo, a, ex[i % 2], 0.3));
  assert.equal(engine.relicTradeUp(a, five).relic.star, true);
});

test('selling back, the relic market and trades', () => {
  const { repo, engine, a, b } = setup();
  repo.addPoints(b.id, 100_000);
  const x = give(repo, a, 'dragonfire-6', 0.1);
  const y = give(repo, a, 'dragonfire-1');
  const z = give(repo, b, 'frostbite-1');
  const val = R.valueOf({ skin: 'dragonfire-1', float: 0.2, seed: 500 });
  assert.equal(engine.relicSellBack(a, [y]).points, Math.floor(val * 0.6));
  assert.equal(engine.relicSellBack(a, [y]).ok, false, 'already sold');
  // Market.
  assert.match(engine.relicList(a, x, 1e9).error, /too expensive/);
  assert.equal(engine.relicList(a, x, 1000).ok, true);
  assert.equal(engine.relicSellBack(a, [x]).ok, false, 'listed relics stay listed');
  assert.equal(engine.relicListings().length, 1);
  assert.equal(engine.relicBuy(b, x).ok, true);
  assert.equal(repo.getUser(a.id).points, Math.floor(val * 0.6) + 950, '5% fee');
  assert.equal(repo.relicGet(x).owner_id, b.id);
  // Trades.
  const w = give(repo, a, 'shadowveil-1');
  const off = engine.relicTradeOffer(b, { to: 'Alice', give: [z], want: [w], pointsGive: 10 });
  assert.equal(off.ok, true, off.error);
  assert.equal(engine.relicTrades(a.id)[0].incoming, true);
  assert.equal(engine.relicTradeAccept(a, off.id).ok, true);
  assert.equal(repo.relicGet(z).owner_id, a.id);
  assert.equal(repo.relicGet(w).owner_id, b.id);
  // New players can't use the market.
  engine.cfg.tradeMinActions = 20;
  assert.match(engine.relicList(a, z, 100).error, /new players can't/);
});

test('admin reset takes relics away and undo gives them back', () => {
  const { repo, engine, a } = setup();
  give(repo, a, 'dragonfire-1');
  give(repo, a, 'dragonfire-2');
  const snap = repo.snapshotPlayer(a.id);
  repo.resetPlayer(a.id);
  assert.equal(engine.relicInventory(a.id).relics.length, 0);
  repo.restorePlayer(a.id, snap);
  assert.equal(engine.relicInventory(a.id).relics.length, 2);
});

test('the bank: a fifth of the rate above the full-rate value, and a daily limit', () => {
  const { repo, engine, a } = setup();
  engine.cfg.bankFullValue = 5000;
  assert.equal(engine.bankPay(1000, 0.6), 600);
  assert.equal(engine.bankPay(50_000, 0.6), 8400, '0.6 × (5,000 + 45,000 / 5)');
  // A ★ Ruby jackpot no longer pays out a million points.
  const jackpot = give(repo, a, 'dragonfire-fang-gem', 0.004, 12, true);
  const v = engine.relicView(repo.relicGet(jackpot));
  assert.ok(v.value > 1_000_000);
  assert.ok(v.buyback < v.value * 0.15, `buyback ${v.buyback} for value ${v.value}`);
  // Daily limit: sells what fits, keeps the rest, explains why.
  engine.cfg.bankDailyLimit = 100;
  const small = [give(repo, a, 'dragonfire-1', 0.2), give(repo, a, 'dragonfire-2', 0.2), give(repo, a, 'dragonfire-3', 0.2)];
  const r = engine.relicSellBack(a, small);
  assert.equal(r.ok, true);
  assert.ok(r.points <= 100);
  assert.ok(r.skipped >= 1);
  assert.match(r.message, /kept: the bank pays out at most 100 pts a day/);
  assert.match(engine.relicSellBack(a, [jackpot]).error, /the bank can only pay .* more pts today .* List it on the market instead/);
  assert.equal(repo.relicGet(jackpot).status, 'owned');
  // Cards share the same daily limit.
  const card = repo.cardInsert(a.id, { card: 'wildlands-01', finish: 'normal', wear: 0.1, q: [0, 0, 0, 0, 0, 0, 0, 0] }, 'test', 1);
  const left = engine.bankRoom(a.id);
  const cr = engine.cardSellBack(a, [card]);
  if (left >= engine.cardView(repo.cardGet(card)).buyback) assert.equal(cr.ok, true);
  else assert.match(cr.error, /the bank can only pay/);
});

test('market values follow real sales, but the bank never pays above catalog value', () => {
  const { repo, engine } = setup();
  const users = ['C', 'D', 'E', 'F'].map((n, i) => repo.upsertUser({ kickUserId: String(10 + i), username: n }));
  const skin = 'frostbite-6';
  const base = (id) => engine.relicView(repo.relicGet(id)).baseValue;
  const probe = give(repo, users[0], skin, 0.2);
  const before = engine.relicView(repo.relicGet(probe));
  assert.equal(before.marketFactor, 1);
  // Two sales aren't enough; three by different sellers and buyers are.
  engine.recordSale('relic', skin, Math.round(base(probe) * 1.5), base(probe), users[1].id, users[2].id);
  engine.recordSale('relic', skin, Math.round(base(probe) * 1.5), base(probe), users[2].id, users[3].id);
  assert.equal(engine.relicView(repo.relicGet(probe)).marketFactor, 1);
  engine.recordSale('relic', skin, Math.round(base(probe) * 1.5), base(probe), users[3].id, users[1].id);
  const after = engine.relicView(repo.relicGet(probe));
  assert.equal(after.marketFactor, 1.5);
  assert.equal(after.value, Math.round(before.baseValue * 1.5));
  assert.equal(after.buyback, before.buyback, 'pumping the price between friends earns nothing from the bank');
  // Prices below catalog pull the bank price down too; factors stay between 0.5 and 2.
  const skin2 = 'frostbite-7';
  const p2 = give(repo, users[0], skin2, 0.2);
  for (const [b, s] of [[1, 2], [2, 3], [3, 1]]) engine.recordSale('relic', skin2, 1, base(p2), users[b].id, users[s].id);
  const cheap = engine.relicView(repo.relicGet(p2));
  assert.equal(cheap.marketFactor, 0.5);
  assert.ok(cheap.buyback < engine.bankPay(cheap.baseValue, 0.6));
});
