// Fish sizes and fishing spots. Every fish caught gets its own length and weight: most land near
// the middle of their species' range, a few are runts, and about 1 in 40 is a trophy that can
// beat the usual maximum. Weight follows length cubed, so a long fish is a much heavier one.
// The look (shape, colors, pattern) is what the Fishing page's 3D models are built from.

// id: [min length cm, max length cm, weight kg at max length, look]
// look: { shape, top, belly, fin, pattern, accent } shapes: fish, billfish, shark, eel, serpent, ray,
// squid, octopus, shrimp, lobster, angler, whale.
const FISH = {
  shrimp: [4, 12, 0.025, { shape: 'shrimp', top: '#f08a6a', belly: '#ffd0b8', fin: '#e8664a' }],
  sardine: [12, 24, 0.2, { shape: 'fish', body: 'slim', top: '#3b6b8f', belly: '#e8f0f4', fin: '#9fb6c6', pattern: 'spots', accent: '#1f3f5a' }],
  herring: [20, 40, 0.7, { shape: 'fish', body: 'slim', top: '#4a6f8a', belly: '#f2f5f7', fin: '#a9bccb', pattern: 'sheen', accent: '#b8e0ff' }],
  trout: [30, 75, 5, { shape: 'fish', body: 'normal', top: '#6b7a3e', belly: '#f3e1c6', fin: '#a88a5a', pattern: 'spots', accent: '#e8546a', stripe: '#e88a8a' }],
  salmon: [50, 110, 20, { shape: 'fish', body: 'normal', top: '#50627a', belly: '#f6ecef', fin: '#8494a8', pattern: 'spots', accent: '#1d2a3a', hook: true }],
  tuna: [80, 250, 400, { shape: 'fish', body: 'torpedo', top: '#1f3a6b', belly: '#dfe6ee', fin: '#f2c53d', pattern: 'finlets', accent: '#f2c53d' }],
  lobster: [20, 60, 6, { shape: 'lobster', top: '#9b2a1c', belly: '#d8573a', fin: '#6e1a10' }],
  swordfish: [120, 400, 500, { shape: 'billfish', body: 'torpedo', top: '#343a55', belly: '#c8ccd8', fin: '#2a2e44', bill: 'sword' }],
  shark: [150, 600, 1500, { shape: 'shark', top: '#6b7886', belly: '#eef1f4', fin: '#5a6674' }],
  anglerfish: [20, 100, 25, { shape: 'angler', top: '#3a2e2a', belly: '#5a4a40', fin: '#2a201c', accent: '#b8ffea' }],
  manta_ray: [300, 700, 2000, { shape: 'ray', top: '#23272e', belly: '#f2f2ee', fin: '#1a1d22' }],
  giant_squid: [400, 1300, 275, { shape: 'squid', top: '#c2553a', belly: '#e8a080', fin: '#9a3a26' }],
  giant_octopus: [200, 600, 70, { shape: 'octopus', top: '#b04a3a', belly: '#e0907a', fin: '#8a3226' }],
  abyssal_eel: [100, 400, 60, { shape: 'eel', top: '#1e2a3a', belly: '#3a4a5a', fin: '#2a3a4a', accent: '#5affd8' }],
  blue_marlin: [200, 500, 800, { shape: 'billfish', body: 'torpedo', top: '#16357a', belly: '#dfe8f0', fin: '#2a4fa0', bill: 'spear', pattern: 'bars', accent: '#6ab8ff', sail: true }],
  coelacanth: [100, 200, 90, { shape: 'fish', body: 'deep', top: '#2a3a5a', belly: '#4a5a78', fin: '#34466a', pattern: 'spots', accent: '#e8eef8', lobed: true }],
  sea_serpent: [800, 2500, 4000, { shape: 'serpent', top: '#1f6b5a', belly: '#b8e0c8', fin: '#e8c24a', accent: '#e8c24a' }],
  leviathan: [2000, 5000, 60000, { shape: 'serpent', top: '#2a1f4a', belly: '#6a5a9a', fin: '#8a5aff', accent: '#c8a8ff', horns: true }],
  celestial_whale: [2500, 4000, 150000, { shape: 'whale', top: '#1a2a6a', belly: '#c8d8ff', fin: '#3a5ab8', accent: '#fff6c0', stars: true }],
  golden_fish: [15, 40, 1.5, { shape: 'fish', body: 'deep', top: '#f2b81a', belly: '#fff0a0', fin: '#ffcf4a', pattern: 'sheen', accent: '#fff8d0', glow: '#ffd24a' }],
};

