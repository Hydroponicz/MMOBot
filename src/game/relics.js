// Relic cases: a case-opening game in the style of the famous shooter's weapon cases, but with fantasy
// weapons (blades, axes, staffs, bows, shields). Pure data and maths; the engine (features/relics.js)
// stores what players own and moves points around.
//
// Every relic a player unboxes is its own copy with:
//   float  0 (flawless) to 1 (wrecked). Sets the exterior (Forge Fresh ... Battle-Scarred).
//   seed   pattern seed 0-999. Changes how the skin is drawn; some seeds are rare patterns
//          (fade percentage, gem phases like Ruby and Sapphire, one-in-a-hundred marbles).
//   soul   SoulTrak™: counts the monsters you defeat while it's your showcased relic.

const RARITIES = {
  adept: { name: 'Adept', color: '#4b69ff', odds: 0.7992, base: 60, rank: 0 },
  heroic: { name: 'Heroic', color: '#8847ff', odds: 0.1598, base: 450, rank: 1 },
  mythic: { name: 'Mythic', color: '#d32ce6', odds: 0.032, base: 2800, rank: 2 },
  exalted: { name: 'Exalted', color: '#eb4b4b', odds: 0.0064, base: 22000, rank: 3 },
  relic: { name: '★ Legendary Relic', color: '#e4ae39', odds: 0.0026, base: 85000, rank: 4 },
};
const RARITY_IDS = Object.keys(RARITIES);
const NEXT_RARITY = { adept: 'heroic', heroic: 'mythic', mythic: 'exalted', exalted: 'relic' };
// How many relics a trade-up contract takes.
const TRADE_UP_SIZE = { adept: 10, heroic: 10, mythic: 10, exalted: 5 };

const EXTERIORS = [
  { max: 0.07, name: 'Forge Fresh', short: 'FF', mult: 1.6 },
  { max: 0.15, name: 'Minimal Wear', short: 'MW', mult: 1.2 },
  { max: 0.38, name: 'Field-Tested', short: 'FT', mult: 1 },
  { max: 0.45, name: 'Well-Worn', short: 'WW', mult: 0.85 },
  { max: 1.01, name: 'Battle-Scarred', short: 'BS', mult: 0.7 },
];
const exteriorOf = (float) => EXTERIORS.find((e) => float < e.max) || EXTERIORS[EXTERIORS.length - 1];

const WEAPONS = {
  sword: 'Sword',
  dagger: 'Dagger',
  axe: 'Axe',
  hammer: 'Warhammer',
  staff: 'Staff',
  bow: 'Longbow',
  scythe: 'Scythe',
  spear: 'Spear',
  shield: 'Shield',
  greatsword: 'Greatsword',
  glaive: 'Glaive',
  fang: 'Fang Knife',
  saber: 'Moon Saber',
};

