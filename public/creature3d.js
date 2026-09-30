// Original creature art for the trading cards: every creature is built in 3D from its own
// blueprint (a body plan plus horns, wings, manes, shells, tentacles, flames, crystals...) and
// rendered cel-shaded so it reads like an illustration. cardart.js puts the render into the
// painted scene with an ink outline and rim light.
//   window.MMOCreatures.render(card, size) -> a transparent canvas (or null without WebGL)
import * as THREE from 'three';

// ---- Toon look -------------------------------------------------------------------------------------
let gradient = null;
function toonRamp() {
  if (gradient) return gradient;
  const data = new Uint8Array([70, 70, 70, 255, 150, 150, 150, 255, 225, 225, 225, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}
function kit() {
  const cache = new Map();
  const mat = (color, { glow = null, gi = 1, opacity = 1 } = {}) => {
    const k = `${color}|${glow}|${gi}|${opacity}`;
    if (!cache.has(k)) {
      const m = new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: toonRamp() });
      if (glow) {
        m.emissive = new THREE.Color(glow);
        m.emissiveIntensity = gi;
      }
      if (opacity < 1) {
        m.transparent = true;
        m.opacity = opacity;
        m.depthWrite = false;
      }
      cache.set(k, m);
    }
    return cache.get(k);
  };
  return { mat, dispose: () => cache.forEach((m) => m.dispose()) };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function mesh(geo, m, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(...pos);
  o.rotation.set(...rot);
  o.scale.set(...scale);
  return o;
}
const sph = (r, s = 28) => new THREE.SphereGeometry(r, s, Math.round(s * 0.7));
// An ellipsoid.
const ell = (m, pos, [sx, sy, sz], rot = [0, 0, 0]) => mesh(sph(1), m, pos, rot, [sx, sy, sz]);
// A capsule limb between two points.
function limb(r, a, b, m, r2 = null) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = r2 == null ? new THREE.CapsuleGeometry(r, Math.max(0.001, len), 6, 14) : new THREE.CylinderGeometry(r2, r, len, 14);
  const o = new THREE.Mesh(geo, m);
  o.position.copy(a).addScaledVector(dir, 0.5);
  o.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
  return o;
}
// A tapering tube along points (tails, horns, necks, tentacles).
function taper(points, r0, r1, m, steps = 10) {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(points);
  for (let i = 0; i < steps; i++) {
    const a = curve.getPoint(i / steps);
    const b = curve.getPoint((i + 1) / steps);
    const r = r0 + (r1 - r0) * (i / steps);
    g.add(limb(Math.max(0.004, r), a, b, m));
  }
  return g;
}
const cone = (r, h, m, pos, rot = [0, 0, 0], seg = 12) => mesh(new THREE.ConeGeometry(r, h, seg), m, pos, rot);
// Points a cone from `at` along `dir`.
function spike(r, h, m, at, dir) {
  const o = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10), m);
  const d = dir.clone().normalize();
  o.position.copy(at).addScaledVector(d, h / 2);
  o.quaternion.setFromUnitVectors(V(0, 1, 0), d);
  return o;
}
// A flat wing from an outline (in x/y), extruded thin and hinged at its root.
function wingShape(kind, span) {
  const s = new THREE.Shape();
  if (kind === 'bat') {
    s.moveTo(0, 0);
    s.lineTo(span * 0.35, span * 0.55);
    s.lineTo(span * 0.6, span * 0.35);
    s.quadraticCurveTo(span * 0.62, span * 0.1, span * 0.8, span * 0.25);
    s.lineTo(span, span * 0.05);
    s.quadraticCurveTo(span * 0.8, -span * 0.02, span * 0.72, -span * 0.12);
    s.quadraticCurveTo(span * 0.55, -span * 0.02, span * 0.45, -span * 0.16);
    s.quadraticCurveTo(span * 0.3, -span * 0.05, span * 0.2, -span * 0.14);
    s.quadraticCurveTo(span * 0.1, -span * 0.04, 0, -span * 0.08);
  } else if (kind === 'insect') {
    s.ellipse(span * 0.5, 0, span * 0.5, span * 0.16, 0, Math.PI * 2);
  } else if (kind === 'butterfly') {
    s.moveTo(0, 0);
    s.bezierCurveTo(span * 0.2, span * 0.9, span * 1.1, span * 0.8, span * 0.9, span * 0.2);
    s.bezierCurveTo(span * 0.8, 0, span * 0.9, -span * 0.5, span * 0.5, -span * 0.55);
    s.bezierCurveTo(span * 0.2, -span * 0.5, span * 0.1, -span * 0.1, 0, 0);
  } else {
    // Feathered: a long rounded wing with a scalloped trailing edge.
    s.moveTo(0, 0);
    s.quadraticCurveTo(span * 0.4, span * 0.45, span, span * 0.3);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x0 = span * (1 - i / n);
      const x1 = span * (1 - (i + 1) / n);
      s.quadraticCurveTo((x0 + x1) / 2, span * (0.02 - i * 0.02), x1, span * (0.18 - (i + 1) * 0.035));
    }
    s.lineTo(0, -span * 0.05);
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: span * 0.025, bevelEnabled: false, curveSegments: 16 });
  return geo;
}
// A pair of wings on the back at `at`, spread to both sides (z).
function wings(kind, span, m, at, { lift = 0.5, sweep = 0.4, m2 = null } = {}) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(wingShape(kind, span), m);
    w.position.copy(at);
    // The shape lies in x/y; turn it out sideways (along z) and tilt it up and back.
    w.rotation.set(0, s * (Math.PI / 2 - sweep), 0);
    w.rotateX(s * 0);
    w.rotateZ(lift);
    if (s < 0) w.scale.z = -1;
    g.add(w);
    if (kind === 'butterfly' && m2) {
      const spot = new THREE.Mesh(new THREE.CircleGeometry(span * 0.13, 20), m2);
      spot.position.set(span * 0.55, span * 0.3, span * 0.03);
      w.add(spot);
    }
  }
  return g;
}
// Big cartoon eyes: white, iris/pupil and a catch light. glow = glowing eyes (no white).
function eyes(g, at, r, { color = '#1a1410', glow = null, gap = 1, look = V(1, 0, 0.35), spread = 0.6 } = {}, K) {
  for (const s of [-1, 1]) {
    const c = at.clone().add(V(0, 0, s * r * 1.35 * gap));
    if (glow) {
      g.add(mesh(sph(r * 0.8, 16), K.mat(glow, { glow, gi: 2.2 }), c.toArray(), [0, 0, 0], [1, 0.75, 1]));
      continue;
    }
    g.add(mesh(sph(r, 18), K.mat('#fbfbf6'), c.toArray()));
    const d = look.clone().normalize();
    d.z += s * 0.25 * spread;
    d.normalize();
    g.add(mesh(sph(r * 0.58, 14), K.mat(color), c.clone().addScaledVector(d, r * 0.62).toArray()));
    g.add(mesh(sph(r * 0.18, 8), K.mat('#ffffff', { glow: '#ffffff', gi: 0.8 }), c.clone().addScaledVector(d, r * 0.95).add(V(0, r * 0.25, 0)).toArray()));
  }
}

// ---- Body plans --------------------------------------------------------------------------------------
// Every plan builds a creature facing +x, standing on y = 0. spec fields are listed per plan.

