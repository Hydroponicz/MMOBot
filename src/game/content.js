// Extra content: cosmetics, pets, race-only items, quest chains. Adds its items to ITEMS and SHOP, so
// require it once before the game uses the item list (shared.js does).
const { ITEMS, SKILLS, SHOP, BUFFS, MUSEUM } = require('./skills');

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
  ['pet_squirrel', 'Squirrel', '🐿️', 'agility'],
  ['pet_cat', 'Kitchen Cat', '🐈', 'cooking'],
  ['pet_salamander', 'Salamander', '🦎', 'smelting'],
  ['pet_beetle', 'Anvil Beetle', '🪲', 'smithing'],
  ['pet_owl', 'Owl', '🦉', 'fletching'],
  ['pet_woodpecker', 'Woodpecker', '🐦', 'carpentry'],
  ['pet_raccoon', 'Raccoon Foreman', '🦝', 'construction'],
  ['pet_spider', 'Weaver Spider', '🕷️', 'crafting'],
  ['pet_toad', 'Toad', '🐸', 'alchemy'],
  ['pet_wolf', 'Wolf Pup', '🐺', 'swords'],
  ['pet_hawk', 'Hawk', '🦅', 'archery'],
  ['pet_dragon', 'Baby Dragon', '🐉', 'magic'],
  ['pet_boar', 'War Boar', '🐗', 'axes'],
  ['pet_raven', 'Thief Raven', '🐦‍⬛', 'daggers'],
  ['pet_scorpion', 'Scorpion', '🦂', 'spears'],
  ['pet_gorilla', 'Gorilla Cub', '🦍', 'brawling'],
  ['pet_bat', 'Grave Bat', '🦇', 'necromancy'],
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
// Every item id matching a test, for quest steps ("any plank").
function questItems(test) {
  return Object.keys(ITEMS).filter((id) => test(ITEMS[id]));
}

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
    intro: 'The king needs a champion. Only the toughest need apply: fifty monsters, and the restless dead in the old crypt.',
    steps: [
      { text: 'Defeat monsters', qty: 50, match: { skill: ['swords', 'archery', 'magic', 'axes', 'daggers', 'spears', 'brawling', 'necromancy'], kind: ['action', 'rare'] } },
      // (Was 5 Trolls, level 70: out of reach for most of the players this quest is meant for.)
      { text: 'Defeat Skeletons', qty: 5, match: { monster: 'skeleton' } },
      { text: 'Find anything rare', qty: 1, match: { kind: 'rare' } },
    ],
    reward: 20000,
    title: 'Champion of the Realm',
  },
  {
    id: 'scavenger',
    name: 'The Monster Scavenger',
    icon: '🦴',
    intro: 'Nothing a monster drops goes to waste. Cook it, brew it, fletch it, open it, show it off.',
    steps: [
      { text: 'Cook a Cheesy Potato Bake (Giant Rat cheese + a potato)', qty: 1, match: { skill: 'cooking', item: 'cheesy_potato_bake' } },
      { text: 'Brew Goblin Grog (goblin ears + a carrot)', qty: 1, match: { skill: 'alchemy', item: 'goblin_grog' } },
      { text: 'Fletch Fang Arrows (wolf fangs)', qty: 1, match: { skill: 'fletching', item: 'fang_arrows' } },
      { text: 'Open monster loot (goblin pouches, stolen goods...)', qty: 3, match: { kind: 'open' } },
      { text: 'Craft a Wolf Pelt Cape', qty: 1, match: { skill: 'crafting', item: 'wolf_pelt_cape' } },
    ],
    reward: 5000,
    title: 'the Scavenger',
  },

  // ---- Wave 2: every newer system gets a story. `after` chains quests: they unlock once the named
  // quest is done. `items` are extra rewards.
  {
    id: 'carpenter',
    name: "The Carpenter's Bench",
    icon: '🪚',
    intro: 'The town is growing and the old carpenter needs hands. Learn to turn trees and metal into building parts.',
    steps: [
      { text: 'Chop logs', qty: 20, match: { skill: 'woodcutting' } },
      { text: 'Saw planks (!saw planks)', qty: 10, match: { skill: 'carpentry', item: questItems((i) => i.material === 'plank') } },
      { text: 'Craft nails (!craft nails)', qty: 5, match: { skill: 'carpentry', item: questItems((i) => i.material === 'nails') } },
      { text: 'Build frames (!build frame)', qty: 3, match: { skill: 'construction', item: questItems((i) => i.buildPart === 'frame') } },
    ],
    reward: 3000,
    items: { oak_logs: 20 },
    title: 'the Carpenter',
  },
  {
    id: 'townmaker',
    name: 'Raise the Town',
    icon: '🏘️',
    after: 'carpenter',
    intro: 'A town needs walls, roofs and people willing to build them. Lend your hammer and open a stall of your own.',
    steps: [
      { text: 'Build wall panels (!build wall)', qty: 5, match: { skill: 'construction', item: questItems((i) => i.buildPart === 'wall_panel') } },
      { text: 'Build roof trusses (!build roof)', qty: 2, match: { skill: 'construction', item: questItems((i) => i.buildPart === 'roof_truss') } },
      { text: 'Give parts to the town (!contribute)', qty: 3, match: { kind: 'contribute' } },
      { text: 'Open a Market Stall (!stall build)', qty: 1, match: { kind: 'build', text: '^opened a' } },
    ],
    reward: 8000,
    title: 'the Townmaker',
  },
  {
    id: 'homebuilder',
    name: 'A Home of My Own',
    icon: '🏡',
    after: 'townmaker',
    intro: 'Anyone can buy a house. Build yours with your own two hands.',
    steps: [
      { text: 'Build doors (!build door)', qty: 3, match: { skill: 'construction', item: questItems((i) => i.buildPart === 'door') } },
      { text: 'Build your house by hand (!house build)', qty: 1, match: { kind: 'build', text: '^built their own' } },
    ],
    reward: 15000,
    title: 'the Homebuilder',
  },
  {
    id: 'angler',
    name: 'The Old Angler',
    icon: '🎣',
    intro: 'An old fisherman swears the big ones only bite for people who have earned it.',
    steps: [
      { text: 'Catch Trout', qty: 10, match: { skill: 'fishing', item: 'trout' } },
      { text: 'Catch Salmon', qty: 10, match: { skill: 'fishing', item: 'salmon' } },
      { text: 'Catch Lobsters', qty: 5, match: { skill: 'fishing', item: 'lobster' } },
      { text: 'Cook food', qty: 20, match: { skill: 'cooking' } },
    ],
    reward: 5000,
    title: 'the Angler',
  },
  {
    id: 'delver',
    name: 'Deep Delver',
    icon: '⛏️',
    after: 'apprentice',
    intro: 'The smith has a bigger order: steel and gold, and plenty of it.',
    steps: [
      { text: 'Mine Iron Ore', qty: 20, match: { skill: 'mining', item: 'iron_ore' } },
      { text: 'Mine Coal', qty: 20, match: { skill: 'mining', item: 'coal' } },
      { text: 'Mine Gold Ore', qty: 10, match: { skill: 'mining', item: 'gold_ore' } },
      { text: 'Smelt Steel Alloys', qty: 10, match: { skill: 'smelting', item: 'steel_bar' } },
      { text: 'Smelt Gold Ingots', qty: 5, match: { skill: 'smelting', item: 'gold_bar' } },
    ],
    reward: 7000,
    title: 'the Delver',
  },
  {
    id: 'herbalist',
    name: 'The Herbalist',
    icon: '🌿',
    intro: 'The healer is out of potions and the Barracks are restless. Grow the herbs and brew the cures.',
    steps: [
      { text: 'Harvest your plots', qty: 3, match: { skill: 'farming', text: '^harvested' } },
      { text: 'Brew health potions', qty: 5, match: { skill: 'alchemy', item: ['minor_health_potion', 'health_potion', 'greater_health_potion', 'super_health_potion'] } },
      { text: 'Brew mana potions', qty: 3, match: { skill: 'alchemy', item: ['minor_mana_potion', 'mana_potion', 'greater_mana_potion'] } },
    ],
    reward: 5000,
    items: { health_potion: 3 },
    title: 'the Herbalist',
  },
  {
    id: 'warden',
    name: 'Warden of the Wilds',
    icon: '🐺',
    after: 'hunter',
    intro: 'Wolves and bandits are raiding the roads. Clear them out and make use of what they leave behind.',
    steps: [
      { text: 'Defeat Wolves', qty: 10, match: { monster: 'wolf' } },
      { text: 'Defeat Bandits', qty: 10, match: { monster: 'bandit' } },
      { text: 'Skin animals', qty: 20, match: { skill: 'skinning' } },
      { text: 'Craft anything', qty: 3, match: { skill: 'crafting' } },
    ],
    reward: 6000,
    title: 'the Warden',
  },
  {
    id: 'runner',
    name: 'Rooftop Runner',
    icon: '🏃',
    intro: 'The couriers guild is hiring. Show them you can cross the town without touching the ground.',
    steps: [
      { text: 'Run laps (!run)', qty: 30, match: { skill: 'agility' } },
      { text: 'Run the Castle Walls', qty: 5, match: { skill: 'agility', text: 'Castle Walls' } },
    ],
    reward: 6000,
    title: 'the Courier',
  },
  {
    id: 'fogwalker',
    name: 'Into the Gloamveil',
    icon: '🌫️',
    intro: 'Scavengers come back from the fog rich, or not at all. Go in, loot, and find a Waystone.',
    steps: [
      { text: 'Search rooms in the Gloamveil (!veil 1, then !search)', qty: 10, match: { kind: 'veilsearch' } },
      { text: 'Get out alive through a Waystone (!extract)', qty: 3, match: { kind: 'extract' } },
    ],
    reward: 6000,
    items: { health_potion: 4 },
    title: 'the Fogwalker',
  },
  {
    id: 'veilwalker',
    name: 'Heart of the Fog',
    icon: '🔮',
    after: 'fogwalker',
    intro: 'The deeper zones hold the real treasure, and the real danger. Other scavengers included.',
    steps: [
      { text: 'Extract from the Drowned Choir or deeper', qty: 3, match: { kind: 'extract', zone: [2, 3, 4] } },
      { text: 'Beat another player in the fog (!ambush)', qty: 1, match: { kind: 'duel', text: '^killed @' } },
    ],
    reward: 25000,
    title: 'the Veilwalker',
  },
  {
    id: 'gladiator',
    name: 'The Arena Calls',
    icon: '🏟️',
    intro: 'The crowd wants blood and the ladder wants a new name at the top. Fight for rating.',
    steps: [{ text: 'Win ranked arena fights (!arena)', qty: 5, match: { kind: 'duel', text: 'ranked arena' } }],
    reward: 8000,
    items: { greater_health_potion: 2 },
    title: 'the Gladiator',
  },
  {
    id: 'rogue',
    name: 'Shadows of the Market',
    icon: '🦹',
    intro: 'Some make their fortune honestly. Some sell on the market. Some take it from other people.',
    steps: [
      { text: 'Put items up on the market', qty: 3, match: { kind: 'market' } },
      { text: 'Pull off a heist (!rob)', qty: 3, match: { kind: 'heist', text: 'snuck into|made off with' } },
    ],
    reward: 6000,
    title: 'the Rogue',
  },
  {
    id: 'collector',
    name: 'The Collector',
    icon: '🃏',
    intro: 'A wealthy collector wants someone to open, catalogue and donate. Their cabinet has room for more.',
    steps: [
      { text: 'Open card packs', qty: 10, match: { kind: 'pack' } },
      { text: 'Open relic cases', qty: 5, match: { kind: 'case' } },
      { text: 'Donate finds to the museum', qty: 5, match: { kind: 'donate' } },
    ],
    reward: 7000,
    title: 'the Collector',
  },
  {
    id: 'dragonsbane',
    name: "The Dragon's Bane",
    icon: '🐉',
    after: 'champion',
    intro: 'The king has a new problem, and it breathes fire. Climb the food chain to the top.',
    steps: [
      { text: 'Defeat Wyverns', qty: 10, match: { monster: 'wyvern' } },
      { text: 'Defeat Hydras', qty: 5, match: { monster: 'hydra' } },
      { text: 'Defeat Dragons', qty: 3, match: { monster: 'dragon' } },
    ],
    reward: 75000,
    title: 'the Dragonsbane',
  },
  {
    id: 'polymath',
    name: 'Master of All Trades',
    icon: '🌟',
    after: ['apprentice', 'hearth', 'hunter', 'initiate', 'carpenter'],
    intro: 'The guildmasters of every craft have heard of you. Now prove you can do it all, in one go.',
    steps: [
      { text: 'Fish', qty: 25, match: { skill: 'fishing' } },
      { text: 'Mine', qty: 25, match: { skill: 'mining' } },
      { text: 'Chop', qty: 25, match: { skill: 'woodcutting' } },
      { text: 'Smith', qty: 10, match: { skill: 'smithing' } },
      { text: 'Cook', qty: 25, match: { skill: 'cooking' } },
      { text: 'Brew', qty: 10, match: { skill: 'alchemy' } },
      { text: 'Build', qty: 5, match: { skill: 'construction' } },
      { text: 'Run laps', qty: 10, match: { skill: 'agility' } },
    ],
    reward: 30000,
    title: 'the Jack of All Trades',
  },
  // More quests: one for brand-new players, and next steps for the existing chains.
  {
    id: 'rising',
    name: 'A Rising Adventurer',
    icon: '🌅',
    intro: 'Everyone starts somewhere. Try a bit of everything and see what sticks.',
    steps: [
      { text: 'Fish', qty: 10, match: { skill: 'fishing' } },
      { text: 'Mine', qty: 10, match: { skill: 'mining' } },
      { text: 'Chop', qty: 10, match: { skill: 'woodcutting' } },
      { text: 'Win fights (any weapon, or your fists: !punch)', qty: 10, match: { skill: ['swords', 'archery', 'magic', 'axes', 'daggers', 'spears', 'brawling', 'necromancy'] } },
    ],
    reward: 2500,
    items: { minor_health_potion: 3 },
    title: 'the Adventurer',
  },
  {
    id: 'goblinslayer',
    name: 'Goblin Slayer',
    icon: '👺',
    intro: "The goblins have been raiding the farms again, and the rats are eating what's left.",
    steps: [
      { text: 'Defeat Goblins', qty: 25, match: { monster: 'goblin' } },
      { text: 'Defeat Giant Rats', qty: 15, match: { monster: 'giant_rat' } },
      { text: 'Open monster loot (!open)', qty: 5, match: { kind: 'open' } },
    ],
    reward: 4000,
    title: 'the Goblin Slayer',
  },
  {
    id: 'masterchef',
    name: 'Master Chef',
    icon: '👨‍🍳',
    after: 'hearth',
    intro: "The tavern's cook has quit. Keep the fires going and feed the whole town.",
    steps: [
      { text: 'Light fires (!lightfire)', qty: 10, match: { skill: 'firemaking' } },
      { text: 'Cook food (!cook, or !cook all)', qty: 50, match: { skill: 'cooking' } },
    ],
    reward: 6000,
    title: 'the Master Chef',
  },
  {
    id: 'deepsea',
    name: 'The Deep Blue',
    icon: '🦈',
    after: 'angler',
    intro: 'The old angler says the big ones live past the harbor. Go and prove it.',
    steps: [
      { text: 'Catch Tuna', qty: 15, match: { skill: 'fishing', item: 'tuna' } },
      { text: 'Catch Swordfish', qty: 5, match: { skill: 'fishing', item: 'swordfish' } },
      { text: 'Catch Sharks', qty: 3, match: { skill: 'fishing', item: 'shark' } },
    ],
    reward: 15000,
    title: 'the Deep-Sea Angler',
  },
  {
    id: 'treasure',
    name: 'Treasure Hunter',
    icon: '🗺️',
    after: 'relics',
    intro: 'Pouches, belts, buried coins: someone has to sort through it all.',
    steps: [
      { text: 'Open monster loot (!open, or !open all)', qty: 25, match: { kind: 'open' } },
      { text: 'Dig up finds', qty: 30, match: { skill: 'digging' } },
      { text: 'Donate finds to the museum', qty: 3, match: { kind: 'donate' } },
    ],
    reward: 8000,
    title: 'the Treasure Hunter',
  },
  {
    id: 'pillar',
    name: 'Pillar of the Town',
    icon: '🏛️',
    after: 'townmaker',
    intro: 'The town is growing, and it needs more than one pair of hands.',
    steps: [
      { text: 'Build wall panels (!build wall)', qty: 10, match: { skill: 'construction', item: questItems((i) => i.buildPart === 'wall_panel') } },
      { text: 'Give parts to the town (!contribute)', qty: 10, match: { kind: 'contribute' } },
    ],
    reward: 12000,
    title: 'the Pillar of the Town',
  },
  // The newer fighting styles.
  {
    id: 'brawler',
    name: 'Tavern Brawler',
    icon: '👊',
    intro: "The innkeeper says you can't afford a sword. You don't need one.",
    steps: [
      { text: 'Punch out Chickens', qty: 5, match: { skill: 'brawling', monster: 'chicken' } },
      { text: 'Punch out Goblins', qty: 5, match: { skill: 'brawling', monster: 'goblin' } },
      { text: 'Smith a pair of knuckles', qty: 1, match: { skill: 'smithing', item: ['bronze_knuckles', 'iron_knuckles', 'steel_knuckles'] } },
    ],
    reward: 2500,
    title: 'the Brawler',
  },
  {
    id: 'woodsman',
    name: 'The Woodsman',
    icon: '🪓',
    intro: 'An axe is a tool until something bites back. Learn to swing it at more than trees.',
    steps: [
      { text: 'Chop logs', qty: 15, match: { skill: 'woodcutting' } },
      { text: 'Smith a battleaxe', qty: 1, match: { skill: 'smithing', item: ['bronze_battleaxe', 'iron_battleaxe', 'steel_battleaxe'] } },
      { text: 'Cleave Wolves', qty: 5, match: { skill: 'axes', monster: 'wolf' } },
    ],
    reward: 6000,
    title: 'the Woodsman',
  },
  {
    id: 'pikeman',
    name: 'Hold the Line',
    icon: '🔱',
    after: 'carpenter',
    intro: 'The town needs a militia: carpenters for the shafts, smiths for the heads, and someone brave to hold them.',
    steps: [
      { text: 'Saw planks', qty: 6, match: { skill: 'carpentry' } },
      { text: 'Smith a spear', qty: 1, match: { skill: 'smithing', item: ['bronze_spear', 'iron_spear', 'steel_spear', 'mithril_spear'] } },
      { text: 'Skewer monsters with a spear', qty: 20, match: { skill: 'spears' } },
    ],
    reward: 8000,
    title: 'the Pikeman',
  },
  {
    id: 'cutpurse',
    name: 'The Cutpurse',
    icon: '🔪',
    intro: 'The Thieves\' Guild only takes members who can use a blade quietly, and use it loudly when needed.',
    steps: [
      { text: 'Stab monsters with a dagger', qty: 15, match: { skill: 'daggers' } },
      { text: 'Stab Bandits', qty: 5, match: { skill: 'daggers', monster: 'bandit' } },
      { text: 'Pull off (or get caught at) a crime', qty: 3, match: { kind: 'heist' } },
    ],
    reward: 7000,
    title: 'the Cutpurse',
  },
  {
    id: 'gravecaller',
    name: 'The Gravecaller',
    icon: '💀',
    intro: 'The old crypt keeper will teach you to wake the dead, if you bring the bones yourself.',
    steps: [
      { text: 'Craft Bone Shards', qty: 2, match: { skill: 'crafting', item: 'bone_shard' } },
      { text: 'Raise the dead against monsters', qty: 15, match: { skill: 'necromancy' } },
      { text: 'Defeat Skeletons with your undead', qty: 5, match: { skill: 'necromancy', monster: 'skeleton' } },
    ],
    reward: 9000,
    items: { bone_shard: 100 },
    title: 'the Gravecaller',
  },
  {
    id: 'warmaster',
    name: 'Master of Arms',
    icon: '⚔️',
    after: ['champion', 'brawler', 'woodsman'],
    intro: 'Every weapon in the armory, one after another. The old weapons master wants to see them all.',
    steps: [
      { text: 'Win fights with a sword', qty: 10, match: { skill: 'swords' } },
      { text: 'Win fights with a bow', qty: 10, match: { skill: 'archery' } },
      { text: 'Win fights with magic', qty: 10, match: { skill: 'magic' } },
      { text: 'Win fights with an axe', qty: 10, match: { skill: 'axes' } },
      { text: 'Win fights with a dagger', qty: 10, match: { skill: 'daggers' } },
      { text: 'Win fights with a spear', qty: 10, match: { skill: 'spears' } },
      { text: 'Win fights with your fists', qty: 10, match: { skill: 'brawling' } },
      { text: 'Win fights with your undead', qty: 10, match: { skill: 'necromancy' } },
    ],
    reward: 40000,
    title: 'the Master of Arms',
  },
];

