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
};

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
};

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

// "!fish" -> "fishing"
const COMMAND_TO_SKILL = Object.fromEntries(SKILL_IDS.map((id) => [SKILLS[id].command, id]));

// Look up an item by a loose name the player typed: "iron", "iron ore", "oak", "steel bar"...
function findItem(query, candidates) {
  const q = String(query || '').toLowerCase().trim().replace(/\s+/g, '_');
  if (!q) return null;
  const list = candidates || Object.keys(ITEMS);
  return (
    list.find((id) => id === q) ||
    list.find((id) => ITEMS[id].name.toLowerCase().replace(/\s+/g, '_') === q) ||
    list.find((id) => id.startsWith(q + '_') || id.startsWith(q)) ||
    null
  );
}

module.exports = { ITEMS, SKILLS, SKILL_IDS, BACKPACK_TIERS, COMMAND_TO_SKILL, TOOL_TO_SKILL, TOOL_ALIASES, maxLevel, findItem };
