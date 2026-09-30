// GameEngine methods: player houses (!house). Each tier adds stamina charges; see ../houses.js.
// Mixed into GameEngine.prototype by engine.js.
const { HOUSES } = require('../houses');
const { SKILL_IDS, characterProgress, fmt } = require('./shared');

module.exports = {
  // The house tiers with live prices from the settings table (a cost of 0 = not for sale).
  houses() {
    const live = new Map((this.settings.all.houses || []).map((r) => [r.id, r]));
    return HOUSES.map((h) => ({ ...h, ...(live.get(h.id) || {}) }));
  },

  // The player's house (null = none). Stored as the tier number in the equipment slots.
  house(userId) {
    const tier = this.repo.getEquipment(userId).house || 0;
    return tier ? this.houses()[Math.min(tier, HOUSES.length) - 1] : null;
  },

  // Extra stamina charges from the player's house.
  houseCharges(userId) {
    if (this.cfg.housesEnabled === false) return 0;
    return this.house(userId)?.charges || 0;
  },

  characterLevel(userId) {
    const xp = this.repo.getSkills(userId);
    return characterProgress(SKILL_IDS.map((id) => xp[id])).level;
  },

  // For the website: every house with whether this player owns it, can buy it, or what's missing.
  houseInfo(userId = null) {
    const tier = userId ? this.repo.getEquipment(userId).house || 0 : 0;
    const level = userId ? this.characterLevel(userId) : null;
    const points = userId ? this.repo.getUser(userId).points : null;
    return {
      on: this.cfg.housesEnabled !== false,
      tier,
      level,
      houses: this.houses().map((h, i) => ({
        ...h,
        tier: i + 1,
        owned: tier === i + 1,
        below: i + 1 < tier,
        next: i + 1 === tier + 1,
        forSale: h.cost > 0,
        canBuy: userId !== null && i + 1 === tier + 1 && h.cost > 0 && level >= h.level && points >= h.cost,
      })),
    };
  },

  // Buys the next house. Returns the reply text.
  buyHouse(user) {
    const p = this.cfg.prefix;
    if (this.cfg.housesEnabled === false) return 'houses are switched off right now.';
    const list = this.houses();
    const tier = this.repo.getEquipment(user.id).house || 0;
    const next = list[tier];
    if (!next) return `you already own the finest house there is: ${list[tier - 1].icon} ${list[tier - 1].name}! 👑`;
    if (!(next.cost > 0)) return `the ${next.icon} ${next.name} isn't for sale right now.`;
    const level = this.characterLevel(user.id);
    if (level < next.level) return `the ${next.icon} ${next.name} needs character level ${next.level} (you are ${level}). Train more skills!`;
    const refused = this.repo.transaction(() => {
      const r = this.pay(user, next.cost, `${next.icon} ${next.name}`);
      if (r) return r;
      this.repo.setEquipment(user.id, 'house', tier + 1);
      return null;
    });
    if (refused) return refused;
    this.emitActivity(user, { kind: 'buy', text: `moved into a ${next.icon} ${next.name}! 🏠` });
    this.announce?.(`🏠 @${user.username} moved into a ${next.icon} ${next.name}!`);
    const after = list[tier + 1];
    return `🏠 welcome to your ${next.icon} ${next.name}! Your stamina bar holds ${next.charges} extra charge${next.charges === 1 ? '' : 's'} now (${this.stamina(user.id).max} total).${after ? ` Next: ${after.icon} ${after.name} (+${after.charges}) at character level ${after.level} for ${fmt(after.cost)} pts.` : ''} ${p}house shows it.`;
  },

  // !house [buy]
  houseCommand(user, args = []) {
    const p = this.cfg.prefix;
    if (this.cfg.housesEnabled === false) return 'houses are switched off right now.';
    if (/^(buy|upgrade|move)$/i.test(args[0] || '')) return this.buyHouse(user);
    if (/^(build|construct)$/i.test(args[0] || '')) return this.buildHouse(user);
    const mine = this.house(user.id);
    const list = this.houses();
    const next = list[this.repo.getEquipment(user.id).house || 0];
    const have = mine ? `you live in a ${mine.icon} ${mine.name} (+${mine.charges} stamina)` : "you don't own a house yet";
    const nextText = next
      ? ` Next: ${next.icon} ${next.name} (+${next.charges} stamina) at character level ${next.level} (you are ${this.characterLevel(user.id)}): ${p}house buy for ${fmt(next.cost)} pts${this.houseBlueprint(next.id) ? `, or build it yourself from ${this.partsText(this.houseBlueprint(next.id).parts, this.houseBlueprint(next.id).minTier)} (Construction ${this.houseBlueprint(next.id).construction}): ${p}house build` : ''}.`
      : ' It is the finest house there is! 👑';
    return `🏠 ${have}.${nextText} All houses: ${this.siteUrl}/#/shop`;
  },
};