// Four legs: fox, wolf, bear, boar, stag, lion, tiger, rhino, mammoth, horse, dragons...
function quad(s, K) {
  const g = new THREE.Group();
  const body = K.mat(s.color);
  const belly = K.mat(s.belly || s.color);
  const dark = K.mat(s.dark || '#1b1512');
  const L = s.len ?? 0.75;
  const R = s.girth ?? 0.42;
  const legH = s.legH ?? 0.45;
  const legT = s.legT ?? 0.1;
  const y = legH + R * 0.7;
  g.add(ell(body, [0, y, 0], [L, R, R * 0.85]));
  g.add(ell(belly, [0.05, y - R * 0.35, 0], [L * 0.8, R * 0.6, R * 0.7]));
  // Legs and paws.
  for (const [lx, lz] of [[L * 0.6, R * 0.5], [L * 0.6, -R * 0.5], [-L * 0.6, R * 0.5], [-L * 0.6, -R * 0.5]]) {
    g.add(limb(legT, V(lx, y - R * 0.3, lz), V(lx + 0.02, 0.06, lz), body));
    g.add(ell(s.hooves ? dark : belly, [lx + 0.04, 0.05, lz], [legT * 1.4, legT * 0.7, legT * 1.2]));
  }
  // Neck and head.
  const hx = L * 0.95 + (s.neck ?? 0.15);
  const hy = y + R * 0.6 + (s.neckUp ?? 0.25);
  const HR = s.head ?? 0.3;
  g.add(limb(R * 0.45, V(L * 0.6, y + R * 0.3, 0), V(hx - HR * 0.3, hy - HR * 0.2, 0), body));
  if (s.longNeck) g.add(taper([V(L * 0.5, y + R * 0.2, 0), V(L * 0.9, y + R * 0.9, 0), V(hx, hy, 0)], R * 0.4, HR * 0.6, body, 6));
  g.add(ell(body, [hx, hy, 0], [HR * 1.05, HR * 0.95, HR * 0.9]));
  const sn = s.snout ?? 0.35;
  if (sn > 0) {
    g.add(ell(s.muzzle ? K.mat(s.muzzle) : body, [hx + HR * 0.7 + sn * 0.3, hy - HR * 0.2, 0], [sn * 0.7, HR * 0.5, HR * 0.55]));
    g.add(mesh(sph(HR * 0.16, 12), dark, [hx + HR * 0.65 + sn, hy - HR * 0.1, 0]));
    if (s.teeth) for (const z of [-1, 1]) g.add(cone(HR * 0.06, HR * 0.22, K.mat('#fffbe8'), [hx + HR * 0.5 + sn * 0.8, hy - HR * 0.55, z * HR * 0.22], [Math.PI, 0, 0]));
  }
  eyes(g, V(hx + HR * 0.55, hy + HR * 0.25, 0), HR * 0.24, { gap: 0.95, glow: s.eyeGlow, color: s.eye }, K);
  // Ears.
  for (const z of [-1, 1]) {
    const ex = hx - HR * 0.15;
    const ey = hy + HR * 0.8;
    const ez = z * HR * 0.55;
    if (s.ears === 'pointy') g.add(spike(HR * 0.28, HR * 0.6, body, V(ex, ey - HR * 0.1, ez), V(-0.1, 1, z * 0.35)));
    else if (s.ears === 'long') g.add(ell(body, [ex - HR * 0.1, ey + HR * 0.55, ez * 0.8], [HR * 0.2, HR * 0.8, HR * 0.12], [0, 0, 0.25]));
    else if (s.ears === 'round') g.add(ell(body, [ex, ey - HR * 0.05, ez], [HR * 0.3, HR * 0.3, HR * 0.15]));
    else if (s.ears === 'floppy') g.add(ell(body, [ex - HR * 0.1, ey - HR * 0.5, z * HR * 0.9], [HR * 0.22, HR * 0.5, HR * 0.1], [0, 0, -0.3]));
  }
  // Horns, antlers, tusks, trunk, unicorn horn, mane.
  const hornM = K.mat(s.hornColor || '#efe6c8');
  if (s.horns === 'bull') for (const z of [-1, 1]) g.add(taper([V(hx, hy + HR * 0.6, z * HR * 0.5), V(hx - 0.05, hy + HR * 0.8, z * HR * 1.3), V(hx + 0.15, hy + HR * 1.5, z * HR * 1.5)], HR * 0.2, HR * 0.03, hornM, 8));
  if (s.horns === 'ram') for (const z of [-1, 1]) g.add(taper([V(hx, hy + HR * 0.6, z * HR * 0.5), V(hx - HR * 0.6, hy + HR * 0.9, z * HR * 0.9), V(hx - HR * 0.5, hy, z * HR * 1.1), V(hx, hy + HR * 0.1, z * HR * 1.0)], HR * 0.22, HR * 0.06, hornM, 12));
  if (s.horns === 'dragon') for (const z of [-1, 1]) g.add(taper([V(hx - HR * 0.2, hy + HR * 0.7, z * HR * 0.45), V(hx - HR * 0.8, hy + HR * 1.2, z * HR * 0.6), V(hx - HR * 1.4, hy + HR * 1.4, z * HR * 0.55)], HR * 0.16, HR * 0.02, hornM, 8));
  if (s.antlers) {
    const am = K.mat('#b88a5a');
    for (const z of [-1, 1]) {
      g.add(taper([V(hx - HR * 0.1, hy + HR * 0.8, z * HR * 0.4), V(hx - HR * 0.3, hy + HR * 1.6, z * HR * 0.9), V(hx - HR * 0.6, hy + HR * 2.4, z * HR * 1.2)], HR * 0.09, HR * 0.03, am, 8));
      g.add(taper([V(hx - HR * 0.25, hy + HR * 1.4, z * HR * 0.8), V(hx + HR * 0.2, hy + HR * 2.0, z * HR * 1.0)], HR * 0.06, HR * 0.02, am, 4));
      g.add(taper([V(hx - HR * 0.45, hy + HR * 2.0, z * HR * 1.05), V(hx - HR * 0.1, hy + HR * 2.6, z * HR * 1.3)], HR * 0.05, HR * 0.02, am, 4));
      if (s.antlerLeaves) for (let i = 0; i < 4; i++) g.add(ell(K.mat('#5aa84a'), [hx - HR * (0.2 + i * 0.12), hy + HR * (1.5 + i * 0.3), z * HR * (0.8 + i * 0.12)], [HR * 0.15, HR * 0.08, HR * 0.12]));
    }
  }
  if (s.tusks) for (const z of [-1, 1]) g.add(taper([V(hx + HR * 0.6, hy - HR * 0.45, z * HR * 0.3), V(hx + HR * (0.9 + s.tusks * 0.5), hy - HR * 0.4, z * HR * 0.45), V(hx + HR * (1.1 + s.tusks), hy + HR * 0.2, z * HR * 0.35)], HR * 0.1, HR * 0.03, K.mat('#fffbe8'), 8));
  if (s.trunk) g.add(taper([V(hx + HR * 0.8, hy - HR * 0.1, 0), V(hx + HR * 1.2, hy - HR * 0.7, 0), V(hx + HR * 1.1, hy - HR * 1.4, 0), V(hx + HR * 1.35, hy - HR * 1.75, 0)], HR * 0.22, HR * 0.09, body, 10));
  if (s.unicorn) g.add(spike(HR * 0.1, HR * 1.1, K.mat('#ffe27a', { glow: '#ffd24a', gi: 0.4 }), V(hx + HR * 0.35, hy + HR * 0.75, 0), V(0.45, 1, 0)));
  if (s.nosehorn) g.add(spike(HR * 0.2, HR * 0.8, hornM, V(hx + HR * 0.6 + sn * 0.7, hy - HR * 0.05, 0), V(0.4, 1, 0)));
  if (s.mane) {
    const mm = K.mat(s.mane);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      g.add(mesh(sph(HR * 0.42, 14), mm, [hx - HR * 0.35 + Math.cos(a) * HR * 0.25, hy + Math.sin(a) * HR * 0.95, Math.cos(a + 1.2) * HR * 0.9]));
    }
    if (s.maneThorns) for (let i = 0; i < 8; i++) g.add(spike(HR * 0.06, HR * 0.35, K.mat('#4a3322'), V(hx - HR * 0.5, hy + Math.sin(i) * HR * 0.8, Math.cos(i) * HR * 0.9), V(-0.3, Math.sin(i), Math.cos(i))));
  }
  if (s.horseMane) for (let i = 0; i < 6; i++) g.add(cone(HR * 0.18, HR * 0.6, K.mat(s.horseMane, s.maneGlow ? { glow: s.horseMane, gi: 1.3 } : {}), [hx - HR * 0.6 - i * 0.09, hy + HR * 0.4 - i * 0.07, 0], [0, 0, 0.8]));
  // Tail.
  const tx = -L * 0.95;
  const tm = s.tailColor ? K.mat(s.tailColor) : body;
  if (s.tail === 'bushy') g.add(ell(tm, [tx - 0.25, y + 0.1, 0], [0.34, 0.16, 0.16], [0, 0, 0.5]));
  else if (s.tail === 'long' || s.tail === 'dragon') {
    g.add(taper([V(tx + 0.1, y, 0), V(tx - 0.35, y - 0.1, 0.15), V(tx - 0.75, y - 0.35, -0.1), V(tx - 1.05, y - 0.3 + (s.tail === 'dragon' ? 0.1 : 0), 0.1)], R * 0.45, 0.03, tm, 12));
    if (s.tail === 'dragon') g.add(spike(0.07, 0.18, hornM, V(tx - 1.05, y - 0.22, 0.1), V(-1, 0.3, 0)));
  } else if (s.tail === 'thin') g.add(taper([V(tx + 0.05, y + 0.05, 0), V(tx - 0.3, y + 0.15, 0.05), V(tx - 0.5, y - 0.1, 0)], 0.04, 0.015, tm, 6));
  else if (s.tail === 'lion') {
    g.add(taper([V(tx + 0.05, y + 0.05, 0), V(tx - 0.3, y + 0.2, 0), V(tx - 0.55, y + 0.35, 0)], 0.05, 0.03, tm, 6));
    g.add(mesh(sph(0.1, 12), K.mat(s.mane || s.dark || '#4a3322'), [tx - 0.58, y + 0.38, 0]));
  } else if (s.tail === 'short') g.add(mesh(sph(0.1, 12), tm, [tx - 0.02, y + 0.05, 0]));
  else if (s.tail === 'flat') g.add(ell(K.mat('#5a3b22'), [tx - 0.3, y - 0.3, 0], [0.32, 0.05, 0.16], [0, 0, 0.35]));
  // Back: spikes, plates, shell, flames, crystals, stripes, wings.
  if (s.spikes) for (let i = 0; i < 7; i++) g.add(spike(0.05, 0.14 + (i % 2) * 0.05, K.mat(s.spikes), V(L * 0.7 - i * L * 0.28, y + R * 0.92, 0), V(0, 1, 0)));
  if (s.shell) {
    g.add(mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), K.mat(s.shell), [0, y - R * 0.25, 0], [0, 0, 0], [L * 1.1, R * 1.5, R * 1.15]));
    for (let i = 0; i < 6; i++) g.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 6), K.mat(s.shellPlate || '#6b5a3a'), [Math.cos(i) * L * 0.5, y + R * 0.9 + Math.sin(i * 2) * 0.05, Math.sin(i) * R * 0.6], [0.3 * Math.sin(i), 0, 0.3 * Math.cos(i)]));
    if (s.moss) for (let i = 0; i < 8; i++) g.add(mesh(sph(0.08, 10), K.mat('#5a9a3a'), [Math.cos(i * 1.7) * L * 0.6, y + R * 1.05, Math.sin(i * 1.7) * R * 0.7]));
  }
  if (s.flames) {
    const fm = K.mat('#ffb03a', { glow: '#ff6a1a', gi: 1.6 });
    for (let i = 0; i < 6; i++) g.add(cone(0.07, 0.28 + (i % 3) * 0.1, fm, [L * 0.6 - i * L * 0.3, y + R * 0.95, (i % 2 ? 0.06 : -0.06)], [0, 0, 0.35]));
  }
  if (s.crystals) {
    const cm = K.mat(s.crystals, { glow: s.crystals, gi: 0.5 });
    for (let i = 0; i < 6; i++) g.add(spike(0.06, 0.28 + (i % 3) * 0.08, cm, V(L * 0.6 - i * L * 0.25, y + R * 0.85, (i % 2 ? 0.08 : -0.08)), V(i % 2 ? -0.2 : 0.2, 1, i % 2 ? 0.3 : -0.3)));
  }
  if (s.stripes) for (let i = 0; i < 5; i++) g.add(mesh(new THREE.TorusGeometry(R * 0.86, 0.025, 6, 24, Math.PI), K.mat(s.stripes), [L * 0.55 - i * L * 0.27, y + 0.02, 0], [0, Math.PI / 2, 0], [1, 1.15, 1]));
  if (s.cracks) {
    const lm = K.mat('#ffb03a', { glow: '#ff5a1a', gi: 2 });
    for (let i = 0; i < 6; i++) g.add(limb(0.018, V(L * 0.5 - i * 0.2, y + R * 0.5, R * 0.62), V(L * 0.4 - i * 0.2, y - R * 0.1, R * 0.7), lm));
  }
  if (s.wings) g.add(wings(s.wings, s.wingSpan ?? 1.1, K.mat(s.wingColor || s.color), V(L * 0.2, y + R * 0.8, 0), { lift: 0.55, sweep: 0.35 }));
  return g;
}

