// The Town page (#/town): everything built from Construction parts. The town's buildings (the whole
// chat donates parts; every level is bonus XP for everyone), building your own house, player shops
// and their storefronts (#/town/shop/<name>). app.js calls window.MMOTown($app, helpers, params).
(() => {
  window.MMOTown = async ($app, { api, toast, esc, fmt, state, playerLink }, params = []) => {
    let d = await api('/town');
    const loggedIn = !!d.username;
    let picked = null; // building chosen for the next contribution (null = the one being built now)

    const post = async (path, body = {}) => {
      try {
        const r = await api(path, { method: 'POST', body });
        toast(r.message || r.error || 'Done.');
        d = await api('/town');
        draw();
        return r;
      } catch (err) {
        toast(err.message);
        return null;
      }
    };
    const pct = (a, b) => (b ? Math.min(100, (a / b) * 100) : 100);
    const pips = (n, max) => Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');

    // A blueprint's checklist: each part with have / need.
    const checklist = (bp) =>
      `<ul class="bp-list">${bp.parts
        .map((p) => {
          const ok = p.have === null ? null : p.have >= p.qty;
          return `<li class="${ok === null ? '' : ok ? 'ok' : 'miss'}"><span>${esc(p.name)}</span><b>${p.have === null ? p.qty : `${fmt(p.have)} / ${fmt(p.qty)}`}</b></li>`;
        })
        .join('')}</ul>
      <div class="muted bp-meta">${esc(bp.minTierName)} parts or better · Construction ${bp.construction}${bp.levelOk === false ? ' <b class="bad">(level too low)</b>' : ''}</div>`;
    const ready = (bp) => bp.levelOk && bp.parts.every((p) => p.have >= p.qty);

    function townHtml() {
      const t = d.town;
      if (!t.on) return '<section class="panel"><p class="muted">The town is switched off right now.</p></section>';
      const target = picked || t.focus;
      const cards = t.buildings
        .map((b) => {
          const done = b.level >= t.maxLevel;
          return `<div class="tb-card ${b.id === target && !done ? 'is-target' : ''} ${done ? 'is-done' : ''}" data-b="${b.id}">
            <div class="tb-head"><span class="tb-icon">${b.icon}</span><div><h3>${esc(b.name)}</h3><div class="tb-pips">${pips(b.level, t.maxLevel)}</div></div>${b.id === t.focus ? '<span class="badge">Building now</span>' : ''}</div>
            <div class="tb-bonus">${b.level ? `<b>+${Math.round(b.bonus * 100)}% XP</b>` : '<span class="muted">No bonus yet</span>'} <span class="muted">${esc(b.text)}</span></div>
            ${done ? '<div class="tb-finished">🏆 Finished</div>' : `<div class="project-bar small"><span style="width:${pct(b.progress, b.goal).toFixed(2)}%"></span><b>${fmt(b.progress)} / ${fmt(b.goal)} → level ${b.level + 1}</b></div>`}
            <div class="tb-foot muted">${b.donors ? `${fmt(b.donors)} builder${b.donors === 1 ? '' : 's'}${b.top[0] ? ` · top: <a href="${playerLink(b.top[0].username)}">${esc(b.top[0].username)}</a>` : ''}` : 'No parts yet'}${loggedIn && !done ? ` <button class="btn btn-sm" data-pick="${b.id}">${b.id === target ? '✓ Giving here' : 'Give here'}</button>` : ''}</div>
          </div>`;
        })
        .join('');
      const tb = t.buildings.find((b) => b.id === target);
      const partOpts = (d.parts || []).map((p) => `<option value="${p.id}">${p.icon} ${esc(p.name)} ×${fmt(p.qty)} (${fmt(p.value)} each)</option>`).join('');
      const form = !loggedIn
        ? state.loginEnabled
          ? '<p><a class="btn btn-primary" href="/auth/login">Log in with Kick to build</a></p>'
          : '<p class="muted">Give parts from chat: <code>!contribute 5 walls</code></p>'
        : !d.parts?.length
          ? `<p class="muted">You have no building parts. Make them with <code>!saw planks</code> + <code>!saw nails</code>, then <code>!build frame</code> / <code>door</code> / <code>wall</code> / <code>roof</code>.</p>`
          : `<form id="tc-form" class="form-row" style="flex-wrap:wrap;align-items:center">
              <select name="item" aria-label="Part">${partOpts}</select>
              <input type="number" name="qty" min="1" value="1" style="max-width:100px" aria-label="How many">
              <button class="btn btn-primary">Give to ${tb ? `${tb.icon} ${esc(tb.name)}` : 'the town'}</button>
              <button type="button" class="btn btn-sm" id="tc-all">Give all of that part</button>
            </form>`;
      return `
        <section class="panel town-panel">
          <div class="panel-head"><h2>🏘️ The Town</h2><span class="muted">Each level: +${Math.round(t.perLevel * 100)}% XP in its skills, for everyone</span></div>
          <p style="margin-top:0">The whole chat builds the town together by donating building parts. Every part counts for its value, and leftover parts carry over into the next level.</p>
          <div class="tb-grid">${cards}</div>
          <div class="tc-give">${form}<p class="muted" style="font-size:.85rem;margin:6px 0 0">In chat: <code>!contribute 5 walls</code>, <code>!contribute forge all frames</code>, <code>!town</code>. Builders who give 25,000+ pts of parts earn <b>the Builder</b>; the biggest builder is <b>the Town Founder</b>.</p></div>
          ${t.top.length ? `<h3>Top builders</h3><ol class="donors">${t.top.map((x) => `<li><a href="${playerLink(x.username)}">${esc(x.username)}</a> <b>${fmt(x.value)}</b></li>`).join('')}</ol>` : ''}
        </section>`;
    }

    function housesHtml() {
      if (!d.housesOn) return '';
      return `
        <section class="panel">
          <div class="panel-head"><h2>🏠 Build your own house</h2><span class="muted">${d.characterLevel !== null ? `Character level ${d.characterLevel} · Construction ${d.construction}` : ''}</span></div>
          <p style="margin-top:0">Every house can be bought with points in the <a href="#/shop">Shop</a>, or built by hand from parts. Both need the same character level, and you move up one house at a time.</p>
          <div class="bp-grid">${d.houses
            .map(
              (h) => `<div class="bp-card ${h.owned ? 'owned' : ''} ${h.below ? 'below' : ''}">
              <div class="bp-title">${h.icon} <b>${esc(h.name)}</b> <span class="muted">+${h.charges} stamina · char. level ${h.level}</span></div>
              ${h.owned ? '<div class="bp-state">✅ Your home</div>' : h.below ? '<div class="bp-state muted">Moved past</div>' : h.blueprint ? checklist(h.blueprint) : '<p class="muted">Can only be bought.</p>'}
              ${h.next && loggedIn && h.blueprint ? `<button class="btn ${ready(h.blueprint) && d.characterLevel >= h.level ? 'btn-primary' : ''}" data-build-house ${ready(h.blueprint) && d.characterLevel >= h.level ? '' : 'disabled'}>🏗️ Build it</button>${d.characterLevel < h.level ? `<div class="muted bp-meta">Needs character level ${h.level}</div>` : ''}` : ''}
            </div>`
            )
            .join('')}</div>
        </section>`;
    }

    function shopsHtml() {
      if (!d.shopsOn) return '';
      const fronts = d.storefronts.length
        ? `<div class="sf-grid">${d.storefronts
            .map(
              (s) => `<a class="sf-card" href="#/town/shop/${encodeURIComponent(s.username)}"><span class="sf-icon">${s.icon}</span><div><b>${esc(s.username)}'s ${esc(s.name)}</b><div class="muted">${fmt(s.count)} item${s.count === 1 ? '' : 's'} for sale · ${Math.round(s.feeCut * 100)}% off fees</div></div></a>`
            )
            .join('')}</div>`
        : '<p class="muted">No shops yet. Build the first one!</p>';
      return `
        <section class="panel">
          <div class="panel-head"><h2>🏪 Player shops</h2><span class="muted"><code>!stall build</code> · <code>!stall name</code></span></div>
          <p style="margin-top:0">A shop is your storefront on the <a href="#/market">Market</a>: more listings at once, a smaller fee on everything you sell, and your own page that lists your goods.</p>
          <div class="bp-grid">${d.shops
            .map(
              (s) => `<div class="bp-card ${s.owned ? 'owned' : ''} ${s.below ? 'below' : ''}">
              <div class="bp-title">${s.icon} <b>${esc(s.name)}</b> <span class="muted">+${s.slots} listings · ${Math.round(s.feeCut * 100)}% off the fee</span></div>
              ${s.owned ? '<div class="bp-state">✅ Yours</div>' : s.below ? '<div class="bp-state muted">Upgraded past</div>' : checklist(s.blueprint)}
              ${s.next && loggedIn ? `<button class="btn ${ready(s.blueprint) ? 'btn-primary' : ''}" data-build-stall ${ready(s.blueprint) ? '' : 'disabled'}>🏗️ Build it</button>` : ''}
            </div>`
            )
            .join('')}</div>
          <h3>Storefronts</h3>${fronts}
        </section>`;
    }

    function partsHtml() {
      if (!loggedIn) return '';
      return `
        <section class="panel">
          <div class="panel-head"><h2>🧱 Your building parts</h2><span class="muted">Make more: <code>!build frame</code> · <code>door</code> · <code>wall</code> · <code>roof</code></span></div>
          ${d.parts.length ? `<div class="part-chips">${d.parts.map((p) => `<span class="cchip">${p.icon} ${esc(p.name)} <b>×${fmt(p.qty)}</b></span>`).join('')}</div>` : '<p class="muted">None yet. Planks (<code>!saw planks</code>, needs a Saw) + nails (<code>!saw nails</code>, needs a Smithing Hammer) → <code>!build</code>.</p>'}
        </section>`;
    }

    // #/town/shop/<name>: one player's storefront.
    function storefrontHtml(name) {
      const s = d.storefronts.find((x) => x.username.toLowerCase() === name.toLowerCase());
      if (!s) return `<section class="panel"><p><a href="#/town">← The Town</a></p><p class="muted">${esc(name)} doesn't have a shop.</p></section>`;
      return `
        <section class="panel storefront">
          <p style="margin:0 0 8px"><a href="#/town">← The Town</a></p>
          <div class="sf-hero"><span class="sf-icon big">${s.icon}</span><div><h2 style="margin:0">${esc(s.username)}'s ${esc(s.name)}</h2><div class="muted"><a href="${playerLink(s.username)}">Profile</a> · ${fmt(s.count)} item${s.count === 1 ? '' : 's'} on the shelves</div></div></div>
          ${
            s.listings.length
              ? `<div class="sf-shelf">${s.listings
                  .map(
                    (l) => `<div class="sf-item"><span class="sf-item-icon">${l.icon}</span><div class="sf-item-name"><b>${esc(l.name)}</b><span class="muted">×${fmt(l.qty)} · ${fmt(l.each)} each</span></div><b class="sf-price">${fmt(l.price)} pts</b>${loggedIn && d.username.toLowerCase() !== s.username.toLowerCase() ? `<button class="btn btn-sm btn-primary" data-buy="${l.id}" ${d.points < l.price ? 'disabled' : ''}>Buy</button>` : ''}</div>`
                  )
                  .join('')}</div>`
              : '<p class="muted">The shelves are empty right now.</p>'
          }
        </section>`;
    }

    function draw() {
      if (params[0] === 'shop' && params[1]) {
        $app.innerHTML = storefrontHtml(params[1]);
      } else {
        $app.innerHTML = `<div class="town-page">
          <section class="panel town-hero"><h1 style="margin:0">🏘️ Town & Building</h1><p class="muted" style="margin:4px 0 0">Everything built from Construction parts: the town, your house and your shop.</p></section>
          ${townHtml()}${partsHtml()}${housesHtml()}${shopsHtml()}</div>`;
      }
      bind();
    }

    function bind() {
      $app.querySelectorAll('[data-pick]').forEach((b) => {
        b.onclick = () => {
          picked = b.dataset.pick;
          draw();
          $app.querySelector('.tc-give')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
      });
      const form = $app.querySelector('#tc-form');
      if (form) {
        const send = (qty) => post('/town/contribute', { building: picked || d.town.focus, item: form.item.value, qty });
        form.onsubmit = (e) => {
          e.preventDefault();
          send(Number(form.qty.value) || 1);
        };
        $app.querySelector('#tc-all').onclick = () => send('all');
      }
      $app.querySelector('[data-build-house]')?.addEventListener('click', () => post('/town/house'));
      $app.querySelector('[data-build-stall]')?.addEventListener('click', () => post('/town/stall'));
      $app.querySelectorAll('[data-buy]').forEach((b) => {
        b.onclick = async () => {
          try {
            const r = await api(`/market/${b.dataset.buy}/buy`, { method: 'POST' });
            toast(r.message);
          } catch (err) {
            toast(err.message);
          }
          d = await api('/town');
          draw();
        };
      });
    }

    draw();
  };
})();
