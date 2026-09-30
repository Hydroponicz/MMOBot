// 3D character models (three.js), built from the same appearance data as the 2D portraits in
// avatar.js: race, look (skin, hair, face, outfit), worn gear (weapon, helmet, body, legs, shield,
// by material color) and cosmetics (hat, cape, aura, pet). Nothing is stored separately, so every
// existing character shows up in 3D exactly as they look today.
//
//   const { mount } = await import('/avatar3d.js');
//   const view = mount(element, appearance, { autoRotate: true });
//   view.update(newAppearance); view.dispose();
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const COLORS = window.MMOAvatar?.COLORS || {};
const shade = window.MMOAvatar?.shade || ((c) => c);
const LEATHER = '#8a5a35';
const GOLD = '#c9a23a';

// Body proportions per race: body [width, height], head [x, y, z] scale, and a few traits.
const RACES = {
  human: { body: [1, 1], head: [1, 1, 1] },
  elf: { body: [0.9, 1.07], head: [0.92, 1.06, 0.95], ears: 'pointed' },
  dwarf: { body: [1.3, 0.8], head: [1.08, 0.98, 1.05], ears: 'round' },
  orc: { body: [1.25, 1.06], head: [1.12, 1.02, 1.06], ears: 'orc', tusks: true, jaw: 1.25 },
  halfling: { body: [1, 0.72], head: [1.04, 1, 1], ears: 'big', feet: 1.35 },
  undead: { body: [0.88, 1], head: [0.92, 1.02, 0.95], gaunt: true },
};

