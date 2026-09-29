// GameEngine methods: sell prices that follow supply, and the price checker (!price, website).
// Every sale adds "sell pressure" for that item across the whole channel (its normal value times the
// amount sold). The more pressure, the lower the price, down to a floor; pressure fades by half every
// few hours, so prices recover on their own. One loop (100 plots of carrots, say) can't print points
// forever. Mixed into GameEngine.prototype by engine.js.
const { ITEMS, SKILLS } = require('../skills');
const { fmt, findItem } = require('./shared');

// All crops and the food cooked from them share one pool of sell pressure, so switching crops
// every harvest doesn't dodge the price drop.
const CROP_IDS = new Set(SKILLS.farming.resources.map((r) => r.item));
const PRODUCE = new Set([...CROP_IDS, ...SKILLS.cooking.recipes.filter((r) => Object.keys(r.inputs).some((i) => CROP_IDS.has(i))).map((r) => r.item)]);
const supplyKey = (id) => (PRODUCE.has(id) ? 'produce' : id);

module.exports = {
  // Settings (Settings -> Economy). scale 0 turns supply pricing off.
  supplyScale() {
    return this.cfg.priceSupplyScale ?? 25000;
  },
  supplyHalfLifeMs() {
    return (this.cfg.priceRecoveryHours ?? 6) * 3_600_000;
  },
  supplyFloor() {
    return this.cfg.priceFloor ?? 0.35;
  },

  // Recent sell pressure for an item, faded to now.
  supplyPressure(id, now = this.now()) {
    this.supply ??= this.repo.getSetting('supply') || {};
    const e = this.supply[supplyKey(id)];
    if (!e) return 0;
    const [s, at] = e;
    return s * 0.5 ** (Math.max(0, now - at) / this.supplyHalfLifeMs());
  },

  // Price multiplier from supply right now (1 = normal price).
  supplyFactor(id, now = this.now()) {
    const P = this.supplyScale();
    if (!P) return 1;
    return Math.max(this.supplyFloor(), 1 / (1 + this.supplyPressure(id, now) / P));
  },

  addSupply(id, qty, now = this.now()) {
    if (!this.supplyScale() || !(ITEMS[id]?.value > 0)) return;
    this.supply ??= this.repo.getSetting('supply') || {};
    this.supply[supplyKey(id)] = [this.supplyPressure(id, now) + ITEMS[id].value * qty, now];
    this.supplyDirty = true;
  },

  // Saved every tick (and on shutdown with the economy stats); faded-out entries are dropped.
  flushSupply() {
    if (!this.supplyDirty || !this.supply) return;
    const now = this.now();
    const faded = (key) => this.supply[key][0] * 0.5 ** (Math.max(0, now - this.supply[key][1]) / this.supplyHalfLifeMs()) < 1;
    for (const key of Object.keys(this.supply)) if (faded(key)) delete this.supply[key];
    this.repo.setSetting('supply', this.supply);
    this.supplyDirty = false;
  },

  // What selling qty of an item pays now: the price slides as this sale adds pressure, so selling
  // 1,000 at once pays the average price across the slide, not the starting price.
  saleTotal(id, qty, userId = null) {
    const unit = this.baseSellValue(id, userId);
    const P = this.supplyScale();
    if (!P || !qty) return Math.round(unit * qty);
    const s0 = this.supplyPressure(id);
    const s1 = s0 + ITEMS[id].value * qty;
    const avg = s1 > s0 ? (P * Math.log((P + s1) / (P + s0))) / (s1 - s0) : 1 / (1 + s0 / P);
    return Math.round(unit * qty * Math.max(this.supplyFloor(), avg));
  },

  // Everything that can be sold, with its normal and current price (price checker).
  // With a userId, prices include that player's own sell rate (race perks).
  priceList(userId = null) {
    const now = this.now();
    return Object.entries(ITEMS)
      .filter(([, it]) => it.value > 0 && !it.notItem && !it.bound && !it.pet && !it.cosmetic && !it.legacy)
      .map(([id, it]) => {
        const base = this.baseSellValue(id, userId);
        const f = this.supplyFactor(id, now);
        const pressure = this.supplyPressure(id, now);
        return { id, name: it.name, icon: it.icon, base, now: Math.max(it.value > 0 ? 1 : 0, Math.round(base * f)), change: Math.round((f - 1) * 100), recent: Math.round(pressure / it.value), group: PRODUCE.has(id) ? 'crops' : null };
      });
  },

  // !price <item>
  priceCheck(user, args = []) {
    const p = this.cfg.prefix;
    const q = args.join(' ').trim();
    if (!q) {
      const low = this.priceList()
        .filter((x) => x.change < 0)
        .sort((a, b) => a.change - b.change)
        .slice(0, 4)
        .map((x) => `${x.icon} ${x.name} ${x.change}%`);
      return `💹 ${p}price <item> checks what it sells for right now.${low.length ? ` Cheapest right now (lots sold lately): ${low.join(' · ')}.` : ' Everything sells at full price right now.'} All prices: ${this.siteUrl}/#/market`;
    }
    const list = this.priceList(user?.id);
    const inv = user ? this.repo.getInventory(user.id) : {};
    const id = findItem(q, list.map((x) => x.id));
    if (!id) {
      const known = findItem(q, Object.keys(ITEMS));
      return known ? `${ITEMS[known].icon} ${ITEMS[known].name} can't be sold.` : `no item called "${q}".`;
    }
    const x = list.find((e) => e.id === id);
    const mine = this.sellValue(id, user?.id);
    const have = inv[id] ? ` You have ${fmt(inv[id])} (${fmt(this.saleTotal(id, inv[id], user.id))} pts if you sell them all).` : '';
    const trend =
      x.change < 0
        ? ` (normally ${fmt(x.base)}, ${x.change}% after ${x.group ? 'lots of crops and crop dishes' : `~${fmt(x.recent)}`} sold lately; it recovers over the next few hours)`
        : ' (full price)';
    return `💹 ${x.icon} ${x.name} sells for ${fmt(mine)} pts each right now${trend}.${have}`;
  },
};
