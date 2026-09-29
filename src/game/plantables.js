// What you can grow. Every crop feeds another skill, so Farming supports the rest of the game instead
// of being a points printer: crops sell for little, the value is in using them.
//
// 15 crop lines with 5 tiers each (better tiers unlock with Farming level and do more), plus Coffee,
// which is special: its seeds only come from gifting subs (see events.js). skills.js turns these into
// items, seeds, farming resources and the recipes/uses of each line.
//
// line: { id, skill, use, start (Farming level of tier 1), text, tiers: [[id, name, icon], ...] }
//   use: cook (a dish per tier) | heal-herb / mana-herb (potions) | flax (bows) | cotton (cloth robes)
//        | rune (Magic Runes) | resin (fires) | booster (+1 item and better rare odds for a gathering
//        skill) | flux (smelting doubles) | dye (outfit colors) | coffee (Trail Brew)
const TIER_OFFSETS = [0, 60, 150, 270, 420]; // Farming levels after a line's first tier

const LINES = [
  { id: 'carrot', skill: 'cooking', use: 'cook', dish: 'Roasted', start: 1, text: 'Cook it into a hearty meal (!cook)',
    tiers: [['carrot', 'Carrot', '🥕'], ['sweet_carrot', 'Sweet Carrot', '🥕'], ['golden_carrot', 'Golden Carrot', '🥕'], ['sunburst_carrot', 'Sunburst Carrot', '🥕'], ['starcarrot', 'Starcarrot', '🥕']] },
  { id: 'mint', skill: 'alchemy', use: 'heal-herb', start: 3, text: 'Brew health potions (!brew)',
    tiers: [['mint', 'Mint', '🍃'], ['chamomile', 'Chamomile', '🌼'], ['ginseng', 'Ginseng', '🌰'], ['mandrake', 'Mandrake Root', '😱'], ['lifebloom', 'Lifebloom', '💗']] },
  { id: 'flax', skill: 'fletching', use: 'flax', start: 5, text: 'Bowstrings: every bow needs flax (!fletch)',
    tiers: [['flax', 'Flax', '💠'], ['silkflax', 'Silkflax', '💠'], ['ironflax', 'Ironflax', '💠'], ['stormflax', 'Stormflax', '💠'], ['starflax', 'Starflax', '💠']] },
  { id: 'potato', skill: 'cooking', use: 'cook', dish: 'Baked', start: 8, text: 'Bake it into a filling meal (!cook)',
    tiers: [['potato', 'Potato', '🥔'], ['red_potato', 'Red Potato', '🥔'], ['sweet_potato', 'Sweet Potato', '🍠'], ['moon_potato', 'Moon Potato', '🥔'], ['dragon_potato', 'Dragon Potato', '🥔']] },
  { id: 'lavender', skill: 'alchemy', use: 'mana-herb', start: 10, text: 'Brew mana potions (!brew)',
    tiers: [['lavender', 'Lavender', '💜'], ['sage', 'Sage', '🍀'], ['snapdragon', 'Snapdragon', '🌺'], ['moonpetal', 'Moonpetal', '🌙'], ['starbloom', 'Starbloom', '🌟']] },
  { id: 'glowmoss', skill: 'fishing', use: 'booster', start: 12, text: 'Bait: used up by !fish for +1 fish and better rare odds',
    tiers: [['glowmoss', 'Glowmoss', '🌿'], ['brightmoss', 'Brightmoss', '🌿'], ['lanternmoss', 'Lanternmoss', '🌿'], ['moonmoss', 'Moonmoss', '🌿'], ['starmoss', 'Starmoss', '🌿']] },
  { id: 'pine_resin', skill: 'firemaking', use: 'resin', start: 15, text: 'Fire starter: used up by !lightfire for a longer fire that cooks more meals',
    tiers: [['pine_resin', 'Pine Resin', '🌲'], ['amber_resin', 'Amber Resin', '🟠'], ['fire_resin', 'Fire Resin', '🔥'], ['sun_resin', 'Sun Resin', '☀️'], ['star_resin', 'Star Resin', '🌟']] },
  { id: 'wheat', skill: 'cooking', use: 'cook', start: 18, text: 'Bake it into bread (!cook)',
    tiers: [['wheat', 'Wheat', '🌾'], ['barley', 'Barley', '🌾'], ['rye', 'Rye', '🌾'], ['golden_grain', 'Golden Grain', '🌾'], ['starwheat', 'Starwheat', '🌾']],
    dishes: [['wheat_bread', 'Wheat Bread', '🍞'], ['barley_bread', 'Barley Bread', '🍞'], ['rye_bread', 'Rye Bread', '🍞'], ['golden_loaf', 'Golden Loaf', '🥖'], ['starwheat_loaf', 'Starwheat Loaf', '🥖']] },
  { id: 'cotton', skill: 'crafting', use: 'cotton', start: 20, text: 'Weave cloth robes for Magic (!craft)',
    tiers: [['cotton', 'Cotton', '☁️'], ['soft_cotton', 'Soft Cotton', '☁️'], ['silk_cotton', 'Silk Cotton', '☁️'], ['moon_cotton', 'Moon Cotton', '☁️'], ['star_cotton', 'Star Cotton', '☁️']] },
  { id: 'stoneroot', skill: 'mining', use: 'booster', start: 22, text: "Miner's charm: used up by !mine for +1 ore and better rare odds",
    tiers: [['stoneroot', 'Stoneroot', '🪨'], ['ironroot', 'Ironroot', '🪨'], ['goldroot', 'Goldroot', '🪨'], ['crystalroot', 'Crystalroot', '💎'], ['voidroot', 'Voidroot', '🌑']] },
  { id: 'runebloom', skill: 'magic', use: 'rune', start: 25, text: 'Petals for Magic Runes: far more runes than Ashes and Tin (!craft runes)',
    tiers: [['runebloom', 'Runebloom', '🌸'], ['arcane_bloom', 'Arcane Bloom', '🌸'], ['mystic_bloom', 'Mystic Bloom', '🌸'], ['ether_bloom', 'Ether Bloom', '🌸'], ['astral_bloom', 'Astral Bloom', '🌸']] },
  { id: 'truffle', skill: 'digging', use: 'booster', start: 28, text: 'Truffle hound treat: used up by !dig for +1 find and better rare odds',
    tiers: [['truffle', 'Truffle', '🍄'], ['black_truffle', 'Black Truffle', '🍄'], ['golden_truffle', 'Golden Truffle', '🍄'], ['moon_truffle', 'Moon Truffle', '🍄'], ['star_truffle', 'Star Truffle', '🍄']] },
  { id: 'tanbark', skill: 'skinning', use: 'booster', start: 30, text: 'Tanning bark: used up by !skin for +1 hide and better rare odds',
    tiers: [['tanbark', 'Tanbark', '🟫'], ['hunters_bark', "Hunter's Bark", '🟫'], ['wildbark', 'Wildbark', '🟫'], ['beastbark', 'Beastbark', '🟫'], ['dragonbark', 'Dragonbark', '🟫']] },
  { id: 'emberroot', skill: 'smelting', use: 'flux', start: 33, text: 'Flux: used up by !smelt for a much better chance to smelt two',
    tiers: [['emberroot', 'Emberroot', '🔥'], ['flameroot', 'Flameroot', '🔥'], ['magmaroot', 'Magmaroot', '🌋'], ['sunforge_root', 'Sunforge Root', '☀️'], ['starforge_root', 'Starforge Root', '🌟']] },
  { id: 'rose_madder', skill: 'crafting', use: 'dye', start: 36, text: 'Dye flowers: unlock a new outfit color on the Customize page',
    tiers: [['rose_madder', 'Rose Madder', '🌹'], ['woad', 'Woad', '🔵'], ['marigold', 'Marigold', '🌼'], ['moonlily', 'Moonlily', '🤍'], ['starflower', 'Starflower', '✨']],
    // Outfit colors unlocked by each flower (3 flowers, once).
    colors: [['crimson', 'Crimson', '#9e1b32'], ['indigo', 'Indigo', '#2e2a8a'], ['saffron', 'Saffron', '#e0a526'], ['silver', 'Silver', '#b9c0c8'], ['celestial', 'Celestial', '#43c6c9']] },
];

// Coffee: one tier, special. Seeds can't be bought: gifting subs earns them. 2 beans per plot, and
// 2 beans brew a Trail Brew (restores 1 stamina charge, once an hour).
const COFFEE = { id: 'coffee_beans', name: 'Coffee Beans', icon: '☕', level: 20, yield: 2, text: 'Brew a Trail Brew (restores a stamina charge, once an hour). Seeds only come from gifting subs!' };

module.exports = { LINES, TIER_OFFSETS, COFFEE };
