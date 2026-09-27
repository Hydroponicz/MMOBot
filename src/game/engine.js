const { EventEmitter } = require('node:events');
const { ITEMS, SKILLS, SKILL_IDS, COMMAND_TO_SKILL, TOOL_TO_SKILL, maxLevel, findItem } = require('./skills');
const { levelForXp, progress, characterProgress } = require('./xp');

const fmt = (n) => Number(n).toLocaleString('en-US');
const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const skillLevel = (skillId, xp) => levelForXp(xp, maxLevel(skillId));
const itemLabel = (id, qty = 1) => `${ITEMS[id].icon} ${qty > 1 ? `${fmt(qty)}x ` : ''}${ITEMS[id].name}`;

// Commands that don't count as "actions" (no cooldown).
const INFO_COMMANDS = {
  stats: 'stats', level: 'stats', lvl: 'stats', skills: 'stats', xp: 'stats',
  inv: 'inventory', inventory: 'inventory', bag: 'inventory',
  points: 'points', pts: 'points', balance: 'points',
  sell: 'sell',
  top: 'top', leaderboard: 'top', lb: 'top',
  upgrade: 'upgrade',
  rod: 'toolInfo',
  commands: 'help', help: 'help', rpg: 'help', mmo: 'help',
};

class GameEngine extends EventEmitter {
  constructor({ repo, config, rng = Math.random, now = () => Date.now() }) {
    super();
    this.repo = repo;
    this.cfg = config.game;
    this.siteUrl = config.baseUrl;
    this.rng = rng;
    this.now = now;
    this.cooldownWarned = new Map(); // userId -> last_action_at we already warned about
  }

  // Entry point for every chat message. Returns { reply } where reply may be null.
  handleChat({ kickUserId, username, avatarUrl = null, content }) {
    if (!kickUserId || !username || typeof content !== 'string') return { reply: null };
    const user = this.repo.upsertUser({ kickUserId, username, avatarUrl });
    this.repo.chatTick(user.id);
    this.awardChatPoints(user);

    const text = content.trim();
    if (!text.startsWith(this.cfg.prefix)) return { reply: null };
    const [rawCmd, ...args] = text.slice(this.cfg.prefix.length).split(/\s+/);
    const cmd = (rawCmd || '').toLowerCase();

    let reply = null;
    if (COMMAND_TO_SKILL[cmd]) {
      reply = this.runAction(user, COMMAND_TO_SKILL[cmd], args);
    } else if (INFO_COMMANDS[cmd]) {
      reply = this[INFO_COMMANDS[cmd]](user, args);
    }
    return { reply: reply ? `@${user.username} ${reply}` : null };
  }

  awardChatPoints(user) {
    const now = this.now();
    if (now - user.last_chat_points_at < this.cfg.chatCooldown * 1000) return;
    this.repo.addPoints(user.id, this.cfg.chatPoints);
    this.repo.setChatPointsAt(user.id, now);
  }

  // ---- Skilling ----------------------------------------------------------

  runAction(user, skillId, args) {
    const now = this.now();
    const fresh = this.repo.getUser(user.id);
    const readyAt = fresh.last_action_at + this.cfg.actionCooldown * 1000;
    if (now < readyAt) {
      // Warn once per cooldown window so spamming doesn't flood chat.
      if (this.cooldownWarned.get(user.id) === fresh.last_action_at) return null;
      this.cooldownWarned.set(user.id, fresh.last_action_at);
      return `you're catching your breath 😮‍💨 try again in ${Math.ceil((readyAt - now) / 1000)}s.`;
    }

    const skill = SKILLS[skillId];
    const result = this.repo.transaction(() => {
      const r = skill.type === 'process' ? this.process(user, skillId, args) : this.gather(user, skillId, args);
      if (r.consumed) this.repo.setActionAt(user.id, now);
      return r;
    });
    return result.reply;
  }

