// The Gloamveil page (#/veil): the extraction minigame. Pick a zone and walk in, then search, go
// deeper and extract at a Waystone; ambush or hide from other players. app.js calls
// window.MMOVeil($app, helpers) and runs the returned cleanup when leaving the page.
(() => {
  window.MMOVeil = async ($app, { api, toast, esc, fmt, ago, playerLink }) => {
    let d = await api('/veil');
    const loggedIn = !!d.username;
    let light = false;
    let busy = false;
    const log = []; // this visit's action results, newest first

    const OUTLOOK = {
      favoured: ['🟢', 'you look stronger'],
      even: ['🟡', 'an even fight'],
      risky: ['🟠', 'they look stronger'],
      hopeless: ['🔴', 'they would crush you'],
    };
    const clock = (ms) => {
      const s = Math.max(0, Math.ceil(ms / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    const strip = (m) => String(m || '').replace(/ \| [^|]*$/, ''); // drop the status line, the page shows it

    async function refresh() {
      d = await api('/veil');
      draw();
    }

    async function act(action, body = {}) {
      if (busy) return;
      busy = true;
      try {
        const r = await api(`/veil/${action}`, { method: 'POST', body });
        // First time in: the game asks to confirm what's at stake.
        if (action === 'enter' && /death is final/.test(r.message)) {
          busy = false;
          if (confirm(`${r.message.replace(/ Type !veil \d again.*$/, '')}\n\nGo in?`)) return act('enter', body);
          return;
        }
        log.unshift({ at: Date.now(), text: strip(r.message) });
        log.length = Math.min(log.length, 8);
        if (!['enter', 'search', 'deeper', 'mend', 'hide'].includes(action)) toast(strip(r.message));
      } catch (err) {
        toast(err.message);
      }
      busy = false;
      await refresh();
    }

    // ---- Not inside: the zones -------------------------------------------------------------------
    function stakeHtml() {
      const me = d.me;
      if (!me) return '';
      const worth = me.gear.reduce((s, g) => s + g.value, 0);
      const gear = me.gear.length
        ? me.gear.map((g) => `<span class="veil-pill">${g.icon} ${esc(g.name)}</span>`).join('')
        : '<span class="muted">nothing worn</span>';
      return `<section class="panel veil-stake">
        <div class="panel-head"><h2>⚠️ At stake</h2><span class="muted">${me.vitals.ko ? '💀 knocked out' : `❤️ ${fmt(me.vitals.hp)}/${fmt(me.vitals.maxHp)} HP`} · ⚡ ${me.stamina.charges}/${me.stamina.max} stamina · 💰 ${fmt(me.points)}</span></div>
        <p style="margin-top:0">You fight with what you're wearing: <b>${esc(me.fighter)}</b>. Die in the fog and all of it is gone${worth ? ` (about ${fmt(worth)} pts)` : ''}:</p>
        <div class="veil-pills">${gear}</div>
        ${me.armed ? '' : '<p class="veil-warn">You aren\'t holding a weapon. Equip one on your character page or with <code>!equip</code>.</p>'}
        <label class="veil-check"><input type="checkbox" id="veil-light" ${light ? '' : 'checked'}> Bring supplies: your ${d.cfg.supplies} best food or health potions (lost if you die, returned if you get out)</label>
      </section>`;
    }

    function zonesHtml() {
      const me = d.me;
      return `<div class="veil-zones">${d.zones
        .map((z) => {
          const locked = me && me.combat < z.minCombat;
          const why = !me
            ? ''
            : locked
              ? `Needs Combat ${z.minCombat} (you're ${me.combat})`
              : !me.armed
                ? 'Equip a weapon first'
                : me.vitals.ko
                  ? 'You are knocked out'
                  : me.points < z.fee
                    ? `Needs ${fmt(z.fee)} pts`
                    : me.stamina.charges < 1
                      ? 'Out of stamina'
                      : '';
          return `<section class="panel veil-zone${locked ? ' locked' : ''}">
            <div class="veil-zone-head"><span class="veil-zone-ic">${z.icon}</span><div><h3>${z.id}. ${esc(z.name)}</h3><div class="muted">${esc(z.text)}</div></div></div>
            <div class="veil-facts"><span>⚔️ Combat ${z.minCombat}+</span><span>💰 ${fmt(z.fee)} pts</span><span>👹 monsters lvl ${z.monsters[0]}–${z.monsters[1]}</span><span>👁️ ${z.inside} inside now</span></div>
            <div class="veil-pills">${z.loot.map((l, i) => `<span class="veil-pill${i === z.loot.length - 1 ? ' rare' : ''}" title="${fmt(l.value)} pts each">${l.icon} ${esc(l.name)} <small>${fmt(l.value)}</small></span>`).join('')}</div>
            ${loggedIn ? `<button class="btn ${why ? '' : 'btn-primary'}" data-enter="${z.id}" ${why ? 'disabled' : ''}>${why ? esc(why) : `Enter the ${esc(z.name)}`}</button>` : ''}
          </section>`;
        })
        .join('')}</div>`;
    }

    function howHtml() {
      return `<section class="panel">
        <h2>How it works</h2>
        <ol class="veil-steps">
          <li><b>Go in</b> wearing your gear (1 stamina and the zone's fee). You have <b>${d.cfg.minutes} minutes</b> before the fog closes.</li>
          <li><b>Search</b> rooms for loot (${d.cfg.bagSize} items fit in your bag). Searching makes <b>noise</b>, and noise draws monsters. Go <b>deeper</b> for rarer loot and harder monsters.</li>
          <li><b>Get out</b> through a 🔮 Waystone (rooms ${d.cfg.waystones.map((i) => i + 1).join(' and ')}; searching can uncover more). Only then is the loot yours.</li>
          <li><b>Other players</b> are in the fog too. When you spot one, <b>ambush</b> them (they may slip away) or <b>hide</b>. The winner takes the loser's bag and a piece of their gear, and still has to get it out.</li>
          <li><b>Death is final</b>: killed by a monster, a player or the fog, you lose your worn weapon and armor, your supplies and your bag, and you're knocked out.</li>
        </ol>
        <p class="muted" style="margin-bottom:0">In chat: <code>!veil 1</code> to enter, then <code>!search</code>, <code>!deeper</code>, <code>!extract</code>, <code>!mend</code>, <code>!ambush</code>, <code>!hide</code>. <code>!veil</code> shows where you are.</p>
      </section>`;
    }

    // ---- Inside: the run ----------------------------------------------------------------------
    function runHtml() {
      const r = d.run;
      const z = d.zones.find((x) => x.id === r.zone);
      const me = d.me;
      const hpPct = Math.max(0, Math.min(100, (me.vitals.hp / me.vitals.maxHp) * 100));
      const room = r.rooms[r.room];
      const rooms = r.rooms
        .map((rm, i) => {
          const cls = i === r.room ? 'here' : i < r.room ? 'past' : 'ahead';
          const mark = rm.waystone ? '🔮' : i === 0 ? '🚪' : i < r.room || i === r.room ? '·' : '?';
          return `<div class="veil-room ${cls}" title="Room ${i + 1}${rm.waystone ? ': Waystone' : ''}">${i === r.room ? '🧍' : mark}<small>${i + 1}</small></div>`;
        })
        .join('<span class="veil-path"></span>');
      const enc = r.encounter;
      const encHtml = enc
        ? `<div class="veil-encounter">
            <div><b>👁️ You spot <a href="${playerLink(enc.username)}">${esc(enc.username)}</a> in the fog</b><div class="muted">${esc(enc.label)} · ❤️ ${fmt(enc.hp)}/${fmt(enc.maxHp)} · ${OUTLOOK[enc.outlook][0]} ${OUTLOOK[enc.outlook][1]} · <span data-until="${enc.until}">${clock(enc.until - Date.now())}</span></div></div>
            <div class="veil-actions"><button class="btn btn-danger" data-act="ambush">🗡️ Ambush</button><button class="btn" data-act="hide">🫥 Hide</button></div>
          </div>`
        : '';
      const bag = r.bag.length
        ? r.bag.map((b) => `<div class="veil-item"><span>${b.icon} ${esc(b.name)}${b.qty > 1 ? ` ×${b.qty}` : ''}</span><span class="muted">${fmt(b.value * b.qty)}</span></div>`).join('')
        : '<div class="muted">Empty. !search to fill it.</div>';
      const count = r.bag.reduce((s, b) => s + b.qty, 0);
      const sup = r.supplies.length ? r.supplies.map((s) => `<span class="veil-pill">${s.icon} ${esc(s.name)} ×${s.qty}</span>`).join('') : '<span class="muted">none left</span>';
      return `<section class="panel veil-run">
          <div class="veil-run-head">
            <h2>${z.icon} ${esc(z.name)}</h2>
            <div class="veil-timer" id="veil-timer" data-ends="${r.endsAt}" title="Time before the fog closes">⏱ ${clock(r.endsAt - Date.now())}</div>
          </div>
          <div class="veil-map">${rooms}</div>
          <div class="veil-meters">
            <div><div class="skill-meta"><span>❤️ HP</span><span>${fmt(me.vitals.hp)}/${fmt(me.vitals.maxHp)}</span></div><div class="bar" style="margin:4px 0"><span style="width:${hpPct}%;--c:${hpPct < 35 ? 'var(--danger)' : 'var(--accent)'}"></span></div></div>
            <div><div class="skill-meta"><span>🔊 Noise</span><span>${r.noise < 30 ? 'quiet' : r.noise < 60 ? 'noticeable' : 'loud'}</span></div><div class="bar" style="margin:4px 0"><span style="width:${r.noise}%;--c:var(--gold)"></span></div></div>
          </div>
          ${encHtml}
          <div class="veil-actions" ${enc ? 'hidden' : ''}>
            <button class="btn ${room.searches > 0 ? 'btn-primary' : ''}" data-act="search" ${room.searches > 0 ? '' : 'disabled'}>🔍 Search${room.searches > 0 ? ` (${room.searches} left)` : ': picked clean'}</button>
            <button class="btn" data-act="deeper" ${r.room < r.rooms.length - 1 ? '' : 'disabled'}>🌫️ Go deeper</button>
            <button class="btn ${room.waystone ? 'btn-primary' : ''}" data-act="extract" ${room.waystone ? '' : 'disabled'}>🔮 Extract${room.waystone ? ` with ${fmt(r.bagValue)} pts` : ': no Waystone here'}</button>
            <button class="btn" data-act="mend" ${r.supplies.length && me.vitals.hp < me.vitals.maxHp ? '' : 'disabled'}>🍖 Mend</button>
          </div>
          <div class="veil-log">${log.map((l) => `<div>${esc(l.text)}</div>`).join('') || '<div class="muted">Your moves show here.</div>'}</div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>🎒 Bag ${count}/${d.cfg.bagSize}</h2><b>${fmt(r.bagValue)} pts</b></div>
          ${bag}
          <h3 style="margin:14px 0 6px">Supplies</h3><div class="veil-pills">${sup}</div>
          <h3 style="margin:14px 0 6px">Wearing (lost if you die)</h3><div class="veil-pills">${me.gear.map((g) => `<span class="veil-pill">${g.icon} ${esc(g.name)}</span>`).join('')}</div>
        </section>`;
    }

    // How the last run went (after dying or getting out on this visit).
    function lastRunHtml() {
      if (!log.length) return '';
      return `<section class="panel"><h2>Your last run</h2><div class="veil-log">${log.map((l) => `<div>${esc(l.text)}</div>`).join('')}</div></section>`;
    }

    // ---- Both: news and the week's board --------------------------------------------------------
    function sideHtml() {
      const feed = d.log.length
        ? d.log
            .slice(0, 12)
            .map((e) => {
              const who = `<a href="${playerLink(e.name)}">${esc(e.name)}</a>`;
              const text =
                e.kind === 'extract'
                  ? `🔮 ${who} got out of the ${esc(e.zone)}${e.value ? ` with ${fmt(e.value)} pts of loot` : ''}`
                  : e.kind === 'kill'
                    ? `🗡️ ${who} killed <a href="${playerLink(e.victim)}">${esc(e.victim)}</a> in the ${esc(e.zone)}`
                    : `💀 ${who} died in the ${esc(e.zone)} (${esc(e.how)})${e.value ? `, losing ${fmt(e.value)} pts of loot` : ''}`;
              return `<li>${text} <span class="muted" data-ts="${e.at}">${ago(e.at)}</span></li>`;
            })
            .join('')
        : '<li class="muted">Nobody has gone in yet.</li>';
      const board = d.board.length
        ? `<table class="table"><thead><tr><th>#</th><th>Player</th><th class="num">Extracted</th><th class="num">Kills</th><th class="num">Deaths</th></tr></thead><tbody>${d.board
            .map((b, i) => `<tr><td>${i + 1}</td><td><a href="${playerLink(b.name)}">${esc(b.name)}</a></td><td class="num">${fmt(b.value)}</td><td class="num">${b.kills}</td><td class="num">${b.deaths}</td></tr>`)
            .join('')}</tbody></table>`
        : '<p class="muted">No runs this week yet.</p>';
      return `<section class="panel"><h2>🌫️ From the fog</h2><ul class="veil-feed">${feed}</ul></section>
        <section class="panel"><h2>🏆 This week</h2>${board}</section>`;
    }

    function draw() {
      const inside = !!d.run;
      $app.innerHTML = `
        <div class="panel-head" style="margin-bottom:6px"><h1 style="margin:0">🌫️ The Gloamveil</h1>${
          !loggedIn ? '<a class="btn btn-primary" href="/auth/login">Log in with Kick to play</a>' : ''
        }</div>
        <p class="muted">A fog-drowned realm between worlds. Walk in wearing your gear, loot what you can, and get out through a Waystone before the fog closes. Die in there and you lose everything you brought.</p>
        ${d.on ? '' : '<div class="panel empty">The Gloamveil is closed right now.</div>'}
        <div class="grid grid-2">
          <div class="stack">${inside ? runHtml() : `${lastRunHtml()}${stakeHtml()}${zonesHtml()}${howHtml()}`}</div>
          <div class="stack">${sideHtml()}</div>
        </div>`;
      $app.querySelectorAll('[data-enter]').forEach((b) => (b.onclick = () => act('enter', { zone: +b.dataset.enter, light })));
      $app.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => act(b.dataset.act)));
      const lightBox = $app.querySelector('#veil-light');
      if (lightBox) lightBox.onchange = () => (light = !lightBox.checked);
    }

    draw();
    // Tick the timers; refresh now and then while inside (other players, the fog closing).
    let n = 0;
    const timer = setInterval(() => {
      const t = document.getElementById('veil-timer');
      if (t) {
        const left = +t.dataset.ends - Date.now();
        t.textContent = `⏱ ${clock(left)}`;
        t.classList.toggle('low', left < 120_000);
      }
      document.querySelectorAll('[data-until]').forEach((el) => (el.textContent = clock(+el.dataset.until - Date.now())));
      n++;
      if (d.run && !busy && (n % 10 === 0 || (t && +t.dataset.ends < Date.now()))) refresh().catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  };
})();
