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
import { buildPet } from './pet3d.js';

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
  let weaponHolder = null;
  if (G.weapon) {
    const wc = G.weapon.color || '#9aa3ad';
    const hand = arms[type === 'bow' ? -1 : 1].hand;
    const holder = new THREE.Group();
    weaponHolder = holder;
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
    } else if (type === 'battleaxe') {
      // Battleaxe: a long haft and a double-bitted head with a collar.
      const axe = new THREE.Group();
      const haft = M.std('#6b4226', { rough: 0.65 });
      axe.add(mesh(cyl(0.02, 0.024, 0.95, 10), haft, [0, 0.3, 0]));
      const bit = new THREE.Shape();
      bit.moveTo(0, 0.07);
      bit.quadraticCurveTo(0.12, 0.1, 0.2, 0.17);
      bit.quadraticCurveTo(0.25, 0, 0.2, -0.17);
      bit.quadraticCurveTo(0.12, -0.1, 0, -0.07);
      bit.closePath();
      const bitGeo = new THREE.ExtrudeGeometry(bit, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 2 });
      bitGeo.translate(0, 0, -0.007);
      for (const side of [1, -1]) axe.add(mesh(bitGeo, M.metal(wc), [0, 0.66, 0], [0, side === 1 ? 0 : Math.PI, 0]));
      axe.add(mesh(cyl(0.034, 0.034, 0.16, 10), M.metal(shade(wc, -0.2)), [0, 0.66, 0]));
      axe.add(mesh(cone(0.024, 0.08, 8), M.metal(wc), [0, 0.8, 0]));
      axe.add(mesh(cyl(0.026, 0.026, 0.14, 10), leather, [0, -0.05, 0]));
      axe.add(mesh(sphere(0.03, 12, 10), gold, [0, -0.15, 0]));
      axe.rotation.set(0.35, 0, -0.35);
      holder.add(axe);
    } else if (type === 'spear') {
      // Spear: a tall shaft, a leaf-shaped head and a binding.
      const spear = new THREE.Group();
      spear.add(mesh(cyl(0.017, 0.02, 1.25, 10), M.std('#8a5d36', { rough: 0.65 }), [0, 0.3, 0]));
      const leaf = new THREE.Shape();
      leaf.moveTo(0, 0);
      leaf.quadraticCurveTo(0.055, 0.08, 0, 0.24);
      leaf.quadraticCurveTo(-0.055, 0.08, 0, 0);
      const leafGeo = new THREE.ExtrudeGeometry(leaf, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
      leafGeo.translate(0, 0, -0.005);
      spear.add(mesh(leafGeo, M.metal(wc), [0, 0.93, 0]));
      spear.add(mesh(cyl(0.024, 0.02, 0.07, 10), gold, [0, 0.91, 0]));
      spear.add(mesh(cyl(0.022, 0.022, 0.12, 10), leather, [0, 0, 0]));
      spear.rotation.set(0.12, 0, -0.08);
      spear.position.set(0, -0.15, 0);
      holder.add(spear);
    } else if (type === 'scythe') {
      // Scythe: a long dark snath with a grip and a sweeping curved blade at the top.
      const scythe = new THREE.Group();
      scythe.add(mesh(cyl(0.02, 0.024, 1.6, 10), M.std('#3b2a20', { rough: 0.7 }), [0, 0.4, 0]));
      scythe.add(mesh(cyl(0.012, 0.012, 0.12, 8), M.std('#3b2a20', { rough: 0.7 }), [0, 0.3, 0.06], [Math.PI / 2, 0, 0]));
      const blade = new THREE.Shape();
      blade.moveTo(0, 0.03);
      blade.quadraticCurveTo(0.3, 0.1, 0.48, -0.14);
      blade.quadraticCurveTo(0.26, -0.02, 0, -0.05);
      blade.closePath();
      const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.005, bevelSegments: 1 });
      bladeGeo.translate(0, 0, -0.004);
      scythe.add(mesh(bladeGeo, M.metal(wc), [0, 1.18, 0], [0, Math.PI + 1.0, 0]));
      scythe.add(mesh(cyl(0.03, 0.03, 0.06, 10), M.metal(shade(wc, -0.3)), [0, 1.18, 0]));
      const glow = mesh(sphere(0.035, 12, 10), M.std('#7dffb0', { emissive: '#7dffb0', ei: 1.4 }), [0, 1.23, 0]);
      scythe.add(glow);
      anim.push((t) => glow.scale.setScalar(0.85 + 0.2 * Math.sin(t * 3)));
      scythe.rotation.set(0.1, 0, -0.06);
      scythe.position.set(0, -0.15, 0);
      holder.add(scythe);
    } else if (type === 'dagger') {
      // Dagger: a short double-edged blade held point-forward.
      const shape = new THREE.Shape();
      shape.moveTo(-0.022, 0);
      shape.lineTo(0.022, 0);
      shape.lineTo(0.016, 0.2);
      shape.lineTo(0, 0.26);
      shape.lineTo(-0.016, 0.2);
      shape.closePath();
      const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
      blade.translate(0, 0, -0.003);
      const dagger = new THREE.Group();
      dagger.add(mesh(blade, M.metal(wc), [0, 0.05, 0]));
      dagger.add(mesh(new RoundedBoxGeometry(0.1, 0.022, 0.03, 2, 0.008), gold, [0, 0.045, 0]));
      dagger.add(mesh(cyl(0.015, 0.017, 0.09, 10), leather, [0, -0.01, 0]));
      dagger.add(mesh(sphere(0.02, 10, 8), gold, [0, -0.06, 0]));
      dagger.rotation.set(0.35, 0, -0.35);
      dagger.scale.setScalar(1.25);
      holder.add(dagger);
    } else if (type === 'knuckles') {
      // Knuckles: a studded metal band across each fist.
      for (const side of [1, -1]) {
        const band = new THREE.Group();
        band.add(mesh(new RoundedBoxGeometry(0.1, 0.035, 0.05, 2, 0.012), M.metal(wc), [0, 0, 0]));
        for (const x of [-0.033, -0.011, 0.011, 0.033]) band.add(mesh(cone(0.012, 0.03, 6), M.metal(shade(wc, 0.2)), [x, 0, 0.035], [Math.PI / 2, 0, 0]));
        if (side === 1) {
          band.position.set(0, -0.01, 0.04);
          holder.add(band);
        } else {
          const left = arms[-1].hand;
          band.position.set(left.position.x, left.position.y - 0.01, left.position.z + 0.04);
          left.parent.add(band);
        }
      }
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
  // The real 3D pet (pet3d.js), shrunk to knee height and turned towards the viewer; the emoji only
  // for data without a pet id.
  const petModel = appearance?.petId ? buildPet(appearance.petId) : null;
  if (petModel) {
    const size = new THREE.Box3().setFromObject(petModel).getSize(new THREE.Vector3());
    const k = 0.5 / Math.max(size.x, size.y, size.z);
    petModel.scale.setScalar(k);
    petModel.rotation.y = -1.1;
    const pet = new THREE.Group();
    pet.add(petModel);
    pet.position.set(0.48, 0, 0.22);
    root.add(pet);
    anim.push((t) => {
      pet.position.y = Math.abs(Math.sin(t * 2.2)) * 0.05;
      petModel.rotation.y = -1.1 + Math.sin(t * 0.7) * 0.25;
    });
    const geos = [];
    petModel.traverse((o) => o.geometry && geos.push(o.geometry));
    root.userData.disposables = [...(root.userData.disposables || []), ...geos, { dispose: petModel.userData.dispose }];
  } else if (appearance?.pet) {
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
  return { group: root, tick: (t) => anim.forEach((f) => f(t)), rig: { arms, body, head, torso, weapon: weaponHolder, weaponType: type, neckTop } };
}

// Frees a character's geometries (shared materials are freed with the view).
function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
  for (const d of g.userData.disposables || []) d.dispose?.();
}

