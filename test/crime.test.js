const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');
const { xpForLevel } = require('../src/game/xp');

const config = {
  baseUrl: 'http://localhost:3000',
  game: { prefix: '!', staminaMax: 100, staminaMinutes: 0.5, racePerks: false, petDropMultiplier: 0, chatPoints: 0, chatCooldown: 60, replyInChat: true, marketMinActions: 0, marketNewUserHours: 0 },
};

// roll(): what every random number is (0.01 = sneaky success, 0.99 = caught).
function setup() {
  const repo = openDb(':memory:');
  let t = 10_000_000;
  const R = { roll: 0.99 };
  const engine = new GameEngine({ repo, config, rng: () => R.roll, now: () => t });
  engine.announce = () => {};
  const say = (content, name = 'Alice', id = '1') => {
    t += 31_000;
    return engine.handleChat({ kickUserId: id, username: name, content }).reply;
  };
  const players = {};
  for (const [name, id] of [['Alice', '1'], ['Bob', '2'], ['Cara', '3'], ['Dan', '4']]) {
    say('hi', name, id);
    const u = repo.getUserByName(name.toLowerCase());
    // Character level 12+: past the new-player shield.
    for (const s of ['fishing', 'mining', 'woodcutting', 'digging', 'farming']) repo.addXp(u.id, s, xpForLevel(13));
    repo.setEquipment(u.id, 'backpack', 9);
    repo.addPoints(u.id, 10_000);
    players[name.toLowerCase()] = u;
  }
  return { repo, engine, say, R, ...players, tick: (s) => (t += s * 1000) };
}

