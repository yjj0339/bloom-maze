/**
 * player.js — 第一人称控制器：加减速、圆 vs AABB 分轴推挤、head bob、速度 FOV、碰撞反馈
 */
import * as THREE from 'three';
import { clamp, damp, shortAngle, TAU } from './lib.js';

export const EYE = 1.66;
const RAD = 0.42;
const WALK = 4.35;
const RUN = 7.0;
const STRIDE = 1.06; // 一个完整步伐周期走过的距离

/**
 * 竖屏补偿：窄纵横比时抬高垂直 FOV，保证水平视野不至于只剩一面墙。
 * 横屏（aspect>=1）原样返回。
 */
export function fovFor(base, aspect) {
  if (!aspect || aspect >= 1) return base;
  const half = Math.atan(Math.tan((base * Math.PI) / 360) / Math.min(1, aspect * 1.35));
  return clamp((half * 360) / Math.PI, base, 96);
}

export class Player {
  constructor(maze, camera) {
    this.maze = maze;
    this.camera = camera;
    this.pos = new THREE.Vector2(0, 0);   // x, z
    this.vel = new THREE.Vector2(0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.stepPhase = 0;
    this.lastStepBucket = 0;
    this.distance = 0;
    this.speed = 0;
    this.bobY = 0;
    this.shake = 0;
    this.fovBase = 76;
    this.fovCur = 76;
    this.aspect = 1;
    this.bobEnabled = true;
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._probe = { x: 0, z: 0 };
    this.onStep = null;
    this.onBump = null;
  }

  reset(x, z, yaw) {
    this.pos.set(x, z);
    this.vel.set(0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.stepPhase = 0;
    this.distance = 0;
    this.speed = 0;
    this.shake = 0;
    this.syncCamera(0);
  }

  /** 初始朝向：面向迷宫内部（背离最近的边界） */
  faceInward(maze) {
    const c = maze.cellOf(maze.start.x, maze.start.z);
    const bits = maze.open[maze.start.cell];
    if (bits & 2) return -Math.PI / 2;   // 东开口 → 朝 +X
    if (bits & 8) return Math.PI / 2;    // 西开口 → 朝 -X
    if (bits & 4) return Math.PI;        // 南开口 → 朝 +Z
    return 0;
  }

  update(dt, input) {
    dt = Math.min(dt, 1 / 20);

    // ── 视角 ──
    const sens = input.sens * 0.0022;
    this.yaw -= input.look.dx * sens;
    this.pitch -= input.look.dy * sens * (input.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    if (this.yaw > Math.PI) this.yaw -= TAU;
    else if (this.yaw < -Math.PI) this.yaw += TAU;
    input.look.dx = 0;
    input.look.dy = 0;

    // ── 移动意图（相对朝向） ──
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // 相机 -Z 为前；yaw=0 时前方 = (0,0,-1)
    this._fwd.set(-sy, -cy);
    this._right.set(cy, -sy);
    let dx = this._fwd.x * input.move.y + this._right.x * input.move.x;
    let dz = this._fwd.y * input.move.y + this._right.y * input.move.x;
    const mag = Math.hypot(dx, dz);
    if (mag > 1) { dx /= mag; dz /= mag; }
    const running = input.run && mag > 0.15;
    const maxSpeed = running ? RUN : WALK;

    // ── 加速度模型：指数趋近目标速度（起步柔和、停步干脆） ──
    const tvx = dx * maxSpeed * Math.min(1, mag);
    const tvz = dz * maxSpeed * Math.min(1, mag);
    const k = 1 - Math.exp(-(mag > 0.05 ? 13.5 : 17) * dt);
    this.vel.x += (tvx - this.vel.x) * k;
    this.vel.y += (tvz - this.vel.y) * k;
    if (Math.abs(this.vel.x) < 1e-4) this.vel.x = 0;
    if (Math.abs(this.vel.y) < 1e-4) this.vel.y = 0;

    const px = this.pos.x, pz = this.pos.y;
    // 分轴移动 + 每轴各解一次碰撞 → 贴墙自然滑行，不抖不穿
    this.pos.x += this.vel.x * dt;
    const hit = collideCircle(this.maze, this._probe, this.pos, RAD);
    this.pos.y += this.vel.y * dt;
    const hit2 = collideCircle(this.maze, this._probe, this.pos, RAD);
    const bump = Math.max(hit, hit2);
    if (bump > 0.012) {
      // 撞墙：吃掉法向速度分量，保留切向 → 滑行
      this.vel.multiplyScalar(clamp(1 - bump * 5.5, 0.15, 1));
      this.shake = Math.min(1, this.shake + bump * 3.4);
      if (bump > 0.05 && this.onBump) this.onBump(bump);
    }

    const moved = Math.hypot(this.pos.x - px, this.pos.y - pz);
    this.distance += moved;
    this.speed = moved / Math.max(dt, 1e-5);

    // ── 步伐与 head bob ──
    const bobAmt = this.bobEnabled ? 1 : 0;
    const sn = clamp(this.speed / RUN, 0, 1.15);
    this.stepPhase += (this.speed / STRIDE) * dt;
    const bucket = Math.floor(this.stepPhase / Math.PI);
    if (bucket !== this.lastStepBucket) {
      this.lastStepBucket = bucket;
      if (this.speed > 0.55 && this.onStep) this.onStep(clamp(this.speed / RUN, 0.3, 1));
    }
    const bobT = this.stepPhase;
    this.bobY = Math.sin(bobT * 2) * 0.062 * sn * bobAmt;
    const bobRoll = Math.sin(bobT) * 0.016 * sn * bobAmt;
    const strafe = clamp(input.move.x, -1, 1);
    this.roll = damp(this.roll, -strafe * 0.026 * bobAmt + bobRoll, 9, dt);
    this.shake = Math.max(0, this.shake - dt * 4.2);

    this.syncCamera(dt, running);
  }

  syncCamera(dt, running = false) {
    const cam = this.camera;
    const sh = this.shake;
    const jx = sh > 0 ? (Math.random() - 0.5) * sh * 0.05 : 0;
    const jy = sh > 0 ? (Math.random() - 0.5) * sh * 0.05 : 0;
    cam.position.set(this.pos.x + jx, EYE + this.bobY + jy, this.pos.y);
    this._euler.set(this.pitch, this.yaw, this.roll);
    cam.quaternion.setFromEuler(this._euler);

    // 速度 FOV：跑起来视野微张
    const target = this.fovCur + (running ? 4.5 : 0) + clamp(this.speed / RUN, 0, 1) * 1.6;
    if (Math.abs(cam.fov - target) > 0.01) {
      cam.fov = damp(cam.fov, target, 7, Math.max(dt, 1 / 120));
      cam.updateProjectionMatrix();
    }
  }

  setFov(f) {
    this.fovBase = f;
    this._recomputeFov();
  }

  setAspect(a) {
    this.aspect = a;
    this._recomputeFov();
  }

  _recomputeFov() {
    this.fovCur = fovFor(this.fovBase, this.aspect || 1);
    this.camera.fov = this.fovCur;
    this.camera.updateProjectionMatrix();
  }

  /** 朝某点的罗盘方位（弧度，0 = 正前） */
  bearingTo(x, z) {
    const dx = x - this.pos.x, dz = z - this.pos.y;
    const worldAngle = Math.atan2(dx, -dz);
    return shortAngle(worldAngle - this.yaw);
  }

  distanceTo(x, z) {
    return Math.hypot(x - this.pos.x, z - this.pos.y);
  }
}

/**
 * 圆形玩家 vs 墙体 AABB 推挤。
 * p 是 THREE.Vector2（x → 世界 X，y → 世界 Z），原地修正；返回最大穿透量用于撞击反馈。
 * probe 是复用的 {x,z} 临时对象，避免每帧分配。
 */
export function collideCircle(maze, probe, p, r) {
  let hit = 0;
  probe.x = p.x;
  probe.z = p.y;
  const boxes = maze.nearBoxes(p.x, p.y, r + 0.6);
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = clamp(p.x, b.x - b.hx, b.x + b.hx);
    const cz = clamp(p.y, b.z - b.hz, b.z + b.hz);
    const dx = p.x - cx, dz = p.y - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      p.x += dx * push;
      p.y += dz * push;
      if (r - d > hit) hit = r - d;
    } else {
      // 圆心已陷入盒内：沿最小穿透轴推出
      const px = b.hx + r - Math.abs(p.x - b.x);
      const pz = b.hz + r - Math.abs(p.y - b.z);
      if (px < pz) { p.x += (p.x < b.x ? -1 : 1) * px; if (px > hit) hit = px; }
      else { p.y += (p.y < b.z ? -1 : 1) * pz; if (pz > hit) hit = pz; }
    }
  }
  return hit;
}
