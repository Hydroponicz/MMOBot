// Live game settings, editable from the admin page.
//
// Defaults come from environment variables (config.js) and the game data (game/skills.js). Anything the
// admin changes is stored in the database as an override and wins over the defaults, so changes apply
// immediately and survive redeploys. Kick credentials, URLs and paths stay environment-only.
const { EventEmitter } = require('node:events');
const { SKILLS, BACKPACK_TIERS, COMMAND_TO_SKILL } = require('./game/skills');

// Every command a viewer can type (without the prefix), for enabling/disabling from the admin page.
const COMMANDS = [...Object.keys(COMMAND_TO_SKILL), 'upgrade', 'rod', 'stats', 'inv', 'sell', 'points', 'top', 'commands'];

// Editable scalar fields, grouped into sections. The admin page renders its form from this.
const FIELDS = {
  general: {
    prefix: { type: 'string', label: 'Command prefix', help: 'What commands start with, e.g. ! for !fish.', maxLength: 3 },
    actionCooldown: { type: 'int', label: 'Action cooldown (seconds)', help: 'Time between skilling actions per viewer.', min: 0, max: 3600 },
    chatPoints: { type: 'int', label: 'Points for chatting', help: 'Points for talking in chat (any message).', min: 0, max: 100000 },
    chatCooldown: { type: 'int', label: 'Chat points cooldown (seconds)', help: 'How often chatting can earn points.', min: 0, max: 86400 },
    replyInChat: { type: 'bool', label: 'Reply in chat', help: 'Turn off to play silently (site and overlay still update).' },
    adminUsers: { type: 'list', label: 'Extra admins', help: 'Kick usernames (comma separated) allowed on this page. The channel owner is always admin.' },
  },
  economy: {
    xpMultiplier: { type: 'number', label: 'XP multiplier', help: '2 = double XP event.', min: 0.1, max: 100 },
    pointsMultiplier: { type: 'number', label: 'Action points multiplier', help: 'Scales the points earned per skilling action.', min: 0, max: 100 },
    sellMultiplier: { type: 'number', label: 'Sell price multiplier', help: 'Scales what items sell for with !sell.', min: 0, max: 100 },
  },
};

// Editable tables: one row per tier. Names/icons come from the game data and aren't editable here.
const TABLES = {
  rods: {
    label: 'Fishing rods',
    columns: {
      level: { type: 'int', label: 'Fishing level', min: 1, max: 500 },
      cost: { type: 'int', label: 'Cost (points)', min: 0, max: 1e12 },
      snapChance: { type: 'number', label: 'Snap chance (0-1)', min: 0, max: 1 },
      xpBonus: { type: 'number', label: 'XP bonus (0.1 = +10%)', min: 0, max: 100 },
      rareBonus: { type: 'number', label: 'Rare odds ×', min: 0, max: 100 },
    },
    rows: () => SKILLS.fishing.tool.tiers,
  },
  backpack: {
    label: 'Backpack',
    columns: {
      capacity: { type: 'int', label: 'Slots', min: 1, max: 100000 },
      cost: { type: 'int', label: 'Cost (points)', min: 0, max: 1e12 },
    },
    rows: () => BACKPACK_TIERS,
  },
};

class SettingsError extends Error {}

