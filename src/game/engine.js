const { EventEmitter } = require('node:events');
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
} = require('./features/shared');
const { RACES } = require('./appearance');
const { QUESTS, PETS, RACE_ITEMS } = require('./content');

class GameEngine extends EventEmitter {
  // settings: a Settings instance (live, admin-editable). Tests may pass a plain { game, all } object.
  constructor({ repo, config, settings, rng = Math.random, petRng = Math.random, now = () => Date.now() }) {
    super();
    this.repo = repo;
    this.settings = settings || staticSettings(config);
    this.siteUrl = config.baseUrl;
    this.rng = rng;
    // Pet drops use their own dice, so they never shift the game's other rolls.
    this.petRng = petRng;
    this.now = now;
    this.cooldownWarned = new Map(); // userId -> stamina refill we already warned about
    this.lastBet = new Map(); // userId -> time of last casino bet (casino cooldown)
    this.betWarned = new Map();
    this.fightWarned = new Map(); // userId -> { monster, at }: "type it again to fight anyway"
    this.lastChat = new Map(); // userId -> their last message (no points for repeats)
  }

  get cfg() {
    return this.settings.game;
  }

  // Entry point for every chat message. Returns { reply } where reply may be null.
  // badges: Kick's badge types on the message (e.g. "subscriber", "founder", "moderator").
  handleChat({ kickUserId, username, avatarUrl = null, content, badges = null }) {
    if (!kickUserId || !username || typeof content !== 'string') return { reply: null };
    const user = this.repo.upsertUser({ kickUserId, username, avatarUrl });
    // Banned from the game by an admin: chat is ignored entirely.
    if (user.banned) return { reply: null };
    if (Array.isArray(badges)) {
      const sub = badges.some((b) => ['subscriber', 'founder', 'sub_gifter'].includes(String(b).toLowerCase())) ? 1 : 0;
      if (sub !== user.subscriber) this.repo.setUserField(user.id, 'subscriber', sub);
      user.subscriber = sub;
    }
    this.repo.chatTick(user.id);
    this.noteChatter(user);
    this.awardChatPoints(user, content);

    const { prefix, disabledCommands = [] } = this.cfg;
    // Emotes in a command are decoration: "!mine [emote:1:KEKW] iron" is "!mine iron".
    const clean = emotes.stripEmotes(content);
    // Emote shortcuts (admin setting): a message with e.g. the hydroponiczcobble emote counts as !mine.
    const text = clean.startsWith(prefix) ? clean : this.emoteCommand(content);
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
    if (reply) this.checkWealth(user);
    return { reply: reply ? `@${user.username} ${reply}` : null };
  }

  // The emote shortcuts in effect, parsed from the setting (bad entries are skipped).
  emoteShortcuts() {
    const list = this.cfg.emoteCommands || [];
    if (this._emoteCache?.list !== list) this._emoteCache = { list, shortcuts: emotes.parseEmoteCommands(list, isChatCommand).shortcuts };
    return this._emoteCache.shortcuts;
  }

  // Turns a message with a shortcut emote into a command: "[emote:1:hydroponiczcobble] iron" ->
  // "!mine iron". Kick sends emotes as "[emote:12345:name]"; people may also type ":name:" or start
  // the message with the name.
  emoteCommand(content) {
    const found = emotes.findShortcut(content, this.emoteShortcuts());
    if (!found) return null;
    const { shortcut, words, atStart } = found;
    const args = shortcut.args.length ? shortcut.args : this.emoteArgs(shortcut.command, words, atStart);
    return `${this.cfg.prefix}${[shortcut.command, ...args].join(' ')}`;
  }

  // Words after a shortcut emote become the command's target only if they are one: "[cobble] iron"
  // mines iron, "[cobble] giant rat" (mapped to fight) fights a Giant Rat, but "[cobble] this is fun"
  // just mines. Other commands take the words as they are when the emote starts the message.
  emoteArgs(command, words, atStart) {
    if (!words.length) return [];
    const targets = this.targetPhrases(command);
    if (!targets) return atStart ? words : [];
    for (let n = Math.min(4, words.length); n > 0; n--) {
      if (targets.has(words.slice(0, n).join(' ').toLowerCase())) return words.slice(0, n);
    }
    return [];
  }

  // Everything a player can name as the target of a skill command, lowercased: full names, first
  // and last words ("iron", "oak", "rat"), ids and groups ("arrows"). null for other commands.
  targetPhrases(command) {
    this._targetCache ??= {};
    if (command in this._targetCache) return this._targetCache[command];
    const skillId = command === 'plant' ? 'farming' : COMMAND_TO_SKILL[command];
    const skill = SKILLS[skillId];
    let set = null;
    if (skill && command !== 'harvest') {
      set = new Set();
      const add = (name) => {
        const n = name.toLowerCase();
        const parts = n.split(' ');
        for (const p of [n, n.replace(/_/g, ' '), parts[0], parts[parts.length - 1]]) set.add(p);
      };
      for (const r of skill.resources || skill.recipes || []) {
        add(ITEMS[r.item].name);
        add(r.item);
        if (r.group) [r.group, `${r.group}s`].forEach((g) => set.add(g));
      }
      for (const m of skill.monsters || []) {
        add(m.name);
        add(m.id);
      }
    }
    return (this._targetCache[command] = set);
  }

