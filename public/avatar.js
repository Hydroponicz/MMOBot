// Draws a player's character (race + look) as an SVG string: window.MMOAvatar.svg(appearance, options).
// The option ids and colors come from the server (/api/appearance); fallbacks keep old pages working.
(function () {
  const COLORS = {
    skin: { porcelain: '#f7dfcd', fair: '#efc7a8', light: '#e0ae87', tan: '#c98c60', olive: '#b07b4f', brown: '#8d5a3b', dark: '#61402a', deep: '#3f281a', moss: '#8aa85e', jade: '#5f8c4c', ash: '#b9c1c9', frost: '#9db4c6' },
    hairColor: { black: '#1f1a17', darkbrown: '#4a2f1f', brown: '#7a4a2a', auburn: '#8e3b1f', red: '#c2451e', blonde: '#e0bd68', platinum: '#efe6c8', grey: '#9a9a9a', white: '#f2f2f2', blue: '#3f6fd1', green: '#3fa062', pink: '#e36fb1', purple: '#7b4cc2' },
    eyeColor: { brown: '#5a3a22', hazel: '#8a6a2f', green: '#3f8a4a', blue: '#3a6fc2', grey: '#7d8790', amber: '#d08a1c', red: '#c22a2a', violet: '#8a4cc2', glow: '#5ff2e6' },
    outfit: { red: '#b8433a', blue: '#3a64b8', green: '#3f8a4a', purple: '#6e45a8', brown: '#7a5334', black: '#2a2d33', gold: '#c9a23a' },
  };

  // Darken (amt < 0) or lighten (amt > 0) a #rrggbb color.
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    const r = mix(n >> 16), g = mix((n >> 8) & 255), b = mix(n & 255);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  function svg(appearance, { size = 120, title = '' } = {}) {
    const race = appearance?.race || 'human';
    const L = appearance?.look || {};
    const S = COLORS.skin[L.skin] || COLORS.skin.light;
    const Sd = shade(S, -0.25);
    const H = COLORS.hairColor[L.hairColor] || COLORS.hairColor.brown;
    const Hd = shade(H, -0.3);
    const E = COLORS.eyeColor[L.eyeColor] || COLORS.eyeColor.brown;
    const O = COLORS.outfit[L.outfit] || COLORS.outfit.blue;
    const hair = L.hair || 'short';
    const out = [];
    const p = (d, fill, extra = '') => out.push(`<path d="${d}" fill="${fill}" ${extra}/>`);
    const line = (d, stroke, w = 2.5, extra = '') => out.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`);

    // Head shape per race: [rx, ry].
    const [rx, ry] = { dwarf: [32, 34], halfling: [31, 33], orc: [32, 35], elf: [28, 36] }[race] || [30, 36];

    // ---- behind the head: long hair, ponytail, bun
    if (hair === 'long') p('M26,52 Q24,20 60,19 Q96,20 94,52 L98,122 Q60,130 22,122Z', Hd);
    if (hair === 'ponytail') p('M84,38 Q110,48 102,100 Q96,78 82,60Z', Hd);
    if (hair === 'bun') out.push(`<circle cx="60" cy="19" r="12" fill="${Hd}"/>`);

    // ---- body and neck
    p('M16,140 Q18,112 60,107 Q102,112 104,140Z', O);
    p('M47,109 L60,125 L73,109Z', shade(O, -0.3));
    out.push(`<rect x="52" y="88" width="16" height="22" rx="6" fill="${Sd}"/>`);

    // ---- ears
    const lx = 60 - rx + 1, rxp = 60 + rx - 1;
    if (race === 'elf') {
      p(`M${lx + 2},56 L${lx - 16},40 L${lx + 1},72Z`, S);
      p(`M${rxp - 2},56 L${rxp + 16},40 L${rxp - 1},72Z`, S);
    } else if (race === 'orc') {
      p(`M${lx + 2},56 L${lx - 12},50 L${lx + 1},72Z`, S);
      p(`M${rxp - 2},56 L${rxp + 12},50 L${rxp - 1},72Z`, S);
    } else {
      const big = race === 'halfling' ? 7 : 5;
      out.push(`<ellipse cx="${lx}" cy="64" rx="${big}" ry="8" fill="${S}"/><ellipse cx="${rxp}" cy="64" rx="${big}" ry="8" fill="${S}"/>`);
    }

    // ---- head
    out.push(`<ellipse cx="60" cy="62" rx="${rx}" ry="${ry}" fill="${S}"/>`);
    if (race === 'undead') {
      out.push(`<ellipse cx="48" cy="61" rx="8" ry="7" fill="${Sd}" opacity=".6"/><ellipse cx="72" cy="61" rx="8" ry="7" fill="${Sd}" opacity=".6"/>`);
      line('M78,74 L86,82 M79,79 L82,76 M82,82 L85,79', Sd, 1.5);
    }
    if (hair === 'bald') out.push(`<ellipse cx="52" cy="36" rx="9" ry="4" fill="#fff" opacity=".18"/>`);

    // ---- cheeks: freckles, blush, scar
    if (L.extra === 'freckles') for (const [x, y] of [[42, 70], [46, 73], [40, 74], [78, 70], [74, 73], [80, 74]]) out.push(`<circle cx="${x}" cy="${y}" r="1.1" fill="${Sd}"/>`);
    if (L.extra === 'blush') out.push(`<ellipse cx="42" cy="73" rx="6" ry="3.5" fill="#e0607a" opacity=".35"/><ellipse cx="78" cy="73" rx="6" ry="3.5" fill="#e0607a" opacity=".35"/>`);

    // ---- eyes
    const eye = (x) => {
      const style = L.eyes || 'round';
      const [ew, eh, ir] = { round: [5, 5, 3], narrow: [6, 2.8, 2.4], sleepy: [5.5, 4, 2.8], wide: [6.2, 6.2, 3.6] }[style] || [5, 5, 3];
      out.push(`<ellipse cx="${x}" cy="60" rx="${ew}" ry="${eh}" fill="#fff"/>`);
      out.push(`<circle cx="${x}" cy="60.5" r="${ir}" fill="${E}"/>`);
      if (L.eyeColor === 'glow') out.push(`<circle cx="${x}" cy="60.5" r="${ir + 2}" fill="${E}" opacity=".25"/>`);
      else out.push(`<circle cx="${x}" cy="60.5" r="${ir * 0.45}" fill="#111"/>`);
      out.push(`<circle cx="${x + 1}" cy="59" r=".9" fill="#fff"/>`);
      if (style === 'sleepy') p(`M${x - ew - 0.5},60 Q${x},${60 - eh - 3} ${x + ew + 0.5},60 L${x + ew + 0.5},${60 - eh - 1} L${x - ew - 0.5},${60 - eh - 1}Z`, S);
    };
    eye(48);
    if (L.extra === 'eyepatch') {
      line('M34,50 L86,66', '#111', 1.6);
      out.push('<ellipse cx="72" cy="61" rx="8" ry="7" fill="#111"/>');
    } else eye(72);

    // ---- brows
    const bw = L.brows === 'thick' ? 4.5 : 2.6;
    if (L.brows === 'arched') line('M41,52 Q48,44 55,51 M65,51 Q72,44 79,52', H, bw);
    else if (L.brows === 'angry') line('M41,48 L55,53 M65,53 L79,48', H, 3);
    else if (L.brows !== 'none') line('M41,51 Q48,47 55,50 M65,50 Q72,47 79,51', H, bw);

    // ---- scar
    if (L.extra === 'scar') line('M41,47 L51,70', '#a33a3a', 1.8, 'opacity=".8"');

    // ---- nose
    const nose = L.nose || 'button';
    if (nose === 'button') line('M57,73 Q60,76 63,73', Sd, 2);
    else if (nose === 'round') out.push(`<ellipse cx="60" cy="72" rx="5" ry="4" fill="${Sd}" opacity=".55"/>`);
    else if (nose === 'long') line('M60,60 L57,76 Q60,78 63,76', Sd, 2);
    else if (nose === 'hooked') line('M59,60 Q67,70 61,78 Q58,78 57,76', Sd, 2);

    // ---- facial hair (under the mouth line so the mouth stays visible)
    const fh = L.facialHair || 'none';
    const mustache = 'M47,81 Q54,75 60,79 Q66,75 73,81 Q66,80 60,82 Q54,80 47,81Z';
    const beardTop = 'Q88,78 80,84 Q70,79 60,81 Q50,79 40,84 Q32,78 30,62Z';
    if (fh === 'stubble') p('M33,70 Q35,98 60,99 Q85,98 87,70 Q82,82 74,81 Q60,77 46,81 Q38,82 33,70Z', H, 'opacity=".32"');
    if (fh === 'beard') p(`M30,62 Q30,104 60,108 Q90,104 90,62 ${beardTop}`, H);
    if (fh === 'longbeard') p(`M30,62 Q27,112 60,134 Q93,112 90,62 ${beardTop}`, H);
    if (fh === 'goatee') p('M54,90 Q60,103 66,90 Q60,93 54,90Z', H);
    if (['mustache', 'goatee', 'beard', 'longbeard'].includes(fh)) p(mustache, Hd);
    if (fh === 'handlebar') p('M41,75 Q42,83 50,80 Q55,76 60,79 Q65,76 70,80 Q78,83 79,75 Q78,85 69,83 Q63,82 60,82 Q57,82 51,83 Q42,85 41,75Z', Hd);

    // ---- mouth
    const mouth = L.mouth || 'smile';
    const lip = race === 'undead' ? '#3a3a44' : '#7a2e2e';
    if (mouth === 'smile') line('M52,85 Q60,91 68,85', lip, 2.2);
    else if (mouth === 'grin') p('M50,84 Q60,96 70,84Z', '#fff', `stroke="${lip}" stroke-width="2" stroke-linejoin="round"`);
    else if (mouth === 'neutral') line('M53,87 L67,87', lip, 2.2);
    else if (mouth === 'smirk') line('M53,87 Q62,89 68,83', lip, 2.2);
    else if (mouth === 'frown') line('M52,89 Q60,83 68,89', lip, 2.2);
    if (race === 'orc') {
      p('M51,90 L53,80 L56,90Z', '#f4efdc');
      p('M64,90 L67,80 L69,90Z', '#f4efdc');
    }

    // ---- hair in front
    if (hair === 'short' || hair === 'ponytail') p('M30,60 Q28,24 60,24 Q92,24 90,60 Q88,44 78,40 Q60,46 42,40 Q32,44 30,60Z', H);
    if (hair === 'sidepart') p('M30,62 Q28,22 62,22 Q94,24 90,60 Q86,40 74,36 Q56,44 38,45 Q32,50 30,62Z', H);
    if (hair === 'spiky') p('M30,58 L27,34 L38,38 L40,19 L50,30 L58,13 L64,30 L74,17 L78,34 L91,30 L90,58 Q86,42 60,40 Q34,42 30,58Z', H);
    if (hair === 'curly') for (const [x, y, r] of [[33, 48, 9], [38, 36, 10], [48, 28, 10], [60, 25, 10], [72, 28, 10], [82, 36, 10], [87, 48, 9]]) out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${H}"/>`);
    if (hair === 'mohawk') {
      p('M31,58 Q30,28 60,27 Q90,28 89,58 Q84,42 60,40 Q36,42 31,58Z', H, 'opacity=".25"');
      p('M52,40 L49,6 Q60,1 71,6 L68,40 Q60,36 52,40Z', H);
    }
    if (hair === 'long') p('M29,66 Q25,21 60,21 Q95,21 91,66 Q86,42 72,37 Q60,44 48,37 Q34,42 29,66Z', H);
    if (hair === 'bun') p('M31,58 Q30,26 60,26 Q90,26 89,58 Q84,40 60,38 Q36,40 31,58Z', H);
    if (hair === 'braids') {
      p('M30,62 Q28,23 60,23 Q92,23 90,62 Q86,42 62,40 L60,30 L58,40 Q34,42 30,62Z', H);
      for (const x of [29, 91]) for (let y = 64; y <= 112; y += 8) out.push(`<ellipse cx="${x}" cy="${y}" rx="5" ry="5" fill="${y % 16 ? H : Hd}"/>`);
    }

    // ---- earring
    if (L.extra === 'earring') out.push(`<circle cx="${lx}" cy="${race === 'elf' || race === 'orc' ? 73 : 74}" r="2.6" fill="none" stroke="#e8c34a" stroke-width="1.8"/>`);

    return `<svg class="char-svg" viewBox="0 0 120 140" width="${size}" height="${Math.round((size * 140) / 120)}" role="img" aria-label="${title.replace(/"/g, '&quot;')}">${title ? `<title>${title.replace(/</g, '&lt;')}</title>` : ''}${out.join('')}</svg>`;
  }

  window.MMOAvatar = { svg, COLORS };
})();
