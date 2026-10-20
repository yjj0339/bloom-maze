/**
 * main.js — 引导、状态机、渲染循环、画质分档与泛光后处理
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { Store, AudioKit, clamp, damp, fmtTime, TAU } from './lib.js';
import { LEVELS, buildMaze } from './maze.js';
import { createWorld } from './world.js';
import { makeSky } from './art.js';
import { Player, EYE } from './player.js';
import { Input } from './input.js';
import { UI, rankOf } from './ui.js';

/* ─────────── 诊断钩子（取证 / 回归用） ─────────── */
window.__errs = [];
window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errs.push('rejection: ' + String(e.reason)));

const $ = (id) => document.getElementById(id);

const isCoarse = window.matchMedia('(pointer: coarse)').matches;
const isTouchDevice = isCoarse || (navigator.maxTouchPoints || 0) > 0 || ('ontouchstart' in window);
// 判定不能只靠单一信号：真手机三者齐备，模拟器可能只给其中一个
const isMobile = isTouchDevice || Math.min(window.innerWidth, window.innerHeight) < 620;

let isFresh = false;
try { isFresh = !localStorage.getItem('bloom-maze-v1'); } catch (e) { isFresh = true; }
Store.isFresh = isFresh;
const store = Store.load();
if (Store.isFresh) {
  store.settings.quality = isMobile ? 'low' : 'high';
  Store.save();
}

/* ─────────── 渲染器 ─────────── */
const app = $('app');
const renderer = new THREE.WebGLRenderer({
  antialias: !isMobile,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;   // 用 EffectComposer 时 info 会被最后一个 pass 重置
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xFFEED8, 34, 195);
const camera = new THREE.PerspectiveCamera(76, 1, 0.1, 1400);
const sky = makeSky();
scene.add(sky);

const audio = new AudioKit();
const ui = new UI();
const input = new Input(app);

/* ─────────── 画质分档 ─────────── */
let composer = null;
let bloom = null;

function applyQuality(q) {
  store.settings.quality = q;
  Store.save();
  renderer.shadowMap.enabled = q !== 'low';
  const pr = q === 'high' ? Math.min(window.devicePixelRatio || 1, 2)
    : q === 'mid' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
  renderer.setPixelRatio(pr);
  const wantBloom = q === 'high';
  if (wantBloom && !composer) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.34, 0.6, 1.0);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  useBloom = wantBloom;
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  onResize();
}
let useBloom = false;

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  if (composer) composer.setSize(w, h);
  if (G.player) G.player.setAspect(camera.aspect);
  ui.resizeMap();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 220));

/* ─────────── 游戏状态 ─────────── */
const G = {
  state: 'boot',           // boot | title | playing | paused | finishing | win
  level: null,
  maze: null,
  world: null,
  player: null,
  time: 0,
  gameClock: 0,
  fruitsGot: 0,
  t: 0,
  finishT: 0,
  attract: 0,
  lastToastAt: -1,
};

const flash = document.createElement('div');
flash.id = 'flash';
flash.style.cssText = 'position:fixed;inset:0;z-index:30;background:#FFFDF6;opacity:0;pointer-events:none;transition:opacity .5s ease';
document.body.appendChild(flash);

function disposeLevel() {
  if (G.world) { G.world.dispose(); G.world = null; }
  G.maze = null;
}

