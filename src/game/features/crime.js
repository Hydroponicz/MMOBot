// GameEngine methods: the crime update, built around heists (pvp.js). Mixed into GameEngine.prototype
// by engine.js.
//   - Wanted posters (!wanted @name 5000): points on a criminal's head for whoever beats them.
//   - Pickpocketing (!pickpocket @name) and crop poaching (!poach @name): steal items, not points.
//   - Shop burglary (!burgle @name): take goods off a player's shop shelf. Bigger shops, better locks.
//   - Jail: !bail out, or !jailbreak @friend.
//   - Snitching (!tipoff @name): a tipped-off criminal is caught on their next crime.
//   - Protection rackets (!racket): guilds sell protection; robbing a client means beating the
//     guild's enforcer first.
// Every crime shares the heist rules: one stamina charge, jail when caught, fines (half to the victim,
// half removed), victim protection, guards, Agility for stealth.
const { ITEMS, fmt, minutesLeft, itemLabel } = require('./shared');
const { CROPS } = require('./shared');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// Items a pickpocket can take: ordinary loot, not gear, tools, pets, cosmetics or quest items.
const pocketable = (id) => {
  const it = ITEMS[id];
  return it && !it.keep && !it.pet && !it.bound && !it.cosmetic && !it.seedFor && !it.ammo;
};

