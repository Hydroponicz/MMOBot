// GameEngine methods: things that happen to the whole channel. Kick follows/subs/gifts and live
// status, channel-wide boosts, random chat events (treasure goblin, supply drop), world boss raids
// and duels. Anything the bot should post by itself goes out through this.announce().
/* eslint-disable no-unused-vars */
const {
  ITEMS,
  SKILLS,
  COMBAT_SKILLS,
  maxHpFor,
  fmt,
  clamp,
  minutesLeft,
  itemLabel,
  casino,
} = require('./shared');

const RANDOM_EVENTS = {
  goblin: {
    id: 'goblin',
    start: (p) => `👺 A TREASURE GOBLIN appeared! First to type ${p}catch gets its loot!`,
    escaped: '👺 The treasure goblin got away...',
    winners: 1,
  },
  supply: {
    id: 'supply',
    start: (p) => `📦 A SUPPLY DROP landed! The first 3 to type ${p}grab get a share!`,
    escaped: '📦 Nobody grabbed the supply drop in time.',
    winners: 3,
  },
};
const GOBLIN_LOOT = ['rusty_coin', 'fossil', 'crystal_skull', 'golden_egg', 'ancient_coin'];
const SUPPLY_LOOT = ['minor_health_potion', 'health_potion', 'cooked_salmon', 'cooked_trout', 'bone_brew', 'minor_mana_potion'];
const EVENT_SECONDS = 60;

