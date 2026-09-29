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
            <td>${w.protectedFor ? `<span class="muted">on guard ${mins(w.protectedFor)}</span>` : me ? '<span class="muted">you</span>' : w.chance !== null ? `${w.chance}%` : ''}</td>
            <td>${canTry ? `<button class="btn btn-sm btn-primary" data-rob="${esc(w.username)}">Rob</button>` : ''}</td>
          </tr>`;
        })
        .join('');
      const mine = h.me;
      return `<section class="panel">
        <div class="panel-head"><h2>🦹 Heists</h2>${loggedIn ? `<span class="badge gold">💰 ${fmt(d.points)} pts</span>` : ''}</div>
        <p class="muted" style="margin-top:0">Rob players richer than you with <code>!rob @name</code> (1 stamina). Pull it off and you take ${pct(c.stealPct)} of their points (up to ${fmt(c.maxSteal)}); the fence keeps ${pct(c.fencePct)} of it. Get caught and you pay a fine of ${pct(c.finePct)} of your own points (half to them) and lie low for ${c.jailMinutes}m. A robbed player is safe for ${c.protectMinutes}m. Your 🏃 Agility against theirs sets the odds, and each guard they hire cuts them by 12%.</p>
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
            ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th class="num">Points</th><th class="num">A heist takes</th><th>Guards</th><th>${loggedIn ? 'Your odds' : ''}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
            : `<div class="empty"><span class="ic">🦹</span>Nobody holds ${fmt(c.minTarget)}+ points yet.</div>`
        }
        <h3 style="margin:16px 0 8px">Recent heists</h3>
        ${
          h.log.length
            ? `<ul class="hall-list">${h.log
                .map((l) => `<li>${l.ok ? '🦹' : '🚔'} <b>${esc(l.robber)}</b> ${l.ok ? `robbed <b>${esc(l.victim)}</b> for ${fmt(l.amount)} pts` : `got caught robbing <b>${esc(l.victim)}</b> (fined ${fmt(l.amount)})`} <span class="muted">${ago(l.at)}</span></li>`)
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

    function draw() {
      $app.innerHTML = `
        <div class="panel-head" style="margin-bottom:6px"><h1 style="margin:0">⚔️ PvP</h1>${
          !loggedIn ? '<a class="btn btn-primary" href="/auth/login">Log in with Kick to play</a>' : ''
        }</div>
        <p class="muted">Take on other players: rob the rich, climb the ranked arena and win the guild war. Duels (<code>!duel @name 500</code>) still work in chat.</p>
        <div class="pvp-grid">${heistsHtml()}${arenaHtml()}${warHtml()}</div>`;
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
