// GameEngine methods: relic cases (website). Opening cases, trade-up contracts, selling back to the
// bank, the relic market, relic trades, the showcase and SoulTrak™ kill counters.
// Relic data and maths are in ../relics.js. Mixed into GameEngine.prototype by engine.js.
const R = require('../relics');
const { fmt } = require('./shared');

const MAX_LISTINGS = 30;
const MAX_OPEN_TRADES = 10;
const MAX_TRADE_RELICS = 12;
const TRADE_DAYS = 3;
const MAX_CASES_AT_ONCE = 5;

// "!cards open dragon booster 3" -> { pick, count } from a catalog by name words, last word a count.
function pickByWords(list, words, max) {
  const w = [...words];
  const count = w.length && /^\d+$/.test(w[w.length - 1]) ? Math.min(max, Math.max(1, Number(w.pop()))) : 1;
  const hit = (x) => w.every((q) => `${x.name} ${x.id}`.toLowerCase().includes(q));
  return { pick: w.length ? list.find(hit) : null, count };
}

const rankOf = (skinId) => R.RARITIES[R.SKINS[skinId].rarity].rank;
// Worth a feed entry: mythic or better, or a rare pattern.
const notable = (row) => rankOf(row.skin) >= 2 || !!R.patternOf(row.skin, row.seed).rare;

