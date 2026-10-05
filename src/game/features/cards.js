// GameEngine methods: trading cards (website). Packs, grading, selling back to the bank, the card
// market and card trades between players. Card data and maths are in ../cards.js.
// Mixed into GameEngine.prototype by engine.js.
const C = require('../cards');
const { fmt } = require('./shared');

const MAX_LISTINGS = 30;
const MAX_OPEN_TRADES = 10;
const MAX_TRADE_CARDS = 12;
const TRADE_DAYS = 3;
const MAX_PACKS_AT_ONCE = 10;

// "!cards open dragon booster 3" -> { pick, count } from a catalog by name words, last word a count.
function pickByWords(list, words, max) {
  const w = [...words];
  const count = w.length && /^\d+$/.test(w[w.length - 1]) ? Math.min(max, Math.max(1, Number(w.pop()))) : 1;
  const hit = (x) => w.every((q) => `${x.name} ${x.id}`.toLowerCase().includes(q));
  return { pick: w.length ? list.find(hit) : null, count };
}

// Worth a feed entry: epic or better, gold foil, or a holo rare+.
const notable = (c) => C.RARITIES[C.CARDS[c.card].rarity].rank >= 3 || c.finish === 'gold' || (c.finish === 'holo' && C.RARITIES[C.CARDS[c.card].rarity].rank >= 2);
const parseQ = (q) => (typeof q === 'string' ? JSON.parse(q) : q);