function buildLevel(level, { attract = false } = {}) {
  disposeLevel();
  G.level = level;
  G.maze = buildMaze(level);
  G.world = createWorld(scene, G.maze, store.settings.quality);
  G.player = new Player(G.maze, camera);
  G.player.fovBase = store.settings.fov;
  G.player.bobEnabled = store.settings.bob;
  G.player.setFov(store.settings.fov);
  G.player.onStep = (f) => audio.step(f);
  let lastBump = 0;
  G.player.onBump = (force) => {
    const now = performance.now();
    if (now - lastBump < 260) return;
    lastBump = now;
    audio.bump(force * 2.2);
  };
  G.player.setAspect(camera.aspect);
  G.player.setFov(store.settings.fov);

  ui.prepare(G.maze);
  ui.setExplore(G.world.reveal, 0);
  ui.setLevel(level);
  ui.setCount(0, level.fruits);
  G.fruitsGot = 0;
  G.time = 0;
  ui.setTime(0);

  const yaw = attract ? 0 : G.player.faceInward(G.maze);
  G.player.reset(G.maze.start.x, G.maze.start.z, yaw);

  scene.fog.near = Math.max(20, Math.min(46, level.cols * 1.5));
  scene.fog.far = scene.fog.near + (attract ? 210 : 165);
  return G.maze;
}

function startLevel(level) {
  buildLevel(level);
  G.state = 'playing';
  ui.hideAll();
  ui.setHud(true);
  ui.applyFlags();
  input.enabled = true;
  input.applyTouchMode(isMobile);
  if (!isMobile) input.requestLock();
  ui.toast(level.hint, 3200);
  audio.resume();
  G.lastToastAt = -1;
}

function pause() {
  if (G.state !== 'playing') return;
  G.state = 'paused';
  input.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('p-time').textContent = fmtTime(G.time, false);
  $('p-count').textContent = `${G.fruitsGot}/${G.level.fruits}`;
  $('p-explored').textContent = Math.round(G.world.exploredRatio() * 100) + '%';
  ui.show('screen-pause');
  audio.ui(false);
}

function resume() {
  if (G.state !== 'paused') return;
  G.state = 'playing';
  input.enabled = true;
  ui.hideAll();
  if (!isMobile) input.requestLock();
  audio.ui(true);
}

function toTitle() {
  G.state = 'title';
  input.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  ui.setHud(false);
  ui.stopConfetti();
  buildLevel(LEVELS[0], { attract: true });
  ui.buildLevels(startLevel);
  ui.show('screen-title');
  $('touch').classList.add('hidden');
}

function finishRun() {
  if (G.state !== 'playing') return;
  G.state = 'finishing';
  G.finishT = 0;
  // 记录进入方向，收尾镜头沿它前视（lookAt 与相机同轴会翻滚）
  const sy = Math.sin(G.player.yaw), cy = Math.cos(G.player.yaw);
  G.finishDir = { x: -sy, z: -cy };
  input.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  audio.portal();
  ui.toast('穿过花拱门…', 1400);
}

function commitWin() {
  const lv = G.level;
  const explored = G.world.exploredRatio();
  const perfect = G.fruitsGot >= lv.fruits;
  const rank = rankOf(G.time, G.maze.par, G.fruitsGot, lv.fruits);
  const rec = {
    time: G.time, fruits: G.fruitsGot, total: lv.fruits, rank,
    explored: +explored.toFixed(3), distance: Math.round(G.player.distance),
    at: Date.now(),
  };
  const { improved, prev } = Store.submit(lv.id, rec);
  G.state = 'win';
  audio.win();
  ui.showWin({
    level: lv, rank, time: G.time, fruits: G.fruitsGot, total: lv.fruits,
    explored, distance: G.player.distance, perfect,
    improved, prev, bestTime: (Store.best(lv.id) || rec).time,
  });
  ui.buildLevels(startLevel);
}

function goNext() {
  const i = LEVELS.findIndex((l) => l.id === G.level.id);
  ui.stopConfetti();
  if (i < 0 || i >= LEVELS.length - 1) { toTitle(); return; }
  startLevel(LEVELS[i + 1]);
}