module.exports = {
  announce(text) {
    if (text) this.emit('announce', text);
  },

  // Remember who's chatting, for raid sizing and "is chat active?".
  noteChatter(user, now = this.now()) {
    this.recentChatters ??= new Map();
    this.recentChatters.set(user.id, now);
    if (this.recentChatters.size > 2000) this.recentChatters.delete(this.recentChatters.keys().next().value);
  },

  activeChatters(minutes = 10, now = this.now()) {
    return [...(this.recentChatters || new Map()).entries()].filter(([, at]) => now - at < minutes * 60_000).map(([id]) => id);
  },

  // ---- Kick channel events -------------------------------------------------------
  // Returns what the bot should say (or null). Types match Kick's webhook event names.
  channelEvent(type, payload = {}) {
    const now = this.now();
    const c = this.cfg;
    const p = c.prefix;
    const who = (x) =>
      x && !x.is_anonymous && x.user_id && x.username
        ? this.repo.upsertUser({ kickUserId: String(x.user_id), username: x.username, avatarUrl: x.profile_picture || null })
        : null;
    const reward = (user, points) => {
      if (!user || !points) return;
      this.repo.addPoints(user.id, points);
      this.track('rewards', points);
    };

    if (type === 'channel.followed') {
      const user = who(payload.follower);
      if (!user) return null;
      // Once per viewer, so unfollowing and following again earns nothing.
      const key = `followed:${user.id}`;
      if (this.repo.getSetting(key)) return null;
      this.repo.setSetting(key, now);
      reward(user, c.followPoints);
      this.emitActivity(user, { kind: 'follow', text: `followed the channel${c.followPoints ? ` (+${fmt(c.followPoints)} pts)` : ''}` });
      return `💚 Thanks for the follow, @${user.username}!${c.followPoints ? ` +${fmt(c.followPoints)} pts to start your adventure.` : ''} Type ${p}commands to play.`;
    }

    if (type === 'channel.subscription.new' || type === 'channel.subscription.renewal') {
      const user = who(payload.subscriber);
      if (!user) return null;
      this.repo.setUserField(user.id, 'subscriber', 1);
      reward(user, c.subPoints);
      const verb = type.endsWith('renewal') ? 'resubscribed' : 'subscribed';
      this.emitActivity(user, { kind: 'sub', text: `${verb}! ⭐${c.subPoints ? ` (+${fmt(c.subPoints)} pts)` : ''}` });
      return `⭐ @${user.username} ${verb}! ${c.subPoints ? `+${fmt(c.subPoints)} pts. ` : ''}Subscribers earn ${c.subChatMultiplier ?? 2}x chat points.`;
    }

    if (type === 'channel.subscription.gifts') {
      const giftees = (payload.giftees || []).map(who).filter(Boolean);
      const count = Math.max(1, (payload.giftees || []).length);
      const gifter = who(payload.gifter);
      reward(gifter, (c.giftPointsPerSub || 0) * count);
      for (const g of giftees) {
        this.repo.setUserField(g.id, 'subscriber', 1);
        reward(g, c.subPoints);
      }
      const name = gifter ? `@${gifter.username}` : 'An anonymous gifter';
      let boost = '';
      const minutes = Math.min(60, count * (c.giftBoostMinutesPerSub || 0));
      if (minutes > 0 && (c.giftBoostMultiplier || 1) > 1) {
        const b = this.startBoost({ kind: 'xp', multiplier: c.giftBoostMultiplier, minutes, reason: `${gifter ? gifter.username : 'a gifter'} gifted ${count} sub${count > 1 ? 's' : ''}`, extend: true });
        boost = ` ${b.multiplier === 2 ? 'DOUBLE' : `${b.multiplier}x`} XP for everyone for ${minutesLeft(b.until - now)}! 🎉`;
      }
      if (gifter) this.emitActivity(gifter, { kind: 'gift', text: `gifted ${count} sub${count > 1 ? 's' : ''}! 🎁` });
      return `🎁 ${name} gifted ${count} sub${count > 1 ? 's' : ''}!${gifter && c.giftPointsPerSub ? ` +${fmt(c.giftPointsPerSub * count)} pts to them` : ''}${giftees.length && c.subPoints ? `, +${fmt(c.subPoints)} each to the lucky ones` : ''}.${boost}`;
    }

    if (type === 'livestream.status.updated') {
      const live = Boolean(payload.is_live);
      this.repo.setSetting('stream', { live, since: now, title: payload.title || '' });
      if (live) this.schedule = null; // start the event timers fresh
      return null;
    }
    return null;
  },

  // Is the stream live (or unknown)? Random events and raids can wait for the stream.
  eventsAllowed() {
    if (!this.cfg.eventsOnlyWhenLive) return true;
    const stream = this.repo.getSetting('stream');
    return !stream || stream.live;
  },

  // ---- Channel-wide boosts ---------------------------------------------------------
  // kind 'xp' or 'points'. extend: add to a boost that's already running (capped at an hour ahead).
  startBoost({ kind = 'xp', multiplier = 2, minutes = 10, reason = '', extend = false }) {
    const now = this.now();
    const cur = this.repo.getSetting('global_boost');
    const running = cur && cur.until > now && cur.kind === kind;
    const from = extend && running ? cur.until : now;
    const until = Math.min(now + 60 * 60_000, from + minutes * 60_000);
    const boost = { kind, multiplier: running && extend ? Math.max(cur.multiplier, multiplier) : multiplier, until, reason };
    this.repo.setSetting('global_boost', boost);
    this.emit('boost', boost);
    return boost;
  },

  stopBoost() {
    this.repo.deleteSetting('global_boost');
    this.emit('boost', null);
  },

  activeBoost() {
    const b = this.repo.getSetting('global_boost');
    return b && b.until > this.now() ? b : null;
  },

  // !boost
  boostInfo() {
    const b = this.activeBoost();
    if (!b) return 'no channel boost right now. Gifted subs start one!';
    return `⚡ ${b.multiplier}x ${b.kind === 'xp' ? 'XP' : 'chat points'} for everyone for another ${minutesLeft(b.until - this.now())}${b.reason ? ` (${b.reason})` : ''}!`;
  },

  // ---- Random chat events -----------------------------------------------------------
  spawnRandomEvent(kind = null) {
    const now = this.now();
    if (this.repo.getSetting('random_event')) return null;
    const ids = Object.keys(RANDOM_EVENTS);
    const def = RANDOM_EVENTS[kind] || RANDOM_EVENTS[ids[Math.floor(this.rng() * ids.length)]];
    const ev = { kind: def.id, startedAt: now, endsAt: now + EVENT_SECONDS * 1000, claimed: [] };
    this.repo.setSetting('random_event', ev);
    const text = def.start(this.cfg.prefix);
    this.emit('activity', { id: 0, kind: 'event', username: '', text, created_at: now });
    this.announce(text);
    return ev;
  },

  // !catch / !grab
  eventCatch(user) {
    const now = this.now();
    const ev = this.repo.getSetting('random_event');
    if (!ev || now > ev.endsAt) return null; // nothing to catch: stay quiet
    const def = RANDOM_EVENTS[ev.kind];
    if (ev.claimed.includes(user.id)) return null;
    ev.claimed.push(user.id);
    const done = ev.claimed.length >= def.winners;
    if (done) this.repo.deleteSetting('random_event');
    else this.repo.setSetting('random_event', ev);
    const pick = (list) => list.filter((i) => ITEMS[i])[Math.floor(this.rng() * list.length) % list.filter((i) => ITEMS[i]).length];
    let points;
    let item;
    if (def.id === 'goblin') {
      points = 200 + Math.round(this.rng() * 80) * 10;
      item = pick(GOBLIN_LOOT);
    } else {
      points = 100;
      item = pick(SUPPLY_LOOT);
    }
    this.repo.transaction(() => {
      this.repo.addPoints(user.id, points);
      if (item) this.repo.addItem(user.id, item, 1);
    });
    this.track('rewards', points);
    this.emitActivity(user, { kind: 'rare', item, text: def.id === 'goblin' ? `caught the treasure goblin! +${fmt(points)} pts` : 'grabbed a share of the supply drop' });
    return def.id === 'goblin'
      ? `👺 you caught the treasure goblin! +${fmt(points)} pts and ${itemLabel(item)}! 💰`
      : `📦 you grabbed ${itemLabel(item)} and ${fmt(points)} pts from the supply drop!${done ? ' (all gone!)' : ''}`;
  },

  // ---- World boss raids ------------------------------------------------------------------
  // The whole chat hits one boss with !attack. Its HP scales with how many people are chatting.
  // Beat it in time and the reward pool is split by damage dealt; the top hitter is MVP.
  raidState() {
    return this.repo.getSetting('raid');
  },

  publicRaid(raid = this.raidState()) {
    if (!raid) return { active: false };
    const top = Object.entries(raid.damageBy)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, dmg]) => ({ username: raid.names[id], damage: dmg }));
    const { damageBy, names, ...rest } = raid;
    return { active: true, ...rest, fighters: Object.keys(damageBy).length, top };
  },

  startRaid({ monsterId = null, hpMultiplier = null } = {}) {
    const now = this.now();
    if (this.raidState()) return { ok: false, error: 'a raid is already running.' };
    const monsters = SKILLS[COMBAT_SKILLS[0]].monsters;
    let monster = monsterId ? monsters.find((m) => m.id === monsterId) : null;
    if (monsterId && !monster) return { ok: false, error: 'unknown monster.' };
    const chatters = this.activeChatters(30, now);
    if (!monster) {
      // Aim a bit above the typical chatter's combat level: a real challenge for the group.
      const levels = chatters.map((id) => this.combatLevel(id)).sort((a, b) => a - b);
      const median = levels.length ? levels[Math.floor(levels.length / 2)] : 1;
      const target = Math.max(1, median * 1.5);
      monster = [...monsters].reverse().find((m) => m.level <= target) || monsters[0];
    }
    // Each viewer gets a few hits per stamina bar, so HP scales with the crowd.
    const mult = hpMultiplier || 2 * Math.max(3, chatters.length);
    const hp = Math.round(monster.hp * mult);
    const raid = {
      monster: monster.id,
      name: monster.name,
      icon: monster.icon,
      level: monster.level,
      hp,
      maxHp: hp,
      startedAt: now,
      endsAt: now + this.cfg.raidMinutes * 60_000,
      damageBy: {},
      names: {},
    };
    this.repo.setSetting('raid', raid);
    const p = this.cfg.prefix;
    const text = `⚔️ RAID! A giant ${monster.icon} ${monster.name} (level ${monster.level}, ${fmt(hp)} HP) attacks the channel! Everyone type ${p}attack, you have ${this.cfg.raidMinutes} minutes!`;
    this.emit('raid', this.publicRaid(raid));
    this.emit('activity', { id: 0, kind: 'raid', username: '', text: `A giant ${monster.name} attacks! Type ${p}attack`, created_at: now });
    this.announce(text);
    return { ok: true, raid: this.publicRaid(raid) };
  },

  // !raid / !boss
  raidInfo() {
    const r = this.raidState();
    if (!r) return `no raid right now.${this.cfg.raidEveryMinutes ? ' Keep chatting, a boss will show up!' : ''}`;
    const fighters = Object.keys(r.damageBy).length;
    return `⚔️ Raid: ${r.icon} ${r.name} ${fmt(r.hp)}/${fmt(r.maxHp)} HP · ${fighters} fighting · ${minutesLeft(r.endsAt - this.now())} left. ${this.cfg.prefix}attack!`;
  },

  // !attack
  raidAttack(user) {
    const now = this.now();
    const raid = this.raidState();
    if (!raid) return this.raidInfo();
    if (now > raid.endsAt) return this.finishRaid(false) && null;
    const vit = this.vitals(user.id, now);
    if (vit.ko) return this.knockedOutMessage(user.id, vit, now);
    const tired = this.staminaCheck(user, now);
    if (tired !== null) return tired || null;
    const pick = this.chooseWeapon(user.id);
    if (!pick.weapon) return ['ammo', 'mana'].includes(pick.reason) ? this.noArrowsMessage(user, pick) : `you need a weapon to join the raid! ${this.howToGetSword(user)}`;
    this.spendStamina(user, now);
    const monster = SKILLS[COMBAT_SKILLS[0]].monsters.find((m) => m.id === raid.monster);
    const stats = this.fightStats(user.id, pick);
    if (pick.arrow) this.repo.removeItem(user.id, pick.arrow, 1);
    if (SKILLS[pick.skillId].manaCost) vit.mana = Math.max(0, vit.mana - SKILLS[pick.skillId].manaCost);
    // Three swings at the boss, then it swings back once.
    const offence = pick.level + stats.attack;
    let dealt = 0;
    for (let i = 0; i < 3; i++) dealt += Math.max(1, Math.round(offence * (0.5 + 0.5 * this.rng())));
    dealt = Math.min(dealt, raid.hp);
    const armor = clamp((monster.damage + 1) / (stats.defence + 1), 0.35, 2);
    const outlevel = clamp(monster.level / Math.max(1, pick.level), 0.5, 10);
    const taken = monster.attack * armor * outlevel * (0.5 + 0.5 * this.rng());
    let hp = Math.max(0, vit.hp - taken);
    let koText = '';
    if (hp <= 0) {
      if (this.hasBuff(user.id, 'deathless')) {
        this.removeBuff(user.id, 'deathless');
        hp = 1;
        koText = ` 💀 Your Lich's Elixir kept you standing on 1 HP!`;
        this.repo.setVitals(user.id, { hp, mana: vit.mana, koUntil: 0 }, now);
      } else {
        this.repo.setVitals(user.id, { hp: 0, mana: vit.mana, koUntil: now + this.cfg.hpRegenHours * 3_600_000 }, now);
        koText = ` 💀 The ${raid.name} knocked you out! !drink a health potion to get back in.`;
      }
    } else this.repo.setVitals(user.id, { hp, mana: vit.mana, koUntil: 0 }, now);

    const next = { ...raid, hp: raid.hp - dealt };
    next.damageBy = { ...raid.damageBy, [user.id]: (raid.damageBy[user.id] || 0) + dealt };
    next.names = { ...raid.names, [user.id]: user.username };
    this.repo.setSetting('raid', next);
    const gained = this.grantXp(user, pick.skillId, this.xpFor(Math.max(1, monster.xp * 0.3)));
    this.emit('raid', this.publicRaid(next));
    const hpText = koText || ` | ❤️ ${fmt(Math.floor(hp))}/${fmt(vit.maxHp)} HP`;
    if (next.hp <= 0) {
      const end = this.finishRaid(true, user);
      return `${ITEMS[pick.weapon].icon} you hit the ${raid.name} for ${fmt(dealt)} and landed the FINAL BLOW! ${gained.text}${hpText} ${end}`;
    }
    return `${ITEMS[pick.weapon].icon} you hit the ${raid.icon} ${raid.name} for ${fmt(dealt)}! (${fmt(next.hp)}/${fmt(next.maxHp)} HP left) ${gained.text}${hpText}`;
  },

  // Ends the raid. Won: split the reward pool by damage, MVP gets extra loot. Returns the summary.
  finishRaid(won, finisher = null) {
    const now = this.now();
    const raid = this.raidState();
    if (!raid) return '';
    this.repo.deleteSetting('raid');
    const entries = Object.entries(raid.damageBy).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, d]) => s + d, 0);
    let text;
    if (won && total) {
      const monster = SKILLS[COMBAT_SKILLS[0]].monsters.find((m) => m.id === raid.monster);
      const pool = this.cfg.raidRewardPoints || 0;
      this.repo.transaction(() => {
        for (const [id, dmg] of entries) {
          const points = Math.floor((pool * dmg) / total) + 25;
          this.repo.addPoints(Number(id), points);
          this.track('rewards', points);
          this.repo.addItem(Number(id), monster.loot[0], 1);
        }
        const mvpId = Number(entries[0][0]);
        this.repo.addItem(mvpId, monster.rare?.item || monster.loot[1], 1);
      });
      const [mvpId, mvpDmg] = entries[0];
      const mvp = raid.names[mvpId];
      this.raidMvps = [...(this.raidMvps || []), Number(mvpId)];
      text = `🏆 The giant ${raid.name} is DEFEATED! ${entries.length} hero${entries.length > 1 ? 'es' : ''} split ${fmt(pool)} pts by damage, plus ${ITEMS[monster.loot[0]].name} each. MVP: @${mvp} (${Math.round((mvpDmg / total) * 100)}% of the damage) 👑 wins ${itemLabel(monster.rare?.item || monster.loot[1])}!`;
      const mvpUser = this.repo.getUser(Number(mvpId));
      this.emitActivity(mvpUser, { kind: 'raid', text: `was MVP against the giant ${raid.name}! 👑` });
      this.onRaidWon?.(entries.map(([id]) => Number(id)), Number(mvpId));
    } else {
      text = `💨 The giant ${raid.name} escaped${total ? ` with ${fmt(raid.hp)} HP left` : ''}! Better luck next time.`;
      this.emit('activity', { id: 0, kind: 'raid', username: '', text: `The giant ${raid.name} escaped!`, created_at: now });
    }
    this.emit('raid', { active: false, result: won ? 'won' : 'escaped', name: raid.name, icon: raid.icon });
    if (!finisher) this.announce(text);
    return text;
  },

  // ---- Duels ----------------------------------------------------------------------------
  // !duel @name [bet]: the other player has a minute to !accept. Duels use a copy of each
  // player's HP (they don't hurt or knock anyone out); the winner takes the bet.
  duel(user, args) {
    if (this.cfg.duelsEnabled === false) return 'duels are switched off right now.';
    const p = this.cfg.prefix;
    if (!args.length) return `usage: ${p}duel @name [bet], e.g. ${p}duel @Alice 500`;
    const target = this.repo.getUserByName(String(args[0]).replace(/^@/, ''));
    if (!target || target.banned) return `no adventurer named ${String(args[0]).replace(/^@/, '')}.`;
    if (target.id === user.id) return "you can't duel yourself!";
    const balance = this.repo.getUser(user.id).points;
    const bet = args[1] ? casino.parseBet(args[1], balance) : 0;
    if (bet === null) return 'how much? e.g. 500, 1k, half or all.';
    if (bet > balance) return `you only have ${fmt(balance)} pts.`;
    this.duels ??= new Map();
    this.duels.set(target.id, { from: user.id, fromName: user.username, bet, at: this.now() });
    return `⚔️ @${target.username}, @${user.username} challenges you to a duel${bet ? ` for ${fmt(bet)} pts` : ''}! Type ${p}accept within 60s (or ${p}decline).`;
  },

  duelDecline(user) {
    const ch = this.duels?.get(user.id);
    if (!ch) return null;
    this.duels.delete(user.id);
    return `declined the duel with @${ch.fromName}.`;
  },

  duelAccept(user) {
    const now = this.now();
    const ch = this.duels?.get(user.id);
    if (!ch || now - ch.at > 60_000) return `no duel waiting for you. Challenge someone: ${this.cfg.prefix}duel @name [bet]`;
    this.duels.delete(user.id);
    const a = this.repo.getUser(ch.from);
    const b = this.repo.getUser(user.id);
    if (ch.bet && (a.points < ch.bet || b.points < ch.bet)) return `the duel is off: both of you need ${fmt(ch.bet)} pts.`;
    const fighter = (u) => {
      const pick = this.chooseWeapon(u.id);
      const level = pick.weapon ? pick.level : this.combatLevel(u.id);
      const stats = pick.weapon ? this.fightStats(u.id, pick) : { attack: 0, defence: this.combatStats(u.id).defence };
      const skill = pick.weapon ? SKILLS[pick.skillId].name : 'Fists';
      return { u, level, stats, hp: maxHpFor(this.combatLevel(u.id)), label: `${skill} ${level}${pick.weapon ? `, ${ITEMS[pick.weapon].name}` : ''}` };
    };
    const fa = fighter(a);
    const fb = fighter(b);
    const hit = (att, def) =>
      Math.max(1, Math.round((att.level + att.stats.attack) * (0.5 + 0.5 * this.rng()) * (1 - def.stats.defence / (def.stats.defence + 100))));
    let [x, y] = this.rng() < 0.5 ? [fa, fb] : [fb, fa];
    let rounds = 0;
    while (fa.hp > 0 && fb.hp > 0 && rounds < 500) {
      y.hp -= hit(x, y);
      [x, y] = [y, x];
      rounds++;
    }
    if (fa.hp > 0 && fb.hp > 0) return `⚔️ @${a.username} and @${b.username} fought for ${rounds} rounds and neither fell. It's a draw!`;
    const [win, lose] = fa.hp > 0 ? [fa, fb] : [fb, fa];
    if (ch.bet) {
      this.repo.transaction(() => {
        this.repo.addPoints(lose.u.id, -ch.bet);
        this.repo.addPoints(win.u.id, ch.bet);
      });
      this.track('traded', ch.bet);
    }
    this.emitActivity(win.u, { kind: 'duel', text: `beat ${lose.u.username} in a duel${ch.bet ? ` and won ${fmt(ch.bet)} pts` : ''}! ⚔️` });
    this.onDuelWon?.(win.u);
    return `⚔️ @${a.username} (${fa.label}) vs @${b.username} (${fb.label}): after ${rounds} rounds @${win.u.username} WINS with ${fmt(Math.max(0, win.hp))} HP left${ch.bet ? ` and takes ${fmt(ch.bet)} pts` : ''}! 🏆`;
  },

  // ---- Scheduler (called every few seconds by the server) --------------------------------
  tick() {
    const now = this.now();
    const c = this.cfg;
    const ev = this.repo.getSetting('random_event');
    if (ev && now > ev.endsAt) {
      this.repo.deleteSetting('random_event');
      if (!ev.claimed.length) this.announce(RANDOM_EVENTS[ev.kind].escaped);
    }
    const raid = this.raidState();
    if (raid && now > raid.endsAt) this.finishRaid(false);

    const jitter = () => 0.75 + this.rng() * 0.5;
    this.schedule ??= {
      random: now + (c.randomEventMinutes || 0) * 60_000 * jitter(),
      raid: now + (c.raidEveryMinutes || 0) * 60_000,
    };
    // Only while people are chatting (and the stream is live, if that's set).
    if (!this.eventsAllowed() || !this.activeChatters(10, now).length) return;
    if (c.randomEventMinutes > 0 && now >= this.schedule.random && !ev && !raid) {
      this.spawnRandomEvent();
      this.schedule.random = now + c.randomEventMinutes * 60_000 * jitter();
    }
    if (c.raidEveryMinutes > 0 && now >= this.schedule.raid && !raid) {
      this.startRaid();
      this.schedule.raid = now + c.raidEveryMinutes * 60_000;
    }
  },
};
