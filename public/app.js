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
    ({ levelup: '🎉', charlevel: '⭐', rare: '💎', sell: '💰', upgrade: '🔧' })[a.kind] || (a.skill ? skillIcon(a.skill) : '•');

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

  function toolRow(t) {
    const status = !t.next
      ? '<span class="tool-max">Max tier 🏆</span>'
      : t.canUpgrade
        ? `<span class="tool-ready">Type <code>!upgrade ${esc(t.id)}</code></span>`
        : `<span class="muted">Next: ${t.next.icon} ${esc(t.next.name)} at ${t.next.level}</span>`;
    return `
      <div class="tool-row" title="${Math.round(t.snapChance * 1000) / 10}% snap chance · +${Math.round(t.xpBonus * 100)}% XP · rare finds x${t.rareBonus}">
        <span class="tool-icon">${t.icon}</span>
        <span class="tool-name"><b>${esc(t.name)}</b><small>Tier ${t.tier}/${t.tiers} · +${Math.round(t.xpBonus * 100)}% XP</small></span>
        ${status}
      </div>`;
  }

  function characterSheet(p, activity, isMe) {
    const c = p.character;
    const inv = p.inventory.length
      ? `<div class="inv-grid">${p.inventory
          .map(
            (i) => `<div class="inv-item${i.rare ? ' rare' : ''}" title="${esc(i.name)} — ${fmt(i.value)} pts each">
              <span class="qty">${fmt(i.qty)}</span><div class="ic">${i.icon}</div>
              <div class="nm">${esc(i.name)}</div><div class="val">${fmt(i.value * i.qty)} pts</div></div>`
          )
          .join('')}</div>`
      : `<div class="empty"><span class="ic">🎒</span>Empty bag. Type <code>!fish</code>, <code>!mine</code>, <code>!chop</code> or <code>!dig</code> in chat.</div>`;
    const charNext = c.nextLevelXp == null ? 'Max character level' : `${c.percent}% to level ${c.level + 1}`;

    return `
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

      <div class="grid grid-2" style="margin-top:28px">
        <section class="panel">
          <div class="panel-head"><h2>Inventory</h2><span class="badge gold">Worth ${fmt(p.inventoryValue)} pts</span></div>
          ${inv}
          ${p.inventory.length ? `<p class="muted" style="margin-bottom:0">Sell in chat with <code>!sell all</code> or <code>!sell trout 5</code>.</p>` : ''}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Recent activity</h2></div>
          <ul class="feed" id="player-feed">${
            activity.length ? activity.map((a) => feedItem(a)).join('') : '<li class="empty">No activity yet.</li>'
          }</ul>
        </section>
      </div>`;
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
    const tierTable = (s) => `
      <div class="table-wrap"><table>
        <thead><tr><th>Level</th><th>${s.type === 'process' ? 'Bar' : 'Resource'}</th>${s.type === 'process' ? '<th>Needs</th>' : ''}<th class="num">XP</th><th class="num">Sells for</th></tr></thead>
        <tbody>${s.tiers
          .map(
            (t) => `<tr><td><b>${t.level}</b></td><td>${t.icon} ${esc(t.item)}</td>
            ${t.inputs ? `<td class="wrap">${t.inputs.map((i) => `${i.qty}× ${i.icon} ${esc(i.item)}`).join(' + ')}</td>` : ''}
            <td class="num">${t.xp}</td><td class="num">${fmt(t.value)} pts</td></tr>`
          )
          .join('')}
          ${s.rares
            .map(
              (r) => `<tr style="color:var(--rare)"><td>Rare · ${esc(r.odds)}</td><td>${r.icon} ${esc(r.item)}</td><td class="num">${fmt(r.xp)}</td><td class="num">${fmt(r.value)} pts</td></tr>`
            )
            .join('')}
        </tbody></table></div>`;
    const toolTable = (t) => `
      <h3 style="margin:22px 0 8px">Rods <code>${esc(t.command)}</code></h3>
      <p class="muted" style="margin-top:0">Everyone starts with a Basic Rod. Every 50 Fishing levels you can upgrade to the next rod, one tier at a time.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Level</th><th>Rod</th><th class="num" title="Chance your line snaps">Snap</th><th class="num" title="Bonus Fishing XP">XP</th><th class="num" title="Rare-find odds multiplier">Rare</th></tr></thead>
        <tbody>${t.tiers
          .map(
            (r) => `<tr><td><b>${r.level}</b></td><td>${r.icon} ${esc(r.name)}</td><td class="num">${Math.round(r.snapChance * 1000) / 10}%</td>
            <td class="num">+${Math.round(r.xpBonus * 100)}%</td><td class="num">x${r.rareBonus}</td></tr>`
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
            <li>Mine ores, then <code>!smelt</code> them into bars for Smelting XP and more valuable loot.</li>
            <li>Just chatting earns <b>${g.chatPoints} points</b> (once every ${g.chatCooldown}s). <code>!sell</code> loot for even more.</li>
            <li>Fishing goes all the way to <b>level 500</b>. Every 50 levels, <code>!upgrade rod</code> for fewer snapped lines, bonus XP and better rare odds.</li>
            <li>Your <b>character level</b> grows with the combined XP of all skills — train them all!</li>
          </ol>
        </section>
        <section class="panel">
          <h2>Chat commands</h2>
          <dl class="kv">
            ${g.skills.map((s) => `<dt><code>${esc(s.command)}</code></dt><dd>${s.icon} Train ${esc(s.name)}</dd>`).join('')}
            <dt><code>!rod</code></dt><dd>Show your fishing rod</dd>
            <dt><code>!upgrade rod</code></dt><dd>Upgrade your rod (every 50 Fishing levels)</dd>
            <dt><code>!stats [name]</code></dt><dd>Show levels and points</dd>
            <dt><code>!inv</code></dt><dd>Show your bag</dd>
            <dt><code>!sell all</code></dt><dd>Sell everything for points</dd>
            <dt><code>!sell trout 5</code></dt><dd>Sell a specific item</dd>
            <dt><code>!points</code></dt><dd>Show your points</dd>
            <dt><code>!top [skill]</code></dt><dd>Top 5 players</dd>
            <dt><code>!commands</code></dt><dd>List commands</dd>
          </dl>
        </section>
      </div>
      <h2 style="margin:28px 0 12px">Skills &amp; unlocks</h2>
      <div class="grid grid-guide">
        ${g.skills
          .map(
            (s) => `<section class="panel"><h2>${s.icon} ${esc(s.name)} <code>${esc(s.command)}</code> <span class="muted" style="font-size:.8rem;font-weight:600">max level ${s.maxLevel}</span></h2>${tierTable(s)}${s.tool ? toolTable(s.tool) : ''}</section>`
          )
          .join('')}
      </div>`;
  };

  pages.admin = async (_, query) => {
    if (!state.isAdmin) {
      $app.innerHTML = `<div class="panel empty"><span class="ic">🔒</span>Admins only. Log in with the channel owner's Kick account.</div>`;
      return;
    }
    const s = await api('/admin/status');
    const ok = query.get('ok');
    const err = query.get('error');
    const dot = (on) => `<span class="status-dot ${on ? 'on' : ''}"></span>`;
    const subs = s.subscriptions;
    $app.innerHTML = `
      <h1>Admin</h1>
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
            <p class="muted">Add a Browser Source (400×600) with this URL to show level-ups and rare drops on stream.</p>
            <code>${esc(location.origin)}/overlay.html</code>
          </section>
        </div>
      </div>`;

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