// ---- Uses for combat drops ---------------------------------------------------------------------
// Every monster drop is good for something besides selling: dishes, potions, arrows, capes,
// containers to open, or museum trophies. (!item <name> shows where anything comes from and goes.)

// New timed effects (see vitals.js buffs).
BUFFS.wellfed = { id: 'wellfed', name: 'Well Fed', icon: '🍲', minutes: 15, text: '+5% XP in every skill' };
BUFFS.stoneskin = { id: 'stoneskin', name: 'Stoneskin', icon: '🪨', minutes: 20, text: '+25% defence in fights' };
BUFFS.venom = { id: 'venom', name: 'Venom Coating', icon: '🐍', minutes: 20, text: '+20% attack in fights' };

// Cooking: monster dishes heal like other food and leave you Well Fed.
const MONSTER_DISHES = [
  // id, name, icon, Cooking level, inputs, XP
  ['cheesy_potato_bake', 'Cheesy Potato Bake', '🧀', 8, { cheese: 1, potato: 1 }, 30],
  ['golden_omelette', 'Golden Omelette', '🍳', 30, { golden_egg: 1 }, 400],
  ['hydra_soup', 'Hydra Head Soup', '🍲', 130, { hydra_head: 1 }, 520],
  ['giants_toe_stew', "Giant's Toe Stew", '🦶', 180, { giant_toe: 1 }, 700],
  ['dragonheart_roast', 'Dragonheart Roast', '❤️‍🔥', 250, { elder_heart: 1 }, 1200],
];
for (const [id, name, icon, level, inputs, xp] of MONSTER_DISHES) {
  const inValue = Object.entries(inputs).reduce((sum, [i, q]) => sum + ITEMS[i].value * q, 0);
  ITEMS[id] = { name, icon, value: Math.round(inValue * 1.3) + 1, food: { heal: Math.round(10 + level * 2), buff: 'wellfed' } };
  SKILLS.cooking.recipes.push({ item: id, level, kind: 'dish', word: name.split(' ')[0].toLowerCase(), xp, inputs });
}
SKILLS.cooking.recipes.sort((a, b) => a.level - b.level);

