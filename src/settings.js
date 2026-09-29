// Live game settings, editable from the admin page.
//
// Defaults come from environment variables (config.js) and the game data (game/skills.js). Anything the
// admin changes is stored in the database as an override and wins over the defaults, so changes apply
// immediately and survive redeploys. Kick credentials, URLs and paths stay environment-only.
const { EventEmitter } = require('node:events');
const { ITEMS, SKILLS, SKILL_IDS, BACKPACK_TIERS, SHOP, COMMAND_TO_SKILL } = require('./game/skills');
const { isChatCommand } = require('./game/engine');
const { parseEmoteCommands, formatShortcut } = require('./game/emotes');
const { REDEMPTIONS, PROJECTS } = require('./game/streamRewards');

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
  'eat',
  'monsters',
  'targets',
  'casino',
  'slots',
  'roulette',
  'plinko',
  'blackjack',
  'crash',
  'mines',
  'cards',
  'relics',
  'redeem',
  'project',
  'raid',
  'boost',
  'season',
  'quest',
  'item',
  'open',
  'pet',
  'prestige',
  'goal',
  'market',
  'enchant',
  'bounty',
  'dungeon',
  'guild',
  'hall',
  'duel',
  'catch',
  'daily',
  'give',
  'craft',
  'museum',
  'title',
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
    staminaMax: { type: 'int', label: 'Stamina charges', help: 'How many actions a viewer can take before resting. Every game action (skilling, fighting, farming, raid !attack) uses one charge.', min: 1, max: 100 },
    racePerks: { type: 'bool', label: 'Race perks', help: 'Races give perks and drawbacks (XP, HP, attack, sell prices...). Off = races are just for looks.' },
    raceChangeDays: { type: 'int', label: 'Race change wait (days)', help: 'How often a player can pick a new race on the website. Their look can be changed any time.', min: 0, max: 365 },
    foodHealCap: { type: 'number', label: 'Food: most one meal can heal (share of max HP)', help: '0.3 = a meal heals at most 30% of your max HP, however good the food.', min: 0.05, max: 1 },
    healManaCost: { type: 'number', label: '!heal mana cost (share of max mana)', help: '0.3 = each cast uses 30% of your max mana.', min: 0.05, max: 1 },
    healBase: { type: 'number', label: '!heal strength (share of max HP)', help: 'Base heal; +0.1% per Magic level on top (up to +30%).', min: 0.05, max: 1 },
    staminaGradual: { type: 'bool', label: 'Stamina: refill one charge at a time', help: 'Off: the whole bar refills at once, the refill time after the first charge is used. On: one charge comes back every (refill time ÷ charges).' },
    prestigeLevel: { type: 'int', label: 'Prestige level', help: 'Skill level needed to !prestige (reset a skill for a star and +5% XP in it). Default 500, the max level.', min: 2, max: 500 },
    staminaMinutes: { type: 'number', label: 'Stamina refill (minutes)', help: 'The bar fills back up to full this long after the first charge is used.', min: 0.05, max: 1440 },
    hpRegenHours: { type: 'int', label: 'HP regen (hours)', help: 'Hours to go from 0 to full HP. Knocked-out players can fight again after this, or right away with a health potion.', min: 1, max: 168 },
    manaRegenHours: { type: 'int', label: 'Mana regen (hours)', help: 'Hours to go from 0 to full mana.', min: 1, max: 168 },
    chatPoints: { type: 'int', label: 'Points for chatting', help: 'Points for talking in chat (any message).', min: 0, max: 100000 },
    chatCooldown: { type: 'int', label: 'Chat points cooldown (seconds)', help: 'How often chatting can earn points.', min: 0, max: 86400 },
    chatPointsFullPerDay: { type: 'int', label: 'Chat points: full awards per day', help: 'A player gets full chat points this many times a day (with the default 60s cooldown, 30 = half an hour of active chatting), then half after that. Keeps marathon chatting from flooding the economy. 0 = always full.', min: 0, max: 100000 },
    chatPointsMinChars: { type: 'int', label: 'Chat points: minimum message length', help: 'Messages shorter than this (letters, not counting emotes) earn no chat points. Stops "a" spam.', min: 0, max: 100 },
    chatPointsNoRepeats: { type: 'bool', label: 'Chat points: ignore repeats', help: 'Sending the same message twice in a row earns nothing the second time.' },
    chatPointsNewUserMinutes: { type: 'int', label: 'Chat points: new chatter wait (minutes)', help: 'New chatters earn chat points only after this long (0 = right away). Makes throwaway alt accounts less useful.', min: 0, max: 10080 },
    subChatMultiplier: { type: 'number', label: 'Subscriber chat points multiplier', help: 'Subscribers (sub badge in chat) earn this many times the chat points.', min: 1, max: 10 },
    replyInChat: { type: 'bool', label: 'Reply in chat', help: 'Turn off to play silently (site and overlay still update).' },
    emoteCommands: {
      type: 'emotes',
      label: 'Emote shortcuts',
      help: 'emote=command pairs, comma separated, e.g. hydroponiczcobble=mine makes the emote work like !mine. Viewers can add a target after the emote (the emote then "iron" mines iron), or fix one here: cobble=mine iron.',
    },
    adminUsers: { type: 'list', label: 'Extra admins', help: 'Kick usernames (comma separated) allowed on this page. The channel owner is always admin.' },
  },
  casino: {
    casinoEnabled: { type: 'bool', label: 'Casino open', help: 'Slots, roulette, plinko and blackjack (chat and website). Points only.' },
    casinoMinBet: { type: 'int', label: 'Minimum bet', help: 'Smallest bet allowed.', min: 1, max: 1e12 },
    casinoMaxBet: { type: 'int', label: 'Maximum bet (0 = no limit)', help: 'Bigger bets (including "all") are capped to this.', min: 0, max: 1e12 },
    casinoCooldown: { type: 'int', label: 'Casino cooldown (seconds)', help: 'Time between bets per viewer.', min: 0, max: 3600 },
    cardsEnabled: { type: 'bool', label: 'Trading cards open', help: 'Card packs, grading, the card market and card trades on the website.' },
    cardPackPriceMultiplier: { type: 'number', label: 'Card pack price multiplier', help: 'Scales every pack price (1 = normal: Scout 200, Booster 1,000, Elite 3,500, Mythic Vault 11,000).', min: 0.1, max: 100 },
    relicsEnabled: { type: 'bool', label: 'Relic cases open', help: 'Relic case opening, trade-up contracts, the relic market and relic trades on the website.' },
    relicCasePriceMultiplier: { type: 'number', label: 'Relic case price multiplier', help: 'Scales every case price (1 = normal, about 900-1,000 pts a case).', min: 0.1, max: 100 },
    relicBuyback: { type: 'number', label: 'Relic buyback rate (0-1)', help: 'Share of a relic’s value the bank pays when a player sells it back. Cases return about 88% of their price in relic value.', min: 0, max: 1 },
    bankDailyLimit: { type: 'int', label: 'Bank sell-back limit per day', help: 'Most points one player can get per day from selling cards and relics back to the bank (both together). Bigger items have to go through the player market, which moves points between players instead of creating them. 0 = no limit.', min: 0, max: 1e12 },
    bankFullValue: { type: 'int', label: 'Bank pays the full rate up to', help: 'The buyback rate applies to the first this-many points of an item’s value; the bank pays a fifth of the rate on anything above. Stops one jackpot item from flooding the economy.', min: 0, max: 1e12 },
    cardBuyback: { type: 'number', label: 'Card buyback rate (0-1)', help: 'Share of a card’s value the bank pays when a player sells it back. 0.6 = 60%. Packs return about 88% of their price in card value, so this is the points sink.', min: 0, max: 1 },
  },
  events: {
    followPoints: { type: 'int', label: 'Points for a new follow', help: 'Given once per viewer when they follow the channel.', min: 0, max: 1e9 },
    subPoints: { type: 'int', label: 'Points for a sub or resub', help: 'Given to the subscriber.', min: 0, max: 1e9 },
    giftPointsPerSub: { type: 'int', label: 'Points per gifted sub (to the gifter)', help: 'Each gifted sub also gives the person receiving it the sub points.', min: 0, max: 1e9 },
    giftBoostMinutesPerSub: { type: 'int', label: 'Double XP minutes per gifted sub', help: 'Gifted subs start a channel-wide XP boost (0 = off). Capped at 60 minutes.', min: 0, max: 60 },
    giftBoostMultiplier: { type: 'number', label: 'Gifted-sub XP boost', help: 'XP multiplier during that boost (2 = double XP).', min: 1, max: 10 },
    eventsOnlyWhenLive: { type: 'bool', label: 'Random events and raids only when live', help: 'Needs Kick live status (the bot subscribes to it); if the stream status is unknown, events run anyway.' },
    randomEventMinutes: { type: 'int', label: 'Random chat events every (minutes)', help: 'A treasure goblin or supply drop appears about this often while chat is active (0 = off).', min: 0, max: 1440 },
    raidEveryMinutes: { type: 'int', label: 'Raid boss every (minutes)', help: 'A world boss appears this often (0 = only when you start one on the Events page).', min: 0, max: 1440 },
    raidMinutes: { type: 'int', label: 'Raid length (minutes)', help: 'How long chat has to beat the boss before it escapes.', min: 1, max: 60 },
    raidHpPerChatter: { type: 'number', label: 'Raid boss HP per chatter', help: "Boss HP = the monster's HP × this × active chatters (at least 3). Raise it if raids die too fast.", min: 0.1, max: 100 },
    worldBossHpMultiplier: { type: 'int', label: 'World boss HP multiplier', help: "World boss HP = the monster's HP × this. It's meant to take several streams.", min: 1, max: 100000 },
    worldBossDays: { type: 'int', label: 'World boss length (days)', help: 'How long the world boss stays before it escapes. Its HP carries over between streams.', min: 1, max: 60 },
    autoGoalTarget: { type: 'int', label: 'Auto channel goal (actions)', help: 'When the stream goes live, start a goal of this many actions for 2x XP for 30 minutes. 0 = off.', min: 0, max: 1000000 },
    raidRewardPoints: { type: 'int', label: 'Raid reward pool (points)', help: 'Split between everyone who hit the boss, by damage dealt.', min: 0, max: 1e9 },
    redeemEnabled: { type: 'bool', label: 'Stream redemptions', help: 'Players spend points on fireworks, a spotlight, a fanfare, double XP, a raid boss... (prices in the Stream redemptions table below).' },
    redeemOnlyLive: { type: 'bool', label: 'Redemptions only while live', help: 'Needs Kick live status; if the stream status is unknown, redemptions work anyway.' },
    projectsEnabled: { type: 'bool', label: 'Community projects', help: 'Chat pools points toward a shared goal (!fund). Goals in the Community projects table below.' },
    duelsEnabled: { type: 'bool', label: 'Duels', help: '!duel @name [bet]: player vs player fights for points.' },
    tradingEnabled: { type: 'bool', label: 'Trading', help: '!give @name <item> or !give @name 500: players give each other items and points.' },
    tradeMinHours: { type: 'int', label: 'Trading: hours since first chat', help: 'Both players must have been around this long (stops brand-new alt accounts).', min: 0, max: 8760 },
    seasonDays: { type: 'int', label: 'Season length (days)', help: 'Seasons end by themselves after this many days: the top 3 get a title and a season-only cosmetic. 0 = only when you end one on the Events page.', min: 0, max: 365 },
    tradeMinActions: { type: 'int', label: 'Trading: minimum actions', help: 'Both players need this many skilling actions.', min: 0, max: 1e6 },
    tradeDailyPoints: { type: 'int', label: 'Trading: points a player can give per day', help: '0 = no limit.', min: 0, max: 1e12 },
  },
  economy: {
    xpMultiplier: { type: 'number', label: 'XP multiplier', help: '2 = double XP event.', min: 0.1, max: 100 },
    pointsMultiplier: { type: 'number', label: 'Action points multiplier', help: 'Scales the points earned per skilling action.', min: 0, max: 100 },
    petDropMultiplier: { type: 'number', label: 'Pet drop rate multiplier', help: '1 = about 1 in 2,500 actions per skill. 0 turns pet drops off.', min: 0, max: 100 },
    marketFee: { type: 'number', label: 'Market fee (0-0.5)', help: 'Share of each market sale that disappears (a points sink). 0.05 = 5%.', min: 0, max: 0.5 },
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
  // Saved rows are matched to items by id, so adding items anywhere never moves a saved price.
  key: 'item',
  columns: { cost: { type: 'int', label: 'Price (points)', min: 0, max: 1e12 } },
  rows: () => SHOP.map((x) => ({ ...x, name: ITEMS[x.item].name, icon: ITEMS[x.item].icon })),
};

