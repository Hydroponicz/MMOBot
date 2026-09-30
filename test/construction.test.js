const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');
const { SKILLS, ITEMS } = require('../src/game/skills');
const { xpForLevel } = require('../src/game/xp');

const config = {
  baseUrl: 'http://localhost:3000',
  game: { prefix: '!', staminaMax: 50, staminaMinutes: 0.5, racePerks: false, petDropMultiplier: 0, chatPoints: 0, chatCooldown: 60, replyInChat: true },
};

function setup() {
  const repo = openDb(':memory:');
  let t = 1_000_000;
  // 0.99: never fails, never rare.
  const engine = new GameEngine({ repo, config, rng: () => 0.99, now: () => t });
  const say = (content) => {
    t += 31_000;
    return engine.handleChat({ kickUserId: '1', username: 'Alice', content }).reply;
  };
  say('hi');
  const u = repo.getUserByName('alice');
  return { repo, engine, say, u, inv: () => repo.getInventory(u.id), xp: (s) => repo.getSkills(u.id)[s] };
}

test('carpentry: a saw turns logs into planks, a hammer turns alloys into nails', () => {
  const { repo, say, u, inv, xp } = setup();
  repo.addItem(u.id, 'logs', 3);
  repo.addItem(u.id, 'bronze_bar', 2);
  assert.match(say('!saw planks'), /you need a 🪚 Saw in your backpack to saw! !buy saw \(500 pts\) or !smith saw \(Smithing 5: 2 Bronze Alloy\)/);
  repo.addItem(u.id, 'saw', 1);
  assert.match(say('!saw planks'), /Wooden Planks/);
  assert.equal(inv().logs, 2);
  assert.equal(inv().wooden_planks, 1);
  assert.ok(xp('carpentry') > 0);
  assert.match(say('!planks'), /Wooden Planks/);
  assert.equal(inv().wooden_planks, 2);
  // Nails need the hammer, not the saw.
  assert.match(say('!nails'), /you need a 🔨 Smithing Hammer/);
  repo.addItem(u.id, 'smithing_hammer', 1);
  assert.match(say('!saw nails'), /Bronze Nails/);
  assert.match(say('!nails bronze'), /Bronze Nails/);
  assert.equal(inv().bronze_nails, 2);
  assert.equal(inv().bronze_bar, undefined);
  // Iron nails need Carpentry 15.
  repo.addItem(u.id, 'iron_bar', 1);
  assert.match(say('!nails iron'), /Carpentry level 15/);
  // A bare !saw lists what you can make.
  repo.addItem(u.id, 'logs', 1);
  assert.match(say('!saw'), /you can saw: .*wooden planks/);
});

test('construction: planks + nails become building parts, best of a kind with !build <kind>', () => {
  const { repo, say, u, inv, xp } = setup();
  repo.addItem(u.id, 'wooden_planks', 6);
  repo.addItem(u.id, 'bronze_nails', 3);
  assert.match(say('!build frame'), /you need a 🔨 Smithing Hammer/);
  repo.addItem(u.id, 'smithing_hammer', 1);
  assert.match(say('!build frame'), /Wooden Frame/);
  assert.equal(inv().wooden_planks, 4);
  assert.equal(inv().bronze_nails, 2);
  assert.ok(xp('construction') > 0);
  assert.match(say('!build roof'), /Construction level 11/);
  repo.addXp(u.id, 'construction', xpForLevel(20));
  assert.match(say('!build wall'), /Wooden Wall Panel/);
  assert.equal(inv().wooden_planks, undefined);
  assert.match(say('!build door'), /needs 3 Wooden Planks \+ 1 Bronze Nails. You're missing 3 Wooden Planks \+ 1 Bronze Nails — try !saw wooden \/ !saw bronze/);
  assert.match(say('!construct oak frame'), /needs 2 Oak Planks \+ 1 Iron Nails/);
});

test('every building part is worth more than its planks and nails, and every tier is reachable', () => {
  for (const r of SKILLS.construction.recipes) {
    const inputs = Object.entries(r.inputs).reduce((s, [i, q]) => s + ITEMS[i].value * q, 0);
    assert.ok(ITEMS[r.item].value > inputs, r.item);
    assert.ok(r.level <= SKILLS.construction.maxLevel, r.item);
    for (const i of Object.keys(r.inputs)) assert.ok(SKILLS.carpentry.recipes.some((c) => c.item === i), `${i} is made by carpentry`);
  }
  assert.equal(SKILLS.construction.recipes.length, 44);
});
