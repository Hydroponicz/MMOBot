// Pets: 24 original chibi creatures built with the card creature generator (creature3d.js), each with
// a prop from its skill (the Kitchen Cat's chef hat, the Raccoon Foreman's hard hat...). The site shows
// pre-rendered pictures (/pets/<id>.png, made by scripts/render-pets.js) so pets look the same on
// every device; the 3D character model uses buildPet() to put the real model at the player's feet.
//   buildPet(id) -> THREE.Group facing +x on y = 0 (or null)
//   renderPet(id, size) -> transparent canvas with an ink outline (or null without WebGL)
import { THREE, kit, mesh, ell, limb, taper, spike, cone, sph, eyes, wings, V, PLANS, renderGroup } from './creature3d.js';

// Where each body plan puts the head (the same maths as the plans), for hats and cheeks.
function headOf(s) {
  if (s.plan === 'quad') {
    const L = s.len ?? 0.75;
    const R = s.girth ?? 0.42;
    const y = (s.legH ?? 0.45) + R * 0.7;
    const HR = s.head ?? 0.3;
    return { x: L * 0.95 + (s.neck ?? 0.15), y: y + R * 0.6 + (s.neckUp ?? 0.25), r: HR, face: HR * 0.75 };
  }
  if (s.plan === 'bird') {
    const up = s.upright ?? 0.5;
    const y = (s.legH ?? 0.3) + 0.35;
    const HR = s.head ?? 0.24;
    return { x: 0.2 + up * 0.05, y: y + 0.42 + up * 0.1, r: HR, face: HR * 0.6 };
  }
  if (s.plan === 'biped') {
    const legH = s.legH ?? 0.55;
    const torso = s.torso ?? 0.55;
    const sh = legH + torso * 0.85;
    const HR = s.head ?? 0.28;
    return { x: 0.02, y: sh + HR * 1.05, r: HR, face: HR * 0.75 };
  }
  return null;
}

// ---- Accessories -----------------------------------------------------------------------------------
// Rosy cheeks make anything cute.
function cheeks(g, h, K, color = '#ff8aa8') {
  for (const z of [-1, 1]) g.add(ell(K.mat(color, { opacity: 0.75 }), [h.x + h.face, h.y - h.r * 0.22, z * h.r * 0.62], [h.r * 0.16, h.r * 0.1, h.r * 0.12]));
}

