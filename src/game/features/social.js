// GameEngine methods: automatic seasons, the hall of fame, stream streaks, bounties, dungeons and
// the weekly limited shop item. Mixed into GameEngine.prototype by engine.js.
const { ITEMS, SKILLS, SKILL_IDS, COMBAT_SKILLS, maxLevel } = require('../skills');
const { SEASON_COSMETICS, LIMITED_SHOP } = require('../content');
const { fmt, itemLabel, findItem, clamp, skillLevel } = require('./shared');

const DAY = 86_400_000;
const WEEK = 7 * DAY;
// Weeks start on Monday 00:00 UTC (1970-01-05 was a Monday).
const MONDAY = 4 * DAY;
const STREAK_REWARDS = { 5: 500, 10: 1500, 25: 5000 };
const DUNGEON_LOBBY_MS = 60_000;
const DUNGEON_MAX = 5;

module.exports = {
  // ---- Seasons ------------------------------------------------------------------------------
  // Automatic seasons count from when the season started, or from when automatic seasons were first
  // switched on (so an old season doesn't end the moment this is deployed).
  seasonEndsAt(s = this.season()) {
    const days = this.cfg.seasonDays ?? 30;
    if (!s.startedAt || days <= 0) return null;
    return Math.max(s.startedAt, this.repo.getSetting('season_auto_since') || 0) + days * DAY;
  },

  // !hall
  hallInfo() {
    const h = this.publicHall();
    const maxed = h.max.filter((m) => m.first).map((m) => `${m.icon} ${m.first.username}`);
    const big = h.casino[0];
    const last = h.seasons[0];
    return `🏛️ Hall of fame: ${last ? `Season ${last.number} winner ${last.winners[0]?.username || '—'}. ` : ''}${maxed.length ? `First to 500: ${maxed.slice(0, 6).join(', ')}. ` : ''}${big ? `Biggest win: ${big.username} ${fmt(big.amount)} pts. ` : ''}${this.siteUrl}/#/hall`;
  },

  // Season winners also get a cosmetic nobody can buy (called from endSeason).
  giveSeasonCosmetics(winners, number) {
    winners.forEach((w, i) => {
      for (const [place, id] of SEASON_COSMETICS) {
        if (place !== i + 1) continue;
        if (!this.repo.getInventory(w.id)[id]) this.repo.addItem(w.id, id, 1);
        this.notify(w.id, `${ITEMS[id].icon} You won the ${ITEMS[id].name} for placing #${place} in Season ${number}! Wear it on the Customize page.`);
      }
    });
  },

  // ---- Hall of fame ---------------------------------------------------------------------------
  hall() {
    return this.repo.getSetting('hall') || { max: {}, pets: {}, casino: [] };
  },

  recordFirst(kind, key, user) {
    const h = this.hall();
    if (h[kind][key]) return;
    h[kind][key] = { username: user.username, at: this.now() };
    this.repo.setSetting('hall', h);
  },

  recordCasinoWin(user, amount, text) {
    const h = this.hall();
    h.casino = [...h.casino, { username: user.username, amount, text, at: this.now() }].sort((a, b) => b.amount - a.amount).slice(0, 10);
    this.repo.setSetting('hall', h);
  },

  publicHall() {
    const h = this.hall();
    const max = SKILL_IDS.map((id) => {
      let first = h.max[id];
      // Players who got there before the hall existed: the current top player, if they're maxed.
      if (!first) {
        const top = this.repo.leaderboard(id, 1)[0];
        if (top && skillLevel(id, top.xp) >= maxLevel(id)) first = { username: top.username, at: null };
      }
      return { skill: id, name: SKILLS[id].name, icon: SKILLS[id].icon, first: first || null };
    });
    const pets = Object.entries(h.pets).map(([id, f]) => ({ id, name: ITEMS[id]?.name, icon: ITEMS[id]?.icon, ...f }));
    const seasons = (this.repo.getSetting('seasons') || []).slice(-12).reverse();
    return { seasons, max, pets, casino: h.casino };
  },

  // ---- Stream streaks and last seen --------------------------------------------------------------
  // Streams are numbered when they go live. Without live/offline updates from Kick, each UTC day counts
  // as a stream.
  streamNumber() {
    const n = this.repo.getSetting('stream_no');
    return n ? { id: n, day: false } : { id: Math.floor(this.now() / DAY), day: true };
  },

  // Called for every chat message.
  noteStreamPresence(user) {
    const now = this.now();
    this.seenAt ??= new Map();
    if (now - (this.seenAt.get(user.id) || 0) > 60_000) {
      this.seenAt.set(user.id, now);
      this.repo.setLastSeen(user.id, now);
    }
    const { id } = this.streamNumber();
    this.streakSeen ??= new Map();
    if (this.streakSeen.get(user.id) === id) return;
    this.streakSeen.set(user.id, id);
    const key = `streak:${user.id}`;
    const st = this.repo.getSetting(key) || { last: null, streak: 0, best: 0 };
    if (st.last === id) return;
    st.streak = st.last === id - 1 ? st.streak + 1 : 1;
    st.best = Math.max(st.best, st.streak);
    st.last = id;
    this.repo.setSetting(key, st);
    const reward = STREAK_REWARDS[st.streak];
    if (reward) {
      this.repo.addPoints(user.id, reward);
      this.track('rewards', reward);
      const what = this.streamNumber().day ? 'days' : 'streams';
      this.announce(`🔥 @${user.username} has been here ${st.streak} ${what} in a row! +${fmt(reward)} pts`);
      this.notify(user.id, `🔥 ${st.streak} ${what} in a row! +${fmt(reward)} pts`);
    }
  },

  streamStreak(userId) {
    const st = this.repo.getSetting(`streak:${userId}`) || { last: null, streak: 0, best: 0 };
    const { id, day } = this.streamNumber();
    // A streak only counts if they were at this stream or the one before.
    const alive = st.last === id || st.last === id - 1;
    return { streak: alive ? st.streak : 0, best: st.best, unit: day ? 'days' : 'streams' };
  },

  // ---- Bounties ---------------------------------------------------------------------------------
  // A player puts up points for the first person to get an item from an action (not the shop or trades).
  bounties() {
    const now = this.now();
    const list = this.repo.getSetting('bounties') || [];
    const live = list.filter((b) => b.expiresAt > now);
    if (live.length !== list.length) {
      for (const b of list.filter((x) => x.expiresAt <= now)) {
        this.repo.addPoints(b.posterId, b.reward);
        this.notify(b.posterId, `⌛ Your bounty for ${ITEMS[b.item].icon} ${ITEMS[b.item].name} expired. ${fmt(b.reward)} pts refunded.`);
      }
      this.repo.setSetting('bounties', live);
    }
    return live;
  },

  bountyable(id) {
    const it = ITEMS[id];
    return it && !it.cosmetic && !it.pet && !it.bound && !this.shopItems().some((x) => x.item === id);
  },

  // !bounty <item> <points> | !bounty cancel
  bounty(user, args = []) {
    const p = this.cfg.prefix;
    if (this.cfg.tradingEnabled === false) return 'trading (and bounties) are switched off right now.';
    const words = args.map((w) => String(w).toLowerCase());
    const list = this.bounties();
    const mine = list.find((b) => b.posterId === user.id);
    if (!words.length) return this.bountyList();
    if (words[0] === 'cancel') {
      if (!mine) return "you don't have a bounty up.";
      this.repo.setSetting('bounties', list.filter((b) => b !== mine));
      this.repo.addPoints(user.id, mine.reward);
      return `cancelled your bounty. ${fmt(mine.reward)} pts refunded.`;
    }
    const amount = Number(words[words.length - 1].replace(/k$/, '000').replace(/[,_]/g, ''));
    const id = findItem(words.slice(0, -1).join(' '), Object.keys(ITEMS).filter((i) => this.bountyable(i)));
    if (!id || !(amount > 0)) return `usage: ${p}bounty <item> <points>, e.g. ${p}bounty goblin crown 5000. The first player to get one from an action wins the points.`;
    if (mine) return `you already have a bounty up (${ITEMS[mine.item].name}). ${p}bounty cancel first.`;
    const blocked = this.marketBlocked(user.id);
    if (blocked) return blocked.replace('use the market', 'post bounties');
    const capped = this.giftAllowanceError(user.id, amount);
    if (capped) return capped;
    if (list.length >= 10) return 'the bounty board is full (10). Try again later.';
    if (amount < 100 || amount > 1_000_000) return 'bounties are 100 to 1,000,000 pts.';
    if (this.repo.getUser(user.id).points < amount) return `you only have ${fmt(this.repo.getUser(user.id).points)} pts.`;
    const b = { id: this.now(), posterId: user.id, poster: user.username, item: id, reward: Math.floor(amount), createdAt: this.now(), expiresAt: this.now() + 7 * DAY };
    this.repo.addPoints(user.id, -b.reward);
    this.spendGiftAllowance(user.id, b.reward);
    this.repo.setSetting('bounties', [...list, b]);
    this.announce(`🎯 BOUNTY: @${user.username} pays ${fmt(b.reward)} pts to the first player to get ${itemLabel(id)}! (7 days)`);
    return `bounty posted: ${fmt(b.reward)} pts for ${itemLabel(id)}. The points are held until someone claims it (or refunded after 7 days).`;
  },

  bountyList() {
    const list = this.bounties();
    if (!list.length) return `no bounties right now. ${this.cfg.prefix}bounty <item> <points> to post one.`;
    return `🎯 Bounties: ${list.map((b) => `${ITEMS[b.item].icon} ${ITEMS[b.item].name} ${fmt(b.reward)} pts (by ${b.poster})`).join(' · ')}`;
  },

  // From the activity feed: an item found by an action claims its bounty.
  claimBounty(user, entry) {
    if (!['action', 'rare'].includes(entry.kind) || !entry.item || entry.summary) return;
    const list = this.repo.getSetting('bounties') || [];
    const b = list.find((x) => x.item === entry.item && x.posterId !== user.id && x.expiresAt > this.now());
    if (!b) return;
    this.repo.setSetting('bounties', list.filter((x) => x !== b));
    this.repo.addPoints(user.id, b.reward);
    this.notify(b.posterId, `🎯 ${user.username} claimed your bounty for ${ITEMS[b.item].icon} ${ITEMS[b.item].name}.`);
    this.notify(user.id, `🎯 You claimed ${b.poster}'s bounty: +${fmt(b.reward)} pts!`);
    this.announce(`🎯 @${user.username} claimed @${b.poster}'s bounty for ${itemLabel(b.item)}: +${fmt(b.reward)} pts!`);
  },

  // ---- Dungeons -------------------------------------------------------------------------------------
  // !dungeon opens a party (or joins the open one). After a minute (or with 5 players) the party runs
  // three rooms and a boss. Clearing rooms gives XP and loot; the boss drops dungeon-only loot.
  dungeonCheck(user) {
    const vit = this.vitals(user.id);
    if (vit.ko) return this.knockedOutMessage(user.id, vit, this.now());
    const pick = this.chooseWeapon(user.id);
    if (!pick.weapon) return `you need a weapon for the dungeon! ${this.howToGetSword(user)}`;
    const tired = this.staminaCheck(user);
    if (tired !== null) return tired || null;
    return null;
  },

  dungeonJoin(user) {
    const p = this.cfg.prefix;
    const now = this.now();
    const d = this.dungeon;
    if (d && d.members.includes(user.id)) return `you're in the party (${d.members.length}/${DUNGEON_MAX}). It sets off in ${Math.max(1, Math.ceil((d.startsAt - now) / 1000))}s.`;
    const blocked = this.dungeonCheck(user);
    if (blocked !== null) return blocked;
    if (!d) {
      this.dungeon = { members: [user.id], names: { [user.id]: user.username }, startsAt: now + DUNGEON_LOBBY_MS };
      this.announce(`🏰 @${user.username} is gathering a party for a DUNGEON! Type ${p}dungeon to join (2-${DUNGEON_MAX} players). Leaving in 60s!`);
      return null;
    }
    d.members.push(user.id);
    d.names[user.id] = user.username;
    if (d.members.length >= DUNGEON_MAX) {
      this.runDungeon();
      return null;
    }
    return `joined the dungeon party (${d.members.length}/${DUNGEON_MAX})!`;
  },

  runDungeon() {
    const d = this.dungeon;
    this.dungeon = null;
    if (!d) return null;
    const users = d.members.map((id) => this.repo.getUser(id)).filter((u) => u && !u.banned);
    if (users.length < 2) {
      this.announce(`🏰 Not enough adventurers joined @${d.names[d.members[0]]}'s dungeon party (it needs 2+). Try again!`);
      return null;
    }
    const monsters = SKILLS[COMBAT_SKILLS[0]].monsters;
    const fighters = users.map((u) => {
      const pick = this.chooseWeapon(u.id);
      const stats = pick.weapon ? this.fightStats(u.id, pick) : { attack: 0, defence: 0 };
      this.spendStamina(u);
      return { u, pick, level: pick.weapon ? pick.level : this.combatLevel(u.id), attack: stats.attack };
    });
    const avg = fighters.reduce((s, f) => s + f.level, 0) / fighters.length;
    const avgAtk = fighters.reduce((s, f) => s + f.attack, 0) / fighters.length;
    // Rooms around the party's level, a boss above it.
    const near = (lvl) => [...monsters].reverse().find((m) => m.level <= lvl) || monsters[0];
    const rooms = [near(avg * 0.8), near(avg), near(avg * 1.1), near(avg * 1.4)];
    const boss = rooms[3];
    const score = avg * (1 + 0.15 * (fighters.length - 1)) + avgAtk * 0.5;
    const log = [];
    let cleared = 0;
    for (const [i, m] of rooms.entries()) {
      const diff = m.level * (i === 3 ? 1.3 : 1);
      const chance = clamp(0.55 + (score - diff) / (diff + 10), 0.1, 0.97);
      if (this.rng() >= chance) {
        log.push(`${m.icon} ${i === 3 ? 'the boss' : 'a room'} beat the party`);
        break;
      }
      cleared++;
      log.push(`${m.icon}✅`);
    }
    const bossDown = cleared === 4;
    const got = [];
    this.repo.transaction(() => {
      for (const f of fighters) {
        let xp = 0;
        const loot = [];
        for (const m of rooms.slice(0, cleared)) {
          xp += Math.round(m.xp * 1.5);
          loot.push(m.loot[Math.floor(this.rng() * m.loot.length)]);
        }
        if (bossDown) {
          const r = this.rng();
          loot.push(r < 0.2 ? 'shadow_gem' : r < 0.55 ? 'dungeon_relic' : 'rune_shard');
        }
        const bag = this.backpack(f.u.id);
        let room = bag.capacity - bag.used;
        for (const item of loot) {
          if (room <= 0) break;
          this.repo.addItem(f.u.id, item, 1);
          room--;
        }
        if (xp) this.grantXp(f.u, f.pick.weapon ? f.pick.skillId : COMBAT_SKILLS[0], this.xpFor(xp));
        // Failing costs some HP.
        if (!bossDown) {
          const vit = this.vitals(f.u.id);
          this.repo.setVitals(f.u.id, { hp: Math.max(1, vit.hp - vit.maxHp * 0.2), mana: vit.mana, koUntil: 0 }, this.now());
        }
        got.push({ f, xp, loot });
      }
      if (bossDown) {
        const pts = 300 * fighters.length;
        for (const f of fighters) this.repo.addPoints(f.u.id, pts);
        this.track('rewards', pts * fighters.length);
        // A rare cape for one lucky member.
        if (this.rng() < 0.05) {
          const lucky = fighters[Math.floor(this.rng() * fighters.length)];
          this.repo.addItem(lucky.u.id, 'delver_cape', 1);
          got.find((g) => g.f === lucky).loot.push('delver_cape');
        }
      }
    });
    for (const g of got) {
      this.emitActivity(g.f.u, {
        kind: bossDown ? 'raid' : 'dungeon',
        text: bossDown ? `cleared a dungeon and beat the ${boss.icon} ${boss.name}! 🏰` : `cleared ${cleared}/4 dungeon rooms`,
      });
    }
    const names = fighters.map((f) => `@${f.u.username}`).join(' ');
    const text = bossDown
      ? `🏰 DUNGEON CLEARED! ${names} beat all 3 rooms and the ${boss.icon} ${boss.name} boss! Everyone gets XP, loot, a dungeon treasure and ${fmt(300 * fighters.length)} pts. ${log.join(' ')}`
      : `🏰 The dungeon run ended after ${cleared}/4 rooms (${log.join(' ')}). ${names} escape with ${cleared ? 'some XP and loot' : 'nothing but bruises'}. Try again with a stronger party!`;
    this.announce(text);
    return { cleared, bossDown, got };
  },

  // ---- Limited shop item ----------------------------------------------------------------------------
  weekIndex(now = this.now()) {
    return Math.floor((now - MONDAY) / WEEK);
  },

  limitedItem(now = this.now()) {
    const n = LIMITED_SHOP.length;
    const row = LIMITED_SHOP[((this.weekIndex(now) % n) + n) % n];
    const live = (this.settings?.all?.shop || []).find((x) => x.item === row.item);
    return { ...row, ...(live || {}), ...ITEMS[row.item], item: row.item, endsAt: MONDAY + (this.weekIndex(now) + 1) * WEEK };
  },

  // Housekeeping from tick(): season end, dungeon start, expired bounties.
  socialTick() {
    const now = this.now();
    const s = this.season();
    if (!this.repo.getSetting('season_auto_since')) this.repo.setSetting('season_auto_since', now);
    if (!s.startedAt) this.repo.setSetting('season', { ...s, startedAt: now });
    else {
      const ends = this.seasonEndsAt(s);
      if (ends && now >= ends) this.endSeason();
    }
    if (this.dungeon && now >= this.dungeon.startsAt) this.runDungeon();
    this.bounties();
  },
};

