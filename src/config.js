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

// Railway injects these automatically: RAILWAY_PUBLIC_DOMAIN once you generate a domain,
// RAILWAY_VOLUME_MOUNT_PATH once you attach a volume.
const railwayDomain = env('RAILWAY_PUBLIC_DOMAIN', '');
const volumePath = env('RAILWAY_VOLUME_MOUNT_PATH', '');
const onRailway = Boolean(env('RAILWAY_ENVIRONMENT', '') || env('RAILWAY_PROJECT_ID', ''));

const config = {
  port: int('PORT', 3000),
  // Public URL of the site, no trailing slash. Used to build OAuth redirect and webhook URLs.
  baseUrl: env('BASE_URL', railwayDomain ? `https://${railwayDomain}` : 'http://localhost:3000').replace(/\/+$/, ''),
  // Optional: when empty a random secret is generated once and stored in the database.
  sessionSecret: env('SESSION_SECRET', ''),
  dbPath: env('DB_PATH', path.join(volumePath || path.join(__dirname, '..', 'data'), 'mmobot.db')),
  onRailway,
  persistentStorage: Boolean(env('DB_PATH', '') || volumePath || !onRailway),

  kick: {
    clientId: env('KICK_CLIENT_ID', ''),
    clientSecret: env('KICK_CLIENT_SECRET', ''),
    // The channel the bot plays in (your Kick username / channel slug).
    channel: env('KICK_CHANNEL', '').toLowerCase(),
    verifyWebhooks: bool('VERIFY_WEBHOOKS', true),
    oauthBase: 'https://id.kick.com',
    apiBase: 'https://api.kick.com',
  },

  game: {
    prefix: env('COMMAND_PREFIX', '!'),
    // Seconds a user must wait between skilling actions.
    actionCooldown: int('ACTION_COOLDOWN_SECONDS', 30),
    // Farming (!plant / !harvest) has its own, shorter cooldown so it can run alongside other skills.
    farmCooldown: int('FARM_COOLDOWN_SECONDS', 10),
    // Points for chatting: awarded at most once per chatCooldown seconds per user.
    chatPoints: int('CHAT_POINTS', 5),
    chatCooldown: int('CHAT_POINTS_COOLDOWN_SECONDS', 60),
    // Whether the bot replies in chat to every command.
    replyInChat: bool('REPLY_IN_CHAT', true),
    // Casino (points only). Min/max bet (0 = no max) and seconds between bets per viewer.
    casinoEnabled: bool('CASINO_ENABLED', true),
    casinoMinBet: int('CASINO_MIN_BET', 10),
    casinoMaxBet: int('CASINO_MAX_BET', 0),
    casinoCooldown: int('CASINO_COOLDOWN_SECONDS', 5),
    // Emotes that work as commands, "emote=command" (comma separated). Editable on the admin page.
    emoteCommands: env('EMOTE_COMMANDS', 'hydroponiczcobble=mine')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  // Extra Kick usernames (comma separated) allowed on the admin page. The KICK_CHANNEL owner is always admin.
  adminUsers: env('ADMIN_USERS', '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Enables POST /api/dev/chat so you can test commands without Kick. Never enable in production.
  devMode: bool('DEV_MODE', false),
};

module.exports = config;
