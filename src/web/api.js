// JSON API consumed by the website (public/app.js) and the OBS overlay.
const crypto = require('node:crypto');
const express = require('express');
const { ITEMS, SKILLS, SKILL_IDS, maxLevel } = require('../game/skills');
const { levelForXp, progress, CHARACTER_MAX_LEVEL, CHARACTER_SKILL_COUNT } = require('../game/xp');
const { makeIsAdmin } = require('./auth');
const { SettingsError } = require('../settings');
const casino = require('../game/casino');

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

  // ---- Shop & your own gear (logged-in players) ------------------------------

  const requireLogin = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'log in with Kick first' }));

  router.get('/shop', (req, res) => {
    const crops = Object.fromEntries(SKILLS.farming.resources.map((c) => [c.seed, c]));
    const items = engine.shopItems().map((x) => {
      const crop = crops[x.item];
      if (!crop) return x;
      const it = ITEMS[crop.item];
      return { ...x, crop: { name: it.name, icon: it.icon, kind: crop.kind, value: engine.sellValue(crop.item), grow: Math.max(1, Math.round(crop.grow * (engine.cfg.growMultiplier ?? 1))) } };
    });
    const me = req.user ? repo.getUser(req.user.id) : null;
    res.json({
      items,
      points: me ? me.points : null,
      farmingLevel: me ? levelForXp(repo.getSkills(me.id).farming, maxLevel('farming')) : null,
      plots: me ? engine.plotCount(me.id) : null,
    });
  });

  // Same rules as the chat commands; the reply text is shown to the player.
  const act = (fn) => (req, res) => {
    const message = fn(req);
    logger.info(`[site] ${req.user.username}: ${req.path} ${JSON.stringify(req.body || {}).slice(0, 200)} → ${message}`);
    res.json({ message, profile: engine.profile(req.user.id) });
  };
  router.post('/shop/buy', requireLogin, act((req) => {
    const qty = Math.min(1000, Math.max(1, Number.parseInt(req.body?.qty, 10) || 1));
    return engine.buy(req.user, [String(req.body?.item || ''), String(qty)]);
  }));
  router.post('/me/plant', requireLogin, act((req) => engine.plant(req.user, req.body?.crop ? [String(req.body.crop)] : []) || 'Slow down a little, farmer!'));
  router.post('/me/harvest', requireLogin, act((req) => engine.harvest(req.user) || 'Slow down a little, farmer!'));
  router.post('/me/equip', requireLogin, act((req) => engine.equip(req.user, [String(req.body?.item || '')])));
  router.post('/me/drink', requireLogin, act((req) => engine.drink(req.user, [String(req.body?.item || '')])));
  router.post('/me/heal', requireLogin, act((req) => engine.healSpell(req.user)));
  router.post('/me/eat', requireLogin, act((req) => engine.eat(req.user, [String(req.body?.item || '')])));
  router.post('/me/unequip', requireLogin, act((req) => engine.unequip(req.user, [String(req.body?.slot || '')])));
  router.post('/me/sell', requireLogin, act((req) => {
    const qty = req.body?.qty === 'all' ? 'all' : String(Math.max(1, Number.parseInt(req.body?.qty, 10) || 1));
    return engine.sell(req.user, [String(req.body?.item || ''), qty]);
  }));

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
        kind === 'points' ? null : kind === 'overall' ? progress(r.char_xp / CHARACTER_SKILL_COUNT, CHARACTER_MAX_LEVEL).level : levelForXp(r.xp, maxLevel(kind)),
    }));
    res.json({ kind, rows });
  });

  router.get('/activity', (req, res) => {
    res.json({ activity: repo.recentActivity(Number(req.query.after) || 0, 30) });
  });

  // Live activity feed (Server-Sent Events) for the website and the OBS overlay.
  router.get('/events', (req, res) => {
    // no-transform / X-Accel-Buffering stop proxies from buffering or compressing the stream.
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
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

  // ---- Casino (logged-in players; results are decided on the server) --------------------

  router.get('/casino', (req, res) => {
    const c = engine.cfg;
    res.json({
      open: c.casinoEnabled !== false,
      minBet: c.casinoMinBet ?? 10,
      maxBet: c.casinoMaxBet || 0,
      cooldown: c.casinoCooldown ?? 5,
      slots: casino.SLOT_SYMBOLS.map(({ id, icon, label, three, two }) => ({ id, icon, label, three, two })),
      wheel: casino.WHEEL_ORDER.map((n) => ({ n, color: casino.colorOf(n) })),
      plinko: { rows: casino.PLINKO_ROWS, risks: casino.PLINKO_RISKS },
      balance: req.user ? repo.getUser(req.user.id).points : null,
      blackjack: req.user ? engine.blackjackState(req.user) : null,
      crash: { growth: casino.CRASH_GROWTH, max: casino.CRASH_MAX, state: req.user ? engine.crashState(req.user) : null },
      mines: { tiles: casino.MINES_TILES, table: Array.from({ length: 24 }, (_, i) => casino.minesMultiplier(i + 1, 1)), state: req.user ? engine.minesState(req.user) : null },
    });
  });
  const play = (fn) => [
    requireLogin,
    (req, res) => {
      const r = fn(req);
      if (!r.ok && !r.error) r.error = 'Slow down a little!';
      res.status(r.ok ? 200 : 400).json(r);
    },
  ];
  const betOf = (req) => String(req.body?.bet ?? '');
  router.post('/casino/slots', ...play((req) => engine.playSlots(req.user, betOf(req))));
  router.post('/casino/roulette', ...play((req) => engine.playRoulette(req.user, String(req.body?.choice || ''), betOf(req))));
  router.post('/casino/plinko', ...play((req) => engine.playPlinko(req.user, betOf(req), String(req.body?.risk || 'medium'))));
  router.post('/casino/blackjack', ...play((req) => engine.blackjackStart(req.user, betOf(req))));
  router.post('/casino/blackjack/:action', ...play((req) => engine.blackjackAction(req.user, req.params.action)));
  // Crash: start a live round (optional auto cash-out), poll it, cash out.
  router.post('/casino/crash', ...play((req) => engine.crashStart(req.user, betOf(req), req.body?.target ?? '')));
  router.get('/casino/crash', ...play((req) => engine.crashState(req.user)));
  router.post('/casino/crash/cashout', ...play((req) => engine.crashCashout(req.user)));
  // Mines: start a board, reveal tiles (0-24), cash out.
  router.post('/casino/mines', ...play((req) => engine.minesStart(req.user, betOf(req), req.body?.mines ?? 3)));
  router.post('/casino/mines/reveal', ...play((req) => engine.minesReveal(req.user, req.body?.tile)));
  router.post('/casino/mines/cashout', ...play((req) => engine.minesCashout(req.user)));

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

  // Pops a sample event onto every open overlay (and the live feeds) so OBS setup can be checked.
  // Not saved anywhere.
  router.post('/admin/overlay-test', requireAdmin, (req, res) => {
    engine.emit('activity', {
      id: 0,
      kind: 'test',
      username: req.user.username,
      text: 'is testing the overlay — it works! 🎉',
      skill: null,
      item: null,
      xp: 0,
      created_at: Date.now(),
    });
    logger.info(`[admin] ${req.user.username} sent a test overlay event`);
    res.json({ ok: true });
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
