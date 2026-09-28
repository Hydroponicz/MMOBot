// Automatic daily database backups, kept next to the database (on the Railway volume), newest 7 by
// default. The admin page lists them, downloads them and restores one with a restart.
const fs = require('node:fs');
const path = require('node:path');

const NAME = /^mmobot-\d{4}-\d{2}-\d{2}-\d{4}\.db$/;
const DAY = 86_400_000;

function createBackups({ repo, config, logger = console, now = () => Date.now() }) {
  const dir = config.backupDir || (config.dbPath && config.dbPath !== ':memory:' ? path.join(path.dirname(config.dbPath), 'backups') : null);
  const keep = Math.max(1, config.backupKeep ?? 7);
  let timer = null;

  function list() {
    if (!dir || !fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => NAME.test(f))
      .map((name) => {
        const st = fs.statSync(path.join(dir, name));
        return { name, size: st.size, at: st.mtimeMs };
      })
      .sort((a, b) => b.at - a.at);
  }

  function run(reason = 'daily') {
    if (!dir) return null;
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date(now()).toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    const name = `mmobot-${stamp}.db`;
    const file = path.join(dir, name);
    fs.rmSync(file, { force: true });
    repo.backupTo(file);
    // Keep the newest few.
    for (const old of list().slice(keep)) fs.rmSync(path.join(dir, old.name), { force: true });
    logger.info(`[backup] ${reason} backup saved: ${name}`);
    return list().find((b) => b.name === name) || null;
  }

  // The full path of a backup, or null for anything that isn't one of ours (no path tricks).
  function file(name) {
    if (!dir || !NAME.test(String(name))) return null;
    const f = path.join(dir, name);
    return fs.existsSync(f) ? f : null;
  }

  // Copies a backup to <db>.restore; openDb swaps it in on the next start.
  function stageRestore(name) {
    const f = file(name);
    if (!f || config.dbPath === ':memory:') return false;
    fs.copyFileSync(f, `${config.dbPath}.restore`);
    return true;
  }

  // Checks every hour; makes a backup when the newest one is a day old (or there are none).
  function start() {
    if (!dir || timer) return;
    const check = () => {
      try {
        const newest = list()[0];
        if (!newest || now() - newest.at >= DAY) run('daily');
      } catch (err) {
        logger.error('[backup] automatic backup failed:', err.message);
      }
    };
    setTimeout(check, 60_000).unref?.();
    timer = setInterval(check, 3_600_000);
    timer.unref?.();
  }

  const stop = () => clearInterval(timer);

  return { dir, keep, list, run, file, stageRestore, start, stop };
}

module.exports = { createBackups };
