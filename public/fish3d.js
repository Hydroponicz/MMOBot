// 3D fish for the Fishing page: every species is built in three.js from its look (src/game/fish.js):
// a body shaped for its kind (fish, billfish, shark, eel, serpent, ray, squid, octopus, shrimp,
// lobster, angler, whale), a painted skin (belly to back gradient, spots, bars, sheen), fins, eyes
// and extras (bills, claws, tentacles, lures). The model is built one unit long and scaled to the
// catch's real length in metres, next to a ruler (and a person, for the big ones).
//   const { mount, thumb } = await import('/fish3d.js');
//   const view = mount(el, { look, length, name }, { controls, autoRotate, splash });  view.dispose();
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function supported() {
  try {
    return !!(window.WebGL2RenderingContext && document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const col = (c) => new THREE.Color(c);
const hash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// ---- Skin: a canvas painted per species. u runs tail -> head, v runs round the body (0 = belly,
// 0.5 = back), so the seam sits under the belly where it can't be seen.
function paintSkin(look, W = 512, H = 256) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const top = col(look.top);
  const belly = col(look.belly);
  // Round the body: belly (v=0) -> side -> back (v=0.5) -> side -> belly (v=1).
  const grad = g.createLinearGradient(0, 0, 0, H);
  const mix = (t) => `#${belly.clone().lerp(top, t).getHexString()}`;
  grad.addColorStop(0, mix(0));
  grad.addColorStop(0.1, mix(0.08));
  grad.addColorStop(0.2, mix(0.6));
  grad.addColorStop(0.28, mix(0.92));
  grad.addColorStop(0.5, mix(1));
  grad.addColorStop(0.72, mix(0.92));
  grad.addColorStop(0.8, mix(0.6));
  grad.addColorStop(0.9, mix(0.08));
  grad.addColorStop(1, mix(0));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Fine scale texture.
  g.globalAlpha = 0.035;
  for (let y = 0; y < H; y += 6) {
    for (let x = (y / 6) % 2 ? 3 : 0; x < W; x += 6) {
      g.fillStyle = hash(x, y) > 0.5 ? '#ffffff' : '#000000';
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  const accent = look.accent || '#222';
  const p = look.pattern;
  if (p === 'spots') {
    g.fillStyle = accent;
    for (let i = 0; i < 180; i++) {
      const x = hash(i, 1) * W;
      const y = H * (0.28 + hash(i, 2) * 0.44);
      const r = 2 + hash(i, 3) * 4;
      g.globalAlpha = 0.55 + hash(i, 4) * 0.4;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  if (p === 'bars') {
    g.fillStyle = accent;
    g.globalAlpha = 0.55;
    for (let i = 0; i < 14; i++) g.fillRect(W * (0.12 + i * 0.055), H * 0.3, W * 0.012, H * 0.4);
    g.globalAlpha = 1;
  }
  if (p === 'finlets') {
    g.fillStyle = accent;
    for (let i = 0; i < 7; i++) {
      g.fillRect(W * (0.08 + i * 0.035), H * 0.47, W * 0.014, H * 0.06);
    }
  }
  if (p === 'sheen' || p === 'spots' || p === 'bars') {
    // The lateral line: a bright streak along each side.
    const sheen = look.pattern === 'sheen' ? accent : '#ffffff';
    for (const yy of [0.3, 0.7]) {
      const lg = g.createLinearGradient(0, H * (yy - 0.05), 0, H * (yy + 0.05));
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, sheen);
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalAlpha = look.pattern === 'sheen' ? 0.55 : 0.18;
      g.fillStyle = lg;
      g.fillRect(0, H * (yy - 0.05), W, H * 0.1);
    }
    g.globalAlpha = 1;
  }
  if (look.stripe) {
    // Rainbow trout's pink band.
    g.fillStyle = look.stripe;
    g.globalAlpha = 0.5;
    g.fillRect(0, H * 0.26, W, H * 0.07);
    g.fillRect(0, H * 0.67, W, H * 0.07);
    g.globalAlpha = 1;
  }
  if (look.stars) {
    for (let i = 0; i < 260; i++) {
      g.fillStyle = hash(i, 9) > 0.7 ? look.accent : '#ffffff';
      g.globalAlpha = 0.4 + hash(i, 8) * 0.6;
      g.beginPath();
      g.arc(hash(i, 5) * W, H * (0.2 + hash(i, 6) * 0.6), 0.6 + hash(i, 7) * 1.6, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A body of revolution along x (tail at -0.5, head at +0.5): radius(t) for t = 0 (tail) .. 1 (head),
// squashed to height h and width w. UVs follow paintSkin.
function bodyGeo(profile, h, w, segs = 72, rings = 40) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const r = profile(t);
    for (let j = 0; j <= rings; j++) {
      const a = (j / rings) * Math.PI * 2 - Math.PI / 2; // start at the belly
      pos.push(t - 0.5, Math.sin(a) * r * h, Math.cos(a) * r * w);
      uv.push(t, j / rings);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < rings; j++) {
      const a = i * (rings + 1) + j;
      const b = a + rings + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Fish-like profile: blunt head, full shoulders, a thin tail wrist.
// Deepest at `peak` (60% of the way to the head), a rounded head (blunter with a bigger `nose`)
// and a thin tail wrist.
const fishProfile = (nose = 0.35, wrist = 0.1, peak = 0.55) => (t) => {
  if (t >= 1) return 0;
  if (t < peak) return wrist + (1 - wrist) * Math.pow(Math.sin((Math.PI / 2) * (t / peak)), 1.3);
  const k = (t - peak) / (1 - peak);
  // Bigger nose = blunter head; small = a pointed snout.
  return Math.pow(Math.max(0, 1 - Math.pow(k, 1.4 + nose * 2)), 0.62);
};

// A flat fin from points (x, y) in the xy plane, both sides visible.
function fin(points, m, z = 0) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ShapeGeometry(s, 12);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.z = z;
  return mesh;
}

// A tube along a curve with a radius that changes along it.
function taperTube(curve, r0, r1, m, segs = 60, radial = 14) {
  const geo = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = geo.attributes.position;
  const frames = curve.computeFrenetFrames(segs, false);
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const r = r0 + (r1 - r0) * t;
    const c = curve.getPointAt(t);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
  }
  void frames;
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, m);
}

// A fish eye: a gold (or glowing) iris ring round a big glossy black pupil, set into the head.
function eye(r, look, glow = null) {
  const g = new THREE.Group();
  const iris = new THREE.MeshStandardMaterial({ color: glow ? glow : '#c9a24a', roughness: 0.35, metalness: 0.3, emissive: glow ? col(glow) : col('#000'), emissiveIntensity: glow ? 1.2 : 0 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), iris);
  ball.scale.z = 0.55;
  g.add(ball);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.68, 14, 10), new THREE.MeshPhysicalMaterial({ color: '#050507', roughness: 0.05, clearcoat: 1 }));
  pupil.scale.z = 0.5;
  pupil.position.z = r * 0.12;
  g.add(pupil);
  void look;
  return g;
}

function materials(look) {
  const skin = paintSkin(look);
  const fishy = new THREE.MeshPhysicalMaterial({ map: skin, roughness: 0.38, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.25, sheen: 0.4, sheenColor: col('#ffffff') });
  if (look.glow) {
    fishy.emissive = col(look.glow);
    fishy.emissiveIntensity = 0.18;
    fishy.metalness = 0.6;
  }
  const finM = new THREE.MeshStandardMaterial({ color: look.fin, roughness: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 0.88 });
  const solid = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, ...o });
  return { skin, fishy, finM, solid, all: [skin, fishy, finM] };
}

// ---- Builders: each returns { group, tail (animated), disposables } one unit long along x.
function buildFish(look, M) {
  const g = new THREE.Group();
  const kind = look.body || 'normal';
  const [h, w, nose] = { slim: [0.16, 0.08, 0.45], normal: [0.2, 0.1, 0.38], torpedo: [0.22, 0.17, 0.28], deep: [0.32, 0.12, 0.3] }[kind];
  g.add(new THREE.Mesh(bodyGeo(fishProfile(nose), h, w), M.fishy));
  const H = h * 1.25; // tallest point, roughly
  // Tail fin (forked for fast swimmers).
  const tail = new THREE.Group();
  tail.position.x = -0.49;
  const fork = kind === 'torpedo' ? 0.26 : kind === 'slim' ? 0.18 : 0.14;
  tail.add(fin(kind === 'deep' && look.lobed ? [[0, 0], [-0.12, H * 0.9], [-0.2, H * 0.4], [-0.16, 0], [-0.2, -H * 0.4], [-0.12, -H * 0.9]] : [[0, 0], [-fork * 0.7, H * 1.1], [-fork, H * 1.05], [-fork * 0.45, 0], [-fork, -H * 1.05], [-fork * 0.7, -H * 1.1]], M.finM));
  g.add(tail);
  // Dorsal, anal, pectoral and pelvic fins.
  const top = (x) => fishProfile(nose)(x + 0.5) * h;
  g.add(fin([[0.05, top(0.05) * 0.9], [-0.02, top(0) + H * 0.55], [-0.2, top(-0.2) + H * 0.2], [-0.24, top(-0.24) * 0.85]], M.finM));
  g.add(fin([[-0.14, -top(-0.14) * 0.9], [-0.22, -top(-0.22) - H * 0.35], [-0.3, -top(-0.3) * 0.8]], M.finM));
  for (const s of [-1, 1]) {
    const pec = fin([[0, 0], [-0.1, -0.05], [-0.07, 0.02]], M.finM);
    pec.position.set(0.22, -h * 0.25, s * w * 0.9);
    pec.rotation.y = s * 0.5;
    g.add(pec);
  }
  if (look.lobed) {
    for (const s of [-1, 1]) {
      const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), M.solid(look.fin));
      lobe.scale.set(1.6, 0.6, 0.4);
      lobe.position.set(0.05, -h * 0.9, s * w * 0.6);
      g.add(lobe);
    }
  }
  // Eyes and a mouth line.
  for (const s of [-1, 1]) {
    // On the surface of the head, a little above the middle.
    const prof = fishProfile(nose)(0.9);
    const e = eye(h * 0.1, look);
    e.position.set(0.4, h * prof * 0.3, s * w * prof * 0.97);
    e.rotation.y = s > 0 ? 0.2 : Math.PI - 0.2;
    g.add(e);
  }
  if (look.hook) {
    // A salmon's hooked jaw.
    const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 8), M.solid(look.top));
    jaw.position.set(0.49, -h * 0.25, 0);
    jaw.rotation.z = -1.1;
    g.add(jaw);
  }
  // Tuna finlets are painted; a little keel on the wrist for torpedoes.
  return { group: g, tail };
}

