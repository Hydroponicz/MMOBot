const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { SKILL_IDS } = require('./game/skills');
const { CHARACTER_XP_CAP_PER_SKILL: CAP } = require('./game/xp');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kick_user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL,
  avatar_url TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  actions_count INTEGER NOT NULL DEFAULT 0,
  last_action_at INTEGER NOT NULL DEFAULT 0,
  last_chat_points_at INTEGER NOT NULL DEFAULT 0,
  has_logged_in INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username_lower);

CREATE TABLE IF NOT EXISTS skills (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, skill)
);
CREATE INDEX IF NOT EXISTS idx_skills_skill_xp ON skills(skill, xp DESC);

CREATE TABLE IF NOT EXISTS inventory (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, item)
);

-- Upgradable tools, e.g. slot "rod". Tier 0 (the starter tool) is implied when there's no row.
CREATE TABLE IF NOT EXISTS equipment (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, slot)
);

-- Weapons and armor a player is wearing (moved out of the backpack while equipped).
CREATE TABLE IF NOT EXISTS worn_gear (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  item TEXT NOT NULL,
  PRIMARY KEY (user_id, slot)
);

-- Farming: what's growing in each of a player's plots (the number of plots owned is in equipment, slot "plots").
CREATE TABLE IF NOT EXISTS farm_plots (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plot INTEGER NOT NULL,
  crop TEXT NOT NULL,
  planted_at INTEGER NOT NULL,
  ready_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, plot)
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  skill TEXT,
  item TEXT,
  xp INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity(user_id, id DESC);

-- Player market: items listed for a total price. The items are held here until sold or cancelled.
CREATE TABLE IF NOT EXISTS market_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  qty INTEGER NOT NULL,
  price INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_market_item ON market_listings(item);

-- Guilds: a bank of points, a weekly goal, members.
CREATE TABLE IF NOT EXISTS guilds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tag TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  bank INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  week INTEGER NOT NULL DEFAULT 0,
  week_actions INTEGER NOT NULL DEFAULT 0,
  week_done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS guild_members (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guild_members ON guild_members(guild_id);

-- Admin actions, with what's needed to undo them.
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  undo TEXT,
  created_at INTEGER NOT NULL,
  undone_at INTEGER,
  undone_by TEXT
);

-- Website notifications (market sales, pets, quests...). Things like "crops ready" are worked out live.
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id DESC);

-- Trading cards: every pulled card is its own row (wear and grade are per copy). status: owned,
-- listed (on the card market for price), bank (sold back to the bank; kept for serials and pop reports).
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card TEXT NOT NULL,
  finish TEXT NOT NULL,
  wear REAL NOT NULL,
  q TEXT NOT NULL,
  serial INTEGER NOT NULL,
  pack TEXT,
  status TEXT NOT NULL DEFAULT 'owned',
  price INTEGER,
  listed_at INTEGER,
  grade INTEGER,
  black INTEGER NOT NULL DEFAULT 0,
  sub TEXT,
  graded_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status, listed_at);
CREATE INDEX IF NOT EXISTS idx_cards_card ON cards(card, grade);

-- Card trade offers between two players: cards (and points) each way.
CREATE TABLE IF NOT EXISTS card_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  give TEXT NOT NULL,
  want TEXT NOT NULL,
  points_give INTEGER NOT NULL DEFAULT 0,
  points_want INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_trades_to ON card_trades(to_id, status);
CREATE INDEX IF NOT EXISTS idx_card_trades_from ON card_trades(from_id, status);

