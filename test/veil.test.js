const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');

// rng is a knob: 0.99 by default (no finds, no monsters, no rares, every hit lands).
function setup(game = {}) {
  const repo = openDb(':memory:');
  let t = 1_000_000;
  const rng = { value: 0.99, queue: [] };
  const engine = new GameEngine({
    repo,
    config: { baseUrl: 'http://x', game: { prefix: '!', staminaMax: 5, racePerks: false, petDropMultiplier: 0, chatPoints: 0, replyInChat: true, ...game } },
    rng: () => (rng.queue.length ? rng.queue.shift() : rng.value),
    now: () => t,
  });
  const say = (content, username = 'Alice', kickUserId = '1') => {
    t += 6000;
    return engine.handleChat({ kickUserId, username, content }).reply;
  };
  const tick = (sec) => (t += sec * 1000);
  const player = (kickUserId, username, { weapon = 'bronze_sword', armor = [], points = 50_000, food = 5, xp = 0 } = {}) => {
    const u = repo.upsertUser({ kickUserId, username });
    if (xp) repo.addXp(u.id, 'swords', xp);
    repo.addPoints(u.id, points);
    for (const id of [weapon, ...armor]) {
      repo.addItem(u.id, id, 1);
      say(`!equip ${id.replace(/_/g, ' ')}`, username, kickUserId);
    }
    if (food) repo.addItem(u.id, 'cooked_trout', food);
    return u;
  };
  return { repo, engine, say, tick, rng, player };
}

