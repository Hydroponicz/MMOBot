const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');

const config = {
  baseUrl: 'http://localhost:3000',
  game: { prefix: '!', staminaMax: 10, staminaMinutes: 0.5, racePerks: false, petDropMultiplier: 0, chatPoints: 0, chatCooldown: 60, replyInChat: true },
};

function setup() {
  const { Settings } = require('../src/settings');
  const repo = openDb(':memory:');
  const settings = new Settings({ config: { ...config, adminUsers: [], kick: { channel: 's' } }, repo });
  let t = 50_000_000;
  const engine = new GameEngine({ repo, config, settings, rng: () => 0.5, now: () => t });
  const announced = [];
  engine.announce = (x) => announced.push(x);
  const say = (content, name, id) => {
    t += 31_000;
    return engine.handleChat({ kickUserId: id, username: name, content }).reply;
  };
  return { repo, engine, settings, say, announced, tick: (s) => (t += s * 1000) };
}
const kicks = (amount, extra = {}) => ({ sender: { user_id: 77, username: 'BigFan', is_verified: false }, gift: { amount, name: 'Rage Quit', type: 'LEVEL_UP', tier: 'MID', ...extra } });

test('a small KICKs gift: points for the sender, a thank-you, the leaderboard', () => {
  const { repo, engine, say } = setup();
  const r = engine.channelEvent('kicks.gifted', kicks(50, { message: 'gg' }));
  assert.match(r, /💎 @BigFan sent 50 KICKs \(Rage Quit\)! “gg” \+100 pts\./);
  assert.doesNotMatch(r, /Loot rain|DOUBLE XP|WORLD BOSS/);
  const fan = repo.getUserByName('bigfan');
  assert.equal(fan.points, 100);
  assert.equal(engine.kicksLeaderboard('all')[0].amount, 50);
  assert.match(say('!kicks', 'Alice', '1'), /this week: BigFan 50 · all time: BigFan 50/);
});

test('bigger gifts set off loot rain, double XP and the world boss; lifetime titles', () => {
  const { repo, engine, say } = setup();
  say('hi', 'Alice', '1');
  say('hi', 'Bob', '2');
  const alice = repo.getUserByName('alice');
  const before = repo.getUser(alice.id).points;
  // 100 KICKs: loot rain (3 pts per KICK shared between the 2 chatters = 150 each).
  const rain = engine.channelEvent('kicks.gifted', kicks(100));
  assert.match(rain, /Loot rain! 150 pts each to (Alice, Bob|Bob, Alice)/);
  assert.equal(repo.getUser(alice.id).points - before, 150);
  assert.ok(engine.titles(repo.getUserByName('bigfan').id).includes('the Kick Supporter'));
  // 500: double XP too.
  assert.match(engine.channelEvent('kicks.gifted', kicks(500)), /DOUBLE XP for everyone for 10m/);
  assert.equal(engine.boostMultiplier('xp'), 2);
  // 2,500: the world boss.
  const big = engine.channelEvent('kicks.gifted', kicks(2500));
  assert.match(big, /WORLD BOSS awakens/);
  assert.ok(repo.getSetting('world_boss'));
  assert.match(big, /New title: the Kick Patron/);
});

test('anonymous senders and switched-off rewards', () => {
  const { engine, settings } = setup();
  assert.match(engine.channelEvent('kicks.gifted', { sender: null, gift: { amount: 20 } }), /Someone sent 20 KICKs!/);
  settings.update('events', { kicksEnabled: false });
  assert.equal(engine.channelEvent('kicks.gifted', kicks(1000)), null);
});