// Skins: [weapon, name, rarity, finish, colors, floatMin, floatMax]
// finish is how the pattern is drawn: fade, camo, stripes, marble, solid, crystal, gem, glyph, flame, scales.
const CASES = [
  {
    id: 'dragonfire',
    name: 'Dragonfire Case',
    icon: '🐉',
    color: '#c2451e',
    skins: [
      ['dagger', 'Ember Camo', 'adept', 'camo', ['#3a1a12', '#a33a16', '#e07a2e'], 0, 0.8],
      ['bow', 'Ash Stripes', 'adept', 'stripes', ['#2b2b2b', '#6b6b6b', '#c05a2a'], 0.06, 0.8],
      ['shield', 'Cinder', 'adept', 'solid', ['#5a2a1a', '#8a3a1a', '#d06a2a'], 0, 1],
      ['spear', 'Rust Marble', 'adept', 'marble', ['#5b2e1a', '#9a4a22', '#c98a4a'], 0.1, 1],
      ['hammer', 'Coal Runes', 'adept', 'glyph', ['#1c1c1c', '#3a2a22', '#ff7a2a'], 0, 0.6],
      ['sword', 'Molten Marble', 'heroic', 'marble', ['#3a0e06', '#d1461b', '#ffb347'], 0, 0.7],
      ['axe', 'Flamewake', 'heroic', 'flame', ['#2a0a04', '#e0431b', '#ffd24a'], 0, 0.5],
      ['staff', 'Emberglow', 'heroic', 'fade', ['#ff4e1b', '#ffb03a', '#ffe9a0'], 0, 0.08],
      ['scythe', 'Charcoal Crystal', 'heroic', 'crystal', ['#1a1a1a', '#4a2a22', '#ff6a2a'], 0, 1],
      ['greatsword', 'Phoenix Fade', 'mythic', 'fade', ['#ff2a2a', '#ff9a1a', '#ffe44a'], 0, 0.08],
      ['bow', 'Magma Crystal', 'mythic', 'crystal', ['#3a0a04', '#e0431b', '#ffb347'], 0, 0.6],
      ['hammer', 'Inferno Runes', 'mythic', 'glyph', ['#2a0a04', '#b3200a', '#ffd24a'], 0, 0.5],
      ['axe', "Dragon's Breath", 'exalted', 'flame', ['#200404', '#ff3a1a', '#ffe44a'], 0, 0.7],
      ['glaive', 'Sunfire', 'exalted', 'fade', ['#ff5a1a', '#ffd24a', '#fff6c0'], 0, 0.08],
    ],
    specials: [['fang', 'Dragonfang'], ['greatsword', 'Worldsplitter']],
  },
  {
    id: 'frostbite',
    name: 'Frostbite Case',
    icon: '❄️',
    color: '#2f7fc2',
    skins: [
      ['dagger', 'Snow Camo', 'adept', 'camo', ['#e8f1f7', '#9fb8c8', '#4f6f86'], 0, 0.8],
      ['bow', 'Glacier Stripes', 'adept', 'stripes', ['#1f3a52', '#6fa8d0', '#e8f6ff'], 0.06, 0.8],
      ['shield', 'Hoarfrost', 'adept', 'solid', ['#6f98b8', '#cfe6f5', '#ffffff'], 0, 1],
      ['spear', 'Slate Marble', 'adept', 'marble', ['#3a4a5a', '#7a8a9a', '#c8d8e8'], 0.1, 1],
      ['hammer', 'Rime Runes', 'adept', 'glyph', ['#16283a', '#2e4a66', '#9fe8ff'], 0, 0.6],
      ['sword', 'Blizzard', 'heroic', 'marble', ['#5a8ab0', '#d8ecf8', '#ffffff'], 0, 0.7],
      ['axe', 'Frozen Scales', 'heroic', 'scales', ['#10324a', '#3a8ab8', '#bff0ff'], 0, 0.6],
      ['staff', 'Aurora', 'heroic', 'fade', ['#3affc8', '#4a8aff', '#c85aff'], 0, 0.08],
      ['scythe', 'Ice Crystal', 'heroic', 'crystal', ['#0a2a44', '#5ab8e8', '#e8ffff'], 0, 1],
      ['greatsword', 'Northern Lights', 'mythic', 'fade', ['#2affb0', '#2a8aff', '#a44aff'], 0, 0.08],
      ['bow', 'Permafrost', 'mythic', 'crystal', ['#06182a', '#2a6ab0', '#aef4ff'], 0, 0.6],
      ['hammer', 'Frost Giant Runes', 'mythic', 'glyph', ['#0a1a2a', '#1a5a8a', '#aef4ff'], 0, 0.5],
      ['axe', 'Avalanche', 'exalted', 'marble', ['#ffffff', '#9fd8ff', '#2a5a9a'], 0, 0.7],
      ['glaive', 'Absolute Zero', 'exalted', 'scales', ['#020a14', '#1a6ad8', '#e8ffff'], 0, 0.5],
    ],
    specials: [['saber', 'Moonblade'], ['glaive', "Winter's Edge"]],
  },
  {
    id: 'shadowveil',
    name: 'Shadowveil Case',
    icon: '🌑',
    color: '#6d3fc2',
    skins: [
      ['dagger', 'Night Camo', 'adept', 'camo', ['#16121e', '#3a2a4a', '#5a4a6a'], 0, 0.8],
      ['bow', 'Grave Moss', 'adept', 'stripes', ['#1a2216', '#3a4a2a', '#7a9a4a'], 0.06, 0.8],
      ['shield', 'Obsidian', 'adept', 'solid', ['#0e0e14', '#24242e', '#5a5a7a'], 0, 1],
      ['spear', 'Bone Marble', 'adept', 'marble', ['#6a6252', '#b8ae96', '#e8e0cc'], 0.1, 1],
      ['hammer', 'Hex Runes', 'adept', 'glyph', ['#140e1e', '#2a1a3a', '#b05aff'], 0, 0.6],
      ['sword', 'Nightshade', 'heroic', 'marble', ['#12061e', '#5a1a8a', '#c07aff'], 0, 0.7],
      ['axe', 'Serpent Scales', 'heroic', 'scales', ['#0a1a0a', '#2a8a3a', '#aaff6a'], 0, 0.6],
      ['staff', 'Twilight', 'heroic', 'fade', ['#ff5ac8', '#8a4aff', '#2a2a8a'], 0, 0.08],
      ['scythe', 'Void Crystal', 'heroic', 'crystal', ['#06020e', '#3a1a6a', '#d05aff'], 0, 1],
      ['greatsword', 'Eclipse', 'mythic', 'fade', ['#ffcc4a', '#d02a6a', '#1a0a3a'], 0, 0.08],
      ['bow', 'Spectral Flame', 'mythic', 'flame', ['#06140e', '#1ad88a', '#c8ffe8'], 0, 0.6],
      ['hammer', 'Lich Runes', 'mythic', 'glyph', ['#04060a', '#1a3a2a', '#5affb0'], 0, 0.5],
      ['axe', 'Soulfire', 'exalted', 'flame', ['#0a0418', '#8a2aff', '#ff9aff'], 0, 0.7],
      ['glaive', 'Abyssal Crystal', 'exalted', 'crystal', ['#000000', '#2a0a5a', '#ff4ad8'], 0, 0.5],
    ],
    specials: [['scythe', 'Soulreaver'], ['fang', 'Nightfang']],
  },
];