// Alchemy: combat potions (a timed effect, some longer than the undead potions).
const MONSTER_POTIONS = [
  // id, name, icon, Alchemy level, inputs, buff, minutes, XP
  ['goblin_grog', 'Goblin Grog', '🍺', 12, { goblin_ear: 2, carrot: 1 }, 'luck', 20, 40],
  ['berserker_draught', 'Berserker Draught', '🔴', 55, { war_paint: 1, ashes: 3 }, 'fury', 30, 110],
  ['stoneskin_tonic', 'Stoneskin Tonic', '🪨', 80, { ogre_tooth: 1, ashes: 4 }, 'stoneskin', 20, 160],
  ['venom_coating', 'Venom Coating', '🐍', 100, { venom_sac: 1, ashes: 4 }, 'venom', 20, 200],
  ['regeneration_draught', 'Regeneration Draught', '🩸', 150, { hydra_blood: 1, ashes: 5 }, 'vampiric', 45, 300],
  ['infernal_focus', 'Infernal Focus', '🔥', 200, { infernal_ash: 1, ashes: 6 }, 'focus', 60, 420],
  ['frostguard_elixir', 'Frostguard Elixir', '❄️', 250, { frost_core: 1, ashes: 6 }, 'stoneskin', 60, 520],
  ['soulbound_elixir', 'Soulbound Elixir', '💎', 300, { soul_gem: 1, ashes: 8 }, 'deathless', 120, 650],
];
for (const [id, name, icon, level, inputs, buff, minutes, xp] of MONSTER_POTIONS) {
  const inValue = Object.entries(inputs).reduce((sum, [i, q]) => sum + ITEMS[i].value * q, 0);
  ITEMS[id] = { name, icon, value: Math.round(inValue * 1.3), keep: true, potion: { buff, minutes } };
  SKILLS.alchemy.recipes.push({ item: id, level, kind: 'combat', xp, inputs });
}
SKILLS.alchemy.recipes.sort((a, b) => a.level - b.level);

