// GameEngine methods: quests, channel goals and this-stream stats. Mixed into GameEngine.prototype
// by engine.js. All three watch the activity feed (see progression.onActivity).
const { ITEMS, SKILLS, SKILL_IDS } = require('../skills');
const { QUESTS } = require('../content');
const { fmt } = require('./shared');

const ACTION_KINDS = ['action', 'rare'];
// How many quests a player can have going at once.
const MAX_ACTIVE = 3;

// Does an activity entry match a quest step?
function matches(m, entry) {
  const is = (want, got) => want === undefined || (Array.isArray(want) ? want.includes(got) : want === got);
  if (!is(m.kind ?? (m.monster || m.skill || m.item ? ACTION_KINDS : undefined), entry.kind)) return false;
  if (!is(m.skill, entry.skill) || !is(m.item, entry.item) || !is(m.monster, entry.monster)) return false;
  return !m.text || new RegExp(m.text).test(entry.text || '');
}

// How far a player is on each objective of a quest. Objectives can be done in any order, so every
// objective keeps its own count. Progress saved when objectives went one at a time ({ step, count })
// is converted: objectives before `step` are complete, `step` has `count`.
function stepCounts(quest, pr) {
  if (!pr) return quest.steps.map(() => 0);
  if (Array.isArray(pr.counts)) return quest.steps.map((s, i) => Math.min(s.qty, pr.counts[i] || 0));
  return quest.steps.map((s, i) => (i < (pr.step || 0) ? s.qty : i === (pr.step || 0) ? Math.min(s.qty, pr.count || 0) : 0));
}

