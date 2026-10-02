// The Train page (#/train): a button for every skill, for players who'd rather click than type in
// chat, plus the backpack to sell from. Each button does exactly what the chat command does (same
// stamina, levels, tools, loot). Wide screens show the backpack as a sidebar; phones switch between
// Skills and Backpack with a bar along the bottom, so nobody scrolls past 24 cards to sell.
// app.js calls window.MMOTrain($app, helpers).
(() => {
  const picks = {}; // skill -> chosen target (kept while you move around the site)
  const said = {}; // skill -> last reply
  let group = 'all';
  let view = 'skills'; // phones: 'skills' | 'bag'
  let bagSaid = '';
  const chosen = new Map(); // item id -> how many to sell (the multi-sell selection)
  let timer = null;

  window.MMOTrain = async ($app, { api, toast, esc, fmt, state }) => {
    if (!state.me) {
      $app.innerHTML = `<section class="panel"><h1 style="margin-top:0">🏋️ Train</h1><p class="muted">Train every skill with a button here instead of typing commands in chat, and sell from your backpack. Same XP, same loot, same stamina.</p>${
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
    let selling = false;
    let working = false;

    const left = (ms) => {
      const s = Math.max(0, Math.ceil(ms / 1000));
      return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
    };
    const full = () => d.backpack.used >= d.backpack.capacity;
    const pips = () => Array.from({ length: d.stamina.max }, (_, i) => `<i class="${i < d.stamina.charges ? 'on' : ''}"></i>`).join('');
    const refillAt = () => (d.stamina.charges < d.stamina.max ? d.stamina.nextAt || d.stamina.refillAt : null);

    // ---- header: what limits your training right now
    function headHtml() {
      const at = refillAt();
      return `
        <section class="panel tr-head">
          <div class="tr-title">
            <h1>🏋️ Train</h1>
            <p class="muted">Every button is the same as its chat command (shown on the card): same XP, loot, stamina and cooldowns.</p>
          </div>
          <div class="tr-stats">
            <div><small>⚡ Stamina</small><b class="tr-pips">${pips()}</b>${at ? `<small class="muted tr-refill" data-at="${at}">+1 in ${left(at - Date.now())}</small>` : ''}</div>
            <div><small>❤️ HP</small><b>${d.hp.ko ? '💀 KO' : `${fmt(d.hp.hp)}/${fmt(d.hp.max)}`}</b></div>
            <div><small>🔷 Mana</small><b>${fmt(d.hp.mana)}/${fmt(d.hp.maxMana)}</b></div>
            <div><small>🔥 Fire</small><b>${d.fire ? `${left(d.fire.msLeft)} · ${d.fire.meals} meals` : 'out'}</b></div>
            <div><small>💰 Points</small><b>${fmt(d.points)}</b></div>
          </div>
          ${recoverHtml()}
        </section>
        ${d.inVeil ? '<section class="panel" style="border-color:var(--rare)">🌫️ You\'re in the Gloamveil: skills wait until you get out. <a href="#/veil">Go to the Gloamveil</a></section>' : ''}`;
    }

    // ---- recover: Heal (!heal), drink a potion (!drink), eat (!eat). Shown when you're hurt or low on mana.
    function recoverHtml() {
      const r = d.recover;
      if (!r.hurt && !r.lowMana) return '';
      const ko = !!d.hp.ko;
      const hp = d.hp.max ? Math.round((d.hp.hp / d.hp.max) * 100) : 100;
      const btns = [
        r.heal && r.hurt && !ko
          ? `<button class="btn btn-sm ${r.heal.ready ? 'btn-primary' : ''}" data-recover="heal" ${r.heal.ready && !working ? '' : `disabled title="Needs ${r.heal.cost} mana (you have ${fmt(d.hp.mana)})"`}>✨ Heal +${r.heal.percent}% <small>${r.heal.cost} mana</small></button>`
          : '',
        r.potions !== null && r.potions > 0 && (ko ? r.revive > 0 : true)
          ? `<button class="btn btn-sm ${ko ? 'btn-primary' : ''}" data-recover="drink" ${working ? 'disabled' : ''}>🧪 ${ko ? 'Drink to get up' : 'Drink potion'} <small>${r.potions}</small></button>`
          : '',
        r.food !== null && r.food > 0 && r.hurt && !ko ? `<button class="btn btn-sm" data-recover="eat" ${working ? 'disabled' : ''}>🍗 Eat <small>${r.food}</small></button>` : '',
      ].filter(Boolean);
      const shop = !btns.length || (ko && !r.revive) ? '<a class="btn btn-sm" href="#/shop">🛒 Buy potions</a>' : '';
      const what = ko ? '💀 Knocked out: only a health potion gets you up now.' : r.hurt ? `❤️ ${hp}% HP` : '🔷 Mana not full';
      return `<div class="tr-recover ${ko ? 'is-ko' : hp < 35 ? 'is-low' : ''}">
        <span class="tr-hpbar" title="${fmt(d.hp.hp)}/${fmt(d.hp.max)} HP"><i style="width:${ko ? 0 : hp}%"></i></span>
        <span class="tr-recover-what">${what}</span>
        <span class="tr-recover-btns">${btns.join('')}${shop}</span>
      </div>`;
    }

    // ---- backpack: tap items to select them, then sell them all at once
    const KIND = { loot: null, gear: '🛡️ gear/tool', potion: '🧪 potion', food: '🍗 food', crop: '🌾 crop', ammo: '🎯 ammo', seed: '🌱 seeds' };
    const RISKY = ['gear', 'potion', 'ammo', 'seed'];
    const itemOf = (id) => d.bag.items.find((x) => x.id === id);
    // Price for n of an item: the server's total for all of them, scaled (close enough for a preview).
    const priceOf = (x, n) => (n >= x.qty ? x.total : Math.round((x.total * n) / x.qty));
    function pruneChosen() {
      for (const [id, n] of chosen) {
        const x = itemOf(id);
        if (!x || !x.sellable) chosen.delete(id);
        else chosen.set(id, Math.min(n, x.qty));
      }
    }
    const chosenTotal = () => [...chosen].reduce((t, [id, n]) => t + priceOf(itemOf(id), n), 0);
    const chosenCount = () => [...chosen.values()].reduce((t, n) => t + n, 0);

    function upgradeBagHtml() {
      const u = d.bagUpgrade;
      if (u.off) return '';
      if (!u.next) return `<p class="tr-upgrade muted">🏆 ${u.icon} ${esc(u.name)}: the biggest backpack there is.</p>`;
      const afford = d.points >= u.next.cost;
      return `<div class="tr-upgrade">
        <span>⬆️ ${u.next.icon} <b>${esc(u.next.name)}</b> · ${u.next.capacity} slots <span class="muted">(+${u.next.capacity - d.backpack.capacity})</span></span>
        <button class="btn btn-sm ${afford ? 'btn-primary' : ''}" data-upgrade="backpack" ${afford && !working ? '' : `disabled title="You have ${fmt(d.points)} pts"`}>Upgrade · ${fmt(u.next.cost)} pts</button>
      </div>`;
    }

    function bagHtml() {
      const b = d.bag;
      const bag = d.backpack;
      if (b.off) return '<section class="panel"><b>🎒 Backpack</b><p class="muted">Selling is switched off right now.</p></section>';
      const groupBtn = (g, label, worth) => (worth > 0 ? `<button class="btn btn-sm ${g === 'all' ? 'btn-primary' : ''}" data-sellgroup="${g}" ${selling ? 'disabled' : ''}>${label} <b>+${fmt(worth)}</b></button>` : '');
      const loot = b.items.filter((x) => x.sellable && x.kind === 'loot');
      const tiles = b.items
        .map((x) => {
          const n = chosen.get(x.id);
          const on = n !== undefined;
          return `<div class="bag-tile ${on ? 'is-on' : ''} ${x.kind !== 'loot' ? 'is-kept' : ''} ${x.sellable ? '' : 'is-locked'}" ${x.sellable ? `data-pick="${esc(x.id)}" role="checkbox" aria-checked="${on}" tabindex="0"` : ''}>
            <span class="bag-check">${on ? '✓' : ''}</span>
            <span class="bag-icon">${x.icon}</span>
            <div class="bag-name">
              <b>${esc(x.name)}</b> <span class="muted">×${fmt(x.qty)}</span>
              <small class="muted">${x.sellable ? `${fmt(x.each)} pts each` : "can't be sold"}${KIND[x.kind] ? ` · ${KIND[x.kind]}` : ''}${x.bagless ? ' · no slot' : ''}</small>
              ${
                on && x.qty > 1
                  ? `<span class="bag-qty" data-noflip>
                      <button class="btn btn-sm" data-step="${esc(x.id)}" data-by="-1" aria-label="One fewer">−</button>
                      <b>${fmt(n)}</b><span class="muted">/${fmt(x.qty)}</span>
                      <button class="btn btn-sm" data-step="${esc(x.id)}" data-by="1" aria-label="One more">+</button>
                      <button class="btn btn-sm" data-step="${esc(x.id)}" data-by="all">All</button>
                    </span>`
                  : ''
              }
            </div>
            ${x.sellable ? `<span class="bag-price">${on ? `+${fmt(priceOf(x, n))}` : `${fmt(x.total)}`}</span>` : ''}
          </div>`;
        })
        .join('');
      const count = chosenCount();
      return `<section class="panel tr-bag">
        <div class="tr-bag-head">
          <h2>🎒 Backpack <span class="${full() ? 'tr-full' : 'muted'}">${bag.used}/${bag.capacity}</span></h2>
          <span class="tr-bag-btns">${groupBtn('all', '💰 Sell all loot', b.worth.loot)}${groupBtn('food', '🍗 Food', b.worth.food)}${groupBtn('crops', '🌾 Crops', b.worth.crop)}</span>
        </div>
        ${upgradeBagHtml()}
        <p class="muted tr-bag-help">Tap items to pick several, then sell them together. <b>Sell all loot</b> is <code>!sell all</code>: it keeps gear, tools, potions, food and crops (pick those to sell them).</p>
        ${bagSaid ? `<p class="tr-said" style="margin:0 0 10px">${esc(bagSaid)}</p>` : ''}
        ${
          b.items.length
            ? `<div class="bag-tools">
                ${loot.length ? `<button class="btn btn-sm" data-pickall="loot">Select all loot</button>` : ''}
                <button class="btn btn-sm" data-pickall="every">Select everything</button>
                ${chosen.size ? '<button class="btn btn-sm" data-pickall="none">Clear</button>' : ''}
              </div>
              <div class="bag-grid">${tiles}</div>`
            : '<p class="muted">Your backpack is empty. Go gather something!</p>'
        }
        ${
          chosen.size
            ? `<div class="bag-sellbar">
                <span><b>${fmt(count)}</b> item${count === 1 ? '' : 's'} picked (${chosen.size} kind${chosen.size === 1 ? '' : 's'})</span>
                <button class="btn btn-primary" data-sellpicked ${selling ? 'disabled' : ''}>${selling ? 'Selling…' : `Sell for +${fmt(chosenTotal())} pts`}</button>
              </div>`
            : ''
        }
      </section>`;
    }

    // ---- skills
    const optLabel = (t) => `${t.locked ? `🔒 ` : t.rating ? `${t.rating.icon} ` : t.ready === false ? '· ' : ''}${t.label}${t.locked ? ` (level ${t.level})` : ''}`;

    function selectHtml(s) {
      if (!s.targets.length && s.type !== 'farm') return '';
      const best = s.type === 'farm' ? '🌱 Best seeds I have' : s.type === 'combat' ? '🎯 Best safe match' : s.pickBest ? '✨ Best I can do' : null;
      // Without a "best" option, what you can make right now comes first (best first).
      const list = best ? s.targets : [...s.targets.filter((t) => t.ready).reverse(), ...s.targets.filter((t) => !t.ready)];
      const opts = [
        ...(best ? [`<option value="">${best}</option>`] : []),
        ...(s.type === 'gather' ? [`<option value="*mix" ${picks[s.id] === '*mix' ? 'selected' : ''}>🎲 Mix of my best (like chat)</option>`] : []),
        ...list.map((t) => `<option value="${esc(t.id)}" ${t.locked ? 'disabled' : ''} ${picks[s.id] === t.id ? 'selected' : ''} title="${esc(t.needs || '')}">${esc(optLabel(t))}${t.needs ? ` — ${esc(t.needs)}` : ''}</option>`),
      ];
      if (!best && !s.targets.some((t) => t.ready) && !picks[s.id]) opts.unshift('<option value="">What can I make?</option>');
      return `<select class="tr-target" data-skill="${s.id}" aria-label="What to train on">${opts.join('')}</select>`;
    }

    // The skill's upgradable tool (rod, pickaxe, axe, shovel, furnace) and an Upgrade button (!upgrade rod).
    function toolHtml(s) {
      const t = s.tool;
      if (!t) return '';
      if (!t.next) return `<p class="tr-tool muted">${t.icon} ${esc(t.name)} · 🏆 best ${esc(t.kind)}</p>`;
      const can = t.next.ready && d.points >= t.next.cost && !d.bagUpgrade.off;
      const why = !t.next.ready ? `Needs ${s.name} ${t.next.level}` : d.points < t.next.cost ? `You have ${fmt(d.points)} pts` : '';
      return `<p class="tr-tool"><span>${t.icon} ${esc(t.name)} <span class="muted">→ ${t.next.icon} ${esc(t.next.name)}${t.next.ready ? '' : ` at ${t.next.level}`}</span></span>
        <button class="btn btn-sm ${can ? 'btn-primary' : ''}" data-upgrade="${s.id}" ${can && !working ? '' : `disabled title="${esc(why)}"`}>⬆️ ${fmt(t.next.cost)} pts</button></p>`;
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
              ? '<a class="btn btn-sm" href="#/fishing">🎣 Spots & 3D</a>'
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
        ${toolHtml(s)}
        ${s.needs ? `<p class="tr-need">Needs a ${s.needs.icon} ${esc(s.needs.name)} in your backpack. <a href="#/shop">Shop</a></p>` : ''}
        <div class="tr-row">
          ${selectHtml(s)}
          <button class="btn btn-primary btn-sm tr-go" data-train="${s.id}" ${busy.has(s.id) || (tired && s.id !== 'cooking') ? 'disabled title="Out of stamina: wait for a charge"' : ''}>${busy.has(s.id) ? '…' : verb}</button>
          ${extra}
        </div>`}
        ${said[s.id] ? `<p class="tr-said">${esc(said[s.id])}</p>` : ''}
      </section>`;
    }

    function skillsHtml() {
      const groups = group === 'all' ? d.groups : d.groups.filter((g) => g.id === group);
      return `${full() ? `<div class="tr-fullnote">🎒 Your backpack is full (${d.backpack.used}/${d.backpack.capacity}). <span class="tr-fullnote-btns"><button class="btn btn-sm btn-primary" data-view="bag">Sell items</button>${d.bagUpgrade.next && !d.bagUpgrade.off ? `<button class="btn btn-sm" data-upgrade="backpack" ${d.points >= d.bagUpgrade.next.cost && !working ? '' : 'disabled'}>⬆️ ${d.bagUpgrade.next.capacity} slots · ${fmt(d.bagUpgrade.next.cost)} pts</button>` : ''}</span></div>` : ''}
        <div class="tabs tr-tabs">${[['all', 'All'], ...d.groups.map((g) => [g.id, g.name])]
          .map(([id, name]) => `<button class="tab ${group === id ? 'active' : ''}" data-group="${id}">${esc(name)}</button>`)
          .join('')}</div>
        ${groups.map((g) => `${group === 'all' ? `<h2 class="tr-group">${esc(g.name)}</h2>` : ''}<div class="tr-grid">${g.skills.map(cardHtml).join('')}</div>`).join('')}`;
    }

    // Phones: Skills / Backpack switch along the bottom, with your stamina.
    function dockHtml() {
      return `<nav class="tr-dock" aria-label="Train page sections">
        <button class="${view === 'skills' ? 'active' : ''}" data-view="skills">🏋️ Skills<small class="tr-pips">${pips()}</small></button>
        <button class="${view === 'bag' ? 'active' : ''} ${full() ? 'is-full' : ''}" data-view="bag">🎒 Backpack<small>${d.backpack.used}/${d.backpack.capacity}${chosen.size ? ` · ${chosenCount()} picked` : ''}</small></button>
      </nav>`;
    }

    function render() {
      pruneChosen();
      const y = window.scrollY;
      $app.innerHTML = `<div class="tr-root" data-mode="${view}">
        ${headHtml()}
        <div class="tr-layout">
          <div class="tr-main">${skillsHtml()}</div>
          <aside class="tr-side">${bagHtml()}</aside>
        </div>
        ${dockHtml()}
      </div>`;
      window.scrollTo(0, y);
      wire();
    }

    function wire() {
      const on = (sel, fn) => $app.querySelectorAll(sel).forEach((el) => (el.onclick = (e) => fn(el, e)));
      on('[data-view]', (el) => {
        if (view !== el.dataset.view) {
          view = el.dataset.view;
          render();
          window.scrollTo(0, 0);
        }
      });
      on('[data-group]', (el) => ((group = el.dataset.group), render()));
      $app.querySelectorAll('.tr-target').forEach((sel) => (sel.onchange = () => (picks[sel.dataset.skill] = sel.value)));
      on('[data-train]', (el) => train(el.dataset.train, el.dataset.target ?? picks[el.dataset.train] ?? $app.querySelector(`.tr-target[data-skill="${el.dataset.train}"]`)?.value ?? ''));
      on('[data-sellgroup]', (el) => sell({ group: el.dataset.sellgroup }));
      on('[data-upgrade]', (el) => {
        const what = el.dataset.upgrade;
        const label = what === 'backpack' ? `your backpack to the ${d.bagUpgrade.next?.name} for ${fmt(d.bagUpgrade.next?.cost)} pts` : `your ${d.groups.flatMap((g) => g.skills).find((x) => x.id === what)?.tool?.kind} for ${fmt(d.groups.flatMap((g) => g.skills).find((x) => x.id === what)?.tool?.next?.cost)} pts`;
        if (confirm(`Upgrade ${label}?`)) act('/train/upgrade', { what });
      });
      on('[data-recover]', (el) => act('/train/recover', { how: el.dataset.recover }));
      // Tap a tile to pick it (all of it); tap again to drop it.
      const flip = (id) => {
        const x = itemOf(id);
        if (!x) return;
        if (chosen.has(id)) chosen.delete(id);
        else chosen.set(id, x.qty);
        render();
      };
      $app.querySelectorAll('[data-pick]').forEach((el) => {
        el.onclick = (e) => {
          if (e.target.closest('[data-noflip]')) return;
          flip(el.dataset.pick);
        };
        el.onkeydown = (e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            flip(el.dataset.pick);
          }
        };
      });
      on('[data-step]', (el, e) => {
        e.stopPropagation();
        const x = itemOf(el.dataset.step);
        const n = chosen.get(x.id) || 0;
        chosen.set(x.id, el.dataset.by === 'all' ? x.qty : Math.min(x.qty, Math.max(1, n + Number(el.dataset.by))));
        render();
      });
      on('[data-pickall]', (el) => {
        const how = el.dataset.pickall;
        if (how === 'none') chosen.clear();
        else for (const x of d.bag.items) if (x.sellable && (how === 'every' || x.kind === 'loot')) chosen.set(x.id, x.qty);
        render();
      });
      on('[data-sellpicked]', () => {
        const risky = [...chosen.keys()].map(itemOf).filter((x) => RISKY.includes(x.kind));
        if (risky.length && !confirm(`Also sell ${risky.map((x) => x.name).join(', ')}? (Sell all loot keeps these.)`)) return;
        sell({ items: [...chosen].map(([item, qty]) => ({ item, qty })) }, true);
      });
    }

    // Upgrades and recovering: one at a time, the reply as a toast.
    async function act(path, body) {
      if (working) return;
      working = true;
      render();
      try {
        const r = await api(path, { method: 'POST', body });
        d = r.train;
        toast?.(r.message);
      } catch (e) {
        toast?.(e.message);
      }
      working = false;
      render();
    }

    async function sell(body, picked = false) {
      if (selling) return;
      selling = true;
      render();
      try {
        const r = await api('/train/sell', { method: 'POST', body });
        bagSaid = r.message;
        d = r.train;
        if (picked) chosen.clear();
        // The reply also shows at the top of the list, which may be scrolled away.
        toast?.(`💰 ${r.message}`);
      } catch (e) {
        bagSaid = e.message;
      }
      selling = false;
      render();
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
      const els = $app.querySelectorAll('.tr-refill');
      if (!els.length) return;
      const ms = Number(els[0].dataset.at) - Date.now();
      if (ms > 0) els.forEach((el) => (el.textContent = `+1 in ${left(ms)}`));
      else if (!busy.size && !selling) {
        d = await api('/train').catch(() => d);
        render();
      }
    }, 1000);
  };
})();
