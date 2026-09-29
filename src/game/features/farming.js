// GameEngine methods: farming. Mixed into GameEngine.prototype by engine.js.
/* eslint-disable no-unused-vars */
const {
  ITEMS,
  SPELLS,
  MUSEUM,
  SKILLS,
  SKILL_IDS,
  BACKPACK_TIERS,
  SHOP,
  MAX_PLOTS,
  STARTER_PLOTS,
  GEAR_SLOTS,
  COMMAND_TO_SKILL,
  COMBAT_SKILLS,
  WEAPON_SKILL,
  TOOL_TO_SKILL,
  TOOL_ALIASES,
  maxLevel,
  maxHpFor,
  maxManaFor,
  BUFFS,
  findItem,
  weaponWords,
  levelForXp,
  progress,
  characterProgress,
  casino,
  emotes,
  fmt,
  payoutOf,
  pct,
  skillLevel,
  itemLabel,
  INFO_COMMANDS,
  SLOT_ALIASES,
  SLOT_ICONS,
  clamp,
  RATINGS,
  CROPS,
  minutesLeft,
  GATHER_HINT,
  unlockName,
} = require('./shared');

module.exports = {
  // ---- Farming (!plant, !harvest, !farm) ----------------------------------------

  plotCount(userId) {
    // Everyone has STARTER_PLOTS free plots plus the ones they bought (stored as "plots"), so players
    // who bought plots before the free plot existed get it too.
    return Math.min(STARTER_PLOTS + (this.repo.getEquipment(userId).plots || 0), MAX_PLOTS);
  },

  // Every owned plot with what's in it: { plot, crop, readyAt, plantedAt, ready } (crop null = empty).
  farmPlots(userId) {
    const now = this.now();
    const byPlot = Object.fromEntries(this.repo.getPlots(userId).map((p) => [p.plot, p]));
    return Array.from({ length: this.plotCount(userId) }, (_, i) => {
      const p = byPlot[i + 1];
      return p
        ? { plot: i + 1, crop: p.crop, plantedAt: p.planted_at, readyAt: p.ready_at, ready: p.ready_at <= now }
        : { plot: i + 1, crop: null, ready: false };
    });
  },

  // Plot prices grow exponentially: each plot you buy costs plotPriceGrowth times the one before
  // (the first bought plot costs the shop price). `ahead` = how many more you'd buy before this one.
  plotPrice(userId, ahead = 0) {
    const base = this.shopItems().find((x) => x.item === 'farm_plot')?.cost ?? 750;
    const growth = this.cfg.plotPriceGrowth ?? 1.12;
    const bought = Math.max(0, this.plotCount(userId) - STARTER_PLOTS) + ahead;
    const price = base * growth ** bought;
    return Math.min(1e15, price < 10000 ? Math.round(price / 10) * 10 : Math.round(price / 100) * 100);
  },

  // Total for the next `qty` plots.
  plotsPrice(userId, qty) {
    let total = 0;
    for (let i = 0; i < qty; i++) total += this.plotPrice(userId, i);
    return total;
  },

  noPlotsMessage(userId) {
    return `you don't have a farm plot yet! 🟫 !buy plot (${fmt(this.plotPrice(userId))} pts) or ${this.siteUrl}/#/shop`;
  },

  // !plant [crop] [amount]: one seed per empty plot.
  plant(user, args) {
    if (!this.plotCount(user.id)) return this.noPlotsMessage(user.id);

    const plots = this.farmPlots(user.id);
    const empty = plots.filter((p) => !p.crop);
    if (!empty.length) {
      const next = plots.filter((p) => !p.ready).sort((a, b) => a.readyAt - b.readyAt)[0];
      const readyCount = plots.filter((p) => p.ready).length;
      return readyCount
        ? `all your plots are full — ${readyCount} ready to !harvest!`
        : `${plots.length === 1 ? 'your plot is' : `all ${plots.length} plots are`} growing. Next ready in ${minutesLeft(next.readyAt - this.now())}.`;
    }

    const words = args.map((w) => String(w).toLowerCase());
    let limit = empty.length;
    if (words.length && /^\d+$/.test(words[words.length - 1])) limit = Math.max(1, Number(words.pop()));
    else if (words[words.length - 1] === 'all') words.pop();
    if (words[words.length - 1] === 'seeds' || words[words.length - 1] === 'seed') words.pop();

    const level = skillLevel('farming', this.repo.getSkills(user.id).farming);
    const inv = this.repo.getInventory(user.id);
    let crop;
    if (words.length) {
      const id = findItem(words.join(' '), CROPS.map((c) => c.item));
      if (!id) return `unknown crop. You can grow: ${CROPS.filter((c) => c.level <= level).map((c) => ITEMS[c.item].name).slice(-6).join(', ')}`;
      crop = CROPS.find((c) => c.item === id);
      if (crop.level > level) return `you need 🌱 Farming level ${crop.level} to grow ${ITEMS[crop.item].name} (you are ${level}).`;
      if (!inv[crop.seed]) {
        return `you have no ${ITEMS[crop.seed].name}! !buy ${ITEMS[crop.item].name.toLowerCase()} seeds ${empty.length} (${fmt(this.seedPrice(crop))} pts each)`;
      }
    } else {
      // No crop named: plant the best seeds you have and can grow.
      crop = [...CROPS].reverse().find((c) => c.level <= level && inv[c.seed]);
      if (!crop) {
        const best = [...CROPS].reverse().find((c) => c.level <= level);
        return `you have no seeds! !buy ${ITEMS[best.item].name.toLowerCase()} seeds ${empty.length} (${fmt(this.seedPrice(best))} pts each), then !plant`;
      }
    }

    const now = this.now();
    // Stamina is checked only when there's something to plant, so "what's growing?" is free.
    const tired = this.staminaCheck(user, now);
    if (tired !== null) return tired || null;
    const n = Math.min(empty.length, inv[crop.seed], limit);
    const growMs = Math.round(crop.grow * 60_000 * (this.cfg.growMultiplier ?? 1));
    const result = this.repo.transaction(() => {
      this.repo.removeItem(user.id, crop.seed, n);
      for (const p of empty.slice(0, n)) this.repo.plant(user.id, p.plot, crop.item, now, now + growMs);
      this.repo.setFarmAt(user.id, now);
      this.spendStamina(user, now);
      return this.grantXp(user, 'farming', this.xpFor(Math.max(1, Math.round(crop.xp * 0.2)) * n));
    });
    const c = ITEMS[crop.item];
    this.emitActivity(user, { kind: 'action', skill: 'farming', item: crop.item, text: `planted ${n}x ${c.name}` });
    const left = empty.length - n;
    return `🌱 planted ${c.icon} ${c.name} in ${n} plot${n === 1 ? '' : 's'} — ready in ${minutesLeft(growMs)}. ${result.text}${left ? ` (${left} plot${left === 1 ? '' : 's'} still empty)` : ''}`;
  },

  seedPrice(crop) {
    return this.shopItems().find((x) => x.item === crop.seed)?.cost ?? crop.seedCost;
  },

  // !harvest: collect every ready plot (as much as fits in the backpack).
  harvest(user) {
    if (!this.plotCount(user.id)) return this.noPlotsMessage(user.id);

    const plots = this.farmPlots(user.id);
    const ready = plots.filter((p) => p.ready);
    if (!ready.length) {
      const growing = plots.filter((p) => p.crop).sort((a, b) => a.readyAt - b.readyAt);
      if (!growing.length) return `your plots are empty! !plant some seeds first (!buy carrot seeds ${plots.length}).`;
      const c = ITEMS[growing[0].crop];
      return `nothing is ready yet. Next: ${c.icon} ${c.name} in ${minutesLeft(growing[0].readyAt - this.now())}.`;
    }

    const tired = this.staminaCheck(user);
    if (tired !== null) return tired || null;

    const bag = this.backpack(user.id);
    let room = bag.capacity - bag.used;
    const gathered = {};
    let harvestedPlots = 0;
    let xp = 0;
    this.repo.transaction(() => {
      for (const p of ready) {
        const crop = CROPS.find((c) => c.item === p.crop);
        const [lo, hi] = crop.yield;
        const qty = lo + Math.floor(this.rng() * (hi - lo + 1));
        if (qty > room) break;
        room -= qty;
        this.repo.addItem(user.id, p.crop, qty);
        this.repo.clearPlot(user.id, p.plot);
        gathered[p.crop] = (gathered[p.crop] || 0) + qty;
        xp += crop.xp;
        harvestedPlots++;
      }
      if (harvestedPlots) {
        this.repo.setFarmAt(user.id, this.now());
        this.spendStamina(user);
      }
    });
    if (!harvestedPlots) {
      const free = bag.capacity - bag.used;
      return `🎒 no backpack space to harvest (${bag.used}/${bag.capacity}) — each plot's crop needs a free slot. !sell or !upgrade backpack first.`;
    }

    const list = Object.entries(gathered).map(([id, q]) => itemLabel(id, q)).join(', ');
    this.emitActivity(user, { kind: 'action', skill: 'farming', xp, text: `harvested ${Object.entries(gathered).map(([id, q]) => `${q}x ${ITEMS[id].name}`).join(', ')}` });
    const gained = this.grantXp(user, 'farming', this.xpFor(xp));
    const leftover = ready.length - harvestedPlots;
    const note = leftover ? ` 🎒 Backpack full — ${leftover} plot${leftover === 1 ? '' : 's'} still waiting!` : ' !plant again!';
    return `🌾 harvested ${harvestedPlots} plot${harvestedPlots === 1 ? '' : 's'}: ${list}! ${gained.text}${note}`;
  },

  // !farm: plot overview.
  farmInfo(user) {
    const plots = this.farmPlots(user.id);
    if (!plots.length) return this.noPlotsMessage(user.id);
    const ready = plots.filter((p) => p.ready).length;
    const growing = plots.filter((p) => p.crop && !p.ready).sort((a, b) => a.readyAt - b.readyAt);
    const empty = plots.filter((p) => !p.crop).length;
    const parts = [`🌱 Farm: ${plots.length}/${MAX_PLOTS} plots`];
    if (ready) parts.push(`✅ ${ready} ready (!harvest)`);
    if (growing.length) parts.push(`⏳ ${growing.length} growing (next ${ITEMS[growing[0].crop].icon} in ${minutesLeft(growing[0].readyAt - this.now())})`);
    if (empty) parts.push(`🟫 ${empty} empty (!plant)`);
    return parts.join(' · ');
  },
};
