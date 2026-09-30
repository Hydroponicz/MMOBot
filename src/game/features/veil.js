// GameEngine methods: the Gloamveil, an extraction minigame (zones and loot in ../veil.js).
//
// !veil 1-4 walks into a zone wearing your gear, carrying up to 4 healing supplies (one stamina
// charge and an entry fee). Inside, one step at a time:
//   !search   loot the room (makes noise; noise draws monsters). A full bag swaps its cheapest
//             item for a better find.
//   !deeper   go one room deeper (better loot, harder monsters)
//   !extract  leave through a Waystone (rooms 3 and 6, some rooms hide one): the loot is yours
//   !mend     eat or drink one of your supplies (also done by itself after a fight when you're low)
// Other players are in the fog too. When you spot one: !ambush to attack (they may slip away,
// Agility helps) or !hide to let them pass. The winner takes the loser's bag and one piece of
// their gear, and still has to get it out.
// Dying (to a monster, a player, or the fog closing when time runs out) is harsh: you lose your
// worn weapon and armor, your supplies and everything in your bag, and you're knocked out.
// Mixed into GameEngine.prototype by engine.js.
const { ITEMS, SKILLS, SPELLS, GEAR_SLOTS, WEAPON_SKILL, skillLevel, fmt, itemLabel, clamp, minutesLeft } = require('./shared');
const { ZONES, ROOMS, WAYSTONES } = require('../veil');

const SUPPLY_UNITS = 4;
const ENCOUNTER_MS = 90_000;
const LOG_SIZE = 30;
const AUTO_MEND = 0.4; // eat a supply by itself after a fight below this share of max HP

const zoneOf = (id) => ZONES.find((z) => z.id === Number(id));
const bagCount = (bag) => Object.values(bag).reduce((s, q) => s + q, 0);
const bagValue = (bag) => Object.entries(bag).reduce((s, [id, q]) => s + (ITEMS[id]?.value || 0) * q, 0);
const bagText = (bag) => Object.entries(bag).map(([id, q]) => itemLabel(id, q)).join(', ');
const noiseBar = (n) => '▓'.repeat(Math.round(clamp(n, 0, 100) / 25)).padEnd(4, '░');
const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

