// Extra content: cosmetics, pets, race-only items, quest chains. Adds its items to ITEMS and SHOP, so
// require it once before the game uses the item list (shared.js does).
const { ITEMS, SKILLS, SHOP } = require('./skills');

// ---- Cosmetics: bought in the shop, worn on the Customize page. Looks only, no stats. ----------
// They don't take backpack slots and aren't sold by !sell all.
const COSMETICS = [
  // id, name, icon, slot, style (what the avatar draws), cost
  ['party_hat', 'Party Hat', '🥳', 'hat', 'party', 2000],
  ['chef_hat', "Chef's Hat", '👨‍🍳', 'hat', 'chef', 3000],
  ['bunny_ears', 'Bunny Ears', '🐰', 'hat', 'bunny', 4000],
  ['wizard_hat', 'Wizard Hat', '🧙', 'hat', 'wizard', 6000],
  ['top_hat', 'Top Hat', '🎩', 'hat', 'tophat', 8000],
  ['pirate_hat', 'Pirate Hat', '🏴‍☠️', 'hat', 'pirate', 10000],
  ['viking_helm', 'Viking Helm', '🪖', 'hat', 'viking', 12000],
  ['halo', 'Halo', '😇', 'hat', 'halo', 25000],
  ['royal_crown', 'Royal Crown', '👑', 'hat', 'crown', 50000],
  ['red_cape', 'Crimson Cape', '🟥', 'cape', '#b8323a', 5000],
  ['emerald_cape', 'Emerald Cape', '🟩', 'cape', '#2f8f5b', 8000],
  ['royal_cape', 'Royal Purple Cape', '🟪', 'cape', '#6b3fa8', 15000],
  ['shadow_cape', 'Shadow Cape', '⬛', 'cape', '#1d1f26', 20000],
  ['golden_cape', 'Golden Cape', '🟨', 'cape', '#d6a93a', 40000],
  ['frost_aura', 'Frost Aura', '❄️', 'aura', '#7fd8ff', 20000],
  ['flame_aura', 'Flame Aura', '🔥', 'aura', '#ff8a3a', 30000],
  ['toxic_aura', 'Toxic Aura', '☢️', 'aura', '#7dff5a', 40000],
  ['void_aura', 'Void Aura', '🌀', 'aura', '#a45cff', 60000],
  ['golden_aura', 'Golden Aura', '✨', 'aura', '#ffd84a', 100000],
];
for (const [id, name, icon, slot, style, cost] of COSMETICS) {
  ITEMS[id] = { name, icon, value: Math.round(cost / 4), keep: true, cosmetic: { slot, style } };
  SHOP.push({ item: id, cost, category: 'cosmetics', description: `Cosmetic ${slot}: shows on your character on the site and stream overlay. Wear it on the Customize page.` });
}
const COSMETIC_SLOTS = ['hat', 'cape', 'aura'];

// Season winners' cosmetics: can't be bought, sold or traded ("bound").
const SEASON_COSMETICS = [
  // place, id, name, icon, slot, style
  [1, 'champion_crown', "Champion's Crown", '👑', 'hat', 'champion'],
  [1, 'victor_aura', 'Victor Aura', '🏆', 'aura', '#ff4ad8'],
  [2, 'silver_laurel', 'Silver Laurel', '🥈', 'hat', 'laurel-silver'],
  [3, 'bronze_laurel', 'Bronze Laurel', '🥉', 'hat', 'laurel-bronze'],
];
for (const [, id, name, icon, slot, style] of SEASON_COSMETICS) {
  ITEMS[id] = { name, icon, value: 0, keep: true, bound: true, cosmetic: { slot, style } };
}

// Limited-time cosmetics: one is in the shop each week (by UTC week number), then it's gone again.
const LIMITED_COSMETICS = [
  ['pumpkin_head', 'Pumpkin Head', '🎃', 'hat', 'pumpkin', 15000],
  ['reindeer_antlers', 'Reindeer Antlers', '🦌', 'hat', 'antlers', 15000],
  ['flower_crown', 'Flower Crown', '🌸', 'hat', 'flowers', 12000],
  ['samurai_helm', 'Samurai Helm', '⛩️', 'hat', 'samurai', 25000],
  ['starry_cape', 'Starry Night Cape', '🌌', 'cape', '#1b2a6b', 20000],
  ['rainbow_aura', 'Rainbow Aura', '🌈', 'aura', '#ff6ad5', 45000],
];
for (const [id, name, icon, slot, style, cost] of LIMITED_COSMETICS) {
  ITEMS[id] = { name, icon, value: Math.round(cost / 4), keep: true, limited: true, cosmetic: { slot, style } };
}
const LIMITED_SHOP = LIMITED_COSMETICS.map(([item, , , slot, , cost]) => ({
  item,
  cost,
  category: 'limited',
  description: `This week only! A limited ${slot} that leaves the shop when the week ends (UTC). Wear it on the Customize page.`,
}));

