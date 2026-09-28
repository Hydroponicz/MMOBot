// Trading cards: packs, wear, grading, selling back, the card market, trades and set rewards.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');
const C = require('../src/game/cards');

function setup({ game = {}, rng = Math.random } = {}) {
  const repo = openDb(':memory:');
  let t = 1_000_000_000;
  const config = { baseUrl: 'http://localhost', game: { prefix: '!', staminaMax: 100, racePerks: false, petDropMultiplier: 0, chatPoints: 0, replyInChat: true, tradeMinHours: 0, tradeMinActions: 0, ...game } };
  const engine = new GameEngine({ repo, config, rng, now: () => t });
  engine.cfg.tradeMinHours = 0;
  engine.cfg.tradeMinActions = 0;
  const a = repo.upsertUser({ kickUserId: '1', username: 'Alice' });
  const b = repo.upsertUser({ kickUserId: '2', username: 'Bob' });
  return { repo, engine, a, b, wait: (ms = 1000) => (t += ms) };
}

test('catalog: three sets of 30, every rarity in every set, packs reference real rarities', () => {
  assert.equal(C.SETS.length, 3);
  for (const s of C.SETS) {
    assert.equal(s.size, 30);
    for (const r of C.RARITY_IDS) assert.ok(s.cards.some((id) => C.CARDS[id].rarity === r), `${s.name} has a ${r}`);
  }
  for (const p of C.PACKS) {
    for (const slot of p.slots) {
      const sum = Object.values(slot).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `${p.id} slot odds add up to 1`);
    }
    // Packs are a points sink: on average they return less than they cost.
    assert.ok(C.packEv(p) < p.price && C.packEv(p) > p.price * 0.6, `${p.id} EV ${C.packEv(p)} vs ${p.price}`);
  }
});

test('wear, condition and grading: lower wear grades better; grading is deterministic', () => {
  const q = [0.1, 0.1, 0.5, 0.5, 0.5, 0.1, 0.1, 0.1];
  assert.equal(C.conditionOf(0.01).name, 'Pristine');
  assert.equal(C.conditionOf(0.1).name, 'Near Mint');
  assert.equal(C.conditionOf(0.9).name, 'Damaged');
  const clean = C.gradeOf(0.005, q);
  const worn = C.gradeOf(0.4, q);
  assert.ok(clean.grade >= 9 && worn.grade <= 5, `${clean.grade} vs ${worn.grade}`);
  assert.deepEqual(C.gradeOf(0.005, q), clean);
  const perfect = C.gradeOf(0, [0, 0, 0.5, 0.5, 0.5, 0, 0, 0]);
  assert.equal(perfect.black, true);
  assert.equal(perfect.label, 'PRISTINE');
  // Value: finish and grade multiply the base.
  const base = { card: 'wildlands-29', finish: 'normal', wear: 0.1 };
  assert.equal(C.valueOf({ ...base, finish: 'holo' }), C.valueOf(base) * 3);
  assert.ok(C.valueOf({ ...base, grade: 10 }) > C.valueOf({ ...base, grade: 9 }));
  assert.ok(C.valueOf({ ...base, grade: 10, black: true }) > C.valueOf({ ...base, grade: 10 }));
  // Grade distribution from fresh packs: 10s are rare, most cards land 7-9.
  let tens = 0;
  let mid = 0;
  const N = 20000;
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < N; i++) {
    const c = C.rollCard(C.PACKS[0], { common: 1 }, rng);
    const g = C.gradeOf(c.wear, c.q).grade;
    if (g === 10) tens++;
    if (g >= 7 && g <= 9) mid++;
  }
  assert.ok(tens / N > 0.01 && tens / N < 0.06, `10s: ${tens / N}`);
  assert.ok(mid / N > 0.6, `7-9: ${mid / N}`);
});

test('opening packs costs points, stores each copy with its own wear and serial', () => {
  const { repo, engine, a, wait } = setup();
  assert.match(engine.cardOpenPacks(a, 'wildlands-booster').error, /you need 1,000 pts/);
  repo.addPoints(a.id, 10_000);
  const r = engine.cardOpenPacks(a, 'wildlands-booster', 2);
  assert.equal(r.ok, true);
  assert.equal(r.cost, 2000);
  assert.equal(r.packs.length, 2);
  assert.equal(r.packs[0].length, 5);
  assert.equal(repo.getUser(a.id).points, 8000);
  for (const c of r.packs.flat()) {
    assert.equal(c.set, 'wildlands');
    assert.ok(c.wear >= 0 && c.wear < 1);
    assert.ok(c.serial >= 1);
    assert.equal(c.owner, 'Alice');
    assert.equal(c.q, undefined, 'hidden quirks never reach the website');
  }
  assert.ok(r.packs[0].slice(0, 3).every((c) => ['common', 'uncommon'].includes(c.rarity)));
  assert.ok(C.RARITIES[r.packs[0][4].rarity].rank >= 2, 'the last card is rare or better');
  assert.equal(engine.cardOpenPacks(a, 'wildlands-booster').error, 'easy! One pack at a time.');
  wait();
  assert.equal(engine.cardOpenPacks(a, 'nope').error, 'no such pack.');
  assert.match(engine.cardOpenPacks(a, 'wildlands-scout', 11).error, /1 to 10/);
  // Serials count up per card.
  const serials = {};
  for (const c of engine.cardCollection(a.id).cards) (serials[c.card] ||= []).push(c.serial);
  for (const s of Object.values(serials)) assert.deepEqual([...s].sort((x, y) => x - y), s.map((_, i) => i + 1).sort((x, y) => x - y));
});

