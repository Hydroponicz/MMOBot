// Emote shortcuts: "hydroponiczcobble=mine" makes that emote work like !mine. Used by the engine
// (to read chat) and by the settings (to check what the admin or EMOTE_COMMANDS typed).

// Kick sends emotes inside the message text as "[emote:12345:name]".
const EMOTE_TOKEN = /\[emote:(\d+):([^\]\s]+)\]/gi;

// Removes Kick emote tokens: "!mine [emote:1:KEKW] iron" -> "!mine iron".
const stripEmotes = (text) =>
  String(text || '')
    .replace(EMOTE_TOKEN, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Reads "name=command [target]" entries, e.g. "hydroponiczcobble=mine" or ":cobble: = !mine iron".
// isCommand(word) says whether a chat command exists. Returns { shortcuts, errors }: bad entries are
// left out and explained in errors, so one typo doesn't break the rest.
function parseEmoteCommands(list, isCommand) {
  const entries = (Array.isArray(list) ? list : String(list ?? '').split(','))
    .map((x) => String(x).trim())
    .filter(Boolean);
  const shortcuts = [];
  const errors = [];
  for (const raw of entries) {
    const eq = raw.indexOf('=');
    // Also accept a pasted Kick emote ("[emote:123:name]") or ":name:" on the left.
    const left = eq < 0 ? '' : raw.slice(0, eq).trim();
    const name = (left.match(/^\[emote:\d+:([^\]]+)\]$/i)?.[1] ?? left).replace(/^:+|:+$/g, '').toLowerCase();
    const [command = '', ...args] = (eq < 0 ? '' : raw.slice(eq + 1)).trim().replace(/^!+/, '').toLowerCase().split(/\s+/).filter(Boolean);
    // At least one letter, so a name can't be empty or just an emote ID.
    if (!/^[a-z0-9_]*[a-z][a-z0-9_]*$/.test(name)) {
      errors.push(`"${raw}" should look like emotename=mine (the emote name is letters, numbers and _)`);
    } else if (!command || !isCommand(command)) {
      errors.push(`"${raw}": "${command}" isn't a command`);
    } else if (!shortcuts.some((s) => s.name === name)) {
      shortcuts.push({ name, command, args });
    }
  }
  return { shortcuts, errors };
}

const formatShortcut = (s) => `${s.name}=${[s.command, ...s.args].join(' ')}`;

// The first shortcut in a message. It counts as the Kick emote ([emote:ID:name]), typed as :name:,
// or as the first word of the message ("hydroponiczcobble iron"). The name elsewhere in a sentence
// or a link doesn't count. Returns { shortcut, words (after it, emotes removed), atStart } or null.
function findShortcut(content, shortcuts) {
  if (!shortcuts.length) return null;
  const text = String(content || '');
  const byName = new Map(shortcuts.map((s) => [s.name, s]));
  let best = null;
  const consider = (name, index, end) => {
    const shortcut = byName.get(name.toLowerCase());
    if (shortcut && (!best || index < best.index)) best = { shortcut, index, end };
  };
  for (const m of text.matchAll(EMOTE_TOKEN)) consider(m[2], m.index, m.index + m[0].length);
  for (const m of text.matchAll(/:([a-z0-9_]+):/gi)) consider(m[1], m.index, m.index + m[0].length);
  const first = text.match(/^(\s*)([a-z0-9_]+)(?=\s|$)/i);
  if (first) consider(first[2], first[1].length, first[0].length);
  if (!best) return null;
  return {
    shortcut: best.shortcut,
    words: stripEmotes(text.slice(best.end)).split(' ').filter(Boolean),
    atStart: !stripEmotes(text.slice(0, best.index)),
  };
}

module.exports = { EMOTE_TOKEN, stripEmotes, parseEmoteCommands, formatShortcut, findShortcut };
