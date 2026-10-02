const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');
const { ITEMS, SKILLS, SHOP, COMBAT_SKILLS, WEAPON_SKILL } = require('../src/game/skills');
const { PETS } = require('../src/game/content');
const { TOWN_BUILDINGS } = require('../src/game/town');

const config = {
  baseUrl: 'http://localhost:3000',
  game: { prefix: '!', staminaMax: 10, staminaMinutes: 0.5, racePerks: false, petDropMultiplier: 0, chatPoints: 0, chatCooldown: 60, replyInChat: true },
};
const NEW = ['axes', 'daggers', 'spears', 'brawling', 'necromancy'];

function setup(rng = () => 0.5) {
  const repo = openDb(':memory:');
  let t = 50_000_000;
  const engine = new GameEngine({ repo, config, rng, now: () => t });
  engine.announce = () => {};
  const say = (content, name = 'Alice', id = '1') => {
    t += 31_000;
    return engine.handleChat({ kickUserId: id, username: name, content }).reply;
  };
  say('hi');
  const u = repo.getUserByName('alice');
  return { repo, engine, say, u };
}

test('five new combat skills: own command, weapon type, a starter in the shop, a smithed weapon per metal, a pet and a town building', () => {
  assert.deepEqual(COMBAT_SKILLS, ['swords', 'archery', 'magic', ...NEW]);
  for (const id of NEW) {
    const sk = SKILLS[id];
    assert.equal(WEAPON_SKILL[sk.weaponType], id);
    assert.equal(sk.monsters, SKILLS.swords.monsters, `${id} fights the same monsters`);
    assert.ok(SHOP.some((x) => ITEMS[x.item]?.weaponType === sk.weaponType), `${id} has a starter weapon`);
    const smithed = SKILLS.smithing.recipes.filter((r) => ITEMS[r.item].weaponType === sk.weaponType);
    assert.equal(smithed.length, 11, `${id}: one weapon per metal`);
    assert.ok(PETS.some((p) => p.skill === id), `${id} has a pet`);
    assert.ok(TOWN_BUILDINGS.some((b) => b.skills.includes(id)), `${id} has a town building`);
  }
  // Spears need planks for the shaft; scythes and battleaxes are two-handed.
  assert.deepEqual(SKILLS.smithing.recipes.find((r) => r.item === 'bronze_spear').inputs, { bronze_bar: 1, wooden_planks: 2 });
  assert.ok(SKILLS.axes.style.twoHanded && SKILLS.necromancy.style.twoHanded);
});

test('!punch works bare-handed and trains Brawling; knuckles hit harder', () => {
  const { repo, engine, say, u } = setup();
  const r = say('!punch chicken');
  assert.match(r, /you punched out a 🐔 Chicken .*Brawling/);
  assert.ok(repo.getSkills(u.id).brawling > 0);
  assert.equal(repo.getWorn(u.id).weapon, undefined, 'fists are never equipped');
  repo.addItem(u.id, 'bronze_knuckles', 1);
  const pick = engine.chooseWeapon(u.id, 'brawling');
  assert.equal(pick.weapon, 'bronze_knuckles');
  // !fight with no weapons points at !punch.
  repo.removeItem(u.id, 'bronze_knuckles', 1);
  assert.match(say('!fight'), /Or fight bare-handed: !punch/);
});