  gather(user, skillId, args) {
    const skill = SKILLS[skillId];
    const xp = this.repo.getSkills(user.id)[skillId];
    const level = skillLevel(skillId, xp);
    const unlocked = skill.resources.filter((r) => r.level <= level);
    const tool = this.currentTool(user.id, skillId);

    let target = null;
    if (args.length) {
      const id = findItem(args.join(' '), skill.resources.map((r) => r.item));
      if (!id) {
        // Everything unlocked plus the next unlock, to keep the message short.
        const shown = skill.resources.filter((r) => r.level <= level || r === skill.resources.find((x) => x.level > level));
        const opts = shown.map((r) => `${ITEMS[r.item].name} (${r.level})`).join(', ');
        return { consumed: false, reply: `unknown target. ${skill.name} options: ${opts}` };
      }
      target = skill.resources.find((r) => r.item === id);
      if (target.level > level) {
        return {
          consumed: false,
          reply: `you need ${skill.icon} ${skill.name} level ${target.level} for ${ITEMS[id].name} (you are ${level}).`,
        };
      }
    }

    // Failure chance: set by your tool if the skill has one, otherwise shrinks as you level.
    const failChance = tool ? tool.snapChance : Math.max(0.03, 0.15 - level * 0.0015);
    if (this.rng() < failChance) {
      const msg = skill.failMessages[Math.floor(this.rng() * skill.failMessages.length)];
      const hint = tool && this.canUpgrade(user.id, skillId, level) ? ` (tip: !upgrade ${skill.tool.id})` : '';
      return { consumed: true, reply: `${skill.icon} ${msg}... better luck next time!${hint}` };
    }

    let drop = null;
    let rare = false;
    for (const r of skill.rares || []) {
      if (this.rng() < r.chance * (tool ? tool.rareBonus : 1)) {
        drop = r;
        rare = true;
        break;
      }
    }
    if (!drop) drop = target || this.pickResource(unlocked);

    return this.reward(user, skillId, drop.item, drop.xp, { rare });
  }

  // Weighted toward your best unlocked tiers: best tier 50%, next 30%, next 20%.
  // Resources sharing a level requirement (copper/tin) share a tier.
  pickResource(unlocked) {
    const levels = [...new Set(unlocked.map((r) => r.level))].sort((a, b) => b - a);
    const tierWeight = [5, 3, 2];
    const weighted = unlocked
      .map((r) => ({ r, w: tierWeight[levels.indexOf(r.level)] || 0 }))
      .filter((x) => x.w > 0);
    const total = weighted.reduce((s, x) => s + x.w, 0);
    let roll = this.rng() * total;
    for (const x of weighted) {
      roll -= x.w;
      if (roll < 0) return x.r;
    }
    return weighted[weighted.length - 1].r;
  }

  process(user, skillId, args) {
    const skill = SKILLS[skillId];
    const level = skillLevel(skillId, this.repo.getSkills(user.id)[skillId]);
    const inv = this.repo.getInventory(user.id);
    const hasInputs = (r) => Object.entries(r.inputs).every(([item, qty]) => (inv[item] || 0) >= qty);
    const describe = (r) =>
      `${ITEMS[r.item].name} needs ${Object.entries(r.inputs).map(([i, q]) => `${q} ${ITEMS[i].name}`).join(' + ')}`;

    let recipe;
    if (args.length) {
      const id = findItem(args.join(' '), skill.recipes.map((r) => r.item));
      if (!id) {
        const opts = skill.recipes.map((r) => `${ITEMS[r.item].name} (${r.level})`).join(', ');
        return { consumed: false, reply: `unknown bar. Options: ${opts}` };
      }
      recipe = skill.recipes.find((r) => r.item === id);
      if (recipe.level > level) {
        return { consumed: false, reply: `you need ${skill.icon} ${skill.name} level ${recipe.level} for ${ITEMS[id].name}.` };
      }
      if (!hasInputs(recipe)) return { consumed: false, reply: `not enough materials: ${describe(recipe)}. Try !mine` };
    } else {
      recipe = [...skill.recipes].reverse().find((r) => r.level <= level && hasInputs(r));
      if (!recipe) {
        return { consumed: false, reply: `you have nothing to smelt! ${describe(skill.recipes[0])}. Use !mine copper / !mine tin` };
      }
    }

    for (const [item, qty] of Object.entries(recipe.inputs)) this.repo.removeItem(user.id, item, qty);
    return this.reward(user, skillId, recipe.item, recipe.xp, { rare: false });
  }