function buildBillfish(look, M) {
  const f = buildFish({ ...look, body: 'torpedo' }, M);
  const bill = new THREE.Mesh(new THREE.ConeGeometry(look.bill === 'sword' ? 0.02 : 0.012, 0.36, 12), M.solid(look.fin, { roughness: 0.3, metalness: 0.2 }));
  if (look.bill === 'sword') bill.scale.z = 0.35;
  bill.rotation.z = -Math.PI / 2;
  bill.position.set(0.66, 0, 0);
  f.group.add(bill);
  if (look.sail) {
    f.group.add(fin([[0.28, 0.17], [0.2, 0.42], [-0.05, 0.36], [-0.25, 0.2], [-0.28, 0.12]], M.finM));
  }
  f.group.scale.x = 0.8; // the bill counts toward the length
  f.group.position.x = -0.1;
  return f;
}

function buildShark(look, M) {
  const g = new THREE.Group();
  const h = 0.16;
  const w = 0.13;
  const profile = (t) => (t > 0.999 ? 0 : Math.sin(Math.PI * Math.pow(t, 0.72)) * Math.pow(1 - t, 0.22) * 1.1);
  g.add(new THREE.Mesh(bodyGeo(profile, h, w), M.fishy));
  const tail = new THREE.Group();
  tail.position.x = -0.48;
  tail.add(fin([[0, 0.01], [-0.1, 0.24], [-0.16, 0.24], [-0.08, 0.02], [-0.1, -0.12], [-0.05, -0.12]], M.solid(look.fin, { side: THREE.DoubleSide })));
  g.add(tail);
  g.add(fin([[0.08, h * 0.95], [-0.02, h + 0.2], [-0.07, h + 0.19], [-0.08, h * 0.85]], M.solid(look.fin, { side: THREE.DoubleSide })));
  for (const s of [-1, 1]) {
    const pec = fin([[0, 0], [-0.18, -0.16], [-0.12, -0.02]], M.solid(look.fin, { side: THREE.DoubleSide }));
    pec.position.set(0.18, -h * 0.5, s * w * 0.8);
    pec.rotation.x = s * 0.5;
    g.add(pec);
    const e = eye(0.012, look);
    e.position.set(0.4, h * 0.25, s * w * 0.55);
    e.rotation.y = s > 0 ? 0.3 : Math.PI - 0.3;
    g.add(e);
    // Gill slits.
    for (let k = 0; k < 5; k++) {
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.07, 0.004), M.solid('#2a3036'));
      slit.position.set(0.28 - k * 0.022, 0, s * w * 0.93);
      g.add(slit);
    }
  }
  return { group: g, tail };
}

