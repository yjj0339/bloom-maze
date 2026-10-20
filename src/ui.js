/**
 * ui.js — HUD、探索式小地图（跟随窗 / 全图两档）、菜单抽屉、胜利结算与彩带
 */
import { LEVELS, CELL } from './maze.js';
import { Store, fmtTime, clamp, TAU } from './lib.js';

const $ = (id) => document.getElementById(id);

export const RANK_ORDER = ['S', 'A', 'B', 'C'];

export function rankOf(time, par, fruitsGot, fruitsTotal) {
  const perfect = fruitsGot >= fruitsTotal;
  if (perfect && time <= par * 0.85) return 'S';
  if (time <= par * 1.15) return perfect ? 'S' : 'A';
  if (time <= par * 1.75) return 'B';
  return 'C';
}

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'),
      level: $('hud-level'),
      time: $('hud-time'),
      count: $('hud-count'),
      total: $('hud-total'),
      fruits: $('hud-fruits'),
      dist: $('hud-dist'),
      compass: $('hud-compass'),
      compassIco: document.querySelector('#hud-compass .ico'),
      toast: $('toast'),
      mapPanel: $('minimap-panel'),
      mapTag: $('minimap-tag'),
      map: $('minimap'),
      confetti: $('confetti'),
      titleFoot: $('title-foot'),
      levelList: $('level-list'),
    };
    this.ctx = this.el.map.getContext('2d');
    this.cctx = this.el.confetti.getContext('2d');
    this.mapMode = 'follow';   // follow | full
    this.rotMap = false;
    this.showMap = true;
    this.showCompass = true;
    this.walls = [];
    this.fruitCells = [];
    this.dpr = 1;
    this._toastT = 0;
    this._confetti = null;
    this._rafConf = 0;
    this.resizeMap();
  }

  /* ─────────── 屏幕切换 ─────────── */
  screens = ['screen-title', 'screen-levels', 'screen-settings', 'screen-pause', 'screen-win'];

  show(name) {
    for (const s of this.screens) $(s).classList.toggle('hidden', s !== name);
  }
  hide(name) { $(name).classList.add('hidden'); }
  hideAll() { for (const s of this.screens) $(s).classList.add('hidden'); }
  visible(name) { return !$(name).classList.contains('hidden'); }
  anyScreen() { return this.screens.some((s) => !$(s).classList.contains('hidden')); }

  setHud(on) { this.el.hud.classList.toggle('hidden', !on); }

  toast(msg, ms = 2100) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.add('show');
    this._toastT = performance.now() + ms;
  }
  tickToast() {
    if (this._toastT && performance.now() > this._toastT) {
      this._toastT = 0;
      this.el.toast.classList.remove('show');
    }
  }

  /* ─────────── HUD ─────────── */
  setLevel(lv) { this.el.level.textContent = `第 ${lv.id} 庭 · ${lv.name}`; }
  setTime(sec) {
    const s = fmtTime(sec);
    const i = s.indexOf('.');
    this.el.time.innerHTML = s.slice(0, i) + '<span class="cs">' + s.slice(i) + '</span>';
  }
  setCount(got, total) {
    this.el.count.textContent = String(got);
    this.el.total.textContent = '/ ' + total;
  }
  popCount() {
    const n = this.el.count;
    n.classList.remove('pop');
    void n.offsetWidth;
    n.classList.add('pop');
  }
  setCompass(bearing, dist) {
    this.el.dist.textContent = dist === null ? '出口 —' : `出口 ${Math.round(dist)} m`;
    this.el.compassIco.style.transform = `rotate(${(bearing * 180 / Math.PI).toFixed(1)}deg)`;
  }
  applyFlags() {
    document.body.classList.toggle('nomap', !this.showMap);
    document.body.classList.toggle('nocompass', !this.showCompass);
  }

  /* ─────────── 小地图 ─────────── */
  resizeMap() {
    const r = this.el.map.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(80, Math.round(r.width || 158));
    const h = Math.max(80, Math.round(r.height || 158));
    this.el.map.width = Math.round(w * this.dpr);
    this.el.map.height = Math.round(h * this.dpr);
    this.mapW = w;
    this.mapH = h;
  }

  prepare(maze) {
    // 预计算每段墙相邻的格子索引，绘制时只在"已探索"处落笔
    this.walls = maze.segs.map((s) => {
      const cells = [];
      if (s.vert) {
        for (const sx of [-1, 1]) {
          const c = maze.cellOf(s.x + sx * (s.hx + 0.05), s.z);
          cells.push(c.cy * maze.cols + c.cx);
        }
      } else {
        for (const sz of [-1, 1]) {
          const c = maze.cellOf(s.x, s.z + sz * (s.hz + 0.05));
          cells.push(c.cy * maze.cols + c.cx);
        }
      }
      return { x: s.x, z: s.z, hx: s.hx, hz: s.hz, cells };
    });
    this.maze = maze;
    this.mapMode = 'follow';
    this.el.mapPanel.classList.remove('big');
  }

  toggleMapMode() {
    this.mapMode = this.mapMode === 'follow' ? 'full' : 'follow';
    this.el.mapPanel.classList.toggle('big', this.mapMode === 'full');
    requestAnimationFrame(() => this.resizeMap());
  }

  drawMinimap(player, fruits, exit, yaw) {
    const maze = this.maze;
    if (!maze || !this.showMap) return;
    const ctx = this.ctx;
    const dpr = this.dpr;
    const W = this.mapW, H = this.mapH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const full = this.mapMode === 'full';
    const viewCells = full ? Math.max(maze.cols, maze.rows) : 9;
    const span = viewCells * CELL;
    const s = (Math.min(W, H) - 10) / span;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(1, 1, W - 2, H - 2, 8) : ctx.rect(1, 1, W - 2, H - 2);
    ctx.clip();

    // 底色：未探索区域
    ctx.fillStyle = '#E2D7C2';
    ctx.fillRect(0, 0, W, H);

    ctx.translate(W / 2, H / 2);
    if (this.rotMap && !full) ctx.rotate(yaw);
    ctx.scale(s, s);
    ctx.translate(-player.x, -player.z);

    const reveal = this.reveal;
    const cols = maze.cols, rows = maze.rows;
    const half = CELL / 2;

    // 已探索地面
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const k = cy * cols + cx;
        const rv = reveal[k];
        if (rv <= 0.01) continue;
        const p = maze.cellCenter(cx, cy);
        ctx.globalAlpha = rv;
        ctx.fillStyle = '#FFFDF6';
        ctx.fillRect(p.x - half, p.z - half, CELL, CELL);
      }
    }
    ctx.globalAlpha = 1;

    // 墙体
    const viewR = span * 0.62;
    ctx.fillStyle = '#4B453C';
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      if (!full && Math.abs(w.x - player.x) > viewR + 2 || !full && Math.abs(w.z - player.z) > viewR + 2) continue;
      let a = 0;
      for (const k of w.cells) if (reveal[k] > a) a = reveal[k];
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      ctx.fillRect(w.x - w.hx, w.z - w.hz, w.hx * 2, w.hz * 2);
    }
    ctx.globalAlpha = 1;

    // 星果（只在已探索格里显示）
    for (const f of fruits) {
      if (f.taken) continue;
      const k = f.cy * cols + f.cx;
      if (reveal[k] <= 0.35) continue;
      ctx.globalAlpha = clamp(reveal[k], 0, 1);
      ctx.fillStyle = '#E9A62B';
      ctx.beginPath();
      ctx.arc(f.x, f.z, full ? CELL * 0.15 : CELL * 0.13, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,253,246,.9)';
      ctx.lineWidth = CELL * 0.045;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 出口
    const ek = exit.cell;
    if (reveal[ek] > 0.02 || full) {
      ctx.globalAlpha = full ? 1 : clamp(reveal[ek] * 1.4, 0, 1);
      ctx.fillStyle = '#FF5C7A';
      const r = full ? CELL * 0.2 : CELL * 0.19;
      ctx.beginPath();
      ctx.arc(exit.x, exit.z, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#FFFDF6';
      ctx.lineWidth = CELL * 0.06;
      ctx.beginPath();
      ctx.arc(exit.x, exit.z, r * 1.55, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // 玩家（屏幕空间，永远居中）+ 视锥
    const cxp = W / 2, cyp = H / 2;
    ctx.save();
    ctx.translate(cxp, cyp);
    if (!this.rotMap || full) ctx.rotate(-yaw);
    const coneR = Math.min(W, H) * 0.2;
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, coneR);
    grad.addColorStop(0, 'rgba(255,92,122,.34)');
    grad.addColorStop(1, 'rgba(255,92,122,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, coneR, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    ctx.closePath();
    ctx.fill();

    const pr = Math.min(W, H) * 0.045;
    ctx.fillStyle = '#FF5C7A';
    ctx.strokeStyle = '#FFFDF6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -pr * 1.7);
    ctx.lineTo(pr * 1.15, pr * 1.15);
    ctx.lineTo(0, pr * 0.55);
    ctx.lineTo(-pr * 1.15, pr * 1.15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 指北针
    ctx.save();
    ctx.translate(W - 15, 15);
    if (this.rotMap && !full) ctx.rotate(yaw);
    ctx.fillStyle = 'rgba(255,253,248,.86)';
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(44,42,38,.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#FF5C7A';
    ctx.font = '700 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, 0.5);
    ctx.restore();

    this.el.mapTag.textContent = `已探索 ${Math.round(this.exploredRatio() * 100)}%`;
  }

  setExplore(reveal, ratio) {
    this.reveal = reveal;
    this._ratio = ratio;
  }
  exploredRatio() { return this._ratio || 0; }

  /* ─────────── 关卡列表 ─────────── */
  buildLevels(onPick) {
    const unlocked = Store.data.unlocked;
    const list = this.el.levelList;
    list.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'lvlist';
    for (const lv of LEVELS) {
      const locked = lv.id > unlocked;
      const raw = Store.best(lv.id);
      // best 来自 localStorage，进入 innerHTML 前先归一化：时间强转数字、评级走白名单
      const best = raw
        ? { time: Number(raw.time) || 0, rank: RANK_ORDER.includes(raw.rank) ? raw.rank : 'C' }
        : null;
      const b = document.createElement('button');
      b.className = 'lv' + (locked ? ' locked' : '') + (best ? ' done' : '');
      b.disabled = locked;
      b.innerHTML = `
        <span class="lv-ico">
          ${locked
            ? '<svg class="ico" viewBox="0 0 24 24"><path d="M6.5 11h11v9h-11z"/><path d="M9 11V8a3 3 0 0 1 6 0v3"/></svg>'
            : best
              ? '<svg class="ico" viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5H5.5v2A3.5 3.5 0 0 0 9 10.5M16 5h2.5v2A3.5 3.5 0 0 1 15 10.5M10 17h4M9 20h6"/></svg>'
              : '<svg class="ico" viewBox="0 0 24 24"><path d="M12 3.2l2.7 5.7 6.1.9-4.4 4.3 1 6.2-5.4-2.9-5.4 2.9 1-6.2L3.2 9.8l6.1-.9z"/></svg>'}
        </span>
        <span class="lv-main">
          <span class="lv-name"></span>
          <span class="lv-sub"></span>
        </span>
        <span class="lv-best"></span>`;
      b.querySelector('.lv-name').textContent = lv.name;
      b.querySelector('.lv-sub').textContent = `${lv.sub} · ${lv.cols}×${lv.rows} · ${lv.fruits} 枚星果`;
      const bestEl = b.querySelector('.lv-best');
      if (best) {
        const t = document.createElement('b');
        t.textContent = fmtTime(best.time, false);
        const rk = document.createElement('span');
        rk.className = 'lv-rank ' + best.rank;
        rk.textContent = best.rank;
        bestEl.append(t, rk);
      } else {
        const sp = document.createElement('span');
        sp.className = 'lv-sub';
        sp.textContent = locked ? '未解锁' : '未通关';
        bestEl.appendChild(sp);
      }
      if (!locked) b.addEventListener('click', () => onPick(lv));
      wrap.appendChild(b);
    }
    list.appendChild(wrap);
    this.el.titleFoot.textContent = `共 ${LEVELS.length} 座庭园 · 已解锁 ${Math.min(unlocked, LEVELS.length)}`;
  }

  /* ─────────── 胜利结算 ─────────── */
  showWin(r) {
    $('win-level').textContent = `第 ${r.level.id} 庭 · ${r.level.name}`;
    const rank = $('win-rank');
    rank.textContent = r.rank;
    rank.className = 'rank ' + r.rank;
    rank.style.animation = 'none';
    void rank.offsetWidth;
    rank.style.animation = '';
    $('win-title').textContent = r.perfect ? '满庭星果，完美通关！' : '找到出口了！';
    $('win-time').textContent = fmtTime(r.time);
    $('win-count').textContent = `${r.fruits}/${r.total}`;
    $('win-explored').textContent = Math.round(r.explored * 100) + '%';
    $('win-dist').textContent = Math.round(r.distance) + ' m';
    $('win-best').textContent = r.improved
      ? (r.prev ? `刷新纪录！原 ${fmtTime(r.prev.time)}` : '新纪录已保存')
      : `最佳 ${fmtTime(r.bestTime)}`;
    const isLast = r.level.id >= LEVELS.length;
    $('btn-next-t').textContent = isLast ? '回到标题' : '下一庭';
    this.show('screen-win');
    this.startConfetti();
  }

  startConfetti() {
    const cv = this.el.confetti;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = cv.clientWidth * dpr;
    cv.height = cv.clientHeight * dpr;
    const ctx = this.cctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cv.clientWidth, H = cv.clientHeight;
    const cols = ['#FF5C7A', '#FFC94A', '#74B24F', '#C7A4FF', '#FF93AC', '#8FD6E8', '#FFF6F0'];
    const P = [];
    for (let i = 0; i < 110; i++) {
      P.push({
        x: Math.random() * W, y: -20 - Math.random() * H * 0.7,
        w: 5 + Math.random() * 8, h: 3 + Math.random() * 5,
        vx: (Math.random() - 0.5) * 46, vy: 62 + Math.random() * 120,
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 7,
        c: cols[(Math.random() * cols.length) | 0],
      });
    }
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of P) {
        p.vy += 26 * dt;
        p.vx += Math.sin(now * 0.002 + p.rot) * 12 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.y < H + 30) alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.w / 2, p.h / 2, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      if (alive > 0 && this.visible('screen-win')) this._rafConf = requestAnimationFrame(loop);
      else ctx.clearRect(0, 0, W, H);
    };
    cancelAnimationFrame(this._rafConf);
    this._rafConf = requestAnimationFrame(loop);
  }

  stopConfetti() {
    cancelAnimationFrame(this._rafConf);
    this._rafConf = 0;
    this.cctx.clearRect(0, 0, this.el.confetti.width, this.el.confetti.height);
  }

  /* ─────────── 设置面板同步 ─────────── */
  syncSettings() {
    const st = Store.data.settings;
    $('set-sens').value = st.sens;
    $('set-sens-v').textContent = (st.sens / 100).toFixed(2);
    $('set-fov').value = st.fov;
    $('set-fov-v').textContent = st.fov + '°';
    $('set-bob').classList.toggle('on', st.bob);
    $('set-rotmap').classList.toggle('on', st.rotMap);
    $('set-invert').classList.toggle('on', st.invert);
    $('set-audio').classList.toggle('on', st.audio);
    $('set-minimap').classList.toggle('on', st.minimap);
    $('set-compass').classList.toggle('on', st.compass);
    for (const b of document.querySelectorAll('#set-quality button')) b.classList.toggle('on', b.dataset.v === st.quality);
    document.body.classList.toggle('muted', !st.audio);
  }
}
