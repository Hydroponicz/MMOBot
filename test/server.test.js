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
    game: { prefix: '!', staminaMax: 1, staminaMinutes: 0.5, racePerks: false, petDropMultiplier: 0, chatPoints: 5, chatCooldown: 60, replyInChat: false },
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
  assert.equal(player.profile.skills.length, 19);

  const lb = await fetch(`${s.url}/api/leaderboard/points`).then((r) => r.json());
  assert.equal(lb.rows[0].username, 'Viewer1');
  assert.ok(lb.rows[0].appearance.race, 'leaderboard rows carry the character look');
  assert.equal(typeof lb.rows[0].appearance.look.hair, 'string');

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
  assert.equal(s.values.general.staminaMax, 1);
  assert.equal(s.values.rods.length, 10);
  assert.equal(s.values.backpack[9].capacity, 100);

  const bad = await api('/api/admin/settings/general', { method: 'PUT', body: { value: { staminaMax: 'soon' } } });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /must be a number/);
  const ok = await api('/api/admin/settings/general', { method: 'PUT', body: { value: { staminaMax: 5, adminUsers: 'ModOne, @ModTwo' } } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ctx.settings.all.general.adminUsers, ['modone', 'modtwo']);
  assert.equal(ctx.engine.cfg.staminaMax, 5);

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

async function adminServer(t, configOverrides = {}) {
  const { createSessions } = require('../src/web/session');
  const repo = openDb(configOverrides.dbPath || ':memory:');
  const config = makeConfig(configOverrides);
  const ctx = createApp({ config, repo, logger: { log() {}, info() {}, warn() {}, error() {} } });
  const server = await new Promise((r) => {
    const s = ctx.app.listen(0, () => r(s));
  });
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const owner = repo.upsertUser({ kickUserId: '99', username: 'streamer' });
  let cookie;
  createSessions({ secret: config.sessionSecret, secure: false }).write({ cookie: (n, v) => (cookie = `${n}=${v}`) }, 'mmo_session', { uid: owner.id }, 60_000);
  const api = (p, opts = {}) =>
    fetch(url + p, { ...opts, headers: { cookie, 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.raw ?? (opts.body && JSON.stringify(opts.body)) });
  return { ...ctx, repo, url, api };
}

test('admin tools: give/take items, ban, reset a player', async (t) => {
  const s = await adminServer(t);
  const u = s.repo.upsertUser({ kickUserId: '5', username: 'Viewer' });
  const give = await (await s.api(`/api/admin/players/${u.id}/items`, { method: 'POST', body: { item: 'iron ore', qty: 5 } })).json();
  assert.deepEqual(give, { ok: true, item: 'Iron Ore', applied: 5, now: 5 });
  const take = await (await s.api(`/api/admin/players/${u.id}/items`, { method: 'POST', body: { item: 'iron_ore', qty: -9 } })).json();
  assert.equal(take.applied, -5, 'never below zero');
  assert.equal((await s.api(`/api/admin/players/${u.id}/items`, { method: 'POST', body: { item: 'unobtainium', qty: 1 } })).status, 400);

  await s.api(`/api/admin/players/${u.id}/ban`, { method: 'POST', body: { banned: true } });
  assert.equal(s.engine.handleChat({ kickUserId: '5', username: 'Viewer', content: '!fish' }).reply, null, 'banned players are ignored');
  assert.equal(s.repo.getUser(u.id).points, 0, 'and earn no chat points');
  const found = await (await s.api('/api/admin/players?q=view')).json();
  assert.equal(found.players[0].banned, 1);
  await s.api(`/api/admin/players/${u.id}/ban`, { method: 'POST', body: { banned: false } });
  assert.match(s.engine.handleChat({ kickUserId: '5', username: 'Viewer', content: '!fish' }).reply, /@Viewer/);

  s.repo.addPoints(u.id, 500);
  await s.api(`/api/admin/players/${u.id}/reset`, { method: 'POST', body: {} });
  assert.equal(s.repo.getUser(u.id).points, 0);
  assert.deepEqual(s.repo.getInventory(u.id), {});
  assert.equal(s.repo.getSkills(u.id).fishing, 0);
});

test('admin tools: reset a player\'s race change wait, or set their race regardless of it (undoable)', async (t) => {
  const s = await adminServer(t);
  s.engine.cfg.raceChangeDays = 30;
  const u = s.repo.upsertUser({ kickUserId: '5', username: 'Viewer' });
  const viewer = s.repo.getUser(u.id);
  assert.equal(s.engine.setAppearance(viewer, { race: 'halfling' }).ok, true);
  assert.match(s.engine.setAppearance(viewer, { race: 'dwarf' }).error, /change your race again in 30 day/);

  const found = await (await s.api('/api/admin/players?q=view')).json();
  assert.equal(found.players[0].race, 'halfling');
  assert.ok(found.players[0].raceWaitUntil > Date.now());
  assert.ok(found.races.some((r) => r.id === 'orc'));

  // Admin sets the race: works despite the wait, and leaves the wait alone.
  const set = await (await s.api(`/api/admin/players/${u.id}/race`, { method: 'POST', body: { race: 'orc' } })).json();
  assert.match(set.message, /Viewer is now .*Orc/);
  assert.equal(s.engine.appearance(u.id).race, 'orc');
  assert.ok(s.engine.raceChangeAt(u.id) > 0);
  assert.equal((await s.api(`/api/admin/players/${u.id}/race`, { method: 'POST', body: { race: 'dragon' } })).status, 400);

  // Reset the wait: the player can pick again themselves.
  await s.api(`/api/admin/players/${u.id}/race-wait`, { method: 'POST', body: {} });
  assert.equal(s.engine.raceChangeAt(u.id), 0);
  assert.equal(s.engine.appearance(u.id).race, 'orc', 'race kept');
  assert.equal(s.engine.setAppearance(s.repo.getUser(u.id), { race: 'dwarf' }).ok, true);

  // Both are in the audit log and can be undone.
  const { entries } = await (await s.api('/api/admin/audit')).json();
  const setEntry = entries.find((e) => e.summary.startsWith("set Viewer's race"));
  assert.ok(setEntry.canUndo && entries.some((e) => e.summary.startsWith("reset Viewer's race change wait")));
  await s.api(`/api/admin/audit/${setEntry.id}/undo`, { method: 'POST', body: {} });
  assert.equal(s.engine.appearance(u.id).race, 'halfling', 'back to what it was before the admin change');
});

test('admin tools: backup downloads the database; restore replaces it on the next start', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmobot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'game.db');
  const s = await adminServer(t, { dbPath, noRestartOnRestore: true });
  s.repo.upsertUser({ kickUserId: '5', username: 'SavedPlayer' });

  const res = await s.api('/api/admin/backup');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /mmobot-.*\.db/);
  const backup = Buffer.from(await res.arrayBuffer());
  assert.equal(backup.subarray(0, 15).toString(), 'SQLite format 3');

  assert.equal((await s.api('/api/admin/restore', { method: 'POST', raw: Buffer.from('not a database'), headers: { 'Content-Type': 'application/octet-stream' } })).status, 400);
  const ok = await s.api('/api/admin/restore', { method: 'POST', raw: backup, headers: { 'Content-Type': 'application/octet-stream' } });
  assert.deepEqual(await ok.json(), { ok: true, restarting: true });
  assert.ok(fs.existsSync(`${dbPath}.restore`));
  // Next start picks it up.
  const again = openDb(dbPath);
  assert.equal(again.getUserByName('savedplayer').username, 'SavedPlayer');
  assert.ok(!fs.existsSync(`${dbPath}.restore`));
  assert.ok(fs.existsSync(`${dbPath}.before-restore`));
});