/* ─────────── 事件绑定 ─────────── */
function bindUI() {
  const clickSound = () => audio.ui(true);

  $('btn-play').addEventListener('click', () => {
    clickSound();
    const unlocked = clamp(Store.data.unlocked, 1, LEVELS.length);
    // 有进度就从最新解锁的那庭继续，否则第一庭
    const lv = LEVELS.find((l) => l.id === (Store.best(unlocked) ? Math.min(unlocked + 1, LEVELS.length) : unlocked)) || LEVELS[0];
    startLevel(lv);
  });
  $('btn-levels').addEventListener('click', () => { clickSound(); ui.buildLevels(startLevel); ui.show('screen-levels'); });
  $('btn-settings').addEventListener('click', () => { clickSound(); ui.show('screen-settings'); });
  $('btn-pause-settings').addEventListener('click', () => { clickSound(); ui.show('screen-settings'); });
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => {
      clickSound();
      ui.hide(b.dataset.close);
      if (b.dataset.close === 'screen-settings' && G.state === 'paused') ui.show('screen-pause');
      if (b.dataset.close === 'screen-levels' && G.state === 'title') ui.show('screen-title');
    })
  );

  $('btn-pause').addEventListener('click', pause);
  $('btn-resume').addEventListener('click', resume);
  $('btn-restart').addEventListener('click', () => { clickSound(); startLevel(G.level); });
  $('btn-quit').addEventListener('click', () => { clickSound(); toTitle(); });
  $('btn-map').addEventListener('click', () => {
    clickSound();
    ui.showMap = !ui.showMap;
    store.settings.minimap = ui.showMap;
    Store.save();
    ui.applyFlags();
    $('btn-map').classList.toggle('off', !ui.showMap);
  });
  $('minimap-panel').addEventListener('click', () => ui.toggleMapMode());
  $('btn-sound').addEventListener('click', () => {
    store.settings.audio = !store.settings.audio;
    Store.save();
    audio.setMuted(!store.settings.audio);
    ui.syncSettings();
    if (store.settings.audio) { audio.resume(); audio.ui(true); }
  });

  $('btn-next').addEventListener('click', () => { clickSound(); goNext(); });
  $('btn-win-retry').addEventListener('click', () => { clickSound(); ui.stopConfetti(); startLevel(G.level); });
  $('btn-win-home').addEventListener('click', () => { clickSound(); toTitle(); });

  $('btn-reset').addEventListener('click', () => {
    Store.reset();
    ui.buildLevels(startLevel);
    ui.syncSettings();
    ui.toast('进度已清空');
    audio.ui(false);
  });

  // 设置项
  const sens = $('set-sens'), fov = $('set-fov');
  sens.addEventListener('input', () => {
    store.settings.sens = +sens.value;
    $('set-sens-v').textContent = (+sens.value / 100).toFixed(2);
    input.sens = +sens.value;
    Store.save();
  });
  fov.addEventListener('input', () => {
    store.settings.fov = +fov.value;
    $('set-fov-v').textContent = fov.value + '°';
    if (G.player) G.player.setFov(+fov.value);
    Store.save();
  });
  const tog = (id, key, after) => {
    $(id).addEventListener('click', () => {
      store.settings[key] = !store.settings[key];
      Store.save();
      ui.syncSettings();
      audio.ui(store.settings[key]);
      if (after) after(store.settings[key]);
    });
  };
  tog('set-bob', 'bob', (v) => { if (G.player) G.player.bobEnabled = v; });
  tog('set-rotmap', 'rotMap', (v) => { ui.rotMap = v; });
  tog('set-invert', 'invert', (v) => { input.invertY = v; });
  tog('set-audio', 'audio', (v) => { audio.setMuted(!v); if (v) audio.resume(); });
  tog('set-minimap', 'minimap', (v) => { ui.showMap = v; ui.applyFlags(); $('btn-map').classList.toggle('off', !v); });
  tog('set-compass', 'compass', (v) => { ui.showCompass = v; ui.applyFlags(); });

  document.querySelectorAll('#set-quality button').forEach((b) => {
    b.addEventListener('click', () => {
      const q = b.dataset.v;
      if (q === store.settings.quality) return;
      audio.ui(true);
      applyQuality(q);
      ui.syncSettings();
      // 构件密度与阴影随画质变化 → 需要重建当前庭园
      if (G.state === 'playing' || G.state === 'paused') {
        const t = G.time, got = G.fruitsGot, reveal = G.world ? G.world.reveal.slice() : null;
        const px = G.player.pos.x, pz = G.player.pos.y, yaw = G.player.yaw, pitch = G.player.pitch;
        startLevel(G.level);
        G.time = t; G.fruitsGot = got;
        ui.setTime(t); ui.setCount(got, G.level.fruits);
        G.player.reset(px, pz, yaw); G.player.pitch = pitch; G.player.syncCamera(0);
        if (reveal) {
          for (let i = 0; i < reveal.length; i++) if (reveal[i] > 0) { G.world.seen[i] = 1; G.world.reveal[i] = reveal[i]; }
        }
      } else if (G.state === 'title') {
        buildLevel(LEVELS[0], { attract: true });
      }
    });
  });

  // 输入回调
  input.onPause = () => {
    if (G.state === 'playing') pause();
    else if (G.state === 'paused') resume();
  };
  input.onLockChange = (locked) => {
    if (!locked && G.state === 'playing' && !isMobile) pause();
  };
  input.onFirstGesture = () => { audio.resume(); };

  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && G.state === 'playing') { $('btn-map').click(); }
    if (e.code === 'Tab' && G.state === 'playing') { e.preventDefault(); ui.toggleMapMode(); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.state === 'playing') pause();
  });

  // 防止 iOS 双击缩放 / 长按菜单
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
}