// ---- Actions (the stream overlay): the character doing what they just did ---------------------
// A tool in the right hand (or their own weapon for fights), something to work on in front of them,
// a looping motion, and the loot popping up. action: { skill, kind, target (emoji), loot (emoji) }.
const SKILL_ACTIONS = {
  fishing: { tool: 'rod', prop: 'water', motion: 'cast' },
  mining: { tool: 'pickaxe', prop: 'rock', motion: 'swing', bits: '#a8a29e' },
  woodcutting: { tool: 'axe', prop: 'tree', motion: 'swing', bits: '#b07b4f' },
  digging: { tool: 'shovel', prop: 'dirt', motion: 'dig', bits: '#8d5a3b' },
  skinning: { tool: 'knife', prop: 'emoji', emoji: '🦌', motion: 'stab', bits: '#d0d0d0' },
  farming: { tool: 'trowel', prop: 'dirt', motion: 'plant', bits: '#6bc46b' },
  harvest: { tool: null, prop: 'crops', motion: 'plant', bits: '#e3c16f' },
  firemaking: { tool: 'flint', prop: 'fire', motion: 'stab', bits: '#ffb03a' },
  agility: { tool: null, prop: 'emoji', emoji: '🏁', motion: 'run' },
  cooking: { tool: 'pan', prop: 'fire', motion: 'stir', bits: '#dddddd' },
  smelting: { tool: 'tongs', prop: 'furnace', motion: 'stab', bits: '#ff8a3a' },
  smithing: { tool: 'hammer', prop: 'anvil', motion: 'swing', bits: '#ffcf4a' },
  fletching: { tool: 'knife', prop: 'log', motion: 'stab', bits: '#c9a06a' },
  carpentry: { tool: 'saw', prop: 'log', motion: 'stab', bits: '#e0b878' },
  construction: { tool: 'hammer', prop: 'emoji', emoji: '🏗️', motion: 'swing', bits: '#c9a06a' },
  crafting: { tool: 'needle', prop: 'emoji', emoji: '🧵', motion: 'stab', bits: '#c9a06a' },
  alchemy: { tool: 'spoon', prop: 'cauldron', motion: 'stir', bits: '#b58cf0' },
  swords: { tool: 'weapon', prop: 'emoji', emoji: '👹', motion: 'swing', bits: '#ff5c7a' },
  archery: { tool: 'weapon', prop: 'emoji', emoji: '👹', motion: 'shoot', bits: '#ff5c7a' },
  magic: { tool: 'weapon', prop: 'emoji', emoji: '👹', motion: 'spell', bits: '#b58cf0' },
  axes: { tool: 'weapon', prop: 'emoji', emoji: '👹', motion: 'swing', bits: '#ff5c7a' },
  daggers: { tool: 'weapon', prop: 'emoji', emoji: '👹', motion: 'stab', bits: '#ff5c7a' },
  spears: { tool: 'weapon', prop: 'emoji', emoji: '👹', motion: 'stab', bits: '#ff5c7a' },
  brawling: { tool: 'weapon', prop: 'emoji', emoji: '👹', motion: 'attack', bits: '#ffcf4a' },
  necromancy: { tool: 'weapon', prop: 'emoji', emoji: '👹', motion: 'swing', bits: '#7dffb0' },
};
const KIND_MOTION = { levelup: 'cheer', charlevel: 'cheer', achievement: 'cheer', jackpot: 'cheer', pet: 'cheer', task: 'cheer', death: 'fall', duel: 'attack', raid: 'attack', follow: 'wave', sub: 'wave', gift: 'wave', kicks: 'cheer' };