function buildEel(look, M, serpent = false) {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(V(t - 0.5, Math.sin(t * Math.PI * (serpent ? 2.2 : 1.6)) * (serpent ? 0.08 : 0.04), Math.cos(t * Math.PI * 1.4) * (serpent ? 0.06 : 0.03)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const r = serpent ? 0.055 : 0.04;
  const body = taperTube(curve, r * 0.15, r, M.fishy, 90, 16);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(r * 1.25, 18, 14), M.fishy);
  head.scale.set(1.7, 0.9, 1);
  head.position.copy(curve.getPointAt(1));
  g.add(head);
  // A ridge fin along the back.
  for (let i = 2; i < 40; i++) {
    const t = i / 40;
    const p = curve.getPointAt(t);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(r * (serpent ? 0.35 : 0.2), r * (serpent ? 1.4 : 0.9), 6), M.solid(look.fin, serpent && look.accent ? { emissive: col(look.accent), emissiveIntensity: 0.25 } : {}));
    spike.position.copy(p).add(V(0, r * (0.3 + t * 0.7), 0));
    g.add(spike);
  }
  const hp = curve.getPointAt(1);
  for (const s of [-1, 1]) {
    const e = eye(r * 0.28, look, serpent || look.accent ? look.accent : null);
    e.position.set(hp.x + r * 0.9, hp.y + r * 0.45, hp.z + s * r * 0.75);
    e.rotation.y = s > 0 ? 0.3 : Math.PI - 0.3;
    g.add(e);
    if (serpent && look.horns) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(r * 0.25, r * 1.8, 8), M.solid('#e8e0d0'));
      horn.position.set(hp.x - r * 0.3, hp.y + r * 1.1, hp.z + s * r * 0.6);
      horn.rotation.set(s * 0.35, 0, 0.6);
      g.add(horn);
    }
  }
  if (serpent) {
    // Whiskers.
    for (const s of [-1, 1]) {
      const wc = new THREE.CatmullRomCurve3([V(hp.x + r * 1.6, hp.y - r * 0.2, hp.z + s * r * 0.4), V(hp.x + r * 2.4, hp.y - r * 0.5, hp.z + s * r * 1.5), V(hp.x + r * 2.2, hp.y - r * 1.4, hp.z + s * r * 2.4)]);
      g.add(taperTube(wc, r * 0.12, r * 0.02, M.solid(look.fin), 20, 6));
    }
  }
  return { group: g, tail: null, wiggle: body };
}

