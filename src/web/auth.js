// "Login with Kick" for viewers, plus the admin-only flow that connects the streamer's channel / bot account.
const crypto = require('node:crypto');
const express = require('express');
const { KickApi } = require('../bot/kickApi');

const SESSION_COOKIE = 'mmo_session';
const OAUTH_COOKIE = 'mmo_oauth';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_MS = 10 * 60 * 1000;

// What each flow asks Kick for.
const FLOWS = {
  login: { scopes: ['user:read'], redirect: '/auth/callback' },
  broadcaster: { scopes: ['user:read', 'chat:write', 'events:subscribe'], redirect: '/auth/callback' },
  bot: { scopes: ['user:read', 'chat:write'], redirect: '/auth/callback' },
};

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Small standalone result page, used when the bot account is connected from a private window
// (where nobody is logged into the site, so the admin page isn't available).
const resultPage = (ok, title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0e11;color:#e8edf2;
font:16px/1.5 system-ui,sans-serif;padding:16px}main{max-width:460px;background:#161b22;border:1px solid #262e39;
border-radius:14px;padding:28px;text-align:center}h1{font-size:1.3rem;margin:.4em 0}.i{font-size:2.4rem}
p{color:#8b98a8}</style></head><body><main><div class="i">${ok ? '✅' : '⚠️'}</div><h1>${esc(title)}</h1>
<p>${body}</p></main></body></html>`;

// The channel owner is always admin; extra admins are editable on the admin page (settings).
const makeIsAdmin = (config, settings) => (user) => {
  if (!user) return false;
  const name = user.username.toLowerCase();
  const extra = settings ? settings.all.general.adminUsers : config.adminUsers || [];
  return name === config.kick.channel || extra.includes(name);
};

function authRouter({ kick, repo, sessions, config, settings, logger = console }) {
  const router = express.Router();
  const isAdmin = makeIsAdmin(config, settings);

  // One-time link (made on the admin page) that lets the bot account be connected from a private
  // window, where you can log into kick.com as the bot instead of your main account.
  const validBotLink = (code) => {
    const link = repo.getSetting('bot_link');
    return Boolean(code && link && link.exp > Date.now() && link.code === String(code));
  };

  const start = (flow) => (req, res) => {
    if (!kick.configured) return res.status(500).send('Kick login is not configured: set KICK_CLIENT_ID and KICK_CLIENT_SECRET.');
    const botLink = flow === 'bot' && validBotLink(req.query.link) ? String(req.query.link) : null;
    if (flow !== 'login' && !isAdmin(req.user) && !botLink) {
      if (flow === 'bot' && req.query.link) {
        return res
          .status(403)
          .send(resultPage(false, 'Link expired', 'This bot login link has expired or was already used. Make a new one on the Admin page.'));
      }
      return res.status(403).send('Admins only. Log in as the channel owner first.');
    }
    const { verifier, challenge } = KickApi.pkce();
    const state = crypto.randomBytes(16).toString('base64url');
    sessions.write(res, OAUTH_COOKIE, { state, verifier, flow, botLink }, OAUTH_MS);
    res.redirect(kick.authorizeUrl({ redirectPath: FLOWS[flow].redirect, scopes: FLOWS[flow].scopes, state, challenge }));
  };

  router.get('/login', start('login'));
  router.get('/connect/broadcaster', start('broadcaster'));
  router.get('/connect/bot', start('bot'));

  // One callback URL for every flow, so only one redirect URL has to be registered with Kick.
  router.get('/callback', async (req, res) => {
    const pending = sessions.read(req, OAUTH_COOKIE);
    sessions.clear(res, OAUTH_COOKIE);
    if (req.query.error) return res.redirect(`/#/?error=${encodeURIComponent(String(req.query.error))}`);
    if (!pending || !req.query.code || req.query.state !== pending.state) {
      return res.status(400).send('Login expired or invalid. <a href="/">Try again</a>.');
    }
    try {
      const token = await kick.exchangeCode({
        code: String(req.query.code),
        verifier: pending.verifier,
        redirectPath: FLOWS[pending.flow].redirect,
      });
      const who = await kick.currentUser(token.access_token);

      if (pending.flow === 'login') {
        const user = repo.upsertUser({ kickUserId: who.userId, username: who.username, avatarUrl: who.avatarUrl });
        repo.setLoggedIn(user.id);
        sessions.write(res, SESSION_COOKIE, { uid: user.id }, SESSION_MS);
        return res.redirect('/#/me');
      }

      const stored = { ...token, user_id: who.userId, username: who.username };

      if (pending.flow === 'bot') return connectBot(req, res, pending, stored);

      // Admin flows: the admin must be logged in.
      if (!isAdmin(req.user)) return res.status(403).send('Admins only.');

      if (pending.flow === 'broadcaster') {
        if (config.kick.channel && who.username.toLowerCase() !== config.kick.channel) {
          return res.redirect(
            `/#/admin?error=${encodeURIComponent(`Authorize as the channel owner (${config.kick.channel}), not ${who.username}.`)}`
          );
        }
        kick.saveToken('broadcaster', stored);
        let note = 'Channel connected — the bot can now reply in chat.';
        try {
          const sub = await kick.ensureChatSubscription();
          if (sub.ok) note += ' Chat subscription is active.';
        } catch (err) {
          logger.error('[auth] chat subscription failed:', err.message);
          return res.redirect(`/#/admin?error=${encodeURIComponent('Connected, but subscribing to chat failed: ' + err.message)}`);
        }
        return res.redirect(`/#/admin?ok=${encodeURIComponent(note)}`);
      }

    } catch (err) {
      logger.error('[auth] callback failed:', err.message);
      res.status(502).send('Kick login failed. <a href="/">Back</a>');
    }
  });

  function connectBot(req, res, pending, stored) {
    const viaLink = Boolean(pending.botLink);
    if (!isAdmin(req.user) && !(viaLink && validBotLink(pending.botLink))) {
      return res.status(403).send(resultPage(false, 'Link expired', 'Make a new bot login link on the Admin page and try again.'));
    }
    const done = (ok, title, body) =>
      viaLink
        ? res.status(ok ? 200 : 400).send(resultPage(ok, title, body))
        : res.redirect(`/#/admin?${ok ? 'ok' : 'error'}=${encodeURIComponent(`${title} ${body.replace(/<[^>]+>/g, '')}`)}`);

    const b = kick.broadcaster();
    const isChannel =
      (b && String(b.user_id) === String(stored.user_id)) || stored.username.toLowerCase() === config.kick.channel;
    if (isChannel) {
      return done(
        false,
        `That was your channel account (${stored.username}).`,
        'Kick signs you in with whichever account is logged into kick.com in this browser. ' +
          'Use “Get bot login link” on the Admin page, open the link in a private/incognito window, ' +
          'and log into Kick there as your bot account.'
      );
    }
    kick.saveToken('bot', stored);
    repo.deleteSetting('bot_link');
    logger.log(`[auth] bot account connected: ${stored.username}`);
    return done(
      true,
      `Bot account ${stored.username} connected.`,
      `Replies in chat now come from <b>${esc(stored.username)}</b>. You can close this window.`
    );
  }

  router.post('/logout', (req, res) => {
    sessions.clear(res, SESSION_COOKIE);
    res.json({ ok: true });
  });

  return router;
}

// Attaches req.user from the session cookie.
function sessionMiddleware({ sessions, repo }) {
  return (req, res, next) => {
    const s = sessions.read(req, SESSION_COOKIE);
    req.user = s?.uid ? repo.getUser(s.uid) : null;
    next();
  };
}

module.exports = { authRouter, sessionMiddleware, makeIsAdmin };
