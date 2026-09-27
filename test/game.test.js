const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');
const { xpForLevel, levelForXp, progress } = require('../src/game/xp');

const baseConfig = {
  baseUrl: 'http://localhost:3000',
  game: { prefix: '!', actionCooldown: 30, chatPoints: 5, chatCooldown: 60, replyInChat: true },
};

function setup({ rolls } = {}) {
  const repo = openDb(':memory:');
  let t = 1_000_000;
  // rng returns 0.99 by default: never fails, never rare, picks the last weighted option.
  const queue = [...(rolls || [])];
  const engine = new GameEngine({ repo, config: baseConfig, rng: () => (queue.length ? queue.shift() : 0.99), now: () => t });
  const say = (content, username = 'Alice', kickUserId = '1') => engine.handleChat({ kickUserId, username, content }).reply;
  const tick = (sec = 31) => (t += sec * 1000);
  return { repo, engine, say, tick };
}

test('xp curve is monotonic and round-trips', () => {
  for (let l = 1; l < 99; l++) {
    assert.ok(xpForLevel(l + 1) > xpForLevel(l));
    assert.equal(levelForXp(xpForLevel(l)), l);
    assert.equal(levelForXp(xpForLevel(l + 1) - 1), l);
  }
  assert.equal(levelForXp(10 ** 9), 99);
  assert.equal(progress(10 ** 9).nextLevelXp, null);
});

test('chatting creates a character and awards points with a cooldown', () => {
  const { repo, say, tick } = setup();
  assert.equal(say('hello'), null);
  assert.equal(say('hello again'), null);
  const u = repo.getUserByName('alice');
  assert.equal(u.points, 5);
  assert.equal(u.message_count, 2);
  tick(61);
  say('hi');
  assert.equal(repo.getUserByName('alice').points, 10);
});

test('!fish gives an item, xp and points, then enforces cooldown', () => {
  const { repo, say, tick } = setup();
  const reply = say('!fish');
  assert.match(reply, /^@Alice 🎣 you caught 🦐 Shrimp! \+10 XP/);
  const u = repo.getUserByName('alice');
  assert.equal(repo.getSkills(u.id).fishing, 10);
  assert.equal(repo.getInventory(u.id).shrimp, 1);

  assert.match(say('!fish'), /catching your breath/);
  assert.equal(say('!fish'), null, 'only warns once per cooldown');
  tick();
  assert.match(say('!chop'), /Logs/);
});

test('all five skill commands work', () => {
  const { say, tick } = setup();
  for (const cmd of ['!fish', '!mine', '!chop', '!dig']) {
    assert.match(say(cmd), /\+\d+ XP/, cmd);
    tick();
  }
  assert.match(say('!smelt'), /nothing to smelt/);
});

test('targeted gathering respects level requirements', () => {
  const { say } = setup();
  assert.match(say('!mine iron'), /need ⛏️ Mining level 15/);
  assert.match(say('!mine banana'), /unknown target/);
  assert.match(say('!mine tin'), /Tin Ore/);
});

test('smelting consumes ores and produces bars', () => {
  const { repo, say, tick } = setup();
  say('!mine copper');
  tick();
  say('!mine tin');
  tick();
  const reply = say('!smelt');
  assert.match(reply, /smelted .*Bronze Bar/);
  const u = repo.getUserByName('alice');
  const inv = repo.getInventory(u.id);
  assert.equal(inv.copper_ore, undefined);
  assert.equal(inv.tin_ore, undefined);
  assert.equal(inv.bronze_bar, 1);
  assert.equal(repo.getSkills(u.id).smelting, 14);
});

test('level ups are announced with unlocks', () => {
  const { repo, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addXp(u.id, 'fishing', xpForLevel(5) - 5);
  assert.match(say('!fish'), /Fishing level 5! Unlocked: Sardine/);
});

test('failures and rare drops', () => {
  const fail = setup({ rolls: [0.0, 0.0] });
  assert.match(fail.say('!fish'), /better luck next time/);

  const rare = setup({ rolls: [0.5, 0.0] }); // no fail, first rare hits
  assert.match(rare.say('!fish'), /RARE .*Message in a Bottle/);
});

test('!sell converts items to points', () => {
  const { repo, say, tick } = setup();
  say('!fish');
  tick();
  say('!fish');
  const u = repo.getUserByName('alice');
  const before = repo.getUser(u.id).points;
  assert.match(say('!sell shrimp'), /sold 🦐 Shrimp for 2 pts/);
  assert.match(say('!sell all'), /sold 🦐 Shrimp for 2 pts/);
  assert.equal(repo.getUser(u.id).points, before + 4);
  assert.match(say('!sell all'), /empty/);
  assert.match(say('!sell gold'), /don't have/);
});

test('!stats, !inv, !top, !points and !commands respond', () => {
  const { say } = setup();
  say('!fish');
  say('hi', 'Bob', '2');
  assert.match(say('!stats'), /you are character level 1 \| 🎣2/);
  assert.match(say('!stats Bob'), /Bob is character level 1/);
  assert.match(say('!stats Nobody'), /no adventurer/);
  assert.match(say('!inv'), /Shrimp/);
  assert.match(say('!top'), /1\. Alice/);
  assert.match(say('!top fishing'), /Fishing: 1\. Alice Lv2/);
  assert.match(say('!points'), /points/);
  assert.match(say('!commands'), /!fish !mine !chop !dig !smelt/);
  assert.equal(say('!unknowncommand'), null);
});

test('profile exposes everything the website needs', () => {
  const { repo, engine, say } = setup();
  say('!fish');
  const p = engine.profile(repo.getUserByName('alice').id);
  assert.equal(p.skills.length, 5);
  assert.equal(p.skills[0].id, 'fishing');
  assert.equal(p.skills[0].level, 2);
  assert.equal(p.skills[0].rank, 1);
  assert.deepEqual(p.skills[0].nextUnlock, { level: 5, item: 'Sardine', icon: '🐟' });
  assert.equal(p.inventory[0].id, 'shrimp');
  assert.equal(p.character.level, 1);
});
