// The 3D casino: every game on the Casino page gets a three.js scene on a shared casino floor (dark
// carpet, neon KICK signs, warm lights). Outcomes still come from the server; these scenes only
// animate them, so chat and the website always agree.
//   const C3 = await import('/casino3d.js');
//   const view = C3.mount(el, 'slots', { symbols });   await view.spin(['kick', 'kick', 'live']);
//   view.dispose();
// Each game's controller:
//   slots     spin(ids) -> Promise
//   roulette  spin(number) -> Promise
//   plinko    setBoard(mults) · drop(path, bucket, { gold }) -> Promise (many at once is fine)
//   blackjack show(state) -> Promise (deals new cards, flips the dealer's hole card)
//   crash     reset() · update(ms, mult) · cashout(mult) · boom()
//   mines     show(state, { onPick }) -> Promise
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function supported() {
  try {
    return !!(window.WebGL2RenderingContext && document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// A canvas texture from a draw function.
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---- The shared stage ------------------------------------------------------------------------
function stage(el, { camera: camPos = V(0, 2, 8), target = V(0, 1, 0), fov = 40, floor = true, neonSign = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'cz3d-canvas';
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a0710');
  scene.fog = new THREE.Fog('#0a0710', 14, 34);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight('#ffd9a8', '#1a0f24', 0.6));
  const key = new THREE.SpotLight('#ffe8c8', 60, 30, 0.6, 0.5, 1.6);
  key.position.set(3, 9, 6);
  key.target.position.copy(target);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key, key.target);
  const rim = new THREE.PointLight('#53fc18', 18, 18, 1.8);
  rim.position.set(-5, 4, -3);
  scene.add(rim);
  const warm = new THREE.PointLight('#ff4fa0', 10, 16, 1.8);
  warm.position.set(6, 3, -4);
  scene.add(warm);
  const D = [env, pmrem];
  if (floor) {
    // Casino carpet and a back wall with neon signs and bokeh lights.
    const carpet = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#2a0d1e';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 64; i++) {
        const x = (i % 8) * 64 + 32;
        const y = Math.floor(i / 8) * 64 + 32;
        g.strokeStyle = i % 2 ? '#c9a23a55' : '#53fc1833';
        g.lineWidth = 3;
        g.beginPath();
        for (let k = 0; k < 4; k++) g.arc(x, y, 10 + k * 5, k, k + Math.PI * 1.2);
        g.stroke();
      }
    });
    carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
    carpet.repeat.set(8, 8);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), new THREE.MeshStandardMaterial({ color: '#140a1c', roughness: 0.9 }));
    wall.position.set(0, 10, -12);
    scene.add(wall);
    const sign = canvasTex(1024, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.font = '900 150px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = '#53fc18';
      g.shadowBlur = 40;
      g.fillStyle = '#b8ff9a';
      g.fillText('KICK CASINO', w / 2, h / 2);
    });
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshBasicMaterial({ map: sign, transparent: true, toneMapped: false }));
    neon.position.set(0, 7.5, -11.9);
    if (neonSign) scene.add(neon);
    const bokeh = new THREE.Group();
    const dotM = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, toneMapped: false });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.08 + Math.random() * 0.12, 12), dotM(['#ffcf4a', '#ff4fa0', '#53fc18', '#6ab8ff'][i % 4]));
      m.position.set((Math.random() - 0.5) * 30, 2 + Math.random() * 9, -11.8);
      bokeh.add(m);
      D.push(m.geometry, m.material);
    }
    scene.add(bokeh);
    D.push(carpet, ground.geometry, ground.material, wall.geometry, wall.material, sign, neon.geometry, neon.material);
  }
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 100);
  camera.position.copy(camPos);
  camera.lookAt(target);

  const resize = () => {
    const w = el.clientWidth || 600;
    const h = el.clientHeight || 360;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  // Tweens: { dur (ms), update(t 0..1), resolve } run every frame.
  const tweens = new Set();
  const tween = (dur, update) =>
    new Promise((resolve) => {
      tweens.add({ start: performance.now(), dur, update, resolve });
    });
  const tickers = new Set(); // fn(dt, time) every frame
  let raf = 0;
  let last = performance.now();
  let disposed = false;
  const loop = () => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const tw of [...tweens]) {
      const t = clamp((now - tw.start) / tw.dur, 0, 1);
      tw.update(t);
      if (t >= 1) {
        tweens.delete(tw);
        tw.resolve();
      }
    }
    for (const f of tickers) f(dt, now / 1000);
    if (!document.hidden) renderer.render(scene, camera);
  };
  loop();

  // Clicks on meshes (mines). handler(mesh) for meshes in `targets`.
  const pick = (targets, handler) => {
    const ray = new THREE.Raycaster();
    const onClick = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(p, camera);
      const hit = ray.intersectObjects(targets(), true)[0];
      if (hit) handler(hit.object);
    };
    const onMove = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(p, camera);
      renderer.domElement.style.cursor = ray.intersectObjects(targets(), true).length ? 'pointer' : 'default';
    };
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.addEventListener('pointermove', onMove);
  };

  // Gold coins (or confetti) bursting out of a point.
  const burst = (at, { count = 40, color = '#ffcf4a', speed = 4, size = 0.08, life = 1.6 } = {}) => {
    const geo = new THREE.CylinderGeometry(size, size, size * 0.3, 14);
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.25, emissive: new THREE.Color(color), emissiveIntensity: 0.25 });
    const parts = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(at);
      const a = Math.random() * Math.PI * 2;
      const up = 0.5 + Math.random();
      m.userData.v = V(Math.cos(a) * speed * Math.random(), up * speed, Math.sin(a) * speed * Math.random());
      m.userData.spin = V(Math.random() * 10, Math.random() * 10, 0);
      scene.add(m);
      parts.push(m);
    }
    let age = 0;
    const f = (dt) => {
      age += dt;
      for (const m of parts) {
        m.userData.v.y -= 9.8 * dt;
        m.position.addScaledVector(m.userData.v, dt);
        m.rotation.x += m.userData.spin.x * dt;
        m.rotation.y += m.userData.spin.y * dt;
      }
      if (age > life) {
        tickers.delete(f);
        parts.forEach((m) => scene.remove(m));
        geo.dispose();
        mat.dispose();
      }
    };
    tickers.add(f);
  };

  return {
    renderer,
    scene,
    camera,
    tween,
    tickers,
    pick,
    burst,
    D,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const tw of tweens) tw.resolve();
      tweens.clear();
      tickers.clear();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) {
          m.map?.dispose?.();
          m.dispose?.();
        }
      });
      D.forEach((d) => d.dispose?.());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