// Where you can fish on the website. Chat !fish uses any water (every fish you've unlocked).
const SPOTS = [
  { id: 'harbor', name: 'Harbor Pier', icon: '⚓', level: 1, fish: ['shrimp', 'sardine', 'herring', 'lobster', 'tuna'], sky: '#8ec9f0', water: '#2f7fb5', text: 'Salt air, gulls and crates of bait. Small fish, lobster pots, and tuna further out.' },
  { id: 'river', name: 'Silverrun River', icon: '🏞️', level: 20, fish: ['trout', 'salmon', 'herring'], sky: '#a8d8b0', water: '#3f8f8a', text: 'Clear, cold water tumbling over stones. Trout in the shallows, salmon running upstream.' },
  { id: 'open', name: 'The Open Sea', icon: '🌅', level: 40, fish: ['tuna', 'swordfish', 'shark', 'manta_ray', 'blue_marlin'], sky: '#f6b27a', water: '#1d4f8a', text: 'Nothing but horizon. Big-game country: billfish, sharks and rays.' },
  { id: 'trench', name: 'Abyssal Trench', icon: '🌑', level: 100, fish: ['anglerfish', 'giant_squid', 'giant_octopus', 'abyssal_eel', 'coelacanth'], sky: '#1a2240', water: '#0a1430', text: 'A long line into the dark. Things down here glow, and some of them are very big.' },
  { id: 'reach', name: "Serpent's Reach", icon: '🐉', level: 400, fish: ['sea_serpent', 'leviathan', 'celestial_whale'], sky: '#3a2a5a', water: '#1a1040', text: 'The edge of the map. The old stories were true.' },
];
const SPOT_BY_ID = Object.fromEntries(SPOTS.map((s) => [s.id, s]));

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// Rolls one catch's size. rng() -> [0, 1).
function rollSize(fish, rng) {
  const [min, max, wMax] = FISH[fish];
  // Near the middle most of the time (the mean of three rolls), sometimes a runt or a big one.
  let t = (rng() + rng() + rng()) / 3;
  // About 1 in 40 is a trophy: up to 25% past the usual maximum.
  if (rng() < 0.025) t = 1 + rng() * 0.25;
  const length = min + (max - min) * t;
  // Weight grows with length cubed, with a little give either way (a fat one, a skinny one).
  const weight = wMax * (length / max) ** 3 * (0.9 + rng() * 0.2);
  return { length: round(length, 1), weight: round(weight, weight < 1 ? 3 : weight < 100 ? 2 : 1), trophy: t > 1 };
}

// "42.3 cm" / "3.4 m"; "850 g" / "12.4 kg" / "1.5 t"
function fmtLength(cm) {
  return cm >= 100 ? `${round(cm / 100, 2)} m` : `${round(cm, 1)} cm`;
}
function fmtWeight(kg) {
  if (kg < 1) return `${Math.round(kg * 1000)} g`;
  if (kg >= 1000) return `${round(kg / 1000, 2)} t`;
  return `${round(kg, kg < 100 ? 2 : 1)} kg`;
}

// Where a catch sits in its species' range: 0 = smallest, 1 = usual max, >1 = trophy.
function sizeScore(fish, length) {
  const [min, max] = FISH[fish];
  return (length - min) / (max - min);
}

module.exports = { FISH, SPOTS, SPOT_BY_ID, rollSize, fmtLength, fmtWeight, sizeScore };
