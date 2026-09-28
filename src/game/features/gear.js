// GameEngine methods: armor set bonuses and enchanting. Mixed into GameEngine.prototype by engine.js.
const { ITEMS } = require('../skills');
const { fmt, itemLabel, findItem } = require('./shared');

// Enchanting: +4% attack/defence per level on that item, up to +5.
const ENCHANT_MAX = 5;
const ENCHANT_BONUS = 0.04;
const ENCHANT_CHANCE = [0.9, 0.75, 0.6, 0.45, 0.3];
// Set bonus: helmet + body + legs of the same material.
const SET_DEFENCE = 1.1;
const SET_ATTACK = 1.05;

// "mithril" for mithril_helmet, "bear" for bear_coif, null for anything else.
function materialOf(id) {
  const m = /^(.+)_(helmet|platebody|platelegs|coif|body|chaps)$/.exec(id || '');
  return m ? m[1] : null;
}

module.exports = {
  // ---- Sets ------------------------------------------------------------------------------
  // { material, name } when helmet, body and legs are all the same material, else null.
  armorSet(worn) {
    const mats = ['head', 'body', 'legs'].map((slot) => materialOf(worn[slot]));
    if (!mats[0] || mats.some((m) => m !== mats[0])) return null;
    const name = ITEMS[worn.head].name.split(' ').slice(0, -1).join(' ');
    return { material: mats[0], name, defence: SET_DEFENCE, attack: SET_ATTACK };
  },

  // ---- Enchanting --------------------------------------------------------------------------
  enchantLevel(userId, itemId) {
    return this.repo.getEquipment(userId)[`ench:${itemId}`] || 0;
  },

  enchantMult(userId, itemId) {
    return 1 + ENCHANT_BONUS * this.enchantLevel(userId, itemId);
  },

  enchantCost(level) {
    const next = level + 1;
    return { ashes: next * 10, points: next * next * 1000, gem: next >= 4 ? 1 : 0, chance: ENCHANT_CHANCE[level] };
  },

  // "Mithril Sword +3"
  gearName(userId, itemId) {
    const n = this.enchantLevel(userId, itemId);
    return `${ITEMS[itemId].name}${n ? ` +${n}` : ''}`;
  },

  // !enchant [item]: spend Ashes and points (and a Shadow Gem for +4/+5) to add a level. Can fail.
  enchant(user, args = []) {
    const p = this.cfg.prefix;
    const inv = this.repo.getInventory(user.id);
    const worn = this.repo.getWorn(user.id);
    const owned = [...new Set([...Object.values(worn), ...Object.keys(inv).filter((id) => inv[id] > 0)])].filter((id) => ITEMS[id]?.gear);
    if (!args.length) {
      const list = Object.values(worn)
        .filter((id) => ITEMS[id]?.gear)
        .map((id) => `${ITEMS[id].icon} ${this.gearName(user.id, id)}`);
      return `✨ enchanting adds +${ENCHANT_BONUS * 100}% attack or defence per level (up to +${ENCHANT_MAX}) for Ashes and points. ${p}enchant mithril sword.${list.length ? ` Worn: ${list.join(', ')}` : ''}`;
    }
    const id = findItem(args.join(' '), owned);
    if (!id) return `you don't have that gear. ${p}enchant <weapon or armor you own>`;
    const level = this.enchantLevel(user.id, id);
    if (level >= ENCHANT_MAX) return `your ${ITEMS[id].name} is already +${ENCHANT_MAX}, the max!`;
    const cost = this.enchantCost(level);
    const lacking = [];
    if ((inv.ashes || 0) < cost.ashes) lacking.push(`${cost.ashes} 🌫️ Ashes (!lightfire)`);
    if (cost.gem && !inv.shadow_gem) lacking.push('a 💠 Shadow Gem (from !dungeon bosses)');
    if (this.repo.getUser(user.id).points < cost.points) lacking.push(`${fmt(cost.points)} pts`);
    if (lacking.length) return `enchanting ${ITEMS[id].name} to +${level + 1} needs ${lacking.join(', ')}.`;
    const ok = this.rng() < cost.chance;
    this.repo.transaction(() => {
      this.repo.removeItem(user.id, 'ashes', cost.ashes);
      if (cost.gem) this.repo.removeItem(user.id, 'shadow_gem', 1);
      this.repo.addPoints(user.id, -cost.points);
      if (ok) this.repo.setEquipment(user.id, `ench:${id}`, level + 1);
    });
    this.track('shop', cost.points);
    if (!ok) return `💨 the enchantment fizzled (${Math.round(cost.chance * 100)}% chance)... your ${ITEMS[id].name} stays +${level}. The materials are gone.`;
    if (level + 1 >= 3) this.emitActivity(user, { kind: 'upgrade', item: id, text: `enchanted a ${ITEMS[id].name} to +${level + 1}! ✨` });
    return `✨ success! ${itemLabel(id)} is now +${level + 1} (+${Math.round((level + 1) * ENCHANT_BONUS * 100)}% ${ITEMS[id].attack ? 'attack' : 'defence'}).${level + 1 < ENCHANT_MAX ? ` Next: ${Math.round(this.enchantCost(level + 1).chance * 100)}% chance.` : ''}`;
  },
};
