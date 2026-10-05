const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');

const config = {
  baseUrl: 'http://localhost:3000',
  game: { prefix: '!', staminaMax: 10, staminaMinutes: 0.5, racePerks: false, petDropMultiplier: 0, chatPoints: 0, chatCooldown: 60, replyInChat: true, tradeMinHours: 0, tradeMinActions: 0 },
};

function setup() {
  const repo = openDb(':memory:');
  let t = 50_000_000;
  const engine = new GameEngine({ repo, config, rng: () => 0.5, now: () => t });
  const said = [];
  engine.announce = (m) => said.push(m);
  for (const [id, name] of [['1', 'Alice'], ['2', 'Bob']]) engine.handleChat({ kickUserId: id, username: name, content: 'hi' });
  const a = repo.getUserByName('alice');
  const b = repo.getUserByName('bob');
  return { repo, engine, said, a, b, tick: (ms) => (t += ms) };
}

test('site commands: only whitelisted ones, and switched-off ones stay off', () => {
  const { engine, a } = setup();
  assert.equal(engine.siteCommand(a, 'admin', []).error, 'unknown action');
  assert.equal(engine.siteCommand(a, 'constructor', []).error, 'unknown action');
  engine.cfg.disabledCommands = ['bounty'];
  assert.match(engine.siteCommand(a, 'bounties', []).error, /switched off/);
});

test('site duel: the challenge is announced, the other player gets an event, and accepting from the site works', () => {
  const { engine, said, a, b } = setup();
  const events = [];
  engine.on('duel', (d) => events.push(d));
  const r = engine.siteCommand(a, 'duel', ['@Bob']);
  assert.match(r.message, /challenges you/);
  assert.ok(said.some((m) => /challenges you/.test(m)), 'announced in chat');
  assert.equal(events[0].to, b.id);
  const acc = engine.siteCommand(b, 'accept', []);
  assert.ok(acc.message);
  assert.ok(events.some((d) => d.to === b.id && d.gone));
  assert.equal(engine.siteCommand(b, 'decline', []).message, 'no duel waiting for you.');
});

test('site gift: points move and the receiver is notified', () => {
  const { engine, repo, a, b } = setup();
  repo.addPoints(a.id, 1000);
  const r = engine.siteCommand(a, 'give', ['@Bob', '300']);
  assert.match(r.message, /gave 300 pts/);
  assert.equal(repo.getUser(b.id).points, 300);
  assert.match(engine.notifications(b.id).saved[0].text, /Alice gave 300 pts to you/);
});

test('site title, bounty post and cancel', () => {
  const { engine, repo, a } = setup();
  assert.equal(engine.siteCommand(a, 'title', ['none']).message, 'title hidden.');
  repo.addPoints(a.id, 10_000);
  const r = engine.siteCommand(a, 'bounty', ['goblin crown', '5000']);
  assert.match(r.message, /bounty posted/);
  assert.equal(repo.getUser(a.id).points, 5000);
  assert.match(engine.siteCommand(a, 'bounty', ['cancel']).message, /refunded/);
  assert.equal(repo.getUser(a.id).points, 10_000);
});

test('site catch with nothing running says so instead of staying silent', () => {
  const { engine, a } = setup();
  assert.match(engine.siteCommand(a, 'catch', []).message, /nothing to catch/);
  assert.equal(engine.publicRandomEvent(), null);
});