test('grading charges a fee, is final, and the pop report counts it', () => {
  const { repo, engine, a } = setup();
  repo.addPoints(a.id, 100_000);
  const card = engine.cardOpenPacks(a, 'vault').packs[0][2];
  const before = repo.getUser(a.id).points;
  const g = engine.cardGrade(a, card.id);
  assert.equal(g.ok, true);
  assert.equal(repo.getUser(a.id).points, before - card.gradeFee);
  assert.ok(g.card.grade >= 1 && g.card.grade <= 10);
  assert.equal(Object.keys(g.card.sub).join(), 'centering,corners,edges,surface');
  assert.match(g.message, /graded/);
  assert.equal(engine.cardGrade(a, card.id).error, 'that card is already graded.');
  assert.equal(engine.cardPopulation(card.card).graded, 1);
  assert.equal(engine.cardGrade(a, 999).error, "that's not your card.");
});

test('selling back to the bank pays the buyback rate', () => {
  const { repo, engine, a, b } = setup();
  repo.addPoints(a.id, 1000);
  const cards = engine.cardOpenPacks(a, 'wildlands-booster').packs[0];
  const want = cards.slice(0, 3).reduce((s, c) => s + Math.floor(c.value * 0.6), 0);
  const r = engine.cardSellBack(a, cards.slice(0, 3).map((c) => c.id));
  assert.equal(r.points, want);
  assert.equal(repo.getUser(a.id).points, want);
  assert.equal(engine.cardCollection(a.id).cards.length, 2);
  assert.equal(engine.cardSellBack(b, [cards[3].id]).ok, false, "can't sell someone else's card");
  assert.equal(engine.cardSellBack(a, [cards[0].id]).ok, false, 'already sold');
});

test('card market: list, buy with the fee, cancel; price limits and ownership', () => {
  const { repo, engine, a, b } = setup();
  repo.addPoints(a.id, 1000);
  repo.addPoints(b.id, 5000);
  const card = engine.cardOpenPacks(a, 'wildlands-booster').packs[0][4];
  assert.match(engine.cardList(a, card.id, 10_000_000).error, /too expensive/);
  assert.equal(engine.cardList(b, card.id, 100).ok, false);
  assert.equal(engine.cardList(a, card.id, 500).ok, true);
  assert.equal(engine.cardSellBack(a, [card.id]).ok, false, 'listed cards stay on the market');
  assert.equal(engine.cardGrade(a, card.id).error, 'take it off the market first.');
  assert.equal(engine.cardListings().length, 1);
  assert.match(engine.cardBuy(a, card.id).error, /your own listing/);
  const aBefore = repo.getUser(a.id).points;
  assert.equal(engine.cardBuy(b, card.id).ok, true);
  assert.equal(repo.getUser(b.id).points, 4500);
  assert.equal(repo.getUser(a.id).points, aBefore + 475, '5% fee');
  assert.equal(repo.cardGet(card.id).owner_id, b.id);
  assert.match(engine.cardBuy(b, card.id).error, /gone/);
  assert.equal(engine.cardList(b, card.id, 600).ok, true);
  assert.equal(engine.cardUnlist(b, card.id).ok, true);
  assert.equal(repo.cardGet(card.id).status, 'owned');
});

