// Trading cards page (#/cards): open packs, grade, sell back, the card market and trades.
// Pulls, grades and prices come from the server; this file draws and animates them.
// app.js calls window.MMOCards($app, helpers, query).
(() => {
  let tab = 'packs';
  const filters = { set: '', rarity: '', sort: 'value', graded: false, q: '' };
  const marketFilters = { rarity: '', sort: 'newest', graded: false, q: '' };

  // Deterministic random numbers from a card id, so each copy's scratches never move.
  const seeded = (seed) => {
    let a = (Number(seed) || 1) * 2654435761;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const GRADE_HINTS = [
    [0.02, 'usually 8 to 10: about 1 in 4 comes back a 10'],
    [0.06, 'usually 8 or 9, now and then a 10'],
    [0.1, 'usually 8 or 9'],
    [0.15, 'usually 7 or 8'],
    [0.3, 'usually 5 to 7: grading rarely pays'],
    [0.5, 'usually 2 to 5: not worth grading'],
    [2, 'almost always a 2: not worth grading'],
  ];
  const gradeHint = (wear) => GRADE_HINTS.find(([max]) => wear < max)[1];
  // Under the Sell to bank button: the bank's daily limit and the reduced rate on big items.
  let bankState = { left: null, full: 0, rate: 0.6 };
  const bankNote = (pay) => {
    const { left, full } = bankState;
    const parts = [];
    if (left != null) parts.push(pay > left ? `The bank can only pay ${Number(left).toLocaleString()} more pts today. List it on the market instead, or try tomorrow.` : `Bank limit: ${Number(left).toLocaleString()} pts left today.`);
    if (full) parts.push(`Value above ${Number(full).toLocaleString()} pts is bought at a fifth of the rate.`);
    return parts.length ? `<p class="muted">${parts.join(' ')}</p>` : '';
  };

  window.MMOCards = async ($app, { api, toast, esc, fmt, state, route, ago, playerLink }, query) => {
    let data = await api('/cards');
    const cat = data.catalog;
    bankState = { get left() { return data.bankLeft; }, full: cat.bankFullValue, rate: cat.buyback };
    const loggedIn = data.points !== null;
    const RAR = cat.rarities;
    const EL = cat.elements;
    const SETS = Object.fromEntries(cat.sets.map((s) => [s.id, s]));
    const BASE = Object.fromEntries(cat.sets.flatMap((s) => s.cards.map((c) => [c.id, { ...c, setName: s.name, setIcon: s.icon, setColor: s.color, setSize: s.size }])));
    if (query?.get('tab')) tab = query.get('tab');
    const cleanups = [];

    if (!data.open) {
      $app.innerHTML = `<div class="panel empty"><span class="ic">🃏</span>Trading cards are closed right now.</div>`;
      return;
    }

    // ---- Drawing cards ---------------------------------------------------------------------
    function wearSvg(c) {
      const w = c.wear || 0;
      if (w < 0.004) return '';
      const r = seeded(c.id);
      const parts = [];
      const corner = Math.min(0.95, w * 3);
      const cr = 3 + w * 14;
      // Whitened corners and edges.
      parts.push(
        `<g fill="#fff" opacity="${corner.toFixed(2)}"><circle cx="0" cy="0" r="${cr}"/><circle cx="100" cy="0" r="${cr * (0.6 + r() * 0.6)}"/><circle cx="0" cy="140" r="${cr * (0.6 + r() * 0.6)}"/><circle cx="100" cy="140" r="${cr}"/></g>`
      );
      parts.push(`<rect x="0.5" y="0.5" width="99" height="139" rx="5" fill="none" stroke="#fff" stroke-width="${(w * 5).toFixed(2)}" stroke-dasharray="${(3 + r() * 6).toFixed(1)} ${(2 + r() * 5).toFixed(1)}" opacity="${Math.min(0.8, w * 2).toFixed(2)}"/>`);
      // Scratches.
      const n = Math.floor(w * 40);
      for (let i = 0; i < n; i++) {
        const x = r() * 100;
        const y = r() * 140;
        const len = 4 + r() * 18;
        const a = r() * Math.PI;
        parts.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + Math.cos(a) * len).toFixed(1)}" y2="${(y + Math.sin(a) * len).toFixed(1)}" stroke="#fff" stroke-width="${(0.25 + r() * 0.4).toFixed(2)}" opacity="${(0.2 + r() * 0.35).toFixed(2)}"/>`);
      }
      // Creases on badly worn cards.
      if (w > 0.45) {
        const y = 30 + r() * 80;
        parts.push(`<path d="M0,${y.toFixed(1)} Q50,${(y + (r() - 0.5) * 20).toFixed(1)} 100,${(y + (r() - 0.5) * 30).toFixed(1)}" stroke="#fff" stroke-width="0.8" fill="none" opacity=".55"/>`);
      }
      parts.push(`<rect width="100" height="140" fill="#d8d0c0" opacity="${Math.min(0.25, w * 0.35).toFixed(2)}"/>`);
      return `<svg class="tc-wear" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">${parts.join('')}</svg>`;
    }

    // c: a copy from the server, or a catalog card (binder).
    function cardHtml(c, { size = 170, tilt = false, cls = '', dim = false } = {}) {
      const b = BASE[c.card || c.id] || c;
      const r = RAR[b.rarity];
      const el = EL[b.element];
      const finish = c.finish || 'normal';
      const small = size < 140 ? ' sm' : '';
      // Painted art (cardart.js); Legendary and Mythic cards are full-art.
      const full = b.rarity === 'legendary' || b.rarity === 'mythic';
      const art = window.MMOCardArt ? window.MMOCardArt.html({ id: b.id, icon: b.icon, element: b.element, rarity: b.rarity }, '', size >= 220 ? 640 : 400) : `<span class="tc-icon">${b.icon}</span>`;
      return `<div class="tcard r-${b.rarity} f-${finish}${full ? ' full-art' : ''}${tilt ? ' tilt' : ''}${small}${dim ? ' dim' : ''} ${cls}" style="--w:${size}px;--rc:${r.color};--el:${el.color};--set:${b.setColor}">
        <div class="tc-face">
          ${full ? `<div class="tc-bg">${art}</div>` : ''}
          <div class="tc-head"><span class="tc-name">${esc(b.name)}</span><span class="tc-hp"><small>HP</small>${b.hp}<i>${el.icon}</i></span></div>
          <div class="tc-art">${full ? '' : art}</div>
          <div class="tc-type"><span class="tc-gem">${r.short}</span>${r.name} · ${el.name}</div>
          <div class="tc-move"><span>⚔️ Power</span><b>${b.power}</b></div>
          <div class="tc-flavor">${esc(b.flavor)}</div>
          <div class="tc-foot"><span>${b.setIcon} ${b.num}/${b.setSize}</span><span>${c.serial ? `#${c.serial}` : ''}</span></div>
        </div>
        ${finish !== 'normal' ? '<div class="tc-shine"></div>' : ''}
        ${c.id && c.card ? wearSvg(c) : ''}
      </div>`;
    }

    function slabHtml(c, { size = 170, tilt = false } = {}) {
      const b = BASE[c.card];
      const fin = c.finish === 'normal' ? '' : ` · ${cat.finishes[c.finish].name.toUpperCase()}`;
      return `<div class="slab${c.black ? ' black' : ''}${tilt ? ' tilt' : ''}" style="--w:${size}px">
        <div class="slab-label">
          <div class="sl-left">
            <div class="sl-brand">MMO GRADING</div>
            <div class="sl-name">${esc(b.name)}</div>
            <div class="sl-meta">${esc(b.setName)} #${b.num}${fin}</div>
            <div class="sl-cert">CERT ${String(c.id).padStart(8, '0')} · #${c.serial}</div>
          </div>
          <div class="sl-grade"><small>${esc(c.gradeLabel)}</small><b>${c.grade}</b></div>
        </div>
        <div class="slab-win">${cardHtml(c, { size: Math.round(size * 0.84) })}</div>
      </div>`;
    }

    const showCard = (c, opts = {}) => (c.grade ? slabHtml(c, opts) : cardHtml(c, opts));
    const chip = (c) =>
      c.grade
        ? `<span class="cchip grade${c.black ? ' black' : c.grade === 10 ? ' gem' : ''}">${c.black ? 'PRISTINE 10' : `${c.gradeLabel} ${c.grade}`}</span>`
        : `<span class="cchip">${c.condition} · ${c.wear.toFixed(4)}</span>`;
    const finishTag = (c) => (c.finish === 'normal' ? '' : `<span class="cchip ${c.finish}">${cat.finishes[c.finish].name}</span>`);

    function packHtml(p, big = false) {
      return `<div class="pack t-${p.tier}${big ? ' big' : ''}" style="--pc:${p.color}">
        <div class="pack-crimp top"></div>
        <div class="pack-body">
          <div class="pack-logo">⚔️ MMO CARDS</div>
          <div class="pack-icon">${p.icon}</div>
          <div class="pack-name">${esc(p.name)}</div>
          <div class="pack-count">${p.cards} cards</div>
        </div>
        <div class="pack-crimp bottom"></div>
        <div class="pack-foil"></div>
      </div>`;
    }

    // Tilt and holo shine follow the pointer.
    const onMove = (e) => {
      const el = e.target.closest?.('.tilt');
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.style.transform = `perspective(700px) rotateY(${((x - 0.5) * 18).toFixed(1)}deg) rotateX(${((0.5 - y) * 18).toFixed(1)}deg)`;
      el.style.setProperty('--mx', `${(x * 100).toFixed(0)}%`);
      el.style.setProperty('--my', `${(y * 100).toFixed(0)}%`);
    };
    const onLeave = (e) => {
      const el = e.target.closest?.('.tilt');
      if (el && !el.contains(e.relatedTarget)) el.style.transform = '';
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerout', onLeave);
    cleanups.push(() => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerout', onLeave);
    });

    const post = async (path, body = {}) => {
      try {
        return await api(path, { method: 'POST', body });
      } catch (err) {
        toast(err.message);
        return null;
      }
    };
    const refresh = async () => {
      data = await api('/cards');
      draw();
    };
    const setBalance = (b) => {
      if (b == null) return;
      data.points = b;
      const el = $app.querySelector('#cd-balance');
      if (el) el.textContent = fmt(b);
    };

    // Why this player can't use the card market or trades yet, with progress toward unlocking it.
    function tradeLock(what) {
      const st = data.marketStatus;
      if (!st?.blocked) return '';
      if (st.off) return `<div class="lock-box"><b>🔒 Trading is switched off right now.</b><p>The streamer has paused the market and trades. You can still grade cards or sell them to the bank.</p></div>`;
      const bar = (have, need) => `<div class="raid-bar"><span style="width:${Math.min(100, (have / need) * 100)}%"></span></div>`;
      const rows = [];
      if (st.needActions) {
        rows.push(`<li class="${st.actions >= st.needActions ? 'done' : ''}"><div>${st.actions >= st.needActions ? '✅' : '🎮'} <b>${st.actions}/${st.needActions}</b> game actions in chat${st.actions >= st.needActions ? '' : ` (${st.needActions - st.actions} to go: <code>!fish</code>, <code>!mine</code>, <code>!chop</code>…)`}</div>${bar(st.actions, st.needActions)}</li>`);
      }
      if (st.needHours) {
        const played = st.needHours - st.hoursLeft;
        const left = st.hoursLeft >= 1 ? `${Math.ceil(st.hoursLeft)}h left` : `${Math.max(1, Math.ceil(st.hoursLeft * 60))} min left`;
        rows.push(`<li class="${st.hoursLeft <= 0 ? 'done' : ''}"><div>${st.hoursLeft <= 0 ? '✅' : '⏳'} <b>${st.needHours}h</b> since you first chatted${st.hoursLeft > 0 ? ` (${left})` : ''}</div>${bar(played, st.needHours)}</li>`);
      }
      return `<div class="lock-box"><b>🔒 You can't ${what} yet</b><p>New players unlock the card market and trades once both of these are done. It stops throwaway accounts from passing points around.</p><ul>${rows.join('')}</ul><p>Until then you can open packs, grade cards and sell them to the bank.</p></div>`;
    }

    // ---- Overlay (pack opening, card details) --------------------------------------------------
    function overlay(html, cls = '') {
      const o = document.createElement('div');
      o.className = `cd-overlay ${cls}`;
      o.innerHTML = `<div class="cd-modal">${html}</div>`;
      document.body.appendChild(o);
      document.body.classList.add('cd-noscroll');
      const close = () => {
        o.remove();
        if (!document.querySelector('.cd-overlay')) document.body.classList.remove('cd-noscroll');
      };
      o.addEventListener('click', (e) => {
        if (e.target === o || e.target.closest('[data-close]')) close();
      });
      const esc_ = (e) => {
        if (e.key === 'Escape') {
          close();
          document.removeEventListener('keydown', esc_);
        }
      };
      document.addEventListener('keydown', esc_);
      cleanups.push(close);
      return { el: o, close };
    }

    function burst(el, colors) {
      const rect = el.getBoundingClientRect();
      for (let i = 0; i < 36; i++) {
        const s = document.createElement('i');
        s.className = 'cd-spark';
        const a = Math.random() * Math.PI * 2;
        const d = 80 + Math.random() * 180;
        s.style.cssText = `left:${rect.left + rect.width / 2}px;top:${rect.top + rect.height / 2}px;background:${colors[i % colors.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px`;
        document.body.appendChild(s);
        setTimeout(() => s.remove(), 1100);
      }
    }

    // ---- Opening packs -----------------------------------------------------------------------
    async function openPacks(pack, count) {
      if (!loggedIn) return toast('Log in with Kick to open packs');
      if (data.points < pack.price * count) return toast(`You need ${fmt(pack.price * count)} pts`);
      const r = await post('/cards/open', { pack: pack.id, count });
      if (!r) return;
      setBalance(r.balance);
      const o = overlay(`<div class="rip" id="rip"></div>`, 'rip-overlay');
      const $rip = o.el.querySelector('#rip');
      let i = 0;
      const showPack = () => {
        $rip.innerHTML = `
          <div class="rip-count muted">${count > 1 ? `Pack ${i + 1} of ${count}` : ''}</div>
          <div class="rip-pack" id="rip-pack" title="Tear it open">${packHtml(pack, true)}</div>
          <button class="btn btn-primary big-btn" id="rip-tear">✂️ Tear it open</button>
          ${count > 1 ? '<button class="btn btn-sm" id="rip-skip">Reveal everything</button>' : ''}`;
        const tear = () => {
          const pk = $rip.querySelector('.pack');
          pk.classList.add('torn');
          $rip.querySelector('#rip-tear').remove();
          setTimeout(showCards, 650);
        };
        $rip.querySelector('#rip-pack').onclick = tear;
        $rip.querySelector('#rip-tear').onclick = tear;
        const skip = $rip.querySelector('#rip-skip');
        if (skip) skip.onclick = summary;
      };
      const showCards = () => {
        const cards = r.packs[i];
        window.MMOCardArt?.warm(cards.map((c) => ({ ...BASE[c.card], id: c.card })), 400);
        $rip.innerHTML = `
          <div class="rip-count muted">${count > 1 ? `Pack ${i + 1} of ${count} · ` : ''}Tap a card to flip it</div>
          <div class="rip-cards">${cards
            .map(
              (c, k) => `<div class="flip${c.rarityRank >= 3 ? ` tell tell-${c.rarity}` : ''}" data-k="${k}" style="--d:${k * 110}ms;--rc:${RAR[c.rarity].color}">
                <div class="flip-inner"><div class="flip-back"><div class="card-back"><span>⚔️</span><b>MMO</b></div></div><div class="flip-front">${cardHtml(c, { size: 170, tilt: true })}</div></div>
                <div class="flip-info">${finishTag(c)}<span class="cchip">${c.condition}</span><b>${fmt(c.value)} pts</b></div>
              </div>`
            )
            .join('')}</div>
          <div class="rip-actions"><button class="btn" id="rip-all">Flip all</button></div>`;
        const flips = [...$rip.querySelectorAll('.flip')];
        const flip = (f) => {
          if (f.classList.contains('open')) return;
          f.classList.add('open');
          const c = cards[+f.dataset.k];
          if (c.rarityRank >= 4 || c.finish === 'gold') {
            setTimeout(() => burst(f, [RAR[c.rarity].color, '#fff', '#ffc940']), 250);
            o.el.classList.add('flash');
            setTimeout(() => o.el.classList.remove('flash'), 700);
          }
          if (flips.every((x) => x.classList.contains('open'))) done();
        };
        flips.forEach((f) => (f.onclick = () => flip(f)));
        $rip.querySelector('#rip-all').onclick = () => flips.forEach((f, k) => setTimeout(() => flip(f), k * 180));
        const done = () => {
          const value = cards.reduce((s, c) => s + c.value, 0);
          const last = i === count - 1;
          $rip.querySelector('.rip-actions').innerHTML = `
            <span class="rip-value ${value >= pack.price ? 'win' : ''}">This pack: <b>${fmt(value)}</b> pts of cards (cost ${fmt(pack.price)})</span>
            ${last ? '<button class="btn btn-primary" id="rip-next">Done</button>' : `<button class="btn btn-primary" id="rip-next">Next pack →</button>`}`;
          $rip.querySelector('#rip-next').onclick = () => {
            if (last) return summary();
            i++;
            showPack();
          };
        };
      };
      const summary = () => {
        const all = r.packs.flat();
        const sel = new Set();
        const draw_ = () => {
          const sellValue = all.filter((c) => sel.has(c.id)).reduce((s, c) => s + c.buyback, 0);
          $rip.innerHTML = `
            <h2>${count > 1 ? `${count} packs opened` : 'Pack opened'}</h2>
            <p class="rip-value ${r.value >= r.cost ? 'win' : ''}">You pulled <b>${fmt(r.value)}</b> pts of cards for ${fmt(r.cost)} pts.</p>
            ${r.sets?.length ? `<p class="cd-good">${r.sets.map(esc).join('<br>')}</p>` : ''}
            <p class="muted" style="margin:0 0 8px">Tick cards to sell them back to the bank (${Math.round(cat.buyback * 100)}% of value${data.bankLeft != null ? `, ${fmt(data.bankLeft)} pts left today` : ''}), or keep everything.</p>
            <div class="sum-grid">${all
              .sort((a, b) => b.value - a.value)
              .map((c) => `<label class="sum-card${sel.has(c.id) ? ' sel' : ''}"><input type="checkbox" data-id="${c.id}" ${sel.has(c.id) ? 'checked' : ''}>${cardHtml(c, { size: 110 })}<span>${finishTag(c)} <b>${fmt(c.value)}</b></span></label>`)
              .join('')}</div>
            <div class="rip-actions">
              <button class="btn btn-sm" id="sum-commons">Tick commons</button>
              <button class="btn" id="sum-sell" ${sel.size ? '' : 'disabled'}>Sell ${sel.size || ''} to bank${sel.size ? ` (+${fmt(sellValue)} pts)` : ''}</button>
              <button class="btn btn-primary" id="sum-keep">Keep the rest</button>
            </div>`;
          $rip.querySelectorAll('input[data-id]').forEach((cb) => {
            cb.onchange = () => {
              if (cb.checked) sel.add(+cb.dataset.id);
              else sel.delete(+cb.dataset.id);
              draw_();
            };
          });
          $rip.querySelector('#sum-commons').onclick = () => {
            all.filter((c) => c.rarity === 'common' && c.finish === 'normal').forEach((c) => sel.add(c.id));
            draw_();
          };
          $rip.querySelector('#sum-sell').onclick = async () => {
            const res = await post('/cards/sell', { ids: [...sel] });
            if (!res) return;
            toast(res.message);
            o.close();
            refresh();
          };
          $rip.querySelector('#sum-keep').onclick = () => {
            o.close();
            refresh();
          };
        };
        draw_();
      };
      showPack();
    }

    // ---- Card details --------------------------------------------------------------------------
    async function details(c) {
      const mine = loggedIn && state.me && c.owner === state.me.username;
      const o = overlay(`<button class="cd-x" data-close aria-label="Close">✕</button><div class="cd-detail" id="cd-detail"></div>`);
      // Errors show inside the panel, next to the buttons (a toast would be hidden behind it).
      const say = (msg) => {
        const m = o.el.querySelector('#cd-msg');
        if (!m) return toast(msg);
        m.textContent = msg.charAt(0).toUpperCase() + msg.slice(1);
        m.hidden = false;
        m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      const post = async (path, body = {}) => {
        try {
          return await api(path, { method: 'POST', body });
        } catch (err) {
          say(err.message);
          return null;
        }
      };
      const $d = o.el.querySelector('#cd-detail');
      let pop = await api(`/cards/pop/${encodeURIComponent(c.card)}`).catch(() => null);
      const render = (card, anim = '') => {
        const b = BASE[card.card];
        const condBands = cat.conditions
          .map((k, idx) => {
            const lo = idx ? cat.conditions[idx - 1].max : 0;
            return `<span style="left:${lo * 100}%;width:${(Math.min(1, k.max) - lo) * 100}%" title="${k.name}">${k.short}</span>`;
          })
          .join('');
        const popRow = pop
          ? `<div class="cd-pop"><div class="muted">Population: ${fmt(pop.pulled)} pulled · ${fmt(pop.graded)} graded</div>
              <div class="pop-bars">${['black', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1']
                .map((k) => `<span title="${k === 'black' ? 'Pristine 10' : `Grade ${k}`}"><i style="height:${pop.graded ? Math.max(pop.pop[k] ? 6 : 0, ((pop.pop[k] || 0) / pop.graded) * 100) : 0}%"></i><b>${pop.pop[k] || 0}</b><small>${k === 'black' ? 'P10' : k}</small></span>`)
                .join('')}</div></div>`
          : '';
        const sub = card.sub
          ? `<div class="subgrades">${Object.entries(card.sub)
              .map(([k, v]) => `<div><small>${k}</small><b>${v % 1 ? v.toFixed(1) : v}</b></div>`)
              .join('')}</div>`
          : '';
        let actions = '';
        if (mine && card.status === 'owned') {
          actions = `
            ${card.grade ? '' : `<div class="cd-act"><button class="btn btn-primary" id="cd-grade" ${data.points < card.gradeFee ? 'disabled title="Not enough points"' : ''}>🔍 Grade it · ${fmt(card.gradeFee)} pts</button><p class="muted">With wear ${card.wear.toFixed(4)}: ${gradeHint(card.wear)}. The grade is final.</p></div>`}
            ${tradeLock('sell cards on the market') || `<div class="cd-act"><form id="cd-list" class="form-row"><input type="number" name="price" min="1" max="${Math.max(1000, card.value * 20)}" value="${Math.max(1, Math.round(card.value * 1.1))}" aria-label="Price"><button class="btn">🏪 List for sale</button></form><p class="muted">Value ${fmt(card.value)} pts · most you can ask: ${fmt(Math.max(1000, card.value * 20))} · you get the price minus ${Math.round(cat.fee * 100)}%.</p></div>`}
            <div class="cd-act"><button class="btn" id="cd-sell" ${data.bankLeft != null && card.buyback > data.bankLeft ? 'disabled' : ''}>💰 Sell to bank · +${fmt(card.buyback)} pts</button>${bankNote(card.buyback)}</div>`;
        } else if (mine && card.status === 'listed') {
          actions = `<div class="cd-act"><p>Listed for <b>${fmt(card.price)}</b> pts.</p><button class="btn" id="cd-unlist">Take it down</button></div>`;
        } else if (card.status === 'listed' && loggedIn) {
          actions = tradeLock('buy cards from other players') || `<div class="cd-act"><button class="btn btn-primary" id="cd-buy" ${data.points < card.price ? 'disabled' : ''}>Buy for ${fmt(card.price)} pts</button><p class="muted">Sold by ${esc(card.owner)}. Value ${fmt(card.value)} pts.</p></div>`;
        }
        $d.innerHTML = `
          <div class="cd-show ${anim}">${showCard(card, { size: 250, tilt: true })}</div>
          <div class="cd-info">
            <div class="muted">${b.setIcon} ${esc(b.setName)} · #${b.num}/${b.setSize}${card.serial ? ` · serial #${card.serial}` : ''}</div>
            <h2 style="margin:4px 0">${b.icon} ${esc(b.name)}</h2>
            <div class="cd-tags"><span class="cchip" style="color:${RAR[b.rarity].color}">${RAR[b.rarity].name}</span>${finishTag(card)}${chip(card)}${card.owner ? `<span class="cchip">Owner: <a href="${playerLink(card.owner)}">${esc(card.owner)}</a></span>` : ''}</div>
            <div class="cd-value"><span class="muted">Value</span><b>${fmt(card.value)}</b><span class="muted">pts</span>${card.marketFactor !== 1 ? `<span class="cchip ${card.marketFactor > 1 ? 'listed' : ''}" title="Catalog value ${fmt(card.baseValue)} pts, adjusted by recent player sales">📈 market ×${card.marketFactor.toFixed(2)}</span>` : ''}</div>
            <div class="cd-wear"><div class="muted">Wear <b>${card.wear.toFixed(5)}</b> (${card.condition}) · lower is better</div><div class="wear-bar">${condBands}<i style="left:${card.wear * 100}%"></i></div></div>
            ${sub}
            ${popRow}
            <div class="cd-msg" id="cd-msg" role="alert" hidden></div>
            ${actions}
          </div>`;
        const $ = (s) => $d.querySelector(s);
        if ($('#cd-grade')) {
          $('#cd-grade').onclick = async () => {
            if (!confirm(`Grade ${b.name} for ${fmt(card.gradeFee)} pts? The grade is final.`)) return;
            const res = await post(`/cards/${card.id}/grade`);
            if (!res) return;
            setBalance(res.balance);
            // Grading: a laser scan while the four subgrades fill in, then the grade slams down.
            const g = res.card;
            const SUB = [['centering', 'Centering'], ['corners', 'Corners'], ['edges', 'Edges'], ['surface', 'Surface']];
            $d.querySelector('.cd-show').innerHTML = `<div class="grading">${cardHtml(card, { size: 250 })}<div class="scan"></div>
              <div class="grade-subs">${SUB.map(([k, l]) => `<div class="gs" data-k="${k}"><span>${l}</span><i><em></em></i><b>–</b></div>`).join('')}</div>
              <div class="grade-slam" hidden></div></div>`;
            pop = await api(`/cards/pop/${encodeURIComponent(card.card)}`).catch(() => pop);
            const subs = g.sub || {};
            SUB.forEach(([k], n) => {
              setTimeout(() => {
                const row = $d.querySelector(`.gs[data-k="${k}"]`);
                if (!row) return;
                const v = subs[k] ?? g.grade;
                row.classList.add('on', v >= 10 ? 'ten' : v >= 9 ? 'hi' : v < 7 ? 'lo' : 'mid');
                row.querySelector('em').style.width = `${v * 10}%`;
                let shown = 0;
                const count = setInterval(() => {
                  shown = Math.min(v, shown + 0.5);
                  row.querySelector('b').textContent = shown % 1 ? shown.toFixed(1) : String(shown);
                  if (shown >= v) clearInterval(count);
                }, 25);
              }, 350 + n * 450);
            });
            setTimeout(() => {
              const slam = $d.querySelector('.grade-slam');
              if (!slam) return;
              slam.hidden = false;
              slam.className = `grade-slam ${g.black ? 'black' : g.grade >= 10 ? 'ten' : g.grade >= 9 ? 'hi' : ''}`;
              slam.innerHTML = `<small>${esc(g.black ? 'PRISTINE' : g.gradeLabel)}</small><b>${g.grade}</b>`;
              $d.querySelector('.grading')?.classList.add('shake');
              if (g.grade >= 9) burst(slam, g.black ? ['#111', '#fff', '#ffc940'] : g.grade >= 10 ? ['#ffc940', '#fff', '#ff5c7a', '#5ad8ff'] : ['#53fc18', '#fff', '#ffc940']);
            }, 350 + SUB.length * 450 + 250);
            setTimeout(() => {
              render(res.card, 'slabbed');
              toast(res.message);
              refreshQuiet();
            }, 350 + SUB.length * 450 + 1700);
          };
        }
        if ($('#cd-list')) {
          $('#cd-list').onsubmit = async (e) => {
            e.preventDefault();
            const res = await post(`/cards/${card.id}/list`, { price: Number(e.target.price.value) });
            if (!res) return;
            toast(res.message);
            o.close();
            refresh();
          };
        }
        if ($('#cd-sell')) {
          $('#cd-sell').onclick = async () => {
            if (!confirm(`Sell ${b.name} to the bank for ${fmt(card.buyback)} pts?`)) return;
            const res = await post('/cards/sell', { ids: [card.id] });
            if (!res) return;
            toast(res.message);
            o.close();
            refresh();
          };
        }
        if ($('#cd-unlist')) {
          $('#cd-unlist').onclick = async () => {
            const res = await post(`/cards/${card.id}/unlist`);
            if (!res) return;
            toast(res.message);
            o.close();
            refresh();
          };
        }
        if ($('#cd-buy')) {
          $('#cd-buy').onclick = async () => {
            if (!confirm(`Buy ${b.name} for ${fmt(card.price)} pts?`)) return;
            const res = await post(`/cards/${card.id}/buy`);
            if (!res) return;
            toast(res.message);
            o.close();
            refresh();
          };
        }
      };
      render(c);
    }
    const refreshQuiet = async () => {
      data = await api('/cards');
      const b = $app.querySelector('#cd-balance');
      if (b) b.textContent = fmt(data.points);
      if (tab === 'collection') drawTab();
    };

    // ---- Tabs ----------------------------------------------------------------------------------
    const TABS = [
      ['packs', '📦 Packs'],
      ['collection', '🗂️ Collection'],
      ['binder', '📖 Binder'],
      ['market', '🏪 Card market'],
      ['trades', '🤝 Trades'],
      ['hall', '🏆 Pulls & top'],
    ];

    function draw() {
      $app.innerHTML = `
        <div class="cards-page">
          <div class="panel-head cards-head" style="margin-bottom:4px">
            <h1 style="margin:0">🃏 Creature Cards</h1>
            ${
              loggedIn
                ? `<span class="badge gold" style="font-size:1rem">💰 <span id="cd-balance">${fmt(data.points)}</span> pts${data.collection ? ` · 🗂️ ${fmt(data.collection.cards.length)} cards worth ${fmt(data.collection.value)}` : ''}</span>`
                : state.loginEnabled
                  ? `<a class="btn btn-primary" href="/auth/login">Log in with Kick to collect</a>`
                  : ''
            }
          </div>
          <p class="muted">Open packs of fantasy creature cards with your points. Every card has its own <b>wear</b>: send clean ones to be <b>graded</b> 1 to 10, then keep them, sell them back to the bank, or trade them with other players.</p>
          <div class="tabs">${TABS.map(([id, label]) => `<button class="tab ${id === tab ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
          <div id="cd-tab"></div>
        </div>`;
      $app.querySelectorAll('[data-tab]').forEach((b) => {
        b.onclick = () => {
          tab = b.dataset.tab;
          history.replaceState(null, '', `#/cards?tab=${tab}`);
          $app.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
          drawTab();
        };
      });
      drawTab();
    }

    const $tab = () => $app.querySelector('#cd-tab');
    function drawTab() {
      ({ packs: drawPacks, collection: drawCollection, binder: drawBinder, market: drawMarket, trades: drawTrades, hall: drawHall }[tab] || drawPacks)();
    }

    // Grid of cards; clicking one opens its details.
    function grid(cards, { size = 150, extra = () => '' } = {}) {
      if (!cards.length) return '';
      if (window.innerWidth < 560) size = Math.round(size * 0.7);
      const html = `<div class="cd-grid" style="--cw:${size}px">${cards
        .map((c) => `<div class="cd-cell" data-id="${c.id}">${showCard(c, { size, tilt: true })}<div class="cd-meta">${finishTag(c)}${chip(c)}</div><div class="cd-meta"><b>${fmt(c.value)} pts</b>${extra(c)}</div></div>`)
        .join('')}</div>`;
      return html;
    }
    function bindGrid(el, cards) {
      el.querySelectorAll('.cd-cell').forEach((cell) => {
        cell.onclick = (e) => {
          if (e.target.closest('button, a, input')) return;
          const c = cards.find((x) => x.id === +cell.dataset.id);
          if (c) details(c);
        };
      });
    }

    function drawPacks() {
      const pct = (x) => (x >= 0.1 ? `${Math.round(x * 100)}%` : `${(x * 100).toFixed(1)}%`);
      const tiers = [
        ['scout', 'Scout packs', '3 cards. A cheap way to start a collection.'],
        ['booster', 'Boosters', '5 cards: 3 commons, an uncommon and a rare or better.'],
        ['elite', 'Elite', 'Mixed sets, 5 cards, an epic or better guaranteed.'],
        ['vault', 'Vault', '3 cards: two epics and a legendary or better.'],
      ];
      $tab().innerHTML = tiers
        .map(([t, title, blurb]) => {
          const packs = cat.packs.filter((p) => p.tier === t);
          return `<section class="panel" style="margin-top:14px"><div class="panel-head"><h2>${title}</h2><span class="muted">${blurb}</span></div>
            <div class="pack-grid">${packs
              .map(
                (p) => `<div class="pack-tile">
                  ${packHtml(p)}
                  <div class="pack-info">
                    <div class="pack-price"><b>${fmt(p.price)}</b> pts</div>
                    <div class="muted" style="font-size:.8rem">Average pull ≈ ${fmt(p.ev)} pts</div>
                    <div class="odds"><span class="muted">Best card:</span>${Object.entries(p.slots[p.slots.length - 1])
                      .map(([r, n]) => `<span style="color:${RAR[r].color}" title="${RAR[r].name}">${RAR[r].name} ${pct(n)}</span>`)
                      .join('')}</div>
                    <div class="form-row" style="margin-top:6px"><button class="btn btn-primary btn-sm" data-open="${p.id}" data-n="1">Open 1</button><button class="btn btn-sm" data-open="${p.id}" data-n="5">Open 5</button></div>
                  </div>
                </div>`
              )
              .join('')}</div></section>`;
        })
        .join('') +
        `<section class="panel" style="margin-top:14px"><h2 style="margin-top:0">How it works</h2><ul class="cd-how">
          <li>Every card can come out <b>Holo</b> (${pct(cat.holoChance)}, 3× value) or <b>Gold Foil</b> (${pct(cat.goldChance)}, 10× value).</li>
          <li><b>Wear</b> is a number from 0 (flawless) to 1 (wrecked). Lower wear means a better condition: ${cat.conditions.map((c) => `${c.name} under ${c.max}`).join(', ')}.</li>
          <li><b>Grading</b> costs a fee and seals the card in a slab with a grade from 1 to 10 and four subgrades (centering, corners, edges, surface). A <b>GEM MINT 10</b> is worth 4× a raw card; all four subgrades at 10 make a <b>PRISTINE 10 black label</b> (10×). Low-wear cards usually grade well, but centering and hidden flaws can surprise you.</li>
          <li>Sell any card back to the bank for ${Math.round(cat.buyback * 100)}% of its value${cat.bankFullValue ? ` (a fifth of that rate on value above ${fmt(cat.bankFullValue)} pts)` : ''}${cat.bankDailyLimit ? `, up to ${fmt(cat.bankDailyLimit)} pts a day` : ''}. Big cards are better sold on the card market or traded with another player. A card's value follows what players actually pay for it on the market (between ×0.5 and ×2).</li>
          <li>Own every card in a set to earn its reward and title: ${cat.sets.map((s) => `${s.icon} ${esc(s.name)} (${fmt(s.reward)} pts, "${esc(s.title)}")`).join(', ')}.</li>
        </ul></section>`;
      $tab().querySelectorAll('[data-open]').forEach((b) => {
        b.onclick = () => openPacks(cat.packs.find((p) => p.id === b.dataset.open), +b.dataset.n);
      });
    }

    function drawCollection() {
      if (!loggedIn) return ($tab().innerHTML = `<div class="panel empty"><span class="ic">🗂️</span>Log in to see your cards.</div>`);
      const all = data.collection.cards;
      if (!all.length) return ($tab().innerHTML = `<div class="panel empty"><span class="ic">📦</span>No cards yet. <a href="#/cards?tab=packs" data-go="packs">Open your first pack!</a></div>`);
      let selecting = false;
      const sel = new Set();
      const list = () => {
        const q = filters.q.toLowerCase();
        const out = all.filter((c) => (!filters.set || c.set === filters.set) && (!filters.rarity || c.rarity === filters.rarity) && (!filters.graded || c.grade) && (!q || c.name.toLowerCase().includes(q)));
        const by = {
          value: (a, b) => b.value - a.value,
          newest: (a, b) => b.id - a.id,
          rarity: (a, b) => b.rarityRank - a.rarityRank || b.value - a.value,
          wear: (a, b) => a.wear - b.wear,
          number: (a, b) => a.set.localeCompare(b.set) || a.num - b.num,
        }[filters.sort];
        return out.sort(by);
      };
      $tab().innerHTML = `
        <section class="panel" style="margin-top:14px">
          <div class="cd-filters">
            <input type="search" class="guide-search" id="f-q" placeholder="Search cards" value="${esc(filters.q)}">
            <select id="f-set"><option value="">All sets</option>${cat.sets.map((s) => `<option value="${s.id}" ${filters.set === s.id ? 'selected' : ''}>${s.icon} ${esc(s.name)}</option>`).join('')}</select>
            <select id="f-rarity"><option value="">All rarities</option>${Object.entries(RAR).map(([id, r]) => `<option value="${id}" ${filters.rarity === id ? 'selected' : ''}>${r.name}</option>`).join('')}</select>
            <select id="f-sort">${[['value', 'Most valuable'], ['newest', 'Newest'], ['rarity', 'Rarity'], ['wear', 'Lowest wear'], ['number', 'Set number']].map(([v, l]) => `<option value="${v}" ${filters.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <label class="muted"><input type="checkbox" id="f-graded" ${filters.graded ? 'checked' : ''}> Graded only</label>
            <button class="btn btn-sm" id="f-select">Select to sell</button>
          </div>
          <div id="sel-bar" class="sel-bar" hidden></div>
          <div id="col-grid"></div>
        </section>`;
      const $g = $tab().querySelector('#col-grid');
      const $bar = $tab().querySelector('#sel-bar');
      const drawGrid = () => {
        const cards = list();
        $g.innerHTML = cards.length
          ? grid(cards, { extra: (c) => (c.status === 'listed' ? `<span class="cchip listed">Listed ${fmt(c.price)}</span>` : selecting && c.status === 'owned' ? `<input type="checkbox" class="sel-cb" data-sel="${c.id}" ${sel.has(c.id) ? 'checked' : ''}>` : '') })
          : '<p class="muted">No cards match.</p>';
        bindGrid($g, cards);
        $g.querySelectorAll('[data-sel]').forEach((cb) => {
          cb.onchange = () => {
            if (cb.checked) sel.add(+cb.dataset.sel);
            else sel.delete(+cb.dataset.sel);
            drawBar();
          };
        });
      };
      const drawBar = () => {
        $bar.hidden = !selecting;
        const pts = all.filter((c) => sel.has(c.id)).reduce((s, c) => s + c.buyback, 0);
        $bar.innerHTML = `<span>${sel.size} selected · bank pays <b>${fmt(pts)}</b> pts${data.bankLeft != null ? ` <span class="muted">(${fmt(data.bankLeft)} left today)</span>` : ''}</span>
          <button class="btn btn-sm" id="sel-commons">Select raw commons</button>
          <button class="btn btn-sm" id="sel-none">Clear</button>
          <button class="btn btn-primary btn-sm" id="sel-sell" ${sel.size ? '' : 'disabled'}>Sell to bank</button>`;
        $bar.querySelector('#sel-commons').onclick = () => {
          list().filter((c) => c.status === 'owned' && c.rarity === 'common' && !c.grade && c.finish === 'normal').forEach((c) => sel.add(c.id));
          drawGrid();
          drawBar();
        };
        $bar.querySelector('#sel-none').onclick = () => {
          sel.clear();
          drawGrid();
          drawBar();
        };
        $bar.querySelector('#sel-sell').onclick = async () => {
          if (!confirm(`Sell ${sel.size} cards to the bank for ${fmt(pts)} pts?`)) return;
          const r = await post('/cards/sell', { ids: [...sel] });
          if (!r) return;
          toast(r.message);
          refresh();
        };
      };
      const $ = (s) => $tab().querySelector(s);
      $('#f-q').oninput = (e) => {
        filters.q = e.target.value.trim();
        drawGrid();
      };
      for (const [id, key] of [['#f-set', 'set'], ['#f-rarity', 'rarity'], ['#f-sort', 'sort']]) {
        $(id).onchange = (e) => {
          filters[key] = e.target.value;
          drawGrid();
        };
      }
      $('#f-graded').onchange = (e) => {
        filters.graded = e.target.checked;
        drawGrid();
      };
      $('#f-select').onclick = (e) => {
        selecting = !selecting;
        e.target.textContent = selecting ? 'Done selecting' : 'Select to sell';
        if (!selecting) sel.clear();
        drawBar();
        drawGrid();
      };
      drawGrid();
    }

    function drawBinder() {
      const bw = window.innerWidth < 560 ? 96 : 120;
      const owned = new Map();
      for (const c of data.collection?.cards || []) if (!owned.has(c.card) || owned.get(c.card).value < c.value) owned.set(c.card, c);
      const progress = Object.fromEntries((data.collection?.sets || []).map((s) => [s.id, s]));
      $tab().innerHTML = cat.sets
        .map((s) => {
          const p = progress[s.id] || { have: 0, done: false };
          return `<section class="panel binder" style="margin-top:14px;--set:${s.color}">
            <div class="panel-head"><h2>${s.icon} ${esc(s.name)}</h2><span class="muted">${p.have}/${s.size}${p.done ? ' · ✅ complete' : ''} · reward ${fmt(s.reward)} pts + "${esc(s.title)}"</span></div>
            <div class="raid-bar" style="margin-bottom:12px"><span style="width:${(p.have / s.size) * 100}%"></span></div>
            <div class="cd-grid binder-grid" style="--cw:${bw}px">${s.cards
              .map((c) => {
                const mine = owned.get(c.id);
                return mine
                  ? `<div class="cd-cell" data-id="${mine.id}">${showCard(mine, { size: bw, tilt: true })}</div>`
                  : `<div class="cd-cell missing"><div class="tcard-missing" style="--w:${bw}px;--rc:${RAR[c.rarity].color}"><span>${c.icon}</span><b>#${c.num}</b><small>${esc(c.name)}</small><i>${RAR[c.rarity].name}</i></div></div>`;
              })
              .join('')}</div>
          </section>`;
        })
        .join('');
      bindGrid($tab(), [...owned.values()]);
    }

    async function drawMarket() {
      $tab().innerHTML = '<div class="skeleton">Loading…</div>';
      const m = await api('/cards/market');
      const list = () => {
        const q = marketFilters.q.toLowerCase();
        const out = m.listings.filter((c) => (!marketFilters.rarity || c.rarity === marketFilters.rarity) && (!marketFilters.graded || c.grade) && (!q || c.name.toLowerCase().includes(q) || c.owner.toLowerCase().includes(q)));
        const by = { newest: () => 0, cheap: (a, b) => a.price - b.price, value: (a, b) => b.value - a.value, deal: (a, b) => a.price / a.value - b.price / b.value }[marketFilters.sort];
        return out.sort(by);
      };
      $tab().innerHTML = `
        <section class="panel" style="margin-top:14px">
          <p class="muted" style="margin-top:0">Cards other players are selling. The market keeps ${Math.round(m.fee * 100)}% of each sale. To sell one of yours, open it from your collection.</p>
          <div class="cd-filters">
            <input type="search" class="guide-search" id="m-q" placeholder="Search cards or sellers" value="${esc(marketFilters.q)}">
            <select id="m-rarity"><option value="">All rarities</option>${Object.entries(RAR).map(([id, r]) => `<option value="${id}" ${marketFilters.rarity === id ? 'selected' : ''}>${r.name}</option>`).join('')}</select>
            <select id="m-sort">${[['newest', 'Newest'], ['cheap', 'Cheapest'], ['value', 'Most valuable'], ['deal', 'Best deal (price ÷ value)']].map(([v, l]) => `<option value="${v}" ${marketFilters.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <label class="muted"><input type="checkbox" id="m-graded" ${marketFilters.graded ? 'checked' : ''}> Graded only</label>
          </div>
          <div id="m-grid"></div>
        </section>`;
      const $g = $tab().querySelector('#m-grid');
      const drawGrid = () => {
        const cards = list();
        $g.innerHTML = cards.length
          ? grid(cards, { extra: (c) => `<span class="cchip listed">${fmt(c.price)} pts</span><span class="muted" style="font-size:.75rem">by ${esc(c.owner)}</span>` })
          : `<div class="empty"><span class="ic">🏪</span>${m.listings.length ? 'Nothing matches.' : 'No cards for sale yet.'}</div>`;
        bindGrid($g, cards);
      };
      $tab().querySelector('#m-q').oninput = (e) => {
        marketFilters.q = e.target.value.trim();
        drawGrid();
      };
      $tab().querySelector('#m-rarity').onchange = (e) => {
        marketFilters.rarity = e.target.value;
        drawGrid();
      };
      $tab().querySelector('#m-sort').onchange = (e) => {
        marketFilters.sort = e.target.value;
        drawGrid();
      };
      $tab().querySelector('#m-graded').onchange = (e) => {
        marketFilters.graded = e.target.checked;
        drawGrid();
      };
      drawGrid();
    }

    async function drawTrades() {
      if (!loggedIn) return ($tab().innerHTML = `<div class="panel empty"><span class="ic">🤝</span>Log in to trade cards.</div>`);
      $tab().innerHTML = '<div class="skeleton">Loading…</div>';
      const { trades } = await api('/cards/trades');
      const mini = (cards) => (cards.length ? `<div class="mini-row">${cards.map((c) => `<div class="tmini" title="${esc(c.name)} · ${fmt(c.value)} pts">${showCard(c, { size: 80 })}</div>`).join('')}</div>` : '<span class="muted">no cards</span>');
      const tradeRow = (t) => {
        const youGive = t.incoming ? t.want : t.give;
        const youGet = t.incoming ? t.give : t.want;
        const ptsGive = t.incoming ? t.pointsWant : t.pointsGive;
        const ptsGet = t.incoming ? t.pointsGive : t.pointsWant;
        const vGive = t.incoming ? t.valueWant : t.valueGive;
        const vGet = t.incoming ? t.valueGive : t.valueWant;
        const other = t.incoming ? t.from : t.to;
        return `<div class="trade ${t.status}">
          <div class="trade-head"><b>${t.incoming ? `From <a href="${playerLink(other)}">${esc(other)}</a>` : `To <a href="${playerLink(other)}">${esc(other)}</a>`}</b>
            <span class="cchip ${t.status === 'open' ? 'listed' : ''}">${t.status}</span><span class="muted" data-ts="${t.createdAt}">${ago(t.createdAt)}</span></div>
          ${t.message ? `<p class="muted" style="margin:4px 0">“${esc(t.message)}”</p>` : ''}
          <div class="trade-sides">
            <div><div class="muted">You give · ${fmt(vGive)} pts value</div>${mini(youGive)}${ptsGive ? `<div>+ <b>${fmt(ptsGive)}</b> pts</div>` : ''}</div>
            <div class="trade-arrow">⇄</div>
            <div><div class="muted">You get · ${fmt(vGet)} pts value</div>${mini(youGet)}${ptsGet ? `<div>+ <b>${fmt(ptsGet)}</b> pts</div>` : ''}</div>
          </div>
          ${
            t.status === 'open'
              ? `<div class="form-row">${t.incoming ? `<button class="btn btn-primary btn-sm" data-t="accept" data-id="${t.id}">Accept</button><button class="btn btn-sm" data-t="decline" data-id="${t.id}">Decline</button>` : `<button class="btn btn-sm" data-t="cancel" data-id="${t.id}">Cancel offer</button>`}<span class="muted" style="font-size:.8rem">Expires ${new Date(t.expiresAt).toLocaleDateString()}</span></div>`
              : ''
          }
        </div>`;
      };
      $tab().innerHTML = `
        <section class="panel" style="margin-top:14px">
          <div class="panel-head"><h2>New trade</h2></div>
          ${data.blocked ? tradeLock('trade cards') : `<form id="tr-find" class="form-row"><input type="text" name="name" style="max-width:260px" placeholder="Player name" required value="${esc(query?.get('with') || '')}"><button class="btn">Load their cards</button></form><div id="tr-build"></div>`}
        </section>
        <section class="panel" style="margin-top:14px">
          <div class="panel-head"><h2>Your offers</h2></div>
          ${trades.length ? trades.map(tradeRow).join('') : '<p class="muted" style="margin:0">No trades yet.</p>'}
        </section>`;
      $tab().querySelectorAll('[data-t]').forEach((b) => {
        b.onclick = async () => {
          if (b.dataset.t === 'accept' && !confirm('Accept this trade?')) return;
          const r = await post(`/cards/trades/${b.dataset.id}/${b.dataset.t}`);
          if (!r) return;
          toast(r.message);
          await refreshQuiet();
          drawTrades();
        };
      });
      const find = $tab().querySelector('#tr-find');
      if (!find) return;
      const build = async (name) => {
        const $b = $tab().querySelector('#tr-build');
        let them;
        try {
          them = await api(`/cards/player/${encodeURIComponent(name)}`);
        } catch {
          $b.innerHTML = '<p class="muted">No player by that name.</p>';
          return;
        }
        if (them.username.toLowerCase() === state.me.username.toLowerCase()) {
          $b.innerHTML = "<p class=\"muted\">That's you!</p>";
          return;
        }
        const mine = data.collection.cards.filter((c) => c.status === 'owned');
        const theirs = them.cards.filter((c) => c.status === 'owned');
        const give = new Set();
        const want = new Set();
        const pick = (cards, set, side) =>
          cards.length
            ? `<div class="pick-grid">${cards
                .sort((a, b) => b.value - a.value)
                .map((c) => `<button type="button" class="pick${set.has(c.id) ? ' on' : ''}" data-side="${side}" data-id="${c.id}" title="${esc(c.name)} · ${fmt(c.value)} pts">${showCard(c, { size: 90 })}<span>${fmt(c.value)}</span></button>`)
                .join('')}</div>`
            : '<p class="muted">No cards to trade.</p>';
        const render = () => {
          const v = (cards, set) => cards.filter((c) => set.has(c.id)).reduce((s, c) => s + c.value, 0);
          $b.innerHTML = `
            <div class="trade-build">
              <div><h3>You give <span class="muted">(${give.size} · ${fmt(v(mine, give))} pts)</span></h3>${pick(mine, give, 'give')}<label class="muted">+ points <input type="number" id="tr-pg" min="0" value="0" style="max-width:120px"></label></div>
              <div><h3>You want from ${esc(them.username)} <span class="muted">(${want.size} · ${fmt(v(theirs, want))} pts)</span></h3>${pick(theirs, want, 'want')}<label class="muted">+ points <input type="number" id="tr-pw" min="0" value="0" style="max-width:120px"></label></div>
            </div>
            <div class="form-row" style="margin-top:10px"><input type="text" id="tr-msg" maxlength="140" placeholder="Message (optional)"><button class="btn btn-primary" id="tr-send" ${give.size || want.size ? '' : 'disabled'}>Send offer</button></div>`;
          $b.querySelectorAll('.pick').forEach((p) => {
            p.onclick = () => {
              const set = p.dataset.side === 'give' ? give : want;
              const id = +p.dataset.id;
              if (set.has(id)) set.delete(id);
              else set.add(id);
              render();
            };
          });
          $b.querySelector('#tr-send').onclick = async () => {
            const r = await post('/cards/trades', {
              to: them.username,
              give: [...give],
              want: [...want],
              pointsGive: Number($b.querySelector('#tr-pg').value) || 0,
              pointsWant: Number($b.querySelector('#tr-pw').value) || 0,
              message: $b.querySelector('#tr-msg').value,
            });
            if (!r) return;
            toast(r.message);
            drawTrades();
          };
        };
        render();
      };
      find.onsubmit = (e) => {
        e.preventDefault();
        build(find.name.value.trim());
      };
      if (query?.get('with')) build(query.get('with'));
    }

    function drawHall() {
      const pulls = data.pulls;
      $tab().innerHTML = `
        <section class="panel" style="margin-top:14px"><div class="panel-head"><h2>✨ Recent big pulls</h2></div>
          ${pulls.length ? grid(pulls, { size: 130, extra: (c) => `<span class="muted" style="font-size:.75rem"><a href="${playerLink(c.owner)}">${esc(c.owner)}</a> · <span data-ts="${c.createdAt}">${ago(c.createdAt)}</span></span>` }) : '<p class="muted" style="margin:0">No big pulls yet. Be the first!</p>'}
        </section>
        <section class="panel" style="margin-top:14px"><div class="panel-head"><h2>🔍 Freshly graded</h2></div>
          ${data.graded.length ? grid(data.graded, { size: 130, extra: (c) => `<span class="muted" style="font-size:.75rem"><a href="${playerLink(c.owner)}">${esc(c.owner)}</a></span>` }) : '<p class="muted" style="margin:0">Nothing graded yet.</p>'}
        </section>
        <section class="panel" style="margin-top:14px"><div class="panel-head"><h2>🏆 Top collections</h2></div>
          ${
            data.top.length
              ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th class="num">Cards</th><th class="num">Value</th><th>Best card</th><th></th></tr></thead><tbody>${data.top
                  .map((t, i) => `<tr><td>${i + 1}</td><td><a href="${playerLink(t.username)}">${esc(t.username)}</a></td><td class="num">${fmt(t.cards)}</td><td class="num"><b>${fmt(t.value)}</b></td><td>${t.best.icon} ${esc(t.best.name)} <span class="muted">(${fmt(t.best.value)})</span></td><td>${loggedIn && state.me.username !== t.username ? `<a class="btn btn-sm" href="#/cards?tab=trades&with=${encodeURIComponent(t.username)}">Trade</a>` : ''}</td></tr>`)
                  .join('')}</tbody></table></div>`
              : '<p class="muted" style="margin:0">No collections yet.</p>'
          }
        </section>`;
      bindGrid($tab(), [...pulls, ...data.graded]);
    }

    $app.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (!go) return;
      e.preventDefault();
      tab = go.dataset.go;
      draw();
    });

    draw();
    return () => cleanups.forEach((fn) => fn());
  };
})();
