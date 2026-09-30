const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');
const { ITEMS } = require('../src/game/skills');
const { xpForLevel } = require('../src/game/xp');

const config = {
  baseUrl: 'http://localhost:3000',
  game: { prefix: '!', staminaMax: 50, staminaMinutes: 0.5, racePerks: false, petDropMultiplier: 0, chatPoints: 0, chatCooldown: 60, replyInChat: true },
};

function setup() {
  const repo = openDb(':memory:');
  let t = 1_000_000;
  const engine = new GameEngine({ repo, config, rng: () => 0.99, now: () => t });
  const say = (content, username = 'Alice', id = '1') => {
    t += 31_000;
    return engine.handleChat({ kickUserId: id, username, content }).reply;
  };
  say('hi');
  say('hi', 'Bob', '2');
  const u = repo.getUserByName('alice');
  const bob = repo.getUserByName('bob');
  return { repo, engine, say, u, bob, inv: () => repo.getInventory(u.id) };
}
const give = (repo, id, parts) => {
  for (const [item, qty] of Object.entries(parts)) repo.addItem(id, item, qty);
};

test('houses can be built from parts instead of bought', () => {
  const { repo, engine, say, u, inv } = setup();
  assert.match(say('!house build'), /Cottage needs character level 25/);
  // Character level 25: plenty of XP in the original skills.
  for (const s of ['fishing', 'mining', 'woodcutting', 'digging', 'farming']) repo.addXp(u.id, s, xpForLevel(26));
  assert.match(say('!house build'), /needs 🏗️ Construction level 10/);
  repo.addXp(u.id, 'construction', xpForLevel(10));
  give(repo, u.id, { wooden_frame: 10, wooden_wall_panel: 8, wooden_door: 2, oak_roof_truss: 1 });
  assert.match(say('!house build'), /takes 10 Frames, 8 Wall Panels, 2 Doors, 4 Roof Trusses \(Wooden or better\). You're missing 3 Roof Trusses/);
  give(repo, u.id, { wooden_roof_truss: 3, oak_frame: 1 });
  const before = repo.getSkills(u.id).construction;
  assert.match(say('!build house'), /you built your 🛖 Cottage!/);
  assert.equal(engine.house(u.id).id, 'cottage');
  // Cheapest parts first: the oak frame is kept, all the wooden ones are gone.
  assert.equal(inv().wooden_frame, undefined);
  assert.equal(inv().oak_frame, 1);
  assert.equal(inv().oak_roof_truss, undefined);
  assert.ok(repo.getSkills(u.id).construction > before);
  assert.equal(repo.getUser(u.id).points < 1000, true, 'no points were spent or given');
  // The next house needs oak or better.
  assert.match(say('!house'), /build it yourself from 16 Frames, 14 Wall Panels, 3 Doors, 8 Roof Trusses \(Oak or better\)/);
});

test('player shops: more market listings and a lower fee for the seller', () => {
  const { repo, engine, say, u, bob } = setup();
  assert.match(say('!stall'), /don't have a shop yet.*Market Stall/);
  repo.addXp(u.id, 'construction', xpForLevel(5));
  give(repo, u.id, { wooden_frame: 6, wooden_roof_truss: 1 });
  assert.match(say('!stall build'), /missing 1 Roof Truss\b/);
  repo.addItem(u.id, 'wooden_roof_truss', 1);
  assert.match(say('!build stall'), /Market Stall is open! 25 market listings at once and 4% fee/);
  assert.equal(engine.marketSlots(u.id, 20), 25);
  assert.equal(engine.sellerFee(u.id), 0.04);
  assert.equal(engine.sellerFee(bob.id), 0.05);
  // Bob buys from Alice's shelf: 4% fee instead of 5%.
  repo.addItem(u.id, 'logs', 5);
  assert.ok(engine.marketSell(u, { item: 'logs', qty: 5, price: 100 }).ok);
  repo.addPoints(bob.id, 1000);
  const aliceBefore = repo.getUser(u.id).points;
  const id = engine.marketListings()[0].id;
  assert.ok(engine.marketBuy(bob, id).ok);
  assert.equal(repo.getUser(u.id).points - aliceBefore, 96);
  assert.match(say('!stall alice', 'Bob', '2'), /Alice's Market Stall: 0 items for sale/);
  assert.equal(engine.storefronts()[0].username, 'Alice');
});

test('the town: parts from chat level buildings that give everyone bonus XP', () => {
  const { repo, engine, say, u, bob, inv } = setup();
  assert.match(say('!town'), /🪚 Sawmill 0\/5/);
  assert.match(say('!contribute 5 walls'), /don't have any Wall Panels/);
  // Oak wall panels are worth 127 each; the first Sawmill level needs 3,000.
  give(repo, u.id, { oak_wall_panel: 30, wooden_frame: 2 });
  assert.match(say('!contribute 5 walls'), /gave 🧱 5x Oak Wall Panel .* to the 🪚 Sawmill: 635 \/ 3,000 toward level 1/);
  assert.equal(inv().oak_wall_panel, 25);
  assert.match(say('!contribute sawmill all walls'), /finished level 1! Everyone now gets \+2% Woodcutting, Carpentry and Fletching XP/);
  assert.equal(engine.townLevel('sawmill'), 1);
  assert.ok(Math.abs(engine.townXp('carpentry') - 1.02) < 1e-9);
  assert.equal(engine.townXp('mining'), 1);
  // The leftover carried over into level 2.
  assert.equal(engine.townPublic().buildings[0].progress, 30 * ITEMS.oak_wall_panel.value - 3000);
  // Everyone gets it, not just the builder: Bob's woodcutting XP is 2% higher.
  const b0 = repo.getSkills(bob.id).woodcutting;
  say('!chop', 'Bob', '2');
  assert.equal(repo.getSkills(bob.id).woodcutting - b0, Math.round(10 * 1.02));
  // Unpicked parts go to the lowest building (the Great Forge is next).
  assert.match(say('!contribute all frames'), /Great Forge/);
  assert.match(say('!contribute 1 rocks'), /isn't a building part/);
});
