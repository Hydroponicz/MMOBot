// GameEngine methods: the player market (website) and website notifications. Mixed into
// GameEngine.prototype by engine.js.
const { ITEMS } = require('../skills');
const { fmt, itemLabel } = require('./shared');

const MAX_LISTINGS = 20;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// Items that can't go on the market: pets are yours for good.
const tradable = (id) => ITEMS[id] && !ITEMS[id].pet && !ITEMS[id].bound;
// Items that don't use backpack slots.
const bagless = (it) => it.seedFor || it.ammo || it.cosmetic || it.pet;

module.exports = {
  // ---- Market ----------------------------------------------------------------------------
  // Highest price allowed per item, so the market can't be used to pass points between accounts.
  marketMaxUnitPrice(id) {
    return Math.max(500, ITEMS[id].value * 50);
  },

  marketBlocked(userId) {
    const c = this.cfg;
    if (c.tradingEnabled === false) return 'trading is switched off right now.';
    const u = this.repo.getUser(userId);
    const newbie = (c.tradeMinHours && this.now() - u.created_at < c.tradeMinHours * 3_600_000) || u.actions_count < (c.tradeMinActions || 0);
    return newbie ? `you can use the market once you've played a while (${c.tradeMinActions} actions and ${c.tradeMinHours}h since you first chatted).` : null;
  },

  // ---- Daily cap on points passed to other players --------------------------------------------
  // !give, bounties, guild deposits and overpriced market buys share one daily allowance, so points
  // can't be funnelled from alt accounts to a main account.
  giftAllowanceError(userId, amount) {
    const cap = this.cfg.tradeDailyPoints;
    if (!cap || amount <= 0) return null;
    const sent = this.repo.getSetting(`gifted:${userId}:${dayOf(this.now())}`) || 0;
    return sent + amount > cap ? `that's over your daily limit for points passed to other players: ${fmt(Math.max(0, cap - sent))} more today (limit ${fmt(cap)}).` : null;
  },

  spendGiftAllowance(userId, amount) {
    if (amount <= 0) return;
    const key = `gifted:${userId}:${dayOf(this.now())}`;
    this.repo.setSetting(key, (this.repo.getSetting(key) || 0) + amount);
  },

  marketListings(sellerId = null) {
    return this.repo.marketList({ sellerId }).map((l) => ({
      id: l.id,
      seller: l.seller,
      sellerId: l.seller_id,
      item: l.item,
      name: ITEMS[l.item]?.name || l.item,
      icon: ITEMS[l.item]?.icon || '❔',
      qty: l.qty,
      price: l.price,
      each: Math.round(l.price / l.qty),
      value: this.sellValue(l.item),
      createdAt: l.created_at,
    }));
  },

  // List items for a total price. They leave your backpack until sold or cancelled.
  marketSell(user, { item, qty, price }) {
    const blocked = this.marketBlocked(user.id);
    if (blocked) return { ok: false, error: blocked };
    const id = String(item || '');
    if (!tradable(id)) return { ok: false, error: "that item can't be sold on the market." };
    const have = this.repo.getInventory(user.id)[id] || 0;
    qty = Math.floor(Number(qty));
    price = Math.floor(Number(price));
    if (!(qty >= 1)) return { ok: false, error: 'how many?' };
    if (qty > have) return { ok: false, error: `you only have ${have} ${ITEMS[id].name}.` };
    if (!(price >= 1)) return { ok: false, error: 'set a price of at least 1 point.' };
    const max = this.marketMaxUnitPrice(id) * qty;
    if (price > max) return { ok: false, error: `that's too expensive: at most ${fmt(max)} pts for ${qty} ${ITEMS[id].name}.` };
    if (this.repo.marketCount(user.id) >= MAX_LISTINGS) return { ok: false, error: `you can have ${MAX_LISTINGS} listings at once. Cancel one first.` };
    // (Worn gear isn't in the backpack, so it can't be listed by accident.)
    const listingId = this.repo.transaction(() => {
      this.repo.removeItem(user.id, id, qty);
      return this.repo.marketAdd(user.id, id, qty, price, this.now());
    });
    this.emitActivity(user, { kind: 'market', item: id, text: `put ${qty}x ${ITEMS[id].name} on the market for ${fmt(price)} pts` });
    return { ok: true, id: listingId, message: `Listed ${itemLabel(id, qty)} for ${fmt(price)} pts.` };
  },

  marketBuy(user, listingId) {
    const blocked = this.marketBlocked(user.id);
    if (blocked) return { ok: false, error: blocked };
    const l = this.repo.marketGet(Number(listingId));
    if (!l) return { ok: false, error: 'that listing is gone (someone may have bought it).' };
    if (l.seller_id === user.id) return { ok: false, error: "that's your own listing. Cancel it instead." };
    const it = ITEMS[l.item];
    if (this.repo.getUser(user.id).points < l.price) return { ok: false, error: `you need ${fmt(l.price)} pts.` };
    if (it.ammo === 'bow') {
      const q = this.quiver(user.id);
      if (q.arrows + l.qty > q.capacity) return { ok: false, error: `no room in your quiver (${fmt(q.arrows)}/${fmt(q.capacity)}).` };
    } else if (!bagless(it)) {
      const bag = this.backpack(user.id);
      if (bag.used + l.qty > bag.capacity) return { ok: false, error: `no room in your backpack (${bag.used}/${bag.capacity}).` };
    }
    // Paying far over the shop value counts as passing points to the seller.
    const excess = Math.max(0, l.price - 2 * this.sellValue(l.item) * l.qty);
    const capped = this.giftAllowanceError(user.id, excess);
    if (capped) return { ok: false, error: `this listing costs much more than the item is worth, and ${capped}` };
    const fee = Math.floor(l.price * (this.cfg.marketFee ?? 0.05));
    const ok = this.repo.transaction(() => {
      if (!this.repo.marketDelete(l.id)) return false;
      this.repo.addPoints(user.id, -l.price);
      this.repo.addPoints(l.seller_id, l.price - fee);
      this.repo.addItem(user.id, l.item, l.qty);
      return true;
    });
    if (!ok) return { ok: false, error: 'that listing is gone.' };
    this.spendGiftAllowance(user.id, excess);
    this.track('traded', l.price);
    this.track('fees', fee);
    this.notify(l.seller_id, `🏪 ${user.username} bought your ${l.qty}x ${it.icon} ${it.name} for ${fmt(l.price)} pts (you got ${fmt(l.price - fee)} after the ${fmt(fee)} pts fee).`);
    this.emitActivity(user, { kind: 'trade', item: l.item, text: `bought ${l.qty}x ${it.name} on the market for ${fmt(l.price)} pts` });
    return { ok: true, message: `Bought ${itemLabel(l.item, l.qty)} for ${fmt(l.price)} pts!` };
  },

  marketCancel(user, listingId) {
    const l = this.repo.marketGet(Number(listingId));
    if (!l || l.seller_id !== user.id) return { ok: false, error: 'not your listing.' };
    this.repo.transaction(() => {
      this.repo.marketDelete(l.id);
      this.repo.addItem(user.id, l.item, l.qty);
    });
    return { ok: true, message: `${itemLabel(l.item, l.qty)} is back in your backpack.` };
  },

  // !market
  marketInfo() {
    const n = this.repo.marketList({ limit: 1000 }).length;
    return `🏪 ${n ? `${n} listing${n === 1 ? '' : 's'}` : 'nothing'} on the player market. Buy and sell at ${this.siteUrl}/#/market`;
  },

  // ---- Economy alerts (admin) --------------------------------------------------------------------
  // Looks at the last 7 days of points coming in and going out, and at who holds the points.
  economyAlerts() {
    this.flushEconomy?.();
    const econ = this.repo.getSetting('economy_stats') || {};
    const days = Object.entries(econ.days || {})
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .slice(0, 7)
      .map(([, v]) => v);
    const sum = (k) => days.reduce((s, d) => s + (d[k] || 0), 0);
    const earned = sum('chat') + sum('actions') + sum('sold') + sum('rewards');
    const spent = sum('shop') + sum('fees') + Math.max(0, sum('casinoWagered') - sum('casinoPaid'));
    const alerts = [];
    const week = { days: days.length, earned, spent };
    if (days.length >= 2 && earned > 1000 && earned > spent * 1.5) {
      alerts.push({
        level: earned > spent * 3 ? 'bad' : 'warn',
        title: `Points are piling up: ${fmt(earned)} earned vs ${fmt(spent)} spent in the last ${days.length} days (${(earned / Math.max(1, spent)).toFixed(1)}x).`,
        tips: [
          'Lower the sell price or action points multiplier (Settings → Economy).',
          'Raise the market fee, or raise shop and upgrade prices.',
          'Put an expensive cosmetic in the spotlight, or start a world boss so points go to rewards people want.',
        ],
      });
    }
    if (days.length >= 2 && spent > 1000 && spent > earned * 1.5) {
      alerts.push({
        level: 'warn',
        title: `Players are spending faster than they earn: ${fmt(spent)} out vs ${fmt(earned)} in over ${days.length} days.`,
        tips: ['Run an XP or chat-points boost, or a channel goal.', 'Raise the points multiplier a little, or lower shop prices.'],
      });
    }
    const wagered = sum('casinoWagered');
    if (wagered > 10_000 && sum('casinoPaid') > wagered) {
      alerts.push({ level: 'warn', title: `The casino paid out ${fmt(sum('casinoPaid') - wagered)} pts more than it took this week.`, tips: ['That happens with a few lucky wins; if it keeps up, lower the max bet (Settings → Casino).'] });
    }
    const top = this.repo.topEarners(100).sort((a, b) => b.points - a.points);
    const totals = this.repo.economyTotals();
    const n = Math.max(1, Math.ceil(totals.players * 0.01));
    const held = top.slice(0, n).reduce((s, u) => s + u.points, 0);
    if (totals.players >= 20 && totals.points > 0 && held / totals.points > 0.5) {
      alerts.push({
        level: 'warn',
        title: `The top ${n} player${n === 1 ? '' : 's'} hold ${Math.round((held / totals.points) * 100)}% of all points.`,
        tips: ['Big sinks for rich players help: cosmetics, enchanting, guild creation, world boss bounties.', 'Check the Players page for anything unusual.'],
      });
    }
    return { week, alerts };
  },

  // ---- Notifications ------------------------------------------------------------------------
  notify(userId, text) {
    this.repo.addNotification(userId, text, this.now());
  },

  // Saved notifications plus live reminders (crops ready, daily reward, stamina, raids).
  notifications(userId) {
    const now = this.now();
    const live = [];
    const ready = this.farmPlots(userId).filter((p) => p.ready).length;
    if (ready) live.push({ id: 'crops', icon: '🌾', text: `${ready} crop${ready === 1 ? ' is' : 's are'} ready to harvest.`, link: '#/me' });
    if (this.daily(userId).lastClaim !== dayOf(now)) live.push({ id: 'daily', icon: '📅', text: `Your daily reward is waiting: type ${this.cfg.prefix}daily in chat.` });
    const u = this.repo.getUser(userId);
    const st = this.stamina(userId, now);
    if (u.stamina !== null && st.charges === st.max && u.stamina_at && now - u.stamina_at < 3_600_000) live.push({ id: 'stamina', icon: '⚡', text: 'Your stamina is full again.' });
    const fire = this.fireLeft(userId);
    if (fire) live.push({ id: 'fire', icon: '🔥', text: `Your fire burns for another ${Math.ceil(fire / 60_000)} min: ${this.cfg.prefix}cook while it lasts.`, info: true });
    const raid = this.raidState();
    if (raid) live.push({ id: 'raid', icon: raid.world ? '🌍' : '⚔️', text: `${raid.world ? 'World boss' : 'Raid'}: ${raid.icon} ${raid.name} is up! ${this.cfg.prefix}attack in chat.`, info: true });
    const goal = this.goalState();
    if (goal && !goal.done) live.push({ id: 'goal', icon: '🎯', text: `Channel goal: ${fmt(goal.progress)}/${fmt(goal.target)}.`, info: true });
    const saved = this.repo.notifications(userId, 20).map((n) => ({ id: n.id, text: n.text, at: n.created_at, read: !!n.read }));
    return { live, saved, unread: saved.filter((n) => !n.read).length + live.filter((n) => !n.info).length };
  },

  readNotifications(userId) {
    this.repo.readNotifications(userId);
  },
};

