// GameEngine methods: reasons to come back. Daily rewards with streaks and daily tasks,
// achievements and the titles they unlock, seasonal leaderboards, and trading between players.
/* eslint-disable no-unused-vars */
const { ITEMS, SKILLS, SKILL_IDS, MUSEUM, COMBAT_SKILLS, fmt, findItem, itemLabel, minutesLeft, skillLevel, casino } = require('./shared');

// ---- Daily tasks ---------------------------------------------------------------------------
// One of these per task; "skill" is what counts towards it (combat = any combat skill's wins).
const TASKS = {
  fishing: { icon: '🎣', text: (n) => `Catch ${n} fish` },
  mining: { icon: '⛏️', text: (n) => `Mine ${n} ores` },
  woodcutting: { icon: '🪓', text: (n) => `Chop ${n} logs` },
  digging: { icon: '🏺', text: (n) => `Dig up ${n} finds` },
  skinning: { icon: '🔪', text: (n) => `Skin ${n} animals` },
  firemaking: { icon: '🔥', text: (n) => `Light ${n} fires` },
  cooking: { icon: '🍳', text: (n) => `Cook ${n} meals` },
  smelting: { icon: '🔥', text: (n) => `Smelt ${n} bars` },
  farming: { icon: '🌱', text: (n) => `Harvest ${n} times` },
  combat: { icon: '⚔️', text: (n) => `Win ${n} fights` },
};
const TASK_REWARD = 150;
const ALL_TASKS_BONUS = 300;
const DAILY_BASE = 100; // x streak day, up to 7
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
// Same tasks all day for a player, without using the game's random numbers.
function seeded(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// ---- Achievements --------------------------------------------------------------------------
// title: unlocks a title for !title. Museum collections and season wins add their own.
const ACHIEVEMENTS = {
  first_blood: { name: 'First Blood', icon: '🗡️', desc: 'Win your first fight' },
  dragonslayer: { name: 'Dragonslayer', icon: '🐉', desc: 'Defeat a Dragon or an Elder Dragon', title: 'the Dragonslayer' },
  back_from_dead: { name: 'Back from the Dead', icon: '💀', desc: 'Get knocked out' },
  skill_50: { name: 'Adept', icon: '🥉', desc: 'Reach level 50 in any skill' },
  skill_99: { name: 'Master', icon: '🥈', desc: 'Reach level 99 in any skill', title: 'the Master' },
  skill_200: { name: 'Grandmaster', icon: '🥇', desc: 'Reach level 200 in any skill', title: 'the Grandmaster' },
  skill_500: { name: 'Legend', icon: '🏅', desc: 'Reach level 500 in any skill', title: 'the Legend' },
  total_500: { name: 'Jack of All Trades', icon: '🧰', desc: 'Reach a total level of 500', title: 'the Versatile' },
  rich: { name: 'Well Off', icon: '💰', desc: 'Hold 100,000 points', title: 'the Wealthy' },
  millionaire: { name: 'Millionaire', icon: '💎', desc: 'Hold 1,000,000 points', title: 'the Millionaire' },
  jackpot: { name: 'Jackpot', icon: '🎰', desc: 'Win 10x or more in the casino', title: 'the Lucky' },
  raid_hero: { name: 'Raider', icon: '⚔️', desc: 'Help beat a raid boss' },
  raid_mvp: { name: 'Raid MVP', icon: '👑', desc: 'Deal the most damage to a raid boss', title: 'the Raid Leader' },
  duelist: { name: 'Duelist', icon: '🤺', desc: 'Win 10 duels', title: 'the Duelist' },
  streak_7: { name: 'Regular', icon: '📅', desc: 'Claim !daily 7 days in a row', title: 'the Loyal' },
  ...Object.fromEntries(MUSEUM.map((c) => [`museum_${c.id}`, { name: c.name, icon: c.icon, desc: `Complete the museum's ${c.name}`, title: c.title }])),
};

module.exports = {
  // ---- Daily reward and tasks ---------------------------------------------------------
  dailyKey(userId) {
    return `daily:${userId}`;
  },

  // Today's state for a player, with fresh tasks if it's a new day.
  daily(userId) {
    const today = dayOf(this.now());
    const d = this.repo.getSetting(this.dailyKey(userId)) || { streak: 0, lastClaim: null };
    if (d.day !== today) {
      const rand = seeded(`${userId}:${today}`);
      const pool = Object.keys(TASKS);
      const picked = [];
      while (picked.length < 3 && pool.length) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
      d.day = today;
      d.tasks = picked.map((skill) => ({ skill, need: 5 + Math.floor(rand() * 3) * 5, done: 0 }));
      d.bonusPaid = false;
      this.repo.setSetting(this.dailyKey(userId), d);
    }
    return d;
  },

  // Called for every action (from emitActivity): counts towards today's tasks, pays when one is done.
  progressDaily(user, entry) {
    let skill = entry.skill;
    if (COMBAT_SKILLS.includes(skill)) skill = 'combat';
    if (!TASKS[skill]) return;
    if (skill === 'farming' && !/^harvested/.test(entry.text || '')) return;
    if (skill === 'combat' && !/^defeated/.test(entry.text || '')) return;
    const d = this.daily(user.id);
    const task = d.tasks.find((t) => t.skill === skill && t.done < t.need);
    if (!task) return;
    task.done++;
    let paid = 0;
    if (task.done === task.need) {
      paid += TASK_REWARD;
      if (!d.bonusPaid && d.tasks.every((t) => t.done >= t.need)) {
        d.bonusPaid = true;
        paid += ALL_TASKS_BONUS;
      }
    }
    this.repo.setSetting(this.dailyKey(user.id), d);
    if (paid) {
      this.repo.addPoints(user.id, paid);
      this.track('rewards', paid);
      this.emitActivity(user, { kind: 'task', text: `finished a daily task: ${TASKS[skill].text(task.need)} (+${fmt(paid)} pts)${d.bonusPaid && paid > TASK_REWARD ? ' and all 3 today! 🎉' : ''}` });
    }
  },

  // !tasks
  tasksInfo(user) {
    const d = this.daily(user.id);
    const list = d.tasks.map((t) => `${TASKS[t.skill].icon} ${TASKS[t.skill].text(t.need)} ${Math.min(t.done, t.need)}/${t.need}${t.done >= t.need ? ' ✅' : ''}`);
    return `📋 Today's tasks (+${TASK_REWARD} pts each, +${ALL_TASKS_BONUS} for all 3): ${list.join(' · ')}. Streak: ${d.streak || 0} day${d.streak === 1 ? '' : 's'} (${this.cfg.prefix}daily).`;
  },

  // !daily: once a day, more for a streak (100 pts x streak day, up to 7).
  claimDaily(user) {
    const now = this.now();
    const today = dayOf(now);
    const d = this.daily(user.id);
    if (d.lastClaim === today) {
      const tomorrow = new Date(`${today}T00:00:00Z`).getTime() + 86_400_000;
      return `you already claimed today's reward. Come back in ${minutesLeft(tomorrow - now)} (UTC midnight) to keep your ${d.streak}-day streak! ${this.cfg.prefix}tasks`;
    }
    const yesterday = dayOf(now - 86_400_000);
    d.streak = d.lastClaim === yesterday ? (d.streak || 0) + 1 : 1;
    d.lastClaim = today;
    this.repo.setSetting(this.dailyKey(user.id), d);
    const points = DAILY_BASE * Math.min(d.streak, 7);
    this.repo.addPoints(user.id, points);
    this.track('rewards', points);
    if (d.streak >= 7) this.unlockAchievement(user, 'streak_7');
    return `📅 daily reward: +${fmt(points)} pts (day ${d.streak} streak${d.streak < 7 ? `, ${fmt(DAILY_BASE * Math.min(d.streak + 1, 7))} tomorrow` : ', max!'}). ${this.tasksInfo(user)}`;
  },

  // ---- Achievements and titles ---------------------------------------------------------
  achKey(userId) {
    return `ach:${userId}`;
  },

  achievements(userId) {
    const a = this.repo.getSetting(this.achKey(userId)) || {};
    return { unlocked: a.unlocked || {}, counters: a.counters || {} };
  },

  // Unlocks once. def: for achievements not in the list (season wins). Returns the def if new.
  unlockAchievement(user, id, def = ACHIEVEMENTS[id]) {
    if (!def || !user) return null;
    const a = this.achievements(user.id);
    if (a.unlocked[id]) return null;
    a.unlocked[id] = { at: this.now(), name: def.name, icon: def.icon, title: def.title || null };
    this.repo.setSetting(this.achKey(user.id), a);
    this.emitActivity(user, { kind: 'achievement', text: `unlocked ${def.icon} ${def.name}${def.title ? ` (title: ${def.title})` : ''}!` });
    return def;
  },

  bumpCounter(user, name) {
    const a = this.achievements(user.id);
    a.counters[name] = (a.counters[name] || 0) + 1;
    this.repo.setSetting(this.achKey(user.id), a);
    return a.counters[name];
  },

  // Level milestones, after XP is added.
  checkLevelAchievements(user) {
    const xp = this.repo.getSkills(user.id);
    const levels = SKILL_IDS.map((id) => skillLevel(id, xp[id]));
    const best = Math.max(...levels);
    for (const [lvl, id] of [[50, 'skill_50'], [99, 'skill_99'], [200, 'skill_200'], [500, 'skill_500']]) if (best >= lvl) this.unlockAchievement(user, id);
    if (levels.reduce((s, l) => s + l, 0) >= 500) this.unlockAchievement(user, 'total_500');
    // Museum collections finished before achievements existed.
    for (const c of this.museumProgress(user.id)) if (c.done) this.unlockAchievement(user, `museum_${c.id}`);
  },

  checkWealth(user) {
    const pts = this.repo.getUser(user.id)?.points || 0;
    if (pts >= 100_000) this.unlockAchievement(user, 'rich');
    if (pts >= 1_000_000) this.unlockAchievement(user, 'millionaire');
  },

  onFightWon(user, monster) {
    this.unlockAchievement(user, 'first_blood');
    if (monster.id === 'dragon' || monster.id === 'elder_dragon') this.unlockAchievement(user, 'dragonslayer');
  },

  onRaidWon(ids, mvpId) {
    for (const id of ids) this.unlockAchievement(this.repo.getUser(id), 'raid_hero');
    this.unlockAchievement(this.repo.getUser(mvpId), 'raid_mvp');
  },

  onDuelWon(user) {
    if (this.bumpCounter(user, 'duelWins') >= 10) this.unlockAchievement(user, 'duelist');
  },

  // From emitActivity: things that are easiest to spot in the feed.
  onActivity(user, entry) {
    // A bulk summary (!cook all): each item already counted on its own.
    if (entry.summary) return;
    if (entry.kind === 'death') this.unlockAchievement(user, 'back_from_dead');
    if (entry.kind === 'jackpot' && /\((\d+(\.\d+)?)x\)|10x|on crash|mines|BLACKJACK/.test(entry.text || '')) {
      // Casino wins of 10x+ are announced as jackpots; blackjack/crash/mines jackpots may be big-money
      // rather than 10x, so check the multiplier where it's given.
      const m = (entry.text || '').match(/(\d+(?:\.\d+)?)x/);
      if (!m || Number(m[1]) >= 10) this.unlockAchievement(user, 'jackpot');
    }
    if (['action', 'rare'].includes(entry.kind) && entry.skill) this.progressDaily(user, entry);
    this.questProgress(user, entry);
    this.claimBounty(user, entry);
    this.guildProgress(user, entry);
    if (entry.kind === 'jackpot') {
      const m = /(?:won|cashed out) ([\d,]+) pts/.exec(entry.text || '');
      if (m) this.recordCasinoWin(user, Number(m[1].replace(/,/g, '')), entry.text);
    }
    this.goalProgress(entry);
    this.noteStreamActivity(user, entry);
    // A showcased SoulTrak™ relic counts monsters defeated.
    if (entry.monster) this.relicKill(user);
  },

  // !achievements
  achievementsInfo(user) {
    const { unlocked } = this.achievements(user.id);
    const got = Object.values(unlocked);
    const total = Object.keys(ACHIEVEMENTS).length;
    if (!got.length) return `no achievements yet (0/${total}). See them all at ${this.siteUrl}/#/me`;
    return `🏆 ${got.length}/${total}: ${got.slice(-8).map((a) => `${a.icon} ${a.name}`).join(', ')}${got.length > 8 ? '…' : ''}`;
  },

  titles(userId) {
    return [...Object.values(this.achievements(userId).unlocked).map((a) => a.title), ...this.questTitles(userId), ...this.cardTitles(userId), ...this.patronTitles(userId)].filter(Boolean);
  },

  // !title [name|none]
  title(user, args) {
    const p = this.cfg.prefix;
    const titles = this.titles(user.id);
    if (!args.length) {
      const cur = this.repo.getUser(user.id).title;
      return titles.length
        ? `your titles: ${titles.join(', ')}${cur ? ` (showing: ${cur})` : ''}. ${p}title <name> to show one, ${p}title none to hide it.`
        : 'no titles yet. Unlock them with achievements, museum collections and season wins.';
    }
    const q = args.join(' ').toLowerCase();
    if (q === 'none' || q === 'off') {
      this.repo.setUserField(user.id, 'title', '');
      return 'title hidden.';
    }
    const t = titles.find((x) => x.toLowerCase() === q) || titles.find((x) => x.toLowerCase().includes(q));
    if (!t) return `you haven't unlocked that title. Yours: ${titles.join(', ') || 'none yet'}`;
    this.repo.setUserField(user.id, 'title', t);
    return `you're now ${user.username} ${t}! 🏷️`;
  },

  // ---- Seasons ---------------------------------------------------------------------------
  season() {
    return this.repo.getSetting('season') || { number: 1, startedAt: null };
  },

  // !season
  seasonInfo(user) {
    const s = this.season();
    const top = this.repo.seasonLeaders(3);
    const me = this.repo.getUser(user.id);
    const rank = me.season_xp > 0 ? this.repo.seasonRank(me.season_xp) : null;
    const ends = this.seasonEndsAt(s);
    const msLeft = ends ? ends - this.now() : 0;
    const left = ends ? ` Ends in ${msLeft > 2 * 86_400_000 ? `${Math.ceil(msLeft / 86_400_000)}d` : minutesLeft(msLeft)}; top 3 win a title and a season-only cosmetic.` : '';
    return `🏁 Season ${s.number}: ${top.map((r, i) => `${['🥇', '🥈', '🥉'][i]} ${r.username} ${fmt(r.season_xp)} XP`).join(' · ') || 'no XP earned yet'}. You: ${fmt(me.season_xp)} XP${rank ? ` (#${rank})` : ''}.${left}`;
  },

  // Ends the season: the top 3 get a permanent title, season XP resets.
  endSeason() {
    const s = this.season();
    const winners = this.repo.seasonLeaders(3);
    winners.forEach((w, i) => {
      const place = ['Champion', 'Runner-up', 'Third Place'][i];
      this.unlockAchievement(this.repo.getUser(w.id), `season_${s.number}_${i + 1}`, {
        name: `Season ${s.number} ${place}`,
        icon: ['🥇', '🥈', '🥉'][i],
        title: `Season ${s.number} ${place}`,
      });
    });
    const history = this.repo.getSetting('seasons') || [];
    history.push({ number: s.number, startedAt: s.startedAt, endedAt: this.now(), winners: winners.map((w) => ({ username: w.username, xp: w.season_xp })) });
    this.repo.setSetting('seasons', history);
    this.giveSeasonCosmetics(winners, s.number);
    this.repo.resetSeason();
    this.repo.setSetting('season', { number: s.number + 1, startedAt: this.now() });
    const text = winners.length
      ? `🏁 Season ${s.number} is over! ${winners.map((w, i) => `${['🥇', '🥈', '🥉'][i]} @${w.username}`).join(' ')} win a permanent title${winners.length ? ' and a season-only cosmetic' : ''}. Season ${s.number + 1} starts now: everyone's back to 0!`
      : `🏁 Season ${s.number + 1} starts now!`;
    this.announce(text);
    return { ok: true, text, winners };
  },

  // ---- Trading ---------------------------------------------------------------------------
  // !give @name <item> [amount] or !give @name 500 (points). Both players need some history in the
  // game (so throwaway alt accounts can't feed a main), and points gifts have a daily cap.
  give(user, args) {
    const c = this.cfg;
    const p = c.prefix;
    if (c.tradingEnabled === false) return 'trading is switched off right now.';
    if (args.length < 2) return `usage: ${p}give @name <item> [amount] or ${p}give @name 500 (points)`;
    const target = this.repo.getUserByName(String(args[0]).replace(/^@/, ''));
    if (!target || target.banned) return `no adventurer named ${String(args[0]).replace(/^@/, '')}.`;
    if (target.id === user.id) return "you can't give things to yourself.";
    const now = this.now();
    const newbie = (u) => (c.tradeMinHours && now - u.created_at < c.tradeMinHours * 3_600_000) || u.actions_count < (c.tradeMinActions || 0);
    const me = this.repo.getUser(user.id);
    if (newbie(me)) return `you can trade once you've played a while (${c.tradeMinActions} actions and ${c.tradeMinHours}h since you first chatted).`;
    if (newbie(target)) return `@${target.username} is too new to receive trades yet.`;

    // Points: "!give @bob 500" or "!give @bob 500 points"
    const rest = args.slice(1).map((w) => String(w).toLowerCase());
    if (rest.length <= 2 && (rest.length === 1 || /^(pts|points?)$/.test(rest[1])) && casino.parseBet(rest[0], me.points) !== null && !findItem(rest[0])) {
      const amount = casino.parseBet(rest[0], me.points);
      if (!amount || amount < 1) return 'give at least 1 point.';
      if (amount > me.points) return `you only have ${fmt(me.points)} pts.`;
      const key = `gifted:${user.id}:${dayOf(this.now())}`;
      const sent = this.repo.getSetting(key) || 0;
      if (c.tradeDailyPoints && sent + amount > c.tradeDailyPoints) return `you can give ${fmt(Math.max(0, c.tradeDailyPoints - sent))} more points today (daily limit ${fmt(c.tradeDailyPoints)}).`;
      this.repo.transaction(() => {
        this.repo.addPoints(user.id, -amount);
        this.repo.addPoints(target.id, amount);
        this.repo.setSetting(key, sent + amount);
      });
      this.track('traded', amount);
      this.emitActivity(user, { kind: 'trade', text: `gave ${fmt(amount)} pts to ${target.username} 🤝` });
      return `🤝 you gave ${fmt(amount)} pts to @${target.username}.`;
    }

    // Items: "!give @bob iron ore 5"
    let qty = 1;
    const words = [...rest];
    if (words.length > 1 && /^\d+$/.test(words[words.length - 1])) qty = Math.max(1, Number(words.pop()));
    const inv = this.repo.getInventory(user.id);
    const id = findItem(words.join(' '), Object.keys(inv).filter((i) => ITEMS[i] && inv[i] > 0));
    if (!id) return `you don't have "${words.join(' ')}". ${p}inv shows your backpack.`;
    if (ITEMS[id].bound || ITEMS[id].pet) return `your ${ITEMS[id].name} can't be given away.`;
    qty = Math.min(qty, inv[id]);
    const item = ITEMS[id];
    if (!item.ammo && !item.seedFor) {
      const bag = this.backpack(target.id);
      if (bag.used + qty > bag.capacity) return `@${target.username}'s backpack is too full (${bag.used}/${bag.capacity}).`;
    }
    this.repo.transaction(() => {
      this.repo.removeItem(user.id, id, qty);
      this.repo.addItem(target.id, id, qty);
    });
    this.track('traded', this.sellValue(id) * qty);
    this.emitActivity(user, { kind: 'trade', item: id, text: `gave ${qty > 1 ? `${qty}x ` : 'a '}${item.name} to ${target.username} 🤝` });
    return `🤝 you gave ${itemLabel(id, qty)} to @${target.username}.`;
  },

  // For the website.
  progressionFor(userId) {
    const { unlocked } = this.achievements(userId);
    return {
      achievements: Object.entries(ACHIEVEMENTS).map(([id, a]) => ({ id, ...a, unlockedAt: unlocked[id]?.at || null })),
      extra: Object.entries(unlocked)
        .filter(([id]) => !ACHIEVEMENTS[id])
        .map(([id, a]) => ({ id, ...a, unlockedAt: a.at })),
      titles: this.titles(userId),
      daily: (() => {
        const d = this.daily(userId);
        return {
          streak: d.streak || 0,
          claimedToday: d.lastClaim === dayOf(this.now()),
          tasks: d.tasks.map((t) => ({ ...t, icon: TASKS[t.skill].icon, text: TASKS[t.skill].text(t.need) })),
          reward: TASK_REWARD,
          bonus: ALL_TASKS_BONUS,
        };
      })(),
    };
  },
};
