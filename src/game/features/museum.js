// GameEngine methods: the museum. Donate digging finds (!donate <item>) to fill collections;
// every donation pays 3x the item's value and a finished collection pays its reward.
/* eslint-disable no-unused-vars */
const { ITEMS, MUSEUM, fmt, findItem, itemLabel } = require('./shared');

module.exports = {
  museumKey(userId) {
    return `museum:${userId}`;
  },

  donated(userId) {
    return this.repo.getSetting(this.museumKey(userId)) || [];
  },

  // [{ ...collection, have: [...], done }]
  museumProgress(userId) {
    const donated = new Set(this.donated(userId));
    return MUSEUM.map((c) => {
      const have = c.items.filter((i) => donated.has(i));
      return { ...c, have, done: have.length === c.items.length };
    });
  },

  // !museum
  museumInfo(user) {
    const parts = this.museumProgress(user.id).map((c) => `${c.icon} ${c.name} ${c.have.length}/${c.items.length}${c.done ? ' ✅' : ''}`);
    return `🏛️ Museum: ${parts.join(' · ')}. ${this.cfg.prefix}donate <item> to add your digging finds.`;
  },

  // !donate <item>
  donate(user, args) {
    const p = this.cfg.prefix;
    const wanted = MUSEUM.flatMap((c) => c.items);
    if (!args.length) {
      const inv = this.repo.getInventory(user.id);
      const donated = new Set(this.donated(user.id));
      const ready = wanted.filter((i) => inv[i] && !donated.has(i));
      return ready.length ? `you can donate: ${ready.map((i) => ITEMS[i].name).join(', ')}. e.g. ${p}donate ${ITEMS[ready[0]].name.toLowerCase()}` : `nothing new to donate. ${p}dig for finds, then ${p}donate them. ${p}museum shows what's missing.`;
    }
    const id = findItem(args.join(' '), wanted);
    if (!id) return `the museum doesn't collect that. It wants digging finds and treasures: ${p}museum`;
    const donated = this.donated(user.id);
    if (donated.includes(id)) return `the museum already has your ${ITEMS[id].name}. Thanks!`;
    if (!this.repo.getInventory(user.id)[id]) return `you don't have a ${ITEMS[id].name}. ${p}dig for one.`;
    const collection = MUSEUM.find((c) => c.items.includes(id));
    const pay = ITEMS[id].value * 3;
    const next = [...donated, id];
    const done = collection.items.every((i) => next.includes(i));
    const total = pay + (done ? collection.reward : 0);
    this.repo.transaction(() => {
      this.repo.removeItem(user.id, id, 1);
      this.repo.setSetting(this.museumKey(user.id), next);
      this.repo.addPoints(user.id, total);
    });
    this.track('rewards', total);
    if (done) {
      this.emitActivity(user, { kind: 'rare', item: id, text: `completed the museum's ${collection.name}! 🏛️` });
      this.unlockAchievement?.(user, `museum_${collection.id}`);
    }
    const have = collection.items.filter((i) => next.includes(i)).length;
    return `🏛️ you donated ${itemLabel(id)} to the ${collection.icon} ${collection.name} (${have}/${collection.items.length}) for ${fmt(pay)} pts!${
      done ? ` 🎉 Collection complete: +${fmt(collection.reward)} pts and the title "${collection.title}" (${p}title).` : ''
    }`;
  },
};