test('admin economy page adds up where points come from and go', async (t) => {
  const s = await adminServer(t);
  s.engine.rng = () => 0.99; // the fish never gets away
  s.engine.handleChat({ kickUserId: '5', username: 'Viewer', content: 'hello everyone' });
  s.engine.handleChat({ kickUserId: '5', username: 'Viewer', content: '!fish' });
  const e = await (await s.api('/api/admin/economy')).json();
  assert.equal(e.flows.chat, 5);
  assert.ok(e.flows.actions >= 1);
  assert.equal(e.topEarners.length, 2);
  assert.ok(e.totals.points >= 6);
});

test('webhook: follows and subscriber badges reach the game', async (t) => {
  const s = await start();
  t.after(s.close);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  s.kick.publicKey = publicKey.export({ type: 'spki', format: 'pem' });
  const deliver = (type, id, payload) => {
    const body = JSON.stringify(payload);
    const sig = crypto.createSign('RSA-SHA256').update(`${id}.2026-01-01T00:00:00Z.${body}`).sign(privateKey, 'base64');
    return fetch(`${s.url}/webhooks/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Kick-Event-Type': type, 'Kick-Event-Message-Id': id, 'Kick-Event-Message-Timestamp': '2026-01-01T00:00:00Z', 'Kick-Event-Signature': sig },
      body,
    });
  };
  await deliver('channel.followed', 'f1', { broadcaster: { user_id: 99 }, follower: { user_id: 50, username: 'Fan', is_anonymous: false } });
  await deliver('chat.message.sent', 'c1', {
    broadcaster: { user_id: 99 },
    sender: { user_id: 51, username: 'SubGuy', identity: { badges: [{ text: 'Subscriber', type: 'subscriber', count: 3 }] } },
    content: 'hello there',
  });
  await deliver('kicks.gifted', 'k1', { broadcaster: { user_id: 99 }, sender: { user_id: 52, username: 'Kicker' }, gift: { amount: 25, name: 'Hype', type: 'BASIC', tier: 'LOW' } });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(s.repo.getUserByKickId('52').points, 50, 'KICKs pay the sender 2 pts each');
  assert.equal(s.repo.getUserByKickId('50').points, 100);
  assert.equal(s.repo.getUserByKickId('51').subscriber, 1);
  assert.equal(s.repo.getUserByKickId('51').points, 10, 'subscribers earn 2x chat points');
});

test('character customizer: options, save a look and race, race change is locked', async (t) => {
  const { createSessions } = require('../src/web/session');
  const config = makeConfig();
  const s = await start(config);
  t.after(s.close);
  const opts = await fetch(`${s.url}/api/appearance`).then((r) => r.json());
  assert.equal(opts.mine, null);
  assert.equal(opts.races.length, 6);
  assert.ok(opts.options.hair.some((o) => o.id === 'mohawk'));
  assert.ok(opts.options.skin.every((o) => /^#[0-9a-f]{6}$/.test(o.color)));

  const put = (body, cookie) =>
    fetch(`${s.url}/api/me/appearance`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  assert.equal((await put({ race: 'elf' })).status, 401);

  const u = s.repo.upsertUser({ kickUserId: '7', username: 'Viewer' });
  let cookie;
  createSessions({ secret: config.sessionSecret, secure: false }).write({ cookie: (n, v) => (cookie = `${n}=${v}`) }, 'mmo_session', { uid: u.id }, 60_000);
  const race = s.engine.appearance(u.id).race === 'elf' ? 'orc' : 'elf';
  const ok = await put({ race, look: { hair: 'braids', skin: 'deep' } }, cookie);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.profile.appearance.race, race);
  assert.equal(body.profile.appearance.look.hair, 'braids');
  const again = await put({ race: 'undead' }, cookie);
  assert.equal(again.status, 400);
  assert.match((await again.json()).error, /change your race again/);
  assert.equal((await put({ look: { skin: 'nope' } }, cookie)).status, 400);
});

test('market and notifications API', async (t) => {
  const { createSessions } = require('../src/web/session');
  const config = makeConfig();
  config.game = { ...config.game, tradeMinHours: 0, tradeMinActions: 0 };
  const s = await start(config);
  t.after(s.close);
  const alice = s.repo.upsertUser({ kickUserId: '7', username: 'Alice' });
  const bob = s.repo.upsertUser({ kickUserId: '8', username: 'Bob' });
  const login = (u) => {
    let cookie;
    createSessions({ secret: config.sessionSecret, secure: false }).write({ cookie: (n, v) => (cookie = `${n}=${v}`) }, 'mmo_session', { uid: u.id }, 60_000);
    return (path, body) =>
      fetch(`${s.url}/api${path}`, { method: body ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  };
  const asAlice = login(alice);
  const asBob = login(bob);
  s.repo.addItem(alice.id, 'iron_ore', 4);
  s.repo.addPoints(bob.id, 500);
  const m = await (await asAlice('/market')).json();
  assert.ok(m.inventory.some((i) => i.id === 'iron_ore'));
  assert.equal((await asAlice('/market/sell', { item: 'iron_ore', qty: 9, price: 10 })).status, 400);
  const listed = await (await asAlice('/market/sell', { item: 'iron_ore', qty: 4, price: 100 })).json();
  assert.equal(listed.ok, true);
  assert.equal((await asBob(`/market/${listed.id}/buy`, {})).status, 200);
  const n = await (await asAlice('/me/notifications')).json();
  assert.match(n.saved[0].text, /Bob bought your 4x/);
  assert.equal((await fetch(`${s.url}/api/me/notifications`)).status, 401);
  await asAlice('/me/notifications/read', {});
  assert.equal((await (await asAlice('/me/notifications')).json()).saved[0].read, true);
});

test('regression: banned players cannot use website actions', async (t) => {
  const { createSessions } = require('../src/web/session');
  const config = makeConfig();
  const s = await start(config);
  t.after(s.close);
  const u = s.repo.upsertUser({ kickUserId: '9', username: 'Cheater' });
  s.repo.addPoints(u.id, 5000);
  s.repo.setUserField(u.id, 'banned', 1);
  let cookie;
  createSessions({ secret: config.sessionSecret, secure: false }).write({ cookie: (n, v) => (cookie = `${n}=${v}`) }, 'mmo_session', { uid: u.id }, 60_000);
  const post = (path, body) => fetch(`${s.url}/api${path}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/shop/buy', { item: 'smithing_hammer' })).status, 403);
  assert.equal((await post('/casino/slots', { bet: 100 })).status, 403);
  assert.equal(s.repo.getUser(u.id).points, 5000);
});

test('automatic backups: made on demand, listed, pruned to the newest few, restorable', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { createBackups } = require('../src/backups');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmobot-bk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'game.db');
  const repo = openDb(dbPath);
  repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  let now = Date.UTC(2026, 0, 1);
  const b = createBackups({ repo, config: { dbPath, backupKeep: 2 }, logger: { info() {} }, now: () => now });
  for (let i = 0; i < 3; i++) {
    b.run();
    now += 86_400_000;
    // (file times come from the disk; give each a distinct mtime)
    const [newest] = fs.readdirSync(b.dir).sort().reverse();
    fs.utimesSync(path.join(b.dir, newest), new Date(now), new Date(now));
  }
  const list = b.list();
  assert.equal(list.length, 2, 'keeps the newest 2');
  assert.equal(b.file('../game.db'), null, 'no path tricks');
  assert.ok(b.stageRestore(list[0].name));
  assert.ok(fs.existsSync(`${dbPath}.restore`));
});