const HATS = {
  chef(g, h, K) {
    const w = K.mat('#fbfbf6');
    g.add(mesh(new THREE.CylinderGeometry(h.r * 0.62, h.r * 0.58, h.r * 0.5, 20), w, [h.x - h.r * 0.1, h.y + h.r * 1.05, 0]));
    for (let k = 0; k < 5; k++) g.add(mesh(sph(h.r * 0.42, 16), w, [h.x - h.r * 0.1 + Math.cos(k * 1.25) * h.r * 0.3, h.y + h.r * 1.5, Math.sin(k * 1.25) * h.r * 0.3]));
  },
  hardhat(g, h, K) {
    const y = K.mat('#ffc61a');
    g.add(mesh(new THREE.SphereGeometry(h.r * 0.8, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), y, [h.x - h.r * 0.12, h.y + h.r * 0.72, 0]));
    g.add(mesh(new THREE.CylinderGeometry(h.r * 0.98, h.r * 0.98, h.r * 0.08, 24), y, [h.x - h.r * 0.05, h.y + h.r * 0.74, 0]));
    g.add(mesh(new THREE.TorusGeometry(h.r * 0.48, h.r * 0.06, 6, 20, Math.PI), K.mat('#e0a010'), [h.x - h.r * 0.12, h.y + h.r * 0.74, 0], [0, Math.PI / 2, 0]));
  },
  wizard(g, h, K) {
    const m = K.mat('#5a3ab8');
    g.add(mesh(new THREE.CylinderGeometry(h.r * 0.95, h.r * 0.95, h.r * 0.07, 24), m, [h.x - h.r * 0.1, h.y + h.r * 0.75, 0]));
    g.add(taper([V(h.x - h.r * 0.1, h.y + h.r * 0.75, 0), V(h.x - h.r * 0.25, h.y + h.r * 1.5, 0), V(h.x - h.r * 0.7, h.y + h.r * 1.95, 0)], h.r * 0.6, h.r * 0.05, m, 10));
    for (const [a, b] of [[0.2, 1.1], [-0.4, 1.35]]) g.add(mesh(new THREE.OctahedronGeometry(h.r * 0.1), K.mat('#ffe27a', { glow: '#ffd24a', gi: 1.2 }), [h.x + h.r * a, h.y + h.r * b, h.r * 0.45]));
  },
  helm(g, h, K) {
    const m = K.mat('#b8c0c8');
    g.add(mesh(new THREE.SphereGeometry(h.r * 0.9, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, [h.x - h.r * 0.1, h.y + h.r * 0.45, 0]));
    g.add(mesh(new THREE.BoxGeometry(h.r * 0.12, h.r * 0.5, h.r * 0.12), m, [h.x + h.r * 0.7, h.y + h.r * 0.35, 0], [0, 0, -0.3]));
    for (const z of [-1, 1]) g.add(taper([V(h.x - h.r * 0.1, h.y + h.r * 0.8, z * h.r * 0.6), V(h.x - h.r * 0.1, h.y + h.r * 1.1, z * h.r * 1.0), V(h.x + h.r * 0.1, h.y + h.r * 1.4, z * h.r * 1.1)], h.r * 0.12, h.r * 0.03, K.mat('#fff2d8'), 6));
  },
  bandana(g, h, K) {
    const m = K.mat('#2a2a34');
    g.add(mesh(new THREE.TorusGeometry(h.r * 0.95, h.r * 0.13, 8, 28), m, [h.x, h.y + h.r * 0.15, 0], [Math.PI / 2, 0.15, 0]));
    for (const z of [-1, 1]) g.add(ell(m, [h.x - h.r * 1.05, h.y + h.r * 0.05, z * h.r * 0.15], [h.r * 0.12, h.r * 0.35, h.r * 0.08], [z * 0.5, 0, 0.9]));
  },
  goggles(g, h, K) {
    g.add(mesh(new THREE.TorusGeometry(h.r * 0.98, h.r * 0.07, 6, 28), K.mat('#5a3b22'), [h.x, h.y + h.r * 0.45, 0], [Math.PI / 2, 0.3, 0]));
    for (const z of [-1, 1]) {
      g.add(mesh(new THREE.CylinderGeometry(h.r * 0.25, h.r * 0.25, h.r * 0.15, 16), K.mat('#c9a23a'), [h.x + h.r * 0.45, h.y + h.r * 0.8, z * h.r * 0.28], [0, 0, -0.9]));
      g.add(mesh(sph(h.r * 0.2, 12), K.mat('#7ad8ff', { glow: '#5ad8ff', gi: 0.5 }), [h.x + h.r * 0.52, h.y + h.r * 0.84, z * h.r * 0.28], [0, 0, 0], [0.5, 1, 1]));
    }
  },
  sprout(g, h, K) {
    const m = K.mat('#4ab84a');
    g.add(limb(h.r * 0.05, V(h.x - h.r * 0.1, h.y + h.r * 0.85, 0), V(h.x - h.r * 0.1, h.y + h.r * 1.3, 0), m));
    for (const z of [-1, 1]) g.add(ell(m, [h.x - h.r * 0.1, h.y + h.r * 1.35, z * h.r * 0.25], [h.r * 0.12, h.r * 0.06, h.r * 0.25], [z * 0.4, 0, 0]));
  },
  crown(g, h, K) {
    const m = K.mat('#ffd24a', { glow: '#ffb03a', gi: 0.3 });
    g.add(mesh(new THREE.CylinderGeometry(h.r * 0.5, h.r * 0.5, h.r * 0.22, 16, 1, true), m, [h.x - h.r * 0.1, h.y + h.r * 0.95, 0]));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      g.add(cone(h.r * 0.1, h.r * 0.28, m, [h.x - h.r * 0.1 + Math.cos(a) * h.r * 0.5, h.y + h.r * 1.18, Math.sin(a) * h.r * 0.5]));
    }
  },
  headband(g, h, K) {
    const m = K.mat('#d8202a');
    g.add(mesh(new THREE.TorusGeometry(h.r * 0.98, h.r * 0.1, 8, 28), m, [h.x, h.y + h.r * 0.35, 0], [Math.PI / 2, 0.2, 0]));
    for (const z of [-1, 1]) g.add(ell(m, [h.x - h.r * 1.1, h.y + h.r * 0.2, z * h.r * 0.2], [h.r * 0.1, h.r * 0.4, h.r * 0.07], [z * 0.6, 0, 1.1]));
  },
  scarf(g, h, K) {
    const m = K.mat('#2a8a5a');
    g.add(mesh(new THREE.TorusGeometry(h.r * 0.6, h.r * 0.16, 8, 24), m, [h.x - h.r * 0.5, h.y - h.r * 0.75, 0], [Math.PI / 2, 0.5, 0]));
    g.add(ell(m, [h.x - h.r * 0.2, h.y - h.r * 1.2, h.r * 0.45], [h.r * 0.14, h.r * 0.4, h.r * 0.08], [0.2, 0, 0.2]));
  },
};