// Fletching: monster arrowheads instead of metal bars (a little stronger than metal at that level).
const MONSTER_ARROWS = [
  // id, name, logs, arrowhead, Fletching level, Archery level to use, attack
  ['fang_arrows', 'Fang Arrows', 'oak_logs', 'wolf_fang', 20, 20, 4],
  ['tusk_arrows', 'Tusk Arrows', 'maple_logs', 'orc_tusk', 55, 55, 9],
  ['claw_arrows', 'Wyvern Claw Arrows', 'ironwood_logs', 'wyvern_claw', 200, 200, 34],
  ['dragonbone_arrows', 'Dragonbone Arrows', 'dragonwood_logs', 'dragon_bone', 400, 400, 65],
];
for (const [id, name, logs, head, fletch, use, attack] of MONSTER_ARROWS) {
  ITEMS[id] = { name, icon: '🏹', value: Math.max(1, Math.round((ITEMS[logs].value + ITEMS[head].value + ITEMS.feathers.value) / 10)), keep: true, ammo: 'bow', level: use, attack, wieldSkill: 'Archery' };
  const xp = SKILLS.fletching.recipes.find((r) => r.group === 'arrows' && r.level <= fletch && r.item !== id);
  SKILLS.fletching.recipes.push({ item: id, level: fletch, kind: 'ammo', group: 'arrows', yield: 10, xp: Math.round((xp ? xp.xp : 20) * 1.1), inputs: { [logs]: 1, feathers: 1, [head]: 1 } });
}
SKILLS.fletching.recipes.sort((a, b) => a.level - b.level);

