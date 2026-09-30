// Trading card artwork: each creature gets a painted scene for its element (forest, canyon,
// volcano, deep sea, storm, aurora, void, radiance) and is drawn like an illustration: dark ink
// outline, element-colored rim light, lighting across the body and a shadow on the ground. Rarer
// cards get more: light rays, particles, a halo. Same card, same painting, every time.
//   window.MMOCardArt.html(card, cls)   an <img> that paints itself when it scrolls into view
//   window.MMOCardArt.paint(card, W)    the canvas
// card: { id, icon, element, rarity }.
(() => {
  function prng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const strHash = (s) => {
    let h = 2166136261;
    for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  // Smooth value noise on a small grid, sampled with bilinear smoothing (cheap clouds and mist).
  function noiseField(rand, gw = 24, gh = 18) {
    const v = new Float32Array((gw + 1) * (gh + 1)).map(() => rand());
    const at = (x, y) => v[y * (gw + 1) + x];
    const s = (t) => t * t * (3 - 2 * t);
    return (u, w) => {
      u = ((u % 1) + 1) % 1;
      w = Math.min(0.9999, Math.max(0, w));
      const x = u * gw;
      const y = w * gh;
      const xi = Math.min(gw - 1, Math.floor(x));
      const yi = Math.min(gh - 1, Math.floor(y));
      const fx = s(x - xi);
      const fy = s(y - yi);
      const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx;
      const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx;
      return a + (b - a) * fy;
    };
  }
  const RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };

  // Element palettes: sky top, sky bottom, ground, accent, particles.
  const ELEMENTS = {
    nature: { sky: ['#8fd9a8', '#e8f6c8'], ground: '#2d6a3a', far: '#4f9a5c', accent: '#b8ff7a', mote: '#fff6a8' },
    earth: { sky: ['#e8b27a', '#f6dcb0'], ground: '#6b4226', far: '#9a6a44', accent: '#ffd08a', mote: '#f2d7a8' },
    fire: { sky: ['#3a0a08', '#e0431b'], ground: '#1a0604', far: '#5a1208', accent: '#ffb03a', mote: '#ffd24a' },
    water: { sky: ['#06284a', '#2a8ad8'], ground: '#041a30', far: '#0a3a66', accent: '#7fe7ff', mote: '#d8f6ff' },
    storm: { sky: ['#1a1f3a', '#5a6a8a'], ground: '#10131f', far: '#262d4a', accent: '#fff27a', mote: '#e8f0ff' },
    frost: { sky: ['#0a1a3a', '#6ab8e8'], ground: '#dcefff', far: '#9fc8e8', accent: '#aef4ff', mote: '#ffffff' },
    shadow: { sky: ['#07030f', '#3a1a6a'], ground: '#05020a', far: '#1a0a33', accent: '#c07aff', mote: '#e0b8ff' },
    light: { sky: ['#fff2c0', '#ffd27a'], ground: '#e8c27a', far: '#f5dfa0', accent: '#ffffff', mote: '#fffbe6' },
  };

  function paint(card, W = 480) {
    const H = Math.round(W * 0.75);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    const rand = prng(strHash(card.id || card.name || 'card'));
    const E = ELEMENTS[card.element] || ELEMENTS.nature;
    const rank = RANK[card.rarity] ?? 0;
    const el = card.element || 'nature';
    const n1 = noiseField(rand, 12, 9);
    const n2 = noiseField(rand, 30, 22);
    const n3 = noiseField(rand, 70, 50);
    const noise = (u, w) => n1(u, w) * 0.55 + n2(u, w) * 0.3 + n3(u, w) * 0.15;
    const horizon = H * (0.62 + rand() * 0.08);

    // ---- sky
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, E.sky[0]);
    sky.addColorStop(1, E.sky[1]);
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // Clouds / mist from the noise field.
    const mist = (color, alpha, y0, y1, scale = 1) => {
      const img = g.getImageData(0, 0, W, H);
      const d = img.data;
      const [r, gg, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
      for (let y = Math.floor(y0); y < Math.min(H, y1); y++) {
        for (let x = 0; x < W; x++) {
          const n = noise((x / W) * scale, (y / H) * scale);
          const a = Math.min(1, Math.max(0, n - 0.42) * 2.4 * alpha);
          if (a <= 0) continue;
          const i = (y * W + x) * 4;
          d[i] += (r - d[i]) * a;
          d[i + 1] += (gg - d[i + 1]) * a;
          d[i + 2] += (b - d[i + 2]) * a;
        }
      }
      g.putImageData(img, 0, 0);
    };

    // Element-specific sky features.
    if (el === 'shadow' || el === 'frost' || el === 'water') {
      // Stars (or deep-sea specks).
      for (let i = 0; i < 70; i++) {
        g.fillStyle = `rgba(255,255,255,${(0.2 + rand() * 0.7).toFixed(2)})`;
        const s = rand() < 0.1 ? 2 : 1;
        g.fillRect(rand() * W, rand() * horizon, s, s);
      }
    }
    if (el === 'shadow') {
      // A swirling nebula.
      for (let i = 0; i < 5; i++) {
        const x = rand() * W;
        const y = rand() * horizon;
        const r = W * (0.15 + rand() * 0.25);
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, i % 2 ? 'rgba(192,122,255,.35)' : 'rgba(255,90,200,.25)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, W, H);
      }
    }
    if (el === 'frost') {
      // Aurora ribbons.
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const y0 = horizon * (0.15 + k * 0.12);
        const grd = g.createLinearGradient(0, y0 - 30, 0, y0 + 50);
        grd.addColorStop(0, 'rgba(90,255,190,0)');
        grd.addColorStop(0.5, k === 1 ? 'rgba(150,120,255,.35)' : 'rgba(90,255,190,.35)');
        grd.addColorStop(1, 'rgba(90,255,190,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(0, y0);
        for (let x = 0; x <= W; x += W / 16) g.lineTo(x, y0 + Math.sin(x / W * 6 + k + rand()) * 18);
        g.lineTo(W, y0 + 70);
        g.lineTo(0, y0 + 70);
        g.fill();
      }
      g.restore();
    }
    if (el === 'light' || el === 'nature' || el === 'earth') {
      // A low sun and god rays.
      const sx = W * (0.25 + rand() * 0.5);
      const sy = horizon * (0.3 + rand() * 0.25);
      const sun = g.createRadialGradient(sx, sy, 0, sx, sy, W * 0.45);
      sun.addColorStop(0, 'rgba(255,255,230,.95)');
      sun.addColorStop(0.12, 'rgba(255,245,200,.6)');
      sun.addColorStop(1, 'rgba(255,245,200,0)');
      g.fillStyle = sun;
      g.fillRect(0, 0, W, H);
    }
    if (el === 'fire') {
      // Ash clouds lit from below.
      mist('#ff7a2a', 0.5, 0, horizon, 1.3);
    } else if (el === 'storm') {
      mist('#0c0f1c', 0.8, 0, horizon, 1.1);
      // Lightning.
      g.save();
      g.strokeStyle = '#fffbe0';
      g.shadowColor = '#fff27a';
      g.shadowBlur = 14;
      for (let k = 0; k < 2; k++) {
        let x = W * (0.15 + rand() * 0.7);
        let y = 0;
        g.lineWidth = 2.2 - k;
        g.beginPath();
        g.moveTo(x, y);
        while (y < horizon * 0.95) {
          x += (rand() - 0.5) * W * 0.08;
          y += H * (0.04 + rand() * 0.05);
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.restore();
    } else if (el !== 'shadow' && el !== 'water') {
      mist('#ffffff', 0.45, 0, horizon * 0.8, 1);
    }
    if (el === 'water') {
      // Caustic light from the surface.
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 9; i++) {
        const x = rand() * W;
        const grd = g.createLinearGradient(x, 0, x + W * 0.1, H);
        grd.addColorStop(0, 'rgba(180,240,255,.28)');
        grd.addColorStop(1, 'rgba(180,240,255,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + W * 0.05, 0);
        g.lineTo(x + W * 0.2, H);
        g.lineTo(x + W * 0.1, H);
        g.fill();
      }
      g.restore();
    }

    // ---- far and near ground (mountains, dunes, reefs, trees)
    const ridge = (y, amp, color, jag = 1) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, H);
      let yy = y;
      for (let x = 0; x <= W + 8; x += 8) {
        yy = y + (noise(x / W, y / H) - 0.5) * amp * 2 + Math.sin(x * 0.03 * jag + rand() * 0.2) * amp * 0.25;
        g.lineTo(x, yy);
      }
      g.lineTo(W, H);
      g.fill();
    };
    ridge(horizon - H * 0.12, H * 0.14, E.far, el === 'earth' || el === 'frost' ? 1.8 : 1);
    if (el === 'nature') {
      // A treeline.
      g.fillStyle = '#1f4a2a';
      for (let x = -10; x < W + 10; x += 14 + rand() * 12) {
        const h = H * (0.1 + rand() * 0.12);
        const y = horizon - H * 0.02;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 10, y - h);
        g.lineTo(x + 20, y);
        g.fill();
      }
    }
    ridge(horizon, H * 0.05, E.ground);
    if (el === 'fire') {
      // Lava cracks glowing in the ground.
      g.save();
      g.strokeStyle = '#ffb03a';
      g.shadowColor = '#ff5a1a';
      g.shadowBlur = 10;
      g.lineWidth = 2;
      for (let k = 0; k < 6; k++) {
        let x = rand() * W;
        let y = horizon + rand() * (H - horizon);
        g.beginPath();
        g.moveTo(x, y);
        for (let s = 0; s < 5; s++) {
          x += (rand() - 0.3) * 40;
          y += (rand() - 0.5) * 16;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.restore();
    }
    if (el === 'frost') {
      g.fillStyle = 'rgba(255,255,255,.5)';
      g.fillRect(0, horizon + 4, W, 3);
    }

    // ---- rarity: light rays behind the creature
    const cx = W / 2;
    const cy = H * 0.5;
    if (rank >= 3) {
      g.save();
      g.translate(cx, cy);
      g.globalCompositeOperation = 'lighter';
      const rays = 14 + rank * 2;
      for (let i = 0; i < rays; i++) {
        g.rotate((Math.PI * 2) / rays);
        const grd = g.createLinearGradient(0, 0, W * 0.7, 0);
        grd.addColorStop(0, rank >= 5 ? 'rgba(255,120,160,.28)' : rank >= 4 ? 'rgba(255,210,90,.28)' : 'rgba(200,140,255,.22)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(W * 0.7, -W * 0.035);
        g.lineTo(W * 0.7, W * 0.035);
        g.fill();
      }
      g.restore();
    }
    // A soft halo behind the creature in its element's color.
    const halo = g.createRadialGradient(cx, cy, 0, cx, cy, W * 0.36);
    halo.addColorStop(0, `${E.accent}${rank >= 2 ? '88' : '55'}`);
    halo.addColorStop(1, `${E.accent}00`);
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);

    // ---- the creature
    const size = H * (rank >= 4 ? 0.66 : 0.6);
    const art = document.createElement('canvas');
    art.width = art.height = Math.ceil(size * 1.5);
    const a = art.getContext('2d');
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    a.font = `${Math.round(size)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    const ac = art.width / 2;
    a.fillText(card.icon || '❓', ac, ac + size * 0.05);
    // Lighting across the body: warm/bright from the top left, element-tinted shade bottom right.
    a.globalCompositeOperation = 'source-atop';
    const lit = a.createLinearGradient(0, 0, art.width, art.height);
    lit.addColorStop(0, 'rgba(255,255,240,.28)');
    lit.addColorStop(0.5, 'rgba(255,255,255,0)');
    lit.addColorStop(1, `${E.far}88`);
    a.fillStyle = lit;
    a.fillRect(0, 0, art.width, art.height);
    a.globalCompositeOperation = 'source-over';
    // Silhouette (for the outline and rim): the creature's shape in one color.
    const sil = (color) => {
      const c = document.createElement('canvas');
      c.width = c.height = art.width;
      const s = c.getContext('2d');
      s.drawImage(art, 0, 0);
      s.globalCompositeOperation = 'source-in';
      s.fillStyle = color;
      s.fillRect(0, 0, c.width, c.height);
      return c;
    };
    const ink = sil('#0b0a12');
    const rim = sil(E.accent);
    const ox = cx - ac;
    const oy = cy - ac;
    // Shadow on the ground.
    g.save();
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.filter = 'blur(6px)';
    g.beginPath();
    g.ellipse(cx, Math.min(H - 10, cy + size * 0.5), size * 0.42, size * 0.09, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // Rim glow, ink outline, then the creature.
    g.save();
    g.shadowColor = E.accent;
    g.shadowBlur = W * (0.03 + rank * 0.006);
    g.drawImage(rim, ox, oy);
    g.restore();
    const t = Math.max(2, W * 0.008);
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2;
      g.drawImage(ink, ox + Math.cos(ang) * t, oy + Math.sin(ang) * t);
    }
    g.drawImage(rim, ox - t * 0.6, oy - t * 0.6);
    g.drawImage(art, ox, oy);

    // ---- particles in front
    const motes = 16 + rank * 10;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < motes; i++) {
      const x = rand() * W;
      const y = rand() * H;
      const r = 0.8 + rand() * (rank >= 4 ? 3 : 2);
      const grd = g.createRadialGradient(x, y, 0, x, y, r * 3);
      grd.addColorStop(0, E.mote);
      grd.addColorStop(1, `${E.mote}00`);
      g.fillStyle = grd;
      g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    }
    g.restore();
    if (el === 'water') {
      g.strokeStyle = 'rgba(220,250,255,.5)';
      for (let i = 0; i < 10; i++) {
        g.lineWidth = 1;
        g.beginPath();
        g.arc(rand() * W, rand() * H, 2 + rand() * 6, 0, Math.PI * 2);
        g.stroke();
      }
    }
    if (el === 'frost' || el === 'storm') {
      g.strokeStyle = el === 'frost' ? 'rgba(255,255,255,.6)' : 'rgba(200,215,255,.35)';
      g.lineWidth = 1;
      for (let i = 0; i < 40; i++) {
        const x = rand() * W;
        const y = rand() * H;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - 3, y + (el === 'storm' ? 14 : 3));
        g.stroke();
      }
    }
    // Vignette.
    const vg = g.createRadialGradient(cx, cy, H * 0.3, cx, cy, W * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.45)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    return cv;
  }

  const urls = new Map();
  const keyOf = (c, W) => `${c.id}|${c.element}|${c.rarity}|${W}`;
  function url(c, W = 480) {
    const k = keyOf(c, W);
    if (!urls.has(k)) {
      urls.set(k, paint(c, W).toDataURL('image/jpeg', 0.9));
      if (urls.size > 500) urls.delete(urls.keys().next().value);
    }
    return urls.get(k);
  }

  // Lazy painting, a few per frame, as cards scroll into view.
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const queue = [];
  let pumping = false;
  function pump() {
    if (pumping) return;
    pumping = true;
    const step = () => {
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < 12) {
        const img = queue.shift();
        if (!img.isConnected || img.dataset.done) continue;
        try {
          img.src = url(JSON.parse(img.dataset.card), Number(img.dataset.w) || 480);
          img.dataset.done = '1';
          img.classList.add('painted');
        } catch (e) {
          console.error(e);
        }
      }
      if (queue.length) requestAnimationFrame(step);
      else pumping = false;
    };
    requestAnimationFrame(step);
  }
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          queue.push(e.target);
        }
        pump();
      }, { rootMargin: '300px' })
    : null;
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const imgs = n.matches?.('img[data-card]') ? [n] : n.querySelectorAll?.('img[data-card]:not([data-done])') || [];
        for (const img of imgs) (io ? io.observe(img) : queue.push(img));
      }
    }
    if (!io) pump();
  }).observe(document.documentElement, { childList: true, subtree: true });

  function html(c, cls = '', W = 480) {
    const p = { id: c.id, icon: c.icon, element: c.element, rarity: c.rarity };
    const ready = urls.get(keyOf(p, W));
    if (ready) return `<img class="tc-img painted ${cls}" alt="" src="${ready}">`;
    const json = JSON.stringify(p).replace(/&/g, '&amp;').replace(/'/g, '&#39;');
    return `<img class="tc-img ${cls}" alt="" src="${BLANK}" data-w="${W}" data-card='${json}'>`;
  }
  // Paints these now (a pack's cards before they're flipped).
  function warm(list, W = 480) {
    for (const c of list) url({ id: c.id, icon: c.icon, element: c.element, rarity: c.rarity }, W);
  }

  window.MMOCardArt = { paint, url, html, warm };
})();