// Props stand beside the pet, on the camera side (+z).
const PROPS = {
  log(g, K, at) {
    g.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 16), K.mat('#8a5a32'), [at[0], 0.11, at[1]], [Math.PI / 2, 0.3, 0]));
    for (const s of [-1, 1]) g.add(mesh(new THREE.CircleGeometry(0.1, 16), K.mat('#e8c890'), [at[0] + s * 0.074, 0.11, at[1] + s * 0.24], [0, 0.3 + (s < 0 ? Math.PI : 0), 0]));
  },
  carrot(g, K, at) {
    g.add(spike(0.07, 0.36, K.mat('#ff8a1a'), V(at[0], 0.08, at[1]), V(1, -0.15, 0.2)));
    for (let k = 0; k < 3; k++) g.add(ell(K.mat('#4ab84a'), [at[0] - 0.05, 0.13 + k * 0.02, at[1] + (k - 1) * 0.03], [0.1, 0.025, 0.03], [0, 0, 2.6 + k * 0.2]));
  },
  acorn(g, K, at) {
    g.add(ell(K.mat('#c8843a'), [at[0], 0.1, at[1]], [0.08, 0.1, 0.08]));
    g.add(mesh(new THREE.SphereGeometry(0.09, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), K.mat('#6a4a2a'), [at[0], 0.14, at[1]]));
    g.add(limb(0.012, V(at[0], 0.22, at[1]), V(at[0] + 0.02, 0.27, at[1]), K.mat('#4a3322')));
  },
  pickaxe(g, K, at) {
    g.add(limb(0.025, V(at[0] - 0.15, 0.02, at[1]), V(at[0] + 0.15, 0.45, at[1]), K.mat('#8a5a32')));
    g.add(taper([V(at[0] - 0.05, 0.5, at[1]), V(at[0] + 0.15, 0.47, at[1]), V(at[0] + 0.32, 0.36, at[1])], 0.035, 0.008, K.mat('#9aa4ae'), 4));
    g.add(taper([V(at[0] + 0.15, 0.47, at[1]), V(at[0] + 0.05, 0.36, at[1] - 0.02), V(at[0] - 0.02, 0.26, at[1])], 0.035, 0.008, K.mat('#9aa4ae'), 4));
  },
  shovel(g, K, at) {
    g.add(limb(0.022, V(at[0], 0.1, at[1]), V(at[0] - 0.1, 0.55, at[1]), K.mat('#8a5a32')));
    g.add(ell(K.mat('#9aa4ae'), [at[0] + 0.02, 0.08, at[1]], [0.09, 0.12, 0.02], [0, 0, 0.2]));
    g.add(mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 12), K.mat('#8a5a32'), [at[0] - 0.11, 0.6, at[1]]));
  },
  knife(g, K, at) {
    g.add(limb(0.025, V(at[0], 0.03, at[1]), V(at[0] + 0.12, 0.06, at[1]), K.mat('#6a4a2a')));
    g.add(ell(K.mat('#c8d0d8'), [at[0] + 0.26, 0.06, at[1]], [0.15, 0.04, 0.012]));
  },
  torch(g, K, at) {
    g.add(limb(0.03, V(at[0], 0.02, at[1]), V(at[0], 0.38, at[1]), K.mat('#6a4a2a')));
    for (let k = 0; k < 3; k++) g.add(cone(0.06 - k * 0.012, 0.2 - k * 0.03, K.mat(k % 2 ? '#ffd24a' : '#ff6a1a', { glow: k % 2 ? '#ffb03a' : '#ff5a1a', gi: 1.8 }), [at[0], 0.47 + k * 0.02, at[1]]));
  },
  pan(g, K, at) {
    g.add(mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.05, 20), K.mat('#2a2a30'), [at[0], 0.03, at[1]]));
    g.add(limb(0.02, V(at[0] + 0.16, 0.05, at[1]), V(at[0] + 0.4, 0.07, at[1] + 0.05), K.mat('#2a2a30')));
    g.add(ell(K.mat('#fff6d8'), [at[0], 0.065, at[1]], [0.07, 0.015, 0.07]));
    g.add(mesh(sph(0.03, 10), K.mat('#ffc61a'), [at[0], 0.075, at[1]]));
  },
  ingot(g, K, at) {
    for (const [dx, dy] of [[0, 0], [0.12, 0], [0.06, 0.07]]) g.add(mesh(new THREE.BoxGeometry(0.2, 0.07, 0.1), K.mat('#ffc61a', { glow: '#ffb03a', gi: 0.25 }), [at[0] + dx, 0.035 + dy, at[1]], [0, 0.3, 0]));
  },
  anvil(g, K, at) {
    const m = K.mat('#4a4a52');
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.1, 0.12), m, [at[0], 0.05, at[1]]));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), m, [at[0], 0.14, at[1]]));
    g.add(mesh(new THREE.BoxGeometry(0.26, 0.07, 0.13), m, [at[0], 0.21, at[1]]));
    g.add(spike(0.04, 0.12, m, V(at[0] + 0.13, 0.21, at[1]), V(1, 0, 0)));
  },
  arrows(g, K, at) {
    for (let k = 0; k < 3; k++) {
      const z = at[1] + (k - 1) * 0.06;
      g.add(limb(0.01, V(at[0] - 0.2, 0.03, z), V(at[0] + 0.2, 0.05 + k * 0.02, z), K.mat('#c8a070')));
      g.add(spike(0.022, 0.06, K.mat('#9aa4ae'), V(at[0] + 0.2, 0.05 + k * 0.02, z), V(1, 0.05, 0)));
      g.add(ell(K.mat(['#d8202a', '#fbfbf6', '#2a6ad8'][k]), [at[0] - 0.18, 0.04 + k * 0.02, z], [0.05, 0.02, 0.005]));
    }
  },
  plank(g, K, at) {
    g.add(mesh(new THREE.BoxGeometry(0.42, 0.04, 0.12), K.mat('#d8a868'), [at[0], 0.02, at[1]], [0, 0.4, 0]));
    g.add(mesh(new THREE.BoxGeometry(0.42, 0.04, 0.12), K.mat('#c8945a'), [at[0] + 0.02, 0.06, at[1]], [0, 0.1, 0]));
  },
  bricks(g, K, at) {
    for (const [dx, dy] of [[0, 0], [0.13, 0], [0.065, 0.07]]) g.add(mesh(new THREE.BoxGeometry(0.12, 0.065, 0.08), K.mat('#c8543a'), [at[0] + dx, 0.033 + dy, at[1]]));
  },
  yarn(g, K, at) {
    g.add(mesh(sph(0.12, 18), K.mat('#e84a8a'), [at[0], 0.12, at[1]]));
    for (let k = 0; k < 4; k++) g.add(mesh(new THREE.TorusGeometry(0.12, 0.008, 4, 24), K.mat('#c8306a'), [at[0], 0.12, at[1]], [k * 0.8, k * 0.5, 0]));
    g.add(limb(0.008, V(at[0] + 0.15, 0.24, at[1]), V(at[0] + 0.12, 0.32, at[1] + 0.03), K.mat('#c8a070')));
    g.add(limb(0.008, V(at[0] + 0.1, 0.24, at[1] - 0.04), V(at[0] + 0.16, 0.33, at[1] - 0.02), K.mat('#c8a070')));
  },
  potion(g, K, at) {
    g.add(mesh(sph(0.1, 16), K.mat('#e8f6ff', { opacity: 0.55 }), [at[0], 0.1, at[1]]));
    g.add(mesh(sph(0.08, 16), K.mat('#5aff8a', { glow: '#3ad86a', gi: 1 }), [at[0], 0.085, at[1]], [0, 0, 0], [1, 0.75, 1]));
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.08, 10), K.mat('#e8f6ff', { opacity: 0.55 }), [at[0], 0.22, at[1]]));
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.04, 10), K.mat('#8a5a32'), [at[0], 0.27, at[1]]));
  },
  sword(g, K, at) {
    g.add(mesh(new THREE.BoxGeometry(0.45, 0.025, 0.05), K.mat('#d8dee6'), [at[0] + 0.1, 0.03, at[1]], [0, 0.3, 0]));
    g.add(mesh(new THREE.BoxGeometry(0.04, 0.04, 0.18), K.mat('#c9a23a'), [at[0] - 0.13, 0.03, at[1] + 0.07], [0, 0.3, 0]));
  },
  orb(g, K, at) {
    g.add(mesh(sph(0.1, 18), K.mat('#c89aff', { glow: '#8a5aff', gi: 1.2 }), [at[0], 0.17, at[1]]));
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.07, 12), K.mat('#c9a23a'), [at[0], 0.035, at[1]]));
  },
  axe(g, K, at) {
    g.add(limb(0.02, V(at[0] - 0.2, 0.02, at[1]), V(at[0] + 0.2, 0.04, at[1]), K.mat('#8a5a32')));
    g.add(ell(K.mat('#b8c0c8'), [at[0] + 0.18, 0.05, at[1] + 0.07], [0.07, 0.015, 0.1]));
  },
  coins(g, K, at) {
    for (let k = 0; k < 4; k++) g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16), K.mat('#ffd24a', { glow: '#ffb03a', gi: 0.3 }), [at[0] + (k === 3 ? 0.1 : 0), 0.012 + (k < 3 ? k * 0.022 : 0), at[1]]));
  },
  gloves: null,
  skull(g, K, at) {
    g.add(ell(K.mat('#f2ead8'), [at[0], 0.1, at[1]], [0.1, 0.09, 0.09]));
    g.add(ell(K.mat('#f2ead8'), [at[0] + 0.05, 0.04, at[1]], [0.06, 0.04, 0.06]));
    for (const z of [-1, 1]) g.add(mesh(sph(0.025, 8), K.mat('#5aff8a', { glow: '#3ad86a', gi: 2 }), [at[0] + 0.08, 0.11, at[1] + z * 0.035]));
  },
  fish(g, K, at) {
    g.add(ell(K.mat('#7ab8e8'), [at[0], 0.05, at[1]], [0.14, 0.05, 0.035]));
    g.add(cone(0.05, 0.08, K.mat('#5a98c8'), [at[0] - 0.17, 0.05, at[1]], [0, 0, Math.PI / 2]));
    g.add(mesh(sph(0.012, 6), K.mat('#111'), [at[0] + 0.1, 0.065, at[1] + 0.03]));
  },
};