const gold = () => new THREE.MeshStandardMaterial({ color: '#d9a531', metalness: 1, roughness: 0.25 });
const chrome = () => new THREE.MeshStandardMaterial({ color: '#d8dde4', metalness: 1, roughness: 0.18 });

// ---- Slots: a cabinet with three spinning reels and a lever ---------------------------------
function slots(el, { symbols }) {
  const S = stage(el, { camera: V(0, 2.9, 8.4), target: V(0, 2.55, 0), neonSign: false });
  const g = new THREE.Group();
  S.scene.add(g);
  const cabinetM = new THREE.MeshPhysicalMaterial({ color: '#16331a', metalness: 0.6, roughness: 0.3, clearcoat: 1 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(3.6, 4.2, 1.6, 6, 0.18), cabinetM);
  body.position.set(0, 2.1, -0.3);
  body.castShadow = true;
  g.add(body);
  const top = new THREE.Mesh(new RoundedBoxGeometry(3.8, 0.9, 1.7, 6, 0.3), gold());
  top.position.set(0, 4.45, -0.3);
  g.add(top);
  const marquee = canvasTex(1024, 256, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#0b2a0e');
    gr.addColorStop(0.5, '#1a5a1f');
    gr.addColorStop(1, '#0b2a0e');
    c.fillStyle = gr;
    c.fillRect(0, 0, w, h);
    c.font = '900 120px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = '#53fc18';
    c.shadowBlur = 30;
    c.fillStyle = '#d8ffc8';
    c.fillText('KICK SLOTS', w / 2, h / 2);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.8), new THREE.MeshBasicMaterial({ map: marquee, toneMapped: false }));
  sign.position.set(0, 4.45, 0.56);
  g.add(sign);
  // Marquee bulbs that chase (and flash on a win).
  const bulbs = [];
  for (let i = 0; i < 18; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe27a', toneMapped: false }));
    b.position.set(-1.75 + (i / 17) * 3.5, i % 2 ? 4.88 : 4.02, 0.6);
    g.add(b);
    bulbs.push(b);
  }
  // The reel window.
  // A gold frame round the reel window (the reels' faces show through it).
  const frameM = gold();
  for (const [w, h, x, y] of [[3.1, 0.12, 0, 3.36], [3.1, 0.12, 0, 1.74], [0.12, 1.74, -1.49, 2.55], [0.12, 1.74, 1.49, 2.55], [0.06, 1.5, -0.475, 2.55], [0.06, 1.5, 0.475, 2.55]]) {
    const bar = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.22, 2, 0.03), frameM);
    bar.position.set(x, y, 0.6);
    g.add(bar);
  }
  // Reels: every symbol twice round the drum, each on its own panel facing out.
  const order = [...symbols, ...symbols];
  const N = order.length;
  const R = 0.95; // drum radius
  const cellH = 2 * R * Math.tan(Math.PI / N) * 1.002;
  const symTex = Object.fromEntries(
    symbols.map((s) => [
      s.id,
      canvasTex(256, 256, (c, w, h) => {
        const gr = c.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, '#e8e2d2');
        gr.addColorStop(0.5, '#ffffff');
        gr.addColorStop(1, '#e8e2d2');
        c.fillStyle = gr;
        c.fillRect(0, 0, w, h);
        c.font = '130px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(s.icon, w / 2, h * 0.42);
        c.font = '800 34px system-ui, sans-serif';
        c.fillStyle = '#334';
        c.fillText(s.label.toUpperCase(), w / 2, h * 0.86);
        c.fillStyle = '#d9a531';
        c.fillRect(0, 0, w, 4);
      }),
    ])
  );
  S.D.push(...Object.values(symTex));
  const panelGeo = new THREE.PlaneGeometry(0.82, cellH);
  const reels = [];
  for (let i = 0; i < 3; i++) {
    const drum = new THREE.Group();
    order.forEach((sym, k) => {
      const pivot = new THREE.Group();
      pivot.rotation.x = (k / N) * Math.PI * 2;
      const panel = new THREE.Mesh(panelGeo, new THREE.MeshStandardMaterial({ map: symTex[sym.id], roughness: 0.45 }));
      panel.position.z = R;
      pivot.add(panel);
      drum.add(pivot);
    });
    const holder = new THREE.Group();
    // The drum sits inside the cabinet with just its front face showing.
    holder.position.set(-0.95 + i * 0.95, 2.55, 0.5 - R + 0.16);
    holder.add(drum);
    g.add(holder);
    reels.push({ drum, holder, angle: 0 });
  }
  // Glass and a payline.
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.5), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 0.95, transparent: true, opacity: 0.12, roughness: 0.05 }));
  glass.position.set(0, 2.55, 0.72);
  g.add(glass);
  const payline = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: '#ff4040', toneMapped: false }));
  payline.position.set(0, 2.55, 0.73);
  g.add(payline);
  // The lever.
  const lever = new THREE.Group();
  lever.position.set(1.95, 2.3, -0.2);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 12), chrome());
  arm.position.y = 0.7;
  lever.add(arm);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), new THREE.MeshPhysicalMaterial({ color: '#e0252b', clearcoat: 1, roughness: 0.2 }));
  knob.position.y = 1.45;
  lever.add(knob);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.2, 18), chrome());
  hub.rotation.z = Math.PI / 2;
  lever.add(hub);
  g.add(lever);
  // Coin tray.
  const tray = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.25, 0.7, 4, 0.08), gold());
  tray.position.set(0, 0.55, 0.45);
  g.add(tray);

  // Angle so symbol k sits on the payline (facing the player).
  const angleFor = (k) => -(k / N) * Math.PI * 2;
  const setReel = (r, a) => {
    r.angle = a;
    r.drum.rotation.x = a;
  };
  reels.forEach((r, i) => setReel(r, angleFor(i * 2)));
  let celebrate = 0;
  S.tickers.add((dt, t) => {
    bulbs.forEach((b, i) => {
      const on = celebrate > 0 ? Math.sin(t * 20 + i) > 0 : Math.floor(t * 4 + i / 3) % 3 === 0;
      b.material.color.set(on ? '#fff3a0' : '#6a5420');
    });
    if (celebrate > 0) celebrate -= dt;
  });

  return {
    async spin(ids, { win = false } = {}) {
      // Pull the lever.
      await S.tween(260, (t) => (lever.rotation.x = Math.sin(t * Math.PI) * 0.9));
      const stops = ids.map((id, i) => {
        const k = order.findIndex((s) => s.id === id) + (i % 2 ? N / 2 : 0);
        return k;
      });
      await Promise.all(
        reels.map((r, i) => {
          const from = r.angle;
          const base = angleFor(stops[i] % N);
          // Several full turns, ending exactly on the symbol (always spinning the same way).
          // Spin forward (symbols roll down) several turns, landing exactly on `base`.
          let to = base;
          while (to < from + Math.PI * 2 * (3 + i)) to += Math.PI * 2;
          const dur = 1100 + i * 420;
          return S.tween(dur, (t) => {
            // A little overshoot and settle at the end.
            const e = t < 0.92 ? ease(t / 0.92) * 1.004 : 1.004 - (t - 0.92) / 0.08 * 0.004;
            setReel(r, from + (to - from) * Math.min(1.004, e));
          }).then(() => setReel(r, base));
        })
      );
      if (win) {
        celebrate = 2.5;
        S.burst(V(0, 0.8, 0.7), { count: 60 });
      }
    },
    dispose: () => S.dispose(),
  };
}

