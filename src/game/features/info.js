// GameEngine methods: info. Mixed into GameEngine.prototype by engine.js.
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
    const title = target.title ? ` "${target.title}"` : '';
    return `${who}${title} character level ${profile.character.level} | ${skills} | Total ${profile.totalLevel} | ${fmt(profile.points)} pts | ${this.siteUrl}/#/player/${encodeURIComponent(target.username)}`;
  },

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
  },

  points(user) {
    const u = this.repo.getUser(user.id);
    return `you have ${fmt(u.points)} points 💰`;
  },

  // !sell all | !sell <item> [qty|all]
  sell(user, args) {
    const inv = this.repo.getInventory(user.id);
    if (!args.length) return 'usage: !sell <item> [amount] or !sell all';
    const named = args.filter((w) => !/^(\d+|all)$/i.test(w)).join(' ');
    const bound = named && findItem(named, Object.keys(inv).filter((i) => ITEMS[i]?.bound || ITEMS[i]?.pet));
    if (bound) return `your ${ITEMS[bound].name} can't be sold.`;

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
        // The price slides down as this sale adds to the channel's recent selling (prices.js).
        sum += this.saleTotal(id, qty, user.id);
        this.addSupply(id, qty);
      }
      this.repo.addPoints(user.id, sum);
      this.track('sold', sum);
      return sum;
    });
    const count = entries.reduce((s, [, q]) => s + q, 0);
    const single = entries.length === 1;
    const what = single ? itemLabel(entries[0][0], entries[0][1]) : `${fmt(count)} items`;
    const plain = single ? `${fmt(entries[0][1])}x ${ITEMS[entries[0][0]].name}` : what;
    this.emitActivity(user, { kind: 'sell', text: `sold ${plain} for ${fmt(total)} pts` });
    const keptNote = kept ? ' (kept your gear & tools)' : '';
    return `sold ${what} for ${fmt(total)} pts 💰 Balance: ${fmt(this.repo.getUser(user.id).points)}${keptNote}`;
  },

  // !sellall: same as !sell all.
  sellAll(user) {
    return this.sell(user, ['all']);
  },

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
  },

  help() {
    const p = this.cfg.prefix;
    const off = this.cfg.disabledCommands || [];
    const on = (list) => list.filter((c) => !off.includes(c)).map((c) => `${p}${c}`).join(' ');
    const skills = on(SKILL_IDS.flatMap((id) => (SKILLS[id].type === 'farm' ? ['plant', 'harvest'] : [SKILLS[id].command])));
    const tools = Object.keys(TOOL_TO_SKILL).join('/');
    // Kept under Kick's 500 characters: the full list is on the site's guide.
    return `Skills: ${skills} | Gear: ${p}shop ${p}buy ${p}equip ${p}upgrade | Fight: ${on(['targets', 'hp', 'stamina', 'drink', 'eat'])} | Daily: ${on(['daily', 'tasks', 'title', 'give'].filter((c) => c !== 'tasks' || !off.includes('daily')))} | Info: ${on(['stats', 'inv', 'sell', 'top'])}${this.cfg.casinoEnabled === false ? '' : ` ${p}casino`} | All commands: ${this.siteUrl}/#/guide`;
  },
};