// ---- Custom bodies (things the card plans don't have) -------------------------------------------
function bat(s, K) {
  const g = new THREE.Group();
  const m = K.mat(s.color);
  const y = 0.55;
  g.add(mesh(sph(0.3, 24), m, [0, y, 0]));
  g.add(ell(K.mat(s.belly), [0.15, y - 0.04, 0], [0.17, 0.22, 0.22]));
  for (const z of [-1, 1]) {
    g.add(spike(0.11, 0.3, m, V(-0.02, y + 0.22, z * 0.15), V(0, 1, z * 0.45)));
    g.add(spike(0.06, 0.2, K.mat('#c86a9a'), V(0.01, y + 0.24, z * 0.16), V(0, 1, z * 0.45)));
    g.add(limb(0.02, V(0, y - 0.25, z * 0.08), V(0.02, y - 0.38, z * 0.09), K.mat('#2a1a2a')));
  }
  g.add(wings('bat', 0.55, K.mat(s.wing), V(-0.18, y + 0.08, 0), { lift: 0.15, sweep: 0.9 }));
  eyes(g, V(0.22, y + 0.06, 0), 0.075, { gap: 1.15, glow: s.eyeGlow }, K);
  for (const z of [-1, 1]) g.add(cone(0.015, 0.05, K.mat('#fffbe8'), [0.29, y - 0.1, z * 0.04], [Math.PI, 0, 0]));
  return g;
}

