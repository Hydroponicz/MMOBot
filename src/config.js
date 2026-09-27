const path = require('node:path');
const fs = require('node:fs');

// Load .env if present (Node 22 built-in, no dotenv needed).
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
};
const int = (name, fallback) => Number.parseInt(env(name, String(fallback)), 10);
const bool = (name, fallback) => ['1', 'true', 'yes', 'on'].includes(String(env(name, fallback)).toLowerCase());

const config = {
  port: int('PORT', 3000),
  // Public URL of the site, no trailing slash. Used to build OAuth redirect URLs.
  baseUrl: env('BASE_URL', 'http://localhost:3000').replace(/\/+$/, ''),
  sessionSecret: env('SESSION_SECRET', ''),
  dbPath: env('DB_PATH', path.join(__dirname, '..', 'data', 'mmobot.db')),

  kick: {
    clientId: env('KICK_CLIENT_ID', ''),
    clientSecret: env('KICK_CLIENT_SECRET', ''),
    // The channel the bot plays in (your Kick username / channel slug).
    channel: env('KICK_CHANNEL', '').toLowerCase(),
    // How chat is read: "webhook" (official, needs a public HTTPS BASE_URL) or "pusher" (unofficial websocket, works locally).
    chatSource: env('CHAT_SOURCE', 'webhook'),
    // Needed only for CHAT_SOURCE=pusher. Find it via https://kick.com/api/v2/channels/<channel> -> chatroom.id
    chatroomId: env('KICK_CHATROOM_ID', ''),
    verifyWebhooks: bool('VERIFY_WEBHOOKS', true),
    oauthBase: 'https://id.kick.com',
    apiBase: 'https://api.kick.com',
  },

  game: {
    prefix: env('COMMAND_PREFIX', '!'),
    // Seconds a user must wait between skilling actions.
    actionCooldown: int('ACTION_COOLDOWN_SECONDS', 30),
    // Points for chatting: awarded at most once per chatCooldown seconds per user.
    chatPoints: int('CHAT_POINTS', 5),
    chatCooldown: int('CHAT_POINTS_COOLDOWN_SECONDS', 60),
    // Whether the bot replies in chat to every command.
    replyInChat: bool('REPLY_IN_CHAT', true),
  },

  // Extra Kick usernames (comma separated) allowed on the admin page. The KICK_CHANNEL owner is always admin.
  adminUsers: env('ADMIN_USERS', '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Enables POST /api/dev/chat so you can test commands without Kick. Never enable in production.
  devMode: bool('DEV_MODE', false),
};

if (!config.sessionSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production');
  }
  config.sessionSecret = 'dev-insecure-secret-change-me';
}

module.exports = config;
