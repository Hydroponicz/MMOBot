// All game content lives here. To add a new skill or item, edit this file only.
//
// Gathering skills: each action rolls one resource from the tiers the player has unlocked
// (or the one they asked for, e.g. "!mine iron"), plus a small chance at a rare find.
// Processing skills (smelting): consume items from the inventory to produce better ones.

const ITEMS = {
  // Fishing
  shrimp: { name: 'Shrimp', icon: '🦐', value: 2 },
  sardine: { name: 'Sardine', icon: '🐟', value: 5 },
  herring: { name: 'Herring', icon: '🐟', value: 8 },
  trout: { name: 'Trout', icon: '🐟', value: 14 },
  salmon: { name: 'Salmon', icon: '🍣', value: 22 },
  tuna: { name: 'Tuna', icon: '🐟', value: 35 },
  lobster: { name: 'Lobster', icon: '🦞', value: 55 },
  swordfish: { name: 'Swordfish', icon: '🗡️', value: 85 },
  shark: { name: 'Shark', icon: '🦈', value: 140 },
  anglerfish: { name: 'Anglerfish', icon: '🐡', value: 200 },
  manta_ray: { name: 'Manta Ray', icon: '🌊', value: 280 },
  giant_squid: { name: 'Giant Squid', icon: '🦑', value: 360 },
  giant_octopus: { name: 'Giant Octopus', icon: '🐙', value: 460 },
  abyssal_eel: { name: 'Abyssal Eel', icon: '🐍', value: 600 },
  blue_marlin: { name: 'Blue Marlin', icon: '🐬', value: 750 },
  coelacanth: { name: 'Coelacanth', icon: '🦕', value: 900 },
  sea_serpent: { name: 'Sea Serpent', icon: '🐉', value: 1100 },
  leviathan: { name: 'Leviathan', icon: '🐋', value: 1300 },
  celestial_whale: { name: 'Celestial Whale', icon: '🐳', value: 1600 },
  message_bottle: { name: 'Message in a Bottle', icon: '🍾', value: 400, rare: true },
  golden_fish: { name: 'Golden Fish', icon: '🐠', value: 1500, rare: true },

  // Mining
  copper_ore: { name: 'Copper Ore', icon: '🟠', value: 3 },
  tin_ore: { name: 'Tin Ore', icon: '⚪', value: 3 },
  iron_ore: { name: 'Iron Ore', icon: '⛓️', value: 10 },
  silver_ore: { name: 'Silver Ore', icon: '🥈', value: 18 },
  coal: { name: 'Coal', icon: '⚫', value: 12 },
  gold_ore: { name: 'Gold Ore', icon: '🥇', value: 35 },
  mithril_ore: { name: 'Mithril Ore', icon: '🔷', value: 55 },
  adamantite_ore: { name: 'Adamantite Ore', icon: '🟢', value: 85 },
  runite_ore: { name: 'Runite Ore', icon: '🔹', value: 130 },
  cobalt_ore: { name: 'Cobalt Ore', icon: '🔵', value: 200 },
  obsidian: { name: 'Obsidian', icon: '⬛', value: 280 },
  titanium_ore: { name: 'Titanium Ore', icon: '🔘', value: 360 },
  orichalcum_ore: { name: 'Orichalcum Ore', icon: '🟡', value: 460 },
  platinum_ore: { name: 'Platinum Ore', icon: '💿', value: 600 },
  dragonite_ore: { name: 'Dragonite Ore', icon: '🟥', value: 750 },
  luminite_ore: { name: 'Luminite Ore', icon: '💡', value: 900 },
  void_ore: { name: 'Void Ore', icon: '🌑', value: 1100 },
  starmetal_ore: { name: 'Starmetal Ore', icon: '⭐', value: 1300 },
  celestium_ore: { name: 'Celestium Ore', icon: '✴️', value: 1600 },
  uncut_gem: { name: 'Uncut Gem', icon: '💎', value: 450, rare: true },
  diamond: { name: 'Diamond', icon: '💠', value: 1800, rare: true },

  // Woodcutting
  logs: { name: 'Logs', icon: '🪵', value: 2 },
  birch_logs: { name: 'Birch Logs', icon: '🍃', value: 4 },
  oak_logs: { name: 'Oak Logs', icon: '🌳', value: 7 },
  pine_logs: { name: 'Pine Logs', icon: '🎄', value: 10 },
  willow_logs: { name: 'Willow Logs', icon: '🌿', value: 14 },
  spruce_logs: { name: 'Spruce Logs', icon: '🌲', value: 20 },
  maple_logs: { name: 'Maple Logs', icon: '🍁', value: 28 },
  mahogany_logs: { name: 'Mahogany Logs', icon: '🟫', value: 45 },
  yew_logs: { name: 'Yew Logs', icon: '🌲', value: 75 },
  magic_logs: { name: 'Magic Logs', icon: '✨', value: 125 },
  redwood_logs: { name: 'Redwood Logs', icon: '🔴', value: 180 },
  cedar_logs: { name: 'Cedar Logs', icon: '🎋', value: 200 },
  ebony_logs: { name: 'Ebony Logs', icon: '🖤', value: 280 },
  ironwood_logs: { name: 'Ironwood Logs', icon: '🪓', value: 360 },
  bloodwood_logs: { name: 'Bloodwood Logs', icon: '🍷', value: 460 },
  crystalwood_logs: { name: 'Crystalwood Logs', icon: '🔮', value: 600 },
  spiritwood_logs: { name: 'Spiritwood Logs', icon: '👻', value: 750 },
  dragonwood_logs: { name: 'Dragonwood Logs', icon: '🐲', value: 900 },
  elder_logs: { name: 'Elder Logs', icon: '🌌', value: 1100 },
  yggdrasil_bark: { name: 'Yggdrasil Bark', icon: '🌳', value: 1300 },
  celestial_timber: { name: 'Celestial Timber', icon: '🌠', value: 1600 },
  bird_nest: { name: 'Bird Nest', icon: '🐣', value: 350, rare: true },
  golden_acorn: { name: 'Golden Acorn', icon: '🌰', value: 1600, rare: true },

  // Digging
  old_bone: { name: 'Old Bone', icon: '🦴', value: 2 },
  rusty_coin: { name: 'Rusty Coin', icon: '🪙', value: 6 },
  pottery_shard: { name: 'Pottery Shard', icon: '🧩', value: 12 },
  arrowhead: { name: 'Flint Arrowhead', icon: '🏹', value: 20 },
  fossil: { name: 'Fossil', icon: '🐚', value: 38 },
  ancient_coin: { name: 'Ancient Coin', icon: '📀', value: 60 },
  crystal_skull: { name: 'Crystal Skull', icon: '💀', value: 100 },
  dragon_relic: { name: 'Dragon Relic', icon: '🐉', value: 170 },
  golden_idol: { name: 'Golden Idol', icon: '🗿', value: 200 },
  mammoth_tusk: { name: 'Mammoth Tusk', icon: '🐘', value: 280 },
  pharaoh_mask: { name: "Pharaoh's Mask", icon: '🎭', value: 360 },
  ancient_scroll: { name: 'Ancient Scroll', icon: '📜', value: 460 },
  meteorite: { name: 'Meteorite', icon: '☄️', value: 600 },
  atlantean_relic: { name: 'Atlantean Relic', icon: '🏛️', value: 750 },
  titan_fossil: { name: 'Titan Fossil', icon: '🦖', value: 900 },
  philosophers_stone: { name: "Philosopher's Stone", icon: '🧿', value: 1100 },
  crown_of_kings: { name: 'Crown of Kings', icon: '👑', value: 1300 },
  heart_of_the_world: { name: 'Heart of the World', icon: '💖', value: 1600 },
  treasure_map: { name: 'Treasure Map', icon: '🗺️', value: 450, rare: true },
  pirate_chest: { name: "Pirate's Chest", icon: '🧰', value: 2000, rare: true },

  // Smelting (item ids keep their original "_bar" names so existing inventories carry over)
  bronze_bar: { name: 'Bronze Alloy', icon: '🟤', value: 10 },
  iron_bar: { name: 'Iron Ingot', icon: '🔩', value: 22 },
  silver_bar: { name: 'Silver Ingot', icon: '🥈', value: 40 },
  sterling_bar: { name: 'Sterling Alloy', icon: '🪙', value: 32 },
  steel_bar: { name: 'Steel Alloy', icon: '⚙️', value: 60 },
  gold_bar: { name: 'Gold Ingot', icon: '🟨', value: 80 },
  mithril_bar: { name: 'Mithril Alloy', icon: '🔷', value: 170 },
  adamantite_bar: { name: 'Adamantite Alloy', icon: '🟩', value: 270 },
  runite_bar: { name: 'Runite Alloy', icon: '🟦', value: 420 },
  cobalt_bar: { name: 'Cobalt Ingot', icon: '🔵', value: 260 },
  obsidian_steel_bar: { name: 'Obsidian Steel Alloy', icon: '⬛', value: 410 },
  titanium_bar: { name: 'Titanium Ingot', icon: '🔘', value: 470 },
  orichalcum_bar: { name: 'Orichalcum Alloy', icon: '🟡', value: 705 },
  platinum_bar: { name: 'Platinum Ingot', icon: '💿', value: 780 },
  dragonite_bar: { name: 'Dragonite Alloy', icon: '🟥', value: 1070 },
  luminite_bar: { name: 'Luminite Ingot', icon: '💡', value: 1170 },
  void_bar: { name: 'Void Alloy', icon: '🌑', value: 1555 },
  starmetal_bar: { name: 'Starmetal Ingot', icon: '⭐', value: 1690 },
  celestium_bar: { name: 'Celestium Alloy', icon: '✴️', value: 3925 },

  // Tools you carry. "keep" items are skipped by "!sell all" (sell them by name if you really want to).
  smithing_hammer: { name: 'Smithing Hammer', icon: '🔨', value: 250, keep: true },
  skinning_knife: { name: 'Skinning Knife', icon: '🔪', value: 250, keep: true },

  // Skinning
  rabbit_hide: { name: 'Rabbit Hide', icon: '🐇', value: 2 },
  squirrel_pelt: { name: 'Squirrel Pelt', icon: '🐿️', value: 5 },
  fox_pelt: { name: 'Fox Pelt', icon: '🦊', value: 9 },
  deer_hide: { name: 'Deer Hide', icon: '🦌', value: 16 },
  boar_hide: { name: 'Boar Hide', icon: '🐗', value: 26 },
  bear_pelt: { name: 'Bear Pelt', icon: '🐻', value: 40 },
  bison_hide: { name: 'Bison Hide', icon: '🦬', value: 62 },
  tiger_pelt: { name: 'Tiger Pelt', icon: '🐅', value: 90 },
  crocodile_skin: { name: 'Crocodile Skin', icon: '🐊', value: 130 },
  polar_bear_pelt: { name: 'Polar Bear Pelt', icon: '❄️', value: 200 },
  snow_leopard_pelt: { name: 'Snow Leopard Pelt', icon: '🐆', value: 280 },
  mammoth_hide: { name: 'Mammoth Hide', icon: '🐘', value: 360 },
  wyvern_hide: { name: 'Wyvern Hide', icon: '🦎', value: 460 },
  basilisk_skin: { name: 'Basilisk Skin', icon: '🐍', value: 600 },
  chimera_hide: { name: 'Chimera Hide', icon: '🦁', value: 750 },
  griffin_pelt: { name: 'Griffin Pelt', icon: '🦅', value: 900 },
  behemoth_hide: { name: 'Behemoth Hide', icon: '🦏', value: 1100 },
  kraken_skin: { name: 'Kraken Skin', icon: '🦑', value: 1300 },
  celestial_fleece: { name: 'Celestial Fleece', icon: '🐑', value: 1600 },
  perfect_pelt: { name: 'Perfect Pelt', icon: '🧥', value: 450, rare: true },
  golden_fleece: { name: 'Golden Fleece', icon: '🌟', value: 1800, rare: true },

  // Monster loot (Swords / !fight)
  feathers: { name: 'Feathers', icon: '🪶', value: 2 },
  raw_chicken: { name: 'Raw Chicken', icon: '🍗', value: 4 },
  rat_tail: { name: 'Rat Tail', icon: '🐀', value: 6 },
  cheese: { name: 'Cheese', icon: '🧀', value: 9 },
  goblin_ear: { name: 'Goblin Ear', icon: '👂', value: 12 },
  goblin_pouch: { name: 'Goblin Pouch', icon: '👛', value: 16 },
  wolf_pelt: { name: 'Wolf Pelt', icon: '🐺', value: 20 },
  wolf_fang: { name: 'Wolf Fang', icon: '🦷', value: 24 },
  bandit_mask: { name: 'Bandit Mask', icon: '🎭', value: 30 },
  stolen_goods: { name: 'Stolen Goods', icon: '📦', value: 36 },
  bone_dust: { name: 'Bone Dust', icon: '🦴', value: 40 },
  cursed_skull: { name: 'Cursed Skull', icon: '☠️', value: 48 },
  orc_tusk: { name: 'Orc Tusk', icon: '🐗', value: 55 },
  war_paint: { name: 'Orc War Paint', icon: '🎨', value: 62 },
  troll_hide: { name: 'Troll Hide', icon: '🧌', value: 80 },
  troll_club: { name: 'Troll Club', icon: '🏏', value: 90 },
  ogre_tooth: { name: 'Ogre Tooth', icon: '🦷', value: 110 },
  ogre_belt: { name: 'Ogre Belt', icon: '🥋', value: 125 },
  spider_silk: { name: 'Spider Silk', icon: '🕸️', value: 200 },
  venom_sac: { name: 'Venom Sac', icon: '🧪', value: 225 },
  ectoplasm: { name: 'Ectoplasm', icon: '👻', value: 280 },
  wraith_shroud: { name: 'Wraith Shroud', icon: '🌫️', value: 310 },
  minotaur_horn: { name: 'Minotaur Horn', icon: '🐂', value: 360 },
  labyrinth_key: { name: 'Labyrinth Key', icon: '🗝️', value: 390 },
  wyvern_scale: { name: 'Wyvern Scale', icon: '🦎', value: 460 },
  wyvern_claw: { name: 'Wyvern Claw', icon: '🪝', value: 490 },
  hydra_head: { name: 'Hydra Head', icon: '🐍', value: 600 },
  hydra_blood: { name: 'Hydra Blood', icon: '🩸', value: 640 },
  demon_horn: { name: 'Demon Horn', icon: '😈', value: 750 },
  infernal_ash: { name: 'Infernal Ash', icon: '🌋', value: 790 },
  frost_core: { name: 'Frost Core', icon: '❄️', value: 900 },
  giant_toe: { name: "Giant's Toenail", icon: '🦶', value: 940 },
  dragon_scale: { name: 'Dragon Scale', icon: '🐉', value: 1100 },
  dragon_bone: { name: 'Dragon Bone', icon: '🦴', value: 1150 },
  phylactery: { name: 'Phylactery', icon: '⚱️', value: 1300 },
  soul_gem: { name: 'Soul Gem', icon: '💜', value: 1360 },
  elder_heart: { name: 'Elder Dragon Heart', icon: '❤️‍🔥', value: 1600 },
  ancient_scale: { name: 'Ancient Scale', icon: '🐲', value: 1680 },
  golden_egg: { name: 'Golden Egg', icon: '🥚', value: 400, rare: true },
  goblin_crown: { name: 'Goblin Crown', icon: '👑', value: 900, rare: true },
  dragon_egg: { name: 'Dragon Egg', icon: '🥚', value: 5000, rare: true },
};

