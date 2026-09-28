// GameEngine methods: shop. Mixed into GameEngine.prototype by engine.js.
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
  // ---- Shop (!buy, website) -------------------------------------------------

  shopItems() {
    const live = this.settings.all.shop;
    const byItem = new Map((live || []).map((row) => [row.item, row]));
    return SHOP.map((x) => ({ ...x, ...(byItem.get(x.item) || {}), ...ITEMS[x.item], item: x.item }));
  },

  shopList() {
    const main = this.shopItems().filter((x) => !x.category || x.category === 'farming');
    const list = main.map((x) => `${x.icon} ${x.name} ${fmt(x.cost)}`).join(', ');
    const potion = this.shopItems().find((x) => x.category === 'potions');
    const potions = potion ? `, potions from ${fmt(potion.cost)} (!buy ${potion.name.toLowerCase()})` : '';
    const arrows = this.shopItems().find((x) => x.category === 'arrows');
    const arrowText = arrows ? `, arrows from ${fmt(arrows.cost)} each (!buy arrows 50)` : '';
    return `🛒 Shop: ${list} pts${potions}${arrowText}, plus seeds (e.g. !buy carrot seeds 5) — ${this.siteUrl}/#/shop`;
  },

  // Shared by "!buy" and the website shop. Returns the reply text.
  // "!buy hammer", "!buy carrot seeds 10", "!buy plot 3".
  buy(user, args) {
    const words = args.map((w) => String(w).toLowerCase()).filter(Boolean);
    let qty = null;
    if (words.length > 1 && /^\d+$/.test(words[words.length - 1])) qty = Math.min(1000, Math.max(1, Number(words.pop())));
    const q = words.join(' ').trim();
    const items = this.shopItems();
    const name = (x) => x.name.toLowerCase();
    const found =
      q &&
      (items.find((x) => x.item === q.replace(/\s+/g, '_') || name(x) === q) ||
        items.find((x) => name(x) === `${q} seeds`) ||
        items.find((x) => name(x).startsWith(q)) ||
        items.find((x) => name(x).includes(q)) ||
        // "runes" -> Magic Rune
        (q.endsWith('s') && items.find((x) => name(x).split(' ').pop() === q.slice(0, -1))));
    if (!found) return `usage: !buy <item> [amount]. ${this.shopList()}`;
    // Arrows come 10 at a time unless you say how many.
    qty ??= found.ammo ? 10 : 1;
    if (found.item === 'farm_plot') return this.buyPlots(user, qty, found);

    const inv = this.repo.getInventory(user.id);
    const isTool = found.keep && !found.gear && !found.seedFor && !found.potion && !found.ammo;
    if (isTool) {
      if (inv[found.item]) return `you already have a ${found.icon} ${found.name}.`;
      qty = 1;
    }
    if (found.ammo === 'bow') {
      // Arrows go in the quiver, not the backpack.
      const q = this.quiver(user.id);
      if (!q.capacity) return `you need a 🧺 Quiver to carry arrows! !buy quiver (${fmt(this.shopItems().find((x) => x.item === 'quiver')?.cost ?? 250)} pts) or !fletch quiver.`;
      if (q.arrows + qty > q.capacity) return `🧺 your quiver only has room for ${fmt(q.capacity - q.arrows)} more arrows (${fmt(q.arrows)}/${fmt(q.capacity)}).`;
    } else if (found.seedFor) {
      const crop = CROPS.find((c) => c.item === found.seedFor);
      const lvl = skillLevel('farming', this.repo.getSkills(user.id).farming);
      if (lvl < crop.level) return `you need 🌱 Farming level ${crop.level} to grow ${ITEMS[crop.item].name} (you are ${lvl}).`;
    } else if (!found.ammo) {
      // (Runes, like arrows, don't take backpack slots.)
      const bag = this.backpack(user.id);
      if (bag.used + qty > bag.capacity) return `🎒 no room in your backpack (${bag.used}/${bag.capacity}). !sell something first.`;
    }
    const total = found.cost * qty;
    return this.repo.transaction(() => {
      const refused = this.pay(user, total, qty > 1 ? `${qty}x ${found.name}` : found.name);
      if (refused) return refused;
      this.repo.addItem(user.id, found.item, qty);
      // A new flint starts with all its uses.
      if (found.item === 'flint_and_steel') this.repo.setEquipment(user.id, 'flint_used', 0);
      this.emitActivity(user, { kind: 'buy', item: found.item, text: `bought ${qty > 1 ? `${qty}x ${found.name}` : `a ${found.name}`}` });
      const tip =
        found.item === 'smithing_hammer'
          ? ' Now try !smith bronze sword.'
          : found.weaponType === 'bow'
            ? ` Now get a quiver and arrows, then !shoot.`
            : found.weaponType
            ? ' Now try !fight.'
            : found.item === 'quiver'
              ? ' Now !fletch arrows or !buy arrows.'
            : found.ammo === 'bow'
              ? ` 🧺 Quiver: ${fmt(this.quiver(user.id).arrows)}/${fmt(this.quiver(user.id).capacity)}. !shoot away!`
            : found.ammo === 'staff'
              ? ' Now !cast with a staff.'
            : found.item === 'flint_and_steel'
              ? ` Good for ${ITEMS.flint_and_steel.uses} fires: !lightfire.`
            : found.item === 'skinning_knife'
              ? ' Now try !skin.'
              : found.seedFor
                ? ` Now !plant ${ITEMS[found.seedFor].name.toLowerCase()}.`
                : found.potion
                  ? ' !drink it when you need it.'
                  : '';
      return `🛒 bought ${itemLabel(found.item, qty)} for ${fmt(total)} pts!${tip} Balance: ${fmt(this.repo.getUser(user.id).points)}`;
    });
  },

  buyPlots(user, qty, found) {
    const have = this.plotCount(user.id);
    if (have >= MAX_PLOTS) return `you already have the maximum of ${MAX_PLOTS} farm plots! 🏆`;
    qty = Math.min(qty, MAX_PLOTS - have);
    const total = found.cost * qty;
    return this.repo.transaction(() => {
      const refused = this.pay(user, total, qty > 1 ? `${qty} farm plots` : 'farm plot');
      if (refused) return refused;
      this.repo.setEquipment(user.id, 'plots', have + qty - STARTER_PLOTS);
      this.emitActivity(user, { kind: 'buy', text: `bought ${qty > 1 ? `${qty} farm plots` : 'a farm plot'} (${have + qty} total)` });
      const first = ` Buy seeds (!buy carrot seeds ${have + qty}) and !plant them!`;
      return `🟫 bought ${qty > 1 ? `${qty} farm plots` : 'a farm plot'} for ${fmt(total)} pts! You now have ${have + qty}/${MAX_PLOTS}.${first}`;
    });
  },

  // ---- Backpack ----------------------------------------------------------

  backpackTiers() {
    const live = this.settings.all.backpack;
    return BACKPACK_TIERS.map((t, i) => ({ ...t, ...(live?.[i] || {}) }));
  },

  backpack(userId) {
    const tiers = this.backpackTiers();
    const tier = Math.min(this.repo.getEquipment(userId).backpack || 0, tiers.length - 1);
    // Seeds live in a seed pouch and arrows in the quiver: neither takes backpack slots.
    const used = Object.entries(this.repo.getInventory(userId)).reduce((s, [id, q]) => s + (ITEMS[id] && !ITEMS[id].seedFor && !ITEMS[id].ammo ? q : 0), 0);
    const next = tiers[tier + 1];
    return {
      level: tier + 1,
      levels: tiers.length,
      name: tiers[tier].name,
      icon: tiers[tier].icon,
      capacity: tiers[tier].capacity,
      used,
      next: next ? { level: tier + 2, name: next.name, icon: next.icon, capacity: next.capacity, cost: next.cost } : null,
    };
  },

  sellValue(itemId) {
    return Math.round(ITEMS[itemId].value * this.cfg.sellMultiplier);
  },

  // ---- Tools & upgrades (!upgrade rod, !upgrade backpack) --------------------

  // Tool tiers with the live (admin-editable) numbers applied.
  toolTiers(skillId) {
    const t = SKILLS[skillId].tool;
    if (!t) return null;
    const live = this.settings.all[`${t.id}s`];
    return t.tiers.map((tier, i) => ({ ...tier, ...(live?.[i] || {}) }));
  },

  toolTier(userId, skillId) {
    const t = SKILLS[skillId].tool;
    if (!t) return null;
    return Math.min(this.repo.getEquipment(userId)[t.id] || 0, t.tiers.length - 1);
  },

  currentTool(userId, skillId) {
    const tier = this.toolTier(userId, skillId);
    return tier === null ? null : this.toolTiers(skillId)[tier];
  },

  canUpgrade(userId, skillId, level) {
    const tiers = this.toolTiers(skillId);
    const next = tiers?.[this.toolTier(userId, skillId) + 1];
    return Boolean(next && level >= next.level);
  },

  // "🎣 Oak Rod: 15% snap chance, +10% XP, rare finds x1.1"
  describeTool(tool, skillId) {
    const def = SKILLS[skillId].tool;
    const parts = [];
    if (def.stats.includes('failChance')) parts.push(`${pct(tool.failChance)} ${def.failWord || 'fail'} chance`);
    if (def.stats.includes('xpBonus')) parts.push(`+${Math.round(tool.xpBonus * 100)}% XP`);
    if (def.stats.includes('rareBonus')) parts.push(`rare finds x${tool.rareBonus}`);
    if (def.stats.includes('doubleChance')) parts.push(`${pct(tool.doubleChance)} chance to smelt two`);
    return `${tool.icon} ${tool.name}: ${parts.join(', ')}`;
  },

  // Deducts the cost if the player can afford it. Returns null on success, or a reply explaining why not.
  pay(user, cost, what) {
    const balance = this.repo.getUser(user.id).points;
    if (balance < cost) {
      return `the ${what} costs ${fmt(cost)} pts, you have ${fmt(balance)} (${fmt(cost - balance)} more needed). Earn points with skills, !sell and chatting.`;
    }
    if (cost > 0) this.repo.addPoints(user.id, -cost);
    this.track('shop', cost);
    return null;
  },

  upgrade(user, args) {
    const which = (args[0] || '').toLowerCase();
    if (['backpack', 'bag', 'pack'].includes(which)) return this.upgradeBackpack(user);
    const skillId = TOOL_TO_SKILL[TOOL_ALIASES[which]];
    const options = [...Object.keys(TOOL_TO_SKILL), 'backpack'].map((t) => `!upgrade ${t}`).join(', ');
    if (!skillId) return which ? `you can't upgrade "${which}" (yet). Try ${options}` : `usage: ${options}`;
    return this.upgradeTool(user, skillId);
  },

  // !upgrade rod: needs the Fishing level for the next rod, and its price in points. One tier at a time.
  upgradeTool(user, skillId) {
    const skill = SKILLS[skillId];
    const t = skill.tool;
    const tiers = this.toolTiers(skillId);
    const level = skillLevel(skillId, this.repo.getSkills(user.id)[skillId]);
    const tier = this.toolTier(user.id, skillId);
    const current = tiers[tier];
    const next = tiers[tier + 1];
    if (!next) return `you already wield the best ${t.name.toLowerCase()} in the land: ${current.icon} ${current.name}! 🏆`;
    if (level < next.level) {
      return `your ${current.icon} ${current.name} can be upgraded to ${next.icon} ${next.name} at ${skill.name} level ${next.level} (you are ${level}) for ${fmt(next.cost)} pts.`;
    }
    return this.repo.transaction(() => {
      const refused = this.pay(user, next.cost, next.name);
      if (refused) return refused;
      this.repo.setEquipment(user.id, t.id, tier + 1);
      this.emitActivity(user, { kind: 'upgrade', skill: skillId, text: `upgraded to the ${next.name}` });
      const after = tiers[tier + 2];
      const upcoming = after
        ? ` Next: ${after.name} at level ${after.level} for ${fmt(after.cost)} pts.`
        : ` That is the best ${t.name.toLowerCase()} there is! 🏆`;
      return `🔧 upgraded to ${this.describeTool(next, skillId)} for ${fmt(next.cost)} pts!${upcoming}`;
    });
  },

  // !upgrade backpack: more slots for points. No level requirement.
  upgradeBackpack(user) {
    const bag = this.backpack(user.id);
    if (!bag.next) return `your ${bag.icon} ${bag.name} is already the biggest backpack there is (${bag.capacity} slots)! 🏆`;
    return this.repo.transaction(() => {
      const refused = this.pay(user, bag.next.cost, `${bag.next.name} (${bag.next.capacity} slots)`);
      if (refused) return refused;
      this.repo.setEquipment(user.id, 'backpack', bag.level);
      this.emitActivity(user, { kind: 'upgrade', text: `upgraded to the ${bag.next.name} (${bag.next.capacity} slots)` });
      const after = this.backpackTiers()[bag.level + 1];
      const upcoming = after ? ` Next: ${after.capacity} slots for ${fmt(after.cost)} pts.` : ' That is the biggest backpack there is! 🏆';
      return `🎒 upgraded to the ${bag.next.icon} ${bag.next.name}: ${bag.next.capacity} slots (level ${bag.level + 1}/${bag.levels}) for ${fmt(bag.next.cost)} pts!${upcoming}`;
    });
  },

  // !rod / !pickaxe / !axe / !shovel / !furnace: show that tool and what's next.
  toolInfo(user, args, cmd) {
    const skillId = TOOL_TO_SKILL[TOOL_ALIASES[cmd]] || TOOL_TO_SKILL.rod;
    const t = SKILLS[skillId].tool;
    const tiers = this.toolTiers(skillId);
    const tier = this.toolTier(user.id, skillId);
    const next = tiers[tier + 1];
    const level = skillLevel(skillId, this.repo.getSkills(user.id)[skillId]);
    let tail = ` This is the best ${t.name.toLowerCase()} there is! 🏆`;
    if (next) {
      tail =
        level >= next.level
          ? ` Ready: !upgrade ${t.id} for the ${next.name} (${fmt(next.cost)} pts)!`
          : ` Next: ${next.name} at ${SKILLS[skillId].name} level ${next.level} for ${fmt(next.cost)} pts.`;
    }
    return `${this.describeTool(tiers[tier], skillId)} (tier ${tier + 1}/${tiers.length}).${tail}`;
  },

  // !gear: every tool plus the backpack in one line, flagging anything ready to upgrade.
  gear(user) {
    const xp = this.repo.getSkills(user.id);
    const parts = SKILL_IDS.filter((id) => SKILLS[id].tool).map((id) => {
      const tiers = this.toolTiers(id);
      const tier = this.toolTier(user.id, id);
      const ready = this.canUpgrade(user.id, id, skillLevel(id, xp[id])) ? ' ⬆️' : '';
      return `${tiers[tier].icon} ${tiers[tier].name} ${tier + 1}/${tiers.length}${ready}`;
    });
    const bag = this.backpack(user.id);
    parts.push(`${bag.icon} ${bag.name} ${bag.used}/${bag.capacity}`);
    const anyReady = parts.some((p) => p.endsWith('⬆️'));
    return `${parts.join(' | ')}${anyReady ? ' — ⬆️ = ready to !upgrade' : ''}`;
  },
};
