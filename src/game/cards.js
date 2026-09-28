// Trading cards: fantasy creatures in sets, packs to open, wear and grading. Pure data and maths;
// the engine (features/cards.js) stores the cards and moves points around.
//
// Every card a player pulls is its own copy with:
//   finish  normal / holo / gold
//   wear    0 (flawless) to 1 (wrecked), shown like a float: lower is better
//   q       hidden print quirks (centering and how the wear lands on corners, edges and surface)
// Grading reads wear + quirks to give four subgrades and a 1-10 grade, so a low-wear card usually
// grades well but can still surprise you. Grading is final: the same card always gets the same grade.

const RARITIES = {
  common: { name: 'Common', short: 'C', color: '#9aa4b1', base: 15, rank: 0 },
  uncommon: { name: 'Uncommon', short: 'U', color: '#4ade80', base: 50, rank: 1 },
  rare: { name: 'Rare', short: 'R', color: '#38bdf8', base: 200, rank: 2 },
  epic: { name: 'Epic', short: 'E', color: '#c084fc', base: 800, rank: 3 },
  legendary: { name: 'Legendary', short: 'L', color: '#ffc940', base: 4000, rank: 4 },
  mythic: { name: 'Mythic', short: 'M', color: '#ff5c7a', base: 20000, rank: 5 },
};
const RARITY_IDS = Object.keys(RARITIES);

const FINISHES = {
  normal: { name: 'Normal', mult: 1 },
  holo: { name: 'Holo', mult: 3 },
  gold: { name: 'Gold Foil', mult: 10 },
};

const ELEMENTS = {
  nature: { name: 'Nature', icon: '🌿', color: '#4caf50' },
  earth: { name: 'Earth', icon: '🪨', color: '#a0785a' },
  fire: { name: 'Fire', icon: '🔥', color: '#ff6b2c' },
  water: { name: 'Water', icon: '💧', color: '#3b9ce8' },
  storm: { name: 'Storm', icon: '⚡', color: '#f5d33b' },
  frost: { name: 'Frost', icon: '❄️', color: '#8ee3ff' },
  shadow: { name: 'Shadow', icon: '🌑', color: '#8b5cf6' },
  light: { name: 'Light', icon: '☀️', color: '#ffe38a' },
};