// Two legs: golems, imps, trolls, oni, balrog, efreet, sprites, yeti, mummy, lich, knights, titans.
function biped(s, K) {
  const g = new THREE.Group();
  const body = K.mat(s.color);
  const skin = K.mat(s.skin || s.color);
  const W = s.width ?? 0.42;
  const legH = s.legs === 'none' ? 0.35 : s.legH ?? 0.55;
  const torsoH = s.torso ?? 0.55;
  const ty = legH + torsoH * 0.5;
  // Lower body: legs, a fishtail, a ghostly wisp or a genie's smoke tail.
  if (s.lower === 'fishtail') {
    g.add(taper([V(0, legH, 0), V(0.1, legH * 0.5, 0), V(0.3, 0.12, 0), V(0.6, 0.08, 0)], W * 0.55, 0.05, K.mat(s.tailColor || '#2ab0a0'), 10));
    g.add(ell(K.mat(s.tailColor || '#2ab0a0'), [0.7, 0.1, 0], [0.2, 0.06, 0.25], [0, 0, 0.4]));
  } else if (s.lower === 'wisp') {
    g.add(taper([V(0, legH + 0.05, 0), V(-0.05, legH * 0.55, 0.05), V(-0.2, 0.15, -0.05), V(-0.35, 0.05, 0)], W * 0.8, 0.02, K.mat(s.color, s.ghost ? { opacity: 0.8 } : {}), 10));
  } else {
    const lm = K.mat(s.legColor || s.color);
    for (const z of [-1, 1]) {
      g.add(limb(W * 0.24, V(0, legH, z * W * 0.45), V(0.03, 0.08, z * W * 0.5), lm));
      g.add(ell(K.mat(s.feet || s.legColor || s.color), [0.08, 0.06, z * W * 0.5], [W * 0.32, W * 0.16, W * 0.26]));
    }
  }
  // Torso (rocky for golems, bark for treants).
  if (s.rocky) {
    const rm = K.mat(s.color);
    for (let i = 0; i < 9; i++) g.add(mesh(new THREE.DodecahedronGeometry(W * (0.35 + (i % 3) * 0.08), 0), rm, [Math.cos(i * 1.3) * W * 0.35, ty + Math.sin(i * 2.1) * torsoH * 0.35, Math.sin(i * 1.3) * W * 0.35], [i, i * 0.7, 0]));
    if (s.moss) for (let i = 0; i < 6; i++) g.add(mesh(sph(W * 0.12, 10), K.mat('#5a9a3a'), [Math.cos(i) * W * 0.4, ty + torsoH * 0.4, Math.sin(i) * W * 0.4]));
    if (s.cracks) for (let i = 0; i < 6; i++) g.add(limb(0.015, V(W * 0.45, ty + i * 0.08 - 0.2, -0.2 + i * 0.08), V(W * 0.5, ty + i * 0.08 - 0.1, -0.1 + i * 0.08), K.mat('#ffb03a', { glow: '#ff5a1a', gi: 2 })));
  } else if (s.bark) {
    g.add(mesh(new THREE.CylinderGeometry(W * 0.75, W * 0.9, torsoH * 1.6, 10), body, [0, ty + torsoH * 0.2, 0]));
    for (let i = 0; i < 8; i++) g.add(limb(0.02, V(Math.cos(i) * W * 0.8, ty - torsoH * 0.5, Math.sin(i) * W * 0.8), V(Math.cos(i) * W * 0.72, ty + torsoH * 0.9, Math.sin(i) * W * 0.72), K.mat('#4a3322')));
  } else {
    g.add(ell(body, [0, ty, 0], [W * 0.75, torsoH * 0.62, W * 0.62]));
    if (s.belly) g.add(ell(K.mat(s.belly), [W * 0.3, ty - torsoH * 0.1, 0], [W * 0.5, torsoH * 0.45, W * 0.45]));
  }
  if (s.robe) g.add(mesh(new THREE.ConeGeometry(W * 0.95, torsoH * 1.6, 16, 1, true), K.mat(s.robe), [0, legH + torsoH * 0.1, 0]));
  if (s.armor) {
    const am = K.mat(s.armor);
    g.add(ell(am, [0.02, ty + torsoH * 0.1, 0], [W * 0.8, torsoH * 0.5, W * 0.68]));
    for (const z of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(W * 0.4, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), am, [0, ty + torsoH * 0.45, z * W * 0.8], [0, 0, 0]));
  }
  // Arms, hands and whatever they hold.
  const sh = ty + torsoH * 0.35;
  const armM = K.mat(s.armColor || s.skin || s.color);
  const armLen = s.longArms ? 0.75 : 0.5;
  for (const z of [-1, 1]) {
    const hand = V(0.25 + (s.reach ?? 0), sh - armLen, z * (W * 0.95 + 0.08));
    g.add(limb(W * (s.bulky ? 0.24 : 0.16), V(0, sh, z * W * 0.8), hand, armM));
    g.add(mesh(sph(W * (s.bulky ? 0.26 : 0.17), 14), K.mat(s.hands || s.skin || s.color), hand.toArray()));
    if (s.claws) for (let k = 0; k < 3; k++) g.add(spike(0.015, 0.08, K.mat('#efe6c8'), hand.clone().add(V(0.06, -0.03, (k - 1) * 0.04)), V(1, -0.5, 0)));
    if (z === 1 && s.weapon) g.add(weapon(s.weapon, hand, K, s));
    if (z === -1 && s.weapon === 'lantern') g.add(weapon('lantern', hand, K, s));
  }
  // Head.
  const HR = s.head ?? 0.28;
  const hy = sh + HR * (s.hunch ? 0.5 : 1.05);
  const hx = s.hunch ? 0.2 : 0.02;
  const headM = K.mat(s.skin || s.color);
  if (s.headShape === 'shark') {
    g.add(ell(headM, [hx + 0.1, hy, 0], [HR * 1.6, HR * 0.9, HR * 0.9]));
    g.add(spike(HR * 0.3, HR * 1.0, headM, V(hx, hy + HR * 0.6, 0), V(-0.4, 1, 0)));
    for (let k = 0; k < 5; k++) g.add(cone(HR * 0.06, HR * 0.18, K.mat('#fffbe8'), [hx + HR * 1.0 + k * 0.01, hy - HR * 0.45, (k - 2) * HR * 0.14], [Math.PI, 0, 0]));
  } else if (s.headShape === 'rock') g.add(mesh(new THREE.DodecahedronGeometry(HR * 1.1, 0), headM, [hx, hy, 0], [0.3, 0.4, 0]));
  else g.add(ell(headM, [hx, hy, 0], [HR, HR * 1.02, HR * 0.95]));
  if (s.hood) g.add(mesh(new THREE.SphereGeometry(HR * 1.25, 20, 12, Math.PI * 0.35, Math.PI * 1.3, 0, Math.PI * 0.62), K.mat(s.hood), [hx - HR * 0.1, hy + HR * 0.05, 0], [0, 0, 0.1]));
  if (s.bandages) for (let k = 0; k < 5; k++) g.add(mesh(new THREE.TorusGeometry(HR * 0.98, HR * 0.07, 6, 24), K.mat('#e8dcc0'), [hx, hy - HR * 0.6 + k * HR * 0.3, 0], [Math.PI / 2 + (k % 2 ? 0.2 : -0.15), 0, 0]));
  if (s.skull) {
    g.add(mesh(sph(HR * 0.2, 10), K.mat('#111'), [hx + HR * 0.8, hy - HR * 0.35, 0]));
  }
  eyes(g, V(hx + HR * 0.72, hy + HR * 0.12, 0), HR * (s.smallEyes ? 0.14 : 0.2), { glow: s.eyeGlow, color: s.eye, gap: 0.9 }, K);
  if (s.nose) g.add(ell(K.mat(s.nose === true ? s.skin || s.color : s.nose), [hx + HR * 0.95, hy - HR * 0.1, 0], [HR * 0.2, HR * 0.16, HR * 0.16]));
  if (s.mouth === 'fangs') for (const z of [-1, 1]) g.add(cone(HR * 0.07, HR * 0.25, K.mat('#fffbe8'), [hx + HR * 0.85, hy - HR * 0.45, z * HR * 0.25], [Math.PI, 0, 0]));
  if (s.mouth === 'tusks') for (const z of [-1, 1]) g.add(spike(HR * 0.08, HR * 0.35, K.mat('#fffbe8'), V(hx + HR * 0.85, hy - HR * 0.5, z * HR * 0.3), V(0.2, 1, z * 0.2)));
  if (s.beard) g.add(taper([V(hx + HR * 0.6, hy - HR * 0.5, 0), V(hx + HR * 0.75, hy - HR * 1.2, 0), V(hx + HR * 0.6, hy - HR * 1.9, 0)], HR * 0.45, HR * 0.06, K.mat(s.beard), 8));
  if (s.ears === 'pointy') for (const z of [-1, 1]) g.add(spike(HR * 0.2, HR * 0.7, headM, V(hx - HR * 0.1, hy + HR * 0.2, z * HR * 0.85), V(-0.2, 0.6, z)));
  if (s.horns) {
    const hm = K.mat(s.hornColor || '#2a1a14');
    for (const z of [-1, 1]) {
      if (s.horns === 'curved') g.add(taper([V(hx, hy + HR * 0.6, z * HR * 0.5), V(hx - HR * 0.4, hy + HR * 1.3, z * HR * 1.0), V(hx + HR * 0.2, hy + HR * 1.9, z * HR * 1.1)], HR * 0.2, HR * 0.03, hm, 8));
      else if (s.horns === 'bull') g.add(taper([V(hx, hy + HR * 0.5, z * HR * 0.6), V(hx, hy + HR * 0.6, z * HR * 1.4), V(hx + HR * 0.3, hy + HR * 1.2, z * HR * 1.6)], HR * 0.2, HR * 0.04, hm, 8));
      else g.add(spike(HR * 0.16, HR * 0.7, hm, V(hx, hy + HR * 0.75, z * HR * 0.45), V(0.1, 1, z * 0.25)));
    }
  }
  if (s.crown) {
    const cm = K.mat(s.crown, { glow: s.crownGlow || null, gi: 0.8 });
    g.add(mesh(new THREE.CylinderGeometry(HR * 0.8, HR * 0.8, HR * 0.3, 16, 1, true), cm, [hx, hy + HR * 0.85, 0]));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      g.add(cone(HR * 0.12, HR * 0.4, cm, [hx + Math.cos(a) * HR * 0.8, hy + HR * 1.15, Math.sin(a) * HR * 0.8]));
    }
  }
  if (s.helm) {
    const hm = K.mat(s.helm);
    g.add(mesh(new THREE.SphereGeometry(HR * 1.12, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), hm, [hx, hy, 0], [0, 0, -0.15]));
    g.add(mesh(new THREE.BoxGeometry(HR * 0.1, HR * 0.5, HR * 1.6), K.mat('#111'), [hx + HR * 0.95, hy + HR * 0.05, 0]));
    g.add(spike(HR * 0.12, HR * 0.8, hm, V(hx - HR * 0.2, hy + HR * 1.0, 0), V(-0.5, 1, 0)));
  }
  if (s.hair) for (let k = 0; k < 7; k++) g.add(taper([V(hx - HR * 0.3, hy + HR * 0.5, (k - 3) * HR * 0.22), V(hx - HR * 1.0, hy - HR * 0.3, (k - 3) * HR * 0.3), V(hx - HR * 1.2, hy - HR * 1.6, (k - 3) * HR * 0.32)], HR * 0.16, HR * 0.03, K.mat(s.hair, s.hairGlow ? { glow: s.hair, gi: 0.8 } : {}), 6));
  if (s.fur) for (let k = 0; k < 10; k++) g.add(mesh(sph(W * 0.3, 10), K.mat(s.fur), [Math.cos(k) * W * 0.55, ty + Math.sin(k * 2) * torsoH * 0.4, Math.sin(k) * W * 0.55]));
  if (s.leaves) for (let k = 0; k < 12; k++) g.add(mesh(sph(HR * (0.4 + (k % 3) * 0.15), 12), K.mat(k % 3 ? '#3f8a3a' : '#5aa84a'), [hx - 0.1 + Math.cos(k * 1.9) * HR * 1.3, hy + HR * 1.1 + Math.sin(k * 1.3) * HR * 0.5, Math.sin(k * 1.9) * HR * 1.3]));
  if (s.branches) for (const z of [-1, 1]) g.add(taper([V(0, sh, z * W * 0.7), V(-0.1, sh + 0.35, z * W * 1.4), V(-0.05, sh + 0.7, z * W * 1.8)], 0.05, 0.015, K.mat('#5a3b22'), 6));
  if (s.wings) g.add(wings(s.wings, s.wingSpan ?? 0.9, K.mat(s.wingColor || s.color, s.wingGlow ? { glow: s.wingColor, gi: 0.6, opacity: 0.75 } : {}), V(-W * 0.4, sh, 0), { lift: 0.6, sweep: 0.5 }));
  if (s.tail) g.add(taper([V(-W * 0.5, legH + 0.05, 0), V(-W * 1.2, legH - 0.1, 0.1), V(-W * 1.8, legH + 0.15, 0)], 0.06, 0.015, K.mat(s.tailColor || s.color), 8));
  if (s.flames) {
    const fm = K.mat('#ffb03a', { glow: '#ff6a1a', gi: 1.8 });
    for (let k = 0; k < 7; k++) g.add(cone(0.06, 0.25 + (k % 3) * 0.1, fm, [hx - HR * 0.3 + Math.cos(k) * HR * 0.4, hy + HR * 0.9 + (k % 2) * 0.05, Math.sin(k) * HR * 0.6], [0, 0, 0.2]));
  }
  if (s.crystals) {
    const cm = K.mat(s.crystals, { glow: s.crystals, gi: 0.5 });
    for (let k = 0; k < 8; k++) g.add(spike(0.06, 0.28 + (k % 3) * 0.1, cm, V(Math.cos(k * 0.8) * W * 0.5, sh + 0.05, Math.sin(k * 0.8) * W * 0.8), V(-0.2, 1, Math.sin(k * 0.8) * 0.6)));
  }
  return g;
}

// Held things.
function weapon(kind, hand, K, s) {
  const g = new THREE.Group();
  g.position.copy(hand);
  const wood = K.mat('#6b4428');
  const steel = K.mat('#c8ced6');
  if (kind === 'club') {
    g.add(taper([V(0, 0, 0), V(0.25, 0.35, 0), V(0.35, 0.7, 0)], 0.05, 0.13, wood, 6));
    for (let k = 0; k < 4; k++) g.add(spike(0.03, 0.1, steel, V(0.3, 0.6 + k * 0.03, 0), V(Math.cos(k * 1.6), 0.3, Math.sin(k * 1.6))));
  } else if (kind === 'pickaxe') {
    g.add(limb(0.025, V(0, -0.1, 0), V(0.1, 0.55, 0), wood));
    g.add(taper([V(-0.12, 0.5, 0), V(0.1, 0.6, 0), V(0.32, 0.48, 0)], 0.035, 0.012, steel, 6));
  } else if (kind === 'sword') {
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.8, 0.02), steel, [0.1, 0.45, 0], [0, 0, -0.2]));
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.04, 0.05), K.mat(s.gold || '#c9a23a'), [0.02, 0.05, 0], [0, 0, -0.2]));
  } else if (kind === 'staff') {
    g.add(limb(0.025, V(0, -0.5, 0), V(0.05, 0.75, 0), wood));
    g.add(mesh(sph(0.09, 16), K.mat(s.orb || '#9b6bff', { glow: s.orb || '#9b6bff', gi: 1.8 }), [0.05, 0.85, 0]));
  } else if (kind === 'trident') {
    g.add(limb(0.02, V(0, -0.5, 0), V(0.05, 0.8, 0), K.mat('#c9a23a')));
    for (const z of [-1, 0, 1]) g.add(spike(0.025, 0.18, K.mat('#c9a23a'), V(0.05, 0.8, z * 0.07), V(0, 1, z * 0.3)));
  } else if (kind === 'whip') {
    g.add(taper([V(0, 0, 0), V(0.4, -0.2, 0.2), V(0.6, -0.5, -0.1), V(0.9, -0.55, 0.1)], 0.03, 0.008, K.mat('#ffb03a', { glow: '#ff5a1a', gi: 1.5 }), 10));
  } else if (kind === 'lantern') {
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.14, 8), K.mat('#ffe27a', { glow: '#ffb03a', gi: 1.5 }), [0.05, -0.1, 0]));
  } else if (kind === 'wand') {
    g.add(limb(0.012, V(0, 0, 0), V(0.2, 0.25, 0), K.mat('#ffe27a')));
    g.add(mesh(new THREE.OctahedronGeometry(0.05), K.mat('#fff6a8', { glow: '#ffe27a', gi: 2 }), [0.22, 0.28, 0]));
  }
  return g;
}

