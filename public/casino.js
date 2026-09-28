// Casino page (#/casino): slots, roulette, plinko and blackjack. Outcomes come from the server;
// this file only animates them. app.js calls window.MMOCasino($app, helpers).
(() => {
  const SUIT_RED = new Set(['♥', '♦']);
  let tab = 'slots';
  let risk = 'medium';
  let rouletteChoice = 'red';

  window.MMOCasino = async ($app, { api, toast, esc, fmt, state, route }) => {
    const info = await api('/casino');
    const loggedIn = info.balance !== null;
    let balance = info.balance;
    let busy = false;
    const timers = new Set();
    const later = (fn, ms) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
      return t;
    };

    // A crash round or mines board left running (e.g. after a refresh) opens its tab.
    if (info.crash.state?.status === 'running') tab = 'crash';
    else if (info.mines.state?.status === 'playing') tab = 'mines';

    if (!info.open) {
      $app.innerHTML = `<div class="panel empty"><span class="ic">🎰</span>The casino is closed right now.</div>`;
      return;
    }

    const TABS = [
      ['slots', '🎰 Slots'],
      ['roulette', '🎡 Roulette'],
      ['plinko', '🔻 Plinko'],
      ['blackjack', '🃏 Blackjack'],
      ['crash', '🚀 Crash'],
      ['mines', '💣 Mines'],
    ];

    $app.innerHTML = `
      <div class="casino">
        <div class="casino-top">
          <div>
            <h1><span class="live-dot">● LIVE</span> Casino</h1>
            <p class="muted">Play with the points you earn in chat. In chat: <code>!slots 500</code>, <code>!roulette red 1k</code>, <code>!plinko half high</code>, <code>!bj all</code>, <code>!crash 500 2x</code>, <code>!mines 500 3</code>.</p>
          </div>
          ${
            loggedIn
              ? `<div class="casino-bank"><span class="muted">Balance</span><b id="cz-balance">${fmt(balance)}</b><span class="muted">pts</span></div>`
              : state.loginEnabled
                ? `<a class="btn btn-primary" href="/auth/login">Log in with Kick to play</a>`
                : ''
          }
        </div>
        <div class="tabs">${TABS.map(([id, label]) => `<button class="tab ${id === tab ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
        <div class="casino-grid">
          <section class="panel casino-stage" id="cz-stage"></section>
          <aside class="panel casino-side">
            <label class="muted" for="cz-bet">Bet</label>
            <div class="form-row"><input type="text" id="cz-bet" value="${fmt(Math.max(info.minBet, 100)).replace(/,/g, '')}" autocomplete="off"></div>
            <div class="bet-quick">
              <button class="mini" data-q="min">Min</button><button class="mini" data-q="half">½</button>
              <button class="mini" data-q="double">2×</button><button class="mini" data-q="all">All</button>
            </div>
            <p class="muted" style="font-size:.8rem">Min ${fmt(info.minBet)}${info.maxBet ? ` · max ${fmt(info.maxBet)}` : ''} · 500, 1k, half, all, 25% all work.</p>
            <div id="cz-controls"></div>
            <div id="cz-result" class="cz-result" aria-live="polite"></div>
            <div id="cz-pay"></div>
          </aside>
        </div>
      </div>`;

    const $ = (sel) => $app.querySelector(sel);
    const betInput = $('#cz-bet');
    const setBalance = (b) => {
      balance = b;
      const el = $('#cz-balance');
      if (el) el.textContent = fmt(b);
    };
    const result = (html, kind = '') => {
      const el = $('#cz-result');
      el.className = `cz-result ${kind}`;
      el.innerHTML = html;
    };
    const outcome = (r) =>
      r.net > 0
        ? result(`🎉 WON <b>${fmt(r.payout)}</b> pts (${r.multiplier}x)`, 'win')
        : r.net === 0
          ? result('Bet back', '')
          : result(`Lost ${fmt(-r.net)} pts`, 'lose');
    const needLogin = () => {
      if (loggedIn) return false;
      toast('Log in with Kick to play');
      return true;
    };
    const post = async (path, body) => {
      try {
        return await api(path, { method: 'POST', body });
      } catch (err) {
        toast(err.message);
        return null;
      }
    };

    $app.querySelectorAll('[data-tab]').forEach((b) => {
      b.onclick = () => {
        if (busy) return;
        tab = b.dataset.tab;
        $app.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
        render();
      };
    });
    $app.querySelectorAll('[data-q]').forEach((b) => {
      b.onclick = () => {
        const cur = Number(String(betInput.value).replace(/[^\d]/g, '')) || info.minBet;
        const q = b.dataset.q;
        betInput.value = q === 'min' ? info.minBet : q === 'half' ? Math.max(info.minBet, Math.floor(cur / 2)) : q === 'double' ? cur * 2 : 'all';
      };
    });

    // ---- Slots ----------------------------------------------------------------------
    const sym = Object.fromEntries(info.slots.map((s) => [s.id, s]));
    const tile = (id) => `<div class="sym sym-${id}"><span>${sym[id].icon}</span><small>${esc(sym[id].label)}</small></div>`;
    function renderSlots() {
      $('#cz-stage').innerHTML = `
        <div class="slot-machine">
          <div class="slot-title">KICK <span>SLOTS</span></div>
          <div class="reels">${['live', 'kick', 'gift'].map((id, i) => `<div class="reel" id="reel${i}">${tile(id)}</div>`).join('')}</div>
          <div class="slot-lights"></div>
        </div>`;
      $('#cz-controls').innerHTML = `<button class="btn btn-primary big-btn" id="cz-go">🎰 Spin</button>`;
      $('#cz-pay').innerHTML = `<h3>Paytable</h3><table class="paytable">${info.slots
        .slice()
        .reverse()
        .map((s) => `<tr><td>${s.icon}${s.icon}${s.icon}</td><td class="num">${s.three}x</td><td>${s.icon}${s.icon}</td><td class="num">${s.two}x</td></tr>`)
        .join('')}<tr><td colspan="4" class="muted">Any single ${sym.kick.icon} KICK: bet back</td></tr></table>`;
      $('#cz-go').onclick = async () => {
        if (busy || needLogin()) return;
        busy = true;
        const r = await post('/casino/slots', { bet: betInput.value });
        if (!r) return (busy = false);
        const ids = info.slots.map((s) => s.id);
        result('Spinning…');
        r.reels.forEach((final, i) => {
          const reel = $(`#reel${i}`);
          reel.classList.add('spinning');
          const spin = setInterval(() => (reel.innerHTML = tile(ids[Math.floor(Math.random() * ids.length)])), 70);
          later(() => {
            clearInterval(spin);
            reel.classList.remove('spinning');
            reel.innerHTML = tile(final);
            reel.classList.add('landed');
            if (i === 2) {
              setBalance(r.balance);
              outcome(r);
              if (r.line) $('#cz-result').insertAdjacentHTML('afterbegin', `<div>${esc(r.line)}</div>`);
              busy = false;
            }
          }, 700 + i * 350);
        });
      };
    }

    // ---- Roulette ------------------------------------------------------------------
    function wheelSvg() {
      const n = info.wheel.length;
      const R = 140;
      const slices = info.wheel
        .map((w, i) => {
          const a0 = ((i - 0.5) / n) * 2 * Math.PI;
          const a1 = ((i + 0.5) / n) * 2 * Math.PI;
          const p = (a, r) => `${(150 + r * Math.sin(a)).toFixed(2)},${(150 - r * Math.cos(a)).toFixed(2)}`;
          const mid = (i / n) * 2 * Math.PI;
          const fill = w.color === 'red' ? '#dc2626' : w.color === 'green' ? '#16a34a' : '#111827';
          return `<path d="M150,150 L${p(a0, R)} A${R},${R} 0 0 1 ${p(a1, R)} Z" fill="${fill}" stroke="#374151" stroke-width="1"/>
            <text x="${p(mid, R - 16).split(',')[0]}" y="${p(mid, R - 16).split(',')[1]}" fill="#fff" font-size="11" font-weight="700" text-anchor="middle" dominant-baseline="middle" transform="rotate(${(mid * 180) / Math.PI} ${p(mid, R - 16).replace(',', ' ')})">${w.n}</text>`;
        })
        .join('');
      return `<svg viewBox="0 0 300 300" class="wheel" id="cz-wheel" role="img" aria-label="Roulette wheel">
        <circle cx="150" cy="150" r="146" fill="#53fc18"/>${slices}
        <circle cx="150" cy="150" r="70" fill="#0b0e11" stroke="#53fc18" stroke-width="3"/>
        <text x="150" y="146" fill="#53fc18" font-size="20" font-weight="800" text-anchor="middle">KICK</text>
        <text x="150" y="168" fill="#8b98a8" font-size="11" font-weight="700" text-anchor="middle">ROULETTE</text>
      </svg>`;
    }
    let wheelAngle = 0;
    function renderRoulette() {
      $('#cz-stage').innerHTML = `
        <div class="wheel-wrap"><div class="wheel-pointer">▼</div>${wheelSvg()}</div>
        <div class="rl-last" id="cz-last"></div>`;
      const choices = [
        ['red', 'Red 2x', 'rl-red'], ['black', 'Black 2x', 'rl-black'], ['green', '0 · 36x', 'rl-green'],
        ['odd', 'Odd 2x'], ['even', 'Even 2x'], ['low', '1-18 2x'], ['high', '19-36 2x'],
        ['1st', '1st 12 · 3x'], ['2nd', '2nd 12 · 3x'], ['3rd', '3rd 12 · 3x'],
      ];
      $('#cz-controls').innerHTML = `
        <div class="rl-choices">${choices
          .map(([id, label, cls]) => `<button class="rl-btn ${cls || ''} ${rouletteChoice === id ? 'active' : ''}" data-choice="${id}">${label}</button>`)
          .join('')}</div>
        <div class="form-row" style="margin:8px 0"><input type="number" id="cz-num" min="1" max="36" placeholder="Number 1-36 (36x)" aria-label="Number to bet on"></div>
        <button class="btn btn-primary big-btn" id="cz-go">🎡 Spin</button>`;
      $('#cz-pay').innerHTML = '';
      $app.querySelectorAll('[data-choice]').forEach((b) => {
        b.onclick = () => {
          rouletteChoice = b.dataset.choice;
          $('#cz-num').value = '';
          $app.querySelectorAll('[data-choice]').forEach((x) => x.classList.toggle('active', x === b));
        };
      });
      $('#cz-num').oninput = () => $app.querySelectorAll('[data-choice]').forEach((x) => x.classList.remove('active'));
      $('#cz-go').onclick = async () => {
        if (busy || needLogin()) return;
        const num = $('#cz-num').value;
        const choice = num ? String(num) : rouletteChoice;
        busy = true;
        const r = await post('/casino/roulette', { bet: betInput.value, choice });
        if (!r) return (busy = false);
        const idx = info.wheel.findIndex((w) => w.n === r.number);
        // Spin several turns and stop with the winning slice under the pointer at the top.
        const target = 360 * 5 - (idx / info.wheel.length) * 360;
        wheelAngle = wheelAngle - (wheelAngle % 360) + target + 360;
        const wheel = $('#cz-wheel');
        wheel.style.transform = `rotate(${wheelAngle}deg)`;
        result('Spinning…');
        later(() => {
          $('#cz-last').innerHTML = `<span class="rl-ball rl-${r.color}">${r.number}</span> ${esc(r.betLabel)}`;
          setBalance(r.balance);
          outcome(r);
          busy = false;
        }, 3200);
      };
    }

    // ---- Plinko --------------------------------------------------------------------
    function renderPlinko() {
      const rows = info.plinko.rows;
      const W = 420;
      const gap = W / (rows + 3);
      const mult = info.plinko.risks[risk];
      const pegs = [];
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k <= r + 2; k++) {
          const x = W / 2 + (k - (r + 2) / 2) * gap;
          pegs.push(`<circle cx="${x.toFixed(1)}" cy="${(30 + r * gap).toFixed(1)}" r="3.2" fill="#8b98a8"/>`);
        }
      }
      const by = 30 + rows * gap + 6;
      const buckets = mult
        .map((m, i) => {
          const x = W / 2 + (i - rows / 2) * gap;
          const hot = m >= 10 ? '#dc2626' : m >= 2 ? '#f97316' : m >= 1 ? '#eab308' : '#53fc18';
          return `<g id="pb${i}"><rect x="${(x - gap / 2 + 1.5).toFixed(1)}" y="${by}" width="${(gap - 3).toFixed(1)}" height="22" rx="4" fill="${hot}"/>
            <text x="${x.toFixed(1)}" y="${by + 15}" font-size="${m >= 100 ? 8 : 9}" font-weight="800" text-anchor="middle" fill="#0b0e11">${m}x</text></g>`;
        })
        .join('');
      $('#cz-stage').innerHTML = `<svg viewBox="0 0 ${W} ${by + 30}" class="plinko" id="cz-plinko" role="img" aria-label="Plinko board">${pegs.join('')}${buckets}<g id="cz-balls"></g></svg>`;
      $('#cz-controls').innerHTML = `
        <div class="rl-choices">${['low', 'medium', 'high']
          .map((x) => `<button class="rl-btn ${x === risk ? 'active' : ''}" data-risk="${x}">${x[0].toUpperCase() + x.slice(1)} risk</button>`)
          .join('')}</div>
        <button class="btn btn-primary big-btn" id="cz-go" style="margin-top:8px">🔻 Drop ball</button>`;
      $('#cz-pay').innerHTML = `<p class="muted" style="font-size:.85rem">Higher risk: bigger edges (up to ${Math.max(...mult)}x), smaller middle.</p>`;
      $app.querySelectorAll('[data-risk]').forEach((b) => {
        b.onclick = () => {
          if (busy) return;
          risk = b.dataset.risk;
          renderPlinko();
        };
      });
      $('#cz-go').onclick = async () => {
        if (busy || needLogin()) return;
        busy = true;
        const r = await post('/casino/plinko', { bet: betInput.value, risk });
        if (!r) return (busy = false);
        const ns = 'http://www.w3.org/2000/svg';
        const ball = document.createElementNS(ns, 'circle');
        ball.setAttribute('r', '6');
        ball.setAttribute('fill', '#53fc18');
        ball.setAttribute('class', 'plinko-ball');
        $('#cz-balls').appendChild(ball);
        let pos = 0; // rights so far
        const place = (row) => {
          const x = W / 2 + (pos - row / 2) * gap;
          ball.setAttribute('cx', x.toFixed(1));
          ball.setAttribute('cy', (18 + row * gap).toFixed(1));
        };
        place(0);
        result('Dropping…');
        r.path.forEach((step, row) => {
          later(() => {
            pos += step;
            place(row + 1);
          }, 110 * (row + 1));
        });
        later(() => {
          $(`#pb${r.bucket}`)?.classList.add('hit');
          later(() => $(`#pb${r.bucket}`)?.classList.remove('hit'), 900);
          ball.remove();
          setBalance(r.balance);
          outcome(r);
          busy = false;
        }, 110 * (rows + 1) + 150);
      };
    }

    // ---- Blackjack -----------------------------------------------------------------
    const HAND_RESULT = { blackjack: '🃏 Blackjack', win: '✅ Win', push: '➖ Push', lose: '❌ Lose', bust: '💥 Bust' };
    const card = (c) =>
      c
        ? `<div class="card ${SUIT_RED.has(c.suit) ? 'red' : ''}"><span>${esc(c.rank)}</span><b>${c.suit}</b></div>`
        : `<div class="card back"><span>KICK</span></div>`;
    function drawTable(g) {
      const playing = g && g.status === 'playing';
      $('#cz-stage').innerHTML = `
        <div class="felt">
          <div class="bj-row"><div class="bj-label">Dealer ${g && g.status !== 'none' ? `<b>${g.dealerTotal}</b>` : ''}</div>
            <div class="cards">${g && g.dealer ? g.dealer.map(card).join('') : ''}</div></div>
          <div class="felt-logo">BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON 17</div>
          ${
            g && g.hands && g.hands.length > 1
              ? `<div class="bj-hands">${g.hands
                  .map(
                    (h, i) => `<div class="bj-row bj-hand ${i === g.active ? 'active' : ''} ${h.status}">
                      <div class="bj-label">Hand ${i + 1} <b>${h.total}</b> · ${fmt(h.stake)}${h.doubled ? ' (doubled)' : ''}${
                        HAND_RESULT[h.status] ? ` <span class="bj-res">${HAND_RESULT[h.status]}</span>` : ''
                      }</div>
                      <div class="cards">${h.cards.map(card).join('')}</div></div>`
                  )
                  .join('')}</div>`
              : `<div class="bj-row"><div class="bj-label">You ${g && g.player ? `<b>${g.playerTotal}</b>` : ''}${g && g.stake ? ` · stake ${fmt(g.stake)}` : ''}</div>
            <div class="cards">${g && g.player ? g.player.map(card).join('') : ''}</div></div>`
          }
        </div>`;
      $('#cz-controls').innerHTML = playing
        ? `<div class="bj-actions">
             <button class="btn btn-primary" data-bj="hit">Hit</button>
             <button class="btn" data-bj="stand">Stand</button>
             ${g.canDouble ? '<button class="btn" data-bj="double">Double</button>' : ''}
             ${g.canSplit ? '<button class="btn" data-bj="split">Split</button>' : ''}
           </div>`
        : `<button class="btn btn-primary big-btn" id="cz-go">🃏 Deal</button>`;
      if (g && g.status === 'split') {
        const net = g.net;
        net > 0 ? result(`Split hands: won <b>${fmt(g.payout)}</b> pts total`, 'win') : net === 0 ? result('Split hands: bets back') : result(`Split hands: lost ${fmt(-net)} pts`, 'lose');
      } else if (g && g.status && !['playing', 'none'].includes(g.status)) {
        const msg = { blackjack: '🃏 BLACKJACK!', win: 'You win!', push: 'Push — bet back', lose: 'Dealer wins', bust: 'Bust!' }[g.status];
        g.net > 0 ? result(`${msg} Won <b>${fmt(g.payout)}</b> pts`, 'win') : g.net === 0 ? result(msg) : result(`${msg} Lost ${fmt(g.stake)} pts`, 'lose');
      } else if (playing) result(g.hands && g.hands.length > 1 ? `Playing hand ${g.active + 1} of ${g.hands.length}` : g.canSplit ? 'A pair! Hit, stand, double or split?' : 'Hit, stand or double?');
      $('#cz-pay').innerHTML = '';
      const go = $('#cz-go');
      if (go) {
        go.onclick = async () => {
          if (busy || needLogin()) return;
          busy = true;
          const r = await post('/casino/blackjack', { bet: betInput.value });
          busy = false;
          if (!r) return;
          setBalance(r.balance);
          drawTable(r);
        };
      }
      $app.querySelectorAll('[data-bj]').forEach((b) => {
        b.onclick = async () => {
          if (busy) return;
          busy = true;
          const r = await post(`/casino/blackjack/${b.dataset.bj}`, {});
          busy = false;
          if (!r) return;
          setBalance(r.balance);
          drawTable(r);
        };
      });
    }
    function renderBlackjack() {
      result('');
      drawTable(info.blackjack && info.blackjack.status !== 'none' ? info.blackjack : null);
    }

    // ---- Crash ---------------------------------------------------------------------
    let alive = true; // stops animation loops when leaving the page
    const crashHistory = [];
    let crashRound = null; // { startLocal, target } while running
    const growth = info.crash.growth;
    const multAt = (ms) => Math.max(1, Math.floor(Math.exp(growth * Math.max(0, ms)) * 100) / 100);
    function renderCrash() {
      $('#cz-stage').innerHTML = `
        <div class="crash">
          <svg viewBox="0 0 400 240" class="crash-graph" preserveAspectRatio="none" aria-hidden="true">
            <path id="cz-crash-path" d="M0,240" fill="none" stroke="#53fc18" stroke-width="4" stroke-linecap="round"/>
          </svg>
          <div class="crash-rocket" id="cz-rocket">🚀</div>
          <div class="crash-mult" id="cz-mult">1.00x</div>
          <div class="crash-sub" id="cz-crash-sub">Cash out before it crashes!</div>
          <div class="crash-history" id="cz-crash-hist"></div>
        </div>`;
      $('#cz-controls').innerHTML = `
        <label class="muted" for="cz-target" style="font-size:.85rem">Auto cash-out (optional)</label>
        <div class="form-row" style="margin:4px 0 8px"><input type="text" id="cz-target" placeholder="e.g. 2x" autocomplete="off"></div>
        <button class="btn btn-primary big-btn" id="cz-go">🚀 Launch</button>`;
      $('#cz-pay').innerHTML = `<p class="muted" style="font-size:.85rem">The multiplier climbs until the rocket crashes, anywhere from 1x to ${info.crash.max}x. Hit <b>Cash out</b> in time to win bet × multiplier. In chat: <code>!crash 500 2x</code>.</p>`;
      drawHistory();
      $('#cz-go').onclick = crashButton;
      if (info.crash.state && info.crash.state.status === 'running') resumeCrash(info.crash.state);
    }
    function drawHistory() {
      const el = $('#cz-crash-hist');
      if (el) el.innerHTML = crashHistory.map((x) => `<span class="${x >= 2 ? 'hi' : ''}">${x}x</span>`).join('');
    }
    function crashPath(ms) {
      // x: time (up to 20s, then scrolls), y: multiplier (log scale feel).
      const span = Math.max(20000, ms);
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const t = (ms * i) / 40;
        const m = Math.exp(growth * t);
        const x = (t / span) * 380;
        const y = 230 - Math.min(220, (Math.log(m) / Math.log(Math.max(2, Math.exp(growth * ms)))) * 200);
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      return { d: `M${pts.join(' L')}`, last: pts[pts.length - 1].split(',').map(Number) };
    }
    function resumeCrash(state) {
      crashRound = { startLocal: performance.now() - state.elapsed, target: state.target, stake: state.stake };
      busy = true;
      const go = $('#cz-go');
      go.textContent = '💰 Cash out';
      go.classList.add('cashout');
      result(state.target ? `Auto cash-out at ${state.target}x` : 'Cash out any time!');
      const frame = () => {
        if (!alive || !crashRound) return;
        const ms = performance.now() - crashRound.startLocal;
        const m = multAt(ms);
        const mult = $('#cz-mult');
        if (!mult) return;
        mult.textContent = `${m.toFixed(2)}x`;
        const p = crashPath(ms);
        $('#cz-crash-path').setAttribute('d', p.d);
        const r = $('#cz-rocket');
        r.style.left = `${(p.last[0] / 400) * 100}%`;
        r.style.top = `${(p.last[1] / 240) * 100}%`;
        go.textContent = `💰 Cash out ${fmt(Math.floor(Number(betInputValue()) * m) || 0)}`;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      const poll = async () => {
        if (!alive || !crashRound) return;
        try {
          const s2 = await api('/casino/crash');
          if (s2.status !== 'running') return crashDone(s2);
        } catch {}
        later(poll, 400);
      };
      later(poll, 400);
    }
    const betInputValue = () => (crashRound && crashRound.stake) || 0;
    async function crashButton() {
      if (needLogin()) return;
      if (crashRound) {
        const r = await post('/casino/crash/cashout', {});
        if (r) crashDone(r);
        return;
      }
      if (busy) return;
      busy = true;
      const r = await post('/casino/crash', { bet: betInput.value, target: $('#cz-target').value });
      if (!r) return (busy = false);
      setBalance(r.balance);
      if (r.status !== 'running') return crashDone(r);
      resumeCrash(r);
    }
    function crashDone(r) {
      if (!crashRound && r.status === 'none') return;
      crashRound = null;
      busy = false;
      setBalance(r.balance);
      const mult = $('#cz-mult');
      const go = $('#cz-go');
      if (go) {
        go.textContent = '🚀 Launch';
        go.classList.remove('cashout');
      }
      crashHistory.unshift(r.crash);
      crashHistory.splice(12);
      drawHistory();
      if (!mult) return;
      if (r.status === 'cashed') {
        mult.textContent = `${r.multiplier.toFixed(2)}x`;
        mult.className = 'crash-mult win';
        $('#cz-crash-sub').textContent = `Cashed out! It crashed at ${r.crash}x`;
        result(`🚀 Cashed out at ${r.multiplier}x: WON <b>${fmt(r.payout)}</b> pts`, 'win');
      } else {
        mult.textContent = `${r.crash.toFixed(2)}x`;
        mult.className = 'crash-mult boom';
        $('#cz-crash-sub').textContent = '💥 CRASHED';
        $('#cz-rocket').textContent = '💥';
        result(`💥 Crashed at ${r.crash}x. Lost ${fmt(r.stake)} pts`, 'lose');
      }
      later(() => {
        const m2 = $('#cz-mult');
        if (m2 && !crashRound) m2.className = 'crash-mult';
        const rk = $('#cz-rocket');
        if (rk && !crashRound) rk.textContent = '🚀';
      }, 2500);
    }

    // ---- Mines ---------------------------------------------------------------------
    let mineCount = 3;
    function renderMines(state = info.mines.state) {
      const g = state && state.status !== 'none' ? state : null;
      const playing = g && g.status === 'playing';
      const tiles = Array.from({ length: info.mines.tiles }, (_, i) => {
        let cls = 'tile';
        let face = '';
        if (g) {
          if (g.revealed.includes(i)) [cls, face] = ['tile gem', '💎'];
          else if (g.mines && g.mines.includes(i)) [cls, face] = [`tile mine${g.hit === i ? ' hit' : ''}`, '💣'];
          else if (!playing) cls = 'tile dim';
        }
        return `<button class="${cls}" data-tile="${i}" ${playing && !g.revealed.includes(i) ? '' : 'disabled'} aria-label="Tile ${i + 1}">${face}</button>`;
      }).join('');
      $('#cz-stage').innerHTML = `<div class="mines-board">${tiles}</div>`;
      $('#cz-controls').innerHTML = playing
        ? `<div class="mines-info"><div><span class="muted">Now</span><b>${g.multiplier}x</b></div><div><span class="muted">Next gem</span><b>${g.next ?? '—'}x</b></div></div>
           <button class="btn btn-primary big-btn" id="cz-cashout" ${g.revealed.length ? '' : 'disabled'}>💰 Cash out ${g.revealed.length ? fmt(Math.floor(g.stake * g.multiplier + 1e-6)) : ''}</button>`
        : `<label class="muted" style="font-size:.85rem">Mines</label>
           <div class="rl-choices" style="margin:4px 0 8px">${[1, 3, 5, 10, 24].map((n) => `<button class="rl-btn ${n === mineCount ? 'active' : ''}" data-mines="${n}">${n} 💣</button>`).join('')}</div>
           <button class="btn btn-primary big-btn" id="cz-go">💣 Start</button>`;
      $('#cz-pay').innerHTML = `<p class="muted" style="font-size:.85rem">Find 💎 gems on the 5×5 board. Every gem raises the multiplier (first gem: ${info.mines.table[mineCount - 1]}x with ${mineCount} mines). Cash out whenever you like; hit a 💣 and you lose the bet. In chat: <code>!mines 500 3</code>, <code>!pick 7</code>, <code>!cashout</code>.</p>`;
      if (g && g.status === 'won') result(`💎 Cashed out at ${g.multiplier}x: WON <b>${fmt(g.payout)}</b> pts`, 'win');
      else if (g && g.status === 'lost') result(`💥 BOOM! Lost ${fmt(g.stake)} pts`, 'lose');
      else if (playing) result(g.revealed.length ? `${g.revealed.length} gem${g.revealed.length > 1 ? 's' : ''} found` : 'Pick a tile!');
      $app.querySelectorAll('[data-mines]').forEach((b) => {
        b.onclick = () => {
          mineCount = Number(b.dataset.mines);
          renderMines(g);
        };
      });
      const go = $('#cz-go');
      if (go) {
        go.onclick = async () => {
          if (busy || needLogin()) return;
          busy = true;
          const r = await post('/casino/mines', { bet: betInput.value, mines: mineCount });
          busy = false;
          if (!r) return;
          setBalance(r.balance);
          info.mines.state = r;
          result('');
          renderMines(r);
        };
      }
      $app.querySelectorAll('[data-tile]').forEach((b) => {
        b.onclick = async () => {
          if (busy) return;
          busy = true;
          b.classList.add('flip');
          const r = await post('/casino/mines/reveal', { tile: Number(b.dataset.tile) });
          busy = false;
          if (!r) return;
          setBalance(r.balance);
          info.mines.state = r.status === 'playing' ? r : null;
          renderMines(r);
        };
      });
      const co = $('#cz-cashout');
      if (co) {
        co.onclick = async () => {
          if (busy) return;
          busy = true;
          const r = await post('/casino/mines/cashout', {});
          busy = false;
          if (!r) return;
          setBalance(r.balance);
          info.mines.state = null;
          renderMines(r);
        };
      }
    }

    function render() {
      result('');
      ({ slots: renderSlots, roulette: renderRoulette, plinko: renderPlinko, blackjack: renderBlackjack, crash: renderCrash, mines: () => renderMines() })[tab]();
    }
    render();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  };
})();
