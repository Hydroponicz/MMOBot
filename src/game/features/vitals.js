// GameEngine methods: vitals. Mixed into GameEngine.prototype by engine.js.
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
  // ---- Health and mana ------------------------------------------------------

  // Current HP and mana with regeneration applied. Knocked-out players have 0 HP until ko_until,
  // then they're back at full.
  vitals(userId, now = this.now()) {
    const u = this.repo.getUser(userId);
    const level = this.combatLevel(userId);
    const perk = this.perks(userId);
    const maxHp = Math.round(maxHpFor(level) * perk.hp);
    const maxMana = Math.round(maxManaFor(level) * perk.mana);
    const regen = (value, at, max, hours) => (value === null || value === undefined ? max : Math.min(max, value + (max * Math.max(0, now - at)) / (hours * 3_600_000)));
    const mana = regen(u.mana, u.mana_at, maxMana, this.cfg.manaRegenHours);
    if (u.ko_until > now) return { hp: 0, maxHp, mana, maxMana, ko: true, koUntil: u.ko_until };
    const hp = u.ko_until ? maxHp : regen(u.hp, u.hp_at, maxHp, this.cfg.hpRegenHours);
    return { hp, maxHp, mana, maxMana, ko: false, koUntil: 0 };
  },

  knockedOutMessage(userId, vit, now) {
    const owned = this.healthPotions(userId);
    const fix = owned.length ? `!drink ${ITEMS[owned[0]].name.toLowerCase()}` : '!buy minor health potion then !drink';
    return `💀 you're knocked out! Back at full HP in ${minutesLeft(vit.koUntil - now)}, or ${fix} to get back up now.`;
  },

  // Health potions the player owns, weakest first.
  healthPotions(userId) {
    const inv = this.repo.getInventory(userId);
    return Object.keys(inv)
      .filter((id) => ITEMS[id]?.potion?.hp && inv[id] > 0)
      .sort((a, b) => ITEMS[a].potion.hp - ITEMS[b].potion.hp);
  },

  vitalsLine(vit) {
    const hp = vit.ko ? `💀 knocked out (0/${fmt(vit.maxHp)} HP)` : `❤️ ${fmt(Math.floor(vit.hp))}/${fmt(vit.maxHp)} HP`;
    return `${hp} · 🔷 ${fmt(Math.floor(vit.mana))}/${fmt(vit.maxMana)} mana`;
  },

  // !hp
  vitalsInfo(user) {
    const now = this.now();
    const vit = this.vitals(user.id, now);
    const extra = vit.ko
      ? ` Back up in ${minutesLeft(vit.koUntil - now)}, or !drink a health potion.`
      : vit.hp < vit.maxHp
        ? ` Full in ${minutesLeft(((vit.maxHp - vit.hp) / vit.maxHp) * this.cfg.hpRegenHours * 3_600_000)}. !heal (mana) or !drink a potion to heal now.`
        : '';
    const buffs = this.buffLine(user.id, now);
    return `${this.vitalsLine(vit)}.${extra}${buffs ? ` | ${buffs}` : ''}`;
  },

  // ---- Timed effects from undead potions ("buffs") -----------------------------
  // Stored as { buffId: expiresAt } per player.
  buffKey(userId) {
    return `buffs:${userId}`;
  },

  activeBuffs(userId, now = this.now()) {
    const all = this.repo.getSetting(this.buffKey(userId)) || {};
    return Object.fromEntries(Object.entries(all).filter(([id, until]) => until > now && BUFFS[id]));
  },

  hasBuff(userId, id) {
    return Boolean(this.activeBuffs(userId)[id]);
  },

  addBuff(userId, id, now = this.now(), minutes = BUFFS[id].minutes) {
    const buffs = { ...this.activeBuffs(userId, now), [id]: now + minutes * 60_000 };
    this.repo.setSetting(this.buffKey(userId), buffs);
    return buffs[id];
  },

  removeBuff(userId, id) {
    const { [id]: _gone, ...rest } = this.activeBuffs(userId);
    this.repo.setSetting(this.buffKey(userId), rest);
  },

  // Grave Luck doubles rare chances, and so does a Festival of Fortune (community project).
  luck(userId) {
    return (this.hasBuff(userId, 'luck') ? 2 : 1) * (this.fortuneActive() ? 2 : 1) * this.perks(userId).luck;
  },

  // ---- Stamina ------------------------------------------------------------------
  // Every game action (skilling, fighting, farming, raid attacks) uses one charge. Using a charge
  // from a full bar starts the refill timer; when it runs out the bar is full again. Wraithwalk
  // halves the refill time.
  // Agility and Halflings make it refill faster.
  staminaRefillMs(userId, now = this.now()) {
    const ms = (this.cfg.staminaMinutes ?? 5) * 60_000 * this.agilityRefill(userId) * (this.perks(userId).refill ?? 1);
    return this.activeBuffs(userId, now).haste ? ms / 2 : ms;
  },

  // Refill-time multiplier from Agility: 0.1% faster per level, up to 25% faster (both settings).
  // 25% faster refills = a third more actions per hour.
  agilityRefill(userId) {
    const level = skillLevel('agility', this.repo.getSkills(userId).agility || 0);
    return 1 - Math.min(this.cfg.agilityRefillMax ?? 0.25, Math.max(0, level - 1) * (this.cfg.agilityRefillPerLevel ?? 0.001));
  },

  // { charges, max, refillAt } (refillAt null = full).
  stamina(userId, now = this.now()) {
    const max = Math.max(1, (this.cfg.staminaMax ?? 3) + this.perks(userId).stamina);
    const u = this.repo.getUser(userId);
    if (!u || u.stamina === null || u.stamina === undefined) return { charges: max, max, refillAt: null, startedAt: null };
    const refill = this.staminaRefillMs(userId, now);
    if (this.cfg.staminaGradual) {
      // Gradual: one charge back every refill/max, so an empty bar is still full after the refill time.
      const per = refill / max;
      const gained = Math.floor(Math.max(0, now - u.stamina_at) / per);
      const charges = Math.min(max, u.stamina + gained);
      if (charges >= max) return { charges: max, max, refillAt: null, startedAt: null };
      const anchor = u.stamina_at + gained * per;
      return { charges, max, refillAt: anchor + (max - charges) * per, nextAt: anchor + per, startedAt: anchor };
    }
    const refillAt = u.stamina_at + refill;
    // (Also full when the max went down, e.g. a Halfling who changed race.)
    if (now >= refillAt || u.stamina >= max) return { charges: max, max, refillAt: null, startedAt: null };
    return { charges: clamp(u.stamina, 0, max), max, refillAt, nextAt: refillAt, startedAt: u.stamina_at };
  },

  // Returns null when the user has a charge, or the "out of stamina" reply ('' = already warned).
  staminaCheck(user, now = this.now()) {
    const s = this.stamina(user.id, now);
    if (s.charges > 0) return null;
    // Warn once per refill window so spamming doesn't flood chat.
    if (this.cooldownWarned.get(user.id) === s.startedAt) return '';
    this.cooldownWarned.set(user.id, s.startedAt);
    return this.cfg.staminaGradual
      ? `you're catching your breath 😮‍💨 out of stamina (0/${s.max}), next charge in ${this.waitText(s.nextAt - now)}.`
      : `you're catching your breath 😮‍💨 out of stamina (0/${s.max}), full again in ${this.waitText(s.refillAt - now)}.`;
  },

  spendStamina(user, now = this.now()) {
    const s = this.stamina(user.id, now);
    this.repo.setStamina(user.id, Math.max(0, s.charges - 1), s.startedAt ?? now);
  },

  // "45s" / "3m 12s"
  waitText(ms) {
    const sec = Math.max(1, Math.ceil(ms / 1000));
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60 ? ` ${sec % 60}s` : ''}`;
  },

  // !stamina
  staminaInfo(user) {
    const s = this.stamina(user.id);
    const bar = '⚡'.repeat(s.charges) + '▫️'.repeat(s.max - s.charges);
    const faster = Math.round((1 - this.agilityRefill(user.id) * (this.perks(user.id).refill ?? 1)) * 100);
    return `stamina ${bar} ${s.charges}/${s.max}${s.refillAt ? ` · full again in ${this.waitText(s.refillAt - this.now())}` : ' · full!'}${faster > 0 ? ` · refills ${faster}% faster (!run trains Agility)` : ' · !run trains Agility for faster refills'}`;
  },

  // "🦴 Bone-Deep Focus 24m · 💀 Deathless 58m"
  buffLine(userId, now = this.now()) {
    return Object.entries(this.activeBuffs(userId, now))
      .map(([id, until]) => `${BUFFS[id].icon} ${BUFFS[id].name} ${minutesLeft(until - now)}`)
      .join(' · ');
  },

  // !buffs
  buffsInfo(user) {
    const line = this.buffLine(user.id);
    return line ? `active effects: ${line}` : 'no active effects. Brew undead potions with !brew (Ashes from !lightfire + something dead) and !drink them.';
  },

  drinkBuff(user, id, now) {
    const buff = BUFFS[ITEMS[id].potion.buff];
    const minutes = ITEMS[id].potion.minutes || buff.minutes;
    const had = this.hasBuff(user.id, buff.id);
    this.repo.transaction(() => {
      this.repo.removeItem(user.id, id, 1);
      this.addBuff(user.id, buff.id, now, minutes);
    });
    return `${ITEMS[id].icon} you drank a ${ITEMS[id].name}: ${buff.icon} ${buff.name} for ${minutes} min${had ? ' (timer restarted)' : ''}: ${buff.text}.`;
  },

  // !drink [potion]: with no name, drinks what you need most — the weakest health potion that tops
  // you up (or your strongest if none does), else a mana potion.
  drink(user, args) {
    const now = this.now();
    const inv = this.repo.getInventory(user.id);
    const owned = Object.keys(inv).filter((id) => ITEMS[id]?.potion && inv[id] > 0);
    const vit = this.vitals(user.id, now);
    let id;
    if (args.length) {
      id = findItem(args.join(' '), owned);
      if (!id) {
        const any = findItem(args.join(' '), SHOP.filter((x) => x.category === 'potions').map((x) => x.item));
        return any ? `you don't have a ${ITEMS[any].name}. !buy ${ITEMS[any].name.toLowerCase()} or !brew it.` : `unknown potion. You have: ${owned.map((i) => ITEMS[i].name).join(', ') || 'none — see !shop'}`;
      }
    } else {
      if (!owned.length) return `you have no potions. !buy minor health potion (see !shop) or !brew one from farmed crops.`;
      const missingHp = vit.maxHp - vit.hp;
      const hpPots = owned.filter((i) => ITEMS[i].potion.hp).sort((a, b) => ITEMS[a].potion.hp - ITEMS[b].potion.hp);
      const manaPots = owned.filter((i) => ITEMS[i].potion.mana).sort((a, b) => ITEMS[a].potion.mana - ITEMS[b].potion.mana);
      if (missingHp > 0.5 && hpPots.length) id = hpPots.find((i) => ITEMS[i].potion.hp * vit.maxHp >= missingHp) || hpPots[hpPots.length - 1];
      else if (vit.maxMana - vit.mana > 0.5 && manaPots.length) {
        id = manaPots.find((i) => ITEMS[i].potion.mana * vit.maxMana >= vit.maxMana - vit.mana) || manaPots[manaPots.length - 1];
      } else return `you're already at full health${manaPots.length ? ' and mana' : ''}. ${this.vitalsLine(vit)}`;
    }
    const p = ITEMS[id].potion;
    if (p.buff) return this.drinkBuff(user, id, now);
    const heals = p.hp && (vit.ko || vit.hp < vit.maxHp);
    const mana = p.mana && vit.mana < vit.maxMana;
    if (!heals && !mana) return `no need — ${this.vitalsLine(vit)}.`;
    const hp = heals ? Math.min(vit.maxHp, (vit.ko ? 0 : vit.hp) + p.hp * vit.maxHp) : vit.hp;
    const newMana = p.mana ? Math.min(vit.maxMana, vit.mana + p.mana * vit.maxMana) : vit.mana;
    this.repo.transaction(() => {
      this.repo.removeItem(user.id, id, 1);
      this.repo.setVitals(user.id, { hp, mana: newMana, koUntil: vit.ko && !heals ? vit.koUntil : 0 }, now);
    });
    const after = this.vitals(user.id, now);
    return `${ITEMS[id].icon} you drank a ${ITEMS[id].name}${vit.ko && heals ? ' and got back on your feet' : ''}! ${this.vitalsLine(after)}${after.ko ? '. Still knocked out — only health potions revive.' : ''}`;
  },

  // !heal: spend half your max mana to restore a quarter of your max HP. Can't revive you.
  // Heal: costs a share of max mana (30% by default) and restores 30% of max HP plus 0.1% per Magic
  // level (up to +30%), so it's never worse than a meal and much better for mages.
  healCost(vit) {
    return Math.ceil(vit.maxMana * (this.cfg.healManaCost ?? 0.3));
  },

  healPercent(userId) {
    const magic = skillLevel('magic', this.repo.getSkills(userId).magic);
    return (this.cfg.healBase ?? 0.3) + Math.min(0.3, magic * 0.001);
  },

  healSpell(user) {
    const now = this.now();
    const vit = this.vitals(user.id, now);
    if (vit.ko) return `${this.knockedOutMessage(user.id, vit, now)} (!heal can't revive you.)`;
    if (vit.hp >= vit.maxHp) return `you're already at full health. ${this.vitalsLine(vit)}`;
    const cost = this.healCost(vit);
    if (vit.mana < cost) {
      const wait = ((cost - vit.mana) / vit.maxMana) * this.cfg.manaRegenHours * 3_600_000;
      return `✨ !heal needs ${cost} mana (you have ${Math.floor(vit.mana)}). Enough in ${minutesLeft(wait)}, or !drink a mana potion.`;
    }
    const hp = Math.min(vit.maxHp, vit.hp + vit.maxHp * this.healPercent(user.id));
    this.repo.setVitals(user.id, { hp, mana: vit.mana - cost, koUntil: 0 }, now);
    const gained = this.grantXp(user, 'magic', this.xpFor(10 + Math.round(vit.maxMana / 10)));
    return `✨ you cast Heal (+${fmt(Math.round(hp - vit.hp))} HP). ${this.vitalsLine(this.vitals(user.id, now))} ${gained.text}`;
  },
};