test('!cleave, !stab and !thrust need their weapon, say how to get it, then fight with it', () => {
  const { repo, say, u } = setup();
  assert.match(say('!cleave'), /🪓 you need a battleaxe for Axes! 🛒 !buy battleaxe \(1,000 pts.*!smith bronze battleaxe \(3 Bronze Alloy/);
  assert.match(say('!stab'), /🔪 you need a dagger for Daggers! 🛒 !buy dagger \(750 pts/);
  assert.match(say('!thrust'), /🔱 you need a spear for Spears!.*!smith bronze spear \(1 Bronze Alloy \+ 2 Wooden Planks/);
  repo.addPoints(u.id, 5000);
  assert.match(say('!buy dagger'), /bought 🔪 Bronze Dagger/);
  assert.match(say('!stab chicken'), /you stabbed a 🐔 Chicken \(equipped your Bronze Dagger\)/);
  assert.ok(repo.getSkills(u.id).daggers > 0);
  repo.addItem(u.id, 'bronze_battleaxe', 1);
  assert.match(say('!hack chicken'), /you cleaved a 🐔 Chicken \(equipped your Bronze Battleaxe\)/);
  assert.ok(repo.getSkills(u.id).axes > 0);
  repo.addItem(u.id, 'bronze_spear', 1);
  assert.match(say('!thrust chicken'), /you skewered a 🐔 Chicken/);
});

test('!raise needs Bone Shards, uses one per fight, and your minion fights with you', () => {
  const { repo, engine, say, u } = setup();
  repo.addItem(u.id, 'bronze_scythe', 1);
  assert.match(say('!raise'), /no Bone Shards to raise the dead with! !buy bone shards 50 \(8 pts each\) or !craft bone shards/);
  repo.addItem(u.id, 'bone_shard', 3);
  assert.match(say('!raise chicken'), /💀 you and your Skeleton defeated a 🐔 Chicken/);
  assert.equal(repo.getInventory(u.id).bone_shard, 2);
  assert.ok(repo.getSkills(u.id).necromancy > 0);
  // Shards don't take backpack slots.
  assert.equal(engine.backpack(u.id).used, 1, 'only the chicken loot');
  // Crafted from chicken bones and ashes.
  repo.addItem(u.id, 'raw_chicken', 1);
  repo.addItem(u.id, 'ashes', 1);
  assert.match(say('!craft bone shards'), /Bone Shards/);
  assert.equal(repo.getInventory(u.id).bone_shard, 12);
});

test('two-handed weapons ignore your shield; minions add attack', () => {
  const { repo, engine, u } = setup();
  repo.wear(u.id, 'shield', 'bronze_shield');
  repo.wear(u.id, 'head', 'bronze_helmet');
  repo.addItem(u.id, 'bronze_battleaxe', 1);
  repo.addItem(u.id, 'bronze_sword', 1);
  repo.addItem(u.id, 'bronze_scythe', 1);
  repo.addItem(u.id, 'bone_shard', 5);
  const sword = engine.fightStats(u.id, engine.chooseWeapon(u.id, 'swords'));
  const axe = engine.fightStats(u.id, engine.chooseWeapon(u.id, 'axes'));
  assert.equal(sword.defence - axe.defence, ITEMS.bronze_shield.defence);
  const scythe = engine.fightStats(u.id, engine.chooseWeapon(u.id, 'necromancy'));
  assert.equal(scythe.attack, ITEMS.bronze_scythe.attack + 1, 'a Skeleton adds 1');
});

test('fighting styles: reach keeps you safe early, crits and stuns show up in the fight', () => {
  const { engine } = setup();
  const monster = SKILLS.swords.monsters.find((m) => m.id === 'wolf');
  const plain = { attack: 10, defence: 5, style: null };
  const fightWith = (style, roll) => {
    engine.rng = roll;
    return engine.simulateFight(20, { ...plain, style }, monster, 1000);
  };
  const half = () => 0.5;
  const base = fightWith(null, half);
  const spear = fightWith(SKILLS.spears.style, half);
  assert.ok(spear.taken < base.taken, 'the monster loses its first swing to the reach');
  assert.equal(spear.moves.reach, 1);
  // Low rolls: every crit and stun lands.
  const lucky = () => 0.01;
  assert.ok(fightWith(SKILLS.daggers.style, lucky).moves.crit > 0);
  assert.ok(fightWith(SKILLS.brawling.style, lucky).moves.stun > 0);
  assert.ok(fightWith(SKILLS.axes.style, lucky).moves.cleave > 0);
  // The estimate knows about styles too.
  const est = (style) => engine.assessFight(20, { ...plain, style }, monster, 1000);
  assert.ok(est(SKILLS.spears.style).taken < est(null).taken);
  assert.ok(est(SKILLS.necromancy.style).taken < est(null).taken);
  assert.match(engine.styleNote({ moves: { crit: 2, stun: 1 } }), /\(2 critical hits, a stun\)/);
});

test('PvP: a spear strikes first; Daggers make you a better thief', () => {
  const { repo, engine, say, u } = setup();
  say('hi', 'Bob', '2');
  const bob = repo.getUserByName('bob');
  repo.addItem(u.id, 'bronze_spear', 1);
  repo.addItem(bob.id, 'bronze_sword', 1);
  const a = engine.pvpCombatant(u.id);
  const b = engine.pvpCombatant(bob.id);
  assert.equal(a.style.reach, 1);
  let first = null;
  const orig = engine.pvpHit.bind(engine);
  engine.pvpHit = (att, def) => {
    first ??= att.id;
    return orig(att, def);
  };
  engine.pvpCombat(b, a);
  assert.equal(first, u.id);
  const before = engine.heistChance(u.id, bob.id);
  repo.addXp(u.id, 'daggers', 500000);
  assert.ok(engine.heistChance(u.id, bob.id) > before);
  assert.ok(engine.daggerStealth(u.id) > 0 && engine.daggerStealth(u.id) <= 0.2);
});

test('the Tavern Brawler quest: punch chickens and goblins, smith knuckles', () => {
  const { repo, engine, say, u } = setup();
  const announced = [];
  engine.announce = (x) => announced.push(x);
  repo.addXp(u.id, 'brawling', 50000);
  assert.match(say('!quest start brawler'), /Tavern Brawler/);
  for (let i = 0; i < 5; i++) assert.match(say('!punch chicken'), /punched out/);
  for (let i = 0; i < 5; i++) assert.match(say('!punch goblin'), /punched out/);
  repo.addItem(u.id, 'smithing_hammer', 1);
  repo.addItem(u.id, 'bronze_bar', 1);
  say('!smith bronze knuckles');
  assert.ok(announced.some((x) => /Tavern Brawler/.test(x) && /the Brawler/.test(x)), announced.join('\n'));
});

test('Train page: targets per skill type, and each button runs the chat command', () => {
  const { repo, engine, u } = setup();
  const page = engine.trainingPage(u.id);
  const all = page.groups.flatMap((g) => g.skills);
  assert.equal(all.length, 24);
  const by = Object.fromEntries(all.map((s) => [s.id, s]));
  assert.ok(by.mining.targets.some((t) => t.id === 'Copper Ore' && t.ready));
  assert.ok(by.mining.targets.some((t) => t.locked), 'the next unlock is shown, locked');
  assert.ok(by.swords.targets[0].rating === null, 'no sword, no rating');
  assert.ok(by.brawling.targets[0].rating, 'fists always work');
  assert.equal(by.skinning.needs.item, 'skinning_knife');
  assert.equal(by.smithing.pickBest, false);
  // Nails are made with !craft: the Carpentry button still makes them.
  repo.addItem(u.id, 'smithing_hammer', 1);
  repo.addItem(u.id, 'bronze_bar', 1);
  assert.match(engine.trainAction(u, 'carpentry', 'Bronze Nails').message, /Bronze Nails/);
  // Swords on the website means swords, even when another style is better.
  repo.addItem(u.id, 'bronze_sword', 1);
  repo.addXp(u.id, 'brawling', 50000);
  assert.match(engine.trainAction(u, 'swords', 'Chicken').message, /🗡️ you defeated a 🐔 Chicken/);
  assert.match(engine.trainAction(u, 'farming', 'harvest').message, /plot|harvest|grow/i);
  // Out of stamina: the website always says so (chat only warns once).
  for (let i = 0; i < 12; i++) engine.trainAction(u, 'agility', '');
  assert.match(engine.trainAction(u, 'agility', '').message, /out of stamina/);
  assert.equal(engine.trainAction(u, 'nope', '').error, 'no such skill');
});

test('Train page backpack: lists items with prices; sell buttons work like !sell', () => {
  const { repo, engine, u } = setup();
  repo.addItem(u.id, 'copper_ore', 4);
  repo.addItem(u.id, 'bronze_sword', 1);
  repo.addItem(u.id, 'carrot', 3);
  const bag = engine.trainingPage(u.id).bag;
  const ore = bag.items.find((x) => x.id === 'copper_ore');
  assert.equal(ore.kind, 'loot');
  assert.ok(ore.each > 0 && ore.total >= ore.each);
  assert.equal(bag.items.find((x) => x.id === 'bronze_sword').kind, 'gear');
  assert.equal(bag.items.find((x) => x.id === 'carrot').kind, 'crop');
  assert.ok(bag.worth.loot > 0);
  const before = repo.getUser(u.id).points;
  assert.match(engine.trainSell(u, { item: 'copper_ore', qty: 1 }).message, /sold 🟠 Copper Ore/);
  assert.equal(repo.getInventory(u.id).copper_ore, 3);
  // Sell all loot keeps gear and crops, like !sell all.
  assert.match(engine.trainSell(u, { group: 'all' }).message, /kept your gear & tools and crops/);
  assert.equal(repo.getInventory(u.id).copper_ore, undefined);
  assert.equal(repo.getInventory(u.id).bronze_sword, 1);
  assert.match(engine.trainSell(u, { group: 'crops' }).message, /Carrot/);
  assert.ok(repo.getUser(u.id).points > before);
  assert.equal(engine.trainSell(u, { group: 'nope' }).error, 'unknown group');
  engine.cfg.disabledCommands = ['sell'];
  assert.match(engine.trainSell(u, { group: 'all' }).error, /switched off/);
});

test('Train page: sell several picked items at once, partial amounts too', () => {
  const { repo, engine, u } = setup();
  repo.addItem(u.id, 'copper_ore', 5);
  repo.addItem(u.id, 'oak_logs', 3);
  repo.addItem(u.id, 'bronze_sword', 1);
  const before = repo.getUser(u.id).points;
  const r = engine.trainSell(u, { items: [{ item: 'copper_ore', qty: 2 }, { item: 'oak_logs', qty: 'all' }, { item: 'bronze_sword', qty: 'all' }, { item: 'dragon_egg', qty: 1 }] });
  assert.match(r.message, /sold 6 items for \d+ pts/);
  const inv = repo.getInventory(u.id);
  assert.equal(inv.copper_ore, 3);
  assert.equal(inv.oak_logs, undefined);
  assert.equal(inv.bronze_sword, undefined);
  assert.ok(repo.getUser(u.id).points > before);
  // More than you have sells what you have; nothing valid is an error.
  assert.match(engine.trainSell(u, { items: [{ item: 'copper_ore', qty: 99 }] }).message, /3x|Copper Ore/);
  assert.equal(repo.getInventory(u.id).copper_ore, undefined);
  assert.equal(engine.trainSell(u, { items: [{ item: 'copper_ore', qty: 1 }] }).error, 'nothing selected to sell.');
});