function buildRay(look, M) {
  const g = new THREE.Group();
  // Wings: a flattened diamond; "length" is the wingspan, so the body lies across x.
  const s = new THREE.Shape();
  s.moveTo(0.22, 0);
  s.quadraticCurveTo(0.1, 0.22, -0.02, 0.5);
  s.quadraticCurveTo(-0.08, 0.2, -0.2, 0);
  s.quadraticCurveTo(-0.08, -0.2, -0.02, -0.5);
  s.quadraticCurveTo(0.1, -0.22, 0.22, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 4, curveSegments: 24 });
  geo.rotateX(Math.PI / 2);
  const wings = new THREE.Mesh(geo, M.solid(look.top, { roughness: 0.6 }));
  g.add(wings);
  const belly = wings.clone();
  belly.material = M.solid(look.belly);
  belly.scale.y = 0.4;
  belly.position.y = -0.03;
  g.add(belly);
  // Horn-like head fins, eyes, and a thin tail.
  for (const k of [-1, 1]) {
    const cf = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 0.03), M.solid(look.fin));
    cf.position.set(0.25, 0, k * 0.07);
    cf.rotation.y = -k * 0.3;
    g.add(cf);
    const e = eye(0.012, look);
    e.position.set(0.2, 0.02, k * 0.09);
    g.add(e);
  }
  const tc = new THREE.CatmullRomCurve3([V(-0.18, 0, 0), V(-0.35, 0.01, 0.02), V(-0.55, 0.03, -0.02)]);
  g.add(taperTube(tc, 0.012, 0.002, M.solid(look.fin), 30, 8));
  g.rotation.y = Math.PI / 2; // wingspan along x
  const wrap = new THREE.Group();
  wrap.add(g);
  wrap.rotation.x = 0.95; // banked, so you see its back
  return { group: wrap, tail: null, flap: g };
}