function toad(s, K) {
  const g = new THREE.Group();
  const m = K.mat(s.color);
  g.add(ell(m, [0, 0.26, 0], [0.42, 0.28, 0.4]));
  g.add(ell(K.mat(s.belly), [0.12, 0.2, 0], [0.32, 0.2, 0.33]));
  for (let k = 0; k < 7; k++) g.add(mesh(sph(0.04, 8), K.mat(s.spots), [-0.25 + (k % 4) * 0.12, 0.47 + (k % 2) * 0.03, (k % 2 ? 1 : -1) * (0.1 + (k % 3) * 0.07)]));
  for (const z of [-1, 1]) {
    // Bulging eyes on top, big back legs, little front legs.
    g.add(mesh(sph(0.12, 16), m, [0.2, 0.52, z * 0.18]));
    eyes(g, V(0.27, 0.55, z * 0.18), 0.09, { gap: 0.001, color: '#1a1410' }, K);
    g.add(ell(m, [-0.22, 0.14, z * 0.33], [0.2, 0.12, 0.12]));
    g.add(ell(m, [-0.08, 0.03, z * 0.42], [0.16, 0.03, 0.08]));
    g.add(limb(0.045, V(0.25, 0.18, z * 0.22), V(0.32, 0.03, z * 0.27), m));
    g.add(ell(m, [0.36, 0.02, z * 0.28], [0.07, 0.02, 0.05]));
  }
  g.add(mesh(new THREE.TorusGeometry(0.17, 0.012, 6, 24, Math.PI), K.mat('#2a4a1a'), [0.33, 0.33, 0], [0, Math.PI / 2, Math.PI], [1, 0.6, 1]));
  return g;
}

