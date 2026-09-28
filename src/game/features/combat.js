// GameEngine methods: combat. Mixed into GameEngine.prototype by engine.js.
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
  // ---- Combat (!fight) ----------------------------------------------------

  combatLevel(userId) {
    const xp = this.repo.getSkills(userId);
    return Math.max(1, ...COMBAT_SKILLS.map((id) => skillLevel(id, xp[id])));
  },

  combatStats(userId) {
    const worn = this.repo.getWorn(userId);
    const weapon = worn.weapon && ITEMS[worn.weapon] ? worn.weapon : null;
    const armor = GEAR_SLOTS.filter((sl) => sl !== 'weapon').map((sl) => ITEMS[worn[sl]]);
    const defence = armor.reduce((sum, it) => sum + (it?.defence || 0), 0);
    // Leather armor helps archers.
    const archeryBonus = armor.reduce((sum, it) => sum + (it?.archeryBonus || 0), 0);
    return { worn, weapon, attack: weapon ? ITEMS[weapon].attack : 0, defence, archeryBonus, level: this.combatLevel(userId) };
  },

  // Look at every weapon the player owns (worn or in the backpack), take the combat skill they're
  // best at, and pick their strongest weapon for it that they're allowed to use.
  chooseWeapon(userId, only = null) {
    const xp = this.repo.getSkills(userId);
    const worn = this.repo.getWorn(userId);
    const inv = this.repo.getInventory(userId);
    const owned = [...new Set([worn.weapon, ...Object.keys(inv)])].filter(
      (id) => ITEMS[id]?.weaponType && (!only || WEAPON_SKILL[ITEMS[id].weaponType] === only)
    );
    if (!owned.length) return { weapon: null, reason: 'none' };
    const bySkill = {};
    for (const id of owned) {
      const skillId = WEAPON_SKILL[ITEMS[id].weaponType];
      if (skillId) (bySkill[skillId] ||= []).push(id);
    }
    const skills = Object.keys(bySkill).sort((a, b) => skillLevel(b, xp[b]) - skillLevel(a, xp[a]));
    let noAmmo = null;
    for (const skillId of skills) {
      const skill = SKILLS[skillId];
      const level = skillLevel(skillId, xp[skillId]);
      const usable = bySkill[skillId].filter((id) => ITEMS[id].level <= level).sort((a, b) => ITEMS[b].attack - ITEMS[a].attack);
      if (!usable.length) continue;
      // Bows need a quiver with arrows you can use, staffs need runes (and mana); the best go first.
      let arrow = null;
      if (skill.ammo) {
        const type = skill.weaponType;
        const holder = !skill.ammoHolder || this.quiver(userId).capacity > 0;
        arrow = holder
          ? Object.keys(inv).filter((id) => ITEMS[id]?.ammo === type && inv[id] > 0 && ITEMS[id].level <= level).sort((a, b) => ITEMS[b].attack - ITEMS[a].attack)[0]
          : null;
        if (!arrow) {
          noAmmo ??= { weapon: null, reason: 'ammo', skillId };
          continue;
        }
      }
      if (skill.manaCost && this.vitals(userId).mana < skill.manaCost) {
        noAmmo ??= { weapon: null, reason: 'mana', skillId };
        continue;
      }
      const spell = skillId === 'magic' ? [...SPELLS].reverse().find((sp) => sp.level <= level) : null;
      return { weapon: usable[0], skillId, level, arrow, spell, wasWorn: usable[0] === worn.weapon };
    }
    if (noAmmo) return noAmmo;
    const easiest = owned.sort((a, b) => ITEMS[a].level - ITEMS[b].level)[0];
    return { weapon: null, reason: 'level', item: easiest };
  },

  // Attack and defence for a fight with this weapon pick (bow attack includes the arrows).
  fightStats(userId, pick) {
    const st = this.combatStats(userId);
    // Arrows, spells, and leather armor's archery bonus add to the weapon's attack.
    const attack =
      ITEMS[pick.weapon].attack + (pick.arrow ? ITEMS[pick.arrow].attack : 0) + (pick.spell ? pick.spell.attack : 0) + (pick.skillId === 'archery' ? st.archeryBonus : 0);
    const perk = this.perks(userId);
    return {
      // Banshee Fury: +25% attack. Race perks scale attack and defence.
      attack: Math.round(attack * (this.hasBuff(userId, 'fury') ? 1.25 : 1) * perk.attack),
      defence: Math.round(st.defence * perk.defence),
    };
  },

  // Your quiver: how many arrows it holds and has.
  quiver(userId) {
    const inv = this.repo.getInventory(userId);
    const arrows = Object.entries(inv).reduce((sum, [id, q]) => sum + (ITEMS[id]?.ammo === 'bow' ? q : 0), 0);
    // Your biggest quiver counts.
    const capacity = Math.max(0, ...Object.keys(inv).map((id) => (inv[id] > 0 && ITEMS[id]?.quiverCapacity) || 0));
    return { capacity, arrows };
  },

  // !quiver / !arrows
  quiverInfo(user) {
    const inv = this.repo.getInventory(user.id);
    const q = this.quiver(user.id);
    if (!q.capacity) return `you don't have a 🧺 Quiver. !buy quiver or !fletch quiver (2 Rabbit Hide). It holds ${fmt(ITEMS.quiver.quiverCapacity)} arrows.`;
    const list = Object.keys(inv).filter((id) => ITEMS[id]?.ammo === 'bow' && inv[id] > 0).map((id) => itemLabel(id, inv[id]));
    return `🧺 Quiver ${fmt(q.arrows)}/${fmt(q.capacity)} arrows${list.length ? `: ${list.join(', ')}` : '. Empty! !fletch arrows (1 Oak Logs + 1 Feathers + 1 Iron Ingot makes 10)'}.`;
  },

  noArrowsMessage(user, pick = null) {
    const p = this.cfg.prefix;
    if (pick?.reason === 'mana') return `🔮 you're out of mana for spells! It refills over time, or ${p}drink a mana potion.`;
    if (pick?.skillId === 'magic') {
      const rune = this.shopItems().find((x) => x.item === 'magic_rune');
      return `🔮 you have no Magic Runes! ${p}buy runes 50${rune ? ` (${fmt(rune.cost)} pts each)` : ''} or ${p}craft runes (1 Ashes + 1 Tin Ore makes 10).`;
    }
    if (!this.quiver(user.id).capacity) return `🏹 you need a 🧺 Quiver for arrows! !buy quiver (${fmt(this.shopItems().find((x) => x.item === 'quiver')?.cost ?? 250)} pts) or !fletch quiver (2 Rabbit Hide), then !fletch arrows.`;
    return `🏹 your quiver is empty! !buy arrows 50 or !fletch arrows (1 Oak Logs + 1 🪶 Feathers from chickens + 1 Iron Ingot makes 10).`;
  },

  // What the bot says when someone tries to !cast without a staff.
  howToGetStaff(user) {
    const points = this.repo.getUser(user.id).points;
    const staff = this.shopItems().find((x) => x.item === 'oak_staff');
    const buy = staff ? `🛒 !buy staff (${fmt(staff.cost)} pts, you have ${fmt(points)}) or ` : '';
    return `🔮 you need a staff! ${buy}!fletch oak staff (2 Oak Logs). Plus Magic Runes: !buy runes 50.`;
  },

  // What the bot says when someone tries to !shoot without a bow.
  howToGetBow(user) {
    const points = this.repo.getUser(user.id).points;
    const bow = this.shopItems().find((x) => x.item === 'oak_shortbow');
    const buy = bow ? `🛒 !buy bow (${fmt(bow.cost)} pts, you have ${fmt(points)}) or ` : '';
    return `🏹 you need a bow! ${buy}!fletch oak shortbow (2 Oak Logs). Plus a 🧺 quiver and arrows: !fletch arrows.`;
  },

  fight(user, args, only = null) {
    const now = this.now();
    const vit = this.vitals(user.id, now);
    if (vit.ko) return { consumed: false, reply: this.knockedOutMessage(user.id, vit, now) };
    const pick = this.chooseWeapon(user.id, only);
    if (!pick.weapon) {
      if (pick.reason === 'ammo' || pick.reason === 'mana') return { consumed: false, reply: this.noArrowsMessage(user, pick) };
      if (only === 'archery' && pick.reason === 'none') return { consumed: false, reply: this.howToGetBow(user) };
      if (only === 'magic' && pick.reason === 'none') return { consumed: false, reply: this.howToGetStaff(user) };
      if (pick.reason === 'level') {
        const it = ITEMS[pick.item];
        const sk = SKILLS[WEAPON_SKILL[it.weaponType]];
        return { consumed: false, reply: `your ${it.icon} ${it.name} needs ${sk.name} level ${it.level}. Get a weaker weapon to train up first.` };
      }
      return { consumed: false, reply: this.howToGetSword(user) };
    }
    const bag = this.backpack(user.id);
    if (bag.used >= bag.capacity) {
      return { consumed: false, reply: `🎒 your backpack is full (${bag.used}/${bag.capacity}) — no room for loot! !sell or !upgrade backpack first.` };
    }

    const skill = SKILLS[pick.skillId];
    // Rate fights with the weapon (and arrows) you're about to use.
    const statsFor = this.fightStats(user.id, pick);
    const odds = (m) => this.assessFight(pick.level, statsFor, m, vit.maxHp);
    let monster;
    if (args.length) {
      monster = this.findMonster(skill, args);
      if (!monster) return { consumed: false, reply: `unknown monster. ${this.monsterList(user, pick, vit)}` };
      // Likely to knock you out with the HP you have now? Say so once; typing it again fights anyway.
      const o = odds(monster);
      const warned = this.fightWarned.get(user.id);
      if ((!o.canWin || o.taken >= vit.hp) && !(warned && warned.monster === monster.id && now - warned.at < 120_000)) {
        this.fightWarned.set(user.id, { monster: monster.id, at: now });
        const why = !o.canWin ? `you can't beat it yet (it has ${fmt(monster.hp)} HP, you hit for ~${fmt(Math.round(o.hit))})` : `it would deal ~${fmt(Math.round(o.taken))} damage and you have ${fmt(Math.floor(vit.hp))} HP`;
        return { consumed: false, reply: `${o.rating.icon} a ${monster.icon} ${monster.name} (level ${monster.level}) will probably knock you out: ${why}. Type !${skill.command} ${monster.name.toLowerCase()} again within 2 min to fight anyway.` };
      }
    } else {
      // The best XP you can get safely: the strongest "good match" your current HP can handle.
      monster = this.bestMonster(skill, odds, vit.hp) || skill.monsters[0];
    }
    const rating = odds(monster).rating;
    this.fightWarned.delete(user.id);

    // Wield the chosen weapon if it isn't already in hand.
    let swapped = '';
    if (!pick.wasWorn) {
      const worn = this.repo.getWorn(user.id);
      this.repo.removeItem(user.id, pick.weapon, 1);
      if (worn.weapon) this.repo.addItem(user.id, worn.weapon, 1);
      this.repo.wear(user.id, 'weapon', pick.weapon);
      swapped = ` (equipped your ${ITEMS[pick.weapon].name})`;
    }

    const stats = this.fightStats(user.id, pick);
    const weapon = ITEMS[pick.weapon];
    // Each fight uses one arrow, win or lose.
    let ammoNote = '';
    if (pick.arrow) {
      this.repo.removeItem(user.id, pick.arrow, 1);
      const left = this.repo.getInventory(user.id)[pick.arrow] || 0;
      ammoNote = left <= 10 ? ` ${ITEMS[pick.arrow].icon} ${left ? `${left} ${ITEMS[pick.arrow].name}${left > 1 && !/s$/.test(ITEMS[pick.arrow].name) ? 's' : ''} left` : `that was your last ${ITEMS[pick.arrow].name.replace(/s$/, '')}`}!` : '';
    }
    // Spells also cost mana.
    if (SKILLS[pick.skillId].manaCost) vit.mana = Math.max(0, vit.mana - SKILLS[pick.skillId].manaCost);
    const f = this.simulateFight(pick.level, stats, monster, vit.hp);
    let hpLeft = Math.max(0, vit.hp - f.taken);
    const tag = `${monster.icon} ${monster.name}${monster.level > pick.level ? ` (level ${monster.level})` : ''}`;

    if (f.outcome === 'died' && this.hasBuff(user.id, 'deathless')) {
      // Lich's Elixir: cheat the knockout once, on 1 HP.
      this.removeBuff(user.id, 'deathless');
      this.repo.setVitals(user.id, { hp: 1, mana: vit.mana, koUntil: 0 }, now);
      const gained = this.grantXp(user, pick.skillId, this.xpFor(monster.xp * 0.5 * (f.dealt / monster.hp)));
      return {
        consumed: true,
        reply: `💀 the ${tag} should have knocked you out, but your Lich's Elixir dragged you back on 1 HP!${swapped} ${gained.text} !drink a potion or !heal before your next fight.${ammoNote}`,
      };
    }
    if (f.outcome === 'died') {
      this.repo.setVitals(user.id, { hp: 0, mana: vit.mana, koUntil: now + this.cfg.hpRegenHours * 3_600_000 }, now);
      // A little XP for the damage you did before going down.
      const gained = this.grantXp(user, pick.skillId, this.xpFor(monster.xp * 0.5 * (f.dealt / monster.hp)));
      this.emitActivity(user, { kind: 'death', skill: pick.skillId, text: `was knocked out by a ${monster.name}` });
      const potion = this.shopItems().find((x) => x.item === 'minor_health_potion');
      return {
        consumed: true,
        reply: `💀 the ${tag} knocked you out!${swapped} You hit it for ${fmt(f.dealt)} of its ${fmt(monster.hp)} HP. ${gained.text} Back at full HP in ${this.cfg.hpRegenHours}h, or !drink a health potion${potion ? ` (!buy minor health potion, ${fmt(potion.cost)} pts)` : ''}.${ammoNote}`,
      };
    }
    this.repo.setVitals(user.id, { hp: hpLeft, mana: vit.mana, koUntil: 0 }, now);
    // Read after the XP so a level-up's bigger max HP shows.
    const hpText = () => `❤️ ${fmt(Math.ceil(hpLeft))}/${fmt(this.vitals(user.id, now).maxHp)} HP`;
    if (f.outcome === 'fled') {
      const gained = this.grantXp(user, pick.skillId, this.xpFor(monster.xp * 0.25));
      return { consumed: true, reply: `${monster.icon} you couldn't beat the ${tag} and backed off.${swapped} ${gained.text} | ${hpText()}${ammoNote}` };
    }

    // Vampire Draught: heal after every win.
    let drained = '';
    if (this.hasBuff(user.id, 'vampiric')) {
      const healed = Math.min(vit.maxHp - hpLeft, vit.maxHp * 0.15);
      if (healed >= 0.5) {
        hpLeft += healed;
        this.repo.setVitals(user.id, { hp: hpLeft, mana: vit.mana, koUntil: 0 }, now);
        drained = ` 🧛 +${fmt(Math.round(healed))} HP`;
      }
    }
    let loot;
    let rare = false;
    if (monster.rare && this.rng() < monster.rare.chance * this.luck(user.id)) {
      loot = monster.rare.item;
      rare = true;
    } else {
      loot = monster.loot[this.rng() < 0.6 ? 0 : 1];
    }
    this.repo.addItem(user.id, loot, 1);
    const xpGain = this.xpFor(monster.xp);
    this.emitActivity(user, {
      kind: rare ? 'rare' : 'action',
      skill: pick.skillId,
      item: loot,
      monster: monster.id,
      target: monster.icon,
      xp: xpGain,
      text: `defeated a ${monster.name}${rare ? ` and found a RARE ${ITEMS[loot].name}` : ''}`,
    });
    const gained = this.grantXp(user, pick.skillId, xpGain);
    this.onFightWon(user, monster);
    const low = hpLeft < vit.maxHp * 0.25 ? ' ⚠️ low HP! !eat, !drink a potion or !heal' : '';
    let easy = '';
    if (rating.id === 'easy') {
      const better = this.bestMonster(skill, odds, vit.maxHp);
      easy = better && better.xp > monster.xp
        ? ` ⚪ Too easy for you, try !${skill.command} ${better.name.toLowerCase()} for ${fmt(this.xpFor(better.xp))} XP. !targets shows your best fights.`
        : ' ⚪ Too easy for you. !targets shows your best fights.';
    }
    return {
      consumed: true,
      reply: `${pick.spell ? `${pick.spell.icon} your ${pick.spell.name}` : weapon.icon} ${pick.spell ? 'defeated' : 'you defeated'} a ${tag}${swapped} and looted ${rare ? 'a RARE ' : ''}${itemLabel(loot)}! ${gained.text} | ${hpText()}${f.taken >= 0.5 ? ` (-${fmt(Math.round(f.taken))})` : ''}${drained}${low}${easy}${ammoNote}${this.fullBagNote(user.id)}`,
    };
  },

  // Trade blows until someone drops. Each round you hit for 50-100% of your attack (level + weapon);
  // the monster hits for 50-100% of its attack, more if your armor is weaker than its level calls
  // for (less if stronger) and more the further it outlevels you. After 100 rounds you back off.
  simulateFight(level, stats, monster, hp) {
    const offence = level + stats.attack;
    const armor = clamp((monster.damage + 1) / (stats.defence + 1), 0.35, 2);
    // Monsters above your level hit harder the further above they are (2x your level: twice as hard).
    const outlevel = clamp(monster.level / Math.max(1, level), 0.5, 10);
    let monsterHp = monster.hp;
    let dealt = 0;
    let taken = 0;
    for (let round = 0; round < 100; round++) {
      const hit = Math.max(1, Math.round(offence * (0.5 + 0.5 * this.rng())));
      dealt += Math.min(hit, monsterHp);
      monsterHp -= hit;
      if (monsterHp <= 0) return { outcome: 'won', dealt, taken };
      taken += monster.attack * armor * outlevel * (0.5 + 0.5 * this.rng());
      if (taken >= hp) return { outcome: 'died', dealt, taken: hp };
    }
    return { outcome: 'fled', dealt, taken };
  },

  // What a fight would look like on average, from the same numbers simulateFight uses:
  // rounds to win, expected damage taken, and a difficulty rating.
  assessFight(level, stats, monster, maxHp) {
    const offence = level + stats.attack;
    const armor = clamp((monster.damage + 1) / (stats.defence + 1), 0.35, 2);
    const outlevel = clamp(monster.level / Math.max(1, level), 0.5, 10);
    const hit = Math.max(1, offence * 0.75);
    const rounds = Math.ceil(monster.hp / hit);
    const canWin = rounds <= 100;
    const perRound = monster.attack * armor * outlevel * 0.75;
    const taken = perRound * (Math.min(rounds, 100) - 1);
    const cost = taken / maxHp;
    const rating = !canWin || cost >= 0.9 ? RATINGS.deadly : cost >= 0.45 ? RATINGS.hard : cost >= 0.15 ? RATINGS.tough : monster.level >= level * 0.5 || cost >= 0.02 ? RATINGS.fair : RATINGS.easy;
    return { hit, rounds, canWin, taken, cost, rating };
  },

  findMonster(skill, args) {
    const q = args.join(' ').toLowerCase().replace(/^an? /, '');
    return skill.monsters.find((m) => m.id === q.replace(/\s+/g, '_') || m.name.toLowerCase() === q) || skill.monsters.find((m) => m.name.toLowerCase().startsWith(q));
  },

  // The highest-XP monster that's a good match (not tough) and that `hp` can survive.
  bestMonster(skill, odds, hp) {
    const ok = skill.monsters.filter((m) => {
      const o = odds(m);
      return o.canWin && o.cost < 0.15 && o.taken < hp * 0.8;
    });
    return ok.sort((a, b) => b.xp - a.xp)[0] || null;
  },

  // "Monsters for you: ⚪ Goblin 10 · 🟢 Wolf 20 · 🟠 Bandit 30 · ☠️ Skeleton 40"
  monsterList(user, pick, vit) {
    const skill = SKILLS[pick.skillId];
    const stats = this.fightStats(user.id, pick);
    const rated = skill.monsters.map((m) => ({ m, r: this.assessFight(pick.level, stats, m, vit.maxHp).rating }));
    const i = Math.max(0, rated.findIndex((x) => x.r.id !== 'easy' && x.r.id !== 'fair') - 1);
    const shown = rated.slice(Math.max(0, i - 2), i + 4);
    return `Monsters for you: ${shown.map((x) => `${x.r.icon} ${x.m.name} ${x.m.level}`).join(' · ')} (⚪ too easy 🟢 good 🟠 tough 🔴 hard ☠️ deadly). !scout <monster> for details.`;
  },

  // !monsters
  monstersInfo(user) {
    const vit = this.vitals(user.id);
    const pick = this.chooseWeapon(user.id);
    if (!pick.weapon) return ['ammo', 'mana'].includes(pick.reason) ? this.noArrowsMessage(user, pick) : this.howToGetSword(user);
    return this.monsterList(user, pick, vit);
  },

  // !targets [bow|sword]: the monsters that suit you best right now, from your level, weapon (and
  // arrows), armor and HP. Good matches first, by XP, plus one stretch goal.
  targets(user, args) {
    const only = Object.keys(weaponWords).find((id) => weaponWords[id].test(String(args[0] || '').toLowerCase())) || null;
    const now = this.now();
    const vit = this.vitals(user.id, now);
    if (vit.ko) return this.knockedOutMessage(user.id, vit, now);
    const pick = this.chooseWeapon(user.id, only);
    if (!pick.weapon) {
      if (['ammo', 'mana'].includes(pick.reason)) return this.noArrowsMessage(user, pick);
      return only === 'archery' ? this.howToGetBow(user) : only === 'magic' ? this.howToGetStaff(user) : this.howToGetSword(user);
    }
    const skill = SKILLS[pick.skillId];
    const stats = this.fightStats(user.id, pick);
    const rated = skill.monsters.map((m) => ({ m, o: this.assessFight(pick.level, stats, m, vit.maxHp) }));
    let best = rated.filter((x) => x.o.canWin && x.o.rating.id === 'fair');
    if (!best.length) best = rated.filter((x) => x.o.rating.id === 'easy');
    best = best.sort((a, b) => b.m.xp - a.m.xp).slice(0, 4);
    const stretch = rated.find((x) => x.o.rating.id === 'tough');
    const show = (x) => `${x.o.rating.icon} ${x.m.icon} ${x.m.name} ${x.m.level} (${fmt(this.xpFor(x.m.xp))} XP, ~${Math.max(1, Math.round(x.o.cost * 100))}% HP)`;
    const gear = `${skill.name} ${pick.level}, ${ITEMS[pick.weapon].name}${pick.arrow ? ` + ${ITEMS[pick.arrow].name}` : ''}, +${stats.defence} def`;
    const safe = best.find((x) => x.o.taken < vit.hp * 0.8);
    // Low HP holding you back from your best fight? Say so.
    const hpNote = safe === best[0] ? '' : ` ⚠️ You're at ${fmt(Math.floor(vit.hp))}/${fmt(vit.maxHp)} HP: !drink a potion or !heal ${safe ? 'for the tougher ones' : 'first'}.`;
    const go = safe || best[0];
    return `🎯 Best fights for you (${gear}): ${best.map(show).join(' · ')}${stretch ? ` | Stretch: ${show(stretch)}` : ''}.${hpNote} Try !${skill.command} ${go.m.name.toLowerCase()}`;
  },

  // !scout <monster>: how a fight would go, without fighting.
  scout(user, args) {
    const vit = this.vitals(user.id);
    const pick = this.chooseWeapon(user.id);
    if (!pick.weapon) return ['ammo', 'mana'].includes(pick.reason) ? this.noArrowsMessage(user, pick) : this.howToGetSword(user);
    const skill = SKILLS[pick.skillId];
    if (!args.length) return this.monsterList(user, pick, vit);
    const m = this.findMonster(skill, args);
    if (!m) return `unknown monster. ${this.monsterList(user, pick, vit)}`;
    const stats = this.fightStats(user.id, pick);
    const o = this.assessFight(pick.level, stats, m, vit.maxHp);
    const verdict = !o.canWin
      ? `you can't beat it yet, you'd need ~${o.rounds} rounds`
      : `~${o.rounds} round${o.rounds === 1 ? '' : 's'}, you'd lose ~${fmt(Math.round(o.taken))} HP (${Math.round(o.cost * 100)}% of max)${o.taken >= vit.hp && !vit.ko ? ` ⚠️ more than your ${fmt(Math.floor(vit.hp))} HP now` : ''}`;
    const tip = o.rating.id === 'easy' ? ' Barely worth it.' : o.rating.id === 'deadly' || o.rating.id === 'hard' ? ' Better weapon/armor or more levels help.' : '';
    return `${o.rating.icon} ${o.rating.label}: ${m.icon} ${m.name} (level ${m.level}, ${fmt(m.hp)} HP) vs you (${skill.name} ${pick.level}, ${ITEMS[pick.weapon].name}, +${stats.defence} def): ${verdict}. ${fmt(this.xpFor(m.xp))} XP.${tip}`;
  },

  // What the bot says when someone tries to !fight without a weapon: the two ways to get a sword,
  // with their progress. Kept short so it doesn't flood chat.
  howToGetSword(user) {
    const points = this.repo.getUser(user.id).points;
    const inv = this.repo.getInventory(user.id);
    const sword = this.shopItems().find((x) => x.weaponType);
    const [alloy, need] = Object.entries(SKILLS.smithing.recipes.find((r) => r.item === 'bronze_sword').inputs)[0];
    const have = Math.min(inv[alloy] || 0, need);
    const buy = sword ? `🛒 !buy sword (${fmt(sword.cost)} pts, you have ${fmt(points)})` : '';
    const hammer = inv.smithing_hammer ? 'hammer ✅' : '!buy hammer';
    const craft = `⚒️ ${hammer} → !smelt bronze (${have}/${need}) → !smith bronze sword`;
    return `⚔️ you need a sword! ${buy}${buy ? ' or ' : ''}${craft}. Then !equip bronze sword.`;
  },

  // !equip <item>: wear gear from the backpack (whatever was in that slot goes back in the backpack).
  equip(user, args) {
    if (!args.length) return 'usage: !equip <item>, e.g. !equip bronze sword. !equipped shows what you wear.';
    const inv = this.repo.getInventory(user.id);
    const id = findItem(args.join(' '), Object.keys(inv).filter((i) => ITEMS[i]?.gear));
    if (!id) return `you don't have "${args.join(' ')}" in your backpack. Smith gear with !smith or buy it with !buy.`;
    const item = ITEMS[id];
    if (item.weaponType) {
      const sk = WEAPON_SKILL[item.weaponType];
      const lvl = skillLevel(sk, this.repo.getSkills(user.id)[sk]);
      if (lvl < item.level) return `you need ${SKILLS[sk].icon} ${SKILLS[sk].name} level ${item.level} to wield a ${item.name} (you are ${lvl}).`;
    } else {
      const lvl = this.combatLevel(user.id);
      if (lvl < item.level) return `you need Combat level ${item.level} to wear ${item.name} (you are ${lvl}).`;
    }
    this.repo.transaction(() => {
      const worn = this.repo.getWorn(user.id);
      this.repo.removeItem(user.id, id, 1);
      if (worn[item.slot]) this.repo.addItem(user.id, worn[item.slot], 1);
      this.repo.wear(user.id, item.slot, id);
    });
    const st = this.combatStats(user.id);
    const bonus = item.attack ? `+${item.attack} attack` : `+${item.defence} defence`;
    return `equipped ${itemLabel(id)} (${bonus}). ⚔️ Attack +${st.attack} · 🛡️ Defence +${st.defence}`;
  },

  // !unequip <slot or item>: put it back in the backpack.
  unequip(user, args) {
    const worn = this.repo.getWorn(user.id);
    const q = args.join(' ').toLowerCase();
    let slot = SLOT_ALIASES[q];
    if (!slot) slot = Object.keys(worn).find((sl) => findItem(q, [worn[sl]]));
    if (!q || !slot) return 'usage: !unequip <weapon|helmet|body|legs|shield>';
    if (!worn[slot]) return `you aren't wearing anything there.`;
    const bag = this.backpack(user.id);
    if (bag.used >= bag.capacity) return `🎒 no room in your backpack (${bag.used}/${bag.capacity}).`;
    this.repo.transaction(() => {
      this.repo.takeOff(user.id, slot);
      this.repo.addItem(user.id, worn[slot], 1);
    });
    return `took off your ${itemLabel(worn[slot])} and put it in your backpack.`;
  },

  // !equipped: what you're wearing and your combat stats.
  equippedInfo(user) {
    const st = this.combatStats(user.id);
    const parts = GEAR_SLOTS.map((sl) => (st.worn[sl] ? itemLabel(st.worn[sl]) : `${SLOT_ICONS[sl]} —`));
    return `${parts.join(' | ')} | ⚔️ Attack +${st.attack} · 🛡️ Defence +${st.defence} · Combat level ${st.level} | ${this.vitalsLine(this.vitals(user.id))}`;
  },
};