// ---- Smithable gear ---------------------------------------------------------
// One set per alloy: a sword and four armor pieces. Smith with "!smith steel sword" (needs a Smithing
// Hammer in your backpack), then "!equip steel sword". Weapons need that level in their combat skill
// (Swords for swords); armor needs that Combat level (your best combat skill).
const METALS = [
  // id, name, alloy used, Smithing level to make, level to wear, sword attack, armor base defence
  ['bronze', 'Bronze', 'bronze_bar', 1, 1, 4, 2],
  ['steel', 'Steel', 'steel_bar', 30, 20, 10, 4],
  ['mithril', 'Mithril', 'mithril_bar', 55, 40, 18, 7],
  ['adamant', 'Adamant', 'adamantite_bar', 70, 60, 28, 11],
  ['rune', 'Rune', 'runite_bar', 85, 80, 40, 16],
  ['obsidian', 'Obsidian', 'obsidian_steel_bar', 130, 100, 55, 22],
  ['orichalcum', 'Orichalcum', 'orichalcum_bar', 200, 150, 75, 30],
  ['dragonite', 'Dragonite', 'dragonite_bar', 300, 250, 110, 44],
  ['void', 'Void', 'void_bar', 400, 350, 150, 60],
  ['celestial', 'Celestial', 'celestium_bar', 500, 450, 200, 80],
];
const PIECES = [
  // piece, name, icon, slot, alloys needed, defence multiplier (armor)
  ['sword', 'Sword', '🗡️', 'weapon', 2, 0],
  ['helmet', 'Helmet', '⛑️', 'head', 1, 1],
  ['shield', 'Shield', '🛡️', 'shield', 2, 1.5],
  ['platelegs', 'Platelegs', '👖', 'legs', 3, 2],
  ['platebody', 'Platebody', '👕', 'body', 4, 3],
];
// Where equipped gear goes, in display order.
const GEAR_SLOTS = ['weapon', 'head', 'body', 'legs', 'shield'];