// Dungeon-only loot (see features/social.js).
ITEMS.shadow_gem = { name: 'Shadow Gem', icon: '💠', value: 2500 };
ITEMS.rune_shard = { name: 'Ancient Rune Shard', icon: '🔷', value: 700 };
ITEMS.dungeon_relic = { name: 'Dungeon Relic', icon: '🗝️', value: 1500 };
ITEMS.delver_cape = { name: "Delver's Cape", icon: '🦇', value: 20000, keep: true, cosmetic: { slot: 'cape', style: '#3a1f4d' } };

// ---- Pets: very rare drops from actions in their skill. The active pet follows your character
// and gives +5% XP in its skill. ----------------------------------------------------------------
const PET_BONUS = 0.05;
const PETS = [
  // id, name, icon, skill, base chance per successful action
  ['pet_heron', 'Heron Chick', '🐧', 'fishing'],
  ['pet_rock_golem', 'Rock Golem', '🗿', 'mining'],
  ['pet_beaver', 'Beaver', '🦫', 'woodcutting'],
  ['pet_hedgehog', 'Hedgehog', '🦔', 'digging'],
  ['pet_fox', 'Fox Kit', '🦊', 'skinning'],
  ['pet_bunny', 'Garden Bunny', '🐰', 'farming'],
  ['pet_ember', 'Ember Chick', '🐥', 'firemaking'],
  ['pet_cat', 'Kitchen Cat', '🐈', 'cooking'],
  ['pet_salamander', 'Salamander', '🦎', 'smelting'],
  ['pet_beetle', 'Anvil Beetle', '🪲', 'smithing'],
  ['pet_owl', 'Owl', '🦉', 'fletching'],
  ['pet_spider', 'Weaver Spider', '🕷️', 'crafting'],
  ['pet_toad', 'Toad', '🐸', 'alchemy'],
  ['pet_wolf', 'Wolf Pup', '🐺', 'swords'],
  ['pet_hawk', 'Hawk', '🦅', 'archery'],
  ['pet_dragon', 'Baby Dragon', '🐉', 'magic'],
].map(([id, name, icon, skill]) => ({ id, name, icon, skill, chance: 1 / 2500 }));
for (const p of PETS) ITEMS[p.id] = { name: p.name, icon: p.icon, value: 0, keep: true, pet: { skill: p.skill } };

// ---- Race-only items: only that race can make them. ------------------------------------------
const RACE_ITEMS = [
  {
    race: 'dwarf',
    skill: 'smithing',
    item: 'dwarven_warhammer',
    def: { name: 'Dwarven Warhammer', icon: '🔨', value: 900, keep: true, gear: true, slot: 'weapon', level: 40, weaponType: 'sword', attack: 23 },
    level: 40,
    kind: 'weapon',
    xp: 400,
    inputs: { mithril_bar: 3 },
  },
  {
    race: 'orc',
    skill: 'smithing',
    item: 'orcish_war_axe',
    def: { name: 'Orcish War Axe', icon: '🪓', value: 1300, keep: true, gear: true, slot: 'weapon', level: 60, weaponType: 'sword', attack: 35 },
    level: 60,
    kind: 'weapon',
    xp: 650,
    inputs: { adamantite_bar: 3 },
  },
  {
    race: 'human',
    skill: 'smithing',
    item: 'knights_kite_shield',
    def: { name: "Knight's Kite Shield", icon: '🛡️', value: 300, keep: true, gear: true, slot: 'shield', level: 20, defence: 9 },
    level: 30,
    kind: 'armor',
    xp: 160,
    inputs: { steel_bar: 3 },
  },
  {
    race: 'elf',
    skill: 'fletching',
    item: 'elven_longbow',
    def: { name: 'Elven Longbow', icon: '🏹', value: 300, keep: true, gear: true, slot: 'weapon', level: 40, weaponType: 'bow' },
    level: 45,
    kind: 'weapon',
    xp: 150,
    inputs: { maple_logs: 3 },
    attackFrom: ['maple_bow', 1.3],
  },
  {
    race: 'undead',
    skill: 'fletching',
    item: 'soul_staff',
    def: { name: 'Soul Staff', icon: '💀', value: 600, keep: true, gear: true, slot: 'weapon', level: 60, weaponType: 'staff' },
    level: 60,
    kind: 'weapon',
    xp: 260,
    inputs: { yew_logs: 2, ashes: 5 },
    attackFrom: ['yew_staff', 1.3],
  },
  {
    race: 'halfling',
    skill: 'cooking',
    item: 'hearty_pie',
    def: { name: 'Hearty Halfling Pie', icon: '🥧', value: 60, food: { heal: 120 } },
    level: 20,
    kind: 'meat',
    word: 'pie',
    xp: 60,
    inputs: { raw_chicken: 1, carrot: 1, potato: 1 },
  },
];
for (const r of RACE_ITEMS) {
  ITEMS[r.item] = { ...r.def, race: r.race };
  if (r.attackFrom) ITEMS[r.item].attack = Math.round(ITEMS[r.attackFrom[0]].attack * r.attackFrom[1]);
  const recipe = { item: r.item, level: r.level, kind: r.kind, xp: r.xp, inputs: r.inputs, race: r.race, ...(r.word ? { word: r.word } : {}) };
  SKILLS[r.skill].recipes.push(recipe);
  SKILLS[r.skill].recipes.sort((a, b) => a.level - b.level);
  for (const i of Object.keys(r.inputs)) if (!ITEMS[i]) throw new Error(`race item input ${i} missing`);
}