function buildSquid(look, M, octo = false) {
  const g = new THREE.Group();
  const skin = M.solid(look.top, { roughness: 0.45, clearcoat: 0.6 });
  const mantle = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), new THREE.MeshPhysicalMaterial({ color: look.top, roughness: 0.4, clearcoat: 0.7 }));
  if (octo) {
    mantle.scale.set(0.14, 0.13, 0.13);
    mantle.position.set(0.28, 0.06, 0);
  } else {
    mantle.scale.set(0.2, 0.06, 0.06);
    mantle.position.set(0.3, 0, 0);
  }
  g.add(mantle);
  if (!octo) {
    for (const s of [-1, 1]) {
      const f = fin([[0, 0], [0.05, 0.1], [0.14, 0.02]], new THREE.MeshStandardMaterial({ color: look.fin, side: THREE.DoubleSide }));
      f.rotation.x = Math.PI / 2;
      f.position.set(0.38, 0, s * 0.03);
      f.scale.z = s;
      if (s < 0) f.rotation.x = -Math.PI / 2;
      g.add(f);
    }
  }
  const headX = octo ? 0.16 : 0.1;
  for (const s of [-1, 1]) {
    const e = eye(octo ? 0.022 : 0.018, look);
    e.position.set(headX + 0.02, octo ? 0.02 : 0.02, s * (octo ? 0.07 : 0.045));
    e.rotation.y = s > 0 ? 0 : Math.PI;
    g.add(e);
  }
  // Arms: curling tubes trailing back (-x).
  const arms = octo ? 8 : 8;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2;
    const len = octo ? 0.62 : 0.4;
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const spread = (octo ? 0.09 : 0.03) * (0.4 + t);
      const curl = octo ? Math.sin(t * 3 + i) * 0.05 * t : 0;
      pts.push(V(headX - t * len, Math.sin(a) * spread + curl, Math.cos(a) * spread + curl * 0.5));
    }
    g.add(taperTube(new THREE.CatmullRomCurve3(pts), octo ? 0.022 : 0.012, 0.002, skin, 36, 8));
  }
  if (!octo) {
    // Two long feeding tentacles with clubs.
    for (const s of [-1, 1]) {
      const pts = [V(headX, 0, s * 0.01), V(headX - 0.3, 0.02, s * 0.04), V(-0.45, -0.01, s * 0.03), V(-0.6, 0.01, s * 0.05)];
      g.add(taperTube(new THREE.CatmullRomCurve3(pts), 0.006, 0.004, skin, 40, 6));
      const club = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), skin);
      club.scale.set(2.2, 0.6, 1);
      club.position.set(-0.6, 0.01, s * 0.05);
      g.add(club);
    }
  }
  return { group: g, tail: null };
}

function buildCrustacean(look, M, lobster = false) {
  const g = new THREE.Group();
  const shell = new THREE.MeshPhysicalMaterial({ color: look.top, roughness: 0.35, clearcoat: 0.9 });
  const under = M.solid(look.belly);
  // Segmented body along a gentle curve (shrimp curl more).
  const n = lobster ? 7 : 8;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = (lobster ? 0.07 : 0.065) * (1 - t * 0.55) * (i === 0 ? 1.15 : 1);
    const seg = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), shell);
    const bend = lobster ? t * 0.1 : Math.sin(t * Math.PI * 0.9) * 0.14;
    seg.scale.set(r * 1.6, r * 0.9, r);
    seg.position.set(0.3 - t * 0.62, -bend, 0);
    g.add(seg);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.003, 0.06, 5), under);
    if (i > 0 && i < 5) {
      for (const s of [-1, 1]) {
        const l = leg.clone();
        l.position.set(seg.position.x, seg.position.y - r * 0.8, s * r * 0.6);
        l.rotation.x = s * 0.4;
        g.add(l);
      }
    }
  }
  // Tail fan.
  const tail = new THREE.Group();
  tail.position.set(-0.34, lobster ? -0.1 : -0.02, 0);
  for (let k = -2; k <= 2; k++) {
    const blade = fin([[0, 0], [-0.08, 0.025], [-0.09, -0.025]], new THREE.MeshStandardMaterial({ color: look.fin, side: THREE.DoubleSide }));
    blade.rotation.x = Math.PI / 2;
    blade.rotation.z = k * 0.3;
    tail.add(blade);
  }
  g.add(tail);
  // Head: antennae and eyes (and claws for a lobster).
  for (const s of [-1, 1]) {
    const ant = new THREE.CatmullRomCurve3([V(0.36, 0.02, s * 0.02), V(0.44, 0.1, s * 0.08), V(0.4, 0.12, s * 0.2), V(0.28, 0.1, s * 0.3)]);
    g.add(taperTube(ant, 0.004, 0.001, M.solid(look.fin), 30, 5));
    const e = eye(0.012, look);
    e.position.set(0.38, 0.045, s * 0.03);
    g.add(e);
    if (lobster) {
      const arm = new THREE.CatmullRomCurve3([V(0.3, -0.02, s * 0.05), V(0.4, -0.02, s * 0.12), V(0.5, -0.01, s * 0.14)]);
      g.add(taperTube(arm, 0.02, 0.016, shell, 20, 8));
      const claw = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), shell);
      claw.scale.set(0.1, 0.035, 0.05);
      claw.position.set(0.6, -0.01, s * 0.14);
      claw.rotation.y = -s * 0.2;
      g.add(claw);
      const pincer = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.1, 8), shell);
      pincer.rotation.z = -Math.PI / 2;
      pincer.position.set(0.72, 0.01, s * 0.15);
      g.add(pincer);
    }
  }
  g.scale.setScalar(lobster ? 0.72 : 0.8);
  return { group: g, tail };
}

