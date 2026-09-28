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

  // !open <container>: goblin pouches, stolen goods, ogre belts, labyrinth keys.
  openContainer(user, args = []) {
    const p = this.cfg.prefix;
    const inv = this.repo.getInventory(user.id);
    const owned = Object.keys(CONTAINERS).filter((id) => inv[id] > 0);
    if (!owned.length) return `nothing to open. Monsters drop goblin pouches, stolen goods, ogre belts and labyrinth keys: ${p}open <name>.`;
    const id = args.length ? findItem(args.join(' '), owned) : owned[0];
    if (!id) return `you don't have that. You can open: ${owned.map((i) => ITEMS[i].name).join(', ')}.`;
    const c = CONTAINERS[id];
    const roll = (lo, hi) => lo + Math.floor(this.rng() * (hi - lo + 1));
    const points = roll(...c.points);
    const got = [];
    this.repo.transaction(() => {
      this.repo.removeItem(user.id, id, 1);
      this.repo.addPoints(user.id, points);
      for (const [item, chance, [lo, hi]] of c.loot) {
        if (this.rng() >= chance) continue;
        const qty = roll(lo, hi);
        this.repo.addItem(user.id, item, qty);
        got.push(itemLabel(item, qty));
      }
    });
    this.track('rewards', points);
    this.emitActivity(user, { kind: 'open', item: id, text: `opened ${/^[aeiou]/i.test(ITEMS[id].name) ? 'an' : 'a'} ${ITEMS[id].name}` });
    const left = (this.repo.getInventory(user.id)[id] || 0);
    return `${ITEMS[id].icon} you opened ${/^[aeiou]/i.test(ITEMS[id].name) ? 'an' : 'a'} ${ITEMS[id].name}: +${fmt(points)} pts${got.length ? ` and ${got.join(', ')}` : ''}!${left ? ` (${left} more to open)` : ''}`;
  },
};