TABLES.redemptions = {
  label: 'Stream redemptions',
  key: 'id',
  columns: {
    cost: { type: 'int', label: 'Price (points, 0 = off)', min: 0, max: 1e12 },
    cooldown: { type: 'int', label: 'Cooldown for the channel (minutes)', min: 0, max: 1440 },
  },
  rows: () => REDEMPTIONS,
};
TABLES.projects = {
  label: 'Community projects',
  key: 'id',
  columns: { goal: { type: 'int', label: 'Goal (points, 0 = skip)', min: 0, max: 1e12 } },
  rows: () => PROJECTS,
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
      // Same rules as EMOTE_COMMANDS: "name=command", optionally with a fixed target ("cobble=mine iron").
      const { shortcuts, errors } = parseEmoteCommands(value, isChatCommand);
      if (errors.length) throw new SettingsError(`${label}: ${errors[0]} (commands: ${Object.keys(COMMAND_TO_SKILL).join(', ')}, …)`);
      return shortcuts.map(formatShortcut);
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

// EMOTE_COMMANDS, cleaned up like the admin page does. Bad entries are skipped with a warning
// instead of silently never matching (or matching everything).
function envEmotes(list) {
  const { shortcuts, errors } = parseEmoteCommands(list || [], isChatCommand);
  for (const e of errors) console.warn(`[settings] EMOTE_COMMANDS: skipping ${e}`);
  return shortcuts.map(formatShortcut);
}

class Settings extends EventEmitter {
  constructor({ config, repo }) {
    super();
    this.config = config;
    this.repo = repo;
    this.defaults = {
      general: {
        prefix: config.game.prefix,
        staminaMax: config.game.staminaMax ?? 3,
        staminaMinutes: config.game.staminaMinutes ?? 5,
        racePerks: config.game.racePerks ?? true,
        staminaGradual: config.game.staminaGradual ?? false,
        foodHealCap: config.game.foodHealCap ?? 0.3,
        healManaCost: config.game.healManaCost ?? 0.3,
        healBase: config.game.healBase ?? 0.3,
        prestigeLevel: config.game.prestigeLevel ?? 500,
        raceChangeDays: config.game.raceChangeDays ?? 30,
        hpRegenHours: config.game.hpRegenHours ?? 24,
        manaRegenHours: config.game.manaRegenHours ?? 1,
        chatPoints: config.game.chatPoints,
        chatCooldown: config.game.chatCooldown,
        chatPointsFullPerDay: config.game.chatPointsFullPerDay ?? 30,
        replyInChat: config.game.replyInChat,
        chatPointsMinChars: config.game.chatPointsMinChars ?? 3,
        chatPointsNoRepeats: config.game.chatPointsNoRepeats ?? true,
        chatPointsNewUserMinutes: config.game.chatPointsNewUserMinutes ?? 0,
        subChatMultiplier: config.game.subChatMultiplier ?? 2,
        emoteCommands: envEmotes(config.game.emoteCommands),
        adminUsers: config.adminUsers || [],
      },
      casino: {
        casinoEnabled: config.game.casinoEnabled ?? true,
        casinoMinBet: config.game.casinoMinBet ?? 10,
        casinoMaxBet: config.game.casinoMaxBet ?? 0,
        casinoCooldown: config.game.casinoCooldown ?? 5,
        cardsEnabled: config.game.cardsEnabled ?? true,
        cardPackPriceMultiplier: config.game.cardPackPriceMultiplier ?? 1,
        cardBuyback: config.game.cardBuyback ?? 0.6,
        bankDailyLimit: config.game.bankDailyLimit ?? 25000,
        bankFullValue: config.game.bankFullValue ?? 5000,
        relicsEnabled: config.game.relicsEnabled ?? true,
        relicCasePriceMultiplier: config.game.relicCasePriceMultiplier ?? 1,
        relicBuyback: config.game.relicBuyback ?? 0.6,
      },
      events: {
        followPoints: config.game.followPoints ?? 100,
        subPoints: config.game.subPoints ?? 500,
        giftPointsPerSub: config.game.giftPointsPerSub ?? 250,
        giftBoostMinutesPerSub: config.game.giftBoostMinutesPerSub ?? 5,
        giftBoostMultiplier: config.game.giftBoostMultiplier ?? 2,
        eventsOnlyWhenLive: config.game.eventsOnlyWhenLive ?? true,
        randomEventMinutes: config.game.randomEventMinutes ?? 15,
        raidEveryMinutes: config.game.raidEveryMinutes ?? 0,
        raidMinutes: config.game.raidMinutes ?? 10,
        raidRewardPoints: config.game.raidRewardPoints ?? 5000,
        raidHpPerChatter: config.game.raidHpPerChatter ?? 2,
        worldBossHpMultiplier: config.game.worldBossHpMultiplier ?? 300,
        worldBossDays: config.game.worldBossDays ?? 7,
        autoGoalTarget: config.game.autoGoalTarget ?? 0,
        redeemEnabled: config.game.redeemEnabled ?? true,
        redeemOnlyLive: config.game.redeemOnlyLive ?? true,
        projectsEnabled: config.game.projectsEnabled ?? true,
        duelsEnabled: config.game.duelsEnabled ?? true,
        tradingEnabled: config.game.tradingEnabled ?? true,
        tradeMinHours: config.game.tradeMinHours ?? 24,
        tradeMinActions: config.game.tradeMinActions ?? 20,
        seasonDays: config.game.seasonDays ?? 30,
        tradeDailyPoints: config.game.tradeDailyPoints ?? 10000,
      },
      economy: { xpMultiplier: 1, pointsMultiplier: 1, sellMultiplier: 1, growMultiplier: 1, petDropMultiplier: config.game.petDropMultiplier ?? 1, marketFee: config.game.marketFee ?? 0.05 },
      disabledCommands: [],
    };
    for (const [key, t] of Object.entries(TABLES)) {
      this.defaults[key] = t.rows().map((row) => ({
        ...(t.key ? { [t.key]: row[t.key] } : {}),
        ...Object.fromEntries(Object.keys(t.columns).map((c) => [c, row[c]])),
      }));
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
    const table = (name) => {
      const saved = o[name];
      if (!Array.isArray(saved)) return d[name];
      const key = TABLES[name].key;
      if (key) {
        // Rows saved before keys existed are in the old order, which matched the defaults' first rows.
        const byKey = new Map(saved.map((row, i) => [row[key] ?? d[name][i]?.[key], row]));
        return d[name].map((row) => ({ ...row, ...(byKey.get(row[key]) || {}), [key]: row[key] }));
      }
      return saved.length <= d[name].length ? d[name].map((row, i) => ({ ...row, ...(saved[i] || {}) })) : d[name];
    };
    this.all = {
      general: { ...d.general, ...(o.general || {}) },
      economy: { ...d.economy, ...(o.economy || {}) },
      casino: { ...d.casino, ...(o.casino || {}) },
      events: { ...d.events, ...(o.events || {}) },
      disabledCommands: Array.isArray(o.disabledCommands) ? o.disabledCommands : d.disabledCommands,
      ...Object.fromEntries(Object.keys(TABLES).map((k) => [k, table(k)])),
    };
    this.overridden = Object.keys(o);
  }

  // Flat view the game engine reads on every command.
  get game() {
    return { ...this.all.general, ...this.all.economy, ...this.all.casino, ...this.all.events, disabledCommands: this.all.disabledCommands };
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
    if (t.key) return out.map((row, i) => ({ [t.key]: this.defaults[section][i][t.key], ...row }));
    return out;
  }

  // Puts a section back to a saved value (undefined/null = defaults). Used to undo admin changes.
  restoreSection(section, value) {
    const o = this.repo.getSetting('config_overrides') || {};
    if (value === undefined || value === null) delete o[section];
    else o[section] = value;
    this.repo.setSetting('config_overrides', o);
    this.reload();
    this.emit('change', section);
    return this.all;
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