const SMITHING_RECIPES = [];
for (const [metal, metalName, alloy, smithLevel, wearLevel, attack, baseDef] of METALS) {
  for (const [piece, pieceName, icon, slot, bars, defMul] of PIECES) {
    const id = `${metal}_${piece}`;
    const isWeapon = slot === 'weapon';
    ITEMS[id] = {
      name: `${metalName} ${pieceName}`,
      icon,
      value: Math.round(ITEMS[alloy].value * bars * 1.3),
      keep: true,
      gear: true,
      slot,
      level: wearLevel,
      ...(isWeapon ? { weaponType: 'sword', attack } : { defence: Math.round(baseDef * defMul) }),
    };
    SMITHING_RECIPES.push({ item: id, level: smithLevel, bars, alloy, kind: isWeapon ? 'weapon' : 'armor' });
  }
}


// Every skill has an upgradable tool (!upgrade rod / pickaxe / axe / shovel / furnace). They all follow
// the same ladder: everyone starts with tier 1, a new tier unlocks every 50 levels of that skill and costs
// points. failChance = chance an action fails, xpBonus = extra XP (0.1 = +10%), rareBonus = multiplier
// on rare-find odds, doubleChance = chance to make two instead of one (furnaces). Prices and stats can be
// changed live on the admin page.
const TOOL_LADDER = [
  { level: 1, cost: 0, failChance: 0.18, xpBonus: 0, rareBonus: 1 },
  { level: 50, cost: 2000, failChance: 0.15, xpBonus: 0.1, rareBonus: 1.1 },
  { level: 100, cost: 10000, failChance: 0.13, xpBonus: 0.2, rareBonus: 1.2 },
  { level: 150, cost: 30000, failChance: 0.11, xpBonus: 0.3, rareBonus: 1.3 },
  { level: 200, cost: 75000, failChance: 0.09, xpBonus: 0.4, rareBonus: 1.4 },
  { level: 250, cost: 150000, failChance: 0.075, xpBonus: 0.55, rareBonus: 1.5 },
  { level: 300, cost: 300000, failChance: 0.06, xpBonus: 0.7, rareBonus: 1.65 },
  { level: 350, cost: 500000, failChance: 0.045, xpBonus: 0.85, rareBonus: 1.8 },
  { level: 400, cost: 800000, failChance: 0.035, xpBonus: 1, rareBonus: 2 },
  { level: 450, cost: 1250000, failChance: 0.02, xpBonus: 1.25, rareBonus: 2.5 },
];
const FURNACE_DOUBLE_CHANCE = [0, 0.03, 0.06, 0.09, 0.12, 0.15, 0.18, 0.22, 0.26, 0.3];

