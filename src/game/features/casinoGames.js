// GameEngine methods: casinoGames. Mixed into GameEngine.prototype by engine.js.
/* eslint-disable no-unused-vars */
const {
  ITEMS,
  SPELLS,
  MUSEUM,
  SKILLS,
  SKILL_IDS,
  BACKPACK_TIERS,
  SHOP,
  MAX_PLOTS,
  STARTER_PLOTS,
  GEAR_SLOTS,
  COMMAND_TO_SKILL,
  COMBAT_SKILLS,
  WEAPON_SKILL,
  TOOL_TO_SKILL,
  TOOL_ALIASES,
  maxLevel,
  maxHpFor,
  maxManaFor,
  BUFFS,
  findItem,
  weaponWords,
  levelForXp,
  progress,
  characterProgress,
  casino,
  emotes,
  fmt,
  payoutOf,
  pct,
  skillLevel,
  itemLabel,
  INFO_COMMANDS,
  SLOT_ALIASES,
  SLOT_ICONS,
  clamp,
  RATINGS,
  CROPS,
  minutesLeft,
  GATHER_HINT,
  unlockName,
} = require('./shared');

module.exports = {
  // ---- Casino ------------------------------------------------------------------
  // Every game returns a result object (used by the website) with ok/error; the chat* wrappers turn
  // it into one line of chat.

  // Validates a bet: casino open, cooldown, min/max, balance. Returns { bet } or { error }.
  // cooldownMs overrides the casino cooldown (the website's plinko button can be spammed).
  takeBet(user, betArg, { cooldownMs = null } = {}) {
    const c = this.cfg;
    if (c.casinoEnabled === false) return { error: 'the casino is closed right now.' };
    const now = this.now();
    const wait = (cooldownMs ?? (c.casinoCooldown ?? 5) * 1000) - (now - (this.lastBet.get(user.id) || 0));
    if (wait > 0) {
      // Say it once per cooldown so spamming doesn't flood chat.
      const last = this.lastBet.get(user.id);
      if (this.betWarned.get(user.id) === last) return { error: '', cooldown: true };
      this.betWarned.set(user.id, last);
      return { error: `🎲 easy! Next bet in ${Math.ceil(wait / 1000)}s.`, cooldown: true };
    }
    const balance = this.repo.getUser(user.id).points;
    let bet = casino.parseBet(betArg, balance);
    if (bet === null) return { error: 'how much? e.g. 500, 1k, half or all.' };
    const max = c.casinoMaxBet || 0;
    if (max > 0 && bet > max) bet = max;
    const min = c.casinoMinBet ?? 10;
    if (bet < min) return { error: `the minimum bet is ${fmt(min)} pts${balance < min ? ` (you have ${fmt(balance)})` : ''}.` };
    if (bet > balance) return { error: `you only have ${fmt(balance)} pts.` };
    return { bet };
  },

  // Pays out: net = bet * multiplier - bet. Announces big wins to the feed/overlay.
  settleBet(user, game, bet, multiplier, what) {
    const payout = payoutOf(bet, multiplier);
    const net = payout - bet;
    this.repo.transaction(() => this.repo.addPoints(user.id, net));
    this.track('casinoWagered', bet);
    this.track('casinoPaid', payout);
    this.lastBet.set(user.id, this.now());
    if (multiplier >= 10 || net >= 10000) {
      this.emitActivity(user, { kind: 'jackpot', text: `won ${fmt(payout)} pts on ${game}${what ? ` (${what})` : ''}! 🎉` });
    }
    return { bet, multiplier, payout, net, balance: this.repo.getUser(user.id).points };
  },

  playSlots(user, betArg) {
    const b = this.takeBet(user, betArg);
    if (b.bet === undefined) return { ok: false, ...b };
    const spin = casino.spinSlots(this.rng);
    return { ok: true, game: 'slots', ...spin, ...this.settleBet(user, 'slots', b.bet, spin.multiplier, spin.line) };
  },

  playRoulette(user, choice, betArg) {
    if (!casino.rouletteBet(choice)) return { ok: false, error: 'bet on red, black, green, odd, even, low, high, 1st/2nd/3rd (dozens) or a number 1-36.' };
    const b = this.takeBet(user, betArg);
    if (b.bet === undefined) return { ok: false, ...b };
    const spin = casino.spinRoulette(this.rng, choice);
    return { ok: true, game: 'roulette', ...spin, ...this.settleBet(user, 'roulette', b.bet, spin.multiplier, spin.win ? spin.betLabel : null) };
  },

  // One or many balls (the bet is per ball). "all", "half" and "25%" with several balls split that
  // share of your points between them. One drop counts as one bet for the cooldown.
  // fast: a website drop, which only waits plinkoDropMs between drops so the button can be spammed
  // (in chat the normal casino cooldown keeps it from flooding).
  playPlinko(user, betArg, risk, ballsArg = 1, { fast = false } = {}) {
    const r = casino.riskOf(risk || 'medium');
    if (!r) return { ok: false, error: 'risk must be low, medium, high or extreme.' };
    const maxBalls = this.cfg.plinkoMaxBalls ?? 1000;
    const balls = Math.floor(Number(ballsArg) || 1);
    if (balls < 1) return { ok: false, error: 'drop at least 1 ball.' };
    if (balls > maxBalls) return { ok: false, error: `at most ${fmt(maxBalls)} balls per drop.` };
    let arg = betArg;
    if (balls > 1 && /^(all|max|allin|half|\d+(\.\d+)?%)$/i.test(String(betArg || '').trim())) {
      const share = casino.parseBet(betArg, this.repo.getUser(user.id).points);
      arg = String(Math.floor((share || 0) / balls));
    }
    const b = this.takeBet(user, arg, fast ? { cooldownMs: this.cfg.plinkoDropMs ?? 100 } : {});
    if (b.bet === undefined) return { ok: false, ...b };
    const total = b.bet * balls;
    const balance = this.repo.getUser(user.id).points;
    if (total > balance) {
      return { ok: false, error: `${fmt(balls)} balls × ${fmt(b.bet)} = ${fmt(total)} pts, but you have ${fmt(balance)}. Try ${fmt(Math.floor(balance / b.bet))} balls or a smaller bet.` };
    }
    if (balls === 1) {
      const drop = casino.dropPlinko(this.rng, r);
      return { ok: true, game: 'plinko', rows: casino.PLINKO_ROWS, balls: [drop], ...drop, ...this.settleBet(user, 'plinko', b.bet, drop.multiplier, `${drop.multiplier}x`) };
    }
    const drops = Array.from({ length: balls }, () => casino.dropPlinko(this.rng, r));
    const payout = drops.reduce((s, d) => s + payoutOf(b.bet, d.multiplier), 0);
    const best = Math.max(...drops.map((d) => d.multiplier));
    // Settle the whole drop as one bet at its average multiplier.
    const settled = this.settleBet(user, 'plinko', total, payout / total, `${fmt(balls)} balls, best ${best}x`);
    if (best >= 10 && !(settled.multiplier >= 10 || settled.net >= 10000)) {
      this.emitActivity(user, { kind: 'jackpot', text: `hit ${best}x on plinko (${r})! 🎉` });
    }
    return { ok: true, game: 'plinko', rows: casino.PLINKO_ROWS, risk: r, balls: drops, perBall: b.bet, best, ...settled, bet: total };
  },

  // Blackjack keeps the hand in the database, so it survives restarts. The stake is taken up front.
  bjKey(userId) {
    return `bj:${userId}`;
  },

  // Hands saved before splitting existed were { stake, player, dealer, doubled }.
  bjLoad(userId) {
    const g = this.repo.getSetting(this.bjKey(userId));
    if (!g || g.hands) return g;
    return { hands: [{ cards: g.player, stake: g.stake, doubled: g.doubled }], active: 0, dealer: g.dealer };
  },

  bjView(game, balance) {
    const done = game.hands.every((h) => h.status);
    const active = done ? null : game.hands[game.active];
    const hands = game.hands.map((h, i) => ({
      cards: h.cards,
      total: casino.handTotal(h.cards),
      stake: h.stake,
      doubled: Boolean(h.doubled),
      status: h.status || (i === game.active ? 'playing' : i < game.active ? 'standing' : 'waiting'),
      payout: h.payout ?? null,
    }));
    const stake = game.hands.reduce((sum, h) => sum + h.stake, 0);
    const payout = done ? game.hands.reduce((sum, h) => sum + (h.payout || 0), 0) : null;
    const main = hands[done ? 0 : game.active];
    return {
      ok: true,
      game: 'blackjack',
      hands,
      active: done ? null : game.active,
      // The hand in play (or the only hand), for simple displays.
      player: main.cards,
      playerTotal: main.total,
      stake,
      dealer: done ? game.dealer : [game.dealer[0], null],
      dealerTotal: done ? casino.handTotal(game.dealer) : casino.handTotal([game.dealer[0]]),
      status: !done ? 'playing' : hands.length === 1 ? hands[0].status : 'split',
      canDouble: !done && active.cards.length === 2 && !active.doubled && balance >= active.stake,
      canSplit: !done && casino.canSplitCards(active.cards) && game.hands.length < casino.MAX_HANDS && balance >= active.stake,
      payout,
      net: done ? payout - stake : null,
      balance,
    };
  },

  blackjackState(user) {
    const game = this.bjLoad(user.id);
    return game ? this.bjView(game, this.repo.getUser(user.id).points) : { ok: true, game: 'blackjack', status: 'none', balance: this.repo.getUser(user.id).points };
  },

  blackjackStart(user, betArg) {
    if (this.bjLoad(user.id)) return { ...this.blackjackState(user), ok: false, error: 'finish your current hand first: !hit, !stand, !double or !split.' };
    const b = this.takeBet(user, betArg);
    if (b.bet === undefined) return { ok: false, ...b };
    const draw = () => casino.drawCard(this.rng);
    const game = { hands: [{ cards: [draw(), draw()], stake: b.bet, doubled: false }], active: 0, dealer: [draw(), draw()] };
    this.repo.transaction(() => {
      this.repo.addPoints(user.id, -b.bet);
      this.track('casinoWagered', b.bet);
      this.repo.setSetting(this.bjKey(user.id), game);
    });
    this.lastBet.set(user.id, this.now());
    if (casino.isBlackjack(game.hands[0].cards) || casino.isBlackjack(game.dealer)) return this.blackjackFinish(user, game);
    return this.bjView(game, this.repo.getUser(user.id).points);
  },

  // Moves on from the active hand; when every hand is done the dealer plays.
  bjNext(user, game) {
    let active = game.active + 1;
    // A split hand that already has 21 (or split aces) needs no decision.
    while (active < game.hands.length && game.hands[active].done) active++;
    if (active >= game.hands.length) return this.blackjackFinish(user, game);
    const next = { ...game, active };
    this.repo.setSetting(this.bjKey(user.id), next);
    return this.bjView(next, this.repo.getUser(user.id).points);
  },

  blackjackAction(user, action) {
    const game = this.bjLoad(user.id);
    if (!game) return { ok: false, error: 'no hand in play. Start one with !bj <bet>.' };
    const balance = () => this.repo.getUser(user.id).points;
    const refuse = (error) => ({ ...this.bjView(game, balance()), ok: false, error });
    const hands = game.hands.map((h) => ({ ...h, cards: [...h.cards] }));
    const hand = hands[game.active];
    const draw = () => casino.drawCard(this.rng);
    const withHands = { ...game, hands };

    if (action === 'double') {
      if (hand.cards.length !== 2 || hand.doubled) return refuse('you can only double on your first two cards.');
      if (balance() < hand.stake) return refuse(`doubling needs another ${fmt(hand.stake)} pts.`);
      this.repo.addPoints(user.id, -hand.stake);
      this.track('casinoWagered', hand.stake);
      Object.assign(hand, { stake: hand.stake * 2, doubled: true, cards: [...hand.cards, draw()] });
      return this.bjNext(user, withHands);
    }
    if (action === 'split') {
      if (!casino.canSplitCards(hand.cards)) return refuse('you can only split a pair (two cards of the same rank, like 8♠ 8♥).');
      if (hands.length >= casino.MAX_HANDS) return refuse(`you can split into at most ${casino.MAX_HANDS} hands.`);
      if (balance() < hand.stake) return refuse(`splitting needs another ${fmt(hand.stake)} pts.`);
      this.repo.addPoints(user.id, -hand.stake);
      this.track('casinoWagered', hand.stake);
      const aces = hand.cards[0].rank === 'A';
      const make = (card) => {
        const cards = [card, draw()];
        // Split aces get one card each; a split hand on 21 is done too.
        return { cards, stake: hand.stake, doubled: false, split: true, done: aces || casino.handTotal(cards) === 21 };
      };
      hands.splice(game.active, 1, make(hand.cards[0]), make(hand.cards[1]));
      if (hands[game.active].done) return this.bjNext(user, withHands);
      this.repo.setSetting(this.bjKey(user.id), withHands);
      return this.bjView(withHands, balance());
    }
    if (action === 'hit') {
      hand.cards.push(draw());
      if (casino.handTotal(hand.cards) >= 21) return this.bjNext(user, withHands);
      this.repo.setSetting(this.bjKey(user.id), withHands);
      return this.bjView(withHands, balance());
    }
    if (action === 'stand') return this.bjNext(user, withHands);
    return { ok: false, error: 'use hit, stand, double or split.' };
  },

  blackjackFinish(user, game) {
    const done = casino.settleBlackjack(game, this.rng);
    const payout = done.hands.reduce((sum, h) => sum + h.payout, 0);
    const stake = done.hands.reduce((sum, h) => sum + h.stake, 0);
    this.repo.transaction(() => {
      if (payout) this.repo.addPoints(user.id, payout);
      this.track('casinoPaid', payout);
      this.repo.deleteSetting(this.bjKey(user.id));
    });
    const bj = done.hands.some((h) => h.status === 'blackjack');
    if (bj || payout - stake >= 10000) {
      this.emitActivity(user, { kind: 'jackpot', text: `won ${fmt(payout)} pts at blackjack${bj ? ' with a BLACKJACK' : ''}! 🃏` });
    }
    return this.bjView(done, this.repo.getUser(user.id).points);
  },

  // ---- Crash ------------------------------------------------------------------------
  // Chat plays it in one go with a cash-out target (!crash 500 2x). The website runs a live round:
  // the crash point is decided at the start and kept on the server; you cash out whenever you like
  // (or at your auto target). The round is saved, so a refresh or restart doesn't lose it.
  crashKey(userId) {
    return `crash:${userId}`;
  },

  playCrash(user, betArg, targetArg) {
    const target = casino.parseTarget(targetArg ?? '2');
    if (!target) return { ok: false, error: `cash out at 1.01x to ${casino.CRASH_MAX}x, e.g. 2x.` };
    const b = this.takeBet(user, betArg);
    if (b.bet === undefined) return { ok: false, ...b };
    const crash = casino.crashPoint(this.rng);
    const win = crash >= target;
    return { ok: true, game: 'crash', crash, target, win, ...this.settleBet(user, 'crash', b.bet, win ? target : 0, win ? `${target}x` : null) };
  },

  crashStart(user, betArg, targetArg) {
    if (this.repo.getSetting(this.crashKey(user.id))) {
      const cur = this.crashState(user);
      if (cur.status === 'running') return { ...cur, ok: false, error: 'you already have a round going. Cash out first!' };
    }
    let target = null;
    if (targetArg !== undefined && targetArg !== null && targetArg !== '') {
      target = casino.parseTarget(targetArg);
      if (!target) return { ok: false, error: `auto cash-out must be 1.01x to ${casino.CRASH_MAX}x.` };
    }
    const b = this.takeBet(user, betArg);
    if (b.bet === undefined) return { ok: false, ...b };
    const round = { stake: b.bet, crash: casino.crashPoint(this.rng), startedAt: this.now(), target };
    this.repo.transaction(() => {
      this.repo.addPoints(user.id, -b.bet);
      this.track('casinoWagered', b.bet);
      this.repo.setSetting(this.crashKey(user.id), round);
    });
    this.lastBet.set(user.id, this.now());
    return this.crashState(user);
  },

  // Where the round is now. Settles it once it has crashed or hit the auto target.
  crashState(user) {
    const round = this.repo.getSetting(this.crashKey(user.id));
    const balance = () => this.repo.getUser(user.id).points;
    if (!round) return { ok: true, game: 'crash', status: 'none', balance: balance() };
    const now = this.now();
    const elapsed = now - round.startedAt;
    const current = casino.crashAt(elapsed);
    if (round.target && round.target <= round.crash && current >= round.target) return this.crashSettle(user, round, round.target);
    if (current >= round.crash) return this.crashSettle(user, round, 0);
    return { ok: true, game: 'crash', status: 'running', stake: round.stake, target: round.target, elapsed, multiplier: current, balance: balance() };
  },

  crashCashout(user) {
    const state = this.crashState(user);
    if (state.status !== 'running') return state.status === 'none' ? { ...state, ok: false, error: 'no round going. Place a bet first.' } : state;
    const round = this.repo.getSetting(this.crashKey(user.id));
    return this.crashSettle(user, round, state.multiplier);
  },

  crashSettle(user, round, multiplier) {
    const payout = payoutOf(round.stake, multiplier);
    this.repo.transaction(() => {
      if (payout) this.repo.addPoints(user.id, payout);
      this.track('casinoPaid', payout);
      this.repo.deleteSetting(this.crashKey(user.id));
    });
    if (multiplier >= 10 || payout - round.stake >= 10000) {
      this.emitActivity(user, { kind: 'jackpot', text: `cashed out ${fmt(payout)} pts at ${multiplier}x on crash! 🚀` });
    }
    return {
      ok: true,
      game: 'crash',
      status: multiplier ? 'cashed' : 'crashed',
      stake: round.stake,
      crash: round.crash,
      crashMs: casino.crashTime(round.crash),
      multiplier,
      payout,
      net: payout - round.stake,
      balance: this.repo.getUser(user.id).points,
    };
  },

  // ---- Mines ------------------------------------------------------------------------
  minesKey(userId) {
    return `mines:${userId}`;
  },

  minesView(game, balance, extra = {}) {
    const done = Boolean(game.status);
    const picks = game.revealed.length;
    const safe = casino.MINES_TILES - game.mines.length;
    return {
      ok: true,
      game: 'mines',
      status: game.status || 'playing',
      stake: game.stake,
      mineCount: game.mines.length,
      revealed: game.revealed,
      mines: done ? game.mines : null,
      hit: game.hit ?? null,
      multiplier: picks ? casino.minesMultiplier(game.mines.length, picks) : 1,
      next: !done && picks < safe ? casino.minesMultiplier(game.mines.length, picks + 1) : null,
      payout: game.payout ?? null,
      net: done ? (game.payout || 0) - game.stake : null,
      balance,
      ...extra,
    };
  },

  minesState(user) {
    const game = this.repo.getSetting(this.minesKey(user.id));
    const balance = this.repo.getUser(user.id).points;
    return game ? this.minesView(game, balance) : { ok: true, game: 'mines', status: 'none', balance };
  },

  minesStart(user, betArg, minesArg) {
    if (this.repo.getSetting(this.minesKey(user.id))) return { ...this.minesState(user), ok: false, error: 'finish your current board first (reveal a tile or cash out).' };
    const count = Number.parseInt(minesArg ?? 3, 10);
    if (!(count >= 1 && count <= casino.MINES_TILES - 1)) return { ok: false, error: `pick 1 to ${casino.MINES_TILES - 1} mines.` };
    const b = this.takeBet(user, betArg);
    if (b.bet === undefined) return { ok: false, ...b };
    const game = { stake: b.bet, mines: casino.placeMines(this.rng, count), revealed: [] };
    this.repo.transaction(() => {
      this.repo.addPoints(user.id, -b.bet);
      this.track('casinoWagered', b.bet);
      this.repo.setSetting(this.minesKey(user.id), game);
    });
    this.lastBet.set(user.id, this.now());
    return this.minesView(game, this.repo.getUser(user.id).points);
  },

  minesReveal(user, tileArg) {
    const game = this.repo.getSetting(this.minesKey(user.id));
    if (!game) return { ok: false, error: 'no board in play. Start one with a bet.' };
    const tile = Number.parseInt(tileArg, 10);
    if (!(tile >= 0 && tile < casino.MINES_TILES)) return { ...this.minesState(user), ok: false, error: `pick a tile from 1 to ${casino.MINES_TILES}.` };
    if (game.revealed.includes(tile)) return { ...this.minesState(user), ok: false, error: 'already revealed.' };
    if (game.mines.includes(tile)) return this.minesFinish(user, { ...game, hit: tile }, 0);
    const next = { ...game, revealed: [...game.revealed, tile] };
    // Every safe tile found: cash out automatically.
    if (next.revealed.length === casino.MINES_TILES - game.mines.length) return this.minesFinish(user, next, casino.minesMultiplier(game.mines.length, next.revealed.length));
    this.repo.setSetting(this.minesKey(user.id), next);
    return this.minesView(next, this.repo.getUser(user.id).points);
  },

  minesCashout(user) {
    const game = this.repo.getSetting(this.minesKey(user.id));
    if (!game) return { ok: false, error: 'no board in play.' };
    if (!game.revealed.length) return { ...this.minesState(user), ok: false, error: 'reveal at least one tile first.' };
    return this.minesFinish(user, game, casino.minesMultiplier(game.mines.length, game.revealed.length));
  },

  minesFinish(user, game, multiplier) {
    const payout = payoutOf(game.stake, multiplier);
    this.repo.transaction(() => {
      if (payout) this.repo.addPoints(user.id, payout);
      this.track('casinoPaid', payout);
      this.repo.deleteSetting(this.minesKey(user.id));
    });
    if (multiplier >= 10 || payout - game.stake >= 10000) {
      this.emitActivity(user, { kind: 'jackpot', text: `won ${fmt(payout)} pts on mines (${multiplier}x)! 💎` });
    }
    return this.minesView({ ...game, status: multiplier ? 'won' : 'lost', payout }, this.repo.getUser(user.id).points);
  },

  // ---- Casino: chat ------------------------------------------------------------------
  casinoReply(r, win) {
    const bal = `Balance: ${fmt(r.balance)}`;
    return r.net > 0 ? `${win} WON ${fmt(r.payout)} pts (${r.multiplier}x)! 💰 ${bal}` : r.net === 0 ? `${win} bet back. ${bal}` : `${win} lost ${fmt(-r.net)}. ${bal}`;
  },

  chatSlots(user, args) {
    if (!args.length) return 'usage: !slots <bet> (e.g. !slots 500, !slots all). Pays up to 300x on 🟩🟩🟩!';
    const r = this.playSlots(user, args[0]);
    if (!r.ok) return r.error || null;
    const icons = r.reels.map((id) => casino.SLOT_SYMBOLS.find((x) => x.id === id).icon).join(' | ');
    return this.casinoReply(r, `🎰 [ ${icons} ]${r.line ? ` ${r.line}!` : ''}`);
  },

  chatRoulette(user, args) {
    if (args.length < 2) return 'usage: !roulette <red|black|green|odd|even|low|high|1st|2nd|3rd|number> <bet>, e.g. !roulette red 500';
    const [a, b] = args;
    const bets = (x) => casino.parseBet(x, user.points) !== null;
    // "!roulette red 500" or "!roulette 500 red". "!roulette 7 500" means 500 on number 7.
    const [choice, bet] = casino.rouletteBet(a) && bets(b) ? [a, b] : casino.rouletteBet(b) && bets(a) ? [b, a] : [null, null];
    if (!choice) return `bet on red, black, green, odd, even, low, high, 1st, 2nd, 3rd or a number 1-36, e.g. ${this.cfg.prefix}roulette red 500`;
    const r = this.playRoulette(user, choice, bet);
    if (!r.ok) return r.error || null;
    const dot = { red: '🔴', black: '⚫', green: '🟢' }[r.color];
    return this.casinoReply(r, `🎡 ${dot} ${r.number} — you bet ${r.betLabel}:`);
  },

  // !plinko 500 high · !plinko 100 extreme 50 (50 balls of 100) · !plinko all high x20 (all, split)
  chatPlinko(user, args) {
    if (!args.length) return 'usage: !plinko <bet> [low|medium|high|extreme] [balls], e.g. !plinko 500 high or !plinko 100 extreme 50';
    let risk = null;
    let bet = null;
    let balls = 1;
    for (const w of args) {
      const n = String(w).toLowerCase();
      if (!risk && casino.riskOf(n)) risk = n;
      else if (bet === null && casino.parseBet(n, 1) !== null) bet = n;
      else if (/^(x?\d+x?|\d+balls?)$/.test(n)) balls = Number(n.replace(/\D/g, ''));
    }
    const r = this.playPlinko(user, bet, risk, balls);
    if (!r.ok) return r.error || null;
    if (r.balls.length === 1) return this.casinoReply(r, `🔻 Plinko (${r.risk}) landed on ${r.multiplier}x:`);
    // "12× 0x, 3× 0.7x, 1× 40x"
    const counts = {};
    for (const d of r.balls) counts[d.multiplier] = (counts[d.multiplier] || 0) + 1;
    const spread = Object.entries(counts)
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .slice(0, 4)
      .map(([m, n]) => `${n}× ${m}x`)
      .join(', ');
    const head = `🔻 Plinko (${r.risk}) ${fmt(r.balls.length)} balls of ${fmt(r.perBall)}: ${spread}${Object.keys(counts).length > 4 ? '…' : ''} →`;
    const bal = `Balance: ${fmt(r.balance)}`;
    return r.net > 0 ? `${head} WON ${fmt(r.payout)} pts on ${fmt(r.bet)}! 💰 ${bal}` : r.net === 0 ? `${head} broke even. ${bal}` : `${head} got back ${fmt(r.payout)} of ${fmt(r.bet)}. ${bal}`;
  },

  bjText(v) {
    const hand = (cards) => cards.map((c) => (c ? casino.cardText(c) : '🂠')).join(' ');
    const dealer = `Dealer: ${hand(v.dealer)} (${v.dealerTotal})`;
    const outcomeOf = (status, payout, stake) =>
      ({
        blackjack: `BLACKJACK! Won ${fmt(payout)} pts`,
        win: `you WIN ${fmt(payout)} pts`,
        push: 'push — bet back',
        lose: `dealer wins, lost ${fmt(stake)}`,
        bust: `bust! Lost ${fmt(stake)}`,
      })[status];
    const actions = (x) => {
      const opts = ['!hit', '!stand', x.canDouble && '!double', x.canSplit && '!split'].filter(Boolean);
      return `${opts.slice(0, -1).join(', ')} or ${opts[opts.length - 1]}`;
    };
    if (v.hands.length === 1) {
      const table = `🃏 You: ${hand(v.player)} (${v.playerTotal}) | ${dealer}`;
      if (v.status === 'playing') return `${table} — ${actions(v)}`;
      return `${table} — ${outcomeOf(v.status, v.payout, v.stake)}. Balance: ${fmt(v.balance)}`;
    }
    // Split hands: "👉" marks the one you're playing.
    const hands = v.hands
      .map((h, i) => {
        const mark = i === v.active ? '👉' : '';
        const result = v.status === 'playing' ? '' : ` ${{ blackjack: '🃏', win: '✅', push: '➖', lose: '❌', bust: '💥' }[h.status] || ''}`;
        return `${mark}Hand ${i + 1}: ${hand(h.cards)} (${h.total})${result}`;
      })
      .join(' | ');
    if (v.status === 'playing') return `🃏 ${hands} | ${dealer} — hand ${v.active + 1}: ${actions(v)}`;
    const total = v.net > 0 ? `WON ${fmt(v.payout)} pts total` : v.net === 0 ? 'bets back' : `lost ${fmt(-v.net)} pts`;
    return `🃏 ${hands} | ${dealer} — ${total}. Balance: ${fmt(v.balance)}`;
  },

  chatBlackjack(user, args) {
    const current = this.bjLoad(user.id);
    if (current) return this.bjText(this.bjView(current, this.repo.getUser(user.id).points));
    if (!args.length) return 'usage: !bj <bet> (e.g. !bj 500), then !hit, !stand, !double or !split (pairs). Blackjack pays 3:2.';
    const r = this.blackjackStart(user, args[0]);
    return r.ok ? this.bjText(r) : r.error || null;
  },

  chatSplit(user) {
    const r = this.blackjackAction(user, 'split');
    return r.ok ? this.bjText(r) : r.error;
  },

  // !crash <bet> [target], e.g. !crash 500 2x (cash out at 2x). Defaults to 2x.
  chatCrash(user, args) {
    if (!args.length) return `usage: !crash <bet> [cash-out], e.g. !crash 500 2x. The rocket climbs until it crashes — if it reaches your cash-out, you win bet × cash-out. Live version at ${this.siteUrl}/#/casino`;
    const [a, b] = args;
    // Either order: "!crash 2x 500" works too.
    const [bet, target] = /x$/i.test(a) && b !== undefined ? [b, a] : [a, b];
    const r = this.playCrash(user, bet, target);
    if (!r.ok) return r.error || null;
    const how = r.win ? `cashed out at ${r.target}x before it crashed at ${r.crash}x:` : `crashed at ${r.crash}x before ${r.target}x:`;
    return this.casinoReply(r, `🚀 ${how}`);
  },

  minesText(v) {
    if (v.status === 'playing') {
      const found = v.revealed.length ? ` 💎 ${v.revealed.map((t) => t + 1).join(', ')}` : '';
      const cash = v.revealed.length ? ` Cash out: ${fmt(payoutOf(v.stake, v.multiplier))} pts (${v.multiplier}x) with !cashout.` : '';
      return `💣 Mines (${v.mineCount} on 25 tiles, bet ${fmt(v.stake)}):${found}. !pick 1-25 for ${v.next}x.${cash}`;
    }
    const board = v.mines.map((t) => t + 1).join(', ');
    return v.status === 'won'
      ? `💎 cashed out at ${v.multiplier}x: WON ${fmt(v.payout)} pts! (mines were at ${board}) Balance: ${fmt(v.balance)}`
      : `💥 BOOM! Tile ${v.hit + 1} was a mine. Lost ${fmt(v.stake)}. (mines: ${board}) Balance: ${fmt(v.balance)}`;
  },

  // !mines <bet> [mines 1-24]
  chatMines(user, args) {
    const current = this.repo.getSetting(this.minesKey(user.id));
    if (current) return this.minesText(this.minesView(current, this.repo.getUser(user.id).points));
    if (!args.length) return 'usage: !mines <bet> [mines 1-24], e.g. !mines 500 3. Then !pick 1-25 to find gems and !cashout whenever you like. Hit a mine and you lose it all!';
    const r = this.minesStart(user, args[0], args[1]);
    return r.ok ? this.minesText(r) : r.error || null;
  },

  chatPick(user, args) {
    if (!args.length) return 'usage: !pick <1-25>';
    const r = this.minesReveal(user, Number.parseInt(args[0], 10) - 1);
    return r.ok ? this.minesText(r) : r.error;
  },

  chatCashout(user) {
    const r = this.minesCashout(user);
    return r.ok ? this.minesText(r) : r.error;
  },

  chatHit(user) {
    const r = this.blackjackAction(user, 'hit');
    return r.ok ? this.bjText(r) : r.error;
  },

  chatStand(user) {
    const r = this.blackjackAction(user, 'stand');
    return r.ok ? this.bjText(r) : r.error;
  },

  chatDouble(user) {
    const r = this.blackjackAction(user, 'double');
    return r.ok ? this.bjText(r) : r.error;
  },

  casinoHelp() {
    const c = this.cfg;
    if (c.casinoEnabled === false) return 'the casino is closed right now.';
    const p = c.prefix;
    return `🎰 Casino (points only): ${p}slots <bet> · ${p}roulette red <bet> · ${p}plinko <bet> [low|medium|high|extreme] [balls] · ${p}bj <bet> then ${p}hit/${p}stand/${p}double/${p}split · ${p}crash <bet> 2x · ${p}mines <bet> 3 then ${p}pick 1-25/${p}cashout. Bets: 500, 1k, half, all. Or play at ${this.siteUrl}/#/casino`;
  },
};