  // Points for chatting, rate-limited. To make farming with spam or alt accounts pointless: very
  // short messages and a repeat of your last message earn nothing, and brand-new chatters can be
  // made to wait before earning. Subscribers earn more.
  awardChatPoints(user, content = '') {
    const now = this.now();
    const c = this.cfg;
    const text = emotes.stripEmotes(content).toLowerCase();
    const last = this.lastChat.get(user.id);
    this.lastChat.set(user.id, text);
    if (this.lastChat.size > 5000) this.lastChat.delete(this.lastChat.keys().next().value);
    if (text.replace(/\s/g, '').length < (c.chatPointsMinChars ?? 0)) return;
    if (c.chatPointsNoRepeats !== false && text && text === last) return;
    if (c.chatPointsNewUserMinutes && Date.now() - user.created_at < c.chatPointsNewUserMinutes * 60_000) return;
    if (now - user.last_chat_points_at < c.chatCooldown * 1000) return;
    const points = Math.round(c.chatPoints * (user.subscriber ? (c.subChatMultiplier ?? 1) : 1) * this.boostMultiplier('points'));
    this.repo.addPoints(user.id, points);
    this.repo.setChatPointsAt(user.id, now);
    this.track('chat', points);
  }

  // A running economy counter for the admin Economy page (chat, actions, sold, shop, casino...).
  track(kind, amount) {
    if (!amount) return;
    this.econ ??= this.repo.getSetting('economy_stats') || { since: this.now() };
    this.econ[kind] = (this.econ[kind] || 0) + amount;
    this.econDirty = true;
    // Written at most every few seconds (and by flushEconomy on shutdown).
    if (!this.econTimer) {
      this.econTimer = setTimeout(() => this.flushEconomy(), 5000);
      this.econTimer.unref?.();
    }
  }

  flushEconomy() {
    clearTimeout(this.econTimer);
    this.econTimer = null;
    if (this.econDirty && this.econ) this.repo.setSetting('economy_stats', this.econ);
    this.econDirty = false;
  }

  // Channel-wide boosts (e.g. double XP after gifted subs). kind: 'xp' or 'points'.
  boostMultiplier(kind) {
    const b = this.repo.getSetting('global_boost');
    return b && b.until > this.now() && b.kind === kind ? b.multiplier : 1;
  }

