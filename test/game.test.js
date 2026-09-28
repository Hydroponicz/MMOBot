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
  assert.match(say('!commands'), /!fish !mine !chop !dig !skin !plant !harvest !lightfire !cook !smelt !smith !fletch !brew !fight !shoot/);
  assert.equal(say('!unknowncommand'), null);
});

test('profile exposes everything the website needs', () => {
  const { repo, engine, say } = setup();
  say('!fish');
  const p = engine.profile(repo.getUserByName('alice').id);
  assert.equal(p.skills.length, 14);
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
  const tools = engine.profile(u.id).skills.filter((s) => s.tool).map((s) => s.tool.name);
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

// ---- Smithing, shop, gear and combat ------------------------------------------

test('the shop sells a smithing hammer (500) and a sword (1,000) via !buy', () => {
  const { repo, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  assert.match(say('!shop'), /🔨 Smithing Hammer 500, 🗡️ Bronze Sword 1,000, 🔪 Skinning Knife 500, 🟫 Farm Plot 750, 🏹 Oak Shortbow 500, 🧺 Quiver 250, 🪨 Flint and Steel 50 pts, potions from 150 \(!buy minor health potion\), arrows from 6 each \(!buy arrows 50\), plus seeds/);
  assert.match(say('!buy hammer'), /Smithing Hammer costs 500 pts, you have 5/);
  repo.addPoints(u.id, 2000);
  assert.match(say('!buy hammer'), /bought 🔨 Smithing Hammer for 500 pts! Now try !smith bronze sword/);
  assert.match(say('!buy hammer'), /already have a 🔨 Smithing Hammer/);
  assert.match(say('!buy sword'), /bought 🗡️ Bronze Sword for 1,000 pts! Now try !fight/);
  assert.equal(repo.getUser(u.id).points, 505);
  assert.match(say('!buy unicorn'), /usage: !buy <item>/);
});

test('smithing needs a hammer and alloys, and makes gear', () => {
  const { repo, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  assert.match(say('!smith bronze sword'), /need a 🔨 Smithing Hammer in your backpack to smith! !buy hammer \(500 pts\)/);
  repo.addItem(u.id, 'smithing_hammer', 1);
  assert.match(say('!smith'), /nothing to smith yet! a Bronze Helmet \(armor\) needs 1 Bronze Alloy.*try !smelt bronze/);
  repo.addItem(u.id, 'bronze_bar', 3);
  assert.match(say('!smith'), /you can smith: bronze platelegs, bronze shield, bronze helmet, bronze sword/);
  assert.match(say('!smith steel sword'), /need ⚒️ Smithing level 30/);
  assert.match(say('!smith bronze sword'), /smithed 🗡️ Bronze Sword! \+34 XP/);
  tick();
  assert.match(say('!smith bronze platebody'), /missing 3 Bronze Alloy — try !smelt bronze/);
  assert.deepEqual(repo.getInventory(u.id), { bronze_bar: 1, bronze_sword: 1, smithing_hammer: 1 }, 'hammer is not used up');
});

test('!equip / !unequip / !equipped, with level requirements', () => {
  const { repo, engine, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addItem(u.id, 'bronze_sword', 1);
  repo.addItem(u.id, 'bronze_platebody', 1);
  repo.addItem(u.id, 'steel_sword', 1);
  assert.match(say('!equip steel sword'), /need 🗡️ Swords level 20 to wield a Steel Sword \(you are 1\)/);
  assert.match(say('!equip bronze sword'), /equipped 🗡️ Bronze Sword \(\+4 attack\)\. ⚔️ Attack \+4 · 🛡️ Defence \+0/);
  assert.match(say('!wear bronze platebody'), /Defence \+6/);
  assert.match(say('!equipped'), /🗡️ Bronze Sword \| ⛑️ — \| 👕 Bronze Platebody \| 👖 — \| 🛡️ — \| ⚔️ Attack \+4 · 🛡️ Defence \+6 · Combat level 1/);
  assert.equal(repo.getInventory(u.id).bronze_sword, undefined, 'equipped items leave the backpack');
  assert.match(say('!unequip body'), /took off your 👕 Bronze Platebody/);
  assert.equal(repo.getInventory(u.id).bronze_platebody, 1);
  const c = engine.profile(u.id).combat;
  assert.equal(c.attack, 4);
  assert.equal(c.worn.find((w) => w.slot === 'weapon').item.name, 'Bronze Sword');
});

test('!sell all keeps gear and tools', () => {
  const { repo, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addItem(u.id, 'smithing_hammer', 1);
  repo.addItem(u.id, 'bronze_sword', 1);
  repo.addItem(u.id, 'logs', 3);
  assert.match(say('!sell all'), /sold 🪵 3x Logs for 6 pts.*\(kept your gear & tools\)/);
  assert.match(say('!sell all'), /nothing to sell — your gear and tools are kept/);
  assert.match(say('!sell bronze sword'), /sold 🗡️ Bronze Sword for 26 pts/);
});

test('!fight needs a weapon, auto-equips the best one, and any monster can be fought', () => {
  // rolls: monster pick, then the fight's hit rolls (0.99 by default), rare roll, loot pick
  const { repo, say, tick } = setup({ rolls: [0.0] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  assert.match(say('!fight'), /you need a sword! 🛒 !buy sword \(1,000 pts, you have 5\)/);
  repo.addItem(u.id, 'bronze_sword', 1);
  repo.addItem(u.id, 'steel_sword', 1); // too high level for now
  assert.match(say('!fight'), /you defeated a 🐔 Chicken \(equipped your Bronze Sword\) and looted .*! \+10 XP.*Swords level 2!.*\| ❤️ \d+\/70 HP \(-\d\)/);
  assert.equal(repo.getWorn(u.id).weapon, 'bronze_sword');
  tick();
  assert.match(say('!fight unicorn'), /unknown monster. Monsters for you: 🟢 Chicken 1 · 🔴 Giant Rat 5 · ☠️ Goblin 10/);

  repo.addXp(u.id, 'swords', xpForLevel(25));
  tick();
  say('!fight chicken');
  assert.equal(repo.getWorn(u.id).weapon, 'steel_sword', 'switches to the best usable weapon');
  assert.equal(repo.getInventory(u.id).bronze_sword, 1, 'old weapon goes back in the backpack');
});

test('fighting far above your level knocks you out until you drink a potion or 24h pass', () => {
  const { repo, engine, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addXp(u.id, 'swords', xpForLevel(5));
  repo.addItem(u.id, 'bronze_sword', 1);
  assert.match(engine.vitalsInfo(u), /❤️ 100\/100 HP · 🔷 30\/30 mana\.$/);
  // First a warning (no cooldown used), then typing it again fights anyway.
  assert.match(say('!fight dragon'), /☠️ a 🐉 Dragon \(level 400\) will probably knock you out: you can't beat it yet \(it has 2,750 HP, you hit for ~7\)\. Type !fight dragon again within 2 min/);
  assert.match(say('!fight dragon'), /💀 the 🐉 Dragon \(level 400\) knocked you out! \(equipped your Bronze Sword\) You hit it for 9 of its 2,750 HP\. \+\d XP.*Back at full HP in 24h, or !drink a health potion \(!buy minor health potion, 150 pts\)/);
  assert.equal(repo.getInventory(u.id).feathers, undefined, 'no loot');
  tick();
  assert.match(say('!fight chicken'), /💀 you're knocked out! Back at full HP in 23h 59m/);
  assert.match(say('!hp'), /💀 knocked out \(0\/100 HP\).*Back up in 23h 59m/);
  assert.match(say('!heal'), /can't revive you/);
  assert.match(say('!drink'), /you have no potions/);

  // A potion gets you back up with part of your HP.
  repo.addItem(u.id, 'minor_health_potion', 1);
  assert.match(say('!drink'), /🧪 you drank a Minor Health Potion and got back on your feet! ❤️ 25\/100 HP/);
  tick();
  assert.match(say('!fight chicken'), /defeated a 🐔 Chicken/);

  // Or wait it out.
  const bob = repo.upsertUser({ kickUserId: '2', username: 'Bob' });
  repo.addItem(bob.id, 'bronze_sword', 1);
  say('!fight elder dragon', 'Bob', '2');
  say('!fight elder dragon', 'Bob', '2');
  assert.equal(engine.vitals(bob.id).ko, true);
  tick(24 * 3600);
  assert.equal(engine.vitals(bob.id).ko, false);
  assert.equal(engine.vitals(bob.id).hp, 60, 'back at full HP');
});

test('fights at your level cost a little HP, which regenerates; armor matters', () => {
  const { repo, engine, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addXp(u.id, 'swords', xpForLevel(10));
  repo.addItem(u.id, 'bronze_sword', 1);
  assert.match(say('!fight goblin'), /you defeated a 👺 Goblin .*\| ❤️ 1[23]\d\/150 HP/);
  const hurt = engine.vitals(u.id).hp;
  assert.ok(hurt < 150);
  tick(3600);
  assert.ok(Math.abs(engine.vitals(u.id).hp - (hurt + 150 / 24)) < 0.01, 'regains 1/24 of max HP per hour');

  // Simulated fights with random rolls: at par you almost always win, armor saves HP.
  const { SKILLS } = require('../src/game/skills');
  const mon = (id) => SKILLS.swords.monsters.find((m) => m.id === id);
  let seed = 1;
  engine.rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const run = (level, stats, m, n = 400) => {
    let wins = 0;
    let taken = 0;
    for (let i = 0; i < n; i++) {
      const f = engine.simulateFight(level, stats, m, 50 + 10 * level);
      if (f.outcome === 'won') wins++;
      taken += f.taken;
    }
    return { win: wins / n, taken: taken / n };
  };
  const bare = run(10, { attack: 4, defence: 0 }, mon('goblin'));
  const armored = run(10, { attack: 4, defence: 15 }, mon('goblin'));
  assert.equal(armored.win, 1);
  assert.ok(armored.taken < bare.taken / 1.8, `armor: ${armored.taken} vs ${bare.taken}`);
  assert.ok(armored.taken < 150 * 0.08, `a par fight costs under 8% HP: ${armored.taken}`);
  assert.ok(run(5, { attack: 4, defence: 15 }, mon('wolf')).win < 0.2, 'level 5 vs a level 20 wolf usually loses');
  assert.ok(run(40, { attack: 18, defence: 52 }, mon('orc')).win > 0.9, 'a bit above your level is fine with good gear');
});

test('fights are rated for you: !scout, !monsters, too-easy tips and a best-match default', () => {
  const { repo, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addXp(u.id, 'swords', xpForLevel(40));
  repo.addItem(u.id, 'mithril_sword', 1);
  for (const piece of ['helmet', 'shield', 'platelegs', 'platebody']) {
    repo.addItem(u.id, `mithril_${piece}`, 1);
    say(`!equip mithril ${piece}`);
  }
  assert.match(say('!monsters'), /Monsters for you: .*🟢 Skeleton 40 · 🟢 Orc 55 · 🔴 Troll 70 · ☠️ Ogre 85/);
  assert.match(say('!scout chicken'), /⚪ Too easy: 🐔 Chicken \(level 1, 15 HP\) vs you \(Swords 40, Mithril Sword, \+53 def\): ~1 round,.*Barely worth it/);
  assert.match(say('!scout troll'), /🔴 Hard: 🧌 Troll \(level 70, 490 HP\).*you'd lose ~\d+ HP \(4\d% of max\).*Better weapon\/armor/);
  assert.match(say('!scout ogre'), /☠️ Deadly/);
  assert.match(say('!scout'), /Monsters for you/);

  // Beating something far below you says so and points at a better fight.
  assert.match(say('!fight chicken'), /you defeated a 🐔 Chicken.* ⚪ Too easy for you, try !fight orc for 105 XP\. !targets shows your best fights\./);
  tick();
  // A bare !fight picks the best safe match.
  assert.match(say('!fight'), /you defeated a 👹 Orc \(level 55\)/);
  tick();
  // A hard fight with little HP left gets a warning first.
  repo.setVitals(u.id, { hp: 30, mana: 0, koUntil: 0 }, 1_000_000 + 62_000);
  assert.match(say('!fight troll'), /🔴 a 🧌 Troll \(level 70\) will probably knock you out: it would deal ~\d+ damage and you have 30 HP/);
  assert.match(say('!fight'), /you defeated a .*(Bandit|Wolf|Goblin|Skeleton)/, 'the default picks something your HP can take');
});

test('!targets recommends monsters from your level, gear and HP', () => {
  const { repo, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  assert.match(say('!targets'), /you need a sword/);
  repo.addXp(u.id, 'swords', xpForLevel(40));
  repo.addItem(u.id, 'mithril_sword', 1);
  for (const piece of ['helmet', 'shield', 'platelegs', 'platebody']) {
    repo.addItem(u.id, `mithril_${piece}`, 1);
    say(`!equip mithril ${piece}`);
  }
  assert.match(say('!targets'), /🎯 Best fights for you \(Swords 40, Mithril Sword, \+53 def\): 🟢 👹 Orc 55 \(105 XP, ~13% HP\) · 🟢 💀 Skeleton 40 \(75 XP, ~5% HP\) · 🟢 🥷 Bandit 30 \(55 XP, ~1% HP\) · 🟢 🐺 Wolf 20/);
  assert.match(say('!targets'), /Try !fight orc$/);
  repo.setVitals(u.id, { hp: 20, mana: 0, koUntil: 0 }, 1_000_000);
  assert.match(say('!targets'), /⚠️ You're at 20\/450 HP: !drink a potion or !heal for the tougher ones\. Try !fight bandit$/);
  repo.setVitals(u.id, { hp: 1, mana: 0, koUntil: 0 }, 1_000_000);
  assert.match(say('!targets'), /⚠️ You're at 1\/450 HP: !drink a potion or !heal first\./);
  assert.match(say('!targets bow'), /you need a bow! 🛒 !buy bow \(500 pts/);
});

test('fletching: arrows (oak + feather + iron ingot), bows and a quiver; archery with !shoot', () => {
  const { repo, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  assert.match(say('!shoot'), /you need a bow! 🛒 !buy bow \(500 pts, you have 5\) or !fletch oak shortbow \(2 Oak Logs\)/);
  assert.match(say('!fletch'), /nothing to fletch yet/);
  assert.match(say('!fletch spear'), /unknown item. Try e.g. !fletch arrows, oak shortbow or quiver/);

  // Arrows need a quiver.
  repo.addItem(u.id, 'oak_logs', 3);
  repo.addItem(u.id, 'feathers', 1);
  repo.addItem(u.id, 'iron_bar', 1);
  assert.match(say('!fletch arrows'), /you need a 🧺 Quiver to hold arrows! !buy quiver \(250 pts\) or !fletch quiver/);
  repo.addPoints(u.id, 1000);
  assert.match(say('!buy quiver'), /bought 🧺 Quiver for 250 pts! Now !fletch arrows/);
  assert.match(say('!fletch arrows'), /🪶 you fletched 🎯 10x Iron Arrows! \+33 XP/);
  tick();
  assert.match(say('!fletch bow'), /🪶 you fletched 🏹 Oak Shortbow! \+40 XP/);
  const bag = repo.getInventory(u.id);
  assert.equal(bag.iron_arrows, 10);
  assert.equal(bag.oak_logs, undefined);
  assert.match(say('!inv'), /\(2\/10\)/, 'arrows sit in the quiver, not the backpack (quiver + bow)');
  assert.match(say('!quiver'), /🧺 Quiver 10\/500 arrows: 🎯 10x Iron Arrows/);

  // !shoot fights with the bow and uses an arrow; Archery gets the XP.
  tick();
  assert.match(say('!shoot chicken'), /🏹 you defeated a 🐔 Chicken \(equipped your Oak Shortbow\).*\+10 XP.*Archery level 2!.* 🎯 9 Iron Arrows left!/);
  assert.equal(repo.getInventory(u.id).iron_arrows, 9);
  assert.equal(repo.getSkills(u.id).archery, 10);
  assert.equal(repo.getSkills(u.id).swords || 0, 0);

  // Out of arrows: !shoot says so, and !fight falls back to a sword.
  repo.removeItem(u.id, 'iron_arrows', 9);
  tick();
  assert.match(say('!shoot'), /your quiver is empty! !buy arrows 50 or !fletch arrows/);
  // Buying arrows: 10 by default, into the quiver.
  assert.match(say('!buy arrows'), /bought 🎯 10x Iron Arrows for 60 pts! 🧺 Quiver: 10\/500/);
  assert.match(say('!buy steel arrows 25'), /bought 🎯 25x Steel Arrows for 400 pts!/);
  assert.match(say('!buy arrows 500'), /quiver only has room for 465 more arrows/);
  assert.match(say('!inv'), /\(2\/10\)/, 'bought arrows skip the backpack too');
  repo.removeItem(u.id, 'iron_arrows', 10);
  repo.removeItem(u.id, 'steel_arrows', 25);
  repo.addItem(u.id, 'bronze_sword', 1);
  assert.match(say('!fight chicken'), /🗡️ you defeated a 🐔 Chicken \(equipped your Bronze Sword\)/);
  assert.match(say('!targets bow'), /your quiver is empty/);
});

test('firemaking: !lightfire needs flint and logs, burns the best log for XP and leaves ashes', () => {
  const { repo, engine, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  assert.match(say('!lightfire'), /you need a 🪨 Flint and Steel in your backpack to light a fire! !buy flint \(50 pts\)/);
  repo.addPoints(u.id, 100);
  assert.match(say('!buy flint'), /bought 🪨 Flint and Steel for 50 pts! Good for 250 fires: !lightfire\./);
  assert.match(say('!buy flint'), /already have a 🪨 Flint and Steel/);
  assert.match(say('!lightfire'), /no logs in your backpack! !chop some first/);
  repo.addItem(u.id, 'logs', 2);
  repo.addItem(u.id, 'oak_logs', 1);
  assert.match(say('!lightfire'), /🔥 you lit a fire with 🪵 Logs and got 🌫️ Ashes! \+13 XP.* 🪨 249\/250 uses left\./, 'burns the best log it can');
  tick();
  assert.match(say('!lightfire oak'), /Firemaking level 15 to burn Oak Logs/);
  const inv = repo.getInventory(u.id);
  assert.equal(inv.logs, 1);
  assert.equal(inv.ashes, 1);
  assert.equal(engine.flintUses(u.id), 249);

  // Better logs give more XP (at the level to burn them).
  repo.addXp(u.id, 'firemaking', xpForLevel(15));
  tick();
  assert.match(say('!lightfire'), /lit a fire with 🌳 Oak Logs.*\+31 XP/);
  assert.match(say('!sell ashes all'), /sold 🌫️ 2x Ashes for 6 pts/);
});

test('firemaking: a failed light uses nothing; the flint wears out after 250 fires', () => {
  const { repo, engine, say, tick } = setup({ rolls: [0.01, 0.0] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addItem(u.id, 'flint_and_steel', 1);
  repo.addItem(u.id, 'logs', 2);
  assert.match(say('!lightfire'), /🔥 the sparks didn't catch\.\.\. try again!/);
  assert.equal(repo.getInventory(u.id).logs, 2);
  assert.equal(engine.flintUses(u.id), 250);
  assert.match(say('!lightfire'), /catching your breath/, 'a failed attempt still uses the cooldown');
  repo.setEquipment(u.id, 'flint_used', 249);
  tick();
  assert.match(say('!lightfire'), /lit a fire.*🪨 Your Flint and Steel wore out! !buy flint \(50 pts\) for another\./);
  assert.equal(repo.getInventory(u.id).flint_and_steel, undefined);
  assert.equal(engine.flintUses(u.id), null);
  repo.addPoints(u.id, 100);
  say('!buy flint');
  assert.equal(engine.flintUses(u.id), 250, 'a new flint has all its uses');
});

test('undead potions: brewed from ashes, give timed effects', () => {
  const { repo, engine, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addXp(u.id, 'alchemy', xpForLevel(100));
  repo.addItem(u.id, 'ashes', 2);
  repo.addItem(u.id, 'old_bone', 1);
  assert.match(say('!brew bone brew'), /⚗️ you brewed 🥣 Bone Brew!/);
  tick();
  assert.match(say('!brew vampire draught'), /needs 3 Ashes \+ 1 Rat Tail\. You're missing 3 Ashes \+ 1 Rat Tail — try !lightfire \/ !fight giant rat/);
  assert.match(say('!buffs'), /no active effects/);

  // Bone Brew: +20% XP for 30 minutes.
  assert.match(say('!drink bone brew'), /you drank a Bone Brew: 🦴 Bone-Deep Focus for 30 min: \+20% XP in every skill\./);
  assert.match(say('!fish'), /\+12 XP/, '10 XP shrimp + 20%');
  assert.match(say('!hp'), /🦴 Bone-Deep Focus 30m/);
  tick(31 * 60);
  assert.match(say('!fish'), /\+10 XP/, 'worn off');

  // Wraithwalk halves the cooldown; Grave Luck doubles rare chances; Banshee Fury adds attack.
  engine.addBuff(u.id, 'haste');
  tick(16);
  assert.match(say('!fish'), /you caught/, '15s is enough with the cooldown halved');
  assert.equal(engine.luck(u.id), 1);
  engine.addBuff(u.id, 'luck');
  assert.equal(engine.luck(u.id), 2);
  repo.addItem(u.id, 'bronze_sword', 1);
  const pick = engine.chooseWeapon(u.id);
  assert.equal(engine.fightStats(u.id, pick).attack, 4);
  engine.addBuff(u.id, 'fury');
  assert.equal(engine.fightStats(u.id, pick).attack, 5);
  assert.match(engine.buffsInfo(u), /Wraithwalk .*Grave Luck .*Banshee Fury/);
});

test("undead potions: Vampire Draught heals after wins, Lich's Elixir cheats one knockout", () => {
  const { repo, engine, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addXp(u.id, 'swords', xpForLevel(10));
  repo.addItem(u.id, 'bronze_sword', 1);
  repo.setVitals(u.id, { hp: 50, mana: 0, koUntil: 0 }, 1_000_000);
  engine.addBuff(u.id, 'vampiric');
  assert.match(say('!fight chicken'), /defeated a 🐔 Chicken.* 🧛 \+23 HP/);
  engine.addBuff(u.id, 'deathless');
  tick();
  say('!fight dragon');
  assert.match(say('!fight dragon'), /should have knocked you out, but your Lich's Elixir dragged you back on 1 HP!/);
  assert.equal(engine.vitals(u.id).ko, false);
  assert.equal(engine.vitals(u.id).hp, 1);
  assert.equal(engine.hasBuff(u.id, 'deathless'), false, 'only once');
});

test('cooking: needs a lit fire; cooks fish, vegetables and meat; food can burn', () => {
  // rolls: [lightfire fail roll, cook burn roll]
  const { repo, engine, say, tick } = setup({ rolls: [0.99, 0.99, 0.0] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addItem(u.id, 'shrimp', 2);
  assert.match(say('!cook'), /🔥 you need a fire to cook on! !lightfire first/);
  repo.addItem(u.id, 'flint_and_steel', 1);
  repo.addItem(u.id, 'logs', 1);
  assert.match(say('!lightfire'), /It burns for 5m: !cook on it\./);
  assert.match(engine.fireInfo(u), /your fire burns for another 5m/);
  tick();
  assert.match(say('!cook'), /🍳 you cooked 🦐 Cooked Shrimp! \+11 XP.* 🔥 Fire: 5m left\./);
  tick();
  // Burnt: the raw food is gone, nothing made.
  assert.match(say('!cook shrimp'), /🔥 oops, you burned the Shrimp! It's ruined/);
  const inv = repo.getInventory(u.id);
  assert.equal(inv.shrimp, undefined);
  assert.equal(inv.cooked_shrimp, 1);
  tick();
  assert.match(say('!cook trout'), /need 🍳 Cooking level 20 for Cooked Trout/);
  assert.match(say('!cook lasagna'), /unknown recipe. You can cook: .*shrimp/);

  // Vegetables and meat too.
  repo.addItem(u.id, 'carrot', 1);
  assert.match(say('!cook carrot'), /you cooked 🥕 Roasted Carrot!/);
  tick();
  repo.addItem(u.id, 'raw_chicken', 1);
  assert.match(say('!cook chicken'), /you cooked 🍗 Cooked Chicken!/);

  // The fire goes out.
  tick(6 * 60);
  repo.addItem(u.id, 'raw_rabbit', 1);
  assert.match(say('!cook'), /you need a fire/);
});

test('cooking: better food gives more XP, and the burn chance falls with level', () => {
  const { repo, engine, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addXp(u.id, 'cooking', xpForLevel(30));
  repo.setSetting(`fire:${u.id}`, 2_000_000_000);
  repo.addItem(u.id, 'shrimp', 1);
  repo.addItem(u.id, 'salmon', 1);
  assert.match(say('!cook'), /Cooked Salmon! \+61 XP/, 'the best food first');
  const { SKILLS } = require('../src/game/skills');
  const salmon = SKILLS.cooking.recipes.find((r) => r.item === 'cooked_salmon');
  const shrimp = SKILLS.cooking.recipes.find((r) => r.item === 'cooked_shrimp');
  assert.ok(salmon.xp > shrimp.xp);
  assert.match(engine.handleChat({ kickUserId: '1', username: 'Alice', content: '!cook shrimp' }).reply, /catching your breath/);
});

test('skinning gives meat; !eat heals with cooked food', () => {
  const { repo, engine, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addItem(u.id, 'skinning_knife', 1);
  assert.match(say('!skin'), /skinned 🐇 Rabbit Hide and 🥩 Raw Rabbit Meat!/);
  assert.equal(repo.getInventory(u.id).raw_rabbit, 1);
  // A full backpack keeps the hide and skips the meat.
  repo.addItem(u.id, 'logs', 6); // knife + hide + meat + 6 logs = 9 of 10 slots
  tick();
  assert.match(say('!skin'), /skinned 🐇 Rabbit Hide!.*\(no room for the Raw Rabbit Meat\)/);

  assert.match(say('!eat'), /you have no cooked food/);
  repo.addItem(u.id, 'cooked_shrimp', 2);
  repo.addItem(u.id, 'cooked_salmon', 1);
  assert.match(say('!eat'), /already at full health/);
  repo.setVitals(u.id, { hp: 50, mana: 0, koUntil: 0 }, 1_000_000 + 31_000);
  assert.match(say('!eat'), /🦐 you ate a Cooked Shrimp \(\+10 HP\)\. ❤️ 60\/60 HP/, 'the smallest food that fills you up');
  repo.setVitals(u.id, { hp: 5, mana: 0, koUntil: 0 }, 1_000_000 + 31_000);
  assert.match(say('!eat salmon'), /ate a Cooked Salmon \(\+55 HP\)/);
  repo.setVitals(u.id, { hp: 0, mana: 0, koUntil: 9_000_000_000 }, 1_000_000);
  assert.match(say('!eat'), /knocked out.*Food can't get you up/);
  assert.match(say('!sell all'), /sold/);
  assert.equal(repo.getInventory(u.id).cooked_shrimp, 1, 'cooked food is kept by !sell all');
  assert.equal(engine.vitals(u.id).ko, true);
});

test('!drink picks the right potion, !heal spends mana, potions can be bought and brewed', () => {
  const { repo, engine, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.setVitals(u.id, { hp: 20, mana: 20, koUntil: 0 }, 1_000_000);
  assert.match(say('!heal'), /✨ you cast Heal \(\+15 HP\)\. ❤️ 35\/60 HP · 🔷 9\/22 mana/);
  assert.match(say('!heal'), /needs 11 mana \(you have 9\)\. Enough in 1h 5m/);
  repo.addItem(u.id, 'minor_health_potion', 2);
  repo.addItem(u.id, 'health_potion', 1);
  repo.addItem(u.id, 'minor_mana_potion', 1);
  assert.match(say('!drink'), /drank a Health Potion! ❤️ 60\/60 HP/, 'the smallest potion that tops you up');
  assert.match(say('!drink'), /drank a Minor Mana Potion! ❤️ 60\/60 HP · 🔷 17\/22 mana/);
  assert.match(say('!drink'), /already at full health/);
  assert.match(say('!drink minor health'), /no need/);
  assert.match(say('!drink elixir'), /don't have a Elixir of Life\. !buy elixir of life or !brew it/);
  assert.equal(repo.getInventory(u.id).minor_health_potion, 2);

  // Buying several, keeping them on !sell all.
  repo.addPoints(u.id, 1000);
  assert.match(say('!buy minor health potion 3'), /bought 🧪 3x Minor Health Potion for 450 pts! !drink it/);
  assert.match(say('!sell all'), /nothing to sell/);

  // Brewing from crops.
  repo.addItem(u.id, 'carrot', 2);
  assert.match(say('!brew'), /⚗️ you brewed 🧪 Minor Health Potion! \+24 XP/);
  tick();
  assert.match(say('!brew health potion'), /need ⚗️ Alchemy level 25/);
  assert.match(say('!brew'), /nothing to brew! a Minor Health Potion \(potion\) needs 2 Carrot\. You're missing 2 Carrot — try !plant carrot/);
  assert.match(engine.equippedInfo(u), /❤️ 60\/60 HP · 🔷 17\/22 mana/);
});

test('new skills never lower anyone\'s character level', () => {
  const { repo, engine } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  for (const s of ['fishing', 'mining', 'woodcutting', 'digging', 'smelting']) repo.addXp(u.id, s, xpForLevel(50));
  assert.equal(engine.profile(u.id).character.level, 50);
});

test('a bare !smith (listing options) ignores the cooldown', () => {
  const { repo, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addItem(u.id, 'smithing_hammer', 1);
  repo.addItem(u.id, 'bronze_bar', 2);
  assert.match(say('!smith bronze sword'), /smithed/);
  assert.match(say('!smith'), /nothing to smith yet|you can smith/);
});

test('!fight without a sword explains how to buy or craft one, briefly, with progress', () => {
  const { repo, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  const first = say('!fight');
  assert.equal(
    first,
    '@Alice ⚔️ you need a sword! 🛒 !buy sword (1,000 pts, you have 5) or ⚒️ !buy hammer → !smelt bronze (0/2) → !smith bronze sword. Then !equip bronze sword.'
  );
  assert.ok(first.length < 200, `short (${first.length} chars)`);

  repo.addPoints(u.id, 2000);
  repo.addItem(u.id, 'smithing_hammer', 1);
  repo.addItem(u.id, 'bronze_bar', 2);
  assert.match(say('!fight'), /you have 2,005\) or ⚒️ hammer ✅ → !smelt bronze \(2\/2\)/);
});

// ---- Skinning, emote shortcuts --------------------------------------------------

test('!skin needs a skinning knife (buy it or smith it at Smithing 20 from a Sterling Alloy)', () => {
  const { repo, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  assert.match(say('!skin'), /need a 🔪 Skinning Knife in your backpack to skin! !buy knife \(500 pts\) or !smith skinning knife \(Smithing 20: 1 Sterling Alloy\)/);
  assert.match(say('!shop'), /🔪 Skinning Knife 500/);

  // Smith one: needs a hammer, Smithing 20 and a steel alloy.
  repo.addItem(u.id, 'smithing_hammer', 1);
  repo.addItem(u.id, 'sterling_bar', 1);
  assert.match(say('!smith knife'), /need ⚒️ Smithing level 20 for Skinning Knife/);
  repo.addXp(u.id, 'smithing', xpForLevel(20));
  assert.match(say('!smith knife'), /smithed 🔪 Skinning Knife! \+55 XP/);
  tick();
  assert.match(say('!skin'), /🔪 you skinned 🐇 Rabbit Hide and 🥩 Raw Rabbit Meat! \+10 XP/);
  assert.equal(repo.getInventory(u.id).skinning_knife, 1, 'the knife is not used up');
  assert.match(say('!sell all'), /kept your gear & tools/);
});

test('the buy route for the knife works too', () => {
  const { repo, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 500);
  assert.match(say('!buy knife'), /bought 🔪 Skinning Knife for 500 pts/);
  assert.match(say('!skin'), /skinned/);
});

test('emote shortcuts: an emote then a space and a target runs that command on that target', () => {
  const { repo, settings, say, tick } = withLiveSettings();
  settings.update('general', { emoteCommands: 'hydroponiczcobble=mine, swordz=fight' });
  const u = repo.getUserByName('alice') || repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  const cob = '[emote:4148074:hydroponiczcobble]';
  assert.match(say(`${cob} copper`), /you mined 🟠 Copper Ore/);
  tick();
  assert.match(say(`${cob}  iron ore`), /Mining level 15 for Iron Ore/, 'the target is used (and checked)');
  assert.match(say(`hydroponiczcobble tin`), /you mined ⚪ Tin Ore/, 'typed name as the first word');
  tick();
  assert.match(say(`:hydroponiczcobble: copper [emote:1:KEKW]`), /you mined 🟠 Copper Ore/, 'other emotes are ignored');
  tick();
  assert.match(say(`lets go ${cob} copper`), /you mined 🟠 Copper Ore/, 'emote mid-message still takes its target');
  tick();
  // Words that aren't a target are just chat: it mines as usual instead of replying "unknown target".
  assert.match(say(`${cob} this is fun`), /you mined/);
  tick();
  assert.match(say(`${cob} i love it`), /you mined/);

  // A fight emote followed by a monster fights that monster.
  repo.addItem(u.id, 'bronze_sword', 1);
  tick();
  assert.match(say('[emote:9:swordz] chicken gg'), /you defeated a 🐔 Chicken/);
  tick();
  assert.match(say('[emote:9:swordz] giant rat'), /Giant Rat \(level 5\) will probably knock you out|defeated a 🐀 Giant Rat/);
});

test('emote shortcuts only fire on the emote, :name: or the first word, never mid-sentence or in links', () => {
  const { settings, say, tick } = withLiveSettings();
  settings.update('general', { emoteCommands: 'hydroponiczcobble=mine' });
  assert.equal(say('hello hydroponiczcobble'), null);
  assert.equal(say('check https://kick.com/hydroponiczcobble'), null);
  assert.equal(say('no adventurer named hydroponiczcobble yet.'), null, 'a bot reply quoting a viewer');
  assert.equal(say('hydroponiczcobblestone is cool'), null);
  assert.equal(say('[emote:4148074:someotheremote]'), null);
  assert.match(say('HYDROPONICZCOBBLE'), /you mined/);
  tick();
  // Two shortcuts in one message: the first one in the message wins.
  settings.update('general', { emoteCommands: 'cobble=mine, fishy=fish' });
  assert.match(say('[emote:1:fishy] then [emote:2:cobble]'), /you caught/);
});

test('emotes after a normal command are ignored instead of breaking it', () => {
  const { repo, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  assert.match(say('!mine [emote:39261:KEKW]'), /you mined/);
  tick();
  assert.match(say('!mine [emote:39261:KEKW] copper'), /you mined 🟠 Copper Ore/);
  assert.match(say('!sell all [emote:1:PogU]'), /sold/);
  repo.addPoints(u.id, 1000);
  assert.match(say('!buy quiver [emote:1:PogU]'), /bought 🧺 Quiver/);
  assert.match(say('[emote:1:PogU] !buy arrows 20'), /bought 🎯 20x Iron Arrows/, 'an emote before the command too');
});

test('emote settings: EMOTE_COMMANDS is cleaned up like the admin page; bad entries are skipped', () => {
  const { Settings, SettingsError } = require('../src/settings');
  const repo = openDb(':memory:');
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  const emoteCommands = ['hydroponiczcobble = mine', 'fishy=!Fish', ':chop:=chop oak', '🪨=mine', '4128=mine', 'cobble=mien'];
  const settings = new Settings({ config: { ...baseConfig, game: { ...baseConfig.game, emoteCommands }, adminUsers: [], kick: { channel: 's' } }, repo });
  console.warn = warn;
  assert.deepEqual(settings.all.general.emoteCommands, ['hydroponiczcobble=mine', 'fishy=fish', 'chop=chop oak']);
  assert.equal(warnings.length, 3);
  assert.match(warnings.join('\n'), /🪨=mine[\s\S]*4128=mine[\s\S]*"mien" isn't a command/);

  // The admin page uses the same rules (and still refuses bad entries outright).
  assert.throws(() => settings.update('general', { emoteCommands: 'cobble=dance' }), SettingsError);
  assert.throws(() => settings.update('general', { emoteCommands: 'bad name=mine' }), /should look like/);
  assert.throws(() => settings.update('general', { emoteCommands: '🪨=mine' }), /should look like/);
  settings.update('general', { emoteCommands: ':Cobble:=!mine, [emote:77:Fishy]=fish, axe=chop oak' });
  assert.deepEqual(settings.all.general.emoteCommands, ['cobble=mine', 'fishy=fish', 'axe=chop oak']);
});

test('the bot ignores its own replies when they come back through chat', () => {
  const { ChatBot } = require('../src/bot/bot');
  const { engine } = setup();
  engine.settings.game.emoteCommands = ['hydroponiczcobble=mine'];
  const bot = new ChatBot({ engine, kick: { botAccount: () => null, sendChat: async () => true }, logger: { info() {}, error() {} } });
  const reply = bot.handleMessage({ kickUserId: '1', username: 'Alice', content: '!stats hydroponiczcobble' });
  assert.match(reply, /no adventurer named hydroponiczcobble/);
  assert.equal(bot.handleMessage({ kickUserId: '999', username: 'KickBot', content: reply }), null);
});

test('saved shop prices survive new shop items being added', () => {
  const { Settings } = require('../src/settings');
  const repo = openDb(':memory:');
  repo.setSetting('config_overrides', { shop: [{ cost: 111 }, { cost: 222 }] });
  const settings = new Settings({ config: { ...baseConfig, adminUsers: [], kick: { channel: 's' } }, repo });
  assert.deepEqual(settings.all.shop.slice(0, 4).map((r) => r.cost), [111, 222, 500, 750]);
  // Saved rows now carry the item, so they stay on it even if items are added before it.
  assert.equal(settings.all.shop[0].item, 'smithing_hammer');
  const rows = settings.all.shop.map((r) => ({ cost: r.item === 'quiver' ? 99 : r.cost }));
  settings.update('shop', rows);
  const saved = repo.getSetting('config_overrides').shop;
  assert.deepEqual(saved.find((r) => r.item === 'quiver'), { item: 'quiver', cost: 99 });
  // Simulate a new item being inserted at the front: the saved quiver price still lands on the quiver.
  repo.setSetting('config_overrides', { shop: [{ item: 'new_thing', cost: 5 }, ...saved] });
  settings.reload();
  assert.equal(settings.all.shop.find((r) => r.item === 'quiver').cost, 99);
  assert.equal(settings.all.shop.find((r) => r.item === 'smithing_hammer').cost, 111);
});

// ---- Sterling alloy, farming ---------------------------------------------------

test('Sterling Alloy (silver + copper) at Smelting 20 is what the knife is smithed from', () => {
  const { repo, say } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addXp(u.id, 'smelting', xpForLevel(20));
  repo.addItem(u.id, 'silver_ore', 1);
  repo.addItem(u.id, 'copper_ore', 1);
  assert.match(say('!smelt sterling'), /smelted 🪙 Sterling Alloy/);
  assert.deepEqual(repo.getInventory(u.id), { sterling_bar: 1 });
});

function farmSetup() {
  const repo = openDb(':memory:');
  let t = 1_000_000;
  const cfg = { ...baseConfig, game: { ...baseConfig.game, farmCooldown: 10 } };
  const engine = new GameEngine({ repo, config: cfg, rng: () => 0.5, now: () => t });
  const say = (content) => engine.handleChat({ kickUserId: '1', username: 'Alice', content }).reply;
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  return { repo, engine, say, u, wait: (sec) => (t += sec * 1000) };
}

test('farming: free starter plot, buy seeds and plots, plant, wait 20 minutes, harvest 1 per plot', () => {
  const { repo, engine, say, u, wait } = farmSetup();
  assert.equal(engine.plotCount(u.id), 1, 'everyone starts with a free plot');
  assert.match(say('!farm'), /🌱 Farm: 1\/100 plots · 🟫 1 empty/);
  assert.match(say('!plant'), /you have no seeds! !buy carrot seeds 1 \(2 pts each\)/);
  assert.match(say('!harvest'), /your plots are empty/);
  repo.addPoints(u.id, 2000);
  assert.match(say('!buy plot 2'), /bought 2 farm plots for 1,500 pts! You now have 3\/100\. Buy seeds \(!buy carrot seeds 3\)/);
  assert.match(say('!buy carrot seeds 5'), /bought 🌱 5x Carrot Seeds for 10 pts! Now !plant carrot/);
  assert.equal(engine.backpack(u.id).used, 0, "seeds don't use backpack slots");

  assert.match(say('!plant carrot'), /🌱 planted 🥕 Carrot in 3 plots — ready in 20m\. \+6 XP/);
  assert.equal(repo.getInventory(u.id).carrot_seeds, 2);
  wait(11);
  assert.match(say('!plant'), /all 3 plots are growing\. Next ready in 20m/);
  wait(11);
  assert.match(say('!harvest'), /nothing is ready yet\. Next: 🥕 Carrot in 20m/);

  wait(20 * 60);
  assert.match(say('!farm'), /✅ 3 ready \(!harvest\)/);
  assert.match(say('!harvest'), /🌾 harvested 3 plots: 🥕 3x Carrot! \+36 XP.* !plant again!/);
  assert.equal(repo.getInventory(u.id).carrot, 3);
  assert.equal(engine.farmPlots(u.id).filter((p) => p.crop).length, 0);
  assert.match(say('!sell carrot all'), /sold 🥕 3x Carrot for 33 pts/);
});

test('farming has its own cooldown, separate from skilling', () => {
  const { repo, say, u } = farmSetup();
  repo.addPoints(u.id, 3000);
  say('!buy plot 2');
  say('!buy carrot seeds 3');
  assert.match(say('!plant carrot 1'), /planted 🥕 Carrot in 1 plot.*\(2 plots still empty\)/);
  assert.match(say('!plant carrot'), /easy there, farmer! Try again in 10s/);
  assert.equal(say('!plant carrot'), null, 'warns once');
  assert.match(say('!fish'), /you caught/, 'skilling is not blocked by farming');
});

test('farming level gates seeds; plot limit is 100; harvest respects backpack space', () => {
  const { repo, engine, say, u, wait } = farmSetup();
  repo.addPoints(u.id, 1_000_000);
  assert.match(say('!buy tomato seeds'), /need 🌱 Farming level 30 to grow Tomato/);
  assert.match(say('!buy plot 150'), /bought 99 farm plots/, 'capped at 100 including the free one');
  assert.match(say('!buy plot'), /maximum of 100 farm plots/);
  say('!buy carrot seeds 100');
  say('!plant');
  wait(21 * 60);
  // 10-slot backpack: 10 plots' carrots fit, the rest wait.
  assert.match(say('!harvest'), /harvested 10 plots: 🥕 10x Carrot!.*Backpack full — 90 plots still waiting!/);
  assert.equal(engine.farmPlots(u.id).filter((p) => p.ready).length, 90);
  wait(11);
  assert.match(say('!harvest'), /no backpack space to harvest \(10\/10\)/);
});

test('growth time multiplier (admin) speeds up new plantings', () => {
  const { Settings } = require('../src/settings');
  const repo = openDb(':memory:');
  const settings = new Settings({ config: { ...baseConfig, adminUsers: [], kick: { channel: 's' } }, repo });
  settings.update('economy', { growMultiplier: 0.5 });
  let t = 1_000_000;
  const engine = new GameEngine({ repo, config: baseConfig, settings, rng: () => 0.5, now: () => t });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 1000);
  engine.handleChat({ kickUserId: '1', username: 'Alice', content: '!buy plot' });
  engine.handleChat({ kickUserId: '1', username: 'Alice', content: '!buy carrot seeds' });
  assert.match(engine.handleChat({ kickUserId: '1', username: 'Alice', content: '!plant' }).reply, /ready in 10m/);
});

test('201 crops, a new one every 2-3 levels from Carrot (1) to World Tree Fruit (500)', () => {
  const { SKILLS, ITEMS } = require('../src/game/skills');
  const crops = SKILLS.farming.resources;
  assert.equal(crops.length, 201);
  assert.deepEqual(crops.slice(0, 4).map((c) => `${c.item}@${c.level}`), ['carrot@1', 'radish@2', 'lettuce@4', 'potato@5']);
  assert.equal(crops[0].grow, 20);
  assert.equal(crops.at(-1).item, 'world_tree_fruit');
  assert.equal(crops.at(-1).level, 500);
  for (let i = 1; i < crops.length; i++) {
    assert.ok(crops[i].level - crops[i - 1].level <= 3, `gap before ${crops[i].item}`);
    assert.ok(ITEMS[crops[i].item].value >= ITEMS[crops[i - 1].item].value, crops[i].item);
  }
  for (const c of crops) {
    assert.deepEqual(c.yield, [1, 1]);
    assert.ok(ITEMS[c.item].value >= c.seedCost * 5, `${c.item} is profitable`);
  }
  // The original crops kept their levels, so existing seeds still work.
  const lvl = Object.fromEntries(crops.map((c) => [c.item, c.level]));
  assert.deepEqual([lvl.potato, lvl.tomato, lvl.watermelon, lvl.mandrake], [5, 30, 100, 200]);
});

test('similar crop names are planted by their full name', () => {
  const { repo, say, u, wait } = farmSetup();
  repo.addXp(u.id, 'farming', xpForLevel(200));
  repo.addPoints(u.id, 100_000);
  say('!buy plot');
  say('!buy lemon balm seeds');
  assert.match(say('!plant'), /planted 🍋 Lemon Balm in 1 plot/);
  wait(11);
  assert.match(say('!plant lemon'), /you have no Lemon Seeds! !buy lemon seeds/);
});

test('players who bought plots before the free plot existed get it on top', () => {
  const { repo, engine, u } = farmSetup();
  repo.setEquipment(u.id, 'plots', 4); // bought 4 under the old rules
  assert.equal(engine.plotCount(u.id), 5);
});

// ---- Casino --------------------------------------------------------------------

test('bets: numbers, k/m, half, all, percent', () => {
  const { parseBet } = require('../src/game/casino');
  assert.equal(parseBet('500', 1000), 500);
  assert.equal(parseBet('1.5k', 0), 1500);
  assert.equal(parseBet('2m', 0), 2_000_000);
  assert.equal(parseBet('all', 1234), 1234);
  assert.equal(parseBet('half', 1235), 617);
  assert.equal(parseBet('25%', 1000), 250);
  assert.equal(parseBet('lots', 1000), null);
});

test('!slots pays 3-of-a-kind, pairs and single KICK; loses otherwise', () => {
  // Reel strip weights: chat 30, follow 25, gift 18, mic 12, cam 9, live 5, kick 3 (total 102).
  const at = (id) => {
    const { SLOT_SYMBOLS } = require('../src/game/casino');
    let start = 0;
    for (const s of SLOT_SYMBOLS) {
      if (s.id === id) return (start + 0.5) / 102;
      start += s.weight;
    }
  };
  const { repo, say, tick } = setup({ rolls: [at('gift'), at('gift'), at('gift'), at('chat'), at('follow'), at('mic'), at('kick'), at('chat'), at('mic')] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 995); // 1,000 total
  assert.match(say('!slots 100'), /🎰 \[ 🎁 \| 🎁 \| 🎁 \] 3x Gift Sub! WON 1,500 pts \(15x\)! 💰 Balance: 2,400/);
  tick();
  assert.match(say('!slots 100'), /🎰 \[ 💬 \| 💚 \| 🎙️ \] lost 100\. Balance: 2,300/);
  tick();
  assert.match(say('!slots 100'), /🎰 \[ 🟩 \| 💬 \| 🎙️ \] lucky KICK! bet back\. Balance: 2,30\d/);
  assert.match(say('!slots'), /usage: !slots <bet>/);
});

test('casino rules: cooldown (warned once), min bet, balance, max bet cap, closed', () => {
  const { repo, settings, say, tick } = withLiveSettings();
  const u = repo.getUserByName('alice') || repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 1000);
  assert.match(say('!slots 5'), /minimum bet is 10 pts/);
  assert.match(say('!slots 999999'), /you only have 1,00\d pts/);
  say('!slots 10');
  assert.match(say('!slots 10'), /easy! Next bet in 5s/);
  assert.equal(say('!slots 10'), null, 'cooldown warning only once');
  tick();
  settings.update('casino', { casinoMaxBet: 50 });
  const before = repo.getUser(u.id).points;
  say('!slots all');
  const after = repo.getUser(u.id).points;
  assert.ok(before - after <= 50, '"all" is capped to the max bet');
  settings.update('casino', { casinoEnabled: false });
  tick();
  assert.match(say('!slots 10'), /casino is closed/);
});

test('!roulette: red/black, numbers, either argument order', () => {
  // WHEEL_ORDER[1] = 32 (red); WHEEL_ORDER[0] = 0 (green)
  const { repo, say, tick } = setup({ rolls: [1.5 / 37, 0.5 / 37, 1.5 / 37] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 995);
  assert.match(say('!roulette red 100'), /🎡 🔴 32 — you bet red: WON 200 pts \(2x\)! 💰 Balance: 1,100/);
  tick();
  assert.match(say('!roulette 100 black'), /🎡 🟢 0 — you bet black: lost 100/);
  tick();
  assert.match(say('!roulette 32 100'), /you bet number 32: WON 3,600 pts \(36x\)/);
  assert.match(say('!roulette purple 100'), /bet on red, black, green/);
  assert.match(say('!roulette banana 10'), /bet on red, black, green/);
});

test('!plinko: 12 rows, risk levels, path decides the bucket', () => {
  const { repo, say, tick } = setup({ rolls: [...Array(12).fill(0.1), ...Array(6).fill(0.1), ...Array(6).fill(0.9)] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 995);
  assert.match(say('!plinko 100 high'), /🔻 Plinko \(high\) landed on 170x: WON 17,000 pts/);
  tick();
  assert.match(say('!plinko medium 100'), /landed on 0\.3x: lost 70/);
});

test('!bj: deal, hit, stand, double; hand survives between commands', () => {
  // Cards use two rolls each (rank, suit). Ranks: A,2..10,J,Q,K -> index/13.
  const r = (rank) => (['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(rank) + 0.5) / 13;
  const suit = 0.1; // spades
  // Player 10+6, dealer 9 + 7. Hit -> 4 (20). Stand: dealer 16 draws 5 -> 21? no: give dealer a K -> bust.
  const { repo, engine, say, tick } = setup({ rolls: [r('10'), suit, r('6'), suit, r('9'), suit, r('7'), suit, r('4'), suit, r('K'), suit] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 995); // 1,000
  assert.match(say('!bj 100'), /🃏 You: 10♠ 6♠ \(16\) \| Dealer: 9♠ 🂠 \(9\) — !hit, !stand or !double/);
  assert.equal(repo.getUser(u.id).points, 900, 'stake taken up front');
  assert.match(say('!bj 100'), /You: 10♠ 6♠/, 'shows the hand in play instead of dealing again');
  assert.match(say('!hit'), /You: 10♠ 6♠ 4♠ \(20\).*— !hit or !stand$/);
  assert.match(say('!stand'), /Dealer: 9♠ 7♠ K♠ \(26\) — you WIN 200 pts\. Balance: 1,100/);
  assert.match(say('!stand'), /no hand in play/);
  assert.equal(engine.blackjackState(u).status, 'none');
});

test('blackjack: split a pair into two hands, each settled against the dealer', () => {
  const r = (rank) => (['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(rank) + 0.5) / 13;
  const s = 0.1; // spades
  // Player 8 8, dealer 10 7. Split: hand 1 gets 3 (11), hand 2 gets 10 (18).
  // Hand 1: double -> 10 (21). Hand 2: stand. Dealer stands on 17: hand 1 wins 2x on 200, hand 2 wins 2x on 100.
  const { repo, engine, say } = setup({ rolls: [r('8'), s, r('8'), s, r('10'), s, r('7'), s, r('3'), s, r('10'), s, r('10'), s] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 995); // 1,000
  assert.match(say('!bj 100'), /You: 8♠ 8♠ \(16\) \| Dealer: 10♠ 🂠 \(10\) — !hit, !stand, !double or !split/);
  assert.match(say('!split'), /🃏 👉Hand 1: 8♠ 3♠ \(11\) \| Hand 2: 8♠ 10♠ \(18\) \| Dealer: 10♠ 🂠 \(10\) — hand 1: !hit, !stand or !double/);
  assert.equal(repo.getUser(u.id).points, 800, 'a second stake for the split');
  assert.match(say('!double'), /👉Hand 2: 8♠ 10♠ \(18\)/);
  assert.equal(engine.blackjackState(u).hands[0].stake, 200);
  assert.match(say('!stand'), /Hand 1: 8♠ 3♠ 10♠ \(21\) ✅ \| Hand 2: 8♠ 10♠ \(18\) ✅ \| Dealer: 10♠ 7♠ \(17\) — WON 600 pts total\. Balance: 1,300/);
  assert.match(say('!split'), /no hand in play/);
});

test('blackjack: only pairs split, and old saved hands still load', () => {
  const r = (rank) => (['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(rank) + 0.5) / 13;
  const { repo, engine, say } = setup({ rolls: [r('8'), 0.1, r('9'), 0.1, r('10'), 0.1, r('7'), 0.1] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 995);
  say('!bj 100');
  assert.match(say('!split'), /you can only split a pair/);
  // A hand saved by the previous version (single hand shape).
  const bob = repo.upsertUser({ kickUserId: '2', username: 'Bob' });
  repo.setSetting(`bj:${bob.id}`, { stake: 50, player: [{ rank: '9', suit: '♠' }, { rank: '7', suit: '♥' }], dealer: [{ rank: '10', suit: '♣' }, { rank: '8', suit: '♦' }], doubled: false });
  assert.equal(engine.blackjackState(bob).playerTotal, 16);
  assert.match(engine.handleChat({ kickUserId: '2', username: 'Bob', content: '!stand' }).reply, /dealer wins, lost 50/);
});

test('crash: chat cashes out at a target; the site runs a live round', () => {
  // crash point = 0.99 / (1 - roll): roll 0.505 -> 2.0x, roll 0 -> 1.00x (instant crash)
  const { repo, engine, say, tick } = setup({ rolls: [0.505, 0.0, 0.8] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 995);
  assert.match(say('!crash 100 2x'), /🚀 cashed out at 2x before it crashed at 2x: WON 200 pts \(2x\)! 💰 Balance: 1,100/);
  tick(6);
  assert.match(say('!crash 1.5x 100'), /🚀 crashed at 1x before 1.5x: lost 100\. Balance: 1,000/);
  tick(6);
  assert.match(say('!crash 100 0.5x'), /cash out at 1.01x/);

  // Live: roll 0.8 -> crash at 4.95x. Cash out after 10s (~2x).
  const start = engine.crashStart(u, '100', '');
  assert.equal(start.status, 'running');
  assert.equal(repo.getUser(u.id).points, 900);
  tick(10);
  const out = engine.crashCashout(u);
  assert.equal(out.status, 'cashed');
  assert.equal(out.multiplier, 2.01);
  assert.equal(out.payout, 201);
  assert.equal(out.crash, 4.95);
  assert.equal(engine.crashState(u).status, 'none');
});

test('crash: the live round settles itself at the crash or the auto target', () => {
  const { repo, engine, tick } = setup({ rolls: [0.8, 0.8] });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 995);
  engine.crashStart(u, '100', '');
  tick(60); // 4.95x crash comes at ~22.8s
  const lost = engine.crashState(u);
  assert.equal(lost.status, 'crashed');
  assert.equal(lost.payout, 0);
  assert.equal(repo.getUser(u.id).points, 895);
  tick(6);
  engine.crashStart(u, '100', '3x');
  tick(120);
  const won = engine.crashState(u);
  assert.equal(won.status, 'cashed');
  assert.equal(won.multiplier, 3);
  assert.equal(repo.getUser(u.id).points, 1095);
});

test('mines: reveal gems for a rising multiplier, cash out, or hit a mine', () => {
  const { repo, engine, say, tick } = setup();
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 995);
  const casino = require('../src/game/casino');
  assert.match(say('!mines 100 3'), /💣 Mines \(3 on 25 tiles, bet 100\):\. !pick 1-25 for 1.12x\./);
  const { mines } = repo.getSetting(`mines:${u.id}`);
  const safe = [...Array(25).keys()].filter((t) => !mines.includes(t));
  assert.match(say(`!pick ${safe[0] + 1}`), new RegExp(`💎 ${safe[0] + 1}\\. !pick 1-25 for 1.28x\\. Cash out: 112 pts \\(1.12x\\)`));
  assert.match(say(`!pick ${safe[0] + 1}`), /already revealed/);
  assert.match(say('!cashout'), /💎 cashed out at 1.12x: WON 112 pts!/);
  assert.equal(repo.getUser(u.id).points, 1012);
  tick(6);
  say('!mines 100 24');
  const board = repo.getSetting(`mines:${u.id}`);
  const mine = board.mines[0];
  assert.match(say(`!pick ${mine + 1}`), new RegExp(`💥 BOOM! Tile ${mine + 1} was a mine\\. Lost 100`));
  assert.equal(repo.getUser(u.id).points, 912);
  assert.equal(casino.minesMultiplier(24, 1), 24.75);
  assert.match(say('!cashout'), /no board in play/);
});

test('blackjack pays 3:2 and doubling doubles the stake', () => {
  const r = (rank) => (['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(rank) + 0.5) / 13;
  const s = 0.1;
  const { repo, say, tick } = setup({
    rolls: [r('A'), s, r('K'), s, r('9'), s, r('7'), s, /* hand 2 */ r('5'), s, r('6'), s, r('10'), s, r('7'), s, r('10'), s],
  });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 995);
  assert.match(say('!bj 100'), /BLACKJACK! Won 250 pts\. Balance: 1,150/);
  tick();
  // 5+6 = 11, double -> draws 10 = 21. Dealer 10+7 = 17 stands. Win 2x on a 200 stake.
  say('!bj 100');
  // 1,150 - 100 stake - 100 more to double + 400 back = 1,350
  assert.match(say('!double'), /You: 5♠ 6♠ 10♠ \(21\) \| Dealer: 10♠ 7♠ \(17\) — you WIN 400 pts\. Balance: 1,350/);
});

test('big wins go to the live feed', () => {
  const { repo, engine, say } = setup({ rolls: Array(12).fill(0.1) });
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 995);
  const seen = [];
  engine.on('activity', (a) => seen.push(a));
  say('!plinko 100 high');
  assert.equal(seen.at(-1).kind, 'jackpot');
  assert.match(seen.at(-1).text, /won 17,000 pts on plinko/);
});

test('return to player is close to a real casino', () => {
  const casino = require('../src/game/casino');
  let x = 42;
  const rng = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  let slots = 0;
  let plinko = 0;
  const N = 200_000;
  for (let i = 0; i < N; i++) {
    slots += casino.spinSlots(rng).multiplier;
    plinko += casino.dropPlinko(rng, 'medium').multiplier;
  }
  assert.ok(slots / N > 0.9 && slots / N < 1, `slots RTP ${slots / N}`);
  assert.ok(plinko / N > 0.95 && plinko / N < 1.02, `plinko RTP ${plinko / N}`);
});

test('chat points: short messages, repeats and new chatters earn nothing; subscribers earn more', () => {
  const { Settings } = require('../src/settings');
  const repo = openDb(':memory:');
  const settings = new Settings({ config: { ...baseConfig, adminUsers: [], kick: { channel: 's' } }, repo });
  let t = 1_000_000;
  const engine = new GameEngine({ repo, config: baseConfig, settings, rng: () => 0.99, now: () => t });
  const say = (content, badges) => engine.handleChat({ kickUserId: '1', username: 'Alice', content, badges });
  const pts = () => repo.getUserByName('alice').points;
  say('a');
  assert.equal(pts(), 0, 'too short');
  say('[emote:1:KEKW]');
  assert.equal(pts(), 0, 'just an emote');
  say('hello chat');
  assert.equal(pts(), 5);
  t += 61_000;
  say('hello chat');
  assert.equal(pts(), 5, 'a repeat');
  say('good game', ['subscriber']);
  assert.equal(pts(), 15, 'subscribers earn 2x');
  assert.equal(repo.getUserByName('alice').subscriber, 1);
  settings.update('general', { chatPointsNewUserMinutes: 60 });
  t += 61_000;
  engine.handleChat({ kickUserId: '2', username: 'Bob', content: 'first message here' });
  assert.equal(repo.getUserByName('bob').points, 0, 'new chatters wait');
});

test('the bot combines replies that are waiting into one message', async () => {
  const { ChatBot } = require('../src/bot/bot');
  const { engine } = setup();
  const sent = [];
  const bot = new ChatBot({ engine, kick: { botAccount: () => null, sendChat: async (t) => sent.push(t) }, logger: { info() {}, error() {} } });
  bot.minGapMs = 5;
  bot.say('@A one');
  bot.say('@B two');
  bot.say('@C three');
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(sent, ['@A one', '@B two | @C three']);
  assert.ok(bot.isOwnReply('@B two | @C three'), 'a combined reply is still recognised as ours');
  bot.say('x'.repeat(300));
  bot.say('y'.repeat(300));
  bot.say('z'.repeat(10));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(sent.length, 4, 'never over 500 characters');
});
