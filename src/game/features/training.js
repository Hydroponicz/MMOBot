// GameEngine methods: the Train page. Every skill can be trained with a button on the website as
// well as in chat. Each button runs exactly what the chat command runs (runAction, plant/harvest),
// so stamina, levels, tools, backpack space and HP all work the same. Mixed into
// GameEngine.prototype by engine.js.
const { ITEMS, SKILLS, SKILL_IDS, COMMAND_TO_SKILL, CROPS, progress, maxLevel, skillLevel } = require('./shared');
const { RACES } = require('../appearance');

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
      return upTo(skill.monsters).map((m) => {
        const r = stats ? this.assessFight(pick.level, stats, m, vit.maxHp).rating : null;
        return { ...opt(m.name, `${m.icon} ${m.name}`, m.level), rating: r ? { id: r.id, icon: r.icon, label: r.label } : null };
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
    };
  },

  // The Train button: the same as typing the skill's command with the target in chat.
  // target: a name from trainTargets (or '' for the best), or for farming 'harvest'.
  trainAction(user, skillId, target = '') {
    const skill = SKILLS[skillId];
    if (!skill) return { error: 'no such skill' };
    if ((this.cfg.disabledCommands || []).includes(skill.command)) return { error: `${skill.icon} ${skill.name} is switched off right now.` };
    const t = String(target || '').slice(0, 80).trim();
    const args = t ? t.split(/\s+/) : [];
    let reply;
    if (skill.type === 'farm') {
      reply = t === 'harvest' ? this.harvest(user) : this.plant(user, args);
    } else if (skill.type === 'combat') {
      reply = this.runAction(user, skillId, args, { only: true });
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