// [name, icon] for each of the 10 tiers -> full tier objects.
const toolTiers = (names, extra = () => ({})) => names.map(([name, icon], i) => ({ name, icon, ...TOOL_LADDER[i], ...extra(i) }));

const SKILLS = {
  fishing: {
    name: 'Fishing',
    icon: '🎣',
    command: 'fish',
    verb: 'caught',
    type: 'gather',
    maxLevel: 500,
    failMessages: ['nothing is biting', 'the line snapped', 'a seagull stole your catch'],
    resources: [
      { item: 'shrimp', level: 1, xp: 10 },
      { item: 'sardine', level: 5, xp: 18 },
      { item: 'herring', level: 10, xp: 26 },
      { item: 'trout', level: 20, xp: 40 },
      { item: 'salmon', level: 30, xp: 55 },
      { item: 'tuna', level: 40, xp: 75 },
      { item: 'lobster', level: 50, xp: 100 },
      { item: 'swordfish', level: 65, xp: 135 },
      { item: 'shark', level: 80, xp: 180 },
      { item: 'anglerfish', level: 100, xp: 280 },
      { item: 'manta_ray', level: 130, xp: 390 },
      { item: 'giant_squid', level: 160, xp: 500 },
      { item: 'giant_octopus', level: 200, xp: 640 },
      { item: 'abyssal_eel', level: 250, xp: 820 },
      { item: 'blue_marlin', level: 300, xp: 1000 },
      { item: 'coelacanth', level: 350, xp: 1200 },
      { item: 'sea_serpent', level: 400, xp: 1420 },
      { item: 'leviathan', level: 450, xp: 1650 },
      { item: 'celestial_whale', level: 500, xp: 1900 },
    ],
    tool: {
      id: 'rod',
      name: 'Rod',
      failWord: 'snap',
      stats: ['failChance', 'xpBonus', 'rareBonus'],
      tiers: toolTiers([
        ['Basic Rod', '🎣'], ['Oak Rod', '🌳'], ['Willow Rod', '🌿'], ['Maple Rod', '🍁'], ['Yew Rod', '🌲'],
        ['Steel Rod', '⚙️'], ['Mithril Rod', '🔷'], ['Adamant Rod', '🟢'], ['Runite Rod', '🔹'], ["Poseidon's Rod", '🔱'],
      ]),
    },
    rares: [
      { item: 'message_bottle', chance: 1 / 120, xp: 150 },
      { item: 'golden_fish', chance: 1 / 1000, xp: 750 },
    ],
  },
  mining: {
    name: 'Mining',
    icon: '⛏️',
    command: 'mine',
    verb: 'mined',
    type: 'gather',
    maxLevel: 500,
    failMessages: ['your pickaxe bounced off the rock', 'the vein was empty', 'you mined only dust'],
    resources: [
      { item: 'copper_ore', level: 1, xp: 10 },
      { item: 'tin_ore', level: 1, xp: 10 },
      { item: 'iron_ore', level: 15, xp: 30 },
      { item: 'silver_ore', level: 20, xp: 38 },
      { item: 'coal', level: 30, xp: 50 },
      { item: 'gold_ore', level: 40, xp: 70 },
      { item: 'mithril_ore', level: 55, xp: 100 },
      { item: 'adamantite_ore', level: 70, xp: 135 },
      { item: 'runite_ore', level: 85, xp: 185 },
      { item: 'cobalt_ore', level: 100, xp: 280 },
      { item: 'obsidian', level: 130, xp: 390 },
      { item: 'titanium_ore', level: 160, xp: 500 },
      { item: 'orichalcum_ore', level: 200, xp: 640 },
      { item: 'platinum_ore', level: 250, xp: 820 },
      { item: 'dragonite_ore', level: 300, xp: 1000 },
      { item: 'luminite_ore', level: 350, xp: 1200 },
      { item: 'void_ore', level: 400, xp: 1420 },
      { item: 'starmetal_ore', level: 450, xp: 1650 },
      { item: 'celestium_ore', level: 500, xp: 1900 },
    ],
    tool: {
      id: 'pickaxe',
      name: 'Pickaxe',
      failWord: 'miss',
      stats: ['failChance', 'xpBonus', 'rareBonus'],
      tiers: toolTiers([
        ['Bronze Pickaxe', '⛏️'], ['Iron Pickaxe', '🔩'], ['Steel Pickaxe', '⚙️'], ['Mithril Pickaxe', '🔷'], ['Adamant Pickaxe', '🟢'],
        ['Runite Pickaxe', '🔹'], ['Cobalt Pickaxe', '🔵'], ['Titanium Pickaxe', '🔘'], ['Dragon Pickaxe', '🐲'], ['Celestial Pickaxe', '🌠'],
      ]),
    },
    rares: [
      { item: 'uncut_gem', chance: 1 / 120, xp: 150 },
      { item: 'diamond', chance: 1 / 1000, xp: 750 },
    ],
  },
  woodcutting: {
    name: 'Woodcutting',
    icon: '🪓',
    command: 'chop',
    verb: 'chopped',
    type: 'gather',
    maxLevel: 500,
    failMessages: ['your axe got stuck', 'the tree refused to fall', 'you swung and missed'],
    resources: [
      { item: 'logs', level: 1, xp: 10 },
      { item: 'birch_logs', level: 8, xp: 16 },
      { item: 'oak_logs', level: 15, xp: 25 },
      { item: 'pine_logs', level: 22, xp: 34 },
      { item: 'willow_logs', level: 30, xp: 45 },
      { item: 'spruce_logs', level: 38, xp: 58 },
      { item: 'maple_logs', level: 45, xp: 70 },
      { item: 'mahogany_logs', level: 55, xp: 90 },
      { item: 'yew_logs', level: 65, xp: 120 },
      { item: 'magic_logs', level: 78, xp: 165 },
      { item: 'redwood_logs', level: 90, xp: 210 },
      { item: 'cedar_logs', level: 100, xp: 280 },
      { item: 'ebony_logs', level: 130, xp: 390 },
      { item: 'ironwood_logs', level: 160, xp: 500 },
      { item: 'bloodwood_logs', level: 200, xp: 640 },
      { item: 'crystalwood_logs', level: 250, xp: 820 },
      { item: 'spiritwood_logs', level: 300, xp: 1000 },
      { item: 'dragonwood_logs', level: 350, xp: 1200 },
      { item: 'elder_logs', level: 400, xp: 1420 },
      { item: 'yggdrasil_bark', level: 450, xp: 1650 },
      { item: 'celestial_timber', level: 500, xp: 1900 },
    ],
    tool: {
      id: 'axe',
      name: 'Axe',
      failWord: 'miss',
      stats: ['failChance', 'xpBonus', 'rareBonus'],
      tiers: toolTiers([
        ['Bronze Axe', '🪓'], ['Iron Axe', '🔩'], ['Steel Axe', '⚙️'], ['Mithril Axe', '🔷'], ['Adamant Axe', '🟢'],
        ['Runite Axe', '🔹'], ['Cobalt Axe', '🔵'], ['Titanium Axe', '🔘'], ['Dragon Axe', '🐲'], ['Celestial Axe', '🌠'],
      ]),
    },
    rares: [
      { item: 'bird_nest', chance: 1 / 120, xp: 150 },
      { item: 'golden_acorn', chance: 1 / 1000, xp: 750 },
    ],
  },
  digging: {
    name: 'Digging',
    icon: '🏺',
    command: 'dig',
    verb: 'dug up',
    type: 'gather',
    maxLevel: 500,
    failMessages: ['you found only dirt', 'you hit bedrock', 'a mole ran off with your find'],
    resources: [
      { item: 'old_bone', level: 1, xp: 10 },
      { item: 'rusty_coin', level: 8, xp: 20 },
      { item: 'pottery_shard', level: 18, xp: 34 },
      { item: 'arrowhead', level: 28, xp: 48 },
      { item: 'fossil', level: 40, xp: 70 },
      { item: 'ancient_coin', level: 52, xp: 95 },
      { item: 'crystal_skull', level: 68, xp: 130 },
      { item: 'dragon_relic', level: 85, xp: 190 },
      { item: 'golden_idol', level: 100, xp: 280 },
      { item: 'mammoth_tusk', level: 130, xp: 390 },
      { item: 'pharaoh_mask', level: 160, xp: 500 },
      { item: 'ancient_scroll', level: 200, xp: 640 },
      { item: 'meteorite', level: 250, xp: 820 },
      { item: 'atlantean_relic', level: 300, xp: 1000 },
      { item: 'titan_fossil', level: 350, xp: 1200 },
      { item: 'philosophers_stone', level: 400, xp: 1420 },
      { item: 'crown_of_kings', level: 450, xp: 1650 },
      { item: 'heart_of_the_world', level: 500, xp: 1900 },
    ],
    tool: {
      id: 'shovel',
      name: 'Shovel',
      failWord: 'miss',
      stats: ['failChance', 'xpBonus', 'rareBonus'],
      tiers: toolTiers([
        ['Wooden Shovel', '🥄'], ['Iron Shovel', '🔩'], ['Steel Shovel', '⚙️'], ['Mithril Shovel', '🔷'], ['Adamant Shovel', '🟢'],
        ['Runite Shovel', '🔹'], ['Cobalt Shovel', '🔵'], ['Titanium Shovel', '🔘'], ['Dragon Shovel', '🐲'], ['Celestial Shovel', '🌠'],
      ]),
    },
    rares: [
      { item: 'treasure_map', chance: 1 / 120, xp: 150 },
      { item: 'pirate_chest', chance: 1 / 1000, xp: 750 },
    ],
  },
  skinning: {
    name: 'Skinning',
    icon: '🔪',
    command: 'skin',
    verb: 'skinned',
    type: 'gather',
    maxLevel: 500,
    // Needs this item in the backpack (buy it, or smith it at Smithing 20 from a Sterling Alloy). Not used up.
    requires: 'skinning_knife',
    failMessages: ['the animal ran off', 'you nicked the hide and ruined it', 'you only found tracks'],
    resources: [
      { item: 'rabbit_hide', level: 1, xp: 10 },
      { item: 'squirrel_pelt', level: 8, xp: 18 },
      { item: 'fox_pelt', level: 15, xp: 28 },
      { item: 'deer_hide', level: 25, xp: 42 },
      { item: 'boar_hide', level: 35, xp: 58 },
      { item: 'bear_pelt', level: 45, xp: 75 },
      { item: 'bison_hide', level: 60, xp: 110 },
      { item: 'tiger_pelt', level: 75, xp: 145 },
      { item: 'crocodile_skin', level: 90, xp: 190 },
      { item: 'polar_bear_pelt', level: 100, xp: 280 },
      { item: 'snow_leopard_pelt', level: 130, xp: 390 },
      { item: 'mammoth_hide', level: 160, xp: 500 },
      { item: 'wyvern_hide', level: 200, xp: 640 },
      { item: 'basilisk_skin', level: 250, xp: 820 },
      { item: 'chimera_hide', level: 300, xp: 1000 },
      { item: 'griffin_pelt', level: 350, xp: 1200 },
      { item: 'behemoth_hide', level: 400, xp: 1420 },
      { item: 'kraken_skin', level: 450, xp: 1650 },
      { item: 'celestial_fleece', level: 500, xp: 1900 },
    ],
    rares: [
      { item: 'perfect_pelt', chance: 1 / 120, xp: 150 },
      { item: 'golden_fleece', chance: 1 / 1000, xp: 750 },
    ],
  },
  farming: {
    name: 'Farming',
    icon: '🌱',
    command: 'plant', // also !harvest and !farm
    verb: 'harvested',
    type: 'farm',
    maxLevel: 500,
    resources: [], // crops, filled in below
  },
  smelting: {
    name: 'Smelting',
    icon: '🔥',
    command: 'smelt',
    verb: 'smelted',
    type: 'process',
    maxLevel: 500,
    failMessages: ['the ore was impure and burned away'],
    // Recipes are ordered from lowest to highest level. Ingots are smelted from one kind of ore;
    // alloys mix ores. The ores come out of the backpack, so you have to !mine them first.
    recipes: [
      { item: 'bronze_bar', level: 1, xp: 14, kind: 'alloy', inputs: { copper_ore: 1, tin_ore: 1 } },
      { item: 'iron_bar', level: 15, xp: 30, kind: 'ingot', inputs: { iron_ore: 1 } },
      { item: 'silver_bar', level: 20, xp: 40, kind: 'ingot', inputs: { silver_ore: 1 } },
      { item: 'sterling_bar', level: 20, xp: 45, kind: 'alloy', inputs: { silver_ore: 1, copper_ore: 1 } },
      { item: 'steel_bar', level: 30, xp: 60, kind: 'alloy', inputs: { iron_ore: 1, coal: 2 } },
      { item: 'gold_bar', level: 40, xp: 80, kind: 'ingot', inputs: { gold_ore: 1 } },
      { item: 'mithril_bar', level: 55, xp: 120, kind: 'alloy', inputs: { mithril_ore: 1, coal: 3 } },
      { item: 'adamantite_bar', level: 70, xp: 170, kind: 'alloy', inputs: { adamantite_ore: 1, coal: 4 } },
      { item: 'runite_bar', level: 85, xp: 240, kind: 'alloy', inputs: { runite_ore: 1, coal: 5 } },
      { item: 'cobalt_bar', level: 100, xp: 280, kind: 'ingot', inputs: { cobalt_ore: 1 } },
      { item: 'obsidian_steel_bar', level: 130, xp: 390, kind: 'alloy', inputs: { obsidian: 1, iron_ore: 1, coal: 2 } },
      { item: 'titanium_bar', level: 160, xp: 500, kind: 'ingot', inputs: { titanium_ore: 1 } },
      { item: 'orichalcum_bar', level: 200, xp: 640, kind: 'alloy', inputs: { orichalcum_ore: 1, gold_ore: 1, coal: 4 } },
      { item: 'platinum_bar', level: 250, xp: 820, kind: 'ingot', inputs: { platinum_ore: 1 } },
      { item: 'dragonite_bar', level: 300, xp: 1000, kind: 'alloy', inputs: { dragonite_ore: 1, coal: 6 } },
      { item: 'luminite_bar', level: 350, xp: 1200, kind: 'ingot', inputs: { luminite_ore: 1 } },
      { item: 'void_bar', level: 400, xp: 1420, kind: 'alloy', inputs: { void_ore: 1, coal: 8 } },
      { item: 'starmetal_bar', level: 450, xp: 1650, kind: 'ingot', inputs: { starmetal_ore: 1 } },
      { item: 'celestium_bar', level: 500, xp: 1900, kind: 'alloy', inputs: { celestium_ore: 1, starmetal_ore: 1, coal: 10 } },
    ],
    // Smelting never fails; better furnaces give bonus XP and a chance to smelt two for the price of one.
    tool: {
      id: 'furnace',
      name: 'Furnace',
      stats: ['xpBonus', 'doubleChance'],
      tiers: toolTiers(
        [
          ['Clay Furnace', '🧱'], ['Stone Furnace', '🪨'], ['Brick Furnace', '🏠'], ['Iron Furnace', '🔩'], ['Steel Furnace', '⚙️'],
          ['Blast Furnace', '💥'], ['Mithril Forge', '🔷'], ['Runic Forge', '🔹'], ['Dragonfire Forge', '🐲'], ['Celestial Forge', '🌠'],
        ],
        (i) => ({ failChance: 0, rareBonus: 1, doubleChance: FURNACE_DOUBLE_CHANCE[i] })
      ),
    },
  },
  smithing: {
    name: 'Smithing',
    icon: '⚒️',
    command: 'smith',
    verb: 'smithed',
    type: 'process',
    maxLevel: 500,
    // Needs this item in the backpack (buy it in the shop). Not used up.
    requires: 'smithing_hammer',
    // Players must say what to make ("!smith bronze sword"); a bare "!smith" lists what they can make.
    pickBest: false,
    failMessages: ['the metal cracked'],
    recipes: [], // filled in below from SMITHING_RECIPES
  },
  swords: {
    name: 'Swords',
    icon: '🗡️',
    command: 'fight',
    verb: 'defeated',
    type: 'combat',
    maxLevel: 500,
    // !fight uses the best weapon you own for the combat skill you're highest in. Swords use swords;
    // future combat skills (bows, battleaxes...) plug in with their own weaponType.
    weaponType: 'sword',
    // power = how hard it is to hit, damage = how hard it hits back. loot: one of these per win.
    monsters: [], // filled in below
  },
};

