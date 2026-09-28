// GameEngine methods: quests, channel goals and this-stream stats. Mixed into GameEngine.prototype
// by engine.js. All three watch the activity feed (see progression.onActivity).
const { ITEMS, SKILLS, SKILL_IDS } = require('../skills');
const { QUESTS } = require('../content');
const { fmt } = require('./shared');

const ACTION_KINDS = ['action', 'rare'];

// Does an activity entry match a quest step?
function matches(m, entry) {
  const is = (want, got) => want === undefined || (Array.isArray(want) ? want.includes(got) : want === got);
  if (!is(m.kind ?? (m.monster || m.skill || m.item ? ACTION_KINDS : undefined), entry.kind)) return false;
  if (!is(m.skill, entry.skill) || !is(m.item, entry.item) || !is(m.monster, entry.monster)) return false;
  return !m.text || new RegExp(m.text).test(entry.text || '');
}

module.exports = {
  // ---- Quests ---------------------------------------------------------------------------
  questKey(userId) {
    return `quest:${userId}`;
  },

  // { chain, step, progress, done: [chain ids] }. Chains are done in order.
  questState(userId) {
    return this.repo.getSetting(this.questKey(userId)) || { chain: QUESTS[0].id, step: 0, progress: 0, done: [] };
  },

  questProgress(user, entry) {
    const st = this.questState(user.id);
    const chain = QUESTS.find((q) => q.id === st.chain);
    if (!chain) return;
    const step = chain.steps[st.step];
    if (!step || !matches(step.match, entry)) return;
    st.progress += 1;
    if (st.progress >= step.qty) {
      st.step += 1;
      st.progress = 0;
      if (st.step >= chain.steps.length) {
        st.done = [...st.done, chain.id];
        const next = QUESTS.find((q) => !st.done.includes(q.id));
        st.chain = next ? next.id : null;
        st.step = 0;
        this.repo.addPoints(user.id, chain.reward);
        this.track('rewards', chain.reward);
        this.repo.setSetting(this.questKey(user.id), st);
        this.emitActivity(user, { kind: 'quest', text: `completed the quest ${chain.icon} ${chain.name}! (title: ${chain.title})` });
        this.notify?.(user.id, `${chain.icon} Quest complete: ${chain.name}! +${fmt(chain.reward)} pts and the title "${chain.title}".`);
        this.announce(`📜 @${user.username} completed the quest ${chain.icon} ${chain.name}! +${fmt(chain.reward)} pts and the title "${chain.title}".${next ? ` Next: ${next.icon} ${next.name} (${this.cfg.prefix}quest)` : ''}`);
        return;
      }
      const nextStep = chain.steps[st.step];
      this.announce(`📜 @${user.username} ✅ ${step.text}! Next for ${chain.icon} ${chain.name}: ${nextStep.text} (0/${nextStep.qty}).`);
    }
    this.repo.setSetting(this.questKey(user.id), st);
  },

  // Titles from finished quest chains (added to the achievement titles).
  questTitles(userId) {
    const { done } = this.questState(userId);
    return QUESTS.filter((q) => done.includes(q.id)).map((q) => q.title);
  },

  // For the character page.
  publicQuests(userId) {
    const st = this.questState(userId);
    return QUESTS.map((q) => ({
      id: q.id,
      name: q.name,
      icon: q.icon,
      intro: q.intro,
      reward: q.reward,
      title: q.title,
      status: st.done.includes(q.id) ? 'done' : q.id === st.chain ? 'active' : 'locked',
      steps: q.steps.map((s, i) => ({
        text: s.text,
        qty: s.qty,
        have: st.done.includes(q.id) || (q.id === st.chain && i < st.step) ? s.qty : q.id === st.chain && i === st.step ? st.progress : 0,
      })),
    }));
  },

  // !quest
  questInfo(user) {
    const st = this.questState(user.id);
    const chain = QUESTS.find((q) => q.id === st.chain);
    if (!chain) return `📜 you've finished all ${QUESTS.length} quests! 🏆 Titles: ${this.questTitles(user.id).join(', ')}`;
    const step = chain.steps[st.step];
    return `📜 ${chain.icon} ${chain.name} (step ${st.step + 1}/${chain.steps.length}): ${step.text} ${st.progress}/${step.qty}. Reward: ${fmt(chain.reward)} pts + title "${chain.title}". ${st.step === 0 && !st.progress ? chain.intro : ''}`.trim();
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
