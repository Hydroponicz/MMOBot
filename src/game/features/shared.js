// Constants and helpers shared by the engine and its feature modules.
const {
  ITEMS,
  SKILLS,
  SKILL_IDS,
  BACKPACK_TIERS,
  SHOP,
  MAX_PLOTS,
  STARTER_PLOTS,
  GEAR_SLOTS,
  COMMAND_TO_SKILL,
  COMMAND_ARGS,
  COMBAT_SKILLS,
  WEAPON_SKILL,
  TOOL_TO_SKILL,
  TOOL_ALIASES,
  maxLevel,
  maxHpFor,
  maxManaFor,
  BUFFS,
  SPELLS,
  MINIONS,
  MUSEUM,
  findItem,
} = require('../skills');
const weaponWords = {
  archery: /^(bows?|archery|shoot|arrows?|ranged)$/,
  swords: /^(swords?|fight|melee)$/,
  magic: /^(magic|staff|staves|cast|spells?|mage)$/,
  axes: /^(axes?|battleaxes?|cleave|hack)$/,
  daggers: /^(daggers?|knives|knife|stab|backstab)$/,
  spears: /^(spears?|polearms?|thrust|lunge)$/,
  brawling: /^(brawl(ing)?|punch|fists?|knuckles|unarmed)$/,
  necromancy: /^(necro(mancy)?|scythes?|raise|undead|minions?)$/,
};
const { levelForXp, progress, characterProgress } = require('../xp');
const casino = require('../casino');
const emotes = require('../emotes');

const fmt = (n) => Number(n).toLocaleString('en-US');
// bet x multiplier, rounded down, without float noise (100 x 2.01 = 201, not 200).
const payoutOf = (bet, multiplier) => Math.floor(bet * multiplier + 1e-6);
const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const skillLevel = (skillId, xp) => levelForXp(xp, maxLevel(skillId));
const itemLabel = (id, qty = 1) => `${ITEMS[id].icon} ${qty > 1 ? `${fmt(qty)}x ` : ''}${ITEMS[id].name}`;

