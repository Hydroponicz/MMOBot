// Casino mini-games: slots, roulette, plinko and blackjack. Played with points, in chat or on the
// website. All outcomes are decided here on the server. Return-to-player is set close to real
// casino games (slots ~95%, roulette ~97%, plinko ~99%, blackjack ~99%), so points drain slowly.

// ---- Slots ------------------------------------------------------------------------
// Kick streaming themed reels. weight = how common on each reel; three = 3-of-a-kind multiplier;
// two = pair multiplier. A single KICK anywhere (with no other win) gives your bet back.
const SLOT_SYMBOLS = [
  { id: 'chat', icon: '💬', label: 'Chat', weight: 30, three: 5, two: 0.4 },
  { id: 'follow', icon: '💚', label: 'Follow', weight: 25, three: 8, two: 0.8 },
  { id: 'gift', icon: '🎁', label: 'Gift Sub', weight: 18, three: 15, two: 1.2 },
  { id: 'mic', icon: '🎙️', label: 'Mic', weight: 12, three: 25, two: 2 },
  { id: 'cam', icon: '🎥', label: 'Cam', weight: 9, three: 40, two: 3 },
  { id: 'live', icon: '🔴', label: 'LIVE', weight: 5, three: 100, two: 5 },
  { id: 'kick', icon: '🟩', label: 'KICK', weight: 3, three: 300, two: 10 },
];
const SLOT_WEIGHT = SLOT_SYMBOLS.reduce((s, x) => s + x.weight, 0);

function spinSlots(rng) {
  const pick = () => {
    let r = rng() * SLOT_WEIGHT;
    for (const s of SLOT_SYMBOLS) {
      r -= s.weight;
      if (r < 0) return s;
    }
    return SLOT_SYMBOLS[0];
  };
  const reels = [pick(), pick(), pick()];
  const counts = {};
  for (const s of reels) counts[s.id] = (counts[s.id] || 0) + 1;
  let multiplier = 0;
  let line = null;
  for (const s of SLOT_SYMBOLS) {
    if (counts[s.id] === 3) [multiplier, line] = [s.three, `3x ${s.label}`];
    else if (counts[s.id] === 2) [multiplier, line] = [s.two, `pair of ${s.label}`];
  }
  if (!multiplier && counts.kick === 1) [multiplier, line] = [1, 'lucky KICK'];
  return { reels: reels.map((s) => s.id), multiplier, line };
}

// ---- Roulette (European, single zero) ---------------------------------------------------
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

// Bet types -> [description, test, multiplier (total returned per point bet)].
function rouletteBet(choice) {
  const c = String(choice || '').toLowerCase().trim();
  const simple = {
    red: ['red', (n) => colorOf(n) === 'red', 2],
    black: ['black', (n) => colorOf(n) === 'black', 2],
    green: ['green (0)', (n) => n === 0, 36],
    even: ['even', (n) => n !== 0 && n % 2 === 0, 2],
    odd: ['odd', (n) => n % 2 === 1, 2],
    low: ['1-18', (n) => n >= 1 && n <= 18, 2],
    high: ['19-36', (n) => n >= 19, 2],
    '1st': ['1st dozen (1-12)', (n) => n >= 1 && n <= 12, 3],
    '2nd': ['2nd dozen (13-24)', (n) => n >= 13 && n <= 24, 3],
    '3rd': ['3rd dozen (25-36)', (n) => n >= 25, 3],
  };
  const alias = { r: 'red', b: 'black', g: 'green', zero: 'green', '0': 'green', '1-18': 'low', '19-36': 'high', first: '1st', second: '2nd', third: '3rd', '1-12': '1st', '13-24': '2nd', '25-36': '3rd' };
  const key = alias[c] || c;
  if (simple[key]) {
    const [label, wins, multiplier] = simple[key];
    return { key, label, wins, multiplier };
  }
  if (/^\d{1,2}$/.test(c) && Number(c) >= 1 && Number(c) <= 36) {
    const n = Number(c);
    return { key: String(n), label: `number ${n}`, wins: (x) => x === n, multiplier: 36 };
  }
  return null;
}

function spinRoulette(rng, choice) {
  const bet = rouletteBet(choice);
  if (!bet) return null;
  const number = WHEEL_ORDER[Math.floor(rng() * WHEEL_ORDER.length)];
  const win = bet.wins(number);
  return { number, color: colorOf(number), bet: bet.key, betLabel: bet.label, win, multiplier: win ? bet.multiplier : 0 };
}

// ---- Plinko (12 rows) ---------------------------------------------------------------------
const PLINKO_ROWS = 12;
const PLINKO_RISKS = {
  low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
  medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
};
const riskOf = (r) => ({ l: 'low', low: 'low', m: 'medium', med: 'medium', medium: 'medium', h: 'high', high: 'high' })[String(r || '').toLowerCase()];

function dropPlinko(rng, risk = 'medium') {
  const path = Array.from({ length: PLINKO_ROWS }, () => (rng() < 0.5 ? 0 : 1)); // 0 = left, 1 = right
  const bucket = path.reduce((s, x) => s + x, 0);
  return { risk, path, bucket, multiplier: PLINKO_RISKS[risk][bucket] };
}

