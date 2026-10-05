const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');
const { FISH, SPOTS, rollSize, fmtLength, fmtWeight } = require('../src/game/fish');
const { SKILLS } = require('../src/game/skills');
const { xpForLevel } = require('../src/game/xp');

const config = {
  baseUrl: 'http://localhost:3000',
  game: { prefix: '!', staminaMax: 100, staminaMinutes: 0.5, racePerks: false, petDropMultiplier: 0, chatPoints: 0, chatCooldown: 60, replyInChat: true },
};

function setup() {
  const repo = openDb(':memory:');
  let t = 1_000_000;
  // 0.99: never fails, never rare, picks the last weighted option.
  const engine = new GameEngine({ repo, config, rng: () => 0.99, now: () => t });
  const say = (content, name = 'Alice', id = '1') => {
    t += 31_000;
    return engine.handleChat({ kickUserId: id, username: name, content }).reply;
  };
  say('hi');
  say('hi', 'Bob', '2');
  const u = repo.getUserByName('alice');
  const bob = repo.getUserByName('bob');
  repo.setEquipment(u.id, 'backpack', 9);
  repo.setEquipment(bob.id, 'backpack', 9);
  return { repo, engine, say, u, bob };
}

test('every fish and fishing spot has a size profile, and sizes stay sensible', () => {
  for (const r of SKILLS.fishing.resources) assert.ok(FISH[r.item], `${r.item} has a size`);
  for (const s of SPOTS) for (const f of s.fish) assert.ok(FISH[f], `${s.id}: ${f}`);
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [id, [min, max, wMax]] of Object.entries(FISH)) {
    for (let i = 0; i < 300; i++) {
      const s = rollSize(id, rng);
      assert.ok(s.length >= min && s.length <= max * 1.25 + 0.1, `${id} length ${s.length}`);
      assert.ok(s.weight > 0 && s.weight <= wMax * 1.25 ** 3 * 1.1 + 0.01, `${id} weight ${s.weight}`);
    }
  }
  assert.equal(fmtLength(42.3), '42.3 cm');
  assert.equal(fmtLength(238), '2.38 m');
  assert.equal(fmtWeight(0.016), '16 g');
  assert.equal(fmtWeight(1.234), '1.23 kg');
  assert.equal(fmtWeight(1500), '1.5 t');
});

test('!fish in chat still works, and says the length and weight with a link to the 3D page', () => {
  const { repo, say, u } = setup();
  const r = say('!fish');
  assert.match(r, /you caught 🦐 Shrimp \(📏 [\d.]+ cm, \d+ g[^)]*\)! \+10 XP.*🐟 See all your catches in 3D: http:\/\/localhost:3000\/#\/fishing/);
  const rows = repo.catchesOf(u.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fish, 'shrimp');
  assert.equal(rows[0].spot, null);
  assert.equal(repo.getInventory(u.id).shrimp, 1);
});

test('personal bests and records: flagged in the reply, announced when a big record falls', () => {
  const { engine, u, bob } = setup();
  const announced = [];
  engine.announce = (t) => announced.push(t);
  const sizes = [0.5, 0.5, 0.5, 0.5]; // mid-size
  engine.sizeRng = () => sizes.shift() ?? 0.5;
  const first = engine.recordCatch(u, 'trout');
  assert.equal(first.best.first, true);
  assert.equal(first.best.pb, false);
  // A bigger one for Bob: a record, but a middling fish, so no announcement.
  engine.sizeRng = (() => { const q = [0.7, 0.7, 0.7, 0.9, 0.5]; return () => q.shift() ?? 0.5; })();
  const b = engine.recordCatch(bob, 'trout');
  assert.equal(b.best.record, true);
  assert.match(b.text, /NEW RECORD/);
  assert.equal(announced.length, 0);
  // A trophy (the 1 in 40 roll) beats it: record and announced.
  engine.sizeRng = (() => { const q = [0.5, 0.5, 0.5, 0.001, 0.8, 0.9]; return () => q.shift() ?? 0.5; })();
  const t = engine.recordCatch(u, 'trout');
  assert.equal(t.best.trophy, true);
  assert.equal(t.best.record, true);
  assert.equal(announced.length, 1);
  assert.match(announced[0], /record 🐟 Trout: [\d.]+ cm, [\d.]+ kg, beating Bob's/);
  const page = engine.fishingPage(u.id);
  const trout = page.species.find((s) => s.id === 'trout');
  assert.equal(trout.record.username, 'Alice');
  assert.equal(trout.best.id, t.catches[0].id);
});

test('fishing spots: locked by level, and a spot only gives its own fish', () => {
  const { repo, engine, u } = setup();
  assert.match(engine.castAt(u, 'river').error, /Silverrun River needs 🎣 Fishing level 20/);
  assert.match(engine.castAt(u, 'nowhere').error, /no such fishing spot/);
  repo.addXp(u.id, 'fishing', xpForLevel(45));
  // rng 0.99 would pick Harbor's best unlocked fish (tuna at 40)...
  const harbor = engine.castAt(u, 'harbor');
  assert.equal(harbor.catches[0].fish, 'tuna');
  assert.equal(harbor.catches[0].spot, 'harbor');
  // ...while the river only has trout, salmon and herring.
  const river = engine.castAt(u, 'river');
  assert.ok(['trout', 'salmon', 'herring'].includes(river.catches[0].fish));
  assert.match(river.reply, /you caught/);
  assert.doesNotMatch(river.reply, /See all your catches/, 'no link when already on the page');
  const page = engine.fishingPage(u.id);
  assert.equal(page.spots.find((s) => s.id === 'open').locked, false);
  assert.equal(page.spots.find((s) => s.id === 'trench').locked, true);
  assert.equal(page.caught, 2);
  assert.equal(page.recent[0].spot, 'river');
});

test('pruning keeps each player\'s latest catches and every personal best, drops the rest', () => {
  const { openDb } = require('../src/db');
  const repo = openDb(':memory:');
  const u = repo.upsertUser({ kickUserId: '1', username: 'Fisher' });
  const t0 = Date.now();
  // A record-sized trout first, then 400 small shrimp.
  const big = repo.catchInsert(u.id, { fish: 'trout', length: 90, weight: 9 }, t0);
  for (let i = 0; i < 400; i++) repo.catchInsert(u.id, { fish: 'shrimp', length: 5, weight: 0.005 + i * 1e-6 }, t0 + i);
  repo.prune();
  assert.ok(repo.catchGet(big), 'the personal best survives');
  assert.equal(repo.catchBest(u.id, 'shrimp').weight, 0.005 + 399 * 1e-6);
  assert.equal(repo.catchCount(u.id), 301, '300 latest + the old best trout');
});