// Smithing XP: what smelting the alloys gave, plus 20%.
SKILLS.smithing.recipes = SMITHING_RECIPES.map(({ item, level, bars, alloy, kind }) => ({
  item,
  level,
  kind,
  xp: Math.round((SKILLS.smelting.recipes.find((r) => r.item === alloy).xp * bars * 1.2)),
  inputs: { [alloy]: bars },
}));
// Tools you can smith instead of buying.
SKILLS.smithing.recipes.push({ item: 'skinning_knife', level: 20, kind: 'tool', xp: 55, inputs: { sterling_bar: 1 } });
SKILLS.smithing.recipes.sort((a, b) => a.level - b.level);

// Monsters for !fight. Level = Swords level needed. Stats are tuned so that at the monster's level,
// with gear for that level, you win about 3 fights in 4; better gear or more levels push it higher.
const MONSTER_LIST = [
  // id, name, icon, level, xp, [loot, loot], rare?
  ['chicken', 'Chicken', '🐔', 1, 10, ['feathers', 'raw_chicken'], { item: 'golden_egg', chance: 1 / 150 }],
  ['giant_rat', 'Giant Rat', '🐀', 5, 18, ['rat_tail', 'cheese']],
  ['goblin', 'Goblin', '👺', 10, 26, ['goblin_ear', 'goblin_pouch'], { item: 'goblin_crown', chance: 1 / 200 }],
  ['wolf', 'Wolf', '🐺', 20, 40, ['wolf_pelt', 'wolf_fang']],
  ['bandit', 'Bandit', '🥷', 30, 55, ['bandit_mask', 'stolen_goods']],
  ['skeleton', 'Skeleton', '💀', 40, 75, ['bone_dust', 'cursed_skull']],
  ['orc', 'Orc', '👹', 55, 105, ['orc_tusk', 'war_paint']],
  ['troll', 'Troll', '🧌', 70, 140, ['troll_hide', 'troll_club']],
  ['ogre', 'Ogre', '👾', 85, 185, ['ogre_tooth', 'ogre_belt']],
  ['giant_spider', 'Giant Spider', '🕷️', 100, 280, ['spider_silk', 'venom_sac']],
  ['wraith', 'Wraith', '👻', 130, 390, ['ectoplasm', 'wraith_shroud']],
  ['minotaur', 'Minotaur', '🐂', 160, 500, ['minotaur_horn', 'labyrinth_key']],
  ['wyvern', 'Wyvern', '🦎', 200, 640, ['wyvern_scale', 'wyvern_claw']],
  ['hydra', 'Hydra', '🐍', 250, 820, ['hydra_head', 'hydra_blood']],
  ['demon', 'Demon', '😈', 300, 1000, ['demon_horn', 'infernal_ash']],
  ['frost_giant', 'Frost Giant', '🥶', 350, 1200, ['frost_core', 'giant_toe']],
  ['dragon', 'Dragon', '🐉', 400, 1420, ['dragon_scale', 'dragon_bone'], { item: 'dragon_egg', chance: 1 / 500 }],
  ['lich_king', 'Lich King', '🧙', 450, 1650, ['phylactery', 'soul_gem']],
  ['elder_dragon', 'Elder Dragon', '🐲', 500, 1900, ['elder_heart', 'ancient_scale'], { item: 'dragon_egg', chance: 1 / 200 }],
];
// Gear someone at level L would usually have: the best metal they can wear.
const metalFor = (level) => [...METALS].reverse().find((m) => m[4] <= level);
SKILLS.swords.monsters = MONSTER_LIST.map(([id, name, icon, level, xp, loot, rare]) => {
  const m = metalFor(level);
  const fullSetDefence = PIECES.reduce((sum, p) => sum + Math.round(m[6] * p[5]), 0);
  return {
    id,
    name,
    icon,
    level,
    xp,
    power: level === 1 ? 3 : Math.round(level + m[5]), // matches your attack (level + sword) at par; chickens are easy
    damage: level <= 5 ? level - 1 : Math.round(fullSetDefence * 0.9), // chickens and rats barely hit back
    loot,
    rare: rare || null,
  };
});