test('pickpocketing: steals ordinary items (never gear), gets caught and jailed, new players are off limits', () => {
  const { repo, engine, say, R, bob } = setup();
  repo.addItem(bob.id, 'logs', 5);
  repo.addItem(bob.id, 'bronze_sword', 1);
  R.roll = 0.01;
  assert.match(say('!pickpocket @Bob'), /you lifted 🪵 .*Logs from @Bob's pocket/);
  assert.ok(repo.getInventory(bob.id).logs < 5);
  assert.equal(repo.getInventory(bob.id).bronze_sword, 1, 'gear is never taken');
  // Bob clutches his pockets for a while.
  assert.match(say('!pickpocket @Bob', 'Cara', '3'), /clutching their pockets/);
  // A brand-new player can't be targeted.
  say('hi', 'Newbie', '9');
  repo.addItem(repo.getUserByName('newbie').id, 'logs', 3);
  assert.match(say('!pickpocket @Newbie', 'Cara', '3'), /still new here/);
  // Caught: fined (half to the victim) and jailed.
  const dan = repo.getUserByName('dan');
  repo.addItem(dan.id, 'logs', 3);
  R.roll = 0.99;
  const before = repo.getUser(dan.id).points;
  assert.match(say('!pickpocket @Dan', 'Cara', '3'), /@Dan caught you pickpocketing! Fined 500 pts \(half to them\) and jailed/);
  assert.equal(repo.getUser(dan.id).points - before, 250);
  assert.match(say('!rob @Alice', 'Cara', '3'), /lying low|jail/);
  assert.ok(engine.heistInfo(repo.getUserByName('cara').id).jailUntil > 0);
});

test('poaching takes ready crops; a Scarecrow makes it harder; burglary empties shop shelves', () => {
  const { repo, engine, say, R, bob, cara, tick } = setup();
  repo.plant(bob.id, 1, 'carrot', 1, 2);
  R.roll = 0.01;
  assert.match(say('!poach @Bob'), /made off with 🥕 Carrot/);
  assert.equal(engine.farmPlots(bob.id).filter((p) => p.crop).length, 0, 'the plot was cleared');
  // With a scarecrow the odds drop by 20%: a 0.5 roll now fails (60% - 20% = 40%).
  repo.plant(cara.id, 1, 'carrot', 1, 2);
  repo.addItem(cara.id, 'scarecrow', 1);
  R.roll = 0.5;
  assert.match(say('!poach @Cara', 'Dan', '4'), /the scarecrow gave you away/);
  // Burglary: needs a shop, takes up to 3 off a listing and leaves the rest listed.
  assert.match(say('!burgle @Bob', 'Dan', '4'), /jail/);
  tick(3600);
  const dan = repo.getUserByName('dan');
  engine.heistInfo(dan.id);
  engine.saveHeistInfo(dan.id, { ...engine.heistInfo(dan.id), jailUntil: 0 });
  assert.match(say('!burgle @Bob', 'Dan', '4'), /doesn't have a shop/);
  repo.setSetting('stalls', { [bob.id]: 1 });
  repo.marketAdd(bob.id, 'iron_bar', 10, 1000, 1);
  R.roll = 0.01;
  assert.match(say('!burgle @Bob', 'Dan', '4'), /picked the lock on @Bob's shop and grabbed 🔩 3x Iron Ingot/);
  const left = engine.marketListings(bob.id)[0];
  assert.equal(left.qty, 7);
  assert.equal(left.price, 700);
});

test('wanted posters: only on criminals; collected by whoever beats them', () => {
  const { repo, engine, say, R, alice, bob } = setup();
  assert.match(say('!wanted @Bob 1000'), /hasn't committed a crime this week/);
  // Bob pickpockets Cara and gets away, so he's a criminal now.
  repo.addItem(repo.getUserByName('cara').id, 'logs', 3);
  R.roll = 0.01;
  say('!pickpocket @Cara', 'Bob', '2');
  assert.match(say('!wanted @Bob 1000'), /posted 1,000 pts on @Bob's head/);
  assert.equal(repo.getUser(alice.id).points, 9000);
  assert.match(say('!wanted'), /WANTED: @Bob 1,000/);
  // Bob tries Dan's pockets and is caught: Dan collects 90% of the bounty (and half the fine).
  const dan = repo.getUserByName('dan');
  repo.addItem(dan.id, 'logs', 3);
  R.roll = 0.99;
  const before = repo.getUser(dan.id).points;
  say('!pickpocket @Dan', 'Bob', '2');
  // 900 (the bounty, less the 10% cut) plus half of Bob's fine.
  assert.ok(repo.getUser(dan.id).points - before >= 900 + 50);
  assert.deepEqual(engine.wantedList(), []);
});

test('jail: bail out, or a friend breaks you out (fail and you join them)', () => {
  const { repo, engine, say, R, bob } = setup();
  engine.saveHeistInfo(bob.id, { ...engine.heistInfo(bob.id), jailUntil: engine.now() + 30 * 60_000 });
  assert.match(say('!jail', 'Bob', '2'), /you're in jail for/);
  assert.match(say('!jail'), /in jail: @Bob/);
  R.roll = 0.01;
  assert.match(say('!jailbreak @Bob'), /@Bob walked free/);
  assert.equal(engine.heistInfo(bob.id).jailUntil, 0);
  // A failed breakout: the breaker ends up inside.
  engine.saveHeistInfo(bob.id, { ...engine.heistInfo(bob.id), jailUntil: engine.now() + 30 * 60_000 });
  R.roll = 0.99;
  assert.match(say('!jailbreak @Bob', 'Cara', '3'), /now you're in the cell next to them/);
  // Bail: pay your way out.
  const cara = repo.getUserByName('cara');
  const pts = repo.getUser(cara.id).points;
  assert.match(say('!bail', 'Cara', '3'), /posted [\d,]+ pts bail and walked out/);
  assert.ok(repo.getUser(cara.id).points < pts);
  assert.equal(engine.heistInfo(cara.id).jailUntil, 0);
});

test('tip-offs: the next crime walks into a trap and the snitch gets a cut', () => {
  const { repo, engine, say, R, bob } = setup();
  const alicePts = repo.getUser(repo.getUserByName('alice').id).points;
  assert.match(say('!tipoff @Bob'), /The guards will be watching @Bob/);
  assert.equal(repo.getUser(repo.getUserByName('alice').id).points, alicePts - 100);
  repo.addItem(repo.getUserByName('dan').id, 'logs', 3);
  R.roll = 0.5; // not named this time (30% chance)
  assert.match(say('!pickpocket @Dan', 'Bob', '2'), /the guards were waiting for you: someone tipped them off/);
  assert.ok(engine.heistInfo(bob.id).jailUntil > engine.now());
  assert.ok(repo.getUser(repo.getUserByName('alice').id).points > alicePts - 100, 'the snitch got a cut');
  assert.match(say('!tipoff @Dan'), /don't take tips from you that often/);
});

test('protection rackets: robbing a client means beating the guild enforcer first', () => {
  const { repo, engine, say, R, alice, bob, cara } = setup();
  // Alice leads a guild with a strong enforcer (herself, combat 60).
  repo.addPoints(alice.id, 20_000);
  assert.ok(engine.guildCreate(alice, 'Iron Fist', 'IRON').ok);
  repo.addXp(alice.id, 'swords', xpForLevel(60));
  assert.match(say('!racket price 2000'), /\[IRON\] now sells protection for 2,000 pts a day/);
  assert.match(say('!racket', 'Bob', '2'), /\[IRON\] 2,000\/day \(enforcer Alice\)/);
  assert.match(say('!racket buy IRON', 'Bob', '2'), /you paid \[IRON\] 2,000 pts/);
  // Cara tries to rob Bob (richer than her after a top-up): Alice's enforcer stops her.
  repo.addPoints(bob.id, 50_000);
  R.roll = 0.99;
  const bank = repo.guildOf(alice.id).bank;
  assert.match(say('!rob @Bob', 'Cara', '3'), /under \[IRON\]'s protection, and their enforcer @Alice beat you/);
  assert.ok(repo.guildOf(alice.id).bank > bank, 'half the fine goes to the guild bank');
  assert.ok(engine.heistInfo(cara.id).jailUntil > engine.now());
});
