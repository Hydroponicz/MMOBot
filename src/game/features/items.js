// GameEngine methods: what every item is for (!item) and opening monster loot (!open).
// Mixed into GameEngine.prototype by engine.js.
const { ITEMS, SKILLS, SKILL_IDS, MUSEUM, BUFFS } = require('../skills');
const { CONTAINERS } = require('../content');
const { fmt, itemLabel, findItem } = require('./shared');

const plural = (name) => `${name.replace(/f$/, 've')}s`;

// Built once: where each item comes from and what it's used in.
let INDEX = null;
function itemIndex() {
  if (INDEX) return INDEX;
  INDEX = {};
  const at = (id) => (INDEX[id] ??= { from: [], uses: [] });
  for (const id of SKILL_IDS) {
    const s = SKILLS[id];
    for (const r of s.resources || []) {
      if (!r.item) continue; // Agility courses give no items
      at(r.item).from.push(`${s.icon} ${s.name} ${r.level}`);
      if (r.meat) at(r.meat).from.push(`${s.icon} ${s.name} ${r.level}`);
    }
    for (const r of s.recipes || []) {
      at(r.item).from.push(`${s.icon} ${s.name} ${r.level}${r.race ? ' (race)' : ''}`);
      for (const i of Object.keys(r.inputs || {})) at(i).uses.push({ text: `${ITEMS[r.item].name} (${s.icon} ${s.name} ${r.level})`, skill: id });
    }
  }
  for (const m of SKILLS.swords.monsters) {
    for (const i of m.loot) at(i).from.push(`${m.icon} ${plural(m.name)} (level ${m.level})`);
    if (m.rare) at(m.rare.item).from.push(`${m.icon} ${plural(m.name)}, rarely (level ${m.level})`);
  }
  for (const c of MUSEUM) for (const i of c.items) at(i).uses.push({ text: `the museum's ${c.name} (!donate)` });
  for (const [id, c] of Object.entries(CONTAINERS)) {
    at(id).uses.push({ text: '!open it for points and loot' });
    for (const [i] of c.loot) at(i).from.push(`opening ${ITEMS[id].name}`);
  }
  for (const [id, it] of Object.entries(ITEMS)) {
    if (it.food) at(id).uses.push({ text: `!eat: heals up to ${it.food.heal} HP${it.food.buff ? ` + ${BUFFS[it.food.buff].name}` : ''}` });
    if (it.potion?.buff) at(id).uses.push({ text: `!drink: ${BUFFS[it.potion.buff].name} for ${it.potion.minutes || BUFFS[it.potion.buff].minutes} min (${BUFFS[it.potion.buff].text})` });
    if (it.cosmetic) at(id).uses.push({ text: `wear it on the Customize page (${it.cosmetic.slot})` });
    if (it.gear) at(id).uses.push({ text: '!equip it' });
    // Crops: what the crop line is for (boosters, resin, flux and dyes have no recipe to point at).
    if (it.plantUse) at(id).uses.unshift({ text: it.plantUse });
    if (it.potion?.stamina) at(id).uses.push({ text: '!drink: +1 stamina charge (once an hour)' });
    if (it.legacy) at(id).uses.push({ text: 'an old crop from before the Farming rework: sell it' });
  }
  return INDEX;
}