// ---- Farming ---------------------------------------------------------------------
// Buy plots and seeds, "!plant carrot" puts one seed in each empty plot, and "!harvest" collects
// what's grown. Each plot holds one crop and yields a few of it. Crops are sold for now; later they
// can feed potions and food. Value and XP scale with the Farming level needed.
const CROP_LIST = [
  // id, name, icon, Farming level, vegetable|herb
  ['carrot', 'Carrot', '🥕', 1, 'vegetable'],
  ['potato', 'Potato', '🥔', 5, 'vegetable'],
  ['parsley', 'Parsley', '🌿', 10, 'herb'],
  ['onion', 'Onion', '🧅', 15, 'vegetable'],
  ['cabbage', 'Cabbage', '🥬', 20, 'vegetable'],
  ['mint', 'Mint', '🍃', 25, 'herb'],
  ['tomato', 'Tomato', '🍅', 30, 'vegetable'],
  ['basil', 'Basil', '🌱', 35, 'herb'],
  ['corn', 'Corn', '🌽', 40, 'vegetable'],
  ['chamomile', 'Chamomile', '🌼', 45, 'herb'],
  ['garlic', 'Garlic', '🧄', 50, 'vegetable'],
  ['thyme', 'Thyme', '☘️', 55, 'herb'],
  ['bell_pepper', 'Bell Pepper', '🫑', 60, 'vegetable'],
  ['lavender', 'Lavender', '💜', 65, 'herb'],
  ['eggplant', 'Eggplant', '🍆', 70, 'vegetable'],
  ['sage', 'Sage', '🍀', 75, 'herb'],
  ['pumpkin', 'Pumpkin', '🎃', 80, 'vegetable'],
  ['rosemary', 'Rosemary', '🌾', 85, 'herb'],
  ['chili_pepper', 'Chili Pepper', '🌶️', 90, 'vegetable'],
  ['ginseng', 'Ginseng', '🌰', 95, 'herb'],
  ['watermelon', 'Watermelon', '🍉', 100, 'vegetable'],
  ['snapdragon', 'Snapdragon', '🌺', 120, 'herb'],
  ['starfruit', 'Starfruit', '⭐', 140, 'vegetable'],
  ['moonpetal', 'Moonpetal', '🌙', 160, 'herb'],
  ['dragonfruit', 'Dragonfruit', '🍈', 180, 'vegetable'],
  ['mandrake', 'Mandrake Root', '😱', 200, 'herb'],
  ['frostleaf', 'Frostleaf', '❄️', 220, 'herb'],
  ['sunbloom', 'Sunbloom', '🌻', 240, 'herb'],
  ['bloodroot', 'Bloodroot', '🩸', 260, 'herb'],
  ['ghost_pepper', 'Ghost Pepper', '👻', 280, 'vegetable'],
  ['silverleaf', 'Silverleaf', '🍂', 300, 'herb'],
  ['emberroot', 'Emberroot', '🔥', 320, 'herb'],
  ['stormvine', 'Stormvine', '⛈️', 340, 'herb'],
  ['crystal_melon', 'Crystal Melon', '💎', 360, 'vegetable'],
  ['nightshade', 'Nightshade', '🌑', 380, 'herb'],
  ['golden_pumpkin', 'Golden Pumpkin', '🟡', 400, 'vegetable'],
  ['phoenix_pepper', 'Phoenix Pepper', '🌋', 420, 'vegetable'],
  ['dreamroot', 'Dreamroot', '💤', 440, 'herb'],
  ['starbloom', 'Starbloom', '🌟', 460, 'herb'],
  ['voidcap', 'Voidcap', '🍄', 480, 'herb'],
  ['world_tree_fruit', 'World Tree Fruit', '🍎', 500, 'vegetable'],
];
const cropValue = (level) => Math.round(3 + 0.5 * level + 0.0045 * level * level);
const cropXp = (level) => Math.round(10 + 1.6 * level + 0.0045 * level * level);
const growMinutes = (level) => 20 + 5 * Math.floor(level / 40); // carrot 20 min ... level 500: 80 min
const MAX_PLOTS = 100;
ITEMS.farm_plot = { name: 'Farm Plot', icon: '🟫', value: 0, notItem: true };
for (const [id, name, icon, level, kind] of CROP_LIST) {
  const value = cropValue(level);
  ITEMS[id] = { name, icon, value, crop: kind };
  // Seeds are kept by "!sell all" and sell back for half their shop price.
  ITEMS[`${id}_seeds`] = { name: `${name} Seeds`, icon: '🌱', value: Math.max(1, Math.round(value / 4)), keep: true, seedFor: id };
  SKILLS.farming.resources.push({
    item: id,
    level,
    kind,
    xp: cropXp(level),
    seed: `${id}_seeds`,
    seedCost: Math.max(2, Math.round(value / 2)),
    grow: growMinutes(level),
    yield: [2, 4], // crops per plot
  });
}