// ---- Materials (cached per look so updates stay cheap) ------------------------------------------
function materials() {
  const cache = new Map();
  const get = (key, make) => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  };
  const std = (color, { rough = 0.7, metal = 0, emissive = null, ei = 1, opacity = 1, side = THREE.FrontSide, transparent = false } = {}) =>
    get(`s|${color}|${rough}|${metal}|${emissive}|${ei}|${opacity}|${side}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: metal, side });
      if (emissive) {
        m.emissive = new THREE.Color(emissive);
        m.emissiveIntensity = ei;
      }
      if (opacity < 1 || transparent) {
        m.transparent = true;
        m.opacity = opacity;
        m.depthWrite = opacity > 0.6;
      }
      return m;
    });
  return {
    std,
    skin: (c) => get(`skin|${c}`, () => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c), roughness: 0.55, metalness: 0, sheen: 0.4, sheenColor: new THREE.Color(shade(c, 0.4)), sheenRoughness: 0.8 })),
    cloth: (c) => std(c, { rough: 0.92 }),
    hair: (c) => get(`hair|${c}`, () => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c), roughness: 0.5, metalness: 0, sheen: 0.8, sheenColor: new THREE.Color(shade(c, 0.5)), sheenRoughness: 0.4 })),
    // Leather gear is the brown "metal"; everything else shines.
    metal: (c) => (c === LEATHER ? std(c, { rough: 0.75 }) : get(`metal|${c}`, () => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c), roughness: 0.28, metalness: 0.9, clearcoat: 0.3, clearcoatRoughness: 0.3 }))),
    dispose() {
      for (const m of cache.values()) m.dispose();
      cache.clear();
    },
  };
}

// ---- Geometry helpers ----------------------------------------------------------------------------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function mesh(geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.scale.set(...scale);
  return m;
}
const sphere = (r, w = 24, h = 16, ...rest) => new THREE.SphereGeometry(r, w, h, ...rest);
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 16);
const cyl = (rt, rb, h, seg = 20, ...rest) => new THREE.CylinderGeometry(rt, rb, h, seg, ...rest);
const cone = (r, h, seg = 16) => new THREE.ConeGeometry(r, h, seg);
const torus = (r, t, arc = Math.PI * 2, seg = 32) => new THREE.TorusGeometry(r, t, 10, seg, arc);
// A limb from a to b (capsule oriented along the segment).
function limb(r, a, b, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(capsule(r, Math.max(0.001, len)), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
  return m;
}
// A curved horn/antler: a chain of shrinking cones along a curve.
function horn(points, r0, mat, steps = 7) {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(points);
  for (let i = 0; i < steps; i++) {
    const a = curve.getPoint(i / steps);
    const b = curve.getPoint((i + 1) / steps);
    const r = r0 * (1 - i / steps) + 0.004;
    const seg = limb(r, a, b, mat);
    g.add(seg);
  }
  return g;
}
// Radial canvas texture (ground glow, blob shadow, aura sprite).
function radialTexture(inner, outer, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// An emoji as a sprite (pets).
function emojiSprite(emoji, size = 0.34) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '100px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, 64, 72);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true }));
  s.scale.set(size, size, size);
  return s;
}

// ---- The character -------------------------------------------------------------------------------
// Returns { group, tick(t) } for one appearance.
function buildCharacter(appearance, M) {
  const race = RACES[appearance?.race] ? appearance.race : 'human';
  const R = RACES[race];
  const L = appearance?.look || {};
  const G = appearance?.gear || {};
  const C = appearance?.cosmetics || {};
  const skinC = COLORS.skin?.[L.skin] || '#e0ae87';
  const hairC = COLORS.hairColor?.[L.hairColor] || '#7a4a2a';
  const eyeC = COLORS.eyeColor?.[L.eyeColor] || '#5a3a22';
  const outfitC = COLORS.outfit?.[L.outfit] || '#3a64b8';
  const skin = M.skin(skinC);
  const skinDark = M.skin(shade(skinC, -0.25));
  const hairM = M.hair(hairC);
  const hairDark = M.hair(shade(hairC, -0.3));
  const cloth = M.cloth(outfitC);
  const clothDark = M.cloth(shade(outfitC, -0.35));
  const trim = M.cloth(shade(outfitC, 0.35));
  const leather = M.std('#5a3a22', { rough: 0.8 });
  const leatherLight = M.std('#7a5334', { rough: 0.75 });
  const gold = M.metal(GOLD);
  const anim = []; // (t) => void

  const root = new THREE.Group();
  const body = new THREE.Group();
  const [bw, bh] = R.body;
  body.scale.set(bw, bh, bw);
  root.add(body);

  // ---- feet and legs
  const legs = G.legs ? M.metal(G.legs) : clothDark;
  const foot = R.feet || 1;
  for (const s of [-1, 1]) {
    const hip = V(s * 0.1, 0.72, 0);
    const knee = V(s * 0.105, 0.42, 0.02);
    const ankle = V(s * 0.1, 0.13, 0);
    body.add(limb(0.078, hip, knee, legs));
    body.add(limb(0.068, knee, ankle, legs));
    if (G.legs && G.legs !== LEATHER) body.add(mesh(sphere(0.062), M.metal(shade(G.legs, 0.1)), [s * 0.105, 0.42, 0.07], [0, 0, 0], [1, 0.9, 0.7]));
    // Boots
    body.add(mesh(new RoundedBoxGeometry(0.13 * foot, 0.1, 0.22 * foot, 3, 0.04), leather, [s * 0.1, 0.05, 0.035 * foot]));
    body.add(mesh(cyl(0.075, 0.08, 0.1), leatherLight, [s * 0.1, 0.13, 0]));
  }

  // ---- hips, tunic skirt, belt
  body.add(mesh(sphere(0.18), clothDark, [0, 0.76, 0], [0, 0, 0], [1.05, 0.55, 0.78]));
  if (!G.legs) body.add(mesh(cyl(0.2, 0.25, 0.2, 24), cloth, [0, 0.66, 0], [0, 0, 0], [1, 1, 0.72]));

  // ---- torso: a lathed tunic (flattened front to back)
  const prof = [
    [0.0, 0.72], [0.175, 0.73], [0.168, 0.82], [0.185, 0.93], [0.21, 1.04], [0.215, 1.1], [0.19, 1.16], [0.1, 1.22], [0.0, 1.23],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torsoGeo = new THREE.LatheGeometry(prof, 32);
  const torso = mesh(torsoGeo, cloth, [0, 0, 0], [0, 0, 0], [1.12, 1, 0.74]);
  body.add(torso);
  // Collar and a trim down the front.
  body.add(mesh(torus(0.085, 0.022), trim, [0, 1.2, 0.015], [Math.PI / 2 - 0.25, 0, 0], [1.1, 1, 1]));
  body.add(mesh(new RoundedBoxGeometry(0.035, 0.36, 0.02, 2, 0.008), trim, [0, 0.98, 0.155], [0.05, 0, 0]));
  for (const y of [0.9, 1.0, 1.1]) body.add(mesh(sphere(0.012, 10, 8), gold, [0, y, 0.168]));
  body.add(mesh(torus(0.19, 0.022, Math.PI * 2, 40), leather, [0, 0.8, 0], [Math.PI / 2, 0, 0], [1.1, 0.76, 1]));
  body.add(mesh(new RoundedBoxGeometry(0.06, 0.05, 0.02, 2, 0.008), gold, [0, 0.8, 0.148]));

  // Plate or leather body armor over the tunic, with pauldrons.
  if (G.body) {
    const bm = M.metal(G.body);
    const shell = mesh(torsoGeo, bm, [0, -0.02, 0.005], [0, 0, 0], [1.2, 1.02, 0.82]);
    body.add(shell);
    if (G.body !== LEATHER) {
      body.add(mesh(torus(0.13, 0.008, Math.PI, 24), M.metal(shade(G.body, 0.3)), [0, 1.03, 0.14], [0, 0, Math.PI], [1.2, 0.5, 1]));
      for (const [x, y] of [[-0.09, 0.92], [0.09, 0.92], [-0.06, 0.86], [0.06, 0.86]]) body.add(mesh(sphere(0.01, 8, 6), M.metal(shade(G.body, 0.4)), [x, y, 0.16]));
    }
    for (const s of [-1, 1]) {
      const pd = mesh(sphere(0.11, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), bm, [s * 0.25, 1.14, 0], [0, 0, s * -0.5], [1, 0.75, 1]);
      body.add(pd);
      body.add(mesh(torus(0.1, 0.012, Math.PI * 2, 24), M.metal(shade(G.body, 0.25)), [s * 0.25, 1.12, 0], [Math.PI / 2, s * 0.5, 0], [1, 1, 0.75]));
    }
  }

  // ---- arms: sleeves, forearms, hands. The right hand holds the weapon, the left the shield/bow.
  const arms = {};
  const type = G.weapon?.type || null;
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.25, 1.13, 0);
    const holdsBow = type === 'bow' && s === -1;
    const holdsWeapon = type && type !== 'bow' && s === 1;
    const elbow = holdsWeapon || holdsBow ? V(s * 0.06, -0.24, 0.08) : V(s * 0.06, -0.25, -0.01);
    const wrist = holdsWeapon ? V(s * 0.08, -0.4, 0.2) : holdsBow ? V(s * 0.07, -0.34, 0.26) : V(s * 0.08, -0.48, 0.04);
    arm.add(limb(0.062, V(0, 0, 0), elbow, cloth));
    arm.add(limb(0.052, elbow, wrist, G.body && G.body !== LEATHER ? M.metal(G.body) : skin));
    arm.add(mesh(torus(0.05, 0.014), trim, [elbow.x * 0.98, elbow.y + 0.02, elbow.z], [Math.PI / 2, 0, 0]));
    const hand = mesh(sphere(0.058), skin, [wrist.x, wrist.y - 0.03, wrist.z], [0, 0, 0], [0.95, 1.05, 0.9]);
    arm.add(hand);
    arm.rotation.z = s * 0.12;
    body.add(arm);
    arms[s] = { arm, hand };
  }
  anim.push((t) => {
    arms[-1].arm.rotation.x = Math.sin(t * 1.1) * 0.035;
    arms[1].arm.rotation.x = Math.sin(t * 1.1 + 1) * 0.035;
  });

  // ---- weapon
  if (G.weapon) {
    const wc = G.weapon.color || '#9aa3ad';
    const hand = arms[type === 'bow' ? -1 : 1].hand;
    const holder = new THREE.Group();
    holder.position.copy(hand.position);
    hand.parent.add(holder);
    if (type === 'bow') {
      const wood = M.std('#7a4a26', { rough: 0.6 });
      const bow = new THREE.Group();
      const limbCurve = new THREE.QuadraticBezierCurve3(V(0, 0.42, -0.02), V(0, 0, 0.26), V(0, -0.42, -0.02));
      bow.add(new THREE.Mesh(new THREE.TubeGeometry(limbCurve, 32, 0.016, 8, false), wood));
      bow.add(limb(0.003, V(0, 0.42, -0.02), V(0, -0.42, -0.02), M.std('#efe9dc', { rough: 0.9 })));
      bow.add(mesh(cyl(0.024, 0.024, 0.1, 10), leather, [0, 0, 0.13]));
      for (const y of [-0.42, 0.42]) bow.add(mesh(sphere(0.02, 8, 6), M.metal(wc === LEATHER ? GOLD : wc), [0, y, -0.02]));
      bow.position.set(0, 0.02, -0.1);
      bow.rotation.set(0.1, 0, 0.12);
      holder.add(bow);
    } else if (type === 'staff') {
      const orbC = wc === '#9aa3ad' ? '#9b6bff' : wc;
      const staff = new THREE.Group();
      staff.add(mesh(cyl(0.022, 0.028, 1.5, 10), M.std('#6b4226', { rough: 0.65 }), [0, 0.25, 0]));
      for (const y of [0.55, 0.62, -0.1]) staff.add(mesh(torus(0.03, 0.008), gold, [0, y, 0], [Math.PI / 2, 0, 0]));
      const orb = mesh(sphere(0.07, 32, 20), M.std(orbC, { rough: 0.15, emissive: orbC, ei: 1.4 }), [0, 1.07, 0]);
      staff.add(orb);
      staff.add(mesh(sphere(0.12, 24, 16), M.std(orbC, { emissive: orbC, ei: 1, opacity: 0.18 }), [0, 1.07, 0]));
      for (const a of [0, 2.1, 4.2]) staff.add(horn([V(0, 0.98, 0), V(Math.cos(a) * 0.07, 1.04, Math.sin(a) * 0.07), V(Math.cos(a) * 0.04, 1.14, Math.sin(a) * 0.04)], 0.012, gold, 4));
      const light = new THREE.PointLight(orbC, 0.8, 1.5, 2);
      light.position.set(0, 1.07, 0);
      staff.add(light);
      anim.push((t) => {
        orb.material.emissiveIntensity = 1.2 + Math.sin(t * 2.4) * 0.35;
        orb.rotation.y = t;
      });
      staff.rotation.set(0.05, 0, -0.08);
      holder.add(staff);
    } else {
      // Sword: an extruded blade with a fuller line, crossguard, grip and pommel.
      const shape = new THREE.Shape();
      shape.moveTo(-0.028, 0);
      shape.lineTo(0.028, 0);
      shape.lineTo(0.024, 0.62);
      shape.lineTo(0, 0.7);
      shape.lineTo(-0.024, 0.62);
      shape.closePath();
      const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
      blade.translate(0, 0, -0.004);
      const sword = new THREE.Group();
      sword.add(mesh(blade, M.metal(wc), [0, 0.06, 0]));
      sword.add(mesh(new RoundedBoxGeometry(0.2, 0.03, 0.04, 2, 0.01), gold, [0, 0.05, 0]));
      sword.add(mesh(cyl(0.018, 0.02, 0.13, 10), leather, [0, -0.03, 0]));
      sword.add(mesh(sphere(0.026, 12, 10), gold, [0, -0.1, 0]));
      sword.rotation.set(0.35, 0, -0.35);
      sword.position.set(0.01, 0.0, 0.02);
      holder.add(sword);
    }
  }

  // ---- shield on the left forearm
  if (G.shield) {
    const sm = M.metal(G.shield);
    const s = new THREE.Shape();
    s.moveTo(-0.16, 0.16);
    s.lineTo(0.16, 0.16);
    s.lineTo(0.16, -0.02);
    s.quadraticCurveTo(0.14, -0.2, 0, -0.27);
    s.quadraticCurveTo(-0.14, -0.2, -0.16, -0.02);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3 });
    const shield = new THREE.Group();
    shield.add(mesh(geo, sm));
    shield.add(mesh(sphere(0.045, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.metal(shade(G.shield, 0.2)), [0, -0.02, 0.035], [Math.PI / 2, 0, 0]));
    shield.add(mesh(new RoundedBoxGeometry(0.03, 0.34, 0.012, 2, 0.005), gold, [0, -0.04, 0.036]));
    shield.add(mesh(new RoundedBoxGeometry(0.28, 0.03, 0.012, 2, 0.005), gold, [0, 0.07, 0.036]));
    const hand = arms[-1].hand;
    shield.position.set(hand.position.x - 0.06, hand.position.y + 0.1, hand.position.z + 0.12);
    shield.rotation.set(0, -0.45, 0);
    hand.parent.add(shield);
  }

  // ---- cape
  if (C.cape) {
    const W = 0.56;
    const H = 0.95 * (race === 'halfling' || race === 'dwarf' ? 0.9 : 1);
    const geo = new THREE.PlaneGeometry(W, H, 14, 20);
    const base = geo.attributes.position.array.slice();
    const capeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(C.cape), roughness: 0.85, side: THREE.DoubleSide });
    const cape = new THREE.Mesh(geo, capeMat);
    cape.position.set(0, 1.18 - H / 2, -0.19);
    body.add(cape);
    const flow = (t) => {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const y = base[i * 3 + 1];
        const down = (H / 2 - y) / H; // 0 at the shoulders, 1 at the hem
        const wrap = -((x / (W / 2)) ** 2) * 0.1 * (1 - down * 0.4);
        const wave = Math.sin(t * 1.6 + y * 5 + x * 3) * 0.025 * down;
        pos.setXYZ(i, x * (1 + down * 0.35), y, wrap + wave - down * 0.12);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    };
    flow(0);
    anim.push(flow);
    // Clasps
    for (const x of [-0.14, 0.14]) body.add(mesh(sphere(0.025, 12, 10), gold, [x, 1.17, 0.1]));
    root.userData.disposables = [...(root.userData.disposables || []), capeMat];
  }

  // ---- head
  const head = new THREE.Group();
  const neckTop = 1.23 * bh;
  head.position.set(0, neckTop + 0.2, 0.01);
  head.scale.set(...R.head.map((x) => x * 1.15));
  root.add(head);
  root.add(mesh(cyl(0.062, 0.07, 0.14, 16), skinDark, [0, neckTop - 0.02, 0]));
  const r = 0.2;
  // Skull and jaw
  head.add(mesh(sphere(r, 40, 28), skin, [0, 0, 0], [0, 0, 0], [0.95, 1.04, 1]));
  head.add(mesh(sphere(r * 0.72, 32, 20), skin, [0, -0.075, 0.02], [0, 0, 0], [(R.jaw || 1) * 1.05, 0.78, 0.98]));
  // A point on the face: x, y from the center, pushed onto the front of the head.
  const face = (x, y, out = 0) => {
    const z = Math.sqrt(Math.max(0, r * r * 1.02 - x * x - y * y));
    return [x, y, z + out];
  };

  // Ears
  const earType = R.ears || 'round';
  for (const s of [-1, 1]) {
    if (earType === 'pointed' || earType === 'orc') {
      const len = earType === 'pointed' ? 0.17 : 0.1;
      const ear = mesh(cone(0.04, len, 12), skin, [s * (r * 0.92 + len * 0.3), 0.02, -0.01], [0.2, 0, s * -(Math.PI / 2 - 0.55)], [1, 1, 0.45]);
      head.add(ear);
    } else {
      const big = earType === 'big' ? 1.35 : 1;
      head.add(mesh(sphere(0.045 * big, 16, 12), skin, [s * r * 0.93, 0, -0.01], [0, 0, 0], [0.45, 1, 0.8]));
      head.add(mesh(sphere(0.026 * big, 12, 10), skinDark, [s * (r * 0.93 + 0.012), 0, 0], [0, 0, 0], [0.3, 0.8, 0.6]));
    }
  }

  // Eyes: whites, iris, pupil and a catch light; lids blink.
  const glow = L.eyeColor === 'glow';
  const eyeStyle = L.eyes || 'round';
  const [ew, eh] = { round: [1, 1], narrow: [1.15, 0.6], sleepy: [1.05, 0.8], wide: [1.2, 1.2] }[eyeStyle] || [1, 1];
  const lids = [];
  for (const s of [-1, 1]) {
    if (s === 1 && L.extra === 'eyepatch') continue;
    const eye = new THREE.Group();
    eye.position.set(...face(s * 0.072, 0.012, -0.022));
    eye.add(mesh(sphere(0.036, 24, 16), M.std(glow ? '#dffcfa' : '#f8f6f0', { rough: 0.25, emissive: glow ? eyeC : null, ei: 0.3 }), [0, 0, 0], [0, 0, 0], [ew, eh, 0.7]));
    eye.add(mesh(sphere(0.021, 20, 14), M.std(eyeC, { rough: 0.2, emissive: glow ? eyeC : null, ei: 2 }), [0, 0, 0.02], [0, 0, 0], [1, 1, 0.5]));
    if (!glow) eye.add(mesh(sphere(0.01, 12, 10), M.std('#0b0b0b', { rough: 0.1 }), [0, 0, 0.029], [0, 0, 0], [1, 1, 0.4]));
    eye.add(mesh(sphere(0.005, 8, 6), M.std('#ffffff', { emissive: '#ffffff', ei: 1 }), [0.008, 0.009, 0.032]));
    // Upper lid (skin), lowered for sleepy eyes.
    const lid = mesh(sphere(0.039, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), skin, [0, 0, 0], [eyeStyle === 'sleepy' ? 0.55 : -0.25, 0, 0], [ew * 1.02, eh * 1.02, 0.78]);
    eye.add(lid);
    lids.push({ lid, open: lid.rotation.x });
    // Lash line
    eye.add(mesh(torus(0.036, 0.004, Math.PI, 20), M.std('#1d1512', { rough: 0.8 }), [0, 0.002, 0.004], [0, 0, 0], [ew, eh, 0.8]));
    if (glow) {
      const l = new THREE.PointLight(eyeC, 0.25, 0.4);
      l.position.set(0, 0, 0.05);
      eye.add(l);
    }
    head.add(eye);
  }
  if (race === 'undead' || R.gaunt) for (const s of [-1, 1]) head.add(mesh(sphere(0.05, 16, 12), skinDark, face(s * 0.072, 0.005, -0.05), [0, 0, 0], [1.1, 1, 0.6]));
  anim.push((t) => {
    // Blink every few seconds.
    const phase = (t % 4.3) / 4.3;
    const closed = phase > 0.96 ? 1 : 0;
    for (const l of lids) l.lid.rotation.x = closed ? 1.3 : l.open;
  });

  // Brows
  if (L.brows !== 'none') {
    const thick = L.brows === 'thick' ? 1.6 : 1;
    for (const s of [-1, 1]) {
      const tilt = L.brows === 'angry' ? s * 0.4 : L.brows === 'arched' ? s * -0.25 : s * -0.08;
      const brow = mesh(capsule(0.009 * thick, 0.06), hairDark, face(s * 0.072, L.brows === 'arched' ? 0.083 : 0.072, -0.008), [0, s * 0.3, Math.PI / 2 + tilt]);
      head.add(brow);
    }
  }

  // Nose
  const nose = L.nose || 'button';
  if (nose === 'button') head.add(mesh(sphere(0.025, 16, 12), skin, face(0, -0.035, 0.005)));
  else if (nose === 'round') head.add(mesh(sphere(0.036, 16, 12), skin, face(0, -0.04, 0.0), [0, 0, 0], [1.1, 0.9, 1]));
  else if (nose === 'long') head.add(mesh(capsule(0.018, 0.06), skin, face(0, -0.03, 0.01), [0.45, 0, 0]));
  else if (nose === 'hooked') {
    head.add(mesh(capsule(0.019, 0.05), skin, face(0, -0.015, 0.012), [0.3, 0, 0]));
    head.add(mesh(sphere(0.022, 12, 10), skin, face(0, -0.05, 0.012)));
  }
  if (race === 'orc') for (const s of [-1, 1]) head.add(mesh(sphere(0.008, 8, 6), M.std('#1a120e'), face(s * 0.014, -0.055, 0.012)));
  if (race === 'dwarf') head.add(mesh(sphere(0.03, 12, 10), M.skin(shade(skinC, -0.05)), face(0, -0.045, 0.008)));

  // Mouth
  const lipM = M.std(race === 'undead' ? '#3a3a44' : shade(skinC, -0.45), { rough: 0.5 });
  const mouth = L.mouth || 'smile';
  const mp = face(0, -0.1, -0.004);
  if (mouth === 'smile') head.add(mesh(torus(0.04, 0.007, Math.PI * 0.7, 20), lipM, [mp[0], mp[1] + 0.02, mp[2]], [0.1, 0, Math.PI + Math.PI * 0.15]));
  else if (mouth === 'frown') head.add(mesh(torus(0.04, 0.007, Math.PI * 0.6, 20), lipM, [mp[0], mp[1] - 0.03, mp[2] - 0.004], [-0.1, 0, Math.PI * 0.2]));
  else if (mouth === 'neutral') head.add(mesh(capsule(0.007, 0.05), lipM, mp, [0, 0, Math.PI / 2]));
  else if (mouth === 'smirk') head.add(mesh(torus(0.04, 0.007, Math.PI * 0.5, 20), lipM, [mp[0] + 0.012, mp[1] + 0.012, mp[2]], [0.1, 0, Math.PI + Math.PI * 0.35]));
  else if (mouth === 'grin') {
    head.add(mesh(sphere(0.045, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.std('#fbfbf6', { rough: 0.3 }), [mp[0], mp[1] + 0.008, mp[2] - 0.012], [0, 0, 0], [1, 0.6, 0.5]));
    head.add(mesh(torus(0.045, 0.006, Math.PI, 20), lipM, [mp[0], mp[1] + 0.008, mp[2] - 0.004], [0.2, 0, Math.PI]));
  }
  if (R.tusks) for (const s of [-1, 1]) head.add(mesh(cone(0.013, 0.06, 10), M.std('#f2ecd6', { rough: 0.4 }), face(s * 0.04, -0.115, 0.004), [0.25, 0, s * -0.15]));

  // Skin extras
  const extra = L.extra || 'none';
  if (extra === 'freckles') {
    for (const [x, y] of [[-0.1, -0.03], [-0.085, -0.045], [-0.115, -0.05], [-0.095, -0.06], [0.1, -0.03], [0.085, -0.045], [0.115, -0.05], [0.095, -0.06]]) head.add(mesh(sphere(0.004, 6, 5), M.std(shade(skinC, -0.4)), face(x, y, 0.001)));
  }
  if (extra === 'blush' || race === 'halfling') for (const s of [-1, 1]) head.add(mesh(sphere(0.028, 16, 10), M.std('#ff6f86', { opacity: 0.28 }), face(s * 0.1, -0.045, -0.02), [0, s * 0.45, 0], [1.3, 0.75, 0.3]));
  if (extra === 'scar') head.add(mesh(capsule(0.004, 0.11), M.std('#8e2f2f', { rough: 0.6 }), face(-0.08, 0.01, 0.0), [0, 0.35, 0.35]));
  if (extra === 'eyepatch') {
    head.add(mesh(sphere(0.042, 20, 12), M.std('#141418', { rough: 0.5 }), face(0.072, 0.012, -0.018), [0, 0, 0], [1.1, 1, 0.55]));
    head.add(mesh(torus(r * 1.0, 0.005, Math.PI * 2, 48), M.std('#141418'), [0, 0.03, 0], [Math.PI / 2 - 0.3, 0.15, 0.25]));
  }
  if (extra === 'earring') head.add(mesh(torus(0.016, 0.004), gold, [-r * 0.95, -0.05, 0.01], [0, Math.PI / 2, 0]));
  if (race === 'undead') for (const [x, y] of [[0.1, -0.08], [0.115, -0.1]]) head.add(mesh(capsule(0.003, 0.03), M.std('#2a2a33'), face(x, y, 0.001), [0, 0, 0.8]));

  // ---- hair
  const hair = L.hair || 'short';
  const cap = (thetaLen = Math.PI * 0.5, tilt = -0.3, scale = 1.07) => mesh(new THREE.SphereGeometry(r * scale, 36, 20, 0, Math.PI * 2, 0, thetaLen), hairM, [0, 0.012, -0.005], [tilt, 0, 0], [0.97, 1.05, 1.02]);
  if (hair === 'short') head.add(cap(Math.PI * 0.52, -0.42));
  if (hair === 'sidepart') {
    head.add(cap(Math.PI * 0.52, -0.42));
    head.add(mesh(sphere(0.11, 24, 14), hairM, [0.06, 0.15, 0.08], [0.2, 0, -0.3], [1.3, 0.45, 0.9]));
  }
  if (hair === 'spiky') {
    head.add(cap(Math.PI * 0.48, -0.4));
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const up = 0.75 + (i % 3) * 0.08;
      const dir = V(Math.cos(a) * 0.55, up, Math.sin(a) * 0.55 - 0.1).normalize();
      const sp = mesh(cone(0.045, 0.12, 8), hairM);
      sp.position.copy(dir.clone().multiplyScalar(r * 1.02));
      sp.quaternion.setFromUnitVectors(V(0, 1, 0), dir);
      head.add(sp);
    }
  }
  if (hair === 'curly') {
    for (let i = 0; i < 46; i++) {
      const phi = Math.acos(1 - (i / 46) * 1.15); // cover the top and back
      const th = i * 2.399;
      const dir = V(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
      if (dir.z > 0.55 && dir.y < 0.55) continue; // leave the face clear
      head.add(mesh(sphere(0.052, 12, 10), i % 4 ? hairM : hairDark, dir.multiplyScalar(r * 1.04).toArray()));
    }
  }
  if (hair === 'mohawk') {
    head.add(mesh(new THREE.SphereGeometry(r * 1.01, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), M.std(hairC, { opacity: 0.35 }), [0, 0, 0], [-0.4, 0, 0]));
    for (let i = 0; i < 7; i++) {
      const a = -0.9 + i * 0.36;
      const dir = V(0, Math.cos(a), Math.sin(a));
      const fin = mesh(cone(0.04, 0.16 - Math.abs(i - 3) * 0.01, 4), hairM, dir.clone().multiplyScalar(r * 1.05).toArray(), [0, 0, 0], [0.45, 1, 1.2]);
      fin.quaternion.setFromUnitVectors(V(0, 1, 0), dir);
      head.add(fin);
    }
  }
  if (hair === 'long' || hair === 'ponytail' || hair === 'bun' || hair === 'braids') head.add(cap(Math.PI * 0.55, -0.45));
  if (hair === 'long') {
    head.add(mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.2, 0.46, 28, 1, true, Math.PI * 0.35, Math.PI * 1.3), hairM, [0, -0.2, -0.015], [0.05, 0, 0]));
    for (const s of [-1, 1]) head.add(mesh(capsule(0.045, 0.28), hairM, [s * 0.16, -0.18, 0.07], [0.1, 0, s * 0.1]));
  }
  if (hair === 'ponytail') {
    head.add(mesh(torus(0.035, 0.012), M.std(outfitC), [0, 0.02, -0.21], [0, 0, 0]));
    const tail = horn([V(0, 0.02, -0.22), V(0, -0.1, -0.29), V(0, -0.3, -0.27), V(0, -0.42, -0.22)], 0.06, hairM, 6);
    head.add(tail);
    anim.push((t) => (tail.rotation.z = Math.sin(t * 1.3) * 0.05));
  }
  if (hair === 'bun') head.add(mesh(sphere(0.08, 24, 16), hairM, [0, 0.17, -0.1]));
  if (hair === 'braids') {
    for (const s of [-1, 1]) {
      for (let i = 0; i < 7; i++) head.add(mesh(sphere(0.038 - i * 0.002, 12, 10), i % 2 ? hairM : hairDark, [s * 0.17, -0.1 - i * 0.055, 0.04 + i * 0.012], [0, 0, 0], [1, 1.15, 1]));
      head.add(mesh(cyl(0.02, 0.02, 0.03, 10), gold, [s * 0.17, -0.5, 0.125]));
    }
  }

  // ---- facial hair
  const fh = L.facialHair || 'none';
  if (fh === 'stubble') head.add(mesh(new THREE.SphereGeometry(r * 1.004, 36, 20, -Math.PI * 0.05, Math.PI * 1.1, Math.PI * 0.56, Math.PI * 0.36), M.std(hairC, { opacity: 0.22 }), [0, -0.02, 0.012], [0, 0, 0], [1.04 * (R.jaw || 1), 1.05, 1.04]));
  if (fh === 'beard' || fh === 'longbeard') {
    head.add(mesh(sphere(0.15, 32, 20), hairM, [0, -0.15, 0.05], [0, 0, 0], [1.28 * (R.jaw || 1), 0.9, 0.85]));
    for (const s of [-1, 1]) head.add(mesh(capsule(0.045, 0.1), hairM, [s * 0.16, -0.06, 0.03], [0, 0, s * 0.25]));
  }
  if (fh === 'longbeard') {
    head.add(mesh(cone(0.13, 0.34, 24), hairM, [0, -0.33, 0.07], [Math.PI + 0.2, 0, 0], [1.15, 1, 0.75]));
    if (race === 'dwarf') head.add(mesh(cyl(0.035, 0.035, 0.035, 14), gold, [0, -0.36, 0.09], [0.2, 0, 0]));
  }
  if (fh === 'goatee') head.add(mesh(cone(0.035, 0.08, 12), hairM, face(0, -0.15, -0.01), [Math.PI + 0.3, 0, 0]));
  if (['mustache', 'goatee', 'beard', 'longbeard', 'handlebar'].includes(fh)) {
    for (const s of [-1, 1]) head.add(mesh(capsule(0.014, 0.045), hairDark, face(s * 0.03, -0.068, 0.006), [0, 0, s * (Math.PI / 2 - 0.35)]));
  }
  if (fh === 'handlebar') for (const s of [-1, 1]) head.add(mesh(torus(0.018, 0.007, Math.PI * 1.3, 14), hairDark, face(s * 0.068, -0.068, 0.0), [0, 0, s > 0 ? -0.6 : Math.PI + 0.6]));

  // ---- helmet (a hat shows instead)
  if (G.head && !C.hat) {
    const hm = M.metal(G.head);
    head.add(mesh(new THREE.SphereGeometry(r * 1.13, 36, 20, 0, Math.PI * 2, 0, Math.PI * 0.55), hm, [0, 0.01, -0.01], [-0.25, 0, 0]));
    head.add(mesh(torus(r * 1.12, 0.012, Math.PI * 2, 48), M.metal(shade(G.head, -0.2)), [0, -0.005, -0.01], [Math.PI / 2 - 0.25, 0, 0], [1, 1.02, 1]));
    if (G.head !== LEATHER) {
      head.add(mesh(new RoundedBoxGeometry(0.026, 0.1, 0.018, 2, 0.006), hm, face(0, 0.045, 0.028)));
      for (const s of [-1, 1]) head.add(mesh(sphere(0.012, 8, 6), M.metal(shade(G.head, 0.3)), face(s * 0.15, 0.06, 0.02)));
    }
  }

  // ---- hats
  const hat = C.hat;
  const top = r * 1.02;
  const H = new THREE.Group();
  H.position.set(0, top * 0.75, -0.01);
  H.rotation.x = -0.18;
  head.add(H);
  if (hat === 'party') {
    const c = mesh(cone(0.1, 0.26, 24), M.std('#e3508f', { rough: 0.5 }), [0, 0.13, 0]);
    H.add(c);
    for (const [y, rr] of [[0.05, 0.08], [0.13, 0.055]]) H.add(mesh(torus(rr, 0.008), M.std('#ffd84a'), [0, y, 0], [Math.PI / 2, 0, 0]));
    H.add(mesh(sphere(0.035), M.std('#ffd84a'), [0, 0.27, 0]));
  } else if (hat === 'chef') {
    H.add(mesh(cyl(0.16, 0.15, 0.12, 28), M.std('#f4f4f4', { rough: 0.95 }), [0, 0.04, 0]));
    for (const [x, z] of [[-0.08, 0], [0.08, 0], [0, 0.06], [0, -0.07], [0, 0]]) H.add(mesh(sphere(0.1, 20, 14), M.std('#fafafa', { rough: 0.95 }), [x, 0.16, z]));
  } else if (hat === 'bunny') {
    for (const s of [-1, 1]) {
      H.add(mesh(sphere(0.05, 16, 12), M.std('#f5f5f5'), [s * 0.07, 0.17, 0], [0, 0, s * -0.2], [0.8, 3, 0.5]));
      H.add(mesh(sphere(0.03, 12, 10), M.std('#f4a6c0'), [s * 0.075, 0.17, 0.02], [0, 0, s * -0.2], [0.8, 3.2, 0.4]));
    }
  } else if (hat === 'wizard') {
    H.add(mesh(cyl(0.3, 0.3, 0.02, 40), M.std('#2d3e96'), [0, 0.0, 0]));
    const tip = horn([V(0, 0, 0), V(0, 0.2, -0.01), V(0.03, 0.34, -0.05), V(0.1, 0.42, -0.1)], 0.16, M.std('#3a4fb8', { rough: 0.8 }), 9);
    H.add(tip);
    H.add(mesh(torus(0.155, 0.014), M.std('#ffd84a', { rough: 0.4 }), [0, 0.03, 0], [Math.PI / 2, 0, 0]));
    const star = mesh(new THREE.OctahedronGeometry(0.03), M.std('#ffd84a', { emissive: '#ffd84a', ei: 0.8 }), [0.04, 0.15, 0.13]);
    H.add(star);
    anim.push((t) => (star.rotation.y = t * 1.5));
  } else if (hat === 'tophat') {
    H.add(mesh(cyl(0.26, 0.26, 0.018, 40), M.std('#15151a', { rough: 0.5 }), [0, 0, 0]));
    H.add(mesh(cyl(0.15, 0.14, 0.28, 32), M.std('#1c1c22', { rough: 0.45 }), [0, 0.14, 0]));
    H.add(mesh(cyl(0.143, 0.143, 0.05, 32), M.std('#b8323a'), [0, 0.04, 0]));
  } else if (hat === 'pirate') {
    H.add(mesh(sphere(0.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.std('#1f1f24', { rough: 0.7 }), [0, -0.02, 0], [0, 0, 0], [1.05, 0.6, 1]));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      H.add(mesh(new RoundedBoxGeometry(0.28, 0.12, 0.03, 2, 0.01), M.std('#1f1f24'), [Math.cos(a) * 0.14, 0.04, Math.sin(a) * 0.14], [0.2, -a + Math.PI / 2, 0]));
    }
    H.add(mesh(sphere(0.03, 12, 10), M.std('#f2f2f2'), [0, 0.07, 0.19]));
  } else if (hat === 'viking') {
    H.add(mesh(new THREE.SphereGeometry(0.22, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.metal('#9aa3ad'), [0, -0.06, 0]));
    H.add(mesh(torus(0.215, 0.022, Math.PI * 2, 40), M.std('#7a5334'), [0, -0.05, 0], [Math.PI / 2, 0, 0]));
    for (const s of [-1, 1]) H.add(horn([V(s * 0.19, 0.0, 0), V(s * 0.3, 0.05, 0), V(s * 0.36, 0.18, -0.02), V(s * 0.33, 0.3, -0.05)], 0.05, M.std('#efe6c8', { rough: 0.5 }), 8));
  } else if (hat === 'demon') {
    for (const s of [-1, 1]) H.add(horn([V(s * 0.1, 0, 0.05), V(s * 0.16, 0.1, 0.04), V(s * 0.15, 0.2, -0.02), V(s * 0.1, 0.27, -0.08)], 0.04, M.std('#b3202a', { rough: 0.4 }), 7));
  } else if (hat === 'halo') {
    const halo = mesh(torus(0.15, 0.018, Math.PI * 2, 48), M.std('#ffe27a', { emissive: '#ffd84a', ei: 1.6 }), [0, 0.18, 0], [Math.PI / 2, 0, 0]);
    H.add(halo);
    anim.push((t) => (halo.position.y = 0.18 + Math.sin(t * 1.8) * 0.012));
  } else if (hat === 'crown' || hat === 'champion') {
    const g = M.metal('#e8c34a');
    H.add(mesh(cyl(0.16, 0.16, 0.07, 32, 1, true), g, [0, 0.02, 0]));
    const spikes = hat === 'champion' ? 7 : 5;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      H.add(mesh(cone(0.03, 0.1, 8), g, [Math.cos(a) * 0.155, 0.1, Math.sin(a) * 0.155]));
      H.add(mesh(sphere(0.012, 8, 6), M.std('#fff', { emissive: '#fff', ei: 0.4 }), [Math.cos(a) * 0.155, 0.155, Math.sin(a) * 0.155]));
    }
    for (const [a, c] of [[Math.PI / 2, '#c0392b'], [Math.PI / 2 - 0.6, '#3a64b8'], [Math.PI / 2 + 0.6, '#3f8a4a']]) H.add(mesh(sphere(0.02, 12, 10), M.std(c, { rough: 0.1, metal: 0.3 }), [Math.cos(a) * 0.162, 0.02, Math.sin(a) * 0.162]));
    if (hat === 'champion') H.add(mesh(torus(0.16, 0.015, Math.PI * 2, 40), M.std('#c0392b'), [0, -0.01, 0], [Math.PI / 2, 0, 0]));
  } else if (hat === 'laurel-silver' || hat === 'laurel-bronze') {
    const lm = M.metal(hat === 'laurel-silver' ? '#d9dee5' : '#c9894a');
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      if (Math.abs(Math.sin(a) - 1) < 0.05) continue;
      H.add(mesh(sphere(0.03, 10, 8), lm, [Math.cos(a) * 0.19, 0.0, Math.sin(a) * 0.19], [0, -a, 0.6], [1.6, 0.5, 0.35]));
    }
  } else if (hat === 'pumpkin') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      H.add(mesh(sphere(0.12, 20, 14), M.std(i % 2 ? '#f07b1d' : '#e46a10', { rough: 0.6 }), [Math.cos(a) * 0.08, 0.08, Math.sin(a) * 0.08], [0, -a, 0], [0.7, 0.8, 1]));
    }
    H.add(mesh(cyl(0.02, 0.028, 0.08, 10), M.std('#4d7a2a'), [0, 0.2, 0]));
  } else if (hat === 'antlers') {
    const am = M.std('#8a5a35', { rough: 0.7 });
    for (const s of [-1, 1]) {
      H.add(horn([V(s * 0.1, 0, 0), V(s * 0.18, 0.15, -0.02), V(s * 0.28, 0.3, -0.05)], 0.022, am, 6));
      H.add(horn([V(s * 0.16, 0.12, -0.02), V(s * 0.1, 0.24, 0.02)], 0.014, am, 3));
      H.add(horn([V(s * 0.23, 0.23, -0.04), V(s * 0.3, 0.32, 0.02)], 0.012, am, 3));
    }
  } else if (hat === 'flowers') {
    const cols = ['#ff6ad5', '#ffd84a', '#7fd8ff', '#ff8a3a', '#b58cf0'];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const f = new THREE.Group();
      f.position.set(Math.cos(a) * 0.19, 0, Math.sin(a) * 0.19);
      for (let k = 0; k < 5; k++) f.add(mesh(sphere(0.018, 8, 6), M.std(cols[i % cols.length]), [Math.cos(k * 1.26) * 0.02, Math.sin(k * 1.26) * 0.02, 0]));
      f.add(mesh(sphere(0.012, 8, 6), M.std('#fff6c2'), [0, 0, 0.01]));
      f.lookAt(f.position.clone().multiplyScalar(3));
      H.add(f);
    }
  } else if (hat === 'samurai') {
    H.add(mesh(new THREE.SphereGeometry(0.23, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.std('#2a2d33', { rough: 0.4, metal: 0.4 }), [0, -0.06, 0]));
    H.add(mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.12, 32, 1, true, Math.PI * 0.6, Math.PI * 1.8), M.std('#2a2d33', { rough: 0.45, metal: 0.4, side: THREE.DoubleSide }), [0, -0.1, 0]));
    for (const s of [-1, 1]) H.add(mesh(torus(0.11, 0.012, Math.PI * 0.6, 20), M.metal('#e8c34a'), [s * 0.05, 0.12, 0.18], [0, 0, s > 0 ? 0.1 : Math.PI - Math.PI * 0.6 - 0.1]));
    H.add(mesh(sphere(0.03, 12, 10), M.std('#c0392b'), [0, 0.07, 0.21]));
  }

  // ---- aura: a soft glow behind them and drifting motes
  if (C.aura) {
    const tex = radialTexture(`${C.aura}aa`, `${C.aura}00`);
    const glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glowS.scale.set(1.9, 2.4, 1);
    glowS.position.set(0, 1.0, -0.4);
    root.add(glowS);
    const n = 40;
    const pos = new Float32Array(n * 3);
    const seeds = [];
    for (let i = 0; i < n; i++) seeds.push([Math.random() * Math.PI * 2, 0.35 + Math.random() * 0.25, Math.random() * 1.9, 0.3 + Math.random() * 0.5]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const motes = new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(shade(C.aura, 0.4)), size: 0.035, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    root.add(motes);
    anim.push((t) => {
      for (let i = 0; i < n; i++) {
        const [a0, rad, y0, sp] = seeds[i];
        const a = a0 + t * sp * 0.6;
        pos[i * 3] = Math.cos(a) * rad;
        pos[i * 3 + 1] = (y0 + t * sp * 0.25) % 2;
        pos[i * 3 + 2] = Math.sin(a) * rad;
      }
      geo.attributes.position.needsUpdate = true;
      glowS.material.opacity = 0.8 + Math.sin(t * 1.5) * 0.2;
    });
    root.userData.disposables = [...(root.userData.disposables || []), tex, glowS.material, geo, motes.material];
  }

  // ---- pet follows at their feet
  if (appearance?.pet) {
    const pet = emojiSprite(appearance.pet);
    pet.position.set(0.42, 0.2, 0.2);
    root.add(pet);
    anim.push((t) => (pet.position.y = 0.2 + Math.abs(Math.sin(t * 2.2)) * 0.06));
    root.userData.disposables = [...(root.userData.disposables || []), pet.material.map, pet.material];
  }

  // ---- idle: breathing and a slow look around
  anim.push((t) => {
    const b = Math.sin(t * 1.6) * 0.008;
    torso.scale.y = 1 + b;
    head.position.y = neckTop + 0.2 + b * 0.8;
    head.rotation.y = Math.sin(t * 0.37) * 0.18;
    head.rotation.x = Math.sin(t * 0.53) * 0.04;
  });

  root.userData.height = neckTop + 0.45 * R.head[1] + (hat || G.head ? 0.25 : 0.08);
  root.userData.headY = neckTop + 0.2;
  return { group: root, tick: (t) => anim.forEach((f) => f(t)) };
}

// Frees a character's geometries (shared materials are freed with the view).
function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
  for (const d of g.userData.disposables || []) d.dispose?.();
}

// ---- The viewer ----------------------------------------------------------------------------------
export function supported() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

// Mounts a turntable viewer in `el` (sized by CSS). opts: { autoRotate, controls, zoom }.
export function mount(el, appearance, opts = {}) {
  const { autoRotate = true, controls: withControls = true } = opts;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'char3d-canvas';
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;

  // Lights: warm key, cool rim, soft fill from the sky.
  scene.add(new THREE.HemisphereLight('#dfe8ff', '#2a2218', 0.9));
  const key = new THREE.DirectionalLight('#fff1dc', 2.2);
  key.position.set(1.6, 2.6, 2.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#7fb4ff', 1.6);
  rim.position.set(-2, 2, -2.5);
  scene.add(rim);
  const fill = new THREE.DirectionalLight('#ffffff', 0.5);
  fill.position.set(-2, 1, 2);
  scene.add(fill);

  // Ground: a glowing disc and a soft contact shadow.
  const groundTex = radialTexture('rgba(83,252,24,0.22)', 'rgba(83,252,24,0)');
  const ground = new THREE.Mesh(new THREE.CircleGeometry(0.85, 48), new THREE.MeshBasicMaterial({ map: groundTex, transparent: true, depthWrite: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.001;
  scene.add(ground);
  const shadowTex = radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  scene.add(shadow);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.8, 64), new THREE.MeshBasicMaterial({ color: '#53fc18', transparent: true, opacity: 0.35 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.003;
  scene.add(ring);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  let controls = null;
  if (withControls) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // Shift/Ctrl + drag or right-drag moves the view (two fingers on touch), so any part of the
    // character can be brought to the middle; scrolling zooms toward the pointer.
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.panSpeed = 0.8;
    controls.zoomToCursor = true;
    controls.minDistance = 0.55;
    controls.maxDistance = 6;
    controls.minPolarAngle = 0.2;
    controls.maxPolarAngle = 1.66;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.2;
    // Keep the view on the character.
    controls.addEventListener('change', () => {
      const h = char?.group.userData.height || 1.8;
      const t = controls.target;
      t.set(THREE.MathUtils.clamp(t.x, -0.7, 0.7), THREE.MathUtils.clamp(t.y, 0.05, h + 0.25), THREE.MathUtils.clamp(t.z, -0.6, 0.6));
    });
    // Turning resumes after a pause; once they've moved in or zoomed on a part, it stays put.
    let resume = null;
    let inspecting = false;
    const home = () => (char ? camera.position.distanceTo(controls.target) : 0);
    let homeDist = 0;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      clearTimeout(resume);
    });
    controls.addEventListener('end', () => {
      clearTimeout(resume);
      const h = char?.group.userData.height || 1.8;
      inspecting = Math.abs(controls.target.y - h * 0.5) > 0.05 || Math.abs(controls.target.x) > 0.05 || Math.abs(home() - homeDist) > 0.1;
      if (autoRotate && !inspecting) resume = setTimeout(() => (controls.autoRotate = true), 6000);
    });
    // Double-click (or double-tap) puts the camera back.
    renderer.domElement.addEventListener('dblclick', () => {
      frame();
      inspecting = false;
      if (autoRotate) controls.autoRotate = true;
    });
    controls.userData = { setHome: (d) => (homeDist = d) };
  }

  let M = materials();
  let char = null;
  const frame = () => {
    const h = char?.group.userData.height || 1.8;
    const headY = char?.group.userData.headY || 1.4;
    const close = opts.view === 'head';
    const target = close ? V(0, headY, 0) : V(0, h * 0.5, 0);
    const dist = close ? 1.35 : Math.max(2.4, h * 2.1);
    camera.position.set(dist * 0.3, close ? headY + 0.05 : h * 0.58, dist);
    camera.lookAt(target);
    if (controls) {
      controls.target.copy(target);
      controls.update();
      controls.userData.setHome(camera.position.distanceTo(target));
    }
  };
  function update(app) {
    if (char) {
      scene.remove(char.group);
      disposeGroup(char.group);
      M.dispose();
      M = materials();
    }
    char = buildCharacter(app, M);
    scene.add(char.group);
    frame();
  }
  update(appearance);

  const resize = () => {
    const w = el.clientWidth || 300;
    const h = el.clientHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  // Only render while visible on screen and the tab is open.
  let visible = true;
  const io = new IntersectionObserver((entries) => (visible = entries.some((e) => e.isIntersecting)));
  io.observe(el);
  const clock = new THREE.Clock();
  let raf = 0;
  let disposed = false;
  const loop = () => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    const t = clock.getElapsedTime();
    char?.tick(t);
    controls?.update();
    renderer.render(scene, camera);
  };
  loop();

  return {
    update,
    // A PNG of the current view (for share cards).
    snapshot() {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      controls?.dispose();
      if (char) disposeGroup(char.group);
      M.dispose();
      for (const o of [ground, shadow, ring]) {
        o.geometry.dispose();
        o.material.dispose();
      }
      groundTex.dispose();
      shadowTex.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
