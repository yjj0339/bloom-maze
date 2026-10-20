/**
 * input.js — 桌面（键盘 + 指针锁鼠标）与移动端（动态摇杆 + 拖拽视角）双端输入
 */
import { clamp } from './lib.js';

const STICK_R = 52;
const DEAD = 0.16;

export class Input {
  constructor(appEl) {
    this.app = appEl;
    this.move = { x: 0, y: 0 };      // x = 横移，y = 前进
    this.look = { dx: 0, dy: 0 };    // 每帧被 player 消费后清零
    this.run = false;
    this.dashLatch = false;          // 移动端冲刺按钮的锁定态
    this.enabled = true;
    this.sens = 100;
    this.invertY = false;
    this.locked = false;
    this.touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.onPause = null;
    this.onLockChange = null;
    this.onFirstGesture = null;

    this.keys = new Set();
    this._stickId = null;
    this._stickOx = 0;
    this._stickOy = 0;
    this._looks = new Map();         // touchId → {x,y}
    this._mouseDown = false;

    this.el = {
      stickZone: document.getElementById('stick-zone'),
      stick: document.getElementById('stick'),
      knob: document.getElementById('stick-knob'),
      dash: document.getElementById('btn-dash'),
      touchLayer: document.getElementById('touch'),
    };

    this._bindKeyboard();
    this._bindMouse();
    this._bindTouch();
  }

  _bindKeyboard() {
    const code = (e) => e.code;
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(code(e))) e.preventDefault();
      if (this.keys.has(code(e))) return;
      this.keys.add(code(e));
      this._gesture();
      if (code(e) === 'Escape' || code(e) === 'KeyP') { if (this.onPause) this.onPause(); }
      if (code(e) === 'ShiftLeft' || code(e) === 'ShiftRight') this.run = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(code(e));
      if (code(e) === 'ShiftLeft' || code(e) === 'ShiftRight') this.run = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.run = false; });
  }

  _gesture() {
    if (this.onFirstGesture) { const f = this.onFirstGesture; this.onFirstGesture = null; f(); }
  }

  requestLock() {
    if (this.touch) return;
    const el = this.app;
    if (!el || !el.requestPointerLock) return;
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(() => { try { el.requestPointerLock(); } catch (e) { /* ignore */ } });
    } catch (e) {
      try { el.requestPointerLock(); } catch (e2) { /* ignore */ }
    }
  }

  _bindMouse() {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.app;
      document.body.classList.toggle('locked', this.locked);
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.locked = false; });

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) {
        this.look.dx += e.movementX || 0;
        this.look.dy += e.movementY || 0;
      } else if (this._mouseDown) {
        this.look.dx += (e.movementX || 0) * 1.25;
        this.look.dy += (e.movementY || 0) * 1.25;
      }
    });

    this.app.addEventListener('mousedown', (e) => {
      this._gesture();
      if (!this.enabled) return;
      if (e.button === 0) {
        this._mouseDown = true;
        if (!this.locked) this.requestLock();
      }
    });
    window.addEventListener('mouseup', () => { this._mouseDown = false; });
    this.app.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _bindTouch() {
    const zone = this.el.stickZone;
    const stick = this.el.stick;
    const knob = this.el.knob;

    const hideStick = () => {
      this._stickId = null;
      stick.classList.add('hidden');
      this.move.x = 0;
      this.move.y = 0;
    };

    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this._gesture();
      if (this._stickId !== null) return;
      const t = e.changedTouches[0];
      this._stickId = t.identifier;
      this._stickOx = t.clientX;
      this._stickOy = t.clientY;
      stick.classList.remove('hidden');
      stick.style.left = t.clientX + 'px';
      stick.style.top = t.clientY + 'px';
      knob.style.transform = 'translate(0,0)';
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== this._stickId) continue;
        let dx = t.clientX - this._stickOx;
        let dy = t.clientY - this._stickOy;
        const len = Math.hypot(dx, dy);
        if (len > STICK_R) { dx = (dx / len) * STICK_R; dy = (dy / len) * STICK_R; }
        knob.style.transform = `translate(${dx}px,${dy}px)`;
        const nx = dx / STICK_R, ny = -dy / STICK_R;
        const m = Math.hypot(nx, ny);
        if (m < DEAD) { this.move.x = 0; this.move.y = 0; }
        else {
          const k = (m - DEAD) / (1 - DEAD) / (m || 1);
          this.move.x = clamp(nx * k, -1, 1);
          this.move.y = clamp(ny * k, -1, 1);
        }
      }
    }, { passive: false });

    const endStick = (e) => {
      for (const t of e.changedTouches) if (t.identifier === this._stickId) { hideStick(); break; }
    };
    zone.addEventListener('touchend', endStick);
    zone.addEventListener('touchcancel', endStick);

    // 视角拖拽：落在 3D 画布上的触点
    this.app.addEventListener('touchstart', (e) => {
      this._gesture();
      if (!this.enabled) return;
      for (const t of e.changedTouches) this._looks.set(t.identifier, { x: t.clientX, y: t.clientY });
    }, { passive: true });

    this.app.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        const p = this._looks.get(t.identifier);
        if (!p) continue;
        this.look.dx += (t.clientX - p.x) * 1.9;
        this.look.dy += (t.clientY - p.y) * 1.9;
        p.x = t.clientX;
        p.y = t.clientY;
      }
    }, { passive: false });

    const endLook = (e) => { for (const t of e.changedTouches) this._looks.delete(t.identifier); };
    this.app.addEventListener('touchend', endLook);
    this.app.addEventListener('touchcancel', endLook);

    // 冲刺按钮（按住或点按锁定）
    const dash = this.el.dash;
    const setDash = (on) => {
      dash.classList.toggle('on', on);
      this.run = on;
    };
    dash.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this._gesture();
      this.dashLatch = !this.dashLatch;
      setDash(this.dashLatch);
    }, { passive: false });
    dash.addEventListener('click', (e) => e.preventDefault());
    this.setDashVisual = () => setDash(this.dashLatch);
  }

  /** 每帧从键盘刷新移动轴（触屏时由摇杆直接写 move） */
  poll() {
    if (this.touch && this._stickId !== null) { /* 摇杆已写入 */ }
    else {
      let x = 0, y = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
      this.move.x = x;
      this.move.y = y;
    }
    if (!this.touch) this.run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  applyTouchMode(on) {
    document.body.classList.toggle('touch', on);
    this.el.touchLayer.classList.toggle('hidden', !on);
  }
}