// A tool held in the right hand: the handle runs on from the arm (local -y), the head at the end.
function buildTool(kind, M) {
  const g = new THREE.Group();
  const wood = M.std('#8a5d36', { rough: 0.7 });
  const iron = M.metal('#9aa3ad');
  const handle = (len, r = 0.018) => g.add(mesh(cyl(r, r, len, 10), wood, [0, -len / 2 + 0.05, 0]));
  if (kind === 'pickaxe') {
    handle(0.55);
    g.add(horn([V(0, -0.5, -0.2), V(0, -0.55, 0), V(0, -0.5, 0.22)], 0.03, iron, 6));
  } else if (kind === 'axe') {
    handle(0.55);
    const blade = new THREE.Shape();
    blade.moveTo(0, 0.06);
    blade.quadraticCurveTo(0.16, 0.1, 0.17, -0.02);
    blade.quadraticCurveTo(0.12, -0.12, 0, -0.06);
    blade.closePath();
    g.add(mesh(new THREE.ExtrudeGeometry(blade, { depth: 0.02, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1 }), iron, [0, -0.47, -0.01], [0, -Math.PI / 2, Math.PI / 2]));
  } else if (kind === 'hammer') {
    handle(0.42);
    g.add(mesh(new RoundedBoxGeometry(0.08, 0.08, 0.2, 2, 0.015), iron, [0, -0.38, 0.02]));
  } else if (kind === 'shovel') {
    handle(0.7);
    g.add(mesh(new RoundedBoxGeometry(0.16, 0.2, 0.02, 2, 0.008), iron, [0, -0.72, 0.02], [0.3, 0, 0]));
  } else if (kind === 'trowel') {
    handle(0.14);
    g.add(mesh(cone(0.05, 0.14, 4), iron, [0, -0.2, 0.02], [Math.PI, 0, 0], [1, 1, 0.3]));
  } else if (kind === 'knife') {
    handle(0.1, 0.016);
    g.add(mesh(cone(0.025, 0.18, 4), iron, [0, -0.17, 0.0], [Math.PI, 0, 0], [1, 1, 0.25]));
  } else if (kind === 'saw') {
    // A wooden grip and a long toothed blade.
    g.add(mesh(new RoundedBoxGeometry(0.05, 0.12, 0.05, 2, 0.015), wood, [0, 0, 0]));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.36, 0.006), iron, [0.02, -0.24, 0]));
    for (let k = 0; k < 9; k++) g.add(mesh(cone(0.012, 0.025, 3), iron, [0.075, -0.1 - k * 0.035, 0], [0, 0, -Math.PI / 2], [1, 1, 0.3]));
  } else if (kind === 'needle') {
    g.add(mesh(cyl(0.004, 0.004, 0.16, 6), iron, [0, -0.08, 0]));
  } else if (kind === 'rod') {
    g.add(mesh(cyl(0.009, 0.02, 1.0, 8), wood, [0, -0.46, 0.08], [0.18, 0, 0]));
    g.add(mesh(torus(0.03, 0.01), iron, [0, -0.05, 0.03], [0, Math.PI / 2, 0]));
    g.userData.tip = V(0, -0.95, 0.17);
  } else if (kind === 'flint') {
    g.add(mesh(new THREE.DodecahedronGeometry(0.04), M.std('#6b6f75', { rough: 0.9 }), [0, -0.05, 0.03]));
  } else if (kind === 'pan') {
    handle(0.2, 0.014);
    g.add(mesh(cyl(0.11, 0.09, 0.03, 20), M.std('#2a2d33', { rough: 0.4, metal: 0.6 }), [0, -0.24, 0.08], [1.4, 0, 0]));
  } else if (kind === 'spoon') {
    handle(0.4, 0.012);
    g.add(mesh(sphere(0.035, 12, 8), wood, [0, -0.36, 0], [0, 0, 0], [1, 0.5, 1.3]));
  } else if (kind === 'tongs') {
    for (const x of [-0.015, 0.015]) g.add(mesh(cyl(0.008, 0.008, 0.4, 6), iron, [x, -0.2, 0.02]));
  }
  return g;
}

