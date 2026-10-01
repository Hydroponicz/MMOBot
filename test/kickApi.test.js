const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDb } = require('../src/db');
const { KickApi, KICK_PUBLIC_KEY } = require('../src/bot/kickApi');

const config = {
  baseUrl: 'https://mmo.example.com',
  kick: { clientId: 'cid', clientSecret: 'secret', channel: 'streamer', oauthBase: 'https://id.kick.com', apiBase: 'https://api.kick.com' },
};
const quiet = { log() {}, warn() {}, error() {} };

// Minimal fake of Kick's official endpoints.
function fakeKick({ existing = [] } = {}) {
  const calls = [];
  const subs = [...existing];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const body = opts.body instanceof URLSearchParams ? Object.fromEntries(opts.body) : opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method: opts.method || 'GET', path: u.pathname + u.search, auth: opts.headers?.Authorization, body });
    if (u.pathname === '/oauth/token') return json(200, { access_token: 'app-token', expires_in: 3600, token_type: 'Bearer' });
    if (u.pathname === '/public/v1/channels') return json(200, { data: [{ broadcaster_user_id: 777, slug: 'streamer' }] });
    if (u.pathname === '/public/v1/events/subscriptions' && opts.method === 'POST') {
      const added = body.events.map((e, i) => ({ id: `sub${subs.length + i + 1}`, event: e.name, version: 1, broadcaster_user_id: body.broadcaster_user_id, method: 'webhook' }));
      subs.push(...added);
      return json(200, { data: added.map((s) => ({ name: s.event, version: 1, subscription_id: s.id })) });
    }
    if (u.pathname === '/public/v1/events/subscriptions') return json(200, { data: subs });
    if (u.pathname === '/public/v1/public-key') return json(500, {});
    return json(404, {});
  };
  return { fetch, calls };
}

test('ensureChatSubscription resolves the channel and subscribes with an app token', async (t) => {
  const fake = fakeKick();
  t.mock.method(globalThis, 'fetch', fake.fetch);
  const kick = new KickApi({ config, repo: openDb(':memory:'), logger: quiet });

  const r = await kick.ensureChatSubscription();
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.deepEqual(kick.broadcaster(), { user_id: '777', username: 'streamer' });

  const tokenCall = fake.calls.find((c) => c.path === '/oauth/token');
  assert.equal(tokenCall.body.grant_type, 'client_credentials');
  const posts = fake.calls.filter((c) => c.method === 'POST' && c.path === '/public/v1/events/subscriptions');
  assert.equal(posts[0].auth, 'Bearer app-token');
  // Channel events (follows, subs, gifts, live status), then chat.
  assert.deepEqual(
    posts[0].body.events.map((e) => e.name),
    ['channel.followed', 'channel.subscription.new', 'channel.subscription.renewal', 'channel.subscription.gifts', 'livestream.status.updated', 'kicks.gifted']
  );
  assert.deepEqual(posts[1].body, { broadcaster_user_id: 777, events: [{ name: 'chat.message.sent', version: 1 }], method: 'webhook' });

  // Second call finds the existing subscriptions and does nothing.
  const again = await kick.ensureChatSubscription();
  assert.equal(again.created, false);
  assert.equal(fake.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/public/v1/events')).length, 2);
});

test('ensureChatSubscription reports missing configuration', async () => {
  const kick = new KickApi({ config: { ...config, kick: { ...config.kick, clientId: '' } }, repo: openDb(':memory:'), logger: quiet });
  assert.deepEqual(await kick.ensureChatSubscription(), { ok: false, reason: 'KICK_CLIENT_ID / KICK_CLIENT_SECRET not set' });
});

test('falls back to the published Kick public key', async (t) => {
  t.mock.method(globalThis, 'fetch', fakeKick().fetch);
  const kick = new KickApi({ config, repo: openDb(':memory:'), logger: quiet });
  assert.equal(await kick.getPublicKey(), KICK_PUBLIC_KEY);
  assert.doesNotThrow(() => crypto.createPublicKey(KICK_PUBLIC_KEY));
});

function withTokens(repo, { broadcaster, bot }) {
  const tok = (user_id, username) => ({ access_token: `tok-${username}`, refresh_token: 'r', expires_at: Date.now() + 3600e3, user_id, username });
  if (broadcaster) repo.setSetting('token:broadcaster', tok(...broadcaster));
  if (bot) repo.setSetting('token:bot', tok(...bot));
}

test('sendChat posts as the separate bot account into the channel', async (t) => {
  const fake = fakeKick();
  t.mock.method(globalThis, 'fetch', async (url, opts) => (url.endsWith('/public/v1/chat') ? new Response('{"data":{"is_sent":true}}') : fake.fetch(url, opts)));
  const repo = openDb(':memory:');
  withTokens(repo, { broadcaster: ['777', 'Streamer'], bot: ['888', 'mmobot'] });
  const kick = new KickApi({ config, repo, logger: quiet });
  assert.deepEqual(kick.replySender(), { mode: 'bot_account', username: 'mmobot' });
  assert.equal(await kick.sendChat('hi'), true);
  const call = globalThis.fetch.mock.calls.at(-1);
  assert.equal(call.arguments[1].headers.Authorization, 'Bearer tok-mmobot');
  assert.deepEqual(JSON.parse(call.arguments[1].body), { type: 'user', broadcaster_user_id: 777, content: 'hi' });
});

test('a channel account saved as the bot is ignored; replies use the app bot', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{"data":{},"message":"Not found"}', { status: 404 }));
  const repo = openDb(':memory:');
  withTokens(repo, { broadcaster: ['777', 'Streamer'], bot: ['777', 'Streamer'] });
  const kick = new KickApi({ config, repo, logger: quiet });
  assert.equal(kick.botAccount(), null);
  assert.deepEqual(kick.replySender(), { mode: 'app_bot', username: null });
  await assert.rejects(kick.sendChat('hi'), /Connect your bot account/);
  const call = globalThis.fetch.mock.calls.at(-1);
  assert.equal(call.arguments[1].headers.Authorization, 'Bearer tok-Streamer');
  assert.deepEqual(JSON.parse(call.arguments[1].body), { type: 'bot', content: 'hi' });
});

test('the bot ignores only its own bot account, never the streamer', () => {
  const { ChatBot } = require('../src/bot/bot');
  const repo = openDb(':memory:');
  withTokens(repo, { broadcaster: ['777', 'Streamer'], bot: ['777', 'Streamer'] });
  const kick = new KickApi({ config, repo, logger: quiet });
  const seen = [];
  const bot = new ChatBot({ engine: { handleChat: (m) => (seen.push(m.username), { reply: null }) }, kick, config: { game: { replyInChat: false } }, logger: quiet });
  bot.handleMessage({ kickUserId: '777', username: 'Streamer', content: '!fish' });
  withTokens(repo, { bot: ['888', 'mmobot'] });
  bot.handleMessage({ kickUserId: '888', username: 'mmobot', content: '@x you caught' });
  bot.handleMessage({ kickUserId: '777', username: 'Streamer', content: '!fish' });
  assert.deepEqual(seen, ['Streamer', 'Streamer']);
});
