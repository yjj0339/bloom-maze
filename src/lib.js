/**
 * lib.js — 通用工具：种子随机、数学、存档、WebAudio 合成音效
 */

/* ─────────────── 随机 ─────────────── */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 带工具方法的随机源 */
export function makeRng(seed) {
  const next = typeof seed === 'function' ? seed : mulberry32(typeof seed === 'string' ? hashString(seed) : seed);
  return {
    next,
    float: (a = 1, b) => (b === undefined ? a * next() : a + (b - a) * next()),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
}

/* ─────────────── 数学 ─────────────── */

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
/** 帧率无关的指数趋近 */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
export const shortAngle = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};

export function fmtTime(sec, cs = true) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  const base = String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  if (!cs) return base;
  return base + '.' + String(Math.floor((s % 1) * 100)).padStart(2, '0');
}

/* ─────────────── 存档 ─────────────── */

const KEY = 'bloom-maze-v1';

const DEFAULTS = {
  unlocked: 1,
  best: {}, // { [levelId]: {time, fruits, total, rank, explored} }
  settings: {
    sens: 100,
    fov: 76,
    bob: true,
    rotMap: false,
    invert: false,
    quality: 'mid',
    audio: true,
    minimap: true,
    compass: true,
  },
};

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k in over || {}) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object') out[k] = deepMerge(base[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

export const Store = {
  data: deepMerge(DEFAULTS, {}),
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = deepMerge(DEFAULTS, JSON.parse(raw));
    } catch (e) {
      /* 隐私模式下 localStorage 可能抛错，走内存态 */
    }
    return this.data;
  },
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) { /* ignore */ }
  },
  set(patch) {
    this.data = deepMerge(this.data, patch);
    this.save();
  },
  setSetting(k, v) {
    this.data.settings[k] = v;
    this.save();
  },
  best(id) {
    return this.data.best[id] || null;
  },
  submit(id, rec) {
    const prev = this.data.best[id];
    const isNew = !prev || rec.time < prev.time;
    if (isNew) this.data.best[id] = rec;
    if (id + 1 > this.data.unlocked) this.data.unlocked = Math.min(99, id + 1);
    this.save();
    return { improved: isNew, prev };
  },
  reset() {
    const settings = this.data.settings;
    this.data = deepMerge(DEFAULTS, {});
    this.data.settings = settings;
    this.save();
  },
};

/* ─────────────── WebAudio 全合成音效 ─────────────── */

export class AudioKit {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.ready = false;
    this._lastStep = 0;
    this._nextChirp = 4;
  }

  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    // 噪声缓冲（脚步 / 风声共用）
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    this._buildAmbience();
    this.ready = true;
    this.setMuted(!this.enabled);
    return ctx;
  }

  resume() {
    const ctx = this.init();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  setMuted(m) {
    this.enabled = !m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 0.85, t, 0.12);
    if (this.ambGain) this.ambGain.gain.setTargetAtTime(m ? 0 : 1, t, 0.4);
  }

  _buildAmbience() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    g.connect(lp).connect(this.master);
    this.ambGain = g;

    // 柔和垫音：两个略微失谐的正弦 + 五度
    [110, 164.81, 220].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      o.detune.value = (i - 1) * 6;
      const og = ctx.createGain();
      og.gain.value = i === 2 ? 0.05 : 0.1;
      o.connect(og).connect(g);
      o.start();
    });

    // 微风：噪声经带通，缓慢起伏
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.7;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    wind.connect(bp).connect(wg).connect(g);
    wind.start();

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.035;
    lfo.connect(lfoG).connect(wg.gain);
    lfo.start();

    g.gain.setTargetAtTime(this.enabled ? 1 : 0, ctx.currentTime, 1.2);
  }

  _env(node, t, a, d, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    node.connect(g);
    return g;
  }

  /** 鸟鸣：随机音高的短促上滑哨音 */
  chirp(when = 0) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = 1500 + Math.random() * 1400;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.3 + Math.random() * 0.7), t + 0.06);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + 0.15);
    const g = this._env(o, t, 0.012, 0.14, 0.055);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.24);
    if (Math.random() < 0.55) this.chirp(when + 0.16 + Math.random() * 0.1);
  }

  /** 环境音调度：每帧调用，按游戏时间随机鸟鸣 */
  ambience(gameTime) {
    if (!this.ready || !this.enabled) return;
    if (gameTime > this._nextChirp) {
      this.chirp();
      this._nextChirp = gameTime + 5 + Math.random() * 11;
    }
  }

  step(intensity = 1) {
    if (!this.ready || !this.enabled) return;
    const now = performance.now();
    if (now - this._lastStep < 150) return;
    this._lastStep = now;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.85 + Math.random() * 0.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 620 + Math.random() * 620;
    bp.Q.value = 1.1;
    const g = this._env(bp, t, 0.006, 0.075, 0.1 * intensity);
    s.connect(bp);
    g.connect(this.master);
    s.start(t, Math.random() * 1.5, 0.2);
    s.stop(t + 0.2);
  }

  pickup(index = 0) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const scale = [0, 2, 4, 7, 9, 11, 14, 16, 19, 21, 24, 26];
    const semi = scale[Math.min(index, scale.length - 1)];
    const f = 659.25 * Math.pow(2, semi / 12);
    [[f, 'sine', 0.16], [f * 2, 'triangle', 0.06], [f * 3.01, 'sine', 0.025]].forEach(([freq, type, amp]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = this._env(o, t, 0.008, 0.42, amp);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.6);
    });
  }

  ui(up = true) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(up ? 520 : 420, t);
    o.frequency.exponentialRampToValueAtTime(up ? 780 : 300, t + 0.07);
    const g = this._env(o, t, 0.005, 0.07, 0.07);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
  }

  portal() {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const notes = [261.63, 329.63, 392.0, 523.25];
    notes.forEach((f, i) => {
      const t = t0 + i * 0.085;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this._env(o, t, 0.02, 0.9, 0.11);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 1.1);
      const o2 = ctx.createOscillator();
      o2.type = 'triangle';
      o2.frequency.value = f * 2;
      const g2 = this._env(o2, t, 0.01, 0.5, 0.03);
      g2.connect(this.master);
      o2.start(t);
      o2.stop(t + 0.7);
    });
  }

  win() {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.1;
    const mel = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
    mel.forEach((f, i) => {
      const t = t0 + i * 0.13;
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      const g = this._env(o, t, 0.012, i === mel.length - 1 ? 1.5 : 0.42, 0.13);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 1.8);
    });
    // 低频铺底
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = 130.81;
    const bg = this._env(b, t0, 0.05, 1.6, 0.1);
    bg.connect(this.master);
    b.start(t0);
    b.stop(t0 + 2);
  }

  bump(force = 1) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = this._env(lp, t, 0.004, 0.09, 0.07 * Math.min(1, force));
    s.connect(lp);
    g.connect(this.master);
    s.start(t, Math.random(), 0.16);
    s.stop(t + 0.2);
  }

  dispose() {
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.ready = false;
  }
}