function hedgehog(s, K) {
  const g = new THREE.Group();
  const head = { len: 0.4, girth: 0.3, legH: 0.08, legT: 0.06, head: 0.24, snout: 0.22, ears: 'round', color: s.face, belly: s.face, muzzle: s.face, dark: '#2a1a14', neckUp: -0.05, neck: 0.02 };
  g.add(PLANS.quad(head, K));
  const h = headOf({ plan: 'quad', ...head });
  eyes(g, V(h.x + h.r * 0.5, h.y + h.r * 0.3, 0), h.r * 0.3, { gap: 1.05 }, K);
  cheeks(g, h, K);
  // A dome of spines over the back.
  const sm = K.mat(s.color);
  const tip = K.mat(s.tips);
  g.add(mesh(new THREE.SphereGeometry(0.44, 24, 12, 0, Math.PI * 2, 0, Math.PI / 1.9), sm, [-0.05, 0.22, 0], [0, 0, 0.25], [1.05, 0.9, 0.85]));
  for (let i = 0; i < 46; i++) {
    const a = i * 2.39996;
    const t = (i + 0.5) / 46;
    const el = Math.acos(1 - t * 0.95);
    const d = V(Math.sin(el) * Math.cos(a) * 1.05 - 0.15, Math.cos(el) * 0.95, Math.sin(el) * Math.sin(a) * 0.85).normalize();
    if (d.x > 0.55) continue;
    g.add(spike(0.04, 0.2, i % 3 ? sm : tip, V(-0.05, 0.22, 0).addScaledVector(d, 0.38), d));
  }
  return g;
}

const BODIES = { bat, toad, hedgehog };

