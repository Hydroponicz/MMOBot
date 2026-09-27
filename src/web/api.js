// JSON API consumed by the website (public/app.js) and the OBS overlay.
const crypto = require('node:crypto');
const express = require('express');
const { SKILLS, SKILL_IDS, maxLevel } = require('../game/skills');
const { levelForXp, progress, CHARACTER_MAX_LEVEL } = require('../game/xp');
const { makeIsAdmin } = require('./auth');
const { SettingsError } = require('../settings');

function apiRouter({ engine, repo, kick, bot, config, settings, logger = console }) {
  const router = express.Router();
  const isAdmin = makeIsAdmin(config, settings);
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
        kind === 'points' ? null : kind === 'overall' ? progress(r.char_xp / SKILL_IDS.length, CHARACTER_MAX_LEVEL).level : levelForXp(r.xp, maxLevel(kind)),
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
    if (kick.configured) {
      try {
        const channel = await kick.resolveChannel();
        subscriptions = (await kick.listSubscriptions()).filter(
          (x) => !channel || String(x.broadcaster_user_id) === String(channel.user_id)
        );
      } catch (err) {
        subscriptionError = err.message;
      }
    }
    res.json({
      channel: config.kick.channel,
      channelId: kick.broadcaster()?.user_id || null,
      kickConfigured: kick.configured,
      webhookUrl: `${config.baseUrl}/webhooks/kick`,
      redirectUrl: `${config.baseUrl}/auth/callback`,
      persistentStorage: config.persistentStorage,
      broadcaster: strip(kick.getToken('broadcaster')),
      bot: strip(kick.botAccount()),
      botIsChannelAccount: Boolean(kick.getToken('bot') && !kick.botAccount()),
      replySender: kick.replySender(),
      stats: bot.stats,
      subscriptions,
      subscriptionError,
      settings: engine.cfg,
    });
  });

  router.post('/admin/resubscribe', requireAdmin, async (req, res) => {
    try {
      const result = await kick.ensureChatSubscription();
      if (!result.ok) return res.status(400).json({ error: result.reason });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // One-time link for connecting the bot account from a private window (valid 30 minutes).
  router.post('/admin/bot-link', requireAdmin, (req, res) => {
    const code = crypto.randomBytes(24).toString('base64url');
    const exp = Date.now() + 30 * 60 * 1000;
    repo.setSetting('bot_link', { code, exp });
    res.json({ url: `${config.baseUrl}/auth/connect/bot?link=${code}`, expiresAt: exp });
  });

  // ---- Admin: settings --------------------------------------------------

  router.get('/admin/settings', requireAdmin, (req, res) => res.json(settings.describe()));

  router.put('/admin/settings/:section', requireAdmin, (req, res) => {
    try {
      settings.update(req.params.section, req.body?.value);
      logger.info(`[admin] ${req.user.username} changed ${req.params.section} settings: ${JSON.stringify(req.body?.value).slice(0, 1000)}`);
      res.json(settings.describe());
    } catch (err) {
      if (err instanceof SettingsError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  router.delete('/admin/settings/:section', requireAdmin, (req, res) => {
    settings.reset(req.params.section);
    logger.info(`[admin] ${req.user.username} reset ${req.params.section} settings to defaults`);
    res.json(settings.describe());
  });

  // ---- Admin: logs --------------------------------------------------------

  router.get('/admin/logs', requireAdmin, (req, res) => {
    const { level, source, q, before, limit } = req.query;
    res.json({ logs: repo.logs({ level, source, q, before, limit }), sources: repo.logSources() });
  });

  // ---- Admin: players -----------------------------------------------------

  router.get('/admin/players', requireAdmin, (req, res) => {
    res.json({ players: repo.searchUsers(req.query.q || '') });
  });

  router.post('/admin/players/:id/points', requireAdmin, (req, res) => {
    const user = repo.getUser(Number(req.params.id));
    const delta = Number(req.body?.delta);
    if (!user) return res.status(404).json({ error: 'player not found' });
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1e12) return res.status(400).json({ error: 'enter a whole number of points' });
    const applied = Math.max(delta, -user.points); // never below zero
    repo.addPoints(user.id, applied);
    const reason = String(req.body?.reason || '').slice(0, 200);
    logger.info(`[admin] ${req.user.username} ${applied >= 0 ? 'gave' : 'took'} ${Math.abs(applied)} points ${applied >= 0 ? 'to' : 'from'} ${user.username}${reason ? ` (${reason})` : ''}`);
    res.json({ player: repo.getUser(user.id) });
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
