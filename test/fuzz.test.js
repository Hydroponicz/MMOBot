// Fuzz test: many players typing random commands (and using the market, guilds and bounties) over
// weeks of game time. After every step the economy must still make sense: no crashes, no negative or
// fractional points, no negative item counts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');
const { ITEMS } = require('../src/game/skills');

// Small seeded random number generator, so a failure can be replayed.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMMANDS = [
  '!fish', '!mine', '!chop', '!dig', '!skin', '!smelt', '!smith bronze sword', '!fletch arrows', '!craft', '!brew',
  '!lightfire', '!cook', '!cook all', '!eat', '!drink', '!heal', '!fight', '!shoot', '!cast', '!attack', '!catch', '!grab',
  '!plant', '!harvest', '!sell all', '!sellall', '!sell copper ore 2', '!buy hammer', '!buy flint', '!buy carrot seeds 3',
  '!buy plot', '!buy quiver', '!buy arrows 20', '!buy sword', '!buy party hat', '!buy knife', '!upgrade backpack',
  '!upgrade rod', '!equip bronze sword', '!unequip weapon', '!daily', '!tasks', '!quest', '!goal', '!pet', '!prestige mining confirm',
  '!enchant bronze sword', '!dungeon', '!guild', '!guild create Fuzz Guild', '!guild join fuzz guild', '!guild deposit 50', '!guild leave',
  '!bounty copper ore 150', '!bounty cancel', '!bounties', '!give @P1 10', '!give @P2 copper ore 1', '!duel @P3 20', '!accept', '!decline',
  '!slots 10', '!roulette red 10', '!plinko 10 high', '!bj 10', '!hit', '!stand', '!double', '!split', '!crash 10 2x', '!mines 10 3', '!pick 5', '!cashout',
  '!donate old bone', '!stats', '!inv', '!top', '!stamina', '!race', '!hall', '!market', '!season', '!title', 'hello chat',
];

function checkInvariants(repo, step, cmd) {
  for (const u of repo.searchUsers('')) {
    const full = repo.getUser(u.id);
    assert.ok(Number.isInteger(full.points) && full.points >= 0, `step ${step} (${cmd}): ${full.username} has ${full.points} points`);
    for (const [item, qty] of Object.entries(repo.getInventory(u.id))) {
      assert.ok(Number.isInteger(qty) && qty > 0, `step ${step} (${cmd}): ${full.username} has ${qty} ${item}`);
      assert.ok(ITEMS[item], `step ${step} (${cmd}): unknown item ${item}`);
    }
  }
}

const SEEDS = process.env.FUZZ_SEEDS ? Array.from({ length: Number(process.env.FUZZ_SEEDS) }, (_, i) => i + 1) : [1, 2, 3];
const STEPS = Number(process.env.FUZZ_STEPS) || 2500;
for (const seed of SEEDS) {
  test(`fuzz: random players and commands keep the game consistent (seed ${seed})`, () => {
    const rnd = mulberry32(seed);
    const repo = openDb(':memory:');
    let t = Date.UTC(2026, 0, 5);
    const config = {
      game: {
        prefix: '!',
        chatPoints: 5,
        chatCooldown: 30,
        staminaMax: 3,
        staminaMinutes: 5,
        replyInChat: true,
        tradeMinHours: 0,
        tradeMinActions: 0,
        petDropMultiplier: 50,
        casinoCooldown: 0,
      },
    };
    const engine = new GameEngine({ repo, config, rng: mulberry32(seed + 100), petRng: mulberry32(seed + 200), now: () => t });
    const players = Array.from({ length: 8 }, (_, i) => ({ kickUserId: String(i + 1), username: `P${i + 1}` }));
    for (const p of players) repo.addPoints(repo.upsertUser(p).id, 20_000);
    const pick = (list) => list[Math.floor(rnd() * list.length)];

    for (let step = 0; step < STEPS; step++) {
      const p = pick(players);
      const cmd = pick(COMMANDS);
      const user = repo.getUserByKickId(p.kickUserId);
      try {
        const r = rnd();
        if (r < 0.03) engine.marketSell(user, { item: pick(Object.keys(repo.getInventory(user.id)).concat('copper_ore')), qty: 1, price: 1 + Math.floor(rnd() * 300) });
        else if (r < 0.06) {
          const l = pick(engine.marketListings().concat([{ id: 999 }]));
          engine.marketBuy(user, l.id);
        } else if (r < 0.07) engine.marketCancel(user, pick(engine.marketListings().concat([{ id: 999 }])).id);
        else if (r < 0.075) engine.startRaid({ world: rnd() < 0.3 });
        else if (r < 0.08) engine.startGoal({ target: 20 });
        else if (r < 0.082) engine.endSeason();
        else if (r < 0.085) engine.spawnRandomEvent();
        else engine.handleChat({ ...p, content: cmd });
      } catch (err) {
        err.message = `step ${step} (${p.username}: ${cmd}): ${err.message}`;
        throw err;
      }
      // Time passes: seconds to hours.
      t += Math.floor(rnd() < 0.9 ? rnd() * 60_000 : rnd() * 6 * 3_600_000);
      if (step % 10 === 0) engine.tick();
      checkInvariants(repo, step, cmd);
    }
  });
}
