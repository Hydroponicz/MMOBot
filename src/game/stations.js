// Gathering stations: the farming loop for the other gathering skills. Place stations, come back
// later, and !collect everything they gathered in one go. Like farm plots, everyone gets one free
// station per skill and each extra one costs more than the last (see features/stations.js).
const { ITEMS, SHOP, SKILLS } = require('./skills');

const STATIONS = [
  { skill: 'fishing', item: 'crab_pot', name: 'Crab Pot', icon: '🦀', verb: 'hauled', cost: 750, text: 'Catches fish while you do other things' },
  { skill: 'mining', item: 'ore_drill', name: 'Ore Drill', icon: '⚙️', verb: 'drilled', cost: 750, text: 'Mines ore while you do other things' },
  { skill: 'woodcutting', item: 'tree_sapling', name: 'Tree Sapling', icon: '🌳', verb: 'felled', cost: 750, text: 'Grows into logs while you do other things' },
  { skill: 'digging', item: 'dig_site', name: 'Dig Site', icon: '🏺', verb: 'dug up', cost: 750, text: 'Turns up finds while you do other things' },
];
const MAX_STATIONS = 100;
const STARTER_STATIONS = 1;

for (const s of STATIONS) {
  ITEMS[s.item] = { name: s.name, icon: s.icon, value: 0, notItem: true };
  // Listed right after the farm plot in the shop.
  const at = SHOP.findIndex((x) => x.item === 'farm_plot');
  SHOP.splice(at + 1 + STATIONS.indexOf(s), 0, {
    item: s.item,
    cost: s.cost,
    category: 'stations',
    description: `${s.text}. Each one gathers a ${SKILLS[s.skill].name} resource every 20+ min, with the XP; !collect brings them all in. Up to ${MAX_STATIONS}.`,
  });
}

module.exports = { STATIONS, MAX_STATIONS, STARTER_STATIONS };