// Shop (website + "!buy"). Prices can be changed on the admin page.
const SHOP = [
  { item: 'smithing_hammer', cost: 500, description: 'Lets you !smith weapons and armor from alloys. Keep it in your backpack.' },
  { item: 'bronze_sword', cost: 1000, description: "A ready-made sword so you can start fighting with !fight right away. Or smith your own!" },
  { item: 'skinning_knife', cost: 500, description: 'Lets you !skin animals for hides. Keep it in your backpack. Or smith one at Smithing 20 from a Sterling Alloy (silver + copper ore).' },
  { item: 'farm_plot', cost: 750, category: 'farming', description: `A plot of land for !plant. Each holds one crop. Up to ${MAX_PLOTS} plots.` },
  ...SKILLS.farming.resources.map((c) => ({
    item: c.seed,
    cost: c.seedCost,
    category: 'seeds',
    level: c.level,
    description: `Plant with !plant ${ITEMS[c.item].name.split(' ')[0].toLowerCase()} (Farming ${c.level}). Ready in ${c.grow} min, 2-4 ${ITEMS[c.item].name} per plot.`,
  })),
];

// Backpack: how many items (total, across all stacks) a player can carry. Upgrade with
// "!upgrade backpack". Numbers can be changed live on the admin page.
const BACKPACK_TIERS = [
  { name: 'Cloth Pouch', icon: '👝', capacity: 10, cost: 0 },
  { name: 'Leather Satchel', icon: '👜', capacity: 20, cost: 100 },
  { name: 'Travel Pack', icon: '🎒', capacity: 30, cost: 250 },
  { name: "Adventurer's Pack", icon: '🎒', capacity: 40, cost: 500 },
  { name: "Explorer's Pack", icon: '🎒', capacity: 50, cost: 1000 },
  { name: 'Reinforced Pack', icon: '🎒', capacity: 60, cost: 2000 },
  { name: "Merchant's Pack", icon: '💼', capacity: 70, cost: 4000 },
  { name: "Hero's Pack", icon: '🛡️', capacity: 80, cost: 7500 },
  { name: 'Dragonhide Pack', icon: '🐉', capacity: 90, cost: 12500 },
  { name: 'Bag of Holding', icon: '✨', capacity: 100, cost: 20000 },
];

