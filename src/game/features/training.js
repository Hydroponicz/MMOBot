// GameEngine methods: the Train page. Every skill can be trained with a button on the website as
// well as in chat. Each button runs exactly what the chat command runs (runAction, plant/harvest),
// so stamina, levels, tools, backpack space and HP all work the same. Mixed into
// GameEngine.prototype by engine.js.
const { ITEMS, SKILLS, SKILL_IDS, COMMAND_TO_SKILL, CROPS, progress, maxLevel, skillLevel } = require('./shared');
const { RACES } = require('../appearance');
const { INFO_COMMANDS } = require('./shared');

// The chat commands siteCommand may run.
const SITE_COMMANDS = new Set(['title', 'pet', 'enchant', 'prestige', 'give', 'attack', 'catch', 'grab', 'duel', 'accept', 'decline', 'bounty', 'bounties', 'dungeon']);

// The order skills appear on the page, in groups.
const GROUPS = [
  ['gather', '⛏️ Gathering', ['fishing', 'mining', 'woodcutting', 'digging', 'skinning', 'farming']],
  ['process', '⚒️ Crafting & processing', ['firemaking', 'cooking', 'smelting', 'smithing', 'fletching', 'carpentry', 'construction', 'crafting', 'alchemy']],
  ['combat', '⚔️ Combat', ['swords', 'archery', 'magic', 'axes', 'daggers', 'spears', 'brawling', 'necromancy']],
  ['other', '🏃 Other', ['agility']],
];