module.exports = {
  // { from: [...], uses: [...] } for an item.
  itemUses(id) {
    const e = itemIndex()[id] || { from: [], uses: [] };
    return { from: [...new Set(e.from)], uses: [...new Set(e.uses.map((u) => u.text))] };
  },

  // !item <name>
  itemInfo(user, args = []) {
    const q = args.join(' ');
    if (!q) return `usage: ${this.cfg.prefix}item <name>, e.g. ${this.cfg.prefix}item cheese — shows where it comes from and what it's for.`;
    const inv = this.repo.getInventory(user.id);
    const id = findItem(q, Object.keys(inv).filter((i) => ITEMS[i])) || findItem(q, Object.keys(ITEMS));
    if (!id) return `no item called "${q}".`;
    const it = ITEMS[id];
    const { from, uses } = this.itemUses(id);
    const shop = this.shopItems().find((x) => x.item === id);
    const parts = [`${it.icon} ${it.name}`];
    if (from.length) parts.push(`from ${from.slice(0, 3).join(', ')}${from.length > 3 ? '…' : ''}`);
    if (shop) parts.push(`shop ${fmt(shop.cost)} pts`);
    parts.push(uses.length ? `used for: ${uses.slice(0, 4).join('; ')}${uses.length > 4 ? '…' : ''}` : 'no other use yet');
    parts.push(it.bound || it.pet ? "can't be sold" : `sells for ${fmt(this.sellValue(id, user.id))} pts`);
    return parts.join(' · ');
  },

  // Opens one container (already checked to be in the backpack). Returns { points, got: {item: qty} }.
  openOne(user, id) {
    const c = CONTAINERS[id];
    const roll = (lo, hi) => lo + Math.floor(this.rng() * (hi - lo + 1));
    const points = roll(...c.points);
    const got = {};
    this.repo.transaction(() => {
      this.repo.removeItem(user.id, id, 1);
      this.repo.addPoints(user.id, points);
      for (const [item, chance, [lo, hi]] of c.loot) {
        if (this.rng() >= chance) continue;
        const qty = roll(lo, hi);
        this.repo.addItem(user.id, item, qty);
        got[item] = (got[item] || 0) + qty;
      }
    });
    this.track('rewards', points);
    this.emitActivity(user, { kind: 'open', item: id, text: `opened ${/^[aeiou]/i.test(ITEMS[id].name) ? 'an' : 'a'} ${ITEMS[id].name}` });
    return { points, got };
  },

  // !open <container>: goblin pouches, stolen goods, ogre belts, labyrinth keys.
  // !open all (everything, including pouches that fall out of stolen goods) or !open all stolen goods.
  openContainer(user, args = []) {
    const p = this.cfg.prefix;
    const owned = () => {
      const inv = this.repo.getInventory(user.id);
      return Object.keys(CONTAINERS).filter((id) => inv[id] > 0);
    };
    const have = owned();
    if (!have.length) return `nothing to open. Monsters drop goblin pouches, stolen goods, ogre belts and labyrinth keys: ${p}open <name>, or ${p}open all.`;
    const words = args.map((w) => String(w).toLowerCase());
    const all = words.includes('all');
    const name = words.filter((w) => w !== 'all').join(' ');
    const only = name ? findItem(name, have) : null;
    if (name && !only) return `you don't have that. You can open: ${have.map((i) => ITEMS[i].name).join(', ')}.`;

    if (!all) {
      const id = only || have[0];
      const { points, got } = this.openOne(user, id);
      const items = Object.entries(got).map(([i, q]) => itemLabel(i, q));
      const left = this.repo.getInventory(user.id)[id] || 0;
      return `${ITEMS[id].icon} you opened ${/^[aeiou]/i.test(ITEMS[id].name) ? 'an' : 'a'} ${ITEMS[id].name}: +${fmt(points)} pts${items.length ? ` and ${items.join(', ')}` : ''}!${left ? ` (${left} more to open: ${p}open all)` : ''}`;
    }

    // Open them all, one at a time (each is its own roll), up to 500 in one go.
    const opened = {};
    const got = {};
    let points = 0;
    let n = 0;
    this.quietActivity = true;
    try {
      while (n < 500) {
        const next = owned().find((id) => !only || id === only);
        if (!next) break;
        const r = this.openOne(user, next);
        opened[next] = (opened[next] || 0) + 1;
        points += r.points;
        for (const [i, q] of Object.entries(r.got)) got[i] = (got[i] || 0) + q;
        n++;
      }
    } finally {
      this.quietActivity = false;
    }
    const what = Object.entries(opened).map(([i, q]) => itemLabel(i, q)).join(', ');
    this.emitActivity(user, { kind: 'opened', text: `opened ${n} containers (${Object.entries(opened).map(([i, q]) => `${q}x ${ITEMS[i].name}`).join(', ')}) for ${fmt(points)} pts 📦` });
    // Containers that fell out and were opened too aren't loot you kept.
    for (const [i, q] of Object.entries(opened)) if (got[i]) got[i] -= Math.min(got[i], q);
    const items = Object.entries(got).filter(([, q]) => q > 0).sort((a, b) => ITEMS[b[0]].value * b[1] - ITEMS[a[0]].value * a[1]).map(([i, q]) => itemLabel(i, q));
    const shown = items.slice(0, 8).join(', ') + (items.length > 8 ? ` and ${items.length - 8} more` : '');
    const left = owned().filter((id) => !only || id === only).length;
    return `📦 you opened ${what}: +${fmt(points)} pts${items.length ? ` and ${shown}` : ''}!${left ? ` (more left: ${p}open all again)` : ''}${this.fullBagNote(user.id)}`;
  },
};