// Sets: [name, icon, element, rarity, flavor]
const SETS = [
  {
    id: 'wildlands',
    name: 'Wildlands',
    icon: '🌲',
    color: '#3f8f4f',
    year: 1,
    title: 'the Beastmaster',
    reward: 15000,
    cards: [
      ['Mossback Toad', '🐸', 'nature', 'common', 'Sits so still that moss grows on it.'],
      ['Thornbeetle', '🪲', 'nature', 'common', 'Its shell is a bramble patch.'],
      ['Meadow Sprite', '🧚', 'light', 'common', 'Leaves glitter wherever it naps.'],
      ['Burrow Beaver', '🦫', 'earth', 'common', 'Has dammed three rivers and one road.'],
      ['Pebble Golem', '🗿', 'earth', 'common', 'Small, stubborn and mostly gravel.'],
      ['Glade Fox', '🦊', 'nature', 'common', 'Never seen, only heard laughing.'],
      ['Spore Shroom', '🍄', 'nature', 'common', 'Do not sniff.'],
      ['Honey Wasp', '🐝', 'nature', 'common', 'Makes honey. Guards it violently.'],
      ['Barkling', '🌳', 'nature', 'common', 'A sapling that learned to walk.'],
      ['Rock Tortoise', '🐢', 'earth', 'common', 'Older than the mountain it sits on.'],
      ['Dusk Owl', '🦉', 'shadow', 'common', 'Asks "who" and already knows.'],
      ['Brook Otter', '🦦', 'water', 'common', 'Holds hands with its friends while it sleeps.'],
      ['Horned Stag', '🦌', 'nature', 'uncommon', 'Its antlers bloom every spring.'],
      ['Wildboar Chieftain', '🐗', 'earth', 'uncommon', 'Leads the charge. Always the charge.'],
      ['Vine Serpent', '🐍', 'nature', 'uncommon', 'Looks exactly like the vine you grabbed.'],
      ['Thunder Hare', '🐇', 'storm', 'uncommon', 'Faster than the lightning it rides.'],
      ['Great Grizzly', '🐻', 'earth', 'uncommon', 'Sleeps half the year. Angry the other half.'],
      ['Moonmoth', '🦋', 'light', 'uncommon', 'Only flies under a full moon.'],
      ['Swamp Croc', '🐊', 'water', 'uncommon', 'All teeth, no manners.'],
      ['Timber Wolf', '🐺', 'nature', 'uncommon', 'The pack is never far behind.'],
      ['Elder Treant', '🌲', 'nature', 'rare', 'It remembers when the forest was a seed.'],
      ['Griffin Scout', '🦅', 'storm', 'rare', 'Sees a mouse from the clouds.'],
      ['Silverback Titan', '🦍', 'earth', 'rare', 'Beats its chest and the ground shakes.'],
      ['Moonlit Unicorn', '🦄', 'light', 'rare', 'Heals any wound it touches.'],
      ['Bramble Lion', '🦁', 'nature', 'rare', 'Its mane is a thicket of thorns.'],
      ['Forest Wyrm', '🐉', 'nature', 'epic', 'Coils around the roots of the world.'],
      ['Prism Peacock', '🦚', 'light', 'epic', 'Every feather holds a rainbow.'],
      ['Ancient Mammoth', '🦣', 'earth', 'epic', 'Walked out of the last ice age. Still walking.'],
      ['Verdant Dragon', '🐲', 'nature', 'legendary', 'Where it lands, a forest grows.'],
      ['Gaia, Heart of the Wilds', '🌍', 'nature', 'mythic', 'Every living thing is her heartbeat.'],
    ],
  },
  {
    id: 'emberforge',
    name: 'Emberforge',
    icon: '🌋',
    color: '#c2451e',
    year: 1,
    title: 'the Flamecaller',
    reward: 20000,
    cards: [
      ['Ember Imp', '👺', 'fire', 'common', 'Steals matches. Lights them. Giggles.'],
      ['Cinder Rat', '🐀', 'fire', 'common', 'Leaves tiny burning footprints.'],
      ['Lava Slug', '🐌', 'fire', 'common', 'Slow. Very, very hot.'],
      ['Ash Sparrow', '🐦', 'fire', 'common', 'Nests in chimneys, sings in smoke.'],
      ['Magma Crab', '🦀', 'fire', 'common', 'Its shell is still cooling.'],
      ['Soot Bat', '🦇', 'shadow', 'common', 'You only notice it when you sneeze.'],
      ['Flame Lizard', '🦎', 'fire', 'common', 'Sunbathes in volcanoes.'],
      ['Kobold Miner', '⛏️', 'earth', 'common', 'Digs for gold. Finds mostly lava.'],
      ['Spark Ladybug', '🐞', 'storm', 'common', 'Lucky, if you like being shocked.'],
      ['Smog Wisp', '💨', 'storm', 'common', 'A cough with a mind of its own.'],
      ['Ember Hound', '🐕', 'fire', 'common', 'A good boy. A hot boy.'],
      ['Coal Golem', '🗿', 'earth', 'common', 'Keeps the forge fed. Sometimes with itself.'],
      ['Scorch Scorpion', '🦂', 'fire', 'uncommon', 'Its sting is a hot coal.'],
      ['Molten Minotaur', '🐂', 'fire', 'uncommon', 'Guards the labyrinth under the volcano.'],
      ['Obsidian Rhino', '🦏', 'earth', 'uncommon', 'Glass-hard and just as sharp.'],
      ['Nightmare Steed', '🐎', 'fire', 'uncommon', 'Its hooves leave the road on fire.'],
      ['Volcano Spirit', '🌋', 'fire', 'uncommon', 'Rumbles when it is hungry.'],
      ['Forge Troll', '🧌', 'earth', 'uncommon', 'Hammers iron with its bare fists.'],
      ['Blaze Tiger', '🐅', 'fire', 'uncommon', 'Its stripes are flames.'],
      ['Oni Brute', '👹', 'shadow', 'uncommon', 'Carries a club made from a whole tree.'],
      ['Cinder Cockatrice', '🐓', 'fire', 'rare', 'One look turns you to ash, not stone.'],
      ['Hellhound', '🐺', 'shadow', 'rare', 'Three heads, one appetite.'],
      ['Magma Rex', '🦖', 'earth', 'rare', 'The king of the lava fields.'],
      ['Efreet', '🧞', 'fire', 'rare', 'Grants wishes. Burns the fine print.'],
      ['Thunder Drake', '🦕', 'storm', 'rare', 'Its roar comes after the lightning.'],
      ['Phoenix Reborn', '🕊️', 'light', 'epic', 'Dies in fire, returns in glory.'],
      ['Balrog', '👿', 'shadow', 'epic', 'Shadow and flame, and a very long whip.'],
      ['Chimera', '🦁', 'fire', 'epic', 'Lion, goat and serpent, all in a bad mood.'],
      ['Inferno Dragon', '🐉', 'fire', 'legendary', 'Its breath melts castle walls.'],
      ['Ignis, the Forge Eternal', '☄️', 'fire', 'mythic', 'The first flame. It will be the last.'],
    ],
  },
  {
    id: 'abyssal',
    name: 'Abyssal Tides',
    icon: '🌊',
    color: '#2554a8',
    year: 1,
    title: 'the Tidecaller',
    reward: 20000,
    cards: [
      ['Reef Minnow', '🐟', 'water', 'common', 'Always in a hurry, never late.'],
      ['Bubble Jelly', '🪼', 'water', 'common', 'Glows in the dark. Stings in the light.'],
      ['Tide Crab', '🦀', 'water', 'common', 'Walks sideways out of every argument.'],
      ['Ink Squid', '🦑', 'water', 'common', 'Writes poetry in the sand.'],
      ['Frost Penguin', '🐧', 'frost', 'common', 'Waddles in formation.'],
      ['Grave Rat', '🐀', 'shadow', 'common', 'Lives in the crypt. Pays no rent.'],
      ['Bone Skitter', '💀', 'shadow', 'common', 'A skull on too many legs.'],
      ['Mire Leech', '🪱', 'water', 'common', 'Just wants a little drink.'],
      ['Seal Pup', '🦭', 'frost', 'common', 'Too cute to be this dangerous.'],
      ['Ghost Lantern', '🏮', 'shadow', 'common', 'Lights the way to nowhere.'],
      ['Shell Snail', '🐚', 'water', 'common', 'Hums the sound of the sea.'],
      ['Snow Hare', '🐇', 'frost', 'common', 'Vanishes into every snowdrift.'],
      ['Siren', '🧜', 'water', 'uncommon', 'Her song is the last thing sailors hear.'],
      ['Banshee', '👻', 'shadow', 'uncommon', 'Wails before every shipwreck.'],
      ['Ice Wolf', '🐺', 'frost', 'uncommon', 'Its howl freezes rivers.'],
      ['Abyss Octopus', '🐙', 'water', 'uncommon', 'Eight arms, eight grudges.'],
      ['Mountain Yeti', '🏔️', 'frost', 'uncommon', 'Footprints the size of a door.'],
      ['Shark Knight', '🦈', 'water', 'uncommon', 'Sworn to the sea queen.'],
      ['Vampire Bat', '🦇', 'shadow', 'uncommon', 'Only bites at midnight. Usually.'],
      ['Tomb Mummy', '🧟', 'shadow', 'uncommon', 'Wrapped for eternity, unwrapping slowly.'],
      ['Leviathan Calf', '🐋', 'water', 'rare', 'Already bigger than your ship.'],
      ['Lich Sorcerer', '🧙', 'shadow', 'rare', 'Hid his heart where no one will find it.'],
      ['Ice Wyvern', '🦕', 'frost', 'rare', 'Wings of glacier glass.'],
      ['Wraith Queen', '👸', 'shadow', 'rare', 'Rules a kingdom of whispers.'],
      ['Moon Dolphin', '🐬', 'light', 'rare', 'Leaps so high it touches the moon.'],
      ['The Kraken', '🐙', 'water', 'epic', 'Release it. If you dare.'],
      ['Frost Titan', '🧊', 'frost', 'epic', 'Carved the fjords with its fingers.'],
      ['Death Knight', '⚔️', 'shadow', 'epic', 'Rides a horse made of bones.'],
      ['Abyssal Leviathan', '🐳', 'water', 'legendary', 'The sea itself, awake and hungry.'],
      ['Nyx, Queen of the Deep', '🌑', 'shadow', 'mythic', 'Where light ends, her reign begins.'],
    ],
  },
];