// Birds: owl, sparrow, cockatrice, phoenix, peacock, penguin, griffin (with a lion body: quad).
function bird(s, K) {
  const g = new THREE.Group();
  const body = K.mat(s.color);
  const up = s.upright ?? 0.5;
  const y = (s.legH ?? 0.3) + 0.35;
  g.add(ell(body, [0, y, 0], [0.38, 0.42 + up * 0.1, 0.34], [0, 0, up * 0.6]));
  if (s.belly) g.add(ell(K.mat(s.belly), [0.14, y - 0.05, 0], [0.22, 0.34, 0.26], [0, 0, up * 0.6]));
  // Legs.
  if (!s.noLegs) for (const z of [-1, 1]) {
    g.add(limb(0.025, V(0, y - 0.3, z * 0.12), V(0.02, 0.04, z * 0.14), K.mat(s.legs || '#e0a030')));
    for (let k = 0; k < 3; k++) g.add(limb(0.015, V(0.02, 0.03, z * 0.14), V(0.12, 0.01, z * 0.14 + (k - 1) * 0.05), K.mat(s.legs || '#e0a030')));
  }
  const hx = 0.2 + up * 0.05;
  const hy = y + 0.42 + up * 0.1;
  const HR = s.head ?? 0.24;
  g.add(ell(K.mat(s.headColor || s.color), [hx, hy, 0], [HR, HR, HR * 0.95]));
  if (s.facedisk) g.add(ell(K.mat(s.facedisk), [hx + HR * 0.45, hy, 0], [HR * 0.5, HR * 0.8, HR * 0.9]));
  g.add(spike(HR * 0.22, HR * (s.hookBeak ? 0.55 : 0.7), K.mat(s.beak || '#f0b030'), V(hx + HR * 0.85, hy - HR * 0.15, 0), V(1, s.hookBeak ? -0.6 : -0.15, 0)));
  eyes(g, V(hx + HR * 0.65, hy + HR * 0.2, 0), HR * (s.bigEyes ? 0.34 : 0.24), { gap: s.bigEyes ? 1.15 : 1, glow: s.eyeGlow, color: s.eye }, K);
  if (s.tufts) for (const z of [-1, 1]) g.add(spike(HR * 0.15, HR * 0.5, body, V(hx, hy + HR * 0.8, z * HR * 0.55), V(0, 1, z * 0.5)));
  if (s.crest) for (let k = 0; k < 4; k++) g.add(spike(HR * 0.1, HR * (0.5 + k * 0.12), K.mat(s.crest, s.crestGlow ? { glow: s.crest, gi: 1.2 } : {}), V(hx - k * HR * 0.2, hy + HR * 0.85, 0), V(-0.3 - k * 0.3, 1, 0)));
  if (s.comb) for (let k = 0; k < 3; k++) g.add(mesh(sph(HR * 0.2, 10), K.mat(s.comb), [hx + HR * (0.3 - k * 0.25), hy + HR * 0.95, 0]));
  if (s.wattle) g.add(ell(K.mat(s.comb || '#d8202a'), [hx + HR * 0.75, hy - HR * 0.6, 0], [HR * 0.12, HR * 0.25, HR * 0.12]));
  // Wings and tail.
  if (s.flippers) for (const z of [-1, 1]) g.add(ell(body, [0, y, z * 0.36], [0.08, 0.3, 0.05], [0, 0, 0.3]));
  else g.add(wings('feather', s.wingSpan ?? 0.8, K.mat(s.wingColor || s.color, s.wingGlow ? { glow: s.wingColor, gi: 0.9 } : {}), V(-0.05, y + 0.2, 0), { lift: s.spread ?? 0.4, sweep: 0.3 }));
  if (s.fan) {
    // Peacock fan with eye spots.
    for (let k = 0; k < 13; k++) {
      const a = -1.2 + (k / 12) * 2.4;
      const f = new THREE.Group();
      f.position.set(-0.25, y + 0.1, 0);
      f.rotation.set(a, 0, 0.35);
      f.add(ell(K.mat(s.fan), [0, 0.55, 0], [0.05, 0.55, 0.13]));
      f.add(mesh(sph(0.07, 12), K.mat('#2a5ad8', { glow: '#5ad8ff', gi: 0.5 }), [0.02, 0.95, 0]));
      f.add(mesh(sph(0.035, 10), K.mat('#ffd24a'), [0.05, 0.95, 0]));
      g.add(f);
    }
  } else if (s.tail === 'flame') {
    for (let k = 0; k < 5; k++) g.add(taper([V(-0.3, y - 0.05, 0), V(-0.6, y + 0.05, (k - 2) * 0.1), V(-0.95, y - 0.1 + k * 0.05, (k - 2) * 0.18)], 0.05, 0.01, K.mat(k % 2 ? '#ffd24a' : '#ff6a1a', { glow: k % 2 ? '#ffb03a' : '#ff5a1a', gi: 1.6 }), 6));
  } else if (s.tail === 'rooster') {
    for (let k = 0; k < 4; k++) g.add(taper([V(-0.3, y, 0), V(-0.5, y + 0.3 + k * 0.05, (k - 1.5) * 0.08), V(-0.55, y - 0.05, (k - 1.5) * 0.12)], 0.05, 0.01, K.mat(k % 2 ? s.tailColor || '#2a6a3a' : s.color), 6));
  } else g.add(ell(K.mat(s.tailColor || s.color), [-0.36, y - 0.12, 0], [0.2, 0.05, 0.12], [0, 0, 0.5]));
  return g;
}

// Bugs and shellfish: beetle, wasp, ladybug, moth, scorpion, crab, snail, slug, skitter.
function bug(s, K) {
  const g = new THREE.Group();
  const body = K.mat(s.color);
  const dark = K.mat(s.dark || '#1b1512');
  const y = s.low ? 0.22 : 0.4;
  if (s.shellSpiral) {
    // Snail: a spiral shell on a soft body.
    g.add(ell(K.mat(s.skin || '#c8b090'), [0.1, 0.12, 0], [0.55, 0.12, 0.2]));
    for (let k = 0; k < 7; k++) {
      const r = 0.34 * Math.pow(0.8, k);
      const a = k * 0.9;
      g.add(mesh(new THREE.TorusGeometry(r, r * 0.45, 10, 24), K.mat(k % 2 ? s.color : s.stripe || shadeHex(s.color, -0.25), s.glowShell ? { glow: s.color, gi: 0.6 } : {}), [-0.05 + Math.cos(a) * r * 0.3, 0.45 + Math.sin(a) * r * 0.3, 0], [0, 0, 0]));
    }
    for (const z of [-1, 1]) g.add(taper([V(0.55, 0.18, z * 0.05), V(0.65, 0.35, z * 0.08)], 0.02, 0.012, K.mat(s.skin || '#c8b090'), 3));
    eyes(g, V(0.66, 0.37, 0), 0.04, { gap: 1.6 }, K);
    return g;
  }
  if (s.slug) {
    g.add(taper([V(-0.5, 0.08, 0), V(-0.1, 0.12, 0), V(0.3, 0.15, 0), V(0.55, 0.25, 0)], 0.1, 0.16, body, 10));
    if (s.cracks) for (let k = 0; k < 6; k++) g.add(limb(0.015, V(-0.4 + k * 0.15, 0.2, 0.08), V(-0.35 + k * 0.15, 0.24, -0.06), K.mat('#ffd24a', { glow: '#ff6a1a', gi: 2 })));
    for (const z of [-1, 1]) g.add(taper([V(0.6, 0.35, z * 0.05), V(0.7, 0.55, z * 0.1)], 0.02, 0.015, body, 3));
    eyes(g, V(0.72, 0.58, 0), 0.04, { gap: 2.2 }, K);
    return g;
  }
  // Thorax/abdomen/head.
  const abd = s.abdomen ?? 0.35;
  g.add(ell(body, [-0.25, y + 0.02, 0], [abd * 1.2, abd * 0.75, abd * 0.9]));
  if (s.stripes) for (let k = 0; k < 3; k++) g.add(mesh(new THREE.TorusGeometry(abd * 0.72, 0.03, 6, 20), K.mat(s.stripes), [-0.15 - k * 0.14, y + 0.02, 0], [0, Math.PI / 2, 0], [1, 1.05, 1.2]));
  g.add(ell(K.mat(s.thorax || s.color), [0.12, y + 0.02, 0], [0.18, 0.16, 0.18]));
  const hx = 0.32;
  const HR = s.head ?? 0.15;
  g.add(ell(K.mat(s.headColor || s.dark || s.color), [hx, y + 0.03, 0], [HR, HR * 0.9, HR]));
  eyes(g, V(hx + HR * 0.55, y + HR * 0.35, 0), HR * 0.35, { gap: 0.95, glow: s.eyeGlow }, K);
  // Shell covers (beetles, ladybugs).
  if (s.elytra) {
    for (const z of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI, 0, Math.PI / 2), K.mat(s.elytra, s.elytraGlow ? { glow: s.elytraGlow, gi: 0.5 } : {}), [-0.22, y + 0.06, z * 0.01], [z > 0 ? 0 : Math.PI, 0, 0], [abd * 1.3, abd * 0.95, abd * 0.95]));
    if (s.spots) for (let k = 0; k < 6; k++) g.add(mesh(sph(0.05, 10), dark, [-0.35 + (k % 3) * 0.14, y + abd * 0.72, (k < 3 ? 1 : -1) * 0.14]));
    if (s.thorns) for (let k = 0; k < 7; k++) g.add(spike(0.025, 0.1, K.mat('#5a3b22'), V(-0.45 + k * 0.08, y + abd * 0.75, (k % 2 ? 1 : -1) * 0.1), V(0, 1, (k % 2 ? 1 : -1) * 0.5)));
  }
  // Six legs (or eight).
  const legs = s.legs ?? 6;
  for (let k = 0; k < legs / 2; k++) {
    for (const z of [-1, 1]) {
      const bx = 0.18 - k * (0.44 / (legs / 2));
      const knee = V(bx + 0.02, y + 0.14, z * 0.35);
      g.add(limb(0.02, V(bx, y, z * 0.12), knee, dark));
      g.add(limb(0.018, knee, V(bx + 0.06, 0.02, z * 0.5), dark));
    }
  }
  if (s.antennae) for (const z of [-1, 1]) g.add(taper([V(hx + 0.08, y + 0.12, z * 0.05), V(hx + 0.2, y + 0.35, z * 0.15), V(hx + 0.32, y + 0.4, z * 0.22)], 0.012, 0.008, dark, 5));
  if (s.pincers) {
    for (const z of [-1, 1]) {
      const base = V(hx + 0.05, y, z * 0.18);
      const tip = V(hx + 0.35, y + 0.15, z * 0.35);
      g.add(limb(0.04, base, tip, body));
      g.add(ell(body, tip.toArray(), [0.14, 0.09, 0.08]));
      g.add(spike(0.03, 0.14, body, tip.clone().add(V(0.08, 0.04, 0)), V(1, 0.4, 0)));
      g.add(spike(0.03, 0.12, body, tip.clone().add(V(0.08, -0.04, 0)), V(1, -0.3, 0)));
    }
  }
  if (s.stinger) {
    g.add(taper([V(-0.5, y + 0.05, 0), V(-0.75, y + 0.35, 0), V(-0.6, y + 0.7, 0), V(-0.3, y + 0.8, 0)], 0.06, 0.03, body, 12));
    g.add(spike(0.04, 0.14, K.mat(s.stingColor || '#ff5a1a', { glow: s.stingColor || '#ff5a1a', gi: 1.4 }), V(-0.3, y + 0.8, 0), V(1, -0.6, 0)));
  } else if (s.sting) g.add(spike(0.04, 0.16, dark, V(-0.62, y, 0), V(-1, -0.2, 0)));
  if (s.wings) g.add(wings(s.wings, s.wingSpan ?? 0.6, K.mat(s.wingColor || '#e8f6ff', { opacity: s.wings === 'butterfly' ? 1 : 0.55, glow: s.wingGlow || null, gi: 0.6 }), V(0.05, y + 0.15, 0), { lift: s.wings === 'butterfly' ? 0.6 : 0.35, sweep: s.wings === 'butterfly' ? 0.05 : 0.2, m2: s.wingSpot ? K.mat(s.wingSpot, { glow: s.wingSpot, gi: 0.8 }) : null }));
  if (s.smoke) for (let k = 0; k < 5; k++) g.add(mesh(sph(0.1 + k * 0.03, 12), K.mat('#6a6a72', { opacity: 0.5 }), [-0.3 - k * 0.12, y + 0.2 + k * 0.1, 0]));
  return g;
}

