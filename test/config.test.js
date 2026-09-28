const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePublicUrl, resolvePublicUrl } = require('../src/config');

test('PUBLIC_URL accepts a full URL or a bare domain', () => {
  assert.equal(normalizePublicUrl('https://mmo.example.com/'), 'https://mmo.example.com');
  assert.equal(normalizePublicUrl('mmo.example.com'), 'https://mmo.example.com');
  assert.equal(normalizePublicUrl('  HTTPS://Mmo.Example.com//  '), 'https://mmo.example.com');
  assert.equal(normalizePublicUrl('localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizePublicUrl('http://my-tunnel.trycloudflare.com'), 'http://my-tunnel.trycloudflare.com');
  assert.equal(normalizePublicUrl('https://example.com/mmo/'), 'https://example.com/mmo');
  assert.equal(normalizePublicUrl('not a url'), null);
  assert.equal(normalizePublicUrl(''), null);
});

test('PUBLIC_URL wins over BASE_URL and the Railway domain', () => {
  const railway = { RAILWAY_PUBLIC_DOMAIN: 'mmobot-production.up.railway.app' };
  assert.deepEqual(resolvePublicUrl({ ...railway, PUBLIC_URL: 'mmo.example.com', BASE_URL: 'https://old.example.com' }), {
    url: 'https://mmo.example.com',
    source: 'PUBLIC_URL',
  });
  assert.deepEqual(resolvePublicUrl({ ...railway, BASE_URL: 'https://old.example.com' }), { url: 'https://old.example.com', source: 'BASE_URL' });
  assert.deepEqual(resolvePublicUrl(railway), { url: 'https://mmobot-production.up.railway.app', source: 'RAILWAY_PUBLIC_DOMAIN' });
  assert.deepEqual(resolvePublicUrl({ PORT: '8080' }), { url: 'http://localhost:8080', source: 'default' });
  // A broken value is skipped (with a warning) rather than breaking login.
  const warn = console.warn;
  console.warn = () => {};
  assert.equal(resolvePublicUrl({ ...railway, PUBLIC_URL: 'not a url' }).source, 'RAILWAY_PUBLIC_DOMAIN');
  console.warn = warn;
});
