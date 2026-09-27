const { EventEmitter } = require('node:events');
const {
  ITEMS,
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
  findItem,
} = require('./skills');
const { levelForXp, progress, characterProgress } = require('./xp');
const casino = require('./casino');

const fmt = (n) => Number(n).toLocaleString('en-US');
const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const skillLevel = (skillId, xp) => levelForXp(xp, maxLevel(skillId));
const itemLabel = (id, qty = 1) => `${ITEMS[id].icon} ${qty > 1 ? `${fmt(qty)}x ` : ''}${ITEMS[id].name}`;

// Commands that don't count as "actions" (no cooldown), mapped to [handler, name used to enable/disable it].
const INFO_COMMANDS = {
  stats: ['stats', 'stats'], level: ['stats', 'stats'], lvl: ['stats', 'stats'], skills: ['stats', 'stats'], xp: ['stats', 'stats'],
  inv: ['inventory', 'inv'], inventory: ['inventory', 'inv'], bag: ['inventory', 'inv'], backpack: ['inventory', 'inv'],
  points: ['points', 'points'], pts: ['points', 'points'], balance: ['points', 'points'],
  sell: ['sell', 'sell'],
  top: ['top', 'top'], leaderboard: ['top', 'top'], lb: ['top', 'top'],
  upgrade: ['upgrade', 'upgrade'],
  gear: ['gear', 'gear'], tools: ['gear', 'gear'], equipment: ['gear', 'gear'],
  // !rod, !pickaxe, !axe, !shovel, !furnace (and aliases like !pick) show that tool.
  ...Object.fromEntries(Object.entries(TOOL_ALIASES).map(([word, toolId]) => [word, ['toolInfo', toolId]])),
  equip: ['equip', 'equip'], wear: ['equip', 'equip'], wield: ['equip', 'equip'],
  unequip: ['unequip', 'unequip'], remove: ['unequip', 'unequip'],
  equipped: ['equippedInfo', 'equipped'], worn: ['equippedInfo', 'equipped'], armor: ['equippedInfo', 'equipped'], armour: ['equippedInfo', 'equipped'],
  buy: ['buy', 'buy'], shop: ['shopList', 'shop'], store: ['shopList', 'shop'],
  // Farming has its own cooldown, separate from the skilling one.
  plant: ['plant', 'plant'], sow: ['plant', 'plant'],
  harvest: ['harvest', 'harvest'], reap: ['harvest', 'harvest'],
  farm: ['farmInfo', 'farm'], plots: ['farmInfo', 'farm'], garden: ['farmInfo', 'farm'],
  // Casino (points only). Has its own short cooldown.
  slots: ['chatSlots', 'slots'], slot: ['chatSlots', 'slots'], spin: ['chatSlots', 'slots'],
  roulette: ['chatRoulette', 'roulette'], rl: ['chatRoulette', 'roulette'],
  plinko: ['chatPlinko', 'plinko'],
  blackjack: ['chatBlackjack', 'blackjack'], bj: ['chatBlackjack', 'blackjack'],
  hit: ['chatHit', 'blackjack'], stand: ['chatStand', 'blackjack'], double: ['chatDouble', 'blackjack'],
  casino: ['casinoHelp', 'casino'], gamble: ['casinoHelp', 'casino'],
  commands: ['help', 'commands'], help: ['help', 'commands'], rpg: ['help', 'commands'], mmo: ['help', 'commands'],
};

// Words players use for gear slots: "!unequip helmet".
const SLOT_ALIASES = {
  weapon: 'weapon', sword: 'weapon',
  head: 'head', helmet: 'head', helm: 'head',
  body: 'body', platebody: 'body', chest: 'body',
  legs: 'legs', platelegs: 'legs',
  shield: 'shield',
};
const SLOT_ICONS = { weapon: '🗡️', head: '⛑️', body: '👕', legs: '👖', shield: '🛡️' };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const CROPS = SKILLS.farming.resources;
const minutesLeft = (ms) => (ms <= 60_000 ? '1m' : ms < 3_600_000 ? `${Math.ceil(ms / 60_000)}m` : `${Math.floor(ms / 3_600_000)}h ${Math.ceil((ms % 3_600_000) / 60_000)}m`);

// Where each material comes from, for "you're missing..." hints:
// copper_ore -> "!mine copper", bronze_bar -> "!smelt bronze".
const GATHER_HINT = {};
for (const id of SKILL_IDS) {
  for (const r of [...(SKILLS[id].resources || []), ...(SKILLS[id].type === 'process' ? SKILLS[id].recipes : [])]) {
    // Crops use their full name ("!plant lemon balm" vs "!plant lemon"); ores etc. the first word ("!mine copper").
    const word = SKILLS[id].type === 'farm' ? ITEMS[r.item].name.toLowerCase() : ITEMS[r.item].name.split(' ')[0].toLowerCase();
    GATHER_HINT[r.item] ??= `!${SKILLS[id].command} ${word}`;
  }
}
// Name of anything in a skill's unlock list (items, recipes or monsters).
const unlockName = (r) => (r.item ? ITEMS[r.item].name : r.name);

class GameEngine extends EventEmitter {
  // settings: a Settings instance (live, admin-editable). Tests may pass a plain { game, all } object.
  constructor({ repo, config, settings, rng = Math.random, now = () => Date.now() }) {
    super();
    this.repo = repo;
    this.settings = settings || staticSettings(config);
    this.siteUrl = config.baseUrl;
    this.rng = rng;
    this.now = now;
    this.cooldownWarned = new Map(); // userId -> last_action_at we already warned about
    this.farmWarned = new Map(); // same, for the farming cooldown
    this.lastBet = new Map(); // userId -> time of last casino bet (casino cooldown)
    this.betWarned = new Map();
  }

  get cfg() {
    return this.settings.game;
  }

  // Entry point for every chat message. Returns { reply } where reply may be null.
  handleChat({ kickUserId, username, avatarUrl = null, content }) {
    if (!kickUserId || !username || typeof content !== 'string') return { reply: null };
    const user = this.repo.upsertUser({ kickUserId, username, avatarUrl });
    this.repo.chatTick(user.id);
    this.awardChatPoints(user);

    const { prefix, disabledCommands = [] } = this.cfg;
    // Emote shortcuts (admin setting): a message with e.g. the hydroponiczcobble emote counts as !mine.
    const text = content.trim().startsWith(prefix) ? content.trim() : this.emoteCommand(content);
    if (!text) return { reply: null };
    const [rawCmd, ...args] = text.slice(prefix.length).split(/\s+/);
    const cmd = (rawCmd || '').toLowerCase();

    let reply = null;
    if (COMMAND_TO_SKILL[cmd]) {
      if (!disabledCommands.includes(cmd)) reply = this.runAction(user, COMMAND_TO_SKILL[cmd], args);
    } else if (INFO_COMMANDS[cmd]) {
      const [handler, name] = INFO_COMMANDS[cmd];
      if (!disabledCommands.includes(name)) reply = this[handler](user, args, cmd);
    }
    return { reply: reply ? `@${user.username} ${reply}` : null };
  }