test('card market respects the trading switch and the new-player wait', () => {
  const { repo, engine, a } = setup();
  repo.addPoints(a.id, 1000);
  const card = engine.cardOpenPacks(a, 'wildlands-booster').packs[0][0];
  // New players are told exactly what's left before they can sell.
  engine.cfg.tradeMinActions = 20;
  engine.cfg.tradeMinHours = 24;
  const st = engine.marketStatus(a.id);
  assert.equal(st.blocked, true);
  assert.equal(st.actions, 0);
  assert.equal(st.needActions, 20);
  assert.ok(st.hoursLeft > 23);
  assert.match(engine.cardList(a, card.id, 100).error, /new players can't buy, sell or trade with other players yet\. To unlock it: do 20 more game actions in chat, like !fish or !mine \(0\/20 done\), and wait about 24 more hours/);
  engine.cfg.tradeMinActions = 0;
  engine.cfg.tradeMinHours = 0;
  assert.equal(engine.marketStatus(a.id).blocked, false);
  engine.cfg.tradingEnabled = false;
  assert.match(engine.cardList(a, card.id, 100).error, /trading is switched off/);
  engine.cfg.tradingEnabled = true;
  engine.cfg.cardsEnabled = false;
  assert.match(engine.cardOpenPacks(a, 'wildlands-booster').error, /switched off/);
});

test('trades: offer, accept swaps cards and points; stale offers are cancelled', () => {
  const { repo, engine, a, b, wait } = setup();
  repo.addPoints(a.id, 1050);
  repo.addPoints(b.id, 1000);
  const ac = engine.cardOpenPacks(a, 'wildlands-booster').packs[0];
  wait();
  const bc = engine.cardOpenPacks(b, 'emberforge-booster').packs[0];
  assert.match(engine.cardTradeOffer(a, { to: 'Alice', give: [ac[0].id] }).error, /yourself/);
  assert.match(engine.cardTradeOffer(a, { to: 'Bob', give: [bc[0].id] }).error, /no longer have/);
  assert.match(engine.cardTradeOffer(a, { to: 'Bob' }).error, /at least one card/);
  const off = engine.cardTradeOffer(a, { to: 'bob', give: [ac[0].id, ac[1].id], want: [bc[4].id], pointsGive: 50, message: 'deal?' });
  assert.equal(off.ok, true);
  const [t] = engine.cardTrades(b.id);
  assert.equal(t.incoming, true);
  assert.equal(t.give.length, 2);
  assert.equal(t.message, 'deal?');
  assert.match(engine.cardTradeAccept(a, off.id).error, /no such offer/, 'only the receiver accepts');
  const r = engine.cardTradeAccept(b, off.id);
  assert.equal(r.ok, true, r.error);
  assert.equal(repo.cardGet(ac[0].id).owner_id, b.id);
  assert.equal(repo.cardGet(bc[4].id).owner_id, a.id);
  assert.equal(repo.getUser(b.id).points, 50);
  assert.match(engine.cardTradeAccept(b, off.id).error, /accepted/);

  // An offer whose card was sold since can't go through.
  const off2 = engine.cardTradeOffer(a, { to: 'Bob', give: [ac[2].id] });
  engine.cardSellBack(a, [ac[2].id]);
  assert.match(engine.cardTradeAccept(b, off2.id).error, /cancelled/);
  // Decline and cancel.
  const off3 = engine.cardTradeOffer(a, { to: 'Bob', give: [ac[3].id] });
  assert.equal(engine.cardTradeClose(b, off3.id, 'declined').ok, true);
  const off4 = engine.cardTradeOffer(a, { to: 'Bob', give: [ac[3].id] });
  assert.equal(engine.cardTradeClose(b, off4.id, 'cancelled').ok, false, 'only the sender cancels');
  assert.equal(engine.cardTradeClose(a, off4.id, 'cancelled').ok, true);
});

test('lopsided trades count against the daily gift limit', () => {
  const { repo, engine, a, b } = setup({ game: { tradeDailyPoints: 100 } });
  engine.cfg.tradeDailyPoints = 100;
  repo.addPoints(a.id, 20_000);
  const vault = engine.cardOpenPacks(a, 'vault').packs[0];
  assert.match(engine.cardTradeOffer(a, { to: 'Bob', give: [vault[2].id] }).error, /daily limit/);
});

test('owning every card in a set pays its reward and title once', () => {
  const { repo, engine, a } = setup();
  const set = C.SETS[0];
  for (const id of set.cards) repo.cardInsert(a.id, { card: id, finish: 'normal', wear: 0.1, q: [0, 0, 0, 0, 0, 0, 0, 0] }, 'test', 1);
  const msgs = engine.cardCheckSets(a);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /Wildlands set complete! \+15,000 pts/);
  assert.equal(repo.getUser(a.id).points, 15_000);
  assert.deepEqual(engine.cardCheckSets(a), []);
  assert.ok(engine.titles(a.id).includes('the Beastmaster'));
  assert.equal(engine.cardCollection(a.id).sets[0].done, true);
});

test('!cards in chat, top collectors, recent pulls, admin reset and undo', () => {
  const { repo, engine, a } = setup();
  assert.match(engine.handleChat({ kickUserId: '1', username: 'Alice', content: '!cards' }).reply, /open fantasy creature card packs/);
  repo.addPoints(a.id, 20_000);
  engine.cardOpenPacks(a, 'vault');
  assert.match(engine.handleChat({ kickUserId: '1', username: 'Alice', content: '!cards' }).reply, /3 cards worth .* pts · best: .*#\/cards/);
  assert.equal(engine.cardTopCollectors()[0].username, 'Alice');
  assert.ok(engine.cardPulls().length >= 1, 'vault pulls are always notable');
  const snap = repo.snapshotPlayer(a.id);
  repo.resetPlayer(a.id);
  assert.equal(engine.cardCollection(a.id).cards.length, 0);
  repo.restorePlayer(a.id, snap);
  assert.equal(engine.cardCollection(a.id).cards.length, 3);
});
