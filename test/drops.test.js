// Uses for combat drops: dishes, potions, arrows, capes, containers, trophies and !item.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');
const { xpForLevel } = require('../src/game/xp');
const { ITEMS, SKILLS, MUSEUM } = require('../src/game/skills');
const { CONTAINERS } = require('../src/game/content');

function setup(rng = () => 0.2) {
  const repo = openDb(':memory:');
  let t = 1_000_000;
  const config = { baseUrl: 'http://localhost', game: { prefix: '!', staminaMax: 100, staminaMinutes: 0.5, racePerks: false, petDropMultiplier: 0, chatPoints: 0, replyInChat: true } };
  const engine = new GameEngine({ repo, config, rng, now: () => t });
  const say = (content) => engine.handleChat({ kickUserId: '1', username: 'Alice', content }).reply;
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  return { repo, engine, say, u, wait: (ms) => (t += ms) };
}

test('every monster drop has a use besides selling', () => {
  const { engine } = setup();
  for (const m of SKILLS.swords.monsters) {
    for (const id of [...m.loot, ...(m.rare ? [m.rare.item] : [])]) {
      if (ITEMS[id].gear || ITEMS[id].food) continue;
      assert.ok(engine.itemUses(id).uses.length, `${ITEMS[id].name} (${m.name}) has no use`);
    }
  }
});

test('!item says where an item comes from and what it is for', () => {
  const { say } = setup();
  assert.match(say('!item cheese'), /🧀 Cheese · from 🐀 Giant Rats \(level 5\) · used for: Cheesy Potato Bake \(🍳 Cooking 8\) · sells for \d+ pts/);
  assert.match(say('!item wolf fang'), /from 🐺 Wolves .*Fang Arrows/);
  assert.match(say('!whatis goblin pouch'), /!open it for points and loot/);
  assert.match(say('!item soul gem'), /Legendary Relics/);
  assert.match(say('!item nonsense'), /no item called "nonsense"/);
  assert.match(say('!item'), /usage: !item <name>/);
});

test('monster dishes heal and make you Well Fed', () => {
  const { repo, engine, say, u } = setup(() => 0.99);
  repo.addXp(u.id, 'cooking', xpForLevel(10));
  repo.setSetting(`fire:${u.id}`, 2_000_000_000);
  repo.addItem(u.id, 'cheese', 1);
  repo.addItem(u.id, 'potato', 1);
  assert.match(say('!cook cheesy potato bake'), /you cooked 🧀 Cheesy Potato Bake!/);
  repo.setVitals(u.id, { hp: 10, mana: 0, koUntil: 0 }, 1_000_000);
  assert.match(say('!eat cheesy'), /ate a Cheesy Potato Bake .*🍲 Well Fed for 15 min/);
  assert.equal(engine.hasBuff(u.id, 'wellfed'), true);
});

test('monster potions: brewed from drops, each with its own duration; stoneskin and venom boost fights', () => {
  const { repo, engine, say, u } = setup();
  repo.addXp(u.id, 'alchemy', xpForLevel(100));
  repo.addItem(u.id, 'goblin_ear', 2);
  repo.addItem(u.id, 'carrot', 1);
  repo.addItem(u.id, 'ashes', 10);
  assert.match(say('!brew goblin grog'), /you brewed 🍺 Goblin Grog!/);
  assert.match(say('!drink goblin grog'), /Grave Luck for 20 min/);
  repo.addItem(u.id, 'ogre_tooth', 2);
  assert.match(say('!brew stoneskin'), /Stoneskin Tonic/);

  repo.addItem(u.id, 'bronze_sword', 1);
  repo.addItem(u.id, 'bronze_helmet', 1);
  say('!equip bronze helmet');
  const pick = engine.chooseWeapon(u.id);
  const before = engine.fightStats(u.id, pick);
  assert.match(say('!drink stoneskin'), /Stoneskin for 20 min: \+25% defence/);
  assert.ok(engine.fightStats(u.id, pick).defence > before.defence);
  engine.addBuff(u.id, 'venom');
  assert.ok(engine.fightStats(u.id, pick).attack > before.attack);
});

test('fang arrows are fletched from wolf fangs and shot with a bow', () => {
  const { repo, say, u } = setup();
  repo.addXp(u.id, 'fletching', xpForLevel(20));
  repo.addItem(u.id, 'quiver', 1);
  repo.addItem(u.id, 'oak_logs', 1);
  repo.addItem(u.id, 'feathers', 1);
  repo.addItem(u.id, 'wolf_fang', 1);
  assert.match(say('!fletch fang arrows'), /fletched 🏹 10x Fang Arrows!/);
  assert.equal(repo.getInventory(u.id).fang_arrows, 10);
  assert.equal(ITEMS.fang_arrows.ammo, 'bow');
});

test('hides and scales become capes to wear', () => {
  const { repo, engine, say, u } = setup();
  repo.addXp(u.id, 'crafting', xpForLevel(20));
  repo.addItem(u.id, 'wolf_pelt', 3);
  assert.match(say('!craft wolf pelt cape'), /crafted 🐺 Wolf Pelt Cape!/);
  assert.equal(engine.setAppearance(u, { look: { cape: 'wolf_pelt_cape' } }).ok, true);
  assert.equal(engine.characterView(u.id).cosmetics.cape, '#6d6258');
  assert.equal(ITEMS.demon_horns.cosmetic.style, 'demon');
});

test('!open gives points and loot; the Scavenger quest counts it', () => {
  const { repo, say, u } = setup();
  assert.match(say('!open'), /nothing to open/);
  assert.match(say('!quest start scavenger'), /Started 🦴 The Monster Scavenger/);
  repo.addItem(u.id, 'goblin_pouch', 2);
  const pts = repo.getUser(u.id).points;
  assert.match(say('!open'), /opened a Goblin Pouch: \+\d+ pts and .*Magic Rune.*\(1 more to open: !open all\)/);
  assert.ok(repo.getUser(u.id).points > pts);
  assert.match(say('!open goblin pouch'), /opened a Goblin Pouch/);
  assert.equal(repo.getInventory(u.id).goblin_pouch, undefined);
  for (const c of Object.values(CONTAINERS)) for (const [i] of c.loot) assert.ok(ITEMS[i]);
});

test('rare drops fill two new museum collections', () => {
  const ids = MUSEUM.map((c) => c.id);
  assert.ok(ids.includes('trophies') && ids.includes('legends'));
  for (const c of MUSEUM.slice(-2)) for (const i of c.items) assert.ok(ITEMS[i], i);
});
