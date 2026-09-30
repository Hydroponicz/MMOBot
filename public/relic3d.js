// 3D relics: the weapon built in three.js from the same outline and painted skin as the 2D art
// (relicart.js), so what you inspect in 3D is exactly the skin you unboxed: float wear, pattern
// seed, fade and all.
//   const { mount } = await import('/relic3d.js');
//   const view = mount(element, relic, { autoRotate, controls, spinIn, glow });  view.dispose();
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

const ART = window.MMORelicArt;

export function supported() {
  try {
    return !!(window.WebGL2RenderingContext && document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

// How each finish takes the light: metal, polish and clearcoat.
const FINISH_MAT = {
  fade: { metal: 0.65, rough: 0.2, coat: 0.8 },
  gem: { metal: 0.75, rough: 0.15, coat: 1 },
  crystal: { metal: 0.5, rough: 0.12, coat: 1 },
  marble: { metal: 0.35, rough: 0.3, coat: 0.6 },
  flame: { metal: 0.45, rough: 0.28, coat: 0.5 },
  glyph: { metal: 0.6, rough: 0.35, coat: 0.3 },
  scales: { metal: 0.55, rough: 0.25, coat: 0.6 },
  camo: { metal: 0.15, rough: 0.6, coat: 0.1 },
  stripes: { metal: 0.25, rough: 0.5, coat: 0.2 },
  solid: { metal: 0.7, rough: 0.3, coat: 0.4 },
};

// Builds the weapon in 240×100 box units (1 unit = 1/100 of a world unit after scaling).
function buildWeapon(relic) {
  const disposables = [];
  const group = new THREE.Group();
  const weapon = ART.SKIN_PATHS[relic.weapon] ? relic.weapon : 'sword';
  const [bx, by, bw, bh] = ART.BBOX[weapon];
  const thick = weapon === 'shield' ? 6 : weapon === 'hammer' || weapon === 'axe' ? 4 : 2.4;

  // ---- the skinned part
  const svg = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${ART.SKIN_PATHS[weapon]}"/></svg>`);
  const shapes = svg.paths.flatMap((p) => SVGLoader.createShapes(p));
  const bevel = weapon === 'shield' ? 2 : 1.1;
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: thick, bevelEnabled: true, bevelThickness: bevel, bevelSize: Math.min(bevel, 0.9), bevelSegments: 4, curveSegments: 24 });
  geo.translate(0, 0, -thick / 2);
  // UVs: the painting covers the part's bounding box (same as the 2D art).
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - bx) / bw, 1 - (pos.getY(i) - by) / bh);
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  const tex = new THREE.CanvasTexture(ART.texture(relic, 1536));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const f = FINISH_MAT[relic.finish] || FINISH_MAT.solid;
  const wear = Math.max(0, Math.min(1, relic.float ?? 0.1));
  const bladeMat = new THREE.MeshPhysicalMaterial({
    map: tex,
    metalness: f.metal,
    roughness: Math.min(0.9, f.rough + wear * 0.45),
    clearcoat: Math.max(0, f.coat - wear * 0.8),
    clearcoatRoughness: 0.15 + wear * 0.5,
    iridescence: relic.finish === 'gem' || relic.finish === 'crystal' ? 0.35 : 0,
    iridescenceIOR: 1.4,
  });
  // Glowing finishes glow a little in the dark.
  if (['flame', 'glyph', 'gem', 'fade'].includes(relic.finish)) {
    bladeMat.emissiveMap = tex;
    bladeMat.emissive = new THREE.Color('#ffffff');
    bladeMat.emissiveIntensity = relic.finish === 'flame' || relic.finish === 'glyph' ? 0.35 : 0.12;
  }
  const blade = new THREE.Mesh(geo, bladeMat);
  group.add(blade);
  disposables.push(geo, tex, bladeMat);

  // ---- plain parts
  const mats = {
    grip: new THREE.MeshStandardMaterial({ color: '#3a2618', roughness: 0.85 }),
    steel: new THREE.MeshPhysicalMaterial({ color: '#b8bec6', metalness: 1, roughness: 0.25, clearcoat: 0.4 }),
    wood: new THREE.MeshStandardMaterial({ color: '#6b4428', roughness: 0.7 }),
    gold: new THREE.MeshPhysicalMaterial({ color: '#d9a531', metalness: 1, roughness: 0.22, clearcoat: 0.5 }),
    string: new THREE.MeshStandardMaterial({ color: '#efe9da', roughness: 0.9 }),
  };
  disposables.push(...Object.values(mats));
  const add = (g, mat, x, y, z = 0, rot = null) => {
    const m = new THREE.Mesh(g, mats[mat] || mats.steel);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(...rot);
    group.add(m);
    disposables.push(g);
    return m;
  };
  for (const p of ART.PARTS[weapon] || []) {
    const [kind, mat] = p;
    if (kind === 'rect') {
      const [, , x, y, w, h, r] = p;
      const d = Math.min(h, mat === 'gold' || mat === 'steel' ? 7 : 6);
      add(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, h / 2, d / 2) * 0.9), mat, x + w / 2, y + h / 2);
      // Leather wrap rings on grips.
      if (mat === 'grip') for (let gx = x + 3; gx < x + w - 1; gx += 4) add(new THREE.TorusGeometry(h * 0.52, 0.45, 6, 16), 'grip', gx, y + h / 2, 0, [0, Math.PI / 2, 0.3]);
    } else if (kind === 'circle') {
      const [, , cx, cy, r] = p;
      add(new THREE.SphereGeometry(r, 24, 16), mat, cx, cy);
    } else if (kind === 'ring') {
      const [, , cx, cy, r, w] = p;
      add(new THREE.TorusGeometry(r, w / 2, 14, 36), mat, cx, cy);
    } else if (kind === 'ellipse') {
      const [, , cx, cy, rx, ry] = p;
      const m = add(new THREE.SphereGeometry(1, 24, 16), mat, cx, cy);
      m.scale.set(rx, ry, Math.min(rx, 4));
    } else if (kind === 'line') {
      const [, , x1, y1, x2, y2, w] = p;
      const a = new THREE.Vector3(x1, y1, 0);
      const b = new THREE.Vector3(x2, y2, 0);
      const dir = b.clone().sub(a);
      const m = add(new THREE.CylinderGeometry(w / 2, w / 2, dir.length(), 12), mat, (x1 + x2) / 2, (y1 + y2) / 2);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    } else if (kind === 'poly') {
      const s = new THREE.Shape(p[2].map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ExtrudeGeometry(s, { depth: 5, bevelEnabled: true, bevelThickness: 1, bevelSize: 1, bevelSegments: 2 });
      g.translate(0, 0, -2.5);
      add(g, mat, 0, 0);
    }
  }
  // Shields get a boss and a rim.
  if (weapon === 'shield') {
    add(new THREE.SphereGeometry(10, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), 'gold', 120, 46, thick / 2 + 1, [Math.PI / 2, 0, 0]);
  }

  // Center on the box and flip SVG's y-down into y-up (a half turn about x keeps the faces facing out).
  group.position.set(0, 0, 0);
  const pivot = new THREE.Group();
  group.position.set(-120, -50, 0);
  pivot.add(group);
  pivot.rotation.x = Math.PI;
  const holder = new THREE.Group();
  holder.add(pivot);
  holder.scale.setScalar(1 / 100);
  return { object: holder, dispose: () => disposables.forEach((d) => d.dispose?.()) };
}