module.exports = {
  veilCfg() {
    const c = this.cfg;
    return {
      on: c.veilEnabled !== false,
      minutes: c.veilMinutes ?? 15,
      bagSize: c.veilBagSize ?? 12,
      lootMult: c.veilLootMultiplier ?? 1,
      pvpChance: c.veilPvpChance ?? 0.15,
      pairHours: c.veilSamePairHours ?? 24,
      actionSeconds: c.veilActionSeconds ?? 5,
    };
  },

  // ---- State ----------------------------------------------------------------------------------
  // A player's run, or null. A run whose time is up ends here: the fog takes them.
  veilRun(userId, now = this.now()) {
    const run = this.repo.getSetting(`veil:${userId}`);
    if (!run) return null;
    if (now >= run.endsAt) {
      this.veilDie(userId, run, { cause: 'fog' }, now);
      return null;
    }
    return run;
  },

  veilSave(userId, run) {
    this.repo.setSetting(`veil:${userId}`, run);
    const active = this.repo.getSetting('veil:active') || [];
    if (!active.includes(userId)) this.repo.setSetting('veil:active', [...active, userId]);
  },

  veilClear(userId) {
    this.repo.setSetting(`veil:${userId}`, null);
    this.repo.setSetting('veil:active', (this.repo.getSetting('veil:active') || []).filter((id) => id !== userId));
  },

  // Everyone in the fog right now: [{ userId, run }] (runs whose time is up end first).
  veilActive(now = this.now()) {
    return (this.repo.getSetting('veil:active') || [])
      .map((userId) => ({ userId, run: this.veilRun(userId, now) }))
      .filter((x) => x.run);
  },

  inVeil(userId) {
    return !!this.veilRun(userId);
  },

  veilLog(entry) {
    const log = this.repo.getSetting('veil:log') || [];
    this.repo.setSetting('veil:log', [{ at: this.now(), ...entry }, ...log].slice(0, LOG_SIZE));
  },

  // This week's board: { week, players: { userId: { name, value, extracts, kills, deaths } } }.
  veilWeek() {
    const week = this.weekIndex();
    let w = this.repo.getSetting('veil:week');
    if (!w || w.week !== week) w = { week, players: {} };
    return w;
  },

  veilStat(userId, field, add) {
    const w = this.veilWeek();
    const u = this.repo.getUser(userId);
    const p = (w.players[userId] ??= { name: u?.username || '?', value: 0, extracts: 0, kills: 0, deaths: 0 });
    p[field] += add;
    this.repo.setSetting('veil:week', w);
  },

  // ---- Fighting in the fog --------------------------------------------------------------------
  // Only what you're wearing counts in here: your worn weapon (with arrows or a spell) and armor.
  veilPick(userId) {
    const weapon = this.repo.getWorn(userId).weapon;
    if (!weapon || !ITEMS[weapon]?.weaponType) return null;
    const skillId = WEAPON_SKILL[ITEMS[weapon].weaponType];
    const level = skillLevel(skillId, this.repo.getSkills(userId)[skillId]);
    let arrow = null;
    if (SKILLS[skillId].ammo) {
      const inv = this.repo.getInventory(userId);
      arrow = Object.keys(inv)
        .filter((id) => ITEMS[id]?.ammo === SKILLS[skillId].weaponType && inv[id] > 0 && ITEMS[id].level <= level)
        .sort((a, b) => ITEMS[b].attack - ITEMS[a].attack)[0] || null;
    }
    const spell = skillId === 'magic' ? [...SPELLS].reverse().find((sp) => sp.level <= level) : null;
    return { weapon, skillId, level, arrow, spell };
  },

  // A fighter for pvpCombat, from worn gear and current HP.
  veilCombatant(userId) {
    const pick = this.veilPick(userId);
    const vit = this.vitals(userId);
    const u = this.repo.getUser(userId);
    const combatLevel = this.combatLevel(userId);
    const stats = pick ? this.fightStats(userId, pick) : { attack: 0, defence: this.combatStats(userId).defence };
    return {
      id: userId,
      username: u.username,
      combatLevel,
      skillId: pick?.skillId || null,
      skillLevel: pick ? pick.level : combatLevel,
      weapon: pick?.weapon || null,
      attack: stats.attack,
      defence: stats.defence,
      maxHp: vit.maxHp,
      hp: vit.hp,
      label: pick ? `${SKILLS[pick.skillId].name} ${pick.level}, ${ITEMS[pick.weapon].name}` : 'Fists',
    };
  },

  // The monster waiting in this room: deeper rooms in deeper zones hold stronger ones.
  // They also stay near your own level (up to 12% above it per room deeper), within the zone's range.
  veilMonster(run, skillId, level) {
    const z = zoneOf(run.zone);
    const [lo, hi] = z.monsters;
    const zoneLevel = lo + ((hi - lo) * run.room) / (ROOMS - 1);
    const target = clamp(Math.min(zoneLevel, level * (1 + 0.12 * run.room)), lo, hi) * (0.85 + 0.25 * this.rng());
    const list = SKILLS[skillId || 'swords'].monsters;
    return [...list].reverse().find((m) => m.level <= target) || list[0];
  },

  // A monster attacks. Returns { dead, text }.
  veilMonsterFight(user, run, now) {
    const pick = this.veilPick(user.id);
    const vit = this.vitals(user.id, now);
    const level = pick ? pick.level : this.combatLevel(user.id);
    const monster = this.veilMonster(run, pick?.skillId, level);
    const stats = pick ? this.fightStats(user.id, pick) : { attack: 0, defence: this.combatStats(user.id).defence };
    if (pick?.arrow) this.repo.removeItem(user.id, pick.arrow, 1);
    const f = this.simulateFight(level, stats, monster, vit.hp);
    const tag = `${monster.icon} ${monster.name} (level ${monster.level})`;
    if (f.outcome === 'died') {
      const death = this.veilDie(user.id, run, { cause: 'monster', by: monster.name }, now);
      return { dead: true, text: `💀 a ${tag} came out of the fog and killed you. ${death}` };
    }
    let hp = Math.max(1, vit.hp - f.taken);
    this.repo.setVitals(user.id, { hp, mana: vit.mana, koUntil: 0 }, now);
    let text;
    if (f.outcome === 'won') {
      run.kills = (run.kills || 0) + 1;
      const gained = pick ? this.grantXp(user, pick.skillId, this.xpFor(monster.xp)) : { text: '' };
      text = `⚔️ a ${tag} attacked, and you killed it (-${fmt(Math.round(f.taken))} HP).${gained.text ? ` ${gained.text}` : ''}`;
      // Some drop a bit of the zone's loot.
      if (this.rng() < 0.3) {
        const z = zoneOf(run.zone);
        const got = this.veilAddLoot(run, z.loot[this.rng() < 0.7 ? 0 : 1][0], 1);
        if (got) text += ` It dropped ${itemLabel(got.item, got.qty)}.`;
      }
    } else {
      run.noise = Math.min(100, run.noise + 10);
      text = `🏃 a ${tag} attacked. You couldn't kill it and fought your way clear (-${fmt(Math.round(f.taken))} HP).`;
    }
    if (hp < vit.maxHp * AUTO_MEND) {
      const m = this.veilUseSupply(user.id, run, now);
      if (m) text += ` ${m}`;
    }
    return { dead: false, text };
  },

  // Adds loot to the bag, as much as fits. Returns { item, qty } or null when full.
  veilAddLoot(run, item, qty) {
    const room = this.veilCfg().bagSize - bagCount(run.bag);
    const n = Math.min(room, qty);
    if (n <= 0) return null;
    run.bag[item] = (run.bag[item] || 0) + n;
    return { item, qty: n };
  },

  // HP a supply restores for this player.
  veilSupplyHeal(userId, id, maxHp) {
    return ITEMS[id].food ? this.mealHeal(userId, id, maxHp) : Math.round((ITEMS[id].potion?.hp || 0) * maxHp);
  },

  // Eats/drinks the supply that best covers the missing HP. Returns the text, or null.
  veilUseSupply(userId, run, now) {
    const vit = this.vitals(userId, now);
    const missing = vit.maxHp - vit.hp;
    const have = Object.keys(run.supplies).filter((id) => run.supplies[id] > 0);
    if (!have.length || missing < 1) return null;
    have.sort((a, b) => this.veilSupplyHeal(userId, a, vit.maxHp) - this.veilSupplyHeal(userId, b, vit.maxHp));
    const id = have.find((i) => this.veilSupplyHeal(userId, i, vit.maxHp) >= missing) || have[have.length - 1];
    const hp = Math.min(vit.maxHp, vit.hp + this.veilSupplyHeal(userId, id, vit.maxHp));
    run.supplies[id]--;
    if (!run.supplies[id]) delete run.supplies[id];
    this.repo.setVitals(userId, { hp, mana: vit.mana, koUntil: 0 }, now);
    return `${ITEMS[id].icon} you ${ITEMS[id].food ? 'ate' : 'drank'} a ${ITEMS[id].name} (+${fmt(Math.round(hp - vit.hp))} HP).`;
  },

  // Death in the fog. Everything worn, carried and found is gone; a killer gets the bag and one
  // piece of gear (not when the same two players already fought in here recently). Returns a short
  // text of what was lost.
  veilDie(userId, run, { cause, by = null, killer = null } = {}, now = this.now()) {
    const user = this.repo.getUser(userId);
    const worn = this.repo.getWorn(userId);
    const gear = GEAR_SLOTS.map((sl) => [sl, worn[sl]]).filter(([, id]) => id && ITEMS[id]);
    const vit = this.vitals(userId, now);
    let taken = null;
    this.repo.transaction(() => {
      for (const [slot, id] of gear) {
        this.repo.takeOff(userId, slot);
        // Enchantments are per item: a lost +5 sword doesn't come back when you get another.
        if (!this.repo.getInventory(userId)[id]) this.repo.setEquipment(userId, `ench:${id}`, 0);
      }
      this.repo.setVitals(userId, { hp: 0, mana: vit.mana, koUntil: now + this.cfg.hpRegenHours * 3_600_000 }, now);
      if (killer?.run) {
        for (const [id, q] of Object.entries(run.bag)) this.veilAddLoot(killer.run, id, q);
        if (gear.length) {
          taken = gear[Math.floor(this.rng() * gear.length)][1];
          this.veilAddLoot(killer.run, taken, 1);
        }
        this.veilSave(killer.id, killer.run);
      }
      this.veilClear(userId);
    });
    const lostGear = gear.map(([, id]) => ITEMS[id].name);
    const lostValue = bagValue(run.bag);
    const z = zoneOf(run.zone);
    const how = cause === 'fog' ? 'the fog closed over them' : cause === 'pvp' ? `killed by ${by}` : `killed by a ${by}`;
    this.veilLog({ kind: 'death', name: user.username, zone: z.name, how, value: lostValue, gear: lostGear.length });
    this.veilStat(userId, 'deaths', 1);
    const what = [lostGear.length ? `your ${lostGear.join(', ')}` : null, Object.keys(run.bag).length ? `your bag (${fmt(lostValue)} pts of loot)` : null, Object.keys(run.supplies).length ? 'your supplies' : null].filter(Boolean);
    const lost = what.length ? `Lost: ${what.join(', ')}.` : 'You had nothing to lose, at least.';
    if (cause !== 'monster') {
      this.notify(userId, cause === 'fog'
        ? `🌫️ Time ran out in the ${z.name} and the fog took you. ${lost}`
        : `💀 ${by} killed you in the ${z.name}${taken ? ` and took your ${ITEMS[taken].name}` : ''}. ${lost}`);
    }
    this.emitActivity(user, { kind: 'death', text: cause === 'fog' ? `was lost in the fog of the ${z.name}` : `died in the ${z.name} (${how})` });
    return `${lost} Knocked out for ${this.cfg.hpRegenHours}h (or !drink a health potion).`;
  },

  // ---- Commands -------------------------------------------------------------------------------
  // !veil: zones and how to enter, or your run's status. !veil 2 enters the Drowned Choir.
  veilCommand(user, args = []) {
    const vc = this.veilCfg();
    if (!vc.on) return 'the Gloamveil is closed right now.';
    const a = (args[0] || '').toLowerCase();
    const run = this.veilRun(user.id);
    if (run) return `${this.veilStatus(user.id, run)} ${this.veilOptions(run)}`;
    const zoneArg = /^\d$/.test(a) ? a : a === 'enter' ? args[1] || '1' : null;
    if (zoneArg) return this.veilEnter(user, Number(zoneArg), { light: args.some((w) => /^light$/i.test(w)) });
    const lvl = this.combatLevel(user.id);
    const zones = ZONES.map((z) => `${z.icon} ${z.id} ${z.name} (Combat ${z.minCombat}+, ${fmt(z.fee)} pts)${lvl >= z.minCombat ? '' : ' 🔒'}`).join(' · ');
    return `🌫️ The Gloamveil: go in wearing your gear, loot, and get out through a Waystone. Die in there and you lose your worn gear and everything you carry. ${zones}. !veil 1 to enter (takes up to ${SUPPLY_UNITS} food/potions; !veil 1 light takes none). Full guide on the website.`;
  },

  veilStatus(userId, run, now = this.now()) {
    const z = zoneOf(run.zone);
    const vit = this.vitals(userId, now);
    const room = run.rooms[run.room];
    const sup = bagCount(run.supplies);
    return `${z.icon} ${z.name} · room ${run.room + 1}/${ROOMS}${room.waystone ? ' 🔮 Waystone here' : ''} · ⏱ ${minutesLeft(run.endsAt - now)} · noise ${noiseBar(run.noise)} · ❤️ ${fmt(Math.floor(vit.hp))}/${fmt(vit.maxHp)} · 🎒 ${bagCount(run.bag)}/${this.veilCfg().bagSize}${sup ? ` · 🍖 ${sup}` : ''}`;
  },

  veilOptions(run) {
    if (run.encounter) return 'You spotted someone: !ambush or !hide.';
    const room = run.rooms[run.room];
    const opts = [room.searches > 0 ? '!search' : null, run.room < ROOMS - 1 ? '!deeper' : null, room.waystone ? '!extract' : null].filter(Boolean);
    return opts.length ? `${opts.join(', ')}.` : '';
  },

  veilEnter(user, zoneId, { light = false } = {}) {
    const now = this.now();
    const vc = this.veilCfg();
    const z = zoneOf(zoneId);
    if (!z) return `there are ${ZONES.length} zones: !veil 1 to !veil ${ZONES.length}.`;
    const lvl = this.combatLevel(user.id);
    if (lvl < z.minCombat) return `the ${z.name} needs Combat level ${z.minCombat} (you are ${lvl}).`;
    const vit = this.vitals(user.id, now);
    if (vit.ko) return this.knockedOutMessage(user.id, vit, now);
    if (!this.veilPick(user.id)) return `you'd go in unarmed. !equip a weapon first: only what you're wearing comes with you (and is lost if you die).`;
    const u = this.repo.getUser(user.id);
    if (u.points < z.fee) return `entering the ${z.name} costs ${fmt(z.fee)} pts (you have ${fmt(u.points)}).`;
    const tired = this.staminaCheck(user, now);
    if (tired !== null) return tired || null;
    // The first time, say what's at stake and ask again.
    const worn = this.repo.getWorn(user.id);
    const gear = GEAR_SLOTS.map((sl) => worn[sl]).filter((id) => id && ITEMS[id]);
    const seen = this.repo.getSetting(`veil:seen:${user.id}`);
    this.veilWarned ??= new Map();
    const warned = this.veilWarned.get(user.id);
    if (!seen && !(warned && now - warned < 120_000)) {
      this.veilWarned.set(user.id, now);
      return `⚠️ In the Gloamveil death is final: you'd lose your ${gear.map((id) => ITEMS[id].name).join(', ')}, your supplies and all loot. Type !veil ${z.id} again within 2 min to go in.`;
    }
    // Pack supplies: the best healing food and potions, up to SUPPLY_UNITS.
    const supplies = {};
    if (!light) {
      const inv = this.repo.getInventory(user.id);
      const heal = (id) => this.veilSupplyHeal(user.id, id, vit.maxHp);
      const pool = Object.keys(inv).filter((id) => (ITEMS[id]?.food || ITEMS[id]?.potion?.hp) && inv[id] > 0).sort((a, b) => heal(b) - heal(a));
      let left = SUPPLY_UNITS;
      for (const id of pool) {
        const n = Math.min(left, inv[id]);
        if (n > 0) supplies[id] = n;
        left -= n;
        if (!left) break;
      }
    }
    const rooms = Array.from({ length: ROOMS }, (_, i) => ({ searches: i === 0 ? 1 : 2 + (this.rng() < 0.5 ? 1 : 0), waystone: WAYSTONES.includes(i) }));
    const run = { zone: z.id, at: now, endsAt: now + vc.minutes * 60_000, room: 0, rooms, noise: 0, bag: {}, supplies, fee: z.fee, kills: 0, encounter: null, met: {} };
    this.repo.transaction(() => {
      this.repo.addPoints(user.id, -z.fee);
      for (const [id, q] of Object.entries(supplies)) this.repo.removeItem(user.id, id, q);
      this.spendStamina(user, now);
      this.repo.setSetting(`veil:seen:${user.id}`, true);
      this.veilSave(user.id, run);
    });
    this.veilWarned.delete(user.id);
    this.track('shop', z.fee);
    const others = this.veilActive(now).filter((x) => x.userId !== user.id && x.run.zone === z.id).length;
    const sup = Object.keys(supplies).length ? `Supplies: ${bagText(supplies)}.` : 'No supplies.';
    return `${z.icon} you step into the ${z.name}. ${z.text} ${sup} ${vc.minutes} minutes before the fog closes${others ? `, and ${others === 1 ? 'someone else is' : `${others} others are`} in here` : ''}. Waystones in rooms ${WAYSTONES.map((i) => i + 1).join(' and ')}. !search, !deeper, !extract.`;
  },

  // Shared checks for actions inside. Returns { run } or { reply }.
  veilTurn(user, now, action) {
    if (!this.veilCfg().on) return { reply: 'the Gloamveil is closed right now.' };
    const run = this.veilRun(user.id, now);
    if (!run) {
      return { reply: action === 'extract' || action === 'search' || action === 'deeper' ? "you aren't in the Gloamveil. !veil to see the zones." : null };
    }
    this.veilLast ??= new Map();
    const wait = this.veilCfg().actionSeconds * 1000 - (now - (this.veilLast.get(user.id) || 0));
    if (wait > 0) return { reply: `the fog is thick... ${this.waitText(wait)}.` };
    this.veilLast.set(user.id, now);
    // Doing anything else lets a spotted player pass.
    if (run.encounter && !['ambush', 'hide'].includes(action)) run.encounter = null;
    if (run.encounter && now > run.encounter.until) run.encounter = null;
    return { run };
  },

  // Maybe you spot another player in the same zone. Returns text or ''.
  veilSpot(user, run, now) {
    const vc = this.veilCfg();
    const others = this.veilActive(now).filter((x) => x.userId !== user.id && x.run.zone === run.zone && !(run.met[x.userId] > now - 10 * 60_000));
    if (!others.length) return '';
    const other = others[Math.floor(this.rng() * others.length)];
    if (this.rng() >= vc.pvpChance + (run.noise + other.run.noise) / 500) return '';
    run.encounter = { userId: other.userId, until: now + ENCOUNTER_MS };
    run.met[other.userId] = now;
    const me = this.veilCombatant(user.id);
    const them = this.veilCombatant(other.userId);
    const odds = { favoured: '🟢 you look stronger', even: '🟡 an even fight', risky: '🟠 they look stronger', hopeless: '🔴 they would crush you' }[this.pvpOutlook(me, them)];
    const theirBag = bagCount(other.run.bag);
    return `👁️ You spot @${them.username} in the fog (${them.label}, ❤️ ${fmt(Math.floor(them.hp))}/${fmt(them.maxHp)}${theirBag ? `, carrying ${theirBag} loot` : ''}): ${odds}. !ambush to attack or !hide to let them pass.`;
  },

  veilSearch(user) {
    const now = this.now();
    const t = this.veilTurn(user, now, 'search');
    if (!t.run) return t.reply;
    const run = t.run;
    const vc = this.veilCfg();
    const z = zoneOf(run.zone);
    const room = run.rooms[run.room];
    if (room.searches <= 0) {
      this.veilSave(user.id, run);
      return `this room is picked clean. ${this.veilOptions(run)}`;
    }
    room.searches--;
    run.noise = Math.min(100, run.noise + 12);
    const parts = [];
    if (this.rng() < 0.8) {
      // Rarer finds the deeper you are.
      const weights = [55, 28, 13, 4].map((w, i) => w * (1 + run.room * 0.3 * i));
      let r = this.rng() * weights.reduce((s, w) => s + w, 0);
      let idx = 0;
      while (r > weights[idx] && idx < weights.length - 1) r -= weights[idx++];
      const [id] = z.loot[idx];
      const qty = Math.max(1, Math.round((idx === 0 ? 1 + Math.floor(this.rng() * 3) : idx === 1 ? 1 + Math.floor(this.rng() * 2) : 1) * vc.lootMult));
      let got = this.veilAddLoot(run, id, qty);
      let swapped = '';
      // A full bag: a better find replaces the cheapest thing in it.
      if (!got) {
        const cheapest = Object.keys(run.bag).sort((x, y) => ITEMS[x].value - ITEMS[y].value)[0];
        if (cheapest && ITEMS[cheapest].value < ITEMS[id].value) {
          run.bag[cheapest]--;
          if (!run.bag[cheapest]) delete run.bag[cheapest];
          got = this.veilAddLoot(run, id, 1);
          swapped = ` (dropped a ${ITEMS[cheapest].name} to make room)`;
        }
      }
      if (got) parts.push(`${idx === z.loot.length - 1 ? '✨ ' : ''}🔍 found ${itemLabel(got.item, got.qty)}!${swapped}`);
      else parts.push(`🔍 found ${itemLabel(id, qty)}, but your bag is full of better things.`);
      if (idx === z.loot.length - 1) this.emitActivity(user, { kind: 'rare', item: id, text: `found a ${ITEMS[id].name} deep in the ${z.name}` });
    } else {
      parts.push('🔍 nothing but mud and old bones.');
    }
    if (!room.waystone && run.room > 0 && this.rng() < 0.15) {
      room.waystone = true;
      parts.push('🔮 You uncover a hidden Waystone!');
    }
    if (this.rng() < 0.08 + run.noise / 250) {
      const f = this.veilMonsterFight(user, run, now);
      if (f.dead) return `${parts.join(' ')} ${f.text}`;
      parts.push(f.text);
    }
    parts.push(this.veilSpot(user, run, now));
    this.veilSave(user.id, run);
    return `${parts.filter(Boolean).join(' ')} | ${this.veilStatus(user.id, run, now)}${run.encounter ? '' : ` ${this.veilOptions(run)}`}`;
  },

  veilDeeper(user) {
    const now = this.now();
    const t = this.veilTurn(user, now, 'deeper');
    if (!t.run) return t.reply;
    const run = t.run;
    if (run.room >= ROOMS - 1) {
      this.veilSave(user.id, run);
      return `this is as deep as the fog goes. ${this.veilOptions(run)}`;
    }
    run.room++;
    run.noise = Math.max(0, run.noise - 15);
    const parts = [`🌫️ you go deeper, into room ${run.room + 1}.${run.rooms[run.room].waystone ? ' 🔮 A Waystone glows here.' : ''}`];
    if (this.rng() < 0.2 + run.room * 0.04) {
      const f = this.veilMonsterFight(user, run, now);
      if (f.dead) return `${parts[0]} ${f.text}`;
      parts.push(f.text);
    }
    parts.push(this.veilSpot(user, run, now));
    this.veilSave(user.id, run);
    return `${parts.filter(Boolean).join(' ')} | ${this.veilStatus(user.id, run, now)}${run.encounter ? '' : ` ${this.veilOptions(run)}`}`;
  },

  veilExtract(user) {
    const now = this.now();
    const t = this.veilTurn(user, now, 'extract');
    if (!t.run) return t.reply;
    const run = t.run;
    if (!run.rooms[run.room].waystone) {
      this.veilSave(user.id, run);
      const next = run.rooms.findIndex((r, i) => i > run.room && r.waystone);
      return `no Waystone here. ${next >= 0 ? `The next one is in room ${next + 1} (!deeper).` : 'Search rooms for a hidden one.'}`;
    }
    const z = zoneOf(run.zone);
    const value = bagValue(run.bag);
    this.repo.transaction(() => {
      for (const [id, q] of Object.entries(run.bag)) this.repo.addItem(user.id, id, q);
      for (const [id, q] of Object.entries(run.supplies)) this.repo.addItem(user.id, id, q);
      this.veilClear(user.id);
    });
    this.veilLog({ kind: 'extract', name: user.username, zone: z.name, value, kills: run.kills || 0 });
    this.veilStat(user.id, 'extracts', 1);
    if (value) this.veilStat(user.id, 'value', value);
    if (value >= run.fee * 4) this.emitActivity(user, { kind: 'event', text: `escaped the ${z.name} with ${fmt(value)} pts of loot` });
    const got = Object.keys(run.bag).length ? `You got out with ${bagText(run.bag)} (worth ${fmt(value)} pts).` : 'You got out with empty hands, but alive.';
    return `🔮 the Waystone pulls you out of the ${z.name}. ${got}${Object.keys(run.supplies).length ? ' Unused supplies are back in your backpack.' : ''}`;
  },

  veilMend(user) {
    const now = this.now();
    const t = this.veilTurn(user, now, 'mend');
    if (!t.run) return t.reply;
    const text = this.veilUseSupply(user.id, t.run, now);
    this.veilSave(user.id, t.run);
    return text ? `${text} | ${this.veilStatus(user.id, t.run, now)}` : `${Object.keys(t.run.supplies).length ? "you're at full health." : 'you have no supplies left.'} | ${this.veilStatus(user.id, t.run, now)}`;
  },

  veilHide(user) {
    const now = this.now();
    const t = this.veilTurn(user, now, 'hide');
    if (!t.run) return t.reply;
    const run = t.run;
    if (!run.encounter) {
      this.veilSave(user.id, run);
      return `there's nobody to hide from. ${this.veilOptions(run)}`;
    }
    const who = this.repo.getUser(run.encounter.userId)?.username || 'they';
    run.encounter = null;
    run.noise = Math.max(0, run.noise - 10);
    this.veilSave(user.id, run);
    return `🫥 you hold still in the fog and let @${who} pass. ${this.veilOptions(run)}`;
  },

  // !ambush: attack the player you spotted. They may slip away (their Agility against yours);
  // otherwise it's a fight to the death with the HP you both have.
  veilAmbush(user) {
    const now = this.now();
    const t = this.veilTurn(user, now, 'ambush');
    if (!t.run) return t.reply;
    const run = t.run;
    if (!run.encounter) {
      this.veilSave(user.id, run);
      return `there's nobody to ambush. Players you spot while searching or moving can be ambushed.`;
    }
    const otherId = run.encounter.userId;
    run.encounter = null;
    const theirRun = this.veilRun(otherId, now);
    if (!theirRun || theirRun.zone !== run.zone) {
      this.veilSave(user.id, run);
      return `they're gone: out through a Waystone, or dead. ${this.veilOptions(run)}`;
    }
    const other = this.repo.getUser(otherId);
    const z = zoneOf(run.zone);
    run.noise = Math.min(100, run.noise + 20);
    theirRun.noise = Math.min(100, theirRun.noise + 20);
    // A quiet player has a better chance to notice you coming.
    const slip = clamp(0.2 + (this.agilityLevel(otherId) - this.agilityLevel(user.id)) * 0.004 + (theirRun.noise < 30 ? 0.1 : 0), 0.05, 0.6);
    if (this.rng() < slip) {
      this.veilSave(user.id, run);
      this.veilSave(otherId, theirRun);
      this.notify(otherId, `👁️ Someone tried to ambush you in the ${z.name}, but you slipped away into the fog.`);
      return `💨 @${other.username} heard you coming and slipped into the fog. ${this.veilOptions(run)} | ${this.veilStatus(user.id, run, now)}`;
    }
    const a = this.veilCombatant(user.id);
    const b = this.veilCombatant(otherId);
    const fight = this.pvpCombat(a, b, { firstStrike: 'a', maxRounds: 200 });
    const setHp = (id, hp) => {
      const v = this.vitals(id, now);
      this.repo.setVitals(id, { hp: Math.max(1, hp), mana: v.mana, koUntil: 0 }, now);
    };
    if (!fight.winner) {
      setHp(user.id, fight.a.hp);
      setHp(otherId, fight.b.hp);
      this.veilSave(user.id, run);
      this.veilSave(otherId, theirRun);
      this.notify(otherId, `⚔️ @${user.username} ambushed you in the ${z.name}. You both broke off, bloodied.`);
      return `⚔️ you and @${other.username} fought until neither could land a blow, then broke off. | ${this.veilStatus(user.id, run, now)}`;
    }
    const iWon = fight.winner.id === user.id;
    const [winId, loseId] = iWon ? [user.id, otherId] : [otherId, user.id];
    const [winRun, loseRun] = iWon ? [run, theirRun] : [theirRun, run];
    const winner = this.repo.getUser(winId);
    // Loot only moves between two players once per veilSamePairHours (stops feeding an alt).
    const pairs = this.repo.getSetting('veil:pairs') || {};
    const key = pairKey(winId, loseId);
    const fresh = !(pairs[key] > now - this.veilCfg().pairHours * 3_600_000);
    pairs[key] = now;
    for (const k of Object.keys(pairs)) if (pairs[k] < now - 7 * 86_400_000) delete pairs[k];
    this.repo.setSetting('veil:pairs', pairs);
    setHp(winId, fight.winner.hp);
    winRun.kills = (winRun.kills || 0) + 1;
    const before = bagCount(winRun.bag);
    const lost = this.veilDie(loseId, loseRun, { cause: 'pvp', by: `@${winner.username}`, killer: fresh ? { id: winId, run: winRun } : null }, now);
    if (!fresh) this.veilSave(winId, winRun);
    this.veilStat(winId, 'kills', 1);
    this.guildWarScore(winId, loseId, 2, 'veil');
    this.veilLog({ kind: 'kill', name: winner.username, victim: iWon ? other.username : user.username, zone: z.name });
    this.emitActivity(this.repo.getUser(winId), { kind: 'duel', text: `killed @${iWon ? other.username : user.username} in the ${z.name}` });
    const looted = bagCount(winRun.bag) - before;
    if (iWon) {
      this.notify(otherId, `💀 @${user.username} ambushed and killed you in the ${z.name}.`);
      const loot = fresh ? (looted ? ` You take their loot (${looted} items) — now get it out!` : ' They had nothing on them.') : ' You already fought each other in here today: their things crumble to dust.';
      return `🗡️ you ambushed @${other.username} and killed them (${fight.rounds} blows, ❤️ ${fmt(Math.floor(fight.winner.hp))} left).${loot} | ${this.veilStatus(user.id, run, now)}`;
    }
    this.notify(otherId, `🗡️ @${user.username} ambushed you in the ${z.name}, and you killed them.${fresh ? ' Their loot is in your bag: get it out!' : ''}`);
    return `💀 you ambushed @${other.username}, but they killed you. ${lost}`;
  },

  // ---- Website -------------------------------------------------------------------------------
  veilPage(viewerId = null) {
    const now = this.now();
    const vc = this.veilCfg();
    const active = this.veilActive(now);
    const zones = ZONES.map((z) => ({
      id: z.id, name: z.name, icon: z.icon, text: z.text, minCombat: z.minCombat, fee: z.fee,
      monsters: z.monsters,
      loot: z.loot.map(([id, name, icon, value]) => ({ id, name, icon, value })),
      inside: active.filter((x) => x.run.zone === z.id).length,
    }));
    const w = this.veilWeek();
    const board = Object.entries(w.players)
      .map(([uid, p]) => ({ userId: Number(uid), ...p }))
      .sort((a, b) => b.value - a.value || b.kills - a.kills)
      .slice(0, 10);
    const out = { on: vc.on, cfg: { minutes: vc.minutes, bagSize: vc.bagSize, supplies: SUPPLY_UNITS, rooms: ROOMS, waystones: WAYSTONES }, zones, log: this.repo.getSetting('veil:log') || [], board };
    if (viewerId) {
      const run = this.veilRun(viewerId, now);
      const worn = this.repo.getWorn(viewerId);
      const vit = this.vitals(viewerId, now);
      out.me = {
        combat: this.combatLevel(viewerId),
        points: this.repo.getUser(viewerId)?.points || 0,
        stamina: this.stamina(viewerId, now),
        armed: !!this.veilPick(viewerId),
        seen: !!this.repo.getSetting(`veil:seen:${viewerId}`),
        gear: GEAR_SLOTS.filter((sl) => worn[sl] && ITEMS[worn[sl]]).map((sl) => ({ slot: sl, id: worn[sl], name: this.gearName(viewerId, worn[sl]), icon: ITEMS[worn[sl]].icon, value: ITEMS[worn[sl]].value })),
        vitals: { hp: Math.floor(vit.hp), maxHp: vit.maxHp, ko: vit.ko },
        fighter: this.veilCombatant(viewerId).label,
      };
      if (run) {
        const enc = run.encounter && now <= run.encounter.until ? run.encounter : null;
        let encounter = null;
        if (enc) {
          const them = this.veilCombatant(enc.userId);
          encounter = { username: them.username, label: them.label, hp: Math.floor(them.hp), maxHp: them.maxHp, outlook: this.pvpOutlook(this.veilCombatant(viewerId), them), until: enc.until };
        }
        out.run = {
          zone: run.zone,
          room: run.room,
          rooms: run.rooms.map((r, i) => ({ waystone: r.waystone, searches: r.searches, seen: i <= run.room })),
          noise: run.noise,
          endsAt: run.endsAt,
          bag: Object.entries(run.bag).map(([id, qty]) => ({ id, qty, name: ITEMS[id].name, icon: ITEMS[id].icon, value: ITEMS[id].value })),
          bagValue: bagValue(run.bag),
          supplies: Object.entries(run.supplies).map(([id, qty]) => ({ id, qty, name: ITEMS[id].name, icon: ITEMS[id].icon })),
          kills: run.kills || 0,
          encounter,
        };
      }
    }
    return out;
  },
};