  reward(user, skillId, item, baseXp, { rare }) {
    const skill = SKILLS[skillId];
    const tool = this.currentTool(user.id, skillId);
    const xpGain = Math.round(baseXp * (1 + (tool?.xpBonus || 0)));
    const before = this.repo.getSkills(user.id);
    const levelBefore = skillLevel(skillId, before[skillId]);
    const charBefore = characterProgress(SKILL_IDS.map((id) => before[id])).level;

    const points = Math.max(1, Math.round(xpGain / 10));
    this.repo.addXp(user.id, skillId, xpGain);
    this.repo.addItem(user.id, item, 1);
    this.repo.addPoints(user.id, points);

    const xpAfter = before[skillId] + xpGain;
    const levelAfter = skillLevel(skillId, xpAfter);
    const charAfter = characterProgress(SKILL_IDS.map((id) => before[id] + (id === skillId ? xpGain : 0))).level;

    let reply = `${skill.icon} you ${skill.verb} ${rare ? 'a RARE ' : ''}${itemLabel(item)}! +${xpGain} XP, +${points} pts`;
    const text = `${skill.verb} ${rare ? 'a RARE ' : ''}${ITEMS[item].name}`;
    this.emitActivity(user, { kind: rare ? 'rare' : 'action', skill: skillId, item, xp: xpGain, text });

    if (levelAfter > levelBefore) {
      reply += ` 🎉 ${skill.name} level ${levelAfter}!`;
      const unlocks = (skill.resources || skill.recipes).filter((r) => r.level > levelBefore && r.level <= levelAfter);
      if (unlocks.length) reply += ` Unlocked: ${unlocks.map((r) => ITEMS[r.item].name).join(', ')}.`;
      if (skill.tool && this.canUpgrade(user.id, skillId, levelAfter) && !this.canUpgrade(user.id, skillId, levelBefore)) {
        reply += ` 🔧 You can now !upgrade ${skill.tool.id}!`;
      }
      this.emitActivity(user, { kind: 'levelup', skill: skillId, text: `reached ${skill.name} level ${levelAfter}` });
    } else {
      const p = progress(xpAfter, maxLevel(skillId));
      reply += ` (${skill.name} ${levelAfter}, ${p.percent}%)`;
    }
    if (charAfter > charBefore) {
      reply += ` ⭐ Character level ${charAfter}!`;
      this.emitActivity(user, { kind: 'charlevel', text: `reached character level ${charAfter}` });
    }
    return { consumed: true, reply };
  }

  emitActivity(user, entry) {
    const id = this.repo.logActivity({ userId: user.id, ...entry });
    this.emit('activity', { id, username: user.username, created_at: this.now(), skill: null, item: null, xp: 0, ...entry });
  }

  // ---- Info commands -----------------------------------------------------

  stats(user, args) {
    let target = user;
    if (args[0]) {
      target = this.repo.getUserByName(args[0]);
      if (!target) return `no adventurer named ${args[0].replace(/^@/, '')} yet.`;
    }
    const profile = this.profile(target.id);
    const skills = profile.skills.map((s) => `${s.icon}${s.level}`).join(' ');
    const who = target.id === user.id ? 'you are' : `${target.username} is`;
    return `${who} character level ${profile.character.level} | ${skills} | Total ${profile.totalLevel} | ${fmt(profile.points)} pts | ${this.siteUrl}/#/player/${encodeURIComponent(target.username)}`;
  }

  inventory(user) {
    const inv = Object.entries(this.repo.getInventory(user.id)).filter(([id]) => ITEMS[id]);
    if (!inv.length) return 'your bag is empty. Try !fish !mine !chop !dig';
    const worth = inv.reduce((s, [id, q]) => s + ITEMS[id].value * q, 0);
    inv.sort((a, b) => ITEMS[b[0]].value * b[1] - ITEMS[a[0]].value * a[1]);
    const shown = inv.slice(0, 8).map(([id, q]) => itemLabel(id, q)).join(', ');
    const more = inv.length > 8 ? ` +${inv.length - 8} more` : '';
    return `🎒 ${shown}${more} (worth ${fmt(worth)} pts — !sell all)`;
  }

  points(user) {
    const u = this.repo.getUser(user.id);
    return `you have ${fmt(u.points)} points 💰`;
  }

  // !sell all | !sell <item> [qty|all]
  sell(user, args) {
    const inv = this.repo.getInventory(user.id);
    if (!args.length) return 'usage: !sell <item> [amount] or !sell all';

    let entries;
    if (args[0].toLowerCase() === 'all' && args.length === 1) {
      entries = Object.entries(inv).filter(([id]) => ITEMS[id]);
    } else {
      let qtyArg = args[args.length - 1].toLowerCase();
      let nameArgs = args;
      if (/^\d+$/.test(qtyArg) || qtyArg === 'all') nameArgs = args.slice(0, -1);
      else qtyArg = '1';
      const id = findItem(nameArgs.join(' '), Object.keys(inv));
      if (!id) return `you don't have any "${nameArgs.join(' ')}".`;
      const qty = qtyArg === 'all' ? inv[id] : Math.min(Number(qtyArg), inv[id]);
      if (qty <= 0) return 'nothing to sell.';
      entries = [[id, qty]];
    }
    if (!entries.length) return 'your bag is empty.';

    const total = this.repo.transaction(() => {
      let sum = 0;
      for (const [id, qty] of entries) {
        this.repo.removeItem(user.id, id, qty);
        sum += ITEMS[id].value * qty;
      }
      this.repo.addPoints(user.id, sum);
      return sum;
    });
    const count = entries.reduce((s, [, q]) => s + q, 0);
    const single = entries.length === 1;
    const what = single ? itemLabel(entries[0][0], entries[0][1]) : `${fmt(count)} items`;
    const plain = single ? `${fmt(entries[0][1])}x ${ITEMS[entries[0][0]].name}` : what;
    this.emitActivity(user, { kind: 'sell', text: `sold ${plain} for ${fmt(total)} pts` });
    return `sold ${what} for ${fmt(total)} pts 💰 Balance: ${fmt(this.repo.getUser(user.id).points)}`;
  }

