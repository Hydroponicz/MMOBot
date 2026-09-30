// Relic skin artwork: every skin is painted on a canvas, pixel by pixel, from its finish, colors,
// pattern seed and float, so the same relic always looks the same and no two seeds match.
//   window.MMORelicArt.texture(relic, width)   the flat skin artwork (also the 3D model's texture)
//   window.MMORelicArt.weapon(relic, width)    the weapon: the skin on its blade/head, lit and bevelled
//   window.MMORelicArt.html(relic, cls)        an <img> that paints itself when it scrolls into view
// relic: { skin, weapon, finish, colors: [dark, mid, light], seed, float, fade, star }.
(() => {
  // ---- Seeded randomness and noise ------------------------------------------------------------
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
  // 2D gradient noise (Perlin) with its own permutation per seed.
  function makeNoise(seed) {
    const rand = prng(seed);
    const p = new Uint8Array(512);
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const gx = new Float32Array(256);
    const gy = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const a = rand() * Math.PI * 2;
      gx[i] = Math.cos(a);
      gy[i] = Math.sin(a);
    }
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const noise = (x, y) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const xf = x - xi;
      const yf = y - yi;
      const X = xi & 255;
      const Y = yi & 255;
      const g = (ix, iy, dx, dy) => {
        const h = p[p[ix] + iy];
        return gx[h] * dx + gy[h] * dy;
      };
      const u = fade(xf);
      const v = fade(yf);
      const n00 = g(X, Y, xf, yf);
      const n10 = g(X + 1, Y, xf - 1, yf);
      const n01 = g(X, Y + 1, xf, yf - 1);
      const n11 = g(X + 1, Y + 1, xf - 1, yf - 1);
      const a = n00 + u * (n10 - n00);
      const b = n01 + u * (n11 - n01);
      return a + v * (b - a); // about -0.7..0.7
    };
    const fbm = (x, y, oct = 4, lac = 2, gain = 0.5) => {
      let s = 0;
      let amp = 0.5;
      let f = 1;
      for (let i = 0; i < oct; i++) {
        s += amp * noise(x * f, y * f);
        f *= lac;
        amp *= gain;
      }
      return s;
    };
    return { noise, fbm, rand };
  }

  // ---- Colors -------------------------------------------------------------------------------
  const rgb = (hex) => {
    const n = parseInt(String(hex).slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  // A color ramp through several stops: t in 0..1.
  function ramp(stops) {
    const cols = stops.map(rgb);
    return (t) => {
      t = clamp01(t) * (cols.length - 1);
      const i = Math.min(cols.length - 2, Math.floor(t));
      return mix(cols[i], cols[i + 1], t - i);
    };
  }
  const smooth = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };

  // ---- Skin textures ------------------------------------------------------------------------
  const ASPECT = 2.4; // the 240×100 weapon box
  const cache = new Map();

  // Paints the skin into a canvas W×H. Every finish is its own little painting.
  function paintSkin(r, W, aspect = ASPECT) {
    const H = Math.max(64, Math.round(W / aspect));
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    const img = g.createImageData(W, H);
    const d = img.data;
    const seed = Number(r.seed ?? 500);
    const key = strHash(`${r.skin || r.id}:${seed}`);
    const N = makeNoise(key);
    const [c1, c2, c3] = (r.colors || ['#333333', '#777777', '#bbbbbb']).map((c) => c);
    const R = rgb(c1);
    const M = rgb(c2);
    const L = rgb(c3);
    const sx = 1 / H; // noise space: 1 unit per texture height
    const finish = r.finish || 'solid';
    const off = N.rand() * 100;

    // Per finish: a function (u, v in 0..1 across the box, x, y noise coords) -> [r, g, b].
    let shade;
    if (finish === 'fade') {
      const fade = r.fade ? (r.fade - 80) / 20 : 0.5;
      const rp = ramp([c1, c1, c2, c3]);
      shade = (u, v, x, y) => {
        const t = (u * 0.85 + v * 0.35) * (0.8 + fade * 0.35) - 0.05 + N.fbm(x * 0.5 + off, y * 0.5, 3) * 0.08;
        const c = rp(t);
        const anod = 0.93 + 0.07 * Math.sin((u * 60 + N.noise(x * 3, y * 3) * 2) * Math.PI);
        return [c[0] * anod, c[1] * anod, c[2] * anod];
      };
    } else if (finish === 'camo') {
      shade = (u, v, x, y) => {
        const wx = x * 1.4 + N.fbm(x * 0.7 + off, y * 0.7, 3) * 1.5;
        const wy = y * 1.4 + N.fbm(x * 0.7, y * 0.7 + off, 3) * 1.5;
        const n1 = N.fbm(wx, wy, 4);
        const n2 = N.fbm(wx + 40, wy - 20, 4);
        let c = R;
        if (n1 > 0.02) c = mix(c, M, smooth(0.02, 0.06, n1));
        if (n2 > 0.08) c = mix(c, L, smooth(0.08, 0.12, n2) * 0.95);
        const grain = 1 + (N.noise(x * 30, y * 30) * 0.12);
        const edge = 1 - 0.18 * (1 - smooth(0.0, 0.04, Math.abs(n1 - 0.04)));
        return [c[0] * grain * edge, c[1] * grain * edge, c[2] * grain * edge];
      };
    } else if (finish === 'stripes') {
      shade = (u, v, x, y) => {
        const w = N.fbm(x * 0.6 + off, y * 1.5, 4) * 3.2;
        const band = Math.sin((x * 2.4 + y * 0.9 + w) * 2.2);
        const band2 = Math.sin((x * 1.1 - y * 0.4 + w * 0.6) * 3.1 + 1.3);
        let c = R;
        c = mix(c, M, smooth(0.35, 0.55, band));
        c = mix(c, L, smooth(0.75, 0.9, band2) * 0.9);
        const g2 = 0.9 + N.noise(x * 25, y * 3) * 0.2;
        return [c[0] * g2, c[1] * g2, c[2] * g2];
      };
    } else if (finish === 'marble') {
      const rp = ramp([c1, c2, c3, c2, c1]);
      shade = (u, v, x, y) => {
        const turb = N.fbm(x * 0.8 + off, y * 0.8, 6) * 5;
        const t = (Math.sin(x * 1.2 + y * 0.4 + turb) + 1) / 2;
        const vein = Math.pow(1 - Math.abs(Math.sin(x * 2.1 - y * 1.3 + turb * 1.7)), 12);
        const c = rp(t * 0.8 + N.noise(x * 4, y * 4) * 0.1);
        return mix(c, [255, 255, 255], vein * 0.35);
      };
    } else if (finish === 'gem') {
      const rp = ramp([c1, c2, c3, c2, c1, c2]);
      shade = (u, v, x, y) => {
        const wx = x + N.fbm(x * 0.5 + off, y * 0.5, 5) * 3;
        const wy = y + N.fbm(x * 0.5 - off, y * 0.5 + 7, 5) * 3;
        const t = (N.fbm(wx * 0.9, wy * 0.9, 5) + 0.5) * 1.1;
        const c = rp(t);
        const glint = Math.pow(clamp01(N.noise(x * 9, y * 9) * 1.6), 6) * 1.2;
        return mix(c, [255, 255, 255], glint);
      };
    } else if (finish === 'flame') {
      const rp = ramp([c1, c1, c2, c3, '#ffffff']);
      shade = (u, v, x, y) => {
        // Tongues of flame licking along the blade.
        const flow = N.fbm(x * 0.9 - off, y * 2.2, 5) * 1.6;
        const lick = Math.abs(Math.sin(y * 2.6 + flow * 2.4 + x * 0.25));
        const heat = clamp01((1 - lick) * 1.2 + N.fbm(x * 2 + 9, y * 2, 3) * 0.6 - u * 0.25);
        return rp(Math.pow(heat, 1.3));
      };
    } else if (finish === 'crystal') {
      // Voronoi facets, each lit from its own angle, with bright edges.
      const pts = [];
      const rr = N.rand;
      const cells = 70;
      for (let i = 0; i < cells; i++) pts.push([rr() * W, rr() * H, rr(), rr() * Math.PI * 2]);
      const cols = [R, M, L];
      shade = (u, v, x, y, px, py) => {
        let b1 = 1e9;
        let b2 = 1e9;
        let best = 0;
        for (let i = 0; i < cells; i++) {
          const dx = px - pts[i][0];
          const dy = (py - pts[i][1]) * 1.4;
          const dd = dx * dx + dy * dy;
          if (dd < b1) {
            b2 = b1;
            b1 = dd;
            best = i;
          } else if (dd < b2) b2 = dd;
        }
        const pt = pts[best];
        const base = cols[Math.floor(pt[2] * 3)];
        // Facet lighting: a gradient across the cell in its own direction.
        const lit = 0.65 + 0.45 * Math.cos(pt[3] + (px - pt[0]) * 0.02 + (py - pt[1]) * 0.03);
        const edge = Math.sqrt(b2) - Math.sqrt(b1);
        const e = 1 - smooth(0, W * 0.004, edge);
        const c = [base[0] * lit, base[1] * lit, base[2] * lit];
        return mix(c, mix(L, [255, 255, 255], 0.5), e * 0.8);
      };
    } else if (finish === 'glyph') {
      shade = (u, v, x, y) => {
        const n = N.fbm(x * 0.6 + off, y * 0.6, 4);
        const c = mix(R, M, clamp01(u * 0.8 + n * 0.8));
        // Etched circuit lines.
        const gx = Math.abs(((x * 3 + N.noise(y * 2, 3) * 0.3) % 1) - 0.5);
        const gy = Math.abs(((y * 3 + N.noise(x * 2, 5) * 0.3) % 1) - 0.5);
        const line = Math.max(1 - smooth(0.0, 0.04, gx) * (N.noise(x * 1.3, y * 7) > 0 ? 1 : 0.2), 1 - smooth(0.0, 0.04, gy) * (N.noise(x * 7, y * 1.3) > 0.1 ? 1 : 0.2));
        return mix(c, L, clamp01(line - 0.2) * 0.55);
      };
    } else if (finish === 'scales') {
      shade = (u, v, x, y) => {
        const s = 2.6;
        const row = Math.floor(y * s);
        const sx2 = x * s * 0.8 + (row % 2) * 0.5;
        const col = Math.floor(sx2);
        const fx = sx2 - col - 0.5;
        const fy = y * s - row;
        const dist = Math.sqrt(fx * fx + (fy - 0.1) * (fy - 0.1));
        const inside = 1 - smooth(0.42, 0.5, dist);
        const lit = 0.55 + 0.6 * (1 - fy) * inside;
        const iri = (Math.sin((col * 1.7 + row * 2.3) + N.noise(x, y) * 3) + 1) / 2;
        const base = mix(M, L, iri * 0.6 * inside);
        const rim = smooth(0.38, 0.47, dist) * inside;
        const c = mix(mix(R, base, inside), L, rim * 0.7);
        return [c[0] * lit, c[1] * lit, c[2] * lit];
      };
    } else {
      // Solid: anodized metal with a soft gradient and brushed lines.
      const rp = ramp([c3, c2, c1]);
      shade = (u, v, x, y) => {
        const c = rp(v * 0.9 + N.fbm(x * 0.4 + off, y * 0.4, 3) * 0.25);
        const brush = 0.94 + N.noise(x * 0.4, y * 40) * 0.12;
        const fleck = Math.pow(clamp01(N.noise(x * 20, y * 20)), 8) * 2;
        return mix([c[0] * brush, c[1] * brush, c[2] * brush], [255, 255, 255], fleck);
      };
    }

    // Wear: scratches and chipped paint down to grey metal, more with a higher float.
    const float = r.float ?? null;
    const chip = float == null ? -1 : 0.62 - float * 0.55;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const u = px / W;
        const v = py / H;
        const x = px * sx * 1.7;
        const y = py * sx * 1.7;
        let c = shade(u, v, x, y, px, py);
        if (float != null && float > 0.07) {
          const wn = N.fbm(x * 1.6 + 50, y * 1.6 - 30, 4) + 0.5;
          if (wn > chip + 0.35) {
            const bare = 150 + N.noise(x * 30, y * 30) * 40;
            c = mix(c, [bare, bare + 4, bare + 10], smooth(chip + 0.35, chip + 0.4, wn));
          }
        }
        const i = (py * W + px) * 4;
        d[i] = c[0];
        d[i + 1] = c[1];
        d[i + 2] = c[2];
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // Glowing runes on top (glyph finish).
    if (finish === 'glyph') {
      const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
      const rr = prng(key + 7);
      g.save();
      g.font = `${Math.round(H * 0.16)}px serif`;
      g.fillStyle = c3;
      g.shadowColor = c3;
      g.shadowBlur = H * 0.06;
      for (let y = H * 0.14; y < H; y += H * 0.19) {
        for (let x = rr() * H * 0.2; x < W; x += H * (0.16 + rr() * 0.12)) g.fillText(runes[Math.floor(rr() * runes.length)], x, y);
      }
      g.restore();
    }
    // Sparkles on gems and fades.
    if (finish === 'gem' || (finish === 'fade' && r.star)) {
      const rr = prng(key + 11);
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 26; i++) {
        const x = rr() * W;
        const y = rr() * H;
        const s = H * (0.01 + rr() * 0.03);
        const grd = g.createRadialGradient(x, y, 0, x, y, s * 3);
        grd.addColorStop(0, 'rgba(255,255,255,.9)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(x - s * 3, y - s * 3, s * 6, s * 6);
        g.fillStyle = 'rgba(255,255,255,.8)';
        g.fillRect(x - s * 3, y - 0.6, s * 6, 1.2);
        g.fillRect(x - 0.6, y - s * 3, 1.2, s * 6);
      }
      g.restore();
    }
    // Scratches.
    if (float != null && float > 0.02) {
      const rr = prng(key + 3);
      const n = Math.floor(float * 220);
      g.save();
      g.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const x = rr() * W;
        const y = rr() * H;
        const len = W * (0.01 + rr() * 0.06);
        const a = (rr() - 0.5) * 1.2;
        g.strokeStyle = `rgba(230,232,236,${(0.15 + rr() * 0.35).toFixed(2)})`;
        g.lineWidth = Math.max(0.6, W / 900) * (0.5 + rr());
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + len * 0.5, y + (rr() - 0.5) * len * 0.2, x + Math.cos(a) * len, y + Math.sin(a) * len);
        g.stroke();
      }
      g.restore();
    }
    return cv;
  }

  // The skin painted for this relic's weapon shape, W px wide.
  function texture(r, W = 1024) {
    const aspect = aspectOf(r.weapon);
    const k = `t|${r.skin || r.id}|${r.seed ?? ''}|${r.float ?? ''}|${(r.colors || []).join()}|${r.fade ?? ''}|${W}|${aspect}`;
    if (!cache.has(k)) {
      cache.set(k, paintSkin(r, W, aspect));
      if (cache.size > 80) cache.delete(cache.keys().next().value);
    }
    return cache.get(k);
  }

  // ---- Weapons -------------------------------------------------------------------------------
  // The skinned part (blade/head) and the plain parts, in a 240×100 box (same as the 3D models).
  const SKIN_PATHS = {
    sword: 'M64,44 L200,44 L224,50 L200,56 L64,56 Z',
    greatsword: 'M70,39 L205,39 L234,50 L205,61 L70,61 Z',
    dagger: 'M108,44 L170,44 L192,50 L170,56 L108,56 Z',
    fang: 'M112,47 Q162,26 196,60 Q160,44 114,60 Z',
    saber: 'M64,45 Q150,40 228,24 Q170,52 64,56 Z',
    // A double-bitted battle axe: two crescent blades flaring from a narrow neck, and a top spike.
    axe: 'M178,44 Q174,26 154,10 Q186,-4 218,10 Q200,26 196,44 L196,56 Q200,74 218,90 Q186,104 154,90 Q174,74 178,56 Z M196,45 L226,50 L196,55 Z',
    hammer: 'M166,22 L214,22 Q220,22 220,28 L220,72 Q220,78 214,78 L166,78 Q160,78 160,72 L160,28 Q160,22 166,22 Z',
    staff: 'M14,47 L186,47 L186,53 L14,53 Z M228,50 A18,18 0 1 1 192,50 A18,18 0 1 1 228,50 Z',
    bow: 'M133,4 Q40,50 133,96 L120,96 Q62,50 120,4 Z',
    scythe: 'M192,50 Q204,6 104,8 Q170,22 182,50 Z',
    spear: 'M180,40 L234,50 L180,60 L188,50 Z',
    glaive: 'M160,38 Q218,28 234,50 Q218,72 160,62 Z',
    shield: 'M120,4 L172,16 Q172,70 120,96 Q68,70 68,16 Z',
  };
  // Where the skinned part sits in the 240×100 box: [x, y, w, h]. The artwork is painted at this
  // shape's proportions (up to 6:1) and fitted to it, so the whole painting shows on thin blades too.
  const BBOX = {
    sword: [64, 44, 160, 12], greatsword: [70, 39, 164, 22], dagger: [108, 44, 84, 12], fang: [112, 26, 84, 34],
    saber: [64, 24, 164, 32], axe: [154, 2, 72, 96], hammer: [160, 22, 60, 56], staff: [14, 32, 214, 36],
    bow: [40, 4, 93, 92], scythe: [104, 6, 100, 44], spear: [180, 40, 54, 20], glaive: [160, 28, 74, 44], shield: [68, 4, 104, 92],
  };
  const aspectOf = (weapon) => {
    const b = BBOX[weapon] || BBOX.sword;
    return Math.max(1, Math.min(6, b[2] / b[3]));
  };
  // Plain parts: [kind, material, ...] kinds: rect x y w h r · circle cx cy r · ring cx cy r w ·
  // line x1 y1 x2 y2 w · poly [points] · ellipse cx cy rx ry. Materials: grip, steel, wood, gold, string.
  const PARTS = {
    sword: [['rect', 'grip', 22, 46, 38, 8, 2], ['circle', 'gold', 17, 50, 6], ['rect', 'gold', 58, 33, 7, 34, 2]],
    greatsword: [['rect', 'grip', 12, 46, 52, 8, 2], ['circle', 'gold', 8, 50, 6], ['rect', 'gold', 62, 24, 9, 52, 3]],
    dagger: [['rect', 'grip', 62, 45, 40, 10, 3], ['circle', 'steel', 58, 50, 6], ['rect', 'steel', 101, 36, 7, 28, 2]],
    fang: [['ring', 'steel', 60, 62, 11, 5], ['poly', 'grip', [[68, 55], [114, 46], [116, 61], [72, 68]]]],
    saber: [['rect', 'grip', 22, 46, 38, 8, 2], ['circle', 'gold', 17, 50, 6], ['ellipse', 'gold', 62, 50, 5, 15]],
    axe: [['rect', 'wood', 16, 46, 184, 8, 3], ['rect', 'grip', 20, 44, 44, 12, 4], ['circle', 'steel', 15, 50, 6], ['rect', 'steel', 173, 40, 28, 20, 4], ['rect', 'steel', 64, 44, 5, 12, 2]],
    hammer: [['rect', 'wood', 18, 46, 146, 8, 3], ['rect', 'grip', 20, 45, 40, 10, 3]],
    staff: [['line', 'gold', 184, 40, 196, 34, 4], ['line', 'gold', 184, 60, 196, 66, 4], ['rect', 'grip', 80, 45, 30, 10, 3]],
    bow: [['line', 'string', 130, 6, 130, 94, 1.2], ['rect', 'grip', 84, 42, 10, 16, 3]],
    scythe: [['rect', 'wood', 14, 46, 184, 8, 3], ['rect', 'grip', 16, 45, 36, 10, 3]],
    spear: [['rect', 'wood', 10, 47, 176, 6, 3], ['rect', 'gold', 176, 45, 8, 10, 1]],
    glaive: [['rect', 'wood', 10, 47, 156, 6, 3], ['rect', 'steel', 156, 42, 8, 16, 2]],
    shield: [],
  };

  // A lit fill for a plain part.
  function partFill(g, mat, x0, y0, x1, y1) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    const stops = {
      grip: ['#4a3322', '#1c130c', '#3a2618'],
      steel: ['#e9edf2', '#8c939c', '#3a3f46'],
      wood: ['#8a5d36', '#5a3b22', '#3a2412'],
      gold: ['#fff1b0', '#d4a12a', '#6e4a0c'],
      string: ['#f4efe2', '#d8d0bc', '#a8a08c'],
    }[mat] || ['#aaa', '#777', '#444'];
    gr.addColorStop(0, stops[0]);
    gr.addColorStop(0.5, stops[1]);
    gr.addColorStop(1, stops[2]);
    return gr;
  }
  function drawParts(g, weapon) {
    for (const p of PARTS[weapon] || []) {
      const [kind, mat] = p;
      g.save();
      g.shadowColor = 'rgba(0,0,0,.45)';
      g.shadowBlur = 3;
      g.shadowOffsetY = 1.5;
      if (kind === 'rect') {
        const [, , x, y, w, h, rr] = p;
        g.fillStyle = partFill(g, mat, x, y, x, y + h);
        g.beginPath();
        g.roundRect(x, y, w, h, rr);
        g.fill();
        g.shadowColor = 'transparent';
        if (mat === 'grip') {
          // Leather wrap.
          g.strokeStyle = 'rgba(0,0,0,.45)';
          g.lineWidth = 1;
          for (let i = x + 3; i < x + w; i += 4) {
            g.beginPath();
            g.moveTo(i, y);
            g.lineTo(i - 2.5, y + h);
            g.stroke();
          }
        }
        if (mat === 'wood') {
          g.strokeStyle = 'rgba(0,0,0,.25)';
          g.lineWidth = 0.5;
          for (let i = 0; i < 3; i++) {
            g.beginPath();
            g.moveTo(x, y + h * (0.3 + i * 0.2));
            g.bezierCurveTo(x + w * 0.3, y + h * (0.2 + i * 0.25), x + w * 0.6, y + h * (0.4 + i * 0.15), x + w, y + h * (0.3 + i * 0.2));
            g.stroke();
          }
        }
      } else if (kind === 'circle') {
        const [, , cx, cy, r] = p;
        const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
        const base = { gold: ['#fff4c0', '#d4a12a', '#6e4a0c'], steel: ['#ffffff', '#9aa1aa', '#3a3f46'] }[mat] || ['#fff', '#999', '#333'];
        gr.addColorStop(0, base[0]);
        gr.addColorStop(0.5, base[1]);
        gr.addColorStop(1, base[2]);
        g.fillStyle = gr;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
      } else if (kind === 'ring') {
        const [, , cx, cy, r, w] = p;
        g.strokeStyle = partFill(g, mat, cx, cy - r, cx, cy + r);
        g.lineWidth = w;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.stroke();
      } else if (kind === 'ellipse') {
        const [, , cx, cy, rx, ry] = p;
        g.fillStyle = partFill(g, mat, cx - rx, cy, cx + rx, cy);
        g.beginPath();
        g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        g.fill();
      } else if (kind === 'line') {
        const [, , x1, y1, x2, y2, w] = p;
        g.strokeStyle = partFill(g, mat, x1, y1, x2, y2);
        g.lineWidth = w;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
      } else if (kind === 'poly') {
        const pts = p[2];
        g.fillStyle = partFill(g, mat, pts[0][0], pts[0][1], pts[2][0], pts[2][1]);
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
        g.fill();
      }
      g.restore();
    }
  }

  // The whole weapon at W px wide: parts, then the skin clipped to the blade with lighting on top.
  function paintWeapon(r, W) {
    const H = Math.round(W / ASPECT);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    const k = W / 240;
    g.scale(k, k);
    const weapon = SKIN_PATHS[r.weapon] ? r.weapon : 'sword';
    const path = new Path2D(SKIN_PATHS[weapon]);
    const tex = texture(r, Math.min(1536, Math.max(384, W * 1.5)));
    const [bx, by, bw, bh] = BBOX[weapon];
    // Soft drop shadow under the blade.
    g.save();
    g.shadowColor = 'rgba(0,0,0,.55)';
    g.shadowBlur = 5;
    g.shadowOffsetY = 3;
    g.fillStyle = '#000';
    g.fill(path);
    g.restore();
    drawParts(g, weapon);
    g.save();
    g.clip(path);
    g.drawImage(tex, bx, by, bw, bh);
    // Lighting: a bright top edge, a soft middle sheen and a darker underside.
    const light = g.createLinearGradient(0, 0, 0, 100);
    light.addColorStop(0, 'rgba(255,255,255,.35)');
    light.addColorStop(0.42, 'rgba(255,255,255,.05)');
    light.addColorStop(0.5, 'rgba(255,255,255,.18)');
    light.addColorStop(0.58, 'rgba(0,0,0,0)');
    light.addColorStop(1, 'rgba(0,0,0,.38)');
    g.fillStyle = light;
    g.fillRect(0, 0, 240, 100);
    // A diagonal glint.
    const glint = g.createLinearGradient(80, 0, 150, 100);
    glint.addColorStop(0, 'rgba(255,255,255,0)');
    glint.addColorStop(0.48, 'rgba(255,255,255,0)');
    glint.addColorStop(0.5, `rgba(255,255,255,${r.float != null && r.float > 0.38 ? 0.12 : 0.3})`);
    glint.addColorStop(0.53, 'rgba(255,255,255,0)');
    glint.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glint;
    g.fillRect(0, 0, 240, 100);
    g.restore();
    // Bevel: a light inner edge and a dark outline.
    g.save();
    g.clip(path);
    g.strokeStyle = 'rgba(255,255,255,.45)';
    g.lineWidth = 1.6;
    g.stroke(path);
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,.6)';
    g.lineWidth = 0.9;
    g.stroke(path);
    return cv;
  }

  const urlCache = new Map();
  const urlKey = (r, W) => `w|${r.skin || r.id}|${r.seed ?? ''}|${r.float ?? ''}|${(r.colors || []).join()}|${r.fade ?? ''}|${r.weapon}|${W}`;
  function weaponUrl(r, W = 480) {
    const k = urlKey(r, W);
    if (!urlCache.has(k)) {
      urlCache.set(k, paintWeapon(r, W).toDataURL('image/png'));
      if (urlCache.size > 600) urlCache.delete(urlCache.keys().next().value);
    }
    return urlCache.get(k);
  }

  // ---- Lazy images ---------------------------------------------------------------------------
  // html() returns an <img> placeholder; it's painted when it comes into view (a few per frame, so
  // big inventories don't freeze the page).
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
          const r = JSON.parse(img.dataset.relic);
          img.src = weaponUrl(r, Number(img.dataset.w) || 480);
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
      }, { rootMargin: '200px' })
    : null;
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const imgs = n.matches?.('img[data-relic]') ? [n] : n.querySelectorAll?.('img[data-relic]:not([data-done])') || [];
        for (const img of imgs) {
          if (io) io.observe(img);
          else queue.push(img);
        }
      }
    }
    if (!io) pump();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  const pick = (r) => ({ skin: r.skin || r.id, weapon: r.weapon, finish: r.finish, colors: r.colors, seed: r.seed, float: r.float, fade: r.fade, star: r.star });
  function html(r, cls = '', W = 480) {
    const p = pick(r);
    const ready = urlCache.get(urlKey(p, W));
    if (ready) return `<img class="relic-img painted ${cls}" alt="" src="${ready}">`;
    const json = JSON.stringify(p).replace(/&/g, '&amp;').replace(/'/g, '&#39;');
    return `<img class="relic-img ${cls}" alt="" src="${BLANK}" data-w="${W}" data-relic='${json}'>`;
  }
  // Paints these now (e.g. every skin in a case before its reel spins).
  function warm(list, W = 480) {
    for (const r of list) weaponUrl(pick(r), W);
  }

  window.MMORelicArt = { texture, weapon: paintWeapon, weaponUrl, html, warm, SKIN_PATHS, PARTS, BBOX, pick };
})();
