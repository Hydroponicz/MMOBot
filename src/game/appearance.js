// Races and character looks. The server keeps the option lists (to check what players save and to
// pick a random look); public/avatar.js draws them.
const crypto = require('node:crypto');

// Perks are multipliers (1 = no change) except stamina, which adds charges.
//   xp: { skillId: multiplier } ("all" applies to every skill), hp, mana, attack, defence,
//   sell (item sell prices), luck (rare finds), food (HP healed by food), stamina.
const RACES = {
  human: {
    name: 'Human',
    plural: 'Humans',
    icon: '🧑',
    text: 'Adaptable jacks of all trades.',
    perks: { xp: { all: 1.05 }, sell: 1.05 },
    pros: ['+5% XP in every skill', '+5% sell prices'],
    cons: ['No big specialty'],
  },
  elf: {
    name: 'Elf',
    plural: 'Elves',
    icon: '🧝',
    text: 'Graceful forest folk with a gift for bows and growing things.',
    perks: { xp: { archery: 1.15, woodcutting: 1.15, farming: 1.15, alchemy: 1.15 }, mana: 1.2, hp: 0.85 },
    pros: ['+15% Archery, Woodcutting, Farming and Alchemy XP', '+20% max mana'],
    cons: ['-15% max HP'],
  },
  dwarf: {
    name: 'Dwarf',
    plural: 'Dwarves',
    icon: '🧔',
    text: 'Stout miners and master smiths, hard to knock down.',
    perks: { xp: { mining: 1.15, smelting: 1.15, smithing: 1.15, archery: 0.85, magic: 0.85 }, hp: 1.15, defence: 1.1 },
    pros: ['+15% Mining, Smelting and Smithing XP', '+15% max HP', '+10% defence'],
    cons: ['-15% Archery and Magic XP'],
  },
  orc: {
    name: 'Orc',
    plural: 'Orcs',
    icon: '👹',
    text: 'Fierce warriors who hit hard and haggle badly.',
    perks: { xp: { swords: 1.15, skinning: 1.15, cooking: 0.9, crafting: 0.9, alchemy: 0.9 }, attack: 1.15, hp: 1.1, sell: 0.9 },
    pros: ['+15% attack', '+15% Swords and Skinning XP', '+10% max HP'],
    cons: ['-10% Cooking, Crafting and Alchemy XP', '-10% sell prices'],
  },
  halfling: {
    name: 'Halfling',
    plural: 'Halflings',
    icon: '🧒',
    text: 'Small, cheerful and tireless, happiest near water and a warm meal.',
    perks: { xp: { fishing: 1.15, cooking: 1.15, farming: 1.15 }, stamina: 1, attack: 0.9, hp: 0.9 },
    pros: ['+1 stamina charge', '+15% Fishing, Cooking and Farming XP'],
    cons: ['-10% attack', '-10% max HP'],
  },
  undead: {
    name: 'Undead',
    plural: 'the Undead',
    icon: '💀',
    text: 'Risen from the grave, steeped in dark magic and unnaturally lucky.',
    perks: { xp: { magic: 1.15, alchemy: 1.15 }, mana: 1.25, luck: 1.15, food: 0.5 },
    pros: ['+15% Magic and Alchemy XP', '+25% max mana', '+15% rare find chance'],
    cons: ['Food heals only half as much'],
  },
};
const RACE_IDS = Object.keys(RACES);

