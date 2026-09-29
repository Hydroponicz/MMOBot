// GameEngine methods: player vs player. Heists (!rob richer players), the ranked arena (!arena, a
// weekly Elo ladder) and guild wars (guilds score PvP wins against other guilds each week).
// Mixed into GameEngine.prototype by engine.js.
//
// Economy: heists move points from richer to poorer players and destroy a cut of every heist and
// fine; guards are a voluntary sink that costs the rich more. Arena rewards come from entry fees
// (a cut is destroyed). Guild wars pay in XP, not points.
const { ITEMS, SKILLS, fmt, skillLevel, minutesLeft } = require('./shared');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MAX_GUARDS = 3;

module.exports = {
  // ---- Shared fight ---------------------------------------------------------------------------
  // Both players fight with their best weapon on a copy of their HP (nobody is hurt or knocked out).
  pvpFighter(userId) {
    const pick = this.chooseWeapon(userId);
    const level = pick.weapon ? pick.level : this.combatLevel(userId);
    const stats = pick.weapon ? this.fightStats(userId, pick) : { attack: 0, defence: this.combatStats(userId).defence };
    const skill = pick.weapon ? SKILLS[pick.skillId].name : 'Fists';
    return { id: userId, level, stats, hp: this.vitals(userId).maxHp, label: `${skill} ${level}${pick.weapon ? `, ${ITEMS[pick.weapon].name}` : ''}` };
  },

  // { winner, loser, rounds, a, b } (winner null = draw). a and b are the fighters.
  pvpFight(aId, bId) {
    const fa = this.pvpFighter(aId);
    const fb = this.pvpFighter(bId);
    const hit = (att, def) =>
      Math.max(1, Math.round((att.level + att.stats.attack) * (0.5 + 0.5 * this.rng()) * (1 - def.stats.defence / (def.stats.defence + 100))));
    let [x, y] = this.rng() < 0.5 ? [fa, fb] : [fb, fa];
    let rounds = 0;
    while (fa.hp > 0 && fb.hp > 0 && rounds < 500) {
      y.hp -= hit(x, y);
      [x, y] = [y, x];
      rounds++;
    }
    if (fa.hp > 0 && fb.hp > 0) return { winner: null, loser: null, rounds, a: fa, b: fb };
    const [winner, loser] = fa.hp > 0 ? [fa, fb] : [fb, fa];
    return { winner, loser, rounds, a: fa, b: fb };
  },

  pvpState(key, fallback) {
    return this.repo.getSetting(key) || fallback;
  },

  // Titles won in PvP (arena champions, guild war heroes), shown with the other titles.
  pvpTitles(userId) {
    return this.pvpState('pvp_titles', {})[userId] || [];
  },

  addPvpTitle(userId, title) {
    const all = this.pvpState('pvp_titles', {});
    const mine = all[userId] || [];
    if (!mine.includes(title)) all[userId] = [...mine, title];
    this.repo.setSetting('pvp_titles', all);
  },

  agilityLevel(userId) {
    return skillLevel('agility', this.repo.getSkills(userId).agility || 0);
  },

  // ---- Heists --------------------------------------------------------------------------------
  heistCfg() {
    const c = this.cfg;
    return {
      on: c.heistsEnabled !== false,
      minTarget: c.heistMinTarget ?? 5000,
      stealPct: c.heistStealPct ?? 0.03,
      maxSteal: c.heistMaxSteal ?? 25000,
      fencePct: c.heistFencePct ?? 0.2,
      finePct: c.heistFinePct ?? 0.05,
      maxFine: c.heistMaxFine ?? 10000,
      baseChance: c.heistBaseChance ?? 0.4,
      protectMinutes: c.heistProtectMinutes ?? 60,
      jailMinutes: c.heistJailMinutes ?? 30,
      sameTargetHours: c.heistSameTargetHours ?? 6,
      guardPct: c.heistGuardPct ?? 0.005,
      dailyLoot: c.heistDailyLoot ?? 50000,
    };
  },

  heistInfo(userId) {
    return this.pvpState(`heist:${userId}`, { guards: 0, guardsUntil: 0, protectedUntil: 0, jailUntil: 0, last: {} });
  },

  saveHeistInfo(userId, info) {
    this.repo.setSetting(`heist:${userId}`, info);
  },

  guardLevel(userId, now = this.now()) {
    const h = this.heistInfo(userId);
    return h.guardsUntil > now ? h.guards : 0;
  },

  // Guards cost a share of what you hold, per level, per day: they cost the rich the most.
  guardPrice(userId, level) {
    const pts = this.repo.getUser(userId).points;
    return level * Math.max(500, Math.round(pts * this.heistCfg().guardPct));
  },

  // Chance that robber takes from victim: better Agility than the victim helps, guards hurt.
  heistChance(robberId, victimId) {
    const hc = this.heistCfg();
    const diff = this.agilityLevel(robberId) - this.agilityLevel(victimId);
    const chance = hc.baseChance + diff * 0.002 - this.guardLevel(victimId) * 0.12;
    return Math.min(0.75, Math.max(0.1, chance));
  },

  // How much a successful heist on this victim would take (before the fence's cut).
  heistTake(victimId) {
    const hc = this.heistCfg();
    return Math.min(hc.maxSteal, Math.floor(this.repo.getUser(victimId).points * hc.stealPct));
  },

  // !rob @name: one stamina charge. Only players richer than you (and holding at least heistMinTarget).
  rob(user, args = []) {
    const hc = this.heistCfg();
    const p = this.cfg.prefix;
    if (!hc.on) return 'heists are switched off right now.';
    if (!args.length) return `usage: ${p}rob @name (only players richer than you). ${p}guards protects you. Most wanted: ${this.siteUrl}/#/pvp`;
    const blocked = this.marketBlocked(user.id);
    if (blocked) return blocked.replace("can't buy, sell or trade with other players", "can't rob other players");
    const name = String(args[0]).replace(/^@/, '');
    const target = this.repo.getUserByName(name);
    if (!target || target.banned) return `no adventurer named ${name}.`;
    if (target.id === user.id) return "you can't rob yourself!";
    const now = this.now();
    const me = this.repo.getUser(user.id);
    const mine = this.heistInfo(user.id);
    if (mine.jailUntil > now) return `🚔 you're lying low after a failed heist. Try again in ${minutesLeft(mine.jailUntil - now)}.`;
    if (target.points <= me.points) return `you can only rob players richer than you (@${target.username} has ${fmt(target.points)} pts, you have ${fmt(me.points)}).`;
    if (target.points < hc.minTarget) return `@${target.username} isn't worth robbing (under ${fmt(hc.minTarget)} pts).`;
    const theirs = this.heistInfo(target.id);
    if (theirs.protectedUntil > now) return `@${target.username} was robbed recently and is on guard for ${minutesLeft(theirs.protectedUntil - now)}.`;
    const lastHit = mine.last?.[target.id] || 0;
    if (now - lastHit < hc.sameTargetHours * HOUR) return `you robbed @${target.username} not long ago. They'll be ready for you again in ${minutesLeft(lastHit + hc.sameTargetHours * HOUR - now)}.`;
    // A cap on what one player can take a day, so heists can't be used to empty a main into an alt.
    const today = new Date(now).toISOString().slice(0, 10);
    if (mine.day !== today) Object.assign(mine, { day: today, looted: 0 });
    if (hc.dailyLoot && mine.looted >= hc.dailyLoot) return `🦹 you've taken ${fmt(mine.looted)} pts in heists today, the most allowed. Lie low until tomorrow.`;
    const tired = this.staminaCheck(user, now);
    if (tired !== null) return tired || null;

    const chance = this.heistChance(user.id, target.id);
    const guards = this.guardLevel(target.id, now);
    const success = this.rng() < chance;
    let reply;
    this.repo.transaction(() => {
      this.spendStamina(user, now);
      this.repo.setActionAt(user.id, now);
      mine.last = Object.fromEntries(Object.entries({ ...(mine.last || {}), [target.id]: now }).filter(([, at]) => now - at < hc.sameTargetHours * HOUR));
      if (success) {
        const take = Math.min(this.heistTake(target.id), hc.dailyLoot ? Math.ceil((hc.dailyLoot - mine.looted) / (1 - hc.fencePct)) : Infinity);
        mine.looted += take - Math.floor(take * hc.fencePct);
        const fence = Math.floor(take * hc.fencePct);
        this.repo.addPoints(target.id, -take);
        this.repo.addPoints(user.id, take - fence);
        this.track('traded', take - fence);
        this.track('pvp', fence);
        theirs.protectedUntil = now + hc.protectMinutes * MIN;
        this.saveHeistInfo(target.id, theirs);
        this.logHeist({ at: now, robber: user.username, victim: target.username, ok: true, amount: take });
        this.guildWarScore(user.id, target.id, 2, 'heist');
        this.notify(target.id, `🦹 ${user.username} robbed you for ${fmt(take)} pts! Hire ${p}guards to make it harder.`);
        this.emitActivity(user, { kind: 'heist', text: `pulled off a heist on ${target.username} for ${fmt(take - fence)} pts! 🦹` });
        reply = `🦹 heist on @${target.username} succeeded${guards ? ` (past ${guards} guard${guards > 1 ? 's' : ''})` : ''}! You got away with ${fmt(take - fence)} pts (the fence kept ${fmt(fence)}). Balance: ${fmt(this.repo.getUser(user.id).points)}`;
      } else {
        const fine = Math.min(hc.maxFine, Math.max(100, Math.floor(me.points * hc.finePct)), me.points);
        const toVictim = Math.floor(fine / 2);
        this.repo.addPoints(user.id, -fine);
        this.repo.addPoints(target.id, toVictim);
        this.track('pvp', fine - toVictim);
        mine.jailUntil = now + hc.jailMinutes * MIN;
        this.logHeist({ at: now, robber: user.username, victim: target.username, ok: false, amount: fine });
        this.notify(target.id, `🛡️ ${user.username} tried to rob you and got caught. You got ${fmt(toVictim)} pts of their fine.`);
        this.emitActivity(user, { kind: 'heist', text: `got caught trying to rob ${target.username} 🚔` });
        reply = `🚔 caught robbing @${target.username}${guards ? ` by their ${guards} guard${guards > 1 ? 's' : ''}` : ''}! Fined ${fmt(fine)} pts (half goes to them) and you're lying low for ${hc.jailMinutes}m. Your odds were ${Math.round(chance * 100)}%.`;
      }
      this.saveHeistInfo(user.id, mine);
    });
    return reply;
  },

  logHeist(entry) {
    const log = this.pvpState('heist_log', []);
    log.unshift(entry);
    this.repo.setSetting('heist_log', log.slice(0, 30));
  },

  // !guards [1-3]: shows your guards, or hires that many for 24 hours.
  guards(user, args = []) {
    const hc = this.heistCfg();
    const p = this.cfg.prefix;
    if (!hc.on) return 'heists are switched off right now.';
    const now = this.now();
    const info = this.heistInfo(user.id);
    const have = this.guardLevel(user.id, now);
    const want = Number.parseInt(args[0], 10);
    if (!want) {
      const prices = [1, 2, 3].map((n) => `${n}: ${fmt(this.guardPrice(user.id, n))}`).join(', ');
      return `🛡️ ${have ? `${have} guard${have > 1 ? 's' : ''} on duty for ${minutesLeft(info.guardsUntil - now)}` : 'no guards on duty'}. Each guard cuts robbers' odds by 12% for 24h. ${p}guards <1-3> hires them (pts: ${prices}).`;
    }
    if (want < 1 || want > MAX_GUARDS) return `you can hire 1 to ${MAX_GUARDS} guards.`;
    const cost = this.guardPrice(user.id, want);
    const refused = this.repo.transaction(() => {
      const balance = this.repo.getUser(user.id).points;
      if (balance < cost) return `${want} guard${want > 1 ? 's' : ''} cost ${fmt(cost)} pts for 24h, you have ${fmt(balance)}.`;
      this.repo.addPoints(user.id, -cost);
      this.track('pvp', cost);
      this.saveHeistInfo(user.id, { ...info, guards: want, guardsUntil: now + DAY });
      return null;
    });
    return refused || `🛡️ hired ${want} guard${want > 1 ? 's' : ''} for 24h (${fmt(cost)} pts). Robbers' odds against you: -${want * 12}%.`;
  },

  // The richest players, their guards and whether they can be robbed right now (website).
  mostWanted(viewerId = null) {
    const hc = this.heistCfg();
    const now = this.now();
    return this.repo
      .leaderboard('points', 10)
      .filter((r) => r.points >= hc.minTarget && !this.repo.getUser(r.id)?.banned)
      .map((r) => {
        const u = this.repo.getUser(r.id);
        const h = this.heistInfo(u.id);
        return {
          username: r.username,
          points: r.points,
          take: this.heistTake(u.id),
          guards: this.guardLevel(u.id, now),
          protectedFor: h.protectedUntil > now ? h.protectedUntil - now : 0,
          chance: viewerId && viewerId !== u.id ? Math.round(this.heistChance(viewerId, u.id) * 100) : null,
        };
      });
  },

  // ---- Ranked arena ---------------------------------------------------------------------------
  arenaCfg() {
    const c = this.cfg;
    return { on: c.arenaEnabled !== false, fee: c.arenaFee ?? 100, perDay: c.arenaFightsPerDay ?? 10, burn: c.arenaBurnPct ?? 0.1 };
  },

  // The arena state for this week; last week's is paid out first.
  arena() {
    const week = this.weekIndex();
    let a = this.pvpState('arena', null);
    if (!a) a = { week, pot: 0, ratings: {} };
    if (a.week !== week) a = this.arenaSeasonEnd(a, week);
    return a;
  },

  // Pays the top 3 from the pot (50/30/20), gives the champion a title, and pulls everyone's
  // rating halfway back to 1,000 for the new week.
  arenaSeasonEnd(a, week) {
    const top = Object.entries(a.ratings)
      .filter(([, r]) => r.w + r.l > 0)
      .sort((x, y) => y[1].r - x[1].r)
      .slice(0, 3);
    const shares = [0.5, 0.3, 0.2];
    const results = [];
    top.forEach(([uid, r], i) => {
      const prize = Math.floor(a.pot * shares[i]);
      const u = this.repo.getUser(Number(uid));
      if (!u) return;
      if (prize) this.repo.addPoints(u.id, prize);
      if (i === 0) this.addPvpTitle(u.id, 'Arena Champion');
      this.notify(u.id, `🏟️ You finished #${i + 1} in last week's ranked arena (${r.r} rating)${prize ? ` and won ${fmt(prize)} pts` : ''}!`);
      results.push({ username: u.username, rating: r.r, prize });
    });
    if (results.length) {
      this.repo.setSetting('arena_last', { week: a.week, results });
      this.announce?.(`🏟️ Ranked arena week over! Champion: @${results[0].username} (${results[0].rating}).${results.length > 1 ? ` Runners-up: ${results.slice(1).map((r) => `@${r.username}`).join(', ')}.` : ''}`);
    }
    const ratings = Object.fromEntries(Object.entries(a.ratings).map(([uid, r]) => [uid, { r: Math.round(1000 + (r.r - 1000) / 2), w: 0, l: 0, day: '', today: 0, recent: [] }]));
    const next = { week, pot: 0, ratings };
    this.repo.setSetting('arena', next);
    return next;
  },

  arenaRating(a, userId) {
    return (a.ratings[userId] ??= { r: 1000, w: 0, l: 0, day: '', today: 0, recent: [] });
  },

  // !arena: a ranked fight against the closest-rated opponent (they don't need to be online; you
  // fight their gear and levels). One stamina charge and an entry fee into the weekly prize pot.
  arenaFight(user, args = []) {
    const ac = this.arenaCfg();
    const p = this.cfg.prefix;
    if (!ac.on) return 'the arena is closed right now.';
    const sub = String(args[0] || '').toLowerCase();
    if (sub === 'top' || sub === 'rank' || sub === 'info') return this.arenaInfo(user);
    const blocked = this.marketBlocked(user.id);
    if (blocked) return blocked.replace("can't buy, sell or trade with other players", "can't fight in the ranked arena");
    const now = this.now();
    const a = this.arena();
    const me = this.arenaRating(a, user.id);
    const day = new Date(now).toISOString().slice(0, 10);
    if (me.day !== day) Object.assign(me, { day, today: 0 });
    if (me.today >= ac.perDay) return `🏟️ that's your ${ac.perDay} ranked fights for today. Back tomorrow! (${p}arena top shows the ladder)`;
    if (this.repo.getUser(user.id).points < ac.fee) return `the arena entry fee is ${fmt(ac.fee)} pts.`;
    // Opponent: the closest rating among other players who can fight (anyone who has played), not one
    // of your last three.
    const pool = this.repo
      .leaderboard('overall', 60)
      .map((r) => this.repo.getUser(r.id))
      .filter((u) => u && u.id !== user.id && !u.banned && !(me.recent || []).includes(u.id));
    if (!pool.length) return '🏟️ no opponents yet: the arena needs more players!';
    pool.sort((x, y) => Math.abs(this.arenaRating(a, x.id).r - me.r) - Math.abs(this.arenaRating(a, y.id).r - me.r));
    const opp = pool[Math.floor(this.rng() * Math.min(3, pool.length))];
    const tired = this.staminaCheck(user, now);
    if (tired !== null) return tired || null;
    const them = this.arenaRating(a, opp.id);
    const fight = this.pvpFight(user.id, opp.id);
    const won = fight.winner?.id === user.id;
    const draw = !fight.winner;
    const expected = 1 / (1 + 10 ** ((them.r - me.r) / 400));
    const score = draw ? 0.5 : won ? 1 : 0;
    const delta = Math.round(32 * (score - expected));
    let reply;
    this.repo.transaction(() => {
      this.spendStamina(user, now);
      this.repo.setActionAt(user.id, now);
      this.repo.addPoints(user.id, -ac.fee);
      const burned = Math.floor(ac.fee * ac.burn);
      this.track('pvp', burned);
      a.pot += ac.fee - burned;
      me.r += delta;
      them.r -= delta;
      me.today++;
      me.recent = [opp.id, ...(me.recent || [])].slice(0, 3);
      if (!draw) {
        if (won) {
          me.w++;
          them.l++;
        } else {
          me.l++;
          them.w++;
        }
      }
      this.repo.setSetting('arena', a);
      if (won) this.guildWarScore(user.id, opp.id, 3, 'arena');
      const vs = `@${opp.username} (${them.r - (draw ? 0 : -delta)})`;
      reply = draw
        ? `🏟️ ${fight.rounds} rounds with ${vs} and nobody fell: a draw. Rating ${me.r} (${delta >= 0 ? '+' : ''}${delta}).`
        : `🏟️ ${won ? 'WIN' : 'loss'} vs ${vs} in ${fight.rounds} rounds (${fight.a.label} vs ${fight.b.label}). Rating ${me.r} (${delta >= 0 ? '+' : ''}${delta}) · ${me.w}W ${me.l}L · ${ac.perDay - me.today} ranked fights left today.`;
      if (won) this.emitActivity(user, { kind: 'duel', text: `won a ranked arena fight against ${opp.username} (${me.r}) 🏟️` });
    });
    return reply;
  },

  arenaLadder(limit = 10) {
    const a = this.arena();
    return Object.entries(a.ratings)
      .filter(([, r]) => r.w + r.l > 0)
      .sort((x, y) => y[1].r - x[1].r)
      .slice(0, limit)
      .map(([uid, r], i) => ({ rank: i + 1, username: this.repo.getUser(Number(uid))?.username, rating: r.r, wins: r.w, losses: r.l }))
      .filter((r) => r.username);
  },

  arenaInfo(user) {
    const a = this.arena();
    const me = a.ratings[user.id];
    const top = this.arenaLadder(5).map((r) => `${r.rank}. ${r.username} ${r.rating}`).join(' | ');
    return `🏟️ Ranked arena (pot ${fmt(a.pot)} pts, paid to the top 3 on Monday): ${top || 'no fights yet this week'}.${me ? ` You: ${me.r} (${me.w}W ${me.l}L).` : ''} ${this.cfg.prefix}arena to fight.`;
  },

  // ---- Guild wars -----------------------------------------------------------------------------
  // Each week guilds score war points when a member beats a member of another guild: arena wins 3,
  // heists 2, duels 1. The winning guild's members get +5% XP all next week.
  guildWar() {
    const week = this.weekIndex();
    let w = this.pvpState('guildwar', null);
    if (!w) w = { week, scores: {}, heroes: {} };
    if (w.week !== week) w = this.guildWarEnd(w, week);
    return w;
  },

  guildWarEnd(w, week) {
    const ranked = Object.entries(w.scores).sort((x, y) => y[1] - x[1]);
    if (ranked.length && ranked[0][1] > 0) {
      const [gid, score] = ranked[0];
      const g = this.repo.guildById?.(Number(gid)) || this.repo.guildList().find((x) => x.id === Number(gid));
      const heroes = Object.entries(w.heroes[gid] || {}).sort((x, y) => y[1] - x[1]);
      const hero = heroes[0] ? this.repo.getUser(Number(heroes[0][0])) : null;
      if (hero) this.addPvpTitle(hero.id, 'Warlord');
      this.repo.setSetting('guildwar_last', { week: w.week, guildId: Number(gid), name: g?.name, tag: g?.tag, score, hero: hero?.username || null, buffUntil: (week + 1) * 7 * DAY + this.weekStartOffset() });
      this.announce?.(`⚔️ Guild war over! [${g?.tag}] ${g?.name} won with ${score} war points${hero ? ` (Warlord: @${hero.username})` : ''}. Their members get +${Math.round((this.cfg.guildWarXpBonus ?? 0.05) * 100)}% XP all week!`);
    }
    const next = { week, scores: {}, heroes: {} };
    this.repo.setSetting('guildwar', next);
    return next;
  },

  // Monday 00:00 UTC offset used by weekIndex (weeks start on Monday).
  weekStartOffset() {
    return 4 * DAY;
  },

  // Called on PvP wins: scores only when both players are in different guilds.
  guildWarScore(winnerId, loserId, pts, kind) {
    if (this.cfg.guildWarsEnabled === false) return;
    const gw = this.repo.guildOf(winnerId);
    const gl = this.repo.guildOf(loserId);
    if (!gw || !gl || gw.id === gl.id) return;
    const w = this.guildWar();
    w.scores[gw.id] = (w.scores[gw.id] || 0) + pts;
    (w.heroes[gw.id] ??= {})[winnerId] = (w.heroes[gw.id][winnerId] || 0) + pts;
    this.repo.setSetting('guildwar', w);
    void kind;
  },

  // XP multiplier for members of last week's winning guild.
  guildWarXp(userId) {
    const last = this.pvpState('guildwar_last', null);
    if (!last || !(last.buffUntil > this.now())) return 1;
    return this.repo.guildOf(userId)?.id === last.guildId ? 1 + (this.cfg.guildWarXpBonus ?? 0.05) : 1;
  },

  guildWarStandings() {
    const w = this.guildWar();
    const guilds = new Map(this.repo.guildList().map((g) => [g.id, g]));
    return Object.entries(w.scores)
      .sort((x, y) => y[1] - x[1])
      .map(([gid, score], i) => {
        const g = guilds.get(Number(gid));
        const top = Object.entries(w.heroes[gid] || {}).sort((x, y) => y[1] - x[1])[0];
        return { rank: i + 1, name: g?.name, tag: g?.tag, score, hero: top ? this.repo.getUser(Number(top[0]))?.username : null };
      })
      .filter((g) => g.name);
  },

  // !war
  guildWarInfo(user) {
    const rows = this.guildWarStandings().slice(0, 5);
    const last = this.pvpState('guildwar_last', null);
    const mine = this.repo.guildOf(user.id);
    const buff = last && last.buffUntil > this.now() ? ` Last week: [${last.tag}] ${last.name} (+XP this week).` : '';
    return `⚔️ Guild war this week: ${rows.length ? rows.map((r) => `${r.rank}. [${r.tag}] ${r.score}`).join(' | ') : 'no war points yet'}.${buff} Beat other guilds' members: ${this.cfg.prefix}arena win 3, ${this.cfg.prefix}rob 2, ${this.cfg.prefix}duel 1.${mine ? '' : ` Join a guild to take part (${this.cfg.prefix}guild).`}`;
  },

  // Everything for the website's PvP page.
  pvpPage(viewerId = null) {
    const a = this.arena();
    const me = viewerId ? a.ratings[viewerId] : null;
    const h = viewerId ? this.heistInfo(viewerId) : null;
    const now = this.now();
    return {
      heists: {
        on: this.heistCfg().on,
        mostWanted: this.mostWanted(viewerId),
        log: this.pvpState('heist_log', []).slice(0, 15),
        me: viewerId
          ? { guards: this.guardLevel(viewerId, now), guardsUntil: h.guardsUntil, jailFor: h.jailUntil > now ? h.jailUntil - now : 0, guardPrices: [1, 2, 3].map((n) => this.guardPrice(viewerId, n)) }
          : null,
        cfg: (({ stealPct, maxSteal, fencePct, finePct, protectMinutes, jailMinutes, minTarget }) => ({ stealPct, maxSteal, fencePct, finePct, protectMinutes, jailMinutes, minTarget }))(this.heistCfg()),
      },
      arena: { on: this.arenaCfg().on, pot: a.pot, fee: this.arenaCfg().fee, perDay: this.arenaCfg().perDay, ladder: this.arenaLadder(20), last: this.pvpState('arena_last', null), me: me ? { rating: me.r, wins: me.w, losses: me.l } : null },
      war: { on: this.cfg.guildWarsEnabled !== false, standings: this.guildWarStandings(), last: this.pvpState('guildwar_last', null), bonus: this.cfg.guildWarXpBonus ?? 0.05 },
    };
  },
};
