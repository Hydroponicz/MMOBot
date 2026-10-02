// The Train page (#/train): a button for every skill, for players who'd rather click than type in
// chat. Each button does exactly what the chat command does (same stamina, levels, tools, loot).
// app.js calls window.MMOTrain($app, helpers).
(() => {
  const picks = {}; // skill -> chosen target (kept while you move around the site)
  const said = {}; // skill -> last reply
  let group = 'all';
  let timer = null;

  window.MMOTrain = async ($app, { api, toast, esc, fmt, state }) => {
    if (!state.me) {
      $app.innerHTML = `<section class="panel"><h1 style="margin-top:0">🏋️ Train</h1><p class="muted">Train every skill with a button here instead of typing commands in chat. Same XP, same loot, same stamina.</p>${
        state.loginEnabled ? '<a class="btn btn-primary" href="/auth/login">Log in with Kick to train</a>' : ''
      }</section>`;
      return;
    }
    let d;
    try {
      d = await api('/train');
    } catch (e) {
      $app.innerHTML = `<section class="panel"><p>${esc(e.message)}</p></section>`;
      return;
    }
    const busy = new Set();

    const left = (ms) => {
      const s = Math.max(0, Math.ceil(ms / 1000));
      return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
    };

    function headHtml() {
      const st = d.stamina;
      const pips = Array.from({ length: st.max }, (_, i) => `<i class="${i < st.charges ? 'on' : ''}"></i>`).join('');
      const refill = st.charges < st.max && (st.nextAt || st.refillAt) ? `<small class="muted" id="tr-refill" data-at="${st.nextAt || st.refillAt}">+1 in ${left((st.nextAt || st.refillAt) - Date.now())}</small>` : '';
      const bag = d.backpack;
      return `
        <section class="panel tr-head">
          <div>
            <h1 style="margin:0">🏋️ Train</h1>
            <p class="muted" style="margin:4px 0 0">Click to train any skill, no chat needed. Every button is the same as its chat command (shown on the card): same XP, loot, stamina and cooldowns.</p>
          </div>
          <div class="tr-stats">
            <div><small>⚡ Stamina</small><b class="tr-pips">${pips}</b>${refill}</div>
            <div><small>❤️ HP</small><b>${d.hp.ko ? '💀 knocked out' : `${fmt(d.hp.hp)}/${fmt(d.hp.max)}`}</b></div>
            <div><small>🔷 Mana</small><b>${fmt(d.hp.mana)}/${fmt(d.hp.maxMana)}</b></div>
            <div><small>🎒 Backpack</small><b class="${bag.used >= bag.capacity ? 'tr-full' : ''}">${bag.used}/${bag.capacity}</b></div>
            <div><small>🔥 Fire</small><b>${d.fire ? `${left(d.fire.msLeft)} · ${d.fire.meals} meals` : 'out'}</b></div>
          </div>
        </section>
        ${d.inVeil ? '<section class="panel" style="border-color:var(--rare)">🌫️ You\'re in the Gloamveil: skills wait until you get out. <a href="#/veil">Go to the Gloamveil</a></section>' : ''}
        <div class="tabs tr-tabs">${[['all', 'All skills'], ...d.groups.map((g) => [g.id, g.name])]
          .map(([id, name]) => `<button class="tab ${group === id ? 'active' : ''}" data-group="${id}">${esc(name)}</button>`)
          .join('')}</div>`;
    }

    const optLabel = (t) => `${t.locked ? `🔒 ` : t.rating ? `${t.rating.icon} ` : t.ready === false ? '· ' : ''}${t.label}${t.locked ? ` (level ${t.level})` : ''}`;

    function selectHtml(s) {
      if (!s.targets.length && s.type !== 'farm') return '';
      const best = s.type === 'farm' ? '🌱 Best seeds I have' : s.type === 'combat' ? '🎯 Best safe match' : s.pickBest ? '✨ Best I can do' : null;
      // Without a "best" option, what you can make right now comes first (best first).
      const list = best ? s.targets : [...s.targets.filter((t) => t.ready).reverse(), ...s.targets.filter((t) => !t.ready)];
      const opts = [
        ...(best ? [`<option value="">${best}</option>`] : []),
        ...list.map((t) => `<option value="${esc(t.id)}" ${t.locked ? 'disabled' : ''} ${picks[s.id] === t.id ? 'selected' : ''} title="${esc(t.needs || '')}">${esc(optLabel(t))}${t.needs ? ` — ${esc(t.needs)}` : ''}</option>`),
      ];
      if (!best && !s.targets.some((t) => t.ready) && !picks[s.id]) opts.unshift('<option value="">What can I make?</option>');
      return `<select class="tr-target" data-skill="${s.id}" aria-label="What to train on">${opts.join('')}</select>`;
    }

    function cardHtml(s) {
      const tired = d.stamina.charges <= 0;
      const verb = { farm: 'Plant', combat: 'Fight', burn: 'Light fire', course: 'Run' }[s.type] || { fishing: 'Fish', mining: 'Mine', woodcutting: 'Chop', digging: 'Dig', skinning: 'Skin' }[s.id] || 'Make';
      const extra =
        s.id === 'farming'
          ? `<button class="btn btn-sm" data-train="${s.id}" data-target="harvest" ${busy.has(s.id) ? 'disabled' : ''}>🧺 Harvest${d.farm.ready ? ` (${d.farm.ready})` : ''}</button>`
          : s.id === 'cooking'
            ? `<button class="btn btn-sm" data-train="${s.id}" data-target="all" ${busy.has(s.id) ? 'disabled' : ''}>🍳 Cook all</button>`
            : s.id === 'fishing'
              ? '<a class="btn btn-sm" href="#/fishing">🎣 Spots & 3D catches</a>'
              : '';
      const sub = s.id === 'farming' ? `${d.farm.plots} plots · ${d.farm.empty} empty · ${d.farm.ready} ready` : `${fmt(s.xp)} XP${s.nextLevelXp ? ` · ${fmt(s.nextLevelXp - s.xp)} to ${s.level + 1}` : ' · max level'}`;
      return `<section class="panel tr-card ${s.off ? 'is-off' : ''}" data-card="${s.id}">
        <header>
          <span class="tr-icon">${s.icon}</span>
          <div><b>${esc(s.name)}</b> <span class="badge">${s.level}</span><br><small class="muted">${sub}</small></div>
          <code class="tr-cmd" title="The chat command for this">${esc(s.command)}</code>
        </header>
        <div class="bar"><span style="width:${s.percent}%"></span></div>
        ${s.off ? '<p class="muted">Switched off by the streamer right now.</p>' : `
        ${s.needs ? `<p class="tr-need">Needs a ${s.needs.icon} ${esc(s.needs.name)} in your backpack. <a href="#/shop">Shop</a></p>` : ''}
        <div class="tr-row">
          ${selectHtml(s)}
          <button class="btn btn-primary btn-sm" data-train="${s.id}" ${busy.has(s.id) || (tired && s.id !== 'cooking') ? 'disabled title="Out of stamina: wait for a charge"' : ''}>${busy.has(s.id) ? '…' : verb}</button>
          ${extra}
        </div>`}
        ${said[s.id] ? `<p class="tr-said">${esc(said[s.id])}</p>` : ''}
      </section>`;
    }

    function render() {
      const groups = group === 'all' ? d.groups : d.groups.filter((g) => g.id === group);
      $app.innerHTML = `${headHtml()}${groups
        .map((g) => `${group === 'all' ? `<h2 class="tr-group">${esc(g.name)}</h2>` : ''}<div class="tr-grid">${g.skills.map(cardHtml).join('')}</div>`)
        .join('')}`;
      $app.querySelectorAll('[data-group]').forEach((b) => (b.onclick = () => ((group = b.dataset.group), render())));
      $app.querySelectorAll('.tr-target').forEach((sel) => (sel.onchange = () => (picks[sel.dataset.skill] = sel.value)));
      $app.querySelectorAll('[data-train]').forEach((b) => (b.onclick = () => train(b.dataset.train, b.dataset.target ?? picks[b.dataset.train] ?? $app.querySelector(`.tr-target[data-skill="${b.dataset.train}"]`)?.value ?? '')));
    }

    async function train(skill, target) {
      if (busy.has(skill)) return;
      busy.add(skill);
      render();
      try {
        const r = await api('/train', { method: 'POST', body: { skill, target } });
        said[skill] = r.message;
        d = r.train;
      } catch (e) {
        said[skill] = e.message;
        toast?.(e.message);
      }
      busy.delete(skill);
      render();
    }

    render();
    // Count the stamina refill down; reload when a charge comes back.
    clearInterval(timer);
    timer = setInterval(async () => {
      if (!document.body.contains($app) || !location.hash.startsWith('#/train')) return clearInterval(timer);
      const el = document.getElementById('tr-refill');
      if (!el) return;
      const ms = Number(el.dataset.at) - Date.now();
      if (ms > 0) el.textContent = `+1 in ${left(ms)}`;
      else if (!busy.size) {
        d = await api('/train').catch(() => d);
        render();
      }
    }, 1000);
  };
})();
