// Player houses: the end-game points sink. Each house adds stamina charges (a flat increase to the
// stamina bar) and needs a character level, so they're a goal for the richest, most-trained players.
// You own one house at a time; moving up costs the next house's full price. Prices, charges and levels
// are editable in Admin -> Settings (Houses table).
const HOUSES = [
  { id: 'cottage', name: 'Cottage', icon: '🛖', charges: 1, cost: 150_000, level: 25, text: 'A snug little place to rest your feet.' },
  { id: 'house', name: 'House', icon: '🏡', charges: 2, cost: 500_000, level: 40, text: 'A proper home with a garden and a comfy bed.' },
  { id: 'manor', name: 'Manor', icon: '🏘️', charges: 3, cost: 1_500_000, level: 60, text: 'Servants, stables and a very long hallway.' },
  { id: 'castle', name: 'Castle', icon: '🏰', charges: 4, cost: 5_000_000, level: 80, text: 'Stone walls, a moat and your own banner.' },
  { id: 'palace', name: 'Palace', icon: '🏯', charges: 5, cost: 15_000_000, level: 100, text: 'The finest residence in the realm.' },
];

module.exports = { HOUSES };
