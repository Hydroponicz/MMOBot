// GameEngine methods: stream rewards. Players spend points on things everyone sees:
//   - Redemptions (!redeem, website): fireworks, a spotlight, a fanfare, double XP, a raid boss...
//   - Community projects (!fund, website): chat pools points toward a shared goal (a monument, a
//     double XP hour, a festival of fortune, the world boss). Big donors earn Patron titles.
// Every point spent here leaves the economy. Prices and goals are admin settings tables.
// Mixed into GameEngine.prototype by engine.js.
const { fmt, casino, characterProgress, SKILL_IDS } = require('./shared');
const { REDEMPTIONS, PROJECTS } = require('../streamRewards');

const USER_COOLDOWN_MS = 30_000;

const MIN_FUND = 10;

module.exports = {
  // ---- Redemptions ---------------------------------------------------------------------------
  redemptions() {
    const live = new Map((this.settings.all.redemptions || []).map((r) => [r.id, r]));
    const used = this.repo.getSetting('redeem_used') || {};
    const now = this.now();
    return REDEMPTIONS.map((r) => {
      const row = { ...r, ...(live.get(r.id) || {}) };
      const readyAt = (used[r.id] || 0) + row.cooldown * 60_000;
      return { ...row, enabled: row.cost > 0, readyAt: readyAt > now ? readyAt : 0 };
    });
  },

  streamOffline() {
    if (this.cfg.redeemOnlyLive === false) return false;
    const stream = this.repo.getSetting('stream');
    return !!stream && !stream.live;
  },

  redeem(user, id) {
    if (this.cfg.redeemEnabled === false) return { ok: false, error: 'stream redemptions are switched off right now.' };
    const r = this.redemptions().find((x) => x.id === String(id || '').toLowerCase());
    if (!r || !r.enabled) return { ok: false, error: `no such redemption. Try ${this.cfg.prefix}redeem to see the list.` };
    if (this.streamOffline()) return { ok: false, error: 'redemptions only work while the stream is live.' };
    const now = this.now();
    if (r.readyAt) return { ok: false, error: `${r.icon} ${r.name} was just used: ready again in ${Math.ceil((r.readyAt - now) / 60_000)} min.` };
    this.lastRedeem ??= new Map();
    const mine = this.lastRedeem.get(user.id) || 0;
    if (now - mine < USER_COOLDOWN_MS) return { ok: false, error: `easy! You can redeem again in ${Math.ceil((USER_COOLDOWN_MS - (now - mine)) / 1000)}s.` };
    const points = this.repo.getUser(user.id).points;
    if (points < r.cost) return { ok: false, error: `${r.icon} ${r.name} costs ${fmt(r.cost)} pts (you have ${fmt(points)}).` };
    // Gameplay redemptions can't stack on what's already running.
    if (r.id === 'xp' && this.activeBoost()) return { ok: false, error: 'a channel boost is already running. Try again when it ends.' };
    if (r.id === 'raid' && this.repo.getSetting('raid')) return { ok: false, error: 'a raid is already running.' };
    if (r.id === 'goblin' && this.repo.getSetting('random_event')) return { ok: false, error: 'a chat event is already running.' };

    this.repo.transaction(() => this.repo.addPoints(user.id, -r.cost));
    this.lastRedeem.set(user.id, now);
    const used = this.repo.getSetting('redeem_used') || {};
    used[r.id] = now;
    this.repo.setSetting('redeem_used', used);
    this.track('redeems', r.cost);

    let text = '';
    if (r.id === 'xp') {
      this.startBoost({ kind: 'xp', multiplier: 2, minutes: 10, reason: `redeemed by ${user.username}` });
      text = `⚡ ${user.username} bought DOUBLE XP for everyone for 10 minutes!`;
      this.announce(text);
    } else if (r.id === 'raid') {
      const res = this.startRaid({});
      if (!res.ok) {
        // Couldn't start after all: refund.
        this.repo.addPoints(user.id, r.cost);
        this.track('redeems', -r.cost);
        return { ok: false, error: res.error };
      }
      text = `🐉 ${user.username} summoned a raid boss!`;
    } else if (r.id === 'goblin') {
      this.spawnRandomEvent('goblin');
      text = `👺 ${user.username} released a treasure goblin!`;
    } else {
      text = { fireworks: `🎆 ${user.username} set off fireworks!`, fanfare: `📯 All hail ${user.username}!`, spotlight: `🔦 ${user.username} takes the spotlight!` }[r.id];
    }
    const me = this.repo.getUser(user.id);
    this.emit('redeem', {
      id: r.id,
      name: r.name,
      icon: r.icon,
      username: user.username,
      title: me.title || '',
      level: characterProgress(SKILL_IDS.map((sk) => this.repo.getSkills(user.id)[sk] || 0)).level,
      appearance: this.characterView(user.id),
      text,
      at: now,
    });
    this.emitActivity(user, { kind: 'redeem', text: `redeemed ${r.icon} ${r.name} (${fmt(r.cost)} pts)` });
    return { ok: true, message: `${r.icon} ${r.name} redeemed for ${fmt(r.cost)} pts!`, balance: me.points };
  },

  // !redeem [name]
  redeemChat(user, args = []) {
    const p = this.cfg.prefix;
    const list = this.redemptions().filter((r) => r.enabled);
    if (!args.length) {
      return `📣 spend points on the stream: ${list.map((r) => `${r.icon} ${r.id} ${fmt(r.cost)}`).join(' · ')}. ${p}redeem <name>, or ${this.siteUrl}/#/stream`;
    }
    const q = args.join(' ').toLowerCase();
    const r = list.find((x) => x.id === q) || list.find((x) => x.name.toLowerCase().includes(q) || x.id.startsWith(q));
    if (!r) return `no redemption called "${q}". Try ${p}redeem to see the list.`;
    const res = this.redeem(user, r.id);
    return res.ok ? res.message : res.error;
  },

  // ---- Community projects -----------------------------------------------------------------------
  projectGoals() {
    const live = new Map((this.settings.all.projects || []).map((r) => [r.id, r]));
    return PROJECTS.map((p) => ({ ...p, ...(live.get(p.id) || {}) })).filter((p) => p.goal > 0);
  },

  // The running project (starting the first one if there isn't one yet).
  project() {
    let st = this.repo.getSetting('project');
    const goals = this.projectGoals();
    if (!goals.length) return null;
    if (!st || !goals.some((g) => g.id === st.id)) {
      st = { id: goals[0].id, number: (st?.number || 0) + 1, progress: 0, donors: {}, names: {}, startedAt: this.now() };
      this.repo.setSetting('project', st);
    }
    return { ...st, ...goals.find((g) => g.id === st.id) };
  },

  publicProject() {
    const p = this.project();
    if (!p) return null;
    const top = Object.entries(p.donors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, amount]) => ({ username: p.names[id], amount }));
    const fortune = this.repo.getSetting('fortune_until') || 0;
    return {
      id: p.id,
      number: p.number,
      name: p.name,
      icon: p.icon,
      text: p.text,
      goal: p.goal,
      progress: p.progress,
      donors: Object.keys(p.donors).length,
      top,
      fortuneUntil: fortune > this.now() ? fortune : 0,
    };
  },

  projectFund(user, amountArg) {
    if (this.cfg.projectsEnabled === false) return { ok: false, error: 'community projects are switched off right now.' };
    const p = this.project();
    if (!p) return { ok: false, error: 'there is no community project right now.' };
    const balance = this.repo.getUser(user.id).points;
    let amount = casino.parseBet(String(amountArg ?? ''), balance);
    if (amount === null) return { ok: false, error: `how much? e.g. ${this.cfg.prefix}fund 500, 1k, half or all.` };
    const left = p.goal - p.progress;
    amount = Math.min(amount, left);
    if (amount < Math.min(MIN_FUND, left)) return { ok: false, error: `give at least ${MIN_FUND} pts.` };
    if (amount > balance) return { ok: false, error: `you only have ${fmt(balance)} pts.` };
    const st = this.repo.getSetting('project');
    this.repo.transaction(() => {
      this.repo.addPoints(user.id, -amount);
      st.progress += amount;
      st.donors[user.id] = (st.donors[user.id] || 0) + amount;
      st.names[user.id] = user.username;
      this.repo.setSetting('project', st);
    });
    this.track('projects', amount);
    const done = st.progress >= p.goal;
    const msg = done ? this.projectComplete(user) : null;
    if (!done) this.emit('project', this.publicProject());
    // Big gifts go on the feed.
    if (amount >= p.goal * 0.05) this.emitActivity(user, { kind: 'fund', text: `gave ${fmt(amount)} pts to ${p.icon} ${p.name}!` });
    return {
      ok: true,
      amount,
      balance: this.repo.getUser(user.id).points,
      message: done ? msg : `${p.icon} you gave ${fmt(amount)} pts to ${p.name}: ${fmt(st.progress)} / ${fmt(p.goal)} (${Math.floor((st.progress / p.goal) * 100)}%).`,
    };
  },

  // The goal is reached: do what it promised, reward the donors and start the next project.
  projectComplete(finisher) {
    const p = this.project();
    const st = this.repo.getSetting('project');
    const now = this.now();
    const ranked = Object.entries(st.donors).sort((a, b) => b[1] - a[1]);
    const [topId] = ranked[0];
    const topName = st.names[topId];
    let effect = '';
    if (p.id === 'monument') {
      const monuments = this.repo.getSetting('monuments') || [];
      monuments.unshift({ username: topName, appearance: this.characterView(Number(topId)), amount: st.donors[topId], number: st.number, at: now, donors: ranked.length });
      this.repo.setSetting('monuments', monuments.slice(0, 24));
      effect = `A monument to ${topName} now stands in the Hall of Monuments!`;
    } else if (p.id === 'xp') {
      this.startBoost({ kind: 'xp', multiplier: 2, minutes: 60, reason: 'community project', extend: true });
      effect = 'DOUBLE XP for everyone for an hour!';
    } else if (p.id === 'fortune') {
      const until = Math.max(this.repo.getSetting('fortune_until') || 0, now) + 60 * 60_000;
      this.repo.setSetting('fortune_until', until);
      effect = 'Rare finds are twice as likely for everyone for an hour!';
    } else if (p.id === 'worldboss') {
      const res = this.startRaid({ world: true });
      effect = res.ok ? 'The WORLD BOSS awakens! Everyone !attack it.' : 'The world boss is already awake: the points go to the next project.';
    }
    // Titles: the top donor becomes a Grand Patron; anyone who gave 10% or more is a Patron.
    for (const [id, amount] of ranked) {
      const rank = id === topId ? 2 : amount >= p.goal * 0.1 ? 1 : 0;
      if (!rank) continue;
      const key = `patron:${id}`;
      const cur = this.repo.getSetting(key) || 0;
      if (rank > cur) this.repo.setSetting(key, rank);
      this.notify(Number(id), `${p.icon} ${p.name} is complete! Thanks for your ${fmt(amount)} pts. You earned the title "${rank === 2 ? 'the Grand Patron' : 'the Patron'}".`);
    }
    const history = this.repo.getSetting('project_history') || [];
    history.unshift({ id: p.id, name: p.name, icon: p.icon, number: st.number, goal: p.goal, donors: ranked.length, top: topName, at: now });
    this.repo.setSetting('project_history', history.slice(0, 30));
    // Next project in the rotation.
    const goals = this.projectGoals();
    const next = goals[(goals.findIndex((g) => g.id === p.id) + 1) % goals.length];
    this.repo.setSetting('project', { id: next.id, number: st.number + 1, progress: 0, donors: {}, names: {}, startedAt: now });
    const text = `${p.icon} COMMUNITY PROJECT COMPLETE: ${p.name}! ${ranked.length} donor${ranked.length === 1 ? '' : 's'}, top donor ${topName}. ${effect} Next up: ${next.icon} ${next.name} (${this.cfg.prefix}fund).`;
    this.announce(text);
    this.emit('project', { ...this.publicProject(), completed: { id: p.id, name: p.name, icon: p.icon, top: topName, appearance: this.characterView(Number(topId)), effect, finisher: finisher?.username } });
    this.emitActivity(finisher, { kind: 'fund', text: `completed ${p.icon} ${p.name}! ${effect}` });
    return `${p.icon} you finished ${p.name}! ${effect}`;
  },

  patronTitles(userId) {
    const rank = this.repo.getSetting(`patron:${userId}`) || 0;
    return rank >= 2 ? ['the Patron', 'the Grand Patron'] : rank === 1 ? ['the Patron'] : [];
  },

  // Festival of Fortune doubles rare chances for everyone while it lasts (see vitals.luck).
  fortuneActive() {
    return (this.repo.getSetting('fortune_until') || 0) > this.now();
  },

  // !project / !fund [amount]
  projectChat(user, args = []) {
    const p = this.publicProject();
    const pre = this.cfg.prefix;
    if (!p) return 'there is no community project right now.';
    if (!args.length) {
      const top = p.top.length ? ` Top: ${p.top.slice(0, 3).map((t) => `${t.username} ${fmt(t.amount)}`).join(', ')}.` : '';
      return `${p.icon} community project: ${p.name}: ${fmt(p.progress)} / ${fmt(p.goal)} (${Math.floor((p.progress / p.goal) * 100)}%). ${p.text}${top} Chip in: ${pre}fund 500`;
    }
    const res = this.projectFund(user, args.join(' '));
    return res.ok ? res.message : res.error;
  },

  monuments() {
    return this.repo.getSetting('monuments') || [];
  },

  projectHistory() {
    return this.repo.getSetting('project_history') || [];
  },
};
