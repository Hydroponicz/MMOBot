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
  uncut_gem: { name: 'Uncut Gem', icon: '💎', value: 450, rare: true },
  diamond: { name: 'Diamond', icon: '💠', value: 1800, rare: true },

  // Woodcutting
  logs: { name: 'Logs', icon: '🪵', value: 2 },
  oak_logs: { name: 'Oak Logs', icon: '🌳', value: 7 },
  willow_logs: { name: 'Willow Logs', icon: '🌿', value: 14 },
  maple_logs: { name: 'Maple Logs', icon: '🍁', value: 28 },
  mahogany_logs: { name: 'Mahogany Logs', icon: '🟫', value: 45 },
  yew_logs: { name: 'Yew Logs', icon: '🌲', value: 75 },
  magic_logs: { name: 'Magic Logs', icon: '✨', value: 125 },
  redwood_logs: { name: 'Redwood Logs', icon: '🔴', value: 180 },
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
  treasure_map: { name: 'Treasure Map', icon: '🗺️', value: 450, rare: true },
  pirate_chest: { name: "Pirate's Chest", icon: '🧰', value: 2000, rare: true },

  // Smelting
  bronze_bar: { name: 'Bronze Bar', icon: '🟤', value: 10 },
  iron_bar: { name: 'Iron Bar', icon: '🔩', value: 22 },
  silver_bar: { name: 'Silver Bar', icon: '🥈', value: 40 },
  steel_bar: { name: 'Steel Bar', icon: '⚙️', value: 60 },
  gold_bar: { name: 'Gold Bar', icon: '🟨', value: 80 },
  mithril_bar: { name: 'Mithril Bar', icon: '🔷', value: 170 },
  adamantite_bar: { name: 'Adamantite Bar', icon: '🟩', value: 270 },
  runite_bar: { name: 'Runite Bar', icon: '🟦', value: 420 },
};

const SKILLS = {
  fishing: {
    name: 'Fishing',
    icon: '🎣',
    command: 'fish',
    verb: 'caught',
    type: 'gather',
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
    ],
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
    ],
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
    failMessages: ['your axe got stuck', 'the tree refused to fall', 'you swung and missed'],
    resources: [
      { item: 'logs', level: 1, xp: 10 },
      { item: 'oak_logs', level: 15, xp: 25 },
      { item: 'willow_logs', level: 30, xp: 45 },
      { item: 'maple_logs', level: 45, xp: 70 },
      { item: 'mahogany_logs', level: 55, xp: 90 },
      { item: 'yew_logs', level: 65, xp: 120 },
      { item: 'magic_logs', level: 78, xp: 165 },
      { item: 'redwood_logs', level: 90, xp: 210 },
    ],
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
    ],
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
    failMessages: ['the ore was impure and burned away'],
    // Recipes are ordered from lowest to highest level.
    recipes: [
      { item: 'bronze_bar', level: 1, xp: 14, inputs: { copper_ore: 1, tin_ore: 1 } },
      { item: 'iron_bar', level: 15, xp: 30, inputs: { iron_ore: 1 } },
      { item: 'silver_bar', level: 20, xp: 40, inputs: { silver_ore: 1 } },
      { item: 'steel_bar', level: 30, xp: 60, inputs: { iron_ore: 1, coal: 2 } },
      { item: 'gold_bar', level: 40, xp: 80, inputs: { gold_ore: 1 } },
      { item: 'mithril_bar', level: 55, xp: 120, inputs: { mithril_ore: 1, coal: 3 } },
      { item: 'adamantite_bar', level: 70, xp: 170, inputs: { adamantite_ore: 1, coal: 4 } },
      { item: 'runite_bar', level: 85, xp: 240, inputs: { runite_ore: 1, coal: 5 } },
    ],
  },
};

const SKILL_IDS = Object.keys(SKILLS);

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

module.exports = { ITEMS, SKILLS, SKILL_IDS, COMMAND_TO_SKILL, findItem };