// Crafting: capes (cosmetic) from hides, scales and shrouds; a horned helm from minotaur horns.
const MONSTER_COSMETICS = [
  // id, name, icon, slot, style, Crafting level, inputs, XP
  ['wolf_pelt_cape', 'Wolf Pelt Cape', '🐺', 'cape', '#6d6258', 20, { wolf_pelt: 3 }, 80],
  ['troll_hide_cape', 'Troll Hide Cape', '🧌', 'cape', '#5d6b4a', 70, { troll_hide: 3 }, 220],
  ['silk_cape', 'Spider Silk Cape', '🕸️', 'cape', '#e8e4dc', 100, { spider_silk: 3 }, 320],
  ['shroud_cape', 'Wraith Shroud Cape', '👻', 'cape', '#2b3140', 130, { wraith_shroud: 2 }, 400],
  ['minotaur_helm', 'Minotaur Helm', '🐂', 'hat', 'viking', 160, { minotaur_horn: 2 }, 480],
  ['wyvern_scale_cape', 'Wyvern Scale Cape', '🐉', 'cape', '#2f8a86', 200, { wyvern_scale: 4 }, 620],
  ['demon_horns', 'Demon Horns', '😈', 'hat', 'demon', 300, { demon_horn: 2 }, 900],
  ['dragon_scale_cape', 'Dragon Scale Cape', '🐲', 'cape', '#a82f2f', 400, { dragon_scale: 4 }, 1300],
  ['ancient_aura', 'Ancient Aura', '🌿', 'aura', '#8ad8a0', 480, { ancient_scale: 3 }, 1700],
];
for (const [id, name, icon, slot, style, level, inputs, xp] of MONSTER_COSMETICS) {
  const inValue = Object.entries(inputs).reduce((sum, [i, q]) => sum + ITEMS[i].value * q, 0);
  ITEMS[id] = { name, icon, value: Math.round(inValue * 1.2), keep: true, cosmetic: { slot, style } };
  SKILLS.crafting.recipes.push({ item: id, level, kind: 'cosmetic', xp, inputs });
}
SKILLS.crafting.recipes.sort((a, b) => a.level - b.level);