/* ─────────── 每帧 ─────────── */
function step(dt) {
  G.t += dt;
  ui.tickToast();

  if (G.state === 'title') {
    G.attract += dt;
    const m = G.maze;
    const span = Math.max(m.W, m.D);
    const r = span * 0.66 + 9;
    const a = G.attract * 0.05;
    camera.position.set(Math.cos(a) * r, 5.6 + Math.sin(G.attract * 0.21) * 1.2, Math.sin(a) * r);
    camera.lookAt(Math.cos(a + 2.4) * span * 0.16, 2.3, Math.sin(a + 2.4) * span * 0.16);
    G.world.update(dt, G.t, { x: camera.position.x, z: camera.position.z });
    audio.ambience(G.t);
    return;
  }

  if (G.state === 'finishing') {
    G.finishT += dt;
    const k = clamp(G.finishT / 1.15, 0, 1);
    const e = G.maze.exit;
    camera.position.set(
      damp(G.player.pos.x, e.x, 3.4, dt),
      damp(EYE, 2.5, 3.0, dt),
      damp(G.player.pos.y, e.z, 3.4, dt)
    );
    camera.fov = damp(camera.fov, 42, 3.2, dt);
    camera.updateProjectionMatrix();
    const fd = G.finishDir || { x: 0, z: -1 };
    camera.lookAt(camera.position.x + fd.x * 5, 2.55 + k * 0.5, camera.position.z + fd.z * 5);
    flash.style.opacity = String(Math.pow(k, 1.7) * 0.96);
    G.world.update(dt, G.t, { x: camera.position.x, z: camera.position.z });
    if (G.finishT >= 1.15) {
      commitWin();
      setTimeout(() => { flash.style.opacity = '0'; }, 60);
    }
    return;
  }

  if (G.state !== 'playing') {
    if (G.world) G.world.update(dt, G.t, { x: camera.position.x, z: camera.position.z });
    return;
  }

  G.time += dt;
  input.poll();
  input.sens = store.settings.sens;
  input.invertY = store.settings.invert;
  G.player.update(dt, input);

  const p = G.player;
  G.world.update(dt, G.t, { x: p.pos.x, z: p.pos.y });
  G.world.markExplored(p.pos.x, p.pos.y);
  ui.setExplore(G.world.reveal, G.world.exploredRatio());
  audio.ambience(G.t);

  // 星果拾取
  const got = G.world.collectNear(p.pos.x, p.pos.y, EYE);
  for (const i of got) {
    if (!G.world.takeFruit(i)) continue;
    G.fruitsGot++;
    audio.pickup(G.fruitsGot - 1);
    ui.setCount(G.fruitsGot, G.level.fruits);
    ui.popCount();
    const left = G.level.fruits - G.fruitsGot;
    if (left === 0) ui.toast('全部星果到手！去找花拱门', 2800);
    else if (left === Math.ceil(G.level.fruits / 2)) ui.toast(`过半了，还剩 ${left} 枚`, 2200);
  }

  // HUD
  ui.setTime(G.time);
  const dExit = p.distanceTo(G.maze.exit.x, G.maze.exit.z);
  ui.setCompass(p.bearingTo(G.maze.exit.x, G.maze.exit.z), dExit);
  ui.drawMinimap({ x: p.pos.x, z: p.pos.y }, G.world.fruits, G.maze.exit, p.yaw);

  // 提示：首次靠近出口
  if (dExit < 9 && G.lastToastAt !== G.level.id) {
    G.lastToastAt = G.level.id;
    ui.toast('花拱门就在附近', 2000);
  }

  // 到达出口
  if (dExit < 1.45) finishRun();
}