// ---- The pets ----------------------------------------------------------------------------------------
// plan + plan options, then hat (on the head), prop (beside), blush (cheek colour, false = none).
const PET_BLUEPRINTS = {
  pet_heron: { plan: 'bird', color: '#e8eef4', belly: '#ffffff', headColor: '#f2f6fa', head: 0.32, bigEyes: true, beak: '#ffb03a', legs: '#ffb03a', legH: 0.38, upright: 0.9, tufts: true, crest: '#9ab8d8', wingColor: '#c8d8e8', prop: 'fish' },
  pet_rock_golem: { plan: 'biped', color: '#8a8a92', skin: '#a0a0a8', rocky: true, moss: true, width: 0.4, legH: 0.16, torso: 0.34, head: 0.36, legColor: '#7a7a82', gems: '#7af0ff', bigEyes: true, eye: '#1a6a8a', smallEyes: true, prop: 'pickaxe', blush: false },
  pet_beaver: { plan: 'quad', color: '#8a5a32', belly: '#c8945a', muzzle: '#d8b088', len: 0.42, girth: 0.34, legH: 0.12, legT: 0.08, head: 0.34, snout: 0.16, ears: 'round', tail: 'flat', teeth: true, neckUp: 0.05, prop: 'log', hat: 'hardhat' },
  pet_hedgehog: { plan: 'hedgehog', color: '#6a4a32', tips: '#e8d8c0', face: '#e8c8a0', prop: 'shovel' },
  pet_fox: { plan: 'quad', color: '#ff7a2a', belly: '#fff2e0', muzzle: '#fff2e0', len: 0.45, girth: 0.28, legH: 0.18, legT: 0.06, head: 0.34, snout: 0.26, ears: 'pointy', tail: 'bushy', tailColor: '#ff8a3a', dark: '#2a1a14', neckUp: 0.12, hat: 'scarf', prop: 'knife' },
  pet_bunny: { plan: 'quad', color: '#f2ece4', belly: '#ffffff', muzzle: '#ffffff', len: 0.38, girth: 0.32, legH: 0.1, legT: 0.07, head: 0.36, snout: 0.1, ears: 'long', tail: 'short', tailColor: '#ffffff', dark: '#e88aa8', neckUp: 0.05, prop: 'carrot', hat: 'sprout' },
  pet_ember: { plan: 'bird', color: '#ffc61a', belly: '#fff2a8', headColor: '#ffd24a', head: 0.34, bigEyes: true, beak: '#ff8a1a', legs: '#ff8a1a', legH: 0.12, upright: 0.4, crest: '#ff6a1a', crestGlow: true, tail: 'flame', wingColor: '#ffb03a', wingSpan: 0.45, prop: 'torch' },
  pet_squirrel: { plan: 'quad', color: '#c8642a', belly: '#f2d8b8', muzzle: '#f2d8b8', len: 0.36, girth: 0.28, legH: 0.12, legT: 0.06, head: 0.32, snout: 0.14, ears: 'pointy', tail: 'squirrel', dark: '#2a1a14', neckUp: 0.18, prop: 'acorn', hat: 'headband' },
  pet_cat: { plan: 'quad', color: '#e8a050', belly: '#fff6e8', muzzle: '#fff6e8', len: 0.42, girth: 0.28, legH: 0.16, legT: 0.06, head: 0.36, snout: 0.08, ears: 'pointy', tail: 'long', stripes: '#c8743a', dark: '#e88aa8', neckUp: 0.1, hat: 'chef', prop: 'pan' },
  pet_salamander: { plan: 'quad', color: '#e0431b', belly: '#ffb347', muzzle: '#ffb347', len: 0.5, girth: 0.2, legH: 0.08, legT: 0.05, head: 0.3, snout: 0.16, ears: 'none', tail: 'long', flames: true, neck: 0.04, neckUp: 0.02, hat: 'goggles', prop: 'ingot' },
  pet_beetle: { plan: 'bug', color: '#3a4a8a', elytra: '#4a5ab8', elytraGlow: '#2a3a8a', head: 0.24, headColor: '#2a3a6a', abdomen: 0.36, antennae: true, horn: true, low: true, dark: '#1a1a2a', prop: 'anvil' },
  pet_owl: { plan: 'bird', color: '#8a6a4a', belly: '#e8d8b8', headColor: '#9a7a5a', head: 0.36, facedisk: '#f2e2c8', bigEyes: true, eye: '#3a2a10', tufts: true, beak: '#e0a030', legs: '#e0a030', legH: 0.12, upright: 0.9, wingColor: '#7a5a3a', hat: 'wizard', prop: 'arrows' },
  pet_woodpecker: { plan: 'bird', color: '#2a2a34', belly: '#fbfbf6', headColor: '#fbfbf6', head: 0.3, bigEyes: true, crest: '#e0201a', beak: '#5a5a62', legs: '#5a5a62', legH: 0.15, upright: 0.8, wingColor: '#1a1a24', prop: 'plank' },
  pet_raccoon: { plan: 'quad', color: '#8a8a92', belly: '#d8d8de', muzzle: '#f2f2f6', len: 0.42, girth: 0.32, legH: 0.14, legT: 0.07, head: 0.36, snout: 0.16, ears: 'pointy', tail: 'ringed', dark: '#2a2a30', neckUp: 0.08, mask: true, hat: 'hardhat', prop: 'bricks' },
  pet_spider: { plan: 'bug', color: '#6a4a9a', head: 0.24, headColor: '#7a5aaa', abdomen: 0.38, legs: 8, low: true, dark: '#4a3a6a', prop: 'yarn' },
  pet_toad: { plan: 'toad', color: '#5aa84a', belly: '#e8f0b8', spots: '#3a7a2a', prop: 'potion', hat: 'crown' },
  pet_wolf: { plan: 'quad', color: '#8a96a8', belly: '#e8eef4', muzzle: '#e8eef4', len: 0.45, girth: 0.3, legH: 0.18, legT: 0.07, head: 0.36, snout: 0.24, ears: 'pointy', tail: 'bushy', tailColor: '#7a86a0', dark: '#1a1a24', neckUp: 0.12, hat: 'helm', prop: 'sword' },
  pet_hawk: { plan: 'bird', color: '#8a5a32', belly: '#f2e2c8', headColor: '#7a4a2a', head: 0.3, bigEyes: true, eye: '#c88a1a', hookBeak: true, beak: '#ffc61a', legs: '#ffc61a', legH: 0.15, upright: 0.7, wingColor: '#6a4a2a', wingSpan: 0.7, spread: 0.7, hat: 'bandana', prop: 'arrows' },
  pet_dragon: { plan: 'quad', color: '#7a4ac8', belly: '#ffd8a8', muzzle: '#8a5ad8', len: 0.45, girth: 0.3, legH: 0.12, legT: 0.08, head: 0.36, snout: 0.18, ears: 'none', horns: 'dragon', hornColor: '#ffe8b8', tail: 'dragon', wings: 'bat', wingColor: '#c89aff', wingSpan: 0.55, spikes: '#ffd24a', neckUp: 0.12, hat: 'wizard', prop: 'orb' },
  pet_boar: { plan: 'quad', color: '#6a4a3a', belly: '#8a6a5a', muzzle: '#c88a7a', len: 0.45, girth: 0.34, legH: 0.12, legT: 0.08, head: 0.36, snout: 0.16, ears: 'pointy', tusks: 0.4, tail: 'thin', hooves: true, spikes: '#3a2a22', dark: '#2a1a14', neck: 0.05, neckUp: 0.02, warpaint: true, prop: 'axe' },
  pet_raven: { plan: 'bird', color: '#2a2a38', belly: '#3a3a4a', headColor: '#2a2a38', head: 0.32, bigEyes: true, eye: '#5a2a8a', beak: '#3a3a44', legs: '#3a3a44', legH: 0.12, upright: 0.6, wingColor: '#1a1a28', hat: 'bandana', prop: 'coins' },
  pet_scorpion: { plan: 'bug', color: '#d8a040', head: 0.2, headColor: '#c8903a', abdomen: 0.32, pincers: true, stinger: true, stingColor: '#9aa4ae', legs: 8, low: true, dark: '#8a6020' },
  pet_gorilla: { plan: 'biped', color: '#4a4a54', skin: '#8a7a8a', belly: '#8a7a8a', width: 0.46, legH: 0.16, torso: 0.42, head: 0.38, bulky: true, nose: '#3a3240', hands: '#e0302a', bigEyes: true, smallEyes: true, hat: 'headband' },
  pet_bat: { plan: 'bat', color: '#4a3a5a', belly: '#6a5a7a', wing: '#3a2a4a', eyeGlow: '#5aff8a', prop: 'skull', blush: false },
};