// Commands that don't count as "actions" (no cooldown), mapped to [handler, name used to enable/disable it].
const INFO_COMMANDS = {
  stats: ['stats', 'stats'], level: ['stats', 'stats'], lvl: ['stats', 'stats'], skills: ['stats', 'stats'], xp: ['stats', 'stats'],
  inv: ['inventory', 'inv'], inventory: ['inventory', 'inv'], bag: ['inventory', 'inv'], backpack: ['inventory', 'inv'],
  points: ['points', 'points'], pts: ['points', 'points'], balance: ['points', 'points'],
  sell: ['sell', 'sell'], sellall: ['sellAll', 'sell'],
  top: ['top', 'top'], leaderboard: ['top', 'top'], lb: ['top', 'top'],
  upgrade: ['upgrade', 'upgrade'],
  gear: ['gear', 'gear'], tools: ['gear', 'gear'], equipment: ['gear', 'gear'],
  // !rod, !pickaxe, !axe, !shovel, !furnace (and aliases like !pick) show that tool.
  ...Object.fromEntries(Object.entries(TOOL_ALIASES).map(([word, toolId]) => [word, ['toolInfo', toolId]])),
  equip: ['equip', 'equip'], wear: ['equip', 'equip'], wield: ['equip', 'equip'],
  unequip: ['unequip', 'unequip'], remove: ['unequip', 'unequip'],
  equipped: ['equippedInfo', 'equipped'], worn: ['equippedInfo', 'equipped'], armor: ['equippedInfo', 'equipped'], armour: ['equippedInfo', 'equipped'],
  buy: ['buy', 'buy'], shop: ['shopList', 'shop'], store: ['shopList', 'shop'],
  // Farming has its own cooldown, separate from the skilling one.
  plant: ['plant', 'plant'], sow: ['plant', 'plant'],
  harvest: ['harvest', 'harvest'], reap: ['harvest', 'harvest'],
  farm: ['farmInfo', 'farm'], plots: ['farmInfo', 'farm'], garden: ['farmInfo', 'farm'],
  // Gathering stations (crab pots, ore drills, saplings, dig sites) and the price checker.
  collect: ['collectStations', 'collect'], haul: ['collectStations', 'collect'],
  stations: ['stationsInfo', 'collect'], station: ['stationsInfo', 'collect'],
  price: ['priceCheck', 'price'], prices: ['priceCheck', 'price'], pc: ['priceCheck', 'price'],
  // Casino (points only). Has its own short cooldown.
  slots: ['chatSlots', 'slots'], slot: ['chatSlots', 'slots'], spin: ['chatSlots', 'slots'],
  roulette: ['chatRoulette', 'roulette'], rl: ['chatRoulette', 'roulette'],
  plinko: ['chatPlinko', 'plinko'],
  blackjack: ['chatBlackjack', 'blackjack'], bj: ['chatBlackjack', 'blackjack'],
  hit: ['chatHit', 'blackjack'], stand: ['chatStand', 'blackjack'], double: ['chatDouble', 'blackjack'], split: ['chatSplit', 'blackjack'],
  crash: ['chatCrash', 'crash'], rocket: ['chatCrash', 'crash'],
  mines: ['chatMines', 'mines'], minesweeper: ['chatMines', 'mines'],
  redeem: ['redeemChat', 'redeem'], redeems: ['redeemChat', 'redeem'], rewards: ['redeemChat', 'redeem'],
  project: ['projectChat', 'project'], fund: ['projectChat', 'project'],
  relics: ['relicsInfo', 'relics'], relic: ['relicsInfo', 'relics'], cases: ['relicsInfo', 'relics'],
  cards: ['cardsInfo', 'cards'], packs: ['cardsInfo', 'cards'], card: ['cardsInfo', 'cards'],
  pick: ['chatPick', 'mines'], reveal: ['chatPick', 'mines'], cashout: ['chatCashout', 'mines'],
  casino: ['casinoHelp', 'casino'], gamble: ['casinoHelp', 'casino'],
  // Channel events: random events, raids, duels, boosts.
  catch: ['eventCatch', 'catch'], grab: ['eventCatch', 'catch'],
  raid: ['raidInfo', 'raid'], boss: ['raidInfo', 'raid'], attack: ['raidAttack', 'raid'],
  duel: ['duel', 'duel'], accept: ['duelAccept', 'duel'], decline: ['duelDecline', 'duel'],
  house: ['houseCommand', 'house'], home: ['houseCommand', 'house'],
  // Structures from Construction parts: the town and player shops.
  town: ['townCommand', 'town'], contribute: ['contributeCommand', 'town'], donateparts: ['contributeCommand', 'town'],
  stall: ['stallCommand', 'stall'], storefront: ['stallCommand', 'stall'],
  // The crime update (crime.js).
  pickpocket: ['pickpocket', 'pickpocket'], pocket: ['pickpocket', 'pickpocket'],
  poach: ['poach', 'poach'], burgle: ['burgle', 'burgle'], burglary: ['burgle', 'burgle'],
  wanted: ['wantedCommand', 'wanted'], jailbreak: ['jailbreak', 'jailbreak'], breakout: ['jailbreak', 'jailbreak'],
  bail: ['bail', 'jailbreak'], jail: ['jailCommand', 'jailbreak'],
  tipoff: ['tipoff', 'tipoff'], snitch: ['tipoff', 'tipoff'], racket: ['racketCommand', 'racket'], protection: ['racketCommand', 'racket'],
  kicks: ['kicksCommand', 'kicks'], supporters: ['kicksCommand', 'kicks'],
  rob: ['rob', 'rob'], heist: ['rob', 'rob'], guards: ['guards', 'rob'], guard: ['guards', 'rob'], hire: ['guards', 'rob'],
  arena: ['arenaFight', 'arena'], ranked: ['arenaFight', 'arena'],
  // The Gloamveil (extraction minigame).
  veil: ['veilCommand', 'veil'], gloamveil: ['veilCommand', 'veil'], delve: ['veilCommand', 'veil'],
  search: ['veilSearch', 'veil'], loot: ['veilSearch', 'veil'], deeper: ['veilDeeper', 'veil'], descend: ['veilDeeper', 'veil'],
  extract: ['veilExtract', 'veil'], mend: ['veilMend', 'veil'], ambush: ['veilAmbush', 'veil'], hide: ['veilHide', 'veil'],
  war: ['guildWarInfo', 'war'], guildwar: ['guildWarInfo', 'war'], wars: ['guildWarInfo', 'war'],
  boost: ['boostInfo', 'boost'],
  museum: ['museumInfo', 'museum'], donate: ['donate', 'museum'],
  // Dailies, achievements, titles, seasons, trading.
  daily: ['claimDaily', 'daily'], tasks: ['tasksInfo', 'daily'], quests: ['tasksInfo', 'daily'],
  achievements: ['achievementsInfo', 'title'], ach: ['achievementsInfo', 'title'], title: ['title', 'title'],
  season: ['seasonInfo', 'season'],
  give: ['give', 'give'], gift: ['give', 'give'],
  // Health and mana. Potions and !heal have no cooldown.
  hp: ['vitalsInfo', 'hp'], health: ['vitalsInfo', 'hp'], mana: ['vitalsInfo', 'hp'], vitals: ['vitalsInfo', 'hp'],
  drink: ['drink', 'drink'], quaff: ['drink', 'drink'], potion: ['drink', 'drink'],
  heal: ['healSpell', 'heal'],
  eat: ['eat', 'eat'], food: ['eat', 'eat'],
  fire: ['fireInfo', 'eat'],
  stamina: ['staminaInfo', 'hp'], energy: ['staminaInfo', 'hp'],
  race: ['raceInfo', 'stats'], races: ['raceInfo', 'stats'],
  pet: ['petCommand', 'pet'], pets: ['petCommand', 'pet'],
  quest: ['questInfo', 'quest'], quests: ['questInfo', 'quest'],
  goal: ['goalInfo', 'goal'],
  enchant: ['enchant', 'enchant'],
  item: ['itemInfo', 'item'], info: ['itemInfo', 'item'], whatis: ['itemInfo', 'item'],
  open: ['openContainer', 'open'],
  bounty: ['bounty', 'bounty'], bounties: ['bountyList', 'bounty'],
  dungeon: ['dungeonJoin', 'dungeon'], dungeons: ['dungeonJoin', 'dungeon'],
  hall: ['hallInfo', 'hall'],
  guild: ['guild', 'guild'], clan: ['guild', 'guild'],
  market: ['marketInfo', 'market'],
  prestige: ['prestige', 'prestige'],
  buffs: ['buffsInfo', 'hp'], effects: ['buffsInfo', 'hp'],
  monsters: ['monstersInfo', 'monsters'], mobs: ['monstersInfo', 'monsters'],
  targets: ['targets', 'targets'], target: ['targets', 'targets'],
  quiver: ['quiverInfo', 'targets'], arrows: ['quiverInfo', 'targets'],
  scout: ['scout', 'monsters'], check: ['scout', 'monsters'], con: ['scout', 'monsters'],
  commands: ['help', 'commands'], help: ['help', 'commands'], rpg: ['help', 'commands'], mmo: ['help', 'commands'],
};

