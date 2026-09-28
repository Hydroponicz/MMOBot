// GameEngine methods: guilds (clans). Mixed into GameEngine.prototype by engine.js.
// A guild has a tag, a bank of points and a weekly goal (actions by its members) that pays into the bank.
const { fmt } = require('./shared');

const GUILD_COST = 10_000;
const MAX_MEMBERS = 30;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 '-]{1,22}[A-Za-z0-9]$/;
const TAG = /^[A-Z0-9]{2,4}$/;

module.exports = {
  guildCost() {
    return this.cfg.guildCost ?? GUILD_COST;
  },

  // Weekly goal: 100 actions per member (at least 200). Reaching it pays 5,000 + 500 per member.
  guildWeekTarget(members) {
    return Math.max(200, 100 * members);
  },

  guildWeekReward(members) {
    return 5000 + 500 * members;
  },

  guildWeek(g) {
    const week = this.weekIndex();
    return g.week === week ? { actions: g.week_actions, done: !!g.week_done } : { actions: 0, done: false };
  },

  publicGuild(g, withMembers = false) {
    if (!g) return null;
    const members = this.repo.guildMembers(g.id);
    const week = this.guildWeek(g);
    return {
      id: g.id,
      name: g.name,
      tag: g.tag,
      bank: g.bank,
      owner: members.find((m) => m.user_id === g.owner_id)?.username || null,
      members: members.length,
      xp: members.reduce((s, m) => s + m.xp, 0),
      seasonXp: members.reduce((s, m) => s + m.season_xp, 0),
      week: { ...week, target: this.guildWeekTarget(members.length), reward: this.guildWeekReward(members.length) },
      list: withMembers ? members.map((m) => ({ id: m.user_id, username: m.username, role: m.role, xp: m.xp, appearance: this.characterView(m.user_id) })) : undefined,
    };
  },

  guildList() {
    return this.repo.guildList().map((g, i) => ({ rank: i + 1, id: g.id, name: g.name, tag: g.tag, members: g.members, xp: g.xp, seasonXp: g.season_xp, bank: g.bank }));
  },

  guildCreate(user, name, tag) {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    if (!NAME.test(name)) return { ok: false, error: 'guild names are 3-24 letters, numbers, spaces, - or \'.' };
    tag = String(tag || name.split(' ').map((w) => w[0]).join('').slice(0, 4) || name.slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (tag.length < 2) tag = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
    if (!TAG.test(tag)) return { ok: false, error: 'tags are 2-4 letters or numbers.' };
    if (this.repo.guildOf(user.id)) return { ok: false, error: "you're already in a guild. Leave it first." };
    if (this.repo.guildByName(name)) return { ok: false, error: 'that name is taken.' };
    const cost = this.guildCost();
    if (this.repo.getUser(user.id).points < cost) return { ok: false, error: `starting a guild costs ${fmt(cost)} pts.` };
    const id = this.repo.transaction(() => {
      this.repo.addPoints(user.id, -cost);
      return this.repo.guildCreate(name, tag, user.id, this.now());
    });
    this.track('shop', cost);
    this.emitActivity(user, { kind: 'guild', text: `founded the guild [${tag}] ${name}! 🛡️` });
    return { ok: true, id, message: `You founded [${tag}] ${name}! Others join with ${this.cfg.prefix}guild join ${name}.` };
  },

  guildJoinByName(user, name) {
    const g = this.repo.guildByName(String(name || '').trim()) || this.repo.guildList().find((x) => x.tag.toLowerCase() === String(name || '').trim().toLowerCase());
    if (!g) return { ok: false, error: `no guild called "${name}". ${this.cfg.prefix}guild top lists them.` };
    return this.guildJoinId(user, g.id);
  },

  guildJoinId(user, id) {
    const g = this.repo.guildGet(Number(id));
    if (!g) return { ok: false, error: 'no such guild.' };
    if (this.repo.guildOf(user.id)) return { ok: false, error: "you're already in a guild. Leave it first." };
    if (this.repo.guildMembers(g.id).length >= MAX_MEMBERS) return { ok: false, error: `[${g.tag}] ${g.name} is full (${MAX_MEMBERS}).` };
    this.repo.guildJoin(user.id, g.id, this.now());
    this.emitActivity(user, { kind: 'guild', text: `joined the guild [${g.tag}] ${g.name}` });
    return { ok: true, message: `Welcome to [${g.tag}] ${g.name}!` };
  },

  // The owner leaving hands the guild to the longest-serving member; the last one out closes it
  // (and takes whatever is left in the bank).
  guildLeave(user) {
    const g = this.repo.guildOf(user.id);
    if (!g) return { ok: false, error: "you're not in a guild." };
    const others = this.repo.guildMembers(g.id).filter((m) => m.user_id !== user.id).sort((a, b) => a.joined_at - b.joined_at);
    this.repo.transaction(() => {
      this.repo.guildLeave(user.id);
      if (!others.length) {
        if (g.bank) this.repo.addPoints(user.id, g.bank);
        this.repo.guildDelete(g.id);
      } else if (g.owner_id === user.id) {
        this.repo.guildSet(g.id, 'owner_id', others[0].user_id);
        this.repo.guildSetRole(others[0].user_id, 'owner');
      }
    });
    if (!others.length) return { ok: true, message: `You closed [${g.tag}] ${g.name}${g.bank ? ` and took the ${fmt(g.bank)} pts in its bank` : ''}.` };
    return { ok: true, message: `You left [${g.tag}] ${g.name}.${g.owner_id === user.id ? ` ${others[0].username} leads it now.` : ''}` };
  },

  guildKick(user, targetName) {
    const g = this.repo.guildOf(user.id);
    if (!g || g.owner_id !== user.id) return { ok: false, error: 'only the guild leader can do that.' };
    const target = this.repo.getUserByName(String(targetName || '').replace(/^@/, ''));
    if (!target || target.id === user.id || this.repo.guildOf(target.id)?.id !== g.id) return { ok: false, error: "they're not in your guild." };
    this.repo.guildLeave(target.id);
    this.notify(target.id, `You were removed from the guild [${g.tag}] ${g.name}.`);
    return { ok: true, message: `${target.username} is no longer in [${g.tag}].` };
  },

  guildDeposit(user, amount) {
    const g = this.repo.guildOf(user.id);
    if (!g) return { ok: false, error: "you're not in a guild." };
    amount = Math.floor(Number(amount));
    if (!(amount > 0)) return { ok: false, error: 'how many points?' };
    const blocked = this.marketBlocked(user.id);
    if (blocked) return { ok: false, error: blocked.replace('use the market', 'deposit') };
    const capped = this.giftAllowanceError(user.id, amount);
    if (capped) return { ok: false, error: capped };
    if (this.repo.getUser(user.id).points < amount) return { ok: false, error: `you only have ${fmt(this.repo.getUser(user.id).points)} pts.` };
    this.repo.transaction(() => {
      this.repo.addPoints(user.id, -amount);
      this.repo.guildSet(g.id, 'bank', g.bank + amount);
    });
    this.spendGiftAllowance(user.id, amount);
    return { ok: true, message: `Deposited ${fmt(amount)} pts. [${g.tag}] bank: ${fmt(g.bank + amount)} pts.` };
  },

  // The leader pays a member from the bank.
  guildPay(user, targetName, amount) {
    const g = this.repo.guildOf(user.id);
    if (!g || g.owner_id !== user.id) return { ok: false, error: 'only the guild leader can pay from the bank.' };
    const target = this.repo.getUserByName(String(targetName || '').replace(/^@/, ''));
    if (!target || this.repo.guildOf(target.id)?.id !== g.id) return { ok: false, error: "they're not in your guild." };
    amount = Math.floor(Number(amount));
    if (!(amount > 0) || amount > g.bank) return { ok: false, error: `the bank has ${fmt(g.bank)} pts.` };
    this.repo.transaction(() => {
      this.repo.guildSet(g.id, 'bank', g.bank - amount);
      this.repo.addPoints(target.id, amount);
    });
    this.notify(target.id, `🛡️ [${g.tag}] paid you ${fmt(amount)} pts from the guild bank.`);
    return { ok: true, message: `Paid ${target.username} ${fmt(amount)} pts from the bank.` };
  },

  // From the activity feed: members' actions count toward the weekly guild goal.
  guildProgress(user, entry) {
    if (!['action', 'rare'].includes(entry.kind) || entry.summary) return;
    const g = this.repo.guildOf(user.id);
    if (!g) return;
    const week = this.weekIndex();
    if (g.week !== week) {
      this.repo.guildSet(g.id, 'week', week);
      this.repo.guildSet(g.id, 'week_actions', 0);
      this.repo.guildSet(g.id, 'week_done', 0);
      g.week_actions = 0;
      g.week_done = 0;
    }
    if (g.week_done) return;
    const n = g.week_actions + 1;
    this.repo.guildSet(g.id, 'week_actions', n);
    const members = this.repo.guildMembers(g.id).length;
    if (n >= this.guildWeekTarget(members)) {
      const reward = this.guildWeekReward(members);
      this.repo.guildSet(g.id, 'week_done', 1);
      this.repo.guildSet(g.id, 'bank', g.bank + reward);
      this.track('rewards', reward);
      this.announce(`🛡️ Guild [${g.tag}] ${g.name} hit its weekly goal! +${fmt(reward)} pts to the guild bank.`);
    }
  },

  // !guild [create <name> | join <name> | leave | deposit <n> | pay @name <n> | kick @name | top]
  guild(user, args = []) {
    const p = this.cfg.prefix;
    const [sub = '', ...rest] = args.map(String);
    const reply = (r) => (r.ok ? r.message : r.error);
    switch (sub.toLowerCase()) {
      case 'create':
        return reply(this.guildCreate(user, rest.join(' ')));
      case 'join':
        return reply(this.guildJoinByName(user, rest.join(' ')));
      case 'leave':
        return reply(this.guildLeave(user));
      case 'kick':
        return reply(this.guildKick(user, rest[0]));
      case 'deposit':
        return reply(this.guildDeposit(user, rest[0]));
      case 'pay':
        return reply(this.guildPay(user, rest[0], rest[1]));
      case 'top':
      case 'list': {
        const list = this.guildList().slice(0, 5);
        return list.length ? `🛡️ Top guilds: ${list.map((g) => `${g.rank}. [${g.tag}] ${g.name} (${g.members}, ${fmt(g.xp)} XP)`).join(' · ')}` : `no guilds yet. ${p}guild create <name> (${fmt(this.guildCost())} pts)`;
      }
      default: {
        const g = this.publicGuild(this.repo.guildOf(user.id));
        if (!g) return `you're not in a guild. ${p}guild join <name>, or ${p}guild create <name> (${fmt(this.guildCost())} pts). ${p}guild top · ${this.siteUrl}/#/guilds`;
        return `🛡️ [${g.tag}] ${g.name}: ${g.members} members, ${fmt(g.xp)} XP, bank ${fmt(g.bank)} pts. Weekly goal: ${fmt(g.week.actions)}/${fmt(g.week.target)} actions${g.week.done ? ' ✅' : ` (+${fmt(g.week.reward)} pts)`}.`;
      }
    }
  },
};
