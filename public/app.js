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
    ({ levelup: '🎉', charlevel: '⭐', rare: '💎', sell: '💰', upgrade: '🔧', test: '🧪', buy: '🛒', jackpot: '🎰', death: '💀', achievement: '🏆', task: '📋', trade: '🤝', follow: '💚', sub: '⭐', gift: '🎁', kicks: '💎', raid: '⚔️', duel: '⚔️', event: '📣', pull: '🃏', unbox: '🧰', redeem: '📣', fund: '🏛️' })[a.kind] || (a.skill ? skillIcon(a.skill) : '•');

  // ---- live activity (SSE) ----------------------------------------------
  const listeners = new Set();
  const es = new EventSource('/api/events');
  es.addEventListener('activity', (e) => {
    const a = JSON.parse(e.data);
    listeners.forEach((fn) => fn(a));
  });

  // Raid boss and channel boost banner at the top of every page.
  const live = { raid: null, boost: null };
  function drawBanner() {
    const el = document.getElementById('live-banner');
    const parts = [];
    const b = live.boost;
    if (b && b.until > Date.now()) {
      parts.push(`<div class="banner boost">⚡ <b>${b.multiplier}x ${b.kind === 'xp' ? 'XP' : 'chat points'}</b> for everyone · ${Math.max(1, Math.ceil((b.until - Date.now()) / 60000))}m left${b.reason ? ` <span class="muted">(${esc(b.reason)})</span>` : ''}</div>`);
    }
    for (const r of [live.raid, live.world]) {
      if (!r || !r.active) continue;
      const pct = Math.max(0, Math.round((r.hp / r.maxHp) * 100));
      const ms = Math.max(0, r.endsAt - Date.now());
      const left = r.world ? `${Math.ceil(ms / 86_400_000)}d left` : `${Math.ceil(ms / 60000)}m`;
      parts.push(`<div class="banner raid${r.world ? ' world' : ''}"><div class="banner-row"><span>${r.icon} <b>${r.world ? 'WORLD BOSS' : 'RAID'}: ${esc(r.name)}</b> (level ${r.level}) · type <code>!attack</code> in chat</span>
        <span>${fmt(r.hp)} / ${fmt(r.maxHp)} HP · ${r.fighters} fighting · ${left}</span></div>
        <div class="raid-bar"><span style="width:${pct}%"></span></div></div>`);
    }
    const g = live.goal;
    if (g && !g.done) {
      const pct = Math.min(100, Math.round((g.progress / g.target) * 100));
      parts.push(`<div class="banner goal"><div class="banner-row"><span>🎯 <b>Channel goal:</b> ${esc(g.label)}</span><span>${fmt(g.progress)} / ${fmt(g.target)}</span></div>
        <div class="raid-bar"><span style="width:${pct}%"></span></div></div>`);
    }
    el.innerHTML = parts.join('');
    el.hidden = !parts.length;
  }
  es.addEventListener('raid', (e) => {
    const r = JSON.parse(e.data);
    if (r.world) live.world = r;
    else live.raid = r;
    drawBanner();
  });
  es.addEventListener('goal', (e) => {
    live.goal = JSON.parse(e.data);
    drawBanner();
  });
  es.addEventListener('boost', (e) => {
    live.boost = JSON.parse(e.data);
    drawBanner();
  });
  setInterval(drawBanner, 15000);

  // ---- chrome ------------------------------------------------------------
  function renderAccount() {
    const el = document.getElementById('account');
    if (state.me) {
      el.innerHTML = `
        <div class="bell-wrap"><button class="bell" id="bell" aria-label="Notifications">🔔<span class="bell-count" id="bell-count" hidden></span></button><div class="bell-menu" id="bell-menu" hidden></div></div>
        <a class="me-link" href="#/me">${avatar(state.me.avatarUrl, state.me.username, 'sm')}<span>${esc(state.me.username)}</span></a>
        <button class="btn btn-sm" id="logout">Log out</button>`;
      setupBell();
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
    fitNav();
  }

  // Notification bell: saved notices (market sales, pets, quests) plus live reminders.
  let bellTimer = null;
  function setupBell() {
    const btn = document.getElementById('bell');
    const menu = document.getElementById('bell-menu');
    const count = document.getElementById('bell-count');
    let data = null;
    const load = async () => {
      if (!state.me) return;
      try {
        data = await api('/me/notifications');
      } catch {
        return;
      }
      count.hidden = !data.unread;
      count.textContent = data.unread > 9 ? '9+' : data.unread;
      if (!menu.hidden) draw();
    };
    const draw = () => {
      const live = data.live.map((n) => `<li class="${n.info ? 'info' : ''}"><span>${n.icon}</span><span>${n.link ? `<a href="${n.link}">${esc(n.text)}</a>` : esc(n.text)}</span></li>`).join('');
      const saved = data.saved.map((n) => `<li class="${n.read ? '' : 'unread'}"><span>•</span><span>${esc(n.text)} <small class="muted">${ago(n.at)}</small></span></li>`).join('');
      menu.innerHTML = live || saved ? `<ul>${live}${saved}</ul>` : '<p class="muted" style="margin:8px">Nothing new.</p>';
    };
    btn.onclick = async (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      if (!menu.hidden) {
        if (!data) await load();
        draw();
        if (data.saved.some((n) => !n.read)) {
          api('/me/notifications/read', { method: 'POST', body: {} }).catch(() => {});
          data.saved.forEach((n) => (n.read = true));
          data.unread = data.live.filter((n) => !n.info).length;
          count.hidden = !data.unread;
          count.textContent = data.unread;
        }
      }
    };
    if (!setupBell.bound) {
      setupBell.bound = true;
      document.addEventListener('click', (e) => {
        const m = document.getElementById('bell-menu');
        if (m && !e.target.closest('.bell-wrap')) m.hidden = true;
      });
    }
    clearInterval(bellTimer);
    bellTimer = setInterval(load, 60_000);
    load();
  }

  function setActiveNav(route) {
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
    // A dropdown lights up when the page you're on is inside it.
    document.querySelectorAll('#nav .nav-group').forEach((g) => g.classList.toggle('active', !!g.querySelector('a.active')));
    closeMenus();
  }

  // ---- Top menu: "Play" and "Community" dropdowns, and the ☰ menu on small screens ----
  const navToggle = document.getElementById('nav-toggle');
  function closeMenus(except = null) {
    document.querySelectorAll('#nav .nav-group.open').forEach((g) => {
      if (g === except) return;
      g.classList.remove('open');
      g.querySelector('.nav-group-btn').setAttribute('aria-expanded', 'false');
    });
    if (!except) {
      document.body.classList.remove('nav-open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
  }
  document.querySelectorAll('#nav .nav-group-btn').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const g = btn.parentElement;
      const open = !g.classList.contains('open');
      closeMenus(g);
      g.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
  });
  navToggle.onclick = (e) => {
    e.stopPropagation();
    const open = !document.body.classList.contains('nav-open');
    closeMenus();
    document.body.classList.toggle('nav-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#nav, #nav-toggle')) closeMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus();
  });
  // Use the ☰ menu whenever the links don't fit on one line (instead of a scrolling row).
  function fitNav() {
    const body = document.body;
    const wasOpen = body.classList.contains('nav-open');
    body.classList.remove('nav-compact', 'nav-open');
    const nav = document.getElementById('nav');
    const account = document.getElementById('account');
    const items = [...nav.children].filter((el) => !el.hidden);
    const right = Math.max(...items.map((el) => el.getBoundingClientRect().right));
    const tooWide = window.innerWidth < 720 || right > account.getBoundingClientRect().left - 8 || nav.scrollWidth > nav.clientWidth + 1;
    body.classList.toggle('nav-compact', tooWide);
    if (tooWide && wasOpen) body.classList.add('nav-open');
  }
  let fitTimer;
  window.addEventListener('resize', () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitNav, 80);
  });
  document.fonts?.ready.then(fitNav);

  // ---- shared components -------------------------------------------------
  function feedItem(a, isNew = false) {
    return `<li class="${esc(a.kind)}${isNew ? ' new' : ''}">
      ${a.appearance ? `<span class="feed-face">${window.MMOAvatar.svg(a.appearance, { size: 26, head: true })}</span>` : ''}
      <span class="ic">${feedIcon(a)}</span>
      <span>${a.username ? `<a href="${playerLink(a.username)}">${esc(a.username)}</a> ` : ''}${esc(a.text)}${a.xp ? ` <span class="muted">+${fmt(a.xp)} xp</span>` : ''}</span>
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
              <div class="nm">${esc(i.name)}</div><div class="val">${i.usesLeft != null ? `${i.usesLeft} uses` : `${fmt(i.value * i.qty)} pts`}</div>
              ${
                isMe
                  ? `<div class="inv-actions">${i.gear ? `<button class="mini" data-act="equip" data-item="${esc(i.id)}">Equip</button>` : ''}${i.potion ? `<button class="mini" data-act="drink" data-item="${esc(i.id)}">Drink</button>` : ''}${i.food ? `<button class="mini" data-act="eat" data-item="${esc(i.id)}">Eat</button>` : ''}<button class="mini" data-act="sell" data-item="${esc(i.id)}" data-name="${esc(i.name)}" data-value="${i.value}">Sell</button></div>`
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
          ${p.appearance ? charStageHtml(p.appearance, { size: 170, title: `${p.username} the ${p.appearance.raceName}`, cls: 'char-stage-profile' }) : avatar(p.avatarUrl, p.username)}
          <div class="char-title">
            <h1>${esc(p.username)}${p.title ? ` <span class="char-titletext">${esc(p.title)}</span>` : ''}</h1>
            <div class="char-badges">
              ${p.appearance ? `<span class="badge" title="${esc([...p.appearance.pros, ...p.appearance.cons].join(' · '))}">${p.appearance.raceIcon} ${esc(p.appearance.raceName)}</span>` : ''}
              ${p.appearance?.stars ? `<span class="badge gold" title="${esc(Object.entries(p.appearance.prestige || {}).map(([k, n]) => `${k} ×${n}`).join(', '))}">⭐ Prestige ${p.appearance.stars}</span>` : ''}
              ${p.appearance?.pet ? `<span class="badge" title="Pet">${p.appearance.pet} ${esc((p.appearance.wardrobe?.pet || []).find((x) => x.icon === p.appearance.pet)?.name || 'Pet')}</span>` : ''}
              ${isMe ? '<a class="badge" href="#/customize">🎨 Customize</a>' : ''}
              ${p.subscriber ? '<span class="badge gold">⭐ Subscriber</span>' : ''}
              <span class="badge gold">💰 ${fmt(p.points)} points</span>
              <span class="badge">📊 Total level ${fmt(p.totalLevel)}</span>
              <span class="badge">✨ ${fmt(p.totalXp)} xp</span>
              ${p.overallRank ? `<span class="badge">🏆 Rank #${fmt(p.overallRank)}</span>` : ''}
              <span class="badge">💬 ${fmt(p.messages)} messages</span>
              ${p.guild ? `<a class="badge" href="#/guilds">🛡️ [${esc(p.guild.tag)}] ${esc(p.guild.name)}</a>` : ''}
              ${p.house ? `<a class="badge gold" href="#/shop" title="+${p.house.charges} stamina">${p.house.icon} ${esc(p.house.name)}</a>` : ''}
              ${p.streamStreak?.streak > 1 ? `<span class="badge" title="Best: ${p.streamStreak.best}">🔥 ${p.streamStreak.streak} ${esc(p.streamStreak.unit)} in a row</span>` : ''}
              ${p.lastSeen && !isMe ? `<span class="badge">👀 Seen ${ago(p.lastSeen)}</span>` : ''}
            </div>
          </div>
          <div class="level-ring" style="--p:${c.percent}" title="${charNext}">
            <div class="level-ring-inner"><div><b>${c.level}</b><small>Character</small></div></div>
          </div>
        </div>
        <div class="form-row" style="margin-top:14px;justify-content:space-between;flex-wrap:wrap">
          ${isMe ? `<p class="muted" style="margin:0">${staminaText(p)} · ${charNext}</p>` : '<span></span>'}
          <button class="btn btn-sm" id="share-card">📸 Share card</button>
        </div>
      </section>

      <h2 style="margin:28px 0 12px">Skills${isMe ? ' <a class="btn btn-sm btn-primary" href="#/train" style="margin-left:8px;vertical-align:middle">🏋️ Train on the website</a>' : ''}</h2>
      <div class="grid grid-skills">${p.skills.map(skillCard).join('')}</div>

      ${equipmentPanel(p.combat, isMe)}
      ${farmPanel(p.farm, isMe)}
      ${stationsPanel(p.farm.stations, isMe, p.stamina)}
      ${museumPanel(p.museum, isMe)}
      ${questsPanel(p.quests, isMe)}
      ${progressPanels(p.progression, isMe)}

      <div class="grid grid-2" style="margin-top:16px">
        <section class="panel">
          <div class="panel-head"><h2>Backpack</h2><span><span class="badge gold">Worth ${fmt(p.inventoryValue)} pts</span>${isMe && p.inventory.length ? ' <a class="btn btn-sm btn-primary" href="#/train">💰 Sell items</a>' : ''}</span></div>
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
    if (i.usesLeft != null) bits.push(`${i.usesLeft}/${i.uses} uses left`);
    if (i.food) bits.push(`!eat it to heal ${i.food.heal} HP (one meal heals at most 30% of your max HP)`);
    if (i.effect) bits.push(`drink for ${i.effect.name} (${i.effect.minutes} min): ${i.effect.text}`);
    if (i.opens) bits.push('!open it for points and loot');
    if (i.usedFor?.length && !i.food && !i.effect) bits.push(`used for: ${i.usedFor.join('; ')}`);
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
            ? `<p class="muted" style="font-size:.85rem;margin:6px 0 0">HP refills over ${c.hpRegenHours}h. ${c.mana >= Math.ceil(c.maxMana * (c.healCost ?? 0.3)) ? `<button class="mini" data-act="heal">✨ Heal +${Math.round((c.healPercent ?? 0.3) * 100)}% HP (${Math.ceil(c.maxMana * (c.healCost ?? 0.3))} mana)</button>` : `<code>!heal</code> needs ${Math.ceil(c.maxMana * (c.healCost ?? 0.3))} mana.`}</p>`
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
            ${c.archeryBonus ? `<span class="badge">🏹 Archery +${fmt(c.archeryBonus)}</span>` : ''}
            ${c.magicBonus ? `<span class="badge">🔮 Magic +${fmt(c.magicBonus)}</span>` : ''}
            <span class="badge">🎖️ Combat level ${fmt(c.level)}</span>
          </div>
        </div>
        ${vitalsBars(c, isMe)}
        ${
          c.buffs && c.buffs.length
            ? `<div class="buffs">${c.buffs
                .map((b) => `<span class="buff" title="${esc(b.text)}">${b.icon} ${esc(b.name)} <small data-until="${b.until}">${Math.max(1, Math.ceil((b.until - Date.now()) / 60000))}m</small></span>`)
                .join('')}</div>`
            : ''
        }
        ${c.set ? `<p class="set-bonus">🛡️ <b>${esc(c.set.name)} set</b>: +${c.set.defence}% defence, +${c.set.attack}% attack</p>` : ''}
        <div class="gear-grid">${c.worn
          .map(
            (w) => `<div class="gear-slot${w.item ? ' filled' : ''}" title="${w.item ? esc(itemTitle(w.item)) : ''}">
              <div class="gear-label">${SLOT_LABEL[w.slot]}</div>
              <div class="ic">${w.item ? w.item.icon : `<span class="ghost">${SLOT_EMPTY[w.slot]}</span>`}</div>
              <div class="nm">${w.item ? `${esc(w.item.name)}${w.item.enchant ? ` <span class="ench">+${w.item.enchant}</span>` : ''}` : 'Empty'}</div>
              <div class="gear-stat">${w.item ? (w.item.attack ? `+${w.item.attack} attack` : `+${w.item.defence} defence`) : '&nbsp;'}</div>
              ${isMe && w.item ? `<button class="mini" data-act="unequip" data-slot="${w.slot}">Unequip</button>` : ''}
            </div>`
          )
          .join('')}</div>
        ${monsterChips(c.monsters, c.ratedWith)}
        <p class="muted" style="margin-bottom:0;font-size:.85rem">Buy a sword or bow in the <a href="#/shop">shop</a>, or <code>!smith</code> / <code>!fletch</code> your own, then <code>!fight</code> (or <code>!shoot</code> with a bow, a quiver and arrows). <code>!targets</code> shows your best fights. Your best weapon is equipped automatically when you fight. Fights cost HP; monsters above your level hit much harder.</p>
      </section>`;
  }

  // A 1200×630 PNG of a character (portrait, levels, best skills) to post on Discord or X.
  async function shareCard(p) {
    const W = 1200;
    const H = 630;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b0e11');
    bg.addColorStop(1, '#1c232c');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#53fc18';
    g.fillRect(0, 0, W, 8);
    // Portrait
    if (p.appearance) {
      const svg = window.MMOAvatar.svg(p.appearance, { size: 420 });
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const img = new Image();
      await new Promise((ok) => {
        img.onload = ok;
        img.onerror = ok;
        img.src = url;
      });
      g.fillStyle = '#161b22';
      g.beginPath();
      g.roundRect(50, 60, 440, 510, 28);
      g.fill();
      try {
        g.drawImage(img, 60, 70, 420, 490);
      } catch {
        // (Some browsers refuse SVG images on canvas; the card still has the stats.)
      }
      URL.revokeObjectURL(url);
    }
    const text = (t, x, y, size, color = '#e8edf2', weight = 800) => {
      g.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
      g.fillStyle = color;
      g.fillText(t, x, y);
    };
    const x = 540;
    text(p.username, x, 140, 68);
    text([p.appearance ? `${p.appearance.raceName}` : '', p.title, p.guild ? `[${p.guild.tag}] ${p.guild.name}` : ''].filter(Boolean).join(' · '), x, 190, 30, '#8b98a8', 600);
    text(`Character level ${p.character.level}`, x, 270, 44, '#53fc18');
    text(`Total level ${fmt(p.totalLevel)} · ${fmt(p.totalXp)} XP${p.overallRank ? ` · Rank #${fmt(p.overallRank)}` : ''}`, x, 320, 28, '#e8edf2', 600);
    const best = [...p.skills].sort((a, b) => b.xp - a.xp).slice(0, 3);
    best.forEach((s, i) => text(`${s.icon} ${s.name} ${s.level}`, x, 400 + i * 50, 34, '#ffc940', 700));
    text(`${state.site?.channel ? `${state.site.channel} MMO · ` : ''}${location.host}`, x, 575, 24, '#8b98a8', 600);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    const file = new File([blob], `${p.username}-character.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `${p.username}'s character` });
        return;
      } catch {
        // Cancelled: fall through to downloading it.
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast('Card saved! Post it anywhere.');
  }

  // Quests: your active ones in full, the rest as cards you can start (up to 3 at once).
  function questsPanel(quests, isMe) {
    if (!quests) return '';
    const done = quests.filter((q) => q.status === 'done').length;
    const active = quests.filter((q) => q.status === 'active');
    // Startable first, then the ones still locked behind another quest, finished ones last.
    const order = { paused: 0, available: 0, locked: 1, done: 2 };
    const others = quests.filter((q) => q.status !== 'active').sort((a, b) => order[a.status] - order[b.status]);
    const full = active.length >= 3;
    const prize = (q) => `${fmt(q.reward)} pts${(q.items || []).map((i) => ` + ${i.qty}× ${i.icon} ${esc(i.name)}`).join('')}`;
    const steps = (q) => `<ul class="tasks">${q.steps
      .map(
        (s) => `<li class="${s.have >= s.qty ? 'done' : ''}"><span>${esc(s.text)}</span><span>${Math.min(s.have, s.qty)}/${s.qty}${s.have >= s.qty ? ' ✅' : ''}</span>
          <div class="task-bar"><span style="width:${Math.min(100, Math.round((s.have / s.qty) * 100))}%"></span></div></li>`
      )
      .join('')}</ul>`;
    const label = { done: '✅ Done', paused: '⏸️ Paused', available: '', locked: '' };
    return `<section class="panel" style="margin-top:16px">
      <div class="panel-head"><h2>📜 Quests</h2><span class="muted">${done}/${quests.length} done · ${active.length}/3 active</span></div>
      ${
        active.length
          ? `<div class="quest-active-grid">${active
              .map(
                (q) => `<div class="quest-active">
                  <div class="panel-head" style="margin-bottom:4px"><h3 style="margin:0">${q.icon} ${esc(q.name)}</h3>${isMe ? `<button class="mini" data-act="quest-pause" data-item="${esc(q.id)}">Pause</button>` : ''}</div>
                  <p class="muted" style="margin:0 0 10px">${esc(q.intro)}</p>
                  ${steps(q)}
                  <p class="muted" style="margin:8px 0 0;font-size:.85rem">Reward: ${prize(q)} + the title “${esc(q.title)}”.</p>
                </div>`
              )
              .join('')}</div>`
          : `<p class="muted">${isMe ? 'No active quest. Pick one below!' : 'No active quests.'}</p>`
      }
      <div class="quest-cards">${others
        .map(
          (q) => `<div class="quest-card ${q.status}" title="${esc(q.intro)}">
            <b>${q.icon} ${esc(q.name)}</b>
            <small class="muted">${q.steps.length} step${q.steps.length === 1 ? '' : 's'} · ${prize(q)} · “${esc(q.title)}”</small>
            ${label[q.status] ? `<small>${label[q.status]}</small>` : ''}
            ${q.status === 'locked' ? `<small class="quest-lock">🔒 After ${q.after.map((a) => `${a.icon} ${esc(a.name)}`).join(' + ')}</small>` : ''}
            ${
              isMe && q.status !== 'done' && q.status !== 'locked'
                ? `<button class="mini" data-act="quest-start" data-item="${esc(q.id)}" ${full ? 'disabled title="Pause one of your 3 active quests first"' : ''}>${q.status === 'paused' ? 'Resume' : 'Start'}</button>`
                : ''
            }
          </div>`
        )
        .join('')}</div>
      ${isMe ? '<p class="muted" style="margin:10px 0 0;font-size:.85rem">In chat: <code>!quest</code> shows your active quests, <code>!quests</code> lists them all, <code>!quest start relic hunter</code> / <code>!quest pause relic hunter</code>. Paused quests keep their progress.</p>' : ''}
    </section>`;
  }

  // Daily tasks (your own page) and achievements.
  function progressPanels(pr, isMe) {
    if (!pr) return '';
    const got = pr.achievements.filter((a) => a.unlockedAt).length + pr.extra.length;
    const daily = isMe
      ? `<section class="panel">
          <div class="panel-head"><h2>📋 Today's tasks</h2><span class="badge">🔥 ${pr.daily.streak}-day streak</span></div>
          <ul class="tasks">${pr.daily.tasks
            .map(
              (t) => `<li class="${t.done >= t.need ? 'done' : ''}"><span>${t.icon} ${esc(t.text)}</span><span>${Math.min(t.done, t.need)}/${t.need}${t.done >= t.need ? ' ✅' : ''}</span>
                <div class="task-bar"><span style="width:${Math.min(100, Math.round((t.done / t.need) * 100))}%"></span></div></li>`
            )
            .join('')}</ul>
          <p class="muted" style="margin-bottom:0;font-size:.85rem">+${pr.daily.reward} pts each, +${pr.daily.bonus} for all three. ${
            pr.daily.claimedToday ? "Today's <code>!daily</code> reward is claimed ✅" : 'Your daily reward is waiting (or type <code>!daily</code> in chat).'
          } New tasks every day (UTC).</p>
          ${pr.daily.claimedToday ? '' : `<button class="btn btn-primary" data-act="daily" style="margin-top:10px">🎁 Claim daily reward +${fmt(pr.daily.nextReward || 0)} pts</button>`}
        </section>`
      : '';
    return `<div class="grid ${isMe ? 'grid-2' : ''}" style="margin-top:16px">
      ${daily}
      <section class="panel">
        <div class="panel-head"><h2>🏆 Achievements</h2><span class="muted">${got}/${pr.achievements.length + pr.extra.length}</span></div>
        <div class="achievements">${[...pr.extra, ...pr.achievements]
          .map((a) => `<span class="ach${a.unlockedAt ? ' got' : ''}" title="${esc(a.name)}: ${esc(a.desc || '')}${a.title ? ` · title: ${esc(a.title)}` : ''}">${a.icon}</span>`)
          .join('')}</div>
        ${pr.titles.length ? `<p class="muted" style="margin-bottom:0;font-size:.85rem">Titles: ${pr.titles.map(esc).join(', ')}. ${isMe ? 'Show one with <code>!title &lt;name&gt;</code>.' : ''}</p>` : ''}
      </section>
    </div>`;
  }

  function museumPanel(m, isMe = false) {
    if (!m || !m.length) return '';
    const ready = isMe ? m.flatMap((c) => c.items.filter((i) => i.owned)) : [];
    return `<section class="panel" style="margin-top:16px">
      <div class="panel-head"><h2>🏛️ Museum</h2><span>${ready.length ? `<button class="btn btn-sm btn-primary" data-act="donate" data-all="1">🏛️ Donate ${ready.length} new find${ready.length === 1 ? '' : 's'}</button> ` : ''}<span class="muted">${m.filter((c) => c.done).length}/${m.length} collections</span></span></div>
      <div class="museum">${m
        .map(
          (c) => `<div class="museum-set${c.done ? ' done' : ''}">
            <div class="museum-name">${c.icon} ${esc(c.name)} ${c.done ? '✅' : `<span class="muted">${fmt(c.reward)} pts</span>`}</div>
            <div class="museum-items">${c.items
              .map((i) =>
                isMe && i.owned
                  ? `<button class="museum-give" data-act="donate" data-item="${esc(i.id)}" title="Donate your ${esc(i.name)} (3× its value)">${i.icon}</button>`
                  : `<span class="${i.have ? 'have' : ''}" title="${esc(i.name)}${i.have ? ' (donated)' : ''}">${i.icon}</span>`
              )
              .join('')}</div>
          </div>`
        )
        .join('')}</div>
      <p class="muted" style="margin-bottom:0;font-size:.85rem">${isMe && ready.length ? 'Glowing items are in your backpack: click one to donate it. ' : ''}<code>!donate &lt;item&gt;</code> gives digging finds to the museum: 3x their value each, and a big reward plus a title for each finished collection.</p>
    </section>`;
  }

  function farmPanel(f, isMe) {
    const now = Date.now();
    const left = (ms) => (ms < 60_000 ? '<1m' : ms < 3_600_000 ? `${Math.ceil(ms / 60_000)}m` : `${Math.floor(ms / 3_600_000)}h${Math.ceil((ms % 3_600_000) / 60_000)}m`);
    if (!f.plots.length) {
      return `<section class="panel" style="margin-top:16px">
        <div class="panel-head"><h2>🌱 Farm</h2></div>
        <div class="empty"><span class="ic">🟫</span>No farm plots yet. ${isMe ? `<button class="btn btn-sm btn-primary" data-act="buy" data-item="farm_plot" data-name="a farm plot" data-value="${f.plotCost}">Buy a plot · ${fmt(f.plotCost)} pts</button>` : ''} Or <code>!buy plot</code> in chat.</div>
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
              }${f.plots.length < f.max ? `<button class="btn btn-sm" data-act="buy" data-item="farm_plot" data-name="another farm plot" data-value="${f.plotCost}">+ Plot · ${fmt(f.plotCost)} pts</button>` : ''}</div>`
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
      <p class="muted" style="margin-bottom:0;font-size:.85rem"><code>!plant carrot</code> fills empty plots (one seed each), <code>!harvest</code> collects ready ones, <code>!farm</code> shows this in chat. Seeds are in the <a href="#/shop">shop</a>; each extra plot costs a bit more than the last.</p>
    </section>`;
  }

  // Gathering stations (crab pots, ore drills, saplings, dig sites): !collect brings in everything ready.
  function stationsPanel(list, isMe, stamina = null) {
    if (!list?.length) return '';
    const now = Date.now();
    const ready = list.filter((s) => s.ready && s.count > 0).length;
    // Collecting costs one stamina charge: say so when there's none, instead of a button that can't work.
    const tired = stamina && stamina.charges <= 0;
    const back = tired ? Math.max(0, (stamina.nextAt || stamina.refillAt || now) - now) : 0;
    const mins = (ms) => (ms < 60_000 ? '<1m' : `${Math.ceil(ms / 60_000)}m`);
    return `<section class="panel" style="margin-top:16px">
      <div class="panel-head">
        <h2>🏡 Gathering stations</h2>
        ${
          isMe && ready
            ? tired
              ? `<button class="btn btn-sm" disabled title="Collecting uses 1 stamina charge">⚡ Out of stamina · ${mins(back)}</button>`
              : `<button class="btn btn-primary btn-sm" data-act="collect">Collect ${ready === list.length ? 'all' : ready} (1 ⚡)</button>`
            : ''
        }
      </div>
      <div class="station-grid">${list
        .map(
          (s) => `<div class="station${s.ready ? ' ready' : ''}">
            <span class="station-ic">${s.icon}</span>
            <div><b>${s.count}× ${esc(s.name)}</b><br><small class="muted">${s.count === 0 ? 'none yet' : s.ready ? '✅ ready' : `${mins(s.readyAt - now)} left`}</small>
              ${isMe && s.price && s.count < (s.max || 100) ? `<br><button class="mini" data-act="buy" data-item="${esc(s.item)}" data-name="a ${esc(s.name)}" data-value="${s.price}">+1 · ${fmt(s.price)} pts</button>` : ''}</div>
          </div>`
        )
        .join('')}</div>
      <p class="muted" style="margin-bottom:0;font-size:.85rem"><code>!collect</code> turns every ready station's work into XP: 1 stamina for all of them, a bit more XP than gathering by hand, but no items or points. <code>!stations</code> shows this in chat. Each extra station costs a bit more than the last (<code>!buy crab pot</code> in chat).</p>
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
      } else if (act === 'buy') {
        if (!confirm(`Buy ${name} for ${fmt(value)} points?`)) return;
        body = { item, qty: 1 };
      } else if (act === 'plant' || act === 'harvest' || act === 'collect' || act === 'heal' || act === 'daily') body = {};
      else if (act === 'donate' && b.dataset.all) body = { all: true };
      else if (act.startsWith('quest-')) body = { quest: item };
      else body = act === 'unequip' ? { slot } : { item };
      b.disabled = true;
      try {
        const r = await api(act === 'buy' ? '/shop/buy' : `/me/${act.replace('quest-', 'quest/')}`, { method: 'POST', body });
        toast(r.message);
        route();
      } catch (err) {
        toast(err.message);
        b.disabled = false;
      }
    };
  }

  // "⚡⚡▫️ Stamina 2/3 · full in 4m 10s"
  function staminaText(p) {
    const s = p.stamina;
    if (!s) return '';
    const pips = s.max <= 10 ? `<span class="stamina-pips">${Array.from({ length: s.max }, (_, i) => `<i class="${i < s.charges ? 'on' : ''}"></i>`).join('')}</span>` : '';
    const left = s.refillAt ? Math.max(0, Math.ceil((s.refillAt - Date.now()) / 1000)) : 0;
    const wait = left >= 60 ? `${Math.floor(left / 60)}m ${left % 60}s` : `${left}s`;
    return `${pips} ⚡ Stamina <b>${s.charges}/${s.max}</b>${left ? ` · full again in ${wait}` : ' · full'}`;
  }

  // ---- 3D characters (avatar3d.js, loaded on demand) ------------------------------------
  // A stage shows the 2D portrait at once and swaps in the 3D model when WebGL is there.
  // Viewers are disposed when the page changes. Players can switch to the portrait (remembered).
  const views3d = new Set();
  let avatar3d = null;
  const load3d = () => (avatar3d ||= import('/avatar3d.js').catch(() => null));
  const prefers2d = () => {
    try {
      return localStorage.getItem('char3d') === '0';
    } catch {
      return false;
    }
  };
  function charStageHtml(appearance, { size = 200, title = '', cls = '' } = {}) {
    return `<div class="char-stage ${cls}" data-stage>
      <div class="char-stage-2d">${window.MMOAvatar.svg(appearance, { size, title })}</div>
      <button class="char-stage-toggle" type="button" data-stage-toggle hidden title="Switch between the 3D model and the portrait">🖼️ 2D</button>
      <div class="char-stage-hint">Drag: turn<br>Shift-drag: move<br>Scroll: zoom<br>Double-click: reset</div>
    </div>`;
  }
  // Mounts a 3D view into a stage made by charStageHtml. Returns the viewer (or null).
  async function mountStage(stage, appearance, opts = {}) {
    if (!stage) return null;
    const mod = await load3d();
    if (!mod || !mod.supported() || !stage.isConnected) return null;
    const toggle = stage.querySelector('[data-stage-toggle]');
    let view = null;
    let current = appearance;
    const show3d = () => {
      if (view) return;
      view = mod.mount(stage, current, opts);
      views3d.add(view);
      stage.classList.add('is-3d');
      if (toggle) toggle.textContent = '🖼️ 2D';
    };
    const show2d = () => {
      if (!view) return;
      view.dispose();
      views3d.delete(view);
      view = null;
      stage.classList.remove('is-3d');
      if (toggle) toggle.textContent = '🧊 3D';
    };
    if (toggle) {
      toggle.hidden = false;
      toggle.onclick = () => {
        const to2d = !!view;
        to2d ? show2d() : show3d();
        try {
          localStorage.setItem('char3d', to2d ? '0' : '1');
        } catch {}
      };
    }
    if (prefers2d()) {
      if (toggle) toggle.textContent = '🧊 3D';
    } else show3d();
    return {
      update(a) {
        current = a;
        view?.update(a);
      },
    };
  }
  function disposeStages() {
    for (const v of views3d) v.dispose();
    views3d.clear();
  }

  // ---- pages -------------------------------------------------------------
  const pages = {};

  pages.home = async () => {
    const [lb, act, guide, sr] = await Promise.all([api('/leaderboard/overall?limit=10'), api('/activity'), api('/guide'), api('/stream').catch(() => null)]);
    const proj = sr?.projectsEnabled && sr.project;
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

      ${
        proj
          ? `<a class="panel project-home" href="#/stream">
              <span class="ph-ic">${proj.icon}</span>
              <span class="ph-main"><b>Community project: ${esc(proj.name)}</b><span class="muted">${esc(proj.text)}</span>
                <span class="project-bar small"><span style="width:${Math.min(100, (proj.progress / proj.goal) * 100).toFixed(2)}%"></span><b>${fmt(proj.progress)} / ${fmt(proj.goal)} pts</b></span></span>
              <span class="btn btn-primary btn-sm">Chip in →</span>
            </a>`
          : ''
      }
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
          <td><a class="player-cell" href="${playerLink(r.username)}">${r.appearance ? `<span class="lb-portrait">${window.MMOAvatar.svg(r.appearance, { size: 34, head: true })}</span>` : avatar(r.avatarUrl, r.username, 'sm')}${esc(r.username)}</a></td>
          ${showLevel ? `<td class="num"><b>${r.level}</b></td>` : ''}
          ${showValue ? `<td class="num">${fmt(kind === 'points' ? r.points : r.xp)}</td>` : ''}
        </tr>`
        )
        .join('')}</tbody></table></div>`;
  }

  pages.shop = async () => {
    const { items, points, farmingLevel, plots, plotGrowth, plotNext, stations, houses } = await api('/shop');
    const growPct = Math.round(((plotGrowth ?? 1.12) - 1) * 100);
    const isStation = (i) => i.category === 'stations';
    // Items bought in bulk at a rising price (plots, stations): the total for 1-5 of them.
    const multiNext = { farm_plot: plotNext, ...Object.fromEntries(Object.entries(stations || {}).map(([k, v]) => [k, v.next])) };
    const rising = (i) => i.item === 'farm_plot' || isStation(i);
    const loggedIn = points !== null;
    const buyBtn = (i, locked) =>
      loggedIn ? `<button class="btn btn-primary btn-sm" data-buy="${esc(i.item)}" ${locked ? 'disabled' : ''}>Buy</button>` : '';
    // Cosmetics show on a preview of your own character (or a sample one when logged out).
    const sample = state.me?.appearance || { race: 'human', look: { skin: 'light', hair: 'short', hairColor: 'brown', outfit: 'blue' } };
    const preview = (i) => window.MMOAvatar.svg({ ...sample, gear: {}, pet: null, stars: 0, cosmetics: { [i.cosmetic.slot]: i.cosmetic.style } }, { size: 84 });
    const card = (i) => `<section class="panel shop-item">
            <div class="shop-icon">${i.cosmetic ? `<span class="shop-preview">${preview(i)}</span>` : i.icon}</div>
            <h2>${esc(i.name)}</h2>
            <p class="muted">${esc(i.description || '')}</p>
            ${i.attack ? `<p class="shop-stat">⚔️ +${i.attack} attack · needs ${esc(i.wieldSkill || 'Swords')} ${i.level}</p>` : ''}
            ${i.item === 'farm_plot' && loggedIn ? `<p class="shop-stat">You own ${plots}/100 plots · each plot costs ${Math.round(((plotGrowth ?? 1.12) - 1) * 100)}% more than the last</p>` : ''}
            ${i.item === 'farm_plot' && !loggedIn ? `<p class="shop-stat">Each plot costs ${growPct}% more than the last</p>` : ''}
            ${isStation(i) && loggedIn ? `<p class="shop-stat">You own ${stations[i.item].count} · ${stations[i.item].ready ? '✅ ready to <code>!collect</code>' : `next haul in ${Math.max(1, Math.ceil((stations[i.item].readyAt - Date.now()) / 60000))} min`} · each costs ${growPct}% more than the last</p>` : ''}
            ${isStation(i) && !loggedIn ? `<p class="shop-stat">Everyone starts with 1 · each extra costs ${growPct}% more than the last</p>` : ''}
            <div class="shop-buy">
              <span class="shop-price"${rising(i) ? ` id="price-${esc(i.item)}"` : ''}>${fmt(i.cost)} pts${i.category === 'arrows' ? ' <small>each</small>' : rising(i) && loggedIn ? ' <small>next one</small>' : ''}</span>
              ${(rising(i) || i.category === 'potions' || i.category === 'arrows') && loggedIn ? `<input type="number" class="qty" id="qty-${esc(i.item)}" value="${i.category === 'arrows' ? 50 : 1}" min="1" max="${i.category === 'arrows' ? 500 : 100}" aria-label="How many">` : ''}
              ${buyBtn(i, i.item === 'farm_plot' && plots >= 100)}
            </div>
            <p class="muted" style="font-size:.8rem;margin:8px 0 0">In chat: <code>!buy ${esc(i.item === 'farm_plot' ? 'plot' : isStation(i) ? i.name.toLowerCase() : i.item === 'flint_and_steel' ? 'flint' : i.category === 'potions' ? i.name.toLowerCase() : i.category === 'arrows' ? `${i.name.toLowerCase()} 50` : i.cosmetic ? i.name.toLowerCase() : i.name.split(' ').pop().toLowerCase())}</code></p>
          </section>`;
    // Seeds grouped by crop: one card per crop with its tiers, in the order they unlock.
    const seedLines = [];
    for (const i of items.filter((x) => x.category === 'seeds').sort((a, b) => a.level - b.level)) {
      let line = seedLines.find((l) => l.id === i.crop.line);
      if (!line) seedLines.push((line = { id: i.crop.line, name: i.crop.lineName, skill: i.crop.skill, tiers: [] }));
      line.tiers.push(i);
    }
    for (const l of seedLines) l.tiers.sort((a, b) => a.crop.tier - b.crop.tier);
    const top = items.filter((i) => !i.category || i.category === 'farming' || i.category === 'weapons');
    const stationItems = items.filter(isStation);
    const potions = items.filter((i) => i.category === 'potions');
    const arrows = items.filter((i) => i.category === 'arrows');
    const cosmetics = items.filter((i) => i.category === 'cosmetics');
    const limited = items.find((i) => i.category === 'limited');
    $app.innerHTML = `
      <div class="panel-head" style="margin-bottom:6px"><h1 style="margin:0">🛒 Shop</h1>${
        loggedIn
          ? `<span class="badge gold" style="font-size:1rem">💰 ${fmt(points)} points</span>`
          : state.loginEnabled
            ? `<a class="btn btn-primary" href="/auth/login">Log in with Kick to buy</a>`
            : ''
      }</div>
      <p class="muted">Spend the points you earn in chat. You can also buy in chat, e.g. <code>!buy hammer</code> or <code>!buy carrot seeds 5</code>.</p>
      ${
        limited
          ? `<section class="panel limited-banner">
              <div><span class="badge gold">⏳ This week only</span><h2 style="margin:8px 0 4px">${limited.icon} ${esc(limited.name)}</h2>
              <p class="muted" style="margin:0">A limited ${esc(limited.cosmetic.slot)} that leaves the shop in <b>${Math.max(1, Math.ceil((limited.endsAt - Date.now()) / 86_400_000))} day(s)</b>. Next week brings a different one.</p></div>
              <span class="shop-preview">${preview(limited)}</span>
              <div class="shop-buy"><span class="shop-price">${fmt(limited.cost)} pts</span>${buyBtn(limited, false)}</div>
            </section>`
          : ''
      }
      <div class="shop-grid">${top.map(card).join('')}</div>

      ${
        houses?.on
          ? `<h2 style="margin:28px 0 6px">🏠 Houses</h2>
      <p class="muted">End-game homes that make your <b>stamina bar bigger</b>: every charge is one more action before you rest. You own one house at a time and move up one step at a time; each needs a character level${loggedIn ? ` (yours: <b>${houses.level}</b>)` : ''}. <code>!house</code> in chat shows yours, <code>!house buy</code> moves up.</p>
      <div class="shop-grid">${houses.houses
        .map(
          (h) => `<section class="panel shop-item${h.owned ? ' owned' : ''}">
            <div class="shop-icon">${h.icon}</div>
            <h2>${esc(h.name)}</h2>
            <p class="muted">${esc(h.text)}</p>
            <p class="shop-stat">⚡ +${h.charges} stamina charge${h.charges === 1 ? '' : 's'} · needs character level ${h.level}</p>
            <div class="shop-buy">
              <span class="shop-price">${h.forSale ? `${fmt(h.cost)} pts` : 'Not for sale'}</span>
              ${
                !loggedIn
                  ? ''
                  : h.owned
                    ? '<span class="badge gold">🏠 Your home</span>'
                    : h.below
                      ? '<span class="muted">Moved up</span>'
                      : h.next
                        ? `<button class="btn btn-primary btn-sm" data-house ${h.canBuy ? '' : 'disabled'} title="${houses.level < h.level ? `Needs character level ${h.level}` : points < h.cost ? 'Not enough points' : ''}">Move in</button>`
                        : `<span class="muted">After the ${esc(houses.houses[h.tier - 2].name)}</span>`
              }
            </div>
          </section>`
        )
        .join('')}</div>`
          : ''
      }

      <h2 style="margin:28px 0 6px">🏡 Gathering stations</h2>
      <p class="muted">Like farm plots for your other skills: each station works on its own every 20 minutes or so (a bit longer at higher levels), and <code>!collect</code> turns everything that's ready into XP for <b>1 stamina</b>. It's a little more XP than gathering the same things by hand, but stations give <b>no items and no points</b>, so your backpack stays free. Everyone starts with one of each; <code>!stations</code> shows them.</p>
      <div class="shop-grid">${stationItems.map(card).join('')}</div>

      <h2 style="margin:28px 0 6px">🎩 Cosmetics</h2>
      <p class="muted">Hats, capes and auras for your character. Looks only, no stats. They show on your portrait, the leaderboards and the stream overlay, and don't take backpack space. Wear them on the <a href="#/customize">Customize</a> page.</p>
      <div class="shop-grid">${cosmetics.map(card).join('')}</div>

      <h2 style="margin:28px 0 6px">🧪 Potions</h2>
      <p class="muted">Fights cost HP. At 0 you're knocked out until you're back at full HP (24h), or until you drink a health potion. <code>!drink</code> in chat drinks the best one for you. Or brew your own from farmed crops with <code>!brew</code>.</p>
      <div class="shop-grid">${potions.map(card).join('')}</div>

      <h2 style="margin:28px 0 6px">🎯 Arrows &amp; runes</h2>
      <p class="muted">For <code>!shoot</code> with a bow. Each fight uses one arrow; better arrows hit harder. They go in your 🧺 Quiver (holds 500, doesn't use backpack slots), so buy a quiver first. Higher tiers must be fletched: <code>!fletch arrows</code>.</p>
      <div class="shop-grid">${arrows.map(card).join('')}</div>

      <h2 style="margin:28px 0 6px">🌱 Seeds</h2>
      <p class="muted">Each crop is used by another skill. Plant with <code>!plant carrot</code>, harvest with <code>!harvest</code> when it's grown, one crop per plot. Better versions of a crop unlock as your Farming level goes up.${loggedIn ? ` Your Farming level: <b>${farmingLevel}</b>.` : ''} ☕ Coffee seeds only come from gifting subs.</p>
      <div class="seed-grid">${seedLines
        .map(
          (line) => `<section class="panel seed-card">
            <div class="seed-head"><span class="seed-icon">${line.tiers[0].crop.icon}</span><div><h3>${esc(line.name)}</h3><span class="badge">${esc(line.skill)}</span></div></div>
            <p class="muted seed-use">${esc(line.tiers[0].crop.use)}</p>
            <ul class="seed-tiers">${line.tiers
              .map((i) => {
                const locked = loggedIn && farmingLevel < i.level;
                return `<li class="${locked ? 'locked' : ''}">
                  <span class="seed-name">${esc(i.crop.name)}${i.crop.tier > 1 ? ` <span class="muted">(tier ${i.crop.tier})</span>` : ''}</span>
                  <span class="seed-meta muted">${locked ? `🔒 Farming ${i.level}` : `${i.level > 1 ? `Farming ${i.level} · ` : ''}${i.crop.grow} min · ${fmt(i.cost)} pts`}</span>
                  ${
                    loggedIn && !locked
                      ? `<span class="form-row"><input type="number" class="qty" id="qty-${esc(i.item)}" value="${Math.max(1, plots || 1)}" min="1" max="1000" aria-label="How many ${esc(i.crop.name)} seeds"> ${buyBtn(i, false)}</span>`
                      : ''
                  }
                </li>`;
              })
              .join('')}</ul>
          </section>`
        )
        .join('')}</div>`;
    // Buying several plots or stations: show the total (each one costs more than the last).
    for (const [item, next] of Object.entries(multiNext)) {
      const qty = document.getElementById(`qty-${item}`);
      const el = document.getElementById(`price-${item}`);
      if (!qty || !el || !next) continue;
      qty.oninput = () => {
        const n = Math.max(1, Math.floor(Number(qty.value) || 1));
        if (n === 1) el.innerHTML = `${fmt(next[0])} pts <small>next one</small>`;
        else if (n <= next.length) el.innerHTML = `${fmt(next[n - 1])} pts <small>for ${n}</small>`;
        else el.innerHTML = `${fmt(next[next.length - 1])}+ pts <small>for ${n}</small>`;
      };
    }
    const houseBtn = $app.querySelector('[data-house]');
    if (houseBtn) {
      houseBtn.onclick = async () => {
        const next = houses.houses.find((h) => h.next);
        if (!confirm(`Move into the ${next.icon} ${next.name} for ${fmt(next.cost)} pts? (+${next.charges} stamina)`)) return;
        houseBtn.disabled = true;
        try {
          toast((await api('/me/house', { method: 'POST', body: {} })).message);
          route();
        } catch (err) {
          toast(err.message);
          houseBtn.disabled = false;
        }
      };
    }
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
  pages.stream = async () => window.MMOStream($app, { api, toast, esc, fmt, state, ago, playerLink });
  pages.pvp = async () => window.MMOPvp($app, { api, toast, esc, fmt, state, ago, playerLink });
  pages.fishing = async () => window.MMOFishing($app, { api, toast, esc, fmt, state, ago, playerLink });
  pages.train = async () => window.MMOTrain($app, { api, toast, esc, fmt, state });
  pages.town = async (params) => window.MMOTown($app, { api, toast, esc, fmt, state, playerLink }, params);
  pages.veil = async () => window.MMOVeil($app, { api, toast, esc, fmt, state, ago, playerLink });
  pages.relics = async (_, query) => window.MMORelics($app, { api, toast, esc, fmt, state, route, ago, playerLink }, query);
  pages.cards = async (_, query) => window.MMOCards($app, { api, toast, esc, fmt, state, route, ago, playerLink }, query);

  pages.leaderboards = async (_, query) => {
    const kind = query.get('board') || 'overall';
    const tabs = [
      { id: 'overall', label: '🏆 Overall' },
      { id: 'points', label: '💰 Points' },
      { id: 'season', label: '🏁 Season' },
      ...state.site.skills.map((s) => ({ id: s.id, label: `${s.icon} ${s.name}` })),
    ];
    const data = await api(`/leaderboard/${encodeURIComponent(kind)}?limit=100`);
    const s = data.season;
    const left = s?.endsAt ? Math.max(0, s.endsAt - Date.now()) : null;
    $app.innerHTML = `
      <div class="panel-head" style="margin-bottom:12px"><h1 style="margin:0">Leaderboards</h1><div class="form-row"><a class="btn btn-sm" href="#/guilds">🛡️ Guilds</a><a class="btn btn-sm" href="#/hall">🏛️ Hall of fame</a></div></div>
      <div class="tabs">${tabs
        .map((t) => `<a class="tab ${t.id === kind ? 'active' : ''}" href="#/leaderboards?board=${t.id}">${t.label}</a>`)
        .join('')}</div>
      ${
        s
          ? `<p class="muted">🏁 <b>Season ${s.number}</b> counts XP earned this season.${
              left !== null ? ` Ends in <b>${left > 172_800_000 ? `${Math.ceil(left / 86_400_000)} days` : `${Math.ceil(left / 3_600_000)} hours`}</b>.` : ''
            } The top 3 win a permanent title and a season-only cosmetic (🥇 Champion's Crown + Victor Aura, 🥈 Silver Laurel, 🥉 Bronze Laurel).</p>`
          : ''
      }
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
    if (data.profile.appearance) mountStage($app.querySelector('[data-stage]'), data.profile.appearance);
    if (isMe) bindSheetActions();
    document.getElementById('share-card')?.addEventListener('click', () => shareCard(data.profile));
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

  // ---- Hall of fame ---------------------------------------------------------------------------
  pages.hall = async () => {
    const h = await api('/hall');
    const when = (t) => (t ? new Date(t).toLocaleDateString() : '');
    $app.innerHTML = `
      <h1>🏛️ Hall of fame</h1>
      <p class="muted">The channel's legends: season champions, the first to reach level 500 in each skill, the first to find each pet, and the biggest casino wins.</p>
      <div class="grid grid-2">
        <section class="panel">
          <h2>🏁 Season winners</h2>
          ${
            h.seasons.length
              ? `<ul class="hall-list">${h.seasons
                  .map(
                    (x) => `<li><b>Season ${x.number}</b> <span class="muted">${when(x.endedAt)}</span><div>${x.winners
                      .map((w, i) => `${['🥇', '🥈', '🥉'][i]} <a href="${playerLink(w.username)}">${esc(w.username)}</a> <span class="muted">${fmt(w.xp)} XP</span>`)
                      .join(' · ') || '<span class="muted">nobody</span>'}</div></li>`
                  )
                  .join('')}</ul>`
              : '<p class="muted">No season has ended yet.</p>'
          }
        </section>
        <section class="panel">
          <h2>🎰 Biggest casino wins</h2>
          ${
            h.casino.length
              ? `<div class="table-wrap"><table><tbody>${h.casino
                  .map((c, i) => `<tr><td>${i + 1}</td><td><a href="${playerLink(c.username)}">${esc(c.username)}</a></td><td class="num"><b>${fmt(c.amount)}</b> pts</td><td class="muted">${esc(c.text.replace(/^won [\d,]+ pts |^cashed out [\d,]+ pts /, ''))}</td></tr>`)
                  .join('')}</tbody></table></div>`
              : '<p class="muted">No big wins yet.</p>'
          }
        </section>
      </div>
      <section class="panel" style="margin-top:16px">
        <h2>⭐ First to level 500</h2>
        <div class="hall-grid">${h.max
          .map((m) => `<div class="hall-card${m.first ? ' got' : ''}"><div class="ic">${m.icon}</div><b>${esc(m.name)}</b><div>${m.first ? `<a href="${playerLink(m.first.username)}">${esc(m.first.username)}</a> <span class="muted">${when(m.first.at)}</span>` : '<span class="muted">Nobody yet</span>'}</div></div>`)
          .join('')}</div>
      </section>
      <section class="panel" style="margin-top:16px">
        <h2>🐾 First pet finders</h2>
        ${
          h.pets.length
            ? `<div class="hall-grid">${h.pets.map((p) => `<div class="hall-card got"><div class="ic">${p.icon}</div><b>${esc(p.name)}</b><div><a href="${playerLink(p.username)}">${esc(p.username)}</a> <span class="muted">${when(p.at)}</span></div></div>`).join('')}</div>`
            : '<p class="muted">No pets found yet. Every action has a tiny chance!</p>'
        }
      </section>`;
  };

  // ---- Guilds ---------------------------------------------------------------------------------
  pages.guilds = async () => {
    const d = await api('/guilds');
    const loggedIn = d.points !== null;
    const g = d.mine;
    const isLeader = g && state.me && g.owner === state.me.username;
    const pct = g ? Math.min(100, Math.round((g.week.actions / g.week.target) * 100)) : 0;
    $app.innerHTML = `
      <div class="panel-head" style="margin-bottom:6px"><h1 style="margin:0">🛡️ Guilds</h1>${loggedIn ? `<span class="badge gold" style="font-size:1rem">💰 ${fmt(d.points)} points</span>` : ''}</div>
      <p class="muted">Team up: a guild has a shared bank, a leaderboard, and a weekly goal (100 actions per member) that pays into the bank. In chat: <code>!guild</code>, <code>!guild join &lt;name&gt;</code>, <code>!guild deposit 500</code>.</p>
      ${
        g
          ? `<section class="panel">
              <div class="panel-head"><h2>[${esc(g.tag)}] ${esc(g.name)}</h2><span class="badge gold">🏦 ${fmt(g.bank)} pts</span></div>
              <p class="muted" style="margin-top:0">Led by ${esc(g.owner || '?')} · ${g.members} member${g.members === 1 ? '' : 's'} · ${fmt(g.xp)} XP</p>
              <div class="task-bar" style="height:10px"><span style="width:${pct}%"></span></div>
              <p style="margin:6px 0 14px">Weekly goal: <b>${fmt(g.week.actions)} / ${fmt(g.week.target)}</b> actions ${g.week.done ? '✅ done! Paid into the bank.' : `→ +${fmt(g.week.reward)} pts to the bank`}</p>
              <div class="guild-members">${g.list
                .map((m) => `<a class="guild-member" href="${playerLink(m.username)}"><span class="lb-portrait">${window.MMOAvatar.svg(m.appearance, { size: 34, head: true })}</span><span><b>${esc(m.username)}</b>${m.role === 'owner' ? ' 👑' : ''}<br><small class="muted">${fmt(m.xp)} XP</small></span></a>`)
                .join('')}</div>
              <div class="form-row" style="margin-top:14px;flex-wrap:wrap">
                <form id="g-deposit" class="form-row"><input type="number" name="amount" min="1" placeholder="Points" style="max-width:120px" aria-label="Points to deposit"><button class="btn">Deposit</button></form>
                ${isLeader ? `<form id="g-pay" class="form-row"><input type="text" name="username" placeholder="Member" style="max-width:130px" aria-label="Member"><input type="number" name="amount" min="1" placeholder="Points" style="max-width:110px" aria-label="Points"><button class="btn">Pay from bank</button></form>` : ''}
                <button class="btn btn-danger" id="g-leave">Leave guild</button>
              </div>
            </section>`
          : loggedIn
            ? `<section class="panel"><h2 style="margin-top:0">Start a guild</h2>
                <form id="g-create" class="form-row" style="flex-wrap:wrap"><input type="text" name="name" placeholder="Guild name" maxlength="24" required aria-label="Guild name"><input type="text" name="tag" placeholder="TAG" maxlength="4" style="max-width:80px;text-transform:uppercase" aria-label="Tag"><button class="btn btn-primary">Create (${fmt(d.cost)} pts)</button></form>
                <p class="muted" style="margin-bottom:0;font-size:.85rem">Or join one below.</p></section>`
            : ''
      }
      <section class="panel" style="margin-top:16px">
        <h2 style="margin-top:0">🏆 Guild leaderboard</h2>
        ${
          d.guilds.length
            ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Guild</th><th class="num">Members</th><th class="num">XP</th><th class="num">Season XP</th><th class="num">Bank</th><th></th></tr></thead><tbody>${d.guilds
                .map(
                  (x) => `<tr class="${g && g.id === x.id ? 'me' : ''}"><td>${x.rank}</td><td><b>[${esc(x.tag)}]</b> ${esc(x.name)}</td><td class="num">${x.members}</td><td class="num">${fmt(x.xp)}</td><td class="num">${fmt(x.seasonXp)}</td><td class="num">${fmt(x.bank)}</td>
                  <td>${loggedIn && !g ? `<button class="btn btn-sm btn-primary" data-join="${x.id}">Join</button>` : ''}</td></tr>`
                )
                .join('')}</tbody></table></div>`
            : '<div class="empty"><span class="ic">🛡️</span>No guilds yet. Start the first one!</div>'
        }
      </section>`;
    const post = async (path, body) => {
      try {
        const r = await api(path, { method: 'POST', body });
        toast(r.message);
        route();
      } catch (err) {
        toast(err.message);
      }
    };
    const on = (id, fn) => {
      const f = document.getElementById(id);
      if (f) f.onsubmit = (e) => (e.preventDefault(), fn(f));
    };
    on('g-create', (f) => post('/guilds', { name: f.name.value, tag: f.tag.value }));
    on('g-deposit', (f) => post('/guild/deposit', { amount: Number(f.amount.value) }));
    on('g-pay', (f) => post('/guild/pay', { username: f.username.value, amount: Number(f.amount.value) }));
    document.getElementById('g-leave')?.addEventListener('click', () => confirm('Leave the guild?') && post('/guild/leave', {}));
    $app.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', () => post(`/guilds/${b.dataset.join}/join`, {})));
  };

  // ---- Player market ------------------------------------------------------------------------
  pages.market = async (_, query) => {
    const [d, bq, pr] = await Promise.all([api('/market'), api('/bounties'), api('/prices')]);
    const loggedIn = d.points !== null;
    let q = (query?.get('q') || '').toLowerCase();
    const mine = (l) => state.me && l.seller === state.me.username;
    const rows = () => {
      const list = d.listings.filter((l) => !q || l.name.toLowerCase().includes(q) || l.seller.toLowerCase().includes(q));
      if (!list.length) return `<div class="empty"><span class="ic">🏪</span>${q ? 'Nothing matches.' : 'Nothing for sale yet. Be the first to list something!'}</div>`;
      return `<div class="table-wrap"><table>
        <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Each</th><th class="num">Shop value</th><th>Seller</th><th></th></tr></thead>
        <tbody>${list
          .map(
            (l) => `<tr><td>${l.icon} ${esc(l.name)}</td><td class="num">${fmt(l.qty)}</td><td class="num"><b>${fmt(l.price)}</b> pts</td><td class="num">${fmt(l.each)}</td>
              <td class="num muted">${fmt(l.value)}</td><td><a href="${playerLink(l.seller)}">${esc(l.seller)}</a></td>
              <td>${
                !loggedIn
                  ? ''
                  : mine(l)
                    ? `<button class="btn btn-sm" data-cancel="${l.id}">Cancel</button>`
                    : `<button class="btn btn-primary btn-sm" data-buy="${l.id}" ${d.points < l.price ? 'disabled title="Not enough points"' : ''}>Buy</button>`
              }</td></tr>`
          )
          .join('')}</tbody></table></div>`;
    };
    $app.innerHTML = `
      <div class="panel-head" style="margin-bottom:6px"><h1 style="margin:0">🏪 Market</h1>${
        loggedIn ? `<span class="badge gold" style="font-size:1rem">💰 ${fmt(d.points)} points</span>` : state.loginEnabled ? `<a class="btn btn-primary" href="/auth/login">Log in with Kick to trade</a>` : ''
      }</div>
      <p class="muted">Buy and sell items with other players. Listed items leave your backpack until they sell or you cancel. The market keeps ${Math.round(d.fee * 100)}% of each sale. Pets can't be sold.</p>
      ${
        loggedIn
          ? d.blocked
            ? `<div class="panel"><p class="muted" style="margin:0">${esc(d.blocked)}</p></div>`
            : `<section class="panel">
                <h2 style="margin-top:0">Sell something</h2>
                <form id="sell-form" class="form-row" style="flex-wrap:wrap">
                  <select name="item" aria-label="Item" required><option value="">Pick an item…</option>${d.inventory
                    .map((i) => `<option value="${esc(i.id)}" data-qty="${i.qty}" data-value="${i.value}" data-max="${i.max}">${i.icon} ${esc(i.name)} (have ${fmt(i.qty)})</option>`)
                    .join('')}</select>
                  <input type="number" name="qty" value="1" min="1" style="max-width:90px" aria-label="Quantity">
                  <input type="number" name="price" min="1" placeholder="Total price" style="max-width:140px" aria-label="Total price">
                  <button class="btn btn-primary">List it</button>
                </form>
                <p class="muted" id="sell-hint" style="font-size:.85rem;margin-bottom:0"></p>
              </section>`
          : ''
      }
      <section class="panel" style="margin-top:16px" id="prices">
        <div class="panel-head"><h2>💹 Price checker</h2><input type="search" id="price-q" class="guide-search" placeholder="Search items, e.g. carrot" style="max-width:260px"></div>
        <p class="muted" style="margin-top:0">What the shop pays right now (<code>!sell</code>). ${
          pr.on
            ? `When lots of one item is sold across the channel its price drops (to ${Math.round(pr.floor * 100)}% at most), then recovers by half every ${pr.recoveryHours} hours. Selling a big pile slides the price as you go, and all crops and crop dishes share one price drop. Spread your selling out, or list it on the market below.`
            : 'Prices are fixed right now.'
        } In chat: <code>!price carrot</code>.</p>
        <div class="form-row" style="margin-bottom:10px;flex-wrap:wrap">
          <select id="price-sort" aria-label="Sort by"><option value="drop">Biggest drops first</option><option value="value">Highest price first</option><option value="name">Name</option>${loggedIn ? '<option value="mine">What I have</option>' : ''}</select>
        </div>
        <div id="price-rows"></div>
      </section>
      <section class="panel" style="margin-top:16px">
        <div class="panel-head"><h2>🎯 Bounties</h2><span class="muted">${bq.bounties.length}/10</span></div>
        ${
          bq.bounties.length
            ? `<ul class="hall-list">${bq.bounties
                .map((b) => `<li>${b.icon} <b>${esc(b.name)}</b>: <b style="color:var(--gold)">${fmt(b.reward)} pts</b> to the first to get one from an action <span class="muted">(posted by ${esc(b.poster)}, ends ${new Date(b.expiresAt).toLocaleDateString()})</span></li>`)
                .join('')}</ul>`
            : '<p class="muted" style="margin:0">No bounties right now.</p>'
        }
        <p class="muted" style="margin:10px 0 0;font-size:.85rem">Post one in chat: <code>!bounty goblin crown 5000</code>. Your points are held until someone finds one (or refunded after 7 days / <code>!bounty cancel</code>).</p>
      </section>
      <section class="panel" style="margin-top:16px">
        <div class="panel-head"><h2>For sale</h2><input type="search" id="market-q" class="guide-search" placeholder="Search items or sellers" value="${esc(q)}" style="max-width:260px"></div>
        <div id="market-rows">${rows()}</div>
      </section>`;
    const $prices = document.getElementById('price-rows');
    const $pq = document.getElementById('price-q');
    const $psort = document.getElementById('price-sort');
    const priceRows = () => {
      const pq = $pq.value.trim().toLowerCase();
      const sort = $psort.value;
      let list = pr.items.filter((x) => !pq || x.name.toLowerCase().includes(pq));
      if (sort === 'mine') list = list.filter((x) => x.have > 0);
      list.sort((a, b) =>
        sort === 'name' ? a.name.localeCompare(b.name) : sort === 'value' ? b.mine - a.mine : sort === 'mine' ? b.mine * b.have - a.mine * a.have : a.change - b.change || b.mine - a.mine
      );
      const total = list.length;
      list = list.slice(0, pq ? 60 : 25);
      if (!list.length) return `<div class="empty"><span class="ic">💹</span>${sort === 'mine' ? 'Nothing in your backpack to sell.' : 'No sellable item matches.'}</div>`;
      return `<div class="table-wrap"><table>
        <thead><tr><th>Item</th><th class="num">Normally</th><th class="num">Right now</th><th class="num">Change</th><th class="num">Sold lately</th>${loggedIn ? '<th class="num">You have</th>' : ''}</tr></thead>
        <tbody>${list
          .map(
            (x) => `<tr><td>${x.icon} ${esc(x.name)}</td><td class="num muted">${fmt(x.base)}</td><td class="num"><b>${fmt(x.mine)}</b> pts</td>
              <td class="num" style="color:${x.change < 0 ? 'var(--danger)' : 'var(--muted)'}">${x.change < 0 ? `${x.change}%` : 'full price'}</td>
              <td class="num muted">${x.group && x.recent ? '<span title="All crops and crop dishes share one price drop">🌾 all crops</span>' : x.recent ? `~${fmt(x.recent)}` : '—'}</td>
              ${loggedIn ? `<td class="num">${x.have ? `${fmt(x.have)} <span class="muted">(${fmt(x.have * x.mine)} pts)</span>` : '<span class="muted">—</span>'}</td>` : ''}</tr>`
          )
          .join('')}</tbody></table></div>${total > list.length ? `<p class="muted" style="margin:8px 0 0;font-size:.85rem">Showing ${list.length} of ${total}. Search to find more.</p>` : ''}`;
    };
    $prices.innerHTML = priceRows();
    $pq.oninput = $psort.onchange = () => ($prices.innerHTML = priceRows());
    const $rows = document.getElementById('market-rows');
    document.getElementById('market-q').oninput = (e) => {
      q = e.target.value.trim().toLowerCase();
      $rows.innerHTML = rows();
    };
    $rows.onclick = async (e) => {
      const b = e.target.closest('button[data-buy], button[data-cancel]');
      if (!b) return;
      const buying = !!b.dataset.buy;
      const l = d.listings.find((x) => x.id === Number(b.dataset.buy || b.dataset.cancel));
      if (buying && !confirm(`Buy ${l.qty}x ${l.name} for ${fmt(l.price)} pts?`)) return;
      b.disabled = true;
      try {
        const r = await api(`/market/${l.id}/${buying ? 'buy' : 'cancel'}`, { method: 'POST', body: {} });
        toast(r.message);
        route();
      } catch (err) {
        toast(err.message);
        b.disabled = false;
      }
    };
    const form = document.getElementById('sell-form');
    if (form) {
      const hint = () => {
        const o = form.item.selectedOptions[0];
        if (!o?.value) return (document.getElementById('sell-hint').textContent = '');
        const qty = Number(form.qty.value) || 1;
        document.getElementById('sell-hint').textContent = `The shop pays ${fmt(o.dataset.value * qty)} pts for ${qty}. Most you can ask: ${fmt(o.dataset.max * qty)} pts. You get the price minus ${Math.round(d.fee * 100)}%.`;
      };
      form.item.onchange = () => {
        const o = form.item.selectedOptions[0];
        if (o?.value) {
          form.qty.max = o.dataset.qty;
          if (!form.price.value) form.price.value = Math.max(1, Math.round(o.dataset.value * 1.5 * (Number(form.qty.value) || 1)));
        }
        hint();
      };
      form.qty.oninput = hint;
      form.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const r = await api('/market/sell', { method: 'POST', body: { item: form.item.value, qty: Number(form.qty.value), price: Number(form.price.value) } });
          toast(r.message);
          route();
        } catch (err) {
          toast(err.message);
        }
      };
    }
  };

  // ---- Character customizer: race and look -------------------------------------------------
  const LOOK_SECTIONS = [
    ['skin', 'Skin tone'],
    ['hair', 'Hairstyle'],
    ['hairColor', 'Hair color'],
    ['facialHair', 'Facial hair'],
    ['eyes', 'Eyes'],
    ['eyeColor', 'Eye color'],
    ['brows', 'Eyebrows'],
    ['nose', 'Nose'],
    ['mouth', 'Mouth'],
    ['extra', 'Extras'],
    ['outfit', 'Outfit'],
  ];

  pages.customize = async () => {
    if (!state.me) {
      $app.innerHTML = `
        <div class="panel empty">
          <span class="ic">🎨</span>
          <h2>Customize your character</h2>
          <p>Log in with the Kick account you chat with to pick your race and look.</p>
          ${state.loginEnabled ? `<a class="btn btn-primary" href="/auth/login">Log in with Kick</a>` : '<p>Kick login is not configured yet.</p>'}
        </div>`;
      return;
    }
    const data = await api('/appearance');
    const mine = data.mine;
    const draft = { race: mine.race, look: { ...mine.look } };
    const locked = mine.raceChangeAt && mine.raceChangeAt > Date.now();
    const daysLeft = locked ? Math.ceil((mine.raceChangeAt - Date.now()) / 86_400_000) : 0;

    // Hats, capes, auras and pets you own.
    const WARDROBE = [
      ['hat', 'Hat'],
      ['cape', 'Cape'],
      ['aura', 'Aura'],
      ['pet', 'Pet'],
    ];
    const worn = (key) => mine.wardrobe[key].find((o) => o.id === draft.look[key]);
    const view = () => ({
      race: draft.race,
      look: draft.look,
      gear: mine.gear,
      stars: mine.stars,
      cosmetics: Object.fromEntries(['hat', 'cape', 'aura'].filter((k) => worn(k)).map((k) => [k, worn(k).style])),
      pet: worn('pet')?.icon || null,
    });
    // The 3D stage is made once and moved into each redraw, so the model isn't rebuilt from scratch.
    const holder = document.createElement('div');
    holder.innerHTML = charStageHtml(view(), { size: 220, cls: 'char-stage-customize' });
    const stageEl = holder.firstElementChild;
    let stage = null;
    let mounting = null;
    const draw = () => {
      const race = data.races.find((r) => r.id === draft.race);
      const changed = draft.race !== mine.race || [...LOOK_SECTIONS, ...WARDROBE].some(([k]) => (draft.look[k] || 'none') !== (mine.look[k] || 'none'));
      $app.innerHTML = `
        <div class="customize">
          <section class="panel customize-preview">
            <div data-stage-slot></div>
            <div class="customize-mini" title="How your portrait looks on leaderboards and the feed">${window.MMOAvatar.svg(view(), { size: 64, head: true })}<span class="muted">Your portrait</span></div>
            <h2 style="margin:10px 0 2px">${esc(state.me.username)}</h2>
            <div class="muted">${race.icon} ${esc(race.name)}</div>
            <div class="customize-actions">
              <button class="btn" data-random>🎲 Random look</button>
              <button class="btn btn-primary" data-save ${changed ? '' : 'disabled'}>Save</button>
            </div>
            ${changed ? '<p class="muted" style="font-size:.85rem;margin:8px 0 0">Unsaved changes</p>' : ''}
          </section>
          <div>
            <section class="panel">
              <div class="panel-head"><h2>Race</h2><span class="muted" style="font-size:.85rem">${
                locked ? `🔒 You can change race again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : `You can change race once every ${data.raceChangeDays} days`
              }</span></div>
              ${data.perksOn ? '' : '<p class="muted">Race perks are switched off right now, so races are just for looks.</p>'}
              <div class="race-grid">
                ${data.races
                  .map(
                    (r) => `<button class="race-card${r.id === draft.race ? ' active' : ''}" data-race="${r.id}" ${locked && r.id !== mine.race ? 'disabled' : ''}>
                      <div class="race-name">${r.icon} ${esc(r.name)}${r.id === mine.race ? ' <span class="muted">(current)</span>' : ''}</div>
                      <div class="muted race-text">${esc(r.text)}</div>
                      <ul class="race-perks">${r.pros.map((x) => `<li class="pro">✅ ${esc(x)}</li>`).join('')}${r.cons.map((x) => `<li class="con">❌ ${esc(x)}</li>`).join('')}</ul>
                    </button>`
                  )
                  .join('')}
              </div>
            </section>
            <section class="panel">
              <h2 style="margin-top:0">Look</h2>
              <p class="muted" style="margin-top:-6px;font-size:.9rem">Change your look as often as you like.</p>
              ${LOOK_SECTIONS.map(
                ([key, label]) => `<div class="look-row"><div class="look-label">${label}</div><div class="look-options">${data.options[key]
                  .map((o) =>
                    o.color
                      ? `<button class="swatch${draft.look[key] === o.id ? ' active' : ''}${o.dye && !(mine.dyes || []).includes(o.id) ? ' dye-locked' : ''}" data-key="${key}" data-val="${o.id}" title="${esc(o.dye && !(mine.dyes || []).includes(o.id) ? `${o.label}: needs 3 ${o.dye} (a dye flower from Farming) the first time` : o.label)}" style="--sw:${o.color}"></button>`
                      : `<button class="tab${draft.look[key] === o.id ? ' active' : ''}" data-key="${key}" data-val="${o.id}">${esc(o.label)}</button>`
                  )
                  .join('')}</div></div>`
              ).join('')}
            </section>
            <section class="panel">
              <h2 style="margin-top:0">Wardrobe</h2>
              <p class="muted" style="margin-top:-6px;font-size:.9rem">Buy hats, capes and auras in the <a href="#/shop">shop</a>. Pets are rare finds from actions: each one gives +5% XP in its skill while it follows you. Your equipped gear shows on your character too.</p>
              ${WARDROBE.map(
                ([key, label]) => `<div class="look-row"><div class="look-label">${label}</div><div class="look-options">${
                  mine.wardrobe[key].length
                    ? [{ id: 'none', name: 'None', icon: '' }, ...mine.wardrobe[key]]
                        .map((o) => `<button class="tab${(draft.look[key] || 'none') === o.id ? ' active' : ''}" data-key="${key}" data-val="${o.id}" title="${esc(o.skill ? `+5% ${o.skill} XP` : o.name)}">${o.icon} ${esc(o.name)}</button>`)
                        .join('')
                    : `<span class="muted" style="font-size:.9rem">${key === 'pet' ? 'No pets yet. Keep playing!' : `None yet. <a href="#/shop">Shop</a>`}</span>`
                }</div></div>`
              ).join('')}
            </section>
          </div>
        </div>`;
      $app.querySelector('[data-stage-slot]')?.replaceWith(stageEl);
      const two = stageEl.querySelector('.char-stage-2d');
      if (two) two.innerHTML = window.MMOAvatar.svg(view(), { size: 220, title: `${state.me.username} the ${race.name}` });
      if (stage) stage.update(view());
      else if (mounting) mounting.then(() => stage?.update(view()));
      else mounting = mountStage(stageEl, view()).then((st) => (stage = st));
    };
    draw();

    $app.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled || 'stageToggle' in b.dataset) return;
      if (b.dataset.race) draft.race = b.dataset.race;
      else if (b.dataset.key) draft.look[b.dataset.key] = b.dataset.val;
      else if ('random' in b.dataset) {
        for (const [key] of LOOK_SECTIONS) {
          const opts = data.options[key].filter((o) => !o.dye || (mine.dyes || []).includes(o.id));
          draft.look[key] = opts[Math.floor(Math.random() * opts.length)].id;
        }
      } else if ('save' in b.dataset) {
        const switching = draft.race !== mine.race;
        if (switching && !confirm(`Become ${draft.race === 'elf' || draft.race === 'orc' || draft.race === 'undead' ? 'an' : 'a'} ${data.races.find((r) => r.id === draft.race).name}? You won't be able to change race again for ${data.raceChangeDays} days.`)) return;
        b.disabled = true;
        try {
          const r = await api('/me/appearance', { method: 'PUT', body: { race: draft.race, look: draft.look } });
          toast(r.message);
          $app.onclick = null;
          return route();
        } catch (err) {
          toast(err.message);
          b.disabled = false;
          return;
        }
      } else return;
      draw();
    };
    return () => ($app.onclick = null);
  };

  pages.guide = async (_, query) => {
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
      <details><summary class="btn btn-sm" style="margin-bottom:12px">Full crop list with numbers (${s.tiers.length} crops)</summary>
      <div class="table-wrap"><table>
        <thead><tr><th>Needs Farming</th><th>Crop</th><th class="num">Seed</th><th class="num">Ready in</th><th class="num">XP</th><th class="num">Sells for</th></tr></thead>
        <tbody>${s.tiers
          .map(
            (t) => `<tr><td><b>${t.level}</b></td><td>${t.icon} ${esc(t.item)}</td>
            <td class="num">${fmt(t.seedCost)} pts</td><td class="num">${t.grow} min</td><td class="num">${t.xp}</td><td class="num">${fmt(t.value)} pts</td></tr>`
          )
          .join('')}</tbody></table></div></details>`;
      }
      if (s.type === 'combat' && s.id !== g.skills.find((x) => x.type === 'combat').id) {
        const how = {
          magic: ['with a staff', '; each fight uses a Magic Rune and 1 mana'],
          archery: ['with a bow', '; each fight uses one arrow from your quiver'],
          axes: ['with a battleaxe', ''],
          daggers: ['with a dagger', ''],
          spears: ['with a spear', ''],
          brawling: ['bare-handed or with knuckles', ''],
          necromancy: ['with a scythe and your raised undead', '; each fight uses one Bone Shard'],
        }[s.id] || ['with its weapon', ''];
        return `<p class="muted">Same monsters as ${esc(g.skills.find((x) => x.type === 'combat').name)} (above). Fight them ${how[0]} using <code>${esc(s.command)}</code>${how[1]}.</p>`;
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
      const hasStats = s.tiers.some((t) => t.stats || t.heal);
      // Long lists (like Cooking's) start folded.
      const fold = s.tiers.length > 40;
      return `${fold ? `<details><summary class="btn btn-sm" style="margin-bottom:12px">Show all ${s.tiers.length}</summary>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th>Level</th><th>${isProcess ? 'Makes' : 'Resource'}</th>${isProcess ? '<th>Type</th><th>Needs (from your backpack)</th>' : ''}${hasStats ? '<th>Stats</th>' : ''}<th class="num">XP</th><th class="num">Sells for</th></tr></thead>
        <tbody>${s.tiers
          .map(
            (t) => `<tr><td><b>${t.level}</b></td><td>${t.icon} ${esc(t.item)}${t.race ? ` <span class="badge" style="font-size:.7rem">${esc(t.race)} only</span>` : ''}</td>
            ${t.kind ? `<td><span class="kind kind-${esc(t.kind)}">${esc(t.kind)}</span></td>` : ''}
            ${t.inputs ? `<td class="wrap">${t.inputs.map((i) => `${i.qty}× ${i.icon} ${esc(i.item)}`).join(' + ')}</td>` : ''}
            ${hasStats ? `<td class="wrap">${t.stats ? gearStat(t.stats) : t.heal ? `❤️ heals ${fmt(t.heal)}` : ''}</td>` : ''}
            <td class="num">${t.xp}</td><td class="num">${fmt(t.value)} pts</td></tr>`
          )
          .join('')}${rareRows(s, 0)}</tbody></table></div>${fold ? '</details>' : ''}`;
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
    // ---- Topics: short summary on the collapsed row, details inside ----
    const P = g.prefix;
    const c = (x) => `<code>${esc(P + x)}</code>`;
    const shopCost = (item) => fmt((g.shop.find((x) => x.item === item) || {}).cost || 0);
    const list = (items) => `<ul class="topic-list">${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
    const backpackTable = `
      <div class="table-wrap"><table>
        <thead><tr><th>Level</th><th>Backpack</th><th class="num">Slots</th><th class="num">Cost</th></tr></thead>
        <tbody>${g.backpack
          .map((b) => `<tr><td><b>${b.level}</b></td><td>${b.icon} ${esc(b.name)}</td><td class="num">${b.capacity}</td><td class="num">${b.cost ? `${fmt(b.cost)} pts` : 'free'}</td></tr>`)
          .join('')}</tbody></table></div>`;

    // What each skill is about, shown above its unlock table.
    const bigger = (what) => (g.gatherBonusLevels ?? 50) ? ` Every ${g.gatherBonusLevels ?? 50} levels you get one more ${what}.` : '';
    const SKILL_INTRO = {
      fishing: `${c('fish')} catches fish. Higher levels unlock better fish; aim for one with ${c('fish trout')}. Fish sell for points, or ${c('cook')} them into food.${bigger('fish per cast')} 🦀 Crab Pots train it for you: ${c('collect')}. <b>Every fish has its own length and weight</b> (most are average, a few are runts, about 1 in 40 is a trophy past the usual size), and the <a href="#/fishing">Fishing page</a> shows every catch in 3D at its real size next to a ruler, your personal best for each fish, and the record holders. You can fish there too, at five spots with their own fish: Harbor Pier, Silverrun River (Fishing 20), the Open Sea (40), the Abyssal Trench (100) and Serpent's Reach (400).`,
      mining: `${c('mine')} digs ore. Pick an ore with ${c('mine iron')}. ${c('smelt')} ores into ingots and alloys.${bigger('ore per swing')} ⚙️ Ore Drills train it for you: ${c('collect')}.`,
      woodcutting: `${c('chop')} cuts logs (${c('chop oak')} for a specific tree). Logs are used for fires, bows, arrows and staffs.${bigger('log per chop')} 🌳 Tree Saplings train it for you: ${c('collect')}.`,
      digging: `${c('dig')} unearths coins, relics and fossils. ${c('donate')} them to the museum for 3× their value.${bigger('find per dig')} 🏺 Dig Sites train it for you: ${c('collect')}.`,
      skinning: `Needs a 🔪 Skinning Knife in your backpack (shop, or smith one at Smithing 20). ${c('skin')} animals for hides and raw meat. ${c('craft')} hides into leather armor.`,
      farming: `<b>How farming works</b>
        <ol class="crop-steps">
          <li><b>Plots:</b> everyone gets 1 free 🟫 plot. Buy more in the <a href="#/shop">shop</a> (${shopCost('farm_plot')} pts for the first, each one a bit more, up to 100).</li>
          <li><b>Plant:</b> buy seeds, then ${c('plant carrot')}. One seed goes in each empty plot.</li>
          <li><b>Harvest:</b> after 20+ minutes, ${c('harvest')} collects one crop per plot. ${c('farm')} shows your plots.</li>
          <li><b>Use it:</b> every crop is an ingredient for another skill (see below). Crops sell for little, so use them or trade them.</li>
        </ol>
        <p class="muted" style="margin:0 0 8px">Planting and harvesting cost 1 stamina per ${g.plotsPerStamina ?? 25} plots. Each crop has better versions (tiers) that unlock at higher Farming levels.</p>
        <b>What each crop is for</b>
        <div class="crop-guide">${(g.plantLines || [])
          .map(
            (l) => `<div class="crop-card"><h4>${l.tiers[0].icon} ${esc(l.tiers[0].name)} <span class="badge">${esc(l.skill)}</span></h4>
              <p>${esc(l.text)}</p>
              ${l.tiers.length > 1 ? `<div class="crop-tier-pills">${l.tiers.map((t) => `<span>${esc(t.name)} · Farming ${t.level}</span>`).join('')}</div>` : `<div class="crop-tier-pills"><span>Farming ${l.tiers[0].level}</span></div>`}
            </div>`
          )
          .join('')}</div>`,
      firemaking: `Buy a 🪨 Flint and Steel (${shopCost('flint_and_steel')} pts, 250 fires), then ${c('lightfire')} burns your best log (or ${c('lightfire oak')}). Better logs give more XP, and every fire leaves 🌫️ Ashes. If it doesn't catch, nothing is used up. ${c('fire')} shows how long it burns.`,
      cooking: `While your fire burns (5 minutes, longer with better logs), ${c('cook')} your best raw food or name it: ${c('cook trout')}. <b>Cooking uses no stamina</b>, but each fire can cook only so many meals: ${g.fireMealsBase ?? 10}, plus 1 per ${g.fireMealsPerLevels ?? 2} Firemaking levels. ${c('cook all')} cooks as much as the fire allows; light another fire for more. Food sometimes burns (less as you level). ${c('eat')} cooked food to heal.`,
      smelting: `${c('smelt')} ores from your backpack into ingots (one ore) and alloys (mixed ores, e.g. copper + tin = bronze). Better furnaces can smelt two at once.`,
      smithing: `Needs a 🔨 Smithing Hammer in your backpack. ${c('smith bronze sword')} turns alloys into weapons and armor. ${c('equip')} them or ${c('sell')} them.`,
      fletching: `${c('fletch arrows')} makes 10 arrows from 1 Oak Logs + 1 🪶 Feathers + 1 Iron Ingot. Also bows (${c('fletch oak shortbow')}), staffs and a quiver.`,
      carpentry: `Refines raw materials for Construction. With a 🪚 Saw (${shopCost('saw')} pts, or ${c('smith saw')} from 2 Bronze Alloy), ${c('saw planks')} turns your best logs into planks (or name them: ${c('saw oak planks')}). Nails are made at the anvil: with a 🔨 Smithing Hammer in your backpack, ${c('craft nails')} hammers a smelted bar into nails (or name them: ${c('craft iron nails')}). Every log and bar has its own planks and nails, and both train Carpentry. ${c('planks')} and ${c('nails')} work as shortcuts.`,
      construction: `Needs a 🔨 Smithing Hammer. ${c('build')} combines planks and nails into building parts: ${c('build frame')}, ${c('build door')}, ${c('build wall')} and ${c('build roof')} make the best of that part you have materials for (or name one: ${c('build oak wall panel')}). Eleven tiers pair a wood with an alloy (Wooden planks + Bronze nails up to Celestial + Celestium). Parts are worth more than what went into them and are the materials for player-built structures, towns and shops.`,
      crafting: `${c('craft')} hides into leather armor (it adds to your attack when you ${c('shoot')}), bigger quivers, and Magic Runes (${c('craft runes')}: 1 Ashes + 1 Tin Ore makes 10).`,
      alchemy: `${c('brew')} potions from herbs you farm, e.g. 2 Mint make a Minor Health Potion and 2 Lavender a Minor Mana Potion. ☕ 2 Coffee Beans brew a Trail Brew (+1 stamina, once an hour; Coffee seeds come from gifting subs). Undead potions come from Ashes plus something dead (see <b>Undead potions</b> in the Combat tab).`,
      swords: `With a sword, ${c('fight')} monsters for Swords XP and loot. ${c('fight goblin')} picks a target; a plain ${c('fight')} picks your best safe match.`,
      archery: `With a bow, a 🧺 quiver and arrows, ${c('shoot')} monsters for Archery XP. Each fight uses one arrow; better arrows hit harder. ${c('quiver')} shows your arrows, ${c('buy arrows 50')} buys more.`,
      agility: `${c('run')} runs a lap of your best obstacle course (or name one: ${c('run rooftops')}). Laps give XP and points but no items, so they never fill your backpack. The reward is stamina: every level makes your stamina refill ${((g.agilityRefillPerLevel ?? 0.001) * 100).toFixed(1)}% faster, up to ${Math.round((g.agilityRefillMax ?? 0.5) * 100)}% faster at the top (half the wait). You sometimes slip (a little XP) and now and then find a shortcut that makes the lap free. ${c('stamina')} shows your refill speed.`,
      axes: `With a battleaxe, ${c('cleave')} monsters for Axes XP (or ${c('hack')}). Battleaxes hit harder than swords and 15% of swings land a second blow, but they take both hands: <b>your shield doesn't count</b>. ${c('buy battleaxe')} or ${c('smith bronze battleaxe')} (3 Bronze Alloy). Orcs get +15% Axes XP.`,
      daggers: `With a dagger, ${c('stab')} monsters for Daggers XP. Daggers are light, but a quarter of your hits are <b>critical hits for double damage</b> and you sometimes dodge. Every Daggers level also makes you a better thief: +0.1% stealth per level (up to +20%) on ${c('rob')}, ${c('pickpocket')}, ${c('burgle')}, ${c('poach')} and jailbreaks. Halflings get +15% Daggers XP.`,
      spears: `With a spear, ${c('thrust')} at monsters for Spears XP. A spear's reach means <b>monsters can't hit you in the first round</b>, and in PvP you always strike first. Spears are smithed from a bar plus two planks from Carpentry: ${c('smith bronze spear')} (1 Bronze Alloy + 2 Wooden Planks).`,
      brawling: `${c('punch')} monsters for Brawling XP, <b>bare-handed from day one</b>, no weapon needed. Knuckles (${c('buy knuckles')} or ${c('smith bronze knuckles')}) hit harder. One haymaker in five <b>stuns</b>: the monster loses its next swing (in PvP, the other player does). Dwarves get +15% Brawling XP.`,
      necromancy: `With a scythe, ${c('raise')} the dead to fight with you for Necromancy XP. Each fight uses one 🦴 Bone Shard (${c('buy bone shards 50')}, or ${c('craft bone shards')}: 1 Raw Chicken + 1 Ashes makes 10; Bone Dust, Cursed Skulls and Dragon Bones make more). Your undead <b>take a quarter of every hit</b> and add their own damage; stronger ones rise as you level (Skeleton, Zombie, Ghoul… up to the Avatar of Death). Scythes are two-handed. The Undead get +15% Necromancy XP.`,
      magic: `With a staff, ${c('cast')} spells for Magic XP. Each cast uses a Magic Rune and 1 mana. Stronger spells unlock as you level. ${c('heal')} also trains Magic.`,
    };
    const skillTopic = (s, tab) => ({
      id: s.id,
      tab,
      icon: s.icon,
      title: s.name,
      summary: `${s.command} · max level ${s.maxLevel}`,
      body: `<div class="skill-intro">${SKILL_INTRO[s.id] || `${c(s.command.replace(/^\W/, ''))} trains ${esc(s.name)}.`}</div>${tierTable(s)}${s.tool ? toolTable(s.tool, s) : ''}`,
    });

    const TABS = [
      ['basics', '🚀 Getting started'],
      ['skills', '🛠️ Skills'],
      ['combat', '⚔️ Combat'],
      ['rewards', '🏆 Rewards & social'],
      ['events', '🎉 Stream events'],
      ['commands', '💬 All commands'],
    ];
    const topics = [
      {
        id: 'first-steps', tab: 'basics', icon: '👋', title: 'Your first commands', summary: 'Type a skill command in chat and you are playing',
        body: list([
          `Type a skill command in chat, like ${c('fish')}, ${c('mine')} or ${c('chop')}. Your character is created automatically.`,
          'Each action gives XP, points and an item. Higher levels unlock better resources.',
          `Target something directly: ${c('mine iron')}, ${c('chop oak')}.`,
          `${c('stats')} shows your levels, ${c('inv')} your backpack, ${c('commands')} the command list.`,
          'Log in on this site with Kick to see your character, shop, and customize your look.',
          'Rather click than type? The <a href="#/train">🏋️ Train page</a> has a button for every skill (log in with Kick): same XP, loot and stamina as the chat commands.',
        ]),
      },
      {
        id: 'stamina', tab: 'basics', icon: '⚡', title: 'Stamina', summary: `${g.staminaMax} charges, refilled every ${g.staminaMinutes} minutes`,
        body: list([
          `You have <b>${g.staminaMax} stamina charges</b>. Every action (skilling, fighting, farming, raid attacks) uses one.`,
          `The bar fills back up to full <b>${g.staminaMinutes} minutes</b> after you use the first charge.`,
          `<b>Cooking on a lit fire is free</b>, and info commands like ${c('stats')} never cost stamina.`,
          `${c('stamina')} shows your bar. A 🏠 house (${c('house')}, end game) adds charges to the bar, training 🏃 Agility (${c('run')}) makes it refill faster, Halflings refill 10% faster, and the Wraith Tonic potion refills it twice as fast.`,
        ]),
      },
      {
        id: 'races', tab: 'basics', icon: '🧬', title: 'Races & your look', summary: 'Pick a race with perks and drawbacks, customize your character',
        body: `<p>Everyone starts as a random race with a random look. <a href="#/customize">Customize</a> your skin, face, hair, facial hair and outfit any time, and pick a race once every ${g.raceChangeDays} days. ${c('race')} shows yours in chat.${g.racePerks ? '' : ' <b>Race perks are switched off right now.</b>'}</p>
          <div class="race-mini">${g.races
            .map((r) => `<div><b>${r.icon} ${esc(r.name)}</b>${list([...r.pros.map((x) => `✅ ${esc(x)}`), ...r.cons.map((x) => `<span class="muted">❌ ${esc(x)}</span>`)])}</div>`)
            .join('')}</div>
          <p style="margin-bottom:0"><b>Race-only items</b> only that race can make: ${g.raceItems.map((r) => `${r.icon} ${esc(r.name)} (${esc(r.race)}, ${esc(r.skill)} ${r.level})`).join(' · ')}.</p>`,
      },
      {
        id: 'points', tab: 'basics', icon: '💰', title: 'Points & selling', summary: 'Earn points by chatting, playing and selling loot',
        body: list([
          `Chatting earns <b>${g.chatPoints} points</b> (once every ${g.chatCooldown}s)${g.chatPointsFullPerDay ? `, half that after ${g.chatPointsFullPerDay} times a day` : ''}. Every action earns a few more.`,
          `${c('sell all')} (or ${c('sellall')}) sells your loot. It keeps gear, tools, seeds, potions, food (for fights) and crops (they feed other skills). Sell those by name (${c('sell cooked trout 5')}) or by group: ${c('sell all food')}, ${c('sell all crops')}.`,
          `Spend points in the <a href="#/shop">shop</a> (or ${c('buy')} in chat) on tools, seeds, potions and more, or gamble them in the <a href="#/casino">casino</a>.`,
        ]),
      },
      {
        id: 'backpack', tab: 'basics', icon: '🎒', title: 'Backpack', summary: `${g.backpack[0].capacity} slots to start, up to ${g.backpack[g.backpack.length - 1].capacity}`,
        body: `<p>When your backpack is full, ${c('sell')}, ${c('smelt')} or ${c('upgrade backpack')}. Seeds don't take space.</p>${backpackTable}`,
      },
      {
        id: 'tools', tab: 'basics', icon: '🔧', title: 'Tools & leveling', summary: 'Skills go to level 500; better tools every 50 levels',
        body: list([
          'Every skill goes to <b>level 500</b>. Your <b>character level</b> grows with the combined XP of all your skills.',
          `Every 50 levels you can buy a better tool: ${c('upgrade rod')}, ${c('upgrade pickaxe')}, ${c('upgrade axe')}, ${c('upgrade shovel')}, ${c('upgrade furnace')}. Better tools fail less and give bonus XP and better rare odds.`,
          `${c('gear')} shows all your tools. Each skill's tool table is in the <b>Skills</b> tab.`,
        ]),
      },
      ...g.skills.filter((s) => s.type !== 'combat').map((s) => skillTopic(s, 'skills')),
      {
        id: 'fighting', tab: 'combat', icon: '🗡️', title: 'How fighting works', summary: 'Pick monsters your size; fights cost HP',
        body: list([
          `${c('fight')} uses whichever combat skill you're best at with your best weapon. Eight fighting styles: Swords (${c('fight')}), Archery (${c('shoot')}), Magic (${c('cast')}), Axes (${c('cleave')}), Daggers (${c('stab')}), Spears (${c('thrust')}), Brawling (${c('punch')}, no weapon needed) and Necromancy (${c('raise')}). Each style's own command always uses that style.`,
          `Every style fights its own way: axes sometimes hit twice but leave no hand for a shield, daggers land critical hits, spears keep monsters at bay, punches stun, and the undead you raise soak up hits. They're balanced to cost about the same HP at your level; your Combat level is your best one.`,
          `${c('targets')} lists the best monsters for your level, gear and HP. ${c('monsters')} rates them: ⚪ too easy · 🟢 good match · 🟠 tough · 🔴 hard · ☠️ deadly.`,
          `${c('scout troll')} shows how a fight would go without fighting. You're warned before a fight that would likely knock you out.`,
          `${c('equip')} gear for attack and defence. ${c('equipped')} shows it, ${c('unequip helmet')} takes it off.`,
        ]),
      },
      {
        id: 'health', tab: 'combat', icon: '❤️', title: 'Health, mana & knockouts', summary: 'At 0 HP you are knocked out until you heal',
        body: list([
          `Fights cost ❤️ HP (better weapons and armor mean less). ${c('hp')} shows your health and mana.`,
          `At 0 HP you're knocked out until you're back at full HP, or ${c('drink')} a health potion to get up now.`,
          `${c('eat')} cooked food to heal: one meal heals at most ${Math.round((g.foodHealCap ?? 0.3) * 100)}% of your max HP, however good the food.`,
          `${c('heal')} spends ${Math.round((g.healManaCost ?? 0.3) * 100)}% of your 🔷 mana to restore ${Math.round((g.healBase ?? 0.3) * 100)}% of your HP, plus 0.1% per Magic level (up to +30%). Mana refills in ${g.manaRegenHours ?? 1}h, so mages heal best.`,
          'At your level with matching gear a fight costs about 10% of your HP; 1.5× your level about 40%; twice your level usually knocks you out.',
        ]),
      },
      {
        id: 'dungeons', tab: 'combat', icon: '🏰', title: 'Dungeons', summary: 'Parties of 2-5 fight through rooms to a boss',
        body: list([
          `${c('dungeon')} gathers a party (anyone can type ${c('dungeon')} to join within a minute, up to 5). It costs a stamina charge and you need a weapon.`,
          'The party fights three rooms and a boss picked for its level. Bigger, stronger parties do better. Every room cleared gives XP and loot.',
          'Beat the boss for points and a dungeon-only treasure: 🔷 Rune Shards, 🗝️ Dungeon Relics, 💠 Shadow Gems, and rarely a 🦇 Delver\'s Cape. A failed run costs some HP.',
        ]),
      },
      {
        id: 'sets-enchanting', tab: 'combat', icon: '✨', title: 'Armor sets & enchanting', summary: 'Matching armor and +1 to +5 gear',
        body: list([
          'Wearing a helmet, body and legs of the same material (e.g. all Mithril, or all Bear leather) gives a set bonus: +10% defence and +5% attack.',
          `${c('enchant mithril sword')} adds +4% attack or defence per level, up to +5. It costs 🌫️ Ashes and points (and a 💠 Shadow Gem for +4 and +5), and can fail: 90% for +1 down to 30% for +5.`,
        ]),
      },
      {
        id: 'potions', tab: 'combat', icon: '🧪', title: 'Buff potions', summary: 'Timed buffs brewed from Ashes and monster drops',
        body: `<p>${c('brew')} Ashes with something dead or a monster drop, then ${c('drink')} it. ${c('buffs')} shows what's active.</p>${list(
          (g.buffs || []).map((b) => `${b.icon} <b>${esc(b.potion)}</b>: ${esc(b.text)} (${b.minutes} min)`)
        )}`,
      },
      {
        id: 'drops', tab: 'combat', icon: '🦴', title: 'Monster drops', summary: 'Every drop is good for something besides selling',
        body: `<p>${c('item cheese')} shows where any item comes from and what it's for.</p>${list([
          `🍳 <b>Cooking</b>: monster dishes like the Cheesy Potato Bake (Giant Rat cheese + a potato) heal and make you 🍲 <b>Well Fed</b> (+5% XP for 15 min).`,
          `⚗️ <b>Alchemy</b>: Goblin Grog, Stoneskin Tonic (+25% defence), Venom Coating (+20% attack), Regeneration Draught and more, brewed from ears, teeth, venom and blood.`,
          `🪶 <b>Fletching</b>: fangs, tusks, claws and dragon bones make stronger arrows.`,
          `🧵 <b>Crafting</b>: pelts, hides, silk and scales become capes to wear; minotaur and demon horns become helms.`,
          `👛 <b>Loot to open</b>: goblin pouches, stolen goods, ogre belts and labyrinth keys. ${c('open')} them for points and random items.`,
          `🏆 <b>Museum</b>: rare drops fill the Trophy Hall and Legendary Relics collections (${c('donate')}).`,
          `🦴 The <b>Monster Scavenger</b> quest walks you through all of it.`,
        ])}`,
      },
      ...g.skills.filter((s) => s.type === 'combat').map((s) => skillTopic(s, 'combat')),
      {
        id: 'quests', tab: 'rewards', icon: '📜', title: 'Quests', summary: `${g.quests.length} short storylines with points and titles`,
        body: `<p>Pick any quests you like, up to 3 at once: they all count what you already do, and a quest's objectives can be done in any order (they all fill up at the same time). ${c('quest start relic hunter')} starts one, ${c('quest pause relic hunter')} pauses it (progress is kept), ${c('quest')} shows your active ones and ${c('quests')} lists them all. Or use the buttons on your character page. Some quests continue a story and unlock once you finish the one before (🔒).</p>${list(
          g.quests.map((q) => `${q.icon} <b>${esc(q.name)}</b>${q.after?.length ? ` <span class="muted">🔒 after ${q.after.map(esc).join(' + ')}</span>` : ''}: ${q.steps.map(esc).join(' · ')}. <span class="muted">Reward ${fmt(q.reward)} pts${(q.items || []).map((i) => ` + ${esc(i)}`).join('')} + “${esc(q.title)}”</span>`)
        )}`,
      },
      {
        id: 'pets', tab: 'rewards', icon: '🐾', title: 'Pets', summary: 'Rare finds that follow you and boost a skill',
        body: `<p>Every action has a tiny chance (about 1 in 2,500) to find that skill's pet. Your active pet shows next to your character and gives <b>+5% XP</b> in its skill. ${c('pet')} lists yours, ${c('pet owl')} switches, or pick one on the <a href="#/customize">Customize</a> page.</p>
          <p class="pet-list">${g.pets.map((p) => `<span class="badge" title="${esc(p.skill)}">${p.icon} ${esc(p.name)} <span class="muted">${esc(p.skill)}</span></span>`).join(' ')}</p>`,
      },
      {
        id: 'prestige', tab: 'rewards', icon: '⭐', title: 'Prestige', summary: `Reset a level ${g.prestigeLevel} skill for a star and +5% XP`,
        body: list([
          `At level ${g.prestigeLevel} in a skill, ${c('prestige mining')} resets it to level 1 for a permanent ⭐ on your character and <b>+5% XP</b> in that skill (up to 10 times, so +50%).`,
          "You keep your items, tools and gear. It asks you to confirm first.",
        ]),
      },
      {
        id: 'cosmetics', tab: 'rewards', icon: '🎩', title: 'Cosmetics & gear looks', summary: 'Hats, capes and auras; your gear shows too',
        body: list([
          'Buy hats, capes and auras in the <a href="#/shop">shop</a> and wear them on the <a href="#/customize">Customize</a> page. They are looks only and take no backpack space.',
          'Each week the shop has one limited cosmetic (pumpkin head, antlers, samurai helm...) that disappears when the week ends.',
          'The helmet, armor, shield and weapon you have equipped are drawn on your character, in the color of their metal.',
          'Your character shows on your page, the leaderboards, the live feed and the stream overlay.',
        ]),
      },
      {
        id: 'stream-rewards', tab: 'events', icon: '📣', title: 'Stream rewards & community projects', summary: 'Spend points on things the whole stream sees',
        body: list([
          `On the <a href="#/stream">Stream Rewards</a> page (or ${c('redeem fireworks')} in chat), spend points on redemptions everyone sees on stream: fireworks with your name, a fanfare, your character in the spotlight, a treasure goblin, 10 minutes of double XP for everyone, or a raid boss. Each has a cooldown for the whole channel, and they only work while the stream is live.`,
          `<b>Community projects</b>: chat pools points toward a shared goal with ${c('fund 500')} (${c('project')} shows progress). Projects take turns: raise a Monument (the top donor's character goes in the Hall of Monuments forever), a Double XP Hour, a Festival of Fortune (double rare finds for an hour) and awakening the World Boss.`,
          'When a project is finished, the top donor earns the title <b>the Grand Patron</b> and everyone who gave 10% or more earns <b>the Patron</b>.',
        ]),
      },
      {
        id: 'relics', tab: 'rewards', icon: '🧰', title: 'Relic cases', summary: 'Unbox legendary weapons, trade up, SoulTrak™',
        body: list([
          `On the <a href="#/relics">Relic Cases</a> page, spend points to open cases. A reel spins and lands on a relic: a blade, axe, staff, bow, scythe or shield with its own skin. Rarities: Adept (79.9%), Heroic (16%), Mythic (3.2%), Exalted (0.64%) and ★ Legendary Relics (0.26%).`,
          'Every relic has a <b>float</b> from 0 to 1 that sets its exterior (Forge Fresh, Minimal Wear, Field-Tested, Well-Worn, Battle-Scarred). Lower is worth more.',
          'The <b>pattern seed</b> changes how it looks: fades roll 80-100%, Gem relics come in phases (Ruby, Sapphire, Black Pearl and Emerald are the rarest), and 1 in 100 marbles, crystals and rune patterns is a rare pattern.',
          `1 in 10 relics is <b>SoulTrak™</b>: showcase it and it counts every monster you defeat with ${c('fight')}.`,
          '<b>Trade-up contracts</b> turn 10 relics of one rarity into 1 of the next (5 Exalted become a ★ relic). The new float is the average of your inputs.',
          `Sell relics back to the bank (up to a daily limit; very valuable relics are bought at a lower rate), list them on the relic market, or trade them with other players. Values follow what players actually pay on the market. ${c('relics')} in chat shows your inventory.`,
        ]),
      },
      {
        id: 'cards', tab: 'rewards', icon: '🃏', title: 'Creature cards', summary: 'Open packs, grade your pulls, trade with players',
        body: list([
          `On the <a href="#/cards">Cards</a> page, spend points on packs of fantasy creature cards: Scout packs (3 cards), Boosters (5), Elite packs and the Mythic Vault. Three sets, six rarities from Common to Mythic, and any card can come out Holo (3× value) or Gold Foil (10×).`,
          'Every card has its own <b>wear</b> from 0 (flawless) to 1 (wrecked). Lower is better: it sets the condition (Pristine, Mint, Near Mint, Excellent...) and what the card is worth.',
          '<b>Grading</b> costs a fee and seals the card in a slab with a grade from 1 to 10 plus four subgrades. A GEM MINT 10 is worth 4× a raw card; four perfect subgrades make a PRISTINE 10 black label (10×). Clean cards usually grade well, but the grade is final.',
          'Sell cards back to the bank for part of their value (up to a daily limit; very valuable cards are bought at a lower rate), list them on the card market, or send trade offers (cards and points both ways) to other players. Values follow what players actually pay on the market.',
          `Collect every card in a set for a points reward and a title. ${c('cards')} in chat shows your collection.`,
        ]),
      },
      {
        id: 'market', tab: 'rewards', icon: '🏪', title: 'Player market', summary: 'Buy and sell items with other players',
        body: list([
          'On the <a href="#/market">Market</a> page, list items for a price. They leave your backpack until someone buys them or you cancel.',
          `The market keeps ${Math.round(g.marketFee * 100)}% of each sale. There's a maximum price per item, and pets can't be sold.`,
          'You get a 🔔 notification on the site when something sells.',
        ]),
      },
      {
        id: 'daily', tab: 'rewards', icon: '📅', title: 'Daily reward & tasks', summary: 'Free points every day, more for streaks',
        body: list([`${c('daily')} gives points, more each day in a row (up to 7 days).`, `${c('tasks')} shows 3 daily tasks that pay when you finish them.`]),
      },
      {
        id: 'titles', tab: 'rewards', icon: '🏅', title: 'Achievements & titles', summary: 'Unlock titles to show off',
        body: list([`Achievements unlock titles. ${c('achievements')} lists them, ${c('title')} picks the one you show.`]),
      },
      {
        id: 'seasons', tab: 'rewards', icon: '🗓️', title: 'Seasons', summary: g.seasonDays ? `Every ${g.seasonDays} days; the top 3 win a title and a cosmetic` : 'Top 3 each season win a title and a cosmetic',
        body: list([
          `The Season leaderboard counts XP earned this season. ${c('season')} shows the leaders, your rank${g.seasonDays ? ' and when it ends' : ''}.`,
          `${g.seasonDays ? `A season lasts ${g.seasonDays} days. ` : ''}The top 3 win a permanent title and a season-only cosmetic that can't be bought or traded: 🥇 Champion's Crown and Victor Aura, 🥈 Silver Laurel, 🥉 Bronze Laurel.`,
          'Past winners are on the <a href="#/hall">Hall of fame</a>.',
        ]),
      },
      {
        id: 'streaks', tab: 'rewards', icon: '🔥', title: 'Stream streaks', summary: 'Come back stream after stream for bonus points',
        body: list(['Chatting in streams in a row builds your streak (shown on your character page).', 'At 5, 10 and 25 in a row you get 500, 1,500 and 5,000 pts.']),
      },
      {
        id: 'guilds', tab: 'rewards', icon: '🛡️', title: 'Guilds', summary: 'Team up with a shared bank and weekly goal',
        body: list([
          `${c('guild create Iron Wolves')} starts a guild (${fmt(g.guildCost)} pts), ${c('guild join iron wolves')} joins one, or use the <a href="#/guilds">Guilds</a> page.`,
          `Every member's actions count toward a weekly goal (100 per member). Reach it and the guild bank gets 5,000 pts + 500 per member.`,
          `${c('guild deposit 500')} adds to the bank; the leader can ${c('guild pay @name 500')} members from it. Guilds have their own leaderboard.`,
        ]),
      },
      {
        id: 'bounties', tab: 'rewards', icon: '🎯', title: 'Bounties', summary: 'Put up points for a rare find',
        body: list([
          `${c('bounty goblin crown 5000')} offers points to the first player (not you) who gets that item from an action.`,
          `Your points are held until then, or refunded after 7 days or with ${c('bounty cancel')}. ${c('bounties')} lists them; they're also on the <a href="#/market">Market</a> page and the overlay.`,
        ]),
      },
      {
        id: 'hall', tab: 'rewards', icon: '🏛️', title: 'Hall of fame', summary: 'Season champions, first to 500, biggest wins',
        body: list(['The <a href="#/hall">Hall of fame</a> remembers season winners, the first player to reach level 500 in each skill, the first to find each pet, and the biggest casino wins.', `${c('hall')} shows the highlights in chat.`]),
      },
      {
        id: 'museum', tab: 'rewards', icon: '🏛️', title: 'Museum', summary: 'Donate digging finds for 3× value and titles',
        body: list([`${c('donate')} your digging finds. Each pays 3× its value.`, `Finishing a collection (coins, relics, fossils, royal treasures...) pays a big reward and a title. ${c('museum')} shows your progress.`]),
      },
      {
        id: 'trading', tab: 'rewards', icon: '🤝', title: 'Trading & duels', summary: 'Give items or points, duel for bets',
        body: list([
          `${c('give @name iron ore 5')} or ${c('give @name 500')} (once you've played a little; point gifts have a daily limit).`,
          `${c('duel @name 500')} challenges someone; they ${c('accept')} or ${c('decline')}. The winner takes the bet. Duels don't hurt your real HP.`,
        ]),
      },
      {
        id: 'pvp', tab: 'rewards', icon: '⚔️', title: 'PvP: heists, crime, arena, guild wars', summary: 'Rob the rich, pick pockets, collect bounties, climb the ladder',
        body: list([
          `<b>Heists:</b> ${c('rob @name')} (1 stamina) tries to rob a player richer than you. First a 🥷 stealth check, your 🏃 Agility against theirs: pass it and you take a small share of their points. Fail and you ⚔️ fight them (combat level, weapon skill and gear on both sides, you on your current HP): win and you grab half as much, lose and you're left on 1 HP, fined (half to them) and lying low for a while. The fence keeps a cut of every haul. ${c('hire 2')} hires guards for 24h (priced by how much you hold) that cut robbers' odds.`,
          `<b>🦹 Crime:</b> ${c('pickpocket @name')} lifts 1-3 of a random ordinary item from their backpack (never gear, tools or pets). ${c('poach @name')} steals up to 3 ripe crops from their farm (a 🎃 Scarecrow, ${c('build scarecrow')}, makes it harder). ${c('burgle @name')} takes up to 3 of something off their shop shelf (bigger shops have better locks). Same rules as heists: 1 stamina, Agility for stealth, guards help the victim, and getting caught means a fine (half to them) and jail. Players under character level 10 are off limits.`,
          `<b>🎯 Wanted:</b> ${c('wanted @name 1000')} puts points on the head of anyone who committed a crime this week. Whoever beats them in a heist fight, the arena or the Gloamveil, or catches them in the act, collects 90%. ${c('wanted')} shows the board.`,
          `<b>🚔 Jail:</b> ${c('bail')} pays your way out (2% of your points). ${c('jailbreak @name')} busts a friend out (Agility helps, guildmates +10%); fail and you're in the next cell. ${c('jail')} shows who's inside.`,
          `<b>🐀 Tip-offs:</b> ${c('tipoff @name')} (100 pts): if they try any crime in the next 10 minutes, the guards are waiting, and you get a quarter of their fine (and any bounty on them). There's a 30% chance your name gets out. Tip off from the PvP page to stay anonymous.`,
          `<b>🛡️ Protection rackets:</b> guild leaders sell protection (${c('racket price 2000')}); players buy it for 24h with ${c('racket buy TAG')}, paid into the guild bank. Anyone who comes for a client has to beat the guild's strongest member first.`,
          `<b>Ranked arena:</b> ${c('arena')} fights the player closest to your rating with both of your best gear (they don't need to be online). A small entry fee goes into the weekly pot; on Monday the top 3 split it and #1 is the Arena Champion. ${c('arena top')} shows the ladder.`,
          `<b>Guild wars:</b> guilds score war points each week when members beat other guilds' members (arena win 3, heist 2, duel 1). The winning guild gets bonus XP all next week. ${c('war')} shows the standings.`,
          'Everything is on the <a href="#/pvp">PvP</a> page.',
        ]),
      },
      {
        id: 'town', tab: 'rewards', icon: '🏘️', title: 'Town & building', summary: 'Build the town, your house and your shop from Construction parts',
        body: list([
          `Make building parts with Carpentry and Construction (${c('saw planks')}, ${c('craft nails')}, then ${c('build frame')} / ${c('build door')} / ${c('build wall')} / ${c('build roof')}). Parts are used for three things:`,
          `<b>The town:</b> ${c('contribute 5 walls')} gives parts to the town building being worked on (or name one: ${c('contribute forge all frames')}). Seven buildings (Sawmill, Great Forge, Harbor, Granary, Tannery, Barracks, Builders' Hall) go up to level 5; <b>every level gives everyone +2% XP</b> in that building's skills. ${c('town')} shows them. Give 25,000+ pts of parts for the title <b>the Builder</b>; the biggest builder is <b>the Town Founder</b>.`,
          `<b>Your house:</b> instead of paying points, ${c('house build')} builds your next house from parts (a Cottage takes 10 Frames, 8 Wall Panels, 2 Doors and 4 Roof Trusses at Construction 10). Better houses need better wood. Same character level as buying.`,
          `<b>Your shop:</b> ${c('stall build')} builds a Market Stall, then a Shop and an Emporium: more market listings at once, 1-3% off the market fee on your sales, and your own storefront page. ${c('stall alice')} shows someone's shop.`,
          'Parts of the needed tier or better count, and the cheapest ones are used first. Everything is on the <a href="#/town">Town</a> page.',
        ]),
      },
      {
        id: 'veil', tab: 'rewards', icon: '🌫️', title: 'The Gloamveil (extraction)', summary: 'Loot the fog and get out alive, or lose it all',
        body: list([
          `${c('veil 1')} walks you into the Mistfen Hollows (1 stamina and a fee; deeper zones need a higher Combat level). You fight with <b>what you're wearing</b>, and bring up to 4 food or health potions (${c('veil 1 light')} brings none).`,
          `Inside: ${c('search')} loots the room (and makes noise, which draws monsters), ${c('deeper')} moves to the next room (rarer loot, harder monsters), ${c('mend')} eats a supply. Only ${c('extract')} at a 🔮 Waystone (rooms 3 and 6, or one you uncover) makes the loot yours.`,
          `Other players are in there too. When you spot one: ${c('ambush')} to attack (they may slip away; Agility helps) or ${c('hide')}. The winner takes the loser's bag and a piece of their gear, and still has to get it out.`,
          '<b>Death is final</b>: a monster, a player or the fog closing (15 minutes) takes your worn weapon and armor, your supplies and your bag, and knocks you out. You can\'t change gear, !eat or !drink from your backpack while inside.',
          'Play it on the <a href="#/veil">Gloamveil</a> page: a map of the rooms, the timer, your bag, and who got out (or didn\'t) this week.',
        ]),
      },
      {
        id: 'raids', tab: 'events', icon: '🐉', title: 'Raid bosses', summary: 'Everyone fights a giant boss together',
        body: list([`When a ⚔️ raid boss appears, type ${c('attack')} to hit it (each attack uses stamina). ${c('raid')} shows its HP.`, 'Beat it in time and the reward pool is split by damage. The top hitter is MVP and gets extra loot.']),
      },
      {
        id: 'world-boss', tab: 'events', icon: '🌍', title: 'World boss', summary: 'A huge boss the whole community fights for days',
        body: list([`Sometimes a world boss appears and stays for days. Its HP carries over between streams, so every ${c('attack')} counts.`, 'Beat it before it escapes for a reward pool 10× a normal raid. Normal raids can still happen while it is up.']),
      },
      {
        id: 'goals', tab: 'events', icon: '🎯', title: 'Channel goals', summary: 'Chat works together for an XP boost',
        body: list([`The streamer can set a goal like “500 mining actions”. Every matching action by anyone counts. ${c('goal')} shows the progress, and it's on the stream overlay.`, 'Reach it and everyone gets an XP boost.']),
      },
      {
        id: 'random-events', tab: 'events', icon: '👺', title: 'Treasure goblins & supply drops', summary: 'Be the first to type the command',
        body: list([`A 👺 treasure goblin (${c('catch')}) or 📦 supply drop (${c('grab')}) sometimes pops up in chat. Be quick!`]),
      },
      {
        id: 'boosts', tab: 'events', icon: '🚀', title: 'Follows, subs, KICKs & XP boosts', summary: 'Supporting the channel pays off for everyone',
        body: list([
          'Following or subscribing earns points.',
          `Gifted subs start ⚡ double XP for everyone. ${c('boost')} shows if one is running.`,
          `💎 <b>KICKs</b> (Kick's tipping currency): every KICK pays the sender points, 100+ KICKs make it rain points on recent chatters, 500+ start double XP for everyone, and 2,500+ wake the world boss. ${c('kicks')} shows the top supporters (also on the <a href="#/stream">Stream</a> page); lifetime totals earn titles at 100, 1,000 and 10,000.`,
          g.xpMultiplier !== 1 ? `<b>🔥 A ${g.xpMultiplier}× XP event is on right now!</b>` : 'The streamer can also run XP events.',
        ]),
      },
    ];

    // ---- Command reference, grouped ----
    const COMMANDS = [
      ['Skills', g.skills.map((s) => [s.command.replace(/^\W/, ''), `${s.icon} Train ${s.name}`])],
      ['Tools & gear', [
        ['gear', 'All your tools and backpack'],
        ['upgrade <tool>', 'Better tool (every 50 levels): rod, pickaxe, axe, shovel, furnace'],
        ['upgrade backpack', 'More backpack slots'],
        ['equip <item>', 'Wear gear (unequip, equipped)'],
      ]],
      ['Farming, fire & food', [
        ['plant [crop]', 'Plant seeds in empty plots'],
        ['harvest', 'Collect grown crops'],
        ['farm', 'Your plots'],
        ['collect', 'Turn your gathering stations\' work into XP (1 stamina, no items or points)'],
        ['stations', 'Your crab pots, ore drills, saplings and dig sites'],
        ['lightfire [log]', 'Light a fire (needs flint and steel)'],
        ['cook [food]', 'Cook on your fire, no stamina needed'],
        ['cook all', 'Cook everything while the fire lasts'],
        ['fire', 'How long your fire burns'],
        ['eat [food]', 'Eat cooked food to heal'],
      ]],
      ['Combat', [
        ['fight [monster]', 'Fight with your best combat skill'],
        ['dungeon', 'Start or join a dungeon party'],
        ['enchant <item>', 'Enchant gear (+1 to +5)'],
        ['shoot [monster]', 'Fight with a bow (1 arrow)'],
        ['cast [monster]', 'Fight with magic (staff + rune)'],
        ['cleave [monster]', 'Fight with a battleaxe (Axes)'],
        ['stab [monster]', 'Fight with a dagger (Daggers)'],
        ['thrust [monster]', 'Fight with a spear (Spears)'],
        ['punch [monster]', 'Fight bare-handed or with knuckles (Brawling)'],
        ['raise [monster]', 'Fight with a scythe + undead (1 Bone Shard)'],
        ['targets', 'Best monsters for you right now'],
        ['monsters', 'Monster ratings for you'],
        ['scout <monster>', 'How a fight would go'],
        ['hp', 'Health and mana'],
        ['drink [potion]', 'Drink a potion'],
        ['heal', 'Spend 30% mana to restore 30%+ HP (more with Magic)'],
        ['buffs', 'Active potion effects'],
        ['quiver', 'Your arrows'],
      ]],
      ['Points & items', [
        ['sell all', 'Sell your loot; keeps gear, potions, food and crops (also !sellall)'],
        ['sell all food', 'Sell all your cooked food (or !sell all crops)'],
        ['sell trout 5', 'Sell a specific item'],
        ['price <item>', 'What an item sells for right now (e.g. !price carrot)'],
        ['buy <item>', 'Buy from the shop (shop lists items)'],
        ['buy arrows 50', 'Buy arrows'],
        ['inv', 'Your backpack'],
        ['item <name>', 'Where an item comes from and what it is for'],
        ['open [item]', 'Open goblin pouches, stolen goods and other monster loot'],
        ['open all [item]', 'Open every container you have (or every one of a kind)'],
        ['points', 'Your points'],
        ['give @name <item|points>', 'Give to another player'],
        ['market', 'Player market link'],
        ['cards', 'Your trading cards (packs, grading and trades on the website)'],
        ['relics', 'Your relics and showcased SoulTrak™ (cases on the website)'],
        ['redeem [name]', 'Spend points on a stream effect (fireworks, spotlight, double XP...)'],
        ['fund <amount>', 'Give points to the community project (project shows it)'],
        ['bounty <item> <points>', 'Post a bounty (bounty cancel)'],
        ['bounties', 'Open bounties'],
        ['guild', 'Your guild (guild create / join / leave / deposit / top)'],
      ]],
      ['You & rankings', [
        ['stats [name]', 'Levels and points'],
        ['stamina', 'Your stamina bar'],
        ['race [race]', 'Your race and its perks'],
        ['quest', 'Your active quests (quest start / pause <name>)'],
        ['quests', 'All quests and which are done'],
        ['pet [name]', 'Your pets, or switch the active one'],
        ['prestige <skill>', 'Reset a high skill for a star and +5% XP'],
        ['top [skill]', 'Top 5 players'],
        ['daily', 'Daily reward'],
        ['tasks', "Today's tasks"],
        ['title [name]', 'Show a title (achievements lists them)'],
        ['season', "This season's leaders and when it ends"],
        ['hall', 'Hall of fame highlights'],
        ['museum', 'Museum progress (donate <item>)'],
      ]],
      ['Events', [
        ['attack', 'Hit the raid boss (raid shows it)'],
        ['catch / grab', 'Claim a random event'],
        ['duel @name [bet]', 'Challenge a player (accept / decline)'],
        ['house [buy]', 'Your house; buy the next one for more stamina'],
        ['rob @name', 'Heist a richer player'],
        ['hire [1-3]', 'Hire guards for 24h so robbers fail more'],
        ['arena', 'Ranked fight (arena top for the ladder)'],
        ['veil 1', 'Enter the Gloamveil: then search, deeper, extract, ambush, hide'],
        ['town', 'The town buildings and their XP bonuses'],
        ['contribute 5 walls', 'Give building parts to the town (or: contribute forge all frames)'],
        ['house build', 'Build your next house from parts'],
        ['stall build', 'Build or upgrade your shop (stall name shows someone\'s)'],
        ['war', 'Guild war standings'],
        ['boost', 'Is an XP boost running?'],
        ['goal', 'Channel goal progress'],
      ]],
      ['Casino', [
        ['slots 500', '🎰 Slots (all, half, 1k also work)'],
        ['roulette red 500', '🎡 Colors, odd/even, halves, dozens or a number'],
        ['plinko 500 high', '🔻 Plinko: low, medium, high or extreme (1000x) risk'],
        ['plinko 100 extreme 50', '🔻 Drop 50 balls of 100 at once'],
        ['bj 500', '🃏 Blackjack: hit, stand, double, split'],
        ['crash 500 2x', '🚀 Crash, cashing out at 2x'],
        ['mines 500 3', '💣 Mines, then pick 7 and cashout'],
      ]],
    ];
    const cmdHtml = (cmd) => `<code>${esc(cmd.split(' / ').map((x) => P + x).join(' / '))}</code>`;

    const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').toLowerCase();
    const topicHtml = (t, open) => `
      <details class="topic" id="topic-${t.id}" ${open ? 'open' : ''}>
        <summary><span class="topic-icon">${t.icon}</span><span class="topic-title">${esc(t.title)}</span><span class="topic-sum">${esc(t.summary)}</span></summary>
        <div class="topic-body">${t.body}</div>
      </details>`;
    const commandsHtml = (q) => {
      const groups = COMMANDS.map(([name, rows]) => [name, rows.filter(([cmd, desc]) => !q || `${cmd} ${desc}`.toLowerCase().includes(q))]).filter(([, rows]) => rows.length);
      return groups.length
        ? `<div class="cmd-groups">${groups
            .map(([name, rows]) => `<section class="panel cmd-group"><h3>${esc(name)}</h3><dl class="kv">${rows.map(([cmd, desc]) => `<dt>${cmdHtml(cmd)}</dt><dd>${esc(desc)}</dd>`).join('')}</dl></section>`)
            .join('')}</div>`
        : '';
    };

    let tab = TABS.some(([id]) => id === query?.get('tab')) ? query.get('tab') : 'basics';
    const openTopic = query?.get('topic');
    let q = '';

    $app.innerHTML = `
      <div class="guide-head">
        <div>
          <h1 style="margin-bottom:4px">How to play</h1>
          <p class="muted" style="margin:0">Pick a topic below. Everything is played by typing commands in Kick chat.</p>
        </div>
        <input id="guide-search" class="guide-search" type="search" placeholder="Search the guide… (e.g. arrows, stamina, iron)" autocomplete="off">
      </div>
      ${g.xpMultiplier !== 1 ? `<div class="panel guide-banner">🔥 <b>${g.xpMultiplier}× XP event is on right now!</b></div>` : ''}
      <div class="tabs guide-tabs" id="guide-tabs"></div>
      <div id="guide-body"></div>`;
    const $tabs = document.getElementById('guide-tabs');
    const $body = document.getElementById('guide-body');

    const draw = () => {
      $tabs.style.display = q ? 'none' : '';
      $tabs.innerHTML = TABS.map(([id, label]) => `<button class="tab ${id === tab ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('');
      if (q) {
        // Search every topic and command at once; open the matches.
        const hits = topics.filter((t) => strip(`${t.title} ${t.summary} ${t.body}`).includes(q));
        const cmds = commandsHtml(q);
        $body.innerHTML =
          hits.length || cmds
            ? `<p class="muted" style="margin-top:0">${hits.length} topic${hits.length === 1 ? '' : 's'} match “${esc(q)}”. Tap one to open it.</p>${hits.length ? `<div class="topics">${hits.map((t) => topicHtml(t, hits.length === 1)).join('')}</div>` : ''}${cmds ? `<h2 style="margin:22px 0 10px">Commands</h2>${cmds}` : ''}`
            : `<div class="panel empty"><span class="ic">🔍</span>Nothing found for “${esc(q)}”.</div>`;
        return;
      }
      if (tab === 'commands') {
        $body.innerHTML = commandsHtml('');
        return;
      }
      const mine = topics.filter((t) => t.tab === tab);
      $body.innerHTML = `
        <div class="guide-tools"><button class="btn btn-sm" data-expand>Expand all</button><button class="btn btn-sm" data-collapse>Collapse all</button></div>
        <div class="topics">${mine.map((t) => topicHtml(t, t.id === openTopic)).join('')}</div>`;
    };
    draw();
    if (openTopic) document.getElementById(`topic-${openTopic}`)?.scrollIntoView({ block: 'start' });

    $tabs.onclick = (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      tab = b.dataset.tab;
      // Remember the tab in the URL without reloading the page.
      history.replaceState(null, '', `#/guide?tab=${tab}`);
      draw();
    };
    $body.onclick = (e) => {
      if (e.target.closest('[data-expand]')) $body.querySelectorAll('details.topic').forEach((d) => (d.open = true));
      if (e.target.closest('[data-collapse]')) $body.querySelectorAll('details.topic').forEach((d) => (d.open = false));
    };
    $body.addEventListener('toggle', (e) => {
      if (e.target.matches?.('details.topic') && e.target.open && !q) history.replaceState(null, '', `#/guide?tab=${tab}&topic=${e.target.id.replace('topic-', '')}`);
    }, true);
    const $search = document.getElementById('guide-search');
    $search.oninput = () => {
      q = $search.value.trim().toLowerCase();
      if (q.length === 1) return;
      draw();
    };
  };

  const ADMIN_TABS = [
    ['overview', '📡 Overview'],
    ['settings', '⚙️ Settings'],
    ['players', '👥 Players'],
    ['economy', '💰 Economy'],
    ['events', '🎉 Events'],
    ['tools', '🧰 Tools'],
    ['audit', '🧾 Audit'],
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
      ${
        s.settings.replyInChat === false
          ? `<div class="alert err"><b>"Reply in chat" is off: the bot reads chat but posts nothing.</b> Commands still work (and the site updates), but nobody sees a reply, and event announcements stay silent too.${
              s.stats.muted ? ` ${fmt(s.stats.muted)} replies held back since the last restart.` : ''
            } <button class="btn btn-sm btn-primary" id="replies-on" style="margin-left:6px">Turn replies back on</button></div>`
          : ''
      }
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
              <dt>Stamina</dt><dd>${s.settings.staminaMax} charges / ${s.settings.staminaMinutes}m</dd>
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
            <p class="muted">In OBS: <b>Sources → + → Browser</b>, paste the link below, set width 400 and height 600, then place it where you like. It shows one event at a time, fading in and out on a see-through card, so it stays out of the way; boss HP and goals are on the website. When it loads you'll see “MMOBot overlay connected” for a few seconds.</p>
            <form id="overlay-form" class="overlay-form">
              <label>Show
                <select name="events">
                  <option value="big">only level-ups, rare finds, subs &amp; raids</option>
                  <option value="all">every action</option>
                </select>
              </label>
              <label>each for <input type="number" name="seconds" value="6" min="2" max="120" style="width:70px"> seconds</label>
              <label>as
                <select name="scenes">
                  <option value="3d">their 3D character doing the action</option>
                  <option value="2d">flat animated scene</option>
                  <option value="0">text only</option>
                </select>
              </label>
              <label><input type="checkbox" name="raid"> boss bar</label>
              <label><input type="checkbox" name="goal"> goal bar</label>
              <label><input type="checkbox" name="stats"> “this stream” panel</label>
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
            <h3 style="margin-top:18px">🎆 Effects overlay (stream redemptions)</h3>
            <p class="muted" style="font-size:.85rem;margin-top:0">A second Browser Source, <b>full screen (1920×1080)</b>, for fireworks, the spotlight, the fanfare and community project celebrations. Tick <b>Control audio via OBS</b> on it to hear the fanfare. Add <code>?sound=0</code> for no sound.</p>
            <div class="form-row">
              <input type="text" id="fx-url" readonly style="max-width:none" aria-label="Effects overlay link" value="${location.origin}/fx.html">
              <button class="btn" id="fx-copy">Copy</button>
            </div>
            <div class="form-row" style="margin-top:10px;flex-wrap:wrap">
              ${[['fireworks', '🎆 Test fireworks'], ['spotlight', '🔦 Test spotlight'], ['fanfare', '📯 Test fanfare'], ['project', '🏛️ Test project complete']].map(([k, l]) => `<button class="btn btn-sm" data-fx="${k}">${l}</button>`).join('')}
              <a class="btn btn-sm" href="/fx.html" target="_blank" rel="noopener">Preview ↗</a>
            </div>
          </section>
        </div>
      </div>`;

    const overlayForm = $app.querySelector('#overlay-form');
    const overlayUrl = () => {
      const f = overlayForm;
      const q = new URLSearchParams();
      if (f.events.value === 'all') q.set('events', 'all');
      if (Number(f.seconds.value) !== 6) q.set('seconds', f.seconds.value);
      if (f.scenes.value !== '3d') q.set('scenes', f.scenes.value);
      for (const k of ['raid', 'goal', 'stats']) if (f[k].checked) q.set(k, '1');
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
    $app.querySelector('#fx-copy').onclick = async () => {
      const input = $app.querySelector('#fx-url');
      try {
        await navigator.clipboard.writeText(input.value);
        toast('Effects overlay link copied');
      } catch {
        input.select();
        toast('Press Ctrl+C / ⌘C to copy');
      }
    };
    $app.querySelectorAll('[data-fx]').forEach((b) => {
      b.onclick = async () => {
        try {
          await api('/admin/fx-test', { method: 'POST', body: { kind: b.dataset.fx } });
          toast('Test effect sent. Check the effects overlay.');
        } catch (e) {
          toast(`Failed: ${e.message}`);
        }
      };
    });
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
    const repliesOn = $app.querySelector('#replies-on');
    if (repliesOn) {
      repliesOn.onclick = async () => {
        repliesOn.disabled = true;
        try {
          await api('/admin/settings/general', { method: 'PUT', body: { value: { replyInChat: true } } });
          toast('Replies are back on.');
          route();
        } catch (e) {
          toast(e.message);
          repliesOn.disabled = false;
        }
      };
    }
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
          ${fieldSection('events', 'Events', 'Follow and sub rewards, random chat events, raids and duels.')}
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
              <dt>Site URL</dt><dd>${esc(env.baseUrl)}${env.baseUrlSource ? ` <span class="muted">(from ${esc(env.baseUrlSource === 'default' ? 'default: set PUBLIC_URL' : env.baseUrlSource)})</span>` : ''}</dd>
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
          .map((k) =>
            tableSection(
              k,
              {
                shop: 'Price of each shop item.',
                redemptions: 'What each stream redemption costs, and how long the whole channel waits before it can be used again. A price of 0 turns it off.',
                projects: 'Points needed to finish each community project. Projects run one after another in this order; a goal of 0 skips it.',
              }[k] || 'Level needed, price and stats for each tier. Levels must go up from tier to tier; the first tier is free at level 1.'
            )
          )
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
    const { players, races } = await api(`/admin/players?q=${encodeURIComponent(q)}`);
    const raceCell = (p) => {
      const days = p.raceWaitUntil ? Math.ceil((p.raceWaitUntil - Date.now()) / 86_400_000) : 0;
      return `<form class="form-row race-form" data-id="${p.id}" data-name="${esc(p.username)}">
          <select name="race" aria-label="Race">${races.map((r) => `<option value="${esc(r.id)}"${r.id === p.race ? ' selected' : ''}>${r.icon} ${esc(r.name)}</option>`).join('')}</select>
          <button class="btn btn-sm">Set</button></form>
        <div class="muted" style="font-size:.8rem;margin-top:4px">${
          days
            ? `Can change in ${days} day${days === 1 ? '' : 's'} <button class="btn btn-sm" data-race-wait="${p.id}" data-name="${esc(p.username)}">Reset wait</button>`
            : p.raceChosen ? 'Can change race now' : 'Hasn\'t picked a race yet'
        }</div>`;
    };
    $app.innerHTML = `
      ${header}
      <section class="panel">
        <form class="form-row" id="player-search">
          <input type="text" name="q" value="${esc(q)}" placeholder="Search by Kick username" style="max-width:none" aria-label="Search players">
          <button class="btn btn-primary">Search</button>
        </form>
        <div class="table-wrap" style="margin-top:14px"><table>
          <thead><tr><th>Player</th><th class="num">Points</th><th class="num">Messages</th><th class="num">Actions</th><th>Last seen</th><th>Race</th><th>Give / take points</th><th>Give / take items</th><th></th></tr></thead>
          <tbody>${
            players.length
              ? players
                  .map(
                    (p) => `<tr>
              <td><a href="${playerLink(p.username)}">${esc(p.username)}</a></td>
              <td class="num" data-points="${p.id}">${fmt(p.points)}</td>
              <td class="num">${fmt(p.message_count)}</td><td class="num">${fmt(p.actions_count)}</td>
              <td>${ago(p.last_seen_at)}</td>
              <td>${raceCell(p)}</td>
              <td><form class="form-row points-form" data-id="${p.id}" data-name="${esc(p.username)}">
                <input type="number" name="delta" step="1" placeholder="+500 or -100" style="max-width:130px" aria-label="Points to add or remove">
                <input type="text" name="reason" placeholder="reason (optional)" style="max-width:170px" aria-label="Reason">
                <button class="btn btn-sm">Apply</button></form></td>
              <td><form class="form-row items-form" data-id="${p.id}" data-name="${esc(p.username)}">
                <input type="text" name="item" placeholder="item, e.g. iron ore" style="max-width:140px" aria-label="Item">
                <input type="number" name="qty" step="1" placeholder="5 or -2" style="max-width:80px" aria-label="Amount">
                <button class="btn btn-sm">Apply</button></form></td>
              <td style="white-space:nowrap">
                <button class="btn btn-sm" data-ban="${p.id}" data-banned="${p.banned ? 1 : 0}" data-name="${esc(p.username)}">${p.banned ? 'Unban' : 'Ban'}</button>
                <button class="btn btn-sm" data-reset="${p.id}" data-name="${esc(p.username)}" style="color:var(--danger)">Reset</button>
              </td>
            </tr>`
                  )
                  .join('')
              : `<tr><td colspan="9" class="empty">No players found.</td></tr>`
          }</tbody>
        </table></div>
      </section>`;
    $app.querySelector('#player-search').onsubmit = (e) => {
      e.preventDefault();
      location.hash = `#/admin?tab=players&q=${encodeURIComponent(e.target.q.value.trim())}`;
    };
    $app.querySelectorAll('.race-form').forEach((f) => {
      f.onsubmit = async (e) => {
        e.preventDefault();
        const r = races.find((x) => x.id === f.race.value);
        if (!confirm(`Make ${f.dataset.name} ${r.icon} ${r.name}? This ignores their race change wait (the wait itself isn't changed).`)) return;
        try {
          const res = await api(`/admin/players/${f.dataset.id}/race`, { method: 'POST', body: { race: f.race.value } });
          toast(res.message);
          route();
        } catch (err) {
          toast(`Failed: ${err.message}`);
        }
      };
    });
    $app.querySelectorAll('[data-race-wait]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm(`Let ${b.dataset.name} pick a new race right away on the Customize page?`)) return;
        try {
          const res = await api(`/admin/players/${b.dataset.raceWait}/race-wait`, { method: 'POST', body: {} });
          toast(res.message);
          route();
        } catch (err) {
          toast(`Failed: ${err.message}`);
        }
      };
    });
    $app.querySelectorAll('.items-form').forEach((f) => {
      f.onsubmit = async (e) => {
        e.preventDefault();
        const qty = Number(f.qty.value);
        if (!f.item.value.trim() || !Number.isInteger(qty) || !qty) return toast('Enter an item and a whole number, e.g. 5 or -2');
        try {
          const r = await api(`/admin/players/${f.dataset.id}/items`, { method: 'POST', body: { item: f.item.value, qty } });
          toast(`${r.applied >= 0 ? 'Gave' : 'Took'} ${Math.abs(r.applied)}x ${r.item} (${f.dataset.name} now has ${r.now})`);
          f.reset();
        } catch (err) {
          toast(`Failed: ${err.message}`);
        }
      };
    });
    $app.querySelectorAll('[data-ban]').forEach((b) => {
      b.onclick = async () => {
        const banned = b.dataset.banned !== '1';
        if (!confirm(`${banned ? 'Ban' : 'Unban'} ${b.dataset.name} ${banned ? 'from' : 'back into'} the game?${banned ? ' Their chat will be ignored by the bot.' : ''}`)) return;
        try {
          await api(`/admin/players/${b.dataset.ban}/ban`, { method: 'POST', body: { banned } });
          toast(banned ? 'Banned' : 'Unbanned');
          route();
        } catch (err) {
          toast(`Failed: ${err.message}`);
        }
      };
    });
    $app.querySelectorAll('[data-reset]').forEach((b) => {
      b.onclick = async () => {
        if (prompt(`This wipes ALL of ${b.dataset.name}'s progress: skills, items, gear, plots and points. Type RESET to confirm.`) !== 'RESET') return;
        try {
          await api(`/admin/players/${b.dataset.reset}/reset`, { method: 'POST', body: {} });
          toast('Player reset');
          route();
        } catch (err) {
          toast(`Failed: ${err.message}`);
        }
      };
    });
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

  // ---- Admin: events (raids, boosts, random events) ----------------------------
  adminPages.events = async (query, header) => {
    const d = await api('/admin/events');
    const r = d.raid;
    const stream = d.stream ? (d.stream.live ? '🔴 Live' : '⚫ Offline') : 'Unknown (no live/offline update from Kick yet)';
    $app.innerHTML = `
      ${header}
      <p class="muted">Stream: <b>${stream}</b> · ${d.chatters} chatting in the last 10 minutes. Automatic events and raids are set on the Settings page (Events).</p>
      <div class="grid grid-2">
        <section class="panel">
          <h2>⚔️ Raid boss</h2>
          ${
            r.active
              ? `<p>${r.icon} <b>${esc(r.name)}</b> (level ${r.level}): ${fmt(r.hp)} / ${fmt(r.maxHp)} HP, ${r.fighters} fighting.</p><button class="btn" id="raid-end">End raid (boss escapes)</button>`
              : `<p class="muted">Chat fights a giant monster together with <code>!attack</code>. Its HP scales with how many people are chatting; the reward pool is split by damage.</p>
                 <div class="form-row"><select id="raid-monster" aria-label="Boss"><option value="">Auto (a bit above chat's level)</option>${d.monsters
                   .map((m) => `<option value="${esc(m.id)}">${m.icon} ${esc(m.name)} (${m.level})</option>`)
                   .join('')}</select>
                 <button class="btn btn-primary" id="raid-start">Start raid</button></div>`
          }
        </section>
        <section class="panel">
          <h2>🌍 World boss</h2>
          ${
            d.worldBoss
              ? `<p>${d.worldBoss.icon} <b>${esc(d.worldBoss.name)}</b> (level ${d.worldBoss.level}): ${fmt(d.worldBoss.hp)} / ${fmt(d.worldBoss.maxHp)} HP, ${d.worldBoss.fighters} fighting, ${Math.ceil((d.worldBoss.endsAt - Date.now()) / 86_400_000)} days left.</p><button class="btn" id="wb-end">End world boss (it escapes)</button>`
              : `<p class="muted">A huge boss that stays for days (Settings → Events) and keeps its HP between streams, so the whole community wears it down. Normal raids still run while it's up.</p>
                 <div class="form-row"><select id="wb-monster" aria-label="World boss"><option value="">Auto</option>${d.monsters
                   .map((m) => `<option value="${esc(m.id)}">${m.icon} ${esc(m.name)} (${m.level})</option>`)
                   .join('')}</select>
                 <button class="btn btn-primary" id="wb-start">Start world boss</button></div>`
          }
        </section>
        <section class="panel">
          <h2>🎯 Channel goal</h2>
          ${
            d.goal
              ? `<p><b>${esc(d.goal.label)}</b>: ${fmt(d.goal.progress)} / ${fmt(d.goal.target)}${d.goal.done ? ' ✅ reached!' : ''}</p><button class="btn" id="goal-end">End goal</button>`
              : `<p class="muted">Chat works together: when they reach the target, everyone gets an XP boost. Shows on the overlay and <code>!goal</code>.</p>
                 <div class="form-row" style="flex-wrap:wrap"><select id="goal-skill" aria-label="Which actions"><option value="any">Any action</option>${d.skills
                   .map((s) => `<option value="${esc(s.id)}">${s.icon} ${esc(s.name)}</option>`)
                   .join('')}</select>
                 <input type="number" id="goal-target" value="500" min="1" style="max-width:100px" aria-label="Target">
                 <input type="number" id="goal-mult" value="2" min="1.1" max="10" step="0.5" style="max-width:70px" aria-label="XP multiplier">
                 <input type="number" id="goal-min" value="30" min="1" max="60" style="max-width:70px" aria-label="Minutes">
                 <button class="btn btn-primary" id="goal-start">Start goal</button></div>
                 <p class="muted" style="font-size:.8rem;margin-bottom:0">Target actions · XP multiplier · boost minutes</p>`
          }
        </section>
        <section class="panel">
          <h2>⚡ Channel boost</h2>
          ${
            d.boost
              ? `<p><b>${d.boost.multiplier}x ${d.boost.kind === 'xp' ? 'XP' : 'chat points'}</b> for everyone, ${Math.ceil((d.boost.until - Date.now()) / 60000)}m left${d.boost.reason ? ` (${esc(d.boost.reason)})` : ''}.</p><button class="btn" id="boost-stop">Stop boost</button>`
              : `<p class="muted">Gifted subs start these automatically. Start one yourself for an event:</p>
                 <div class="form-row"><select id="boost-kind" aria-label="Boost type"><option value="xp">XP</option><option value="points">Chat points</option></select>
                 <input type="number" id="boost-mult" value="2" min="1.1" max="10" step="0.5" style="max-width:80px" aria-label="Multiplier">
                 <input type="number" id="boost-min" value="15" min="1" max="60" style="max-width:80px" aria-label="Minutes">
                 <button class="btn btn-primary" id="boost-start">Start</button></div>`
          }
        </section>
        <section class="panel">
          <h2>🏁 Season ${d.season.number}</h2>
          <p class="muted">Everyone's XP this season makes the Season leaderboard. Ending it gives the top 3 a permanent title (${
            d.season.leaders.map((l, i) => `${['🥇', '🥈', '🥉'][i]} ${esc(l.username)}`).join(', ') || 'nobody yet'
          }) and starts the next season from 0. Nobody loses their levels.</p>
          <button class="btn" id="season-end">End season ${d.season.number}</button>
        </section>
        <section class="panel">
          <h2>📣 Random event</h2>
          <p class="muted">Pop one now: a treasure goblin (first to <code>!catch</code>) or a supply drop (first 3 to <code>!grab</code>).</p>
          <div class="form-row"><button class="btn" data-ev="goblin">👺 Goblin</button><button class="btn" data-ev="supply">📦 Supply drop</button></div>
        </section>
      </div>`;
    const act = async (path, body, method = 'POST') => {
      try {
        await api(path, { method, body });
        toast('Done');
        route();
      } catch (err) {
        toast(err.message);
      }
    };
    $app.querySelector('#raid-start')?.addEventListener('click', () => act('/admin/raid', { monster: $app.querySelector('#raid-monster').value }));
    $app.querySelector('#raid-end')?.addEventListener('click', () => confirm('End the raid? The boss escapes and nobody is paid.') && act('/admin/raid/end', {}));
    $app.querySelector('#wb-start')?.addEventListener('click', () => act('/admin/raid', { world: true, monster: $app.querySelector('#wb-monster').value }));
    $app.querySelector('#wb-end')?.addEventListener('click', () => confirm('End the world boss? It escapes and nobody is paid.') && act('/admin/worldboss/end', {}));
    $app.querySelector('#goal-start')?.addEventListener('click', () =>
      act('/admin/goal', {
        skill: $app.querySelector('#goal-skill').value,
        target: Number($app.querySelector('#goal-target').value),
        multiplier: Number($app.querySelector('#goal-mult').value),
        minutes: Number($app.querySelector('#goal-min').value),
      })
    );
    $app.querySelector('#goal-end')?.addEventListener('click', () => act('/admin/goal/end', {}));
    $app.querySelector('#boost-start')?.addEventListener('click', () =>
      act('/admin/boost', { kind: $app.querySelector('#boost-kind').value, multiplier: Number($app.querySelector('#boost-mult').value), minutes: Number($app.querySelector('#boost-min').value) })
    );
    $app.querySelector('#boost-stop')?.addEventListener('click', () => act('/admin/boost', {}, 'DELETE'));
    $app.querySelector('#season-end')?.addEventListener('click', () => confirm(`End season ${d.season.number}? The top 3 get titles and everyone's season XP goes back to 0.`) && act('/admin/season/end', {}));
    $app.querySelectorAll('[data-ev]').forEach((b) => b.addEventListener('click', () => act('/admin/random-event', { kind: b.dataset.ev })));
  };

  // ---- Admin: economy --------------------------------------------------------
  adminPages.economy = async (query, header) => {
    const e = await api('/admin/economy');
    const f = e.flows;
    const row = (label, v, cls = '') => `<tr><td>${label}</td><td class="num ${cls}">${fmt(v || 0)}</td></tr>`;
    const casinoNet = (f.casinoWagered || 0) - (f.casinoPaid || 0);
    const cardsNet = (f.cardPacks || 0) + (f.cardGrading || 0) - (f.cardBuyback || 0);
    const relicsNet = (f.relicCases || 0) - (f.relicBuyback || 0);
    // A game's result for players: minus = they lost points to it (a sink), plus = it paid out more.
    const netRow = (label, net) =>
      `<tr><td><b>${label}</b> <span class="muted">(for players: minus = points lost, plus = points won)</span></td><td class="num"><b class="${net >= 0 ? 'down' : 'up'}">${net >= 0 ? '' : '+'}${fmt(-net)}</b></td></tr>`;
    const hl = e.health || { alerts: [], week: { days: 0 } };
    const held = e.held || { cards: { count: 0, value: 0, buyback: 0 }, relics: { count: 0, value: 0, buyback: 0 } };
    $app.innerHTML = `
      ${header}
      <section class="panel" style="margin-bottom:16px">
        <h2 style="margin-top:0">🩺 Economy health <span class="muted" style="font-size:.85rem;font-weight:600">last ${hl.week.days || 0} day(s): ${fmt(hl.week.earned || 0)} earned, ${fmt(hl.week.spent || 0)} spent</span></h2>
        ${
          hl.alerts.length
            ? hl.alerts
                .map((a) => `<div class="econ-alert ${a.level}"><b>${a.level === 'bad' ? '🔴' : '🟠'} ${esc(a.title)}</b><ul>${a.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`)
                .join('')
            : `<p class="muted" style="margin:0">✅ ${hl.week.days >= 2 ? 'Points in and out look balanced.' : 'Not enough data yet: this fills in over the next few days.'}</p>`
        }
      </section>
      <div class="stat-row" style="margin-bottom:16px">
        <div class="stat"><div class="v">${fmt(e.totals.points)}</div><div class="k">points held now</div></div>
        <div class="stat"><div class="v">${fmt(e.totals.lifetime)}</div><div class="k">points ever earned</div></div>
        <div class="stat"><div class="v">${fmt(e.totals.players)}</div><div class="k">players</div></div>
      </div>
      ${
        hl.week.games?.length
          ? `<section class="panel" style="margin-bottom:16px">
              <h2 style="margin-top:0">🎲 Games of chance <span class="muted" style="font-size:.85rem;font-weight:600">last ${hl.week.days || 0} day(s)</span></h2>
              <div class="table-wrap"><table><thead><tr><th>Game</th><th class="num">Players put in</th><th class="num">Paid back out</th><th class="num">Players' net</th><th class="num">Payout rate</th></tr></thead><tbody>
                ${hl.week.games
                  .map((g) => `<tr><td>${g.name}</td><td class="num">${fmt(g.in)}</td><td class="num">${fmt(g.out)}</td><td class="num"><b class="${g.net >= 0 ? 'down' : 'up'}">${g.net >= 0 ? '' : '+'}${fmt(-g.net)}</b></td><td class="num">${g.in ? `${Math.round((g.out / g.in) * 100)}%` : '–'}</td></tr>`)
                  .join('')}
              </tbody></table></div>
              <p class="muted" style="font-size:.85rem;margin-bottom:0"><b>Players' net</b>: red minus = points the game removed from the economy (healthy), green plus = the game paid out more than it took (points created). For cards and relics, players keep most of what they open, so the payout rate stays low until they sell to the bank: see the value held below.</p>
            </section>`
          : ''
      }
      <div class="stat-row" style="margin-bottom:16px">
        <div class="stat"><div class="v">${fmt(held.cards.buyback)}</div><div class="k">points in cards (${fmt(held.cards.count)} cards, bank buyback)</div></div>
        <div class="stat"><div class="v">${fmt(held.relics.buyback)}</div><div class="k">points in relics (${fmt(held.relics.count)} relics, bank buyback)</div></div>
        <div class="stat"><div class="v">${fmt(e.totals.points + held.cards.buyback + held.relics.buyback)}</div><div class="k">total players could cash out</div></div>
      </div>
      <div class="grid grid-2">
        <section class="panel">
          <h2>Where points come from and go</h2>
          <p class="muted" style="font-size:.85rem">Counted since ${e.since ? new Date(e.since).toLocaleDateString() : 'this was added'}.</p>
          <div class="table-wrap"><table><tbody>
            ${row('💬 Earned chatting', f.chat, 'up')}
            ${row('⛏️ Earned from actions', f.actions, 'up')}
            ${row('💰 Earned selling items', f.sold, 'up')}
            ${row('🎁 Rewards (events, raids, dailies, follows/subs)', f.rewards, 'up')}
            ${row('🛒 Spent in the shop and on upgrades', f.shop, 'down')}
            ${row('🎰 Bet in the casino', f.casinoWagered)}
            ${row('🎰 Paid out by the casino', f.casinoPaid)}
            ${netRow('Casino result', casinoNet)}
            ${row('🃏 Spent on card packs', f.cardPacks)}
            ${row('🃏 Spent grading cards', f.cardGrading)}
            ${row('🃏 Paid for cards sold back to the bank', f.cardBuyback)}
            ${netRow('Cards result', cardsNet)}
            ${row('🧰 Spent on relic cases', f.relicCases)}
            ${row('🧰 Paid for relics sold back to the bank', f.relicBuyback)}
            ${netRow('Relic cases result', relicsNet)}
            ${row('📣 Spent on stream redemptions', f.redeems, 'down')}
            ${row('🏛️ Given to community projects', f.projects, 'down')}
            ${row('🏪 Market fees (removed from the game)', f.fees, 'down')}
            ${row('🦹 Removed by PvP (heist cuts and fines, guards, arena fees)', f.pvp, 'down')}
            ${row('🤝 Traded between players', f.traded)}
          </tbody></table></div>
        </section>
        <section class="panel">
          <h2>Biggest earners</h2>
          <table><thead><tr><th>Player</th><th class="num">Has now</th><th class="num">Ever earned</th></tr></thead><tbody>
            ${e.topEarners.map((p) => `<tr><td><a href="${playerLink(p.username)}">${esc(p.username)}</a></td><td class="num">${fmt(p.points)}</td><td class="num">${fmt(p.lifetime_points)}</td></tr>`).join('')}
          </tbody></table>
        </section>
      </div>`;
  };

  // ---- Admin: tools (backup / restore) -------------------------------------
  adminPages.tools = async (query, header) => {
    const bk = await api('/admin/backups');
    const size = (n) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
    $app.innerHTML = `
      ${header}
      <section class="panel" style="margin-bottom:16px">
        <div class="panel-head"><h2>🗂️ Automatic backups</h2>${bk.enabled ? '<button class="btn btn-primary btn-sm" id="bk-now">Back up now</button>' : ''}</div>
        ${
          bk.enabled
            ? `<p class="muted" style="margin-top:0">A backup is made every day and the newest ${bk.keep} are kept on the server (<code>${esc(bk.dir)}</code>). Restoring one replaces all game data and restarts the server.</p>
              ${
                bk.backups.length
                  ? `<div class="table-wrap"><table><thead><tr><th>Backup</th><th>Made</th><th class="num">Size</th><th></th></tr></thead><tbody>${bk.backups
                      .map(
                        (b) => `<tr><td><code>${esc(b.name)}</code></td><td>${new Date(b.at).toLocaleString()}</td><td class="num">${size(b.size)}</td>
                          <td><div class="form-row"><a class="btn btn-sm" href="/api/admin/backups/${encodeURIComponent(b.name)}" download>Download</a><button class="btn btn-sm btn-danger" data-restore="${esc(b.name)}">Restore</button></div></td></tr>`
                      )
                      .join('')}</tbody></table></div>`
                  : '<p class="muted">No backups yet. The first one is made a minute after the server starts.</p>'
              }`
            : '<p class="muted">Automatic backups need a database file (they are off for in-memory test databases).</p>'
        }
      </section>
      <div class="grid grid-2">
        <section class="panel">
          <h2>💾 Back up</h2>
          <p class="muted">Download a copy of the whole game database (players, items, settings, logs). Keep one before big changes; Railway volumes have no export button.</p>
          <a class="btn btn-primary" href="/api/admin/backup" download>Download backup</a>
        </section>
        <section class="panel">
          <h2>♻️ Restore</h2>
          <p class="muted">Replace <b>everything</b> with a backup file. The server restarts to load it (a few seconds). The current database is kept next to it as <code>.before-restore</code>.</p>
          <div class="form-row"><input type="file" id="restore-file" accept=".db" aria-label="Backup file"><button class="btn" id="restore-go" style="color:var(--danger)">Restore</button></div>
        </section>
      </div>`;
    $app.querySelector('#bk-now')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await api('/admin/backups', { method: 'POST', body: {} });
        toast('Backup saved');
        route();
      } catch (err) {
        toast(`Failed: ${err.message}`);
        e.target.disabled = false;
      }
    });
    $app.querySelectorAll('[data-restore]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (prompt(`Restore ${b.dataset.restore}? ALL game data goes back to that moment. Type RESTORE to confirm.`) !== 'RESTORE') return;
        try {
          await api(`/admin/backups/${encodeURIComponent(b.dataset.restore)}/restore`, { method: 'POST', body: {} });
          toast('Restoring… the site will be back in a few seconds');
          setTimeout(() => location.reload(), 6000);
        } catch (err) {
          toast(`Failed: ${err.message}`);
        }
      })
    );
    $app.querySelector('#restore-go').onclick = async () => {
      const file = $app.querySelector('#restore-file').files[0];
      if (!file) return toast('Choose a backup file first');
      if (prompt('This replaces ALL game data with the backup. Type RESTORE to confirm.') !== 'RESTORE') return;
      try {
        const res = await fetch('/api/admin/restore', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        toast('Restoring… the site will be back in a few seconds');
        setTimeout(() => location.reload(), 6000);
      } catch (err) {
        toast(`Failed: ${err.message}`);
      }
    };
  };

  // ---- Admin: audit log (who changed what, with undo) --------------------------------------
  adminPages.audit = async (query, header) => {
    const d = await api('/admin/audit');
    $app.innerHTML = `
      ${header}
      <p class="muted">Every change made from the admin pages. Points, items, bans, player resets and settings changes can be undone.</p>
      <section class="panel">${
        d.entries.length
          ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Admin</th><th>What</th><th></th></tr></thead><tbody>${d.entries
              .map(
                (e) => `<tr class="${e.undoneAt ? 'muted' : ''}"><td>${new Date(e.at).toLocaleString()}</td><td>${esc(e.admin)}</td><td>${esc(e.summary)}${e.undoneAt ? ` <span class="badge">undone by ${esc(e.undoneBy)}</span>` : ''}</td>
                  <td>${e.canUndo ? `<button class="btn btn-sm" data-undo="${e.id}" data-what="${esc(e.summary)}">Undo</button>` : ''}</td></tr>`
              )
              .join('')}</tbody></table></div>`
          : '<div class="empty"><span class="ic">🧾</span>No admin changes yet.</div>'
      }</section>`;
    $app.querySelectorAll('[data-undo]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm(`Undo: ${b.dataset.what}?`)) return;
        try {
          const r = await api(`/admin/audit/${b.dataset.undo}/undo`, { method: 'POST', body: {} });
          toast(`Undone${r.note || ''}`);
          route();
        } catch (err) {
          toast(err.message);
        }
      })
    );
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
  let lastHash = null;
  async function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    // Re-rendering the page you're on (after Equip, Sell, Drink...) keeps your place on it; going to
    // another page starts at the top.
    const same = hash === lastHash;
    lastHash = hash;
    const y = window.scrollY;
    const [pathPart, queryPart = ''] = hash.split('?');
    const [name = 'home', ...params] = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    const page = pages[name] || pages.home;
    setActiveNav(name === 'player' || name === 'me' ? '' : name);
    if (typeof cleanup === 'function') cleanup();
    cleanup = null;
    disposeStages();
    // (No "Loading…" flash on a refresh: it would collapse the page and lose the scroll position.)
    if (!same) $app.innerHTML = '<div class="skeleton">Loading…</div>';
    else $app.style.minHeight = `${$app.offsetHeight}px`;
    try {
      cleanup = await page(params, new URLSearchParams(queryPart));
    } catch (err) {
      console.error(err);
      $app.innerHTML = `<div class="panel empty"><span class="ic">⚠️</span>Something went wrong: ${esc(err.message)}</div>`;
    }
    $app.style.minHeight = '';
    window.scrollTo(0, same ? y : 0);
  }

  // Keep "x ago" labels fresh.
  setInterval(() => document.querySelectorAll('[data-ts]').forEach((el) => (el.textContent = ago(+el.dataset.ts))), 15000);

  async function boot() {
    const [me, site] = await Promise.all([api('/me'), api('/site')]);
    Object.assign(state, { me: me.user, isAdmin: me.isAdmin, loginEnabled: me.loginEnabled, devMode: me.devMode, site });
    live.raid = site.raid;
    live.world = site.worldBoss;
    live.goal = site.goal;
    live.boost = site.boost;
    drawBanner();
    if (site.channel) document.getElementById('brand-name').textContent = `${site.channel} MMO`;
    renderAccount();
    window.addEventListener('hashchange', route);
    route();
  }
  boot();
})();
