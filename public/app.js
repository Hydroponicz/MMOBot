// MMOBot website — dependency-free single page app with hash routing.
(() => {
  const $app = document.getElementById('app');
  const state = { me: null, isAdmin: false, loginEnabled: false, devMode: false, site: null };

  // ---- helpers -----------------------------------------------------------
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (n) => Number(n || 0).toLocaleString();
  const api = async (path, opts = {}) => {
    const res = await fetch(`/api${path}`, {
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      credentials: 'same-origin',
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
    return data;
  };
  const ago = (ts) => {
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
  const avatar = (url, name, cls = '') =>
    url
      ? `<img class="avatar ${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="avatar ${cls}">${esc((name || '?')[0].toUpperCase())}</span>`;
  const playerLink = (name) => `#/player/${encodeURIComponent(name)}`;
  const toast = (msg) => {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 3500);
  };
  const skillIcon = (id) => state.site?.skills.find((s) => s.id === id)?.icon || '✨';
  const feedIcon = (a) =>
    ({ levelup: '🎉', charlevel: '⭐', rare: '💎', sell: '💰', upgrade: '🔧', test: '🧪', buy: '🛒', jackpot: '🎰', death: '💀' })[a.kind] || (a.skill ? skillIcon(a.skill) : '•');

  // ---- live activity (SSE) ----------------------------------------------
  const listeners = new Set();
  const es = new EventSource('/api/events');
  es.addEventListener('activity', (e) => {
    const a = JSON.parse(e.data);
    listeners.forEach((fn) => fn(a));
  });

  // ---- chrome ------------------------------------------------------------
  function renderAccount() {
    const el = document.getElementById('account');
    if (state.me) {
      el.innerHTML = `
        <a class="me-link" href="#/me">${avatar(state.me.avatarUrl, state.me.username, 'sm')}<span>${esc(state.me.username)}</span></a>
        <button class="btn btn-sm" id="logout">Log out</button>`;
      el.querySelector('#logout').onclick = async () => {
        await fetch('/auth/logout', { method: 'POST' });
        state.me = null;
        state.isAdmin = false;
        renderAccount();
        location.hash = '#/';
      };
    } else if (state.loginEnabled) {
      el.innerHTML = `<a class="btn btn-primary btn-sm" href="/auth/login">Log in with Kick</a>`;
    } else {
      el.innerHTML = '';
    }
    document.getElementById('nav-admin').hidden = !state.isAdmin;
    document.getElementById('nav-dev').hidden = !state.devMode;
  }

  function setActiveNav(route) {
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  }

  // ---- shared components -------------------------------------------------
  function feedItem(a, isNew = false) {
    return `<li class="${esc(a.kind)}${isNew ? ' new' : ''}">
      <span class="ic">${feedIcon(a)}</span>
      <span><a href="${playerLink(a.username)}">${esc(a.username)}</a> ${esc(a.text)}${a.xp ? ` <span class="muted">+${fmt(a.xp)} xp</span>` : ''}</span>
      <span class="t" data-ts="${a.created_at}">${ago(a.created_at)}</span>
    </li>`;
  }

  function liveFeed(el, { filter = () => true, max = 40 } = {}) {
    const fn = (a) => {
      if (!filter(a)) return;
      el.querySelector('.empty')?.remove();
      el.insertAdjacentHTML('afterbegin', feedItem(a, true));
      while (el.children.length > max) el.lastElementChild.remove();
    };
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function skillCard(s) {
    const toNext = s.nextLevelXp == null ? 'Max level!' : `${fmt(s.nextLevelXp - s.xp)} xp to ${s.level + 1}`;
    return `
      <div class="skill-card" style="--c: var(--${esc(s.id)})">
        <div class="skill-top">
          <div class="skill-icon">${s.icon}</div>
          <div><div class="skill-name">${esc(s.name)}</div><div class="skill-cmd">${esc(s.command)}</div></div>
          <div class="skill-level" title="Level">${s.level}</div>
        </div>
        <div class="bar" title="${s.percent}%"><span style="width:${s.percent}%"></span></div>
        <div class="skill-meta"><span>${fmt(s.xp)} xp</span><span>${toNext}</span></div>
        ${s.tool ? toolRow(s.tool) : ''}
        <div class="skill-next">
          ${s.nextUnlock ? `Next unlock: ${s.nextUnlock.icon} <b>${esc(s.nextUnlock.item)}</b> at level ${s.nextUnlock.level}` : 'All tiers unlocked 🏅'}
          ${s.rank ? `<span style="float:right">Rank #${fmt(s.rank)}</span>` : ''}
        </div>
      </div>`;
  }

  // "15% miss · +10% XP · rare x1.1" for a tool tier, based on which stats that tool has.
  const pctText = (x) => `${Math.round(x * 1000) / 10}%`;
  const toolStats = (t, stats, failWord) =>
    stats
      .map((st) =>
        st === 'failChance'
          ? `${pctText(t.failChance)} ${failWord}`
          : st === 'xpBonus'
            ? `+${Math.round(t.xpBonus * 100)}% XP`
            : st === 'rareBonus'
              ? `rare x${t.rareBonus}`
              : `${pctText(t.doubleChance)} double`
      )
      .join(' · ');

  function toolRow(t) {
    const status = !t.next
      ? '<span class="tool-max">Max tier 🏆</span>'
      : t.canUpgrade
        ? `<span class="tool-ready">Ready: <code>!upgrade ${esc(t.id)}</code> · ${fmt(t.next.cost)} pts</span>`
        : `<span class="muted">Next: ${t.next.icon} ${esc(t.next.name)} at level ${t.next.level} · ${fmt(t.next.cost)} pts</span>`;
    return `
      <div class="tool-row" title="${esc(toolStats(t, t.stats, `${t.failWord} chance`))}">
        <span class="tool-icon">${t.icon}</span>
        <span class="tool-name"><b>${esc(t.name)}</b><small>Tier ${t.tier}/${t.tiers} · ${esc(toolStats(t, t.stats.filter((x) => x !== 'rareBonus'), t.failWord))}</small></span>
        ${status}
      </div>`;
  }

  function backpackBar(b) {
    const full = b.used >= b.capacity;
    const pctUsed = Math.min(100, Math.round((b.used / b.capacity) * 100));
    return `
      <div class="bag-head">
        <span class="tool-icon">${b.icon}</span>
        <span class="tool-name"><b>${esc(b.name)}</b><small>Level ${b.level}/${b.levels}${
          b.next ? ` · next: ${b.next.capacity} slots for ${fmt(b.next.cost)} pts (<code>!upgrade backpack</code>)` : ' · biggest backpack 🏆'
        }</small></span>
        <span class="bag-count ${full ? 'full' : ''}">${b.used}/${b.capacity}</span>
      </div>
      <div class="bar" style="--c:${full ? 'var(--danger)' : 'var(--gold)'};margin-top:8px"><span style="width:${pctUsed}%"></span></div>
      ${full ? `<p class="bag-warn">Backpack full: <code>!sell</code>, <code>!smelt</code> or <code>!upgrade backpack</code> to keep gathering.</p>` : ''}`;
  }

  function characterSheet(p, activity, isMe) {
    const c = p.character;
    const inv = p.inventory.length
      ? `<div class="inv-grid">${p.inventory
          .map(
            (i) => `<div class="inv-item${i.rare ? ' rare' : ''}${i.gear ? ' gear' : ''}" title="${esc(itemTitle(i))}">
              <span class="qty">${fmt(i.qty)}</span><div class="ic">${i.icon}</div>
              <div class="nm">${esc(i.name)}</div><div class="val">${fmt(i.value * i.qty)} pts</div>
              ${
                isMe
                  ? `<div class="inv-actions">${i.gear ? `<button class="mini" data-act="equip" data-item="${esc(i.id)}">Equip</button>` : ''}${i.potion ? `<button class="mini" data-act="drink" data-item="${esc(i.id)}">Drink</button>` : ''}<button class="mini" data-act="sell" data-item="${esc(i.id)}" data-name="${esc(i.name)}" data-value="${i.value}">Sell</button></div>`
                  : ''
              }</div>`
          )
          .join('')}</div>`
      : `<div class="empty"><span class="ic">🎒</span>Empty bag. Type <code>!fish</code>, <code>!mine</code>, <code>!chop</code> or <code>!dig</code> in chat.</div>`;
    const charNext = c.nextLevelXp == null ? 'Max character level' : `${c.percent}% to level ${c.level + 1}`;

    return `
     <div id="sheet">
      <section class="panel">
        <div class="char-header">
          ${avatar(p.avatarUrl, p.username)}
          <div class="char-title">
            <h1>${esc(p.username)}</h1>
            <div class="char-badges">
              <span class="badge gold">💰 ${fmt(p.points)} points</span>
              <span class="badge">📊 Total level ${fmt(p.totalLevel)}</span>
              <span class="badge">✨ ${fmt(p.totalXp)} xp</span>
              ${p.overallRank ? `<span class="badge">🏆 Rank #${fmt(p.overallRank)}</span>` : ''}
              <span class="badge">💬 ${fmt(p.messages)} messages</span>
            </div>
          </div>
          <div class="level-ring" style="--p:${c.percent}" title="${charNext}">
            <div class="level-ring-inner"><div><b>${c.level}</b><small>Character</small></div></div>
          </div>
        </div>
        ${isMe ? `<p class="muted" style="margin:14px 0 0">${cooldownText(p)} · ${charNext}</p>` : ''}
      </section>

      <h2 style="margin:28px 0 12px">Skills</h2>
      <div class="grid grid-skills">${p.skills.map(skillCard).join('')}</div>

      ${equipmentPanel(p.combat, isMe)}
      ${farmPanel(p.farm, isMe)}

      <div class="grid grid-2" style="margin-top:16px">
        <section class="panel">
          <div class="panel-head"><h2>Backpack</h2><span class="badge gold">Worth ${fmt(p.inventoryValue)} pts</span></div>
          ${backpackBar(p.backpack)}
          ${inv}
          ${p.inventory.length ? `<p class="muted" style="margin-bottom:0">${isMe ? 'Use the buttons, or in chat:' : 'Sell in chat with'} <code>!sell all</code> or <code>!sell trout 5</code>${isMe ? ', <code>!equip bronze sword</code>' : ''}.</p>` : ''}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Recent activity</h2></div>
          <ul class="feed" id="player-feed">${
            activity.length ? activity.map((a) => feedItem(a)).join('') : '<li class="empty">No activity yet.</li>'
          }</ul>
        </section>
      </div>
     </div>`;
  }

  const SLOT_LABEL = { weapon: 'Weapon', head: 'Head', body: 'Body', legs: 'Legs', shield: 'Shield' };
  const SLOT_EMPTY = { weapon: '🗡️', head: '⛑️', body: '👕', legs: '👖', shield: '🛡️' };

  function itemTitle(i) {
    const bits = [`${i.name} — sells for ${fmt(i.value)} pts`];
    if (i.attack) bits.push(`+${i.attack} attack, needs ${i.wieldSkill || 'Swords'} ${i.level}`);
    if (i.defence) bits.push(`+${i.defence} defence, needs Combat ${i.level}`);
    return bits.join(' · ');
  }

  function vitalsBars(c, isMe) {
    const ko = c.knockedOutUntil && c.knockedOutUntil > Date.now();
    const left = (ms) => {
      const m = ms < 3_600_000 ? Math.max(1, Math.ceil(ms / 60_000)) : Math.floor(ms / 60_000);
      return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
    };
    const bar = (cls, label, v, max) => `<div class="vital ${cls}">
        <div class="vital-label"><span>${label}</span><b>${fmt(v)} / ${fmt(max)}</b></div>
        <div class="vital-bar"><span style="width:${Math.round((v / max) * 100)}%"></span></div></div>`;
    return `<div class="vitals">
        ${bar(`hp${ko ? ' ko' : ''}`, ko ? '💀 Knocked out' : '❤️ Health', ko ? 0 : c.hp, c.maxHp)}
        ${bar('mana', '🔷 Mana', c.mana, c.maxMana)}
      </div>
      ${
        ko
          ? `<p class="bag-warn">Knocked out! Back at full HP in ${left(c.knockedOutUntil - Date.now())}, or drink a health potion (<a href="#/shop">shop</a>, or <code>!brew</code> one) to fight again now.</p>`
          : isMe && c.hp < c.maxHp
            ? `<p class="muted" style="font-size:.85rem;margin:6px 0 0">HP refills over ${c.hpRegenHours}h. ${c.mana >= Math.ceil(c.maxMana / 2) ? '<button class="mini" data-act="heal">✨ Heal (half your mana)</button>' : '<code>!heal</code> needs half your mana.'}</p>`
            : ''
      }`;
  }

  // Monsters rated for this player: a few too-easy ones, every good match, and the first risky ones.
  function monsterChips(list, ratedWith) {
    if (!list || !list.length) return '';
    const firstRisky = list.findIndex((m) => m.rating !== 'easy' && m.rating !== 'fair');
    const end = firstRisky === -1 ? list.length : firstRisky + 2;
    const start = Math.max(0, list.findIndex((m) => m.rating === 'fair') - 1);
    const shown = list.slice(start, end);
    const tip = (m) => (m.cost === null ? `${m.label}: you can't beat it yet` : `${m.label}: you'd lose ~${m.cost}% of your max HP`);
    return `<div class="monster-chips">
        <div class="gear-label">Monsters for you${ratedWith ? ` <span style="text-transform:none">(!fight with ${esc(ratedWith)})</span>` : ''}</div>
        ${shown
          .map((m) => `<span class="mchip r-${m.rating}" title="${esc(tip(m))} · ${fmt(m.hp)} HP · ${fmt(m.xp)} XP">${m.ratingIcon} ${m.icon} ${esc(m.name)} <small>${m.level}</small></span>`)
          .join('')}
        <div class="muted" style="font-size:.8rem;margin-top:6px">⚪ too easy · 🟢 good match · 🟠 tough · 🔴 hard · ☠️ deadly. <code>!targets</code> or <code>!scout &lt;monster&gt;</code> in chat for details.</div>
      </div>`;
  }

  function equipmentPanel(c, isMe) {
    return `
      <section class="panel" style="margin-top:28px">
        <div class="panel-head">
          <h2>Equipment</h2>
          <div class="char-badges">
            <span class="badge">⚔️ Attack +${fmt(c.attack)}</span>
            <span class="badge">🛡️ Defence +${fmt(c.defence)}</span>
            <span class="badge">🎖️ Combat level ${fmt(c.level)}</span>
          </div>
        </div>
        ${vitalsBars(c, isMe)}
        <div class="gear-grid">${c.worn
          .map(
            (w) => `<div class="gear-slot${w.item ? ' filled' : ''}" title="${w.item ? esc(itemTitle(w.item)) : ''}">
              <div class="gear-label">${SLOT_LABEL[w.slot]}</div>
              <div class="ic">${w.item ? w.item.icon : `<span class="ghost">${SLOT_EMPTY[w.slot]}</span>`}</div>
              <div class="nm">${w.item ? esc(w.item.name) : 'Empty'}</div>
              <div class="gear-stat">${w.item ? (w.item.attack ? `+${w.item.attack} attack` : `+${w.item.defence} defence`) : '&nbsp;'}</div>
              ${isMe && w.item ? `<button class="mini" data-act="unequip" data-slot="${w.slot}">Unequip</button>` : ''}
            </div>`
          )
          .join('')}</div>
        ${monsterChips(c.monsters, c.ratedWith)}
        <p class="muted" style="margin-bottom:0;font-size:.85rem">Buy a sword or bow in the <a href="#/shop">shop</a>, or <code>!smith</code> / <code>!fletch</code> your own, then <code>!fight</code> (or <code>!shoot</code> with a bow, a quiver and arrows). <code>!targets</code> shows your best fights. Your best weapon is equipped automatically when you fight. Fights cost HP; monsters above your level hit much harder.</p>
      </section>`;
  }

  function farmPanel(f, isMe) {
    const now = Date.now();
    const left = (ms) => (ms < 60_000 ? '<1m' : ms < 3_600_000 ? `${Math.ceil(ms / 60_000)}m` : `${Math.floor(ms / 3_600_000)}h${Math.ceil((ms % 3_600_000) / 60_000)}m`);
    if (!f.plots.length) {
      return `<section class="panel" style="margin-top:16px">
        <div class="panel-head"><h2>🌱 Farm</h2></div>
        <div class="empty"><span class="ic">🟫</span>No farm plots yet. Buy one in the <a href="#/shop">shop</a> (${fmt(f.plotCost)} pts) or <code>!buy plot</code> in chat.</div>
      </section>`;
    }
    const ready = f.plots.filter((p) => p.ready).length;
    const empty = f.plots.filter((p) => !p.crop).length;
    return `<section class="panel" style="margin-top:16px">
      <div class="panel-head">
        <h2>🌱 Farm <span class="muted" style="font-size:.9rem">${f.plots.length}/${f.max} plots</span></h2>
        ${
          isMe
            ? `<div class="form-row">${ready ? `<button class="btn btn-primary btn-sm" data-act="harvest">Harvest ${ready}</button>` : ''}${
                empty ? `<button class="btn btn-sm" data-act="plant">Plant ${empty}</button>` : ''
              }</div>`
            : ''
        }
      </div>
      <div class="plot-grid">${f.plots
        .map((p) => {
          if (!p.crop) return `<div class="plot empty" title="Plot ${p.plot}: empty">·</div>`;
          const total = p.readyAt - p.plantedAt;
          const pctDone = p.ready ? 100 : Math.min(99, Math.round(((now - p.plantedAt) / total) * 100));
          return `<div class="plot${p.ready ? ' ready' : ''}" title="Plot ${p.plot}: ${esc(p.crop.name)} — ${p.ready ? 'ready!' : `${left(p.readyAt - now)} left`}" style="--g:${pctDone}%">
            <span>${p.crop.icon}</span><small>${p.ready ? '✅' : left(p.readyAt - now)}</small></div>`;
        })
        .join('')}</div>
      <p class="muted" style="margin-bottom:0;font-size:.85rem"><code>!plant carrot</code> fills empty plots (one seed each), <code>!harvest</code> collects ready ones, <code>!farm</code> shows this in chat. Buy seeds and plots in the <a href="#/shop">shop</a>.</p>
    </section>`;
  }

  // Equip / unequip / sell buttons on your own character page.
  function bindSheetActions() {
    const sheet = document.getElementById('sheet');
    if (!sheet) return;
    sheet.onclick = async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const { act, item, slot, name, value } = b.dataset;
      let body;
      if (act === 'sell') {
        if (!confirm(`Sell 1 ${name} for ${fmt(value)} points?`)) return;
        body = { item, qty: 1 };
      } else if (act === 'plant' || act === 'harvest' || act === 'heal') body = {};
      else body = act === 'unequip' ? { slot } : { item };
      b.disabled = true;
      try {
        const r = await api(`/me/${act}`, { method: 'POST', body });
        toast(r.message);
        route();
      } catch (err) {
        toast(err.message);
        b.disabled = false;
      }
    };
  }

  function cooldownText(p) {
    const left = Math.ceil((p.cooldownEndsAt - Date.now()) / 1000);
    return left > 0 ? `⏳ Next action ready in ${left}s` : '✅ Ready for your next action';
  }

  // ---- pages -------------------------------------------------------------
  const pages = {};

  pages.home = async () => {
    const [lb, act, guide] = await Promise.all([api('/leaderboard/overall?limit=10'), api('/activity'), api('/guide')]);
    const t = state.site.totals;
    const channel = state.site.channel;
    $app.innerHTML = `
      <section class="hero">
        <div>
          <h1>Level up by chatting${channel ? ` in <span style="color:var(--accent)">${esc(channel)}</span>'s stream` : ''}.</h1>
          <p>Type commands in Kick chat to fish, mine, chop, dig and smelt. Earn XP, level your skills, collect loot and climb the leaderboards. Every chatter gets a character automatically — log in with Kick to see yours.</p>
          <div class="hero-actions">
            ${
              state.me
                ? `<a class="btn btn-primary" href="#/me">View my character</a>`
                : state.loginEnabled
                  ? `<a class="btn btn-primary" href="/auth/login">Log in with Kick</a>`
                  : ''
            }
            ${channel ? `<a class="btn" href="https://kick.com/${esc(channel)}" target="_blank" rel="noopener">Watch the stream ↗</a>` : ''}
            <a class="btn" href="#/guide">How to play</a>
          </div>
        </div>
        <div class="cmd-cloud">
          ${guide.skills
            .map((s) => `<div class="cmd-chip"><span class="ic">${s.icon}</span><div><b>${esc(s.command)}</b><small>${esc(s.name)}</small></div></div>`)
            .join('')}
          <div class="cmd-chip"><span class="ic">📜</span><div><b>!stats</b><small>Your levels</small></div></div>
        </div>
      </section>

      <div class="stat-row">
        <div class="stat"><div class="v">${fmt(t.players)}</div><div class="k">Adventurers</div></div>
        <div class="stat"><div class="v">${fmt(t.actions)}</div><div class="k">Actions taken</div></div>
        <div class="stat"><div class="v">${fmt(t.xp)}</div><div class="k">XP earned</div></div>
      </div>

      <div class="grid grid-2">
        <section class="panel">
          <div class="panel-head"><h2>🔴 Live activity</h2><span class="muted">Updates in real time</span></div>
          <ul class="feed" id="home-feed">${
            act.activity.length
              ? act.activity.map((a) => feedItem(a)).join('')
              : '<li class="empty"><span class="ic">🌱</span>Nothing yet — type !fish in chat!</li>'
          }</ul>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>🏆 Top adventurers</h2><a href="#/leaderboards">View all</a></div>
          ${leaderboardTable(lb, true)}
        </section>
      </div>`;
    return liveFeed(document.getElementById('home-feed'));
  };

  function leaderboardTable({ kind, rows }, compact = false) {
    if (!rows.length) return `<div class="empty"><span class="ic">🏁</span>No one here yet. Be the first!</div>`;
    const showLevel = kind !== 'points';
    const showValue = !compact || kind === 'points';
    return `<div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Player</th>
        ${showLevel ? `<th class="num">${kind === 'overall' ? 'Char lvl' : 'Level'}</th>` : ''}
        ${showValue ? `<th class="num">${kind === 'points' ? 'Points' : 'XP'}</th>` : ''}</tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr class="${state.me && state.me.username === r.username ? 'me' : ''}">
          <td class="rank rank-${r.rank}">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td>
          <td><a class="player-cell" href="${playerLink(r.username)}">${avatar(r.avatarUrl, r.username, 'sm')}${esc(r.username)}</a></td>
          ${showLevel ? `<td class="num"><b>${r.level}</b></td>` : ''}
          ${showValue ? `<td class="num">${fmt(kind === 'points' ? r.points : r.xp)}</td>` : ''}
        </tr>`
        )
        .join('')}</tbody></table></div>`;
  }

  let shopShowAllSeeds = false;
  pages.shop = async () => {
    const { items, points, farmingLevel, plots } = await api('/shop');
    const loggedIn = points !== null;
    const buyBtn = (i, locked) =>
      loggedIn ? `<button class="btn btn-primary btn-sm" data-buy="${esc(i.item)}" ${locked ? 'disabled' : ''}>Buy</button>` : '';
    const card = (i) => `<section class="panel shop-item">
            <div class="shop-icon">${i.icon}</div>
            <h2>${esc(i.name)}</h2>
            <p class="muted">${esc(i.description || '')}</p>
            ${i.attack ? `<p class="shop-stat">⚔️ +${i.attack} attack · needs ${esc(i.wieldSkill || 'Swords')} ${i.level}</p>` : ''}
            ${i.item === 'farm_plot' && loggedIn ? `<p class="shop-stat">You own ${plots}/100 plots</p>` : ''}
            <div class="shop-buy">
              <span class="shop-price">${fmt(i.cost)} pts</span>
              ${(i.item === 'farm_plot' || i.category === 'potions') && loggedIn ? `<input type="number" class="qty" id="qty-${esc(i.item)}" value="1" min="1" max="100" aria-label="How many">` : ''}
              ${buyBtn(i, i.item === 'farm_plot' && plots >= 100)}
            </div>
            <p class="muted" style="font-size:.8rem;margin:8px 0 0">In chat: <code>!buy ${esc(i.item === 'farm_plot' ? 'plot' : i.category === 'potions' ? i.name.toLowerCase() : i.name.split(' ').pop().toLowerCase())}</code></p>
          </section>`;
    const allSeeds = items.filter((i) => i.category === 'seeds');
    // Show what you can plant now plus the next few unlocks; "Show all" reveals the rest.
    const cap = loggedIn ? farmingLevel : 1;
    const locked = allSeeds.filter((i) => i.level > cap);
    const seeds = shopShowAllSeeds ? allSeeds : [...allSeeds.filter((i) => i.level <= cap), ...locked.slice(0, 5)];
    const top = items.filter((i) => !i.category || i.category === 'farming');
    const potions = items.filter((i) => i.category === 'potions');
    $app.innerHTML = `
      <div class="panel-head" style="margin-bottom:6px"><h1 style="margin:0">🛒 Shop</h1>${
        loggedIn
          ? `<span class="badge gold" style="font-size:1rem">💰 ${fmt(points)} points</span>`
          : state.loginEnabled
            ? `<a class="btn btn-primary" href="/auth/login">Log in with Kick to buy</a>`
            : ''
      }</div>
      <p class="muted">Spend the points you earn in chat. You can also buy in chat, e.g. <code>!buy hammer</code> or <code>!buy carrot seeds 5</code>.</p>
      <div class="shop-grid">${top.map(card).join('')}</div>

      <h2 style="margin:28px 0 6px">🧪 Potions</h2>
      <p class="muted">Fights cost HP. At 0 you're knocked out until you're back at full HP (24h), or until you drink a health potion. <code>!drink</code> in chat drinks the best one for you. Or brew your own from farmed crops with <code>!brew</code>.</p>
      <div class="shop-grid">${potions.map(card).join('')}</div>

      <h2 style="margin:28px 0 6px">🌱 Seeds</h2>
      <p class="muted">One seed per plot: <code>!plant carrot</code>, then <code>!harvest</code> when it's grown (1 crop per plot). Seeds don't take backpack space.${loggedIn ? ` Your Farming level: <b>${farmingLevel}</b>.` : ''}</p>
      <section class="panel"><div class="table-wrap"><table>
        <thead><tr><th>Level</th><th>Seed</th><th>Grows</th><th class="num">Ready in</th><th class="num">Crop sells for</th><th class="num">Price</th>${loggedIn ? '<th>Buy</th>' : ''}</tr></thead>
        <tbody>${seeds
          .map((i) => {
            const locked = loggedIn && farmingLevel < i.level;
            return `<tr class="${locked ? 'locked' : ''}">
              <td><b>${i.level}</b></td>
              <td>🌱 ${esc(i.crop.name)} seeds</td>
              <td>${i.crop.icon} ${esc(i.crop.kind)}</td>
              <td class="num">${i.crop.grow} min</td>
              <td class="num">${fmt(i.crop.value)} pts</td>
              <td class="num">${fmt(i.cost)} pts</td>
              ${
                loggedIn
                  ? `<td>${
                      locked
                        ? `<span class="muted">Farming ${i.level}</span>`
                        : `<div class="form-row"><input type="number" class="qty" id="qty-${esc(i.item)}" value="${Math.max(1, plots || 1)}" min="1" max="1000" aria-label="How many"> ${buyBtn(i, false)}</div>`
                    }</td>`
                  : ''
              }
            </tr>`;
          })
          .join('')}</tbody></table></div>
        ${
          seeds.length < allSeeds.length
            ? `<button class="btn" id="show-all-seeds" style="margin-top:12px">Show all ${allSeeds.length} seeds</button>`
            : ''
        }</section>`;
    const showAll = $app.querySelector('#show-all-seeds');
    if (showAll) showAll.onclick = () => ((shopShowAllSeeds = true), route());
    $app.querySelectorAll('[data-buy]').forEach((b) => {
      b.onclick = async () => {
        const qtyInput = document.getElementById(`qty-${b.dataset.buy}`);
        b.disabled = true;
        try {
          const r = await api('/shop/buy', { method: 'POST', body: { item: b.dataset.buy, qty: qtyInput ? qtyInput.value : 1 } });
          toast(r.message);
          route();
        } catch (err) {
          toast(err.message);
          b.disabled = false;
        }
      };
    });
  };

  pages.casino = async () => window.MMOCasino($app, { api, toast, esc, fmt, state, route });

  pages.leaderboards = async (_, query) => {
    const kind = query.get('board') || 'overall';
    const tabs = [
      { id: 'overall', label: '🏆 Overall' },
      { id: 'points', label: '💰 Points' },
      ...state.site.skills.map((s) => ({ id: s.id, label: `${s.icon} ${s.name}` })),
    ];
    const data = await api(`/leaderboard/${encodeURIComponent(kind)}?limit=100`);
    $app.innerHTML = `
      <h1>Leaderboards</h1>
      <div class="tabs">${tabs
        .map((t) => `<a class="tab ${t.id === kind ? 'active' : ''}" href="#/leaderboards?board=${t.id}">${t.label}</a>`)
        .join('')}</div>
      <section class="panel">${leaderboardTable(data)}</section>`;
  };

  pages.player = async ([name]) => {
    const data = await api(`/player/${encodeURIComponent(name)}`).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!data) {
      $app.innerHTML = `<div class="panel empty"><span class="ic">🔍</span>No adventurer named <b>${esc(name)}</b> yet. They need to chat first!</div>`;
      return;
    }
    const isMe = state.me && state.me.id === data.profile.id;
    $app.innerHTML = characterSheet(data.profile, data.activity, isMe);
    if (isMe) bindSheetActions();
    return liveFeed(document.getElementById('player-feed'), {
      filter: (a) => a.username === data.profile.username,
      max: 25,
    });
  };

  pages.me = async () => {
    if (!state.me) {
      $app.innerHTML = `
        <div class="panel empty">
          <span class="ic">🧙</span>
          <h2>Your character awaits</h2>
          <p>Log in with the Kick account you chat with — your progress from chat is already saved.</p>
          ${state.loginEnabled ? `<a class="btn btn-primary" href="/auth/login">Log in with Kick</a>` : '<p>Kick login is not configured yet.</p>'}
        </div>`;
      return;
    }
    return pages.player([state.me.username]);
  };

  pages.guide = async () => {
    const g = await api('/guide');
    const rareRows = (s, cols) =>
      s.rares
        .map(
          (r) => `<tr style="color:var(--rare)"><td>Rare · ${esc(r.odds)}</td><td>${r.icon} ${esc(r.item)}${r.from ? ` <span class="muted">(${esc(r.from)})</span>` : ''}</td>${'<td></td>'.repeat(cols)}<td class="num">${r.xp ? fmt(r.xp) : ''}</td><td class="num">${fmt(r.value)} pts</td></tr>`
        )
        .join('');
    const gearStat = (st) => (st.attack ? `+${st.attack} atk${st.ammo ? ' per shot' : ''} · ${esc(st.skill || 'Swords')} ${st.wear}` : `+${st.defence} def · Combat ${st.wear}`);
    const tierTable = (s) => {
      if (s.type === 'farm') {
        return `
      <details><summary class="btn btn-sm" style="margin-bottom:12px">Show all ${s.tiers.length} crops</summary>
      <div class="table-wrap"><table>
        <thead><tr><th>Level</th><th>Crop</th><th>Type</th><th class="num">Seed</th><th class="num">Ready in</th><th class="num">XP</th><th class="num">Sells for</th></tr></thead>
        <tbody>${s.tiers
          .map(
            (t) => `<tr><td><b>${t.level}</b></td><td>${t.icon} ${esc(t.item)}</td><td><span class="kind kind-${t.kind === 'herb' ? 'herb' : 'veg'}">${esc(t.kind)}</span></td>
            <td class="num">${fmt(t.seedCost)} pts</td><td class="num">${t.grow} min</td><td class="num">${t.xp}</td><td class="num">${fmt(t.value)} pts</td></tr>`
          )
          .join('')}</tbody></table></div></details>`;
      }
      if (s.type === 'combat' && s.id !== g.skills.find((x) => x.type === 'combat').id) {
        return `<p class="muted">Same monsters as ${esc(g.skills.find((x) => x.type === 'combat').name)} (above). Fight them with a bow using <code>${esc(s.command)}</code>; each fight uses one arrow from your quiver.</p>`;
      }
      if (s.type === 'combat') {
        return `
      <div class="table-wrap"><table>
        <thead><tr><th>Level</th><th>Monster</th><th class="num">HP</th><th>Loot</th><th class="num">XP</th><th class="num">Loot sells for</th></tr></thead>
        <tbody>${s.tiers
          .map(
            (t) => `<tr><td><b>${t.level}</b></td><td>${t.icon} ${esc(t.item)}</td><td class="num">${fmt(t.hp)}</td>
            <td class="wrap">${t.loot.map((l) => `${l.icon} ${esc(l.item)}`).join(', ')}</td>
            <td class="num">${t.xp}</td><td class="num">${t.loot.map((l) => fmt(l.value)).join(' / ')} pts</td></tr>`
          )
          .join('')}${rareRows(s, 2)}</tbody></table></div>
      <p class="muted" style="font-size:.85rem">Any monster can be fought at any level, but ones above your level hit much harder: twice your level is a hard fight, three times will likely knock you out.</p>`;
      }
      const isProcess = s.type === 'process';
      const hasStats = s.tiers.some((t) => t.stats);
      return `
      <div class="table-wrap"><table>
        <thead><tr><th>Level</th><th>${isProcess ? 'Makes' : 'Resource'}</th>${isProcess ? '<th>Type</th><th>Needs (from your backpack)</th>' : ''}${hasStats ? '<th>Stats</th>' : ''}<th class="num">XP</th><th class="num">Sells for</th></tr></thead>
        <tbody>${s.tiers
          .map(
            (t) => `<tr><td><b>${t.level}</b></td><td>${t.icon} ${esc(t.item)}</td>
            ${t.kind ? `<td><span class="kind kind-${esc(t.kind)}">${esc(t.kind)}</span></td>` : ''}
            ${t.inputs ? `<td class="wrap">${t.inputs.map((i) => `${i.qty}× ${i.icon} ${esc(i.item)}`).join(' + ')}</td>` : ''}
            ${hasStats ? `<td class="wrap">${t.stats ? gearStat(t.stats) : ''}</td>` : ''}
            <td class="num">${t.xp}</td><td class="num">${fmt(t.value)} pts</td></tr>`
          )
          .join('')}${rareRows(s, 0)}</tbody></table></div>`;
    };
    const STAT_HEAD = {
      failChance: (t) => `<th class="num" title="Chance an action fails">${t.failWord === 'snap' ? 'Snap' : 'Miss'}</th>`,
      xpBonus: () => '<th class="num" title="Bonus XP">XP</th>',
      rareBonus: () => '<th class="num" title="Rare-find odds multiplier">Rare</th>',
      doubleChance: () => '<th class="num" title="Chance to smelt two at once">Double</th>',
    };
    const STAT_CELL = {
      failChance: (r) => pctText(r.failChance),
      xpBonus: (r) => `+${Math.round(r.xpBonus * 100)}%`,
      rareBonus: (r) => `x${r.rareBonus}`,
      doubleChance: (r) => pctText(r.doubleChance),
    };
    const toolTable = (t, skill) => `
      <h3 style="margin:22px 0 8px">${esc(t.name)}s <code>${esc(t.command)}</code></h3>
      <p class="muted" style="margin-top:0">Everyone starts with a ${esc(t.tiers[0].name)}. A better one unlocks every 50 ${esc(skill.name)} levels and costs points. Upgrade one tier at a time.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Level</th><th>${esc(t.name)}</th>${t.stats.map((st) => STAT_HEAD[st](t)).join('')}<th class="num">Cost</th></tr></thead>
        <tbody>${t.tiers
          .map(
            (r) => `<tr><td><b>${r.level}</b></td><td>${r.icon} ${esc(r.name)}</td>${t.stats.map((st) => `<td class="num">${STAT_CELL[st](r)}</td>`).join('')}
            <td class="num">${r.cost ? `${fmt(r.cost)} pts` : 'free'}</td></tr>`
          )
          .join('')}</tbody></table></div>`;
    $app.innerHTML = `
      <h1>How to play</h1>
      <div class="grid grid-2">
        <section class="panel">
          <h2>Getting started</h2>
          <ol class="steps">
            <li>Type a skill command in chat, like <code>${esc(g.skills[0].command)}</code>. Your character is created automatically.</li>
            <li>Each action gives XP and an item. You can act once every <b>${g.actionCooldown}s</b>.</li>
            <li>Higher levels unlock better resources. Target one directly, e.g. <code>!mine iron</code> or <code>!chop oak</code>.</li>
            <li>Mine ores, then <code>!smelt</code> them into <b>ingots</b> (one ore) and <b>alloys</b> (mixed ores, e.g. copper + tin = bronze). The ores come out of your backpack.</li>
            <li>Your backpack holds <b>${g.backpack[0].capacity} items</b> to start. When it's full, <code>!sell</code>, <code>!smelt</code> or <code>!upgrade backpack</code> (up to ${g.backpack[g.backpack.length - 1].capacity} slots).</li>
            <li>Just chatting earns <b>${g.chatPoints} points</b> (once every ${g.chatCooldown}s). <code>!sell</code> loot for even more.</li>
            <li>Every skill goes all the way to <b>level 500</b>. Every 50 levels you can buy a better tool with points: <code>!upgrade rod</code>, <code>pickaxe</code>, <code>axe</code>, <code>shovel</code> or <code>furnace</code>. Better tools fail less, give bonus XP and better rare odds (furnaces can smelt two at once). <code>!gear</code> shows all your tools.</li>
            ${g.xpMultiplier !== 1 ? `<li><b>🔥 ${g.xpMultiplier}× XP event is on right now!</b></li>` : ''}
            <li><b>Smithing</b>: buy a 🔨 Smithing Hammer in the <a href="#/shop">shop</a> (keep it in your backpack), then turn alloys into weapons and armor: <code>!smith bronze sword</code>. <code>!equip</code> gear for attack and defence, or <code>!sell</code> it.</li>
            <li><b>Skinning</b>: with a 🔪 Skinning Knife in your backpack (buy it in the <a href="#/shop">shop</a> or smith it at Smithing 20 from a Sterling Alloy), <code>!skin</code> animals for hides, from rabbits up to celestial fleece.</li>
            <li><b>Farming</b>: everyone gets a free 🟫 farm plot. Buy seeds (and more plots, ${fmt((g.shop.find((x) => x.item === 'farm_plot') || {}).cost || 0)} pts each, up to 100) in the <a href="#/shop">shop</a>, <code>!plant carrot</code>, and <code>!harvest</code> when it's grown (carrots take 20 minutes, 1 crop per plot). ${g.skills.find((x) => x.type === 'farm')?.tiers.length || ''} crops to unlock up to level 500. Farming has its own cooldown, so you can farm while you do everything else.</li>
            <li><b>Combat</b>: with a sword (shop or smithed), <code>!fight</code> monsters for Swords XP and loot. <code>!fight goblin</code> picks a target (<code>!targets</code> lists the best ones for your level, gear and HP), and you can pick any monster, but ones above your level hit much harder. <code>!monsters</code> rates them for you (⚪ too easy · 🟢 good match · 🟠 tough · 🔴 hard · ☠️ deadly) and <code>!scout troll</code> shows how a fight would go. A plain <code>!fight</code> picks your best safe match, and you're warned before a fight that would likely knock you out. Fights cost ❤️ HP (better weapons and armor mean less). At 0 HP you're knocked out: wait until you're back at full HP (24h) or <code>!drink</code> a health potion. <code>!heal</code> spends 🔷 mana to restore HP.</li>
            <li><b>Archery &amp; Fletching</b>: <code>!fletch arrows</code> from 1 Oak Logs + 1 🪶 Feathers (from chickens) + 1 Iron Ingot, 10 at a time. Arrows go in a 🧺 Quiver (shop 250 pts, or <code>!fletch quiver</code> from 2 Rabbit Hides), which holds 500. Get a bow (shop 500 pts, or <code>!fletch oak shortbow</code> from 2 Oak Logs), then <code>!shoot</code> monsters for Archery XP: each fight uses one arrow, and better arrows hit harder. <code>!fight</code> uses whichever combat skill you're best at.</li>
            <li><b>Alchemy</b>: <code>!brew</code> potions from crops you farm, e.g. 2 Carrots make a Minor Health Potion. Or buy potions in the <a href="#/shop">shop</a>.</li>
            <li>Your <b>character level</b> grows with the combined XP of all skills — train them all!</li>
          </ol>
        </section>
        <section class="panel">
          <h2>Chat commands</h2>
          <dl class="kv">
            ${g.skills.map((s) => `<dt><code>${esc(s.command)}</code></dt><dd>${s.icon} Train ${esc(s.name)}</dd>`).join('')}
            <dt><code>!gear</code></dt><dd>Show all your tools and backpack</dd>
            <dt><code>!&lt;tool&gt;</code></dt><dd>Show one tool: <code>!rod</code> <code>!pickaxe</code> <code>!axe</code> <code>!shovel</code> <code>!furnace</code></dd>
            <dt><code>!upgrade &lt;tool&gt;</code></dt><dd>Upgrade a tool (every 50 levels, costs points)</dd>
            <dt><code>!upgrade backpack</code></dt><dd>More backpack slots (costs points)</dd>
            <dt><code>!plant [crop]</code></dt><dd>Plant seeds in empty plots</dd>
            <dt><code>!harvest</code></dt><dd>Collect grown crops (<code>!farm</code> shows your plots)</dd>
            <dt><code>!skin</code></dt><dd>Skin animals (needs a knife)</dd>
            <dt><code>!smith &lt;item&gt;</code></dt><dd>Smith gear from alloys (needs a hammer)</dd>
            <dt><code>!fight [monster]</code></dt><dd>Fight for Swords XP and loot (costs HP)</dd>
            <dt><code>!hp</code></dt><dd>Show your health and mana</dd>
            <dt><code>!drink [potion]</code></dt><dd>Drink a potion (revives you if knocked out)</dd>
            <dt><code>!targets [bow]</code></dt><dd>The best monsters for you to fight right now</dd>
            <dt><code>!shoot [monster]</code></dt><dd>Fight with a bow (uses 1 arrow)</dd>
            <dt><code>!fletch &lt;item&gt;</code></dt><dd>Make arrows, bows or a quiver (<code>!quiver</code> shows your arrows)</dd>
            <dt><code>!monsters</code></dt><dd>Which monsters suit you (⚪ too easy to ☠️ deadly)</dd>
            <dt><code>!scout &lt;monster&gt;</code></dt><dd>How a fight would go, without fighting</dd>
            <dt><code>!heal</code></dt><dd>Spend half your mana to restore 25% HP</dd>
            <dt><code>!equip &lt;item&gt;</code></dt><dd>Wear gear (<code>!unequip</code>, <code>!equipped</code>)</dd>
            <dt><code>!buy &lt;item&gt;</code></dt><dd>Buy a hammer or sword (<code>!shop</code> lists them)</dd>
            <dt><code>!stats [name]</code></dt><dd>Show levels and points</dd>
            <dt><code>!inv</code></dt><dd>Show your backpack</dd>
            <dt><code>!sell all</code></dt><dd>Sell everything for points</dd>
            <dt><code>!sell trout 5</code></dt><dd>Sell a specific item</dd>
            <dt><code>!points</code></dt><dd>Show your points</dd>
            <dt><code>!top [skill]</code></dt><dd>Top 5 players</dd>
            <dt><code>!slots 500</code></dt><dd>🎰 Spin the slots (<code>!slots all</code>, <code>!slots half</code>, <code>!slots 1k</code>)</dd>
            <dt><code>!roulette red 500</code></dt><dd>🎡 Bet on red/black/green, odd/even, low/high, 1st/2nd/3rd or a number</dd>
            <dt><code>!plinko 500 high</code></dt><dd>🔻 Drop a plinko ball (low, medium or high risk)</dd>
            <dt><code>!bj 500</code></dt><dd>🃏 Blackjack, then <code>!hit</code>, <code>!stand</code> or <code>!double</code></dd>
            <dt><code>!commands</code></dt><dd>List commands</dd>
          </dl>
        </section>
      </div>
      <section class="panel" style="margin-top:16px">
        <h2>🎒 Backpacks <code>!upgrade backpack</code></h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Level</th><th>Backpack</th><th class="num">Slots</th><th class="num">Cost</th></tr></thead>
          <tbody>${g.backpack
            .map((b) => `<tr><td><b>${b.level}</b></td><td>${b.icon} ${esc(b.name)}</td><td class="num">${b.capacity}</td><td class="num">${b.cost ? `${fmt(b.cost)} pts` : 'free'}</td></tr>`)
            .join('')}</tbody></table></div>
      </section>
      <h2 style="margin:28px 0 12px">Skills &amp; unlocks</h2>
      <div class="grid grid-guide">
        ${g.skills
          .map(
            (s) => `<section class="panel${s.type === 'combat' || s.type === 'farm' || s.tiers.some((t) => t.stats) ? ' span-all' : ''}"><h2>${s.icon} ${esc(s.name)} <code>${esc(s.command)}</code> <span class="muted" style="font-size:.8rem;font-weight:600">max level ${s.maxLevel}</span></h2>${tierTable(s)}${s.tool ? toolTable(s.tool, s) : ''}</section>`
          )
          .join('')}
      </div>`;
  };

  const ADMIN_TABS = [
    ['overview', '📡 Overview'],
    ['settings', '⚙️ Settings'],
    ['players', '👥 Players'],
    ['logs', '📜 Logs'],
  ];

  pages.admin = async (_, query) => {
    if (!state.isAdmin) {
      $app.innerHTML = `<div class="panel empty"><span class="ic">🔒</span>Admins only. Log in with the channel owner's Kick account.</div>`;
      return;
    }
    const tab = ADMIN_TABS.some(([id]) => id === query.get('tab')) ? query.get('tab') : 'overview';
    const header = `
      <h1>Admin</h1>
      <div class="tabs">${ADMIN_TABS.map(([id, label]) => `<a class="tab ${id === tab ? 'active' : ''}" href="#/admin?tab=${id}">${label}</a>`).join('')}</div>`;
    return adminPages[tab](query, header);
  };

  const adminPages = {};

  adminPages.overview = async (query, header) => {
    const s = await api('/admin/status');
    const ok = query.get('ok');
    const err = query.get('error');
    const dot = (on) => `<span class="status-dot ${on ? 'on' : ''}"></span>`;
    const subs = s.subscriptions;
    $app.innerHTML = `
      ${header}
      ${ok ? `<div class="alert ok">${esc(ok)}</div>` : ''}${err ? `<div class="alert err">${esc(err)}</div>` : ''}
      ${
        s.persistentStorage
          ? ''
          : `<div class="alert err"><b>No volume attached.</b> Player progress is stored on a temporary disk and will be lost on the next redeploy. In Railway, right-click this service → Attach volume (any mount path), then redeploy.</div>`
      }
      ${!s.kickConfigured ? `<div class="alert err">Set <code>KICK_CLIENT_ID</code> and <code>KICK_CLIENT_SECRET</code> to connect to Kick.</div>` : ''}
      <div class="grid grid-2">
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>1. Chat subscription</h2>${dot(subs && subs.length)}</div>
            <p class="muted">MMOBot subscribes to <b>${esc(s.channel || 'your channel')}</b>'s chat through Kick's official webhooks automatically, and re-checks every 30 minutes.</p>
            <button class="btn" id="resub" ${s.kickConfigured ? '' : 'disabled'}>Check / re-subscribe now</button>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>2. Bot account</h2>${dot(s.bot)}</div>
            ${
              s.botIsChannelAccount
                ? `<div class="alert err">The account connected as the bot is your channel account, so it's being ignored. Connect your bot account (e.g. <i>mmobot</i>) with the link below.</div>`
                : ''
            }
            <p class="muted">Replies are posted from a separate Kick account, e.g. <i>mmobot</i>. Kick signs in with whichever account is logged into kick.com in the browser, so connect it from a <b>private/incognito window</b>:</p>
            <ol class="steps muted">
              <li>Click <b>Get bot login link</b> and copy the link.</li>
              <li>Open a private/incognito window and paste the link.</li>
              <li>Log into Kick as your bot account and approve.</li>
            </ol>
            ${s.bot ? `<p>Replying as <b>${esc(s.bot.username)}</b>.</p>` : ''}
            <div class="form-row" style="flex-wrap:wrap">
              <button class="btn ${s.bot ? '' : 'btn-primary'}" id="bot-link">Get bot login link</button>
              ${s.bot ? '<button class="btn btn-danger" data-disconnect="bot">Disconnect bot account</button>' : ''}
            </div>
            <div id="bot-link-box" hidden style="margin-top:12px">
              <div class="form-row"><input type="text" id="bot-link-url" readonly style="max-width:none"><button class="btn" id="bot-link-copy">Copy</button></div>
              <p class="muted" style="margin:6px 0 0;font-size:.85rem">Works once and expires in 30 minutes.</p>
            </div>
            <p class="muted" style="margin-bottom:0;font-size:.85rem">Tip: type <code>/mod ${esc(s.bot?.username || 'mmobot')}</code> in your chat so slow mode and follower-only mode don't block replies.</p>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>3. Channel connection</h2>${dot(s.broadcaster)}</div>
            <p class="muted">Optional once a bot account is connected. Without one, replies are sent through your channel account as your Kick app's bot.</p>
            ${
              s.broadcaster
                ? `<p>Connected as <b>${esc(s.broadcaster.username)}</b>.</p>
                   <a class="btn" href="/auth/connect/broadcaster">Reconnect</a>
                   <button class="btn btn-danger" data-disconnect="broadcaster">Disconnect</button>`
                : `<a class="btn" href="/auth/connect/broadcaster">Connect channel</a>`
            }
          </section>
          <section class="panel">
            <h2>Send a test message</h2>
            <form class="form-row" id="say-form"><input type="text" name="text" placeholder="Hello chat! Type !commands to play" style="max-width:none" maxlength="500"><button class="btn btn-primary">Send</button></form>
          </section>
        </div>
        <div class="stack">
          <section class="panel">
            <h2>Status</h2>
            <dl class="kv">
              <dt>Channel</dt><dd>${esc(s.channel || '— set KICK_CHANNEL')}${s.channelId ? ` <span class="muted">(id ${esc(s.channelId)})</span>` : ''}</dd>
              <dt>Replies come from</dt><dd>${
                s.replySender.mode === 'bot_account'
                  ? `${dot(true)}${esc(s.replySender.username)}`
                  : s.replySender.mode === 'app_bot'
                    ? `${dot(true)}your Kick app's bot (via ${esc(s.broadcaster.username)})`
                    : `${dot(false)}nobody yet: connect a bot account`
              }</dd>
              <dt>Messages seen</dt><dd>${fmt(s.stats.received)}${s.stats.lastMessageAt ? ` (last ${ago(s.stats.lastMessageAt)})` : ''}</dd>
              <dt>Commands handled</dt><dd>${fmt(s.stats.commands)}</dd>
              <dt>Replies sent</dt><dd>${fmt(s.stats.sent)}${s.stats.sendErrors ? ` · <span style="color:var(--danger)">${fmt(s.stats.sendErrors)} errors</span>` : ''}</dd>
              ${s.stats.lastError ? `<dt>Last error</dt><dd style="color:var(--danger)">${esc(s.stats.lastError)}</dd>` : ''}
              <dt>Chat subscription</dt><dd>${
                s.subscriptionError
                  ? `<span style="color:var(--danger)">${esc(s.subscriptionError)}</span>`
                  : subs
                    ? subs.length
                      ? subs.map((x) => `${dot(true)}${esc(x.event)} v${esc(x.version)}`).join('<br>')
                      : `${dot(false)}none — click “Check / re-subscribe now”`
                    : '—'
              }</dd>
              <dt>Storage</dt><dd>${s.persistentStorage ? `${dot(true)}persistent` : `${dot(false)}temporary — attach a volume`}</dd>
              <dt>Action cooldown</dt><dd>${s.settings.actionCooldown}s</dd>
              <dt>Chat points</dt><dd>${s.settings.chatPoints} per ${s.settings.chatCooldown}s</dd>
            </dl>
          </section>
          <section class="panel">
            <h2>Kick app settings</h2>
            <p class="muted">Paste these into your app at <a href="https://kick.com/settings/developer" target="_blank" rel="noopener">kick.com/settings/developer</a>.</p>
            <dl class="kv">
              <dt>Redirect URL</dt><dd><code>${esc(s.redirectUrl)}</code></dd>
              <dt>Webhook URL</dt><dd><code>${esc(s.webhookUrl)}</code></dd>
            </dl>
          </section>
          <section class="panel">
            <h2>OBS overlay</h2>
            <p class="muted">In OBS: <b>Sources → + → Browser</b>, paste the link below, set width 400 and height 600, then place it where you like. When it loads you'll see “MMOBot overlay connected” for a few seconds.</p>
            <form id="overlay-form" class="overlay-form">
              <label>Show
                <select name="events">
                  <option value="all">every action</option>
                  <option value="big">only level-ups, rare finds &amp; upgrades</option>
                </select>
              </label>
              <label>for <input type="number" name="seconds" value="10" min="2" max="120" style="width:70px"> seconds</label>
              <label>max <input type="number" name="max" value="6" min="1" max="30" style="width:64px"> at once</label>
            </form>
            <div class="form-row" style="margin-top:10px">
              <input type="text" id="overlay-url" readonly style="max-width:none" aria-label="Overlay link">
              <button class="btn" id="overlay-copy">Copy</button>
            </div>
            <div class="form-row" style="margin-top:10px;flex-wrap:wrap">
              <button class="btn btn-primary" id="overlay-test">Send test event</button>
              <a class="btn" id="overlay-open" target="_blank" rel="noopener">Preview ↗</a>
            </div>
            <p class="muted" style="font-size:.85rem;margin-bottom:0">“Send test event” pops a message onto every open overlay (it isn't saved anywhere). If it doesn't appear in OBS, right-click the source → <b>Refresh</b>.</p>
          </section>
        </div>
      </div>`;

    const overlayForm = $app.querySelector('#overlay-form');
    const overlayUrl = () => {
      const f = overlayForm;
      const q = new URLSearchParams();
      if (f.events.value === 'big') q.set('events', 'big');
      if (Number(f.seconds.value) !== 10) q.set('seconds', f.seconds.value);
      if (Number(f.max.value) !== 6) q.set('max', f.max.value);
      return `${location.origin}/overlay.html${q.toString() ? `?${q}` : ''}`;
    };
    const syncOverlay = () => {
      $app.querySelector('#overlay-url').value = overlayUrl();
      $app.querySelector('#overlay-open').href = overlayUrl();
    };
    overlayForm.oninput = syncOverlay;
    syncOverlay();
    $app.querySelector('#overlay-copy').onclick = async () => {
      const input = $app.querySelector('#overlay-url');
      try {
        await navigator.clipboard.writeText(input.value);
        toast('Overlay link copied');
      } catch {
        input.select();
        toast('Press Ctrl+C / ⌘C to copy');
      }
    };
    $app.querySelector('#overlay-test').onclick = async () => {
      try {
        await api('/admin/overlay-test', { method: 'POST' });
        toast('Test event sent. Check OBS.');
      } catch (e) {
        toast(`Failed: ${e.message}`);
      }
    };

    $app.querySelectorAll('[data-disconnect]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Disconnect?')) return;
        await api(`/admin/disconnect/${b.dataset.disconnect}`, { method: 'POST' });
        route();
      };
    });
    const resub = $app.querySelector('#resub');
    if (resub)
      resub.onclick = async () => {
        try {
          await api('/admin/resubscribe', { method: 'POST' });
          toast('Chat subscription is active');
          route();
        } catch (e) {
          toast(`Failed: ${e.message}`);
        }
      };
    $app.querySelector('#bot-link').onclick = async () => {
      try {
        const r = await api('/admin/bot-link', { method: 'POST' });
        $app.querySelector('#bot-link-box').hidden = false;
        const input = $app.querySelector('#bot-link-url');
        input.value = r.url;
        input.select();
      } catch (e) {
        toast(`Failed: ${e.message}`);
      }
    };
    $app.querySelector('#bot-link-copy').onclick = async () => {
      const input = $app.querySelector('#bot-link-url');
      try {
        await navigator.clipboard.writeText(input.value);
        toast('Copied. Paste it into a private/incognito window.');
      } catch {
        input.select();
        toast('Press Ctrl+C / ⌘C to copy');
      }
    };
    $app.querySelector('#say-form').onsubmit = async (e) => {
      e.preventDefault();
      const input = e.target.text;
      try {
        const r = await api('/admin/say', { method: 'POST', body: { text: input.value } });
        toast(r.ok ? 'Sent!' : 'Not sent — connect your channel first');
        if (r.ok) input.value = '';
      } catch (err) {
        toast(`Failed: ${err.message}`);
      }
    };
  };

  // ---- Admin: settings ---------------------------------------------------
  adminPages.settings = async (query, header) => {
    const d = await api('/admin/settings');
    const isOver = (section) => d.overridden.includes(section);
    const resetBtn = (section) =>
      isOver(section) ? `<button type="button" class="btn btn-sm" data-reset="${section}">Reset to defaults</button>` : '';

    const fieldInput = (section, key, spec) => {
      const v = d.values[section][key];
      const id = `f-${section}-${key}`;
      let input;
      if (spec.type === 'bool') {
        input = `<label class="switch"><input type="checkbox" id="${id}" name="${key}" ${v ? 'checked' : ''}><span></span></label>`;
      } else if (spec.type === 'list' || spec.type === 'emotes') {
        input = `<input type="text" id="${id}" name="${key}" value="${esc(v.join(', '))}" placeholder="none">`;
      } else if (spec.type === 'string') {
        input = `<input type="text" id="${id}" name="${key}" value="${esc(v)}" maxlength="${spec.maxLength || 50}">`;
      } else {
        input = `<input type="number" id="${id}" name="${key}" value="${esc(v)}" min="${spec.min}" max="${spec.max}" step="${spec.type === 'int' ? 1 : 'any'}">`;
      }
      const def = d.defaults[section][key];
      return `<div class="field">
        <label for="${id}">${esc(spec.label)}</label>${input}
        <small>${esc(spec.help || '')}${String(v) !== String(def) ? ` <span class="muted">(default: ${esc(Array.isArray(def) ? def.join(', ') || 'none' : def)})</span>` : ''}</small>
      </div>`;
    };
    const fieldSection = (section, title, blurb) => `
      <form class="panel settings-form" data-section="${section}" data-kind="fields">
        <div class="panel-head"><h2>${title}</h2>${resetBtn(section)}</div>
        <p class="muted">${blurb}</p>
        <div class="fields">${Object.entries(d.fields[section]).map(([k, spec]) => fieldInput(section, k, spec)).join('')}</div>
        <button class="btn btn-primary">Save ${title.toLowerCase()}</button>
      </form>`;
    const tableSection = (section, blurb) => {
      const t = d.tables[section];
      const cols = Object.entries(t.columns);
      return `
      <form class="panel settings-form" data-section="${section}" data-kind="table">
       <details${isOver(section) ? ' open' : ''}>
        <summary class="panel-head"><h2>${esc(t.label)}</h2>${resetBtn(section)}</summary>
        <p class="muted">${blurb}</p>
        <div class="table-wrap"><table class="edit-table">
          <thead><tr><th>#</th><th>Name</th>${cols.map(([, c]) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${d.values[section]
            .map(
              (row, i) => `<tr data-row="${i}"><td>${i + 1}</td><td>${esc(t.names[i])}</td>${cols
                .map(
                  ([k, c]) =>
                    `<td><input type="number" name="${k}" value="${esc(row[k])}" min="${c.min}" max="${c.max}" step="${c.type === 'int' ? 1 : 'any'}" aria-label="${esc(`${t.names[i]} ${c.label}`)}"></td>`
                )
                .join('')}</tr>`
            )
            .join('')}</tbody>
        </table></div>
        <button class="btn btn-primary" style="margin-top:12px">Save ${esc(t.label.toLowerCase())}</button>
       </details>
      </form>`;
    };
    const off = d.values.disabledCommands;
    const env = d.environment;

    $app.innerHTML = `
      ${header}
      <p class="muted">Changes apply instantly in chat and on the site, and are kept across redeploys. Kick credentials and URLs are set in Railway's Variables tab.</p>
      <div class="grid grid-2">
        <div class="stack">
          ${fieldSection('general', 'General', 'Commands, cooldowns and chat behaviour.')}
          ${fieldSection('economy', 'Economy', 'Multipliers for XP, points and prices. Great for double-XP events.')}
          ${fieldSection('casino', 'Casino', 'Slots, roulette, plinko and blackjack, on the site and in chat. Max bet 0 means no limit.')}
        </div>
        <div class="stack">
          <form class="panel settings-form" data-section="disabledCommands" data-kind="commands">
            <div class="panel-head"><h2>Commands</h2>${resetBtn('disabledCommands')}</div>
            <p class="muted">Untick a command to switch it off. The bot ignores switched-off commands.</p>
            <div class="checks">${d.commands
              .map((c) => `<label class="check"><input type="checkbox" name="${esc(c)}" ${off.includes(c) ? '' : 'checked'}> <code>${esc(d.values.general.prefix + c)}</code></label>`)
              .join('')}</div>
            <button class="btn btn-primary">Save commands</button>
          </form>
          <section class="panel">
            <h2>Environment <span class="muted" style="font-size:.8rem">(read-only)</span></h2>
            <dl class="kv">
              <dt>Channel</dt><dd>${esc(env.channel || '—')}</dd>
              <dt>Site URL</dt><dd>${esc(env.baseUrl)}</dd>
              <dt>Kick client ID</dt><dd>${esc(env.kickClientId)}</dd>
              <dt>Database</dt><dd>${esc(env.dbPath)}</dd>
              <dt>Dev mode</dt><dd>${env.devMode ? 'on' : 'off'}</dd>
            </dl>
          </section>
        </div>
      </div>
      <div class="stack" style="margin-top:16px">
        ${Object.keys(d.tables)
          .filter((k) => k !== 'backpack')
          .map((k) => tableSection(k, `Level needed, price and stats for each tier. Levels must go up from tier to tier; the first tier is free at level 1.`))
          .join('')}
        ${tableSection('backpack', 'Slots and price for each backpack level. Slots must go up from level to level.')}
      </div>`;

    $app.querySelectorAll('[data-reset]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Reset this section to its defaults?')) return;
        await api(`/admin/settings/${b.dataset.reset}`, { method: 'DELETE' });
        toast('Reset to defaults');
        route();
      };
    });
    $app.querySelectorAll('.settings-form').forEach((form) => {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const { section, kind } = form.dataset;
        let value;
        if (kind === 'fields') {
          value = {};
          for (const [k, spec] of Object.entries(d.fields[section])) {
            const el = form.elements[k];
            value[k] = spec.type === 'bool' ? el.checked : el.value;
          }
        } else if (kind === 'commands') {
          value = d.commands.filter((c) => !form.elements[c].checked);
        } else {
          value = [...form.querySelectorAll('tr[data-row]')].map((tr) =>
            Object.fromEntries([...tr.querySelectorAll('input')].map((i) => [i.name, i.value]))
          );
        }
        const btn = form.querySelector('.btn-primary');
        btn.disabled = true;
        try {
          await api(`/admin/settings/${section}`, { method: 'PUT', body: { value } });
          toast('Saved ✓ Live now');
          route();
        } catch (err) {
          toast(`Not saved: ${err.message}`);
          btn.disabled = false;
        }
      };
    });
  };

  // ---- Admin: players ----------------------------------------------------
  adminPages.players = async (query, header) => {
    const q = query.get('q') || '';
    const { players } = await api(`/admin/players?q=${encodeURIComponent(q)}`);
    $app.innerHTML = `
      ${header}
      <section class="panel">
        <form class="form-row" id="player-search">
          <input type="text" name="q" value="${esc(q)}" placeholder="Search by Kick username" style="max-width:none" aria-label="Search players">
          <button class="btn btn-primary">Search</button>
        </form>
        <div class="table-wrap" style="margin-top:14px"><table>
          <thead><tr><th>Player</th><th class="num">Points</th><th class="num">Messages</th><th class="num">Actions</th><th>Last seen</th><th>Give / take points</th></tr></thead>
          <tbody>${
            players.length
              ? players
                  .map(
                    (p) => `<tr>
              <td><a href="${playerLink(p.username)}">${esc(p.username)}</a></td>
              <td class="num" data-points="${p.id}">${fmt(p.points)}</td>
              <td class="num">${fmt(p.message_count)}</td><td class="num">${fmt(p.actions_count)}</td>
              <td>${ago(p.last_seen_at)}</td>
              <td><form class="form-row points-form" data-id="${p.id}" data-name="${esc(p.username)}">
                <input type="number" name="delta" step="1" placeholder="+500 or -100" style="max-width:130px" aria-label="Points to add or remove">
                <input type="text" name="reason" placeholder="reason (optional)" style="max-width:170px" aria-label="Reason">
                <button class="btn btn-sm">Apply</button></form></td>
            </tr>`
                  )
                  .join('')
              : `<tr><td colspan="6" class="empty">No players found.</td></tr>`
          }</tbody>
        </table></div>
      </section>`;
    $app.querySelector('#player-search').onsubmit = (e) => {
      e.preventDefault();
      location.hash = `#/admin?tab=players&q=${encodeURIComponent(e.target.q.value.trim())}`;
    };
    $app.querySelectorAll('.points-form').forEach((f) => {
      f.onsubmit = async (e) => {
        e.preventDefault();
        const delta = Number(f.delta.value);
        if (!Number.isInteger(delta) || !delta) return toast('Enter a whole number, e.g. 500 or -100');
        if (!confirm(`${delta > 0 ? 'Give' : 'Take'} ${fmt(Math.abs(delta))} points ${delta > 0 ? 'to' : 'from'} ${f.dataset.name}?`)) return;
        try {
          const r = await api(`/admin/players/${f.dataset.id}/points`, { method: 'POST', body: { delta, reason: f.reason.value } });
          $app.querySelector(`[data-points="${f.dataset.id}"]`).textContent = fmt(r.player.points);
          f.reset();
          toast('Points updated');
        } catch (err) {
          toast(`Failed: ${err.message}`);
        }
      };
    });
  };

  // ---- Admin: logs -------------------------------------------------------
  adminPages.logs = async (query, header) => {
    const filters = { level: query.get('level') || '', source: query.get('source') || '', q: query.get('q') || '' };
    const qs = (extra = {}) => new URLSearchParams(Object.entries({ ...filters, ...extra }).filter(([, v]) => v)).toString();
    const data = await api(`/admin/logs?${qs()}`);
    const time = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const row = (l) => `<tr class="log-${esc(l.level)}"><td class="log-ts">${time(l.ts)}</td><td><span class="log-level">${esc(l.level)}</span></td><td>${esc(l.source)}</td><td class="log-msg">${esc(l.message)}</td></tr>`;
    let oldest = data.logs.length ? data.logs[data.logs.length - 1].id : null;
    let newest = data.logs.length ? data.logs[0].id : 0;

    $app.innerHTML = `
      ${header}
      <section class="panel">
        <form class="log-filters" id="log-filters">
          <select name="level" aria-label="Level">
            <option value="">All levels</option>
            <option value="warn" ${filters.level === 'warn' ? 'selected' : ''}>Warnings &amp; errors</option>
            <option value="error" ${filters.level === 'error' ? 'selected' : ''}>Errors only</option>
          </select>
          <select name="source" aria-label="Source">
            <option value="">All sources</option>
            ${data.sources.map((src) => `<option ${src === filters.source ? 'selected' : ''}>${esc(src)}</option>`).join('')}
          </select>
          <input type="text" name="q" value="${esc(filters.q)}" placeholder="Search messages" aria-label="Search">
          <button class="btn btn-primary">Filter</button>
          <label class="check"><input type="checkbox" id="log-live" checked> Live</label>
        </form>
        <p class="muted" style="font-size:.85rem">Sources: <b>chat</b> = commands and bot replies, <b>kick</b> = Kick API, <b>webhook</b> = incoming chat events, <b>auth</b> = logins, <b>admin</b> = changes made here. Kept for 14 days.</p>
        <div class="table-wrap log-wrap"><table class="log-table">
          <thead><tr><th>Time</th><th>Level</th><th>Source</th><th>Message</th></tr></thead>
          <tbody id="log-rows">${data.logs.length ? data.logs.map(row).join('') : '<tr><td colspan="4" class="empty">No logs match.</td></tr>'}</tbody>
        </table></div>
        <button class="btn" id="log-more" style="margin-top:12px" ${data.logs.length < 200 ? 'hidden' : ''}>Load older</button>
      </section>`;

    $app.querySelector('#log-filters').onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      const next = new URLSearchParams({ tab: 'logs', level: f.level.value, source: f.source.value, q: f.q.value.trim() });
      [...next.keys()].forEach((k) => !next.get(k) && next.delete(k));
      location.hash = `#/admin?${next}`;
    };
    const more = $app.querySelector('#log-more');
    more.onclick = async () => {
      const older = await api(`/admin/logs?${qs({ before: oldest })}`);
      $app.querySelector('#log-rows').insertAdjacentHTML('beforeend', older.logs.map(row).join(''));
      if (older.logs.length) oldest = older.logs[older.logs.length - 1].id;
      more.hidden = older.logs.length < 200;
    };
    // Live tail: poll for new lines every 5 seconds while this tab is open.
    const timer = setInterval(async () => {
      if (!$app.querySelector('#log-live')?.checked) return;
      const fresh = (await api(`/admin/logs?${qs({ limit: 100 })}`).catch(() => ({ logs: [] }))).logs.filter((l) => l.id > newest);
      if (!fresh.length) return;
      newest = fresh[0].id;
      const rows = $app.querySelector('#log-rows');
      rows.querySelector('.empty')?.parentElement.remove();
      rows.insertAdjacentHTML('afterbegin', fresh.map(row).join(''));
    }, 5000);
    return () => clearInterval(timer);
  };

  pages.dev = async () => {
    if (!state.devMode) {
      $app.innerHTML = `<div class="panel empty">Dev mode is off. Set <code>DEV_MODE=true</code> to test commands without Kick.</div>`;
      return;
    }
    const saved = sessionStorage.getItem('dev-user') || 'TestViewer';
    $app.innerHTML = `
      <h1>Test chat</h1>
      <p class="muted">Pretend to be a viewer and type commands exactly like in Kick chat. Only available with <code>DEV_MODE=true</code>.</p>
      <div class="grid grid-2">
        <section class="panel">
          <div class="chatlog" id="chatlog"><div class="muted">Try <code>!fish</code>, <code>!mine copper</code>, <code>!smelt</code>, <code>!stats</code>, <code>!inv</code>, <code>!sell all</code>…</div></div>
          <form class="form-row" id="chat-form">
            <input type="text" name="username" value="${esc(saved)}" placeholder="username" aria-label="Username">
            <input type="text" name="content" placeholder="Type a message or command" aria-label="Message" autocomplete="off" autofocus>
            <button class="btn btn-primary">Send</button>
          </form>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Live activity</h2></div>
          <ul class="feed" id="dev-feed"><li class="empty">Waiting for actions…</li></ul>
        </section>
      </div>`;
    const log = document.getElementById('chatlog');
    const line = (html) => {
      log.insertAdjacentHTML('beforeend', `<div>${html}</div>`);
      log.scrollTop = log.scrollHeight;
    };
    document.getElementById('chat-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const username = f.username.value.trim();
      const content = f.content.value;
      if (!content.trim()) return;
      sessionStorage.setItem('dev-user', username);
      line(`<span class="u">${esc(username)}:</span> ${esc(content)}`);
      f.content.value = '';
      try {
        const r = await api('/dev/chat', { method: 'POST', body: { username, content } });
        if (r.reply) line(`<span class="b">🤖 Bot:</span> ${esc(r.reply)}`);
      } catch (err) {
        line(`<span style="color:var(--danger)">${esc(err.message)}</span>`);
      }
    };
    return liveFeed(document.getElementById('dev-feed'));
  };

  // ---- router ------------------------------------------------------------
  let cleanup = null;
  async function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart = ''] = hash.split('?');
    const [name = 'home', ...params] = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    const page = pages[name] || pages.home;
    setActiveNav(name === 'player' || name === 'me' ? '' : name);
    if (typeof cleanup === 'function') cleanup();
    cleanup = null;
    $app.innerHTML = '<div class="skeleton">Loading…</div>';
    try {
      cleanup = await page(params, new URLSearchParams(queryPart));
    } catch (err) {
      console.error(err);
      $app.innerHTML = `<div class="panel empty"><span class="ic">⚠️</span>Something went wrong: ${esc(err.message)}</div>`;
    }
    window.scrollTo(0, 0);
  }

  // Keep "x ago" labels fresh.
  setInterval(() => document.querySelectorAll('[data-ts]').forEach((el) => (el.textContent = ago(+el.dataset.ts))), 15000);

  async function boot() {
    const [me, site] = await Promise.all([api('/me'), api('/site')]);
    Object.assign(state, { me: me.user, isAdmin: me.isAdmin, loginEnabled: me.loginEnabled, devMode: me.devMode, site });
    if (site.channel) document.getElementById('brand-name').textContent = `${site.channel} MMO`;
    renderAccount();
    window.addEventListener('hashchange', route);
    route();
  }
  boot();
})();