// Serpents: snakes, leeches, wyrms, eels.
function serpent(s, K) {
  const g = new THREE.Group();
  const body = K.mat(s.color);
  const pts = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(V(-0.9 + t * 1.6, 0.12 + (s.rise ? Math.max(0, t - 0.55) * 1.4 : 0) + Math.sin(t * 5) * 0.03, Math.sin(t * 7 + 0.5) * 0.28 * (1 - t * 0.5)));
  }
  g.add(taper(pts, s.thin ?? 0.05, s.thick ?? 0.13, body, 22));
  if (s.belly) for (let i = 3; i < n; i++) g.add(ell(K.mat(s.belly), pts[i].clone().add(V(0.02, -0.04, 0)).toArray(), [0.08, 0.03, 0.08]));
  const head = pts[n];
  const HR = s.head ?? 0.16;
  g.add(ell(body, [head.x + HR * 0.4, head.y + 0.02, head.z], [HR * 1.4, HR * 0.8, HR]));
  eyes(g, V(head.x + HR * 0.9, head.y + HR * 0.45, head.z), HR * 0.28, { gap: 1.2, glow: s.eyeGlow, color: s.eye }, K);
  if (s.fangs) for (const z of [-1, 1]) g.add(cone(0.015, 0.07, K.mat('#fffbe8'), [head.x + HR * 1.4, head.y - HR * 0.4, head.z + z * 0.05], [Math.PI, 0, 0]));
  if (s.tongue) g.add(taper([V(head.x + HR * 1.7, head.y - 0.03, head.z), V(head.x + HR * 2.4, head.y - 0.05, head.z)], 0.012, 0.006, K.mat('#d8202a'), 3));
  if (s.leaves) for (let i = 1; i < n; i += 2) g.add(ell(K.mat('#5aa84a'), pts[i].clone().add(V(0, 0.12, 0)).toArray(), [0.1, 0.04, 0.06], [0, 0, 0.6]));
  if (s.sucker) g.add(mesh(new THREE.TorusGeometry(HR * 0.5, HR * 0.15, 8, 20), K.mat('#8a2a3a'), [head.x + HR * 1.6, head.y, head.z], [0, Math.PI / 2, 0]));
  return g;
}

// Swimmers: fish, whales, dolphins, seals, sharks.
function swimmer(s, K) {
  const g = new THREE.Group();
  const body = K.mat(s.color);
  const L = s.len ?? 0.7;
  const R = s.girth ?? 0.3;
  const y = R + 0.15;
  g.add(ell(body, [0, y, 0], [L, R, R * 0.85]));
  if (s.belly) g.add(ell(K.mat(s.belly), [0.05, y - R * 0.35, 0], [L * 0.85, R * 0.6, R * 0.7]));
  // Tail fin, dorsal, pectorals.
  const fin = K.mat(s.fin || s.color);
  g.add(taper([V(-L * 0.8, y, 0), V(-L * 1.25, y + 0.05, 0)], R * 0.35, R * 0.15, body, 4));
  if (s.flukes) for (const z of [-1, 1]) g.add(ell(fin, [-L * 1.35, y + 0.08, z * R * 0.45], [R * 0.4, R * 0.08, R * 0.45], [0, z * 0.4, 0.2]));
  else g.add(ell(fin, [-L * 1.35, y + 0.05, 0], [R * 0.3, R * 0.6, R * 0.06], [0, 0, 0.4]));
  if (s.dorsal) g.add(spike(R * 0.3, R * 0.7, fin, V(0, y + R * 0.85, 0), V(-0.5, 1, 0)));
  for (const z of [-1, 1]) g.add(ell(fin, [L * 0.3, y - R * 0.4, z * R * 0.8], [R * 0.4, R * 0.08, R * 0.25], [0.3 * z, 0, -0.4]));
  // Face.
  eyes(g, V(L * 0.65, y + R * 0.2, 0), R * 0.2, { gap: 2.2, glow: s.eyeGlow, color: s.eye, spread: 0.2 }, K);
  if (s.beak) g.add(ell(body, [L * 1.05, y - R * 0.15, 0], [R * 0.45, R * 0.2, R * 0.25]));
  if (s.spout) for (let k = 0; k < 4; k++) g.add(mesh(sph(0.05 + k * 0.02, 10), K.mat('#d8f6ff', { opacity: 0.8 }), [L * 0.3 + k * 0.02, y + R + 0.1 + k * 0.1, (k % 2 ? 0.05 : -0.05)]));
  if (s.whiskers) for (const z of [-1, 1]) for (let k = 0; k < 3; k++) g.add(limb(0.004, V(L * 0.95, y - R * 0.1, z * R * 0.25), V(L * 1.25, y - R * 0.15 + k * 0.04, z * R * 0.55), K.mat('#e8e8e8')));
  if (s.nose) g.add(mesh(sph(R * 0.12, 10), K.mat('#1a1410'), [L * 0.98, y, 0]));
  if (s.runes) for (let k = 0; k < 5; k++) g.add(mesh(new THREE.TorusGeometry(R * 0.2, 0.015, 6, 12), K.mat(s.runes, { glow: s.runes, gi: 2 }), [L * 0.4 - k * L * 0.3, y + R * 0.5, R * 0.62], [0, 0.3, 0]));
  if (s.barnacles) for (let k = 0; k < 7; k++) g.add(mesh(sph(0.04, 8), K.mat('#c8c0b0'), [Math.cos(k * 1.3) * L * 0.6, y + R * 0.7, Math.sin(k * 1.3) * R * 0.6]));
  if (s.teeth) for (let k = 0; k < 6; k++) g.add(cone(0.02, 0.07, K.mat('#fffbe8'), [L * 0.9 - k * 0.02, y - R * 0.35, (k - 2.5) * 0.05], [Math.PI, 0, 0]));
  if (s.crescent) g.add(mesh(new THREE.TorusGeometry(R * 0.5, 0.03, 8, 24, Math.PI * 1.2), K.mat('#fff6c0', { glow: '#fff6c0', gi: 1.5 }), [0, y + R + 0.3, 0], [0, 0, 0.6]));
  return g;
}

// Tentacled: squid, octopus, kraken, jellyfish.
function tentacled(s, K) {
  const g = new THREE.Group();
  const body = K.mat(s.color, s.jelly ? { opacity: 0.75, glow: s.color, gi: 0.35 } : {});
  const size = s.size ?? 1;
  const y = 0.55 * size;
  if (s.jelly) g.add(mesh(new THREE.SphereGeometry(0.35 * size, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), body, [0, y, 0]));
  else g.add(ell(body, [0, y + 0.15 * size, 0], [0.34 * size, 0.42 * size, 0.34 * size], [0, 0, s.squid ? -0.4 : 0]));
  if (s.squid) g.add(cone(0.22 * size, 0.3 * size, body, [-0.2 * size, y + 0.55 * size, 0], [0, 0, 0.9]));
  const n = s.arms ?? 8;
  const tm = s.jelly ? K.mat(s.color, { opacity: 0.6, glow: s.color, gi: 0.4 }) : body;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.22 * size;
    const len = (s.jelly ? 0.5 : 0.65) * size;
    const pts = [V(Math.cos(a) * r * 0.8, y - 0.05 * size, Math.sin(a) * r * 0.8), V(Math.cos(a) * r * 1.6, y - len * 0.4, Math.sin(a) * r * 1.6), V(Math.cos(a + 0.5) * r * 2.4, y - len * 0.7 + (s.jelly ? 0 : 0.12), Math.sin(a + 0.5) * r * 2.4), V(Math.cos(a + 0.9) * r * 2.8, (s.jelly ? y - len : 0.06), Math.sin(a + 0.9) * r * 2.8)];
    g.add(taper(pts, (s.jelly ? 0.015 : 0.06) * size, 0.01 * size, tm, 10));
    if (s.suckers) for (let k = 1; k < 3; k++) g.add(mesh(sph(0.02 * size, 8), K.mat('#f0c0c8'), pts[k].toArray()));
  }
  eyes(g, V(0.28 * size, y + 0.2 * size, 0), 0.08 * size, { gap: 1.8, glow: s.eyeGlow, color: s.eye }, K);
  if (s.crown) for (let k = 0; k < 5; k++) g.add(cone(0.04 * size, 0.18 * size, K.mat('#c9a23a', { glow: '#ffd24a', gi: 0.4 }), [Math.cos(k * 1.26) * 0.2 * size, y + 0.58 * size, Math.sin(k * 1.26) * 0.2 * size]));
  if (s.glowSpots) for (let k = 0; k < 8; k++) g.add(mesh(sph(0.025 * size, 8), K.mat(s.glowSpots, { glow: s.glowSpots, gi: 2 }), [Math.cos(k) * 0.3 * size, y + 0.2 * size + Math.sin(k * 2) * 0.15 * size, Math.sin(k) * 0.3 * size]));
  return g;
}

