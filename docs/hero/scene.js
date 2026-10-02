// README hero: a looping three.js render of the keypad walking Home → Codex → Project → Task.
// Every frame is a pure function of time, so record.mjs can step it deterministically.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ?record steps frames for record.mjs; ?card renders a square close-up with no banner copy.
const params = new URLSearchParams(location.search), recording = params.has('record'), card = params.has('card');
const W = card ? 640 : 1200, H = card ? 640 : 600, LOOP = 10;
const stage = document.getElementById('stage');
stage.style.width = `${W}px`; stage.style.height = `${H}px`;
document.documentElement.classList.toggle('card', card); document.documentElement.classList.toggle('record', recording);
const DPR = Math.min(window.devicePixelRatio || 1, 2);

// ---- Storyboard (fictional demo data, same labels as public/demo.js) ----
const key = (title, icon, state, status) => ({ title, icon, state, status });
const off = (title, icon) => ({ title, icon, state: 'off', status: 'Not connected' });
const nav = (title, icon, disabled) => ({ title, icon, state: disabled ? 'off' : 'nav' });
const EMPTY = { title: '', state: 'empty' };
const NAV = [nav('Back', 'back'), nav('Previous', 'left', true), nav('Next', 'right')];
const TASKS = [key('Terraform plan', 'thread', 'working', 'Working'), key('AWS sign-in', 'thread', 'idle', 'Idle'), key('Container logs', 'thread', 'working', 'Working'), key('Network policy', 'thread', 'done', 'Done'), key('RDS connection', 'thread', 'idle', 'Idle'), ...NAV];
const PAGES = {
  home: [key('Codex', 'codex', 'needs-attention', '2 Needs you'), off('Claude', 'claude'), off('VS Code', 'vs code'), off('Terminal', 'terminal'), off('GitHub', 'github'), off('AWS', 'aws'), EMPTY, EMPTY, EMPTY],
  projects: [key('Infrastructure', 'folder', 'needs-attention', 'Needs you'), key('Agentic', 'folder', 'working', '2 Working'), key('Brain', 'folder', 'done', 'Done'), key('Platform', 'folder', 'needs-attention', 'Needs you'), key('Portfolio', 'folder', 'working', 'Working'), key('CLI tools', 'folder', 'error', 'Error'), ...NAV],
  waiting: [key('ECS deployment', 'thread', 'needs-attention', 'Needs you'), ...TASKS],
  working: [key('ECS deployment', 'thread', 'working', 'Working'), ...TASKS],
  done: [key('ECS deployment', 'thread', 'done', 'Done'), ...TASKS]
};
const STEPS = [
  { t: 0, page: 'home', crumbs: ['HOME'] },
  { t: 1.45, page: 'projects', crumbs: ['HOME', 'CODEX'] },
  { t: 3.75, page: 'waiting', crumbs: ['HOME', 'CODEX', 'INFRASTRUCTURE'] },
  { t: 6.05, page: 'working', crumbs: ['HOME', 'CODEX', 'INFRASTRUCTURE'] },
  { t: 7.4, page: 'done', crumbs: ['HOME', 'CODEX', 'INFRASTRUCTURE'] },
  { t: 8.65, page: 'home', crumbs: ['HOME'] }
];
const PRESSES = [{ t: 1.3, k: 0 }, { t: 3.6, k: 0 }, { t: 5.9, k: 0 }, { t: 8.5, k: 6 }];
const FLIP = 0.62, STAGGER = 0.07, LIFT = 0.72, PRESS = 0.36;