const SKILL_IDS = Object.keys(SKILLS);

// Skills cap at 99 unless they set their own maxLevel (all current skills go to 500).
const DEFAULT_MAX_LEVEL = 99;
const maxLevel = (skillId) => SKILLS[skillId]?.maxLevel || DEFAULT_MAX_LEVEL;

// "rod" -> "fishing", "pickaxe" -> "mining", ...
const TOOL_TO_SKILL = Object.fromEntries(SKILL_IDS.filter((id) => SKILLS[id].tool).map((id) => [SKILLS[id].tool.id, id]));
// Other words players might type for a tool: "!upgrade pick", "!upgrade forge"...
const TOOL_ALIASES = { rod: 'rod', pole: 'rod', pickaxe: 'pickaxe', pick: 'pickaxe', axe: 'axe', hatchet: 'axe', shovel: 'shovel', spade: 'shovel', furnace: 'furnace', forge: 'furnace' };

// "!fish" -> "fishing". Combat skills share one command (!fight), so it maps to the first one;
// the engine then picks the combat skill from your weapons.
const COMMAND_TO_SKILL = {};
for (const id of SKILL_IDS) if (SKILLS[id].type !== 'farm') COMMAND_TO_SKILL[SKILLS[id].command] ??= id; // farming has its own commands
const COMBAT_SKILLS = SKILL_IDS.filter((id) => SKILLS[id].type === 'combat');
// "sword" -> "swords"
const WEAPON_SKILL = Object.fromEntries(COMBAT_SKILLS.map((id) => [SKILLS[id].weaponType, id]));

// Look up an item by a loose name the player typed: "iron", "iron ore", "oak", "steel bar"...
function findItem(query, candidates) {
  const q = String(query || '').toLowerCase().trim().replace(/\s+/g, '_');
  if (!q) return null;
  const list = candidates || Object.keys(ITEMS);
  return (
    list.find((id) => id === q) ||
    list.find((id) => ITEMS[id].name.toLowerCase().replace(/\s+/g, '_') === q) ||
    list.find((id) => id.startsWith(q + '_') || id.startsWith(q)) ||
    list.find((id) => id.endsWith('_' + q)) || // "knife" -> skinning_knife
    null
  );
}

module.exports = {
  ITEMS,
  SKILLS,
  SKILL_IDS,
  BACKPACK_TIERS,
  SHOP,
  MAX_PLOTS,
  GEAR_SLOTS,
  COMMAND_TO_SKILL,
  COMBAT_SKILLS,
  WEAPON_SKILL,
  TOOL_TO_SKILL,
  TOOL_ALIASES,
  maxLevel,
  findItem,
};