// Spirits and things: mushroom, wisp, volcano, lantern, ghost, meteor, planet, dark moon.
function spirit(s, K) {
  const g = new THREE.Group();
  const face = (at, r, opts = {}) => {
    eyes(g, at, r, { gap: 1.2, ...opts }, K);
    if (opts.mouth) g.add(mesh(new THREE.TorusGeometry(r * 0.7, r * 0.15, 6, 16, Math.PI), K.mat(opts.mouthColor || '#1a1410'), at.clone().add(V(r * 0.2, -r * 1.3, 0)).toArray(), [0, Math.PI / 2, Math.PI]));
  };
  if (s.kind === 'mushroom') {
    g.add(mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.5, 16), K.mat('#f2ead8'), [0, 0.25, 0]));
    g.add(mesh(new THREE.SphereGeometry(0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), K.mat(s.color), [0, 0.45, 0], [0, 0, 0], [1, 0.7, 1]));
    for (let k = 0; k < 9; k++) g.add(mesh(sph(0.06, 10), K.mat('#fff6e8'), [Math.cos(k * 2.4) * 0.3, 0.72 + (k % 2) * 0.03, Math.sin(k * 2.4) * 0.3]));
    for (let k = 0; k < 7; k++) g.add(mesh(sph(0.03, 8), K.mat('#e8ffb0', { glow: '#c8ff6a', gi: 1.5 }), [Math.cos(k) * 0.6, 0.5 + k * 0.08, Math.sin(k) * 0.5]));
    face(V(0.2, 0.28, 0), 0.06, { mouth: true });
  } else if (s.kind === 'wisp' || s.kind === 'smog') {
    const m = K.mat(s.color, { glow: s.kind === 'wisp' ? s.color : null, gi: 0.8, opacity: 0.85 });
    for (let k = 0; k < 12; k++) g.add(mesh(sph(0.16 + (k % 4) * 0.05, 14), m, [Math.cos(k * 0.9) * (0.1 + k * 0.03), 0.3 + k * 0.06, Math.sin(k * 0.9) * (0.1 + k * 0.03)]));
    face(V(0.3, 0.75, 0), 0.07, { mouth: s.kind === 'smog', glow: s.eyeGlow });
    if (s.sparks) for (let k = 0; k < 6; k++) g.add(limb(0.01, V(Math.cos(k) * 0.4, 0.6 + k * 0.05, Math.sin(k) * 0.4), V(Math.cos(k) * 0.55, 0.7 + k * 0.05, Math.sin(k) * 0.55), K.mat('#fff27a', { glow: '#fff27a', gi: 2 })));
  } else if (s.kind === 'volcano') {
    g.add(mesh(new THREE.ConeGeometry(0.6, 0.9, 12, 1, true), K.mat('#4a2a1a'), [0, 0.45, 0]));
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 12), K.mat('#ffb03a', { glow: '#ff5a1a', gi: 2 }), [0, 0.88, 0]));
    for (let k = 0; k < 7; k++) g.add(cone(0.08, 0.3 + (k % 3) * 0.12, K.mat(k % 2 ? '#ffd24a' : '#ff5a1a', { glow: k % 2 ? '#ffb03a' : '#ff3a1a', gi: 1.8 }), [Math.cos(k) * 0.12, 1.0 + (k % 3) * 0.05, Math.sin(k) * 0.12]));
    for (let k = 0; k < 4; k++) g.add(limb(0.025, V(0.3 + k * 0.06, 0.75 - k * 0.15, 0.25), V(0.4 + k * 0.05, 0.6 - k * 0.15, 0.3), K.mat('#ffb03a', { glow: '#ff5a1a', gi: 2 })));
    face(V(0.38, 0.5, 0), 0.08, { glow: '#ffd24a', mouth: true, mouthColor: '#ffb03a' });
  } else if (s.kind === 'lantern') {
    g.add(mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.5, 8), K.mat('#e8d0a0', { glow: '#ff9a3a', gi: 1.2, opacity: 0.9 }), [0, 0.55, 0]));
    for (const y of [0.3, 0.8]) g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 8), K.mat('#2a1a14'), [0, y, 0]));
    g.add(mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 16), K.mat('#2a1a14'), [0, 0.95, 0]));
    face(V(0.26, 0.6, 0), 0.06, { glow: '#5affe8', mouth: true });
    for (let k = 0; k < 3; k++) g.add(mesh(sph(0.06, 10), K.mat('#8affe8', { glow: '#5affe8', gi: 1.5, opacity: 0.7 }), [-0.3 - k * 0.1, 0.4 + k * 0.15, 0.1]));
  } else if (s.kind === 'ghost') {
    const m = K.mat(s.color, { opacity: 0.85, glow: s.color, gi: 0.35 });
    g.add(mesh(sph(0.3, 24), m, [0, 0.85, 0]));
    g.add(mesh(new THREE.ConeGeometry(0.34, 0.8, 16, 1, true), m, [0, 0.45, 0], [Math.PI, 0, 0]));
    for (const z of [-1, 1]) g.add(taper([V(0, 0.75, z * 0.25), V(0.2, 0.6, z * 0.5), V(0.35, 0.75, z * 0.65)], 0.06, 0.03, m, 6));
    if (s.hair) for (let k = 0; k < 7; k++) g.add(taper([V(-0.05, 1.05, (k - 3) * 0.07), V(-0.35, 0.8, (k - 3) * 0.12), V(-0.55, 0.45, (k - 3) * 0.15)], 0.04, 0.01, K.mat(s.hair, { opacity: 0.9 }), 6));
    face(V(0.26, 0.9, 0), 0.07, { glow: s.eyeGlow || '#1a1a2a', mouth: true });
  } else if (s.kind === 'meteor') {
    g.add(mesh(new THREE.DodecahedronGeometry(0.4, 1), K.mat('#5a4a3a'), [0.2, 0.55, 0], [0.3, 0.2, 0]));
    for (let k = 0; k < 8; k++) g.add(limb(0.02, V(0.2 + Math.cos(k) * 0.3, 0.55 + Math.sin(k * 1.7) * 0.3, Math.sin(k) * 0.3), V(0.2 + Math.cos(k) * 0.38, 0.6 + Math.sin(k * 1.7) * 0.3, Math.sin(k) * 0.38), K.mat('#ffd24a', { glow: '#ff6a1a', gi: 2 })));
    for (let k = 0; k < 9; k++) g.add(cone(0.12 - k * 0.008, 0.6 + k * 0.08, K.mat(k % 2 ? '#ffd24a' : '#ff5a1a', { glow: k % 2 ? '#ffb03a' : '#ff3a1a', gi: 1.8, opacity: 0.85 }), [-0.25 - k * 0.06, 0.62 + Math.sin(k) * 0.1, Math.cos(k * 1.3) * 0.12], [0, 0, Math.PI / 2 + 0.15]));
    face(V(0.55, 0.62, 0), 0.08, { glow: '#fff6a8' });
  } else if (s.kind === 'planet') {
    g.add(mesh(sph(0.5, 36), K.mat('#2a8ad8'), [0, 0.6, 0]));
    for (let k = 0; k < 9; k++) g.add(mesh(sph(0.16 + (k % 3) * 0.05, 14), K.mat('#3fa04a'), [Math.cos(k * 1.4) * 0.38, 0.6 + Math.sin(k * 2.1) * 0.3, Math.sin(k * 1.4) * 0.38], [0, 0, 0], [1, 0.6, 1]));
    for (let k = 0; k < 7; k++) {
      const a = k * 0.9;
      const at = V(Math.cos(a) * 0.45, 0.6 + 0.35, Math.sin(a) * 0.35);
      g.add(limb(0.02, at, at.clone().add(V(0, 0.14, 0)), K.mat('#6b4226')));
      g.add(mesh(sph(0.07, 10), K.mat('#5aa84a'), at.clone().add(V(0, 0.18, 0)).toArray()));
    }
    g.add(mesh(new THREE.TorusGeometry(0.72, 0.02, 8, 64), K.mat('#b8ff7a', { glow: '#b8ff7a', gi: 1.2 }), [0, 0.6, 0], [1.2, 0.3, 0]));
    face(V(0.46, 0.66, 0), 0.07, { mouth: true });
  } else if (s.kind === 'moon') {
    g.add(mesh(sph(0.5, 36), K.mat('#1a1030'), [0, 0.65, 0]));
    g.add(mesh(new THREE.TorusGeometry(0.52, 0.04, 8, 48, Math.PI * 1.1), K.mat('#c07aff', { glow: '#c07aff', gi: 1.8 }), [0.02, 0.65, 0], [0, Math.PI / 2, 0.6]));
    for (let k = 0; k < 6; k++) g.add(cone(0.05, 0.28, K.mat('#8a4cc2', { glow: '#c07aff', gi: 0.8 }), [Math.cos(k * 1.05) * 0.22, 1.15, Math.sin(k * 1.05) * 0.22]));
    for (let k = 0; k < 10; k++) g.add(taper([V(-0.2, 0.3 + k * 0.05, (k - 5) * 0.08), V(-0.6, 0.1 + k * 0.03, (k - 5) * 0.14), V(-0.9, -0.05 + k * 0.05, (k - 5) * 0.2)], 0.04, 0.005, K.mat('#2a1a4a', { opacity: 0.8 }), 6));
    face(V(0.46, 0.72, 0), 0.08, { glow: '#e0b8ff' });
  }
  return g;
}

// Hex shading helper (for spiral shells).
function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return `#${((1 << 24) | (f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1)}`;
}

