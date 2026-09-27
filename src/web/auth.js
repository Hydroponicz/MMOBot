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

const makeIsAdmin = (config) => (user) =>
  Boolean(user) &&
  (user.username.toLowerCase() === config.kick.channel || config.adminUsers.includes(user.username.toLowerCase()));

function authRouter({ kick, repo, sessions, config, logger = console }) {
  const router = express.Router();
  const isAdmin = makeIsAdmin(config);

  const start = (flow) => (req, res) => {
    if (!kick.configured) return res.status(500).send('Kick login is not configured: set KICK_CLIENT_ID and KICK_CLIENT_SECRET.');
    if (flow !== 'login' && !isAdmin(req.user)) return res.status(403).send('Admins only. Log in as the channel owner first.');
    const { verifier, challenge } = KickApi.pkce();
    const state = crypto.randomBytes(16).toString('base64url');
    sessions.write(res, OAUTH_COOKIE, { state, verifier, flow }, OAUTH_MS);
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

      // Admin flows: the admin must be logged in.
      if (!isAdmin(req.user)) return res.status(403).send('Admins only.');
      const stored = { ...token, user_id: who.userId, username: who.username };

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

      if (pending.flow === 'bot') {
        kick.saveToken('bot', stored);
        return res.redirect(`/#/admin?ok=${encodeURIComponent(`Bot account ${who.username} connected.`)}`);
      }
    } catch (err) {
      logger.error('[auth] callback failed:', err.message);
      res.status(502).send('Kick login failed. <a href="/">Back</a>');
    }
  });

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