// Small deterministic hash, so values and stats never change between restarts.
function hash01(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

const CARDS = {};
for (const set of SETS) {
  set.cards = set.cards.map(([name, icon, element, rarity, flavor], i) => {
    const id = `${set.id}-${String(i + 1).padStart(2, '0')}`;
    const r = RARITIES[rarity];
    const h = hash01(id);
    const card = {
      id,
      set: set.id,
      num: i + 1,
      name,
      icon,
      element,
      rarity,
      flavor,
      // Value of a raw near-mint normal copy.
      base: Math.round(r.base * (0.85 + 0.3 * h)),
      power: Math.round((r.rank + 1) * 20 + h * 25 + r.rank * r.rank * 6),
      hp: Math.round(40 + (r.rank + 1) * 30 + hash01(`${id}hp`) * 40),
    };
    CARDS[id] = card;
    return id;
  });
  set.size = set.cards.length;
}
const SET_BY_ID = Object.fromEntries(SETS.map((s) => [s.id, s]));
const byRarity = (setIds, rarity) => Object.values(CARDS).filter((c) => setIds.includes(c.set) && c.rarity === rarity).map((c) => c.id);

// Packs. Each slot is a rarity table; a card of that rarity is picked from the pack's sets.
// price is the default; admins can scale all prices (cardPackPriceMultiplier).
const PACKS = [
  ...SETS.map((s) => ({ id: `${s.id}-scout`, name: `${s.name} Scout Pack`, icon: s.icon, sets: [s.id], price: 200, tier: 'scout', color: s.color, slots: [{ common: 1 }, { common: 1 }, { uncommon: 0.85, rare: 0.13, epic: 0.02 }] })),
  ...SETS.map((s) => ({
    id: `${s.id}-booster`,
    name: `${s.name} Booster`,
    icon: s.icon,
    sets: [s.id],
    price: 1000,
    tier: 'booster',
    color: s.color,
    slots: [{ common: 0.92, uncommon: 0.08 }, { common: 1 }, { common: 1 }, { uncommon: 0.9, rare: 0.1 }, { rare: 0.78, epic: 0.17, legendary: 0.043, mythic: 0.007 }],
  })),
  { id: 'elite', name: 'Elite Pack', icon: '💠', sets: SETS.map((s) => s.id), price: 3500, tier: 'elite', color: '#7c3aed', slots: [{ uncommon: 1 }, { uncommon: 1 }, { rare: 1 }, { rare: 0.85, epic: 0.15 }, { epic: 0.8, legendary: 0.17, mythic: 0.03 }] },
  { id: 'vault', name: 'Mythic Vault', icon: '👑', sets: SETS.map((s) => s.id), price: 11000, tier: 'vault', color: '#b91c1c', slots: [{ epic: 1 }, { epic: 0.9, legendary: 0.1 }, { legendary: 0.88, mythic: 0.12 }] },
];
const PACK_BY_ID = Object.fromEntries(PACKS.map((p) => [p.id, p]));

const HOLO_CHANCE = 0.1;
const GOLD_CHANCE = 0.01;

function pickWeighted(table, rng) {
  let roll = rng();
  const entries = Object.entries(table);
  for (const [k, w] of entries) {
    if (roll < w) return k;
    roll -= w;
  }
  return entries[entries.length - 1][0];
}

// Wear from a fresh pack: most cards are near mint or excellent, a few are flawless, and now and then
// one comes out of the pack damaged.
function rollWear(rng) {
  const damaged = rng() < 0.02;
  const w = damaged ? 0.3 + rng() * 0.7 : 0.07 * (-Math.log(1 - rng() * 0.999999) - Math.log(1 - rng() * 0.999999));
  return Math.round(Math.min(0.99999, w) * 1e5) / 1e5;
}

// One card copy fresh out of a pack (no id/owner yet).
function rollCard(pack, slot, rng) {
  const rarity = pickWeighted(slot, rng);
  const pool = byRarity(pack.sets, rarity);
  const card = pool[Math.floor(rng() * pool.length)];
  const f = rng();
  const finish = f < GOLD_CHANCE ? 'gold' : f < GOLD_CHANCE + HOLO_CHANCE ? 'holo' : 'normal';
  const wear = rollWear(rng);
  const q = Array.from({ length: 8 }, () => Math.round(rng() * 1e4) / 1e4);
  return { card, finish, wear, q };
}

function openPack(pack, rng) {
  return pack.slots.map((slot) => rollCard(pack, slot, rng));
}

// ---- Condition and grading ----------------------------------------------------------------
const CONDITIONS = [
  { max: 0.02, name: 'Pristine', short: 'PR', mult: 1.6 },
  { max: 0.06, name: 'Mint', short: 'M', mult: 1.3 },
  { max: 0.15, name: 'Near Mint', short: 'NM', mult: 1 },
  { max: 0.3, name: 'Excellent', short: 'EX', mult: 0.8 },
  { max: 0.5, name: 'Good', short: 'GD', mult: 0.6 },
  { max: 0.75, name: 'Played', short: 'PL', mult: 0.45 },
  { max: 1.01, name: 'Damaged', short: 'DMG', mult: 0.3 },
];
const conditionOf = (wear) => CONDITIONS.find((c) => wear < c.max) || CONDITIONS[CONDITIONS.length - 1];

const GRADES = {
  10: { name: 'GEM MINT', mult: 4 },
  9: { name: 'MINT', mult: 1.7 },
  8: { name: 'NM-MT', mult: 1.15 },
  7: { name: 'NEAR MINT', mult: 0.9 },
  6: { name: 'EX-MT', mult: 0.75 },
  5: { name: 'EXCELLENT', mult: 0.62 },
  4: { name: 'VG-EX', mult: 0.5 },
  3: { name: 'VERY GOOD', mult: 0.4 },
  2: { name: 'GOOD', mult: 0.32 },
  1: { name: 'POOR', mult: 0.25 },
};
// All four subgrades a perfect 10: rarer than a gem mint, worth much more.
const BLACK_LABEL = { name: 'PRISTINE', mult: 10 };

const half = (x) => Math.round(x * 2) / 2;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Subgrades from wear and the card's hidden quirks. Centering is how it was printed (not wear).
function subgradesOf(wear, q) {
  const [c0, c1, m1, m2, m3, n1, n2, n3] = q;
  const hit = (m, n) => half(clamp(10.25 - wear * 14 * (0.6 + m * 0.8) - Math.pow(n, 4) * 3, 1, 10));
  return {
    centering: half(clamp(10.25 - Math.pow(c0, 3) * 3.5 - Math.pow(c1, 6) * 2, 1, 10)),
    corners: hit(m1, n1),
    edges: hit(m2, n2),
    surface: hit(m3, n3),
  };
}

function gradeOf(wear, q) {
  const sub = subgradesOf(wear, q);
  const vals = Object.values(sub);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const low = Math.min(...vals);
  // Like the real graders: the average, but never more than one grade above the weakest subgrade.
  const grade = clamp(Math.min(Math.floor(avg + 0.25), Math.floor(low) + 1), 1, 10);
  const black = vals.every((v) => v === 10);
  return { grade, sub, black, label: black ? BLACK_LABEL.name : GRADES[grade].name };
}

// What a copy is worth (points). copy: { card, finish, wear, grade, black }
function valueOf(copy) {
  const c = CARDS[copy.card];
  if (!c) return 0;
  const f = FINISHES[copy.finish]?.mult || 1;
  const m = copy.grade ? (copy.black ? BLACK_LABEL.mult : GRADES[copy.grade].mult) : conditionOf(copy.wear).mult;
  return Math.max(1, Math.round(c.base * f * m));
}

// Grading fee: a flat part plus a share of the raw value.
function gradeFee(copy) {
  return Math.max(25, Math.round((20 + valueOf({ ...copy, grade: null }) * 0.2) / 5) * 5);
}

// Expected value of a pack (raw copies), for the pack shop.
function packEv(pack) {
  const finishMult = 1 - HOLO_CHANCE - GOLD_CHANCE + HOLO_CHANCE * FINISHES.holo.mult + GOLD_CHANCE * FINISHES.gold.mult;
  // Average condition multiplier for fresh cards (worked out once).
  const condMult = AVG_CONDITION;
  let total = 0;
  for (const slot of pack.slots) {
    for (const [rarity, w] of Object.entries(slot)) {
      const pool = byRarity(pack.sets, rarity);
      total += (w * pool.reduce((s, id) => s + CARDS[id].base, 0)) / pool.length;
    }
  }
  return Math.round(total * finishMult * condMult);
}
const AVG_CONDITION = (() => {
  let s = 0;
  const n = 20000;
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < n; i++) s += conditionOf(rollWear(rng)).mult;
  return s / n;
})();

module.exports = {
  RARITIES,
  RARITY_IDS,
  FINISHES,
  ELEMENTS,
  SETS,
  SET_BY_ID,
  CARDS,
  PACKS,
  PACK_BY_ID,
  CONDITIONS,
  GRADES,
  BLACK_LABEL,
  HOLO_CHANCE,
  GOLD_CHANCE,
  openPack,
  rollCard,
  rollWear,
  conditionOf,
  subgradesOf,
  gradeOf,
  valueOf,
  gradeFee,
  packEv,
};