module.exports = {
  crimeCfg() {
    const c = this.cfg;
    return {
      wanted: c.wantedEnabled !== false,
      pickpocket: c.pickpocketEnabled !== false,
      poach: c.poachEnabled !== false,
      burglary: c.burglaryEnabled !== false,
      jailbreak: c.jailbreakEnabled !== false,
      tipoffs: c.tipoffsEnabled !== false,
      rackets: c.racketsEnabled !== false,
      minLevel: c.crimeMinTargetLevel ?? 10,
      wantedMin: c.wantedMin ?? 500,
      bailPct: c.bailPct ?? 0.02,
      racketMax: c.racketMaxPrice ?? 5000,
      dailyCrimes: c.crimeDailyLimit ?? 15,
    };
  },

  // ---- Shared ---------------------------------------------------------------------------------
  // The fine for getting caught: a share of what you hold (min 100, capped).
  crimeFine(userId) {
    const hc = this.heistCfg();
    const pts = this.repo.getUser(userId).points;
    return Math.min(hc.maxFine, Math.max(100, Math.floor(pts * hc.finePct)), pts);
  },

  // Caught: pay the fine (half to `toId` if given, the rest removed) and go to jail.
  // Returns the fine. Call inside a transaction; saves `mine`.
  crimeCaught(user, mine, now, { toId = null, toGuild = null, jailMinutes = null, share = 0.5 } = {}) {
    const hc = this.heistCfg();
    const fine = this.crimeFine(user.id);
    const paid = Math.floor(fine * share);
    this.repo.addPoints(user.id, -fine);
    if (toId) this.repo.addPoints(toId, paid);
    if (toGuild) this.repo.guildSet(toGuild.id, 'bank', (this.repo.guildGet(toGuild.id)?.bank || 0) + paid);
    this.track('pvp', fine - (toId || toGuild ? paid : 0));
    mine.jailUntil = now + (jailMinutes ?? hc.jailMinutes) * MIN;
    this.saveHeistInfo(user.id, mine);
    return { fine, paid };
  },

  // Common checks for !pickpocket / !poach / !burgle. Returns { error } or what the crime needs.
  crimeStart(user, args, kind) {
    const hc = this.heistCfg();
    const cc = this.crimeCfg();
    const p = this.cfg.prefix;
    if (!hc.on || !cc[kind]) return { error: `that's switched off right now.` };
    const verb = { pickpocket: 'pickpocket', poach: 'poach from', burglary: 'burgle' }[kind];
    if (!args.length) return { error: `usage: ${p}${kind === 'burglary' ? 'burgle' : kind} @name` };
    const blocked = this.marketBlocked(user.id);
    if (blocked) return { error: blocked.replace("can't buy, sell or trade with other players", `can't ${verb} other players`) };
    const name = String(args[0]).replace(/^@/, '');
    const target = this.repo.getUserByName(name.toLowerCase());
    if (!target || target.banned) return { error: `no adventurer named ${name}.` };
    if (target.id === user.id) return { error: "that's you!" };
    const now = this.now();
    const mine = this.heistInfo(user.id);
    if (mine.jailUntil > now) return { error: `🚔 you're in jail for ${minutesLeft(mine.jailUntil - now)}. ${p}bail to pay your way out, or ask a friend to ${p}jailbreak you.` };
    // New players are off limits for item crimes.
    if (this.characterLevel(target.id) < cc.minLevel) return { error: `@${target.username} is still new here (character level under ${cc.minLevel}). Pick on someone your own size.` };
    const today = new Date(now).toISOString().slice(0, 10);
    if (mine.crimeDay !== today) Object.assign(mine, { crimeDay: today, crimes: 0 });
    if (cc.dailyCrimes && mine.crimes >= cc.dailyCrimes) return { error: `🦹 you've pulled ${mine.crimes} jobs today. Lie low until tomorrow.` };
    const key = `${kind}:${target.id}`;
    const last = mine.last?.[key] || 0;
    if (last && now - last < 3 * HOUR) return { error: `you hit @${target.username} not long ago. Try again in ${minutesLeft(last + 3 * HOUR - now)}.` };
    const vit = this.vitals(user.id, now);
    if (vit.ko) return { error: `you're knocked out. ${this.knockedOutMessage(user.id, vit, now)}` };
    return { target, now, mine, theirs: this.heistInfo(target.id), key };
  },

  // Stamina, then the snitch/racket gate, then the stamina charge is used and the attempt booked.
  // Returns { stop: reply } when the crime ends here, or { note } to carry on.
  crimeBegin(user, st) {
    const tired = this.staminaCheck(user, st.now);
    if (tired !== null) return { stop: tired || 'Slow down a little!' };
    const gate = this.crimeGate(user, st.target, st.mine, st.now);
    if (gate.free) return { stop: gate.reply };
    this.crimeCommit(user, st);
    if (gate.reply) {
      this.saveHeistInfo(user.id, st.mine);
      return { stop: gate.reply };
    }
    return { note: gate.note };
  },

  // Uses the stamina charge and books the attempt.
  crimeCommit(user, st) {
    this.spendStamina(user, st.now);
    this.repo.setActionAt(user.id, st.now);
    st.mine.crimes = (st.mine.crimes || 0) + 1;
    st.mine.lastCrimeAt = st.now;
    st.mine.last = Object.fromEntries(Object.entries({ ...(st.mine.last || {}), [st.key]: st.now }).filter(([, at]) => st.now - at < DAY));
  },

  // Before any crime lands: a tip-off gets you caught on the spot, and robbing a racket client means
  // beating the guild's enforcer first. Returns { reply } if the crime is over, or { note } to go on.
  crimeGate(user, target, mine, now) {
    const p = this.cfg.prefix;
    mine.lastCrimeAt = now;
    // Snitches.
    const tips = this.repo.getSetting('tipoffs') || {};
    const tip = tips[user.id];
    if (tip && tip.until > now && this.crimeCfg().tipoffs) {
      delete tips[user.id];
      this.repo.setSetting('tipoffs', tips);
      let reply;
      this.repo.transaction(() => {
        const { fine, paid } = this.crimeCaught(user, mine, now, { toId: tip.by, share: 0.25 });
        const bounty = this.claimWanted(this.repo.getUser(tip.by), user.id, 'turned in by a snitch');
        // Sometimes the name gets out.
        const named = this.rng() < 0.3;
        this.notify(tip.by, `🐀 Your tip-off paid: the guards were waiting for ${user.username}. You got ${fmt(paid)} pts of their fine${bounty ? ` and the ${fmt(bounty)} pts bounty on them` : ''}.`);
        this.emitActivity(user, { kind: 'heist', text: `walked straight into a trap: someone tipped off the guards 🐀🚔` });
        reply = `🚔 the guards were waiting for you: someone tipped them off! Fined ${fmt(fine)} pts and jailed for ${this.heistCfg().jailMinutes}m.${named ? ` Word on the street: it was @${tip.byName}. 🐀` : ' You never find out who talked.'} (${p}bail or a friend's ${p}jailbreak gets you out)`;
      });
      return { reply };
    }
    // Protection rackets.
    const client = this.racketClient(target.id, now);
    if (client && this.crimeCfg().rackets) {
      const g = this.repo.guildGet(client.guildId);
      const myGuild = this.repo.guildOf(user.id);
      if (g && myGuild?.id === g.id) return { reply: `@${target.username} pays [${g.tag}] for protection: your own guild. Leave them be.`, free: true };
      const champ = g ? this.racketEnforcer(g.id, [user.id, target.id]) : null;
      if (champ) {
        const fight = this.pvpCombat(this.pvpCombatant(user.id, { realHp: true }), this.pvpCombatant(champ.id), { firstStrike: 'b', maxRounds: 60 });
        const vit = this.vitals(user.id, now);
        this.repo.setVitals(user.id, { hp: Math.max(1, fight.a.hp), mana: vit.mana, koUntil: 0 }, now);
        if (fight.winner?.id !== user.id) {
          let reply;
          this.repo.transaction(() => {
            const { fine } = this.crimeCaught(user, mine, now, { toGuild: g });
            if (fight.winner) this.claimWanted(this.repo.getUser(champ.id), user.id, `stopped by [${g.tag}]'s enforcer`);
            this.notify(champ.id, `🛡️ You stopped ${user.username} from hitting @${target.username}, who pays [${g.tag}] for protection. Half their fine went to the guild bank.`);
            this.notify(target.id, `🛡️ ${user.username} came for you, but [${g.tag}]'s enforcer ${champ.username} ran them off.`);
            this.emitActivity(user, { kind: 'heist', text: `got run off by [${g.tag}]'s enforcer ${champ.username} 🛡️` });
            reply = `🛡️ @${target.username} is under [${g.tag}]'s protection, and their enforcer @${champ.username} ${fight.winner ? `beat you (${fight.rounds} rounds)` : 'held you off'}. Fined ${fmt(fine)} pts (half to the guild) and jailed for ${this.heistCfg().jailMinutes}m.`;
          });
          return { reply };
        }
        this.notify(champ.id, `⚔️ ${user.username} beat you and got past [${g.tag}]'s protection of @${target.username}.`);
        return { note: ` You fought past [${g.tag}]'s enforcer @${champ.username} first!` };
      }
    }
    return { note: '' };
  },

  // A stealth roll like a heist's: your Agility against theirs, minus 12% per guard and any locks.
  crimeChance(userId, targetId, base, minus = 0) {
    const hc = this.heistCfg();
    const diff = this.agilityLevel(userId) - this.agilityLevel(targetId);
    return clamp(base + diff * hc.stealthPerLevel - this.guardLevel(targetId) * 0.12 - minus, 0.05, 0.9);
  },

  // Caught in the act (pickpocketing, poaching, burgling): no fight, the victim's people grab you.
  crimeFail(user, st, what) {
    const p = this.cfg.prefix;
    let reply;
    this.repo.transaction(() => {
      const { fine, paid } = this.crimeCaught(user, st.mine, st.now, { toId: st.target.id, jailMinutes: Math.ceil(this.heistCfg().jailMinutes / 2) });
      const bounty = this.claimWanted(st.target, user.id, `caught ${what}`);
      this.logHeist({ at: st.now, robber: user.username, victim: st.target.username, ok: false, how: what, amount: fine });
      this.notify(st.target.id, `🚨 You caught ${user.username} ${what}! You got ${fmt(paid)} pts of their fine${bounty ? ` and the ${fmt(bounty)} pts bounty on their head` : ''}.`);
      this.emitActivity(user, { kind: 'heist', text: `got caught ${what} ${st.target.username} 🚔` });
      reply = `🚨 @${st.target.username} caught you ${what}! Fined ${fmt(fine)} pts (half to them) and jailed for ${Math.ceil(this.heistCfg().jailMinutes / 2)}m. (${p}bail to get out)`;
    });
    return reply;
  },

  // ---- Pickpocketing ----------------------------------------------------------------------------
  // !pickpocket @name: 1-3 of one random ordinary item from their backpack.
  pickpocket(user, args = []) {
    const st = this.crimeStart(user, args, 'pickpocket');
    if (st.error) return st.error;
    const inv = this.repo.getInventory(st.target.id);
    const loot = Object.keys(inv).filter((id) => inv[id] > 0 && pocketable(id));
    if (!loot.length) return `@${st.target.username}'s pockets are empty (nothing worth taking).`;
    if (st.theirs.pocketUntil > st.now) return `@${st.target.username} is clutching their pockets after the last time (${minutesLeft(st.theirs.pocketUntil - st.now)}).`;
    const bag = this.backpack(user.id);
    if (bag.used >= bag.capacity) return `🎒 your backpack is full: no room for anything you lift.`;
    const gate = this.crimeBegin(user, st);
    if (gate.stop) return gate.stop;
    if (this.rng() >= this.crimeChance(user.id, st.target.id, 0.55)) return this.crimeFail(user, st, 'pickpocketing');
    const id = loot[Math.floor(this.rng() * loot.length)];
    const qty = Math.min(inv[id], 1 + Math.floor(this.rng() * 3), bag.capacity - bag.used);
    this.repo.transaction(() => {
      this.repo.removeItem(st.target.id, id, qty);
      this.repo.addItem(user.id, id, qty);
      st.theirs.pocketUntil = st.now + 30 * MIN;
      this.saveHeistInfo(st.target.id, st.theirs);
      this.saveHeistInfo(user.id, st.mine);
      this.logHeist({ at: st.now, robber: user.username, victim: st.target.username, ok: true, how: 'pickpocket', amount: 0, item: `${qty}x ${ITEMS[id].name}` });
    });
    this.notify(st.target.id, `🧤 Someone's hand was in your pocket: ${user.username} lifted ${qty}x ${ITEMS[id].icon} ${ITEMS[id].name}!`);
    this.emitActivity(user, { kind: 'heist', text: `picked ${st.target.username}'s pocket: ${qty}x ${ITEMS[id].name} 🧤` });
    return `🧤 you lifted ${itemLabel(id, qty)} from @${st.target.username}'s pocket!${gate.note}`;
  },

  // ---- Crop poaching ----------------------------------------------------------------------------
  // !poach @name: up to 3 ready crops from their farm. A Scarecrow in their backpack makes it harder.
  poach(user, args = []) {
    const st = this.crimeStart(user, args, 'poach');
    if (st.error) return st.error;
    const plots = this.farmPlots(st.target.id).filter((x) => x.ready && CROPS.find((c) => c.item === x.crop));
    if (!plots.length) return `@${st.target.username} has nothing ready to harvest. Come back when their crops are ripe.`;
    if (st.theirs.farmUntil > st.now) return `@${st.target.username} is watching their fields after the last raid (${minutesLeft(st.theirs.farmUntil - st.now)}).`;
    const bag = this.backpack(user.id);
    if (bag.used >= bag.capacity) return `🎒 your backpack is full: no room for stolen crops.`;
    const gate = this.crimeBegin(user, st);
    if (gate.stop) return gate.stop;
    const scarecrow = (this.repo.getInventory(st.target.id).scarecrow || 0) > 0;
    if (this.rng() >= this.crimeChance(user.id, st.target.id, 0.6, scarecrow ? 0.2 : 0)) return this.crimeFail(user, st, scarecrow ? 'poaching (the scarecrow gave you away)' : 'poaching');
    let room = bag.capacity - bag.used;
    const took = {};
    this.repo.transaction(() => {
      for (const plot of plots.slice(0, 3)) {
        const crop = CROPS.find((c) => c.item === plot.crop);
        const qty = Math.min(room, crop.yield[0]);
        if (qty <= 0) break;
        this.repo.clearPlot(st.target.id, plot.plot);
        this.repo.addItem(user.id, plot.crop, qty);
        took[plot.crop] = (took[plot.crop] || 0) + qty;
        room -= qty;
      }
      st.theirs.farmUntil = st.now + HOUR;
      this.saveHeistInfo(st.target.id, st.theirs);
      this.saveHeistInfo(user.id, st.mine);
    });
    const list = Object.entries(took).map(([id, q]) => itemLabel(id, q)).join(', ');
    this.logHeist({ at: st.now, robber: user.username, victim: st.target.username, ok: true, how: 'poach', amount: 0, item: list });
    this.notify(st.target.id, `🌾 ${user.username} raided your farm and took ${list}! A 🎃 Scarecrow (${this.cfg.prefix}build scarecrow) scares poachers off.`);
    this.emitActivity(user, { kind: 'heist', text: `poached ${st.target.username}'s crops 🌾` });
    return `🌾 you crept into @${st.target.username}'s fields and made off with ${list}!${gate.note}`;
  },

  // ---- Shop burglary ----------------------------------------------------------------------------
  // !burgle @name: take goods from one of their shop listings. Each shop tier adds a lock (-10%).
  burgle(user, args = []) {
    const st = this.crimeStart(user, args, 'burglary');
    if (st.error) return st.error;
    const tier = this.stallTier?.(st.target.id) || 0;
    if (!tier) return `@${st.target.username} doesn't have a shop to break into.`;
    const listings = this.marketListings(st.target.id).filter((l) => ITEMS[l.item] && !ITEMS[l.item].pet);
    if (!listings.length) return `@${st.target.username}'s shelves are empty.`;
    if (st.theirs.shopUntil > st.now) return `@${st.target.username} changed the locks after the last break-in (${minutesLeft(st.theirs.shopUntil - st.now)}).`;
    const bag = this.backpack(user.id);
    if (bag.used >= bag.capacity) return `🎒 your backpack is full: no room for the goods.`;
    const gate = this.crimeBegin(user, st);
    if (gate.stop) return gate.stop;
    if (this.rng() >= this.crimeChance(user.id, st.target.id, 0.55, tier * 0.1)) return this.crimeFail(user, st, 'breaking into the shop of');
    const l = listings[Math.floor(this.rng() * listings.length)];
    const qty = Math.min(l.qty, 3, bag.capacity - bag.used);
    this.repo.transaction(() => {
      this.repo.marketDelete(l.id);
      if (l.qty > qty) this.repo.marketAdd(st.target.id, l.item, l.qty - qty, Math.max(1, Math.round((l.price * (l.qty - qty)) / l.qty)), st.now);
      this.repo.addItem(user.id, l.item, qty);
      st.theirs.shopUntil = st.now + 2 * HOUR;
      this.saveHeistInfo(st.target.id, st.theirs);
      this.saveHeistInfo(user.id, st.mine);
    });
    this.logHeist({ at: st.now, robber: user.username, victim: st.target.username, ok: true, how: 'burglary', amount: 0, item: `${qty}x ${ITEMS[l.item].name}` });
    this.notify(st.target.id, `🏚️ Your shop was broken into! ${user.username} took ${qty}x ${ITEMS[l.item].icon} ${ITEMS[l.item].name} off the shelf.`);
    this.emitActivity(user, { kind: 'heist', text: `burgled ${st.target.username}'s shop 🏚️` });
    return `🏚️ you picked the lock${tier > 1 ? 's' : ''} on @${st.target.username}'s shop and grabbed ${itemLabel(l.item, qty)} off the shelf!${gate.note}`;
  },

  // ---- Wanted posters (bounties on criminals) ---------------------------------------------------
  wantedBoard() {
    const now = this.now();
    const all = this.repo.getSetting('wanted') || {};
    let changed = false;
    // Posters older than a week come down; posters get 90% back.
    for (const [id, w] of Object.entries(all)) {
      if (now - w.updated < 7 * DAY) continue;
      for (const [pid, amt] of Object.entries(w.posters)) {
        this.repo.addPoints(Number(pid), Math.floor(amt * 0.9));
        this.notify(Number(pid), `⌛ Nobody collected your bounty on ${w.name}. ${fmt(Math.floor(amt * 0.9))} pts refunded.`);
      }
      delete all[id];
      changed = true;
    }
    if (changed) this.repo.setSetting('wanted', all);
    return all;
  },

  wantedList(limit = 10) {
    return Object.entries(this.wantedBoard())
      .map(([id, w]) => ({ userId: Number(id), username: w.name, total: w.total, posters: Object.keys(w.posters).length, updated: w.updated }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  },

  // Put points on a criminal's head. Only players who've committed a crime in the last week.
  postWanted(user, name, amountArg) {
    const cc = this.crimeCfg();
    if (!cc.wanted) return { ok: false, error: 'wanted posters are switched off right now.' };
    const target = this.repo.getUserByName(String(name || '').replace(/^@/, '').toLowerCase());
    if (!target) return { ok: false, error: `no adventurer named ${name}.` };
    if (target.id === user.id) return { ok: false, error: "you can't put a bounty on yourself." };
    const now = this.now();
    const crime = this.heistInfo(target.id).lastCrimeAt || 0;
    if (!crime || now - crime > 7 * DAY) return { ok: false, error: `@${target.username} hasn't committed a crime this week. Only criminals go on the wanted board.` };
    const amount = Math.floor(Number(String(amountArg || '').replace(/[, ]/g, '').replace(/k$/i, '000')));
    if (!(amount >= cc.wantedMin)) return { ok: false, error: `a bounty is at least ${fmt(cc.wantedMin)} pts.` };
    const pts = this.repo.getUser(user.id).points;
    if (amount > pts) return { ok: false, error: `you have ${fmt(pts)} pts.` };
    const all = this.wantedBoard();
    this.repo.transaction(() => {
      this.repo.addPoints(user.id, -amount);
      const w = (all[target.id] ||= { name: target.username, total: 0, posters: {}, updated: now });
      w.total += amount;
      w.posters[user.id] = (w.posters[user.id] || 0) + amount;
      w.updated = now;
      w.name = target.username;
      this.repo.setSetting('wanted', all);
    });
    const total = all[target.id].total;
    this.notify(target.id, `🎯 ${user.username} put ${fmt(amount)} pts on your head. The bounty is now ${fmt(total)} pts: anyone who beats you collects it.`);
    this.emitActivity(user, { kind: 'heist', text: `put a ${fmt(amount)} pts bounty on ${target.username} 🎯 (now ${fmt(total)})` });
    if (total >= 5000) this.announce?.(`🎯 WANTED: @${target.username}, ${fmt(total)} pts. Beat them in a heist fight, the arena or the Gloamveil to collect.`);
    return { ok: true, message: `🎯 posted ${fmt(amount)} pts on @${target.username}'s head (${fmt(total)} pts in total). Whoever beats them collects it.` };
  },

  // Someone beat a wanted player: they collect the bounty (10% is removed). Returns the amount.
  claimWanted(winner, loserId, how) {
    if (!winner || winner.id === loserId || !this.crimeCfg().wanted) return 0;
    const all = this.wantedBoard();
    const w = all[loserId];
    if (!w) return 0;
    const pay = Math.floor(w.total * 0.9);
    delete all[loserId];
    this.repo.setSetting('wanted', all);
    this.repo.addPoints(winner.id, pay);
    this.track('pvp', w.total - pay);
    for (const pid of Object.keys(w.posters)) this.notify(Number(pid), `🎯 ${winner.username} collected the bounty on ${w.name} (${how}).`);
    this.notify(loserId, `🎯 ${winner.username} collected the ${fmt(w.total)} pts bounty on your head.`);
    this.emitActivity(winner, { kind: 'heist', text: `collected the ${fmt(pay)} pts bounty on ${w.name} (${how}) 🎯` });
    if (w.total >= 5000) this.announce?.(`🎯 @${winner.username} collected the ${fmt(pay)} pts bounty on @${w.name}!`);
    return pay;
  },

  // !wanted [@name amount]
  wantedCommand(user, args = []) {
    const p = this.cfg.prefix;
    if (args.length >= 2) {
      const r = this.postWanted(user, args[0], args[1]);
      return r.ok ? r.message : r.error;
    }
    const list = this.wantedList(5);
    if (args.length === 1) {
      const t = this.repo.getUserByName(String(args[0]).replace(/^@/, '').toLowerCase());
      const w = t && this.wantedBoard()[t.id];
      return w ? `🎯 @${w.name}: ${fmt(w.total)} pts on their head from ${Object.keys(w.posters).length} poster${Object.keys(w.posters).length === 1 ? '' : 's'}.` : `no bounty on ${args[0]}. ${p}wanted @name 1000 puts one up (criminals only).`;
    }
    return list.length
      ? `🎯 WANTED: ${list.map((w) => `@${w.username} ${fmt(w.total)}`).join(' · ')}. Beat them in a heist fight, the arena or the Gloamveil to collect. ${p}wanted @name 1000 adds to one.`
      : `🎯 the wanted board is empty. ${p}wanted @name 1000 puts points on a criminal's head.`;
  },

  // ---- Jail: bail and jailbreaks ----------------------------------------------------------------
  bailPrice(userId) {
    return Math.min(20000, Math.max(200, Math.floor(this.repo.getUser(userId).points * this.crimeCfg().bailPct)));
  },

  bail(user) {
    const now = this.now();
    const mine = this.heistInfo(user.id);
    if (!(mine.jailUntil > now)) return "you're not in jail.";
    const cost = this.bailPrice(user.id);
    if (this.repo.getUser(user.id).points < cost) return `bail is ${fmt(cost)} pts and you don't have it. Wait it out (${minutesLeft(mine.jailUntil - now)}) or hope a friend breaks you out.`;
    this.repo.transaction(() => {
      this.repo.addPoints(user.id, -cost);
      this.track('pvp', cost);
      mine.jailUntil = 0;
      this.saveHeistInfo(user.id, mine);
    });
    return `🔓 you posted ${fmt(cost)} pts bail and walked out. Stay out of trouble!`;
  },

  jailed(now = this.now()) {
    return this.repo
      .listSettingsLike?.('heist:%')
      ?.map(({ key, value }) => ({ id: Number(key.split(':')[1]), until: value?.jailUntil || 0 }))
      .filter((x) => x.until > now)
      .map((x) => ({ ...x, username: this.repo.getUser(x.id)?.username }))
      .filter((x) => x.username) || [];
  },

  // !jailbreak @name: bust someone out. Agility helps, guildmates help each other. Fail and you're in too.
  jailbreak(user, args = []) {
    const p = this.cfg.prefix;
    if (!this.crimeCfg().jailbreak) return 'jailbreaks are switched off right now.';
    if (!args.length) {
      const inside = this.jailed();
      return inside.length ? `🚔 in jail: ${inside.map((x) => `@${x.username} (${minutesLeft(x.until - this.now())})`).join(', ')}. ${p}jailbreak @name to bust them out.` : '🚔 the jail is empty.';
    }
    const name = String(args[0]).replace(/^@/, '');
    const target = this.repo.getUserByName(name.toLowerCase());
    if (!target) return `no adventurer named ${name}.`;
    if (target.id === user.id) return `you can't break yourself out. ${p}bail pays your way out.`;
    const now = this.now();
    const mine = this.heistInfo(user.id);
    if (mine.jailUntil > now) return "you're in jail yourself!";
    const theirs = this.heistInfo(target.id);
    if (!(theirs.jailUntil > now)) return `@${target.username} isn't in jail.`;
    const tired = this.staminaCheck(user, now);
    if (tired !== null) return tired || null;
    const sameGuild = this.repo.guildOf(user.id)?.id && this.repo.guildOf(user.id)?.id === this.repo.guildOf(target.id)?.id;
    const chance = clamp(0.35 + this.agilityLevel(user.id) * 0.002 + (sameGuild ? 0.1 : 0), 0.1, 0.8);
    this.spendStamina(user, now);
    this.repo.setActionAt(user.id, now);
    if (this.rng() < chance) {
      theirs.jailUntil = 0;
      this.saveHeistInfo(target.id, theirs);
      mine.breakouts = (mine.breakouts || 0) + 1;
      this.saveHeistInfo(user.id, mine);
      if (mine.breakouts >= 3) this.addPvpTitle(user.id, 'the Liberator');
      this.notify(target.id, `🔓 ${user.username} broke you out of jail!`);
      this.emitActivity(user, { kind: 'heist', text: `broke ${target.username} out of jail! 🔓` });
      return `🔓 you bent the bars and @${target.username} walked free!${mine.breakouts === 3 ? ' Title unlocked: "the Liberator".' : ''}`;
    }
    let reply;
    this.repo.transaction(() => {
      const { fine } = this.crimeCaught(user, mine, now, { jailMinutes: Math.ceil(this.heistCfg().jailMinutes / 2), share: 0 });
      reply = `🚨 the guards caught you trying to break @${target.username} out. Fined ${fmt(Math.floor(fine))} pts and now you're in the cell next to them (${Math.ceil(this.heistCfg().jailMinutes / 2)}m).`;
    });
    this.emitActivity(user, { kind: 'heist', text: `got caught trying to break ${target.username} out of jail 🚔` });
    return reply;
  },

  // !jail: your sentence (or who's inside).
  jailCommand(user, args = []) {
    const now = this.now();
    const mine = this.heistInfo(user.id);
    if (!args.length && mine.jailUntil > now) return `🚔 you're in jail for ${minutesLeft(mine.jailUntil - now)}. ${this.cfg.prefix}bail costs ${fmt(this.bailPrice(user.id))} pts, or a friend can ${this.cfg.prefix}jailbreak you.`;
    return this.jailbreak(user, []);
  },

  // ---- Snitching --------------------------------------------------------------------------------
  // !tipoff @name: for 10 minutes the guards wait for them; their next crime fails and you get a cut.
  tipoff(user, args = []) {
    const p = this.cfg.prefix;
    if (!this.crimeCfg().tipoffs) return 'tip-offs are switched off right now.';
    if (!args.length) return `usage: ${p}tipoff @name. If they try a crime in the next 10 minutes, the guards are waiting (you get a quarter of the fine). Costs 100 pts. Tip off from the website to stay anonymous.`;
    const name = String(args[0]).replace(/^@/, '');
    const target = this.repo.getUserByName(name.toLowerCase());
    if (!target) return `no adventurer named ${name}.`;
    if (target.id === user.id) return 'snitching on yourself? Bold.';
    const now = this.now();
    const mine = this.heistInfo(user.id);
    if (now - (mine.lastTip || 0) < 15 * MIN) return `the guards don't take tips from you that often. Wait ${minutesLeft(mine.lastTip + 15 * MIN - now)}.`;
    if (this.repo.getUser(user.id).points < 100) return 'a tip-off costs 100 pts (guards like a little something).';
    const tips = this.repo.getSetting('tipoffs') || {};
    for (const [k, t] of Object.entries(tips)) if (t.until <= now) delete tips[k];
    this.repo.transaction(() => {
      this.repo.addPoints(user.id, -100);
      this.track('pvp', 100);
      tips[target.id] = { by: user.id, byName: user.username, until: now + 10 * MIN };
      this.repo.setSetting('tipoffs', tips);
      mine.lastTip = now;
      this.saveHeistInfo(user.id, mine);
    });
    return `🤫 noted. The guards will be watching @${target.username} for the next 10 minutes.`;
  },

  // ---- Protection rackets -----------------------------------------------------------------------
  racketOffers() {
    const offers = this.repo.getSetting('rackets') || {};
    return Object.entries(offers)
      .map(([gid, price]) => ({ guild: this.repo.guildGet(Number(gid)), price }))
      .filter((o) => o.guild && o.price > 0)
      .map((o) => ({ guildId: o.guild.id, tag: o.guild.tag, name: o.guild.name, price: o.price, enforcer: this.racketEnforcer(o.guild.id, [])?.username || null }));
  },

  racketClient(userId, now = this.now()) {
    const c = (this.repo.getSetting('racket_clients') || {})[userId];
    return c && c.until > now ? c : null;
  },

  // The guild's strongest member (highest combat level), not counting `exclude`.
  racketEnforcer(guildId, exclude = []) {
    const members = this.repo.guildMembers(guildId).filter((m) => !exclude.includes(m.user_id));
    if (!members.length) return null;
    const best = members.map((m) => ({ id: m.user_id, username: m.username, level: this.combatLevel(m.user_id) })).sort((a, b) => b.level - a.level)[0];
    return best;
  },

  // !racket · !racket price 2000 (guild leader; 0 stops) · !racket buy TAG
  racketCommand(user, args = []) {
    const p = this.cfg.prefix;
    const cc = this.crimeCfg();
    if (!cc.rackets) return 'protection rackets are switched off right now.';
    const sub = String(args[0] || '').toLowerCase();
    if (sub === 'price' || sub === 'set') {
      const g = this.repo.guildOf(user.id);
      if (!g || g.owner_id !== user.id) return 'only a guild leader can sell protection.';
      const price = Math.floor(Number(String(args[1] || '').replace(/[, ]/g, '').replace(/k$/i, '000')));
      if (!(price >= 0) || price > cc.racketMax) return `set a price from 0 (stop selling) to ${fmt(cc.racketMax)} pts per 24h.`;
      const offers = this.repo.getSetting('rackets') || {};
      if (price) offers[g.id] = price;
      else delete offers[g.id];
      this.repo.setSetting('rackets', offers);
      return price ? `🛡️ [${g.tag}] now sells protection for ${fmt(price)} pts a day. Anyone who hits a client has to beat your strongest member first. Clients pay into the guild bank.` : `[${g.tag}] stopped selling protection.`;
    }
    if (sub === 'buy') {
      const r = this.buyProtection(user, args[1]);
      return r.ok ? r.message : r.error;
    }
    const mine = this.racketClient(user.id);
    const offers = this.racketOffers();
    const have = mine ? ` You're protected by [${this.repo.guildGet(mine.guildId)?.tag}] for ${minutesLeft(mine.until - this.now())}.` : '';
    return offers.length
      ? `🛡️ protection for sale: ${offers.map((o) => `[${o.tag}] ${fmt(o.price)}/day${o.enforcer ? ` (enforcer ${o.enforcer})` : ''}`).join(' · ')}. ${p}racket buy TAG.${have}`
      : `🛡️ no guild is selling protection. Guild leaders: ${p}racket price 2000.${have}`;
  },

  buyProtection(user, tag) {
    const cc = this.crimeCfg();
    if (!cc.rackets) return { ok: false, error: 'protection rackets are switched off right now.' };
    const offer = this.racketOffers().find((o) => o.tag.toLowerCase() === String(tag || '').replace(/[[\]]/g, '').toLowerCase());
    if (!offer) return { ok: false, error: `no guild called ${tag} sells protection. ${this.cfg.prefix}racket lists them.` };
    const pts = this.repo.getUser(user.id).points;
    if (pts < offer.price) return { ok: false, error: `[${offer.tag}]'s protection costs ${fmt(offer.price)} pts, you have ${fmt(pts)}.` };
    // Paying a guild counts toward the daily gift limit (so it can't be used to move points to alts).
    const capped = this.giftAllowanceError?.(user.id, offer.price);
    if (capped) return { ok: false, error: capped };
    const now = this.now();
    this.repo.transaction(() => {
      this.repo.addPoints(user.id, -offer.price);
      const g = this.repo.guildGet(offer.guildId);
      this.repo.guildSet(g.id, 'bank', g.bank + offer.price);
      const clients = this.repo.getSetting('racket_clients') || {};
      clients[user.id] = { guildId: g.id, until: now + DAY };
      this.repo.setSetting('racket_clients', clients);
    });
    this.spendGiftAllowance?.(user.id, offer.price);
    return { ok: true, message: `🛡️ you paid [${offer.tag}] ${fmt(offer.price)} pts. For 24h anyone who comes for you has to get past their enforcer${offer.enforcer ? ` (${offer.enforcer})` : ''} first.` };
  },

  // Everything the Crime section of the PvP page shows.
  crimePage(viewerId = null) {
    const now = this.now();
    const cc = this.crimeCfg();
    const mine = viewerId ? this.heistInfo(viewerId) : null;
    const client = viewerId ? this.racketClient(viewerId, now) : null;
    const g = viewerId ? this.repo.guildOf(viewerId) : null;
    return {
      cfg: cc,
      wanted: this.wantedList(10),
      jail: this.jailed(now).map((x) => ({ username: x.username, for: x.until - now })),
      rackets: this.racketOffers(),
      me: viewerId
        ? {
            jailFor: mine.jailUntil > now ? mine.jailUntil - now : 0,
            bail: this.bailPrice(viewerId),
            protectedBy: client ? { tag: this.repo.guildGet(client.guildId)?.tag, for: client.until - now } : null,
            leaderOf: g && g.owner_id === viewerId ? { tag: g.tag, price: (this.repo.getSetting('rackets') || {})[g.id] || 0 } : null,
            wantedOnMe: this.wantedBoard()[viewerId]?.total || 0,
          }
        : null,
    };
  },
};
