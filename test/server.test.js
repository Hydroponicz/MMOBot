const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

function makeConfig(overrides = {}) {
  return {
    port: 0,
    baseUrl: 'http://localhost',
    sessionSecret: 'test-secret',
    kick: {
      clientId: 'cid',
      clientSecret: 'csecret',
      channel: 'streamer',
      chatSource: 'webhook',
      verifyWebhooks: true,
      oauthBase: 'https://id.kick.com',
      apiBase: 'https://api.kick.com',
    },
    game: { prefix: '!', actionCooldown: 30, chatPoints: 5, chatCooldown: 60, replyInChat: false },
    adminUsers: [],
    devMode: true,
    ...overrides,
  };
}

async function start(config = makeConfig()) {
  const repo = openDb(':memory:');
  const ctx = createApp({ config, repo, logger: { log() {}, warn() {}, error() {} } });
  const server = await new Promise((r) => {
    const s = ctx.app.listen(0, () => r(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { ...ctx, repo, url, close: () => server.close() };
}

test('dev chat -> player profile -> leaderboard', async (t) => {
  const s = await start();
  t.after(s.close);
  const post = (body) =>
    fetch(`${s.url}/api/dev/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  const r = await post({ username: 'Viewer1', content: '!chop' });
  assert.match(r.reply, /@Viewer1 .*Logs|better luck/);

  const player = await fetch(`${s.url}/api/player/viewer1`).then((r) => r.json());
  assert.equal(player.profile.username, 'Viewer1');
  assert.equal(player.profile.skills.length, 5);

  const lb = await fetch(`${s.url}/api/leaderboard/points`).then((r) => r.json());
  assert.equal(lb.rows[0].username, 'Viewer1');

  assert.equal((await fetch(`${s.url}/api/leaderboard/bogus`)).status, 400);
  assert.equal((await fetch(`${s.url}/api/admin/status`)).status, 403);
  const me = await fetch(`${s.url}/api/me`).then((r) => r.json());
  assert.equal(me.user, null);
});

test('dev chat is disabled without DEV_MODE', async (t) => {
  const s = await start(makeConfig({ devMode: false }));
  t.after(s.close);
  const res = await fetch(`${s.url}/api/dev/chat`, { method: 'POST' });
  assert.equal(res.status, 404);
});

test('webhook: verifies signature, handles chat, dedupes', async (t) => {
  const s = await start();
  t.after(s.close);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  s.kick.publicKey = publicKey.export({ type: 'spki', format: 'pem' });

  const body = JSON.stringify({
    message_id: 'm1',
    broadcaster: { user_id: 99, username: 'streamer' },
    sender: { user_id: 42, username: 'Chatter', profile_picture: 'https://example.com/a.png', is_anonymous: false },
    content: '!dig',
  });
  const send = (sig, id = 'evt-1') =>
    fetch(`${s.url}/webhooks/kick`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Kick-Event-Type': 'chat.message.sent',
        'Kick-Event-Message-Id': id,
        'Kick-Event-Message-Timestamp': '2026-01-01T00:00:00Z',
        'Kick-Event-Signature': sig,
      },
      body,
    });
  const sign = (id) =>
    crypto.createSign('RSA-SHA256').update(`${id}.2026-01-01T00:00:00Z.${body}`).sign(privateKey, 'base64');

  assert.equal((await send('bogus')).status, 401);
  assert.equal((await send(sign('evt-1'))).status, 200);
  assert.equal((await send(sign('evt-1'))).status, 200); // redelivery

  const user = s.repo.getUserByKickId('42');
  assert.equal(user.username, 'Chatter');
  assert.equal(user.avatar_url, 'https://example.com/a.png');
  assert.equal(user.message_count, 1, 'duplicate delivery ignored');
});

test('login redirects to Kick with PKCE', async (t) => {
  const s = await start();
  t.after(s.close);
  const res = await fetch(`${s.url}/auth/login`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://id.kick.com/oauth/authorize');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(loc.searchParams.get('redirect_uri'), 'http://localhost/auth/callback');
  assert.match(res.headers.get('set-cookie'), /mmo_oauth=.*HttpOnly/i);

  // Admin connect flows require an admin session.
  assert.equal((await fetch(`${s.url}/auth/connect/broadcaster`, { redirect: 'manual' })).status, 403);
});