  top(user, args) {
    const q = (args[0] || 'overall').toLowerCase();
    const kind =
      q === 'points' || q === 'pts' ? 'points' : SKILL_IDS.find((s) => s === q || SKILLS[s].command === q) || 'overall';
    const rows = this.repo.leaderboard(kind, 5);
    if (!rows.length) return 'the leaderboard is empty — be the first!';
    const label = kind === 'overall' ? '🏆 Overall' : kind === 'points' ? '💰 Points' : `${SKILLS[kind].icon} ${SKILLS[kind].name}`;
    const list = rows
      .map((r, i) => {
        if (kind === 'points') return `${i + 1}. ${r.username} ${fmt(r.points)}`;
        if (kind === 'overall') return `${i + 1}. ${r.username} (${fmt(r.xp)} xp)`;
        return `${i + 1}. ${r.username} Lv${skillLevel(kind, r.xp)}`;
      })
      .join(' | ');
    return `${label}: ${list}`;
  }

  help() {
    const skills = SKILL_IDS.map((id) => `!${SKILLS[id].command}`).join(' ');
    return `Skills: ${skills} (add a target, e.g. !mine iron) | Gear: !rod !upgrade rod | Info: !stats !inv !sell !points !top | Login & track progress: ${this.siteUrl}`;
  }

  // ---- Tools (!upgrade rod) --------------------------------------------------

  toolTier(userId, skillId) {
    const t = SKILLS[skillId].tool;
    if (!t) return null;
    return Math.min(this.repo.getEquipment(userId)[t.id] || 0, t.tiers.length - 1);
  }

  currentTool(userId, skillId) {
    const tier = this.toolTier(userId, skillId);
    return tier === null ? null : SKILLS[skillId].tool.tiers[tier];
  }

  canUpgrade(userId, skillId, level) {
    const t = SKILLS[skillId].tool;
    const next = t?.tiers[this.toolTier(userId, skillId) + 1];
    return Boolean(next && level >= next.level);
  }

  describeTool(tool) {
    return `${tool.icon} ${tool.name}: ${pct(tool.snapChance)} snap chance, +${Math.round(tool.xpBonus * 100)}% XP, rare finds x${tool.rareBonus}`;
  }

  // !upgrade rod: checks your Fishing level and moves you up one rod tier.
  upgrade(user, args) {
    const toolIds = Object.keys(TOOL_TO_SKILL);
    const which = (args[0] || '').toLowerCase();
    const skillId = TOOL_TO_SKILL[which];
    if (!skillId) {
      const list = toolIds.map((t) => `!upgrade ${t}`).join(', ');
      return which ? `you can't upgrade "${which}" (yet). Try ${list}` : `usage: ${list}`;
    }
    const skill = SKILLS[skillId];
    const t = skill.tool;
    const level = skillLevel(skillId, this.repo.getSkills(user.id)[skillId]);
    const tier = this.toolTier(user.id, skillId);
    const current = t.tiers[tier];
    const next = t.tiers[tier + 1];
    if (!next) return `you already wield the best ${t.name.toLowerCase()} in the land: ${current.icon} ${current.name}! 🏆`;
    if (level < next.level) {
      return `your ${current.icon} ${current.name} can be upgraded to ${next.icon} ${next.name} at ${skill.name} level ${next.level} (you are ${level}).`;
    }

    this.repo.setEquipment(user.id, t.id, tier + 1);
    this.emitActivity(user, { kind: 'upgrade', skill: skillId, text: `upgraded to the ${next.name}` });
    const after = t.tiers[tier + 2];
    const upcoming = after
      ? ` Next: ${after.name} at level ${after.level}.`
      : ` That is the best ${t.name.toLowerCase()} there is! 🏆`;
    return `🔧 upgraded to ${this.describeTool(next)}!${upcoming}`;
  }