// What they work on. Returns { group, hit(t) (a little shake), top (loot height) }.
function buildProp(kind, M, emoji) {
  const g = new THREE.Group();
  let top = 0.55;
  const dispose = [];
  if (kind === 'rock') {
    g.add(mesh(new THREE.DodecahedronGeometry(0.26, 1), M.std('#8b8f96', { rough: 0.95 }), [0, 0.2, 0], [0.3, 0.5, 0], [1.2, 0.8, 1]));
    g.add(mesh(new THREE.DodecahedronGeometry(0.06, 0), M.std('#d08a4a', { rough: 0.4, metal: 0.4 }), [0.1, 0.33, 0.14]));
    top = 0.5;
  } else if (kind === 'tree') {
    g.add(mesh(cyl(0.08, 0.11, 0.9, 12), M.std('#7a5334', { rough: 0.9 }), [0, 0.45, 0]));
    for (const [y, r] of [[1.0, 0.36], [1.3, 0.28], [1.55, 0.18]]) g.add(mesh(sphere(r, 16, 12), M.std('#3f8a4a', { rough: 0.85 }), [0, y, 0]));
    top = 1.1;
  } else if (kind === 'water') {
    const water = mesh(new THREE.CircleGeometry(0.5, 40), M.std('#3a7fc2', { rough: 0.15, metal: 0.2, opacity: 0.85 }), [0, 0.01, 0], [-Math.PI / 2, 0, 0]);
    g.add(water);
    for (const r of [0.15, 0.3]) g.add(mesh(new THREE.RingGeometry(r, r + 0.01, 40), M.std('#bfe3ff', { opacity: 0.5 }), [0, 0.015, 0], [-Math.PI / 2, 0, 0]));
    top = 0.5;
  } else if (kind === 'dirt' || kind === 'crops') {
    g.add(mesh(sphere(0.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.std('#6b4226', { rough: 1 }), [0, 0, 0], [0, 0, 0], [1.2, 0.35, 1]));
    if (kind === 'crops') for (const [x, z] of [[-0.12, 0], [0.05, 0.08], [0.12, -0.06]]) g.add(mesh(cone(0.03, 0.3, 6), M.std('#e0bd4a'), [x, 0.2, z]));
    else g.add(mesh(cone(0.02, 0.12, 6), M.std('#5aa84a'), [0.02, 0.14, 0.02]));
    top = 0.45;
  } else if (kind === 'fire' || kind === 'furnace' || kind === 'cauldron') {
    if (kind === 'furnace') g.add(mesh(new RoundedBoxGeometry(0.4, 0.5, 0.36, 3, 0.04), M.std('#6f6a66', { rough: 0.95 }), [0, 0.25, 0]));
    else for (let i = 0; i < 3; i++) g.add(mesh(cyl(0.035, 0.035, 0.36, 8), M.std('#6b4226'), [0, 0.04, 0], [Math.PI / 2, (i * Math.PI) / 3, 0]));
    const flameY = kind === 'furnace' ? 0.18 : 0.12;
    const flame = new THREE.Group();
    flame.position.set(0, flameY, kind === 'furnace' ? 0.13 : 0);
    for (const [r, h, c, o] of [[0.11, 0.3, '#ff4a1a', 0.75], [0.075, 0.24, '#ff9a2a', 0.9], [0.04, 0.16, '#ffe27a', 1]]) {
      const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, toneMapped: false, depthWrite: false });
      flame.add(mesh(cone(r, h, 12), m, [0, h / 2, 0]));
      dispose.push(m);
    }
    g.add(flame);
    const light = new THREE.PointLight('#ff8a3a', 1.2, 1.5);
    light.position.set(0, 0.35, 0.2);
    g.add(light);
    if (kind === 'cauldron') {
      g.add(mesh(sphere(0.22, 24, 16, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), M.std('#2a2d33', { rough: 0.5, metal: 0.5, side: THREE.DoubleSide }), [0, 0.32, 0]));
      g.add(mesh(new THREE.CircleGeometry(0.19, 24), M.std('#8a4cc2', { emissive: '#8a4cc2', ei: 0.8 }), [0, 0.42, 0], [-Math.PI / 2, 0, 0]));
      top = 0.75;
    } else top = kind === 'furnace' ? 0.8 : 0.55;
    g.userData.flicker = (t) => {
      flame.scale.set(1 + Math.sin(t * 11) * 0.08, 1 + Math.sin(t * 7) * 0.15, 1);
      light.intensity = 1.1 + Math.sin(t * 13) * 0.25;
    };
  } else if (kind === 'anvil') {
    g.add(mesh(new RoundedBoxGeometry(0.16, 0.24, 0.16, 2, 0.02), M.metal('#4a4f57'), [0, 0.12, 0]));
    g.add(mesh(new RoundedBoxGeometry(0.4, 0.1, 0.18, 2, 0.02), M.metal('#5a6068'), [0, 0.29, 0]));
    g.add(mesh(new RoundedBoxGeometry(0.14, 0.03, 0.06, 2, 0.01), M.std('#ff8a3a', { emissive: '#ff5a1a', ei: 1.5 }), [0, 0.355, 0]));
    top = 0.6;
  } else if (kind === 'log') {
    g.add(mesh(cyl(0.08, 0.08, 0.45, 12), M.std('#8a5d36', { rough: 0.8 }), [0, 0.1, 0], [0, 0, Math.PI / 2]));
    top = 0.45;
  } else {
    const sp = emojiSprite(emoji || '👹', 0.6);
    sp.position.set(0, 0.42, 0);
    g.add(sp);
    dispose.push(sp.material.map, sp.material);
    top = 0.85;
  }
  g.userData.top = top;
  g.userData.dispose = dispose;
  return g;
}

