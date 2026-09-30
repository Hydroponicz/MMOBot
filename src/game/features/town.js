// GameEngine methods: structures built from Construction parts (see ../town.js). Houses built by
// hand (!house build), player shops for the market (!stall), and the town the whole chat builds
// together (!contribute, !town). Mixed into GameEngine.prototype by engine.js.
const { PART_TIERS, PART_KINDS, HOUSE_BLUEPRINTS, SHOPS, TOWN_BUILDINGS, TOWN_GOALS, TOWN_MAX_LEVEL } = require('../town');
const { ITEMS, fmt, itemLabel, skillLevel, findItem } = require('./shared');

const KIND_NAMES = { frame: 'Frame', door: 'Door', wall_panel: 'Wall Panel', roof_truss: 'Roof Truss' };
const tierName = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// "walls" / "wall panel" / "roof" -> the part kind.
const KIND_WORDS = { frame: 'frame', frames: 'frame', door: 'door', doors: 'door', wall: 'wall_panel', walls: 'wall_panel', 'wall panel': 'wall_panel', 'wall panels': 'wall_panel', roof: 'roof_truss', roofs: 'roof_truss', truss: 'roof_truss', trusses: 'roof_truss', 'roof truss': 'roof_truss', 'roof trusses': 'roof_truss', parts: '*', all: '*' };
const PART_IDS = Object.keys(ITEMS).filter((id) => ITEMS[id].buildPart);
// Lowest tier first, so cheap parts go before precious ones.
const byTier = (a, b) => PART_TIERS.indexOf(ITEMS[a].buildTier) - PART_TIERS.indexOf(ITEMS[b].buildTier);