function buildAngler(look, M) {
  const g = new THREE.Group();
  const h = 0.36;
  const w = 0.3;
  const profile = (t) => (t > 0.999 ? 0.02 : Math.sin(Math.PI * Math.pow(t, 0.55)) * (0.4 + t * 0.6));
  g.add(new THREE.Mesh(bodyGeo(profile, h, w), M.fishy));
  const tail = new THREE.Group();
  tail.position.x = -0.49;
  tail.add(fin([[0, 0], [-0.12, 0.12], [-0.14, -0.1]], M.finM));
  g.add(tail);
  // A huge mouth full of needle teeth.
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 8, 24, Math.PI), M.solid('#1a1210'));
  mouth.rotation.set(0, Math.PI / 2, Math.PI);
  mouth.position.set(0.47, -0.02, 0);
  g.add(mouth);
  const tooth = M.solid('#f2eee0', { roughness: 0.2 });
  for (let i = 0; i < 12; i++) {
    const a = Math.PI * (i / 11);
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.05, 6), tooth);
    t.position.set(0.48, -0.02 - Math.sin(a) * 0.1, Math.cos(a) * 0.12);
    t.rotation.z = Math.PI;
    g.add(t);
  }
  // The lure.
  const stalk = new THREE.CatmullRomCurve3([V(0.28, 0.3, 0), V(0.45, 0.44, 0), V(0.62, 0.38, 0), V(0.66, 0.26, 0)]);
  g.add(taperTube(stalk, 0.008, 0.004, M.solid(look.fin), 30, 6));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshStandardMaterial({ color: look.accent, emissive: col(look.accent), emissiveIntensity: 2.5 }));
  bulb.position.set(0.66, 0.24, 0);
  g.add(bulb);
  const light = new THREE.PointLight(look.accent, 0.8, 1.5);
  light.position.copy(bulb.position);
  g.add(light);
  for (const s of [-1, 1]) {
    const e = eye(0.022, look);
    e.position.set(0.32, 0.16, s * 0.12);
    e.rotation.y = s > 0 ? 0.3 : Math.PI - 0.3;
    g.add(e);
  }
  return { group: g, tail };
}

function buildWhale(look, M) {
  const g = new THREE.Group();
  const profile = (t) => (t > 0.999 ? 0 : Math.sin(Math.PI * Math.pow(t, 0.62)) * Math.pow(1 - t, 0.12));
  g.add(new THREE.Mesh(bodyGeo(profile, 0.17, 0.16), M.fishy));
  const tail = new THREE.Group();
  tail.position.x = -0.49;
  const fluke = fin([[0, 0], [-0.06, 0.2], [-0.13, 0.22], [-0.07, 0], [-0.13, -0.22], [-0.06, -0.2]], M.solid(look.fin, { side: THREE.DoubleSide }));
  fluke.rotation.x = Math.PI / 2;
  tail.add(fluke);
  g.add(tail);
  for (const s of [-1, 1]) {
    const flip = fin([[0, 0], [-0.1, -0.02], [-0.2, -0.05], [-0.06, 0.02]], M.solid(look.fin, { side: THREE.DoubleSide }));
    flip.position.set(0.18, -0.08, s * 0.14);
    flip.rotation.x = s * 1.1;
    g.add(flip);
    const e = eye(0.012, look);
    e.position.set(0.33, -0.02, s * 0.12);
    e.rotation.y = s > 0 ? 0.3 : Math.PI - 0.3;
    g.add(e);
  }
  return { group: g, tail, whale: true };
}

const BUILDERS = {
  fish: buildFish,
  billfish: buildBillfish,
  shark: buildShark,
  eel: (l, M) => buildEel(l, M, false),
  serpent: (l, M) => buildEel(l, M, true),
  ray: buildRay,
  squid: (l, M) => buildSquid(l, M, false),
  octopus: (l, M) => buildSquid(l, M, true),
  shrimp: (l, M) => buildCrustacean(l, M, false),
  lobster: (l, M) => buildCrustacean(l, M, true),
  angler: buildAngler,
  whale: buildWhale,
};

