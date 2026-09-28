// Live game settings, editable from the admin page.
//
// Defaults come from environment variables (config.js) and the game data (game/skills.js). Anything the
// admin changes is stored in the database as an override and wins over the defaults, so changes apply
// immediately and survive redeploys. Kick credentials, URLs and paths stay environment-only.
const { EventEmitter } = require('node:events');
const { ITEMS, SKILLS, SKILL_IDS, BACKPACK_TIERS, SHOP, COMMAND_TO_SKILL } = require('./game/skills');

// Every command a viewer can type (without the prefix), for enabling/disabling from the admin page.
const TOOL_SKILLS = SKILL_IDS.filter((id) => SKILLS[id].tool);
const COMMANDS = [
  ...Object.keys(COMMAND_TO_SKILL),
  'upgrade',
  'gear',
  'equip',
  'unequip',
  'equipped',
  'shop',
  'buy',
  'plant',
  'harvest',
  'farm',
  'hp',
  'drink',
  'heal',
  'monsters',
  'targets',
  'casino',
  'slots',
  'roulette',
  'plinko',
  'blackjack',
  'crash',
  'mines',
  ...TOOL_SKILLS.map((id) => SKILLS[id].tool.id),
  'stats',
  'inv',
  'sell',
  'points',
  'top',
  'commands',
];

// Editable scalar fields, grouped into sections. The admin page renders its form from this.
const FIELDS = {
  general: {
    prefix: { type: 'string', label: 'Command prefix', help: 'What commands start with, e.g. ! for !fish.', maxLength: 3 },
    actionCooldown: { type: 'int', label: 'Action cooldown (seconds)', help: 'Time between skilling actions per viewer.', min: 0, max: 3600 },
    farmCooldown: { type: 'int', label: 'Farming cooldown (seconds)', help: 'Time between !plant / !harvest per viewer (separate from the action cooldown).', min: 0, max: 3600 },
    hpRegenHours: { type: 'int', label: 'HP regen (hours)', help: 'Hours to go from 0 to full HP. Knocked-out players can fight again after this, or right away with a health potion.', min: 1, max: 168 },
    manaRegenHours: { type: 'int', label: 'Mana regen (hours)', help: 'Hours to go from 0 to full mana.', min: 1, max: 168 },
    chatPoints: { type: 'int', label: 'Points for chatting', help: 'Points for talking in chat (any message).', min: 0, max: 100000 },
    chatCooldown: { type: 'int', label: 'Chat points cooldown (seconds)', help: 'How often chatting can earn points.', min: 0, max: 86400 },
    replyInChat: { type: 'bool', label: 'Reply in chat', help: 'Turn off to play silently (site and overlay still update).' },
    emoteCommands: {
      type: 'emotes',
      label: 'Emote shortcuts',
      help: 'emote=command pairs, comma separated. A chat message with that emote runs the command, e.g. hydroponiczcobble=mine makes the emote work like !mine.',
    },
    adminUsers: { type: 'list', label: 'Extra admins', help: 'Kick usernames (comma separated) allowed on this page. The channel owner is always admin.' },
  },
  casino: {
    casinoEnabled: { type: 'bool', label: 'Casino open', help: 'Slots, roulette, plinko and blackjack (chat and website). Points only.' },
    casinoMinBet: { type: 'int', label: 'Minimum bet', help: 'Smallest bet allowed.', min: 1, max: 1e12 },
    casinoMaxBet: { type: 'int', label: 'Maximum bet (0 = no limit)', help: 'Bigger bets (including "all") are capped to this.', min: 0, max: 1e12 },
    casinoCooldown: { type: 'int', label: 'Casino cooldown (seconds)', help: 'Time between bets per viewer.', min: 0, max: 3600 },
  },
  economy: {
    xpMultiplier: { type: 'number', label: 'XP multiplier', help: '2 = double XP event.', min: 0.1, max: 100 },
    pointsMultiplier: { type: 'number', label: 'Action points multiplier', help: 'Scales the points earned per skilling action.', min: 0, max: 100 },
    sellMultiplier: { type: 'number', label: 'Sell price multiplier', help: 'Scales what items sell for with !sell.', min: 0, max: 100 },
    growMultiplier: { type: 'number', label: 'Crop growth time multiplier', help: '0.5 = crops grow twice as fast (applies to new plantings).', min: 0.01, max: 100 },
  },
};

