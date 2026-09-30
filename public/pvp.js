// PvP page (#/pvp): heists (most wanted, guards, recent heists), the ranked arena ladder and the
// weekly guild war. app.js calls window.MMOPvp($app, helpers).
(() => {
  window.MMOPvp = async ($app, { api, toast, esc, fmt, ago, playerLink }) => {
    let d = await api('/pvp');
    const loggedIn = d.points !== null;
    const mins = (ms) => {
      const m = ms < 3_600_000 ? Math.max(1, Math.ceil(ms / 60_000)) : Math.floor(ms / 60_000); // "23h 59m", not "23h 60m"
      return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
    };
    const pct = (x) => `${Math.round(x * 100)}%`;
    const FIGHT = { favoured: '<span style="color:var(--accent)">favoured</span>', even: 'even', risky: '<span style="color:var(--gold)">risky</span>', hopeless: '<span style="color:var(--danger)">hopeless</span>' };

    const post = async (path, body) => {
      try {
        const r = await api(path, { method: 'POST', body });
        toast(r.message);
      } catch (err) {
        toast(err.message);
      }
      d = await api('/pvp');
      draw();
    };

    function heistsHtml() {
      const h = d.heists;
      if (!h.on) return '';
      const c = h.cfg;
      const rows = h.mostWanted
        .map((w, i) => {
          const me = w.username === d.username;
          const canTry = loggedIn && !me && w.points > d.points && !w.protectedFor;
          return `<tr>
            <td>${i + 1}</td>
            <td><a href="${playerLink(w.username)}">${esc(w.username)}</a></td>
            <td class="num">${fmt(w.points)}</td>
            <td class="num">${fmt(w.take)}</td>
            <td>${w.guards ? '🛡️'.repeat(w.guards) : '<span class="muted">none</span>'}</td>
            <td>${w.protectedFor ? `<span class="muted">on guard ${mins(w.protectedFor)}</span>` : me ? '<span class="muted">you</span>' : w.chance !== null ? `🥷 ${w.chance}% · ⚔️ ${FIGHT[w.fight] || ''}` : ''}</td>
            <td>${canTry ? `<button class="btn btn-sm btn-primary" data-rob="${esc(w.username)}">Rob</button>` : ''}</td>
          </tr>`;
        })
        .join('');
      const mine = h.me;
      return `<section class="panel">
        <div class="panel-head"><h2>🦹 Heists</h2>${loggedIn ? `<span class="badge gold">💰 ${fmt(d.points)} pts</span>` : ''}</div>
        <p class="muted" style="margin-top:0">Rob players richer than you with <code>!rob @name</code> (1 stamina). First a <b>🥷 stealth check</b>: your 🏃 Agility against theirs (each guard they hire cuts it by 12%). Slip in unseen and you take ${pct(c.stealPct)} of their points (up to ${fmt(c.maxSteal)}). If they spot you, you <b>⚔️ fight</b>: combat level, weapon skill and gear on both sides, you on your current HP, them backed up by their guards (+${pct(c.guardFight)} attack and defence each). Win and you grab ${pct(c.mugPct)} of the haul; lose and you're left on 1 HP, pay a fine of ${pct(c.finePct)} of your points (half to them) and lie low for ${c.jailMinutes}m. The fence keeps ${pct(c.fencePct)} of every haul. A robbed player is safe for ${c.protectMinutes}m.</p>
        ${
          mine
            ? `<div class="form-row" style="flex-wrap:wrap;align-items:center;margin-bottom:12px">
                <b>Your guards:</b> ${mine.guards ? `${'🛡️'.repeat(mine.guards)} for ${mins(mine.guardsUntil - Date.now())}` : '<span class="muted">none</span>'}
                ${[1, 2, 3].map((n) => `<button class="btn btn-sm" data-guards="${n}">Hire ${n} (${fmt(mine.guardPrices[n - 1])} pts / 24h)</button>`).join('')}
                ${mine.jailFor ? `<span class="muted">🚔 lying low for ${mins(mine.jailFor)}</span>` : ''}
              </div>`
            : ''
        }
        <h3 style="margin:8px 0">Most wanted</h3>
        ${
          rows
            ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th class="num">Points</th><th class="num">A heist takes</th><th>Guards</th><th>${loggedIn ? 'Stealth · if it comes to a fight' : ''}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
            : `<div class="empty"><span class="ic">🦹</span>Nobody holds ${fmt(c.minTarget)}+ points yet.</div>`
        }
        <h3 style="margin:16px 0 8px">Recent heists</h3>
        ${
          h.log.length
            ? `<ul class="hall-list">${h.log
                .map((l) => {
                  const what = l.ok
                    ? l.how === 'fight'
                      ? `fought past <b>${esc(l.victim)}</b> and took ${fmt(l.amount)} pts`
                      : `snuck in and robbed <b>${esc(l.victim)}</b> for ${fmt(l.amount)} pts`
                    : l.how === 'escaped'
                      ? `was fought off by <b>${esc(l.victim)}</b> and fled empty-handed`
                      : `lost a fight robbing <b>${esc(l.victim)}</b> (fined ${fmt(l.amount)})`;
                  return `<li>${l.ok ? (l.how === 'fight' ? '⚔️' : '🥷') : '🚔'} <b>${esc(l.robber)}</b> ${what} <span class="muted">${ago(l.at)}</span></li>`;
                })
                .join('')}</ul>`
            : '<p class="muted">No heists yet.</p>'
        }
      </section>`;
    }

    function arenaHtml() {
      const a = d.arena;
      if (!a.on) return '';
      return `<section class="panel">
        <div class="panel-head"><h2>🏟️ Ranked arena</h2><span class="badge gold">Pot ${fmt(a.pot)} pts</span></div>
        <p class="muted" style="margin-top:0"><code>!arena</code> fights the player closest to your rating with both of your best gear (they don't need to be online). ${fmt(a.fee)} pts entry into the weekly pot, 1 stamina, ${a.perDay} ranked fights a day. On Monday the top 3 split the pot 50/30/20 and #1 earns the <b>Arena Champion</b> title; ratings then move halfway back to 1,000.</p>
        ${loggedIn ? `<div class="form-row" style="margin-bottom:12px"><button class="btn btn-primary" id="arena-fight">⚔️ Ranked fight</button>${a.me ? `<span class="muted">You: <b>${a.me.rating}</b> (${a.me.wins}W ${a.me.losses}L)</span>` : '<span class="muted">Everyone starts at 1,000.</span>'}</div>` : ''}
        ${
          a.ladder.length
            ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th class="num">Rating</th><th class="num">W</th><th class="num">L</th></tr></thead><tbody>${a.ladder
                .map((r) => `<tr><td>${r.rank}</td><td><a href="${playerLink(r.username)}">${esc(r.username)}</a></td><td class="num"><b>${r.rating}</b></td><td class="num">${r.wins}</td><td class="num">${r.losses}</td></tr>`)
                .join('')}</tbody></table></div>`
            : '<div class="empty"><span class="ic">🏟️</span>No ranked fights yet this week.</div>'
        }
        ${a.last?.results?.length ? `<p class="muted" style="margin-bottom:0">Last week: ${a.last.results.map((r, i) => `${['🥇', '🥈', '🥉'][i]} ${esc(r.username)} (${r.rating}${r.prize ? `, ${fmt(r.prize)} pts` : ''})`).join(' · ')}</p>` : ''}
      </section>`;
    }

    function warHtml() {
      const w = d.war;
      if (!w.on) return '';
      const buff = w.last && w.last.buffUntil > Date.now();
      return `<section class="panel">
        <div class="panel-head"><h2>⚔️ Guild war</h2><span class="muted">ends Monday</span></div>
        <p class="muted" style="margin-top:0">Guilds score war points when a member beats someone from another guild: a ranked arena win is 3, a heist 2, a duel 1. The winning guild's members get <b>+${pct(w.bonus)} XP</b> all next week, and its top scorer earns the <b>Warlord</b> title.</p>
        ${buff ? `<p>🏆 Last week's winner: <b>[${esc(w.last.tag)}] ${esc(w.last.name)}</b> (${fmt(w.last.score)} pts${w.last.hero ? `, Warlord ${esc(w.last.hero)}` : ''}): +${pct(w.bonus)} XP this week.</p>` : ''}
        ${
          w.standings.length
            ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Guild</th><th class="num">War points</th><th>Top fighter</th></tr></thead><tbody>${w.standings
                .map((g) => `<tr><td>${g.rank}</td><td>[${esc(g.tag)}] ${esc(g.name)}</td><td class="num"><b>${fmt(g.score)}</b></td><td>${g.hero ? esc(g.hero) : ''}</td></tr>`)
                .join('')}</tbody></table></div>`
            : '<div class="empty"><span class="ic">⚔️</span>No war points yet this week. <a href="#/guilds">Join a guild</a> and start fighting.</div>'
        }
      </section>`;
    }

    // ---- The crime update: jobs, the wanted board, the jail and protection rackets.
    function crimeHtml() {
      const c = d.crime;
      if (!c) return '';
      const cfg = c.cfg;
      const me = c.me;
      const status = me
        ? [
            me.jailFor ? `🚔 You're in jail for <b>${mins(me.jailFor)}</b>. <button class="btn btn-sm" data-crime="bail">Pay ${fmt(me.bail)} pts bail</button>` : '',
            me.protectedBy ? `🛡️ Protected by <b>[${esc(me.protectedBy.tag)}]</b> for ${mins(me.protectedBy.for)}.` : '',
            me.wantedOnMe ? `🎯 There's a <b>${fmt(me.wantedOnMe)} pts</b> bounty on your head.` : '',
          ]
            .filter(Boolean)
            .map((x) => `<div class="crime-status">${x}</div>`)
            .join('')
        : '';
      const jobs = [
        cfg.pickpocket && ['pickpocket', '🧤 Pickpocket', 'Lift 1-3 of a random item from their backpack (never gear, tools or pets).'],
        cfg.poach && ['poach', '🌾 Poach crops', 'Steal up to 3 ripe crops from their farm. A 🎃 Scarecrow makes it harder.'],
        cfg.burglary && ['burgle', '🏚️ Burgle shop', 'Take up to 3 of something off their shop shelf. Bigger shops have better locks.'],
        cfg.tipoffs && ['tipoff', '🐀 Tip off', '100 pts: if they try a crime in the next 10 minutes, the guards are waiting and you get a quarter of the fine. Anonymous from here.'],
      ].filter(Boolean);
      return `
        <section class="panel crime-panel">
          <div class="panel-head"><h2>🦹 Crime</h2><span class="muted">1 stamina per job · caught = fine + jail</span></div>
          ${status}
          ${
            loggedIn && jobs.length
              ? `<div class="crime-jobs">
                  <input type="text" id="crime-target" placeholder="@name" autocomplete="off" aria-label="Target" list="crime-names">
                  <datalist id="crime-names">${d.heists.mostWanted.map((w) => `<option value="${esc(w.username)}">`).join('')}</datalist>
                  <div class="crime-btns">${jobs.map(([id, label, help]) => `<button class="btn" data-job="${id}" title="${esc(help)}">${label}</button>`).join('')}</div>
                </div>
                <ul class="crime-help muted">${jobs.map(([, label, help]) => `<li><b>${label}</b>: ${esc(help)}</li>`).join('')}<li>Players under character level ${cfg.minLevel} are off limits. Up to ${cfg.dailyCrimes} jobs a day.</li></ul>`
              : ''
          }
          <div class="grid grid-2" style="margin-top:12px">
            ${
              cfg.wanted
                ? `<div>
                    <h3>🎯 Wanted</h3>
                    ${
                      c.wanted.length
                        ? `<table class="fx-table"><tbody>${c.wanted.map((w) => `<tr><td><a href="${playerLink(w.username)}">${esc(w.username)}</a></td><td class="num"><b>${fmt(w.total)}</b> pts</td><td class="muted">${w.posters} poster${w.posters === 1 ? '' : 's'}</td></tr>`).join('')}</tbody></table>`
                        : '<p class="muted">The board is empty.</p>'
                    }
                    <p class="muted" style="font-size:.85rem">Beat a wanted player in a heist fight, the arena or the Gloamveil (or catch them in the act) to collect 90% of the bounty. Only players who committed a crime this week can be posted.</p>
                    ${loggedIn ? `<form id="wanted-form" class="form-row"><input type="text" name="name" placeholder="@name" aria-label="Who" style="max-width:140px"><input name="amount" type="number" min="${cfg.wantedMin}" placeholder="${cfg.wantedMin}" aria-label="Bounty" style="max-width:120px"><button class="btn">Post bounty</button></form>` : ''}
                  </div>`
                : ''
            }
            <div>
              ${
                cfg.jailbreak
                  ? `<h3>🚔 Jail</h3>${
                      c.jail.length
                        ? `<table class="fx-table"><tbody>${c.jail.map((j) => `<tr><td><a href="${playerLink(j.username)}">${esc(j.username)}</a></td><td class="muted">${mins(j.for)} left</td><td>${loggedIn && j.username !== d.username ? `<button class="btn btn-sm" data-break="${esc(j.username)}">🔓 Break out</button>` : ''}</td></tr>`).join('')}</tbody></table>`
                        : '<p class="muted">Nobody is locked up.</p>'
                    }<p class="muted" style="font-size:.85rem">Breakouts use Agility (guildmates +10%). Fail and you're in the next cell.</p>`
                  : ''
              }
              ${
                cfg.rackets
                  ? `<h3>🛡️ Protection</h3>${
                      c.rackets.length
                        ? `<table class="fx-table"><tbody>${c.rackets.map((r) => `<tr><td>[${esc(r.tag)}] ${esc(r.name)}</td><td class="num">${fmt(r.price)}/day</td><td class="muted">${r.enforcer ? `enforcer ${esc(r.enforcer)}` : ''}</td><td>${loggedIn ? `<button class="btn btn-sm" data-racket="${esc(r.tag)}">Buy</button>` : ''}</td></tr>`).join('')}</tbody></table>`
                        : '<p class="muted">No guild sells protection right now.</p>'
                    }<p class="muted" style="font-size:.85rem">Anyone who comes for a client has to beat the guild's strongest member first.</p>${
                      me?.leaderOf
                        ? `<form id="racket-form" class="form-row"><input name="price" type="number" min="0" max="${cfg.racketMax}" value="${me.leaderOf.price || ''}" placeholder="price/day (0 = stop)" aria-label="Protection price" style="max-width:170px"><button class="btn">Set [${esc(me.leaderOf.tag)}] price</button></form>`
                        : ''
                    }`
                  : ''
              }
            </div>
          </div>
        </section>`;
    }

    function draw() {
      $app.innerHTML = `
        <div class="panel-head" style="margin-bottom:6px"><h1 style="margin:0">⚔️ PvP</h1>${
          !loggedIn ? '<a class="btn btn-primary" href="/auth/login">Log in with Kick to play</a>' : ''
        }</div>
        <p class="muted">Take on other players: rob the rich, climb the ranked arena and win the guild war. Duels (<code>!duel @name 500</code>) still work in chat.</p>
        <div class="pvp-grid">${heistsHtml()}${crimeHtml()}${arenaHtml()}${warHtml()}</div>`;
      const target = () => ($app.querySelector('#crime-target')?.value || '').trim().replace(/^@/, '');
      $app.querySelectorAll('[data-job]').forEach((b) => {
        b.onclick = () => {
          if (!target()) return toast('Who? Type a name first.');
          post(`/pvp/crime/${b.dataset.job}`, { name: target() });
        };
      });
      $app.querySelectorAll('[data-crime]').forEach((b) => (b.onclick = () => post(`/pvp/crime/${b.dataset.crime}`, {})));
      $app.querySelectorAll('[data-break]').forEach((b) => (b.onclick = () => post('/pvp/crime/jailbreak', { name: b.dataset.break })));
      $app.querySelectorAll('[data-racket]').forEach((b) => {
        b.onclick = () => {
          if (confirm(`Buy [${b.dataset.racket}]'s protection for 24 hours?`)) post('/pvp/crime/racket-buy', { tag: b.dataset.racket });
        };
      });
      const wf = $app.querySelector('#wanted-form');
      if (wf) wf.onsubmit = (e) => {
        e.preventDefault();
        post('/pvp/crime/wanted', { name: wf.querySelector('[name=name]').value.trim().replace(/^@/, ''), amount: wf.querySelector('[name=amount]').value });
      };
      const rf = $app.querySelector('#racket-form');
      if (rf) rf.onsubmit = (e) => {
        e.preventDefault();
        post('/pvp/crime/racket-price', { price: rf.price.value || 0 });
      };
      $app.querySelectorAll('[data-rob]').forEach((b) => {
        b.onclick = () => {
          if (confirm(`Try to rob ${b.dataset.rob}? It uses 1 stamina, and if you're caught you pay a fine.`)) post('/pvp/rob', { name: b.dataset.rob });
        };
      });
      $app.querySelectorAll('[data-guards]').forEach((b) => {
        b.onclick = () => post('/pvp/guards', { guards: b.dataset.guards });
      });
      const fight = $app.querySelector('#arena-fight');
      if (fight) fight.onclick = () => post('/pvp/arena', {});
    }
    draw();
  };
})();
