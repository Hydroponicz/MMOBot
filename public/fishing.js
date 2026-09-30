// The Fishing page (#/fishing): the skill's home. Pick a spot and cast (same as !fish in chat, with
// that water's fish), watch the catch leap out in 3D at its real size, and browse every catch,
// the fishdex with personal bests, and the records. app.js calls window.MMOFishing($app, helpers).
(() => {
  let spotId = null;
  let tab = 'catches';

  window.MMOFishing = async ($app, { api, toast, esc, fmt, state, ago, playerLink }) => {
    let d = await api('/fishing');
    const loggedIn = !!d.username;
    const cleanups = [];
    let fish3d = null;
    const load3d = async () => {
      if (fish3d !== null) return fish3d;
      try {
        const m = await import('/fish3d.js');
        fish3d = m.supported() ? m : false;
      } catch {
        fish3d = false;
      }
      return fish3d;
    };
    const species = () => Object.fromEntries(d.species.map((s) => [s.id, s]));
    let S = species();
    const open = d.spots.filter((s) => !s.locked);
    if (!spotId || !d.spots.find((s) => s.id === spotId && !s.locked)) spotId = (open[open.length - 1] || d.spots[0]).id;

    let stage = null; // the 3D viewer on the main stage
    const disposeStage = () => {
      stage?.dispose();
      stage = null;
    };
    cleanups.push(disposeStage);

    const thumbOf = (id) => (fish3d ? fish3d.thumb(id, S[id].look, 240) : null);
    const pic = (id, cls = '') => {
      const url = thumbOf(id);
      return url ? `<img class="fx-thumb ${cls}" src="${url}" alt="">` : `<span class="fx-emoji ${cls}">${S[id].icon}</span>`;
    };
    const tags = (c) =>
      [c.record && '<span class="fx-tag rec">🏆 Record</span>', c.pb && '<span class="fx-tag pb">🏅 Personal best</span>', c.first && '<span class="fx-tag new">🆕 First catch</span>', c.trophy && '<span class="fx-tag tro">🌟 Trophy</span>'].filter(Boolean).join('');
    // Where a catch sits between its species' smallest and biggest (trophies go past the end).
    const sizeBar = (c) => {
      const pct = Math.max(2, Math.min(100, c.score * 100));
      return `<div class="fx-size"><span style="width:${pct}%"></span>${c.score > 1 ? '<b>+</b>' : ''}</div>`;
    };

    function hero() {
      const st = d.stamina;
      const next = d.species.filter((s) => !s.rare && s.level > d.level).sort((a, b) => a.level - b.level)[0];
      return `
        <section class="panel fx-hero">
          <div>
            <h1 style="margin:0">🎣 Fishing</h1>
            <p class="muted" style="margin:4px 0 0">Every fish you catch, here or with <code>!fish</code> in chat, has its own length and weight. Cast at a spot to see it leap out in 3D.</p>
          </div>
          ${
            loggedIn
              ? `<div class="fx-stats">
                  <div><small>Level</small><b>${d.level}</b></div>
                  <div><small>Rod</small><b>${d.tool ? `${d.tool.icon} ${esc(d.tool.name)}` : '—'}</b></div>
                  <div><small>Stamina</small><b id="fx-stamina">${st ? `${st.charges}/${st.max}` : '—'}</b></div>
                  <div><small>Caught</small><b>${fmt(d.caught)}</b></div>
                  ${next ? `<div><small>Next fish</small><b>${S[next.id].icon} ${esc(next.name)} · ${next.level}</b></div>` : ''}
                </div>`
              : state.loginEnabled
                ? '<a class="btn btn-primary" href="/auth/login">Log in with Kick to fish</a>'
                : ''
          }
        </section>`;
    }

    function spotsHtml() {
      return `<div class="fx-spots">${d.spots
        .map(
          (s) => `<button class="fx-spot ${s.id === spotId ? 'active' : ''} ${s.locked ? 'locked' : ''}" data-spot="${s.id}" style="--sky:${s.sky};--water:${s.water}" ${s.locked ? 'disabled' : ''}>
            <span class="fx-spot-icon">${s.icon}</span>
            <b>${esc(s.name)}</b>
            <small>${s.locked ? `🔒 Fishing ${s.level}` : s.fish.map((f) => S[f].icon).join(' ')}</small>
          </button>`
        )
        .join('')}</div>`;
    }

    function stageHtml() {
      const s = d.spots.find((x) => x.id === spotId);
      return `
        <section class="fx-water" id="fx-water" style="--sky:${s.sky};--water:${s.water}">
          <div class="fx-sky"></div><div class="fx-waves"></div>
          <div class="fx-stage" id="fx-stage"></div>
          <div class="fx-bobber" id="fx-bobber" hidden>🔴</div>
          <div class="fx-caption" id="fx-caption">
            <h2 style="margin:0">${s.icon} ${esc(s.name)}</h2>
            <p class="muted" style="margin:4px 0 8px">${esc(s.text)}</p>
            <div class="fx-here">${s.fish.map((f) => `<span class="cchip" title="Fishing ${S[f].level}">${S[f].icon} ${esc(S[f].name)}${S[f].level > d.level ? ` · ${S[f].level}` : ''}</span>`).join('')}</div>
          </div>
          <div class="fx-cast-row">
            ${loggedIn ? `<button class="btn btn-primary big-btn" id="fx-cast">🎣 Cast</button>` : ''}
            <div class="fx-result" id="fx-result" aria-live="polite"></div>
          </div>
        </section>`;
    }

    function catchesHtml() {
      if (!loggedIn) return '<p class="muted">Log in to see your catches.</p>';
      if (!d.recent.length) return '<p class="muted">Nothing yet! Cast above, or type <code>!fish</code> in chat.</p>';
      return `<div class="fx-grid">${d.recent
        .map(
          (c) => `<button class="fx-card" data-catch="${c.id}">
            ${pic(c.fish)}
            <b>${c.icon} ${esc(c.name)}</b>
            <span>${esc(c.lengthText)} · ${esc(c.weightText)}</span>
            ${sizeBar(c)}
            <small class="muted">${ago(c.at)}</small>
          </button>`
        )
        .join('')}</div>`;
    }

    function dexHtml() {
      const found = d.species.filter((s) => s.best).length;
      return `<p class="muted" style="margin-top:0">${loggedIn ? `You've caught <b>${found}</b> of ${d.species.length} kinds of fish.` : ''} Each fish's size range, your biggest, and the record.</p>
        <div class="fx-grid dex">${d.species
          .map((s) => {
            const have = !!s.best;
            return `<div class="fx-card ${have ? '' : 'unknown'}" ${have ? `data-catch="${s.best.id}"` : s.record ? `data-catch="${s.record.id}"` : ''}>
              ${pic(s.id, have ? '' : 'shadow')}
              <b>${s.icon} ${esc(s.name)}</b>
              <small class="muted">${s.rare ? 'Rare find' : `Fishing ${s.level}`} · ${esc(fmtLen(s.min))}–${esc(fmtLen(s.max))}</small>
              <span>${have ? `Your best: <b>${esc(s.best.weightText)}</b>` : '<span class="muted">Not caught yet</span>'}</span>
              <small>${s.record ? `🏆 <a href="${playerLink(s.record.username)}">${esc(s.record.username)}</a> ${esc(s.record.weightText)}` : '<span class="muted">No record yet</span>'}</small>
            </div>`;
          })
          .join('')}</div>`;
    }

    function recordsHtml() {
      const rec = d.species.filter((s) => s.record);
      return `
        <div class="grid grid-2">
          <div>
            <h3 style="margin-top:0">🏆 Records</h3>
            ${
              rec.length
                ? `<table class="fx-table"><tbody>${rec
                    .map((s) => `<tr data-catch="${s.record.id}"><td>${s.icon} ${esc(s.name)}</td><td><b>${esc(s.record.weightText)}</b></td><td>${esc(s.record.lengthText)}</td><td><a href="${playerLink(s.record.username)}">${esc(s.record.username)}</a></td></tr>`)
                    .join('')}</tbody></table>`
                : '<p class="muted">No records yet.</p>'
            }
          </div>
          <div>
            <h3 style="margin-top:0">🌊 Just landed</h3>
            ${
              d.feed.length
                ? `<table class="fx-table"><tbody>${d.feed
                    .map((c) => `<tr data-catch="${c.id}"><td><a href="${playerLink(c.username)}">${esc(c.username)}</a></td><td>${c.icon} ${esc(c.name)}</td><td>${esc(c.weightText)}</td><td class="muted">${ago(c.at)}</td></tr>`)
                    .join('')}</tbody></table>`
                : '<p class="muted">Nothing yet.</p>'
            }
          </div>
        </div>`;
    }
    const fmtLen = (cm) => (cm >= 100 ? `${+(cm / 100).toFixed(2)} m` : `${cm} cm`);

    function tabsHtml() {
      const body = { catches: catchesHtml, dex: dexHtml, records: recordsHtml }[tab]();
      return `<section class="panel" style="margin-top:14px">
        <div class="tabs">${[
          ['catches', '🐟 My catches'],
          ['dex', '📖 Fishdex'],
          ['records', '🏆 Records'],
        ]
          .map(([id, label]) => `<button class="tab ${id === tab ? 'active' : ''}" data-tab="${id}">${label}</button>`)
          .join('')}</div>
        <div id="fx-tab">${body}</div>
      </section>`;
    }

    function draw() {
      disposeStage();
      $app.innerHTML = `<div class="fx-page">${hero()}${spotsHtml()}${stageHtml()}${tabsHtml()}</div>`;
      bind();
    }

    function bindCatches(root) {
      root.querySelectorAll('[data-catch]').forEach((el) => {
        el.onclick = (e) => {
          if (e.target.closest('a')) return;
          inspect(Number(el.dataset.catch));
        };
      });
    }

    function bind() {
      $app.querySelectorAll('[data-spot]').forEach((b) => {
        b.onclick = () => {
          spotId = b.dataset.spot;
          draw();
        };
      });
      $app.querySelectorAll('[data-tab]').forEach((b) => {
        b.onclick = () => {
          tab = b.dataset.tab;
          $app.querySelector('#fx-tab').innerHTML = { catches: catchesHtml, dex: dexHtml, records: recordsHtml }[tab]();
          $app.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
          bindCatches($app.querySelector('#fx-tab'));
        };
      });
      bindCatches($app);
      const cast = $app.querySelector('#fx-cast');
      if (cast) cast.onclick = () => doCast(cast);
    }

    let casting = false;
    async function doCast(btn) {
      if (casting) return;
      casting = true;
      btn.disabled = true;
      const res = $app.querySelector('#fx-result');
      const bob = $app.querySelector('#fx-bobber');
      const cap = $app.querySelector('#fx-caption');
      res.className = 'fx-result';
      res.textContent = '';
      disposeStage();
      $app.querySelector('#fx-stage').innerHTML = '';
      cap.hidden = false;
      bob.hidden = false;
      bob.className = 'fx-bobber cast';
      const wait = new Promise((r) => setTimeout(r, 1100));
      let r = null;
      try {
        r = await api('/fishing/cast', { method: 'POST', body: { spot: spotId } });
      } catch (err) {
        await wait;
        bob.hidden = true;
        res.textContent = err.message;
        res.className = 'fx-result lose';
        casting = false;
        btn.disabled = false;
        return;
      }
      await wait;
      bob.className = 'fx-bobber bite';
      await new Promise((r2) => setTimeout(r2, r.catches.length ? 450 : 250));
      bob.hidden = true;
      // The chat reply, minus the @name and the link (you're already here).
      const msg = String(r.message || '').replace(/^@\S+\s*/, '').replace(/ 🐟 See all your catches in 3D: \S+/, '');
      if (r.stamina) {
        const el = $app.querySelector('#fx-stamina');
        if (el) el.textContent = `${r.stamina.charges}/${r.stamina.max}`;
      }
      if (!r.catches.length) {
        res.textContent = msg;
        res.className = 'fx-result';
        casting = false;
        btn.disabled = false;
        return;
      }
      const best = r.catches.reduce((a, b) => (b.weight > a.weight ? b : a));
      cap.hidden = true;
      const f3 = await load3d();
      if (f3) stage = f3.mount($app.querySelector('#fx-stage'), { look: S[best.fish].look, length: best.length }, { splash: true });
      else $app.querySelector('#fx-stage').innerHTML = `<div class="fx-flat">${S[best.fish].icon}</div>`;
      res.innerHTML = `
        <div class="fx-catch-name">${best.icon} ${esc(best.name)}</div>
        <div class="fx-catch-size"><b>${esc(best.lengthText)}</b> · <b>${esc(best.weightText)}</b>${r.catches.length > 1 ? ` <span class="muted">(biggest of ${r.catches.length})</span>` : ''}</div>
        ${sizeBar(best)}
        <div class="fx-tags">${tags(best)}</div>
        <div class="muted fx-msg">${esc(msg.replace(/ \(📏[^)]*\)/, ''))}</div>`;
      res.className = `fx-result caught ${best.record ? 'record' : best.pb || best.trophy ? 'pb' : ''}`;
      // Refresh the lists behind it (new catch, maybe a new best).
      d = await api('/fishing');
      S = species();
      $app.querySelector('#fx-tab').innerHTML = { catches: catchesHtml, dex: dexHtml, records: recordsHtml }[tab]();
      bindCatches($app.querySelector('#fx-tab'));
      casting = false;
      btn.disabled = false;
      btn.focus();
    }

    // Any catch in 3D, in a pop-up.
    async function inspect(id) {
      const c = await api(`/fishing/catch/${id}`).catch(() => null);
      if (!c) return;
      const s = S[c.fish];
      const o = document.createElement('div');
      o.className = 'cd-overlay';
      o.innerHTML = `<div class="cd-modal fx-modal"><button class="cd-x" data-close aria-label="Close">✕</button>
        <div class="fx-inspect" id="fx-inspect"></div>
        <div class="fx-inspect-info">
          <h2 style="margin:0">${c.icon} ${esc(c.name)}</h2>
          <div class="fx-catch-size"><b>${esc(c.lengthText)}</b> · <b>${esc(c.weightText)}</b></div>
          ${sizeBar(c)}
          <p class="muted" style="margin:6px 0 0">Caught by <a href="${playerLink(c.username)}">${esc(c.username)}</a> ${ago(c.at)}${c.spot ? ` at ${esc(d.spots.find((x) => x.id === c.spot)?.name || c.spot)}` : ' from chat'}. ${esc(s.name)} usually run ${esc(fmtLen(s.min))}–${esc(fmtLen(s.max))}${s.record ? `; the record is ${esc(s.record.weightText)} (${esc(s.record.username)})` : ''}.</p>
          <p class="muted" style="font-size:.8rem;margin:6px 0 0">Drag to turn · shift-drag to move · scroll to zoom · double-click to reset</p>
        </div></div>`;
      document.body.appendChild(o);
      document.body.classList.add('cd-noscroll');
      let view = null;
      const close = () => {
        view?.dispose();
        o.remove();
        document.body.classList.remove('cd-noscroll');
        document.removeEventListener('keydown', onKey);
      };
      const onKey = (e) => e.key === 'Escape' && close();
      document.addEventListener('keydown', onKey);
      o.onclick = (e) => {
        if (e.target === o || e.target.closest('[data-close]')) close();
      };
      cleanups.push(close);
      const f3 = await load3d();
      if (f3 && o.isConnected) view = f3.mount(o.querySelector('#fx-inspect'), { look: s.look, length: c.length }, { splash: false });
      else o.querySelector('#fx-inspect').innerHTML = `<div class="fx-flat">${c.icon}</div>`;
    }

    // Thumbnails need the 3D module; draw once it's loaded (emoji until then).
    draw();
    load3d().then((m) => {
      if (m && $app.querySelector('.fx-page')) {
        $app.querySelector('#fx-tab').innerHTML = { catches: catchesHtml, dex: dexHtml, records: recordsHtml }[tab]();
        bindCatches($app.querySelector('#fx-tab'));
      }
    });
    return () => cleanups.forEach((f) => f());
  };
})();