  // Kick sends emotes as "[emote:12345:name]"; people may also type ":name:" or just the name.
  emoteCommand(content) {
    for (const pair of this.cfg.emoteCommands || []) {
      const [name, command] = pair.split('=');
      if (!name || !command) continue;
      const n = name.replace(/[^a-z0-9_]/gi, '');
      const re = new RegExp(`\\[emote:\\d+:${n}\\]|:${n}:|(^|[^a-z0-9_])${n}([^a-z0-9_]|$)`, 'i');
      if (re.test(content)) return `${this.cfg.prefix}${command}`;
    }
    return null;
  }

  awardChatPoints(user) {
    const now = this.now();
    if (now - user.last_chat_points_at < this.cfg.chatCooldown * 1000) return;
    this.repo.addPoints(user.id, this.cfg.chatPoints);
    this.repo.setChatPointsAt(user.id, now);
  }

  // ---- Skilling ----------------------------------------------------------

  runAction(user, skillId, args) {
    // A bare "!smith" just lists what you can make, so it doesn't need (or use) the cooldown.
    if (SKILLS[skillId].pickBest === false && !args.length) return this.process(user, skillId, args).reply;
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
      const r =
        skill.type === 'combat'
          ? this.fight(user, args)
          : skill.type === 'process'
            ? this.process(user, skillId, args)
            : this.gather(user, skillId, args);
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
    if (skill.requires && !this.repo.getInventory(user.id)[skill.requires]) return { consumed: false, reply: this.missingToolMessage(skill) };

    // Gathering needs a free backpack slot.
    const bag = this.backpack(user.id);
    if (bag.used >= bag.capacity) {
      const next = bag.next ? ` or !upgrade backpack (${fmt(bag.next.capacity)} slots for ${fmt(bag.next.cost)} pts)` : '';
      return { consumed: false, reply: `🎒 your backpack is full (${bag.used}/${bag.capacity})! !sell or !smelt to make room${next}.` };
    }

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
    const failChance = tool ? tool.failChance || 0 : Math.max(0.03, 0.15 - level * 0.0015);
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

  // "you need a 🔪 Skinning Knife in your backpack to skin! !buy knife (500 pts) or !smith skinning knife (Smithing 20: 1 Steel Alloy)"
  missingToolMessage(skill) {
    const need = ITEMS[skill.requires];
    const shortName = need.name.split(' ').pop().toLowerCase();
    const ways = [];
    const price = this.shopItems().find((x) => x.item === skill.requires)?.cost;
    if (price !== undefined) ways.push(`!buy ${shortName} (${fmt(price)} pts)`);
    const recipe = SKILLS.smithing?.recipes.find((r) => r.item === skill.requires);
    if (recipe) {
      const inputs = Object.entries(recipe.inputs).map(([i, q]) => `${q} ${ITEMS[i].name}`).join(' + ');
      ways.push(`!smith ${need.name.toLowerCase()} (Smithing ${recipe.level}: ${inputs})`);
    }
    return `you need a ${need.icon} ${need.name} in your backpack to ${skill.command}!${ways.length ? ` ${ways.join(' or ')}` : ''}`;
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

  // Smelting: turns ores from the backpack into ingots (one ore type) and alloys (mixed ores).
  // Always frees backpack space, so it works even when the backpack is full.
  process(user, skillId, args) {
    const skill = SKILLS[skillId];
    const level = skillLevel(skillId, this.repo.getSkills(user.id)[skillId]);
    const inv = this.repo.getInventory(user.id);
    if (skill.requires && !inv[skill.requires]) return { consumed: false, reply: this.missingToolMessage(skill) };
    const hasInputs = (r) => Object.entries(r.inputs).every(([item, qty]) => (inv[item] || 0) >= qty);
    const needs = (r) => Object.entries(r.inputs).map(([i, q]) => `${q} ${ITEMS[i].name}`).join(' + ');
    const missing = (r) => {
      const lacking = Object.entries(r.inputs).filter(([i, q]) => (inv[i] || 0) < q);
      const list = lacking.map(([i, q]) => `${q - (inv[i] || 0)} ${ITEMS[i].name}`).join(' + ');
      const hints = [...new Set(lacking.map(([i]) => GATHER_HINT[i]).filter(Boolean))].join(' / ');
      return `a ${ITEMS[r.item].name} (${r.kind}) needs ${needs(r)}. You're missing ${list}${hints ? ` — try ${hints}` : ''}`;
    };

    let recipe;
    if (args.length) {
      const id = findItem(args.join(' '), skill.recipes.map((r) => r.item));
      if (!id) {
        if (skill.pickBest === false) {
          return { consumed: false, reply: `unknown item. Try e.g. !${skill.command} bronze sword (sword, helmet, shield, platelegs, platebody) or !${skill.command} skinning knife` };
        }
        const opts = skill.recipes.filter((r) => r.level <= level).map((r) => ITEMS[r.item].name.split(' ')[0].toLowerCase());
        return { consumed: false, reply: `unknown recipe. You can ${skill.command}: ${opts.join(', ')} (e.g. !${skill.command} ${opts[opts.length - 1]})` };
      }
      recipe = skill.recipes.find((r) => r.item === id);
      if (recipe.level > level) {
        return { consumed: false, reply: `you need ${skill.icon} ${skill.name} level ${recipe.level} for ${ITEMS[id].name}.` };
      }
      if (!hasInputs(recipe)) return { consumed: false, reply: missing(recipe) };
    } else if (skill.pickBest === false) {
      // Smithing: say what they can make right now instead of guessing.
      const ready = skill.recipes.filter((r) => r.level <= level && hasInputs(r));
      if (ready.length) {
        const list = ready.slice(-6).reverse().map((r) => ITEMS[r.item].name.toLowerCase()).join(', ');
        return { consumed: false, reply: `you can ${skill.command}: ${list}. e.g. !${skill.command} ${ITEMS[ready[ready.length - 1].item].name.toLowerCase()}` };
      }
      return { consumed: false, reply: `nothing to ${skill.command} yet! ${missing(skill.recipes[1] || skill.recipes[0])}` };
    } else {
      recipe = [...skill.recipes].reverse().find((r) => r.level <= level && hasInputs(r));
      if (!recipe) {
        // Point at the closest thing they could make: the unlocked recipe they're fewest ores away from.
        const unlocked = skill.recipes.filter((r) => r.level <= level);
        const gap = (r) => Object.entries(r.inputs).reduce((s, [i, q]) => s + Math.max(0, q - (inv[i] || 0)), 0);
        const closest = unlocked.reduce((best, r) => (gap(r) < gap(best) ? r : best), unlocked[0]);
        return { consumed: false, reply: `nothing to ${skill.command}! ${missing(closest)}` };
      }
    }

    for (const [item, qty] of Object.entries(recipe.inputs)) this.repo.removeItem(user.id, item, qty);
    return this.reward(user, skillId, recipe.item, recipe.xp, { rare: false });
  }

  reward(user, skillId, item, baseXp, { rare }) {
    const skill = SKILLS[skillId];
    const tool = this.currentTool(user.id, skillId);
    const xpGain = this.xpFor(baseXp, tool);
    // Better furnaces sometimes make two (only if there's room in the backpack for the extra one).
    let qty = 1;
    if (tool?.doubleChance > 0 && this.rng() < tool.doubleChance) {
      const bagNow = this.backpack(user.id);
      if (bagNow.used + 1 < bagNow.capacity) qty = 2;
    }
    this.repo.addItem(user.id, item, qty);
    const text = `${skill.verb} ${rare ? 'a RARE ' : ''}${ITEMS[item].name}`;
    this.emitActivity(user, { kind: rare ? 'rare' : 'action', skill: skillId, item, xp: xpGain, text });
    const gained = this.grantXp(user, skillId, xpGain);
    const reply = `${skill.icon} you ${skill.verb} ${rare ? 'a RARE ' : ''}${itemLabel(item, qty)}!${qty > 1 ? ' (double!)' : ''} ${gained.text}`;
    return { consumed: true, reply: reply + this.fullBagNote(user.id) };
  }

  xpFor(baseXp, tool) {
    return Math.max(1, Math.round(baseXp * (1 + (tool?.xpBonus || 0)) * this.cfg.xpMultiplier));
  }

  // Adds XP and action points; returns "+X XP, +Y pts" plus level-up / progress text for the reply.
  grantXp(user, skillId, xpGain) {
    const skill = SKILLS[skillId];
    const before = this.repo.getSkills(user.id);
    const levelBefore = skillLevel(skillId, before[skillId]);
    const charBefore = characterProgress(SKILL_IDS.map((id) => before[id])).level;
    const points = Math.round(Math.max(1, xpGain / 10) * this.cfg.pointsMultiplier);
    this.repo.addXp(user.id, skillId, xpGain);
    if (points > 0) this.repo.addPoints(user.id, points);

    const xpAfter = before[skillId] + xpGain;
    const levelAfter = skillLevel(skillId, xpAfter);
    const charAfter = characterProgress(SKILL_IDS.map((id) => before[id] + (id === skillId ? xpGain : 0))).level;

    let text = `+${xpGain} XP, +${points} pts`;
    if (levelAfter > levelBefore) {
      text += ` 🎉 ${skill.name} level ${levelAfter}!`;
      const unlocks = (skill.resources || skill.recipes || skill.monsters).filter((r) => r.level > levelBefore && r.level <= levelAfter);
      if (unlocks.length) text += ` Unlocked: ${unlocks.slice(0, 5).map(unlockName).join(', ')}${unlocks.length > 5 ? '…' : ''}.`;
      if (skill.tool && this.canUpgrade(user.id, skillId, levelAfter) && !this.canUpgrade(user.id, skillId, levelBefore)) {
        text += ` 🔧 You can now !upgrade ${skill.tool.id}!`;
      }
      this.emitActivity(user, { kind: 'levelup', skill: skillId, text: `reached ${skill.name} level ${levelAfter}` });
    } else {
      text += ` (${skill.name} ${levelAfter}, ${progress(xpAfter, maxLevel(skillId)).percent}%)`;
    }
    if (charAfter > charBefore) {
      text += ` ⭐ Character level ${charAfter}!`;
      this.emitActivity(user, { kind: 'charlevel', text: `reached character level ${charAfter}` });
    }
    return { points, text };
  }

  fullBagNote(userId) {
    const bag = this.backpack(userId);
    return bag.used >= bag.capacity ? ` 🎒 Backpack full (${bag.used}/${bag.capacity})!` : '';
  }

  // ---- Combat (!fight) ----------------------------------------------------

  combatLevel(userId) {
    const xp = this.repo.getSkills(userId);
    return Math.max(1, ...COMBAT_SKILLS.map((id) => skillLevel(id, xp[id])));
  }

  combatStats(userId) {
    const worn = this.repo.getWorn(userId);
    const weapon = worn.weapon && ITEMS[worn.weapon] ? worn.weapon : null;
    const defence = GEAR_SLOTS.filter((sl) => sl !== 'weapon').reduce((sum, sl) => sum + (ITEMS[worn[sl]]?.defence || 0), 0);
    return { worn, weapon, attack: weapon ? ITEMS[weapon].attack : 0, defence, level: this.combatLevel(userId) };
  }

  // Look at every weapon the player owns (worn or in the backpack), take the combat skill they're
  // best at, and pick their strongest weapon for it that they're allowed to use.
  chooseWeapon(userId) {
    const xp = this.repo.getSkills(userId);
    const worn = this.repo.getWorn(userId);
    const owned = [...new Set([worn.weapon, ...Object.keys(this.repo.getInventory(userId))])].filter((id) => ITEMS[id]?.weaponType);
    if (!owned.length) return { weapon: null, reason: 'none' };
    const bySkill = {};
    for (const id of owned) {
      const skillId = WEAPON_SKILL[ITEMS[id].weaponType];
      if (skillId) (bySkill[skillId] ||= []).push(id);
    }
    const skills = Object.keys(bySkill).sort((a, b) => skillLevel(b, xp[b]) - skillLevel(a, xp[a]));
    for (const skillId of skills) {
      const level = skillLevel(skillId, xp[skillId]);
      const usable = bySkill[skillId].filter((id) => ITEMS[id].level <= level).sort((a, b) => ITEMS[b].attack - ITEMS[a].attack);
      if (usable.length) return { weapon: usable[0], skillId, level, wasWorn: usable[0] === worn.weapon };
    }
    const easiest = owned.sort((a, b) => ITEMS[a].level - ITEMS[b].level)[0];
    return { weapon: null, reason: 'level', item: easiest };
  }

  fight(user, args) {
    const pick = this.chooseWeapon(user.id);
    if (!pick.weapon) {
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
    const unlocked = skill.monsters.filter((m) => m.level <= pick.level);
    let monster;
    if (args.length) {
      const q = args.join(' ').toLowerCase().replace(/^an? /, '');
      monster = skill.monsters.find((m) => m.id === q.replace(/\s+/g, '_') || m.name.toLowerCase() === q) || skill.monsters.find((m) => m.name.toLowerCase().startsWith(q));
      if (!monster) {
        const next = skill.monsters.find((m) => m.level > pick.level);
        const opts = [...unlocked, ...(next ? [next] : [])].map((m) => `${m.name} (${m.level})`).join(', ');
        return { consumed: false, reply: `unknown monster. You can fight: ${opts}` };
      }
      if (monster.level > pick.level) {
        return { consumed: false, reply: `you need ${skill.icon} ${skill.name} level ${monster.level} to fight a ${monster.name} (you are ${pick.level}).` };
      }
    } else {
      monster = this.pickResource(unlocked);
    }

    // Wield the chosen weapon if it isn't already in hand.
    let swapped = '';
    if (!pick.wasWorn) {
      const worn = this.repo.getWorn(user.id);
      this.repo.removeItem(user.id, pick.weapon, 1);
      if (worn.weapon) this.repo.addItem(user.id, worn.weapon, 1);
      this.repo.wear(user.id, 'weapon', pick.weapon);
      swapped = ` (equipped your ${ITEMS[pick.weapon].name})`;
    }

    const stats = this.combatStats(user.id);
    const chance = this.winChance(pick.level, stats, monster);
    const weapon = ITEMS[pick.weapon];
    if (this.rng() >= chance) {
      const gained = this.grantXp(user, pick.skillId, this.xpFor(monster.xp * 0.25));
      return {
        consumed: true,
        reply: `${monster.icon} the ${monster.name} was too strong and you retreated!${swapped} ${gained.text} (win chance ${Math.round(chance * 100)}% — better gear helps)`,
      };
    }

    let loot;
    let rare = false;
    if (monster.rare && this.rng() < monster.rare.chance) {
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
      xp: xpGain,
      text: `defeated a ${monster.name}${rare ? ` and found a RARE ${ITEMS[loot].name}` : ''}`,
    });
    const gained = this.grantXp(user, pick.skillId, xpGain);
    return {
      consumed: true,
      reply: `${weapon.icon} you defeated a ${monster.icon} ${monster.name}${swapped} and looted ${rare ? 'a RARE ' : ''}${itemLabel(loot)}! ${gained.text}${this.fullBagNote(user.id)}`,
    };
  }

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
  }

  // Your attack (level + weapon) against the monster's power, your defence against its damage.
  // Evenly matched with the right gear: ~75%. Always between 5% and 95%.
  winChance(level, stats, monster) {
    const offence = Math.min(1.5, (level + stats.attack) / monster.power);
    const defence = Math.min(1.5, (stats.defence + 1) / (monster.damage + 1));
    return clamp(0.25 + 0.5 * (0.65 * offence + 0.35 * defence), 0.05, 0.95);
  }

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
  }

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
  }

  // !equipped: what you're wearing and your combat stats.
  equippedInfo(user) {
    const st = this.combatStats(user.id);
    const parts = GEAR_SLOTS.map((sl) => (st.worn[sl] ? itemLabel(st.worn[sl]) : `${SLOT_ICONS[sl]} —`));
    return `${parts.join(' | ')} | ⚔️ Attack +${st.attack} · 🛡️ Defence +${st.defence} · Combat level ${st.level}`;
  }

  // ---- Shop (!buy, website) -------------------------------------------------

  shopItems() {
    const live = this.settings.all.shop;
    return SHOP.map((x, i) => ({ ...x, ...(live?.[i] || {}), ...ITEMS[x.item], item: x.item }));
  }

  shopList() {
    const main = this.shopItems().filter((x) => x.category !== 'seeds');
    const list = main.map((x) => `${x.icon} ${x.name} ${fmt(x.cost)}`).join(', ');
    return `🛒 Shop: ${list} pts, plus seeds (e.g. !buy carrot seeds 5) — ${this.siteUrl}/#/shop`;
  }

  // Shared by "!buy" and the website shop. Returns the reply text.
  // "!buy hammer", "!buy carrot seeds 10", "!buy plot 3".
  buy(user, args) {
    const words = args.map((w) => String(w).toLowerCase()).filter(Boolean);
    let qty = 1;
    if (words.length > 1 && /^\d+$/.test(words[words.length - 1])) qty = Math.min(1000, Math.max(1, Number(words.pop())));
    const q = words.join(' ').trim();
    const items = this.shopItems();
    const name = (x) => x.name.toLowerCase();
    const found =
      q &&
      (items.find((x) => x.item === q.replace(/\s+/g, '_') || name(x) === q) ||
        items.find((x) => name(x) === `${q} seeds`) ||
        items.find((x) => name(x).startsWith(q)) ||
        items.find((x) => name(x).includes(q)));
    if (!found) return `usage: !buy <item> [amount]. ${this.shopList()}`;
    if (found.item === 'farm_plot') return this.buyPlots(user, qty, found);

    const inv = this.repo.getInventory(user.id);
    const isTool = found.keep && !found.gear && !found.seedFor;
    if (isTool) {
      if (inv[found.item]) return `you already have a ${found.icon} ${found.name}.`;
      qty = 1;
    }
    if (found.seedFor) {
      const crop = CROPS.find((c) => c.item === found.seedFor);
      const lvl = skillLevel('farming', this.repo.getSkills(user.id).farming);
      if (lvl < crop.level) return `you need 🌱 Farming level ${crop.level} to grow ${ITEMS[crop.item].name} (you are ${lvl}).`;
    } else {
      const bag = this.backpack(user.id);
      if (bag.used + qty > bag.capacity) return `🎒 no room in your backpack (${bag.used}/${bag.capacity}). !sell something first.`;
    }
    const total = found.cost * qty;
    return this.repo.transaction(() => {
      const refused = this.pay(user, total, qty > 1 ? `${qty}x ${found.name}` : found.name);
      if (refused) return refused;
      this.repo.addItem(user.id, found.item, qty);
      this.emitActivity(user, { kind: 'buy', item: found.item, text: `bought ${qty > 1 ? `${qty}x ${found.name}` : `a ${found.name}`}` });
      const tip =
        found.item === 'smithing_hammer'
          ? ' Now try !smith bronze sword.'
          : found.weaponType
            ? ' Now try !fight.'
            : found.item === 'skinning_knife'
              ? ' Now try !skin.'
              : found.seedFor
                ? ` Now !plant ${ITEMS[found.seedFor].name.toLowerCase()}.`
                : '';
      return `🛒 bought ${itemLabel(found.item, qty)} for ${fmt(total)} pts!${tip} Balance: ${fmt(this.repo.getUser(user.id).points)}`;
    });
  }

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
  }

  // ---- Farming (!plant, !harvest, !farm) ----------------------------------------

  plotCount(userId) {
    // Everyone has STARTER_PLOTS free plots plus the ones they bought (stored as "plots"), so players
    // who bought plots before the free plot existed get it too.
    return Math.min(STARTER_PLOTS + (this.repo.getEquipment(userId).plots || 0), MAX_PLOTS);
  }

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
  }

  // Farming's own cooldown (so you can farm between other actions). Returns a reply if still waiting.
  farmCooldown(user) {
    const now = this.now();
    const last = this.repo.getUser(user.id).last_farm_at || 0;
    const readyAt = last + (this.cfg.farmCooldown ?? 10) * 1000;
    if (now >= readyAt) return null;
    if (this.farmWarned.get(user.id) === last) return '';
    this.farmWarned.set(user.id, last);
    return `🌱 easy there, farmer! Try again in ${Math.ceil((readyAt - now) / 1000)}s.`;
  }

  noPlotsMessage() {
    const plot = this.shopItems().find((x) => x.item === 'farm_plot');
    return `you don't have a farm plot yet! 🟫 !buy plot (${fmt(plot?.cost ?? 0)} pts) or ${this.siteUrl}/#/shop`;
  }

  // !plant [crop] [amount]: one seed per empty plot.
  plant(user, args) {
    if (!this.plotCount(user.id)) return this.noPlotsMessage();
    const wait = this.farmCooldown(user);
    if (wait !== null) return wait || null;

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

    const n = Math.min(empty.length, inv[crop.seed], limit);
    const now = this.now();
    const growMs = Math.round(crop.grow * 60_000 * (this.cfg.growMultiplier ?? 1));
    const result = this.repo.transaction(() => {
      this.repo.removeItem(user.id, crop.seed, n);
      for (const p of empty.slice(0, n)) this.repo.plant(user.id, p.plot, crop.item, now, now + growMs);
      this.repo.setFarmAt(user.id, now);
      return this.grantXp(user, 'farming', this.xpFor(Math.max(1, Math.round(crop.xp * 0.2)) * n));
    });
    const c = ITEMS[crop.item];
    this.emitActivity(user, { kind: 'action', skill: 'farming', item: crop.item, text: `planted ${n}x ${c.name}` });
    const left = empty.length - n;
    return `🌱 planted ${c.icon} ${c.name} in ${n} plot${n === 1 ? '' : 's'} — ready in ${minutesLeft(growMs)}. ${result.text}${left ? ` (${left} plot${left === 1 ? '' : 's'} still empty)` : ''}`;
  }

  seedPrice(crop) {
    return this.shopItems().find((x) => x.item === crop.seed)?.cost ?? crop.seedCost;
  }

  // !harvest: collect every ready plot (as much as fits in the backpack).
  harvest(user) {
    if (!this.plotCount(user.id)) return this.noPlotsMessage();
    const wait = this.farmCooldown(user);
    if (wait !== null) return wait || null;

    const plots = this.farmPlots(user.id);
    const ready = plots.filter((p) => p.ready);
    if (!ready.length) {
      const growing = plots.filter((p) => p.crop).sort((a, b) => a.readyAt - b.readyAt);
      if (!growing.length) return `your plots are empty! !plant some seeds first (!buy carrot seeds ${plots.length}).`;
      const c = ITEMS[growing[0].crop];
      return `nothing is ready yet. Next: ${c.icon} ${c.name} in ${minutesLeft(growing[0].readyAt - this.now())}.`;
    }

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
      if (harvestedPlots) this.repo.setFarmAt(user.id, this.now());
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
  }

  // !farm: plot overview.
  farmInfo(user) {
    const plots = this.farmPlots(user.id);
    if (!plots.length) return this.noPlotsMessage();
    const ready = plots.filter((p) => p.ready).length;
    const growing = plots.filter((p) => p.crop && !p.ready).sort((a, b) => a.readyAt - b.readyAt);
    const empty = plots.filter((p) => !p.crop).length;
    const parts = [`🌱 Farm: ${plots.length}/${MAX_PLOTS} plots`];
    if (ready) parts.push(`✅ ${ready} ready (!harvest)`);
    if (growing.length) parts.push(`⏳ ${growing.length} growing (next ${ITEMS[growing[0].crop].icon} in ${minutesLeft(growing[0].readyAt - this.now())})`);
    if (empty) parts.push(`🟫 ${empty} empty (!plant)`);
    return parts.join(' · ');
  }

  emitActivity(user, entry) {
    const id = this.repo.logActivity({ userId: user.id, ...entry });
    this.emit('activity', { id, username: user.username, created_at: this.now(), skill: null, item: null, xp: 0, ...entry });
  }

  // ---- Backpack ----------------------------------------------------------

  backpackTiers() {
    const live = this.settings.all.backpack;
    return BACKPACK_TIERS.map((t, i) => ({ ...t, ...(live?.[i] || {}) }));
  }

  backpack(userId) {
    const tiers = this.backpackTiers();
    const tier = Math.min(this.repo.getEquipment(userId).backpack || 0, tiers.length - 1);
    // Seeds live in a seed pouch and don't take backpack slots.
    const used = Object.entries(this.repo.getInventory(userId)).reduce((s, [id, q]) => s + (ITEMS[id] && !ITEMS[id].seedFor ? q : 0), 0);
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
  }

  sellValue(itemId) {
    return Math.round(ITEMS[itemId].value * this.cfg.sellMultiplier);
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
    const bag = this.backpack(user.id);
    const head = `${bag.icon} ${bag.name} (${bag.used}/${bag.capacity})`;
    const inv = Object.entries(this.repo.getInventory(user.id)).filter(([id]) => ITEMS[id]);
    if (!inv.length) return `${head} is empty. Try !fish !mine !chop !dig`;
    const worth = inv.reduce((s, [id, q]) => s + this.sellValue(id) * q, 0);
    inv.sort((a, b) => ITEMS[b[0]].value * b[1] - ITEMS[a[0]].value * a[1]);
    const shown = inv.slice(0, 8).map(([id, q]) => itemLabel(id, q)).join(', ');
    const more = inv.length > 8 ? ` +${inv.length - 8} more` : '';
    return `${head}: ${shown}${more} (worth ${fmt(worth)} pts — !sell all)`;
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
    let kept = 0;
    if (args[0].toLowerCase() === 'all' && args.length === 1) {
      // Gear and tools are kept; sell those by name.
      entries = Object.entries(inv).filter(([id]) => ITEMS[id] && !ITEMS[id].keep);
      kept = Object.entries(inv).filter(([id]) => ITEMS[id]?.keep).length;
      if (!entries.length && kept) return 'nothing to sell — your gear and tools are kept by !sell all (sell them by name, e.g. !sell bronze sword).';
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
        sum += this.sellValue(id) * qty;
      }
      this.repo.addPoints(user.id, sum);
      return sum;
    });
    const count = entries.reduce((s, [, q]) => s + q, 0);
    const single = entries.length === 1;
    const what = single ? itemLabel(entries[0][0], entries[0][1]) : `${fmt(count)} items`;
    const plain = single ? `${fmt(entries[0][1])}x ${ITEMS[entries[0][0]].name}` : what;
    this.emitActivity(user, { kind: 'sell', text: `sold ${plain} for ${fmt(total)} pts` });
    const keptNote = kept ? ' (kept your gear & tools)' : '';
    return `sold ${what} for ${fmt(total)} pts 💰 Balance: ${fmt(this.repo.getUser(user.id).points)}${keptNote}`;
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
    const p = this.cfg.prefix;
    const off = this.cfg.disabledCommands || [];
    const on = (list) => list.filter((c) => !off.includes(c)).map((c) => `${p}${c}`).join(' ');
    const skills = on(SKILL_IDS.flatMap((id) => (SKILLS[id].type === 'farm' ? ['plant', 'harvest'] : [SKILLS[id].command])));
    const tools = Object.keys(TOOL_TO_SKILL).join('/');
    return `Skills: ${skills} (e.g. ${p}mine iron, ${p}smith bronze sword) | Gear: ${p}gear ${p}equip ${p}equipped ${p}shop ${p}buy, ${p}upgrade ${tools}/backpack | Info: ${on(['stats', 'inv', 'sell', 'points', 'top'])}${this.cfg.casinoEnabled === false ? '' : ` | Casino: ${p}casino`} | ${this.siteUrl}`;
  }

  // ---- Tools & upgrades (!upgrade rod, !upgrade backpack) --------------------

  // Tool tiers with the live (admin-editable) numbers applied.
  toolTiers(skillId) {
    const t = SKILLS[skillId].tool;
    if (!t) return null;
    const live = this.settings.all[`${t.id}s`];
    return t.tiers.map((tier, i) => ({ ...tier, ...(live?.[i] || {}) }));
  }

  toolTier(userId, skillId) {
    const t = SKILLS[skillId].tool;
    if (!t) return null;
    return Math.min(this.repo.getEquipment(userId)[t.id] || 0, t.tiers.length - 1);
  }

  currentTool(userId, skillId) {
    const tier = this.toolTier(userId, skillId);
    return tier === null ? null : this.toolTiers(skillId)[tier];
  }

  canUpgrade(userId, skillId, level) {
    const tiers = this.toolTiers(skillId);
    const next = tiers?.[this.toolTier(userId, skillId) + 1];
    return Boolean(next && level >= next.level);
  }

  // "🎣 Oak Rod: 15% snap chance, +10% XP, rare finds x1.1"
  describeTool(tool, skillId) {
    const def = SKILLS[skillId].tool;
    const parts = [];
    if (def.stats.includes('failChance')) parts.push(`${pct(tool.failChance)} ${def.failWord || 'fail'} chance`);
    if (def.stats.includes('xpBonus')) parts.push(`+${Math.round(tool.xpBonus * 100)}% XP`);
    if (def.stats.includes('rareBonus')) parts.push(`rare finds x${tool.rareBonus}`);
    if (def.stats.includes('doubleChance')) parts.push(`${pct(tool.doubleChance)} chance to smelt two`);
    return `${tool.icon} ${tool.name}: ${parts.join(', ')}`;
  }

  // Deducts the cost if the player can afford it. Returns null on success, or a reply explaining why not.
  pay(user, cost, what) {
    const balance = this.repo.getUser(user.id).points;
    if (balance < cost) {
      return `the ${what} costs ${fmt(cost)} pts, you have ${fmt(balance)} (${fmt(cost - balance)} more needed). Earn points with skills, !sell and chatting.`;
    }
    if (cost > 0) this.repo.addPoints(user.id, -cost);
    return null;
  }

  upgrade(user, args) {
    const which = (args[0] || '').toLowerCase();
    if (['backpack', 'bag', 'pack'].includes(which)) return this.upgradeBackpack(user);
    const skillId = TOOL_TO_SKILL[TOOL_ALIASES[which]];
    const options = [...Object.keys(TOOL_TO_SKILL), 'backpack'].map((t) => `!upgrade ${t}`).join(', ');
    if (!skillId) return which ? `you can't upgrade "${which}" (yet). Try ${options}` : `usage: ${options}`;
    return this.upgradeTool(user, skillId);
  }

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
  }

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
  }

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
  }

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
  }

  // ---- Casino ------------------------------------------------------------------
  // Every game returns a result object (used by the website) with ok/error; the chat* wrappers turn
  // it into one line of chat.

  // Validates a bet: casino open, cooldown, min/max, balance. Returns { bet } or { error }.
  takeBet(user, betArg) {
    const c = this.cfg;
    if (c.casinoEnabled === false) return { error: 'the casino is closed right now.' };
    const now = this.now();
    const wait = (c.casinoCooldown ?? 5) * 1000 - (now - (this.lastBet.get(user.id) || 0));
    if (wait > 0) {
      // Say it once per cooldown so spamming doesn't flood chat.
      const last = this.lastBet.get(user.id);
      if (this.betWarned.get(user.id) === last) return { error: '', cooldown: true };
      this.betWarned.set(user.id, last);
      return { error: `🎲 easy! Next bet in ${Math.ceil(wait / 1000)}s.`, cooldown: true };
    }
    const balance = this.repo.getUser(user.id).points;
    let bet = casino.parseBet(betArg, balance);
    if (bet === null) return { error: 'how much? e.g. 500, 1k, half or all.' };
    const max = c.casinoMaxBet || 0;
    if (max > 0 && bet > max) bet = max;
    const min = c.casinoMinBet ?? 10;
    if (bet < min) return { error: `the minimum bet is ${fmt(min)} pts${balance < min ? ` (you have ${fmt(balance)})` : ''}.` };
    if (bet > balance) return { error: `you only have ${fmt(balance)} pts.` };
    return { bet };
  }

  // Pays out: net = bet * multiplier - bet. Announces big wins to the feed/overlay.
  settleBet(user, game, bet, multiplier, what) {
    const payout = Math.floor(bet * multiplier);
    const net = payout - bet;
    this.repo.transaction(() => this.repo.addPoints(user.id, net));
    this.lastBet.set(user.id, this.now());
    if (multiplier >= 10 || net >= 10000) {
      this.emitActivity(user, { kind: 'jackpot', text: `won ${fmt(payout)} pts on ${game}${what ? ` (${what})` : ''}! 🎉` });
    }
    return { bet, multiplier, payout, net, balance: this.repo.getUser(user.id).points };
  }

  playSlots(user, betArg) {
    const b = this.takeBet(user, betArg);
    if (b.bet === undefined) return { ok: false, ...b };
    const spin = casino.spinSlots(this.rng);
    return { ok: true, game: 'slots', ...spin, ...this.settleBet(user, 'slots', b.bet, spin.multiplier, spin.line) };
  }

  playRoulette(user, choice, betArg) {
    if (!casino.rouletteBet(choice)) return { ok: false, error: 'bet on red, black, green, odd, even, low, high, 1st/2nd/3rd (dozens) or a number 1-36.' };
    const b = this.takeBet(user, betArg);
    if (b.bet === undefined) return { ok: false, ...b };
    const spin = casino.spinRoulette(this.rng, choice);
    return { ok: true, game: 'roulette', ...spin, ...this.settleBet(user, 'roulette', b.bet, spin.multiplier, spin.win ? spin.betLabel : null) };
  }

  playPlinko(user, betArg, risk) {
    const r = casino.riskOf(risk || 'medium');
    if (!r) return { ok: false, error: 'risk must be low, medium or high.' };
    const b = this.takeBet(user, betArg);
    if (b.bet === undefined) return { ok: false, ...b };
    const drop = casino.dropPlinko(this.rng, r);
    return { ok: true, game: 'plinko', rows: casino.PLINKO_ROWS, ...drop, ...this.settleBet(user, 'plinko', b.bet, drop.multiplier, `${drop.multiplier}x`) };
  }

  // Blackjack keeps the hand in the database, so it survives restarts. The stake is taken up front.
  bjKey(userId) {
    return `bj:${userId}`;
  }

  bjView(game, balance) {
    const done = Boolean(game.status);
    return {
      ok: true,
      game: 'blackjack',
      stake: game.stake,
      player: game.player,
      playerTotal: casino.handTotal(game.player),
      dealer: done ? game.dealer : [game.dealer[0], null],
      dealerTotal: done ? casino.handTotal(game.dealer) : casino.handTotal([game.dealer[0]]),
      status: game.status || 'playing',
      canDouble: !done && game.player.length === 2 && !game.doubled && balance >= game.stake,
      payout: game.payout ?? null,
      net: game.payout != null ? game.payout - game.stake : null,
      balance,
    };
  }

  blackjackState(user) {
    const game = this.repo.getSetting(this.bjKey(user.id));
    return game ? this.bjView(game, this.repo.getUser(user.id).points) : { ok: true, game: 'blackjack', status: 'none', balance: this.repo.getUser(user.id).points };
  }

  blackjackStart(user, betArg) {
    if (this.repo.getSetting(this.bjKey(user.id))) return { ok: false, error: 'finish your current hand first: !hit, !stand or !double.', ...this.blackjackState(user) };
    const b = this.takeBet(user, betArg);
    if (b.bet === undefined) return { ok: false, ...b };
    const game = { stake: b.bet, player: [casino.drawCard(this.rng), casino.drawCard(this.rng)], dealer: [casino.drawCard(this.rng), casino.drawCard(this.rng)], doubled: false };
    this.repo.transaction(() => {
      this.repo.addPoints(user.id, -b.bet);
      this.repo.setSetting(this.bjKey(user.id), game);
    });
    this.lastBet.set(user.id, this.now());
    if (casino.isBlackjack(game.player) || casino.isBlackjack(game.dealer)) return this.blackjackFinish(user, game);
    return this.bjView(game, this.repo.getUser(user.id).points);
  }

  blackjackAction(user, action) {
    let game = this.repo.getSetting(this.bjKey(user.id));
    if (!game) return { ok: false, error: 'no hand in play. Start one with !bj <bet>.' };
    if (action === 'double') {
      if (game.player.length !== 2 || game.doubled) return { ok: false, error: 'you can only double on your first two cards.', ...this.bjView(game, this.repo.getUser(user.id).points) };
      if (this.repo.getUser(user.id).points < game.stake) return { ok: false, error: `doubling needs another ${fmt(game.stake)} pts.`, ...this.bjView(game, this.repo.getUser(user.id).points) };
      this.repo.addPoints(user.id, -game.stake);
      game = { ...game, stake: game.stake * 2, doubled: true, player: [...game.player, casino.drawCard(this.rng)] };
      return this.blackjackFinish(user, game);
    }
    if (action === 'hit') {
      game = { ...game, player: [...game.player, casino.drawCard(this.rng)] };
      if (casino.handTotal(game.player) >= 21) return this.blackjackFinish(user, game);
      this.repo.setSetting(this.bjKey(user.id), game);
      return this.bjView(game, this.repo.getUser(user.id).points);
    }
    if (action === 'stand') return this.blackjackFinish(user, game);
    return { ok: false, error: 'use hit, stand or double.' };
  }

  blackjackFinish(user, game) {
    const done = casino.settleBlackjack(game, this.rng);
    const payout = Math.floor(done.stake * done.multiplier);
    this.repo.transaction(() => {
      if (payout) this.repo.addPoints(user.id, payout);
      this.repo.deleteSetting(this.bjKey(user.id));
    });
    if (done.status === 'blackjack' || payout - done.stake >= 10000) {
      this.emitActivity(user, { kind: 'jackpot', text: `won ${fmt(payout)} pts at blackjack${done.status === 'blackjack' ? ' with a BLACKJACK' : ''}! 🃏` });
    }
    return this.bjView({ ...done, payout }, this.repo.getUser(user.id).points);
  }

  // ---- Casino: chat ------------------------------------------------------------------
  casinoReply(r, win) {
    const bal = `Balance: ${fmt(r.balance)}`;
    return r.net > 0 ? `${win} WON ${fmt(r.payout)} pts (${r.multiplier}x)! 💰 ${bal}` : r.net === 0 ? `${win} bet back. ${bal}` : `${win} lost ${fmt(-r.net)}. ${bal}`;
  }

  chatSlots(user, args) {
    if (!args.length) return 'usage: !slots <bet> (e.g. !slots 500, !slots all). Pays up to 300x on 🟩🟩🟩!';
    const r = this.playSlots(user, args[0]);
    if (!r.ok) return r.error || null;
    const icons = r.reels.map((id) => casino.SLOT_SYMBOLS.find((x) => x.id === id).icon).join(' | ');
    return this.casinoReply(r, `🎰 [ ${icons} ]${r.line ? ` ${r.line}!` : ''}`);
  }

  chatRoulette(user, args) {
    if (args.length < 2) return 'usage: !roulette <red|black|green|odd|even|low|high|1st|2nd|3rd|number> <bet>, e.g. !roulette red 500';
    const [a, b] = args;
    const bets = (x) => casino.parseBet(x, user.points) !== null;
    // "!roulette red 500" or "!roulette 500 red". "!roulette 7 500" means 500 on number 7.
    const [choice, bet] = casino.rouletteBet(a) && bets(b) ? [a, b] : casino.rouletteBet(b) && bets(a) ? [b, a] : [null, null];
    if (!choice) return `bet on red, black, green, odd, even, low, high, 1st, 2nd, 3rd or a number 1-36, e.g. ${this.cfg.prefix}roulette red 500`;
    const r = this.playRoulette(user, choice, bet);
    if (!r.ok) return r.error || null;
    const dot = { red: '🔴', black: '⚫', green: '🟢' }[r.color];
    return this.casinoReply(r, `🎡 ${dot} ${r.number} — you bet ${r.betLabel}:`);
  }

  chatPlinko(user, args) {
    if (!args.length) return 'usage: !plinko <bet> [low|medium|high], e.g. !plinko 500 high';
    const [a, b] = args;
    const [bet, risk] = casino.riskOf(a) ? [b, a] : [a, b];
    const r = this.playPlinko(user, bet, risk);
    if (!r.ok) return r.error || null;
    return this.casinoReply(r, `🔻 Plinko (${r.risk}) landed on ${r.multiplier}x:`);
  }

  bjText(v) {
    const hand = (cards) => cards.map((c) => (c ? casino.cardText(c) : '🂠')).join(' ');
    const table = `🃏 You: ${hand(v.player)} (${v.playerTotal}) | Dealer: ${hand(v.dealer)} (${v.dealerTotal})`;
    if (v.status === 'playing') return `${table} — !hit, !stand${v.canDouble ? ' or !double' : ''}`;
    const outcome = {
      blackjack: `BLACKJACK! Won ${fmt(v.payout)} pts`,
      win: `you WIN ${fmt(v.payout)} pts`,
      push: 'push — bet back',
      lose: `dealer wins, lost ${fmt(v.stake)}`,
      bust: `bust! Lost ${fmt(v.stake)}`,
    }[v.status];
    return `${table} — ${outcome}. Balance: ${fmt(v.balance)}`;
  }

  chatBlackjack(user, args) {
    const current = this.repo.getSetting(this.bjKey(user.id));
    if (current) return this.bjText(this.bjView(current, this.repo.getUser(user.id).points));
    if (!args.length) return 'usage: !bj <bet> (e.g. !bj 500), then !hit, !stand or !double. Blackjack pays 3:2.';
    const r = this.blackjackStart(user, args[0]);
    return r.ok ? this.bjText(r) : r.error || null;
  }

  chatHit(user) {
    const r = this.blackjackAction(user, 'hit');
    return r.ok ? this.bjText(r) : r.error;
  }

  chatStand(user) {
    const r = this.blackjackAction(user, 'stand');
    return r.ok ? this.bjText(r) : r.error;
  }

  chatDouble(user) {
    const r = this.blackjackAction(user, 'double');
    return r.ok ? this.bjText(r) : r.error;
  }

  casinoHelp() {
    const c = this.cfg;
    if (c.casinoEnabled === false) return 'the casino is closed right now.';
    return `🎰 Casino (points only): ${c.prefix}slots <bet> · ${c.prefix}roulette red <bet> · ${c.prefix}plinko <bet> [low|medium|high] · ${c.prefix}bj <bet> then ${c.prefix}hit/${c.prefix}stand/${c.prefix}double. Bets: 500, 1k, half, all. Or play at ${this.siteUrl}/#/casino`;
  }

  // ---- Data for the website ---------------------------------------------

  profile(userId) {
    const user = this.repo.getUser(userId);
    if (!user) return null;
    const xp = this.repo.getSkills(userId);
    const skills = SKILL_IDS.map((id) => {
      const s = SKILLS[id];
      const p = progress(xp[id], maxLevel(id));
      const tiers = s.resources || s.recipes || s.monsters;
      const next = tiers.find((r) => r.level > p.level);
      let tool = null;
      if (s.tool) {
        const toolTiers = this.toolTiers(id);
        const tier = this.toolTier(userId, id);
        const nextTool = toolTiers[tier + 1];
        tool = {
          id: s.tool.id,
          kind: s.tool.name,
          failWord: s.tool.failWord || 'fail',
          stats: s.tool.stats,
          tier: tier + 1,
          tiers: toolTiers.length,
          ...toolTiers[tier],
          next: nextTool ? { name: nextTool.name, icon: nextTool.icon, level: nextTool.level, cost: nextTool.cost } : null,
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
        type: s.type,
        nextUnlock: next ? { level: next.level, item: unlockName(next), icon: next.item ? ITEMS[next.item].icon : next.icon } : null,
      };
    });
    const totalXp = SKILL_IDS.reduce((s, id) => s + xp[id], 0);
    const inventory = Object.entries(this.repo.getInventory(userId))
      .filter(([id]) => ITEMS[id])
      .map(([id, qty]) => ({ id, qty, ...ITEMS[id], value: this.sellValue(id), rare: !!ITEMS[id].rare }))
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
      backpack: this.backpack(userId),
      farm: {
        max: MAX_PLOTS,
        plotCost: this.shopItems().find((x) => x.item === 'farm_plot')?.cost,
        plots: this.farmPlots(userId).map((p) => ({
          ...p,
          crop: p.crop ? { id: p.crop, name: ITEMS[p.crop].name, icon: ITEMS[p.crop].icon } : null,
        })),
      },
      combat: (() => {
        const st = this.combatStats(userId);
        return {
          attack: st.attack,
          defence: st.defence,
          level: st.level,
          worn: GEAR_SLOTS.map((slot) => ({ slot, item: st.worn[slot] ? { id: st.worn[slot], ...ITEMS[st.worn[slot]] } : null })),
        };
      })(),
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
      xpMultiplier: this.cfg.xpMultiplier,
      disabledCommands: this.cfg.disabledCommands || [],
      backpack: this.backpackTiers().map((t, i) => ({ level: i + 1, ...t })),
      shop: this.shopItems(),
      skills: SKILL_IDS.map((id) => {
        const s = SKILLS[id];
        return {
          id,
          name: s.name,
          icon: s.icon,
          command: `${this.cfg.prefix}${s.command}`,
          type: s.type,
          tiers: (s.resources || s.recipes || s.monsters).map((r) => ({
            level: r.level,
            xp: r.xp,
            item: unlockName(r),
            icon: r.item ? ITEMS[r.item].icon : r.icon,
            value: r.item ? this.sellValue(r.item) : undefined,
            kind: r.kind,
            grow: r.grow ? Math.max(1, Math.round(r.grow * (this.cfg.growMultiplier ?? 1))) : undefined,
            seedCost: r.seed ? this.seedPrice(r) : undefined,
            loot: r.loot ? r.loot.map((i) => ({ item: ITEMS[i].name, icon: ITEMS[i].icon, value: this.sellValue(i) })) : undefined,
            stats: r.item && ITEMS[r.item].gear ? { slot: ITEMS[r.item].slot, attack: ITEMS[r.item].attack, defence: ITEMS[r.item].defence, wear: ITEMS[r.item].level } : undefined,
            inputs: r.inputs
              ? Object.entries(r.inputs).map(([i, q]) => ({ qty: q, item: ITEMS[i].name, icon: ITEMS[i].icon }))
              : undefined,
          })),
          maxLevel: maxLevel(id),
          tool: s.tool
            ? {
                id: s.tool.id,
                name: s.tool.name,
                failWord: s.tool.failWord || 'fail',
                stats: s.tool.stats,
                command: `${this.cfg.prefix}upgrade ${s.tool.id}`,
                tiers: this.toolTiers(id),
              }
            : null,
          rares: (s.rares || (s.monsters || []).filter((m) => m.rare).map((m) => ({ ...m.rare, from: m.name }))).map((r) => ({
            item: ITEMS[r.item].name,
            icon: ITEMS[r.item].icon,
            value: this.sellValue(r.item),
            odds: `1 in ${Math.round(1 / r.chance)}`,
            xp: r.xp ?? null,
            from: r.from,
          })),
        };
      }),
    };
  }
}

// Fixed settings built from config, for tests and scripts that don't need live editing.
function staticSettings(config) {
  return {
    game: { xpMultiplier: 1, pointsMultiplier: 1, sellMultiplier: 1, disabledCommands: [], ...config.game },
    all: {},
  };
}

module.exports = { GameEngine };