// Adds the action to a built character: returns { group (props etc.), tick(t), frame: {target, dist} }.
function buildAction(char, action, M) {
  const { rig, group: who } = char;
  const kind = action.kind || 'action';
  const sk = SKILL_ACTIONS[action.skill === 'farming' && action.harvest ? 'harvest' : action.skill] || null;
  const motion = kind === 'action' || kind === 'rare' || kind === 'test' ? sk?.motion || 'wave' : KIND_MOTION[kind] || 'wave';
  const scene = new THREE.Group();
  const facing = motion === 'cheer' || motion === 'wave' || motion === 'fall' ? 0.25 : Math.PI / 2 - 0.55;
  who.rotation.y = facing;
  const fwd = V(Math.sin(facing), 0, Math.cos(facing));
  const withProp = !['cheer', 'wave', 'fall'].includes(motion);
  who.position.set(withProp ? -0.42 : 0, 0, 0);
  const [armR, armL] = [rig.arms[1].arm, rig.arms[-1].arm];

  // Tool: fights use their own weapon (or fists); skills swap it for the tool.
  let tool = null;
  const useWeapon = sk?.tool === 'weapon' || motion === 'attack';
  if (rig.weapon) rig.weapon.visible = useWeapon || !withProp;
  if (!useWeapon && sk?.tool && withProp) {
    tool = buildTool(sk.tool, M);
    tool.scale.setScalar(1.25);
    tool.position.copy(rig.arms[1].hand.position);
    armR.add(tool);
  }

  // The prop, in front of them.
  let prop = null;
  if (withProp) {
    const propKind = sk?.prop || 'emoji';
    prop = buildProp(propKind, M, action.target || sk?.emoji);
    const reach = motion === 'cast' ? 1.25 : motion === 'shoot' || motion === 'spell' ? 1.3 : sk?.tool === 'shovel' ? 0.85 : 0.72;
    prop.position.copy(who.position).addScaledVector(fwd, reach);
    scene.add(prop);
  }

  // Bits that fly off on each hit.
  const bits = [];
  if (withProp && sk?.bits) {
    for (let i = 0; i < 7; i++) {
      const b = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), M.std(sk.bits, { rough: 0.8 }));
      b.visible = false;
      scene.add(b);
      bits.push({ m: b, v: V(0, 0, 0) });
    }
  }
  const burst = (at) => {
    for (const b of bits) {
      b.m.visible = true;
      b.m.position.copy(at);
      b.v.set((Math.random() - 0.5) * 1.4, 1 + Math.random() * 1.2, (Math.random() - 0.5) * 1.4);
    }
  };

  // Loot pops up above the prop (or them).
  let loot = null;
  const disposables = [...(prop?.userData.dispose || [])];
  if (action.loot) {
    loot = emojiSprite(action.loot, 0.32);
    loot.visible = false;
    scene.add(loot);
    disposables.push(loot.material.map, loot.material);
  }
  const lootBase = prop ? prop.position.clone().setY(prop.userData.top + 0.1) : V(who.position.x, (who.userData.height || 1.8) + 0.15, 0);

  // Arrows and spells fly to the target.
  let shot = null;
  if (motion === 'shoot' || motion === 'spell') {
    shot = motion === 'shoot' ? mesh(cyl(0.006, 0.006, 0.4, 6), M.std('#d9c7a0'), [0, 0, 0], [0, 0, Math.PI / 2]) : mesh(sphere(0.06, 16, 12), M.std('#b58cf0', { emissive: '#9b6bff', ei: 2 }));
    shot.visible = false;
    scene.add(shot);
  }

  // Fishing line: rod tip to a bobber.
  let fishLine = null;
  let bobber = null;
  if (motion === 'cast' && tool?.userData.tip) {
    const geo = new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), V(0, 0, 0)]);
    fishLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#e8e8e8', transparent: true, opacity: 0.8 }));
    scene.add(fishLine);
    bobber = mesh(sphere(0.03, 12, 8), M.std('#e0453a'), prop.position.clone().setY(0.03).toArray());
    scene.add(bobber);
    disposables.push(geo, fishLine.material);
  }

  const period = { swing: 1.1, attack: 1.1, dig: 1.3, stab: 0.8, stir: 1.4, plant: 1.4, cast: 2.4, shoot: 1.6, spell: 1.8, cheer: 1.2, wave: 1.2, run: 0.5, fall: 99 }[motion] || 1.2;
  const baseX = { r: armR.rotation.x, l: armL.rotation.x };
  const baseZ = { r: armR.rotation.z, l: armL.rotation.z };
  let lastHit = -1;
  let hits = 0;
  const tmp = V(0, 0, 0);
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

  const tick = (t, dt) => {
    const cyc = Math.floor(t / period);
    const p = (t % period) / period;
    let hitNow = false;
    armR.rotation.z = baseZ.r;
    armL.rotation.z = baseZ.l;
    if (motion === 'swing' || motion === 'attack') {
      // Wind up overhead, strike down fast.
      const up = p < 0.6 ? ease(p / 0.6) : 1 - ease((p - 0.6) / 0.25 > 1 ? 1 : (p - 0.6) / 0.25);
      armR.rotation.x = -0.5 - 2.3 * up;
      hitNow = p > 0.83;
    } else if (motion === 'dig') {
      armR.rotation.x = -0.4 - Math.sin(p * Math.PI * 2) * 0.5;
      armL.rotation.x = -0.6 - Math.sin(p * Math.PI * 2) * 0.4;
      rig.body.position.y = -Math.abs(Math.sin(p * Math.PI)) * 0.04;
      hitNow = p > 0.2 && p < 0.3;
    } else if (motion === 'stab') {
      armR.rotation.x = -0.7 - Math.max(0, Math.sin(p * Math.PI * 2)) * 0.6;
      hitNow = p > 0.2 && p < 0.3;
    } else if (motion === 'stir') {
      armR.rotation.x = -1.0 + Math.sin(t * 4.5) * 0.15;
      armR.rotation.z = baseZ.r + Math.cos(t * 4.5) * 0.15;
      hitNow = p > 0.45 && p < 0.55;
    } else if (motion === 'plant') {
      rig.body.position.y = -0.06 - Math.sin(p * Math.PI) * 0.05;
      armR.rotation.x = -0.9 - Math.sin(p * Math.PI) * 0.4;
      armL.rotation.x = -0.6 - Math.sin(p * Math.PI) * 0.3;
      hitNow = p > 0.45 && p < 0.55;
    } else if (motion === 'cast') {
      const back = p < 0.25 ? ease(p / 0.25) : p < 0.4 ? 1 - ease((p - 0.25) / 0.15) : 0;
      armR.rotation.x = -0.8 - 1.6 * back;
      hitNow = p > 0.4 && p < 0.5;
    } else if (motion === 'shoot' || motion === 'spell') {
      armL.rotation.x = motion === 'shoot' ? -1.45 : baseX.l;
      armR.rotation.x = motion === 'shoot' ? -1.45 + (p < 0.5 ? 0.3 * ease(p / 0.5) : 0) : -1.2 - Math.sin(p * Math.PI) * 0.4;
      if (shot) {
        const f = p < 0.5 ? -1 : (p - 0.5) / 0.3;
        shot.visible = f >= 0 && f <= 1;
        if (shot.visible) {
          const from = who.position.clone().add(V(0, 1.05, 0)).addScaledVector(fwd, 0.35);
          const to = prop.position.clone().setY(0.45);
          shot.position.lerpVectors(from, to, f);
          if (motion === 'shoot') shot.rotation.set(0, facing - Math.PI / 2, Math.PI / 2);
        }
      }
      hitNow = p > 0.8;
    } else if (motion === 'cheer') {
      const j = Math.abs(Math.sin(p * Math.PI));
      who.position.y = j * 0.12;
      armR.rotation.x = -2.7 - j * 0.2;
      armL.rotation.x = -2.7 - j * 0.2;
      armR.rotation.z = baseZ.r + 0.35;
      armL.rotation.z = baseZ.l - 0.35;
      hitNow = p < 0.1;
    } else if (motion === 'wave') {
      armR.rotation.x = -2.6;
      armR.rotation.z = baseZ.r + 0.25 + Math.sin(t * 7) * 0.25;
    } else if (motion === 'run') {
      who.position.y = Math.abs(Math.sin(t * 12)) * 0.05;
      armR.rotation.x = Math.sin(t * 12) * 0.8;
      armL.rotation.x = -Math.sin(t * 12) * 0.8;
      rig.body.rotation.x = 0.12;
    } else if (motion === 'fall') {
      const f = Math.min(1, Math.max(0, (t - 0.8) / 0.6));
      who.rotation.x = -ease(f) * 1.45;
      who.position.y = ease(f) * 0.12;
      armR.rotation.x = -f * 2.4;
      armL.rotation.x = -f * 2.4;
    }
    if (hitNow && cyc !== lastHit) {
      lastHit = cyc;
      hits++;
      if (prop) {
        prop.userData.shakeAt = t;
        burst(prop.position.clone().setY(Math.min(prop.userData.top, 0.5)));
      } else if (motion === 'cheer') burst(V(who.position.x, (who.userData.height || 1.8) + 0.1, 0));
      if (loot && hits === (motion === 'cheer' ? 1 : 2)) loot.userData.at = t;
    }
    // Prop shake and flicker
    if (prop) {
      const since = t - (prop.userData.shakeAt ?? -9);
      prop.rotation.z = since < 0.25 ? Math.sin(since * 60) * 0.05 * (1 - since / 0.25) : 0;
      prop.userData.flicker?.(t);
    }
    for (const b of bits) {
      if (!b.m.visible) continue;
      b.v.y -= 4.5 * dt;
      b.m.position.addScaledVector(b.v, dt);
      b.m.rotation.x += dt * 8;
      if (b.m.position.y < 0) b.m.visible = false;
    }
    if (loot && loot.userData.at !== undefined) {
      const since = t - loot.userData.at;
      loot.visible = true;
      const pop = Math.min(1, since / 0.35);
      const s = 0.32 * (pop < 1 ? 0.3 + pop * 0.9 : 1 + Math.sin(since * 3) * 0.04);
      loot.scale.set(s, s, s);
      loot.position.copy(lootBase).add(V(0, pop * 0.25 + Math.sin(since * 2.2) * 0.03, 0));
    }
    if (fishLine) {
      tool.updateMatrixWorld(true);
      tmp.copy(tool.userData.tip);
      tool.localToWorld(tmp);
      scene.worldToLocal(tmp);
      bobber.position.y = 0.03 + Math.sin(t * 5) * 0.01 - (p > 0.7 && p < 0.8 ? 0.03 : 0);
      fishLine.geometry.setFromPoints([tmp.clone(), bobber.position.clone()]);
    }
  };

  // Frame the character and the prop together.
  const h = who.userData.height || 1.8;
  const cx = prop ? (who.position.x + prop.position.x) / 2 : who.position.x;
  const cz = prop ? (who.position.z + prop.position.z) / 2 : 0;
  return {
    group: scene,
    tick,
    frame: { target: V(cx, h * 0.5, cz), dist: Math.max(2.9, h * 2.05) + (prop ? 0.55 : 0) + (prop?.userData.top > 1 ? 0.5 : 0) },
    dispose: () => disposables.forEach((d) => d.dispose?.()),
  };
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

