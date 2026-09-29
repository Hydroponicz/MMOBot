// Relic cases page (#/relics): open cases on a spinning reel, inspect floats and patterns, trade-up
// contracts, the relic market and trades. Outcomes come from the server; this file draws them.
// app.js calls window.MMORelics($app, helpers, query).
(() => {
  let tab = 'cases';
  let openCaseId = null;
  let tuRarity = 'adept';
  let tuSoul = false;
  const invFilters = { case: '', rarity: '', sort: 'value', q: '' };
  const mkFilters = { rarity: '', sort: 'newest', q: '' };
  let sound = (() => {
    try {
      return localStorage.getItem('relicSound') !== 'off';
    } catch {
      return true;
    }
  })();

  // ---- Weapon skins as SVG --------------------------------------------------------------------
  // Deterministic random numbers from the pattern seed, so the same relic always looks the same.
  const prng = (seed) => {
    let a = (Number(seed) + 1) * 2654435761;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const strHash = (s) => {
    let h = 7;
    for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h;
  };

  // Each weapon: the skinned part (blade/head) and the plain parts (grip, guard, shaft), in a 240×100 box.
  const WOOD = '#5a3b22';
  const STEEL = '#8c939c';
  const DARK = '#2a2622';
  const SHAPES = {
    sword: {
      skin: 'M64,44 L200,44 L224,50 L200,56 L64,56 Z',
      parts: `<rect x="22" y="46" width="38" height="8" rx="2" fill="${DARK}"/><circle cx="17" cy="50" r="6" fill="${STEEL}"/><rect x="58" y="33" width="7" height="34" rx="2" fill="${STEEL}"/>`,
    },
    greatsword: {
      skin: 'M70,39 L205,39 L234,50 L205,61 L70,61 Z',
      parts: `<rect x="12" y="46" width="52" height="8" rx="2" fill="${DARK}"/><circle cx="8" cy="50" r="6" fill="${STEEL}"/><rect x="62" y="24" width="9" height="52" rx="3" fill="${STEEL}"/>`,
    },
    dagger: {
      skin: 'M108,44 L170,44 L192,50 L170,56 L108,56 Z',
      parts: `<rect x="62" y="45" width="40" height="10" rx="3" fill="${DARK}"/><circle cx="58" cy="50" r="6" fill="${STEEL}"/><rect x="101" y="36" width="7" height="28" rx="2" fill="${STEEL}"/>`,
    },
    fang: {
      skin: 'M112,47 Q162,26 196,60 Q160,44 114,60 Z',
      parts: `<circle cx="60" cy="62" r="11" fill="none" stroke="${STEEL}" stroke-width="5"/><path d="M68,55 L114,46 L116,61 L72,68 Z" fill="${DARK}"/>`,
    },
    saber: {
      skin: 'M64,45 Q150,40 228,24 Q170,52 64,56 Z',
      parts: `<rect x="22" y="46" width="38" height="8" rx="2" fill="${DARK}"/><circle cx="17" cy="50" r="6" fill="${STEEL}"/><ellipse cx="62" cy="50" rx="5" ry="15" fill="${STEEL}"/>`,
    },
    axe: {
      skin: 'M156,48 L166,18 Q210,28 206,50 Q210,72 166,82 L156,52 Z',
      parts: `<rect x="18" y="46" width="176" height="8" rx="3" fill="${WOOD}"/>`,
    },
    hammer: {
      skin: 'M166,22 L214,22 Q220,22 220,28 L220,72 Q220,78 214,78 L166,78 Q160,78 160,72 L160,28 Q160,22 166,22 Z',
      parts: `<rect x="18" y="46" width="146" height="8" rx="3" fill="${WOOD}"/>`,
    },
    staff: {
      skin: 'M14,47 L186,47 L186,53 L14,53 Z M210,32 A18,18 0 1 1 209.9,32 Z',
      parts: `<path d="M184,40 L196,34 M184,60 L196,66" stroke="${STEEL}" stroke-width="4" stroke-linecap="round"/>`,
    },
    bow: {
      skin: 'M132,4 Q48,50 132,96 L124,96 Q66,50 124,4 Z',
      parts: `<line x1="130" y1="6" x2="130" y2="94" stroke="#e8e0cc" stroke-width="1.2"/><rect x="84" y="42" width="10" height="16" rx="3" fill="${DARK}"/>`,
    },
    scythe: {
      skin: 'M192,50 Q204,6 104,8 Q170,22 182,50 Z',
      parts: `<rect x="14" y="46" width="184" height="8" rx="3" fill="${WOOD}"/>`,
    },
    spear: {
      skin: 'M180,40 L234,50 L180,60 L188,50 Z',
      parts: `<rect x="10" y="47" width="176" height="6" rx="3" fill="${WOOD}"/><rect x="176" y="45" width="8" height="10" fill="${STEEL}"/>`,
    },
    glaive: {
      skin: 'M160,38 Q218,28 234,50 Q218,72 160,62 Z',
      parts: `<rect x="10" y="47" width="156" height="6" rx="3" fill="${WOOD}"/><rect x="156" y="42" width="8" height="16" rx="2" fill="${STEEL}"/>`,
    },
    shield: {
      skin: 'M120,4 L172,16 Q172,70 120,96 Q68,70 68,16 Z',
      parts: '',
    },
  };

  let uid = 0;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

  // The pattern drawn inside the skinned shape.
  function patternLayer(r, id, rand) {
    const [c1, c2, c3] = r.colors;
    const out = { defs: '', body: '' };
    const noise = (freq, oct, type = 'turbulence') => {
      const cols = [hex(c1), hex(c2), hex(c3)];
      const tv = (k) => cols.map((c) => c[k].toFixed(3)).join(' ');
      out.defs += `<filter id="n${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="${type}" baseFrequency="${freq}" numOctaves="${oct}" seed="${r.seed}"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="table" tableValues="${tv(0)}"/><feFuncG type="table" tableValues="${tv(1)}"/><feFuncB type="table" tableValues="${tv(2)}"/><feFuncA type="table" tableValues="1 1"/></feComponentTransfer></filter>`;
      out.body += `<rect width="240" height="100" filter="url(#n${id})"/>`;
    };
    switch (r.finish) {
      case 'fade': {
        const f = r.fade ? (r.fade - 80) / 20 : 0.5;
        out.defs += `<linearGradient id="g${id}" x1="0" x2="1" y1="0.2" y2="0.8"><stop offset="0" stop-color="${c1}"/><stop offset="${(0.1 + f * 0.25).toFixed(2)}" stop-color="${c1}"/><stop offset="${(0.55 - f * 0.05).toFixed(2)}" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/></linearGradient>`;
        out.body += `<rect width="240" height="100" fill="url(#g${id})"/>`;
        break;
      }
      case 'camo': {
        out.body += `<rect width="240" height="100" fill="${c1}"/>`;
        for (let i = 0; i < 22; i++) {
          out.body += `<ellipse cx="${(rand() * 240).toFixed(0)}" cy="${(rand() * 100).toFixed(0)}" rx="${(8 + rand() * 18).toFixed(0)}" ry="${(5 + rand() * 10).toFixed(0)}" transform="rotate(${(rand() * 180).toFixed(0)} 120 50)" fill="${i % 2 ? c2 : c3}" opacity=".9"/>`;
        }
        break;
      }
      case 'stripes': {
        out.body += `<rect width="240" height="100" fill="${c1}"/>`;
        for (let x = -30; x < 260; x += 14 + rand() * 12) {
          const w = 4 + rand() * 7;
          const lean = 20 + rand() * 30;
          out.body += `<path d="M${x},0 L${x + w},0 L${x + w + lean},100 L${x + lean},100 Z" fill="${rand() < 0.6 ? c2 : c3}"/>`;
        }
        break;
      }
      case 'solid':
        out.defs += `<linearGradient id="g${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c3}"/><stop offset=".45" stop-color="${c2}"/><stop offset="1" stop-color="${c1}"/></linearGradient>`;
        out.body += `<rect width="240" height="100" fill="url(#g${id})"/>`;
        break;
      case 'marble':
        noise('0.018 0.05', 4);
        break;
      case 'gem':
        noise('0.03 0.06', 3, 'fractalNoise');
        for (let i = 0; i < 14; i++) out.body += `<circle cx="${(rand() * 240).toFixed(0)}" cy="${(rand() * 100).toFixed(0)}" r="${(0.6 + rand() * 1.4).toFixed(1)}" fill="#fff" opacity="${(0.4 + rand() * 0.5).toFixed(2)}"/>`;
        break;
      case 'flame': {
        out.body += `<rect width="240" height="100" fill="${c1}"/>`;
        for (let i = 0; i < 9; i++) {
          const y = rand() * 100;
          const len = 90 + rand() * 150;
          const amp = 6 + rand() * 12;
          out.body += `<path d="M-10,${y.toFixed(0)} Q${(len * 0.3).toFixed(0)},${(y - amp).toFixed(0)} ${(len * 0.55).toFixed(0)},${(y + amp * 0.4).toFixed(0)} T${len.toFixed(0)},${(y - amp * 0.2).toFixed(0)} L${(len * 0.5).toFixed(0)},${(y + amp).toFixed(0)} Q${(len * 0.2).toFixed(0)},${(y + amp * 1.2).toFixed(0)} -10,${(y + amp * 1.4).toFixed(0)} Z" fill="${i % 3 ? c2 : c3}" opacity=".85"/>`;
        }
        break;
      }
      case 'crystal': {
        const pts = [];
        for (let y = -10; y <= 110; y += 22) for (let x = -10; x <= 250; x += 26) pts.push([x + (rand() - 0.5) * 18, y + (rand() - 0.5) * 16]);
        const cols = 11;
        const cs = [c1, c2, c3];
        for (let i = 0; i + cols + 1 < pts.length; i++) {
          if ((i + 1) % cols === 0) continue;
          const [a, b, c, d] = [pts[i], pts[i + 1], pts[i + cols], pts[i + cols + 1]];
          out.body += `<path d="M${a} L${b} L${c}Z" fill="${cs[Math.floor(rand() * 3)]}"/><path d="M${b} L${d} L${c}Z" fill="${cs[Math.floor(rand() * 3)]}"/>`;
        }
        break;
      }
      case 'glyph': {
        out.defs += `<linearGradient id="g${id}" x1="0" x2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient><filter id="glow${id}"><feGaussianBlur stdDeviation="1.4"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
        out.body += `<rect width="240" height="100" fill="url(#g${id})"/>`;
        const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
        let txt = '';
        for (let y = 12; y < 100; y += 16) {
          for (let x = 6 + (y % 32 ? 8 : 0); x < 240; x += 16 + rand() * 10) txt += `<text x="${x.toFixed(0)}" y="${y}" font-size="11">${runes[Math.floor(rand() * runes.length)]}</text>`;
        }
        out.body += `<g fill="${c3}" filter="url(#glow${id})" font-family="serif">${txt}</g>`;
        break;
      }
      case 'scales': {
        out.defs += `<pattern id="p${id}" width="12" height="10" patternUnits="userSpaceOnUse" patternTransform="translate(${(rand() * 12).toFixed(1)} 0)"><rect width="12" height="10" fill="${c1}"/><path d="M0,10 A6,6 0 0 1 12,10" fill="${c2}" stroke="${c3}" stroke-width="1"/><path d="M-6,5 A6,6 0 0 1 6,5 M6,5 A6,6 0 0 1 18,5" fill="${c2}" stroke="${c3}" stroke-width="1"/></pattern>`;
        out.body += `<rect width="240" height="100" fill="url(#p${id})"/>`;
        break;
      }
      default:
        out.body += `<rect width="240" height="100" fill="${c2}"/>`;
    }
    return out;
  }

  function wearLayer(r, rand) {
    const f = r.float;
    let s = '';
    const n = Math.floor(f * 70);
    for (let i = 0; i < n; i++) {
      const x = rand() * 240;
      const y = rand() * 100;
      const len = 3 + rand() * 14;
      const a = rand() * Math.PI;
      s += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + Math.cos(a) * len).toFixed(1)}" y2="${(y + Math.sin(a) * len).toFixed(1)}" stroke="#d8d8d8" stroke-width="${(0.4 + rand() * 0.8).toFixed(2)}" opacity="${(0.25 + rand() * 0.4).toFixed(2)}"/>`;
    }
    // Paint worn away down to grey metal on well-used relics.
    for (let i = 0; i < Math.floor(Math.max(0, f - 0.3) * 30); i++) {
      s += `<ellipse cx="${(rand() * 240).toFixed(0)}" cy="${(rand() * 100).toFixed(0)}" rx="${(2 + rand() * 7).toFixed(1)}" ry="${(1 + rand() * 4).toFixed(1)}" fill="#9aa0a6" opacity=".75"/>`;
    }
    return s;
  }

  // r: a relic (or a catalog skin with no float/seed). Returns an <svg>.
  function relicSvg(r, cls = '') {
    const shape = SHAPES[r.weapon] || SHAPES.sword;
    const id = `rl${++uid}`;
    const seed = r.seed ?? 500;
    const rand = prng(seed * 7919 + strHash(r.skin || r.id));
    const pat = patternLayer({ ...r, seed }, id, rand);
    const wear = r.float != null ? wearLayer(r, prng(seed + strHash(r.skin || r.id) + 99)) : '';
    return `<svg class="relic-svg ${cls}" viewBox="0 0 240 100" aria-hidden="true">
      <defs><clipPath id="c${id}"><path d="${shape.skin}"/></clipPath>${pat.defs}
        <linearGradient id="sh${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient></defs>
      ${shape.parts}
      <g clip-path="url(#c${id})">${pat.body}${wear}<rect width="240" height="100" fill="url(#sh${id})"/></g>
      <path d="${shape.skin}" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="1.2"/>
    </svg>`;
  }

  window.MMORelics = async ($app, { api, toast, esc, fmt, state, ago, playerLink }, query) => {
    let data = await api('/relics');
    const cat = data.catalog;
    const loggedIn = data.points !== null;
    const RAR = cat.rarities;
    const CASES = Object.fromEntries(cat.cases.map((c) => [c.id, c]));
    if (query?.get('tab')) tab = query.get('tab');
    const cleanups = [];
    if (!data.open) {
      $app.innerHTML = `<div class="panel empty"><span class="ic">🧰</span>Relic cases are closed right now.</div>`;
      return;
    }
    const bankNote = (pay) => {
      const parts = [];
      if (data.bankLeft != null) parts.push(pay > data.bankLeft ? `The bank can only pay ${fmt(data.bankLeft)} more pts today. List it on the market instead, or try tomorrow.` : `Bank limit: ${fmt(data.bankLeft)} pts left today.`);
      if (cat.bankFullValue) parts.push(`Value above ${fmt(cat.bankFullValue)} pts is bought at a fifth of the rate.`);
      return parts.length ? `<p class="muted" style="font-size:.85rem;margin:6px 0 0">${parts.join(' ')}</p>` : '';
    };
    const pct = (x) => (x >= 0.1 ? `${(x * 100).toFixed(1)}%` : x >= 0.01 ? `${(x * 100).toFixed(2)}%` : `${(x * 100).toFixed(3)}%`);
    const soulTag = (r) => (r.soul ? `<span class="soultrak" title="SoulTrak™: counts monsters you defeat while showcased">☠ ${fmt(r.kills)}</span>` : '');

    // A relic tile: rarity-coloured, skin, name, exterior.
    function tile(r, { extra = '', cls = '' } = {}) {
      return `<div class="rtile r-${r.rarity} ${cls}" style="--rc:${r.color || RAR[r.rarity].color}" data-id="${r.id ?? ''}">
        <div class="rtile-art">${relicSvg(r)}${soulTag(r)}${r.rarePattern ? '<span class="rare-pat" title="Rare pattern">✨</span>' : ''}</div>
        <div class="rtile-name"><small>${r.soul ? '<b class="st">SoulTrak™</b> ' : ''}${r.star ? '★ ' : ''}${esc(r.weaponName)}</small><b>${esc(r.name)}</b></div>
        ${r.exterior ? `<div class="rtile-meta"><span>${r.exteriorShort}</span><span>${r.float.toFixed(4)}</span>${r.pattern ? `<span class="${r.rarePattern ? 'gold' : ''}">${esc(r.pattern)}</span>` : ''}</div>` : ''}
        ${extra}
      </div>`;
    }
    // The gold "rare special item" slot, as the real reel shows it.
    const starTile = () => `<div class="rtile r-relic star-mystery" style="--rc:${RAR.relic.color}"><div class="rtile-art"><span class="star-big">★</span></div><div class="rtile-name"><small>Exceedingly rare</small><b>★ Special Relic</b></div></div>`;

    const post = async (path, body = {}) => {
      try {
        return await api(path, { method: 'POST', body });
      } catch (err) {
        toast(err.message);
        return null;
      }
    };
    const refresh = async () => {
      data = await api('/relics');
      draw();
    };
    const setBalance = (b) => {
      if (b == null) return;
      data.points = b;
      const el = $app.querySelector('#rl-balance');
      if (el) el.textContent = fmt(b);
    };

    // Same unlock explanation as the card market (new players wait a while before trading).
    function tradeLock(what) {
      const st = data.marketStatus;
      if (!st?.blocked) return '';
      if (st.off) return `<div class="lock-box"><b>🔒 Trading is switched off right now.</b><p>The streamer has paused the market and trades. You can still open cases, trade up and sell to the bank.</p></div>`;
      const bar = (have, need) => `<div class="raid-bar"><span style="width:${Math.min(100, (have / need) * 100)}%"></span></div>`;
      const rows = [];
      if (st.needActions) rows.push(`<li class="${st.actions >= st.needActions ? 'done' : ''}"><div>${st.actions >= st.needActions ? '✅' : '🎮'} <b>${st.actions}/${st.needActions}</b> game actions in chat${st.actions >= st.needActions ? '' : ` (${st.needActions - st.actions} to go: <code>!fish</code>, <code>!mine</code>, <code>!chop</code>…)`}</div>${bar(st.actions, st.needActions)}</li>`);
      if (st.needHours) {
        const left = st.hoursLeft >= 1 ? `${Math.ceil(st.hoursLeft)}h left` : `${Math.max(1, Math.ceil(st.hoursLeft * 60))} min left`;
        rows.push(`<li class="${st.hoursLeft <= 0 ? 'done' : ''}"><div>${st.hoursLeft <= 0 ? '✅' : '⏳'} <b>${st.needHours}h</b> since you first chatted${st.hoursLeft > 0 ? ` (${left})` : ''}</div>${bar(st.needHours - st.hoursLeft, st.needHours)}</li>`);
      }
      return `<div class="lock-box"><b>🔒 You can't ${what} yet</b><p>New players unlock the market and trades once both of these are done. It stops throwaway accounts from passing points around.</p><ul>${rows.join('')}</ul><p>Until then you can open cases, sign trade-up contracts and sell relics to the bank.</p></div>`;
    }

    // ---- Overlay ------------------------------------------------------------------------------
    function overlay(html, cls = '') {
      const o = document.createElement('div');
      o.className = `cd-overlay ${cls}`;
      o.innerHTML = `<div class="cd-modal">${html}</div>`;
      document.body.appendChild(o);
      document.body.classList.add('cd-noscroll');
      const onKey = (e) => e.key === 'Escape' && close();
      const close = () => {
        o.remove();
        document.removeEventListener('keydown', onKey);
        if (!document.querySelector('.cd-overlay')) document.body.classList.remove('cd-noscroll');
      };
      o.addEventListener('click', (e) => {
        if (e.target === o || e.target.closest('[data-close]')) close();
      });
      document.addEventListener('keydown', onKey);
      cleanups.push(close);
      return { el: o, close };
    }
    function burst(el, colors) {
      const rect = el.getBoundingClientRect();
      for (let i = 0; i < 40; i++) {
        const s = document.createElement('i');
        s.className = 'cd-spark';
        const a = Math.random() * Math.PI * 2;
        const d = 80 + Math.random() * 200;
        s.style.cssText = `left:${rect.left + rect.width / 2}px;top:${rect.top + rect.height / 2}px;background:${colors[i % colors.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px`;
        document.body.appendChild(s);
        setTimeout(() => s.remove(), 1100);
      }
    }

    // A tiny click for each tile that passes the marker.
    let audio = null;
    const tick = (pitch = 1) => {
      if (!sound) return;
      try {
        audio ??= new (window.AudioContext || window.webkitAudioContext)();
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.type = 'square';
        o.frequency.value = 1800 * pitch;
        g.gain.setValueAtTime(0.04, audio.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.03);
        o.connect(g).connect(audio.destination);
        o.start();
        o.stop(audio.currentTime + 0.035);
      } catch {
        /* no audio */
      }
    };

    // ---- Opening: the reel ------------------------------------------------------------------------
    const WIN_AT = 52;
    function reelItems(c, winner) {
      // Filler tiles follow the real odds, so blues fly past and gold is a rare flash.
      const byRarity = {};
      for (const s of c.skins) (byRarity[s.rarity] ||= []).push(s);
      const pickRandom = () => {
        let x = Math.random();
        for (const r of Object.keys(RAR)) {
          if (x < RAR[r].odds * (r === 'relic' ? 1.5 : 1) || r === 'relic') {
            if (r === 'relic') return null;
            const pool = byRarity[r];
            return { ...pool[Math.floor(Math.random() * pool.length)], color: RAR[r].color };
          }
          x -= RAR[r].odds;
        }
        return null;
      };
      // While spinning, the winning tile is drawn exactly like the filler: the plain catalog skin, with no
      // float, exterior, SoulTrak™ badge, pattern or wear, so nothing gives it away before it stops.
      const plain = winner.star ? null : { ...c.skins.find((s) => s.id === winner.skin), color: RAR[winner.rarity].color };
      return Array.from({ length: WIN_AT + 6 }, (_, i) => (i === WIN_AT ? plain : pickRandom()));
    }

    async function openCases(c, count) {
      if (!loggedIn) return toast('Log in with Kick to open cases');
      if (data.points < c.price * count) return toast(`You need ${fmt(c.price * count)} pts`);
      const r = await post('/relics/open', { case: c.id, count });
      if (!r) return;
      setBalance(r.balance);
      const o = overlay(
        `<div class="spin-head"><h2>${c.icon} ${esc(c.name)}</h2><button class="btn btn-sm" id="sp-sound" title="Sound">${sound ? '🔊' : '🔈'}</button></div>
        <div class="rl-reels">${r.relics
          .map((w, k) => {
            const items = reelItems(c, w);
            return `<div class="rl-reel-wrap"><div class="rl-reel-marker"></div><div class="rl-reel" data-k="${k}">${items.map((it) => (it ? tile(it) : starTile())).join('')}</div></div>`;
          })
          .join('')}</div>
        <div id="sp-result"></div>
        <div class="rip-actions" id="sp-actions"><button class="btn btn-sm" id="sp-skip">Skip ⏩</button></div>`,
        'spin-overlay'
      );
      const $o = o.el;
      $o.querySelector('#sp-sound').onclick = (e) => {
        sound = !sound;
        e.target.textContent = sound ? '🔊' : '🔈';
        try {
          localStorage.setItem('relicSound', sound ? 'on' : 'off');
        } catch {
          /* ignore */
        }
      };
      const reels = [...$o.querySelectorAll('.rl-reel')];
      const width = reels[0].parentElement.clientWidth;
      // Tile spacing as drawn (tiles are smaller on phones).
      const TILE = reels[0].children[1].getBoundingClientRect().left - reels[0].children[0].getBoundingClientRect().left;
      const DURATION = 6500;
      const targets = reels.map(() => -(WIN_AT * TILE + TILE / 2 - width / 2) + (Math.random() - 0.5) * TILE * 0.8);
      let done = false;
      // Start the spin on the next frame so the transition runs.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          reels.forEach((el, k) => {
            el.style.transition = `transform ${DURATION}ms cubic-bezier(0.08, 0.72, 0.12, 1)`;
            el.style.transform = `translateX(${targets[k]}px)`;
          });
        })
      );
      // Tick as tiles pass the marker (first reel only).
      let lastIdx = -1;
      const watch = () => {
        if (done || !reels[0].isConnected) return;
        const m = new DOMMatrixReadOnly(getComputedStyle(reels[0]).transform);
        const idx = Math.floor((-m.m41 + width / 2) / TILE);
        if (idx !== lastIdx) {
          if (lastIdx >= 0) tick(0.8 + Math.random() * 0.4);
          lastIdx = idx;
        }
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
      const finish = () => {
        if (done) return;
        done = true;
        reels.forEach((el, k) => {
          el.style.transition = 'none';
          el.style.transform = `translateX(${targets[k]}px)`;
          // Now reveal the real relic (float, exterior, pattern, SoulTrak™) in the reel.
          el.children[WIN_AT].outerHTML = tile(r.relics[k], { cls: 'winner' });
        });
        showResult();
      };
      const timer = setTimeout(finish, DURATION + 150);
      cleanups.push(() => clearTimeout(timer));
      $o.querySelector('#sp-skip').onclick = () => {
        clearTimeout(timer);
        finish();
      };
      const showResult = () => {
        const best = [...r.relics].sort((a, b) => b.value - a.value)[0];
        if (best.rarityRank >= 3 || best.star) {
          $o.classList.add('flash');
          setTimeout(() => $o.classList.remove('flash'), 700);
          setTimeout(() => burst($o.querySelector('#sp-result'), [best.color, '#fff', '#e4ae39']), 100);
        }
        const kept = new Set(r.relics.map((x) => x.id));
        const draw_ = () => {
          $o.querySelector('#sp-result').innerHTML = `<div class="sp-result">${r.relics
            .map((x) => tile(x, { cls: kept.has(x.id) ? 'big' : 'big sold', extra: `<div class="rtile-value">${fmt(x.value)} pts</div>${kept.has(x.id) ? `<button class="btn btn-sm" data-sell="${x.id}">Sell +${fmt(x.buyback)}</button>` : '<span class="muted">Sold</span>'}` }))
            .join('')}</div>
            <p class="rip-value ${r.value >= r.cost ? 'win' : ''}">Unboxed <b>${fmt(r.value)}</b> pts of relics for ${fmt(r.cost)} pts.</p>`;
          $o.querySelectorAll('[data-sell]').forEach((b) => {
            b.onclick = async () => {
              const res = await post('/relics/sell', { ids: [+b.dataset.sell] });
              if (!res) return;
              toast(res.message);
              setBalance(res.balance);
              kept.delete(+b.dataset.sell);
              draw_();
            };
          });
        };
        draw_();
        $o.querySelector('#sp-actions').innerHTML = `<button class="btn" id="sp-close">Keep & close</button><button class="btn btn-primary" id="sp-again">Open another · ${fmt(c.price * count)} pts</button>`;
        $o.querySelector('#sp-close').onclick = () => {
          o.close();
          refresh();
        };
        $o.querySelector('#sp-again').onclick = async () => {
          o.close();
          await openCases(c, count);
        };
      };
    }

    // ---- Inspect ----------------------------------------------------------------------------------
    async function inspect(r) {
      const mine = loggedIn && state.me && r.owner === state.me.username;
      const o = overlay(`<button class="cd-x" data-close aria-label="Close">✕</button><div id="ins"></div>`);
      const $d = o.el.querySelector('#ins');
      const un = await api(`/relics/unboxed/${encodeURIComponent(r.skin)}`).catch(() => null);
      const say = (msg) => {
        const m = $d.querySelector('#ins-msg');
        m.textContent = msg.charAt(0).toUpperCase() + msg.slice(1);
        m.hidden = false;
      };
      const act = async (path, body = {}) => {
        try {
          return await api(path, { method: 'POST', body });
        } catch (err) {
          say(err.message);
          return null;
        }
      };
      const bands = cat.exteriors
        .map((e, i) => {
          const lo = i ? cat.exteriors[i - 1].max : 0;
          return `<span style="left:${lo * 100}%;width:${(Math.min(1, e.max) - lo) * 100}%" title="${e.name}">${e.short}</span>`;
        })
        .join('');
      const isShow = data.inventory?.showcase === r.id;
      let actions = '';
      if (mine && r.status === 'owned') {
        actions = `
          <div class="cd-act form-row" style="flex-wrap:wrap"><button class="btn" id="ins-show">${isShow ? '✅ Showcased' : '🏅 Showcase'}</button><button class="btn" id="ins-sell" ${data.bankLeft != null && r.buyback > data.bankLeft ? 'disabled' : ''}>💰 Sell to bank · +${fmt(r.buyback)} pts</button></div>${bankNote(r.buyback)}
          ${tradeLock('sell relics on the market') || `<div class="cd-act"><form id="ins-list" class="form-row"><input type="number" name="price" min="1" max="${Math.max(1000, r.value * 20)}" value="${Math.max(1, Math.round(r.value * 1.1))}" aria-label="Price"><button class="btn">🏪 List for sale</button></form><p class="muted">Value ${fmt(r.value)} pts · most you can ask: ${fmt(Math.max(1000, r.value * 20))} · you get the price minus ${Math.round(cat.fee * 100)}%.</p></div>`}`;
      } else if (mine && r.status === 'listed') {
        actions = `<div class="cd-act"><p>Listed for <b>${fmt(r.price)}</b> pts.</p><button class="btn" id="ins-unlist">Take it down</button></div>`;
      } else if (r.status === 'listed' && loggedIn) {
        actions = tradeLock('buy relics from other players') || `<div class="cd-act"><button class="btn btn-primary" id="ins-buy" ${data.points < r.price ? 'disabled' : ''}>Buy for ${fmt(r.price)} pts</button><p class="muted">Sold by ${esc(r.owner)}. Value ${fmt(r.value)} pts.</p></div>`;
      }
      $d.innerHTML = `
        <div class="ins-art r-${r.rarity}" style="--rc:${r.color}">${relicSvg(r, 'big')}</div>
        <div class="ins-info">
          <div class="muted">${esc(r.caseName)}${r.origin === 'tradeup' ? ' · from a trade-up contract' : ''}</div>
          <h2 style="margin:4px 0;color:${r.color}">${esc(r.fullName)}</h2>
          <div class="cd-tags"><span class="cchip" style="color:${r.color}">${esc(r.rarityName)}</span><span class="cchip">${r.exterior}</span>${r.pattern ? `<span class="cchip ${r.rarePattern ? 'gold' : ''}">${r.rarePattern ? '✨ ' : ''}${esc(r.pattern)}</span>` : ''}${r.soul ? `<span class="cchip soul">☠ SoulTrak™ ${fmt(r.kills)} kill${r.kills === 1 ? '' : 's'}</span>` : ''}${r.owner ? `<span class="cchip">Owner: <a href="${playerLink(r.owner)}">${esc(r.owner)}</a></span>` : ''}</div>
          <div class="cd-value"><span class="muted">Value</span><b>${fmt(r.value)}</b><span class="muted">pts</span>${r.marketFactor !== 1 ? `<span class="cchip ${r.marketFactor > 1 ? 'listed' : ''}" title="Catalog value ${fmt(r.baseValue)} pts, adjusted by recent player sales">📈 market ×${r.marketFactor.toFixed(2)}</span>` : ''}</div>
          <div class="cd-wear"><div class="muted">Float <b>${r.float.toFixed(6)}</b> · this skin rolls ${r.min.toFixed(2)} to ${r.max.toFixed(2)} · lower is better</div><div class="wear-bar">${bands}<em style="left:${r.min * 100}%;width:${(r.max - r.min) * 100}%"></em><i style="left:${r.float * 100}%"></i></div></div>
          <div class="ins-grid">
            <div><small>Pattern seed</small><b>${r.seed}</b></div>
            <div><small>Unboxed</small><b>${un ? fmt(un.unboxed) : '–'}</b></div>
            <div><small>Finish</small><b>${esc(r.finish)}</b></div>
          </div>
          ${r.soul ? `<p class="muted" style="font-size:.85rem">☠ SoulTrak™ counts every monster you defeat with <code>!fight</code> while this is your showcased relic.</p>` : ''}
          <div class="cd-msg" id="ins-msg" role="alert" hidden></div>
          ${actions}
        </div>`;
      const $ = (s) => $d.querySelector(s);
      const done = (res) => {
        if (!res) return;
        toast(res.message);
        o.close();
        refresh();
      };
      if ($('#ins-show')) $('#ins-show').onclick = async () => done(await act('/relics/showcase', { id: isShow ? null : r.id }));
      if ($('#ins-sell')) {
        $('#ins-sell').onclick = async () => {
          if (confirm(`Sell ${r.fullName} to the bank for ${fmt(r.buyback)} pts?`)) done(await act('/relics/sell', { ids: [r.id] }));
        };
      }
      if ($('#ins-list')) $('#ins-list').onsubmit = async (e) => {
        e.preventDefault();
        done(await act(`/relics/${r.id}/list`, { price: Number(e.target.price.value) }));
      };
      if ($('#ins-unlist')) $('#ins-unlist').onclick = async () => done(await act(`/relics/${r.id}/unlist`));
      if ($('#ins-buy')) {
        $('#ins-buy').onclick = async () => {
          if (confirm(`Buy ${r.fullName} for ${fmt(r.price)} pts?`)) done(await act(`/relics/${r.id}/buy`));
        };
      }
    }

    // ---- Page -----------------------------------------------------------------------------------
    const TABS = [
      ['cases', '🧰 Cases'],
      ['inventory', '🎒 Inventory'],
      ['tradeup', '📜 Trade up'],
      ['market', '🏪 Relic market'],
      ['trades', '🤝 Trades'],
      ['drops', '🏆 Drops & top'],
    ];
    function draw() {
      const inv = data.inventory;
      $app.innerHTML = `
        <div class="relics-page">
          <div class="panel-head cards-head" style="margin-bottom:4px">
            <h1 style="margin:0">🧰 Relic Cases</h1>
            ${
              loggedIn
                ? `<span class="badge gold" style="font-size:1rem">💰 <span id="rl-balance">${fmt(data.points)}</span> pts${inv ? ` · 🎒 ${fmt(inv.relics.length)} relics worth ${fmt(inv.value)}` : ''}</span>`
                : state.loginEnabled
                  ? `<a class="btn btn-primary" href="/auth/login">Log in with Kick to open cases</a>`
                  : ''
            }
          </div>
          <p class="muted">Crack open cases for legendary blades, axes, staffs and bows. Every relic has its own <b>float</b> and <b>pattern</b>, 1 in 10 is <b>SoulTrak™</b>, and ★ relics are exceedingly rare. Sell them back, trade them, or sign <b>trade-up contracts</b>.</p>
          <div class="tabs">${TABS.map(([id, label]) => `<button class="tab ${id === tab ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
          <div id="rl-tab"></div>
        </div>`;
      $app.querySelectorAll('[data-tab]').forEach((b) => {
        b.onclick = () => {
          tab = b.dataset.tab;
          history.replaceState(null, '', `#/relics?tab=${tab}`);
          $app.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
          drawTab();
        };
      });
      drawTab();
    }
    const $tab = () => $app.querySelector('#rl-tab');
    function drawTab() {
      ({ cases: drawCases, inventory: drawInventory, tradeup: drawTradeUp, market: drawMarket, trades: drawTrades, drops: drawDrops }[tab] || drawCases)();
    }
    const bindTiles = (el, list) =>
      el.querySelectorAll('.rtile[data-id]').forEach((t) => {
        t.onclick = (e) => {
          if (e.target.closest('button, a, input')) return;
          const r = list.find((x) => String(x.id) === t.dataset.id);
          if (r) inspect(r);
        };
      });
    const caseArt = (c) => `<div class="case-box" style="--cc:${c.color}"><div class="case-lid"></div><div class="case-body"><span>${c.icon}</span></div><div class="case-lock"></div></div>`;

    function drawCases() {
      if (openCaseId && CASES[openCaseId]) return drawCaseDetail(CASES[openCaseId]);
      $tab().innerHTML = `<div class="case-grid">${cat.cases
        .map(
          (c) => `<button class="case-card" data-case="${c.id}" style="--cc:${c.color}">
            ${caseArt(c)}
            <b>${esc(c.name)}</b>
            <span class="pack-price"><b>${fmt(c.price)}</b> pts</span>
            <span class="muted" style="font-size:.8rem">${c.skins.filter((s) => !s.star).length} relics + ★ specials</span>
          </button>`
        )
        .join('')}</div>
        <section class="panel" style="margin-top:14px"><h2 style="margin-top:0">How it works</h2><ul class="cd-how">
          <li>Odds for every case: ${Object.values(RAR).map((r) => `<b style="color:${r.color}">${esc(r.name)}</b> ${pct(r.odds)}`).join(' · ')}.</li>
          <li><b>Float</b> (0 to 1) sets the exterior: ${cat.exteriors.map((e) => `${e.name} under ${e.max}`).join(', ')}. Lower floats are worth more, and floats under 0.01 are prized.</li>
          <li><b>Pattern seed</b> (0 to 999) changes how the skin looks. Fades roll 80-100% (100% is best); Gem relics come in phases, with Ruby, Sapphire, Black Pearl and Emerald the rarest; 1 in 100 marbles, crystals and rune patterns is a rare pattern.</li>
          <li><b>SoulTrak™</b> (1 in 10, worth ~1.8×): showcase it and it counts every monster you defeat with <code>!fight</code>.</li>
          <li><b>Trade-up contracts</b>: 10 relics of one rarity become 1 of the next (5 Exalted become a ★ relic). The new float is the average of your inputs, so low-float inputs make a low-float result.</li>
          <li>Sell relics back to the bank for ${Math.round(cat.buyback * 100)}% of their value${cat.bankFullValue ? ` (a fifth of that rate on value above ${fmt(cat.bankFullValue)} pts)` : ''}${cat.bankDailyLimit ? `, up to ${fmt(cat.bankDailyLimit)} pts a day` : ''}. Big relics are better sold on the relic market or traded. A relic's value follows what players actually pay for that skin on the market (between ×0.5 and ×2).</li>
        </ul></section>`;
      $tab().querySelectorAll('[data-case]').forEach((b) => {
        b.onclick = () => {
          openCaseId = b.dataset.case;
          drawCases();
        };
      });
    }

    function drawCaseDetail(c) {
      const order = Object.keys(RAR);
      const skins = [...c.skins].filter((s) => !s.star).sort((a, b) => order.indexOf(b.rarity) - order.indexOf(a.rarity));
      const stars = c.skins.filter((s) => s.star);
      $tab().innerHTML = `
        <section class="panel case-detail" style="--cc:${c.color}">
          <button class="btn btn-sm" id="cs-back">← All cases</button>
          <div class="case-hero">
            ${caseArt(c)}
            <div>
              <h2 style="margin:0">${c.icon} ${esc(c.name)}</h2>
              <p class="muted" style="margin:4px 0 10px">Average unboxing ≈ ${fmt(c.ev)} pts</p>
              <div class="form-row" style="flex-wrap:wrap">${[1, 3, 5].map((n) => `<button class="btn ${n === 1 ? 'btn-primary' : ''}" data-open="${n}">Open ${n > 1 ? `${n} · ` : ''}${fmt(c.price * n)} pts</button>`).join('')}</div>
            </div>
          </div>
          <h3>Contains one of:</h3>
          <div class="rt-grid">${skins
            .map((s) => tile({ ...s, color: RAR[s.rarity].color }, { extra: `<div class="rtile-odds">${pct(s.chance)}</div>` }))
            .join('')}${starTile()}</div>
          <h3 style="margin-top:16px;color:${RAR.relic.color}">★ Rare special items (${pct(RAR.relic.odds)} together)</h3>
          <div class="rt-grid">${stars.map((s) => tile({ ...s, color: RAR.relic.color }, { extra: `<div class="rtile-odds">${pct(s.chance)}</div>` })).join('')}</div>
        </section>`;
      $tab().querySelector('#cs-back').onclick = () => {
        openCaseId = null;
        drawCases();
      };
      $tab().querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openCases(c, +b.dataset.open)));
    }

    function drawInventory() {
      if (!loggedIn) return ($tab().innerHTML = `<div class="panel empty"><span class="ic">🎒</span>Log in to see your relics.</div>`);
      const all = data.inventory.relics;
      if (!all.length) return ($tab().innerHTML = `<div class="panel empty"><span class="ic">🧰</span>No relics yet. Open your first case on the Cases tab!</div>`);
      const show = all.find((r) => r.id === data.inventory.showcase);
      let selecting = false;
      const sel = new Set();
      const list = () => {
        const q = invFilters.q.toLowerCase();
        const out = all.filter((r) => (!invFilters.case || r.case === invFilters.case) && (!invFilters.rarity || r.rarity === invFilters.rarity) && (!q || r.fullName.toLowerCase().includes(q)));
        const by = { value: (a, b) => b.value - a.value, newest: (a, b) => b.id - a.id, float: (a, b) => a.float - b.float, rarity: (a, b) => b.rarityRank - a.rarityRank || b.value - a.value }[invFilters.sort];
        return out.sort(by);
      };
      $tab().innerHTML = `
        ${show ? `<section class="panel showcase" style="--rc:${show.color}"><div class="showcase-art">${relicSvg(show, 'big')}</div><div><div class="muted">🏅 Showcased relic</div><h3 style="margin:2px 0;color:${show.color}">${esc(show.fullName)}</h3><div class="muted">${show.exterior} · ${show.float.toFixed(4)}${show.soul ? ` · <b style="color:#ff9a3a">☠ ${fmt(show.kills)} monsters defeated</b>` : ''}</div></div></section>` : ''}
        <section class="panel" style="margin-top:14px">
          <div class="cd-filters">
            <input type="search" class="guide-search" id="i-q" placeholder="Search relics" value="${esc(invFilters.q)}">
            <select id="i-case"><option value="">All cases</option>${cat.cases.map((c) => `<option value="${c.id}" ${invFilters.case === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select>
            <select id="i-rarity"><option value="">All rarities</option>${Object.entries(RAR).map(([id, r]) => `<option value="${id}" ${invFilters.rarity === id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
            <select id="i-sort">${[['value', 'Most valuable'], ['newest', 'Newest'], ['float', 'Lowest float'], ['rarity', 'Rarity']].map(([v, l]) => `<option value="${v}" ${invFilters.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <button class="btn btn-sm" id="i-select">Select to sell</button>
          </div>
          <div id="i-bar" class="sel-bar" hidden></div>
          <div id="i-grid"></div>
        </section>`;
      const $g = $tab().querySelector('#i-grid');
      const $bar = $tab().querySelector('#i-bar');
      const drawGrid = () => {
        const items = list();
        $g.innerHTML = items.length
          ? `<div class="rt-grid">${items
              .map((r) =>
                tile(r, {
                  cls: sel.has(r.id) ? 'selected' : '',
                  extra: `<div class="rtile-value">${fmt(r.value)} pts${r.status === 'listed' ? ` · <span class="cchip listed">Listed ${fmt(r.price)}</span>` : ''}${r.id === data.inventory.showcase ? ' · 🏅' : ''}</div>${selecting && r.status === 'owned' ? `<input type="checkbox" class="sel-cb" data-sel="${r.id}" ${sel.has(r.id) ? 'checked' : ''}>` : ''}`,
                })
              )
              .join('')}</div>`
          : '<p class="muted">No relics match.</p>';
        bindTiles($g, items);
        $g.querySelectorAll('[data-sel]').forEach((cb) => {
          cb.onchange = () => {
            if (cb.checked) sel.add(+cb.dataset.sel);
            else sel.delete(+cb.dataset.sel);
            drawBar();
            drawGrid();
          };
        });
      };
      const drawBar = () => {
        $bar.hidden = !selecting;
        const pts = all.filter((r) => sel.has(r.id)).reduce((s, r) => s + r.buyback, 0);
        $bar.innerHTML = `<span>${sel.size} selected · bank pays <b>${fmt(pts)}</b> pts${data.bankLeft != null ? ` <span class="muted">(${fmt(data.bankLeft)} left today)</span>` : ''}</span>
          <button class="btn btn-sm" id="s-blue">Select Adept (non-SoulTrak)</button><button class="btn btn-sm" id="s-none">Clear</button>
          <button class="btn btn-primary btn-sm" id="s-sell" ${sel.size ? '' : 'disabled'}>Sell to bank</button>`;
        $bar.querySelector('#s-blue').onclick = () => {
          list().filter((r) => r.status === 'owned' && r.rarity === 'adept' && !r.soul && !r.rarePattern).forEach((r) => sel.add(r.id));
          drawBar();
          drawGrid();
        };
        $bar.querySelector('#s-none').onclick = () => {
          sel.clear();
          drawBar();
          drawGrid();
        };
        $bar.querySelector('#s-sell').onclick = async () => {
          if (!confirm(`Sell ${sel.size} relics to the bank for ${fmt(pts)} pts?`)) return;
          const res = await post('/relics/sell', { ids: [...sel] });
          if (!res) return;
          toast(res.message);
          refresh();
        };
      };
      const $ = (s) => $tab().querySelector(s);
      $('#i-q').oninput = (e) => {
        invFilters.q = e.target.value.trim();
        drawGrid();
      };
      for (const [id, key] of [['#i-case', 'case'], ['#i-rarity', 'rarity'], ['#i-sort', 'sort']]) {
        $(id).onchange = (e) => {
          invFilters[key] = e.target.value;
          drawGrid();
        };
      }
      $('#i-select').onclick = (e) => {
        selecting = !selecting;
        e.target.textContent = selecting ? 'Done selecting' : 'Select to sell';
        if (!selecting) sel.clear();
        drawBar();
        drawGrid();
      };
      drawGrid();
    }

    function drawTradeUp() {
      if (!loggedIn) return ($tab().innerHTML = `<div class="panel empty"><span class="ic">📜</span>Log in to sign trade-up contracts.</div>`);
      const size = cat.tradeUpSize[tuRarity];
      const eligible = data.inventory.relics.filter((r) => r.status === 'owned' && r.rarity === tuRarity && r.soul === tuSoul).sort((a, b) => a.float - b.float);
      const picked = [];
      const draw_ = async () => {
        const inputs = picked.map((id) => eligible.find((r) => r.id === id));
        $tab().innerHTML = `
          <section class="panel" style="margin-top:14px">
            <h2 style="margin-top:0">📜 Trade-up contract</h2>
            <p class="muted" style="margin-top:0">Trade <b>${size}</b> relics of one rarity for <b>1</b> of the next rarity, from the same cases as your inputs. The result's float is the average of your inputs (each measured within its own float range), so low floats in means a low float out.</p>
            <div class="form-row" style="flex-wrap:wrap;align-items:center">
              ${Object.keys(cat.tradeUpSize)
                .map((r) => `<button class="tab ${r === tuRarity ? 'active' : ''}" data-tu="${r}" style="--rc:${RAR[r].color}">${esc(RAR[r].name)} → ${esc(RAR[cat.next[r]].name)}</button>`)
                .join('')}
              <label class="muted"><input type="checkbox" id="tu-soul" ${tuSoul ? 'checked' : ''}> SoulTrak™ contract</label>
            </div>
            <div class="tu-slots">${Array.from({ length: size }, (_, i) => (inputs[i] ? `<div class="tu-slot filled" data-un="${inputs[i].id}">${tile(inputs[i])}</div>` : '<div class="tu-slot"><span>+</span></div>')).join('')}</div>
            <div class="form-row" style="margin:8px 0;flex-wrap:wrap"><button class="btn btn-sm" id="tu-auto">Fill with lowest floats</button><button class="btn btn-sm" id="tu-clear">Clear</button></div>
            <div id="tu-preview"></div>
          </section>
          <section class="panel" style="margin-top:14px"><div class="panel-head"><h3 style="margin:0">Your ${esc(RAR[tuRarity].name)}${tuSoul ? ' SoulTrak™' : ''} relics (${eligible.length})</h3><span class="muted">Click to add · lowest float first</span></div>
            ${eligible.length ? `<div class="rt-grid">${eligible.map((r) => tile(r, { cls: picked.includes(r.id) ? 'selected' : '', extra: `<div class="rtile-value">${fmt(r.value)} pts</div>` })).join('')}</div>` : '<p class="muted">None of these yet.</p>'}
          </section>`;
        $tab().querySelectorAll('[data-tu]').forEach((b) => {
          b.onclick = () => {
            tuRarity = b.dataset.tu;
            drawTradeUp();
          };
        });
        $tab().querySelector('#tu-soul').onchange = (e) => {
          tuSoul = e.target.checked;
          drawTradeUp();
        };
        $tab().querySelector('#tu-auto').onclick = () => {
          for (const r of eligible) if (picked.length < size && !picked.includes(r.id)) picked.push(r.id);
          draw_();
        };
        $tab().querySelector('#tu-clear').onclick = () => {
          picked.length = 0;
          draw_();
        };
        $tab().querySelectorAll('[data-un]').forEach((s) => {
          s.onclick = () => {
            picked.splice(picked.indexOf(+s.dataset.un), 1);
            draw_();
          };
        });
        $tab().querySelectorAll('.rt-grid .rtile[data-id]').forEach((t) => {
          if (t.closest('.tu-slot')) return;
          t.onclick = () => {
            const id = +t.dataset.id;
            if (picked.includes(id)) picked.splice(picked.indexOf(id), 1);
            else if (picked.length < size) picked.push(id);
            else return toast(`A contract takes ${size} relics.`);
            draw_();
          };
        });
        if (picked.length !== size) return;
        const $p = $tab().querySelector('#tu-preview');
        $p.innerHTML = '<p class="muted">Working out the possible results…</p>';
        const pv = await post('/relics/tradeup/preview', { ids: picked });
        if (!pv) return ($p.innerHTML = '');
        const ev = pv.outcomes.reduce((s, o) => s + o.chance * o.value, 0);
        $p.innerHTML = `
          <h3>Possible results</h3>
          <div class="rt-grid">${pv.outcomes.map((o) => tile(o, { extra: `<div class="rtile-odds">${pct(o.chance)}</div><div class="rtile-value">≈ ${fmt(o.value)} pts</div>` })).join('')}</div>
          <p>You put in <b>${fmt(pv.inValue)}</b> pts of relics. Average result ≈ <b class="${ev >= pv.inValue ? 'cd-good' : ''}">${fmt(Math.round(ev))}</b> pts (patterns can add more).</p>
          <button class="btn btn-primary big-btn" id="tu-sign">✍️ Sign contract</button>`;
        $p.querySelector('#tu-sign').onclick = async () => {
          if (!confirm(`Trade these ${size} relics for 1 ${RAR[pv.next].name} relic? Your inputs are used up.`)) return;
          const res = await post('/relics/tradeup', { ids: picked });
          if (!res) return;
          const o = overlay(`<div class="contract"><div class="scroll">📜</div><p>Sealing the contract…</p></div>`, 'spin-overlay');
          setTimeout(() => {
            o.el.querySelector('.cd-modal').innerHTML = `<div class="rip"><h2>Contract fulfilled!</h2><div class="sp-result">${tile(res.relic, { cls: 'big', extra: `<div class="rtile-value">${fmt(res.relic.value)} pts</div>` })}</div><button class="btn btn-primary" data-close>Nice!</button></div>`;
            if (res.relic.rarityRank >= 3) burst(o.el.querySelector('.sp-result'), [res.relic.color, '#fff', '#e4ae39']);
          }, 1600);
          o.el.addEventListener('click', (e) => e.target.closest('[data-close]') && refresh());
        };
      };
      draw_();
    }

    async function drawMarket() {
      $tab().innerHTML = '<div class="skeleton">Loading…</div>';
      const m = await api('/relics/market');
      const list = () => {
        const q = mkFilters.q.toLowerCase();
        const out = m.listings.filter((r) => (!mkFilters.rarity || r.rarity === mkFilters.rarity) && (!q || r.fullName.toLowerCase().includes(q) || r.owner.toLowerCase().includes(q)));
        const by = { newest: () => 0, cheap: (a, b) => a.price - b.price, value: (a, b) => b.value - a.value, float: (a, b) => a.float - b.float, deal: (a, b) => a.price / a.value - b.price / b.value }[mkFilters.sort];
        return out.sort(by);
      };
      $tab().innerHTML = `
        <section class="panel" style="margin-top:14px">
          <p class="muted" style="margin-top:0">Relics other players are selling. The market keeps ${Math.round(m.fee * 100)}% of each sale. To sell one of yours, open it from your inventory.</p>
          <div class="cd-filters">
            <input type="search" class="guide-search" id="m-q" placeholder="Search relics or sellers" value="${esc(mkFilters.q)}">
            <select id="m-rarity"><option value="">All rarities</option>${Object.entries(RAR).map(([id, r]) => `<option value="${id}" ${mkFilters.rarity === id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
            <select id="m-sort">${[['newest', 'Newest'], ['cheap', 'Cheapest'], ['value', 'Most valuable'], ['float', 'Lowest float'], ['deal', 'Best deal (price ÷ value)']].map(([v, l]) => `<option value="${v}" ${mkFilters.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </div>
          <div id="m-grid"></div>
        </section>`;
      const $g = $tab().querySelector('#m-grid');
      const drawGrid = () => {
        const items = list();
        $g.innerHTML = items.length
          ? `<div class="rt-grid">${items.map((r) => tile(r, { extra: `<div class="rtile-value"><span class="cchip listed">${fmt(r.price)} pts</span> <span class="muted">value ${fmt(r.value)}</span></div><div class="muted" style="font-size:.75rem">by ${esc(r.owner)}</div>` })).join('')}</div>`
          : `<div class="empty"><span class="ic">🏪</span>${m.listings.length ? 'Nothing matches.' : 'No relics for sale yet.'}</div>`;
        bindTiles($g, items);
      };
      $tab().querySelector('#m-q').oninput = (e) => {
        mkFilters.q = e.target.value.trim();
        drawGrid();
      };
      $tab().querySelector('#m-rarity').onchange = (e) => {
        mkFilters.rarity = e.target.value;
        drawGrid();
      };
      $tab().querySelector('#m-sort').onchange = (e) => {
        mkFilters.sort = e.target.value;
        drawGrid();
      };
      drawGrid();
    }

    async function drawTrades() {
      if (!loggedIn) return ($tab().innerHTML = `<div class="panel empty"><span class="ic">🤝</span>Log in to trade relics.</div>`);
      $tab().innerHTML = '<div class="skeleton">Loading…</div>';
      const { trades } = await api('/relics/trades');
      const mini = (list) => (list.length ? `<div class="rt-grid mini">${list.map((r) => tile(r)).join('')}</div>` : '<span class="muted">no relics</span>');
      const row = (t) => {
        const [youGive, youGet] = t.incoming ? [t.want, t.give] : [t.give, t.want];
        const [ptsGive, ptsGet] = t.incoming ? [t.pointsWant, t.pointsGive] : [t.pointsGive, t.pointsWant];
        const [vGive, vGet] = t.incoming ? [t.valueWant, t.valueGive] : [t.valueGive, t.valueWant];
        const other = t.incoming ? t.from : t.to;
        return `<div class="trade ${t.status}">
          <div class="trade-head"><b>${t.incoming ? 'From' : 'To'} <a href="${playerLink(other)}">${esc(other)}</a></b><span class="cchip ${t.status === 'open' ? 'listed' : ''}">${t.status}</span><span class="muted" data-ts="${t.createdAt}">${ago(t.createdAt)}</span></div>
          ${t.message ? `<p class="muted" style="margin:4px 0">“${esc(t.message)}”</p>` : ''}
          <div class="trade-sides">
            <div><div class="muted">You give · ${fmt(vGive)} pts value</div>${mini(youGive)}${ptsGive ? `<div>+ <b>${fmt(ptsGive)}</b> pts</div>` : ''}</div>
            <div class="trade-arrow">⇄</div>
            <div><div class="muted">You get · ${fmt(vGet)} pts value</div>${mini(youGet)}${ptsGet ? `<div>+ <b>${fmt(ptsGet)}</b> pts</div>` : ''}</div>
          </div>
          ${t.status === 'open' ? `<div class="form-row">${t.incoming ? `<button class="btn btn-primary btn-sm" data-t="accept" data-id="${t.id}">Accept</button><button class="btn btn-sm" data-t="decline" data-id="${t.id}">Decline</button>` : `<button class="btn btn-sm" data-t="cancel" data-id="${t.id}">Cancel offer</button>`}<span class="muted" style="font-size:.8rem">Expires ${new Date(t.expiresAt).toLocaleDateString()}</span></div>` : ''}
        </div>`;
      };
      $tab().innerHTML = `
        <section class="panel" style="margin-top:14px"><h2 style="margin-top:0">New trade</h2>
          ${data.blocked ? tradeLock('trade relics') : `<form id="tr-find" class="form-row"><input type="text" name="name" style="max-width:260px" placeholder="Player name" required value="${esc(query?.get('with') || '')}"><button class="btn">Load their relics</button></form><div id="tr-build"></div>`}
        </section>
        <section class="panel" style="margin-top:14px"><h2 style="margin-top:0">Your offers</h2>${trades.length ? trades.map(row).join('') : '<p class="muted" style="margin:0">No trades yet.</p>'}</section>`;
      $tab().querySelectorAll('[data-t]').forEach((b) => {
        b.onclick = async () => {
          if (b.dataset.t === 'accept' && !confirm('Accept this trade?')) return;
          const r = await post(`/relics/trades/${b.dataset.id}/${b.dataset.t}`);
          if (!r) return;
          toast(r.message);
          data = await api('/relics');
          drawTrades();
        };
      });
      const find = $tab().querySelector('#tr-find');
      if (!find) return;
      const build = async (name) => {
        const $b = $tab().querySelector('#tr-build');
        let them;
        try {
          them = await api(`/relics/player/${encodeURIComponent(name)}`);
        } catch {
          $b.innerHTML = '<p class="muted">No player by that name.</p>';
          return;
        }
        if (them.username.toLowerCase() === state.me.username.toLowerCase()) return ($b.innerHTML = "<p class=\"muted\">That's you!</p>");
        const mine = data.inventory.relics.filter((r) => r.status === 'owned').sort((a, b) => b.value - a.value);
        const theirs = them.relics.filter((r) => r.status === 'owned').sort((a, b) => b.value - a.value);
        const give = new Set();
        const want = new Set();
        const pick = (list, set, side) => (list.length ? `<div class="rt-grid mini pick-list">${list.map((r) => tile(r, { cls: set.has(r.id) ? 'selected' : '', extra: `<div class="rtile-value">${fmt(r.value)}</div>` }).replace('class="rtile', `data-side="${side}" class="rtile`)).join('')}</div>` : '<p class="muted">No relics to trade.</p>');
        const render = () => {
          const v = (list, set) => list.filter((r) => set.has(r.id)).reduce((s, r) => s + r.value, 0);
          $b.innerHTML = `
            <div class="trade-build">
              <div><h3>You give <span class="muted">(${give.size} · ${fmt(v(mine, give))} pts)</span></h3>${pick(mine, give, 'give')}<label class="muted">+ points <input type="number" id="tr-pg" min="0" value="0" style="max-width:120px"></label></div>
              <div><h3>You want from ${esc(them.username)} <span class="muted">(${want.size} · ${fmt(v(theirs, want))} pts)</span></h3>${pick(theirs, want, 'want')}<label class="muted">+ points <input type="number" id="tr-pw" min="0" value="0" style="max-width:120px"></label></div>
            </div>
            <div class="form-row" style="margin-top:10px"><input type="text" id="tr-msg" maxlength="140" placeholder="Message (optional)"><button class="btn btn-primary" id="tr-send" ${give.size || want.size ? '' : 'disabled'}>Send offer</button></div>`;
          $b.querySelectorAll('.rtile[data-side]').forEach((t) => {
            t.onclick = () => {
              const set = t.dataset.side === 'give' ? give : want;
              const id = +t.dataset.id;
              if (set.has(id)) set.delete(id);
              else set.add(id);
              render();
            };
          });
          $b.querySelector('#tr-send').onclick = async () => {
            const r = await post('/relics/trades', { to: them.username, give: [...give], want: [...want], pointsGive: Number($b.querySelector('#tr-pg').value) || 0, pointsWant: Number($b.querySelector('#tr-pw').value) || 0, message: $b.querySelector('#tr-msg').value });
            if (!r) return;
            toast(r.message);
            drawTrades();
          };
        };
        render();
      };
      find.onsubmit = (e) => {
        e.preventDefault();
        build(find.name.value.trim());
      };
      if (query?.get('with')) build(query.get('with'));
    }

    function drawDrops() {
      $tab().innerHTML = `
        <section class="panel" style="margin-top:14px"><h2 style="margin-top:0">✨ Recent big unboxings</h2>
          ${data.drops.length ? `<div class="rt-grid">${data.drops.map((r) => tile(r, { extra: `<div class="muted" style="font-size:.75rem"><a href="${playerLink(r.owner)}">${esc(r.owner)}</a> · <span data-ts="${r.createdAt}">${ago(r.createdAt)}</span></div>` })).join('')}</div>` : '<p class="muted" style="margin:0">No big unboxings yet. Be the first!</p>'}
        </section>
        <section class="panel" style="margin-top:14px"><h2 style="margin-top:0">🏆 Top inventories</h2>
          ${
            data.top.length
              ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th class="num">Relics</th><th class="num">Value</th><th>Best relic</th><th></th></tr></thead><tbody>${data.top
                  .map((t, i) => `<tr><td>${i + 1}</td><td><a href="${playerLink(t.username)}">${esc(t.username)}</a></td><td class="num">${fmt(t.relics)}</td><td class="num"><b>${fmt(t.value)}</b></td><td style="color:${t.best.color}">${esc(t.best.name)} <span class="muted">(${fmt(t.best.value)})</span></td><td>${loggedIn && state.me.username !== t.username ? `<a class="btn btn-sm" href="#/relics?tab=trades&with=${encodeURIComponent(t.username)}">Trade</a>` : ''}</td></tr>`)
                  .join('')}</tbody></table></div>`
              : '<p class="muted" style="margin:0">No relics yet.</p>'
          }
        </section>`;
      bindTiles($tab(), data.drops);
    }

    draw();
    return () => cleanups.forEach((fn) => fn());
  };
})();
