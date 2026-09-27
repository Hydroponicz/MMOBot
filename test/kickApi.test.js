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
      const s = { id: 'sub1', event: body.events[0].name, version: 1, broadcaster_user_id: body.broadcaster_user_id, method: 'webhook' };
      subs.push(s);
      return json(200, { data: [{ name: s.event, version: 1, subscription_id: s.id }] });
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
  const post = fake.calls.find((c) => c.method === 'POST' && c.path === '/public/v1/events/subscriptions');
  assert.equal(post.auth, 'Bearer app-token');
  assert.deepEqual(post.body, { broadcaster_user_id: 777, events: [{ name: 'chat.message.sent', version: 1 }], method: 'webhook' });

  // Second call finds the existing subscription and does nothing.
  const again = await kick.ensureChatSubscription();
  assert.equal(again.created, false);
  assert.equal(fake.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/public/v1/events')).length, 1);
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