const TEXT = { 'needs-attention': '#f4ba6b', working: '#92bdfc', done: '#b7f398', error: '#fa9393', idle: '#a4adbb', off: '#8792a2' };
const GLOW = { 'needs-attention': ['#ff9a2e', 1.5], working: ['#3f8cff', 1.0], done: ['#63d943', 0.75], error: ['#ff4545', 1.1], idle: ['#5f6f86', 0.16], nav: ['#5f6f86', 0.22], off: ['#3a4554', 0.07], empty: ['#3a4554', 0.04] };
const ICONS = {
  codex: 'm9 6-6 6 6 6m6-12 6 6-6 6m-2-16-2 20', folder: 'M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  thread: 'M5 4h14v12H9l-4 4ZM9 8h6m-6 4h4', back: 'm9 5-7 7 7 7m-7-7h14a5 5 0 0 1 5 5', left: 'm14 5-7 7 7 7', right: 'm10 5 7 7-7 7',
  claude: 'M12 2v20M2 12h20M5 5l14 14M5 19 19 5m-16 3 18 8M8 3l8 18M3 16l18-8M8 21l8-18', 'vs code': 'm3 8 5 4-5 4 2 2 10-9v10l6 3V2l-6 3v10L5 6Z',
  terminal: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 4 4 4-4 4m7 0h5', github: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M8 20v-4m8 4v-4M8 8l-1-3m9 3 1-3M7 11c0 5 10 5 10 0',
  aws: 'M6 16H5a4 4 0 1 1 1-8 6 6 0 0 1 12-1 4.5 4.5 0 0 1 0 9h-1m-9 4 4-4 4 4m-4-4v7'
};
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif', MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';