  // !rod: show your current rod.
  toolInfo(user) {
    const skillId = TOOL_TO_SKILL.rod;
    const t = SKILLS[skillId].tool;
    const tier = this.toolTier(user.id, skillId);
    const next = t.tiers[tier + 1];
    const level = skillLevel(skillId, this.repo.getSkills(user.id)[skillId]);
    let tail = ` This is the best ${t.name.toLowerCase()} there is! 🏆`;
    if (next) tail = level >= next.level ? ` Ready: type !upgrade ${t.id} for the ${next.name}!` : ` Next: ${next.name} at ${SKILLS[skillId].name} level ${next.level}.`;
    return `${this.describeTool(t.tiers[tier])} (tier ${tier + 1}/${t.tiers.length}).${tail}`;
  }

  // ---- Data for the website ---------------------------------------------

  profile(userId) {
    const user = this.repo.getUser(userId);
    if (!user) return null;
    const xp = this.repo.getSkills(userId);
    const skills = SKILL_IDS.map((id) => {
      const s = SKILLS[id];
      const p = progress(xp[id], maxLevel(id));
      const tiers = s.resources || s.recipes;
      const next = tiers.find((r) => r.level > p.level);
      let tool = null;
      if (s.tool) {
        const tier = this.toolTier(userId, id);
        const nextTool = s.tool.tiers[tier + 1];
        tool = {
          id: s.tool.id,
          tier: tier + 1,
          tiers: s.tool.tiers.length,
          ...s.tool.tiers[tier],
          next: nextTool ? { name: nextTool.name, icon: nextTool.icon, level: nextTool.level } : null,
          canUpgrade: Boolean(nextTool && p.level >= nextTool.level),
        };
      }
      return {
        id,
        name: s.name,
        icon: s.icon,
        command: `${this.cfg.prefix}${s.command}`,
        ...p,
        maxLevel: maxLevel(id),
        tool,
        rank: xp[id] > 0 ? this.repo.rank(userId, id) : null,
        nextUnlock: next ? { level: next.level, item: ITEMS[next.item].name, icon: ITEMS[next.item].icon } : null,
      };
    });
    const totalXp = SKILL_IDS.reduce((s, id) => s + xp[id], 0);
    const inventory = Object.entries(this.repo.getInventory(userId))
      .filter(([id]) => ITEMS[id])
      .map(([id, qty]) => ({ id, qty, ...ITEMS[id], rare: !!ITEMS[id].rare }))
      .sort((a, b) => b.value * b.qty - a.value * a.qty);
    return {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatar_url,
      points: user.points,
      lifetimePoints: user.lifetime_points,
      messages: user.message_count,
      actions: user.actions_count,
      joinedAt: user.created_at,
      lastSeenAt: user.last_seen_at,
      character: characterProgress(SKILL_IDS.map((id) => xp[id])),
      totalXp,
      totalLevel: skills.reduce((s, x) => s + x.level, 0),
      overallRank: totalXp > 0 ? this.repo.rank(userId, 'overall') : null,
      skills,
      inventory,
      inventoryValue: inventory.reduce((s, i) => s + i.value * i.qty, 0),
      cooldownEndsAt: user.last_action_at + this.cfg.actionCooldown * 1000,
    };
  }

  // Static game data for the "How to play" page.
  guide() {
    return {
      prefix: this.cfg.prefix,
      actionCooldown: this.cfg.actionCooldown,
      chatPoints: this.cfg.chatPoints,
      chatCooldown: this.cfg.chatCooldown,
      skills: SKILL_IDS.map((id) => {
        const s = SKILLS[id];
        return {
          id,
          name: s.name,
          icon: s.icon,
          command: `${this.cfg.prefix}${s.command}`,
          type: s.type,
          tiers: (s.resources || s.recipes).map((r) => ({
            level: r.level,
            xp: r.xp,
            item: ITEMS[r.item].name,
            icon: ITEMS[r.item].icon,
            value: ITEMS[r.item].value,
            inputs: r.inputs
              ? Object.entries(r.inputs).map(([i, q]) => ({ qty: q, item: ITEMS[i].name, icon: ITEMS[i].icon }))
              : undefined,
          })),
          maxLevel: maxLevel(id),
          tool: s.tool
            ? {
                id: s.tool.id,
                command: `${this.cfg.prefix}upgrade ${s.tool.id}`,
                tiers: s.tool.tiers.map((t) => ({ ...t })),
              }
            : null,
          rares: (s.rares || []).map((r) => ({
            item: ITEMS[r.item].name,
            icon: ITEMS[r.item].icon,
            value: ITEMS[r.item].value,
            odds: `1 in ${Math.round(1 / r.chance)}`,
            xp: r.xp,
          })),
        };
      }),
    };
  }
}

module.exports = { GameEngine };