// ★ relics: each special weapon comes in these four finishes (shared by all cases).
const SPECIAL_FINISHES = [
  ['Fade', 'fade', ['#ff5ac8', '#ffd24a', '#5ad8ff'], 0, 0.08],
  ['Gem', 'gem', ['#1a0a3a', '#6a2aff', '#ff4aa8'], 0, 0.08],
  ['Crystal Heart', 'crystal', ['#0a0a2a', '#5a3aff', '#ff5ad8'], 0, 0.5],
  ['Tempered Steel', 'marble', ['#2a5ad8', '#d8b04a', '#8a8a8a'], 0, 1],
];

// Small deterministic hash, so values and patterns never change between restarts.
function hash01(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const SKINS = {};
for (const c of CASES) {
  c.skinIds = [];
  const add = (skin) => {
    SKINS[skin.id] = skin;
    c.skinIds.push(skin.id);
  };
  c.skins.forEach(([weapon, name, rarity, finish, colors, min, max], i) => {
    add({ id: `${c.id}-${i + 1}`, case: c.id, weapon, weaponName: WEAPONS[weapon], name, rarity, finish, colors, min, max, star: false });
  });
  for (const [weapon, special] of c.specials) {
    for (const [fname, finish, colors, min, max] of SPECIAL_FINISHES) {
      const id = `${c.id}-${weapon}-${finish}`;
      add({ id, case: c.id, weapon, weaponName: special, name: fname, rarity: 'relic', finish, colors, min, max, star: true });
    }
  }
  delete c.skins;
}
for (const s of Object.values(SKINS)) s.base = Math.round(RARITIES[s.rarity].base * (0.8 + 0.5 * hash01(s.id)));
const CASE_BY_ID = Object.fromEntries(CASES.map((c) => [c.id, c]));
const skinsOf = (caseId, rarity) => CASE_BY_ID[caseId].skinIds.filter((id) => SKINS[id].rarity === rarity);
const fullName = (s) => `${s.star ? '★ ' : ''}${s.weaponName} | ${s.name}`;

// Case prices are set so a case pays back about 88% of its price in relic value on average.
const RETURN = 0.88;
const SOUL_CHANCE = 0.1;

function pickRarity(rng) {
  let r = rng();
  for (const id of RARITY_IDS) {
    if (r < RARITIES[id].odds) return id;
    r -= RARITIES[id].odds;
  }
  return 'adept';
}

const rollFloat = (skin, rng) => Math.round((skin.min + (skin.max - skin.min) * rng()) * 1e6) / 1e6;

// One relic from a case (no id/owner yet).
function openCase(caseId, rng) {
  const rarity = pickRarity(rng);
  const pool = skinsOf(caseId, rarity);
  const skin = SKINS[pool[Math.floor(rng() * pool.length)]];
  return { skin: skin.id, float: rollFloat(skin, rng), seed: Math.floor(rng() * 1000), soul: rng() < SOUL_CHANCE };
}

// ---- Patterns ------------------------------------------------------------------------------
const GEM_PHASES = [
  { max: 10, name: 'Sapphire', mult: 5, colors: ['#020a3a', '#1a4aff', '#6ad8ff'] },
  { max: 25, name: 'Ruby', mult: 4, colors: ['#2a0206', '#d8102a', '#ff6a7a'] },
  { max: 40, name: 'Black Pearl', mult: 3, colors: ['#020204', '#2a1a4a', '#8a6aff'] },
  { max: 45, name: 'Emerald', mult: 6, colors: ['#021a0a', '#0ad85a', '#aaffc8'] },
];
const PHASE_MULTS = [1, 1.05, 0.95, 1.15];

// What a pattern seed means for this skin: a label, a value multiplier, and colours for gems.
function patternOf(skinId, seed) {
  const s = SKINS[skinId];
  if (!s) return { label: '', mult: 1 };
  if (s.finish === 'fade') {
    const pct = 80 + Math.floor(hash01(`${skinId}:${seed}:fade`) * 21);
    return { label: `${pct}% Fade`, fade: pct, mult: pct === 100 ? 1.6 : pct >= 97 ? 1.25 : 1, rare: pct >= 97 };
  }
  if (s.finish === 'gem') {
    const g = GEM_PHASES.find((p) => seed < p.max);
    if (g) return { label: g.name, mult: g.mult, colors: g.colors, rare: true };
    const phase = (seed % 4) + 1;
    return { label: `Phase ${phase}`, mult: PHASE_MULTS[phase - 1] };
  }
  const tempered = s.star && s.name === 'Tempered Steel';
  const roll = hash01(`${skinId}:${seed}:pattern`);
  if (tempered && roll < 0.005) return { label: 'Blue Temper', mult: 5, rare: true };
  if (['marble', 'crystal', 'glyph', 'scales', 'flame'].includes(s.finish) && roll < 0.01) return { label: 'Rare pattern', mult: 2.5, rare: true };
  return { label: '', mult: 1 };
}

// What a copy is worth. copy: { skin, float, seed, soul }
function valueOf(copy) {
  const s = SKINS[copy.skin];
  if (!s) return 0;
  const ext = exteriorOf(copy.float).mult;
  const low = copy.float < 0.001 ? 2.5 : copy.float < 0.01 ? 1.4 : 1;
  return Math.max(1, Math.round(s.base * ext * low * (copy.soul ? 1.8 : 1) * patternOf(copy.skin, copy.seed).mult));
}

// ---- Trade-up contracts ---------------------------------------------------------------------
// inputs: [{ skin, float, soul }] all of one rarity. Returns { error } or { rarity, soul, outcomes }
// where outcomes are the possible results with their chance and the float they'd get.
function tradeUpPreview(inputs) {
  if (!inputs.length) return { error: 'pick some relics.' };
  const rarity = SKINS[inputs[0].skin]?.rarity;
  if (!rarity || !NEXT_RARITY[rarity]) return { error: "★ relics can't be traded up." };
  if (inputs.some((i) => SKINS[i.skin].rarity !== rarity)) return { error: 'every relic in a contract must be the same rarity.' };
  const size = TRADE_UP_SIZE[rarity];
  if (inputs.length !== size) return { error: `a ${RARITIES[rarity].name} contract takes exactly ${size} relics.` };
  const soul = !!inputs[0].soul;
  if (inputs.some((i) => !!i.soul !== soul)) return { error: "SoulTrak™ and normal relics can't be mixed in one contract." };
  const next = NEXT_RARITY[rarity];
  // Float: the average of where each input sits in its own float range, mapped into the output's range.
  const avg = inputs.reduce((sum, i) => {
    const s = SKINS[i.skin];
    return sum + (s.max > s.min ? (i.float - s.min) / (s.max - s.min) : 0);
  }, 0) / inputs.length;
  const chances = {};
  for (const i of inputs) {
    const pool = skinsOf(SKINS[i.skin].case, next);
    for (const id of pool) chances[id] = (chances[id] || 0) + 1 / inputs.length / pool.length;
  }
  const outcomes = Object.entries(chances)
    .map(([id, chance]) => {
      const s = SKINS[id];
      const float = Math.round((s.min + avg * (s.max - s.min)) * 1e6) / 1e6;
      return { skin: id, chance, float, value: valueOf({ skin: id, float, seed: 500, soul }) };
    })
    .sort((a, b) => b.chance - a.chance || b.value - a.value);
  return { rarity, next, soul, outcomes };
}

function tradeUp(inputs, rng) {
  const p = tradeUpPreview(inputs);
  if (p.error) return p;
  let r = rng();
  let pick = p.outcomes[p.outcomes.length - 1];
  for (const o of p.outcomes) {
    if (r < o.chance) {
      pick = o;
      break;
    }
    r -= o.chance;
  }
  return { skin: pick.skin, float: pick.float, seed: Math.floor(rng() * 1000), soul: p.soul };
}

// Expected value of one case (for the case list).
function caseEv(caseId) {
  let total = 0;
  const N = 60;
  for (const rarity of RARITY_IDS) {
    const pool = skinsOf(caseId, rarity);
    let sum = 0;
    for (const id of pool) {
      const s = SKINS[id];
      for (let k = 0; k < N; k++) {
        const float = s.min + ((k + 0.5) / N) * (s.max - s.min);
        for (let seed = 7; seed < 1000; seed += 50) sum += valueOf({ skin: id, float, seed, soul: false });
      }
    }
    const perCopy = sum / (pool.length * N * 20);
    total += RARITIES[rarity].odds * perCopy;
  }
  return Math.round(total * (1 - SOUL_CHANCE + SOUL_CHANCE * 1.8));
}

for (const c of CASES) {
  c.ev = caseEv(c.id);
  c.price = Math.max(50, Math.round(c.ev / RETURN / 50) * 50);
}

module.exports = {
  RARITIES,
  RARITY_IDS,
  NEXT_RARITY,
  TRADE_UP_SIZE,
  EXTERIORS,
  WEAPONS,
  CASES,
  CASE_BY_ID,
  SKINS,
  RETURN,
  SOUL_CHANCE,
  GEM_PHASES,
  exteriorOf,
  fullName,
  openCase,
  patternOf,
  valueOf,
  tradeUpPreview,
  tradeUp,
  caseEv,
};