module.exports = {
  // Catalog value of a copy, its value on the market (real sales nudge it) and what the bank pays.
  cardValues(row) {
    const base = C.valueOf({ card: row.card, finish: row.finish, wear: row.wear, grade: row.grade || null, black: !!row.black });
    const factor = this.marketFactor('card', row.card);
    return { base, factor, value: Math.max(1, Math.round(base * factor)), buyback: this.bankPay(Math.round(base * Math.min(1, factor)), this.cfg.cardBuyback ?? 0.6) };
  },

  cardsClosed() {
    return this.cfg.cardsEnabled === false ? 'trading cards are switched off right now.' : null;
  },

  cardPackPrice(pack) {
    return Math.max(1, Math.round(pack.price * (this.cfg.cardPackPriceMultiplier ?? 1)));
  },

  // What a stored card looks like on the website.
  cardView(row) {
    const c = C.CARDS[row.card];
    if (!c) return null;
    const set = C.SET_BY_ID[c.set];
    const r = C.RARITIES[c.rarity];
    const grade = row.grade || null;
    const copy = { card: row.card, finish: row.finish, wear: row.wear, grade, black: !!row.black };
    const { value, base, factor, buyback } = this.cardValues(row);
    const cond = C.conditionOf(row.wear);
    return {
      id: row.id,
      card: row.card,
      name: c.name,
      icon: c.icon,
      flavor: c.flavor,
      element: c.element,
      power: c.power,
      hp: c.hp,
      set: c.set,
      setName: set.name,
      setIcon: set.icon,
      setColor: set.color,
      num: c.num,
      setSize: set.size,
      rarity: c.rarity,
      rarityName: r.name,
      rarityRank: r.rank,
      finish: row.finish,
      wear: row.wear,
      condition: cond.name,
      conditionShort: cond.short,
      serial: row.serial,
      grade,
      black: !!row.black,
      gradeLabel: grade ? (row.black ? C.BLACK_LABEL.name : C.GRADES[grade].name) : null,
      sub: row.sub ? JSON.parse(row.sub) : null,
      value,
      baseValue: base,
      marketFactor: factor,
      buyback,
      gradeFee: grade ? null : C.gradeFee(copy),
      status: row.status,
      price: row.price ?? null,
      owner: row.owner,
      ownerId: row.owner_id,
      createdAt: row.created_at,
      gradedAt: row.graded_at || null,
    };
  },

  cardCatalog() {
    return {
      rarities: C.RARITIES,
      finishes: C.FINISHES,
      elements: C.ELEMENTS,
      conditions: C.CONDITIONS.map(({ name, short, max, mult }) => ({ name, short, max: Math.min(1, max), mult })),
      grades: C.GRADES,
      blackLabel: C.BLACK_LABEL,
      holoChance: C.HOLO_CHANCE,
      goldChance: C.GOLD_CHANCE,
      buyback: this.cfg.cardBuyback ?? 0.6,
      bankDailyLimit: this.cfg.bankDailyLimit ?? 25000,
      bankFullValue: this.cfg.bankFullValue ?? 5000,
      fee: this.cfg.marketFee ?? 0.05,
      sets: C.SETS.map((s) => ({ id: s.id, name: s.name, icon: s.icon, color: s.color, size: s.size, title: s.title, reward: s.reward, cards: s.cards.map((id) => ({ ...C.CARDS[id] })) })),
      packs: C.PACKS.map((p) => {
        const price = this.cardPackPrice(p);
        const odds = {};
        for (const slot of p.slots) for (const [r, w] of Object.entries(slot)) odds[r] = (odds[r] || 0) + w;
        return { id: p.id, name: p.name, icon: p.icon, color: p.color, tier: p.tier, sets: p.sets, cards: p.slots.length, price, ev: C.packEv(p), odds, slots: p.slots };
      }),
    };
  },

  // Collection value and set progress for one player.
  cardCollection(userId) {
    const owner = this.repo.getUser(userId)?.username;
    const cards = this.repo.cardsOf(userId).map((r) => this.cardView({ ...r, owner }));
    const owned = new Set(cards.map((c) => c.card));
    const claimed = this.repo.getSetting(`cardsets:${userId}`) || [];
    return {
      cards,
      value: cards.reduce((s, c) => s + c.value, 0),
      sets: C.SETS.map((s) => ({ id: s.id, name: s.name, icon: s.icon, size: s.size, have: s.cards.filter((id) => owned.has(id)).length, done: claimed.includes(s.id), title: s.title, reward: s.reward })),
      owned: [...owned],
    };
  },

  cardTitles(userId) {
    const claimed = this.repo.getSetting(`cardsets:${userId}`) || [];
    return C.SETS.filter((s) => claimed.includes(s.id)).map((s) => s.title);
  },

  // Owning every card in a set (any condition) pays its reward and title once.
  cardCheckSets(user) {
    const claimed = this.repo.getSetting(`cardsets:${user.id}`) || [];
    const owned = new Set(this.repo.cardsOf(user.id).map((r) => r.card));
    const done = [];
    for (const s of C.SETS) {
      if (claimed.includes(s.id) || !s.cards.every((id) => owned.has(id))) continue;
      claimed.push(s.id);
      done.push(s);
    }
    if (!done.length) return [];
    this.repo.transaction(() => {
      this.repo.setSetting(`cardsets:${user.id}`, claimed);
      for (const s of done) this.repo.addPoints(user.id, s.reward);
    });
    for (const s of done) {
      this.track('rewards', s.reward);
      this.notify(user.id, `🃏 You completed the ${s.icon} ${s.name} card set! +${fmt(s.reward)} pts and the title "${s.title}".`);
      this.emitActivity(user, { kind: 'achievement', text: `completed the ${s.icon} ${s.name} card set! 🃏` });
    }
    return done.map((s) => `${s.icon} ${s.name} set complete! +${fmt(s.reward)} pts and the title "${s.title}".`);
  },

  // ---- Packs -----------------------------------------------------------------------------
  cardOpenPacks(user, packId, count = 1) {
    const closed = this.cardsClosed();
    if (closed) return { ok: false, error: closed };
    const pack = C.PACK_BY_ID[String(packId)];
    if (!pack) return { ok: false, error: 'no such pack.' };
    count = Math.floor(Number(count) || 1);
    if (count < 1 || count > MAX_PACKS_AT_ONCE) return { ok: false, error: `open 1 to ${MAX_PACKS_AT_ONCE} packs at a time.` };
    const now = this.now();
    this.lastPackAt ??= new Map();
    if (now - (this.lastPackAt.get(user.id) || 0) < 800) return { ok: false, error: 'easy! One pack at a time.' };
    const cost = this.cardPackPrice(pack) * count;
    const points = this.repo.getUser(user.id).points;
    if (points < cost) return { ok: false, error: `you need ${fmt(cost)} pts (you have ${fmt(points)}).` };
    this.lastPackAt.set(user.id, now);
    const packs = [];
    this.repo.transaction(() => {
      this.repo.addPoints(user.id, -cost);
      for (let i = 0; i < count; i++) {
        const pulls = C.openPack(pack, this.rng);
        packs.push(pulls.map((p) => this.repo.cardInsert(user.id, p, pack.id, now)));
      }
    });
    this.track('cardPacks', cost);
    for (let i = 0; i < count; i++) this.questProgress?.(user, { kind: 'pack' });
    const views = packs.map((ids) => ids.map((id) => this.cardView({ ...this.repo.cardGet(id), owner: user.username })));
    const all = views.flat();
    // Big pulls go on the feed (the best one per opening), and mythics are announced in chat.
    const best = all.filter(notable).sort((a, b) => b.value - a.value)[0];
    if (best) {
      const fin = best.finish === 'normal' ? '' : `${C.FINISHES[best.finish].name} `;
      this.emitActivity(user, { kind: 'pull', text: `pulled a ${fin}${best.rarityName} ${best.icon} ${best.name} from a ${pack.name}! 🃏` });
      if (best.rarityRank >= 5 || (best.rarityRank >= 4 && best.finish !== 'normal')) {
        this.emit('announce', `🃏 ${user.username} just pulled a ${fin}${best.rarityName} ${best.icon} ${best.name} (${fmt(best.value)} pts) from a ${pack.name}!`);
      }
    }
    const sets = this.cardCheckSets(user);
    return {
      ok: true,
      pack: { id: pack.id, name: pack.name, icon: pack.icon, color: pack.color },
      packs: views,
      cost,
      value: all.reduce((s, c) => s + c.value, 0),
      balance: this.repo.getUser(user.id).points,
      sets,
      message: `Opened ${count} ${pack.name}${count === 1 ? '' : 's'}.`,
    };
  },

  // ---- Grading ---------------------------------------------------------------------------
  cardGrade(user, cardId) {
    const closed = this.cardsClosed();
    if (closed) return { ok: false, error: closed };
    const row = this.repo.cardGet(Number(cardId));
    if (!row || row.owner_id !== user.id || row.status === 'bank') return { ok: false, error: "that's not your card." };
    if (row.grade) return { ok: false, error: 'that card is already graded.' };
    if (row.status !== 'owned') return { ok: false, error: 'take it off the market first.' };
    const copy = { card: row.card, finish: row.finish, wear: row.wear };
    const fee = C.gradeFee(copy);
    const points = this.repo.getUser(user.id).points;
    if (points < fee) return { ok: false, error: `grading this card costs ${fmt(fee)} pts (you have ${fmt(points)}).` };
    const g = C.gradeOf(row.wear, parseQ(row.q));
    const now = this.now();
    const changed = this.repo.transaction(() => {
      if (!this.repo.cardUpdate(row.id, { grade: g.grade, black: g.black ? 1 : 0, sub: JSON.stringify(g.sub), graded_at: now })) return false;
      this.repo.addPoints(user.id, -fee);
      return true;
    });
    if (!changed) return { ok: false, error: 'that card is gone.' };
    this.track('cardGrading', fee);
    const view = this.cardView({ ...this.repo.cardGet(row.id), owner: user.username });
    if (g.grade === 10 && view.rarityRank >= 2) {
      this.emitActivity(user, { kind: 'pull', text: `got a ${g.black ? 'PRISTINE 10 BLACK LABEL' : 'GEM MINT 10'} on ${view.icon} ${view.name}! 💎` });
      if (g.black && view.rarityRank >= 3) this.emit('announce', `💎 ${user.username} graded a PRISTINE 10 BLACK LABEL ${view.icon} ${view.name}!`);
    }
    const raw = C.valueOf(copy);
    return {
      ok: true,
      card: view,
      fee,
      rawValue: raw,
      balance: this.repo.getUser(user.id).points,
      message: `${view.icon} ${view.name} graded ${g.black ? 'PRISTINE 10 (black label)' : `${C.GRADES[g.grade].name} ${g.grade}`}: now worth ${fmt(view.value)} pts (was ${fmt(raw)}).`,
    };
  },

  // ---- Selling back to the bank ----------------------------------------------------------
  cardSellBack(user, ids) {
    const closed = this.cardsClosed();
    if (closed) return { ok: false, error: closed };
    ids = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean))].slice(0, 200);
    if (!ids.length) return { ok: false, error: 'pick some cards to sell.' };
    let result = { sold: [], total: 0, skipped: 0 };
    this.repo.transaction(() => {
      const items = [];
      for (const id of ids) {
        const row = this.repo.cardGet(id);
        if (!row || row.owner_id !== user.id || row.status !== 'owned') continue;
        items.push({ id, pay: this.cardValues(row).buyback });
      }
      result = this.bankTake(user.id, items, (id) => this.repo.cardUpdate(id, { status: 'bank' }));
    });
    const { sold, total, skipped } = result;
    const note = this.bankLimitNote(user.id, skipped);
    if (!sold.length) return { ok: false, error: skipped ? this.bankLimitError(user.id, skipped) : 'none of those cards can be sold (on the market, or not yours).' };
    this.track('cardBuyback', total);
    const n = sold.length;
    return { ok: true, sold: n, soldIds: sold, skipped, points: total, balance: this.repo.getUser(user.id).points, message: `Sold ${n} card${n === 1 ? '' : 's'} to the bank for ${fmt(total)} pts.${note}` };
  },

  // ---- Card market -------------------------------------------------------------------------
  cardMaxPrice(view) {
    return Math.max(1000, view.value * 20);
  },

  cardListings() {
    return this.repo.cardListings().map((r) => this.cardView(r));
  },

  cardList(user, cardId, price) {
    const closed = this.cardsClosed() || this.marketBlocked(user.id);
    if (closed) return { ok: false, error: closed };
    const row = this.repo.cardGet(Number(cardId));
    if (!row || row.owner_id !== user.id || row.status !== 'owned') return { ok: false, error: "that card can't be listed." };
    price = Math.floor(Number(price));
    if (!(price >= 1)) return { ok: false, error: 'set a price of at least 1 point.' };
    const view = this.cardView(row);
    const max = this.cardMaxPrice(view);
    if (price > max) return { ok: false, error: `that's too expensive: at most ${fmt(max)} pts for this card.` };
    if (this.repo.cardListingCount(user.id) >= MAX_LISTINGS) return { ok: false, error: `you can list ${MAX_LISTINGS} cards at once.` };
    this.repo.cardUpdate(row.id, { status: 'listed', price, listed_at: this.now() });
    return { ok: true, message: `Listed ${view.icon} ${view.name} for ${fmt(price)} pts.` };
  },

  cardUnlist(user, cardId) {
    const row = this.repo.cardGet(Number(cardId));
    if (!row || row.owner_id !== user.id || row.status !== 'listed') return { ok: false, error: 'not your listing.' };
    this.repo.cardUpdate(row.id, { status: 'owned', price: null, listed_at: null });
    return { ok: true, message: `${C.CARDS[row.card].name} is back in your collection.` };
  },

  cardBuy(user, cardId) {
    const closed = this.cardsClosed() || this.marketBlocked(user.id);
    if (closed) return { ok: false, error: closed };
    const row = this.repo.cardGet(Number(cardId));
    if (!row || row.status !== 'listed') return { ok: false, error: 'that card is gone (someone may have bought it).' };
    if (row.owner_id === user.id) return { ok: false, error: "that's your own listing. Take it down instead." };
    const view = this.cardView(row);
    const price = row.price;
    if (this.repo.getUser(user.id).points < price) return { ok: false, error: `you need ${fmt(price)} pts.` };
    // Paying far over the card's value counts as passing points to the seller.
    const excess = Math.max(0, price - 2 * view.value);
    const capped = this.giftAllowanceError(user.id, excess);
    if (capped) return { ok: false, error: `this card costs much more than it's worth, and ${capped}` };
    const fee = Math.floor(price * (this.cfg.marketFee ?? 0.05));
    const sellerId = row.owner_id;
    const ok = this.repo.transaction(() => {
      const fresh = this.repo.cardGet(row.id);
      if (fresh.status !== 'listed' || fresh.owner_id !== sellerId || fresh.price !== price) return false;
      this.repo.cardUpdate(row.id, { owner_id: user.id, status: 'owned', price: null, listed_at: null });
      this.repo.addPoints(user.id, -price);
      this.repo.addPoints(sellerId, price - fee);
      return true;
    });
    if (!ok) return { ok: false, error: 'that card is gone.' };
    this.recordSale('card', row.card, price, view.baseValue, user.id, sellerId);
    this.spendGiftAllowance(user.id, excess);
    this.track('traded', price);
    this.track('fees', fee);
    this.notify(sellerId, `🃏 ${user.username} bought your ${view.icon} ${view.name} for ${fmt(price)} pts (you got ${fmt(price - fee)} after the fee).`);
    this.emitActivity(user, { kind: 'trade', text: `bought a ${view.rarityName} ${view.icon} ${view.name} card for ${fmt(price)} pts` });
    const sets = this.cardCheckSets(user);
    return { ok: true, sets, message: `Bought ${view.icon} ${view.name} for ${fmt(price)} pts!` };
  },

  // ---- Trades between players --------------------------------------------------------------
  cardTradeView(t, viewerId) {
    const cards = (ids) => ids.map((id) => this.repo.cardGet(id)).filter(Boolean).map((r) => this.cardView(r));
    const give = cards(JSON.parse(t.give));
    const want = cards(JSON.parse(t.want));
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
      valueGive: give.reduce((s, c) => s + c.value, 0) + t.points_give,
      valueWant: want.reduce((s, c) => s + c.value, 0) + t.points_want,
    };
  },

  cardTrades(userId) {
    this.repo.cardTradesExpire(this.now() - TRADE_DAYS * 86_400_000, this.now());
    return this.repo.cardTradesFor(userId).map((t) => this.cardTradeView(t, userId));
  },

  // Checks both sides still have what the trade needs. Returns an error or null.
  cardTradeCheck(fromId, toId, give, want, pointsGive, pointsWant) {
    for (const [ids, owner, who] of [[give, fromId, 'you'], [want, toId, 'they']]) {
      for (const id of ids) {
        const r = this.repo.cardGet(id);
        if (!r || r.owner_id !== owner || r.status === 'bank') return `${who} no longer have one of those cards.`;
        if (r.status !== 'owned') return `one of those cards is on the market; take it down first.`;
      }
    }
    if (this.repo.getUser(fromId).points < pointsGive) return 'the offer is short of points.';
    if (this.repo.getUser(toId).points < pointsWant) return "there aren't enough points on the other side.";
    return null;
  },

  // Card values count like points for the daily gift limit: sending far more than you get back
  // uses up your allowance, so trades can't funnel value between accounts.
  cardTradeExcess(give, want, pointsGive, pointsWant) {
    const val = (ids) => ids.reduce((s, id) => s + this.cardView(this.repo.cardGet(id)).value, 0);
    const a = val(give) + pointsGive;
    const b = val(want) + pointsWant;
    return { from: Math.max(0, a - 2 * b), to: Math.max(0, b - 2 * a) };
  },

  cardTradeOffer(user, { to, give = [], want = [], pointsGive = 0, pointsWant = 0, message = '' } = {}) {
    const closed = this.cardsClosed() || this.marketBlocked(user.id);
    if (closed) return { ok: false, error: closed };
    const target = this.repo.getUserByName(String(to || ''));
    if (!target || target.banned) return { ok: false, error: 'no player by that name.' };
    if (target.id === user.id) return { ok: false, error: "you can't trade with yourself." };
    const theirs = this.marketBlocked(target.id);
    if (theirs) return { ok: false, error: `${target.username} can't trade yet.` };
    const ids = (a) => [...new Set((Array.isArray(a) ? a : []).map(Number).filter(Boolean))];
    give = ids(give);
    want = ids(want);
    pointsGive = Math.max(0, Math.floor(Number(pointsGive) || 0));
    pointsWant = Math.max(0, Math.floor(Number(pointsWant) || 0));
    if (!give.length && !want.length) return { ok: false, error: 'pick at least one card.' };
    if (give.length > MAX_TRADE_CARDS || want.length > MAX_TRADE_CARDS) return { ok: false, error: `up to ${MAX_TRADE_CARDS} cards each way.` };
    if (this.repo.cardTradesOpenFrom(user.id) >= MAX_OPEN_TRADES) return { ok: false, error: `you have ${MAX_OPEN_TRADES} open offers. Cancel one first.` };
    const bad = this.cardTradeCheck(user.id, target.id, give, want, pointsGive, pointsWant);
    if (bad) return { ok: false, error: bad };
    const ex = this.cardTradeExcess(give, want, pointsGive, pointsWant);
    const capped = this.giftAllowanceError(user.id, ex.from);
    if (capped) return { ok: false, error: `this offer gives away much more than it gets back, and ${capped}` };
    const id = this.repo.cardTradeAdd({ fromId: user.id, toId: target.id, give, want, pointsGive, pointsWant, message: String(message || '').slice(0, 140) }, this.now());
    this.notify(target.id, `🤝 ${user.username} sent you a card trade offer. See it on the Cards page → Trades.`);
    return { ok: true, id, message: `Trade offer sent to ${target.username}.` };
  },

  cardTradeAccept(user, tradeId) {
    const closed = this.cardsClosed() || this.marketBlocked(user.id);
    if (closed) return { ok: false, error: closed };
    this.repo.cardTradesExpire(this.now() - TRADE_DAYS * 86_400_000, this.now());
    const t = this.repo.cardTradeGet(Number(tradeId));
    if (!t || t.to_id !== user.id) return { ok: false, error: 'no such offer.' };
    if (t.status !== 'open') return { ok: false, error: `that offer is ${t.status}.` };
    const give = JSON.parse(t.give);
    const want = JSON.parse(t.want);
    const bad = this.cardTradeCheck(t.from_id, t.to_id, give, want, t.points_give, t.points_want);
    if (bad) {
      this.repo.cardTradeSet(t.id, 'cancelled', this.now());
      return { ok: false, error: `this offer can't go through any more (${bad.replace(/^you /, 'they ').replace(/^they no/, 'someone no')}). It has been cancelled.` };
    }
    const ex = this.cardTradeExcess(give, want, t.points_give, t.points_want);
    const capA = this.giftAllowanceError(t.from_id, ex.from);
    if (capA) return { ok: false, error: `the other player's side is over their daily gift limit: ${capA}` };
    const capB = this.giftAllowanceError(user.id, ex.to);
    if (capB) return { ok: false, error: `you'd be giving much more than you get, and ${capB}` };
    const now = this.now();
    const ok = this.repo.transaction(() => {
      if (!this.repo.cardTradeSet(t.id, 'accepted', now)) return false;
      for (const id of give) this.repo.cardUpdate(id, { owner_id: t.to_id });
      for (const id of want) this.repo.cardUpdate(id, { owner_id: t.from_id });
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
    this.spendGiftAllowance(t.from_id, ex.from);
    this.spendGiftAllowance(user.id, ex.to);
    const from = this.repo.getUser(t.from_id);
    this.notify(t.from_id, `🤝 ${user.username} accepted your card trade.`);
    this.emitActivity(user, { kind: 'trade', text: `traded cards with ${from.username} 🤝` });
    const sets = [...this.cardCheckSets(user), ...this.cardCheckSets(from)];
    return { ok: true, sets, message: `Trade done with ${from.username}!` };
  },

  cardTradeClose(user, tradeId, how) {
    const t = this.repo.cardTradeGet(Number(tradeId));
    const mine = how === 'cancelled' ? t?.from_id === user.id : t?.to_id === user.id;
    if (!t || !mine) return { ok: false, error: 'no such offer.' };
    if (!this.repo.cardTradeSet(t.id, how, this.now())) return { ok: false, error: `that offer is already ${t.status}.` };
    if (how === 'declined') this.notify(t.from_id, `🤝 ${user.username} declined your card trade.`);
    return { ok: true, message: how === 'cancelled' ? 'Offer cancelled.' : 'Offer declined.' };
  },

  // ---- Public views --------------------------------------------------------------------------
  cardPulls() {
    const rows = this.repo.cardRecent(400).filter(notable).slice(0, 24);
    return rows.map((r) => this.cardView(r));
  },

  cardRecentGrades() {
    return this.repo.cardRecentGraded(16).map((r) => this.cardView(r));
  },

  // Population report for one card: how many were pulled and graded at each grade.
  cardPopulation(cardId) {
    if (!C.CARDS[cardId]) return null;
    const pop = {};
    let graded = 0;
    for (const r of this.repo.cardPop(cardId)) {
      const k = r.black ? 'black' : String(r.grade);
      pop[k] = (pop[k] || 0) + r.n;
      graded += r.n;
    }
    return { card: cardId, pulled: this.repo.cardPulled(cardId), graded, pop };
  },

  // Top collections by value (cached for a minute).
  cardTopCollectors(limit = 10) {
    const now = this.now();
    if (this.cardTopCache && now - this.cardTopCache.at < 60_000) return this.cardTopCache.list.slice(0, limit);
    const by = new Map();
    for (const r of this.repo.cardsActive()) {
      const e = by.get(r.owner_id) || { username: r.username, value: 0, cards: 0, best: null };
      const v = this.cardValues(r).value;
      e.value += v;
      e.cards++;
      if (!e.best || v > e.best.value) e.best = { name: C.CARDS[r.card].name, icon: C.CARDS[r.card].icon, value: v };
      by.set(r.owner_id, e);
    }
    const list = [...by.values()].sort((a, b) => b.value - a.value).slice(0, 50);
    this.cardTopCache = { at: now, list };
    return list.slice(0, limit);
  },

  // Another player's collection (for trade offers and profiles).
  cardPlayer(name) {
    const u = this.repo.getUserByName(String(name || ''));
    if (!u || u.banned) return null;
    return { username: u.username, ...this.cardCollection(u.id) };
  },

  // !cards
  cardsInfo(user, args = []) {
    if (this.cardsClosed()) return this.cardsClosed();
    const [sub = '', ...rest] = args.map((w) => String(w).toLowerCase());
    if (sub === 'packs') {
      const cheapest = [...C.PACKS].sort((a, b) => a.price - b.price).slice(0, 6);
      return `🃏 packs: ${cheapest.map((x) => `${x.icon} ${x.name} ${fmt(this.cardPackPrice(x))}`).join(' · ')}… all ${C.PACKS.length} at ${this.siteUrl}/#/cards. ${this.cfg.prefix}cards open <pack> [count]`;
    }
    if (sub === 'open') {
      const { pick, count } = pickByWords(C.PACKS, rest, MAX_PACKS_AT_ONCE);
      if (!pick) return `which pack? e.g. ${this.cfg.prefix}cards open ${C.PACKS[0].name.toLowerCase()} (${this.cfg.prefix}cards packs lists them)`;
      const r = this.cardOpenPacks(user, pick.id, count);
      if (!r.ok) return r.error;
      const all = r.packs.flat();
      const best = all.reduce((a, b) => (b.value > a.value ? b : a));
      const fin = best.finish === 'normal' ? '' : `${C.FINISHES[best.finish].name} `;
      return `🃏 opened ${count} ${pick.name}${count === 1 ? '' : 's'} (-${fmt(r.cost)}): ${all.length} cards worth ${fmt(r.value)} pts. Best: ${fin}${best.rarityName} ${best.icon} ${best.name} (${fmt(best.value)}).${r.sets.length ? ` ${r.sets.join(' ')}` : ''} See them: ${this.siteUrl}/#/cards`;
    }
    const col = this.cardCollection(user.id);
    const url = `${this.siteUrl}/#/cards`;
    if (!col.cards.length) return `🃏 open fantasy creature card packs with your points, grade your best pulls and trade them: ${url}`;
    const best = col.cards.reduce((a, b) => (b.value > a.value ? b : a));
    const grade = best.grade ? ` ${best.black ? 'PRISTINE 10' : `graded ${best.grade}`}` : '';
    return `🃏 ${col.cards.length} card${col.cards.length === 1 ? '' : 's'} worth ${fmt(col.value)} pts · best: ${best.icon} ${best.name}${grade} (${fmt(best.value)}). Packs, grading and trades: ${url}`;
  },
};