module.exports = {
  // ---- Parts in the backpack ---------------------------------------------------------------------
  // { kind: [[itemId, qty], ...] } for parts of minTier or better, lowest tier first.
  partsHeld(userId, minTier = 'wooden') {
    const inv = this.repo.getInventory(userId);
    const min = PART_TIERS.indexOf(minTier);
    const out = Object.fromEntries(PART_KINDS.map((k) => [k, []]));
    for (const id of PART_IDS.filter((i) => inv[i] > 0).sort(byTier)) {
      if (PART_TIERS.indexOf(ITEMS[id].buildTier) >= min) out[ITEMS[id].buildPart].push([id, inv[id]]);
    }
    return out;
  },

  // What's still missing for a blueprint: { kind: n } (empty when it can be built).
  partsMissing(userId, need, minTier) {
    const held = this.partsHeld(userId, minTier);
    const missing = {};
    for (const [kind, qty] of Object.entries(need)) {
      const have = held[kind].reduce((s, [, q]) => s + q, 0);
      if (have < qty) missing[kind] = qty - have;
    }
    return missing;
  },

  // Uses up a blueprint's parts (call inside a transaction, after partsMissing came back empty).
  // Returns the total value of what was used.
  takeParts(userId, need, minTier) {
    const held = this.partsHeld(userId, minTier);
    let value = 0;
    for (const [kind, qty] of Object.entries(need)) {
      let left = qty;
      for (const [id, have] of held[kind]) {
        const n = Math.min(have, left);
        if (!n) continue;
        this.repo.removeItem(userId, id, n);
        value += ITEMS[id].value * n;
        left -= n;
      }
    }
    return value;
  },

  partsText(need, minTier) {
    const list = Object.entries(need).map(([k, q]) => `${q} ${KIND_NAMES[k]}${q === 1 ? '' : KIND_NAMES[k].endsWith('s') ? 'es' : 's'}`).join(', ');
    return `${list} (${tierName(minTier)} or better)`;
  },

  // Everything a blueprint needs, for the website: per kind, how many and how many you have.
  blueprintView(userId, bp) {
    const held = userId ? this.partsHeld(userId, bp.minTier) : null;
    const level = userId ? skillLevel('construction', this.repo.getSkills(userId).construction) : null;
    return {
      construction: bp.construction,
      minTier: bp.minTier,
      minTierName: tierName(bp.minTier),
      levelOk: level === null ? null : level >= bp.construction,
      parts: Object.entries(bp.parts).map(([kind, qty]) => ({ kind, name: KIND_NAMES[kind], qty, have: held ? Math.min(qty, held[kind].reduce((s, [, q]) => s + q, 0)) : null })),
    };
  },

  // XP for putting a structure together: a fifth of the parts' value.
  structureXp(user, value) {
    return this.grantXp(user, 'construction', Math.max(1, Math.round(value * 0.2)), { points: false });
  },

  // Shared checks for building something from a blueprint. Returns an error text or null.
  blueprintBlocked(user, bp, what) {
    const level = skillLevel('construction', this.repo.getSkills(user.id).construction);
    if (level < bp.construction) return `building a ${what} needs 🏗️ Construction level ${bp.construction} (you are ${level}).`;
    const missing = this.partsMissing(user.id, bp.parts, bp.minTier);
    if (Object.keys(missing).length) {
      return `a ${what} takes ${this.partsText(bp.parts, bp.minTier)}. You're missing ${this.partsText(missing, bp.minTier).replace(/ \(.*\)$/, '')}. Make them with ${this.cfg.prefix}build (e.g. ${this.cfg.prefix}build wall).`;
    }
    return null;
  },

  // ---- Houses: build instead of buy ------------------------------------------------------------
  houseBlueprint(houseId) {
    return HOUSE_BLUEPRINTS[houseId] || null;
  },

  buildHouse(user) {
    const p = this.cfg.prefix;
    if (this.cfg.housesEnabled === false) return 'houses are switched off right now.';
    const list = this.houses();
    const tier = this.repo.getEquipment(user.id).house || 0;
    const next = list[tier];
    if (!next) return `you already live in the finest house there is: ${list[tier - 1].icon} ${list[tier - 1].name}! 👑`;
    const bp = this.houseBlueprint(next.id);
    if (!bp) return `the ${next.icon} ${next.name} can't be built by hand. ${p}house buy`;
    const level = this.characterLevel(user.id);
    if (level < next.level) return `the ${next.icon} ${next.name} needs character level ${next.level} (you are ${level}). Train more skills!`;
    const blocked = this.blueprintBlocked(user, bp, `${next.icon} ${next.name}`);
    if (blocked) return blocked;
    const value = this.repo.transaction(() => {
      const v = this.takeParts(user.id, bp.parts, bp.minTier);
      this.repo.setEquipment(user.id, 'house', tier + 1);
      return v;
    });
    const gained = this.structureXp(user, value);
    this.emitActivity(user, { kind: 'build', text: `built their own ${next.icon} ${next.name} with their bare hands! 🏗️` });
    this.announce?.(`🏗️ @${user.username} built their own ${next.icon} ${next.name}!`);
    return `🏗️ you built your ${next.icon} ${next.name}! Your stamina bar holds ${next.charges} extra charge${next.charges === 1 ? '' : 's'} now (${this.stamina(user.id).max} total).${gained.text ? ` ${gained.text.trim()}` : ''}`;
  },

  // ---- Player shops ------------------------------------------------------------------------------
  stallTier(userId) {
    return (this.repo.getSetting('stalls') || {})[userId] || 0;
  },

  stall(userId) {
    const t = this.stallTier(userId);
    return t ? SHOPS[t - 1] : null;
  },

  // Listing slots on the item market: the base plus your shop's.
  marketSlots(userId, base) {
    return base + (this.stall(userId)?.slots || 0);
  },

  // The market fee on this seller's sales.
  sellerFee(sellerId) {
    const fee = this.cfg.marketFee ?? 0.05;
    return Math.max(0, fee - (this.stall(sellerId)?.feeCut || 0));
  },

  buildStall(user) {
    if (this.cfg.shopsEnabled === false) return 'player shops are switched off right now.';
    const tier = this.stallTier(user.id);
    const next = SHOPS[tier];
    if (!next) return `your ${SHOPS[tier - 1].icon} ${SHOPS[tier - 1].name} is as big as shops get! 👑`;
    const blocked = this.blueprintBlocked(user, next, `${next.icon} ${next.name}`);
    if (blocked) return blocked;
    const value = this.repo.transaction(() => {
      const v = this.takeParts(user.id, next.parts, next.minTier);
      const all = this.repo.getSetting('stalls') || {};
      all[user.id] = tier + 1;
      this.repo.setSetting('stalls', all);
      return v;
    });
    const gained = this.structureXp(user, value);
    this.emitActivity(user, { kind: 'build', text: `opened a ${next.icon} ${next.name}! 🏗️` });
    return `${next.icon} your ${next.name} is open! ${this.marketSlots(user.id, 20)} market listings at once and ${Math.round(this.sellerFee(user.id) * 1000) / 10}% fee on your sales. Your storefront: ${this.siteUrl}/#/town/shop/${encodeURIComponent(user.username)}${gained.text ? ` ${gained.text.trim()}` : ''}`;
  },

  // Every player with a shop and what's on their shelves.
  storefronts() {
    const all = this.repo.getSetting('stalls') || {};
    const listings = this.marketListings();
    return Object.entries(all)
      .map(([id, tier]) => {
        const u = this.repo.getUser(Number(id));
        if (!u || !tier) return null;
        const s = SHOPS[tier - 1];
        const mine = listings.filter((l) => l.sellerId === Number(id));
        return { username: u.username, tier, name: s.name, icon: s.icon, feeCut: s.feeCut, slots: s.slots, listings: mine, count: mine.length };
      })
      .filter(Boolean)
      .sort((a, b) => b.tier - a.tier || b.count - a.count);
  },

  // !stall [build | player]
  stallCommand(user, args = []) {
    const p = this.cfg.prefix;
    if (this.cfg.shopsEnabled === false) return 'player shops are switched off right now.';
    if (/^(build|upgrade|open)$/i.test(args[0] || '')) return this.buildStall(user);
    if (args[0]) {
      const name = args[0].replace(/^@/, '');
      const other = this.repo.getUserByName(name.toLowerCase());
      if (!other) return `no adventurer called ${name}.`;
      const s = this.stall(other.id);
      if (!s) return `${other.username} doesn't have a shop yet.`;
      const n = this.marketListings(other.id).length;
      return `${s.icon} ${other.username}'s ${s.name}: ${n} item${n === 1 ? '' : 's'} for sale. ${this.siteUrl}/#/town/shop/${encodeURIComponent(other.username)}`;
    }
    const mine = this.stall(user.id);
    const next = SHOPS[this.stallTier(user.id)];
    const have = mine ? `your ${mine.icon} ${mine.name}: +${mine.slots} market listings, ${Math.round(mine.feeCut * 100)}% off the fee` : "you don't have a shop yet";
    const nextText = next ? ` Next: ${next.icon} ${next.name} (+${next.slots} listings, ${Math.round(next.feeCut * 100)}% off the fee) at Construction ${next.construction}: ${this.partsText(next.parts, next.minTier)}. ${p}stall build` : '';
    return `${have}.${nextText}`;
  },

  // ---- The town ----------------------------------------------------------------------------------
  townState() {
    if (this._town) return this._town;
    const st = this.repo.getSetting('town') || {};
    st.levels ||= {};
    st.progress ||= {};
    st.donors ||= {}; // building -> { userId: value }
    st.totals ||= {}; // userId -> value, all buildings
    st.names ||= {};
    this._town = st;
    return st;
  },

  saveTown(st) {
    this._town = st;
    this.repo.setSetting('town', st);
  },

  townGoal(level) {
    return Math.round(TOWN_GOALS[level] * (this.cfg.townGoalMultiplier ?? 1));
  },

  townLevel(buildingId) {
    return this.townState().levels[buildingId] || 0;
  },

  // XP multiplier for a skill from the town's buildings.
  townXp(skillId) {
    if (this.cfg.townEnabled === false) return 1;
    const b = TOWN_BUILDINGS.find((x) => x.skills.includes(skillId));
    return b ? 1 + this.townLevel(b.id) * (this.cfg.townXpPerLevel ?? 0.02) : 1;
  },

  // Where parts go when a player doesn't pick: the lowest building, first in the list on ties.
  townFocus() {
    const open = TOWN_BUILDINGS.filter((b) => this.townLevel(b.id) < TOWN_MAX_LEVEL);
    if (!open.length) return null;
    return open.reduce((best, b) => (this.townLevel(b.id) < this.townLevel(best.id) ? b : best), open[0]);
  },

  findBuilding(q) {
    const s = String(q || '').toLowerCase();
    if (!s) return null;
    return TOWN_BUILDINGS.find((b) => b.id === s || b.name.toLowerCase() === s) || TOWN_BUILDINGS.find((b) => b.name.toLowerCase().split(/[\s']+/).includes(s) || b.id.startsWith(s));
  },

  // Gives parts to a town building. Returns { ok, message } / { ok: false, error }.
  townContribute(user, { building = null, item = null, kind = null, qty = 1 } = {}) {
    if (this.cfg.townEnabled === false) return { ok: false, error: 'the town is switched off right now.' };
    const b = building ? this.findBuilding(building) : this.townFocus();
    if (!b) return { ok: false, error: building ? `no town building called "${building}". ${this.cfg.prefix}town lists them.` : 'every town building is finished! 🎉' };
    if (this.townLevel(b.id) >= TOWN_MAX_LEVEL) return { ok: false, error: `the ${b.icon} ${b.name} is finished (level ${TOWN_MAX_LEVEL}). Pick another building.` };
    const inv = this.repo.getInventory(user.id);
    // Which parts: one item, one kind (lowest tier first) or any part.
    let pool;
    if (item) pool = ITEMS[item]?.buildPart && inv[item] ? [item] : [];
    else pool = PART_IDS.filter((i) => inv[i] > 0 && (!kind || kind === '*' || ITEMS[i].buildPart === kind)).sort(byTier);
    if (!pool.length) return { ok: false, error: `you don't have ${item ? `any ${ITEMS[item]?.name || 'of that'}` : kind && kind !== '*' ? `any ${KIND_NAMES[kind]}${KIND_NAMES[kind].endsWith('s') ? 'es' : 's'}` : 'any building parts'}. Make them with ${this.cfg.prefix}build.` };
    const all = qty === 'all';
    let left = all ? Infinity : Math.max(1, Math.floor(Number(qty) || 1));
    const used = [];
    let value = 0;
    const st = this.townState();
    const levelsBefore = st.levels[b.id] || 0;
    this.repo.transaction(() => {
      for (const id of pool) {
        const n = Math.min(inv[id], left);
        if (!n) continue;
        this.repo.removeItem(user.id, id, n);
        used.push([id, n]);
        value += ITEMS[id].value * n;
        left -= n;
        if (!left) break;
      }
      st.progress[b.id] = (st.progress[b.id] || 0) + value;
      st.donors[b.id] ||= {};
      st.donors[b.id][user.id] = (st.donors[b.id][user.id] || 0) + value;
      st.totals[user.id] = (st.totals[user.id] || 0) + value;
      st.names[user.id] = user.username;
      // Level up as many times as the parts cover; extra carries over.
      while ((st.levels[b.id] || 0) < TOWN_MAX_LEVEL && st.progress[b.id] >= this.townGoal(st.levels[b.id] || 0)) {
        st.progress[b.id] -= this.townGoal(st.levels[b.id] || 0);
        st.levels[b.id] = (st.levels[b.id] || 0) + 1;
      }
      if (st.levels[b.id] >= TOWN_MAX_LEVEL) st.progress[b.id] = 0;
      this.saveTown(st);
    });
    this.track?.('town', value);
    const gave = used.map(([id, n]) => itemLabel(id, n)).join(', ');
    const lvl = st.levels[b.id] || 0;
    if (lvl > levelsBefore) {
      const bonus = Math.round(lvl * (this.cfg.townXpPerLevel ?? 0.02) * 100);
      const text = `🏘️ The town's ${b.icon} ${b.name} reached level ${lvl}! Everyone gets +${bonus}% ${b.text} XP. Last parts from ${user.username}.`;
      this.announce?.(text);
      this.emitActivity(user, { kind: 'build', text: `finished level ${lvl} of the town's ${b.icon} ${b.name}! +${bonus}% ${b.text} XP for everyone` });
      this.emit('town', this.townPublic());
      return { ok: true, value, message: `you gave ${gave} to the ${b.icon} ${b.name} and finished level ${lvl}! Everyone now gets +${bonus}% ${b.text} XP. 🎉` };
    }
    this.emit('town', this.townPublic());
    const goal = this.townGoal(lvl);
    return { ok: true, value, message: `you gave ${gave} (${fmt(value)} pts of parts) to the ${b.icon} ${b.name}: ${fmt(st.progress[b.id])} / ${fmt(goal)} toward level ${lvl + 1}.` };
  },

  townPublic() {
    const st = this.townState();
    const per = this.cfg.townXpPerLevel ?? 0.02;
    const focus = this.townFocus();
    const top = Object.entries(st.totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, value]) => ({ username: st.names[id], value }));
    return {
      on: this.cfg.townEnabled !== false,
      maxLevel: TOWN_MAX_LEVEL,
      perLevel: per,
      focus: focus?.id || null,
      top,
      buildings: TOWN_BUILDINGS.map((b) => {
        const level = st.levels[b.id] || 0;
        const donors = Object.entries(st.donors[b.id] || {}).sort((x, y) => y[1] - x[1]);
        return {
          ...b,
          level,
          bonus: level * per,
          progress: level >= TOWN_MAX_LEVEL ? 0 : st.progress[b.id] || 0,
          goal: level >= TOWN_MAX_LEVEL ? 0 : this.townGoal(level),
          donors: donors.length,
          top: donors.slice(0, 3).map(([id, value]) => ({ username: st.names[id], value })),
        };
      }),
    };
  },

  // Titles: the biggest builder of all is the Town Founder; anyone who gave 25k+ of parts is a Builder.
  townTitles(userId) {
    const st = this.townState();
    const mine = st.totals[userId] || 0;
    if (!mine) return [];
    const top = Object.entries(st.totals).sort((a, b) => b[1] - a[1])[0];
    const out = mine >= 25000 ? ['the Builder'] : [];
    if (top && Number(top[0]) === userId && mine >= 25000) out.push('the Town Founder');
    return out;
  },

  // !contribute [building] [qty|all] <part>: "!contribute 5 oak walls", "!contribute forge all frames"
  contributeCommand(user, args = []) {
    const p = this.cfg.prefix;
    const words = args.map((a) => a.toLowerCase());
    let building = null;
    if (words.length && this.findBuilding(words[0]) && !KIND_WORDS[words[0]]) building = words.shift();
    let qty = 1;
    const qi = words.findIndex((w) => /^\d+$/.test(w) || w === 'all');
    if (qi >= 0) {
      const w = words.splice(qi, 1)[0];
      qty = w === 'all' ? 'all' : Number(w);
    }
    if (!words.length && qty === 'all') words.push('parts');
    const q = words.join(' ');
    if (!q) {
      const focus = this.townFocus();
      return `give building parts to the town: ${p}contribute 5 walls (or frames, doors, roofs, a named part like oak wall panel, or "all parts"). They go to the ${focus ? `${focus.icon} ${focus.name}` : 'town'} unless you name a building: ${p}contribute forge 3 roofs. ${p}town shows the buildings.`;
    }
    const kind = KIND_WORDS[q] || null;
    const item = kind ? null : findItem(q, PART_IDS);
    if (!kind && !item) return `"${q}" isn't a building part. Try frames, doors, walls, roofs or e.g. oak wall panel.`;
    const res = this.townContribute(user, { building, item, kind, qty });
    return res.ok ? res.message : res.error;
  },

  // !town
  townCommand(user, args = []) {
    const p = this.cfg.prefix;
    if (this.cfg.townEnabled === false) return 'the town is switched off right now.';
    const t = this.townPublic();
    const list = t.buildings.map((b) => `${b.icon} ${b.name} ${b.level}/${t.maxLevel}`).join(' · ');
    const f = t.buildings.find((b) => b.id === t.focus);
    const focus = f ? ` Building now: ${f.icon} ${f.name} ${fmt(f.progress)} / ${fmt(f.goal)}.` : '';
    return `🏘️ the town: ${list}. Each level = +${Math.round(t.perLevel * 100)}% XP in its skills for everyone.${focus} ${p}contribute 5 walls to help. ${this.siteUrl}/#/town`;
  },

  // Everything the Town page shows.
  townPage(userId = null) {
    const tier = userId ? this.repo.getEquipment(userId).house || 0 : 0;
    const houses = this.houses().map((h, i) => ({
      id: h.id,
      name: h.name,
      icon: h.icon,
      charges: h.charges,
      level: h.level,
      cost: h.cost,
      tier: i + 1,
      owned: tier === i + 1,
      below: i + 1 < tier,
      next: i + 1 === tier + 1,
      blueprint: HOUSE_BLUEPRINTS[h.id] ? this.blueprintView(userId, HOUSE_BLUEPRINTS[h.id]) : null,
    }));
    const stallTier = userId ? this.stallTier(userId) : 0;
    const held = userId ? this.partsHeld(userId) : null;
    return {
      town: this.townPublic(),
      houses,
      housesOn: this.cfg.housesEnabled !== false,
      characterLevel: userId ? this.characterLevel(userId) : null,
      construction: userId ? skillLevel('construction', this.repo.getSkills(userId).construction) : null,
      shopsOn: this.cfg.shopsEnabled !== false,
      shops: SHOPS.map((s, i) => ({ ...s, tier: i + 1, owned: stallTier === i + 1, below: i + 1 < stallTier, next: i + 1 === stallTier + 1, blueprint: this.blueprintView(userId, s) })),
      storefronts: this.storefronts(),
      parts: held
        ? Object.values(held)
            .flat()
            .map(([id, qty]) => ({ id, qty, name: ITEMS[id].name, icon: ITEMS[id].icon, value: ITEMS[id].value, kind: ITEMS[id].buildPart }))
        : null,
    };
  },
};
