// Player-built structures, all made from Construction parts (frames, doors, wall panels, roof
// trusses; see skills.js BUILD_TIERS / BUILD_PARTS):
//   - House blueprints: build your house yourself instead of paying points (!house build).
//   - Shops: a storefront for the player market with more listing slots and a lower fee (!stall build).
//   - The town: buildings the whole chat builds together by donating parts (!contribute). Every
//     level gives everyone bonus XP in the building's skills.
// Parts of the named tier or better count; the lowest qualifying tiers are used first.

// Tiers in order, so "oak or better" can be checked.
const PART_TIERS = ['wooden', 'oak', 'willow', 'mahogany', 'yew', 'redwood', 'ebony', 'bloodwood', 'spiritwood', 'elder', 'celestial'];
const PART_KINDS = ['frame', 'door', 'wall_panel', 'roof_truss'];

// House id -> what it takes to build it yourself. Same houses (and character level) as buying.
const HOUSE_BLUEPRINTS = {
  cottage: { construction: 10, minTier: 'wooden', parts: { frame: 10, wall_panel: 8, door: 2, roof_truss: 4 } },
  house: { construction: 30, minTier: 'oak', parts: { frame: 16, wall_panel: 14, door: 3, roof_truss: 8 } },
  manor: { construction: 60, minTier: 'willow', parts: { frame: 24, wall_panel: 24, door: 5, roof_truss: 12 } },
  castle: { construction: 100, minTier: 'yew', parts: { frame: 40, wall_panel: 40, door: 8, roof_truss: 20 } },
  palace: { construction: 150, minTier: 'ebony', parts: { frame: 60, wall_panel: 60, door: 12, roof_truss: 30 } },
};

// Player shops, built in order. slots = extra market listings, feeCut = taken off the market fee on
// your sales.
const SHOPS = [
  { id: 'stall', name: 'Market Stall', icon: '🛒', construction: 5, minTier: 'wooden', parts: { frame: 6, roof_truss: 2 }, slots: 5, feeCut: 0.01 },
  { id: 'shop', name: 'Shop', icon: '🏪', construction: 40, minTier: 'oak', parts: { frame: 12, wall_panel: 10, door: 2, roof_truss: 4 }, slots: 15, feeCut: 0.02 },
  { id: 'emporium', name: 'Emporium', icon: '🏬', construction: 90, minTier: 'mahogany', parts: { frame: 30, wall_panel: 30, door: 6, roof_truss: 12 }, slots: 30, feeCut: 0.03 },
];

// Town buildings. Each level needs `goal` points' worth of parts (their item value), times the level
// goal table below; each level gives +townXpPerLevel XP (2% by default) in its skills.
const TOWN_BUILDINGS = [
  { id: 'sawmill', name: 'Sawmill', icon: '🪚', skills: ['woodcutting', 'carpentry', 'fletching'], text: 'Woodcutting, Carpentry and Fletching' },
  { id: 'forge', name: 'Great Forge', icon: '⚒️', skills: ['mining', 'smelting', 'smithing'], text: 'Mining, Smelting and Smithing' },
  { id: 'harbor', name: 'Harbor', icon: '⚓', skills: ['fishing', 'cooking', 'firemaking'], text: 'Fishing, Cooking and Firemaking' },
  { id: 'granary', name: 'Granary', icon: '🌾', skills: ['farming', 'digging', 'alchemy'], text: 'Farming, Digging and Alchemy' },
  { id: 'tannery', name: 'Tannery', icon: '🧵', skills: ['skinning', 'crafting', 'agility'], text: 'Skinning, Crafting and Agility' },
  { id: 'barracks', name: 'Barracks', icon: '🛡️', skills: ['swords', 'archery', 'magic'], text: 'Swords, Archery and Magic' },
  { id: 'guildhall', name: "Builders' Hall", icon: '🏗️', skills: ['construction'], text: 'Construction' },
];
// Parts value needed for each level (1..5).
const TOWN_GOALS = [3000, 12000, 40000, 120000, 350000];
const TOWN_MAX_LEVEL = TOWN_GOALS.length;

module.exports = { PART_TIERS, PART_KINDS, HOUSE_BLUEPRINTS, SHOPS, TOWN_BUILDINGS, TOWN_GOALS, TOWN_MAX_LEVEL };