test('Gloamveil: entering warns once, takes the fee, stamina and supplies, and locks your gear', () => {
  const { repo, engine, say, player } = setup();
  assert.match(say('!veil'), /Mistfen Hollows.*!veil 1 to enter/);
  const u = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  repo.addPoints(u.id, 1000);
  assert.match(say('!veil 1'), /unarmed/);
  player('1', 'Alice', { armor: ['bronze_helmet'], points: 0 });
  assert.match(say('!veil 2'), /needs Combat level 40/);
  assert.match(say('!veil 1'), /death is final: you'd lose your Bronze Sword, Bronze Helmet/);
  assert.match(say('!veil 1'), /you step into the Mistfen Hollows.*Supplies: 🐟 4x Cooked Trout/);
  assert.equal(repo.getUser(u.id).points, 500, '500 pts fee');
  assert.equal(repo.getInventory(u.id).cooked_trout, 1, '4 trout went in as supplies');
  assert.equal(engine.stamina(u.id).charges, 4);
  assert.ok(engine.inVeil(u.id));
  assert.match(say('!veil'), /room 1\/6.*🍖 4/);
  assert.match(say('!unequip helmet'), /can't change gear in the Gloamveil/);
  assert.match(say('!equip bronze sword'), /can't change gear/);
  assert.match(say('!eat'), /backpack is outside the fog/);
  assert.match(say('!drink'), /backpack is outside the fog/);
  assert.match(say('!fight'), /monsters find you in there/);
  // Not in a run: the inside commands say so, or stay quiet.
  assert.match(say('!search', 'Bob', '2'), /aren't in the Gloamveil/);
  assert.equal(say('!hide', 'Bob', '2'), null);
});

test('Gloamveil: search, go deeper, extract at a Waystone to keep the loot', () => {
  const { repo, say, rng, player } = setup();
  const u = player('1', 'Alice');
  say('!veil 1');
  say('!veil 1');
  // Found something (0.1 < 0.8), the commonest item (weight roll 0.1), 3 of them (qty roll 0.99).
  rng.queue.push(0.1, 0.1, 0.99);
  assert.match(say('!search'), /found 🫧 3x Wisp Shard!.*🎒 3\/12/);
  assert.match(say('!search'), /picked clean/);
  assert.match(say('!extract'), /no Waystone here\. The next one is in room 3/);
  assert.match(say('!deeper'), /into room 2/);
  assert.match(say('!deeper'), /into room 3\. 🔮 A Waystone glows here/);
  assert.match(say('!extract'), /Waystone pulls you out.*3x Wisp Shard \(worth 60 pts\)\. Unused supplies are back/);
  assert.equal(repo.getInventory(u.id).wisp_shard, 3);
  assert.equal(repo.getInventory(u.id).cooked_trout, 5);
  assert.ok(!repo.getSetting(`veil:${u.id}`));
  assert.equal(repo.getWorn(u.id).weapon, 'bronze_sword', 'gear comes back out');
});

test('Gloamveil: a full bag swaps its cheapest item for a better find', () => {
  const { engine, say, rng, player } = setup({ veilBagSize: 3 });
  const u = player('1', 'Alice');
  say('!veil 1');
  say('!veil 1');
  rng.queue.push(0.1, 0.1, 0.99);
  say('!search');
  say('!deeper');
  // Weight roll 0.99 picks the rarest.
  rng.queue.push(0.1, 0.99);
  assert.match(say('!search'), /found 🗿 Mistfen Idol!.*dropped a Wisp Shard to make room/);
  const run = engine.veilRun(u.id);
  assert.deepEqual(run.bag, { wisp_shard: 2, mistfen_idol: 1 });
});

test('Gloamveil: when the fog closes you lose your worn gear, supplies and loot', () => {
  const { repo, engine, say, tick, rng, player } = setup();
  const u = player('1', 'Alice', { armor: ['bronze_helmet'] });
  repo.setEquipment(u.id, 'ench:bronze_sword', 3);
  say('!veil 1');
  say('!veil 1');
  rng.queue.push(0.1, 0.1, 0.99);
  say('!search');
  tick(16 * 60);
  assert.match(say('!veil'), /The Gloamveil: go in wearing/);
  assert.deepEqual(repo.getWorn(u.id), {});
  assert.equal(repo.getInventory(u.id).wisp_shard, undefined);
  assert.equal(repo.getInventory(u.id).cooked_trout, 1, 'the 4 supplies are gone');
  assert.equal(engine.enchantLevel(u.id, 'bronze_sword'), 0, 'a lost enchanted item is gone for good');
  assert.equal(engine.vitals(u.id).ko, true);
  assert.match(JSON.stringify(repo.notifications(u.id)), /fog took you/);
  assert.equal(engine.veilPage().log[0].how, 'the fog closed over them');
  assert.equal(engine.veilWeek().players[u.id].deaths, 1);
});

test('Gloamveil: spotting and ambushing a player; the winner takes their bag and a piece of gear', () => {
  const { repo, engine, say, rng, player } = setup({ veilPvpChance: 1 });
  const a = player('1', 'Alice', { weapon: 'mithril_sword', armor: ['mithril_platebody'], xp: 500_000 });
  const b = player('2', 'Bob', { armor: ['bronze_helmet'] });
  say('!veil 1');
  say('!veil 1');
  say('!veil 1', 'Bob', '2');
  say('!veil 1', 'Bob', '2');
  rng.queue.push(0.1, 0.1, 0.99);
  const bobSearch = say('!search', 'Bob', '2');
  assert.match(bobSearch, /found 🫧 3x Wisp Shard/);
  assert.match(bobSearch, /You spot @Alice/, 'Bob spots Alice too');
  say('!hide', 'Bob', '2');
  const spotted = say('!search');
  assert.match(spotted, /You spot @Bob in the fog \(Swords 1, Bronze Sword.*carrying 3 loot\).*!ambush/);
  const res = say('!ambush');
  assert.match(res, /you ambushed @Bob and killed them.*You take their loot/);
  assert.deepEqual(repo.getWorn(b.id), {}, 'Bob lost his gear');
  assert.equal(engine.inVeil(b.id), false);
  const run = engine.veilRun(a.id);
  assert.equal(run.bag.wisp_shard, 3);
  assert.equal(run.bag.bronze_sword ?? run.bag.bronze_helmet, 1, 'one of Bob\'s pieces');
  assert.equal(engine.veilWeek().players[a.id].kills, 1);
  assert.match(JSON.stringify(repo.notifications(b.id)), /ambushed and killed you/);
  // Carry it out.
  say('!deeper');
  say('!deeper');
  assert.match(say('!extract'), /got out with/);
  assert.equal(repo.getInventory(a.id).wisp_shard, 3);

  // The same two again within a day: the loser's things are destroyed instead.
  repo.setVitals(b.id, { hp: 1000, mana: 0, koUntil: 0 }, engine.now());
  repo.addItem(b.id, 'bronze_sword', 1);
  say('!equip bronze sword', 'Bob', '2');
  say('!veil 1');
  say('!veil 1', 'Bob', '2');
  rng.queue.push(0.1, 0.1, 0.99);
  say('!search', 'Bob', '2');
  say('!hide', 'Bob', '2');
  assert.match(say('!search'), /You spot @Bob/);
  assert.match(say('!ambush'), /already fought each other in here today: their things crumble/);
  assert.deepEqual(engine.veilRun(a.id).bag, {});
});

test('Gloamveil: an ambush can be slipped, and loses the ambusher everything if they lose', () => {
  for (const slip of [true, false]) {
    const { repo, engine, say, rng, player } = setup({ veilPvpChance: 1 });
    const a = player('1', 'Alice');
    const b = player('2', 'Bob', { weapon: 'mithril_sword', armor: ['mithril_platebody'], xp: 500_000 });
    say('!veil 1');
    say('!veil 1');
    say('!veil 1', 'Bob', '2');
    say('!veil 1', 'Bob', '2');
    assert.match(say('!search'), /You spot @Bob.*🔴 they would crush you/);
    if (slip) {
      // The slip roll (0.01) is under Bob's chance to notice.
      rng.queue.push(0.01);
      assert.match(say('!ambush'), /heard you coming and slipped into the fog/);
      assert.match(JSON.stringify(repo.notifications(b.id)), /tried to ambush you/);
      assert.ok(engine.inVeil(a.id) && engine.inVeil(b.id));
      // Someone you've just seen isn't spotted again right away.
      assert.doesNotMatch(say('!deeper'), /You spot/);
    } else {
      assert.match(say('!ambush'), /you ambushed @Bob, but they killed you/);
      assert.deepEqual(repo.getWorn(a.id), {});
      assert.equal(engine.veilRun(b.id).bag.bronze_sword, 1, 'Bob took the sword');
      assert.match(JSON.stringify(repo.notifications(b.id)), /you killed them.*get it out/);
    }
  }
});

test('Gloamveil: the website page', () => {
  const { engine, say, player } = setup();
  const u = player('1', 'Alice', { armor: ['bronze_helmet'] });
  let page = engine.veilPage(u.id);
  assert.equal(page.zones.length, 4);
  assert.equal(page.me.armed, true);
  assert.deepEqual(page.me.gear.map((g) => g.id), ['bronze_sword', 'bronze_helmet']);
  assert.equal(page.run, undefined);
  say('!veil 1');
  say('!veil 1');
  page = engine.veilPage(u.id);
  assert.equal(page.run.zone, 1);
  assert.equal(page.run.rooms.length, 6);
  assert.equal(page.zones[0].inside, 1);
  assert.equal(page.run.supplies[0].qty, 4);
});