function coerce(spec, value, label) {
  switch (spec.type) {
    case 'bool':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'false') return value === 'true';
      throw new SettingsError(`${label} must be on or off`);
    case 'string': {
      const s = String(value ?? '').trim();
      if (!s) throw new SettingsError(`${label} can't be empty`);
      if (spec.maxLength && s.length > spec.maxLength) throw new SettingsError(`${label} is too long`);
      if (/\s/.test(s)) throw new SettingsError(`${label} can't contain spaces`);
      return s;
    }
    case 'list': {
      const arr = Array.isArray(value) ? value : String(value ?? '').split(',');
      return [...new Set(arr.map((x) => String(x).trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
    }
    case 'int':
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new SettingsError(`${label} must be a number`);
      if (spec.type === 'int' && !Number.isInteger(n)) throw new SettingsError(`${label} must be a whole number`);
      if (n < spec.min || n > spec.max) throw new SettingsError(`${label} must be between ${spec.min} and ${spec.max}`);
      return n;
    }
    default:
      throw new SettingsError(`unknown setting type for ${label}`);
  }
}

class Settings extends EventEmitter {
  constructor({ config, repo }) {
    super();
    this.config = config;
    this.repo = repo;
    this.defaults = {
      general: {
        prefix: config.game.prefix,
        actionCooldown: config.game.actionCooldown,
        chatPoints: config.game.chatPoints,
        chatCooldown: config.game.chatCooldown,
        replyInChat: config.game.replyInChat,
        adminUsers: config.adminUsers || [],
      },
      economy: { xpMultiplier: 1, pointsMultiplier: 1, sellMultiplier: 1 },
      disabledCommands: [],
      rods: TABLES.rods.rows().map(({ level, cost, snapChance, xpBonus, rareBonus }) => ({ level, cost, snapChance, xpBonus, rareBonus })),
      backpack: TABLES.backpack.rows().map(({ capacity, cost }) => ({ capacity, cost })),
    };
    this.reload();
  }

  reload() {
    const o = this.repo.getSetting('config_overrides') || {};
    const d = this.defaults;
    const table = (name) => (Array.isArray(o[name]) && o[name].length === d[name].length ? o[name] : d[name]);
    this.all = {
      general: { ...d.general, ...(o.general || {}) },
      economy: { ...d.economy, ...(o.economy || {}) },
      disabledCommands: Array.isArray(o.disabledCommands) ? o.disabledCommands : d.disabledCommands,
      rods: table('rods'),
      backpack: table('backpack'),
    };
    this.overridden = Object.keys(o);
  }

  // Flat view the game engine reads on every command.
  get game() {
    return { ...this.all.general, ...this.all.economy, disabledCommands: this.all.disabledCommands };
  }

  // Validate and save one section. Returns the new settings; throws SettingsError on bad input.
  update(section, value) {
    const o = this.repo.getSetting('config_overrides') || {};
    if (FIELDS[section]) {
      const next = {};
      for (const [key, spec] of Object.entries(FIELDS[section])) {
        next[key] = key in (value || {}) ? coerce(spec, value[key], spec.label) : this.all[section][key];
      }
      o[section] = next;
    } else if (section === 'disabledCommands') {
      if (!Array.isArray(value)) throw new SettingsError('disabledCommands must be a list');
      o.disabledCommands = value.map(String).filter((c) => COMMANDS.includes(c));
    } else if (TABLES[section]) {
      o[section] = this.validateTable(section, value);
    } else {
      throw new SettingsError(`unknown settings section "${section}"`);
    }
    this.repo.setSetting('config_overrides', o);
    this.reload();
    this.emit('change', section);
    return this.all;
  }

  validateTable(section, rows) {
    const t = TABLES[section];
    const expected = this.defaults[section].length;
    if (!Array.isArray(rows) || rows.length !== expected) throw new SettingsError(`${t.label} needs exactly ${expected} rows`);
    const out = rows.map((row, i) =>
      Object.fromEntries(
        Object.entries(t.columns).map(([key, spec]) => [key, coerce(spec, row?.[key], `${t.label} tier ${i + 1} ${spec.label}`)])
      )
    );
    // Tiers must get strictly better/pricier as they go up.
    const ascending = section === 'rods' ? 'level' : 'capacity';
    for (let i = 1; i < out.length; i++) {
      if (out[i][ascending] <= out[i - 1][ascending]) {
        throw new SettingsError(`${t.label}: tier ${i + 1} ${t.columns[ascending].label.toLowerCase()} must be higher than tier ${i}`);
      }
    }
    if (section === 'rods' && out[0].level !== 1) throw new SettingsError('The first rod must be available at level 1');
    return out;
  }

  reset(section) {
    const o = this.repo.getSetting('config_overrides') || {};
    delete o[section];
    this.repo.setSetting('config_overrides', o);
    this.reload();
    this.emit('change', section);
    return this.all;
  }

  // Everything the admin page needs to render the settings form.
  describe() {
    return {
      values: this.all,
      defaults: this.defaults,
      overridden: this.overridden,
      fields: FIELDS,
      commands: COMMANDS,
      tables: Object.fromEntries(
        Object.entries(TABLES).map(([k, t]) => [
          k,
          { label: t.label, columns: t.columns, names: t.rows().map((r) => `${r.icon || ''} ${r.name || ''}`.trim()) },
        ])
      ),
      environment: {
        channel: this.config.kick.channel,
        baseUrl: this.config.baseUrl,
        dbPath: this.config.dbPath,
        kickClientId: this.config.kick.clientId ? `${this.config.kick.clientId.slice(0, 4)}…` : '(not set)',
        devMode: this.config.devMode,
      },
    };
  }
}

module.exports = { Settings, SettingsError, COMMANDS };