  emitActivity(user, entry) {
    // (Bulk actions like !cook all post one summary instead of an entry per item.)
    if (this.quietActivity && ['action', 'rare'].includes(entry.kind)) {
      this.onActivity?.(user, entry);
      return;
    }
    const id = this.repo.logActivity({ userId: user.id, ...entry });
    // The overlay draws the player's character doing the action, so it gets their look and the item's icon.
    const look = this.characterView(user.id);
    this.emit('activity', {
      id,
      username: user.username,
      created_at: this.now(),
      skill: null,
      item: null,
      xp: 0,
      icon: entry.item ? ITEMS[entry.item]?.icon : undefined,
      appearance: look || undefined,
      ...entry,
    });
    // Daily tasks and achievements watch the activity feed.
    this.onActivity?.(user, entry);
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
      .map(([id, qty]) => ({
        id,
        qty,
        ...ITEMS[id],
        value: this.sellValue(id, userId),
        rare: !!ITEMS[id].rare,
        ...(id === 'flint_and_steel' ? { usesLeft: this.flintUses(userId) } : {}),
        ...(ITEMS[id].potion?.buff ? { effect: BUFFS[ITEMS[id].potion.buff] } : {}),
      }))
      .sort((a, b) => b.value * b.qty - a.value * a.qty);
    return {
      id: user.id,
      username: user.username,
      title: user.title || '',
      subscriber: Boolean(user.subscriber),
      seasonXp: user.season_xp || 0,
      progression: this.progressionFor(userId),
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
      museum: this.museumProgress(userId).map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
        reward: c.reward,
        title: c.title,
        done: c.done,
        items: c.items.map((i) => ({ id: i, name: ITEMS[i].name, icon: ITEMS[i].icon, have: c.have.includes(i) })),
      })),
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
        const vit = this.vitals(userId);
        return {
          attack: st.attack,
          defence: st.defence,
          archeryBonus: st.archeryBonus,
          level: st.level,
          hp: Math.floor(vit.hp),
          maxHp: vit.maxHp,
          mana: Math.floor(vit.mana),
          maxMana: vit.maxMana,
          knockedOutUntil: vit.ko ? vit.koUntil : null,
          hpRegenHours: this.cfg.hpRegenHours,
          // Timed effects from undead potions.
          buffs: Object.entries(this.activeBuffs(userId)).map(([id, until]) => ({ ...BUFFS[id], until })),
          // What !fight would use, so the ratings below say which weapon they're for.
          ratedWith: (() => {
            const pick = this.chooseWeapon(userId);
            return pick.weapon ? `${SKILLS[pick.skillId].name} ${pick.level} · ${ITEMS[pick.weapon].name}${pick.arrow ? ` + ${ITEMS[pick.arrow].name}` : ''}` : null;
          })(),
          // Every monster rated for this player (with their best usable weapon, or bare hands).
          monsters: (() => {
            const pick = this.chooseWeapon(userId);
            const skillId = pick.skillId || COMBAT_SKILLS[0];
            const level = pick.level || this.combatLevel(userId);
            const stats = pick.weapon ? this.fightStats(userId, pick) : { attack: 0, defence: st.defence };
            return SKILLS[skillId].monsters.map((m) => {
              const o = this.assessFight(level, stats, m, vit.maxHp);
              return { id: m.id, name: m.name, icon: m.icon, level: m.level, hp: m.hp, xp: this.xpFor(m.xp), rating: o.rating.id, label: o.rating.label, ratingIcon: o.rating.icon, cost: o.canWin ? Math.round(o.cost * 100) : null };
            });
          })(),
          worn: GEAR_SLOTS.map((slot) => ({ slot, item: st.worn[slot] ? { id: st.worn[slot], ...ITEMS[st.worn[slot]] } : null })),
        };
      })(),
      stamina: this.stamina(userId),
      appearance: this.publicAppearance(userId),
      quests: this.publicQuests(userId),
    };
  }

  // Static game data for the "How to play" page.
  guide() {
    return {
      prefix: this.cfg.prefix,
      staminaMax: this.cfg.staminaMax,
      staminaMinutes: this.cfg.staminaMinutes,
      races: this.appearanceOptions().races,
      quests: QUESTS.map((q) => ({ name: q.name, icon: q.icon, reward: q.reward, title: q.title, steps: q.steps.map((s) => `${s.text} ×${s.qty}`) })),
      pets: PETS.map((p) => ({ name: p.name, icon: p.icon, skill: SKILLS[p.skill].name })),
      raceItems: RACE_ITEMS.map((r) => ({ race: RACES[r.race].name, name: ITEMS[r.item].name, icon: ITEMS[r.item].icon, skill: SKILLS[r.skill].name, level: r.level })),
      prestigeLevel: this.cfg.prestigeLevel ?? 100,
      marketFee: this.cfg.marketFee ?? 0.05,
      raceChangeDays: this.cfg.raceChangeDays ?? 30,
      racePerks: this.cfg.racePerks !== false,
      chatPoints: this.cfg.chatPoints,
      chatCooldown: this.cfg.chatCooldown,
      xpMultiplier: this.cfg.xpMultiplier,
      disabledCommands: this.cfg.disabledCommands || [],
      backpack: this.backpackTiers().map((t, i) => ({ level: i + 1, ...t })),
      shop: this.shopItems(),
      // Undead potions and what they do.
      buffs: Object.values(ITEMS)
        .filter((i) => i.potion?.buff)
        .map((i) => ({ potion: i.name, icon: i.icon, ...BUFFS[i.potion.buff] })),
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
            hp: r.hp,
            heal: r.item ? ITEMS[r.item].food?.heal : undefined,
            grow: r.grow ? Math.max(1, Math.round(r.grow * (this.cfg.growMultiplier ?? 1))) : undefined,
            seedCost: r.seed ? this.seedPrice(r) : undefined,
            loot: r.loot ? r.loot.map((i) => ({ item: ITEMS[i].name, icon: ITEMS[i].icon, value: this.sellValue(i) })) : undefined,
            stats: r.item && (ITEMS[r.item].gear || ITEMS[r.item].ammo) ? { slot: ITEMS[r.item].slot, attack: ITEMS[r.item].attack, defence: ITEMS[r.item].defence, wear: ITEMS[r.item].level, skill: ITEMS[r.item].wieldSkill, ammo: !!ITEMS[r.item].ammo } : undefined,
            race: r.race ? RACES[r.race].name : undefined,
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
    game: { xpMultiplier: 1, pointsMultiplier: 1, sellMultiplier: 1, hpRegenHours: 24, manaRegenHours: 2, disabledCommands: [], ...config.game },
    all: {},
  };
}

// Is this a chat command (without the prefix)? Used to check emote shortcuts.
function isChatCommand(word) {
  return Boolean(COMMAND_TO_SKILL[word] || INFO_COMMANDS[word]);
}

// Feature modules add their methods to the engine.
for (const mod of ['skilling', 'combat', 'vitals', 'shop', 'farming', 'info', 'casinoGames', 'events', 'museum', 'progression', 'character', 'community', 'market']) {
  Object.assign(GameEngine.prototype, require(`./features/${mod}`));
}

module.exports = { GameEngine, isChatCommand };
