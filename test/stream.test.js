// Stream rewards: redemptions (points spent on things everyone sees) and community projects.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');

function setup(game = {}) {
  const repo = openDb(':memory:');
  let t = 1_000_000_000_000;
  const config = { baseUrl: 'http://localhost', game: { prefix: '!', staminaMax: 100, racePerks: false, petDropMultiplier: 0, chatPoints: 0, replyInChat: true, raidMinutes: 10, ...game } };
  const engine = new GameEngine({ repo, config, now: () => t });
  const said = [];
  const effects = [];
  engine.on('announce', (x) => said.push(x));
  engine.on('redeem', (x) => effects.push(x));
  const a = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  const b = repo.upsertUser({ kickUserId: '2', username: 'Bob' });
  const say = (content, username = 'Alice', kickUserId = '1') => engine.handleChat({ kickUserId, username, content }).reply;
  return { repo, engine, a, b, say, said, effects, wait: (ms) => (t += ms) };
}

test('redemptions cost points, fire an effect, and respect channel and player cooldowns', () => {
  const { repo, engine, a, b, say, effects, wait } = setup();
  assert.match(say('!redeem'), /🎆 fireworks 1,000 · 📯 fanfare 1,500 · 🔦 spotlight 2,500/);
  assert.match(say('!redeem fireworks'), /costs 1,000 pts \(you have 0\)/);
  repo.addPoints(a.id, 10_000);
  repo.addPoints(b.id, 10_000);
  assert.match(say('!redeem fireworks'), /Fireworks redeemed for 1,000 pts/);
  assert.equal(repo.getUser(a.id).points, 9000);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].id, 'fireworks');
  assert.equal(effects[0].username, 'Alice');
  assert.ok(effects[0].appearance, 'the effects overlay gets the character to draw');
  // Channel cooldown (1 min for fireworks) blocks everyone; the player cooldown blocks spamming others.
  assert.match(engine.redeem(b, 'fireworks').error, /was just used: ready again in 1 min/);
  assert.match(engine.redeem(a, 'fanfare').error, /easy! You can redeem again/);
  wait(61_000);
  assert.equal(engine.redeem(b, 'fireworks').ok, true);
  assert.match(engine.redeem(a, 'nope').error, /no such redemption/);
  // Sink: the economy counts it.
  engine.flushEconomy?.();
  assert.equal(engine.econ.redeems, 2000);
});

test('gameplay redemptions: double XP, raid boss and treasure goblin', () => {
  const { repo, engine, a, b, said, wait } = setup();
  repo.addPoints(a.id, 100_000);
  repo.addPoints(b.id, 100_000);
  assert.equal(engine.redeem(a, 'xp').ok, true);
  assert.equal(engine.activeBoost().multiplier, 2);
  assert.match(said.at(-1), /Alice bought DOUBLE XP/);
  wait(31_000);
  assert.equal(engine.redeem(a, 'raid').ok, true);
  assert.ok(repo.getSetting('raid'));
  wait(31_000);
  assert.equal(engine.redeem(a, 'goblin').ok, true);
  assert.equal(repo.getSetting('random_event').kind, 'goblin');
  // Can't stack on what's already running (and no points are taken).
  engine.repo.setSetting('redeem_used', {});
  const before = repo.getUser(b.id).points;
  assert.match(engine.redeem(b, 'xp').error, /boost is already running/);
  assert.match(engine.redeem(b, 'raid').error, /raid is already running/);
  assert.equal(repo.getUser(b.id).points, before);
});

test('redemptions wait for the stream to be live; admins set prices and turn them off', () => {
  const { repo, engine, a } = setup();
  repo.addPoints(a.id, 10_000);
  repo.setSetting('stream', { live: false });
  assert.match(engine.redeem(a, 'fireworks').error, /only work while the stream is live/);
  repo.setSetting('stream', { live: true });
  engine.settings.all.redemptions = [{ id: 'fireworks', cost: 0, cooldown: 1 }, { id: 'fanfare', cost: 42, cooldown: 0 }];
  assert.match(engine.redeem(a, 'fireworks').error, /no such redemption/, 'price 0 turns it off');
  assert.equal(engine.redeem(a, 'fanfare').ok, true);
  assert.equal(repo.getUser(a.id).points, 10_000 - 42);
});

test('community projects: funding, completion effects, titles, rotation', () => {
  const { repo, engine, a, b, say, said } = setup();
  repo.addPoints(a.id, 200_000);
  repo.addPoints(b.id, 200_000);
  assert.match(say('!project'), /Raise a Monument: 0 \/ 50,000/);
  assert.match(say('!fund 5'), /at least 10/);
  assert.match(say('!fund 10000'), /you gave 10,000 pts to Raise a Monument: 10,000 \/ 50,000 \(20%\)/);
  assert.match(say('!fund 3000', 'Bob', '2'), /13,000 \/ 50,000/);
  // Giving more than is left only takes what's needed.
  const r = engine.projectFund(a, 999_999);
  assert.equal(r.amount, 37_000);
  assert.match(said.at(-1), /COMMUNITY PROJECT COMPLETE: Raise a Monument! 2 donors, top donor Alice/);
  const m = engine.monuments();
  assert.equal(m.length, 1);
  assert.equal(m[0].username, 'Alice');
  assert.ok(engine.titles(a.id).includes('the Grand Patron'));
  assert.ok(!engine.titles(b.id).includes('the Patron'), 'Bob gave 6%, under 10%');
  // Next project: Double XP Hour.
  assert.equal(engine.publicProject().id, 'xp');
  engine.projectFund(b, 60_000);
  assert.equal(engine.activeBoost().multiplier, 2);
  assert.ok(engine.activeBoost().until - engine.now() >= 59 * 60_000);
  assert.ok(engine.titles(b.id).includes('the Grand Patron'));
  // Festival of Fortune doubles everyone's rare chances for an hour.
  assert.equal(engine.publicProject().id, 'fortune');
  const luck = engine.luck(a.id);
  engine.projectFund(a, 40_000);
  assert.equal(engine.luck(a.id), luck * 2);
  // World boss.
  engine.projectFund(a, 100_000);
  assert.ok(repo.getSetting('world_boss'));
  assert.equal(engine.publicProject().id, 'monument', 'back to the start');
  assert.equal(engine.projectHistory().length, 4);
  engine.flushEconomy?.();
  assert.equal(engine.econ.projects, 250_000);
});

test('projects skip goals of 0 and can be switched off', () => {
  const { repo, engine, a } = setup();
  repo.addPoints(a.id, 100_000);
  engine.settings.all.projects = [{ id: 'monument', goal: 0 }, { id: 'xp', goal: 100 }, { id: 'fortune', goal: 0 }, { id: 'worldboss', goal: 0 }];
  assert.equal(engine.publicProject().id, 'xp');
  engine.projectFund(a, 100);
  assert.equal(engine.publicProject().id, 'xp', 'only one project left, so it repeats');
  engine.cfg.projectsEnabled = false;
  assert.match(engine.projectFund(a, 50).error, /switched off/);
});

test('economy health counts redemptions and projects as spending', () => {
  const { engine } = setup();
  engine.track('chat', 1000);
  engine.track('redeems', 3000);
  engine.track('projects', 7000);
  const { week } = engine.economyAlerts();
  assert.equal(week.spent, 10_000);
});