// ---- Quest chains: short storylines done in order. Each step counts matching actions from the
// activity feed. Finishing a chain pays points and gives a title. ---------------------------
//   match: { skill, item, monster, kind, text (regex) } — every field given must match.
const QUESTS = [
  {
    id: 'apprentice',
    name: "The Blacksmith's Apprentice",
    icon: '🔨',
    intro: 'The village smith needs a new apprentice. Prove you can work metal from ore to blade.',
    steps: [
      { text: 'Mine Copper Ore', qty: 10, match: { skill: 'mining', item: 'copper_ore' } },
      { text: 'Mine Tin Ore', qty: 10, match: { skill: 'mining', item: 'tin_ore' } },
      { text: 'Smelt Bronze Alloys', qty: 5, match: { skill: 'smelting', item: 'bronze_bar' } },
      { text: 'Smith a Bronze Sword (buy a Smithing Hammer first)', qty: 1, match: { skill: 'smithing', item: 'bronze_sword' } },
      { text: 'Defeat Goblins', qty: 3, match: { monster: 'goblin' } },
    ],
    reward: 2000,
    title: 'the Apprentice',
  },
  {
    id: 'hearth',
    name: 'Hearth & Home',
    icon: '🍳',
    intro: 'A traveller is hungry. Catch, grow and cook a proper meal.',
    steps: [
      { text: 'Catch fish', qty: 15, match: { skill: 'fishing' } },
      { text: 'Plant crops', qty: 1, match: { skill: 'farming', text: '^planted' } },
      { text: 'Light fires', qty: 3, match: { skill: 'firemaking' } },
      { text: 'Cook food', qty: 10, match: { skill: 'cooking' } },
    ],
    reward: 3000,
    title: 'the Homesteader',
  },
  {
    id: 'hunter',
    name: "Hunter's Path",
    icon: '🏹',
    intro: 'The ranger will teach you the bow, if you can keep up.',
    steps: [
      { text: 'Chop Oak Logs', qty: 10, match: { skill: 'woodcutting', item: 'oak_logs' } },
      { text: 'Fletch anything (arrows, a bow, a quiver)', qty: 3, match: { skill: 'fletching' } },
      { text: 'Skin animals', qty: 5, match: { skill: 'skinning' } },
      { text: 'Defeat monsters with a bow', qty: 5, match: { skill: 'archery' } },
    ],
    reward: 4000,
    title: 'the Hunter',
  },
  {
    id: 'initiate',
    name: 'Arcane Initiate',
    icon: '🔮',
    intro: 'The tower accepts only those who can craft, brew and cast.',
    steps: [
      { text: 'Craft Magic Runes', qty: 1, match: { skill: 'crafting', item: 'magic_rune' } },
      { text: 'Brew potions', qty: 3, match: { skill: 'alchemy' } },
      { text: 'Defeat monsters with magic', qty: 10, match: { skill: 'magic' } },
    ],
    reward: 6000,
    title: 'the Initiate',
  },
  {
    id: 'relics',
    name: 'Relic Hunter',
    icon: '🏺',
    intro: 'The museum curator is looking for someone with a keen eye and a good shovel.',
    steps: [
      { text: 'Dig up finds', qty: 25, match: { skill: 'digging' } },
      { text: 'Donate finds to the museum', qty: 3, match: { kind: 'donate' } },
    ],
    reward: 6000,
    title: 'the Relic Hunter',
  },
  {
    id: 'champion',
    name: 'Champion of the Realm',
    icon: '⚔️',
    intro: 'The king needs a champion. Only the toughest need apply.',
    steps: [
      { text: 'Defeat monsters', qty: 50, match: { skill: ['swords', 'archery', 'magic'], kind: ['action', 'rare'] } },
      { text: 'Defeat Trolls', qty: 5, match: { monster: 'troll' } },
      { text: 'Find anything rare', qty: 1, match: { kind: 'rare' } },
    ],
    reward: 20000,
    title: 'Champion of the Realm',
  },
];

module.exports = { COSMETICS, COSMETIC_SLOTS, SEASON_COSMETICS, LIMITED_COSMETICS, LIMITED_SHOP, PETS, PET_BONUS, RACE_ITEMS, QUESTS };
