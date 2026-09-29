// GameEngine methods: skilling. Mixed into GameEngine.prototype by engine.js.
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
const { RACES } = require('../appearance');

module.exports = {
  // ---- Skilling ----------------------------------------------------------

  runAction(user, skillId, args) {
    // A bare "!smith" just lists what you can make, so it doesn't need (or use) stamina.
    if (SKILLS[skillId].pickBest === false && !args.length) return this.process(user, skillId, args).reply;
    if (skillId === 'cooking' && String(args[0] || '').toLowerCase() === 'all') return this.cookAll(user);
    const now = this.now();
    // Cooking is free once a fire is lit: it's limited by the fire's time left and your raw food.
    const free = !!SKILLS[skillId].needsFire;
    const tired = free ? null : this.staminaCheck(user, now);
    if (tired !== null) return tired || null;

    const skill = SKILLS[skillId];
    const result = this.repo.transaction(() => {
      const r =
        skill.type === 'combat'
          ? this.fight(user, args, skill.command === 'fight' ? null : skillId) // !fight picks, !shoot means archery
          : skill.type === 'burn'
            ? this.burn(user, args)
          : skill.type === 'process'
            ? this.process(user, skillId, args)
          : skill.type === 'course'
            ? this.runCourse(user, args)
            : this.gather(user, skillId, args);
      if (r.consumed) {
        this.repo.setActionAt(user.id, now);
        // (A lucky Agility shortcut makes the lap free.)
        if (!free && !r.refund) this.spendStamina(user, now);
      }
      return r;
    });
    return result.reply;
  },

  // !cook all: cook every raw food in the backpack (up to 100) while the fire burns, in one message.
  cookAll(user) {
    if (!this.fireLeft(user.id)) return this.process(user, 'cooking', []).reply;
    const before = { ...this.repo.getInventory(user.id) };
    const xpBefore = this.repo.getSkills(user.id).cooking;
    let cooked = 0;
    let burnt = 0;
    let last = '';
    // One summary line on the feed and overlay instead of a scene per fish.
    this.quietActivity = true;
    try {
      for (let i = 0; i < 100; i++) {
        const r = this.repo.transaction(() => this.process(user, 'cooking', []));
        if (!r.consumed) {
          last = r.reply;
          break;
        }
        if (/burned the/.test(r.reply)) burnt++;
        else cooked++;
      }
    } finally {
      this.quietActivity = false;
    }
    if (!cooked && !burnt) return last;
    const after = this.repo.getInventory(user.id);
    const made = Object.keys(after).filter((id) => ITEMS[id]?.food && (after[id] || 0) > (before[id] || 0));
    const list = made.map((id) => itemLabel(id, after[id] - (before[id] || 0))).join(', ');
    const xp = this.repo.getSkills(user.id).cooking - xpBefore;
    this.emitActivity(user, { kind: 'action', summary: true, skill: 'cooking', item: made[0] || null, xp, text: `cooked ${cooked} food${burnt ? ` (burned ${burnt})` : ''}` });
    const mealsLeft = this.fireMealsLeft(user.id);
    const out = mealsLeft ? `${minutesLeft(this.fireLeft(user.id))}, ${mealsLeft} meal${mealsLeft === 1 ? '' : 's'} left` : 'cooked all it can, !lightfire again';
    return `🍳 cooked ${cooked}${burnt ? ` (burned ${burnt})` : ''}: ${list || 'nothing'}! +${fmt(xp)} Cooking XP (Cooking ${skillLevel('cooking', this.repo.getSkills(user.id).cooking)}). 🔥 Fire: ${out}.`;
  },

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
      if (this.rng() < r.chance * (tool ? tool.rareBonus : 1) * this.luck(user.id)) {
        drop = r;
        rare = true;
        break;
      }
    }
    if (!drop) drop = target || this.pickResource(unlocked);

    // Bigger hauls as you level: +1 item (and its XP) every gatherBonusLevels levels, if there's room.
    // Rares stay single.
    const every = this.cfg.gatherBonusLevels ?? 50;
    const extra = !rare && every > 0 ? Math.floor(level / every) : 0;
    const qty = Math.max(1, Math.min(1 + extra, bag.capacity - bag.used));
    const result = this.reward(user, skillId, drop.item, drop.xp * qty, { rare, qty });
    // Skinned animals also give their meat, if there's room for it.
    if (drop.meat) {
      const bag = this.backpack(user.id);
      if (bag.used < bag.capacity) {
        const meat = Math.min(qty, bag.capacity - bag.used);
        this.repo.addItem(user.id, drop.meat, meat);
        result.reply = result.reply.replace(/!/, ` and ${itemLabel(drop.meat, meat)}!`);
      } else result.reply += ` (no room for the ${ITEMS[drop.meat].name})`;
    }
    return result;
  },

  // !run [course]: one Agility lap on your best course (or the one you name). No items: XP, action
  // points and, as you level, faster stamina refills. Falls happen less as you level and still give
  // a little XP; now and then you find a shortcut and the lap costs no stamina.
  runCourse(user, args) {
    const skill = SKILLS.agility;
    const level = skillLevel('agility', this.repo.getSkills(user.id).agility);
    const unlocked = skill.resources.filter((r) => r.level <= level);
    let course = unlocked[unlocked.length - 1];
    if (args.length) {
      const q = args.join(' ').toLowerCase();
      const found = skill.resources.find((r) => r.name.toLowerCase() === q || r.id === q.replace(/\s+/g, '_')) || skill.resources.find((r) => r.name.toLowerCase().includes(q));
      if (!found) {
        const shown = skill.resources.filter((r) => r.level <= level || r === skill.resources.find((x) => x.level > level));
        return { consumed: false, reply: `unknown course. Agility courses: ${shown.map((r) => `${r.name} (${r.level})`).join(', ')}` };
      }
      if (found.level > level) return { consumed: false, reply: `you need 🏃 Agility level ${found.level} for ${found.icon} ${found.name} (you are ${level}).` };
      course = found;
    }
    const failChance = Math.max(0.03, 0.15 - level * 0.0015);
    if (this.rng() < failChance) {
      const msg = skill.failMessages[Math.floor(this.rng() * skill.failMessages.length)];
      const gained = this.grantXp(user, 'agility', this.xpFor(Math.max(1, Math.round(course.xp / 4)), null));
      return { consumed: true, reply: `🏃 ${msg} on the ${course.icon} ${course.name}! ${gained.text}` };
    }
    const xpGain = this.xpFor(course.xp, null);
    this.emitActivity(user, { kind: 'action', skill: 'agility', xp: xpGain, text: `ran the ${course.name}` });
    const gained = this.grantXp(user, 'agility', xpGain);
    const shortcut = this.rng() < (this.cfg.agilityShortcutChance ?? 0.05);
    return {
      consumed: true,
      refund: shortcut,
      reply: `🏃 you ran a lap of the ${course.icon} ${course.name}!${shortcut ? ' 🍀 You found a shortcut: this lap was free!' : ''} ${gained.text}`,
    };
  },

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
  },

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
  },

  // Smelting: turns ores from the backpack into ingots (one ore type) and alloys (mixed ores).
  // Always frees backpack space, so it works even when the backpack is full.
  process(user, skillId, args) {
    const base = SKILLS[skillId];
    // Race-only recipes (e.g. the Dwarven Warhammer) are hidden from other races.
    const race = this.appearance(user.id)?.race;
    const skill = { ...base, recipes: base.recipes.filter((r) => !r.race || r.race === race) };
    const level = skillLevel(skillId, this.repo.getSkills(user.id)[skillId]);
    const inv = this.repo.getInventory(user.id);
    if (skill.requires && !inv[skill.requires]) return { consumed: false, reply: this.missingToolMessage(skill) };
    if (skill.needsFire && !this.fireLeft(user.id)) {
      return { consumed: false, reply: `🔥 you need a fire to ${skill.command} on! !lightfire first (a Flint and Steel and logs), then !${skill.command} while it burns.` };
    }
    if (skill.needsFire && this.fireMealsLeft(user.id) <= 0) {
      return { consumed: false, reply: `🔥 your fire has cooked all it can (${this.fireMeals(user.id)} meals a fire; more with Firemaking). !lightfire again to keep cooking.` };
    }
    const hasInputs = (r) => Object.entries(r.inputs).every(([item, qty]) => (inv[item] || 0) >= qty);
    const needs = (r) => Object.entries(r.inputs).map(([i, q]) => `${q} ${ITEMS[i].name}`).join(' + ');
    const missing = (r) => {
      const lacking = Object.entries(r.inputs).filter(([i, q]) => (inv[i] || 0) < q);
      const list = lacking.map(([i, q]) => `${q - (inv[i] || 0)} ${ITEMS[i].name}`).join(' + ');
      const hints = [...new Set(lacking.map(([i]) => GATHER_HINT[i]).filter(Boolean))].join(' / ');
      return `${r.yield ? `${r.yield} ${ITEMS[r.item].name}` : `a ${ITEMS[r.item].name}`} (${r.kind}) needs ${needs(r)}. You're missing ${list}${hints ? ` — try ${hints}` : ''}`;
    };

    let recipe;
    // "!fletch arrows" / "!fletch bow": the best of that kind you can make right now.
    const q = args.join(' ').toLowerCase().trim();
    const group = skill.recipes.filter((r) => r.group && (q === r.group || q === `${r.group}s` || `${q}s` === r.group));
    if (group.length) {
      const unlocked = group.filter((r) => r.level <= level);
      if (!unlocked.length) return { consumed: false, reply: `you need ${skill.icon} ${skill.name} level ${group[0].level} for ${ITEMS[group[0].item].name}.` };
      args = [ITEMS[([...unlocked].reverse().find(hasInputs) || unlocked[0]).item].name];
    }
    if (args.length) {
      const id = findItem(args.join(' '), skill.recipes.map((r) => r.item));
      const other = !id && base.recipes.find((r) => r.race && r.race !== race && r.item === findItem(args.join(' '), [r.item]));
      if (other) return { consumed: false, reply: `only ${RACES[other.race].plural} know how to make the ${ITEMS[other.item].name}! (${this.siteUrl}/#/customize)` };
      if (!id) {
        if (skill.pickBest === false) {
          const eg = skill.example || 'bronze sword (sword, helmet, shield, platelegs, platebody) or !smith skinning knife';
          return { consumed: false, reply: `unknown item. Try e.g. !${skill.command} ${eg}` };
        }
        const opts = [...new Set(skill.recipes.filter((r) => r.level <= level).map((r) => r.word || ITEMS[r.item].name.split(' ')[0].toLowerCase()))].slice(-8);
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

    // Arrows go in your quiver: you need one, with room.
    if (ITEMS[recipe.item].ammo === 'bow') {
      const q = this.quiver(user.id);
      if (!q.capacity) return { consumed: false, reply: `you need a 🧺 Quiver to hold arrows! !buy quiver (${fmt(this.shopItems().find((x) => x.item === 'quiver')?.cost ?? 250)} pts) or !fletch quiver (2 Rabbit Hide).` };
      if (q.arrows + (recipe.yield || 1) > q.capacity) return { consumed: false, reply: `🧺 your quiver is full (${fmt(q.arrows)}/${fmt(q.capacity)} arrows). !shoot some first.` };
    }
    for (const [item, qty] of Object.entries(recipe.inputs)) this.repo.removeItem(user.id, item, qty);
    if (skill.needsFire) this.repo.setSetting(this.fireMealsKey(user.id), this.fireMealsLeft(user.id) - 1);
    const fire = skill.needsFire ? ` 🔥 Fire: ${minutesLeft(this.fireLeft(user.id))}, ${this.fireMealsLeft(user.id)} meal${this.fireMealsLeft(user.id) === 1 ? '' : 's'} left.` : '';
    // Cooking: likely to burn at the recipe's level, rarely 50+ levels above it. Burnt food is lost.
    if (skill.burnable && this.rng() < clamp(0.3 - (level - recipe.level) * 0.0056, 0.02, 0.3)) {
      const inputs = Object.keys(recipe.inputs);
      const burnt = inputs.length > 1 ? ITEMS[recipe.item].name : ITEMS[inputs[0]].name;
      return { consumed: true, reply: `🔥 oops, you burned the ${burnt}! It's ruined. Keep practising, you burn less as you level.${fire}` };
    }
    const done = this.reward(user, skillId, recipe.item, recipe.xp, { rare: false, qty: recipe.yield || 1 });
    return { ...done, reply: `${done.reply}${fire}` };
  },

  // !lightfire [log]: burn a log from your backpack with your Flint and Steel. Uses the best log you
  // can burn unless you name one. A small chance the fire won't catch (nothing is used up then);
  // a lit fire uses one log and one of the flint's uses, and leaves Ashes.
  burn(user, args) {
    const skill = SKILLS.firemaking;
    const level = skillLevel('firemaking', this.repo.getSkills(user.id).firemaking);
    const inv = this.repo.getInventory(user.id);
    const flint = this.shopItems().find((x) => x.item === 'flint_and_steel');
    if (!inv.flint_and_steel) {
      return { consumed: false, reply: `you need a 🪨 Flint and Steel in your backpack to light a fire! !buy flint${flint ? ` (${fmt(flint.cost)} pts)` : ''}.` };
    }
    const logs = skill.resources.filter((r) => inv[r.item]);
    let log;
    if (args.length) {
      const id = findItem(args.join(' '), skill.resources.map((r) => r.item));
      if (!id) return { consumed: false, reply: `unknown log. You can burn: ${skill.resources.filter((r) => r.level <= level).map((r) => ITEMS[r.item].name).join(', ')}` };
      log = skill.resources.find((r) => r.item === id);
      if (log.level > level) return { consumed: false, reply: `you need 🔥 Firemaking level ${log.level} to burn ${ITEMS[id].name} (you are ${level}).` };
      if (!inv[id]) return { consumed: false, reply: `you don't have any ${ITEMS[id].name}. Try !chop ${ITEMS[id].name.split(' ')[0].toLowerCase()}.` };
    } else {
      log = [...logs].reverse().find((r) => r.level <= level);
      if (!log) {
        return {
          consumed: false,
          reply: logs.length
            ? `you need 🔥 Firemaking level ${logs[0].level} to burn ${ITEMS[logs[0].item].name} (you are ${level}). !chop some plain Logs to start.`
            : 'no logs in your backpack! !chop some first.',
        };
      }
    }
    const failChance = Math.max(0.03, 0.1 - level * 0.0015);
    if (this.rng() < failChance) {
      const msg = skill.failMessages[Math.floor(this.rng() * skill.failMessages.length)];
      return { consumed: true, reply: `🔥 ${msg}... try again!` };
    }
    // Use up the log and one of the flint's uses; it's gone after its last one.
    const maxUses = ITEMS.flint_and_steel.uses;
    const used = (this.repo.getEquipment(user.id).flint_used || 0) + 1;
    const wornOut = used >= maxUses;
    this.repo.removeItem(user.id, log.item, 1);
    this.repo.addItem(user.id, 'ashes', 1);
    if (wornOut) this.repo.removeItem(user.id, 'flint_and_steel', 1);
    this.repo.setEquipment(user.id, 'flint_used', wornOut ? 0 : used);
    // The fire burns for a while: 5 minutes, plus a minute per log tier. Cook on it with !cook.
    const minutes = 5 + SKILLS.firemaking.resources.indexOf(log);
    const until = Math.max(this.now() + minutes * 60_000, this.now() + this.fireLeft(user.id));
    // Each fire cooks a limited number of meals (more with Firemaking); relighting adds another fire's worth.
    const meals = this.fireMealsLeft(user.id) + this.fireMeals(user.id);
    this.repo.setSetting(this.fireKey(user.id), until);
    this.repo.setSetting(this.fireMealsKey(user.id), meals);
    const xpGain = this.xpFor(log.xp);
    this.emitActivity(user, { kind: 'action', skill: 'firemaking', item: log.item, xp: xpGain, text: `burned ${ITEMS[log.item].name}` });
    const gained = this.grantXp(user, 'firemaking', xpGain);
    const flintNote = wornOut
      ? ` 🪨 Your Flint and Steel wore out! !buy flint${flint ? ` (${fmt(flint.cost)} pts)` : ''} for another.`
      : ` 🪨 ${maxUses - used}/${maxUses} uses left.`;
    return {
      consumed: true,
      reply: `🔥 you lit a fire with ${itemLabel(log.item)} and got ${itemLabel('ashes')}! ${gained.text} It burns for ${minutesLeft(until - this.now())} and can cook ${meals} meal${meals === 1 ? '' : 's'}: !cook on it.${flintNote}`,
    };
  },

  // ---- Fires (for cooking) --------------------------------------------------------
  fireKey(userId) {
    return `fire:${userId}`;
  },

  // Milliseconds your fire keeps burning (0 = no fire).
  fireLeft(userId) {
    return Math.max(0, (this.repo.getSetting(this.fireKey(userId)) || 0) - this.now());
  },

  fireMealsKey(userId) {
    return `firemeals:${userId}`;
  },

  // Meals one fire can cook: fireMealsBase (10) + 1 per fireMealsPerLevels (2) Firemaking levels.
  // Stops one fire (one stamina charge) cooking a whole farm's harvest.
  fireMeals(userId) {
    const level = skillLevel('firemaking', this.repo.getSkills(userId).firemaking);
    const per = this.cfg.fireMealsPerLevels ?? 2;
    return (this.cfg.fireMealsBase ?? 10) + (per > 0 ? Math.floor(level / per) : 0);
  },

  // Meals your current fire can still cook (0 when it's out). A missing count on a burning fire (lit
  // before the limit existed) counts as a fresh fire.
  fireMealsLeft(userId) {
    if (!this.fireLeft(userId)) return 0;
    const left = this.repo.getSetting(this.fireMealsKey(userId));
    return left === null || left === undefined ? this.fireMeals(userId) : left;
  },

  // !fire
  fireInfo(user) {
    const left = this.fireLeft(user.id);
    return left
      ? `🔥 your fire burns for another ${minutesLeft(left)} and can cook ${this.fireMealsLeft(user.id)} more meal${this.fireMealsLeft(user.id) === 1 ? '' : 's'}. !cook while it lasts.`
      : `no fire going. !lightfire to light one (needs a Flint and Steel and logs; each fire cooks ${this.fireMeals(user.id)} meals).`;
  },

  // !eat [food]: cooked food heals HP. With no name, eats the smallest food that fills you up (or
  // your biggest). Food can't get you up from a knockout; only health potions can.
  eat(user, args) {
    const now = this.now();
    const inv = this.repo.getInventory(user.id);
    const owned = Object.keys(inv).filter((id) => ITEMS[id]?.food && inv[id] > 0).sort((a, b) => ITEMS[a].food.heal - ITEMS[b].food.heal);
    const vit = this.vitals(user.id, now);
    if (vit.ko) return `${this.knockedOutMessage(user.id, vit, now)} (Food can't get you up.)`;
    // What a food actually heals you: its heal (halved for Undead), but at most a share of your max HP.
    const heals = (i) => this.mealHeal(user.id, i, vit.maxHp);
    let id;
    if (args.length) {
      id = findItem(args.join(' '), owned);
      if (!id) return owned.length ? `you don't have that. Your food: ${owned.map((i) => ITEMS[i].name).join(', ')}` : 'you have no cooked food. !lightfire then !cook fish, vegetables or meat.';
    } else {
      if (!owned.length) return 'you have no cooked food. !lightfire then !cook fish, vegetables or meat.';
      const missing = vit.maxHp - vit.hp;
      id = owned.find((i) => heals(i) >= missing) || owned[owned.length - 1];
    }
    if (vit.hp >= vit.maxHp) return `you're already at full health. ${this.vitalsLine(vit)}`;
    const hp = Math.min(vit.maxHp, vit.hp + heals(id));
    const buff = ITEMS[id].food.buff;
    this.repo.transaction(() => {
      this.repo.removeItem(user.id, id, 1);
      this.repo.setVitals(user.id, { hp, mana: vit.mana, koUntil: 0 }, now);
      if (buff) this.addBuff(user.id, buff, now);
    });
    const fed = buff ? ` ${BUFFS[buff].icon} ${BUFFS[buff].name} for ${BUFFS[buff].minutes} min: ${BUFFS[buff].text}.` : '';
    return `${ITEMS[id].icon} you ate ${/^[AEIOU]/.test(ITEMS[id].name) ? 'an' : 'a'} ${ITEMS[id].name} (+${fmt(Math.round(hp - vit.hp))} HP). ${this.vitalsLine(this.vitals(user.id, now))}${fed}`;
  },

  // HP one meal of this food restores for this player.
  mealHeal(userId, itemId, maxHp = this.vitals(userId).maxHp) {
    const cap = Math.round(maxHp * (this.cfg.foodHealCap ?? 0.3));
    return Math.min(cap, Math.round(ITEMS[itemId].food.heal * this.perks(userId).food));
  },

  // Uses left on a player's Flint and Steel (null if they don't have one).
  flintUses(userId) {
    if (!this.repo.getInventory(userId).flint_and_steel) return null;
    return ITEMS.flint_and_steel.uses - (this.repo.getEquipment(userId).flint_used || 0);
  },

  reward(user, skillId, item, baseXp, { rare, qty: baseQty = 1 }) {
    const skill = SKILLS[skillId];
    const tool = this.currentTool(user.id, skillId);
    const xpGain = this.xpFor(baseXp, tool);
    // Better furnaces sometimes make two (only if there's room in the backpack for the extra one).
    let qty = baseQty;
    if (baseQty === 1 && tool?.doubleChance > 0 && this.rng() < tool.doubleChance) {
      const bagNow = this.backpack(user.id);
      if (bagNow.used + 1 < bagNow.capacity) qty = 2;
    }
    this.repo.addItem(user.id, item, qty);
    // "cooked Rabbit Meat", not "cooked Cooked Rabbit Meat".
    const name = ITEMS[item].name.replace(new RegExp(`^${skill.verb} `, 'i'), '');
    const text = `${skill.verb} ${rare ? 'a RARE ' : ''}${name}`;
    this.emitActivity(user, { kind: rare ? 'rare' : 'action', skill: skillId, item, xp: xpGain, text });
    const gained = this.grantXp(user, skillId, xpGain);
    const reply = `${skill.icon} you ${skill.verb} ${rare ? 'a RARE ' : ''}${itemLabel(item, qty)}!${qty > baseQty ? ' (double!)' : ''} ${gained.text}`;
    return { consumed: true, reply: reply + this.fullBagNote(user.id) };
  },

  xpFor(baseXp, tool) {
    return Math.max(1, Math.round(baseXp * (1 + (tool?.xpBonus || 0)) * this.cfg.xpMultiplier * this.boostMultiplier('xp')));
  },

  // Adds XP and action points; returns "+X XP, +Y pts" plus level-up / progress text for the reply.
  // { points: false } gives XP only (gathering stations).
  grantXp(user, skillId, xpGain, { points: withPoints = true } = {}) {
    const skill = SKILLS[skillId];
    // Race perk (e.g. Dwarves +15% Mining XP).
    // Race perk (e.g. Dwarves +15% Mining XP), active pet (+5%) and prestige (+5% each).
    xpGain = Math.max(1, Math.round(xpGain * this.raceXp(user.id, skillId) * this.petXp(user.id, skillId) * this.prestigeXp(user.id, skillId) * (this.guildWarXp?.(user.id) ?? 1)));
    // Bone Brew: +20% XP while it lasts.
    if (this.hasBuff(user.id, 'focus')) xpGain = Math.round(xpGain * 1.2);
    // Well Fed (monster dishes): +5% XP.
    if (this.hasBuff(user.id, 'wellfed')) xpGain = Math.round(xpGain * 1.05);
    const before = this.repo.getSkills(user.id);
    const levelBefore = skillLevel(skillId, before[skillId]);
    const charBefore = characterProgress(SKILL_IDS.map((id) => before[id])).level;
    const points = withPoints ? Math.round(Math.max(1, xpGain / 10) * this.cfg.pointsMultiplier) : 0;
    this.repo.addXp(user.id, skillId, xpGain);
    this.repo.addSeasonXp(user.id, xpGain);
    if (points > 0) this.repo.addPoints(user.id, points);
    this.track('actions', points);

    const xpAfter = before[skillId] + xpGain;
    const levelAfter = skillLevel(skillId, xpAfter);
    // (Checked on every gain, so players who levelled before achievements existed still get them.)
    this.checkLevelAchievements(user);
    const charAfter = characterProgress(SKILL_IDS.map((id) => before[id] + (id === skillId ? xpGain : 0))).level;

    let text = withPoints ? `+${xpGain} XP, +${points} pts` : `+${xpGain} XP`;
    if (levelAfter > levelBefore) {
      text += ` 🎉 ${skill.name} level ${levelAfter}!`;
      const unlocks = (skill.resources || skill.recipes || skill.monsters).filter((r) => r.level > levelBefore && r.level <= levelAfter);
      if (unlocks.length) text += ` Unlocked: ${unlocks.slice(0, 5).map(unlockName).join(', ')}${unlocks.length > 5 ? '…' : ''}.`;
      if (skill.tool && this.canUpgrade(user.id, skillId, levelAfter) && !this.canUpgrade(user.id, skillId, levelBefore)) {
        text += ` 🔧 You can now !upgrade ${skill.tool.id}!`;
      }
      this.emitActivity(user, { kind: 'levelup', skill: skillId, text: `reached ${skill.name} level ${levelAfter}` });
      if (levelAfter >= maxLevel(skillId)) this.recordFirst('max', skillId, user);
    } else {
      text += ` (${skill.name} ${levelAfter}, ${progress(xpAfter, maxLevel(skillId)).percent}%)`;
    }
    if (charAfter > charBefore) {
      text += ` ⭐ Character level ${charAfter}!`;
      this.emitActivity(user, { kind: 'charlevel', text: `reached character level ${charAfter}` });
    }
    this.noteStreamXp?.(user, xpGain);
    const pet = this.rollPet(user, skillId);
    if (pet) text += ` 🐾 RARE PET: ${pet.icon} ${pet.name}!`;
    return { points, text };
  },

  fullBagNote(userId) {
    const bag = this.backpack(userId);
    return bag.used >= bag.capacity ? ` 🎒 Backpack full (${bag.used}/${bag.capacity})!` : '';
  },
};