// ---- Roulette: a wheel, a ball, and a slow spin --------------------------------------------
function roulette(el, { wheel }) {
  const S = stage(el, { camera: V(0, 5.2, 5.4), target: V(0, 0.9, 0), fov: 38 });
  const n = wheel.length;
  const R = 2;
  // Table.
  const felt = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.5, 0.9, 64), new THREE.MeshStandardMaterial({ color: '#0f4d24', roughness: 0.9 }));
  felt.position.y = 0.45;
  felt.receiveShadow = true;
  S.scene.add(felt);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.45, R + 0.3, 0.5, 72, 1, true), new THREE.MeshStandardMaterial({ color: '#5a2e12', roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide }));
  bowl.position.y = 1.15;
  S.scene.add(bowl);
  const rimRing = new THREE.Mesh(new THREE.TorusGeometry(R + 0.45, 0.08, 12, 96), gold());
  rimRing.rotation.x = Math.PI / 2;
  rimRing.position.y = 1.4;
  S.scene.add(rimRing);
  // The spinning wheel: pockets painted on the top.
  const face = canvasTex(1024, 1024, (c, w) => {
    const cx = w / 2;
    for (let i = 0; i < n; i++) {
      const a0 = ((i - 0.5) / n) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2;
      c.beginPath();
      c.moveTo(cx, cx);
      c.arc(cx, cx, cx, a0, a1);
      c.closePath();
      c.fillStyle = wheel[i].color === 'red' ? '#c81e1e' : wheel[i].color === 'green' ? '#139a3e' : '#121318';
      c.fill();
      c.strokeStyle = '#d9a531';
      c.lineWidth = 3;
      c.stroke();
      const mid = (i / n) * Math.PI * 2 - Math.PI / 2;
      c.save();
      c.translate(cx + Math.cos(mid) * cx * 0.86, cx + Math.sin(mid) * cx * 0.86);
      c.rotate(mid + Math.PI / 2);
      c.fillStyle = '#fff';
      c.font = '800 34px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(wheel[i].n), 0, 0);
      c.restore();
    }
    // Inner cone area.
    const gr = c.createRadialGradient(cx, cx, 0, cx, cx, cx * 0.62);
    gr.addColorStop(0, '#7a4a20');
    gr.addColorStop(1, '#3a200c');
    c.beginPath();
    c.arc(cx, cx, cx * 0.62, 0, Math.PI * 2);
    c.fillStyle = gr;
    c.fill();
    c.strokeStyle = '#d9a531';
    c.lineWidth = 8;
    c.stroke();
  });
  // The cylinder cap mirrors canvas textures; flip it back so the numbers read right.
  face.wrapS = THREE.RepeatWrapping;
  face.repeat.x = -1;
  const wheelG = new THREE.Group();
  wheelG.position.y = 1.0;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.16, 96), [new THREE.MeshStandardMaterial({ color: '#3a200c', roughness: 0.5 }), new THREE.MeshStandardMaterial({ map: face, roughness: 0.35, metalness: 0.1 }), new THREE.MeshStandardMaterial({ color: '#3a200c' })]);
  disc.castShadow = true;
  wheelG.add(disc);
  // Pocket separators (frets) and the turret.
  // Pocket i's angle on the wheel (matching where it's painted on the face).
  const pocketA = (i) => Math.PI / 2 - (i / n) * Math.PI * 2;
  const fretM = gold();
  for (let i = 0; i < n; i++) {
    const a = pocketA(i + 0.5);
    const fret = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.34), fretM);
    fret.position.set(Math.sin(a) * R * 0.82, 0.12, -Math.cos(a) * R * 0.82);
    fret.rotation.y = -a;
    wheelG.add(fret);
  }
  const turret = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.5, 32), gold());
  turret.position.y = 0.33;
  wheelG.add(turret);
  const cross = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 10), chrome());
    bar.rotation.z = Math.PI / 2;
    bar.rotation.y = (k * Math.PI) / 4;
    cross.add(bar);
  }
  cross.position.y = 0.62;
  wheelG.add(cross);
  S.scene.add(wheelG);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 14), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.1, clearcoat: 1 }));
  ball.castShadow = true;
  S.scene.add(ball);
  // Pocket i points at angle (i / n) * 2π from the top (−z) when the wheel is at 0, turning clockwise
  // seen from above; wheel rotation.y is counter-clockwise, hence the minus signs.
  let wheelA = 0;
  let ballA = Math.PI / 2;
  let ballR = R + 0.25;
  let ballY = 1.3;
  let lockedPocket = null;
  const placeBall = () => {
    const a = lockedPocket === null ? ballA : pocketA(lockedPocket) - wheelA;
    ball.position.set(Math.sin(a) * ballR, ballY, -Math.cos(a) * ballR);
  };
  placeBall();
  // Idle: a slow turn.
  let idle = true;
  S.tickers.add((dt) => {
    if (idle) {
      wheelA += dt * 0.25;
      wheelG.rotation.y = wheelA;
      placeBall();
    }
  });
  return {
    async spin(number) {
      idle = false;
      lockedPocket = null;
      const idx = wheel.findIndex((w) => w.n === number);
      const w0 = wheelA;
      const w1 = w0 + Math.PI * 2 * 3 + Math.random() * Math.PI;
      // Where the pocket ends up (world angle) when the wheel stops.
      const pocketEnd = pocketA(idx) - w1;
      const b0 = ballA;
      // The wheel turns one way (its pockets' angles go down); the ball runs the other way, many laps.
      let b1 = pocketEnd;
      while (b1 < b0 + Math.PI * 2 * 5) b1 += Math.PI * 2;
      await S.tween(4200, (t) => {
        wheelA = w0 + (w1 - w0) * ease(t);
        wheelG.rotation.y = wheelA;
        ballA = b0 + (b1 - b0) * ease(t);
        // Rolls on the rim, then drops in and bounces over the frets.
        const drop = clamp((t - 0.55) / 0.35, 0, 1);
        ballR = R + 0.25 - drop * (0.25 + R * 0.18);
        ballY = 1.3 - drop * 0.15 + (drop > 0 && drop < 1 ? Math.abs(Math.sin(drop * Math.PI * 4)) * 0.12 * (1 - drop) : 0);
        placeBall();
      });
      ballA = pocketEnd;
      lockedPocket = idx;
      placeBall();
      setTimeout(() => (idle = true), 1800);
    },
    dispose: () => S.dispose(),
  };
}

