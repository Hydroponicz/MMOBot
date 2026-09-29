// GameEngine methods: what crops do in other skills (see ../plantables.js). Booster crops for
// gathering, resin and flux, dye flowers for outfit colors, Coffee and its Trail Brew, and the
// one-time buyback of the old crops. Mixed into GameEngine.prototype by engine.js.
const { ITEMS, PLANT_LINES, LEGACY_ITEMS, lineItems } = require('../skills');
const { fmt, itemLabel, minutesLeft } = require('./shared');

const BOOSTER_LINE = Object.fromEntries(PLANT_LINES.filter((l) => l.use === 'booster').map((l) => [l.skill, l.id]));
const DYE_LINE = PLANT_LINES.find((l) => l.use === 'dye');
// Outfit color -> the dye flower that unlocks it.
const DYES = Object.fromEntries(DYE_LINE.colors.map(([color], i) => [color, DYE_LINE.tiers[i][0]]));
const DYE_COST = 3;

module.exports = {
  // The best tier of a crop line the player has (null = none). { item, tier }
  bestCrop(userId, lineId) {
    const inv = this.repo.getInventory(userId);
    const best = [...lineItems(lineId)].reverse().find((p) => inv[p.id] > 0);
    return best ? { item: best.id, tier: best.tier } : null;
  },

  // Uses up one of the best tier of a crop line the player has. Returns { item, tier } or null.
  useCrop(userId, lineId) {
    const c = this.bestCrop(userId, lineId);
    if (c) this.repo.removeItem(userId, c.item, 1);
    return c;
  },

  // Gathering boosters: Glowmoss (fishing), Stoneroot (mining), Truffles (digging), Tanbark (skinning).
  useBooster(user, skillId) {
    const line = BOOSTER_LINE[skillId];
    return line ? this.useCrop(user.id, line) : null;
  },

  // ---- Dye flowers: premium outfit colors ----------------------------------------------------
  dyeFor(color) {
    return DYES[color] || null;
  },

  dyesUnlocked(userId) {
    return this.repo.getSetting(`dyes:${userId}`) || [];
  },

  // Called when a player picks an outfit color. Premium colors need their dye flower: DYE_COST of them
  // the first time, after that the color is theirs. Returns an error text or null.
  unlockDye(userId, color) {
    const flower = this.dyeFor(color);
    if (!flower) return null;
    const have = this.dyesUnlocked(userId);
    if (have.includes(color)) return null;
    const inv = this.repo.getInventory(userId);
    if ((inv[flower] || 0) < DYE_COST) {
      return `the ${color} outfit color needs ${DYE_COST} ${ITEMS[flower].name} (a dye flower from Farming) the first time. You have ${inv[flower] || 0}.`;
    }
    this.repo.removeItem(userId, flower, DYE_COST);
    this.repo.setSetting(`dyes:${userId}`, [...have, color]);
    return null;
  },

  // ---- Coffee and Trail Brew ------------------------------------------------------------------
  // Gifting subs is the only way to get Coffee seeds.
  giveCoffeeSeeds(user, count) {
    const per = this.cfg.coffeeSeedsPerGiftedSub ?? 1;
    const n = Math.max(0, Math.floor(per * count));
    if (!user || !n) return 0;
    this.repo.addItem(user.id, 'coffee_beans_seeds', n);
    this.notify(user.id, `☕ Thanks for gifting! You got ${n} Coffee Seeds: !plant coffee, then !brew trail brew (restores a stamina charge).`);
    return n;
  },

  // Drinking a Trail Brew: +1 stamina charge, at most once per trailBrewCooldownMinutes (60).
  drinkTrailBrew(user, id, now = this.now()) {
    const key = `trailbrew:${user.id}`;
    const wait = (this.cfg.trailBrewCooldownMinutes ?? 60) * 60_000;
    const last = this.repo.getSetting(key) || 0;
    if (last && now - last < wait) return `☕ you can only have one Trail Brew an hour. Next one in ${minutesLeft(last + wait - now)}.`;
    const s = this.stamina(user.id, now);
    if (s.charges >= s.max) return `☕ your stamina is already full (${s.charges}/${s.max}). Save the Trail Brew for when you're tired!`;
    this.repo.transaction(() => {
      this.repo.removeItem(user.id, id, 1);
      this.repo.setStamina(user.id, Math.min(s.max, s.charges + 1), s.startedAt ?? now);
      this.repo.setSetting(key, now);
    });
    const after = this.stamina(user.id, now);
    return `☕ you drank a Trail Brew and got your second wind! Stamina ${after.charges}/${after.max}.`;
  },

  // ---- Old crops ------------------------------------------------------------------------------
  // The crops from before the rework are bought back once, at their value: crops, seeds and the
  // dishes cooked from them. (Old crops still growing turn into points when harvested; see harvest.)
  migrateLegacyCrops() {
    if (this.repo.getSetting('migrated:legacy_crops')) return 0;
    const held = this.repo.itemsHeld([...LEGACY_ITEMS]);
    const byUser = new Map();
    for (const { user_id: uid, item, qty } of held) {
      const e = byUser.get(uid) || { points: 0, items: 0 };
      e.points += (ITEMS[item]?.value || 0) * qty;
      e.items += qty;
      byUser.set(uid, e);
    }
    this.repo.transaction(() => {
      for (const { user_id: uid, item, qty } of held) this.repo.removeItem(uid, item, qty);
      for (const [uid, e] of byUser) {
        if (e.points) this.repo.addPoints(uid, e.points);
        this.track('sold', e.points);
        this.notify(uid, `🌱 Farming was reworked: every crop now feeds another skill. Your ${fmt(e.items)} old crops, seeds and dishes were bought back for ${fmt(e.points)} pts. See the new crops in the shop!`);
      }
      this.repo.setSetting('migrated:legacy_crops', { at: this.now(), players: byUser.size });
    });
    return byUser.size;
  },

  // A legacy crop harvested from an old plot: paid straight out in points.
  legacyHarvestValue(item, qty) {
    return LEGACY_ITEMS.has(item) ? (ITEMS[item]?.value || 0) * qty : 0;
  },

  // "Used for" text for an item (item info, shop, price checker).
  plantUse(itemId) {
    return ITEMS[itemId]?.plantUse || null;
  },

  labelCrop(itemId, qty) {
    return itemLabel(itemId, qty);
  },
};