module.exports = {
  // What each skill can be trained on right now: { id, label, level, locked, ready }. ready = you have
  // what it takes (the inputs, the logs, the seeds); locked = your level is too low (only the next
  // unlock is listed, so the lists stay short).
  trainTargets(userId, skillId) {
    const skill = SKILLS[skillId];
    const level = skillLevel(skillId, this.repo.getSkills(userId)[skillId]);
    const inv = this.repo.getInventory(userId);
    const upTo = (list) => {
      const next = list.find((x) => x.level > level);
      return list.filter((x) => x.level <= level || x === next);
    };
    const opt = (id, label, lvl, ready = true) => ({ id, label, level: lvl, locked: lvl > level, ready: lvl <= level && ready });
    if (skill.type === 'combat') {
      const pick = this.chooseWeapon(userId, skillId);
      const vit = this.vitals(userId);
      const stats = pick.weapon ? this.fightStats(userId, pick) : null;
      // Any monster can be fought (like in chat); the rating says how it would go.
      return skill.monsters.map((m) => {
        const r = stats ? this.assessFight(pick.level, stats, m, vit.maxHp).rating : null;
        return { ...opt(m.name, `${m.icon} ${m.name} · ${m.level}`, m.level), locked: false, ready: true, rating: r ? { id: r.id, icon: r.icon, label: r.label } : null };
      });
    }
    if (skill.type === 'farm') {
      return CROPS.filter((c) => c.level <= level && inv[c.seed]).map((c) => ({ ...opt(ITEMS[c.item].name, `${ITEMS[c.item].icon} ${ITEMS[c.item].name} (${inv[c.seed]} seeds)`, c.level), have: inv[c.seed] }));
    }
    if (skill.type === 'burn') return upTo(skill.resources).map((r) => ({ ...opt(ITEMS[r.item].name, `${ITEMS[r.item].icon} ${ITEMS[r.item].name}`, r.level, !!inv[r.item]), have: inv[r.item] || 0 }));
    if (skill.type === 'course') return upTo(skill.resources).map((r) => opt(r.name, `${r.icon} ${r.name}`, r.level));
    if (skill.type === 'gather') return upTo(skill.resources).map((r) => opt(ITEMS[r.item].name, `${ITEMS[r.item].icon} ${ITEMS[r.item].name}`, r.level));
    // Process skills: one entry per item (some items have several recipes, e.g. runes), race-only
    // recipes only for that race.
    const race = this.appearance(userId)?.race;
    const hasInputs = (r) => Object.entries(r.inputs).every(([i, q]) => (inv[i] || 0) >= q);
    const byItem = new Map();
    for (const r of skill.recipes) {
      if (r.race && r.race !== race) continue;
      const cur = byItem.get(r.item);
      if (!cur) byItem.set(r.item, { level: r.level, ready: r.level <= level && hasInputs(r), r });
      else if (r.level <= level && hasInputs(r)) cur.ready = true;
    }
    const list = [...byItem.entries()].map(([item, x]) => ({
      ...opt(ITEMS[item].name, `${ITEMS[item].icon} ${ITEMS[item].name}${x.r.yield ? ` ×${x.r.yield}` : ''}`, x.level, x.ready),
      needs: Object.entries(x.r.inputs).map(([i, q]) => `${q} ${ITEMS[i].name}`).join(' + '),
      race: x.r.race ? RACES[x.r.race]?.name : null,
    }));
    return upTo(list);
  },

  // Everything the Train page shows.
  trainingPage(userId) {
    const xp = this.repo.getSkills(userId);
    const inv = this.repo.getInventory(userId);
    const disabled = this.cfg.disabledCommands || [];
    const vit = this.vitals(userId);
    const fire = this.fireLeft(userId);
    const skills = SKILL_IDS.map((id) => {
      const s = SKILLS[id];
      const p = progress(xp[id], maxLevel(id));
      const tool = s.requires;
      return {
        id,
        name: s.name,
        icon: s.icon,
        type: s.type,
        command: `${this.cfg.prefix}${s.command}`,
        level: p.level,
        percent: p.percent,
        xp: p.xp,
        nextLevelXp: p.nextLevelXp,
        off: disabled.includes(s.command),
        needs: tool && !inv[tool] ? { item: tool, name: ITEMS[tool].name, icon: ITEMS[tool].icon } : null,
        // Bare "train" picks the best target (smithing-style skills just list what you can make).
        pickBest: s.type !== 'process' || s.pickBest !== false,
        targets: this.trainTargets(userId, id),
        tool: s.tool ? this.trainTool(userId, id) : null,
      };
    });
    const bySkill = Object.fromEntries(skills.map((s) => [s.id, s]));
    return {
      groups: GROUPS.map(([id, name, ids]) => ({ id, name, skills: ids.filter((x) => bySkill[x]).map((x) => bySkill[x]) })),
      stamina: this.stamina(userId),
      backpack: this.backpack(userId),
      hp: { hp: Math.floor(vit.hp), max: vit.maxHp, ko: vit.ko ? vit.koUntil : null, mana: Math.floor(vit.mana), maxMana: vit.maxMana },
      fire: fire ? { msLeft: fire, meals: this.fireMealsLeft(userId) } : null,
      farm: { plots: this.plotCount(userId), ready: this.farmPlots(userId).filter((p) => p.ready).length, empty: this.farmPlots(userId).filter((p) => !p.crop).length },
      inVeil: this.inVeil(userId),
      bag: this.trainBag(userId),
      points: this.repo.getUser(userId).points,
      bagUpgrade: (() => {
        const b = this.backpack(userId);
        return { name: b.name, icon: b.icon, next: b.next ? { name: b.next.name, icon: b.next.icon, capacity: b.next.capacity, cost: b.next.cost } : null, off: disabled.includes('upgrade') };
      })(),
      recover: this.trainRecover(userId),
      daily: (this.cfg.disabledCommands || []).includes('daily') ? null : { next: this.dailyNextReward(userId) },
      museumReady: (this.cfg.disabledCommands || []).includes('museum') ? [] : this.museumReady(userId),
    };
  },

  // A skill's upgradable tool (rod, pickaxe, axe, shovel, furnace): the one you have and the next.
  trainTool(userId, skillId) {
    const tiers = this.toolTiers(skillId);
    const tier = this.toolTier(userId, skillId);
    const cur = tiers[tier];
    const next = tiers[tier + 1];
    const level = skillLevel(skillId, this.repo.getSkills(userId)[skillId]);
    return {
      name: cur.name,
      icon: cur.icon,
      kind: SKILLS[skillId].tool.name.toLowerCase(),
      next: next ? { name: next.name, icon: next.icon, level: next.level, cost: next.cost, ready: level >= next.level } : null,
    };
  },

  // Heal, potions and food: what the "recover" buttons can do right now.
  trainRecover(userId) {
    const vit = this.vitals(userId);
    const inv = this.repo.getInventory(userId);
    const count = (f) => Object.entries(inv).reduce((t, [id, q]) => t + (ITEMS[id] && f(ITEMS[id]) ? q : 0), 0);
    const off = this.cfg.disabledCommands || [];
    return {
      hurt: vit.ko || vit.hp < vit.maxHp - 0.5,
      lowMana: vit.mana < vit.maxMana - 0.5,
      heal: off.includes('heal') ? null : { cost: this.healCost(vit), percent: Math.round(this.healPercent(userId) * 100), ready: !vit.ko && vit.mana >= this.healCost(vit) },
      potions: off.includes('drink') ? null : count((it) => it.potion && (it.potion.hp || it.potion.mana) && !it.potion.buff && !it.potion.stamina),
      revive: count((it) => it.potion?.hp),
      food: off.includes('eat') ? null : count((it) => it.food),
    };
  },

  // Upgrade buttons: 'backpack' or a skill id (its tool). Same as !upgrade.
  trainUpgrade(user, what) {
    if ((this.cfg.disabledCommands || []).includes('upgrade')) return { error: 'Upgrades are switched off right now.' };
    if (what === 'backpack') return { message: this.upgradeBackpack(user) };
    if (!SKILLS[what]?.tool) return { error: 'nothing to upgrade there.' };
    return { message: this.upgradeTool(user, what) };
  },

  // Recover buttons: 'heal' (!heal), 'drink' (!drink: the potion you need most), 'eat' (!eat: the
  // food that fills you up best).
  trainRecoverAction(user, how) {
    const off = this.cfg.disabledCommands || [];
    const fn = { heal: () => this.healSpell(user), drink: () => this.drink(user, []), eat: () => this.eat(user, []) }[how];
    if (!fn) return { error: 'unknown action' };
    if (off.includes(how)) return { error: `!${how} is switched off right now.` };
    return { message: fn() };
  },

  // The backpack, for selling from the Train page. kind: what !sell all does with it ('loot' is
  // sold; gear, potions, food and crops are kept and sold by name or with their own button).
  trainBag(userId) {
    const inv = this.repo.getInventory(userId);
    const kindOf = (it) => (it.potion ? 'potion' : it.ammo ? 'ammo' : it.seedFor ? 'seed' : it.keep ? 'gear' : it.food ? 'food' : it.plantLine ? 'crop' : 'loot');
    const items = Object.entries(inv)
      .filter(([id, q]) => ITEMS[id] && q > 0 && !ITEMS[id].cosmetic && !ITEMS[id].pet && !ITEMS[id].virtual)
      .map(([id, qty]) => {
        const it = ITEMS[id];
        const sellable = !it.bound && it.value > 0;
        return {
          id,
          name: it.name,
          icon: it.icon,
          qty,
          kind: kindOf(it),
          // Seeds, arrows, runes and bone shards don't take backpack slots.
          bagless: !!(it.seedFor || it.ammo),
          opens: !!it.opens,
          sellable,
          each: sellable ? this.sellValue(id, userId) : 0,
          total: sellable ? this.saleTotal(id, qty, userId) : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
    const sum = (kind) => items.filter((x) => x.sellable && x.kind === kind).reduce((t, x) => t + x.total, 0);
    return { items, worth: { loot: sum('loot'), food: sum('food'), crop: sum('crop') }, off: (this.cfg.disabledCommands || []).includes('sell') };
  },

  // Chat commands the website runs as they are (titles, pets, enchanting, prestige, gifts, raids and
  // chat events, duels, item bounties, dungeons): the same code and the same on/off switches as chat.
  siteCommand(user, word, args = []) {
    const w = String(word || '').toLowerCase();
    if (!SITE_COMMANDS.has(w)) return { error: 'unknown action' };
    const [handler, name] = INFO_COMMANDS[w];
    if ((this.cfg.disabledCommands || []).includes(name)) return { error: `!${w} is switched off right now.` };
    const clean = (Array.isArray(args) ? args : [args]).slice(0, 6).map((a) => String(a ?? '').slice(0, 60)).filter((a) => a.trim());
    const challenger = (w === 'accept' || w === 'decline') && this.duels?.get(user.id);
    const reply = this[handler](user, clean, w);
    // In chat everyone sees the reply. From the site only the clicker does, so tell the other player.
    if (reply && w === 'duel' && reply.startsWith('⚔️')) this.announce(reply);
    if (reply && challenger) {
      if (w === 'accept') this.announce(reply);
      else this.notify(challenger.from, `${user.username} declined your duel.`);
    }
    if (reply && w === 'give' && reply.startsWith('🤝')) {
      const target = this.repo.getUserByName(String(clean[0]).replace(/^@/, ''));
      if (target) this.notify(target.id, `🤝 ${user.username} ${reply.replace(/^🤝 you /, '').replace(/ to @\S+?\.$/, '')} to you.`);
    }
    if (reply) return { message: reply };
    if (w === 'catch' || w === 'grab') return { message: 'nothing to catch right now (or you already got this one).' };
    if (w === 'decline') return { message: 'no duel waiting for you.' };
    if (w === 'dungeon') return { message: this.dungeon?.members.includes(user.id) ? "🏰 you started a dungeon party! It sets off in 60s; others join with !dungeon or the Join button." : '🏰 the party set off! Results are in chat and the live feed.' };
    return { message: 'Done.' };
  },

  // Open buttons: one container, all of one kind, or everything (same as !open / !open all).
  trainOpen(user, { item = '', all = false } = {}) {
    if ((this.cfg.disabledCommands || []).includes('open')) return { error: 'Opening is switched off right now.' };
    const args = [...(all ? ['all'] : []), ...(item ? [String(item)] : [])];
    return { message: this.openContainer(user, args) };
  },

  // A sell button: { group: 'all' | 'food' | 'crops' } or { item, qty: n | 'all' }. Same as !sell.
  // Or several at once: { items: [{ item, qty: n | 'all' }, ...] } (the website's "Sell selected").
  trainSell(user, { item = '', qty = 1, group = '', items = null } = {}) {
    if ((this.cfg.disabledCommands || []).includes('sell')) return { error: 'Selling is switched off right now.' };
    if (Array.isArray(items)) {
      const inv = this.repo.getInventory(user.id);
      const want = new Map();
      for (const x of items.slice(0, 200)) {
        const id = String(x?.item || '');
        const it = ITEMS[id];
        if (!it || !inv[id] || it.bound || it.pet || it.cosmetic || it.virtual || !(it.value > 0)) continue;
        const n = x.qty === 'all' ? inv[id] : Math.max(1, Math.floor(Number(x.qty)) || 1);
        want.set(id, Math.min(inv[id], (want.get(id) || 0) + n));
      }
      if (!want.size) return { error: 'nothing selected to sell.' };
      return { message: this.sellEntries(user, [...want.entries()]) };
    }
    if (group) {
      const args = { all: ['all'], food: ['all', 'food'], crops: ['all', 'crops'] }[group];
      if (!args) return { error: 'unknown group' };
      return { message: this.sell(user, args) };
    }
    const id = String(item);
    if (!ITEMS[id]) return { error: 'no such item' };
    const n = qty === 'all' ? 'all' : String(Math.max(1, Math.floor(Number(qty)) || 1));
    return { message: this.sell(user, [id, n]) };
  },

  // The Train button: the same as typing the skill's command with the target in chat.
  // target: a name from trainTargets (or '' for the best), or for farming 'harvest'.
  trainAction(user, skillId, target = '') {
    const skill = SKILLS[skillId];
    if (!skill) return { error: 'no such skill' };
    if ((this.cfg.disabledCommands || []).includes(skill.command)) return { error: `${skill.icon} ${skill.name} is switched off right now.` };
    // Out of stamina: say so here, without going through staminaCheck (that would use up the one
    // warning chat gets, and the player's next chat command would get no reply).
    if (skillId !== 'cooking') {
      const st = this.stamina(user.id);
      if (st.charges <= 0) return { message: `you're catching your breath 😮‍💨 out of stamina (0/${st.max}), next charge in ${this.waitText((st.nextAt || st.refillAt) - this.now())}.` };
    }
    let t = String(target || '').slice(0, 80).trim();
    // Gathering: a bare chat command picks among your best three resources for variety; on the
    // website "Best I can do" means the best one, and "*mix" asks for the chat behaviour.
    if (skill.type === 'gather') {
      if (t === '*mix') t = '';
      else if (!t) {
        const level = skillLevel(skillId, this.repo.getSkills(user.id)[skillId]);
        const best = skill.resources.filter((r) => r.level <= level).sort((a, b) => b.level - a.level || b.xp - a.xp)[0];
        if (best) t = ITEMS[best.item].name;
      }
    }
    const args = t ? t.split(/\s+/) : [];
    let reply;
    if (skill.type === 'farm') {
      reply = t === 'harvest' ? this.harvest(user) : this.plant(user, args);
    } else if (skill.type === 'combat') {
      reply = this.runAction(user, skillId, args, { only: true });
      // The "will probably knock you out" warning: on the website you confirm by clicking again.
      if (reply) reply = reply.replace(/Type !\S+ .+? again within 2 min to fight anyway\./, 'Click Fight again within 2 min to fight anyway.');
    } else if (skill.type === 'process' && t) {
      // Nails are made with !craft, not !saw: use the command the recipe says.
      const recipe = skill.recipes.find((r) => ITEMS[r.item].name.toLowerCase() === t.toLowerCase());
      reply = recipe?.command ? this.runAction(user, COMMAND_TO_SKILL[recipe.command], args) : this.runAction(user, skillId, args);
    } else if (skillId === 'cooking' && t === 'all') {
      reply = this.runAction(user, 'cooking', ['all']);
    } else {
      reply = this.runAction(user, skillId, args);
    }
    if (!reply) {
      // Chat only warns once per refill (so spam doesn't flood it); the website always says why.
      const st = this.stamina(user.id);
      if (st.charges <= 0) reply = `you're catching your breath 😮‍💨 out of stamina (0/${st.max}), next charge in ${this.waitText((st.nextAt || st.refillAt) - this.now())}.`;
    }
    return { message: reply || 'Slow down a little!' };
  },
};