// ---- Plinko: a tall board of pegs, buckets, and shiny balls ---------------------------------
function plinko(el, { rows, mults }) {
  const gap = 0.42;
  const H = rows * gap;
  const S = stage(el, { camera: V(0, H / 2 + 1.3, H * 1.5 + 2.4), target: V(0, H / 2 + 1.1, 0), fov: 40 });
  const board = new THREE.Group();
  board.position.y = 0.9;
  S.scene.add(board);
  const W = (rows + 3) * gap;
  const back = new THREE.Mesh(new RoundedBoxGeometry(W + 0.6, H + 1.6, 0.2, 4, 0.1), new THREE.MeshStandardMaterial({ color: '#10141c', roughness: 0.6, metalness: 0.3 }));
  back.position.set(0, H / 2 + 0.2, -0.2);
  back.receiveShadow = true;
  board.add(back);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 4), gold());
  void frame;
  // Pegs (instanced).
  const pegCount = Array.from({ length: rows }, (_, r) => r + 3).reduce((a, b) => a + b, 0);
  const pegs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 14), chrome(), pegCount);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  let k = 0;
  const top = H + 0.4;
  for (let r = 0; r < rows; r++) {
    for (let j = 0; j <= r + 2; j++) {
      m4.compose(V((j - (r + 2) / 2) * gap, top - r * gap, 0), q, V(1, 1, 1));
      pegs.setMatrixAt(k++, m4);
    }
  }
  pegs.castShadow = true;
  board.add(pegs);
  // Buckets with their multipliers.
  const buckets = [];
  const bucketsG = new THREE.Group();
  board.add(bucketsG);
  const colorOf = (m) => (m >= 10 ? '#dc2626' : m >= 2 ? '#f97316' : m >= 1 ? '#eab308' : '#2fd36b');
  const setBoard = (ms) => {
    for (const b of buckets) {
      bucketsG.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.forEach?.((m) => (m.map?.dispose(), m.dispose()));
    }
    buckets.length = 0;
    ms.forEach((m, i) => {
      const tex = canvasTex(128, 96, (c, w, h) => {
        c.fillStyle = colorOf(m);
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#0b0e11';
        c.font = `900 ${m >= 1000 ? 30 : m >= 100 ? 36 : 44}px system-ui, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(`${m}x`, w / 2, h / 2);
      });
      const side = new THREE.MeshStandardMaterial({ color: colorOf(m), roughness: 0.4, emissive: new THREE.Color(colorOf(m)), emissiveIntensity: 0.15 });
      const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.15 });
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(gap * 0.92, 0.32, 0.3, 3, 0.04), [side, side, side, side, front, side]);
      mesh.position.set((i - rows / 2) * gap, top - rows * gap - 0.12, 0);
      bucketsG.add(mesh);
      buckets.push({ mesh, front, base: mesh.position.y });
    });
  };
  setBoard(mults);
  const ballGeo = new THREE.SphereGeometry(0.1, 20, 14);
  const ballM = new THREE.MeshPhysicalMaterial({ color: '#53fc18', roughness: 0.15, clearcoat: 1, emissive: new THREE.Color('#1a6a08'), emissiveIntensity: 0.4 });
  const goldM = new THREE.MeshPhysicalMaterial({ color: '#ffc940', roughness: 0.1, metalness: 0.6, clearcoat: 1, emissive: new THREE.Color('#6a4a00'), emissiveIntensity: 0.5 });
  S.D.push(ballGeo, ballM, goldM);
  const ROW_MS = 110;
  return {
    setBoard,
    // One ball down its path (a hop per row), landing in its bucket. Same timing as the 2D board.
    drop(path, bucket, { gold: isGold = false } = {}) {
      const ball = new THREE.Mesh(ballGeo, isGold ? goldM : ballM);
      ball.castShadow = true;
      board.add(ball);
      let pos = 0;
      const at = (row, p) => V((p - row / 2) * gap, top - row * gap + 0.12, 0.12);
      ball.position.copy(at(0, 0));
      const jitter = (Math.random() - 0.5) * 0.04;
      return (async () => {
        for (let row = 0; row < path.length; row++) {
          const a = at(row, pos);
          pos += path[row];
          const b = at(row + 1, pos);
          await S.tween(ROW_MS, (t) => {
            ball.position.set(a.x + (b.x - a.x) * t + jitter, a.y + (b.y - a.y) * t + Math.sin(t * Math.PI) * gap * 0.35, 0.12);
          });
        }
        const bk = buckets[bucket];
        if (bk) {
          await S.tween(150, (t) => (ball.position.y -= 0.02 * t));
          board.remove(ball);
          S.tween(380, (t) => (bk.mesh.position.y = bk.base - Math.sin(t * Math.PI) * 0.12));
          bk.front.emissiveIntensity = 1;
          S.tween(500, (t) => (bk.front.emissiveIntensity = 1 - t * 0.85));
          if (isGold) S.burst(board.localToWorld(bk.mesh.position.clone()), { count: 24, speed: 3 });
        } else board.remove(ball);
      })();
    },
    dispose: () => S.dispose(),
  };
}

// ---- Blackjack: felt, a shoe, and cards dealt and flipped ------------------------------------
const SUIT_RED = new Set(['♥', '♦']);
function cardTex(card) {
  return canvasTex(256, 356, (c, w, h) => {
    c.fillStyle = '#fbfaf6';
    c.beginPath();
    c.roundRect(0, 0, w, h, 22);
    c.fill();
    const red = SUIT_RED.has(card.suit);
    c.fillStyle = red ? '#c8102e' : '#15171c';
    c.font = '800 54px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText(card.rank, 40, 62);
    c.font = '46px system-ui, sans-serif';
    c.fillText(card.suit, 40, 110);
    c.save();
    c.translate(w - 40, h - 62);
    c.rotate(Math.PI);
    c.font = '800 54px system-ui, sans-serif';
    c.fillText(card.rank, 0, 0);
    c.font = '46px system-ui, sans-serif';
    c.fillText(card.suit, 0, -48);
    c.restore();
    c.font = '150px system-ui, sans-serif';
    c.textBaseline = 'middle';
    c.fillText(card.suit, w / 2, h / 2 + 6);
  });
}
let backTexCache = null;
function backTex() {
  backTexCache ??= canvasTex(256, 356, (c, w, h) => {
    c.fillStyle = '#fbfaf6';
    c.beginPath();
    c.roundRect(0, 0, w, h, 22);
    c.fill();
    c.fillStyle = '#0f5a22';
    c.beginPath();
    c.roundRect(12, 12, w - 24, h - 24, 16);
    c.fill();
    c.strokeStyle = '#53fc18';
    c.lineWidth = 3;
    for (let i = -h; i < w + h; i += 22) {
      c.beginPath();
      c.moveTo(i, 12);
      c.lineTo(i + h, h);
      c.stroke();
    }
    c.fillStyle = '#0b2a0e';
    c.fillRect(40, h / 2 - 40, w - 80, 80);
    c.fillStyle = '#b8ff9a';
    c.font = '900 52px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('KICK', w / 2, h / 2);
  });
  return backTexCache;
}
function blackjack(el) {
  const S = stage(el, { camera: V(0, 4.6, 3.3), target: V(0, 0.95, -1.0), fov: 42 });
  const table = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.2, 64), new THREE.MeshStandardMaterial({ color: '#0f5a2a', roughness: 0.95 }));
  table.position.set(0, 0.85, -1.6);
  table.receiveShadow = true;
  S.scene.add(table);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.16, 12, 96), new THREE.MeshStandardMaterial({ color: '#4a2410', roughness: 0.5 }));
  rail.rotation.x = Math.PI / 2;
  rail.position.set(0, 0.97, -1.6);
  S.scene.add(rail);
  const print = canvasTex(1024, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = '#d9c88a';
    c.fillStyle = '#d9c88a';
    c.lineWidth = 4;
    c.font = '700 40px Georgia, serif';
    c.textAlign = 'center';
    c.fillText('BLACKJACK PAYS 3 TO 2', w / 2, 120);
    c.font = '600 28px Georgia, serif';
    c.fillText('Dealer must stand on 17 and draw to 16', w / 2, 170);
    c.beginPath();
    c.arc(w / 2, -400, 760, 0.36 * Math.PI, 0.64 * Math.PI);
    c.stroke();
  });
  const printM = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: print, transparent: true }));
  printM.rotation.x = -Math.PI / 2;
  printM.position.set(0, 0.96, -0.6);
  S.scene.add(printM);
  // The shoe.
  const shoe = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.45, 1.1, 4, 0.06), new THREE.MeshStandardMaterial({ color: '#1a1a1e', roughness: 0.4, metalness: 0.4 }));
  shoe.position.set(2.6, 1.18, -2.2);
  shoe.rotation.y = -0.5;
  S.scene.add(shoe);
  const SHOE = V(2.5, 1.3, -2.0);
  const cardGeo = new THREE.BoxGeometry(0.64, 0.012, 0.89);
  S.D.push(cardGeo);
  const edgeM = new THREE.MeshStandardMaterial({ color: '#f2f0e8' });
  // Cards on the table: one entry per slot ("d0", "h1c2"...), so redraws only animate new ones.
  const placed = new Map();
  const makeCard = (card) => {
    const backM = new THREE.MeshStandardMaterial({ map: backTex(), roughness: 0.5 });
    const faceM = new THREE.MeshStandardMaterial({ map: card ? cardTex(card) : backTex(), roughness: 0.5 });
    // Box faces: +x, -x, +y (top), -y (bottom), +z, -z.
    const m = new THREE.Mesh(cardGeo, [edgeM, edgeM, faceM, backM, edgeM, edgeM]);
    m.castShadow = true;
    return m;
  };
  const slotPos = (row, i, count, rowZ) => V((i - (count - 1) / 2) * 0.5, 0.97 + i * 0.002, rowZ + i * 0.02);
  const chips = new THREE.Group();
  S.scene.add(chips);
  return {
    async show(g) {
      if (!g) {
        for (const [, c] of placed) S.scene.remove(c.mesh);
        placed.clear();
        while (chips.children.length) chips.remove(chips.children[0]);
        return;
      }
      const want = [];
      const dealerCards = g.dealer || [];
      dealerCards.forEach((c, i) => want.push({ key: `d${i}`, card: c, pos: slotPos(0, i, dealerCards.length, -2.3) }));
      const hands = g.hands && g.hands.length ? g.hands : g.player ? [{ cards: g.player }] : [];
      hands.forEach((h, hi) => {
        const off = (hi - (hands.length - 1) / 2) * 1.9;
        h.cards.forEach((c, i) => {
          const p = slotPos(1, i, h.cards.length, -0.4);
          p.x += off;
          if (hands.length > 1 && hi === g.active && g.status === 'playing') p.z += 0.12;
          want.push({ key: `h${hi}c${i}`, card: c, pos: p });
        });
      });
      // A new round: clear the table (a slot gone, or a different card in it).
      const same = (a, b) => !a || !b || (a.rank === b.rank && a.suit === b.suit);
      if ([...placed.entries()].some(([k, c]) => { const w = want.find((x) => x.key === k); return !w || !same(c.card, w.card); })) {
        for (const [, c] of placed) S.scene.remove(c.mesh);
        placed.clear();
      }
      // Stake chips.
      while (chips.children.length) chips.remove(chips.children[0]);
      const stake = hands.reduce((s, h) => s + (h.stake || 0), 0) || g.stake || 0;
      const n = clamp(Math.ceil(Math.log10(Math.max(10, stake)) * 2), 1, 12);
      const chipM = new THREE.MeshStandardMaterial({ color: '#c81e1e', roughness: 0.4 });
      for (let i = 0; i < n; i++) {
        const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 24), i % 2 ? chipM : new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.4 }));
        chip.position.set(-1.6, 0.98 + i * 0.052, 0.4);
        chips.add(chip);
      }
      let delay = 0;
      const jobs = [];
      for (const w of want) {
        const have = placed.get(w.key);
        if (have) {
          // Turn over the dealer's hole card when it's revealed.
          if (!have.card && w.card) {
            const old = have.mesh;
            const fresh = makeCard(w.card);
            fresh.position.copy(old.position);
            fresh.rotation.copy(old.rotation);
            fresh.rotation.z = Math.PI;
            S.scene.remove(old);
            S.scene.add(fresh);
            have.mesh = fresh;
            have.card = w.card;
            jobs.push(S.tween(420, (t) => {
              fresh.rotation.z = Math.PI * (1 - easeInOut(t));
              fresh.position.y = w.pos.y + Math.sin(t * Math.PI) * 0.3;
            }));
          }
          const from = have.mesh.position.clone();
          if (from.distanceTo(w.pos) > 0.001) jobs.push(S.tween(250, (t) => have.mesh.position.lerpVectors(from, w.pos, ease(t))));
          continue;
        }
        const mesh = makeCard(w.card);
        mesh.position.copy(SHOE);
        mesh.rotation.z = Math.PI; // face down out of the shoe
        mesh.rotation.y = -0.5;
        S.scene.add(mesh);
        placed.set(w.key, { mesh, card: w.card });
        const d = delay;
        delay += 260;
        jobs.push(
          new Promise((res) => setTimeout(res, d)).then(() =>
            S.tween(480, (t) => {
              const e = easeInOut(t);
              mesh.position.lerpVectors(SHOE, w.pos, e);
              mesh.position.y += Math.sin(t * Math.PI) * 0.35;
              mesh.rotation.y = -0.5 * (1 - e);
              mesh.rotation.z = w.card ? Math.PI * (1 - e) : Math.PI;
            })
          )
        );
      }
      await Promise.all(jobs);
      if (g.net > 0 && g.status !== 'playing') S.burst(V(-1.6, 1.2, 0.4), { count: 36, speed: 3 });
    },
    dispose: () => S.dispose(),
  };
}

// ---- Crash: a rocket climbing through space --------------------------------------------------
function crash(el) {
  const S = stage(el, { camera: V(0, 2, 7), target: V(0, 2, 0), floor: false, fov: 45 });
  S.scene.background = new THREE.Color('#05030c');
  S.scene.fog = null;
  // Stars.
  const starGeo = new THREE.BufferGeometry();
  const pts = [];
  for (let i = 0; i < 1500; i++) pts.push((Math.random() - 0.5) * 120, (Math.random() - 0.2) * 120, -10 - Math.random() * 60);
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.12, sizeAttenuation: true }));
  S.scene.add(stars);
  // A planet below.
  const planet = new THREE.Mesh(new THREE.SphereGeometry(14, 48, 32), new THREE.MeshStandardMaterial({ color: '#1d5a3a', roughness: 0.9, emissive: new THREE.Color('#0a2a12'), emissiveIntensity: 0.4 }));
  planet.position.set(0, -15.5, -4);
  S.scene.add(planet);
  // The rocket.
  const rocket = new THREE.Group();
  const bodyM = new THREE.MeshPhysicalMaterial({ color: '#f2f4f8', roughness: 0.25, clearcoat: 1, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.1, 24), bodyM);
  rocket.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 24), new THREE.MeshPhysicalMaterial({ color: '#53fc18', roughness: 0.3, clearcoat: 1 }));
  nose.position.y = 0.8;
  rocket.add(nose);
  const window1 = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), new THREE.MeshStandardMaterial({ color: '#6ab8ff', emissive: new THREE.Color('#2a6aaa'), emissiveIntensity: 1 }));
  window1.position.set(0, 0.2, 0.235);
  rocket.add(window1);
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.35, 0.3), new THREE.MeshStandardMaterial({ color: '#d0202a', roughness: 0.4 }));
    const a = (i / 3) * Math.PI * 2;
    fin.position.set(Math.sin(a) * 0.28, -0.42, Math.cos(a) * 0.28);
    fin.rotation.y = a;
    rocket.add(fin);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 18, 1, true), new THREE.MeshBasicMaterial({ color: '#ffb03a', transparent: true, opacity: 0.85, toneMapped: false }));
  flame.rotation.x = Math.PI;
  flame.position.y = -0.92;
  rocket.add(flame);
  const glow = new THREE.PointLight('#ffb03a', 6, 4);
  glow.position.y = -1;
  rocket.add(glow);
  S.scene.add(rocket);
  // Exhaust trail.
  const trailMax = 240;
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(trailMax * 3).fill(0), 3));
  trailGeo.setDrawRange(0, 0);
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: '#53fc18', transparent: true, opacity: 0.9 }));
  S.scene.add(trail);
  let flying = false;
  let trailN = 0;
  let pos = V(0, 0, 0);
  const home = () => {
    pos = V(-4, 0, 0);
    rocket.position.copy(pos);
    rocket.rotation.set(0, 0, -0.6);
    rocket.visible = true;
    trailN = 0;
    trailGeo.setDrawRange(0, 0);
    flame.visible = false;
  };
  home();
  S.tickers.add((dt, t) => {
    flame.scale.y = 0.8 + Math.sin(t * 40) * 0.2;
    if (flying) {
      // The camera follows, and the stars stream past.
      S.camera.position.lerp(V(pos.x + 2, pos.y + 0.8, 7), 0.08);
      S.camera.lookAt(pos.x + 1.5, pos.y + 0.6, 0);
      stars.position.y -= dt * 2;
    } else if (!rocket.visible) {
      // After a crash.
    } else {
      rocket.position.y = pos.y + Math.sin(t * 2) * 0.05;
    }
  });
  return {
    reset() {
      flying = false;
      home();
      S.camera.position.set(0, 2, 7);
      S.camera.lookAt(0, 2, 0);
    },
    // ms since launch and the multiplier: x drifts right, y climbs with log(multiplier).
    update(ms, mult) {
      if (!flying) {
        flying = true;
        flame.visible = true;
        rocket.visible = true;
      }
      const x = -4 + ms / 1000 * 0.9;
      const y = Math.log(Math.max(1, mult)) * 3.2;
      const next = V(x, y, 0);
      const dir = next.clone().sub(pos);
      if (dir.length() > 0.0001) rocket.rotation.z = Math.atan2(dir.y, dir.x) - Math.PI / 2;
      pos = next;
      rocket.position.copy(pos);
      const arr = trailGeo.attributes.position.array;
      if (trailN < trailMax) trailN++;
      else arr.copyWithin(0, 3);
      arr[(trailN - 1) * 3] = pos.x;
      arr[(trailN - 1) * 3 + 1] = pos.y;
      arr[(trailN - 1) * 3 + 2] = 0;
      trailGeo.attributes.position.needsUpdate = true;
      trailGeo.setDrawRange(0, trailN);
    },
    cashout() {
      flying = false;
      S.burst(rocket.position.clone(), { count: 40, speed: 3 });
      setTimeout(() => !flying && this.reset(), 2200);
    },
    boom() {
      flying = false;
      rocket.visible = false;
      S.burst(rocket.position.clone(), { count: 80, color: '#ff6a1a', speed: 5, size: 0.06 });
      S.burst(rocket.position.clone(), { count: 40, color: '#ffd24a', speed: 3, size: 0.05 });
      setTimeout(() => !flying && this.reset(), 2400);
    },
    dispose: () => S.dispose(),
  };
}

// ---- Mines: a 5×5 board of tiles to turn over ------------------------------------------------
function mines(el, { tiles = 25 }) {
  const S = stage(el, { camera: V(0, 8.2, 5.6), target: V(0, 0.9, 0.2), fov: 40 });
  const base = new THREE.Mesh(new RoundedBoxGeometry(5.6, 0.3, 5.6, 4, 0.12), new THREE.MeshStandardMaterial({ color: '#141a24', roughness: 0.5, metalness: 0.3 }));
  base.position.y = 0.75;
  base.receiveShadow = true;
  S.scene.add(base);
  const trim = new THREE.Mesh(new THREE.TorusGeometry(3.9, 0.05, 8, 4), gold());
  trim.rotation.set(Math.PI / 2, 0, Math.PI / 4);
  trim.position.y = 0.9;
  S.scene.add(trim);
  const tileGeo = new RoundedBoxGeometry(0.92, 0.22, 0.92, 4, 0.08);
  const tileM = new THREE.MeshPhysicalMaterial({ color: '#2a3446', roughness: 0.35, metalness: 0.4, clearcoat: 0.6 });
  const hoverM = new THREE.MeshPhysicalMaterial({ color: '#3d4f6e', roughness: 0.3, metalness: 0.4, clearcoat: 0.8, emissive: new THREE.Color('#53fc18'), emissiveIntensity: 0.08 });
  const dimM = new THREE.MeshStandardMaterial({ color: '#1a202c', roughness: 0.6 });
  const gemM = new THREE.MeshPhysicalMaterial({ color: '#3fe0ff', roughness: 0.08, metalness: 0.35, emissive: new THREE.Color('#1aa8d0'), emissiveIntensity: 0.7, clearcoat: 1, flatShading: true });
  const mineM = new THREE.MeshStandardMaterial({ color: '#1a1a1e', roughness: 0.4, metalness: 0.6 });
  const fuseM = new THREE.MeshBasicMaterial({ color: '#ff4a2a', toneMapped: false });
  S.D.push(tileGeo, tileM, hoverM, dimM, gemM, mineM, fuseM);
  const cells = [];
  for (let i = 0; i < tiles; i++) {
    const x = (i % 5) - 2;
    const z = Math.floor(i / 5) - 2;
    const t = new THREE.Mesh(tileGeo, tileM);
    t.position.set(x * 1.04, 1.02, z * 1.04);
    t.castShadow = true;
    t.userData.i = i;
    S.scene.add(t);
    cells.push({ tile: t, prize: null, state: 'hidden' });
  }
  const makeGem = () => {
    const g = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), gemM);
    g.scale.y = 1.3;
    return g;
  };
  const makeMine = () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 14), mineM));
    for (let k = 0; k < 8; k++) {
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 8), mineM);
      const dir = V(Math.cos(k), Math.sin(k * 1.7), Math.sin(k)).normalize();
      s.position.copy(dir.clone().multiplyScalar(0.28));
      s.quaternion.setFromUnitVectors(V(0, 1, 0), dir);
      g.add(s);
    }
    const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), fuseM);
    fuse.position.y = 0.34;
    g.add(fuse);
    return g;
  };
  let onPick = null;
  let playing = false;
  let hover = null;
  S.pick(
    () => (playing ? cells.filter((c) => c.state === 'hidden').map((c) => c.tile) : []),
    (mesh) => onPick?.(mesh.userData.i)
  );
  S.renderer.domElement.addEventListener('pointermove', (e) => {
    const r = S.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), S.camera);
    const hit = playing ? ray.intersectObjects(cells.filter((c) => c.state === 'hidden').map((c) => c.tile))[0] : null;
    if (hover && hover !== hit?.object) {
      hover.material = tileM;
      hover.position.y = 1.02;
    }
    hover = hit?.object || null;
    if (hover) {
      hover.material = hoverM;
      hover.position.y = 1.08;
    }
  });
  S.tickers.add((dt, t) => {
    for (const c of cells) if (c.prize && c.state === 'gem') c.prize.rotation.y += dt * 1.5, (c.prize.position.y = 1.55 + Math.sin(t * 2 + c.tile.userData.i) * 0.05);
  });
  const reveal = (c, kind, big) => {
    c.state = kind;
    const prize = kind === 'gem' ? makeGem() : makeMine();
    prize.position.set(c.tile.position.x, 1.1, c.tile.position.z);
    S.scene.add(prize);
    c.prize = prize;
    c.tile.material = dimM;
    const p = S.tween(380, (t) => {
      c.tile.position.y = 1.02 - ease(t) * 0.12;
      prize.position.y = 1.1 + ease(t) * 0.45;
      prize.scale.setScalar(0.2 + ease(t) * 0.8);
    });
    if (kind === 'mine' && big) {
      S.burst(c.tile.position.clone().setY(1.5), { count: 70, color: '#ff6a1a', speed: 4.5, size: 0.06 });
      S.burst(c.tile.position.clone().setY(1.5), { count: 30, color: '#ffd24a', speed: 3, size: 0.05 });
    }
    return p;
  };
  return {
    async show(g, opts = {}) {
      if (opts.onPick) onPick = opts.onPick;
      playing = !!(g && g.status === 'playing');
      const jobs = [];
      for (const [i, c] of cells.entries()) {
        const gem = g && g.revealed?.includes(i);
        const mine = g && g.mines?.includes(i);
        if (!g) {
          // A fresh board.
          if (c.prize) S.scene.remove(c.prize);
          c.prize = null;
          c.state = 'hidden';
          c.tile.material = tileM;
          c.tile.position.y = 1.02;
          continue;
        }
        if (gem && c.state !== 'gem') jobs.push(reveal(c, 'gem'));
        else if (mine && c.state !== 'mine') jobs.push(reveal(c, 'mine', g.hit === i));
        else if (!gem && !mine && g.status !== 'playing' && c.state === 'hidden') c.tile.material = dimM;
        else if (!gem && !mine && g.status === 'playing' && c.state !== 'hidden') {
          // A new game started over an old board.
          if (c.prize) S.scene.remove(c.prize);
          c.prize = null;
          c.state = 'hidden';
          c.tile.material = tileM;
          c.tile.position.y = 1.02;
        }
      }
      await Promise.all(jobs);
      if (g && g.status === 'won') S.burst(V(0, 1.6, 0), { count: 50 });
    },
    // Start a new board (clear prizes).
    clear() {
      return this.show(null);
    },
    dispose: () => S.dispose(),
  };
}

const GAMES = { slots, roulette, plinko, blackjack, crash, mines };
export function mount(el, game, opts = {}) {
  return GAMES[game](el, opts);
}
