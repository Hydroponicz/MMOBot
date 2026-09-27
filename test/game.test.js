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
  assert.match(reply, /smelted .*Bronze Alloy/);
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

test('everyone starts with the Basic Rod; !rod shows it', () => {
  const { say } = setup();
  assert.match(say('!rod'), /🎣 Basic Rod: 18% snap chance, \+0% XP, rare finds x1 \(tier 1\/10\)\. Next: Oak Rod at Fishing level 50/);
});

test('!upgrade rod checks the Fishing level, then upgrades one tier at a time', () => {
  const { repo, engine, say } = setup();
  assert.match(say('!upgrade'), /usage: !upgrade rod/);
  assert.match(say('!upgrade sword'), /can't upgrade "sword"/);
  assert.match(say('!upgrade rod'), /can be upgraded to 🌳 Oak Rod at Fishing level 50 \(you are 1\)/);

  const u = repo.getUserByName('alice');
  repo.addXp(u.id, 'fishing', xpForLevel(120));
  assert.match(say('!upgrade rod'), /Oak Rod costs 2,000 pts, you have 5/);
  repo.addPoints(u.id, 12_000);
  assert.match(say('!upgrade rod'), /upgraded to 🌳 Oak Rod: 15% snap chance, \+10% XP, rare finds x1.1 for 2,000 pts! Next: Willow Rod at level 100 for 10,000 pts/);
  assert.equal(repo.getUser(u.id).points, 10_005);
  assert.match(say('!upgrade rod'), /upgraded to 🌿 Willow Rod/);
  assert.match(say('!upgrade rod'), /can be upgraded to 🍁 Maple Rod at Fishing level 150 \(you are 120\)/);
  assert.equal(engine.toolTier(u.id, 'fishing'), 2);

  const fishing = engine.profile(u.id).skills.find((s) => s.id === 'fishing');
  assert.equal(fishing.maxLevel, 500);
  assert.equal(fishing.tool.name, 'Willow Rod');
  assert.equal(fishing.tool.canUpgrade, false);
  assert.deepEqual(fishing.tool.next, { name: 'Maple Rod', icon: '🍁', level: 150, cost: 30000 });
});

test('the best rod is the last upgrade', () => {
  const { repo, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addXp(u.id, 'fishing', xpForLevel(500));
  repo.addPoints(u.id, 10_000_000);
  for (let i = 0; i < 9; i++) assert.match(say('!upgrade rod'), /upgraded to/);
  assert.match(say('!rod'), /🔱 Poseidon's Rod.*tier 10\/10.*best rod/);
  assert.match(say('!upgrade rod'), /already wield the best rod/);
});

test('every skill goes to level 500', () => {
  const { repo, engine } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addXp(u.id, 'fishing', 10 ** 9);
  repo.addXp(u.id, 'mining', 10 ** 9);
  const p = engine.profile(u.id);
  assert.equal(p.skills.find((s) => s.id === 'fishing').level, 500);
  assert.equal(p.skills.find((s) => s.id === 'mining').level, 500);
});

test('the rod sets the snap chance and boosts fishing XP', () => {
  // rolls: snap check, snap message; afterwards everything rolls 0.99 (no snap, no rare)
  const { repo, say, tick } = setup({ rolls: [0.16, 0.5] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  assert.match(say('!fish'), /better luck next time/, '0.16 < 18% Basic Rod snap chance');

  repo.addXp(u.id, 'fishing', xpForLevel(50));
  repo.setEquipment(u.id, 'rod', 1); // Oak Rod: 15% snap, +10% XP
  tick();
  const before = repo.getSkills(u.id).fishing;
  assert.match(say('!fish sardine', 'Alice'), /\+20 XP/, '18 base XP * 1.1');
  assert.equal(repo.getSkills(u.id).fishing - before, 20);
});

test('reaching a rod level announces the upgrade', () => {
  const { repo, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addXp(u.id, 'fishing', xpForLevel(50) - 5);
  assert.match(say('!fish'), /Fishing level 50!.*You can now !upgrade rod!/);
});

test('one skill alone cannot max character level; overall rank uses the same rule', () => {
  const { repo, engine } = setup();
  const { CHARACTER_XP_CAP_PER_SKILL, levelForXp } = require('../src/game/xp');
  const fisher = repo.upsertUser({ kickUserId: '1', username: 'Fisher' });
  const allRounder = repo.upsertUser({ kickUserId: '2', username: 'AllRounder' });
  repo.addXp(fisher.id, 'fishing', xpForLevel(500));
  for (const s of ['fishing', 'mining', 'woodcutting', 'digging', 'smelting']) repo.addXp(allRounder.id, s, xpForLevel(80));

  const fisherChar = engine.profile(fisher.id).character.level;
  assert.equal(fisherChar, levelForXp(CHARACTER_XP_CAP_PER_SKILL / 5, 120));
  assert.ok(fisherChar < 80, `fishing-only character level ${fisherChar} should be below an all-80 player`);
  assert.equal(engine.profile(allRounder.id).character.level, 80);

  assert.deepEqual(repo.leaderboard('overall').map((r) => r.username), ['AllRounder', 'Fisher']);
  assert.equal(repo.rank(allRounder.id, 'overall'), 1);
  assert.equal(repo.rank(fisher.id, 'overall'), 2);
});

// ---- Backpack, smelting, live settings ----------------------------------

function withLiveSettings() {
  const { Settings } = require('../src/settings');
  const repo = openDb(':memory:');
  const settings = new Settings({ config: { ...baseConfig, adminUsers: [], kick: { channel: 'streamer' } }, repo });
  let t = 1_000_000;
  const engine = new GameEngine({ repo, config: baseConfig, settings, rng: () => 0.99, now: () => t });
  const say = (content) => engine.handleChat({ kickUserId: '1', username: 'Alice', content }).reply;
  return { repo, engine, settings, say, tick: () => (t += 31_000) };
}

test('the backpack starts with 10 slots; gathering stops when full without using the cooldown', () => {
  const { repo, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addItem(u.id, 'logs', 9);
  assert.match(say('!fish'), /Shrimp.*🎒 Backpack full \(10\/10\)!/);
  tick();
  assert.match(say('!mine'), /backpack is full \(10\/10\)! !sell or !smelt to make room or !upgrade backpack \(20 slots for 100 pts\)/);
  assert.match(say('!chop'), /backpack is full/, 'no cooldown was used');
  assert.match(say('!inv'), /👝 Cloth Pouch \(10\/10\)/);
});

test('!upgrade backpack costs points and grows to 100 slots at level 10', () => {
  const { repo, engine, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  assert.match(say('!upgrade backpack'), /costs 100 pts, you have 5/);
  repo.addPoints(u.id, 1_000_000);
  assert.match(say('!upgrade backpack'), /upgraded to the 👜 Leather Satchel: 20 slots \(level 2\/10\) for 100 pts! Next: 30 slots for 250 pts/);
  for (let i = 0; i < 8; i++) assert.match(say('!upgrade bag'), /upgraded/);
  assert.match(say('!upgrade backpack'), /already the biggest backpack there is \(100 slots\)/);
  const bag = engine.profile(u.id).backpack;
  assert.equal(bag.level, 10);
  assert.equal(bag.capacity, 100);
  assert.equal(repo.getUser(u.id).points, 1_000_005 - (100 + 250 + 500 + 1000 + 2000 + 4000 + 7500 + 12500 + 20000));
});

test('smelting uses ores from the backpack, explains what is missing, and works when full', () => {
  const { repo, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  assert.match(say('!smelt'), /nothing to smelt! a Bronze Alloy \(alloy\) needs 1 Copper Ore \+ 1 Tin Ore\. You're missing 1 Copper Ore \+ 1 Tin Ore — try !mine copper \/ !mine tin/);
  repo.addItem(u.id, 'copper_ore', 1);
  assert.match(say('!smelt bronze'), /missing 1 Tin Ore — try !mine tin/);
  assert.match(say('!smelt steel'), /need 🔥 Smelting level 30 for Steel Alloy/);
  assert.match(say('!smelt banana'), /unknown recipe. You can smelt: bronze/);

  repo.addItem(u.id, 'tin_ore', 1);
  repo.addItem(u.id, 'logs', 8); // backpack now full (10/10)
  assert.match(say('!smelt'), /smelted 🟤 Bronze Alloy/);
  assert.deepEqual(repo.getInventory(u.id), { bronze_bar: 1, logs: 8 });

  repo.addXp(u.id, 'smelting', xpForLevel(30));
  repo.addItem(u.id, 'iron_ore', 1);
  tick();
  assert.match(say('!smelt'), /Iron Ingot/, 'iron ore alone makes an ingot');
  repo.addItem(u.id, 'iron_ore', 1);
  repo.addItem(u.id, 'coal', 2);
  tick();
  assert.match(say('!smelt'), /Steel Alloy/, 'best recipe you have ores for');
});

test('admin settings apply live: XP multiplier, prices, disabled commands', () => {
  const { repo, settings, say, tick } = withLiveSettings();
  const { SettingsError } = require('../src/settings');
  assert.match(say('!fish'), /\+10 XP/);
  settings.update('economy', { xpMultiplier: 2 });
  tick();
  assert.match(say('!fish'), /\+20 XP/);

  const rods = settings.all.rods.map((r) => ({ ...r }));
  rods[1].cost = 50;
  settings.update('rods', rods);
  const u = repo.getUserByName('alice');
  repo.addXp(u.id, 'fishing', xpForLevel(60));
  assert.match(say('!upgrade rod'), /the Oak Rod costs 50 pts/);
  repo.addPoints(u.id, 100);
  assert.match(say('!upgrade rod'), /upgraded to 🌳 Oak Rod.* for 50 pts/);

  settings.update('disabledCommands', ['dig']);
  assert.equal(say('!dig'), null);
  assert.doesNotMatch(say('!commands'), /!dig/);

  settings.update('general', { prefix: '?' });
  assert.equal(say('!points'), null);
  assert.match(say('?points'), /points/);

  assert.throws(() => settings.update('general', { actionCooldown: -1 }), SettingsError);
  assert.throws(() => settings.update('rods', rods.slice(1)), /needs exactly 10 rows/);
  rods[2].level = 10;
  assert.throws(() => settings.update('rods', rods), /tier 3 fishing level must be higher than tier 2/);

  settings.reset('general');
  assert.equal(settings.all.general.prefix, '!');
  assert.equal(settings.all.economy.xpMultiplier, 2, 'other sections keep their changes');
});

// ---- Tools for every skill -----------------------------------------------

test('every skill has a tool with 10 tiers; !upgrade works for each', () => {
  const { repo, engine, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 1_000_000);
  for (const skill of ['fishing', 'mining', 'woodcutting', 'digging', 'smelting']) repo.addXp(u.id, skill, xpForLevel(60));
  assert.match(say('!upgrade pickaxe'), /upgraded to 🔩 Iron Pickaxe: 15% miss chance, \+10% XP, rare finds x1.1 for 2,000 pts!/);
  assert.match(say('!upgrade axe'), /upgraded to 🔩 Iron Axe/);
  assert.match(say('!upgrade spade'), /upgraded to 🔩 Iron Shovel/);
  assert.match(say('!upgrade forge'), /upgraded to 🪨 Stone Furnace: \+10% XP, 3% chance to smelt two for 2,000 pts!/);
  assert.match(say('!upgrade pick'), /can be upgraded to ⚙️ Steel Pickaxe at Mining level 100 \(you are 60\) for 10,000 pts/);
  const tools = engine.profile(u.id).skills.map((s) => s.tool.name);
  assert.deepEqual(tools, ['Basic Rod', 'Iron Pickaxe', 'Iron Axe', 'Iron Shovel', 'Stone Furnace']);
});

test('!axe, !pickaxe etc. show the tool; !gear shows everything', () => {
  const { repo, say } = setup();
  assert.match(say('!axe'), /🪓 Bronze Axe: 18% miss chance, \+0% XP, rare finds x1 \(tier 1\/10\)\. Next: Iron Axe at Woodcutting level 50 for 2,000 pts/);
  assert.match(say('!furnace'), /🧱 Clay Furnace: \+0% XP, 0% chance to smelt two/);
  const u = repo.getUserByName('alice');
  repo.addXp(u.id, 'mining', xpForLevel(50));
  assert.match(
    say('!gear'),
    /🎣 Basic Rod 1\/10 \| ⛏️ Bronze Pickaxe 1\/10 ⬆️ \| 🪓 Bronze Axe 1\/10 \| 🥄 Wooden Shovel 1\/10 \| 🧱 Clay Furnace 1\/10 \| 👝 Cloth Pouch 0\/10 — ⬆️ = ready to !upgrade/
  );
});

test('the pickaxe sets the mining miss chance', () => {
  const { repo, say, tick } = setup({ rolls: [0.16, 0.5] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  assert.match(say('!mine'), /better luck next time/, '0.16 < 18% Bronze Pickaxe');
  repo.addXp(u.id, 'mining', xpForLevel(50));
  repo.setEquipment(u.id, 'pickaxe', 1); // Iron Pickaxe: 15%, +10% XP
  tick();
  assert.match(say('!mine tin'), /\+11 XP/, '10 base XP * 1.1');
});

test('woodcutting has birch, pine and spruce between the classic woods, up to level 500', () => {
  const { SKILLS } = require('../src/game/skills');
  const woods = SKILLS.woodcutting.resources.map((r) => `${r.item}@${r.level}`);
  assert.deepEqual(woods.slice(0, 6), ['logs@1', 'birch_logs@8', 'oak_logs@15', 'pine_logs@22', 'willow_logs@30', 'spruce_logs@38']);
  assert.equal(SKILLS.woodcutting.resources.at(-1).level, 500);
  for (const id of ['mining', 'woodcutting', 'digging', 'smelting']) {
    const list = SKILLS[id].resources || SKILLS[id].recipes;
    assert.equal(list.at(-1).level, 500, id);
  }
  const { repo, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addXp(u.id, 'woodcutting', xpForLevel(8));
  assert.match(say('!chop birch'), /Birch Logs/);
});

test('a better furnace can smelt two at once (if the backpack has room)', () => {
  // rolls: doubleChance roll (0.01 < 3%)
  const { repo, say } = setup({ rolls: [0.01] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.setEquipment(u.id, 'furnace', 1);
  repo.addItem(u.id, 'copper_ore', 1);
  repo.addItem(u.id, 'tin_ore', 1);
  assert.match(say('!smelt'), /smelted 🟤 2x Bronze Alloy! \(double!\) \+15 XP/);
  assert.equal(repo.getInventory(u.id).bronze_bar, 2);
});

test('rod prices saved before the tool rework still apply', () => {
  const { Settings } = require('../src/settings');
  const repo = openDb(':memory:');
  const old = Array.from({ length: 10 }, (_, i) => ({ level: i === 0 ? 1 : i * 50, cost: i * 7, snapChance: 0.2, xpBonus: 0, rareBonus: 1 }));
  repo.setSetting('config_overrides', { rods: old });
  const settings = new Settings({ config: { ...baseConfig, adminUsers: [], kick: { channel: 's' } }, repo });
  assert.equal(settings.all.rods[1].cost, 7);
  assert.equal(settings.all.rods[1].failChance, 0.2);
  assert.deepEqual(Object.keys(settings.all).filter((k) => k.endsWith('s') && Array.isArray(settings.all[k])).sort(), ['axes', 'disabledCommands', 'furnaces', 'pickaxes', 'rods', 'shovels']);
});