// Plan tweaks: a squirrel's curled tail and a raccoon's ringed one, the raccoon mask, war paint, a beetle horn.
function details(g, s, K, h) {
  const L = s.len ?? 0.75;
  const y = (s.legH ?? 0.45) + (s.girth ?? 0.42) * 0.7;
  if (s.tail === 'squirrel') {
    const m = K.mat(s.color);
    g.add(taper([V(-L * 0.9, y - 0.05, 0), V(-L * 1.4, y + 0.15, 0), V(-L * 1.35, y + 0.55, 0), V(-L * 0.95, y + 0.75, 0)], 0.12, 0.17, m, 12));
  }
  if (s.tail === 'ringed') {
    for (let k = 0; k < 5; k++) g.add(ell(K.mat(k % 2 ? '#2a2a30' : s.color), [-L * 0.95 - 0.07 - k * 0.09, y - 0.02 - k * 0.04, 0], [0.07, 0.1, 0.1], [0, 0, 0.6]));
  }
  if (s.mask && h) for (const z of [-1, 1]) g.add(ell(K.mat('#2a2a30'), [h.x + h.r * 0.5, h.y + h.r * 0.22, z * h.r * 0.4], [h.r * 0.32, h.r * 0.2, h.r * 0.28]));
  if (s.warpaint && h) for (const z of [-1, 1]) g.add(ell(K.mat('#d8202a'), [h.x + h.r * 0.8, h.y + h.r * 0.05, z * h.r * 0.52], [h.r * 0.06, h.r * 0.3, h.r * 0.05], [0, 0, 0.3]));
  // Chibi eyes for four-legged pets: bigger and higher than the card creatures', so they read at icon size.
  if (s.plan === 'quad' && h) eyes(g, V(h.x + h.r * 0.5, h.y + h.r * 0.32, 0), h.r * 0.3, { gap: 1.05, color: s.eye || '#1a1410', glow: s.eyeGlow }, K);
  if (s.bigEyes && s.plan === 'biped' && h) eyes(g, V(h.x + h.r * 0.78, h.y + h.r * 0.1, 0), h.r * 0.27, { gap: 0.95, color: s.eye || '#1a1410' }, K);
  if (s.gems) for (const [x, y2, z] of [[-0.12, 0.72, 0.28], [-0.18, 0.62, -0.3], [-0.25, 0.5, 0.05]]) g.add(spike(0.05, 0.16, K.mat(s.gems, { glow: s.gems, gi: 0.6 }), V(x, y2, z), V(-0.4, 1, z)));
  if (s.horn) g.add(taper([V(0.48, 0.48, 0), V(0.6, 0.62, 0), V(0.55, 0.78, 0)], 0.04, 0.01, K.mat(s.headColor || s.color), 6));
}

export function buildPet(id, K = kit()) {
  const s = PET_BLUEPRINTS[id];
  if (!s) return null;
  const g = new THREE.Group();
  g.add((BODIES[s.plan] || PLANS[s.plan])(s, K));
  const h = headOf(s);
  details(g, s, K, h);
  if (h && s.blush !== false) cheeks(g, h, K);
  if (h && s.hat) HATS[s.hat](g, h, K);
  if (s.prop && PROPS[s.prop]) PROPS[s.prop](g, K, [0.35, 0.42]);
  g.userData.dispose = () => K.dispose();
  return g;
}

// A pet as a picture: cel-shaded with an ink outline, cropped to fill `size` px.
export function renderPet(id, size = 256, opts = {}) {
  if (!PET_BLUEPRINTS[id]) return null;
  return renderGroup((K) => {
    const g = buildPet(id, K);
    g.rotation.y = TURN[PET_BLUEPRINTS[id].plan] ?? -0.65; // three-quarter view, face towards the viewer
    return g;
  }, size, { outline: Math.max(2, Math.round(size / 70)), ...opts });
}

// How far to turn each kind of body so both eyes show.
const TURN = { quad: -0.82, hedgehog: -0.8, toad: -0.75, biped: -0.8, bug: -0.8 };

export const PET_IDS = Object.keys(PET_BLUEPRINTS);
window.MMOPets3D = { buildPet, renderPet, ids: PET_IDS };