// ---- Key faces: one canvas for plain ink, one for the parts that glow ----
const faceCache = new Map();
function canvasTexture(draw, w = 512, h = 512) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return texture;
}
function drawIcon(ctx, name, cx, cy, size, color) {
  ctx.save(); ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.lineCap = ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(ICONS[name])); ctx.restore();
}
function face(content, number) {
  const id = `${number}|${content.title}|${content.state}|${content.status || ''}`;
  if (faceCache.has(id)) return faceCache.get(id);
  const { title, icon, state, status } = content;
  const dim = state === 'off', attention = state === 'needs-attention', ink = dim ? '#7f8a9a' : '#e6ebf1';
  const titleY = status ? 322 : 362, iconY = status ? 168 : 196;
  const ink2d = canvasTexture(ctx => {
    if (!title) { ctx.fillStyle = '#4b5666'; ctx.font = `300 96px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('+', 256, 256); return; }
    ctx.fillStyle = '#8795a8'; ctx.font = `500 34px ${MONO}`; ctx.fillText(String(number), 40, 68);
    if (!attention) drawIcon(ctx, icon, 256, iconY, 124, ink);
    ctx.fillStyle = ink; ctx.textAlign = 'center';
    let size = 70; do ctx.font = `600 ${size}px ${SANS}`; while (ctx.measureText(title).width > 464 && (size -= 2) > 30);
    ctx.fillText(title, 256, titleY);
    if (dim && status) { ctx.fillStyle = '#6f7a8a'; ctx.font = `400 40px ${SANS}`; ctx.fillText(status, 256, 404); }
  });
  const glow2d = canvasTexture(ctx => {
    if (!title || dim || !status) return;
    const color = TEXT[state];
    if (attention) drawIcon(ctx, icon, 256, iconY, 124, color);
    ctx.font = `600 50px ${SANS}`; ctx.fillStyle = ctx.strokeStyle = color; ctx.lineWidth = 5;
    const width = ctx.measureText(status).width, x = 256 - (width + 42) / 2, y = 412;
    ctx.beginPath();
    if (attention) { ctx.moveTo(x + 13, y - 33); ctx.lineTo(x + 29, y - 17); ctx.lineTo(x + 13, y - 1); ctx.lineTo(x - 3, y - 17); ctx.closePath(); ctx.fill(); }
    else { ctx.arc(x + 13, y - 17, 13, 0, Math.PI * 2); state === 'idle' ? ctx.stroke() : ctx.fill(); }
    ctx.textAlign = 'left'; ctx.fillText(status, x + 42, y);
  });
  const result = { ink: ink2d, glow: glow2d, state };
  faceCache.set(id, result);
  return result;
}

// ---- Scene ----
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: recording });
renderer.setPixelRatio(DPR); renderer.setSize(W, H);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const BG = new THREE.Color('#0d1117');
scene.background = BG; scene.fog = new THREE.Fog(BG, 13, 24);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 60);
if (!card) camera.setViewOffset(W, H, -W * 0.225, -6, W, H); // push the device into the right-hand side of the banner

const sun = new THREE.DirectionalLight('#ffffff', 2.4);
sun.position.set(-4, 9, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 5; sun.shadow.bias = -0.0004;
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 22 });
scene.add(sun, new THREE.AmbientLight('#9db4d6', 0.35));
const rim = new THREE.DirectionalLight('#7fb0ff', 1.1); rim.position.set(6, 3, -6); scene.add(rim);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.55 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.5; floor.receiveShadow = true; scene.add(floor);
const pool = new THREE.Mesh(new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, map: canvasTexture((ctx, w) => {
  const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  g.addColorStop(0, 'rgba(70,96,138,.42)'); g.addColorStop(0.45, 'rgba(44,60,90,.16)'); g.addColorStop(1, 'rgba(13,17,23,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
}) }));
pool.position.y = -0.51; scene.add(pool);

function trace(s, w, h, r) {
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function roundedRect(w, h, r, hole) {
  const s = trace(new THREE.Shape(), w, h, r);
  if (hole) s.holes.push(trace(new THREE.Path(), w - hole * 2, h - hole * 2, Math.max(0.01, r - hole)));
  return new THREE.ShapeGeometry(s, 8).rotateX(-Math.PI / 2);
}
const device = new THREE.Group(); scene.add(device);
const body = new THREE.Mesh(new RoundedBoxGeometry(4.36, 0.5, 5.16, 8, 0.24), new THREE.MeshStandardMaterial({ color: '#2b323c', metalness: 0.55, roughness: 0.42 }));
body.position.y = -0.25; body.castShadow = body.receiveShadow = true; device.add(body);
const well = new THREE.Mesh(roundedRect(3.74, 3.74, 0.16), new THREE.MeshStandardMaterial({ color: '#0b0e13', roughness: 0.95, metalness: 0 }));
well.position.y = 0.004; well.receiveShadow = true; device.add(well);

function strip(draw, z) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 0.28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: canvasTexture(draw, 1480, 112), transparent: true, depthWrite: false }));
  mesh.position.set(0, 0.006, z); device.add(mesh);
}
strip(ctx => {
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#e2e7ed'; ctx.font = `700 42px ${MONO}`; ctx.fillText('CODEX', 8, 58);
  ctx.fillStyle = '#8f99a8'; ctx.font = `400 34px ${MONO}`; ctx.fillText('/ AGENT KEYPAD', 178, 58);
  ctx.textAlign = 'right'; ctx.fillStyle = '#c3ccd8'; ctx.fillText('DEMO', 1472, 58);
  ctx.fillStyle = '#b7f398'; ctx.beginPath(); ctx.arc(1346, 56, 9, 0, Math.PI * 2); ctx.fill();
}, -2.2);
strip(ctx => {
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#8f99a8'; ctx.font = `400 32px ${MONO}`; ctx.fillText('PROTOTYPE 01', 8, 56);
  ctx.textAlign = 'right'; ctx.fillText('3 × 3', 1472, 56);
  ctx.textAlign = 'center'; ctx.fillStyle = '#12171e'; ctx.font = `700 40px ${MONO}`; ctx.fillText('| | | | | | | | | | | | | | | |', 740, 56);
}, 2.2);

const KEY_H = 0.3, PITCH = 1.18;
const keyGeometry = new RoundedBoxGeometry(1, KEY_H, 1, 5, 0.075);
const faceGeometry = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
const glowGeometry = roundedRect(1.1, 1.1, 0.12, 0.085);
const keys = Array.from({ length: 9 }, (_, i) => {
  const col = i % 3, row = Math.floor(i / 3), x = (col - 1) * PITCH, z = (row - 1) * PITCH;
  const group = new THREE.Group(); group.position.set(x, KEY_H / 2 + 0.02, z);
  const cap = new THREE.Mesh(keyGeometry, new THREE.MeshStandardMaterial({ color: '#222933', roughness: 0.55, metalness: 0.15 }));
  cap.castShadow = cap.receiveShadow = true; group.add(cap);
  const layer = (flip, lift) => {
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, color: new THREE.Color().setScalar(0.84) }); // plain ink stays under the bloom threshold
    const mesh = new THREE.Mesh(faceGeometry, material);
    mesh.position.y = (KEY_H / 2 + lift) * (flip ? -1 : 1); if (flip) mesh.rotation.x = Math.PI;
    group.add(mesh); return material;
  };
  const sides = [{ ink: layer(false, 0.002), glow: layer(false, 0.004) }, { ink: layer(true, 0.002), glow: layer(true, 0.004) }];
  const under = new THREE.Mesh(glowGeometry, new THREE.MeshBasicMaterial());
  under.position.set(x, 0.012, z);
  device.add(group, under);
  return { group, sides, under: under.material, stagger: (col + row) * STAGGER, baseY: group.position.y };
});

const composer = new EffectComposer(renderer);
composer.setPixelRatio(DPR); composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W * DPR, H * DPR), 0.95, 0.6, 0.8));
composer.addPass(new OutputPass());

// ---- Timeline ----
const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const sameFace = (a, b) => a.title === b.title && a.state === b.state && a.status === b.status;
const pulse = (state, t, i) => state === 'needs-attention' ? 0.72 + 0.28 * Math.sin(t * Math.PI * 2) : state === 'working' ? 0.8 + 0.2 * Math.sin(t * Math.PI + i * 1.7) : 1;
const inkLevel = { 'needs-attention': 1.9, working: 1.5, done: 1.45, error: 1.7, idle: 1 };
const from = new THREE.Color(), to = new THREE.Color(), accent = new THREE.Color('#b7f398');
function glowOf(content, t, i, target) {
  const [color, level] = GLOW[content.state];
  return target.set(color).multiplyScalar(level * pulse(content.state, t, i));
}
function paint(side, content, i, t) {
  const f = face(content, i + 1);
  if (side.ink.map !== f.ink) { side.ink.map = f.ink; side.glow.map = f.glow; side.ink.needsUpdate = side.glow.needsUpdate = true; }
  side.glow.color.setScalar((inkLevel[content.state] || 1) * pulse(content.state, t, i));
}
const crumbs = document.getElementById('crumbs');
let shownCrumbs = '';

function renderAt(time, view = {}) {
  const t = ((time % LOOP) + LOOP) % LOOP;
  keys.forEach((k, i) => {
    let index = 0;
    STEPS.forEach((step, n) => { if (t >= step.t + k.stagger) index = n; });
    const current = PAGES[STEPS[index].page][i], previous = PAGES[STEPS[(index + STEPS.length - 1) % STEPS.length].page][i];
    const p = (t - STEPS[index].t - k.stagger) / FLIP, flipping = p < 1 && !sameFace(previous, current), e = flipping ? ease(p) : 1;
    paint(k.sides[0], flipping ? previous : current, i, t);
    if (flipping) paint(k.sides[1], current, i, t);
    k.group.rotation.x = flipping ? e * Math.PI : 0;
    let y = k.baseY + (flipping ? Math.sin(p * Math.PI) * LIFT : 0), flare = 0;
    for (const press of PRESSES) {
      const q = (t - press.t) / PRESS;
      if (press.k === i && q >= 0 && q < 1) { y -= 0.085 * Math.sin(Math.min(1, q * 1.6) * Math.PI); flare = Math.max(flare, Math.pow(1 - q, 1.5)); }
    }
    k.group.position.y = y;
    glowOf(previous, t, i, from); glowOf(current, t, i, to);
    k.under.color.copy(flipping ? from.lerp(to, e) : to).lerp(accent, flare * 0.85).multiplyScalar(1 + flare * 2.2);
  });
  let page = 0;
  STEPS.forEach((step, n) => { if (t >= step.t) page = n; });
  const label = STEPS[page].crumbs.join('›');
  if (label !== shownCrumbs) { shownCrumbs = label; crumbs.innerHTML = STEPS[page].crumbs.map(c => `<b>${c}</b>`).join('<span>›</span>'); }

  const a = (t / LOOP) * Math.PI * 2, azimuth = view.azimuth ?? -0.28 + 0.15 * Math.sin(a), elevation = view.elevation ?? 0.97 + 0.04 * Math.cos(a), radius = view.radius ?? 12;
  camera.position.set(Math.sin(azimuth) * Math.cos(elevation) * radius, Math.sin(elevation) * radius, Math.cos(azimuth) * Math.cos(elevation) * radius);
  camera.lookAt(...(view.target ?? [0, -0.2, 0.3]));
  composer.render();
}

// Warm every face once so no frame pays for canvas work mid-flip.
Object.values(PAGES).forEach(page => page.forEach((content, i) => face(content, i + 1)));
window.renderAt = renderAt;
renderAt(0);
window.heroReady = { loop: LOOP, width: W, height: H };
if (!recording) {
  const fit = () => { stage.style.transform = `scale(${Math.min(1, innerWidth / W)})`; };
  addEventListener('resize', fit); fit();
  const tick = now => { renderAt(now / 1000); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
