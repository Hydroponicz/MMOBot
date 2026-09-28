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
    addXp: db.prepare('UPDATE skills SET xp = xp + ? WHERE user_id = ? AND skill = ?'),
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
      `SELECT id, username, points, message_count, actions_count, last_seen_at, banned FROM users
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
    // Simple per-player fields (whitelisted, so the column name is never user input).
    setUserField(userId, field, value) {
      if (!['banned', 'subscriber', 'title'].includes(field)) throw new Error(`can't set users.${field}`);
      db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(value, userId);
    },
    addSeasonXp: (userId, xp) => db.prepare('UPDATE users SET season_xp = season_xp + ? WHERE id = ?').run(xp, userId),
    resetSeason: () => db.prepare('UPDATE users SET season_xp = 0').run(),
    seasonLeaders: (limit = 10) =>
      db.prepare('SELECT id, username, avatar_url, season_xp FROM users WHERE season_xp > 0 AND banned = 0 ORDER BY season_xp DESC LIMIT ?').all(limit),
    // Everything a player owns and has done, for admin resets and the economy page.
    resetPlayer(userId) {
      for (const sql of [
        'UPDATE skills SET xp = 0 WHERE user_id = ?',
        'DELETE FROM inventory WHERE user_id = ?',
        'DELETE FROM equipment WHERE user_id = ?',
        'DELETE FROM worn_gear WHERE user_id = ?',
        'DELETE FROM farm_plots WHERE user_id = ?',
        "UPDATE users SET points = 0, hp = NULL, mana = NULL, ko_until = 0, season_xp = 0, title = '' WHERE id = ?",
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