// A turntable viewer. opts: { autoRotate, controls, spinIn (spin in on open), glow (rarity color) }.
export function mount(el, relic, opts = {}) {
  const { autoRotate = true, controls: withControls = true, spinIn = false } = opts;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.className = 'relic3d-canvas';
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.9;
  scene.add(new THREE.HemisphereLight('#e8eeff', '#1a1410', 0.6));
  const key = new THREE.DirectionalLight('#fff4e6', 2.4);
  key.position.set(2, 3, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(opts.glow || '#8fb8ff', 2);
  rim.position.set(-3, 1, -2);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
  const HOME = new THREE.Vector3(0.35, 0.45, 3.0);
  camera.position.copy(HOME);
  camera.lookAt(0, 0, 0);
  let controls = null;
  if (withControls) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.6;
    controls.maxDistance = 9;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 2.2;
    let resume = null;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      clearTimeout(resume);
    });
    controls.addEventListener('end', () => {
      clearTimeout(resume);
      if (autoRotate) resume = setTimeout(() => (controls.autoRotate = true), 5000);
    });
    renderer.domElement.addEventListener('dblclick', () => {
      camera.position.copy(HOME).multiplyScalar(fitK);
      controls.target.set(0, 0, 0);
    });
  }

  const built = buildWeapon(relic);
  const turn = new THREE.Group();
  turn.add(built.object);
  scene.add(turn);
  // Fit the camera to the weapon (tall ones like bows and shields need to back off).
  const box = new THREE.Box3().setFromObject(turn);
  const size = box.getSize(new THREE.Vector3());
  const aspect0 = (el.clientWidth || 400) / (el.clientHeight || 220);
  const fitK = Math.max(0.6, size.x / (2.3 * Math.min(1, aspect0 / 1.8)), size.y / 1.05);
  camera.position.multiplyScalar(fitK);
  turn.rotation.y = -0.35;
  if (controls) controls.update();

  const resize = () => {
    const w = el.clientWidth || 400;
    const h = el.clientHeight || 220;
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
    // Spin in fast and settle, like pulling it out of the case.
    if (spinIn && t < 1.6) {
      const k = 1 - Math.pow(1 - t / 1.6, 3);
      turn.rotation.y = (1 - k) * Math.PI * 4;
      turn.scale.setScalar(0.3 + 0.7 * k);
    } else if (!controls) turn.rotation.y = -0.35 + Math.sin(t * 0.6) * 0.45;
    turn.position.y = Math.sin(t * 1.3) * 0.03;
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
      built.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
