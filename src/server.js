const path = require('node:path');
const express = require('express');
const config = require('./config');
const { openDb } = require('./db');
const { GameEngine } = require('./game/engine');
const { KickApi } = require('./bot/kickApi');
const { ChatBot } = require('./bot/bot');
const { webhookRouter } = require('./bot/webhook');
const { startPusherReader } = require('./bot/pusher');
const { createSessions } = require('./web/session');
const { authRouter, sessionMiddleware } = require('./web/auth');
const { apiRouter } = require('./web/api');

function createApp({ config, repo, logger = console }) {
  const engine = new GameEngine({ repo, config });
  const kick = new KickApi({ config, repo, logger });
  const bot = new ChatBot({ engine, kick, config, logger });
  const sessions = createSessions({ secret: config.sessionSecret, secure: config.baseUrl.startsWith('https://') });

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Webhooks need the raw body for signature checks, so mount before any JSON parsing.
  app.use('/webhooks', webhookRouter({ bot, kick, repo, config, logger }));
  app.use(sessionMiddleware({ sessions, repo }));
  app.use('/auth', authRouter({ kick, repo, sessions, config, logger }));
  app.use('/api', apiRouter({ engine, repo, kick, bot, config }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  return { app, engine, kick, bot };
}

if (require.main === module) {
  const repo = openDb(config.dbPath);
  const { app, bot } = createApp({ config, repo });

  app.listen(config.port, () => {
    console.log(`MMOBot running at ${config.baseUrl} (port ${config.port})`);
    console.log(`  chat source: ${config.kick.chatSource}${config.devMode ? ' | DEV_MODE on: dev console enabled' : ''}`);
    if (!config.kick.clientId) console.log('  ! KICK_CLIENT_ID not set — Kick login and chat replies are disabled');
  });

  if (config.kick.chatSource === 'pusher') {
    if (config.kick.chatroomId) startPusherReader({ chatroomId: config.kick.chatroomId, bot });
    else console.warn('  ! CHAT_SOURCE=pusher requires KICK_CHATROOM_ID');
  }

  setInterval(() => repo.prune(), 60 * 60 * 1000).unref();
}

module.exports = { createApp };