// Every option: [id, label, color?]. Colors are used by the avatar and the swatches.
const OPTIONS = {
  skin: [
    ['porcelain', 'Porcelain', '#f7dfcd'],
    ['fair', 'Fair', '#efc7a8'],
    ['light', 'Light', '#e0ae87'],
    ['tan', 'Tan', '#c98c60'],
    ['olive', 'Olive', '#b07b4f'],
    ['brown', 'Brown', '#8d5a3b'],
    ['dark', 'Dark', '#61402a'],
    ['deep', 'Deep', '#3f281a'],
    ['moss', 'Moss green', '#8aa85e'],
    ['jade', 'Jade green', '#5f8c4c'],
    ['ash', 'Ash grey', '#b9c1c9'],
    ['frost', 'Frost blue', '#9db4c6'],
  ],
  hair: [
    ['bald', 'Bald'],
    ['short', 'Short'],
    ['sidepart', 'Side part'],
    ['spiky', 'Spiky'],
    ['curly', 'Curly'],
    ['mohawk', 'Mohawk'],
    ['long', 'Long'],
    ['ponytail', 'Ponytail'],
    ['bun', 'Bun'],
    ['braids', 'Braids'],
  ],
  hairColor: [
    ['black', 'Black', '#1f1a17'],
    ['darkbrown', 'Dark brown', '#4a2f1f'],
    ['brown', 'Brown', '#7a4a2a'],
    ['auburn', 'Auburn', '#8e3b1f'],
    ['red', 'Red', '#c2451e'],
    ['blonde', 'Blonde', '#e0bd68'],
    ['platinum', 'Platinum', '#efe6c8'],
    ['grey', 'Grey', '#9a9a9a'],
    ['white', 'White', '#f2f2f2'],
    ['blue', 'Blue', '#3f6fd1'],
    ['green', 'Green', '#3fa062'],
    ['pink', 'Pink', '#e36fb1'],
    ['purple', 'Purple', '#7b4cc2'],
  ],
  eyes: [
    ['round', 'Round'],
    ['narrow', 'Narrow'],
    ['sleepy', 'Sleepy'],
    ['wide', 'Wide'],
  ],
  eyeColor: [
    ['brown', 'Brown', '#5a3a22'],
    ['hazel', 'Hazel', '#8a6a2f'],
    ['green', 'Green', '#3f8a4a'],
    ['blue', 'Blue', '#3a6fc2'],
    ['grey', 'Grey', '#7d8790'],
    ['amber', 'Amber', '#d08a1c'],
    ['red', 'Red', '#c22a2a'],
    ['violet', 'Violet', '#8a4cc2'],
    ['glow', 'Ghostly glow', '#5ff2e6'],
  ],
  brows: [
    ['normal', 'Normal'],
    ['thick', 'Thick'],
    ['arched', 'Arched'],
    ['angry', 'Angry'],
    ['none', 'None'],
  ],
  nose: [
    ['button', 'Button'],
    ['round', 'Round'],
    ['long', 'Long'],
    ['hooked', 'Hooked'],
  ],
  mouth: [
    ['smile', 'Smile'],
    ['grin', 'Grin'],
    ['neutral', 'Neutral'],
    ['smirk', 'Smirk'],
    ['frown', 'Frown'],
  ],
  facialHair: [
    ['none', 'None'],
    ['stubble', 'Stubble'],
    ['mustache', 'Mustache'],
    ['handlebar', 'Handlebar mustache'],
    ['goatee', 'Goatee'],
    ['beard', 'Full beard'],
    ['longbeard', 'Long beard'],
  ],
  extra: [
    ['none', 'None'],
    ['freckles', 'Freckles'],
    ['blush', 'Rosy cheeks'],
    ['scar', 'Scar'],
    ['eyepatch', 'Eyepatch'],
    ['earring', 'Earring'],
  ],
  outfit: [
    ['red', 'Red', '#b8433a'],
    ['blue', 'Blue', '#3a64b8'],
    ['green', 'Green', '#3f8a4a'],
    ['purple', 'Purple', '#6e45a8'],
    ['brown', 'Brown', '#7a5334'],
    ['black', 'Black', '#2a2d33'],
    ['gold', 'Gold', '#c9a23a'],
  ],
};
const LOOK_KEYS = Object.keys(OPTIONS);
const has = (key, id) => OPTIONS[key].some(([o]) => o === id);

// Skin tones a random character of each race is picked from (players can choose any).
const RACE_SKINS = {
  orc: ['moss', 'jade'],
  undead: ['ash', 'frost'],
  default: ['porcelain', 'fair', 'light', 'tan', 'olive', 'brown', 'dark', 'deep'],
};

// Deterministic "random" numbers from a seed, so a player's starting look never changes until
// they customize it (and needs no database write).
function seeded(seed) {
  let i = 0;
  return () => {
    const h = crypto.createHash('sha256').update(`${seed}:${i++}`).digest();
    return h.readUInt32BE(0) / 2 ** 32;
  };
}

function randomCharacter(seed) {
  const rnd = seeded(`look:${seed}`);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const ids = (key) => OPTIONS[key].map(([id]) => id);
  const race = pick(RACE_IDS);
  const natural = ['black', 'darkbrown', 'brown', 'auburn', 'red', 'blonde', 'platinum', 'grey'];
  const beardy = race === 'dwarf' ? 0.9 : ['elf', 'halfling'].includes(race) ? 0.1 : 0.35;
  const look = {
    skin: pick(RACE_SKINS[race] || RACE_SKINS.default),
    hair: pick(ids('hair')),
    hairColor: rnd() < 0.85 ? pick(natural) : pick(ids('hairColor')),
    eyes: pick(ids('eyes')),
    eyeColor: race === 'undead' ? 'glow' : pick(['brown', 'hazel', 'green', 'blue', 'grey', 'amber']),
    brows: pick(ids('brows').filter((b) => b !== 'none')),
    nose: pick(ids('nose')),
    mouth: pick(ids('mouth')),
    facialHair: rnd() < beardy ? pick(ids('facialHair').filter((f) => f !== 'none')) : 'none',
    extra: rnd() < 0.6 ? 'none' : pick(ids('extra').filter((e) => e !== 'none')),
    outfit: pick(ids('outfit')),
  };
  if (race === 'dwarf' && look.facialHair !== 'none' && rnd() < 0.5) look.facialHair = 'longbeard';
  return { race, look };
}

// Checks a saved look: every key must be a known option. Returns { look } or { error }.
function cleanLook(input, base) {
  const look = { ...base };
  if (!input || typeof input !== 'object') return { error: 'invalid look' };
  for (const key of LOOK_KEYS) {
    if (input[key] === undefined) continue;
    const id = String(input[key]);
    if (!has(key, id)) return { error: `unknown ${key}: ${id}` };
    look[key] = id;
  }
  return { look };
}

// Options as plain JSON for the website.
const publicOptions = () =>
  Object.fromEntries(LOOK_KEYS.map((key) => [key, OPTIONS[key].map(([id, label, color]) => ({ id, label, ...(color ? { color } : {}) }))]));

const publicRaces = () => RACE_IDS.map((id) => ({ id, name: RACES[id].name, icon: RACES[id].icon, text: RACES[id].text, pros: RACES[id].pros, cons: RACES[id].cons }));

module.exports = { RACES, RACE_IDS, OPTIONS, LOOK_KEYS, randomCharacter, cleanLook, publicOptions, publicRaces };
