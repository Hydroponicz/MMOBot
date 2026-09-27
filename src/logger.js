// Logger that writes to the console (Railway's log view) and to the database, so recent logs can be
// browsed and filtered on the admin page. Messages starting with a "[source]" tag are grouped by it.
const util = require('node:util');

function createLogger({ repo, echo = console } = {}) {
  const write = (level) => (...args) => {
    echo[level === 'info' ? 'log' : level](...args);
    if (!repo) return;
    let message = args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : util.inspect(a, { depth: 3 }))).join(' ');
    let source = 'server';
    const m = message.match(/^\s*\[([\w-]+)\]\s*/);
    if (m) {
      source = m[1];
      message = message.slice(m[0].length);
    }
    try {
      repo.addLog({ level, source, message: message.slice(0, 4000) });
    } catch {
      // Never let logging break the app (e.g. during shutdown when the database is closed).
    }
  };
  return { log: write('info'), info: write('info'), warn: write('warn'), error: write('error') };
}

module.exports = { createLogger };
