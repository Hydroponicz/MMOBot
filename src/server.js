const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const { openDb } = require('./db');
const { GameEngine } = require('./game/engine');
const { KickApi } = require('./bot/kickApi');
const { ChatBot } = require('./bot/bot');
const { webhookRouter } = require('./bot/webhook');
const { createSessions } = require('./web/session');
const { authRouter, sessionMiddleware } = require('./web/auth');
const { apiRouter } = require('./web/api');
const { Settings } = require('./settings');
const { createLogger } = require('./logger');
const { createBackups } = require('./backups');

function createApp({ config, repo, logger: baseLogger = console, settings = new Settings({ config, repo }) }) {
  const logger = { ...baseLogger, info: (baseLogger.info || baseLogger.log).bind(baseLogger) };
  const backups = createBackups({ repo, config, logger });
  const engine = new GameEngine({ repo, config, settings });
  const kick = new KickApi({ config, repo, logger });
  const bot = new ChatBot({ engine, kick, logger });
  // Things the game says by itself: raids starting and ending, random events...
  engine.on('announce', (text) => {
    if (engine.cfg.replyInChat) bot.say(text);
    logger.info(`[event] ${text}`);
  });
  const sessions = createSessions({ secret: config.sessionSecret, secure: config.baseUrl.startsWith('https://') });

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // With PUBLIC_URL set, pages opened on another address (www vs no-www, the old *.up.railway.app
  // address) are sent to PUBLIC_URL. Kick login always returns to PUBLIC_URL, so it has to start there
  // too or the login cookie is on the wrong address. Webhooks, the API and health checks are left alone.
  if (['PUBLIC_URL', 'BASE_URL'].includes(config.baseUrlSource)) {
    const canonical = new URL(config.baseUrl).host.toLowerCase();
    app.use((req, res, next) => {
      const host = String(req.headers.host || '').toLowerCase();
      if (!host || host === canonical || !['GET', 'HEAD'].includes(req.method) || /^\/(webhooks|api|healthz)(\/|$)/.test(req.path)) return next();
      if (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) || host.endsWith('.railway.internal')) return next();
      res.redirect(301, config.baseUrl + req.originalUrl);
    });
  }

  // Webhooks need the raw body for signature checks, so mount before any JSON parsing.
  app.use('/webhooks', webhookRouter({ bot, kick, repo, config, logger }));
  app.use(sessionMiddleware({ sessions, repo }));
  app.use('/auth', authRouter({ kick, repo, sessions, config, settings, logger }));
  app.use('/api', apiRouter({ engine, repo, kick, bot, config, settings, logger, backups }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  return { app, engine, kick, bot, settings, backups };
}

// Use SESSION_SECRET if set; otherwise generate one once and keep it in the database,
// so logins survive restarts without any extra configuration.
function resolveSessionSecret(config, repo) {
  if (config.sessionSecret) return config.sessionSecret;
  let secret = repo.getSetting('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    repo.setSetting('session_secret', secret);
  }
  return secret;
}

async function keepChatSubscribed(kick, logger = console) {
  try {
    const r = await kick.ensureChatSubscription();
    if (!r.ok) logger.warn(`  ! chat not subscribed: ${r.reason}`);
  } catch (err) {
    logger.error('[kick] could not ensure chat subscription:', err.message);
  }
}

if (require.main === module) {
  const repo = openDb(config.dbPath);
  const logger = createLogger({ repo });
  config.sessionSecret = resolveSessionSecret(config, repo);
  const { app, kick, engine, backups } = createApp({ config, repo, logger });
  backups.start();
  process.on('unhandledRejection', (err) => logger.error('[server] unhandled promise rejection:', err));

  const server = app.listen(config.port, () => {
    logger.info(`[server] MMOBot started at ${config.baseUrl} (port ${config.port}, URL from ${config.baseUrlSource})`);
    logger.info(`  database: ${config.dbPath}`);
    logger.info(`  webhook URL for your Kick app: ${config.baseUrl}/webhooks/kick`);
    logger.info(`  redirect URL for your Kick app: ${config.baseUrl}/auth/callback`);
    if (config.devMode) logger.info('  DEV_MODE on: test chat page enabled (turn off for public sites)');
    if (!kick.configured) logger.info('  ! KICK_CLIENT_ID / KICK_CLIENT_SECRET not set — Kick login and chat are disabled');
    if (config.onRailway && config.baseUrl.startsWith('http://localhost')) {
      logger.warn('  ! No public URL: set PUBLIC_URL to your domain, or in Railway open this service → Settings → Networking → Generate Domain, then redeploy.');
    }
    if (!config.persistentStorage) {
      logger.warn('  ! No Railway volume attached: player progress will be LOST on every redeploy. Attach a volume to this service.');
    }
  });

  keepChatSubscribed(kick, logger);
  const timers = [
    setInterval(() => keepChatSubscribed(kick, logger), 30 * 60 * 1000),
    setInterval(() => repo.prune(), 60 * 60 * 1000),
    // Random events, raids and their timeouts.
    setInterval(() => {
      try {
        engine.tick();
      } catch (err) {
        logger.error('[events] tick failed:', err);
      }
    }, 10 * 1000),
  ];
  timers.forEach((t) => t.unref());

  // Railway sends SIGTERM on redeploy: finish in-flight requests and close the database cleanly.
  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    timers.forEach(clearInterval);
    engine.flushEconomy?.();
    server.close(() => {
      repo.close();
      process.exit(0);
    });
    server.closeAllConnections?.(); // SSE streams would otherwise keep the server open
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { createApp };