// Editable tables: one row per tier. Names/icons come from the game data and aren't editable here.
// One table per skill tool ("rods", "pickaxes", "axes", "shovels", "furnaces") plus the backpack.
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const STAT_COLUMNS = {
  failChance: (tool) => ({ type: 'number', label: `${cap(tool.failWord || 'fail')} chance (0-1)`, min: 0, max: 1 }),
  xpBonus: () => ({ type: 'number', label: 'XP bonus (0.1 = +10%)', min: 0, max: 100 }),
  rareBonus: () => ({ type: 'number', label: 'Rare odds ×', min: 0, max: 100 }),
  doubleChance: () => ({ type: 'number', label: 'Double chance (0-1)', min: 0, max: 1 }),
};
const TABLES = {};
for (const id of TOOL_SKILLS) {
  const skill = SKILLS[id];
  const tool = skill.tool;
  TABLES[`${tool.id}s`] = {
    label: `${skill.name} ${tool.name.toLowerCase()}s`,
    tool: true,
    ascending: 'level',
    columns: {
      level: { type: 'int', label: `${skill.name} level`, min: 1, max: skill.maxLevel || 99 },
      cost: { type: 'int', label: 'Cost (points)', min: 0, max: 1e12 },
      ...Object.fromEntries(tool.stats.map((stat) => [stat, STAT_COLUMNS[stat](tool)])),
    },
    rows: () => tool.tiers,
  };
}
TABLES.backpack = {
  label: 'Backpack',
  ascending: 'capacity',
  columns: {
    capacity: { type: 'int', label: 'Slots', min: 1, max: 100000 },
    cost: { type: 'int', label: 'Cost (points)', min: 0, max: 1e12 },
  },
  rows: () => BACKPACK_TIERS,
};
TABLES.shop = {
  label: 'Shop prices',
  columns: { cost: { type: 'int', label: 'Price (points)', min: 0, max: 1e12 } },
  rows: () => SHOP.map((x) => ({ ...x, name: ITEMS[x.item].name, icon: ITEMS[x.item].icon })),
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
    case 'emotes': {
      const arr = Array.isArray(value) ? value : String(value ?? '').split(',');
      const out = [];
      for (const raw of arr.map((x) => String(x).trim()).filter(Boolean)) {
        const [name, command] = raw.split('=').map((x) => (x || '').trim().replace(/^[:!]+|:+$/g, '').toLowerCase());
        if (!/^[a-z0-9_]+$/.test(name || '') || !command) throw new SettingsError(`${label}: "${raw}" should look like emotename=mine`);
        if (!COMMANDS.includes(command)) throw new SettingsError(`${label}: "${command}" isn't a command (try ${Object.keys(COMMAND_TO_SKILL).join(', ')})`);
        out.push(`${name}=${command}`);
      }
      return out;
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
        farmCooldown: config.game.farmCooldown ?? 10,
        hpRegenHours: config.game.hpRegenHours ?? 24,
        manaRegenHours: config.game.manaRegenHours ?? 12,
        chatPoints: config.game.chatPoints,
        chatCooldown: config.game.chatCooldown,
        replyInChat: config.game.replyInChat,
        emoteCommands: config.game.emoteCommands || [],
        adminUsers: config.adminUsers || [],
      },
      casino: {
        casinoEnabled: config.game.casinoEnabled ?? true,
        casinoMinBet: config.game.casinoMinBet ?? 10,
        casinoMaxBet: config.game.casinoMaxBet ?? 0,
        casinoCooldown: config.game.casinoCooldown ?? 5,
      },
      economy: { xpMultiplier: 1, pointsMultiplier: 1, sellMultiplier: 1, growMultiplier: 1 },
      disabledCommands: [],
    };
    for (const [key, t] of Object.entries(TABLES)) {
      this.defaults[key] = t.rows().map((row) => Object.fromEntries(Object.keys(t.columns).map((c) => [c, row[c]])));
    }
    this.reload();
  }

  reload() {
    const o = this.repo.getSetting('config_overrides') || {};
    // Rods saved before tools were generalised used "snapChance" for what is now "failChance".
    if (Array.isArray(o.rods)) {
      o.rods = o.rods.map(({ snapChance, ...row }) => (snapChance !== undefined && row.failChance === undefined ? { ...row, failChance: snapChance } : row));
    }
    const d = this.defaults;
    // Saved tables are applied row by row, so adding rows later (e.g. a new shop item) keeps earlier edits.
    const table = (name) =>
      Array.isArray(o[name]) && o[name].length <= d[name].length ? d[name].map((row, i) => ({ ...row, ...(o[name][i] || {}) })) : d[name];
    this.all = {
      general: { ...d.general, ...(o.general || {}) },
      economy: { ...d.economy, ...(o.economy || {}) },
      casino: { ...d.casino, ...(o.casino || {}) },
      disabledCommands: Array.isArray(o.disabledCommands) ? o.disabledCommands : d.disabledCommands,
      ...Object.fromEntries(Object.keys(TABLES).map((k) => [k, table(k)])),
    };
    this.overridden = Object.keys(o);
  }

  // Flat view the game engine reads on every command.
  get game() {
    return { ...this.all.general, ...this.all.economy, ...this.all.casino, disabledCommands: this.all.disabledCommands };
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
    const ascending = t.ascending;
    for (let i = 1; ascending && i < out.length; i++) {
      if (out[i][ascending] <= out[i - 1][ascending]) {
        throw new SettingsError(`${t.label}: tier ${i + 1} ${t.columns[ascending].label.toLowerCase()} must be higher than tier ${i}`);
      }
    }
    if (t.tool && out[0].level !== 1) throw new SettingsError(`${t.label}: the first tier must be available at level 1`);
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
        baseUrlSource: this.config.baseUrlSource,
        dbPath: this.config.dbPath,
        kickClientId: this.config.kick.clientId ? `${this.config.kick.clientId.slice(0, 4)}…` : '(not set)',
        devMode: this.config.devMode,
      },
    };
  }
}

module.exports = { Settings, SettingsError, COMMANDS };