// The model, one unit long, head toward +x.
export function buildFishModel(look) {
  const M = materials(look);
  const b = (BUILDERS[look.shape] || buildFish)(look, M);
  const disposables = [...M.all];
  b.group.traverse((o) => {
    if (o.geometry) disposables.push(o.geometry);
    if (o.material && !disposables.includes(o.material)) disposables.push(o.material);
  });
  // Normalise to exactly one unit along x, centred.
  const box = new THREE.Box3().setFromObject(b.group);
  const size = box.getSize(V(0, 0, 0));
  const center = box.getCenter(V(0, 0, 0));
  const holder = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(b.group);
  inner.position.set(-center.x, -center.y, -center.z);
  holder.add(inner);
  holder.scale.setScalar(1 / Math.max(0.001, size.x));
  return { object: holder, tail: b.tail, flap: b.flap, wiggle: b.wiggle, dispose: () => disposables.forEach((d) => d.dispose?.()) };
}

// A simple person silhouette, 1.8 m tall, for scale.
function person(M) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: '#8a96a8', roughness: 0.8, transparent: true, opacity: 0.55 });
  M.push(m);
  const add = (geo, x, y, z = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    g.add(o);
    M.push(geo);
  };
  add(new THREE.SphereGeometry(0.11, 16, 12), 0, 1.66);
  add(new THREE.CapsuleGeometry(0.17, 0.5, 6, 12), 0, 1.18);
  for (const s of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.065, 0.72, 4, 8), s * 0.1, 0.46);
    add(new THREE.CapsuleGeometry(0.05, 0.55, 4, 8), s * 0.26, 1.12);
  }
  return g;
}

// A ruler under the fish with ticks at a sensible step and labels.
function ruler(lengthM, D) {
  const g = new THREE.Group();
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
  const step = steps.find((s) => lengthM / s <= 8) || 10;
  const total = Math.ceil((lengthM * 1.05) / step) * step;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(total, total * 0.012, total * 0.03), new THREE.MeshStandardMaterial({ color: '#e8dcb0', roughness: 0.6 }));
  bar.position.x = total / 2;
  g.add(bar);
  D.push(bar.geometry, bar.material);
  const tickM = new THREE.MeshBasicMaterial({ color: '#3a3020' });
  D.push(tickM);
  const label = (text, x) => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 48;
    const x2 = c.getContext('2d');
    x2.fillStyle = '#e8eef6';
    x2.font = 'bold 30px system-ui, sans-serif';
    x2.textAlign = 'center';
    x2.fillText(text, 64, 36);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set(total * 0.12, total * 0.045, 1);
    sp.position.set(x, -total * 0.05, 0);
    g.add(sp);
    D.push(tex, sp.material);
  };
  const fmt = (m) => (m >= 1 ? `${+m.toFixed(1)} m` : `${Math.round(m * 100)} cm`);
  for (let v = 0; v <= total + 1e-9; v += step) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(total * 0.004, total * 0.03, total * 0.032), tickM);
    t.position.set(v, total * 0.012, 0);
    g.add(t);
    D.push(t.geometry);
    label(fmt(v), v);
  }
  return { group: g, total };
}