test('admin audit log records changes and can undo points, items, bans, resets and settings', async (t) => {
  const { createSessions } = require('../src/web/session');
  const config = makeConfig();
  const s = await start(config);
  t.after(s.close);
  const owner = s.repo.upsertUser({ kickUserId: '99', username: 'streamer' });
  let cookie;
  createSessions({ secret: config.sessionSecret, secure: false }).write({ cookie: (n, v) => (cookie = `${n}=${v}`) }, 'mmo_session', { uid: owner.id }, 60_000);
  const api = (path, body, method = body ? 'POST' : 'GET') =>
    fetch(`${s.url}/api${path}`, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const p = s.repo.upsertUser({ kickUserId: '5', username: 'Viewer' });
  s.repo.addXp(p.id, 'mining', 5000);
  s.repo.addItem(p.id, 'iron_ore', 3);

  await api(`/admin/players/${p.id}/points`, { delta: 700, reason: 'giveaway' });
  await api(`/admin/players/${p.id}/items`, { item: 'coal', qty: 4 });
  await api(`/admin/players/${p.id}/ban`, { banned: true });
  await api(`/admin/players/${p.id}/reset`, {});
  await api('/admin/settings/general', { value: { staminaMax: 9 } }, 'PUT');
  await api('/admin/goal', { target: 50 });
  const { entries } = await api('/admin/audit');
  assert.deepEqual(entries.map((e) => e.summary.split(' ')[0]).slice(0, 6), ['started', 'changed', 'reset', 'banned', 'gave', 'gave']);
  assert.equal(entries[0].canUndo, false, 'goals are logged but not undoable');
  assert.equal(s.repo.getUser(p.id).points, 0, 'reset wiped the points');
  assert.equal(s.engine.cfg.staminaMax, 9);

  const undo = (summaryStart) => api(`/admin/audit/${entries.find((e) => e.summary.startsWith(summaryStart)).id}/undo`, {});
  await undo('changed general');
  assert.equal(s.engine.cfg.staminaMax, 1, 'settings back');
  await undo('reset');
  assert.equal(s.repo.getUser(p.id).points, 700, 'reset undone: points back');
  assert.equal(s.repo.getInventory(p.id).iron_ore, 3);
  assert.equal(s.repo.getSkills(p.id).mining, 5000);
  await undo('banned');
  assert.equal(s.repo.getUser(p.id).banned, 0);
  await undo('gave 4x');
  assert.equal(s.repo.getInventory(p.id).coal, undefined);
  await undo('gave 700');
  assert.equal(s.repo.getUser(p.id).points, 0);
  const again = await fetch(`${s.url}/api/admin/audit/${entries[5].id}/undo`, { method: 'POST', headers: { cookie } });
  assert.equal(again.status, 400, 'only once');
  const after = await api('/admin/audit');
  assert.match(after.entries[0].summary, /^undid #/);
});

test('with PUBLIC_URL set, pages on other addresses redirect there (login needs one address)', async (t) => {
  const s = await start(makeConfig({ baseUrl: 'https://hydroponicz.wtf', baseUrlSource: 'PUBLIC_URL' }));
  t.after(s.close);
  // (fetch can't set the Host header, so use http directly.)
  const http = require('node:http');
  const get = (path, host) =>
    new Promise((ok, fail) => {
      const u = new URL(s.url + path);
      http
        .get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { host } }, (res) => {
          res.resume();
          ok({ status: res.statusCode, headers: { get: (h) => res.headers[h] } });
        })
        .on('error', fail);
    });
  const r = await get('/auth/login?x=1', 'www.hydroponicz.wtf');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), 'https://hydroponicz.wtf/auth/login?x=1');
  assert.equal((await get('/', 'mmobot-production.up.railway.app')).status, 301);
  assert.equal((await get('/', 'hydroponicz.wtf')).status, 200, 'the real address is served');
  assert.equal((await get('/api/site', 'www.hydroponicz.wtf')).status, 200, 'the API is left alone');
  assert.equal((await get('/healthz', 'something.internal')).status, 200);
});
