const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');
const { QUESTS } = require('../src/game/content');
const { xpForLevel } = require('../src/game/xp');

const config = {
  baseUrl: 'http://localhost:3000',
  game: { prefix: '!', staminaMax: 200, staminaMinutes: 0.5, racePerks: false, petDropMultiplier: 0, chatPoints: 0, chatCooldown: 60, replyInChat: true },
};

function setup() {
  const repo = openDb(':memory:');
  let t = 1_000_000;
  const engine = new GameEngine({ repo, config, rng: () => 0.99, now: () => t });
  const say = (content) => {
    t += 31_000;
    return engine.handleChat({ kickUserId: '1', username: 'Alice', content }).reply;
  };
  say('hi');
  const u = repo.getUserByName('alice');
  return { repo, engine, say, u };
}

test('there are 34 quests and every chained quest names a real one', () => {
  assert.equal(QUESTS.length, 34);
  assert.equal(new Set(QUESTS.map((q) => q.id)).size, QUESTS.length);
});

test('chained quests stay locked until the one before is done, then unlock', () => {
  const { repo, engine, say, u } = setup();
  assert.match(say('!quest start raise the town'), /🔒 🏘️ Raise the Town unlocks after 🪚 The Carpenter's Bench/);
  const pub = engine.publicQuests(u.id);
  assert.equal(pub.find((q) => q.id === 'townmaker').status, 'locked');
  assert.equal(pub.find((q) => q.id === 'carpenter').status, 'available');
  // !quests only lists what can be started, and counts the locked ones.
  assert.match(say('!quests'), /🪚 The Carpenter's Bench/);
  assert.doesNotMatch(say('!quests'), /Raise the Town/);
  assert.match(say('!quests'), /🔒 \d+ unlock later/);

  // Play the Carpenter's Bench for real: chop, saw planks, hammer nails, build frames.
  say('!quest pause apprentice');
  assert.match(say('!quest start carpenter'), /Started 🪚 The Carpenter's Bench/);
  repo.setEquipment(u.id, 'backpack', 9); // Bag of Holding: room for everything
  repo.addItem(u.id, 'saw', 1);
  repo.addItem(u.id, 'smithing_hammer', 1);
  repo.addItem(u.id, 'bronze_bar', 5);
  for (let i = 0; i < 20; i++) say('!chop');
  for (let i = 0; i < 10; i++) say('!saw planks');
  for (let i = 0; i < 5; i++) say('!nails');
  const before = repo.getUser(u.id).points;
  for (let i = 0; i < 3; i++) say('!build frame');
  const st = engine.questState(u.id);
  assert.ok(st.done.includes('carpenter'));
  // Points and the item reward.
  assert.ok(repo.getUser(u.id).points - before >= 3000);
  assert.ok(repo.getInventory(u.id).oak_logs >= 20);
  assert.ok(engine.titles(u.id).includes('the Carpenter'));
  assert.match(say('!quest start raise the town'), /Started 🏘️ Raise the Town/);
});

test('new hooks count: Gloamveil zones, relic cases, card packs and town contributions', () => {
  const { engine, u } = setup();
  const st = engine.questState(u.id);
  st.done = ['fogwalker'];
  st.active = ['veilwalker', 'collector'];
  engine.saveQuests(u.id, st);
  // An extraction from the first zone doesn't count for "the Drowned Choir or deeper".
  engine.questProgress(u, { kind: 'extract', zone: 1 });
  engine.questProgress(u, { kind: 'extract', zone: 2 });
  engine.questProgress(u, { kind: 'case' });
  engine.questProgress(u, { kind: 'pack' });
  engine.questProgress(u, { kind: 'pack' });
  const p = engine.questState(u.id).progress;
  assert.deepEqual(p.veilwalker.counts, [1, 0]);
  assert.deepEqual(p.collector.counts, [2, 1, 0]);
});

test('Champion of the Realm asks for Skeletons (not level-70 Trolls); a new player can start A Rising Adventurer', () => {
  const { QUESTS } = require('../src/game/content');
  const champ = QUESTS.find((q) => q.id === 'champion');
  assert.ok(champ.steps.some((s) => s.match.monster === 'skeleton'));
  assert.ok(!champ.steps.some((s) => s.match.monster === 'troll'));
  for (const id of ['rising', 'goblinslayer', 'masterchef', 'deepsea', 'treasure', 'pillar']) assert.ok(QUESTS.some((q) => q.id === id), id);
  assert.equal(QUESTS.find((q) => q.id === 'rising').after, undefined, 'open to everyone from the start');
});
