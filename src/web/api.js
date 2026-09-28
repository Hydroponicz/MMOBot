// JSON API consumed by the website (public/app.js) and the OBS overlay.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { ITEMS, SKILLS, SKILL_IDS, maxLevel, findItem } = require('../game/skills');
const { levelForXp, progress, CHARACTER_MAX_LEVEL, CHARACTER_SKILL_COUNT } = require('../game/xp');
const { makeIsAdmin } = require('./auth');
const { SettingsError } = require('../settings');
const casino = require('../game/casino');

function apiRouter({ engine, repo, kick, bot, config, settings, logger = console, backups = null }) {
  const router = express.Router();
  const isAdmin = makeIsAdmin(config, settings);
  router.use(express.json({ limit: '16kb' }));

  // ---- Admin audit log ------------------------------------------------------------------
  // Every change an admin makes is recorded. Handlers that can be undone record their own entry (with
  // an undo payload); anything else is recorded by requireAdmin once it succeeds.
  const audit = (req, action, summary, undo = null) => {
    req.audited = true;
    return repo.addAudit({ admin: req.user.username, action, summary, undo }, Date.now());
  };
  const ACTION_NAMES = {
    '/admin/raid': 'started a raid',
    '/admin/raid/end': 'ended the raid',
    '/admin/worldboss/end': 'ended the world boss',
    '/admin/boost': 'changed the channel boost',
    '/admin/season/end': 'ended the season',
    '/admin/random-event': 'started a random event',
    '/admin/goal': 'started a channel goal',
    '/admin/goal/end': 'ended the channel goal',
    '/admin/backups': 'made a backup',
    '/admin/restore': 'uploaded a backup to restore',
    '/admin/overlay-test': 'sent an overlay test',
    '/admin/say': 'sent a chat message as the bot',
    '/admin/resubscribe': 'resubscribed to chat',
    '/admin/bot-link': 'made a bot connect link',
  };
  const requireAdmin = (req, res, next) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'admins only' });
    if (req.method !== 'GET') {
      res.on('finish', () => {
        if (req.audited || res.statusCode >= 400) return;
        const path = req.path;
        const name = ACTION_NAMES[path] || (/^\/admin\/backups\/.+\/restore$/.test(path) ? `restored backup ${decodeURIComponent(path.split('/')[3])}` : `${req.method} ${path}`);
        const detail = req.body && !Buffer.isBuffer(req.body) && Object.keys(req.body).length ? ` ${JSON.stringify(req.body).slice(0, 200)}` : '';
        repo.addAudit({ admin: req.user.username, action: path, summary: `${name}${name.startsWith(req.method) ? detail : ''}` }, Date.now());
      });
    }
    next();
  };

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
      raid: engine.publicRaid(repo.getSetting('raid')),
      worldBoss: repo.getSetting('world_boss') ? engine.publicRaid(repo.getSetting('world_boss')) : null,
      goal: engine.publicGoal(),
      boost: engine.activeBoost(),
    });
  });

  router.get('/guide', (req, res) => res.json(engine.guide()));

  // ---- Shop & your own gear (logged-in players) ------------------------------

  // Banned players can look around but not play (chat already ignores them).
  const requireLogin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'log in with Kick first' });
    if (repo.getUser(req.user.id)?.banned) return res.status(403).json({ error: "you've been removed from the game by an admin." });
    next();
  };

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
  router.post('/me/quest/start', requireLogin, act((req) => { const r = engine.questStart(req.user, String(req.body?.quest || '')); return r.ok ? r.message : r.error; }));
  router.post('/me/quest/pause', requireLogin, act((req) => { const r = engine.questPause(req.user, String(req.body?.quest || '')); return r.ok ? r.message : r.error; }));
  router.post('/me/heal', requireLogin, act((req) => engine.healSpell(req.user)));
  router.post('/me/eat', requireLogin, act((req) => engine.eat(req.user, [String(req.body?.item || '')])));
  router.post('/me/unequip', requireLogin, act((req) => engine.unequip(req.user, [String(req.body?.slot || '')])));
  router.post('/me/sell', requireLogin, act((req) => {
    const qty = req.body?.qty === 'all' ? 'all' : String(Math.max(1, Number.parseInt(req.body?.qty, 10) || 1));
    return engine.sell(req.user, [String(req.body?.item || ''), qty]);
  }));

  // ---- Player market ----------------------------------------------------------------
  router.get('/market', (req, res) => {
    const me = req.user ? repo.getUser(req.user.id) : null;
    const inv = me ? repo.getInventory(me.id) : {};
    res.json({
      listings: engine.marketListings(),
      fee: engine.cfg.marketFee ?? 0.05,
      points: me ? me.points : null,
      blocked: me ? engine.marketBlocked(me.id) : null,
      inventory: Object.entries(inv)
        .filter(([id, q]) => q > 0 && ITEMS[id] && !ITEMS[id].pet)
        .map(([id, qty]) => ({ id, qty, name: ITEMS[id].name, icon: ITEMS[id].icon, value: engine.sellValue(id), max: engine.marketMaxUnitPrice(id) })),
    });
  });
  const marketAct = (fn) => (req, res) => {
    const r = fn(req);
    if (!r.ok) return res.status(400).json({ error: r.error });
    logger.info(`[site] ${req.user.username}: ${req.path} → ${r.message}`);
    res.json(r);
  };
  router.post('/market/sell', requireLogin, marketAct((req) => engine.marketSell(req.user, req.body || {})));
  router.post('/market/:id/buy', requireLogin, marketAct((req) => engine.marketBuy(req.user, req.params.id)));
  router.post('/market/:id/cancel', requireLogin, marketAct((req) => engine.marketCancel(req.user, req.params.id)));

  // ---- Guilds -------------------------------------------------------------------------------
  router.get('/guilds', (req, res) => {
    const mine = req.user ? repo.guildOf(req.user.id) : null;
    res.json({ guilds: engine.guildList(), mine: engine.publicGuild(mine, true), cost: engine.guildCost(), points: req.user ? repo.getUser(req.user.id).points : null });
  });
  router.get('/guilds/:id', (req, res) => {
    const g = repo.guildGet(Number(req.params.id));
    if (!g) return res.status(404).json({ error: 'no such guild' });
    res.json({ guild: engine.publicGuild(g, true) });
  });
  router.post('/guilds', requireLogin, marketAct((req) => engine.guildCreate(req.user, req.body?.name, req.body?.tag)));
  router.post('/guilds/:id/join', requireLogin, marketAct((req) => engine.guildJoinId(req.user, req.params.id)));
  router.post('/guild/leave', requireLogin, marketAct((req) => engine.guildLeave(req.user)));
  router.post('/guild/deposit', requireLogin, marketAct((req) => engine.guildDeposit(req.user, req.body?.amount)));
  router.post('/guild/pay', requireLogin, marketAct((req) => engine.guildPay(req.user, req.body?.username, req.body?.amount)));
  router.post('/guild/kick', requireLogin, marketAct((req) => engine.guildKick(req.user, req.body?.username)));

  // ---- Hall of fame and bounties -----------------------------------------------------------
  router.get('/hall', (req, res) => res.json(engine.publicHall()));
  router.get('/bounties', (req, res) =>
    res.json({ bounties: engine.bounties().map((b) => ({ ...b, name: ITEMS[b.item].name, icon: ITEMS[b.item].icon })) })
  );

  // ---- Notifications --------------------------------------------------------------------
  router.get('/me/notifications', requireLogin, (req, res) => res.json(engine.notifications(req.user.id)));
  router.post('/me/notifications/read', requireLogin, (req, res) => {
    engine.readNotifications(req.user.id);
    res.json({ ok: true });
  });

  // ---- Channel goal (admin) ---------------------------------------------------------------
  router.post('/admin/goal', requireAdmin, (req, res) => {
    const r = engine.startGoal(req.body || {});
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  });
  router.post('/admin/goal/end', requireAdmin, (req, res) => {
    engine.stopGoal();
    res.json({ ok: true });
  });

  // Character customizer: the options, races and (logged in) your current look.
  router.get('/appearance', (req, res) => {
    res.json({ ...engine.appearanceOptions(), mine: req.user ? engine.publicAppearance(req.user.id) : null });
  });
  router.put('/me/appearance', requireLogin, (req, res) => {
    const r = engine.setAppearance(req.user, { race: req.body?.race, look: req.body?.look });
    if (!r.ok) return res.status(400).json({ error: r.error });
    logger.info(`[site] ${req.user.username}: appearance → ${r.message}`);
    res.json({ message: r.message, profile: engine.profile(req.user.id) });
  });

  router.get('/player/:name', (req, res) => {
    const user = repo.getUserByName(req.params.name);
    if (!user) return res.status(404).json({ error: 'player not found' });
    res.json({ profile: engine.profile(user.id), activity: withFaces(repo.userActivity(user.id, 25)) });
  });

  router.get('/leaderboard/:kind', (req, res) => {
    const kind = req.params.kind;
    if (!['overall', 'points', 'season'].includes(kind) && !SKILL_IDS.includes(kind)) {
      return res.status(400).json({ error: 'unknown leaderboard' });
    }
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const rows = repo.leaderboard(kind, limit, offset).map((r, i) => ({
      rank: offset + i + 1,
      username: r.username,
      avatarUrl: r.avatar_url,
      appearance: r.id ? engine.characterView(r.id) : null,
      xp: r.xp ?? null,
      points: r.points ?? null,
      level:
        kind === 'points' ? null : kind === 'overall' ? progress(r.char_xp / CHARACTER_SKILL_COUNT, CHARACTER_MAX_LEVEL).level : levelForXp(r.xp, maxLevel(kind)),
    }));
    const season = kind === 'season' ? { ...engine.season(), endsAt: engine.seasonEndsAt() } : undefined;
    res.json({ kind, rows, season });
  });

  // Each row gets the player's character look, for the faces in the feed.
  const withFaces = (rows) => {
    const looks = new Map();
    return rows.map((r) => {
      if (!looks.has(r.user_id)) looks.set(r.user_id, engine.characterView(r.user_id));
      return { ...r, appearance: looks.get(r.user_id) };
    });
  };
  router.get('/activity', (req, res) => {
    res.json({ activity: withFaces(repo.recentActivity(Number(req.query.after) || 0, 30)) });
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
    // Raid boss HP and channel boosts, for the overlay and site banners.
    const sendRaid = (raid) => res.write(`event: raid\ndata: ${JSON.stringify(raid)}\n\n`);
    const sendBoost = (boost) => res.write(`event: boost\ndata: ${JSON.stringify(boost)}\n\n`);
    // Channel goal progress and this stream's top players, for the overlay.
    const sendGoal = (goal) => res.write(`event: goal\ndata: ${JSON.stringify(goal)}\n\n`);
    const sendStats = (stats) => res.write(`event: streamstats\ndata: ${JSON.stringify(stats)}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    engine.on('activity', send);
    engine.on('raid', sendRaid);
    engine.on('boost', sendBoost);
    engine.on('goal', sendGoal);
    engine.on('streamstats', sendStats);
    const goal = engine.publicGoal();
    if (goal) sendGoal(goal);
    sendStats(engine.publicStreamStats());
    for (const key of ['world_boss', 'raid']) {
      const r = repo.getSetting(key);
      if (r) sendRaid(engine.publicRaid(r));
    }
    const boost = engine.activeBoost();
    if (boost) sendBoost(boost);
    req.on('close', () => {
      clearInterval(ping);
      engine.off('activity', send);
      engine.off('raid', sendRaid);
      engine.off('boost', sendBoost);
      engine.off('goal', sendGoal);
      engine.off('streamstats', sendStats);
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
      const before = (repo.getSetting('config_overrides') || {})[req.params.section] ?? null;
      settings.update(req.params.section, req.body?.value);
      audit(req, 'settings', `changed ${req.params.section} settings`, { type: 'settings', section: req.params.section, before });
      logger.info(`[admin] ${req.user.username} changed ${req.params.section} settings: ${JSON.stringify(req.body?.value).slice(0, 1000)}`);
      res.json(settings.describe());
    } catch (err) {
      if (err instanceof SettingsError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  router.delete('/admin/settings/:section', requireAdmin, (req, res) => {
    const before = (repo.getSetting('config_overrides') || {})[req.params.section] ?? null;
    settings.reset(req.params.section);
    audit(req, 'settings', `reset ${req.params.section} settings to defaults`, { type: 'settings', section: req.params.section, before });
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
    audit(req, 'points', `${applied >= 0 ? 'gave' : 'took'} ${Math.abs(applied)} pts ${applied >= 0 ? 'to' : 'from'} ${user.username}${reason ? ` (${reason})` : ''}`, { type: 'points', userId: user.id, delta: applied });
    logger.info(`[admin] ${req.user.username} ${applied >= 0 ? 'gave' : 'took'} ${Math.abs(applied)} points ${applied >= 0 ? 'to' : 'from'} ${user.username}${reason ? ` (${reason})` : ''}`);
    res.json({ player: repo.getUser(user.id) });
  });

  // Give (qty > 0) or take (qty < 0) items: { item: "iron ore" | "iron_ore", qty }.
  router.post('/admin/players/:id/items', requireAdmin, (req, res) => {
    const user = repo.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'player not found' });
    const item = findItem(String(req.body?.item || ''));
    const qty = Number(req.body?.qty);
    if (!item) return res.status(400).json({ error: 'unknown item' });
    if (!Number.isInteger(qty) || qty === 0 || Math.abs(qty) > 1e6) return res.status(400).json({ error: 'enter a whole number, e.g. 5 or -2' });
    const have = repo.getInventory(user.id)[item] || 0;
    const applied = Math.max(qty, -have);
    if (applied > 0) repo.addItem(user.id, item, applied);
    else if (applied < 0) repo.removeItem(user.id, item, -applied);
    if (applied) audit(req, 'items', `${applied >= 0 ? 'gave' : 'took'} ${Math.abs(applied)}x ${ITEMS[item].name} ${applied >= 0 ? 'to' : 'from'} ${user.username}`, { type: 'items', userId: user.id, item, qty: applied });
    logger.info(`[admin] ${req.user.username} ${applied >= 0 ? 'gave' : 'took'} ${Math.abs(applied)}x ${ITEMS[item].name} ${applied >= 0 ? 'to' : 'from'} ${user.username}`);
    res.json({ ok: true, item: ITEMS[item].name, applied, now: repo.getInventory(user.id)[item] || 0 });
  });

  // Take a player out of the game (their chat is ignored) or let them back in.
  router.post('/admin/players/:id/ban', requireAdmin, (req, res) => {
    const user = repo.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'player not found' });
    const banned = req.body?.banned ? 1 : 0;
    repo.setUserField(user.id, 'banned', banned);
    audit(req, 'ban', `${banned ? 'banned' : 'unbanned'} ${user.username}`, { type: 'ban', userId: user.id, banned: user.banned });
    logger.info(`[admin] ${req.user.username} ${banned ? 'banned' : 'unbanned'} ${user.username} from the game`);
    res.json({ ok: true, banned });
  });

  // Wipe a player's progress (skills, items, gear, plots, points).
  router.post('/admin/players/:id/reset', requireAdmin, (req, res) => {
    const user = repo.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'player not found' });
    const keys = ['bj', 'crash', 'mines', 'buffs', 'fire', 'daily', 'ach', 'museum', 'quest', 'streak'].map((k) => `${k}:${user.id}`);
    const snapshot = repo.snapshotPlayer(user.id, keys);
    repo.transaction(() => repo.resetPlayer(user.id));
    for (const key of keys) repo.deleteSetting(key);
    audit(req, 'reset', `reset ${user.username}'s progress`, { type: 'reset', userId: user.id, snapshot });
    logger.warn(`[admin] ${req.user.username} reset ${user.username}'s progress`);
    res.json({ ok: true });
  });

  // ---- Admin: audit log and undo -------------------------------------------------------------
  router.get('/admin/audit', requireAdmin, (req, res) => {
    res.json({
      entries: repo.audits(200).map((a) => ({ id: a.id, admin: a.admin, action: a.action, summary: a.summary, at: a.created_at, canUndo: Boolean(a.undo) && !a.undone_at, undoneAt: a.undone_at, undoneBy: a.undone_by })),
    });
  });

  router.post('/admin/audit/:id/undo', requireAdmin, (req, res) => {
    const a = repo.getAudit(Number(req.params.id));
    if (!a || !a.undo) return res.status(404).json({ error: "that change can't be undone" });
    if (a.undone_at) return res.status(400).json({ error: 'already undone' });
    const u = JSON.parse(a.undo);
    let note = '';
    repo.transaction(() => {
      if (u.type === 'points') {
        const user = repo.getUser(u.userId);
        const back = Math.max(-u.delta, -user.points);
        repo.addPoints(u.userId, back);
        if (back !== -u.delta) note = ` (only ${Math.abs(back)} could be taken back; they had spent the rest)`;
      } else if (u.type === 'items') {
        if (u.qty > 0) {
          const have = repo.getInventory(u.userId)[u.item] || 0;
          const take = Math.min(have, u.qty);
          if (take) repo.removeItem(u.userId, u.item, take);
          if (take < u.qty) note = ` (only ${take} were left to take back)`;
        } else repo.addItem(u.userId, u.item, -u.qty);
      } else if (u.type === 'ban') {
        repo.setUserField(u.userId, 'banned', u.banned ? 1 : 0);
      } else if (u.type === 'reset') {
        repo.restorePlayer(u.userId, u.snapshot);
      } else if (u.type === 'settings') {
        settings.restoreSection(u.section, u.before);
      }
      repo.markUndone(a.id, req.user.username, Date.now());
    });
    audit(req, 'undo', `undid #${a.id}: ${a.summary}${note}`);
    logger.warn(`[admin] ${req.user.username} undid #${a.id}: ${a.summary}${note}`);
    res.json({ ok: true, note });
  });

  // ---- Admin: events (raids, boosts, random events, stream status) ---------------------
  router.get('/admin/events', requireAdmin, (req, res) => {
    res.json({
      stream: repo.getSetting('stream'),
      raid: engine.publicRaid(repo.getSetting('raid')),
      worldBoss: repo.getSetting('world_boss') ? engine.publicRaid(repo.getSetting('world_boss')) : null,
      goal: engine.publicGoal(),
      skills: SKILL_IDS.map((id) => ({ id, name: SKILLS[id].name, icon: SKILLS[id].icon })),
      boost: engine.activeBoost(),
      randomEvent: repo.getSetting('random_event'),
      chatters: engine.activeChatters(10).length,
      season: { ...engine.season(), leaders: repo.seasonLeaders(3) },
      monsters: SKILLS.swords.monsters.map((m) => ({ id: m.id, name: m.name, icon: m.icon, level: m.level })),
    });
  });
  const adminAct = (fn) => (req, res) => {
    const r = fn(req);
    if (r && r.ok === false) return res.status(400).json(r);
    logger.info(`[admin] ${req.user.username} ${req.method} ${req.path}`);
    res.json({ ok: true, ...(r || {}) });
  };
  router.post('/admin/raid', requireAdmin, adminAct((req) => engine.startRaid({ monsterId: req.body?.monster || null, hpMultiplier: Number(req.body?.hpMultiplier) || null, world: !!req.body?.world })));
  router.post('/admin/raid/end', requireAdmin, adminAct(() => ({ text: engine.finishRaid(false, null, repo.getSetting('raid')) })));
  router.post('/admin/worldboss/end', requireAdmin, adminAct(() => ({ text: engine.finishRaid(false, null, repo.getSetting('world_boss')) })));
  router.post('/admin/boost', requireAdmin, adminAct((req) => {
    const multiplier = Number(req.body?.multiplier);
    const minutes = Number(req.body?.minutes);
    if (!(multiplier > 1 && multiplier <= 10) || !(minutes > 0 && minutes <= 60)) return { ok: false, error: 'multiplier 1-10 and 1-60 minutes' };
    const kind = req.body?.kind === 'points' ? 'points' : 'xp';
    const boost = engine.startBoost({ kind, multiplier, minutes, reason: String(req.body?.reason || 'streamer event').slice(0, 80) });
    engine.announce(`⚡ ${multiplier}x ${kind === 'xp' ? 'XP' : 'chat points'} for everyone for ${minutes} min! ${boost.reason ? `(${boost.reason})` : ''}`);
    return { boost };
  }));
  router.delete('/admin/boost', requireAdmin, adminAct(() => engine.stopBoost()));
  router.post('/admin/season/end', requireAdmin, adminAct(() => engine.endSeason()));
  router.post('/admin/random-event', requireAdmin, adminAct((req) => {
    const ev = engine.spawnRandomEvent(req.body?.kind || null);
    return ev ? { event: ev } : { ok: false, error: 'an event is already running' };
  }));

  // ---- Admin: economy ----------------------------------------------------------
  router.get('/admin/economy', requireAdmin, (req, res) => {
    engine.flushEconomy?.();
    const flows = repo.getSetting('economy_stats') || {};
    res.json({ totals: repo.economyTotals(), flows, since: flows.since || null, topEarners: repo.topEarners(10), health: engine.economyAlerts() });
  });

  // ---- Admin: backup and restore -------------------------------------------
  // Download a consistent copy of the whole database.
  router.get('/admin/backup', requireAdmin, (req, res) => {
    const file = path.join(os.tmpdir(), `mmobot-backup-${Date.now()}.db`);
    try {
      engine.flushEconomy?.();
      repo.backupTo(file);
    } catch (err) {
      return res.status(500).json({ error: `backup failed: ${err.message}` });
    }
    logger.info(`[admin] ${req.user.username} downloaded a backup`);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    res.download(file, `mmobot-${stamp}.db`, () => fs.rm(file, { force: true }, () => {}));
  });

  // Upload a backup: it replaces the database on the next start, and the server restarts itself.
  router.post('/admin/restore', requireAdmin, express.raw({ type: '*/*', limit: '512mb' }), (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 100 || buf.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') {
      return res.status(400).json({ error: "that isn't a MMOBot backup (.db) file" });
    }
    if (config.dbPath === ':memory:') return res.status(400).json({ error: 'no database file to restore into' });
    fs.writeFileSync(`${config.dbPath}.restore`, buf);
    logger.warn(`[admin] ${req.user.username} uploaded a backup (${Math.round(buf.length / 1024)} KB); restarting to restore it`);
    res.json({ ok: true, restarting: true });
    // Exit with an error code so Railway (restart on failure) starts it again with the backup.
    if (!config.noRestartOnRestore) setTimeout(() => process.exit(1), 800);
  });

  // Automatic backups kept on the server.
  router.get('/admin/backups', requireAdmin, (req, res) => {
    res.json({ enabled: Boolean(backups?.dir), dir: backups?.dir || null, keep: backups?.keep || 0, backups: backups ? backups.list() : [] });
  });
  router.post('/admin/backups', requireAdmin, (req, res) => {
    if (!backups?.dir) return res.status(400).json({ error: 'backups need a database file' });
    engine.flushEconomy?.();
    const b = backups.run(`manual (${req.user.username})`);
    res.json({ ok: true, backup: b, backups: backups.list() });
  });
  router.get('/admin/backups/:name', requireAdmin, (req, res) => {
    const f = backups?.file(req.params.name);
    if (!f) return res.status(404).json({ error: 'no such backup' });
    res.download(f, req.params.name);
  });
  router.post('/admin/backups/:name/restore', requireAdmin, (req, res) => {
    if (!backups?.stageRestore(req.params.name)) return res.status(404).json({ error: 'no such backup' });
    logger.warn(`[admin] ${req.user.username} is restoring backup ${req.params.name}; restarting`);
    res.json({ ok: true, restarting: true });
    if (!config.noRestartOnRestore) setTimeout(() => process.exit(1), 800);
  });

  // Pops a sample event onto every open overlay (and the live feeds) so OBS setup can be checked.
  // Not saved anywhere.
  router.post('/admin/overlay-test', requireAdmin, (req, res) => {
    engine.emit('activity', {
      id: 0,
      kind: 'test',
      username: req.user.username,
      text: 'is testing the overlay — it works! 🎉',
      // Shows the admin's character mining, so the animated scene can be checked too.
      skill: 'mining',
      item: null,
      icon: '💎',
      appearance: engine.characterView(req.user.id),
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