// ---- Blackjack (infinite deck, dealer stands on 17, blackjack pays 3:2, double on first two) ------
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const drawCard = (rng) => ({ rank: RANKS[Math.floor(rng() * 13)], suit: SUITS[Math.floor(rng() * 4)] });
function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      aces++;
      total += 11;
    } else total += ['J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank);
  }
  while (total > 21 && aces) {
    total -= 10;
    aces--;
  }
  return total;
}
const isBlackjack = (cards) => cards.length === 2 && handTotal(cards) === 21;
const cardText = (c) => `${c.rank}${c.suit}`;

// Pairs can be split: same rank, up to 4 hands.
const canSplitCards = (cards) => cards.length === 2 && cards[0].rank === cards[1].rank;
const MAX_HANDS = 4;

// Plays the dealer out and settles every hand. A game is { hands: [{ cards, stake, doubled }], dealer }.
// Each hand gets status and multiplier (total returned per point bet: win 2, blackjack 2.5, push 1,
// loss 0). A two-card 21 only counts as blackjack on an unsplit hand.
function settleBlackjack(game, rng) {
  const dealer = [...game.dealer];
  const split = game.hands.length > 1;
  const natural = (h) => !split && !h.doubled && isBlackjack(h.cards);
  const live = game.hands.filter((h) => handTotal(h.cards) <= 21 && !natural(h));
  if (live.length) while (handTotal(dealer) < 17) dealer.push(drawCard(rng));
  const d = handTotal(dealer);
  const dealerBj = isBlackjack(game.dealer);
  const hands = game.hands.map((h) => {
    const p = handTotal(h.cards);
    let status;
    let multiplier;
    if (p > 21) [status, multiplier] = ['bust', 0];
    else if (natural(h)) [status, multiplier] = dealerBj ? ['push', 1] : ['blackjack', 2.5];
    else if (dealerBj) [status, multiplier] = ['lose', 0];
    else if (d > 21 || p > d) [status, multiplier] = ['win', 2];
    else if (p === d) [status, multiplier] = ['push', 1];
    else [status, multiplier] = ['lose', 0];
    return { ...h, status, multiplier, payout: Math.floor(h.stake * multiplier + 1e-6) };
  });
  return { ...game, dealer, hands };
}

// ---- Crash ----------------------------------------------------------------------------------
// The multiplier climbs from 1.00x (2x after ~10s, 10x after ~33s) until it crashes. Cash out
// before the crash to win bet x multiplier. P(crash >= x) = 0.99 / x, so every target returns 99%.
const CRASH_GROWTH = 0.00007; // per ms
const CRASH_MAX = 1000;
function crashPoint(rng) {
  const x = 0.99 / (1 - rng());
  return Math.min(CRASH_MAX, Math.max(1, Math.floor(x * 100) / 100));
}
const crashAt = (ms) => Math.max(1, Math.floor(Math.exp(CRASH_GROWTH * Math.max(0, ms)) * 100) / 100);
const crashTime = (multiplier) => Math.log(multiplier) / CRASH_GROWTH; // ms to reach it
// "2", "2x", "2.5X" -> 2.5
function parseTarget(arg) {
  const m = String(arg || '').toLowerCase().match(/^(\d+(?:\.\d+)?)x?$/);
  if (!m) return null;
  const t = Math.floor(Number(m[1]) * 100) / 100;
  return t >= 1.01 && t <= CRASH_MAX ? t : null;
}

// ---- Mines ----------------------------------------------------------------------------------
// A 5x5 board with 1-24 mines. Every safe tile raises the multiplier; hit a mine and you lose.
// Fair odds with a 1% edge: 0.99 x (chance of surviving that many picks)^-1.
const MINES_TILES = 25;
function minesMultiplier(mines, picks) {
  let m = 0.99;
  for (let i = 0; i < picks; i++) m *= (MINES_TILES - i) / (MINES_TILES - mines - i);
  return Math.floor(m * 100) / 100;
}
function placeMines(rng, count) {
  const tiles = Array.from({ length: MINES_TILES }, (_, i) => i);
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles.slice(0, count).sort((a, b) => a - b);
}

// ---- Bets -----------------------------------------------------------------------------------
// "500", "1k", "2.5k", "1m", "all", "max", "half", "25%".
function parseBet(arg, balance) {
  const a = String(arg || '').toLowerCase().trim().replace(/,/g, '');
  if (!a) return null;
  if (a === 'all' || a === 'max' || a === 'allin') return balance;
  if (a === 'half') return Math.floor(balance / 2);
  let m = a.match(/^(\d+(?:\.\d+)?)%$/);
  if (m) return Math.floor((balance * Math.min(100, Number(m[1]))) / 100);
  m = a.match(/^(\d+(?:\.\d+)?)([km]?)$/);
  if (!m) return null;
  return Math.floor(Number(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1));
}

module.exports = {
  SLOT_SYMBOLS,
  spinSlots,
  WHEEL_ORDER,
  colorOf,
  rouletteBet,
  spinRoulette,
  PLINKO_ROWS,
  PLINKO_RISKS,
  riskOf,
  dropPlinko,
  drawCard,
  handTotal,
  isBlackjack,
  cardText,
  settleBlackjack,
  canSplitCards,
  MAX_HANDS,
  crashPoint,
  crashAt,
  CRASH_GROWTH,
  crashTime,
  parseTarget,
  CRASH_MAX,
  MINES_TILES,
  minesMultiplier,
  placeMines,
  parseBet,
};
