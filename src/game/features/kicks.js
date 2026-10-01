// GameEngine methods: KICKs, Kick's tipping currency (the "kicks.gifted" webhook). Every KICK pays
// the sender points, bigger gifts set off effects for the whole chat, and lifetime totals feed a
// supporter leaderboard (!kicks, the Stream page) and titles. Mixed into GameEngine.prototype by
// engine.js; channelEvent (events.js) hands the webhook here.
const { fmt, minutesLeft } = require('./shared');

// Lifetime KICKs -> title.
const KICK_TITLES = [
  [100, 'the Kick Supporter'],
  [1000, 'the Kick Patron'],
  [10000, 'the Kick Legend'],
];

module.exports = {
  kicksCfg() {
    const c = this.cfg;
    return {
      on: c.kicksEnabled !== false,
      messages: c.kicksMessages !== false,
      pointsPer: c.kicksPointsPer ?? 2,
      rainAt: c.kicksRainAt ?? 100,
      rainPer: c.kicksRainPoints ?? 3,
      boostAt: c.kicksBoostAt ?? 500,
      boostMinutes: c.kicksBoostMinutes ?? 10,
      bossAt: c.kicksBossAt ?? 2500,
    };
  },

  // { userId: { name, total, week, weekNo, month, monthNo } }
  kicksTotals() {
    return this.repo.getSetting('kicks_totals') || {};
  },

  monthIndex(now = this.now()) {
    const d = new Date(now);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  },

  recordKicks(user, amount) {
    const all = this.kicksTotals();
    const week = this.weekIndex();
    const month = this.monthIndex();
    const t = (all[user.id] ||= { name: user.username, total: 0, week: 0, weekNo: week, month: 0, monthNo: month });
    if (t.weekNo !== week) Object.assign(t, { week: 0, weekNo: week });
    if (t.monthNo !== month) Object.assign(t, { month: 0, monthNo: month });
    const before = t.total;
    t.total += amount;
    t.week += amount;
    t.month += amount;
    t.name = user.username;
    this.repo.setSetting('kicks_totals', all);
    // This stream's KICKs, for the stream summary.
    const st = this.streamStats?.();
    if (st) {
      st.kicks = (st.kicks || 0) + amount;
      this._streamDirty = true;
    }
    return { before, after: t.total };
  },

  // Top supporters: period 'week' | 'month' | 'all'.
  kicksLeaderboard(period = 'all', limit = 10) {
    const week = this.weekIndex();
    const month = this.monthIndex();
    return Object.entries(this.kicksTotals())
      .map(([id, t]) => ({ userId: Number(id), username: t.name, amount: period === 'week' ? (t.weekNo === week ? t.week : 0) : period === 'month' ? (t.monthNo === month ? t.month : 0) : t.total }))
      .filter((x) => x.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit)
      .map((x, i) => ({ ...x, rank: i + 1 }));
  },

  kicksTitles(userId) {
    const total = this.kicksTotals()[userId]?.total || 0;
    return KICK_TITLES.filter(([at]) => total >= at).map(([, title]) => title);
  },

  // The webhook: { sender, gift: { amount, name, type, tier, message } }. Returns the chat line.
  kicksGifted(payload = {}, who) {
    const kc = this.kicksCfg();
    if (!kc.on) return null;
    const gift = payload.gift || {};
    const amount = Math.max(0, Math.floor(Number(gift.amount) || 0));
    if (!amount) return null;
    const user = who(payload.sender);
    const now = this.now();
    const name = user ? `@${user.username}` : 'Someone';
    const giftName = gift.name ? ` (${String(gift.name).slice(0, 40)})` : '';
    const effects = [];
    let pts = 0;
    let newTitle = null;
    if (user) {
      pts = amount * kc.pointsPer;
      if (pts) {
        this.repo.addPoints(user.id, pts);
        this.track('rewards', pts);
      }
      const { before, after } = this.recordKicks(user, amount);
      const unlocked = KICK_TITLES.filter(([at]) => before < at && after >= at).pop();
      if (unlocked) newTitle = unlocked[1];
    }
    // Loot rain: points shower on the chatters who've been around in the last 10 minutes.
    if (kc.rainAt && amount >= kc.rainAt) {
      const chatters = this.activeChatters(10, now).filter((id) => id !== user?.id);
      const pick = chatters.sort(() => this.rng() - 0.5).slice(0, 10);
      if (pick.length) {
        const each = Math.max(1, Math.floor((amount * kc.rainPer) / pick.length));
        for (const id of pick) this.repo.addPoints(id, each);
        this.track('rewards', each * pick.length);
        const names = pick.map((id) => this.repo.getUser(id)?.username).filter(Boolean);
        effects.push(`💰 Loot rain! ${fmt(each)} pts each to ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''}`);
      }
    }
    // Double XP for everyone.
    if (kc.boostAt && amount >= kc.boostAt && kc.boostMinutes > 0) {
      const b = this.startBoost({ kind: 'xp', multiplier: 2, minutes: kc.boostMinutes, reason: `${user ? user.username : 'someone'} sent ${fmt(amount)} KICKs`, extend: true });
      effects.push(`⚡ DOUBLE XP for everyone for ${minutesLeft(b.until - now)}`);
    }
    // The world boss wakes up.
    if (kc.bossAt && amount >= kc.bossAt) {
      const r = this.startRaid({ world: true });
      if (r.ok) effects.push(`🌍 the WORLD BOSS awakens! Everyone ${this.cfg.prefix}attack`);
    }
    if (user) this.emitActivity(user, { kind: 'kicks', text: `sent ${fmt(amount)} KICKs${giftName}! 💎${effects.length ? ` ${effects.map((e) => e.split('!')[0]).join(' · ')}` : ''}` });
    if (newTitle) this.notify?.(user.id, `💎 Thanks for your KICKs! You earned the title "${newTitle}".`);
    if (!kc.messages) return null;
    const note = gift.message ? ` “${String(gift.message).replace(/\s+/g, ' ').slice(0, 80)}”` : '';
    return `💎 ${name} sent ${fmt(amount)} KICKs${giftName}!${note}${pts ? ` +${fmt(pts)} pts.` : ''}${effects.length ? ` ${effects.join('. ')}!` : ''}${newTitle ? ` New title: ${newTitle}.` : ''}`;
  },

  // !kicks: this week's and all-time top supporters.
  kicksCommand(user) {
    const kc = this.kicksCfg();
    if (!kc.on) return 'KICKs rewards are switched off right now.';
    const week = this.kicksLeaderboard('week', 3);
    const all = this.kicksLeaderboard('all', 3);
    const mine = this.kicksTotals()[user.id]?.total || 0;
    const list = (l) => l.map((x) => `${x.username} ${fmt(x.amount)}`).join(', ');
    const tiers = [kc.rainAt && `${fmt(kc.rainAt)}+ loot rain`, kc.boostAt && `${fmt(kc.boostAt)}+ double XP`, kc.bossAt && `${fmt(kc.bossAt)}+ world boss`].filter(Boolean).join(', ');
    return `💎 KICKs supporters — this week: ${week.length ? list(week) : 'nobody yet'} · all time: ${all.length ? list(all) : 'nobody yet'}.${mine ? ` You've sent ${fmt(mine)}.` : ''} Every KICK = ${kc.pointsPer} pts${tiers ? `; ${tiers}` : ''}. ${this.siteUrl}/#/stream`;
  },

  kicksPublic() {
    const kc = this.kicksCfg();
    return { on: kc.on, cfg: kc, week: this.kicksLeaderboard('week', 10), month: this.kicksLeaderboard('month', 10), all: this.kicksLeaderboard('all', 10) };
  },
};
