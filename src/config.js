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
const num = (name, fallback) => Number.parseFloat(env(name, String(fallback)));
const bool = (name, fallback) => ['1', 'true', 'yes', 'on'].includes(String(env(name, fallback)).toLowerCase());

// Railway injects these automatically: RAILWAY_PUBLIC_DOMAIN once you generate a domain,
// RAILWAY_VOLUME_MOUNT_PATH once you attach a volume.
const volumePath = env('RAILWAY_VOLUME_MOUNT_PATH', '');
const onRailway = Boolean(env('RAILWAY_ENVIRONMENT', '') || env('RAILWAY_PROJECT_ID', ''));

// The site's public address. PUBLIC_URL wins (set it to your own domain), then the older BASE_URL,
// then Railway's generated domain, then localhost. A bare domain gets https:// (http:// for localhost).
function normalizePublicUrl(value) {
  let url = String(value || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `${/^(localhost|127\.0\.0\.1)(:|$)/i.test(url) ? 'http' : 'https'}://${url}`;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}
function resolvePublicUrl(vars) {
  for (const name of ['PUBLIC_URL', 'BASE_URL']) {
    if (!vars[name]) continue;
    const url = normalizePublicUrl(vars[name]);
    if (url) return { url, source: name };
    console.warn(`[config] ${name}="${vars[name]}" isn't a valid URL, ignoring it`);
  }
  if (vars.RAILWAY_PUBLIC_DOMAIN) return { url: `https://${vars.RAILWAY_PUBLIC_DOMAIN}`, source: 'RAILWAY_PUBLIC_DOMAIN' };
  return { url: `http://localhost:${vars.PORT || 3000}`, source: 'default' };
}
const publicUrl = resolvePublicUrl(process.env);

const config = {
  port: int('PORT', 3000),
  // Public URL of the site, no trailing slash. Used for the Kick login redirect, webhook URL and
  // every link the bot posts. Set PUBLIC_URL to use your own domain.
  baseUrl: publicUrl.url,
  baseUrlSource: publicUrl.source,
  // Optional: when empty a random secret is generated once and stored in the database.
  sessionSecret: env('SESSION_SECRET', ''),
  dbPath: env('DB_PATH', path.join(volumePath || path.join(__dirname, '..', 'data'), 'mmobot.db')),
  // Daily backups go next to the database unless BACKUP_DIR is set; the newest BACKUP_KEEP are kept.
  backupDir: env('BACKUP_DIR', ''),
  backupKeep: int('BACKUP_KEEP', 7),
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
    // Stamina: every game action uses a charge; the bar refills to full staminaMinutes after the first use.
    staminaMax: int('STAMINA_MAX', 3),
    staminaMinutes: num('STAMINA_MINUTES', 5),
    // Races: perks on/off and days between race changes.
    racePerks: bool('RACE_PERKS', true),
    raceChangeDays: int('RACE_CHANGE_DAYS', 30),
    hpRegenHours: int('HP_REGEN_HOURS', 24),
    manaRegenHours: int('MANA_REGEN_HOURS', 1),
    // Points for chatting: awarded at most once per chatCooldown seconds per user.
    chatPoints: int('CHAT_POINTS', 5),
    chatCooldown: int('CHAT_POINTS_COOLDOWN_SECONDS', 60),
    // Full chat points for this many awards a day, then half (0 = always full).
    chatPointsFullPerDay: int('CHAT_POINTS_FULL_PER_DAY', 30),
    // +1 item per gathering action every this many levels (0 = off).
    gatherBonusLevels: int('GATHER_BONUS_LEVELS', 50),
    // !collect (gathering stations) gives this times the XP of gathering by hand, and no items or points.
    stationXpBonus: num('STATION_XP_BONUS', 1.2),
    // Agility: stamina refills this much faster per level, up to the max; chance a lap is free.
    agilityRefillPerLevel: num('AGILITY_REFILL_PER_LEVEL', 0.001),
    agilityRefillMax: num('AGILITY_REFILL_MAX', 0.5),
    agilityShortcutChance: num('AGILITY_SHORTCUT_CHANCE', 0.05),
    // Sell prices drop as the channel sells an item (0 = fixed prices), recovering by half every few hours.
    priceSupplyScale: int('PRICE_SUPPLY_SCALE', 25000),
    priceRecoveryHours: num('PRICE_RECOVERY_HOURS', 6),
    priceFloor: num('PRICE_FLOOR', 0.35),
    // Whether the bot replies in chat to every command.
    replyInChat: bool('REPLY_IN_CHAT', true),
    // Casino (points only). Min/max bet (0 = no max) and seconds between bets per viewer.
    casinoEnabled: bool('CASINO_ENABLED', true),
    casinoMinBet: int('CASINO_MIN_BET', 10),
    casinoMaxBet: int('CASINO_MAX_BET', 0),
    casinoCooldown: int('CASINO_COOLDOWN_SECONDS', 5),
    // The bank (card and relic sell-backs): most points per player per day, and the item value up to
    // which it pays the full buyback rate (a fifth of the rate above). 0 turns either off.
    bankDailyLimit: int('BANK_DAILY_LIMIT', 25000),
    bankFullValue: int('BANK_FULL_VALUE', 5000),
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
module.exports.normalizePublicUrl = normalizePublicUrl;
module.exports.resolvePublicUrl = resolvePublicUrl;