// Interactive viewer: the fish at its real size over a ruler, turntable + orbit/pan/zoom.
export function mount(el, fish, opts = {}) {
  const { controls: withControls = true, autoRotate = true, splash = false } = opts;
  const lengthM = Math.max(0.01, (fish.length || 30) / 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.className = 'fish3d-canvas';
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.7;
  scene.add(new THREE.HemisphereLight('#cfe8ff', '#0a2030', 1.2));
  const sun = new THREE.DirectionalLight('#fff4de', 2.2);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const rim = new THREE.DirectionalLight('#7ad0ff', 1.4);
  rim.position.set(-3, 1, -2);
  scene.add(rim);

  const D = [];
  const model = buildFishModel(fish.look);
  model.object.scale.multiplyScalar(lengthM);
  const swim = new THREE.Group();
  swim.add(model.object);
  scene.add(swim);
  const r = ruler(lengthM, D);
  const stage = new THREE.Group();
  const fishBox = new THREE.Box3().setFromObject(swim);
  const fishH = fishBox.getSize(V(0, 0, 0)).y;
  r.group.position.set(-lengthM / 2, -fishH / 2 - lengthM * 0.12, 0);
  stage.add(r.group);
  // A person for scale once the fish is long enough to stand next to.
  if (lengthM >= 0.8) {
    const p = person(D);
    p.position.set(-lengthM / 2 - 0.5, r.group.position.y, -0.2);
    stage.add(p);
  }
  scene.add(stage);

  // Frame everything.
  const all = new THREE.Box3().setFromObject(scene);
  const size = all.getSize(V(0, 0, 0));
  const center = all.getCenter(V(0, 0, 0));
  const aspect = (el.clientWidth || 400) / (el.clientHeight || 260);
  const fov = 32;
  const fitH = size.y / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
  const fitW = size.x / 2 / Math.tan(((fov / 2) * Math.PI) / 180) / aspect;
  const dist = Math.max(fitH, fitW) * 1.15 + size.z;
  const camera = new THREE.PerspectiveCamera(fov, aspect, dist / 500, dist * 20);
  const HOME = center.clone().add(V(dist * 0.25, dist * 0.18, dist));
  camera.position.copy(HOME);
  camera.lookAt(center);
  let controls = null;
  if (withControls) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.minDistance = dist * 0.08;
    controls.maxDistance = dist * 4;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.2;
    let resume = null;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      clearTimeout(resume);
    });
    controls.addEventListener('end', () => {
      clearTimeout(resume);
      if (autoRotate) resume = setTimeout(() => (controls.autoRotate = true), 6000);
    });
    renderer.domElement.addEventListener('dblclick', () => {
      camera.position.copy(HOME);
      controls.target.copy(center);
      if (autoRotate) controls.autoRotate = true;
    });
  }

  const resize = () => {
    const w = el.clientWidth || 400;
    const h = el.clientHeight || 260;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  const clock = new THREE.Clock();
  let raf = 0;
  let disposed = false;
  const loop = () => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const t = clock.getElapsedTime();
    // Leaping out of the water on a fresh catch, then a lazy swim.
    if (splash && t < 1.4) {
      const k = t / 1.4;
      swim.position.y = Math.sin(k * Math.PI) * lengthM * 0.6 - (1 - k) * lengthM * 0.4;
      swim.rotation.z = (0.5 - k) * 1.2;
      swim.scale.setScalar(0.4 + 0.6 * Math.min(1, k * 1.6));
    } else {
      swim.position.y = Math.sin(t * 1.3) * lengthM * 0.015;
      swim.rotation.z = Math.sin(t * 0.9) * 0.03;
      swim.scale.setScalar(1);
    }
    if (model.tail) model.tail.rotation.y = Math.sin(t * 6) * 0.35;
    if (model.flap) model.flap.rotation.x = Math.sin(t * 1.6) * 0.12;
    if (!controls) swim.rotation.y = -0.35 + Math.sin(t * 0.5) * 0.4;
    controls?.update();
    renderer.render(scene, camera);
  };
  loop();

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls?.dispose();
      model.dispose();
      D.forEach((d) => d.dispose?.());
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

// A still picture of a species (for lists), cached. One shared renderer for all of them.
let shared = null;
const thumbs = new Map();
export function thumb(id, look, size = 160) {
  const key = `${id}|${size}`;
  if (thumbs.has(key)) return thumbs.get(key);
  if (!shared) {
    shared = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    shared.outputColorSpace = THREE.SRGBColorSpace;
    shared.toneMapping = THREE.ACESFilmicToneMapping;
    shared.setClearColor(0x000000, 0);
  }
  shared.setSize(size, size * 0.62, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#dff0ff', '#1a3040', 1.6));
  const sun = new THREE.DirectionalLight('#fff4de', 2.4);
  sun.position.set(1, 3, 3);
  scene.add(sun);
  const m = buildFishModel(look);
  m.object.rotation.y = -0.45;
  m.object.rotation.z = 0.05;
  scene.add(m.object);
  const box = new THREE.Box3().setFromObject(m.object);
  const c = box.getCenter(V(0, 0, 0));
  const s = box.getSize(V(0, 0, 0));
  const cam = new THREE.PerspectiveCamera(28, 1 / 0.62, 0.01, 50);
  const d = Math.max(s.x / 0.62 / 1.6, s.y / 1.2) / Math.tan((14 * Math.PI) / 180) * 0.55 + s.z;
  cam.position.copy(c).add(V(0.1, 0.12, d));
  cam.lookAt(c);
  shared.render(scene, cam);
  const url = shared.domElement.toDataURL('image/png');
  m.dispose();
  thumbs.set(key, url);
  return url;
}

window.MMOFish3D = { mount, thumb, supported };
