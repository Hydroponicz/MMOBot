// Stream rewards page (#/stream): spend points on redemptions everyone sees on stream, and pool
// points into community projects. app.js calls window.MMOStream($app, helpers).
(() => {
  window.MMOStream = async ($app, { api, toast, esc, fmt, state, ago, playerLink }) => {
    let data = await api('/stream');
    const loggedIn = data.points !== null;
    const cleanups = [];
    // The server's clock, so cooldowns count down correctly even if this computer's clock is off.
    let skew = data.now - Date.now();
    const now = () => Date.now() + skew;

    const post = async (path, body) => {
      try {
        return await api(path, { method: 'POST', body });
      } catch (err) {
        toast(err.message);
        return null;
      }
    };
    const reload = async () => {
      data = await api('/stream');
      skew = data.now - Date.now();
      draw();
    };

    function projectHtml() {
      const p = data.project;
      if (!data.projectsEnabled || !p) return '';
      const pct = Math.min(100, (p.progress / p.goal) * 100);
      const idx = data.projects.findIndex((x) => x.id === p.id);
      const upcoming = [...data.projects.slice(idx + 1), ...data.projects.slice(0, idx)].slice(0, 3);
      return `
        <section class="panel project-panel">
          <div class="panel-head"><h2>${p.icon} Community project #${p.number}: ${esc(p.name)}</h2><span class="muted">${fmt(p.donors)} donor${p.donors === 1 ? '' : 's'}</span></div>
          <p style="margin-top:0">${esc(p.text)}</p>
          <div class="project-bar"><span style="width:${pct.toFixed(2)}%"></span><b>${fmt(p.progress)} / ${fmt(p.goal)} pts · ${Math.floor(pct)}%</b></div>
          ${
            loggedIn
              ? `<form id="fund-form" class="form-row" style="margin-top:12px;flex-wrap:wrap;align-items:center">
                  <input type="number" name="amount" min="10" placeholder="Points" style="max-width:160px" aria-label="Points to give">
                  <button class="btn btn-primary">Give</button>
                  ${[100, 1000, 10000].map((n) => `<button type="button" class="btn btn-sm" data-quick="${n}">${fmt(n)}</button>`).join('')}
                  <button type="button" class="btn btn-sm" data-quick="all">All</button>
                  <span class="muted" style="font-size:.85rem">You have ${fmt(data.points)} pts · in chat: <code>!fund 500</code></span>
                </form>`
              : state.loginEnabled
                ? '<p><a class="btn btn-primary" href="/auth/login">Log in with Kick to chip in</a></p>'
                : '<p class="muted">Chip in from chat: <code>!fund 500</code></p>'
          }
          <div class="grid grid-2" style="margin-top:14px">
            <div>
              <h3>Top donors</h3>
              ${p.top.length ? `<ol class="donors">${p.top.map((t) => `<li><a href="${playerLink(t.username)}">${esc(t.username)}</a> <b>${fmt(t.amount)}</b></li>`).join('')}</ol>` : '<p class="muted">No one yet. Be the first!</p>'}
              <p class="muted" style="font-size:.85rem">When the goal is reached, the top donor earns the title <b>the Grand Patron</b> and everyone who gave 10% or more earns <b>the Patron</b>.</p>
            </div>
            <div>
              <h3>Next up</h3>
              <ul class="upcoming">${upcoming.map((x) => `<li>${x.icon} <b>${esc(x.name)}</b> <span class="muted">${fmt(x.goal)} pts: ${esc(x.text)}</span></li>`).join('')}</ul>
            </div>
          </div>
        </section>`;
    }

    function redeemHtml() {
      if (!data.redeemEnabled) return '';
      return `
        <section class="panel" style="margin-top:16px">
          <div class="panel-head"><h2>📣 Stream redemptions</h2><span class="muted">Everyone sees these on stream · in chat: <code>!redeem fireworks</code></span></div>
          ${data.offline ? '<p class="lock-box" style="margin-top:0">📴 The stream is offline: redemptions open again when it goes live.</p>' : ''}
          <div class="redeem-grid">${data.redemptions
            .map((r) => {
              const wait = r.readyAt ? Math.max(0, r.readyAt - now()) : 0;
              const poor = loggedIn && data.points < r.cost;
              return `<div class="redeem-card" data-id="${r.id}">
                <div class="redeem-ic">${r.icon}</div>
                <b>${esc(r.name)}</b>
                <p class="muted">${esc(r.text)}</p>
                <div class="redeem-foot">
                  <span class="pack-price"><b>${fmt(r.cost)}</b> pts</span>
                  ${
                    loggedIn
                      ? `<button class="btn btn-primary btn-sm" data-redeem="${r.id}" ${wait || data.offline || poor ? 'disabled' : ''} data-ready="${r.readyAt || 0}">${wait ? `Ready in <span class="cd" data-until="${r.readyAt}">${Math.ceil(wait / 1000)}s</span>` : poor ? 'Not enough points' : 'Redeem'}</button>`
                      : ''
                  }
                </div>
                ${r.cooldown ? `<small class="muted">Cooldown ${r.cooldown} min for the whole channel</small>` : ''}
              </div>`;
            })
            .join('')}</div>
        </section>`;
    }

    function hallHtml() {
      const m = data.monuments;
      const h = data.history;
      return `
        <section class="panel" style="margin-top:16px">
          <h2 style="margin-top:0">🏛️ Hall of Monuments</h2>
          ${
            m.length
              ? `<div class="monuments">${m
                  .map(
                    (x) => `<div class="statue"><div class="statue-fig">${x.appearance && window.MMOAvatar ? MMOAvatar.svg(x.appearance, { size: 130 }) : '🗿'}</div><div class="statue-plinth">${esc(x.username)}</div>
                      <small class="muted">Project #${x.number} · ${fmt(x.amount)} pts · ${new Date(x.at).toLocaleDateString()}</small></div>`
                  )
                  .join('')}</div>`
              : '<p class="muted" style="margin:0">No monuments yet. Fund the Monument project and the top donor is carved here forever.</p>'
          }
          ${
            h.length
              ? `<h3 style="margin-top:18px">Completed projects</h3><ul class="upcoming">${h
                  .slice(0, 10)
                  .map((x) => `<li>${x.icon} <b>#${x.number} ${esc(x.name)}</b> <span class="muted">${fmt(x.goal)} pts from ${fmt(x.donors)} donor${x.donors === 1 ? '' : 's'} · top: <a href="${playerLink(x.top)}">${esc(x.top)}</a> · <span data-ts="${x.at}">${ago(x.at)}</span></span></li>`)
                  .join('')}</ul>`
              : ''
          }
        </section>`;
    }

    // KICKs supporters: what a gift does, and the leaderboards.
    let kicksPeriod = 'week';
    function kicksHtml() {
      const k = data.kicks;
      if (!k || !k.on) return '';
      const c = k.cfg;
      const tiers = [
        [1, `+${fmt(c.pointsPer)} pts per KICK for you`],
        c.rainAt && [c.rainAt, `💰 loot rain: ${fmt(c.rainPer)} pts per KICK shared between up to 10 chatters`],
        c.boostAt && [c.boostAt, `⚡ double XP for everyone for ${c.boostMinutes} min`],
        c.bossAt && [c.bossAt, '🌍 wakes the world boss'],
      ].filter(Boolean);
      const list = k[kicksPeriod];
      return `
        <section class="panel kicks-panel">
          <div class="panel-head"><h2>💎 KICKs supporters</h2><span class="muted">Send KICKs on Kick to set these off</span></div>
          <div class="grid grid-2">
            <div>
              <h3 style="margin-top:0">What a gift does</h3>
              <ul class="kick-tiers">${tiers.map(([at, text]) => `<li><b>${at === 1 ? 'Any' : `${fmt(at)}+`}</b><span>${text}</span></li>`).join('')}</ul>
              <p class="muted" style="font-size:.85rem">Bigger gifts set off everything below them too. Lifetime titles: <b>the Kick Supporter</b> (100), <b>the Kick Patron</b> (1,000), <b>the Kick Legend</b> (10,000). In chat: <code>!kicks</code>.</p>
            </div>
            <div>
              <div class="tabs" style="margin-bottom:8px">${[['week', 'This week'], ['month', 'This month'], ['all', 'All time']].map(([id, l]) => `<button class="tab ${id === kicksPeriod ? 'active' : ''}" data-kperiod="${id}">${l}</button>`).join('')}</div>
              ${list.length ? `<ol class="donors">${list.map((x) => `<li><a href="${playerLink(x.username)}">${esc(x.username)}</a> <b>💎 ${fmt(x.amount)}</b></li>`).join('')}</ol>` : '<p class="muted">No KICKs yet. Be the first!</p>'}
            </div>
          </div>
        </section>`;
    }

    function draw() {
      $app.innerHTML = `
        <div class="panel-head cards-head" style="margin-bottom:4px">
          <h1 style="margin:0">📣 Stream Rewards</h1>
          ${loggedIn ? `<span class="badge gold" style="font-size:1rem">💰 ${fmt(data.points)} pts</span>` : ''}
        </div>
        <p class="muted">Spend your points on things the whole stream sees, or pool them with chat to unlock something big together.</p>
        ${projectHtml()}
        ${kicksHtml()}
        ${redeemHtml()}
        ${hallHtml()}`;
      $app.querySelectorAll('[data-kperiod]').forEach((b) => {
        b.onclick = () => {
          kicksPeriod = b.dataset.kperiod;
          draw();
        };
      });
      const form = $app.querySelector('#fund-form');
      if (form) {
        const give = async (amount) => {
          const r = await post('/stream/fund', { amount });
          if (!r) return;
          toast(r.message);
          reload();
        };
        form.onsubmit = (e) => {
          e.preventDefault();
          const v = form.amount.value.trim();
          if (v) give(v);
        };
        form.querySelectorAll('[data-quick]').forEach((b) => {
          b.onclick = () => {
            if (b.dataset.quick === 'all' && !confirm(`Give all ${fmt(data.points)} of your points to the project?`)) return;
            give(b.dataset.quick);
          };
        });
      }
      $app.querySelectorAll('[data-redeem]').forEach((b) => {
        b.onclick = async () => {
          const r = data.redemptions.find((x) => x.id === b.dataset.redeem);
          if (!confirm(`Redeem ${r.icon} ${r.name} for ${fmt(r.cost)} pts?`)) return;
          b.disabled = true;
          const res = await post('/stream/redeem', { id: r.id });
          if (res) toast(res.message);
          reload();
        };
      });
    }
    draw();

    // Cooldowns count down; buttons come back when ready.
    const timer = setInterval(() => {
      let ready = false;
      $app.querySelectorAll('.cd[data-until]').forEach((el) => {
        const left = Number(el.dataset.until) - now();
        if (left <= 0) ready = true;
        else el.textContent = left > 90_000 ? `${Math.ceil(left / 60_000)}m` : `${Math.ceil(left / 1000)}s`;
      });
      if (ready) reload();
    }, 1000);
    cleanups.push(() => clearInterval(timer));
    // Live project progress.
    const es = new EventSource('/api/events');
    es.addEventListener('project', (e) => {
      const p = JSON.parse(e.data);
      if (!p) return;
      if (p.completed) return reload();
      data.project = p;
      const bar = $app.querySelector('.project-bar');
      if (bar && p.id === data.project.id) {
        bar.querySelector('span').style.width = `${Math.min(100, (p.progress / p.goal) * 100).toFixed(2)}%`;
        bar.querySelector('b').textContent = `${fmt(p.progress)} / ${fmt(p.goal)} pts · ${Math.floor((p.progress / p.goal) * 100)}%`;
      }
    });
    cleanups.push(() => es.close());
    return () => cleanups.forEach((fn) => fn());
  };
})();
