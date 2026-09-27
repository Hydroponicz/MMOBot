// Minimal stateless sessions: an HMAC-signed JSON cookie. No session store needed.
const crypto = require('node:crypto');

function createSessions({ secret, secure }) {
  const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

  const encode = (obj) => {
    const data = Buffer.from(JSON.stringify(obj)).toString('base64url');
    return `${data}.${sign(data)}`;
  };

  const decode = (value) => {
    if (!value || typeof value !== 'string') return null;
    const [data, sig] = value.split('.');
    if (!data || !sig) return null;
    const expected = sign(data);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
      const obj = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
      if (obj.exp && obj.exp < Date.now()) return null;
      return obj;
    } catch {
      return null;
    }
  };

  const parseCookies = (header = '') =>
    Object.fromEntries(
      header
        .split(';')
        .map((c) => c.trim().split('='))
        .filter(([k, v]) => k && v !== undefined)
        .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
    );

  const cookieOpts = (maxAgeMs) => ({ httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: maxAgeMs });

  return {
    read(req, name) {
      return decode(parseCookies(req.headers.cookie)[name]);
    },
    write(res, name, obj, maxAgeMs) {
      res.cookie(name, encode({ ...obj, exp: Date.now() + maxAgeMs }), cookieOpts(maxAgeMs));
    },
    clear(res, name) {
      res.clearCookie(name, { path: '/' });
    },
  };
}

module.exports = { createSessions };