// ---- Blueprints: one per card ------------------------------------------------------------------------
const B = {
  // Wildlands
  'wildlands-01': { plan: 'quad', color: '#6aa84a', belly: '#c8e0a0', len: 0.55, girth: 0.45, legH: 0.12, legT: 0.12, head: 0.36, snout: 0.08, neck: -0.1, neckUp: -0.05, ears: 'none', tail: 'none', moss: true, spikes: '#4a7a2a', dark: '#3a5a2a' },
  'wildlands-02': { plan: 'bug', color: '#2a4a2a', elytra: '#3a6a3a', thorns: true, antennae: true, dark: '#1a2a14' },
  'wildlands-03': { plan: 'biped', color: '#ffe8f0', skin: '#ffd8c8', width: 0.24, legH: 0.35, torso: 0.3, head: 0.22, hair: '#ffd24a', hairGlow: true, wings: 'butterfly', wingColor: '#aef4ff', wingGlow: true, wingSpan: 0.6, weapon: 'wand', robe: '#ff9ad8' },
  'wildlands-04': { plan: 'quad', color: '#8a5a34', belly: '#c8a070', len: 0.6, girth: 0.42, legH: 0.18, head: 0.3, snout: 0.18, ears: 'round', tail: 'flat', teeth: true, muzzle: '#b88a5a' },
  'wildlands-05': { plan: 'biped', color: '#8a8f96', rocky: true, moss: true, bulky: true, width: 0.5, head: 0.26, headShape: 'rock', eyeGlow: '#aef4ff', legColor: '#7a7f86' },
  'wildlands-06': { plan: 'quad', color: '#e0782a', belly: '#fff2e0', len: 0.6, girth: 0.3, legH: 0.38, legT: 0.07, head: 0.27, snout: 0.35, ears: 'pointy', tail: 'bushy', tailColor: '#e0782a', dark: '#2a1a14' },
  'wildlands-07': { plan: 'spirit', kind: 'mushroom', color: '#d8402a' },
  'wildlands-08': { plan: 'bug', color: '#ffc21a', stripes: '#1a1410', thorax: '#6a4a14', wings: 'insect', wingSpan: 0.5, antennae: true, sting: true },
  'wildlands-09': { plan: 'biped', color: '#7a5334', bark: true, width: 0.3, legH: 0.3, torso: 0.4, head: 0.22, leaves: true, branches: true, legColor: '#5a3b22' },
  'wildlands-10': { plan: 'quad', color: '#8a9a6a', belly: '#b8b890', len: 0.6, girth: 0.4, legH: 0.18, legT: 0.12, head: 0.26, snout: 0.15, ears: 'none', tail: 'short', shell: '#6b5a3a', shellPlate: '#8a7a4a', moss: true, neck: 0.1 },
  'wildlands-11': { plan: 'bird', color: '#5a4a6a', belly: '#b8a8c8', facedisk: '#d8c8e0', bigEyes: true, eye: '#1a1410', tufts: true, beak: '#e0a030', hookBeak: true, upright: 0.9, head: 0.3, wingColor: '#4a3a5a', eyeGlow: null },
  'wildlands-12': { plan: 'quad', color: '#7a5334', belly: '#e0c8a0', len: 0.6, girth: 0.28, legH: 0.18, legT: 0.08, head: 0.25, snout: 0.2, ears: 'round', tail: 'long', muzzle: '#e0c8a0' },
  'wildlands-13': { plan: 'quad', color: '#a0683a', belly: '#f0dcc0', len: 0.65, girth: 0.32, legH: 0.6, legT: 0.06, head: 0.24, snout: 0.3, ears: 'pointy', antlers: true, antlerLeaves: true, tail: 'short', hooves: true, neckUp: 0.35 },
  'wildlands-14': { plan: 'quad', color: '#5a3b2a', belly: '#8a6a4a', len: 0.7, girth: 0.45, legH: 0.3, legT: 0.1, head: 0.33, snout: 0.35, ears: 'pointy', tusks: 0.5, tail: 'thin', hooves: true, spikes: '#2a1a14', muzzle: '#b88a7a', eyeGlow: '#ff5a2a' },
  'wildlands-15': { plan: 'serpent', color: '#3f8a3a', belly: '#c8e0a0', leaves: true, fangs: true, tongue: true, rise: true, thick: 0.12, eye: '#d8a020' },
  'wildlands-16': { plan: 'quad', color: '#d8d8e0', belly: '#ffffff', len: 0.5, girth: 0.3, legH: 0.32, legT: 0.07, head: 0.26, snout: 0.14, ears: 'long', tail: 'short', tailColor: '#ffffff', crystals: '#fff27a', neckUp: 0.2 },
  'wildlands-17': { plan: 'quad', color: '#6a4228', belly: '#8a6040', len: 0.75, girth: 0.52, legH: 0.35, legT: 0.14, head: 0.34, snout: 0.25, ears: 'round', tail: 'short', claws: true, muzzle: '#a07a58', teeth: true },
  'wildlands-18': { plan: 'bug', color: '#e8e0ff', dark: '#3a2a5a', wings: 'butterfly', wingColor: '#8a7aff', wingSpot: '#fff6c0', wingGlow: '#6a5aff', wingSpan: 1.25, antennae: true, abdomen: 0.2, head: 0.12 },
  'wildlands-19': { plan: 'quad', color: '#4a6a3a', belly: '#b8c890', len: 0.85, girth: 0.3, legH: 0.12, legT: 0.08, head: 0.26, snout: 0.6, ears: 'none', tail: 'long', teeth: true, spikes: '#2a4a2a', neck: 0, neckUp: -0.1 },
  'wildlands-20': { plan: 'quad', color: '#6a6a72', belly: '#c8c8d0', len: 0.7, girth: 0.34, legH: 0.42, legT: 0.08, head: 0.28, snout: 0.38, ears: 'pointy', tail: 'bushy', teeth: true, eyeGlow: '#ffd24a' },
  'wildlands-21': { plan: 'biped', color: '#6b4a2a', bark: true, width: 0.5, legH: 0.5, torso: 0.8, head: 0.3, leaves: true, branches: true, longArms: true, legColor: '#5a3b22', eyeGlow: '#b8ff7a' },
  'wildlands-22': { plan: 'quad', color: '#c89a5a', belly: '#e8d0a0', len: 0.6, girth: 0.34, legH: 0.4, head: 0.28, snout: 0, ears: 'none', tail: 'lion', mane: null, wings: 'feather', wingColor: '#8a6a4a', wingSpan: 1.1, beakGriffin: true, dark: '#2a1a14', eyeGlow: null },
  'wildlands-23': { plan: 'biped', color: '#3a3a42', skin: '#5a5a62', belly: '#6a6a72', width: 0.55, legH: 0.35, torso: 0.6, head: 0.28, hunch: true, longArms: true, bulky: true, fur: '#9aa3ad', nose: '#2a2a32', smallEyes: true, eye: '#8a5a2a' },
  'wildlands-24': { plan: 'quad', color: '#fbfbff', belly: '#ffffff', len: 0.65, girth: 0.32, legH: 0.55, legT: 0.07, head: 0.25, snout: 0.35, ears: 'pointy', unicorn: true, horseMane: '#ff9ad8', maneGlow: true, tail: 'long', tailColor: '#c89aff', hooves: true, dark: '#c8a8e8', neckUp: 0.35 },
  'wildlands-25': { plan: 'quad', color: '#d8a040', belly: '#f0d8a0', len: 0.7, girth: 0.38, legH: 0.4, legT: 0.1, head: 0.32, snout: 0.22, ears: 'round', mane: '#3f7a2a', maneThorns: true, tail: 'lion', teeth: true },
  'wildlands-26': { plan: 'quad', color: '#2f8a3a', belly: '#b8e0a0', len: 0.9, girth: 0.34, legH: 0.28, legT: 0.09, head: 0.3, snout: 0.4, ears: 'none', horns: 'dragon', hornColor: '#e8d8a0', tail: 'dragon', spikes: '#b8ff7a', teeth: true, longNeck: true, neckUp: 0.4, antlerLeaves: false },
  'wildlands-27': { plan: 'bird', color: '#1a5ad8', belly: '#2a8ad8', headColor: '#1a6ad8', crest: '#5ad8ff', crestGlow: true, fan: '#1a8a5a', upright: 0.7, beak: '#c8c0a0', legs: '#8a8a8a', wingColor: '#4aa0c8' },
  'wildlands-28': { plan: 'quad', color: '#7a4a2a', belly: '#9a6a44', len: 0.85, girth: 0.6, legH: 0.5, legT: 0.17, head: 0.38, snout: 0.05, ears: 'floppy', tusks: 1.2, trunk: true, tail: 'thin', hooves: false, fur: true, spikes: null },
  'wildlands-29': { plan: 'quad', color: '#1f7a3a', belly: '#d8f0a0', len: 0.95, girth: 0.42, legH: 0.36, legT: 0.1, head: 0.34, snout: 0.45, ears: 'none', horns: 'dragon', hornColor: '#fff2c0', tail: 'dragon', spikes: '#b8ff7a', wings: 'bat', wingColor: '#3fa04a', wingSpan: 1.4, teeth: true, longNeck: true, neckUp: 0.45, eyeGlow: '#ffe27a', crystals: '#b8ff7a' },
  'wildlands-30': { plan: 'spirit', kind: 'planet' },
  // Emberforge
  'emberforge-01': { plan: 'biped', color: '#d8402a', skin: '#e0503a', width: 0.28, legH: 0.3, torso: 0.3, head: 0.28, ears: 'pointy', horns: 'spike', hornColor: '#2a1a14', tail: true, wings: 'bat', wingColor: '#8a1a14', wingSpan: 0.5, mouth: 'fangs', eyeGlow: '#ffd24a' },
  'emberforge-02': { plan: 'quad', color: '#4a3a34', belly: '#7a6a64', len: 0.45, girth: 0.25, legH: 0.12, legT: 0.05, head: 0.2, snout: 0.25, ears: 'round', tail: 'thin', tailColor: '#ff7a3a', cracks: true, eyeGlow: '#ffb03a', teeth: true },
  'emberforge-03': { plan: 'bug', slug: true, color: '#3a1a14', cracks: true },
  'emberforge-04': { plan: 'bird', color: '#6a6a72', belly: '#b8b0a8', headColor: '#4a4a52', beak: '#ffb03a', tail: 'flame', crest: '#ff6a1a', crestGlow: true, wingColor: '#5a5a62' },
  'emberforge-05': { plan: 'bug', color: '#8a2a14', pincers: true, legs: 8, low: true, abdomen: 0.42, head: 0.16, headColor: '#8a2a14', thorax: '#8a2a14', elytra: '#3a1a14', elytraGlow: '#ff5a1a', eyeGlow: null },
  'emberforge-06': { plan: 'biped', color: '#2a2230', skin: '#3a3040', width: 0.22, legH: 0.18, torso: 0.3, head: 0.24, ears: 'pointy', wings: 'bat', wingColor: '#2a2230', wingSpan: 0.9, mouth: 'fangs', eyeGlow: '#ff5a2a', smoke: true },
  'emberforge-07': { plan: 'quad', color: '#e0431b', belly: '#ffb347', len: 0.6, girth: 0.22, legH: 0.12, legT: 0.06, head: 0.2, snout: 0.25, ears: 'none', tail: 'long', flames: true, eyeGlow: '#ffe27a', neck: 0.05, neckUp: 0 },
  'emberforge-08': { plan: 'biped', color: '#8a6a3a', skin: '#b88a4a', width: 0.3, legH: 0.3, torso: 0.35, head: 0.28, ears: 'pointy', helmMiner: true, weapon: 'pickaxe', belly: '#6a4a2a', nose: true, tail: true },
  'emberforge-09': { plan: 'bug', color: '#d8202a', elytra: '#e02a1a', spots: true, antennae: true, dark: '#1a1410', abdomen: 0.34, wings: null, crystals: '#fff27a' },
  'emberforge-10': { plan: 'spirit', kind: 'smog', color: '#7a7a82', sparks: true, eyeGlow: '#fff27a' },
  'emberforge-11': { plan: 'quad', color: '#5a2a1a', belly: '#8a4a2a', len: 0.6, girth: 0.32, legH: 0.38, legT: 0.08, head: 0.28, snout: 0.32, ears: 'floppy', tail: 'thin', flames: true, eyeGlow: '#ffd24a', teeth: true },
  'emberforge-12': { plan: 'biped', color: '#2a2a2e', rocky: true, cracks: true, bulky: true, width: 0.55, head: 0.26, headShape: 'rock', eyeGlow: '#ffb03a', legColor: '#2a2a2e' },
  'emberforge-13': { plan: 'bug', color: '#c8541a', pincers: true, stinger: true, stingColor: '#ffd24a', legs: 8, low: true, abdomen: 0.34, head: 0.14, eyeGlow: '#ffe27a' },
  'emberforge-14': { plan: 'biped', color: '#6a2a1a', skin: '#8a3a22', width: 0.5, legH: 0.55, torso: 0.6, head: 0.32, horns: 'bull', hornColor: '#efe6c8', bulky: true, nose: '#4a1a10', weapon: 'club', cracksBody: true, eyeGlow: '#ffb03a', flames: true, legColor: '#4a1a10' },
  'emberforge-15': { plan: 'quad', color: '#1a1a22', belly: '#2a2a34', len: 0.8, girth: 0.5, legH: 0.35, legT: 0.14, head: 0.34, snout: 0.35, ears: 'pointy', nosehorn: true, hornColor: '#5a3a8a', tail: 'thin', crystals: '#8a5aff', hooves: true },
  'emberforge-16': { plan: 'quad', color: '#1a1014', belly: '#2a1a1e', len: 0.7, girth: 0.34, legH: 0.6, legT: 0.07, head: 0.25, snout: 0.38, ears: 'pointy', horseMane: '#ff6a1a', maneGlow: true, tail: 'long', tailColor: '#ff6a1a', hooves: true, dark: '#ff6a1a', eyeGlow: '#ff3a1a', neckUp: 0.35 },
  'emberforge-17': { plan: 'spirit', kind: 'volcano' },
  'emberforge-18': { plan: 'biped', color: '#5a6a4a', skin: '#6a7a5a', width: 0.55, legH: 0.4, torso: 0.6, head: 0.28, hunch: true, longArms: true, bulky: true, mouth: 'tusks', nose: true, weapon: null, armor: '#4a4a52', smallEyes: true, eye: '#d8a020' },
  'emberforge-19': { plan: 'quad', color: '#ff8a1a', belly: '#fff2e0', len: 0.7, girth: 0.34, legH: 0.4, legT: 0.09, head: 0.3, snout: 0.22, ears: 'round', stripes: '#1a1014', tail: 'long', flames: true, teeth: true, eyeGlow: '#ffe27a' },
  'emberforge-20': { plan: 'biped', color: '#b8202a', skin: '#c82a2a', width: 0.52, legH: 0.5, torso: 0.6, head: 0.32, horns: 'spike', hornColor: '#ffd24a', mouth: 'tusks', weapon: 'club', bulky: true, armor: '#2a2a32', hair: '#1a1014', eyeGlow: '#ffe27a' },
  'emberforge-21': { plan: 'bird', color: '#c8401a', belly: '#ffb347', comb: '#ff2a1a', wattle: true, tail: 'rooster', tailColor: '#3a1a14', beak: '#ffd24a', eyeGlow: '#ffe27a', legs: '#ffd24a', upright: 0.6, wingColor: '#8a2a14' },
  'emberforge-22': { plan: 'quad', color: '#1a1014', belly: '#3a1a1a', len: 0.7, girth: 0.36, legH: 0.42, legT: 0.09, head: 0.3, snout: 0.35, ears: 'pointy', tail: 'long', flames: true, spikes: '#3a1a1a', teeth: true, eyeGlow: '#ff3a1a', cracks: true },
  'emberforge-23': { plan: 'quad', color: '#5a3a2a', belly: '#8a6a4a', len: 0.8, girth: 0.42, legH: 0.42, legT: 0.13, head: 0.38, snout: 0.45, ears: 'none', tail: 'dragon', teeth: true, spikes: '#2a1a14', cracks: true, eyeGlow: '#ffb03a', neckUp: 0.35 },
  'emberforge-24': { plan: 'biped', color: '#2a6ad8', skin: '#3a8ae8', width: 0.42, lower: 'wisp', torso: 0.6, head: 0.28, horns: 'curved', hornColor: '#ffd24a', flames: true, crown: '#ffd24a', crownGlow: '#ffb03a', bulky: true, eyeGlow: '#ffe27a', aura: '#ff6a1a' },
  'emberforge-25': { plan: 'quad', color: '#3a4a8a', belly: '#8aa0d8', len: 0.85, girth: 0.36, legH: 0.36, legT: 0.1, head: 0.3, snout: 0.4, ears: 'none', horns: 'dragon', hornColor: '#fff27a', tail: 'dragon', wings: 'bat', wingColor: '#2a3a6a', wingSpan: 1.1, crystals: '#fff27a', longNeck: true, neckUp: 0.4, eyeGlow: '#fff27a' },
  'emberforge-26': { plan: 'bird', color: '#ff7a1a', belly: '#ffd24a', headColor: '#ff9a2a', crest: '#ffd24a', crestGlow: true, tail: 'flame', wingColor: '#ff5a1a', wingGlow: true, wingSpan: 1.2, spread: 0.9, beak: '#ffe27a', eyeGlow: '#fff6c0', upright: 0.5 },
  'emberforge-27': { plan: 'biped', color: '#1a1014', skin: '#2a1a1a', width: 0.6, legH: 0.6, torso: 0.7, head: 0.34, horns: 'curved', hornColor: '#3a2a22', wings: 'bat', wingColor: '#2a1a1a', wingSpan: 1.5, flames: true, weapon: 'whip', bulky: true, eyeGlow: '#ff5a1a', tail: true, claws: true, aura: '#ff3a1a' },
  'emberforge-28': { plan: 'quad', color: '#d8a040', belly: '#f0d8a0', len: 0.75, girth: 0.4, legH: 0.42, legT: 0.1, head: 0.32, snout: 0.22, ears: 'round', mane: '#c8401a', tail: 'long', tailColor: '#3f8a3a', horns: 'ram', hornColor: '#efe6c8', wings: 'bat', wingColor: '#8a2a14', wingSpan: 1.0, teeth: true, flames: true, eyeGlow: '#ffe27a' },
  'emberforge-29': { plan: 'quad', color: '#b3200a', belly: '#ffb347', len: 0.95, girth: 0.44, legH: 0.38, legT: 0.11, head: 0.35, snout: 0.45, ears: 'none', horns: 'dragon', hornColor: '#2a1a14', tail: 'dragon', wings: 'bat', wingColor: '#6a0a04', wingSpan: 1.5, spikes: '#2a1a14', flames: true, cracks: true, teeth: true, longNeck: true, neckUp: 0.45, eyeGlow: '#ffe27a' },
  'emberforge-30': { plan: 'spirit', kind: 'meteor' },
  // Abyssal Tides
  'abyssal-01': { plan: 'swimmer', color: '#3ab8e8', belly: '#d8f6ff', fin: '#ffb03a', len: 0.45, girth: 0.22, dorsal: true },
  'abyssal-02': { plan: 'tentacled', jelly: true, color: '#c89aff', arms: 10, glowSpots: '#fff6ff' },
  'abyssal-03': { plan: 'bug', color: '#e0562a', pincers: true, legs: 8, low: true, abdomen: 0.4, head: 0.15, headColor: '#e0562a', thorax: '#e0562a', eye: null },
  'abyssal-04': { plan: 'tentacled', squid: true, color: '#8a4cc2', arms: 8, suckers: true, size: 0.9 },
  'abyssal-05': { plan: 'bird', color: '#1a1f2a', belly: '#fbfbff', headColor: '#1a1f2a', beak: '#ffb03a', flippers: true, upright: 1.1, legs: '#ffb03a', legH: 0.1, crystals: '#aef4ff' },
  'abyssal-06': { plan: 'quad', color: '#4a4a52', belly: '#7a7a82', len: 0.45, girth: 0.25, legH: 0.12, legT: 0.05, head: 0.2, snout: 0.25, ears: 'round', tail: 'thin', tailColor: '#c8a8b8', eyeGlow: '#5aff8a', teeth: true },
  'abyssal-07': { plan: 'bug', color: '#e8e0cc', legs: 8, low: true, abdomen: 0.3, head: 0.2, headColor: '#f2ead8', dark: '#d8d0bc', eyeGlow: '#5affb0', thorax: '#d8d0bc', skullBug: true },
  'abyssal-08': { plan: 'serpent', color: '#3a2a3a', belly: '#6a4a5a', sucker: true, thick: 0.1, thin: 0.06, eye: '#1a1410' },
  'abyssal-09': { plan: 'swimmer', color: '#b8c0c8', belly: '#e8eef4', len: 0.55, girth: 0.3, flukes: true, whiskers: true, nose: true, eye: '#1a1410' },
  'abyssal-10': { plan: 'spirit', kind: 'lantern' },
  'abyssal-11': { plan: 'bug', shellSpiral: true, color: '#f0b8c8', stripe: '#c86a8a', skin: '#e8d8c8' },
  'abyssal-12': { plan: 'quad', color: '#f2f6fa', belly: '#ffffff', len: 0.5, girth: 0.3, legH: 0.3, legT: 0.07, head: 0.26, snout: 0.14, ears: 'long', tail: 'short', crystals: '#aef4ff', neckUp: 0.2 },
  'abyssal-13': { plan: 'biped', color: '#2ab0a0', skin: '#e8c8b0', width: 0.3, lower: 'fishtail', tailColor: '#2ab0a0', torso: 0.4, head: 0.24, hair: '#ff6a8a', weapon: 'trident', belly: '#8ae8d8' },
  'abyssal-14': { plan: 'spirit', kind: 'ghost', color: '#d8e8ff', hair: '#e8f0ff', eyeGlow: '#5ad8ff' },
  'abyssal-15': { plan: 'quad', color: '#c8e0f0', belly: '#ffffff', len: 0.7, girth: 0.34, legH: 0.42, legT: 0.08, head: 0.28, snout: 0.38, ears: 'pointy', tail: 'bushy', tailColor: '#c8e0f0', crystals: '#aef4ff', teeth: true, eyeGlow: '#5ad8ff' },
  'abyssal-16': { plan: 'tentacled', color: '#d8402a', arms: 8, suckers: true, size: 1.1 },
  'abyssal-17': { plan: 'biped', color: '#f2f6fa', skin: '#9fb8d8', width: 0.55, legH: 0.45, torso: 0.6, head: 0.3, fur: '#ffffff', bulky: true, longArms: true, mouth: 'fangs', horns: 'curved', hornColor: '#c8d8e8', smallEyes: true, eye: '#1a3a6a' },
  'abyssal-18': { plan: 'biped', color: '#6a8aa0', skin: '#7a9ab0', width: 0.45, legH: 0.55, torso: 0.55, head: 0.3, headShape: 'shark', armor: '#c8ced6', weapon: 'sword', gold: '#c9a23a', belly: '#e8f0f4' },
  'abyssal-19': { plan: 'biped', color: '#3a1a2a', skin: '#4a2a3a', width: 0.26, legH: 0.2, torso: 0.3, head: 0.26, ears: 'pointy', wings: 'bat', wingColor: '#9a2a44', wingSpan: 1.7, mouth: 'fangs', eyeGlow: '#ff2a3a' },
  'abyssal-20': { plan: 'biped', color: '#d8ccaa', skin: '#c8b890', width: 0.36, legH: 0.55, torso: 0.55, head: 0.27, bandages: true, eyeGlow: '#5affb0', longArms: true, reach: 0.25 },
  'abyssal-21': { plan: 'swimmer', color: '#3a6a9a', belly: '#c8e0f0', len: 0.75, girth: 0.36, flukes: true, spout: true, barnacles: true },
  'abyssal-22': { plan: 'biped', color: '#2a1a3a', skin: '#c8d0c8', width: 0.38, legH: 0.55, torso: 0.6, head: 0.26, robe: '#3a1a5a', hood: '#2a1a3a', weapon: 'staff', orb: '#5affb0', crown: '#c9a23a', eyeGlow: '#5affb0', beard: '#e8e8e8', aura: '#5affb0' },
  'abyssal-23': { plan: 'quad', color: '#9fd8f0', belly: '#e8f8ff', len: 0.75, girth: 0.3, legH: 0.3, legT: 0.08, head: 0.26, snout: 0.38, ears: 'none', horns: 'dragon', hornColor: '#e8ffff', tail: 'dragon', wings: 'bat', wingColor: '#6ab8e8', wingSpan: 1.2, crystals: '#e8ffff', longNeck: true, neckUp: 0.4, eyeGlow: '#5ad8ff' },
  'abyssal-24': { plan: 'biped', color: '#c8d0e8', skin: '#e8eef8', width: 0.34, lower: 'wisp', ghost: true, torso: 0.55, head: 0.25, crown: '#b8c0d0', crownGlow: '#8ab8ff', hair: '#e8f0ff', hairGlow: true, eyeGlow: '#8ab8ff', aura: '#8ab8ff', robe: '#8a9ab8' },
  'abyssal-25': { plan: 'swimmer', color: '#8a9ad8', belly: '#e8eeff', len: 0.62, girth: 0.26, dorsal: true, beak: true, runes: '#fff6c0', crescent: true },
  'abyssal-26': { plan: 'tentacled', color: '#5a1a3a', arms: 10, suckers: true, size: 1.35, crown: true, eyeGlow: '#ffd24a' },
  'abyssal-27': { plan: 'biped', color: '#9fd8f0', rocky: true, bulky: true, width: 0.65, head: 0.3, headShape: 'rock', crystals: '#e8ffff', eyeGlow: '#5ad8ff', legColor: '#7ab8e0', aura: '#aef4ff' },
  'abyssal-28': { plan: 'biped', color: '#2a2a32', skin: '#1a1a22', width: 0.46, legH: 0.6, torso: 0.6, head: 0.28, armor: '#3a3a44', helm: '#3a3a44', weapon: 'sword', gold: '#8a4cc2', eyeGlow: '#8a5aff', aura: '#5a2a8a', legColor: '#2a2a32' },
  'abyssal-29': { plan: 'swimmer', color: '#1a3a6a', belly: '#8ab8d8', len: 1.05, girth: 0.45, flukes: true, teeth: true, runes: '#5affe8', barnacles: true, spout: true, eyeGlow: '#5affe8' },
  'abyssal-30': { plan: 'spirit', kind: 'moon' },
};
// Small fix-ups the plans read.
B['emberforge-08'].crown = null;