function render() {
  renderer.info.reset();
  if (useBloom && composer) composer.render();
  else renderer.render(scene, camera);
}

/* ─────────── 主循环 ─────────── */
let last = performance.now();
let acc = 0;
let fpsT = 0, fpsN = 0, fps = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 1 / 60;
  step(dt);
  render();
  fpsN++;
  fpsT += dt;
  if (fpsT >= 0.5) { fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
}

/* ─────────── 测试 / 取证钩子 ─────────── */
const engine = {
  G, renderer, scene, camera, ui, input, audio,
  step, render, applyQuality, startLevel, buildLevel, toTitle,
  LEVELS,
  get fps() { return fps; },
  /** 定步长推进（后台标签 rAF 被节流时用这个量真实帧时间） */
  tick(n, dt = 1 / 60) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      step(dt);
      render();
      out.push(performance.now() - t0);
    }
    return { avg: out.reduce((a, b) => a + b, 0) / out.length, max: Math.max(...out) };
  },
  teleport(x, z, yaw) {
    if (!G.player) return;
    G.player.pos.set(x, z);
    if (yaw !== undefined) G.player.yaw = yaw;
    G.player.vel.set(0, 0);
    G.player.syncCamera(0);
  },
  info() {
    const i = renderer.info;
    return {
      calls: i.render.calls, tris: i.render.triangles, points: i.render.points,
      geo: i.memory.geometries, tex: i.memory.textures, programs: i.programs ? i.programs.length : -1,
      fps, state: G.state, dpr: renderer.getPixelRatio(),
      gpu: (() => {
        try {
          const gl = renderer.getContext();
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'n/a';
        } catch (e) { return 'n/a'; }
      })(),
    };
  },
  worldStats() { return G.world ? G.world.stats : null; },
};
window.engine = engine;
window.__stats = () => engine.info();

/* ─────────── 启动 ─────────── */
function boot() {
  const st = store.settings;
  // 触屏设备上沿用桌面 high 档会拖垮帧率：降一档（保留阴影、关泛光）
  if (isMobile && st.quality === 'high') { st.quality = 'mid'; Store.save(); }
  input.sens = st.sens;
  input.invertY = st.invert;
  ui.showMap = st.minimap;
  ui.showCompass = st.compass;
  ui.rotMap = !!st.rotMap;
  audio.enabled = st.audio;
  ui.syncSettings();
  ui.applyFlags();
  $('btn-map').classList.toggle('off', !st.minimap);
  input.applyTouchMode(isMobile);

  applyQuality(st.quality);
  onResize();
  bindUI();

  // 首帧需要一次用户手势才能起音频，先静音待命
  audio.setMuted(true);
  const unlock = () => {
    audio.resume();
    audio.setMuted(!store.settings.audio);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  toTitle();
  requestAnimationFrame((t) => { last = t; frame(t); });
  $('screen-loading').classList.add('hidden');
  document.title = '花庭迷宫 · BLOOM MAZE';
}

boot();