// Mounts a viewer in `el` (sized by CSS). opts: { autoRotate, controls, view: 'head',
// action: { skill, kind, target, loot, harvest } (the character doing it, for the stream overlay),
// zoom (camera distance multiplier for action scenes) }.
export function mount(el, appearance, opts = {}) {
  const { action = null } = opts;
  const autoRotate = action ? false : opts.autoRotate ?? true;
  const withControls = action ? false : opts.controls ?? true;
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
  if (!action) scene.add(ground);
  const shadowTex = radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  scene.add(shadow);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.8, 64), new THREE.MeshBasicMaterial({ color: '#53fc18', transparent: true, opacity: 0.35 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.003;
  if (!action) scene.add(ring);

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
  let act = null;
  const frame = () => {
    if (act) {
      const { target } = act.frame;
      const dist = act.frame.dist * (opts.zoom || 1);
      camera.position.set(target.x + dist * 0.12, target.y + 0.35 * (opts.zoom || 1), dist);
      camera.lookAt(target);
      return;
    }
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
    if (act) {
      scene.remove(act.group);
      disposeGroup(act.group);
      act.dispose();
      act = null;
    }
    char = buildCharacter(app, M);
    scene.add(char.group);
    if (action) {
      act = buildAction(char, action, M);
      scene.add(act.group);
    }
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
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    char?.tick(t);
    act?.tick(t, dt);
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
      if (act) {
        disposeGroup(act.group);
        act.dispose();
      }
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
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