// Words players use for gear slots: "!unequip helmet".
const SLOT_ALIASES = {
  weapon: 'weapon', sword: 'weapon',
  head: 'head', helmet: 'head', helm: 'head',
  body: 'body', platebody: 'body', chest: 'body',
  legs: 'legs', platelegs: 'legs',
  shield: 'shield',
};
const SLOT_ICONS = { weapon: '🗡️', head: '⛑️', body: '👕', legs: '👖', shield: '🛡️' };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// How a fight looks for you (see assessFight).
const RATINGS = {
  easy: { id: 'easy', icon: '⚪', label: 'Too easy' },
  fair: { id: 'fair', icon: '🟢', label: 'Good match' },
  tough: { id: 'tough', icon: '🟠', label: 'Tough' },
  hard: { id: 'hard', icon: '🔴', label: 'Hard' },
  deadly: { id: 'deadly', icon: '☠️', label: 'Deadly' },
};
const CROPS = SKILLS.farming.resources;
// How much harder a monster hits for being above your level: 1.5x your level hits ~1.13x as hard,
// 2x ~1.23x, 3x ~1.39x. That's on top of it having more HP and your gear being weaker than it calls
// for (up to 1.4x), so 1.5x your level costs ~40% HP a fight and 2x ~80%.
const outlevelFactor = (monsterLevel, level) => Math.pow(Math.min(10, Math.max(0.5, monsterLevel / Math.max(1, level))), 0.3);
const minutesLeft = (ms) => {
  const m = ms < 3_600_000 ? Math.max(1, Math.ceil(ms / 60_000)) : Math.floor(ms / 60_000); // "23h 59m", not "24h 0m"
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

// Where each material comes from, for "you're missing..." hints:
// copper_ore -> "!mine copper", bronze_bar -> "!smelt bronze".
const GATHER_HINT = {};
for (const id of SKILL_IDS) {
  for (const r of [...(SKILLS[id].resources || []), ...(SKILLS[id].type === 'process' ? SKILLS[id].recipes : [])]) {
    if (!r.item) continue; // Agility courses give no items
    // Crops use their full name ("!plant lemon balm" vs "!plant lemon"); ores etc. the first word ("!mine copper").
    const word = SKILLS[id].type === 'farm' ? ITEMS[r.item].name.toLowerCase() : ITEMS[r.item].name.split(' ')[0].toLowerCase();
    GATHER_HINT[r.item] ??= `!${SKILLS[id].command} ${word}`;
  }
}
// Recipes made with another command than their skill's (nails: "!craft iron nails").
for (const id of SKILL_IDS) for (const r of SKILLS[id].recipes || []) if (r.command) GATHER_HINT[r.item] = `!${r.command} ${ITEMS[r.item].name.toLowerCase()}`;
// Monster loot: feathers -> "!fight chicken".
for (const id of SKILL_IDS) {
  for (const m of SKILLS[id].type === 'combat' ? SKILLS[id].monsters : []) {
    for (const item of m.loot) GATHER_HINT[item] ??= `!${SKILLS[id].command} ${m.name.toLowerCase()}`;
  }
}
// Firemaking leaves ashes; skinning gives meat.
GATHER_HINT.ashes = '!lightfire';
for (const r of SKILLS.skinning.resources) if (r.meat) GATHER_HINT[r.meat] = `!skin ${ITEMS[r.item].name.split(' ')[0].toLowerCase()}`;
// Name of anything in a skill's unlock list (items, recipes or monsters).
const unlockName = (r) => (r.item ? ITEMS[r.item].name : r.name);

module.exports = {
  SPELLS,
  MINIONS,
  MUSEUM,
  ITEMS,
  SKILLS,
  SKILL_IDS,
  BACKPACK_TIERS,
  SHOP,
  MAX_PLOTS,
  STARTER_PLOTS,
  GEAR_SLOTS,
  COMMAND_TO_SKILL,
  COMMAND_ARGS,
  COMBAT_SKILLS,
  WEAPON_SKILL,
  TOOL_TO_SKILL,
  TOOL_ALIASES,
  maxLevel,
  maxHpFor,
  maxManaFor,
  BUFFS,
  findItem,
  weaponWords,
  levelForXp,
  progress,
  characterProgress,
  casino,
  emotes,
  fmt,
  payoutOf,
  pct,
  skillLevel,
  itemLabel,
  INFO_COMMANDS,
  SLOT_ALIASES,
  SLOT_ICONS,
  clamp,
  RATINGS,
  outlevelFactor,
  CROPS,
  minutesLeft,
  GATHER_HINT,
  unlockName,
};
