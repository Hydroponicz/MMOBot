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
    const maxHp = maxHpFor(level);
    const maxMana = maxManaFor(level);
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

  addBuff(userId, id, now = this.now()) {
    const buffs = { ...this.activeBuffs(userId, now), [id]: now + BUFFS[id].minutes * 60_000 };
    this.repo.setSetting(this.buffKey(userId), buffs);
    return buffs[id];
  },

  removeBuff(userId, id) {
    const { [id]: _gone, ...rest } = this.activeBuffs(userId);
    this.repo.setSetting(this.buffKey(userId), rest);
  },

  // Grave Luck doubles rare chances.
  luck(userId) {
    return this.hasBuff(userId, 'luck') ? 2 : 1;
  },

  // Wraithwalk halves the action cooldown.
  actionCooldownMs(userId, now = this.now()) {
    const ms = this.cfg.actionCooldown * 1000;
    return this.activeBuffs(userId, now).haste ? ms / 2 : ms;
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
    const had = this.hasBuff(user.id, buff.id);
    this.repo.transaction(() => {
      this.repo.removeItem(user.id, id, 1);
      this.addBuff(user.id, buff.id, now);
    });
    return `${ITEMS[id].icon} you drank a ${ITEMS[id].name}: ${buff.icon} ${buff.name} for ${buff.minutes} min${had ? ' (timer restarted)' : ''}: ${buff.text}.`;
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
  healSpell(user) {
    const now = this.now();
    const vit = this.vitals(user.id, now);
    if (vit.ko) return `${this.knockedOutMessage(user.id, vit, now)} (!heal can't revive you.)`;
    if (vit.hp >= vit.maxHp) return `you're already at full health. ${this.vitalsLine(vit)}`;
    const cost = Math.ceil(vit.maxMana / 2);
    if (vit.mana < cost) {
      const wait = ((cost - vit.mana) / vit.maxMana) * this.cfg.manaRegenHours * 3_600_000;
      return `✨ !heal needs ${cost} mana (you have ${Math.floor(vit.mana)}). Enough in ${minutesLeft(wait)}, or !drink a mana potion.`;
    }
    const hp = Math.min(vit.maxHp, vit.hp + vit.maxHp * 0.25);
    this.repo.setVitals(user.id, { hp, mana: vit.mana - cost, koUntil: 0 }, now);
    const gained = this.grantXp(user, 'magic', this.xpFor(10 + Math.round(vit.maxMana / 10)));
    return `✨ you cast Heal (+${fmt(Math.round(hp - vit.hp))} HP). ${this.vitalsLine(this.vitals(user.id, now))} ${gained.text}`;
  },
};
