// Draws a player's character (race + look + gear + cosmetics) as a detailed, shaded SVG portrait:
// window.MMOAvatar.svg(appearance, options). The same appearance data drives the 3D model
// (avatar3d.js), so both always match. Option ids and colors come from the server
// (/api/appearance); fallbacks keep old pages working.
// Coordinates: 0 0 120 140 (head centered at 60,62, chest to the bottom), so the overlay can place
// the drawing in bigger scenes with parts().
(function () {
  const COLORS = {
    skin: { porcelain: '#f7dfcd', fair: '#efc7a8', light: '#e0ae87', tan: '#c98c60', olive: '#b07b4f', brown: '#8d5a3b', dark: '#61402a', deep: '#3f281a', moss: '#8aa85e', jade: '#5f8c4c', ash: '#b9c1c9', frost: '#9db4c6' },
    hairColor: { black: '#1f1a17', darkbrown: '#4a2f1f', brown: '#7a4a2a', auburn: '#8e3b1f', red: '#c2451e', blonde: '#e0bd68', platinum: '#efe6c8', grey: '#9a9a9a', white: '#f2f2f2', blue: '#3f6fd1', green: '#3fa062', pink: '#e36fb1', purple: '#7b4cc2' },
    eyeColor: { brown: '#5a3a22', hazel: '#8a6a2f', green: '#3f8a4a', blue: '#3a6fc2', grey: '#7d8790', amber: '#d08a1c', red: '#c22a2a', violet: '#8a4cc2', glow: '#5ff2e6' },
    outfit: { red: '#b8433a', blue: '#3a64b8', green: '#3f8a4a', purple: '#6e45a8', brown: '#7a5334', black: '#2a2d33', gold: '#c9a23a', crimson: '#9e1b32', indigo: '#2e2a8a', saffron: '#e0a526', silver: '#b9c0c8', celestial: '#43c6c9' },
  };

  // Darken (amt < 0) or lighten (amt > 0) a #rrggbb color.
  function shade(hex, amt) {
    const n = parseInt(String(hex).slice(1), 16);
    if (Number.isNaN(n)) return hex;
    const mix = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    const r = mix(n >> 16), g = mix((n >> 8) & 255), b = mix(n & 255);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  // Each drawing gets its own gradient ids, so many portraits can share a page.
  let seq = 0;

  function parts(appearance) {
    const id = `av${(++seq).toString(36)}`;
    const race = appearance?.race || 'human';
    const L = appearance?.look || {};
    const S = COLORS.skin[L.skin] || COLORS.skin.light;
    const Sd = shade(S, -0.22);
    const Sdd = shade(S, -0.4);
    const Sl = shade(S, 0.28);
    const H = COLORS.hairColor[L.hairColor] || COLORS.hairColor.brown;
    const Hd = shade(H, -0.35);
    const Hl = shade(H, 0.35);
    const E = COLORS.eyeColor[L.eyeColor] || COLORS.eyeColor.brown;
    const O = COLORS.outfit[L.outfit] || COLORS.outfit.blue;
    const Od = shade(O, -0.35);
    const Ol = shade(O, 0.25);
    const hair = L.hair || 'short';
    const G = appearance?.gear || {};
    const C = appearance?.cosmetics || {};
    const glow = L.eyeColor === 'glow';

    const defs = [];
    const out = [];
    const p = (d, fill, extra = '') => out.push(`<path d="${d}" fill="${fill}" ${extra}/>`);
    const line = (d, stroke, w = 2.5, extra = '') => out.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`);
    // Gradients: radial (light from the upper left) and linear (top to bottom).
    const radial = (name, stops, cx = 38, cy = 30, r = 75) => {
      defs.push(`<radialGradient id="${id}${name}" cx="${cx}%" cy="${cy}%" r="${r}%">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`);
      return `url(#${id}${name})`;
    };
    const linear = (name, stops, x2 = 0, y2 = 1) => {
      defs.push(`<linearGradient id="${id}${name}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`);
      return `url(#${id}${name})`;
    };
    const metalCache = {};
    // Brushed metal: bright band near the top, dark toward the bottom.
    const metal = (c) => {
      if (!metalCache[c]) {
        metalCache[c] = {
          fill: linear(`m${Object.keys(metalCache).length}`, [[0, shade(c, 0.45)], [0.35, shade(c, 0.1)], [0.55, c], [1, shade(c, -0.45)]], 0.3, 1),
          dark: shade(c, -0.45),
          light: shade(c, 0.55),
          base: c,
        };
      }
      return metalCache[c];
    };

    const skinFill = radial('skin', [[0, Sl], [0.55, S], [1, Sd]], 40, 32, 80);
    const hairFill = linear('hair', [[0, Hl], [0.45, H], [1, Hd]]);
    const hairBack = linear('hairb', [[0, H], [1, shade(H, -0.5)]]);
    const cloth = linear('cloth', [[0, Ol], [0.5, O], [1, Od]]);

    // Head shape per race: [rx, ry].
    const [rx, ry] = { dwarf: [32, 34], halfling: [31, 33], orc: [33, 35], elf: [28, 36] }[race] || [30, 36];

    // ---- aura, cape and a weapon on the back, all behind the character
    if (C.aura) {
      const aura = radial('aura', [[0, C.aura, 0.45], [0.6, C.aura, 0.18], [1, C.aura, 0]], 50, 50, 50);
      out.push(`<circle cx="60" cy="74" r="66" fill="${aura}"/>`);
      for (const [x, y, r] of [[14, 40, 1.6], [104, 30, 1.3], [20, 96, 1.2], [100, 88, 1.7], [58, 6, 1.2]]) out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${shade(C.aura, 0.5)}" opacity=".8"/>`);
    }
    if (C.cape) {
      const cape = linear('cape', [[0, shade(C.cape, 0.15)], [1, shade(C.cape, -0.45)]]);
      p('M24,102 Q2,126 -2,140 L122,140 Q118,126 96,102Z', cape);
      line('M18,118 Q12,130 10,140 M102,118 Q108,130 110,140', shade(C.cape, -0.5), 1.2, 'opacity=".6"');
      p('M28,110 L36,86 L50,104Z', C.cape, `stroke="${shade(C.cape, -0.35)}" stroke-width="1.2"`);
      p('M92,110 L84,86 L70,104Z', C.cape, `stroke="${shade(C.cape, -0.35)}" stroke-width="1.2"`);
    }
    if (G.weapon) {
      const m = metal(G.weapon.color);
      if (G.weapon.type === 'bow') {
        const wood = linear('bow', [[0, '#b07a4a'], [1, '#5e3a1e']], 1, 0);
        line('M16,58 Q-2,96 18,134', '#4a2c14', 6);
        line('M16,58 Q-2,96 18,134', wood, 4);
        line('M16,58 L18,134', '#f0ede4', 0.9);
        out.push('<rect x="4.5" y="92" width="6" height="9" rx="2" fill="#6b4226" transform="rotate(-8 7 96)"/>');
      } else if (G.weapon.type === 'staff') {
        const orbC = G.weapon.color === '#9aa3ad' ? '#9b6bff' : G.weapon.color;
        const orb = radial('orb', [[0, '#ffffff'], [0.35, shade(orbC, 0.4)], [1, shade(orbC, -0.3)]], 35, 30, 70);
        line('M102,136 L112,26', '#3e2a17', 6);
        line('M102,136 L112,26', '#8a5d36', 3.6);
        line('M104,110 L106,96 M107,78 L109,64', '#c9a86b', 1.4, 'opacity=".7"');
        out.push(`<circle cx="112" cy="24" r="12" fill="${orbC}" opacity=".18"/><circle cx="112" cy="24" r="7.5" fill="${orb}"/><path d="M104,30 Q108,18 112,15 M120,30 Q116,18 112,15" fill="none" stroke="#c9a86b" stroke-width="1.6"/>`);
      } else if (G.weapon.type === 'battleaxe') {
        // Battleaxe on the back: a long haft and a double-bitted head.
        line('M98,136 L114,30', '#3e2a17', 5.5);
        line('M98,136 L114,30', '#8a5d36', 3.4);
        p('M113,40 Q126,30 128,48 Q124,60 111,54Z', m.fill, `stroke="${m.dark}" stroke-width=".9"`);
        p('M113,40 Q100,28 96,44 Q99,57 111,54Z', m.fill, `stroke="${m.dark}" stroke-width=".9"`);
        line('M126,36 Q130,48 125,58 M98,34 Q94,46 98,56', m.light, 1, 'opacity=".8"');
        out.push(`<circle cx="112" cy="47" r="2.6" fill="#c9a23a" stroke="#7a5a1a" stroke-width=".7"/>`);
      } else if (G.weapon.type === 'spear') {
        // Spear on the back: a tall shaft and a leaf-shaped head.
        line('M100,138 L116,10', '#3e2a17', 4.5);
        line('M100,138 L116,10', '#9a6b3e', 2.8);
        p('M116.5,-6 L121,12 L116,18 L111.5,10Z', m.fill, `stroke="${m.dark}" stroke-width=".8"`);
        line('M114,22 L118.5,22', '#c9a23a', 2.4);
      } else if (G.weapon.type === 'scythe') {
        // Scythe on the back: a long snath and a curved blade over the shoulder.
        line('M100,138 L112,18', '#2a1d12', 5);
        line('M100,138 L112,18', '#5e4a3a', 3);
        p('M112,18 Q86,4 66,22 Q90,14 110,26Z', m.fill, `stroke="${m.dark}" stroke-width=".9"`);
        line('M108,20 Q88,10 72,20', m.light, 0.8, 'opacity=".8"');
      } else if (G.weapon.type === 'dagger') {
        // Dagger at the hip.
        p('M94,104 L104,128 L101,129 L91,106Z', m.fill, `stroke="${m.dark}" stroke-width=".7"`);
        line('M88,104 L98,100', '#c9a23a', 2.4);
        line('M90,100 L86,92', '#2a1d12', 3.2);
      } else if (G.weapon.type === 'knuckles') {
        // Knuckles are too small to show on the portrait.
      } else {
        // Sword on the back: blade with a fuller, crossguard, wrapped grip and pommel.
        p('M96.5,124 L111.5,55 L116.5,56 L101.5,125Z', m.fill, `stroke="${m.dark}" stroke-width=".8"`);
        line('M100,122 L113.5,58', m.light, 0.9, 'opacity=".8"');
        line('M103,64 L121,70', '#3b2a1a', 5);
        line('M103,64 L121,70', '#c9a23a', 3);
        line('M114,54 L117,42', '#2a1d12', 4.5);
        line('M114.6,51 L116.4,49 M115.2,47.5 L117,45.5', '#7a5334', 1.2);
        out.push(`<circle cx="117.5" cy="40" r="3.2" fill="#c9a23a" stroke="#7a5a1a" stroke-width=".8"/>`);
      }
    }

    // ---- behind the head: long hair, ponytail, bun
    if (hair === 'long') p('M26,52 Q24,20 60,19 Q96,20 94,52 L98,122 Q60,130 22,122Z', hairBack);
    if (hair === 'ponytail') {
      p('M84,38 Q110,48 102,100 Q96,78 82,60Z', hairBack);
      line('M90,50 Q102,64 100,90', Hd, 1, 'opacity=".6"');
    }
    if (hair === 'bun') out.push(`<circle cx="60" cy="19" r="12.5" fill="${hairFill}" stroke="${Hd}" stroke-width=".8"/><path d="M51,16 Q60,9 69,16 M52,22 Q60,17 68,22" fill="none" stroke="${Hd}" stroke-width="1" opacity=".6"/>`);

    // ---- body: tunic with collar, seams and folds
    p('M16,140 Q18,112 60,107 Q102,112 104,140Z', cloth);
    p('M16,140 Q18,112 60,107 Q30,116 24,140Z', Od, 'opacity=".35"');
    line('M34,114 Q30,126 30,140 M86,114 Q90,126 90,140', Od, 1.2, 'opacity=".7"');
    line('M44,126 Q48,132 46,140 M76,126 Q72,132 74,140', Od, 1, 'opacity=".45"');
    p('M45,109 L60,127 L75,109 L70,108 L60,120 L50,108Z', shade(O, 0.35));
    p('M50,108 L60,120 L70,108Z', Od);
    out.push(`<circle cx="60" cy="131" r="1.6" fill="${shade(O, 0.45)}"/><circle cx="60" cy="137" r="1.6" fill="${shade(O, 0.45)}"/>`);
    if (G.body) {
      const m = metal(G.body);
      p('M20,140 Q22,113 60,109 Q98,113 100,140Z', m.fill, `stroke="${m.dark}" stroke-width="1.2"`);
      p('M40,116 Q60,110 80,116 L78,132 Q60,138 42,132Z', 'none', `stroke="${m.dark}" stroke-width="1" opacity=".6"`);
      line('M60,112 L60,140', m.dark, 1.2);
      line('M38,120 Q48,115 57,119 M63,119 Q72,115 82,120', m.light, 1.4, 'opacity=".7"');
      for (const [x, y] of [[44, 131], [76, 131], [52, 137], [68, 137]]) out.push(`<circle cx="${x}" cy="${y}" r="1.3" fill="${m.light}" stroke="${m.dark}" stroke-width=".5"/>`);
      // Pauldrons
      for (const x of [26, 94]) {
        out.push(`<ellipse cx="${x}" cy="121" rx="14" ry="9" fill="${m.fill}" stroke="${m.dark}" stroke-width="1.2"/>`);
        out.push(`<path d="M${x - 11},119 Q${x},112 ${x + 11},119" fill="none" stroke="${m.light}" stroke-width="1.2" opacity=".75"/>`);
      }
    }
    // Neck with a shadow under the chin.
    out.push(`<rect x="51.5" y="86" width="17" height="24" rx="6.5" fill="${Sd}"/>`);
    p('M51.5,92 Q60,100 68.5,92 L68.5,98 Q60,104 51.5,98Z', Sdd, 'opacity=".45"');

    // ---- ears
    const lx = 60 - rx + 1, rxp = 60 + rx - 1;
    if (race === 'elf') {
      p(`M${lx + 2},56 L${lx - 16},39 Q${lx - 6},58 ${lx + 1},72Z`, skinFill, `stroke="${Sd}" stroke-width=".8"`);
      p(`M${rxp - 2},56 L${rxp + 16},39 Q${rxp + 6},58 ${rxp - 1},72Z`, skinFill, `stroke="${Sd}" stroke-width=".8"`);
      line(`M${lx - 1},52 L${lx - 10},44 M${rxp + 1},52 L${rxp + 10},44`, Sd, 1.2, 'opacity=".7"');
    } else if (race === 'orc') {
      p(`M${lx + 2},56 L${lx - 12},49 Q${lx - 5},62 ${lx + 1},72Z`, skinFill, `stroke="${Sd}" stroke-width=".8"`);
      p(`M${rxp - 2},56 L${rxp + 12},49 Q${rxp + 5},62 ${rxp - 1},72Z`, skinFill, `stroke="${Sd}" stroke-width=".8"`);
    } else {
      const big = race === 'halfling' ? 7 : 5;
      for (const x of [lx, rxp]) {
        out.push(`<ellipse cx="${x}" cy="64" rx="${big}" ry="8.5" fill="${S}" stroke="${Sd}" stroke-width=".8"/>`);
        out.push(`<ellipse cx="${x + (x < 60 ? 1 : -1)}" cy="64.5" rx="${big * 0.5}" ry="5" fill="${Sd}" opacity=".55"/>`);
      }
    }

    // ---- head with jaw shading and a soft rim
    out.push(`<ellipse cx="60" cy="62" rx="${rx}" ry="${ry}" fill="${skinFill}" stroke="${Sdd}" stroke-width=".7" stroke-opacity=".5"/>`);
    p(`M${60 - rx + 3},70 Q${60 - rx + 8},${62 + ry - 2} 60,${62 + ry} Q${60 + rx - 8},${62 + ry - 2} ${60 + rx - 3},70 Q${60 + rx - 10},${62 + ry - 8} 60,${62 + ry - 4} Q${60 - rx + 10},${62 + ry - 8} ${60 - rx + 3},70Z`, Sd, 'opacity=".35"');
    out.push(`<ellipse cx="${60 - rx * 0.45}" cy="44" rx="${rx * 0.35}" ry="8" fill="#fff" opacity=".12"/>`);
    if (race === 'orc') p('M38,54 Q60,46 82,54 Q60,50 38,54Z', Sd, 'opacity=".6"');
    if (race === 'dwarf') out.push(`<ellipse cx="60" cy="74" rx="7" ry="5" fill="#d9786a" opacity=".3"/>`);
    if (race === 'undead') {
      out.push(`<ellipse cx="48" cy="61" rx="9" ry="8" fill="${Sdd}" opacity=".45"/><ellipse cx="72" cy="61" rx="9" ry="8" fill="${Sdd}" opacity=".45"/>`);
      p('M36,72 Q40,84 46,86 Q40,78 40,72Z M84,72 Q80,84 74,86 Q80,78 80,72Z', Sdd, 'opacity=".35"');
      line('M78,74 L86,82 M79,79 L82,76 M82,82 L85,79', Sdd, 1.3);
      line('M34,48 L40,44 M36,45 L37,49 M38.5,44 L39.5,48', Sdd, 1, 'opacity=".8"');
    }
    if (hair === 'bald') out.push(`<ellipse cx="50" cy="35" rx="11" ry="4.5" fill="#fff" opacity=".22"/>`);

    // ---- cheeks: freckles, blush
    if (L.extra === 'freckles') for (const [x, y, r] of [[42, 70, 1.1], [46, 73, 0.9], [40, 74, 1], [44, 76, 0.8], [78, 70, 1.1], [74, 73, 0.9], [80, 74, 1], [76, 76, 0.8], [57, 72, 0.7], [63, 72, 0.7]]) out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${Sdd}" opacity=".8"/>`);
    const blush = radial('blush', [[0, '#e0607a', 0.5], [1, '#e0607a', 0]], 50, 50, 50);
    if (L.extra === 'blush' || race === 'halfling') out.push(`<ellipse cx="42" cy="73" rx="8" ry="5" fill="${blush}"/><ellipse cx="78" cy="73" rx="8" ry="5" fill="${blush}"/>`);

    // ---- eyes: socket shadow, white, iris with a gradient, pupil, two highlights, lid and lashes
    const iris = radial('iris', [[0, shade(E, 0.45)], [0.6, E], [1, shade(E, -0.45)]], 50, 40, 60);
    const eye = (x) => {
      const style = L.eyes || 'round';
      const [ew, eh, ir] = { round: [5.2, 5, 3.1], narrow: [6.2, 2.9, 2.5], sleepy: [5.6, 4.2, 2.9], wide: [6.4, 6.2, 3.7] }[style] || [5, 5, 3];
      out.push(`<ellipse cx="${x}" cy="61" rx="${ew + 2.2}" ry="${eh + 2.2}" fill="${Sd}" opacity=".35"/>`);
      out.push(`<ellipse cx="${x}" cy="60" rx="${ew}" ry="${eh}" fill="${glow ? '#dffcfa' : '#fbfbf8'}"/>`);
      out.push(`<ellipse cx="${x}" cy="${60 - eh * 0.45}" rx="${ew}" ry="${eh * 0.5}" fill="${Sd}" opacity=".18"/>`);
      if (glow) out.push(`<circle cx="${x}" cy="60.5" r="${ir + 3}" fill="${E}" opacity=".3"/>`);
      out.push(`<circle cx="${x}" cy="60.5" r="${ir}" fill="${iris}" stroke="${shade(E, -0.55)}" stroke-width=".5"/>`);
      if (!glow) out.push(`<circle cx="${x}" cy="60.5" r="${ir * 0.45}" fill="#111"/>`);
      out.push(`<circle cx="${x + 1.1}" cy="59" r="1" fill="#fff"/><circle cx="${x - 1.2}" cy="62" r=".5" fill="#fff" opacity=".8"/>`);
      // Upper lid line and lashes.
      out.push(`<path d="M${x - ew - 0.6},60 Q${x},${60 - eh - 1.6} ${x + ew + 0.6},60" fill="none" stroke="#2a1d17" stroke-width="1.3" stroke-linecap="round"/>`);
      out.push(`<path d="M${x + ew},58.6 l1.6,-1.6 M${x - ew},58.6 l-1.6,-1.6" stroke="#2a1d17" stroke-width=".9" stroke-linecap="round"/>`);
      if (style === 'sleepy') p(`M${x - ew - 0.6},60 Q${x},${60 - eh - 2.5} ${x + ew + 0.6},60 L${x + ew + 0.6},${60 - eh - 1.5} L${x - ew - 0.6},${60 - eh - 1.5}Z`, S);
      if (style === 'sleepy') line(`M${x - ew},59.6 Q${x},58 ${x + ew},59.6`, '#2a1d17', 1.2);
    };
    eye(48);
    if (L.extra === 'eyepatch') {
      line('M32,49 L88,65', '#111', 1.6);
      out.push('<ellipse cx="72" cy="61" rx="8.5" ry="7.5" fill="#15151a" stroke="#000" stroke-width=".8"/><ellipse cx="70" cy="58.5" rx="3" ry="1.6" fill="#fff" opacity=".12"/>');
    } else eye(72);

    // ---- brows (tapered)
    if (L.brows !== 'none') {
      const t = L.brows === 'thick' ? 2.4 : 1.4;
      const brow = (x0, x1, yEnd, yMid, dir) => {
        const [a, b] = dir > 0 ? [x0, x1] : [x1, x0];
        p(`M${a},${yEnd} Q${(a + b) / 2},${yMid - t} ${b},${yEnd - (L.brows === 'angry' ? 0 : 1)} Q${(a + b) / 2},${yMid + t} ${a},${yEnd + t * 0.9}Z`, H, `stroke="${Hd}" stroke-width=".5"`);
      };
      if (L.brows === 'arched') {
        brow(41, 55, 51, 44, 1);
        brow(65, 79, 51, 44, -1);
      } else if (L.brows === 'angry') {
        p('M41,47 L55,52 L55,54.5 L41,49.5Z', H);
        p('M79,47 L65,52 L65,54.5 L79,49.5Z', H);
      } else {
        brow(41, 55, 50.5, 47, 1);
        brow(65, 79, 50.5, 47, -1);
      }
    }

    // ---- scar
    if (L.extra === 'scar') {
      line('M41,46 L51,71', '#8e2f2f', 2.2, 'opacity=".75"');
      line('M42,52 L46,51 M44,58 L48,57 M46,64 L50,63', '#8e2f2f', 1, 'opacity=".7"');
    }

    // ---- nose with a shadow side and a highlight
    const nose = L.nose || 'button';
    if (nose === 'button') {
      out.push(`<ellipse cx="60" cy="72.5" rx="4.2" ry="3.2" fill="${Sd}" opacity=".45"/><circle cx="58.8" cy="71.2" r="1.2" fill="#fff" opacity=".35"/>`);
      line('M56.5,74 Q60,76.6 63.5,74', Sdd, 1.3, 'opacity=".8"');
    } else if (nose === 'round') {
      out.push(`<ellipse cx="60" cy="72" rx="5.8" ry="4.6" fill="${Sd}" opacity=".6"/><ellipse cx="58.5" cy="70.5" rx="2" ry="1.4" fill="#fff" opacity=".3"/><circle cx="57.4" cy="74" r="1" fill="${Sdd}"/><circle cx="62.6" cy="74" r="1" fill="${Sdd}"/>`);
    } else if (nose === 'long') {
      p('M59,58 L56,75 Q60,78 64,75 L61,58Z', Sd, 'opacity=".45"');
      line('M60,59 L57,75.5 Q60,77.8 63,75.5', Sdd, 1.4);
    } else if (nose === 'hooked') {
      p('M59,58 Q69,68 62,78 Q58,78 57,76 Q62,70 59,58Z', Sd, 'opacity=".5"');
      line('M59,59 Q67,69 61.5,77.5 Q58.5,78 57,76', Sdd, 1.4);
    }
    if (race === 'orc') out.push(`<circle cx="57.4" cy="74.5" r="1.3" fill="${Sdd}"/><circle cx="62.6" cy="74.5" r="1.3" fill="${Sdd}"/>`);

    // ---- facial hair (drawn before the mouth so the mouth stays visible)
    const fh = L.facialHair || 'none';
    const beardFill = linear('beard', [[0, H], [1, Hd]]);
    const mustache = 'M47,81 Q54,75 60,79 Q66,75 73,81 Q66,80 60,82 Q54,80 47,81Z';
    const beardTop = 'Q88,78 80,84 Q70,79 60,81 Q50,79 40,84 Q32,78 30,62Z';
    if (fh === 'stubble') {
      p('M33,70 Q35,98 60,99 Q85,98 87,70 Q82,82 74,81 Q60,77 46,81 Q38,82 33,70Z', H, 'opacity=".3"');
      for (let i = 0; i < 28; i++) out.push(`<circle cx="${(38 + ((i * 37) % 44)).toFixed(1)}" cy="${(84 + ((i * 13) % 12)).toFixed(1)}" r=".45" fill="${Hd}" opacity=".6"/>`);
    }
    if (fh === 'beard') {
      p(`M30,62 Q30,104 60,108 Q90,104 90,62 ${beardTop}`, beardFill);
      line('M40,88 Q42,98 48,104 M50,92 Q52,100 54,106 M70,92 Q68,100 66,106 M80,88 Q78,98 72,104', Hl, 0.9, 'opacity=".45"');
    }
    if (fh === 'longbeard') {
      p(`M30,62 Q27,112 60,134 Q93,112 90,62 ${beardTop}`, beardFill);
      line('M40,90 Q42,108 52,124 M52,94 Q54,112 58,130 M68,94 Q66,112 62,130 M80,90 Q78,108 68,124', Hl, 0.9, 'opacity=".45"');
      if (race === 'dwarf') out.push(`<rect x="55.5" y="114" width="9" height="5" rx="1.5" fill="#c9a23a" stroke="#7a5a1a" stroke-width=".6"/>`);
    }
    if (fh === 'goatee') p('M54,90 Q60,104 66,90 Q60,93 54,90Z', beardFill);
    if (['mustache', 'goatee', 'beard', 'longbeard'].includes(fh)) {
      p(mustache, Hd);
      line('M50,80 Q54,78 58,79.5 M62,79.5 Q66,78 70,80', Hl, 0.7, 'opacity=".5"');
    }
    if (fh === 'handlebar') p('M41,75 Q42,83 50,80 Q55,76 60,79 Q65,76 70,80 Q78,83 79,75 Q78,85 69,83 Q63,82 60,82 Q57,82 51,83 Q42,85 41,75Z', Hd);

    // ---- mouth with lips
    const mouth = L.mouth || 'smile';
    const lip = race === 'undead' ? '#3a3a44' : shade(S, -0.45);
    const lipL = race === 'undead' ? '#55555f' : '#b0605a';
    if (mouth === 'smile') {
      p('M52,85 Q60,92 68,85 Q60,89.5 52,85Z', lipL, 'opacity=".7"');
      line('M52,85 Q60,91 68,85', lip, 1.8);
    } else if (mouth === 'grin') {
      p('M50,84 Q60,97 70,84Z', '#fff', `stroke="${lip}" stroke-width="1.8" stroke-linejoin="round"`);
      line('M51.5,86.5 Q60,89 68.5,86.5', '#ddd', 0.8);
    } else if (mouth === 'neutral') {
      p('M53,86 Q60,89.5 67,86 Q60,87.5 53,86Z', lipL, 'opacity=".6"');
      line('M53,86.6 L67,86.6', lip, 1.8);
    } else if (mouth === 'smirk') {
      p('M54,87 Q62,90 68,84 Q62,88 54,87Z', lipL, 'opacity=".6"');
      line('M53,87 Q62,89 68,83', lip, 1.8);
    } else if (mouth === 'frown') {
      p('M52,89 Q60,85 68,89 Q60,91 52,89Z', lipL, 'opacity=".55"');
      line('M52,89 Q60,83.5 68,89', lip, 1.8);
    }
    if (race === 'orc') {
      const tusk = linear('tusk', [[0, '#fffbea'], [1, '#cfc4a0']]);
      p('M50.5,91 L53,79 L57,91Z', tusk, 'stroke="#a89c78" stroke-width=".6"');
      p('M63,91 L67,79 L69.5,91Z', tusk, 'stroke="#a89c78" stroke-width=".6"');
    }

    // ---- hair in front, with strands
    const strands = (d) => line(d, Hl, 0.9, 'opacity=".45"');
    if (hair === 'short' || hair === 'ponytail') {
      p('M30,60 Q28,24 60,24 Q92,24 90,60 Q88,44 78,40 Q60,46 42,40 Q32,44 30,60Z', hairFill, `stroke="${Hd}" stroke-width=".7"`);
      strands('M40,32 Q48,28 56,30 M64,30 Q74,28 82,34 M36,44 Q40,36 48,34');
    }
    if (hair === 'sidepart') {
      p('M30,62 Q28,22 62,22 Q94,24 90,60 Q86,40 74,36 Q56,44 38,45 Q32,50 30,62Z', hairFill, `stroke="${Hd}" stroke-width=".7"`);
      strands('M44,28 Q60,24 76,30 M40,36 Q56,34 70,34 M74,26 Q84,32 88,44');
    }
    if (hair === 'spiky') {
      p('M30,58 L27,34 L38,38 L40,19 L50,30 L58,13 L64,30 L74,17 L78,34 L91,30 L90,58 Q86,42 60,40 Q34,42 30,58Z', hairFill, `stroke="${Hd}" stroke-width=".7"`);
      strands('M40,22 L44,34 M58,16 L59,32 M74,20 L71,34');
    }
    if (hair === 'curly') {
      for (const [x, y, r] of [[33, 48, 9], [38, 36, 10], [48, 28, 10], [60, 25, 10], [72, 28, 10], [82, 36, 10], [87, 48, 9]]) {
        out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${hairFill}" stroke="${Hd}" stroke-width=".7"/><path d="M${x - r * 0.5},${y - r * 0.1} Q${x},${y - r * 0.7} ${x + r * 0.5},${y - r * 0.1}" fill="none" stroke="${Hl}" stroke-width=".9" opacity=".5"/>`);
      }
    }
    if (hair === 'mohawk') {
      p('M31,58 Q30,28 60,27 Q90,28 89,58 Q84,42 60,40 Q36,42 31,58Z', H, 'opacity=".25"');
      p('M52,40 L49,6 Q60,1 71,6 L68,40 Q60,36 52,40Z', hairFill, `stroke="${Hd}" stroke-width=".7"`);
      strands('M55,36 L54,10 M60,35 L60,6 M65,36 L66,10');
    }
    if (hair === 'long') {
      p('M29,66 Q25,21 60,21 Q95,21 91,66 Q86,42 72,37 Q60,44 48,37 Q34,42 29,66Z', hairFill, `stroke="${Hd}" stroke-width=".7"`);
      strands('M40,30 Q50,26 58,28 M64,28 Q74,26 82,32 M32,50 Q36,40 44,36 M88,50 Q84,40 76,36');
    }
    if (hair === 'bun') {
      p('M31,58 Q30,26 60,26 Q90,26 89,58 Q84,40 60,38 Q36,40 31,58Z', hairFill, `stroke="${Hd}" stroke-width=".7"`);
      strands('M40,34 Q50,30 58,30 M62,30 Q72,30 80,34');
    }
    if (hair === 'braids') {
      p('M30,62 Q28,23 60,23 Q92,23 90,62 Q86,42 62,40 L60,30 L58,40 Q34,42 30,62Z', hairFill, `stroke="${Hd}" stroke-width=".7"`);
      for (const x of [29, 91]) {
        for (let y = 64; y <= 112; y += 8) out.push(`<ellipse cx="${x}" cy="${y}" rx="5.2" ry="5" fill="${y % 16 ? H : Hd}" stroke="${Hd}" stroke-width=".6"/><path d="M${x - 3},${y - 1} Q${x},${y - 3} ${x + 3},${y - 1}" fill="none" stroke="${Hl}" stroke-width=".7" opacity=".5"/>`);
        out.push(`<rect x="${x - 3}" y="116" width="6" height="3" rx="1" fill="#c9a23a"/>`);
      }
    }

    // ---- helmet (a cosmetic hat shows instead) and hats
    if (G.head && !C.hat) {
      const m = metal(G.head);
      p('M27,64 Q25,19 60,18 Q95,19 93,64 L86,64 L86,49 Q60,40 34,49 L34,64Z', m.fill, `stroke="${m.dark}" stroke-width="1.2"`);
      out.push(`<rect x="57" y="44" width="6" height="22" rx="2" fill="${m.fill}" stroke="${m.dark}" stroke-width="1"/>`);
      line('M36,30 Q48,22 60,22', m.light, 2, 'opacity=".75"');
      line('M60,19 L60,44', m.dark, 1.2, 'opacity=".6"');
      for (const x of [31, 89]) for (const y of [52, 59]) out.push(`<circle cx="${x}" cy="${y}" r="1.1" fill="${m.light}"/>`);
    }
    const hat = C.hat;
    if (hat === 'party') {
      p('M46,30 L60,2 L74,30Z', linear('party', [[0, '#ff7ab0'], [1, '#c03a74']], 1, 0));
      line('M52,20 L66,24 M49,26 L70,30', '#ffd84a', 2.5);
      out.push('<circle cx="60" cy="3" r="4" fill="#ffd84a"/>');
    } else if (hat === 'chef') {
      out.push('<circle cx="45" cy="16" r="10" fill="#fafafa" stroke="#dcdcdc"/><circle cx="60" cy="11" r="12" fill="#fff" stroke="#dcdcdc"/><circle cx="75" cy="16" r="10" fill="#fafafa" stroke="#dcdcdc"/><rect x="38" y="18" width="44" height="14" rx="3" fill="#f0f0f0" stroke="#d0d0d0"/>');
    } else if (hat === 'bunny') {
      out.push('<ellipse cx="47" cy="14" rx="7" ry="17" fill="#f5f5f5" stroke="#dcdcdc" transform="rotate(-12 47 14)"/><ellipse cx="47" cy="15" rx="3.5" ry="12" fill="#f4a6c0" transform="rotate(-12 47 15)"/><ellipse cx="73" cy="14" rx="7" ry="17" fill="#f5f5f5" stroke="#dcdcdc" transform="rotate(12 73 14)"/><ellipse cx="73" cy="15" rx="3.5" ry="12" fill="#f4a6c0" transform="rotate(12 73 15)"/>');
    } else if (hat === 'wizard') {
      p('M36,33 Q58,18 68,0 Q74,20 86,33Z', linear('wiz', [[0, '#5b71e0'], [1, '#27358a']], 1, 0));
      out.push('<ellipse cx="60" cy="33" rx="33" ry="6" fill="#2d3e96"/><text x="63" y="24" font-size="9" fill="#ffd84a" text-anchor="middle">★</text><text x="52" y="30" font-size="5" fill="#ffd84a">✦</text>');
    } else if (hat === 'tophat') {
      out.push(`<rect x="41" y="2" width="38" height="30" rx="2" fill="${linear('top', [[0, '#34343c'], [0.5, '#1c1c22'], [1, '#0e0e12']], 1, 0)}"/><rect x="41" y="23" width="38" height="5" fill="#b8323a"/><ellipse cx="60" cy="32" rx="31" ry="5" fill="#15151a"/>`);
    } else if (hat === 'pirate') {
      p('M24,36 Q34,10 60,10 Q86,10 96,36 Q60,26 24,36Z', '#1f1f24', 'stroke="#c9a23a" stroke-width="1.2"');
      out.push('<circle cx="60" cy="22" r="4" fill="#f2f2f2"/><path d="M56,28 L64,28" stroke="#f2f2f2" stroke-width="2"/>');
    } else if (hat === 'viking') {
      const horn = linear('horn', [[0, '#fff8e4'], [1, '#c9b98a']]);
      p('M33,21 Q20,16 18,2 Q26,14 38,17Z', horn);
      p('M87,21 Q100,16 102,2 Q94,14 82,17Z', horn);
      p('M30,44 Q30,14 60,14 Q90,14 90,44Z', metal('#9aa3ad').fill, 'stroke="#6f7780" stroke-width="1.2"');
      out.push('<rect x="30" y="38" width="60" height="7" rx="2" fill="#7a5334"/>');
    } else if (hat === 'demon') {
      const horn = linear('dhorn', [[0, '#e03a44'], [1, '#6e1016']]);
      p('M40,30 Q30,20 32,4 Q38,18 48,24Z', horn, 'stroke="#6e1016" stroke-width="1.2"');
      p('M80,30 Q90,20 88,4 Q82,18 72,24Z', horn, 'stroke="#6e1016" stroke-width="1.2"');
    } else if (hat === 'halo') {
      out.push('<ellipse cx="60" cy="10" rx="22" ry="6" fill="none" stroke="#ffd84a" stroke-width="8" opacity=".22"/><ellipse cx="60" cy="10" rx="22" ry="6" fill="none" stroke="#ffe27a" stroke-width="3"/>');
    } else if (hat === 'champion') {
      out.push('<ellipse cx="60" cy="18" rx="30" ry="14" fill="#ffd84a" opacity=".22"/>');
      p('M32,33 L32,10 L42,20 L51,4 L60,16 L69,4 L78,20 L88,10 L88,33Z', linear('champ', [[0, '#ffe98a'], [1, '#c8961a']]), 'stroke="#a8801a" stroke-width="1.2"');
      out.push('<rect x="32" y="27" width="56" height="7" rx="2" fill="#c0392b"/><circle cx="51" cy="6" r="2.5" fill="#fff"/><circle cx="69" cy="6" r="2.5" fill="#fff"/><circle cx="60" cy="24" r="4" fill="#3fb6c9"/>');
    } else if (hat === 'laurel-silver' || hat === 'laurel-bronze') {
      const lc = hat === 'laurel-silver' ? '#d9dee5' : '#c9894a';
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const [lx2, ly2] = [30 + t * 22, 44 - Math.sin(t * Math.PI * 0.9) * 20];
        out.push(`<ellipse cx="${lx2.toFixed(1)}" cy="${ly2.toFixed(1)}" rx="6" ry="3" fill="${lc}" stroke="${shade(lc, -0.35)}" stroke-width=".5" transform="rotate(${(-60 + t * 60).toFixed(0)} ${lx2.toFixed(1)} ${ly2.toFixed(1)})"/>`);
        out.push(`<ellipse cx="${(120 - lx2).toFixed(1)}" cy="${ly2.toFixed(1)}" rx="6" ry="3" fill="${lc}" stroke="${shade(lc, -0.35)}" stroke-width=".5" transform="rotate(${(60 - t * 60).toFixed(0)} ${(120 - lx2).toFixed(1)} ${ly2.toFixed(1)})"/>`);
      }
    } else if (hat === 'pumpkin') {
      out.push(`<ellipse cx="60" cy="24" rx="26" ry="16" fill="${radial('pump', [[0, '#ffa04a'], [1, '#c85a0c']])}"/><ellipse cx="60" cy="24" rx="10" ry="16" fill="#e46a10" opacity=".6"/><path d="M47,10 Q60,6 73,10" stroke="#c75a0c" stroke-width="2" fill="none"/><rect x="57" y="2" width="6" height="9" rx="2" fill="#4d7a2a"/>`);
    } else if (hat === 'antlers') {
      line('M40,34 Q34,18 26,8 M31,16 L22,16 M34,24 L26,28 M80,34 Q86,18 94,8 M89,16 L98,16 M86,24 L94,28', '#5e3a1e', 5);
      line('M40,34 Q34,18 26,8 M31,16 L22,16 M34,24 L26,28 M80,34 Q86,18 94,8 M89,16 L98,16 M86,24 L94,28', '#9a6a40', 3);
    } else if (hat === 'flowers') {
      const cols = ['#ff6ad5', '#ffd84a', '#7fd8ff', '#ff8a3a', '#b58cf0', '#ff6ad5', '#ffd84a'];
      cols.forEach((c, i) => {
        const x = 32 + i * 9.3;
        const y = 30 - Math.sin((i / 6) * Math.PI) * 10;
        out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${c}" stroke="${shade(c, -0.3)}" stroke-width=".6"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" fill="#fff6c2"/>`);
      });
    } else if (hat === 'samurai') {
      p('M26,44 Q26,14 60,14 Q94,14 94,44 L100,50 L84,46 L84,40 Q60,32 36,40 L36,46 L20,50Z', linear('sam', [[0, '#3a3d45'], [1, '#15161a']]), 'stroke="#111" stroke-width="1.2"');
      p('M48,16 Q40,0 30,2 Q42,6 54,18Z', '#e8c34a');
      p('M72,16 Q80,0 90,2 Q78,6 66,18Z', '#e8c34a');
      out.push('<circle cx="60" cy="20" r="4" fill="#c0392b"/>');
    } else if (hat === 'crown') {
      p('M36,32 L36,12 L47,22 L60,5 L73,22 L84,12 L84,32Z', linear('crown', [[0, '#fff0a0'], [0.5, '#e8c34a'], [1, '#a8801a']]), 'stroke="#8a6a1a" stroke-width="1.2"');
      out.push('<circle cx="60" cy="25" r="3.5" fill="#c0392b"/><circle cx="46" cy="27" r="2.5" fill="#3a64b8"/><circle cx="74" cy="27" r="2.5" fill="#3f8a4a"/><circle cx="59" cy="24" r="1" fill="#fff" opacity=".7"/>');
    }

    // ---- shield in front, pet at their feet, prestige stars
    if (G.shield) {
      const m = metal(G.shield);
      p('M3,106 L31,106 L31,124 Q17,141 3,124Z', m.fill, `stroke="${m.dark}" stroke-width="1.8"`);
      p('M6,109 L28,109 L28,123 Q17,136 6,123Z', 'none', `stroke="${m.light}" stroke-width=".9" opacity=".6"`);
      out.push(`<circle cx="17" cy="119" r="4.2" fill="${m.fill}" stroke="${m.dark}" stroke-width="1"/><circle cx="16" cy="118" r="1.3" fill="${m.light}"/>`);
    }
    // The pet's picture (public/pets/<id>.png); the emoji only for data without an id.
    if (appearance?.petId && /^pet_[a-z_]+$/.test(appearance.petId)) out.push(`<image href="/pets/${appearance.petId}.png" x="86" y="111" width="34" height="34"/>`);
    else if (appearance?.pet) out.push(`<text x="104" y="131" font-size="24" text-anchor="middle" dominant-baseline="central">${appearance.pet}</text>`);
    if (appearance?.stars > 0) out.push(`<text x="4" y="12" font-size="11" font-weight="700" fill="#ffd84a">★${appearance.stars > 1 ? appearance.stars : ''}</text>`);

    // ---- earring
    if (L.extra === 'earring') out.push(`<circle cx="${lx}" cy="${race === 'elf' || race === 'orc' ? 73 : 74}" r="2.6" fill="none" stroke="#e8c34a" stroke-width="1.8"/><circle cx="${lx - 1}" cy="${race === 'elf' || race === 'orc' ? 72 : 73}" r=".6" fill="#fff"/>`);

    return `<defs>${defs.join('')}</defs>${out.join('')}`;
  }

  // head: crop to just the face (for small spots like leaderboards).
  function svg(appearance, { size = 120, title = '', head = false } = {}) {
    const box = head ? '14 8 92 92' : '0 0 120 140';
    const height = head ? size : Math.round((size * 140) / 120);
    return `<svg xmlns="http://www.w3.org/2000/svg" class="char-svg" viewBox="${box}" width="${size}" height="${height}" role="img" aria-label="${title.replace(/"/g, '&quot;')}">${title ? `<title>${title.replace(/</g, '&lt;')}</title>` : ''}${parts(appearance)}</svg>`;
  }

  // Skin and outfit colors of a look, for drawing arms next to the character.
  const colorsOf = (appearance) => ({
    skin: COLORS.skin[appearance?.look?.skin] || COLORS.skin.light,
    outfit: COLORS.outfit[appearance?.look?.outfit] || COLORS.outfit.blue,
  });

  window.MMOAvatar = { svg, parts, colorsOf, COLORS, shade };
})();