const PLANS = { quad, biped, bird, bug, serpent, swimmer, tentacled, spirit };

// ---- Rendering -------------------------------------------------------------------------------------
let renderer = null;
function getRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

// Renders a card's creature into a transparent canvas `size` px square.
export function render(card, size = 360) {
  const bp = B[card.id];
  if (!bp) return null;
  const r = getRenderer();
  const RS = Math.round(size * 1.6);
  r.setSize(RS, RS, false);
  const K = kit();
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#4a4a5a', 1.6));
  const key = new THREE.DirectionalLight('#fff6e8', 2.2);
  key.position.set(2, 3, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#aac8ff', 0.6);
  fill.position.set(-3, 1, 2);
  scene.add(fill);
  const creature = PLANS[bp.plan](bp, K);
  // Griffin: an eagle head on a lion's body.
  if (bp.beakGriffin) {
    const HR = bp.head;
    const hx = bp.len * 0.95 + 0.15;
    const hy = bp.legH + bp.girth * 0.7 + bp.girth * 0.6 + 0.25;
    creature.add(ell(K.mat('#fbfbf6'), [hx, hy, 0], [HR * 1.05, HR, HR * 0.9]));
    creature.add(spike(HR * 0.25, HR * 0.8, K.mat('#f0b030'), V(hx + HR * 0.85, hy - HR * 0.1, 0), V(1, -0.5, 0)));
    eyes(creature, V(hx + HR * 0.55, hy + HR * 0.25, 0), HR * 0.24, { gap: 0.95 }, K);
  }
  if (bp.helmMiner) {
    creature.add(mesh(new THREE.SphereGeometry(0.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), K.mat('#c9a23a'), [0.02, 1.25, 0], [0, 0, -0.1]));
    creature.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), K.mat('#fff6a8', { glow: '#ffe27a', gi: 2 }), [0.28, 1.38, 0], [0, 0, Math.PI / 2]));
  }
  if (bp.skullBug) {
    const s = creature;
    s.add(mesh(sph(0.05, 10), K.mat('#1a1410'), [0.52, 0.28, 0]));
  }
  scene.add(creature);
  // Frame: fit the creature, seen from the front-right and a little above.
  const box = new THREE.Box3().setFromObject(creature);
  const c = box.getCenter(new THREE.Vector3());
  const sz = box.getSize(new THREE.Vector3());
  const radius = Math.max(sz.x, sz.y, sz.z) * 0.62;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  const dir = V(0.55, 0.32, 1).normalize();
  cam.position.copy(c).addScaledVector(dir, radius / Math.sin((15 * Math.PI) / 180));
  cam.lookAt(c);
  r.render(scene, cam);
  // Crop to what was actually drawn so every creature fills the art the same.
  const full = document.createElement('canvas');
  full.width = full.height = RS;
  const fx = full.getContext('2d', { willReadFrequently: true });
  fx.drawImage(r.domElement, 0, 0);
  const px = fx.getImageData(0, 0, RS, RS).data;
  let x0 = RS, y0 = RS, x1 = -1, y1 = -1;
  for (let y = 0; y < RS; y++) {
    for (let x = 0; x < RS; x++) {
      if (px[(y * RS + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const out = document.createElement('canvas');
  out.width = out.height = size;
  if (x1 >= 0) {
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const k = (size * 0.9) / Math.max(w, h);
    const dw = w * k, dh = h * k;
    const ox = x0 - 1, oy = y0 - 1;
    const octx = out.getContext('2d');
    octx.imageSmoothingQuality = 'high';
    // Centred, but standing on a common ground line.
    octx.drawImage(full, ox, oy, w + 2, h + 2, (size - dw) / 2, size * 0.95 - dh, dw + 2 * k, dh + 2 * k);
  }
  creature.traverse((o) => o.geometry?.dispose());
  K.dispose();
  return out;
}

export function supported() {
  try {
    return !!(window.WebGL2RenderingContext && document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

window.MMOCreatures = { render, supported, has: (id) => !!B[id] };
