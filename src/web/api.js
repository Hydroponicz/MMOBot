// JSON API consumed by the website (public/app.js) and the OBS overlay.
const express = require('express');
const { SKILLS, SKILL_IDS } = require('../game/skills');
const { levelForXp, characterProgress } = require('../game/xp');
const { makeIsAdmin } = require('./auth');

function apiRouter({ engine, repo, kick, bot, config }) {
  const router = express.Router();
  const isAdmin = makeIsAdmin(config);
  router.use(express.json({ limit: '16kb' }));

  const requireAdmin = (req, res, next) => (isAdmin(req.user) ? next() : res.status(403).json({ error: 'admins only' }));

  router.get('/me', (req, res) => {
    res.json({
      user: req.user ? engine.profile(req.user.id) : null,
      isAdmin: isAdmin(req.user),
      loginEnabled: kick.configured,
      devMode: config.devMode,
    });
  });

  router.get('/site', (req, res) => {
    res.json({
      channel: config.kick.channel,
      totals: repo.totals(),
      skills: SKILL_IDS.map((id) => ({ id, name: SKILLS[id].name, icon: SKILLS[id].icon })),
    });
  });

  router.get('/guide', (req, res) => res.json(engine.guide()));

  router.get('/player/:name', (req, res) => {
    const user = repo.getUserByName(req.params.name);
    if (!user) return res.status(404).json({ error: 'player not found' });
    res.json({ profile: engine.profile(user.id), activity: repo.userActivity(user.id, 25) });
  });

  router.get('/leaderboard/:kind', (req, res) => {
    const kind = req.params.kind;
    if (kind !== 'overall' && kind !== 'points' && !SKILL_IDS.includes(kind)) {
      return res.status(400).json({ error: 'unknown leaderboard' });
    }
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const rows = repo.leaderboard(kind, limit, offset).map((r, i) => ({
      rank: offset + i + 1,
      username: r.username,
      avatarUrl: r.avatar_url,
      xp: r.xp ?? null,
      points: r.points ?? null,
      level:
        kind === 'points' ? null : kind === 'overall' ? characterProgress(r.xp, SKILL_IDS.length).level : levelForXp(r.xp),
    }));
    res.json({ kind, rows });
  });

  router.get('/activity', (req, res) => {
    res.json({ activity: repo.recentActivity(Number(req.query.after) || 0, 30) });
  });

  // Live activity feed (Server-Sent Events) for the website and the OBS overlay.
  router.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    const send = (entry) => res.write(`event: activity\ndata: ${JSON.stringify(entry)}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    engine.on('activity', send);
    req.on('close', () => {
      clearInterval(ping);
      engine.off('activity', send);
    });
  });

  // ---- Admin -------------------------------------------------------------

  router.get('/admin/status', requireAdmin, async (req, res) => {
    const strip = (t) => (t ? { username: t.username, userId: t.user_id, scope: t.scope, expiresAt: t.expires_at } : null);
    let subscriptions = null;
    let subscriptionError = null;
    const b = kick.getToken('broadcaster');
    if (b && config.kick.chatSource === 'webhook') {
      try {
        const token = await kick.accessToken('broadcaster');
        subscriptions = (await kick.listSubscriptions(token))?.data || [];
      } catch (err) {
        subscriptionError = err.message;
      }
    }
    res.json({
      channel: config.kick.channel,
      chatSource: config.kick.chatSource,
      webhookUrl: `${config.baseUrl}/webhooks/kick`,
      redirectUrl: `${config.baseUrl}/auth/callback`,
      broadcaster: strip(b),
      bot: strip(kick.getToken('bot')),
      stats: bot.stats,
      subscriptions,
      subscriptionError,
      settings: config.game,
    });
  });

  router.post('/admin/resubscribe', requireAdmin, async (req, res) => {
    const b = kick.broadcaster();
    if (!b) return res.status(400).json({ error: 'connect your channel first' });
    try {
      const token = await kick.accessToken('broadcaster');
      res.json({ ok: true, result: await kick.subscribeChat(token, b.user_id) });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  router.post('/admin/disconnect/:kind', requireAdmin, (req, res) => {
    if (!['bot', 'broadcaster'].includes(req.params.kind)) return res.status(400).json({ error: 'unknown kind' });
    kick.removeToken(req.params.kind);
    res.json({ ok: true });
  });

  router.post('/admin/say', requireAdmin, async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    try {
      res.json({ ok: await kick.sendChat(text) });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // ---- Dev console: play without Kick (DEV_MODE=true only) ---------------

  if (config.devMode) {
    router.post('/dev/chat', (req, res) => {
      const username = String(req.body?.username || '').trim().replace(/^@/, '');
      const content = String(req.body?.content || '');
      if (!/^[\w-]{2,25}$/.test(username)) return res.status(400).json({ error: 'invalid username' });
      const existing = repo.getUserByName(username);
      const kickUserId = existing?.kick_user_id || `dev-${username.toLowerCase()}`;
      const reply = bot.handleMessage({ kickUserId, username, content });
      res.json({ reply });
    });
  }

  return router;
}

module.exports = { apiRouter };