// Containers: !open them for points and a few random items.
const CONTAINERS = {
  goblin_pouch: { points: [20, 80], loot: [['magic_rune', 0.5, [5, 15]], ['carrot_seeds', 0.4, [2, 5]], ['iron_arrows', 0.3, [10, 20]]] },
  stolen_goods: { points: [60, 200], loot: [['iron_bar', 0.4, [1, 3]], ['steel_arrows', 0.4, [10, 25]], ['goblin_pouch', 0.3, [1, 1]]] },
  ogre_belt: { points: [150, 400], loot: [['health_potion', 0.35, [1, 1]], ['mana_potion', 0.3, [1, 1]], ['ashes', 0.5, [5, 12]]] },
  labyrinth_key: { points: [500, 1500], loot: [['greater_health_potion', 0.3, [1, 2]], ['rune_shard', 0.3, [1, 1]], ['shadow_gem', 0.05, [1, 1]], ['golden_egg', 0.04, [1, 1]]] },
};
for (const [id, c] of Object.entries(CONTAINERS)) {
  for (const [i] of c.loot) if (!ITEMS[i]) throw new Error(`container ${id} drops unknown item ${i}`);
  ITEMS[id].opens = true;
}

// Museum trophy collections for rare monster drops.
MUSEUM.push(
  { id: 'trophies', name: 'Trophy Hall', icon: '🏆', items: ['golden_egg', 'goblin_crown', 'bandit_mask', 'troll_club'], reward: 15000, title: 'the Monster Hunter' },
  { id: 'legends', name: 'Legendary Relics', icon: '🐉', items: ['dragon_egg', 'phylactery', 'soul_gem', 'elder_heart'], reward: 150000, title: 'the Dragonslayer' },
);

// Every item, monster and prerequisite a quest names must exist.
for (const q of QUESTS) {
  for (const s of q.steps) {
    for (const i of [].concat(s.match.item || [])) if (!ITEMS[i]) throw new Error(`quest ${q.id} names unknown item ${i}`);
    for (const m of [].concat(s.match.monster || [])) if (!SKILLS.swords.monsters.some((x) => x.id === m)) throw new Error(`quest ${q.id} names unknown monster ${m}`);
  }
  for (const a of [].concat(q.after || [])) if (!QUESTS.some((x) => x.id === a)) throw new Error(`quest ${q.id} comes after unknown quest ${a}`);
  for (const i of Object.keys(q.items || {})) if (!ITEMS[i]) throw new Error(`quest ${q.id} rewards unknown item ${i}`);
}

module.exports = { CONTAINERS, MONSTER_DISHES, MONSTER_POTIONS, MONSTER_ARROWS, MONSTER_COSMETICS, COSMETICS, COSMETIC_SLOTS, SEASON_COSMETICS, LIMITED_COSMETICS, LIMITED_SHOP, PETS, PET_BONUS, RACE_ITEMS, QUESTS };