module.exports = {
  // Catalog value of a relic, its value on the market (real sales nudge it) and what the bank pays.
  relicValues(row) {
    const base = R.valueOf({ skin: row.skin, float: row.float, seed: row.seed, soul: !!row.soul });
    const factor = this.marketFactor('relic', row.skin);
    return { base, factor, value: Math.max(1, Math.round(base * factor)), buyback: this.bankPay(Math.round(base * Math.min(1, factor)), this.cfg.relicBuyback ?? 0.6) };
  },

  relicsClosed() {
    return this.cfg.relicsEnabled === false ? 'relic cases are switched off right now.' : null;
  },

  relicCasePrice(c) {
    return Math.max(1, Math.round(c.price * (this.cfg.relicCasePriceMultiplier ?? 1)));
  },

  relicShowcaseId(userId) {
    return this.repo.getSetting(`relic_showcase:${userId}`) || null;
  },

  // What a stored relic looks like on the website. The pattern seed is public (it's how the skin
  // looks), like in the real thing.
  relicView(row) {
    const s = R.SKINS[row.skin];
    if (!s) return null;
    const r = R.RARITIES[s.rarity];
    const { value, base, factor, buyback } = this.relicValues(row);
    const ext = R.exteriorOf(row.float);
    const pattern = R.patternOf(row.skin, row.seed);
    return {
      id: row.id,
      skin: row.skin,
      case: s.case,
      caseName: R.CASE_BY_ID[s.case].name,
      weapon: s.weapon,
      weaponName: s.weaponName,
      name: s.name,
      fullName: `${row.soul ? 'SoulTrak™ ' : ''}${R.fullName(s)}`,
      star: s.star,
      rarity: s.rarity,
      rarityName: r.name,
      rarityRank: r.rank,
      color: r.color,
      finish: s.finish,
      colors: pattern.colors || s.colors,
      min: s.min,
      max: s.max,
      float: row.float,
      exterior: ext.name,
      exteriorShort: ext.short,
      seed: row.seed,
      pattern: pattern.label,
      fade: pattern.fade || null,
      rarePattern: !!pattern.rare,
      soul: !!row.soul,
      kills: row.kills || 0,
      value,
      baseValue: base,
      marketFactor: factor,
      buyback,
      status: row.status,
      price: row.price ?? null,
      owner: row.owner,
      origin: row.origin,
      createdAt: row.created_at,
    };
  },

  relicCatalog() {
    return {
      rarities: R.RARITIES,
      exteriors: R.EXTERIORS.map(({ name, short, max, mult }) => ({ name, short, max: Math.min(1, max), mult })),
      tradeUpSize: R.TRADE_UP_SIZE,
      next: R.NEXT_RARITY,
      soulChance: R.SOUL_CHANCE,
      buyback: this.cfg.relicBuyback ?? 0.6,
      bankDailyLimit: this.cfg.bankDailyLimit ?? 25000,
      bankFullValue: this.cfg.bankFullValue ?? 5000,
      fee: this.cfg.marketFee ?? 0.05,
      cases: R.CASES.map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
        color: c.color,
        price: this.relicCasePrice(c),
        ev: c.ev,
        skins: c.skinIds.map((id) => {
          const s = R.SKINS[id];
          const pool = c.skinIds.filter((x) => R.SKINS[x].rarity === s.rarity).length;
          return { id, weapon: s.weapon, weaponName: s.weaponName, name: s.name, star: s.star, rarity: s.rarity, finish: s.finish, colors: s.colors, min: s.min, max: s.max, base: s.base, chance: R.RARITIES[s.rarity].odds / pool };
        }),
      })),
    };
  },

  relicInventory(userId) {
    const owner = this.repo.getUser(userId)?.username;
    const relics = this.repo.relicsOf(userId).map((r) => this.relicView({ ...r, owner }));
    return { relics, value: relics.reduce((s, r) => s + r.value, 0), showcase: this.relicShowcaseId(userId) };
  },

  // ---- Opening cases -----------------------------------------------------------------------
  relicOpen(user, caseId, count = 1) {
    const closed = this.relicsClosed();
    if (closed) return { ok: false, error: closed };
    const c = R.CASE_BY_ID[String(caseId)];
    if (!c) return { ok: false, error: 'no such case.' };
    count = Math.floor(Number(count) || 1);
    if (count < 1 || count > MAX_CASES_AT_ONCE) return { ok: false, error: `open 1 to ${MAX_CASES_AT_ONCE} cases at a time.` };
    const now = this.now();
    this.lastCaseAt ??= new Map();
    if (now - (this.lastCaseAt.get(user.id) || 0) < 800) return { ok: false, error: 'easy! Let the last case finish spinning.' };
    const cost = this.relicCasePrice(c) * count;
    const points = this.repo.getUser(user.id).points;
    if (points < cost) return { ok: false, error: `you need ${fmt(cost)} pts (you have ${fmt(points)}).` };
    this.lastCaseAt.set(user.id, now);
    const ids = this.repo.transaction(() => {
      this.repo.addPoints(user.id, -cost);
      return Array.from({ length: count }, () => this.repo.relicInsert(user.id, R.openCase(c.id, this.rng), 'case', now));
    });
    this.track('relicCases', cost);
    for (let i = 0; i < count; i++) this.questProgress?.(user, { kind: 'case' });
    const relics = ids.map((id) => this.relicView({ ...this.repo.relicGet(id), owner: user.username }));
    // The best unboxing goes on the feed after the reel has had time to stop spinning.
    const best = relics.filter((r) => notable({ skin: r.skin, seed: r.seed })).sort((a, b) => b.value - a.value)[0];
    if (best) {
      const fire = () => {
        this.emitActivity(user, { kind: 'unbox', text: `unboxed ${best.fullName} (${best.exterior}${best.pattern ? `, ${best.pattern}` : ''}) from a ${c.name}! 🧰` });
        if (best.star || best.rarityRank >= 3) this.emit('announce', `🧰 ${user.username} just unboxed ${best.fullName} (${best.exterior}) worth ${fmt(best.value)} pts from a ${c.name}!`);
      };
      if (this.cfg.relicFeedDelayMs === 0) fire();
      else setTimeout(fire, this.cfg.relicFeedDelayMs ?? 7000).unref?.();
    }
    return { ok: true, case: { id: c.id, name: c.name }, relics, cost, value: relics.reduce((s, r) => s + r.value, 0), balance: this.repo.getUser(user.id).points };
  },

  // ---- Showcase and SoulTrak™ -----------------------------------------------------------------
  relicSetShowcase(user, relicId) {
    if (relicId === null || relicId === '' || relicId === 0) {
      this.repo.deleteSetting(`relic_showcase:${user.id}`);
      return { ok: true, message: 'Showcase cleared.' };
    }
    const row = this.repo.relicGet(Number(relicId));
    if (!row || row.owner_id !== user.id || !['owned', 'listed'].includes(row.status)) return { ok: false, error: "that's not your relic." };
    this.repo.setSetting(`relic_showcase:${user.id}`, row.id);
    const v = this.relicView(row);
    return { ok: true, message: `${v.fullName} is now your showcased relic.${v.soul ? ' Its SoulTrak™ counts every monster you defeat.' : ''}` };
  },

  // Called for every fight won (progression.onActivity).
  relicKill(user) {
    const id = this.relicShowcaseId(user.id);
    if (!id) return;
    const row = this.repo.relicGet(id);
    if (row && row.soul && row.owner_id === user.id && row.status !== 'bank' && row.status !== 'used') this.repo.relicAddKill(id);
  },

  // ---- Trade-up contracts ------------------------------------------------------------------------
  relicTradeUpInputs(user, ids) {
    ids = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
    const rows = ids.map((id) => this.repo.relicGet(id));
    if (rows.some((r) => !r || r.owner_id !== user.id || r.status !== 'owned')) return { error: 'every relic in the contract must be yours and not on the market.' };
    return { rows };
  },

  relicTradeUpPreview(user, ids) {
    const { rows, error } = this.relicTradeUpInputs(user, ids);
    if (error) return { ok: false, error };
    const p = R.tradeUpPreview(rows.map((r) => ({ skin: r.skin, float: r.float, soul: !!r.soul })));
    if (p.error) return { ok: false, error: p.error };
    const inValue = rows.reduce((s, r) => s + this.relicView(r).value, 0);
    return {
      ok: true,
      rarity: p.rarity,
      next: p.next,
      soul: p.soul,
      inValue,
      outcomes: p.outcomes.map((o) => ({ ...this.relicView({ id: 0, skin: o.skin, float: o.float, seed: 500, soul: p.soul ? 1 : 0 }), chance: o.chance })),
    };
  },

  relicTradeUp(user, ids) {
    const closed = this.relicsClosed();
    if (closed) return { ok: false, error: closed };
    const { rows, error } = this.relicTradeUpInputs(user, ids);
    if (error) return { ok: false, error };
    const out = R.tradeUp(rows.map((r) => ({ skin: r.skin, float: r.float, soul: !!r.soul })), this.rng);
    if (out.error) return { ok: false, error: out.error };
    const showcase = this.relicShowcaseId(user.id);
    const id = this.repo.transaction(() => {
      for (const r of rows) this.repo.relicUpdate(r.id, { status: 'used' });
      return this.repo.relicInsert(user.id, out, 'tradeup', this.now());
    });
    if (showcase && rows.some((r) => r.id === showcase)) this.repo.deleteSetting(`relic_showcase:${user.id}`);
    const v = this.relicView({ ...this.repo.relicGet(id), owner: user.username });
    if (v.rarityRank >= 3) {
      this.emitActivity(user, { kind: 'unbox', text: `traded up into ${v.fullName} (${v.exterior})! 📜` });
      if (v.star) this.emit('announce', `📜 ${user.username} traded up into ${v.fullName} (${v.exterior}) worth ${fmt(v.value)} pts!`);
    }
    return { ok: true, relic: v, message: `Contract signed: you got ${v.fullName} (${v.exterior}).` };
  },

  // ---- Selling back to the bank -----------------------------------------------------------------
  relicSellBack(user, ids) {
    const closed = this.relicsClosed();
    if (closed) return { ok: false, error: closed };
    ids = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean))].slice(0, 200);
    if (!ids.length) return { ok: false, error: 'pick some relics to sell.' };
    const showcase = this.relicShowcaseId(user.id);
    let result = { sold: [], total: 0, skipped: 0 };
    this.repo.transaction(() => {
      const items = [];
      for (const id of ids) {
        const row = this.repo.relicGet(id);
        if (!row || row.owner_id !== user.id || row.status !== 'owned') continue;
        items.push({ id, pay: this.relicValues(row).buyback });
      }
      result = this.bankTake(user.id, items, (id) => this.repo.relicUpdate(id, { status: 'bank' }));
    });
    const { sold, total, skipped } = result;
    if (!sold.length) return { ok: false, error: skipped ? this.bankLimitError(user.id, skipped) : 'none of those relics can be sold (on the market, or not yours).' };
    if (showcase && sold.includes(showcase)) this.repo.deleteSetting(`relic_showcase:${user.id}`);
    this.track('relicBuyback', total);
    const n = sold.length;
    return { ok: true, sold: n, soldIds: sold, skipped, points: total, balance: this.repo.getUser(user.id).points, message: `Sold ${n} relic${n === 1 ? '' : 's'} to the bank for ${fmt(total)} pts.${this.bankLimitNote(user.id, skipped)}` };
  },

  // ---- Relic market -------------------------------------------------------------------------------
  relicMaxPrice(view) {
    return Math.max(1000, view.value * 20);
  },

  relicListings() {
    return this.repo.relicListings().map((r) => this.relicView(r));
  },

  relicList(user, relicId, price) {
    const closed = this.relicsClosed() || this.marketBlocked(user.id);
    if (closed) return { ok: false, error: closed };
    const row = this.repo.relicGet(Number(relicId));
    if (!row || row.owner_id !== user.id || row.status !== 'owned') return { ok: false, error: "that relic can't be listed." };
    price = Math.floor(Number(price));
    if (!(price >= 1)) return { ok: false, error: 'set a price of at least 1 point.' };
    const view = this.relicView(row);
    const max = this.relicMaxPrice(view);
    if (price > max) return { ok: false, error: `that's too expensive: at most ${fmt(max)} pts for this relic.` };
    if (this.repo.relicListingCount(user.id) >= MAX_LISTINGS) return { ok: false, error: `you can list ${MAX_LISTINGS} relics at once.` };
    this.repo.relicUpdate(row.id, { status: 'listed', price, listed_at: this.now() });
    return { ok: true, message: `Listed ${view.fullName} for ${fmt(price)} pts.` };
  },

  relicUnlist(user, relicId) {
    const row = this.repo.relicGet(Number(relicId));
    if (!row || row.owner_id !== user.id || row.status !== 'listed') return { ok: false, error: 'not your listing.' };
    this.repo.relicUpdate(row.id, { status: 'owned', price: null, listed_at: null });
    return { ok: true, message: `${R.fullName(R.SKINS[row.skin])} is back in your inventory.` };
  },

  relicBuy(user, relicId) {
    const closed = this.relicsClosed() || this.marketBlocked(user.id);
    if (closed) return { ok: false, error: closed };
    const row = this.repo.relicGet(Number(relicId));
    if (!row || row.status !== 'listed') return { ok: false, error: 'that relic is gone (someone may have bought it).' };
    if (row.owner_id === user.id) return { ok: false, error: "that's your own listing. Take it down instead." };
    const view = this.relicView(row);
    const price = row.price;
    if (this.repo.getUser(user.id).points < price) return { ok: false, error: `you need ${fmt(price)} pts.` };
    // Paying far over the relic's value counts as passing points to the seller.
    const excess = Math.max(0, price - 2 * view.value);
    const capped = this.giftAllowanceError(user.id, excess);
    if (capped) return { ok: false, error: `this relic costs much more than it's worth, and ${capped}` };
    const fee = Math.floor(price * (this.cfg.marketFee ?? 0.05));
    const sellerId = row.owner_id;
    const ok = this.repo.transaction(() => {
      const fresh = this.repo.relicGet(row.id);
      if (fresh.status !== 'listed' || fresh.owner_id !== sellerId || fresh.price !== price) return false;
      this.repo.relicUpdate(row.id, { owner_id: user.id, status: 'owned', price: null, listed_at: null });
      this.repo.addPoints(user.id, -price);
      this.repo.addPoints(sellerId, price - fee);
      return true;
    });
    if (!ok) return { ok: false, error: 'that relic is gone.' };
    this.recordSale('relic', row.skin, price, view.baseValue, user.id, sellerId);
    if (this.relicShowcaseId(sellerId) === row.id) this.repo.deleteSetting(`relic_showcase:${sellerId}`);
    this.spendGiftAllowance(user.id, excess);
    this.track('traded', price);
    this.track('fees', fee);
    this.notify(sellerId, `🧰 ${user.username} bought your ${view.fullName} for ${fmt(price)} pts (you got ${fmt(price - fee)} after the fee).`);
    this.emitActivity(user, { kind: 'trade', text: `bought ${view.fullName} for ${fmt(price)} pts` });
    return { ok: true, message: `Bought ${view.fullName} for ${fmt(price)} pts!` };
  },

  // ---- Trades between players ---------------------------------------------------------------------
  relicTradeView(t, viewerId) {
    const list = (ids) => ids.map((id) => this.repo.relicGet(id)).filter(Boolean).map((r) => this.relicView(r));
    const give = list(JSON.parse(t.give));
    const want = list(JSON.parse(t.want));
    return {
      id: t.id,
      from: t.from_name,
      to: t.to_name,
      incoming: t.to_id === viewerId,
      give,
      want,
      pointsGive: t.points_give,
      pointsWant: t.points_want,
      message: t.message,
      status: t.status,
      createdAt: t.created_at,
      expiresAt: t.created_at + TRADE_DAYS * 86_400_000,
      valueGive: give.reduce((s, r) => s + r.value, 0) + t.points_give,
      valueWant: want.reduce((s, r) => s + r.value, 0) + t.points_want,
    };
  },

  relicTrades(userId) {
    this.repo.relicTradesExpire(this.now() - TRADE_DAYS * 86_400_000, this.now());
    return this.repo.relicTradesFor(userId).map((t) => this.relicTradeView(t, userId));
  },

  relicTradeCheck(fromId, toId, give, want, pointsGive, pointsWant) {
    for (const [ids, owner, who] of [[give, fromId, 'you'], [want, toId, 'they']]) {
      for (const id of ids) {
        const r = this.repo.relicGet(id);
        if (!r || r.owner_id !== owner || !['owned', 'listed'].includes(r.status)) return `${who} no longer have one of those relics.`;
        if (r.status !== 'owned') return 'one of those relics is on the market; take it down first.';
      }
    }
    if (this.repo.getUser(fromId).points < pointsGive) return 'the offer is short of points.';
    if (this.repo.getUser(toId).points < pointsWant) return "there aren't enough points on the other side.";
    return null;
  },

  // Relic values count like points for the daily gift limit, so trades can't funnel value to alts.
  relicTradeExcess(give, want, pointsGive, pointsWant) {
    const val = (ids) => ids.reduce((s, id) => s + this.relicView(this.repo.relicGet(id)).value, 0);
    const a = val(give) + pointsGive;
    const b = val(want) + pointsWant;
    return { from: Math.max(0, a - 2 * b), to: Math.max(0, b - 2 * a) };
  },

  relicTradeOffer(user, { to, give = [], want = [], pointsGive = 0, pointsWant = 0, message = '' } = {}) {
    const closed = this.relicsClosed() || this.marketBlocked(user.id);
    if (closed) return { ok: false, error: closed };
    const target = this.repo.getUserByName(String(to || ''));
    if (!target || target.banned) return { ok: false, error: 'no player by that name.' };
    if (target.id === user.id) return { ok: false, error: "you can't trade with yourself." };
    if (this.marketBlocked(target.id)) return { ok: false, error: `${target.username} can't trade yet.` };
    const ids = (a) => [...new Set((Array.isArray(a) ? a : []).map(Number).filter(Boolean))];
    give = ids(give);
    want = ids(want);
    pointsGive = Math.max(0, Math.floor(Number(pointsGive) || 0));
    pointsWant = Math.max(0, Math.floor(Number(pointsWant) || 0));
    if (!give.length && !want.length) return { ok: false, error: 'pick at least one relic.' };
    if (give.length > MAX_TRADE_RELICS || want.length > MAX_TRADE_RELICS) return { ok: false, error: `up to ${MAX_TRADE_RELICS} relics each way.` };
    if (this.repo.relicTradesOpenFrom(user.id) >= MAX_OPEN_TRADES) return { ok: false, error: `you have ${MAX_OPEN_TRADES} open offers. Cancel one first.` };
    const bad = this.relicTradeCheck(user.id, target.id, give, want, pointsGive, pointsWant);
    if (bad) return { ok: false, error: bad };
    const ex = this.relicTradeExcess(give, want, pointsGive, pointsWant);
    const capped = this.giftAllowanceError(user.id, ex.from);
    if (capped) return { ok: false, error: `this offer gives away much more than it gets back, and ${capped}` };
    const id = this.repo.relicTradeAdd({ fromId: user.id, toId: target.id, give, want, pointsGive, pointsWant, message: String(message || '').slice(0, 140) }, this.now());
    this.notify(target.id, `🤝 ${user.username} sent you a relic trade offer. See it on the Cases page → Trades.`);
    return { ok: true, id, message: `Trade offer sent to ${target.username}.` };
  },

  relicTradeAccept(user, tradeId) {
    const closed = this.relicsClosed() || this.marketBlocked(user.id);
    if (closed) return { ok: false, error: closed };
    this.repo.relicTradesExpire(this.now() - TRADE_DAYS * 86_400_000, this.now());
    const t = this.repo.relicTradeGet(Number(tradeId));
    if (!t || t.to_id !== user.id) return { ok: false, error: 'no such offer.' };
    if (t.status !== 'open') return { ok: false, error: `that offer is ${t.status}.` };
    const give = JSON.parse(t.give);
    const want = JSON.parse(t.want);
    const bad = this.relicTradeCheck(t.from_id, t.to_id, give, want, t.points_give, t.points_want);
    if (bad) {
      this.repo.relicTradeSet(t.id, 'cancelled', this.now());
      return { ok: false, error: `this offer can't go through any more (someone no longer has what it needs). It has been cancelled.` };
    }
    const ex = this.relicTradeExcess(give, want, t.points_give, t.points_want);
    const capA = this.giftAllowanceError(t.from_id, ex.from);
    if (capA) return { ok: false, error: `the other player's side is over their daily gift limit: ${capA}` };
    const capB = this.giftAllowanceError(user.id, ex.to);
    if (capB) return { ok: false, error: `you'd be giving much more than you get, and ${capB}` };
    const now = this.now();
    const ok = this.repo.transaction(() => {
      if (!this.repo.relicTradeSet(t.id, 'accepted', now)) return false;
      for (const id of give) this.repo.relicUpdate(id, { owner_id: t.to_id });
      for (const id of want) this.repo.relicUpdate(id, { owner_id: t.from_id });
      if (t.points_give) {
        this.repo.addPoints(t.from_id, -t.points_give);
        this.repo.addPoints(t.to_id, t.points_give);
      }
      if (t.points_want) {
        this.repo.addPoints(t.to_id, -t.points_want);
        this.repo.addPoints(t.from_id, t.points_want);
      }
      return true;
    });
    if (!ok) return { ok: false, error: 'that offer is no longer open.' };
    for (const [uid, ids] of [[t.from_id, give], [t.to_id, want]]) {
      if (ids.includes(this.relicShowcaseId(uid))) this.repo.deleteSetting(`relic_showcase:${uid}`);
    }
    this.spendGiftAllowance(t.from_id, ex.from);
    this.spendGiftAllowance(user.id, ex.to);
    const from = this.repo.getUser(t.from_id);
    this.notify(t.from_id, `🤝 ${user.username} accepted your relic trade.`);
    this.emitActivity(user, { kind: 'trade', text: `traded relics with ${from.username} 🤝` });
    return { ok: true, message: `Trade done with ${from.username}!` };
  },

  relicTradeClose(user, tradeId, how) {
    const t = this.repo.relicTradeGet(Number(tradeId));
    const mine = how === 'cancelled' ? t?.from_id === user.id : t?.to_id === user.id;
    if (!t || !mine) return { ok: false, error: 'no such offer.' };
    if (!this.repo.relicTradeSet(t.id, how, this.now())) return { ok: false, error: `that offer is already ${t.status}.` };
    if (how === 'declined') this.notify(t.from_id, `🤝 ${user.username} declined your relic trade.`);
    return { ok: true, message: how === 'cancelled' ? 'Offer cancelled.' : 'Offer declined.' };
  },

  // ---- Public views ------------------------------------------------------------------------------
  relicDrops() {
    return this.repo.relicRecent(400).filter(notable).slice(0, 24).map((r) => this.relicView(r));
  },

  relicUnboxedCount(skinId) {
    return R.SKINS[skinId] ? this.repo.relicUnboxed(skinId) : 0;
  },

  relicTop(limit = 10) {
    const now = this.now();
    if (this.relicTopCache && now - this.relicTopCache.at < 60_000) return this.relicTopCache.list.slice(0, limit);
    const by = new Map();
    for (const r of this.repo.relicsActive()) {
      const e = by.get(r.owner_id) || { username: r.username, value: 0, relics: 0, best: null };
      const v = this.relicValues(r).value;
      e.value += v;
      e.relics++;
      if (!e.best || v > e.best.value) e.best = { name: `${r.soul ? 'SoulTrak™ ' : ''}${R.fullName(R.SKINS[r.skin])}`, color: R.RARITIES[R.SKINS[r.skin].rarity].color, value: v };
      by.set(r.owner_id, e);
    }
    const list = [...by.values()].sort((a, b) => b.value - a.value).slice(0, 50);
    this.relicTopCache = { at: now, list };
    return list.slice(0, limit);
  },

  relicPlayer(name) {
    const u = this.repo.getUserByName(String(name || ''));
    if (!u || u.banned) return null;
    return { username: u.username, ...this.relicInventory(u.id) };
  },

  // !relics
  relicsInfo(user, args = []) {
    if (this.relicsClosed()) return this.relicsClosed();
    const [sub = '', ...rest] = args.map((w) => String(w).toLowerCase());
    if (sub === 'cases') return `🧰 cases: ${R.CASES.map((c) => `${c.icon} ${c.name} ${fmt(this.relicCasePrice(c))}`).join(' · ')}. ${this.cfg.prefix}relics open <case> [count]`;
    if (sub === 'open') {
      const { pick, count } = pickByWords(R.CASES, rest, MAX_CASES_AT_ONCE);
      if (!pick) return `which case? ${R.CASES.map((c) => c.name).join(', ')}. e.g. ${this.cfg.prefix}relics open ${R.CASES[0].id}`;
      const r = this.relicOpen(user, pick.id, count);
      if (!r.ok) return r.error;
      const best = r.relics.reduce((a, b) => (b.value > a.value ? b : a));
      return `🧰 opened ${count} ${pick.name}${count === 1 ? '' : 's'} (-${fmt(r.cost)}): ${r.relics.length === 1 ? '' : `${r.relics.length} relics worth ${fmt(r.value)} pts. Best: `}${best.fullName} (${best.exteriorShort}${best.pattern ? `, ${best.pattern}` : ''}) worth ${fmt(best.value)} pts. ${this.siteUrl}/#/relics`;
    }
    const inv = this.relicInventory(user.id);
    const url = `${this.siteUrl}/#/relics`;
    if (!inv.relics.length) return `🧰 open relic cases for legendary blades, staffs and bows (with floats, rare patterns and SoulTrak™): ${url}`;
    const show = inv.relics.find((r) => r.id === inv.showcase);
    const best = inv.relics.reduce((a, b) => (b.value > a.value ? b : a));
    const shown = show ? ` · showcasing ${show.fullName}${show.soul ? ` (${fmt(show.kills)} kill${show.kills === 1 ? '' : 's'})` : ''}` : '';
    return `🧰 ${inv.relics.length} relic${inv.relics.length === 1 ? '' : 's'} worth ${fmt(inv.value)} pts · best: ${best.fullName} (${best.exteriorShort}, ${fmt(best.value)})${shown}. Cases and trade-ups: ${url}`;
  },
};
