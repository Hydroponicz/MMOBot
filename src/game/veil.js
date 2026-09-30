// The Gloamveil: a fog-drowned realm between worlds, and the game's extraction minigame (see
// features/veil.js). Four depths, each deeper and richer. You walk in wearing your gear, loot what
// you can, and only keep it if you reach a Waystone and extract. Die in there (to a monster, another
// player, or the fog closing) and you lose everything you brought and found.
//
// Adds the Veil loot items to ITEMS. Required once by skills.js, like content.js.
const { ITEMS } = require('./skills');

// zone: { id, name, icon, minCombat, fee, monsters: [lowest, deepest] monster level (monsters also
//         stay near your own level: up to +12% per room deeper), text,
//         loot: [[id, name, icon, value], ...] common to rare (the last one is the rarest) }
const ZONES = [
  {
    id: 1, name: 'Mistfen Hollows', icon: '🌫️', minCombat: 1, fee: 500, monsters: [1, 35],
    text: 'Drowned lanterns and sunken shrines under a fog that never lifts.',
    loot: [['wisp_shard', 'Wisp Shard', '🫧', 20], ['bog_amber', 'Bog Amber', '🟠', 45], ['drowned_coin', 'Drowned Coin', '🪙', 110], ['mistfen_idol', 'Mistfen Idol', '🗿', 700]],
  },
  {
    id: 2, name: 'The Drowned Choir', icon: '🔔', minCombat: 40, fee: 2500, monsters: [40, 130],
    text: 'A cathedral under black water, where something still sings.',
    loot: [['choir_bell', 'Choir Bell', '🔔', 150], ['tidebone', 'Tidebone', '🦴', 300], ['hymn_pearl', 'Hymn Pearl', '⚪', 650], ['siren_crown', "Siren's Crown", '👑', 4500]],
  },
  {
    id: 3, name: 'Umbral Sanctum', icon: '🌘', minCombat: 120, fee: 10000, monsters: [130, 350],
    text: 'Halls lit by a sun that set a thousand years ago.',
    loot: [['umbral_ichor', 'Umbral Ichor', '🖤', 700], ['sanctum_relic', 'Sanctum Relic', '🏺', 1400], ['void_sigil', 'Void Sigil', '🔯', 3000], ['eclipsed_heart', 'Eclipsed Heart', '🌑', 20000]],
  },
  {
    id: 4, name: 'Heart of the Veil', icon: '👁️', minCombat: 300, fee: 40000, monsters: [350, 500],
    text: 'Where the fog is thinnest, and the dreaming thing beneath is closest.',
    loot: [['veil_thread', 'Veil Thread', '🕸️', 2800], ['starless_ember', 'Starless Ember', '✴️', 5500], ['dreaming_eye', 'Dreaming Eye', '👁️', 12000], ['crown_of_whispers', 'Crown of Whispers', '💀', 80000]],
  },
];

for (const z of ZONES) {
  z.loot.forEach(([id, name, icon, value], i) => {
    if (ITEMS[id]) throw new Error(`veil item ${id} clashes with an existing item`);
    ITEMS[id] = { name, icon, value, veil: z.id, veilRare: i === z.loot.length - 1 };
  });
}

// Rooms per run: 0 is the way in, ROOMS - 1 the deepest. Waystones (extraction points) always stand in
// these rooms; others can turn one up when searched.
const ROOMS = 6;
const WAYSTONES = [2, 5];

module.exports = { ZONES, ROOMS, WAYSTONES };