-- Relic cases: every unboxed relic is its own row (float, pattern seed, SoulTrak kills). status: owned,
-- listed (on the relic market for price), bank (sold back), used (spent in a trade-up contract).
CREATE TABLE IF NOT EXISTS relics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skin TEXT NOT NULL,
  float REAL NOT NULL,
  seed INTEGER NOT NULL,
  soul INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'case',
  status TEXT NOT NULL DEFAULT 'owned',
  price INTEGER,
  listed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relics_owner ON relics(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_relics_status ON relics(status, listed_at);
CREATE INDEX IF NOT EXISTS idx_relics_skin ON relics(skin);

-- Relic trade offers between two players: relics (and points) each way.
CREATE TABLE IF NOT EXISTS relic_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  give TEXT NOT NULL,
  want TEXT NOT NULL,
  points_give INTEGER NOT NULL DEFAULT 0,
  points_want INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relic_trades_to ON relic_trades(to_id, status);
CREATE INDEX IF NOT EXISTS idx_relic_trades_from ON relic_trades(from_id, status);

-- Player-to-player sales of cards and relics, used to nudge their shown value toward real prices.
-- ratio = price paid / the item's catalog value.
CREATE TABLE IF NOT EXISTS item_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  ratio REAL NOT NULL,
  price INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_item_sales ON item_sales(kind, key, created_at);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_messages (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
`;

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // A backup uploaded on the admin page waits here until the next start, then replaces the database.
  const restore = `${dbPath}.restore`;
  if (dbPath !== ':memory:' && fs.existsSync(restore)) {
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(f)) fs.renameSync(f, `${f}.before-restore`);
    fs.renameSync(restore, dbPath);
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return createRepo(db);
}

// Columns added after the first release. Safe to run on every start.
function migrate(db) {
  // Every player needs a row per skill, or XP for skills added later (Agility) isn't saved until
  // their next chat message creates it.
  const addSkill = db.prepare('INSERT OR IGNORE INTO skills (user_id, skill, xp) SELECT id, ?, 0 FROM users');
  for (const skill of SKILL_IDS) addSkill.run(skill);
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('last_farm_at')) db.exec('ALTER TABLE users ADD COLUMN last_farm_at INTEGER NOT NULL DEFAULT 0');
  // Health and mana: NULL means full. *_at is when the value was last written (regen counts from there).
  // ko_until: knocked out until this time (0 = not knocked out).
  if (!cols.includes('hp')) db.exec('ALTER TABLE users ADD COLUMN hp REAL');
  if (!cols.includes('hp_at')) db.exec('ALTER TABLE users ADD COLUMN hp_at INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('mana')) db.exec('ALTER TABLE users ADD COLUMN mana REAL');
  if (!cols.includes('mana_at')) db.exec('ALTER TABLE users ADD COLUMN mana_at INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('ko_until')) db.exec('ALTER TABLE users ADD COLUMN ko_until INTEGER NOT NULL DEFAULT 0');
  // banned: an admin took them out of the game. subscriber: had a sub badge on their last message.
  // season_xp: XP earned this season (seasonal leaderboard). title: the title they show.
  if (!cols.includes('banned')) db.exec('ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('subscriber')) db.exec('ALTER TABLE users ADD COLUMN subscriber INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('season_xp')) db.exec('ALTER TABLE users ADD COLUMN season_xp INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('title')) db.exec("ALTER TABLE users ADD COLUMN title TEXT NOT NULL DEFAULT ''");
  // Stamina charges: NULL means a full bar. stamina_at is when the bar started refilling (first charge used).
  if (!cols.includes('stamina')) db.exec('ALTER TABLE users ADD COLUMN stamina INTEGER');
  // Race and look: NULL = the random one picked from the player's id (see game/appearance.js).
  // race_changed_at: when they last picked a race on the website (limits race changes).
  if (!cols.includes('race')) db.exec('ALTER TABLE users ADD COLUMN race TEXT');
  if (!cols.includes('look')) db.exec('ALTER TABLE users ADD COLUMN look TEXT');
  if (!cols.includes('race_changed_at')) db.exec('ALTER TABLE users ADD COLUMN race_changed_at INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('last_seen_at')) db.exec('ALTER TABLE users ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('stamina_at')) db.exec('ALTER TABLE users ADD COLUMN stamina_at INTEGER NOT NULL DEFAULT 0');
  // Chat points taper: how many chat awards a player got on chat_day (YYYY-MM-DD).
  if (!cols.includes('chat_day')) db.exec("ALTER TABLE users ADD COLUMN chat_day TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('chat_awards')) db.exec('ALTER TABLE users ADD COLUMN chat_awards INTEGER NOT NULL DEFAULT 0');
}

function createRepo(db) {
  const stmt = {
    userByKickId: db.prepare('SELECT * FROM users WHERE kick_user_id = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByName: db.prepare('SELECT * FROM users WHERE username_lower = ? ORDER BY last_seen_at DESC LIMIT 1'),
    insertUser: db.prepare(
      `INSERT INTO users (kick_user_id, username, username_lower, avatar_url, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ),
    touchUser: db.prepare(
      'UPDATE users SET username = ?, username_lower = ?, avatar_url = COALESCE(?, avatar_url), last_seen_at = ? WHERE id = ?'
    ),
    insertSkill: db.prepare('INSERT OR IGNORE INTO skills (user_id, skill, xp) VALUES (?, ?, 0)'),
    skills: db.prepare('SELECT skill, xp FROM skills WHERE user_id = ?'),
    // An upsert, so XP is never lost if a player's row for a newer skill doesn't exist yet.
    addXp: db.prepare('INSERT INTO skills (user_id, skill, xp) VALUES (?2, ?3, ?1) ON CONFLICT(user_id, skill) DO UPDATE SET xp = xp + excluded.xp'),
    inventory: db.prepare('SELECT item, qty FROM inventory WHERE user_id = ? AND qty > 0 ORDER BY item'),
    itemQty: db.prepare('SELECT qty FROM inventory WHERE user_id = ? AND item = ?'),
    addItem: db.prepare(
      `INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?)
       ON CONFLICT(user_id, item) DO UPDATE SET qty = qty + excluded.qty`
    ),
    removeItem: db.prepare('UPDATE inventory SET qty = qty - ? WHERE user_id = ? AND item = ? AND qty >= ?'),
    cleanInventory: db.prepare('DELETE FROM inventory WHERE user_id = ? AND qty <= 0'),
    equipment: db.prepare('SELECT slot, tier FROM equipment WHERE user_id = ?'),
    setEquipment: db.prepare(
      `INSERT INTO equipment (user_id, slot, tier) VALUES (?, ?, ?)
       ON CONFLICT(user_id, slot) DO UPDATE SET tier = excluded.tier`
    ),
    worn: db.prepare('SELECT slot, item FROM worn_gear WHERE user_id = ?'),
    wear: db.prepare(
      `INSERT INTO worn_gear (user_id, slot, item) VALUES (?, ?, ?)
       ON CONFLICT(user_id, slot) DO UPDATE SET item = excluded.item`
    ),
    takeOff: db.prepare('DELETE FROM worn_gear WHERE user_id = ? AND slot = ?'),
    plots: db.prepare('SELECT plot, crop, planted_at, ready_at FROM farm_plots WHERE user_id = ? ORDER BY plot'),
    plant: db.prepare('INSERT INTO farm_plots (user_id, plot, crop, planted_at, ready_at) VALUES (?, ?, ?, ?, ?)'),
    clearPlot: db.prepare('DELETE FROM farm_plots WHERE user_id = ? AND plot = ?'),
    setFarmAt: db.prepare('UPDATE users SET last_farm_at = ? WHERE id = ?'),
    setVitals: db.prepare('UPDATE users SET hp = ?, hp_at = ?, mana = ?, mana_at = ?, ko_until = ? WHERE id = ?'),
    addPoints: db.prepare(
      'UPDATE users SET points = points + ?, lifetime_points = lifetime_points + MAX(?, 0) WHERE id = ?'
    ),
    chatTick: db.prepare('UPDATE users SET message_count = message_count + 1 WHERE id = ?'),
    setChatPointsAt: db.prepare('UPDATE users SET last_chat_points_at = ? WHERE id = ?'),
    setActionAt: db.prepare('UPDATE users SET last_action_at = ?, actions_count = actions_count + 1 WHERE id = ?'),
    setLoggedIn: db.prepare('UPDATE users SET has_logged_in = 1 WHERE id = ?'),
    insertActivity: db.prepare(
      'INSERT INTO activity (user_id, kind, skill, item, xp, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ),
    userActivity: db.prepare(
      `SELECT a.*, u.username FROM activity a JOIN users u ON u.id = a.user_id
       WHERE a.user_id = ? ORDER BY a.id DESC LIMIT ?`
    ),
    recentActivity: db.prepare(
      `SELECT a.*, u.username FROM activity a JOIN users u ON u.id = a.user_id
       WHERE a.id > ? ORDER BY a.id DESC LIMIT ?`
    ),
    pruneActivity: db.prepare('DELETE FROM activity WHERE created_at < ?'),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ),
    deleteSetting: db.prepare('DELETE FROM settings WHERE key = ?'),
    markProcessed: db.prepare('INSERT OR IGNORE INTO processed_messages (id, created_at) VALUES (?, ?)'),
    pruneProcessed: db.prepare('DELETE FROM processed_messages WHERE created_at < ?'),
    addLog: db.prepare('INSERT INTO logs (ts, level, source, message) VALUES (?, ?, ?, ?)'),
    pruneLogs: db.prepare('DELETE FROM logs WHERE ts < ? OR id <= (SELECT MAX(id) FROM logs) - 50000'),
    logSources: db.prepare('SELECT DISTINCT source FROM logs ORDER BY source'),
    searchUsers: db.prepare(
      `SELECT id, username, points, message_count, actions_count, last_seen_at, banned, race, race_changed_at FROM users
       WHERE username_lower LIKE ? ESCAPE '\\' ORDER BY last_seen_at DESC LIMIT 25`
    ),
    totals: db.prepare(
      `SELECT (SELECT COUNT(*) FROM users) AS players,
              (SELECT COALESCE(SUM(actions_count), 0) FROM users) AS actions,
              (SELECT COALESCE(SUM(xp), 0) FROM skills) AS xp`
    ),
  };

  const leaderboardBySkill = db.prepare(
    `SELECT u.id, u.username, u.avatar_url, s.xp FROM skills s JOIN users u ON u.id = s.user_id
     WHERE s.skill = ? AND s.xp > 0 ORDER BY s.xp DESC, u.id ASC LIMIT ? OFFSET ?`
  );
  const leaderboardOverall = db.prepare(
    // Ranked like character level: each skill counts up to the character XP cap.
    `SELECT u.id, u.username, u.avatar_url, SUM(s.xp) AS xp, SUM(MIN(s.xp, ${CAP})) AS char_xp
     FROM skills s JOIN users u ON u.id = s.user_id
     GROUP BY u.id HAVING SUM(s.xp) > 0 ORDER BY char_xp DESC, xp DESC, u.id ASC LIMIT ? OFFSET ?`
  );
  const leaderboardPoints = db.prepare(
    `SELECT id, username, avatar_url, points FROM users WHERE points > 0
     ORDER BY points DESC, id ASC LIMIT ? OFFSET ?`
  );
  const rankBySkill = db.prepare(
    `SELECT COUNT(*) + 1 AS rank FROM skills WHERE skill = ? AND xp > (SELECT xp FROM skills WHERE user_id = ? AND skill = ?)`
  );
  const rankOverall = db.prepare(
    `WITH t AS (SELECT user_id, SUM(MIN(xp, ${CAP})) AS c, SUM(xp) AS x FROM skills GROUP BY user_id),
          me AS (SELECT c, x FROM t WHERE user_id = ?)
     SELECT COUNT(*) + 1 AS rank FROM t, me WHERE t.c > me.c OR (t.c = me.c AND t.x > me.x)`
  );

  const repo = {
    raw: db,

    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    // Find or create a player from their Kick identity. Chatters get a character automatically;
    // logging in on the website later links to the same row via kick_user_id.
    upsertUser({ kickUserId, username, avatarUrl = null }) {
      const now = Date.now();
      const kid = String(kickUserId);
      let user = stmt.userByKickId.get(kid);
      if (!user) {
        stmt.insertUser.run(kid, username, username.toLowerCase(), avatarUrl, now, now);
        user = stmt.userByKickId.get(kid);
      } else {
        stmt.touchUser.run(username, username.toLowerCase(), avatarUrl, now, user.id);
        user = stmt.userById.get(user.id);
      }
      for (const skill of SKILL_IDS) stmt.insertSkill.run(user.id, skill);
      return user;
    },

    getUser: (id) => stmt.userById.get(id) || null,
    getUserByKickId: (kid) => stmt.userByKickId.get(String(kid)) || null,
    getUserByName: (name) => stmt.userByName.get(String(name).toLowerCase().replace(/^@/, '')) || null,

    getSkills(userId) {
      const out = Object.fromEntries(SKILL_IDS.map((s) => [s, 0]));
      for (const row of stmt.skills.all(userId)) if (row.skill in out) out[row.skill] = row.xp;
      return out;
    },
    addXp: (userId, skill, xp) => stmt.addXp.run(xp, userId, skill),

    getInventory(userId) {
      return Object.fromEntries(stmt.inventory.all(userId).map((r) => [r.item, r.qty]));
    },
    itemQty: (userId, item) => stmt.itemQty.get(userId, item)?.qty || 0,
    addItem: (userId, item, qty = 1) => stmt.addItem.run(userId, item, qty),
    removeItem(userId, item, qty = 1) {
      const res = stmt.removeItem.run(qty, userId, item, qty);
      if (res.changes === 0) throw new Error(`not enough ${item}`);
      stmt.cleanInventory.run(userId);
    },

    getEquipment(userId) {
      return Object.fromEntries(stmt.equipment.all(userId).map((r) => [r.slot, r.tier]));
    },
    setEquipment: (userId, slot, tier) => stmt.setEquipment.run(userId, slot, tier),

    getWorn(userId) {
      return Object.fromEntries(stmt.worn.all(userId).map((r) => [r.slot, r.item]));
    },
    wear: (userId, slot, item) => stmt.wear.run(userId, slot, item),
    takeOff: (userId, slot) => stmt.takeOff.run(userId, slot),

    getPlots: (userId) => stmt.plots.all(userId),
    plant: (userId, plot, crop, plantedAt, readyAt) => stmt.plant.run(userId, plot, crop, plantedAt, readyAt),
    clearPlot: (userId, plot) => stmt.clearPlot.run(userId, plot),
    setFarmAt: (userId, ts) => stmt.setFarmAt.run(ts, userId),
    setAppearance: (userId, race, look, raceChangedAt) =>
      db.prepare('UPDATE users SET race = ?, look = ?, race_changed_at = ? WHERE id = ?').run(race, JSON.stringify(look), raceChangedAt, userId),
    // Guilds
    guildCreate(name, tag, ownerId, ts) {
      const id = Number(db.prepare('INSERT INTO guilds (name, tag, owner_id, created_at) VALUES (?, ?, ?, ?)').run(name, tag, ownerId, ts).lastInsertRowid);
      db.prepare("INSERT INTO guild_members (user_id, guild_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(ownerId, id, ts);
      return id;
    },
    guildGet: (id) => db.prepare('SELECT * FROM guilds WHERE id = ?').get(id) || null,
    guildByName: (name) => db.prepare('SELECT * FROM guilds WHERE name = ?').get(name) || null,
    guildOf: (userId) => db.prepare('SELECT g.* FROM guilds g JOIN guild_members m ON m.guild_id = g.id WHERE m.user_id = ?').get(userId) || null,
    guildMembers: (guildId) =>
      db
        .prepare(
          `SELECT m.user_id, m.role, m.joined_at, u.username, u.season_xp,
             (SELECT COALESCE(SUM(xp), 0) FROM skills WHERE user_id = m.user_id) AS xp
           FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = ? ORDER BY xp DESC`
        )
        .all(guildId),
    guildJoin: (userId, guildId, ts, role = 'member') => db.prepare('INSERT INTO guild_members (user_id, guild_id, role, joined_at) VALUES (?, ?, ?, ?)').run(userId, guildId, role, ts),
    guildLeave: (userId) => db.prepare('DELETE FROM guild_members WHERE user_id = ?').run(userId),
    guildDelete(id) {
      db.prepare('DELETE FROM guild_members WHERE guild_id = ?').run(id);
      db.prepare('DELETE FROM guilds WHERE id = ?').run(id);
    },
    guildSet(id, field, value) {
      if (!['bank', 'owner_id', 'week', 'week_actions', 'week_done'].includes(field)) throw new Error(`can't set guilds.${field}`);
      db.prepare(`UPDATE guilds SET ${field} = ? WHERE id = ?`).run(value, id);
    },
    guildSetRole: (userId, role) => db.prepare('UPDATE guild_members SET role = ? WHERE user_id = ?').run(role, userId),
    guildList: () =>
      db
        .prepare(
          `SELECT g.*, COUNT(m.user_id) AS members, COALESCE(SUM(u.season_xp), 0) AS season_xp,
             (SELECT COALESCE(SUM(s.xp), 0) FROM skills s JOIN guild_members m2 ON m2.user_id = s.user_id WHERE m2.guild_id = g.id) AS xp
           FROM guilds g LEFT JOIN guild_members m ON m.guild_id = g.id LEFT JOIN users u ON u.id = m.user_id
           GROUP BY g.id ORDER BY xp DESC`
        )
        .all(),
    // Market
    marketAdd: (sellerId, item, qty, price, ts) =>
      Number(db.prepare('INSERT INTO market_listings (seller_id, item, qty, price, created_at) VALUES (?, ?, ?, ?, ?)').run(sellerId, item, qty, price, ts).lastInsertRowid),
    marketGet: (id) => db.prepare('SELECT * FROM market_listings WHERE id = ?').get(id) || null,
    marketDelete: (id) => db.prepare('DELETE FROM market_listings WHERE id = ?').run(id).changes,
    marketList: ({ sellerId = null, limit = 200 } = {}) =>
      db
        .prepare(
          `SELECT m.*, u.username AS seller FROM market_listings m JOIN users u ON u.id = m.seller_id
           WHERE (? IS NULL OR m.seller_id = ?) ORDER BY m.id DESC LIMIT ?`
        )
        .all(sellerId, sellerId, limit),
    marketCount: (sellerId) => db.prepare('SELECT COUNT(*) AS n FROM market_listings WHERE seller_id = ?').get(sellerId).n,
    // Trading cards
    cardInsert(ownerId, { card, finish, wear, q }, pack, ts) {
      const serial = db.prepare('SELECT COALESCE(MAX(serial), 0) + 1 AS n FROM cards WHERE card = ?').get(card).n;
      return Number(
        db.prepare('INSERT INTO cards (owner_id, card, finish, wear, q, serial, pack, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(ownerId, card, finish, wear, JSON.stringify(q), serial, pack, ts).lastInsertRowid
      );
    },
    cardGet: (id) => db.prepare('SELECT * FROM cards WHERE id = ?').get(id) || null,
    cardsOf: (ownerId) => db.prepare("SELECT * FROM cards WHERE owner_id = ? AND status IN ('owned', 'listed') ORDER BY id DESC").all(ownerId),
    cardUpdate(id, fields) {
      const allowed = ['owner_id', 'status', 'price', 'listed_at', 'grade', 'black', 'sub', 'graded_at'];
      const keys = Object.keys(fields).filter((k) => allowed.includes(k));
      if (!keys.length) return 0;
      return db.prepare(`UPDATE cards SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id).changes;
    },
    cardListings: (limit = 300) =>
      db.prepare("SELECT c.*, u.username AS owner FROM cards c JOIN users u ON u.id = c.owner_id WHERE c.status = 'listed' ORDER BY c.listed_at DESC LIMIT ?").all(limit),
    cardListingCount: (ownerId) => db.prepare("SELECT COUNT(*) AS n FROM cards WHERE owner_id = ? AND status = 'listed'").get(ownerId).n,
    cardRecent: (limit = 400) => db.prepare('SELECT c.*, u.username AS owner FROM cards c JOIN users u ON u.id = c.owner_id ORDER BY c.id DESC LIMIT ?').all(limit),
    cardRecentGraded: (limit = 20) =>
      db.prepare('SELECT c.*, u.username AS owner FROM cards c JOIN users u ON u.id = c.owner_id WHERE c.grade IS NOT NULL ORDER BY c.graded_at DESC LIMIT ?').all(limit),
    cardPop: (card) => db.prepare('SELECT grade, black, finish, COUNT(*) AS n FROM cards WHERE card = ? AND grade IS NOT NULL GROUP BY grade, black, finish').all(card),
    cardPulled: (card) => db.prepare('SELECT COUNT(*) AS n FROM cards WHERE card = ?').get(card).n,
    cardsActive: () => db.prepare("SELECT c.owner_id, c.card, c.finish, c.wear, c.grade, c.black, u.username FROM cards c JOIN users u ON u.id = c.owner_id WHERE c.status IN ('owned', 'listed') AND u.banned = 0").all(),
    cardTradeAdd: ({ fromId, toId, give, want, pointsGive, pointsWant, message }, ts) =>
      Number(
        db
          .prepare('INSERT INTO card_trades (from_id, to_id, give, want, points_give, points_want, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(fromId, toId, JSON.stringify(give), JSON.stringify(want), pointsGive, pointsWant, message, ts, ts).lastInsertRowid
      ),
    cardTradeGet: (id) => db.prepare('SELECT * FROM card_trades WHERE id = ?').get(id) || null,
    cardTradeSet: (id, status, ts) => db.prepare("UPDATE card_trades SET status = ?, updated_at = ? WHERE id = ? AND status = 'open'").run(status, ts, id).changes,
    cardTradesFor: (userId, limit = 40) =>
      db
        .prepare(
          `SELECT t.*, f.username AS from_name, o.username AS to_name FROM card_trades t
           JOIN users f ON f.id = t.from_id JOIN users o ON o.id = t.to_id
           WHERE t.from_id = ? OR t.to_id = ? ORDER BY t.status = 'open' DESC, t.id DESC LIMIT ?`
        )
        .all(userId, userId, limit),
    cardTradesOpenFrom: (userId) => db.prepare("SELECT COUNT(*) AS n FROM card_trades WHERE from_id = ? AND status = 'open'").get(userId).n,
    cardTradesExpire: (before, ts) => db.prepare("UPDATE card_trades SET status = 'expired', updated_at = ? WHERE status = 'open' AND created_at < ?").run(ts, before).changes,

    // Relic cases
    relicInsert: (ownerId, { skin, float, seed, soul }, origin, ts) =>
      Number(db.prepare('INSERT INTO relics (owner_id, skin, float, seed, soul, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(ownerId, skin, float, seed, soul ? 1 : 0, origin, ts).lastInsertRowid),
    relicGet: (id) => db.prepare('SELECT * FROM relics WHERE id = ?').get(id) || null,
    relicsOf: (ownerId) => db.prepare("SELECT * FROM relics WHERE owner_id = ? AND status IN ('owned', 'listed') ORDER BY id DESC").all(ownerId),
    relicUpdate(id, fields) {
      const allowed = ['owner_id', 'status', 'price', 'listed_at', 'kills'];
      const keys = Object.keys(fields).filter((k) => allowed.includes(k));
      if (!keys.length) return 0;
      return db.prepare(`UPDATE relics SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id).changes;
    },
    relicAddKill: (id) => db.prepare('UPDATE relics SET kills = kills + 1 WHERE id = ?').run(id).changes,
    relicListings: (limit = 300) =>
      db.prepare("SELECT r.*, u.username AS owner FROM relics r JOIN users u ON u.id = r.owner_id WHERE r.status = 'listed' ORDER BY r.listed_at DESC LIMIT ?").all(limit),
    relicListingCount: (ownerId) => db.prepare("SELECT COUNT(*) AS n FROM relics WHERE owner_id = ? AND status = 'listed'").get(ownerId).n,
    relicRecent: (limit = 400) => db.prepare("SELECT r.*, u.username AS owner FROM relics r JOIN users u ON u.id = r.owner_id WHERE r.origin IN ('case', 'tradeup') ORDER BY r.id DESC LIMIT ?").all(limit),
    relicUnboxed: (skin) => db.prepare('SELECT COUNT(*) AS n FROM relics WHERE skin = ?').get(skin).n,
    relicsActive: () =>
      db.prepare("SELECT r.owner_id, r.skin, r.float, r.seed, r.soul, u.username FROM relics r JOIN users u ON u.id = r.owner_id WHERE r.status IN ('owned', 'listed') AND u.banned = 0").all(),
    relicTradeAdd: ({ fromId, toId, give, want, pointsGive, pointsWant, message }, ts) =>
      Number(
        db
          .prepare('INSERT INTO relic_trades (from_id, to_id, give, want, points_give, points_want, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(fromId, toId, JSON.stringify(give), JSON.stringify(want), pointsGive, pointsWant, message, ts, ts).lastInsertRowid
      ),
    relicTradeGet: (id) => db.prepare('SELECT * FROM relic_trades WHERE id = ?').get(id) || null,
    relicTradeSet: (id, status, ts) => db.prepare("UPDATE relic_trades SET status = ?, updated_at = ? WHERE id = ? AND status = 'open'").run(status, ts, id).changes,
    relicTradesFor: (userId, limit = 40) =>
      db
        .prepare(
          `SELECT t.*, f.username AS from_name, o.username AS to_name FROM relic_trades t
           JOIN users f ON f.id = t.from_id JOIN users o ON o.id = t.to_id
           WHERE t.from_id = ? OR t.to_id = ? ORDER BY t.status = 'open' DESC, t.id DESC LIMIT ?`
        )
        .all(userId, userId, limit),
    relicTradesOpenFrom: (userId) => db.prepare("SELECT COUNT(*) AS n FROM relic_trades WHERE from_id = ? AND status = 'open'").get(userId).n,
    relicTradesExpire: (before, ts) => db.prepare("UPDATE relic_trades SET status = 'expired', updated_at = ? WHERE status = 'open' AND created_at < ?").run(ts, before).changes,

    // Card and relic sales between players (market values)
    saleAdd: ({ kind, key, ratio, price, buyerId, sellerId }, ts) =>
      db.prepare('INSERT INTO item_sales (kind, key, ratio, price, buyer_id, seller_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(kind, key, ratio, price, buyerId, sellerId, ts),
    salesFor: (kind, key, since, limit = 15) =>
      db.prepare('SELECT ratio, price, buyer_id, seller_id, created_at FROM item_sales WHERE kind = ? AND key = ? AND created_at >= ? ORDER BY id DESC LIMIT ?').all(kind, key, since, limit),
    salesPrune: (before) => db.prepare('DELETE FROM item_sales WHERE created_at < ?').run(before),
    setChatDay: (userId, day, awards) => db.prepare('UPDATE users SET chat_day = ?, chat_awards = ? WHERE id = ?').run(day, awards, userId),

    // Notifications
    addNotification: (userId, text, ts) => db.prepare('INSERT INTO notifications (user_id, text, created_at) VALUES (?, ?, ?)').run(userId, text, ts),
    notifications: (userId, limit = 20) => db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit),
    readNotifications: (userId) => db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId),
    pruneNotifications: (before) => db.prepare('DELETE FROM notifications WHERE created_at < ?').run(before),
    setLastSeen: (userId, ts) => db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(ts, userId),
    setStamina: (userId, stamina, at) => db.prepare('UPDATE users SET stamina = ?, stamina_at = ? WHERE id = ?').run(stamina, at, userId),
    // Simple per-player fields (whitelisted, so the column name is never user input).
    // Lets every player of a race pick a new race right away (used when a race's perks change).
    resetRaceWaitFor(race) {
      return db.prepare('UPDATE users SET race_changed_at = 0 WHERE race = ?').run(race).changes;
    },
    setUserField(userId, field, value) {
      if (!['banned', 'subscriber', 'title'].includes(field)) throw new Error(`can't set users.${field}`);
      db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(value, userId);
    },
    addSeasonXp: (userId, xp) => db.prepare('UPDATE users SET season_xp = season_xp + ? WHERE id = ?').run(xp, userId),
    resetSeason: () => db.prepare('UPDATE users SET season_xp = 0').run(),
    seasonRank: (xp) => db.prepare('SELECT COUNT(*) + 1 AS r FROM users WHERE season_xp > ? AND banned = 0').get(xp).r,
    seasonLeaders: (limit = 10) =>
      db.prepare('SELECT id, username, avatar_url, season_xp FROM users WHERE season_xp > 0 AND banned = 0 ORDER BY season_xp DESC LIMIT ?').all(limit),
    // A copy of everything resetPlayer wipes (plus the given settings keys), so a reset can be undone.
    snapshotPlayer(userId, settingKeys = []) {
      const all = (sql) => db.prepare(sql).all(userId);
      return {
        user: db.prepare('SELECT points, hp, hp_at, mana, mana_at, ko_until, stamina, stamina_at, season_xp, title FROM users WHERE id = ?').get(userId),
        skills: all('SELECT skill, xp FROM skills WHERE user_id = ?'),
        inventory: all('SELECT item, qty FROM inventory WHERE user_id = ?'),
        equipment: all('SELECT slot, tier FROM equipment WHERE user_id = ?'),
        worn: all('SELECT slot, item FROM worn_gear WHERE user_id = ?'),
        plots: all('SELECT plot, crop, planted_at, ready_at FROM farm_plots WHERE user_id = ?'),
        cards: all("SELECT * FROM cards WHERE owner_id = ? AND status IN ('owned', 'listed')"),
        relics: all("SELECT * FROM relics WHERE owner_id = ? AND status IN ('owned', 'listed')"),
        settings: Object.fromEntries(settingKeys.map((k) => [k, stmt.getSetting.get(k)?.value ?? null])),
      };
    },
    restorePlayer(userId, snap) {
      for (const t of ['inventory', 'equipment', 'worn_gear', 'farm_plots']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
      for (const r of snap.skills) db.prepare('UPDATE skills SET xp = ? WHERE user_id = ? AND skill = ?').run(r.xp, userId, r.skill);
      for (const r of snap.inventory) db.prepare('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?)').run(userId, r.item, r.qty);
      for (const r of snap.equipment) db.prepare('INSERT INTO equipment (user_id, slot, tier) VALUES (?, ?, ?)').run(userId, r.slot, r.tier);
      for (const r of snap.worn) db.prepare('INSERT INTO worn_gear (user_id, slot, item) VALUES (?, ?, ?)').run(userId, r.slot, r.item);
      for (const r of snap.plots) db.prepare('INSERT INTO farm_plots (user_id, plot, crop, planted_at, ready_at) VALUES (?, ?, ?, ?, ?)').run(userId, r.plot, r.crop, r.planted_at, r.ready_at);
      for (const r of snap.relics || []) {
        db.prepare("UPDATE relics SET owner_id = ?, status = ?, price = ?, listed_at = ? WHERE id = ? AND (owner_id = ? OR status = 'bank')").run(userId, r.status, r.price, r.listed_at, r.id, userId);
      }
      // Cards taken by a reset come back (unless someone else owns them by now).
      for (const r of snap.cards || []) {
        db.prepare("UPDATE cards SET owner_id = ?, status = ?, price = ?, listed_at = ? WHERE id = ? AND (owner_id = ? OR status = 'bank')").run(userId, r.status, r.price, r.listed_at, r.id, userId);
      }
      const u = snap.user;
      db.prepare('UPDATE users SET points = ?, hp = ?, hp_at = ?, mana = ?, mana_at = ?, ko_until = ?, stamina = ?, stamina_at = ?, season_xp = ?, title = ? WHERE id = ?').run(
        u.points, u.hp, u.hp_at, u.mana, u.mana_at, u.ko_until, u.stamina, u.stamina_at, u.season_xp, u.title, userId
      );
      for (const [k, v] of Object.entries(snap.settings || {})) {
        if (v === null) db.prepare('DELETE FROM settings WHERE key = ?').run(k);
        else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
      }
    },
    // Admin audit log
    addAudit: ({ admin, action, summary, undo = null }, ts) =>
      Number(db.prepare('INSERT INTO admin_audit (admin, action, summary, undo, created_at) VALUES (?, ?, ?, ?, ?)').run(admin, action, summary, undo ? JSON.stringify(undo) : null, ts).lastInsertRowid),
    audits: (limit = 100) => db.prepare('SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?').all(limit),
    getAudit: (id) => db.prepare('SELECT * FROM admin_audit WHERE id = ?').get(id) || null,
    markUndone: (id, by, ts) => db.prepare('UPDATE admin_audit SET undone_at = ?, undone_by = ? WHERE id = ?').run(ts, by, id),
    // Everything a player owns and has done, for admin resets and the economy page.
    resetPlayer(userId) {
      for (const sql of [
        'UPDATE skills SET xp = 0 WHERE user_id = ?',
        'DELETE FROM inventory WHERE user_id = ?',
        'DELETE FROM equipment WHERE user_id = ?',
        'DELETE FROM worn_gear WHERE user_id = ?',
        'DELETE FROM farm_plots WHERE user_id = ?',
        "UPDATE cards SET status = 'bank', price = NULL WHERE owner_id = ? AND status IN ('owned', 'listed')",
        "UPDATE card_trades SET status = 'cancelled' WHERE status = 'open' AND (from_id = ?1 OR to_id = ?1)",
        "UPDATE relics SET status = 'bank', price = NULL WHERE owner_id = ? AND status IN ('owned', 'listed')",
        "UPDATE relic_trades SET status = 'cancelled' WHERE status = 'open' AND (from_id = ?1 OR to_id = ?1)",
        "UPDATE users SET points = 0, hp = NULL, mana = NULL, ko_until = 0, stamina = NULL, season_xp = 0, title = '' WHERE id = ?",
      ]) db.prepare(sql).run(userId);
    },
    economyTotals: () =>
      db.prepare('SELECT COUNT(*) AS players, COALESCE(SUM(points), 0) AS points, COALESCE(SUM(lifetime_points), 0) AS lifetime FROM users WHERE banned = 0').get(),
    topEarners: (limit = 10) => db.prepare('SELECT id, username, points, lifetime_points FROM users ORDER BY lifetime_points DESC LIMIT ?').all(limit),
    backupTo: (file) => db.exec(`VACUUM INTO '${String(file).replace(/'/g, "''")}'`),
    setVitals: (userId, { hp, mana, koUntil }, ts) => stmt.setVitals.run(hp, ts, mana, ts, koUntil, userId),

    addPoints: (userId, amount) => stmt.addPoints.run(amount, amount, userId),
    chatTick: (userId) => stmt.chatTick.run(userId),
    setChatPointsAt: (userId, ts) => stmt.setChatPointsAt.run(ts, userId),
    setActionAt: (userId, ts) => stmt.setActionAt.run(ts, userId),
    setLoggedIn: (userId) => stmt.setLoggedIn.run(userId),

    logActivity({ userId, kind, skill = null, item = null, xp = 0, text }) {
      const res = stmt.insertActivity.run(userId, kind, skill, item, xp, text, Date.now());
      return Number(res.lastInsertRowid);
    },
    userActivity: (userId, limit = 20) => stmt.userActivity.all(userId, limit),
    recentActivity: (afterId = 0, limit = 30) => stmt.recentActivity.all(afterId, limit),

    leaderboard(kind, limit = 25, offset = 0) {
      if (kind === 'points') return leaderboardPoints.all(limit, offset);
      if (kind === 'season') {
        return db
          .prepare('SELECT id, username, avatar_url, season_xp AS xp FROM users WHERE season_xp > 0 AND banned = 0 ORDER BY season_xp DESC LIMIT ? OFFSET ?')
          .all(limit, offset);
      }
      if (kind === 'overall') return leaderboardOverall.all(limit, offset);
      if (!SKILL_IDS.includes(kind)) return [];
      return leaderboardBySkill.all(kind, limit, offset);
    },
    rank(userId, kind) {
      if (kind === 'overall') return rankOverall.get(userId).rank;
      return rankBySkill.get(kind, userId, kind).rank;
    },
    totals: () => stmt.totals.get(),

    getSetting(key) {
      const row = stmt.getSetting.get(key);
      return row ? JSON.parse(row.value) : null;
    },
    setSetting: (key, value) => stmt.setSetting.run(key, JSON.stringify(value)),
    deleteSetting: (key) => stmt.deleteSetting.run(key),

    // Returns true the first time a message id is seen (Kick may redeliver webhooks).
    markProcessed(id) {
      return stmt.markProcessed.run(String(id), Date.now()).changes > 0;
    },

    addLog: ({ level, source, message }) => stmt.addLog.run(Date.now(), level, source, message),

    // Newest first. Filters: level ('error' | 'warn' | 'info'), source, text search, before (id, for paging).
    logs({ level, source, q, before, limit = 200 } = {}) {
      const where = [];
      const params = [];
      if (level === 'error') where.push("level = 'error'");
      else if (level === 'warn') where.push("level IN ('warn', 'error')");
      if (source) {
        where.push('source = ?');
        params.push(source);
      }
      if (q) {
        where.push("message LIKE ? ESCAPE '\\'");
        params.push(`%${String(q).replace(/[\\%_]/g, (c) => '\\' + c)}%`);
      }
      if (before) {
        where.push('id < ?');
        params.push(Number(before));
      }
      const sql = `SELECT * FROM logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
      return db.prepare(sql).all(...params, Math.min(Math.max(Number(limit) || 200, 1), 1000));
    },
    logSources: () => stmt.logSources.all().map((r) => r.source),

    searchUsers(q) {
      const term = String(q || '').toLowerCase().replace(/^@/, '').replace(/[\\%_]/g, (c) => '\\' + c);
      return stmt.searchUsers.all(`%${term}%`);
    },

    prune() {
      const day = 24 * 60 * 60 * 1000;
      stmt.pruneProcessed.run(Date.now() - day);
      stmt.pruneActivity.run(Date.now() - 30 * day);
      stmt.pruneLogs.run(Date.now() - 14 * day);
    },

    close: () => db.close(),
  };
  return repo;
}

module.exports = { openDb };
