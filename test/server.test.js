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
      verifyWebhooks: true,
      oauthBase: 'https://id.kick.com',
      apiBase: 'https://api.kick.com',
    },
    game: { prefix: '!', actionCooldown: 30, chatPoints: 5, chatCooldown: 60, replyInChat: false },
    adminUsers: [],
    devMode: true,
    persistentStorage: true,
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
  assert.match(r.reply, /@Viewer1 .*(Logs|RARE|better luck)/);

  const player = await fetch(`${s.url}/api/player/viewer1`).then((r) => r.json());
  assert.equal(player.profile.username, 'Viewer1');
  assert.equal(player.profile.skills.length, 8);

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

test('bot login link: works without a session, rejects the channel account, accepts the bot', async (t) => {
  const s = await start();
  t.after(s.close);
  // Fake Kick's OAuth + users endpoints; let requests to our own server through.
  const realFetch = globalThis.fetch;
  let who = { user_id: 99, name: 'Streamer' };
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://id.kick.com/oauth/token')) return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }));
    if (u.startsWith('https://api.kick.com/public/v1/users')) return new Response(JSON.stringify({ data: [who] }));
    return realFetch(url, opts);
  });

  assert.equal((await fetch(`${s.url}/auth/connect/bot?link=nope`, { redirect: 'manual' })).status, 403);

  s.repo.setSetting('bot_link', { code: 'good', exp: Date.now() + 60_000 });
  const flow = async () => {
    const r = await fetch(`${s.url}/auth/connect/bot?link=good`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const state = new URL(r.headers.get('location')).searchParams.get('state');
    return fetch(`${s.url}/auth/callback?code=c&state=${state}`, { headers: { cookie }, redirect: 'manual' });
  };

  const rejected = await flow();
  assert.equal(rejected.status, 400);
  assert.match(await rejected.text(), /That was your channel account \(Streamer\)/);
  assert.equal(s.kick.getToken('bot'), null);

  who = { user_id: 55, name: 'mmobot' };
  const ok = await flow();
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Bot account mmobot connected/);
  assert.equal(s.kick.botAccount().username, 'mmobot');

  // The link is single-use.
  assert.equal((await fetch(`${s.url}/auth/connect/bot?link=good`, { redirect: 'manual' })).status, 403);
});

test('admin API: settings, logs and players need an admin; logs record chat commands', async (t) => {
  const { createSessions } = require('../src/web/session');
  const { createLogger } = require('../src/logger');
  const repo = openDb(':memory:');
  const config = makeConfig();
  const logger = createLogger({ repo, echo: { log() {}, warn() {}, error() {} } });
  const ctx = createApp({ config, repo, logger });
  const server = await new Promise((r) => {
    const s = ctx.app.listen(0, () => r(s));
  });
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;

  for (const path of ['/api/admin/settings', '/api/admin/logs', '/api/admin/players']) {
    assert.equal((await fetch(url + path)).status, 403, path);
  }

  // Log in as the channel owner.
  const owner = repo.upsertUser({ kickUserId: '99', username: 'streamer' });
  let cookie;
  createSessions({ secret: config.sessionSecret, secure: false }).write({ cookie: (n, v) => (cookie = `${n}=${v}`) }, 'mmo_session', { uid: owner.id }, 60_000);
  const api = (path, opts = {}) =>
    fetch(url + path, { ...opts, headers: { cookie, 'Content-Type': 'application/json' }, body: opts.body && JSON.stringify(opts.body) });

  const s = await (await api('/api/admin/settings')).json();
  assert.equal(s.values.general.actionCooldown, 30);
  assert.equal(s.values.rods.length, 10);
  assert.equal(s.values.backpack[9].capacity, 100);

  const bad = await api('/api/admin/settings/general', { method: 'PUT', body: { value: { actionCooldown: 'soon' } } });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /must be a number/);
  const ok = await api('/api/admin/settings/general', { method: 'PUT', body: { value: { actionCooldown: 5, adminUsers: 'ModOne, @ModTwo' } } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ctx.settings.all.general.adminUsers, ['modone', 'modtwo']);
  assert.equal(ctx.engine.cfg.actionCooldown, 5);

  ctx.bot.handleMessage({ kickUserId: '5', username: 'Viewer', content: '!fish' });
  const logs = await (await api('/api/admin/logs?source=chat')).json();
  assert.match(logs.logs[0].message, /^Viewer: !fish → @Viewer/);
  const adminLogs = await (await api('/api/admin/logs?q=changed%20general')).json();
  assert.match(adminLogs.logs[0].message, /streamer changed general settings/);

  const found = await (await api('/api/admin/players?q=view')).json();
  assert.equal(found.players[0].username, 'Viewer');
  const give = await api(`/api/admin/players/${found.players[0].id}/points`, { method: 'POST', body: { delta: 500, reason: 'giveaway' } });
  assert.equal((await give.json()).player.points, found.players[0].points + 500);
  const take = await api(`/api/admin/players/${found.players[0].id}/points`, { method: 'POST', body: { delta: -1e9 } });
  assert.equal((await take.json()).player.points, 0, 'never below zero');
});

test('overlay: the live stream is unbuffered, and the admin test event reaches it', async (t) => {
  const { createSessions } = require('../src/web/session');
  const s = await start();
  t.after(s.close);
  assert.equal((await fetch(`${s.url}/api/admin/overlay-test`, { method: 'POST' })).status, 403);

  const ac = new AbortController();
  t.after(() => ac.abort());
  const stream = await fetch(`${s.url}/api/events`, { signal: ac.signal });
  assert.equal(stream.headers.get('x-accel-buffering'), 'no');
  assert.match(stream.headers.get('cache-control'), /no-transform/);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const waitFor = async (re) => {
    while (!re.test(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    return text;
  };
  await waitFor(/retry: 5000/);

  const owner = s.repo.upsertUser({ kickUserId: '99', username: 'streamer' });
  let cookie;
  createSessions({ secret: 'test-secret', secure: false }).write({ cookie: (n, v) => (cookie = `${n}=${v}`) }, 'mmo_session', { uid: owner.id }, 60_000);
  const res = await fetch(`${s.url}/api/admin/overlay-test`, { method: 'POST', headers: { cookie } });
  assert.equal(res.status, 200);
  assert.match(await waitFor(/testing the overlay/), /event: activity\ndata: .*"kind":"test".*"username":"streamer"/);
  assert.equal(s.repo.recentActivity(0, 10).length, 0, 'test events are not saved');
});