module.exports = {
  // ---- Quests ---------------------------------------------------------------------------
  questKey(userId) {
    return `quest:${userId}`;
  },

  // Players pick which quests to do (up to MAX_ACTIVE at once, all progressing together). Pausing one
  // keeps its progress. State: { active: [ids], progress: { id: { counts: [per objective] } }, done: [ids] }.
  questState(userId) {
    const st = this.repo.getSetting(this.questKey(userId));
    if (!st) return { active: [QUESTS[0].id], progress: {}, done: [] };
    // Saved before quests could be chosen: one chain in progress, done in order.
    if (!Array.isArray(st.active)) {
      return { active: st.chain ? [st.chain] : [], progress: st.chain ? { [st.chain]: { step: st.step || 0, count: st.progress || 0 } } : {}, done: st.done || [] };
    }
    return st;
  },

  saveQuests(userId, st) {
    this.repo.setSetting(this.questKey(userId), st);
  },

  // A quest by id, name or part of its name ("blacksmith", "relic").
  findQuest(q) {
    const s = String(q || '').toLowerCase().trim();
    if (!s) return null;
    return QUESTS.find((x) => x.id === s || x.name.toLowerCase() === s) || QUESTS.find((x) => x.name.toLowerCase().includes(s));
  },

  // Every unfinished objective of every active quest that this action matches moves forward.
  questProgress(user, entry) {
    const st = this.questState(user.id);
    let changed = false;
    for (const id of [...st.active]) {
      const quest = QUESTS.find((q) => q.id === id);
      if (!quest) continue;
      const counts = stepCounts(quest, st.progress[id]);
      const finished = [];
      quest.steps.forEach((step, i) => {
        if (counts[i] >= step.qty || !matches(step.match, entry)) return;
        counts[i] += 1;
        changed = true;
        if (counts[i] >= step.qty) finished.push(step);
      });
      st.progress[id] = { counts };
      const left = quest.steps.filter((s, i) => counts[i] < s.qty);
      if (!left.length) {
        st.done = [...st.done, id];
        st.active = st.active.filter((x) => x !== id);
        delete st.progress[id];
        this.repo.addPoints(user.id, quest.reward);
        this.track('rewards', quest.reward);
        this.emitActivity(user, { kind: 'quest', text: `completed the quest ${quest.icon} ${quest.name}! (title: ${quest.title})` });
        this.notify?.(user.id, `${quest.icon} Quest complete: ${quest.name}! +${fmt(quest.reward)} pts and the title "${quest.title}".`);
        const more = QUESTS.filter((q) => !st.done.includes(q.id) && !st.active.includes(q.id)).length;
        this.announce(`📜 @${user.username} completed the quest ${quest.icon} ${quest.name}! +${fmt(quest.reward)} pts and the title "${quest.title}".${more ? ` Pick another: ${this.cfg.prefix}quests` : ''}`);
      } else if (finished.length) {
        const done = quest.steps.length - left.length;
        const rest = left.map((s) => `${s.text} (${counts[quest.steps.indexOf(s)]}/${s.qty})`).join(' · ');
        this.announce(`📜 @${user.username} ✅ ${finished.map((s) => s.text).join(' + ')}! ${quest.icon} ${quest.name}: ${done}/${quest.steps.length} done. Still to do: ${rest}.`);
      }
    }
    if (changed) this.saveQuests(user.id, st);
  },

  // Start (or resume) a quest. Returns { ok, message } or { ok: false, error }.
  questStart(user, name) {
    const quest = this.findQuest(name);
    if (!quest) return { ok: false, error: `no quest called "${name}". ${this.cfg.prefix}quests lists them.` };
    const st = this.questState(user.id);
    if (st.done.includes(quest.id)) return { ok: false, error: `you've already finished ${quest.icon} ${quest.name}.` };
    if (st.active.includes(quest.id)) return { ok: false, error: `${quest.icon} ${quest.name} is already one of your active quests.` };
    if (st.active.length >= MAX_ACTIVE) {
      return { ok: false, error: `you can have ${MAX_ACTIVE} quests going at once. Pause one first: ${this.cfg.prefix}quest pause <name>.` };
    }
    st.active = [...st.active, quest.id];
    this.saveQuests(user.id, st);
    const pr = st.progress[quest.id];
    const counts = stepCounts(quest, pr);
    const todo = quest.steps.map((s, i) => (counts[i] < s.qty ? `${s.text} ${counts[i]}/${s.qty}` : null)).filter(Boolean);
    return { ok: true, message: `📜 ${pr ? 'Resumed' : 'Started'} ${quest.icon} ${quest.name}: ${todo.join(' · ')} (any order).${pr ? '' : ` ${quest.intro}`}` };
  },

  // Pause a quest: it stops counting but keeps its progress.
  questPause(user, name) {
    const quest = this.findQuest(name);
    const st = this.questState(user.id);
    if (!quest || !st.active.includes(quest.id)) return { ok: false, error: `that isn't one of your active quests.` };
    st.active = st.active.filter((x) => x !== quest.id);
    this.saveQuests(user.id, st);
    return { ok: true, message: `⏸️ Paused ${quest.icon} ${quest.name}. Your progress is kept: ${this.cfg.prefix}quest start ${quest.name.toLowerCase()} to pick it up again.` };
  },

  // Titles from finished quests (added to the achievement titles).
  questTitles(userId) {
    const { done } = this.questState(userId);
    return QUESTS.filter((q) => done.includes(q.id)).map((q) => q.title);
  },

  // For the character page: every quest with its status (done, active, paused, new) and progress.
  publicQuests(userId) {
    const st = this.questState(userId);
    return QUESTS.map((q) => {
      const done = st.done.includes(q.id);
      const pr = st.progress[q.id];
      const status = done ? 'done' : st.active.includes(q.id) ? 'active' : pr ? 'paused' : 'available';
      return {
        id: q.id,
        name: q.name,
        icon: q.icon,
        intro: q.intro,
        reward: q.reward,
        title: q.title,
        status,
        steps: (() => {
          const counts = stepCounts(q, pr);
          return q.steps.map((s, i) => ({ text: s.text, qty: s.qty, have: done ? s.qty : counts[i] }));
        })(),
      };
    });
  },

  // !quest [start|pause <name>] · !quests lists them all
  questInfo(user, args = [], cmd = 'quest') {
    const p = this.cfg.prefix;
    const [sub = '', ...rest] = args.map(String);
    const reply = (r) => (r.ok ? r.message : r.error);
    if (['start', 'begin', 'take', 'resume'].includes(sub.toLowerCase())) return reply(this.questStart(user, rest.join(' ')));
    if (['pause', 'stop', 'drop'].includes(sub.toLowerCase())) return reply(this.questPause(user, rest.join(' ')));
    const st = this.questState(user.id);
    if (sub && !['list', 'all'].includes(sub.toLowerCase())) {
      // "!quest relic hunter": start it if they can, otherwise show why not.
      return reply(this.questStart(user, args.join(' ')));
    }
    const available = QUESTS.filter((q) => !st.done.includes(q.id) && !st.active.includes(q.id));
    if (cmd === 'quests' || sub) {
      return `📜 Quests: ${QUESTS.map((q) => `${st.done.includes(q.id) ? '✅' : st.active.includes(q.id) ? '▶️' : st.progress[q.id] ? '⏸️' : '•'} ${q.icon} ${q.name}`).join(' · ')}. ${p}quest start <name> (up to ${MAX_ACTIVE} at once).`;
    }
    if (!st.active.length) {
      if (!available.length) return `📜 you've finished all ${QUESTS.length} quests! 🏆 Titles: ${this.questTitles(user.id).join(', ')}`;
      return `📜 no active quest. Pick one: ${available.map((q) => `${q.icon} ${q.name}`).join(' · ')}. ${p}quest start <name>`;
    }
    const lines = st.active.map((id) => {
      const q = QUESTS.find((x) => x.id === id);
      const counts = stepCounts(q, st.progress[id]);
      // Objectives already started come first, so what you're working on is always shown.
      const left = q.steps
        .map((s, i) => ({ s, have: counts[i], i }))
        .filter((x) => x.have < x.s.qty)
        .sort((a, b) => (b.have > 0) - (a.have > 0) || a.i - b.i)
        .map((x) => `${x.s.text} ${x.have}/${x.s.qty}`);
      const shown = left.slice(0, 3).join(' · ') + (left.length > 3 ? ` +${left.length - 3} more` : '');
      return `${q.icon} ${q.name} (${q.steps.length - left.length}/${q.steps.length} done): ${shown}`;
    });
    return `📜 ${lines.join(' · ')}${available.length ? ` | More: ${p}quests` : ''}`;
  },

  // ---- Channel goals ----------------------------------------------------------------------
  // "Chat mines 500 times -> everyone gets 2x XP for 30 minutes." skill 'any' counts every action.
  goalState() {
    return this.repo.getSetting('goal');
  },

  goalLabel(g) {
    const what = g.skill === 'any' ? 'actions' : `${SKILLS[g.skill].icon} ${SKILLS[g.skill].name} actions`;
    return `${fmt(g.target)} ${what} → ${g.multiplier}x XP for ${g.minutes} min`;
  },

  publicGoal(g = this.goalState()) {
    return g ? { ...g, label: this.goalLabel(g) } : null;
  },

  startGoal({ skill = 'any', target = 500, multiplier = 2, minutes = 30 } = {}) {
    if (skill !== 'any' && !SKILL_IDS.includes(skill)) return { ok: false, error: 'unknown skill.' };
    target = Math.round(Number(target));
    multiplier = Number(multiplier);
    minutes = Math.round(Number(minutes));
    if (!(target >= 1 && target <= 1_000_000)) return { ok: false, error: 'target must be 1 to 1,000,000.' };
    if (!(multiplier > 1 && multiplier <= 10)) return { ok: false, error: 'the XP multiplier must be above 1 and at most 10.' };
    if (!(minutes >= 1 && minutes <= 60)) return { ok: false, error: 'the boost lasts 1 to 60 minutes.' };
    const goal = { skill, target, multiplier, minutes, progress: 0, startedAt: this.now(), done: false };
    this.repo.setSetting('goal', goal);
    this.emit('goal', this.publicGoal(goal));
    this.announce(`🎯 CHANNEL GOAL: ${this.goalLabel(goal)} for everyone! Every ${skill === 'any' ? 'action' : `!${SKILLS[skill].command}`} counts. ${this.cfg.prefix}goal shows progress.`);
    return { ok: true, goal: this.publicGoal(goal) };
  },

  stopGoal() {
    this.repo.deleteSetting('goal');
    this.emit('goal', null);
  },

  goalProgress(entry) {
    const g = this.goalState();
    if (!g || g.done || !ACTION_KINDS.includes(entry.kind) || !entry.skill) return;
    if (g.skill !== 'any' && g.skill !== entry.skill) return;
    g.progress += 1;
    if (g.progress >= g.target) {
      g.done = true;
      g.doneAt = this.now();
      this.startBoost({ kind: 'xp', multiplier: g.multiplier, minutes: g.minutes, reason: 'channel goal reached', extend: true });
      this.announce(`🎉 CHANNEL GOAL REACHED! ${g.multiplier}x XP for everyone for ${g.minutes} minutes! GG chat!`);
    }
    this.repo.setSetting('goal', g);
    this.emit('goal', this.publicGoal(g));
  },

  // !goal
  goalInfo() {
    const g = this.goalState();
    if (!g) return 'no channel goal right now.';
    if (g.done) return `🎉 goal reached! ${this.boostInfo()}`;
    return `🎯 channel goal: ${fmt(g.progress)}/${fmt(g.target)} ${g.skill === 'any' ? 'actions' : `${SKILLS[g.skill].name} actions`} (${Math.floor((g.progress / g.target) * 100)}%). Reward: ${g.multiplier}x XP for everyone for ${g.minutes} min!`;
  },

  // ---- This stream's stats (for the overlay) -------------------------------------------------
  streamStats() {
    this._stream ??= this.repo.getSetting('stream_stats') || this.freshStreamStats();
    return this._stream;
  },

  freshStreamStats() {
    return { startedAt: this.now(), actions: 0, xp: {}, names: {}, lastRare: null, lastPet: null, mvp: null };
  },

  resetStreamStats() {
    this._stream = this.freshStreamStats();
    this.repo.setSetting('stream_stats', this._stream);
    this.emit('streamstats', this.publicStreamStats());
  },

  noteStreamXp(user, xp) {
    const st = this.streamStats();
    st.xp[user.id] = (st.xp[user.id] || 0) + xp;
    st.names[user.id] = user.username;
    this._streamDirty = true;
  },

  noteStreamActivity(user, entry) {
    const st = this.streamStats();
    if (ACTION_KINDS.includes(entry.kind)) st.actions += 1;
    const icon = entry.item ? ITEMS[entry.item]?.icon : null;
    let now = false;
    if (entry.kind === 'rare') {
      st.lastRare = { username: user.username, text: entry.text, icon };
      now = true;
    }
    if (entry.kind === 'pet') {
      st.lastPet = { username: user.username, text: entry.text, icon };
      now = true;
    }
    if (entry.kind === 'raid' && /MVP/.test(entry.text || '')) {
      st.mvp = { username: user.username, text: entry.text };
      now = true;
    }
    this._streamDirty = true;
    if (now) this.flushStreamStats();
  },

  publicStreamStats() {
    const st = this.streamStats();
    const top = Object.entries(st.xp)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, xp]) => ({ username: st.names[id], xp, appearance: this.characterView(Number(id)) }));
    const lim = this.limitedItem();
    const bounties = this.bounties().map((b) => ({ poster: b.poster, reward: b.reward, name: ITEMS[b.item].name, icon: ITEMS[b.item].icon }));
    return {
      startedAt: st.startedAt,
      actions: st.actions,
      top,
      lastRare: st.lastRare,
      lastPet: st.lastPet,
      mvp: st.mvp,
      limited: { name: lim.name, icon: lim.icon, cost: lim.cost },
      bounties: bounties.sort((a, b) => b.reward - a.reward).slice(0, 3),
    };
  },

  // Saves and broadcasts the stats (called from tick() and on big moments).
  flushStreamStats() {
    if (!this._streamDirty) return;
    this._streamDirty = false;
    this.repo.setSetting('stream_stats', this.streamStats());
    this.emit('streamstats', this.publicStreamStats());
  },

  // Housekeeping from tick(): clear a finished goal after a couple of minutes, share the stats.
  communityTick() {
    const g = this.goalState();
    if (g?.done && this.now() - g.doneAt > 120_000) this.stopGoal();
    this.flushStreamStats();
  },
};
