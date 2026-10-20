/**
 * maze.js — 种子化迷宫生成（DFS 递归回溯 + braid 成环）、墙段 AABB、空间哈希、关卡表
 */
import { makeRng, clamp } from './lib.js';

export const CELL = 3.6;   // 相邻墙中线的间距（走廊净宽 = CELL - T）
export const T = 0.5;      // 墙厚
export const H = 2.5;      // 石墙身高度（其上再叠绿篱冠）

const N = 1, E = 2, S = 4, W = 8;
const OPP = { [N]: S, [S]: N, [E]: W, [W]: E };
const DIR = {
  [N]: [0, -1], [S]: [0, 1], [E]: [1, 0], [W]: [-1, 0],
};
const ALL = [N, E, S, W];

export const LEVELS = [
  { id: 1, name: '晨曦苗圃', sub: 'Dawn Nursery',   cols: 7,  rows: 7,  fruits: 6,  seed: 'dawn-nursery',   braid: 0.18, hint: '跟着星果的光走，别怕死路。' },
  { id: 2, name: '铃兰回廊', sub: 'Lily Corridor',  cols: 10, rows: 9,  fruits: 9,  seed: 'lily-corridor',  braid: 0.28, hint: '回廊开始打结了，小地图会帮你。' },
  { id: 3, name: '藤萝深庭', sub: 'Wisteria Court', cols: 13, rows: 12, fruits: 13, seed: 'wisteria-court', braid: 0.34, hint: '死路里常藏着星果。' },
  { id: 4, name: '蔷薇迷阵', sub: 'Rose Labyrinth', cols: 16, rows: 15, fruits: 18, seed: 'rose-labyrinth', braid: 0.40, hint: '环形通路多了，试着记住地标。' },
  { id: 5, name: '花神穹顶', sub: 'Flora Sanctum',  cols: 20, rows: 19, fruits: 24, seed: 'flora-sanctum',  braid: 0.44, hint: '最后一座庭园，祝你好运。' },
];

const popcount = (v) => ((v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1));

export function buildMaze(level) {
  const { cols, rows } = level;
  const rng = makeRng(level.seed);
  const idx = (cx, cy) => cy * cols + cx;
  const inside = (cx, cy) => cx >= 0 && cy >= 0 && cx < cols && cy < rows;

  /* ── 1. 递归回溯生成完美迷宫（迭代式，避免深递归） ── */
  const open = new Uint8Array(cols * rows);
  const seen = new Uint8Array(cols * rows);
  const stack = [0];
  seen[0] = 1;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const cx = cur % cols, cy = (cur / cols) | 0;
    const opts = [];
    for (const d of ALL) {
      const nx = cx + DIR[d][0], ny = cy + DIR[d][1];
      if (inside(nx, ny) && !seen[idx(nx, ny)]) opts.push([d, nx, ny]);
    }
    if (!opts.length) { stack.pop(); continue; }
    const [d, nx, ny] = opts[Math.floor(rng.next() * opts.length)];
    const ni = idx(nx, ny);
    open[cur] |= d;
    open[ni] |= OPP[d];
    seen[ni] = 1;
    stack.push(ni);
  }

  /* ── 2. Braid：拆掉部分死胡同，制造环路与多解 ── */
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const i = idx(cx, cy);
      if (popcount(open[i]) !== 1) continue;
      if (!rng.chance(level.braid)) continue;
      const blocked = ALL.filter((d) => {
        const nx = cx + DIR[d][0], ny = cy + DIR[d][1];
        return inside(nx, ny) && !(open[i] & d);
      });
      if (!blocked.length) continue;
      // 优先连向已经比较通畅的邻居，环更自然
      blocked.sort((a, b) => {
        const pa = popcount(open[idx(cx + DIR[a][0], cy + DIR[a][1])]);
        const pb = popcount(open[idx(cx + DIR[b][0], cy + DIR[b][1])]);
        return pb - pa;
      });
      const d = rng.chance(0.6) ? blocked[0] : blocked[Math.floor(rng.next() * blocked.length)];
      open[i] |= d;
      open[idx(cx + DIR[d][0], cy + DIR[d][1])] |= OPP[d];
    }
  }

  /* ── 3. 世界坐标 ── */
  const Wd = cols * CELL, Dd = rows * CELL;
  const bx = (cx) => cx * CELL - Wd / 2;      // 竖向边界
  const bz = (cy) => cy * CELL - Dd / 2;      // 横向边界
  const ccx = (cx) => cx * CELL + CELL / 2 - Wd / 2;
  const ccz = (cy) => cy * CELL + CELL / 2 - Dd / 2;

  /* ── 4. BFS 距离场 ── */
  const bfs = (from) => {
    const dist = new Int32Array(cols * rows).fill(-1);
    const q = [from];
    dist[from] = 0;
    for (let h = 0; h < q.length; h++) {
      const cur = q[h];
      const cx = cur % cols, cy = (cur / cols) | 0;
      for (const d of ALL) {
        if (!(open[cur] & d)) continue;
        const ni = idx(cx + DIR[d][0], cy + DIR[d][1]);
        if (dist[ni] === -1) { dist[ni] = dist[cur] + 1; q.push(ni); }
      }
    }
    return dist;
  };
  const farthest = (dist) => {
    let bi = 0, bv = -1;
    for (let i = 0; i < dist.length; i++) if (dist[i] > bv) { bv = dist[i]; bi = i; }
    return bi;
  };
  // 双扫找直径两端 → 起点与出口距离最大化
  const d0 = bfs(0);
  const startI = farthest(d0);
  const dist = bfs(startI);
  const exitI = farthest(dist);

  /* ── 5. 墙段（同时用于渲染与碰撞） ── */
  // 注意 idx 的签名是 (cx, cy)：竖向墙查左侧格的 E 位，横向墙查上侧格的 S 位
  const vSolid = (cx, cy) => cx === 0 || cx === cols || !(open[idx(cx - 1, cy)] & E);
  const hSolid = (cx, cy) => cy === 0 || cy === rows || !(open[idx(cx, cy - 1)] & S);

  const segs = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx <= cols; cx++) {
      if (!vSolid(cx, cy)) continue;
      segs.push({ x: bx(cx), z: ccz(cy), hx: T / 2, hz: CELL / 2 + T / 2, vert: true, len: CELL + T, outer: cx === 0 || cx === cols });
    }
  }
  for (let cy = 0; cy <= rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!hSolid(cx, cy)) continue;
      segs.push({ x: ccx(cx), z: bz(cy), hx: CELL / 2 + T / 2, hz: T / 2, vert: false, len: CELL + T, outer: cy === 0 || cy === rows });
    }
  }

  /* ── 6. 立柱（仅在真有墙交汇的格点上） ── */
  const posts = [];
  for (let cy = 0; cy <= rows; cy++) {
    for (let cx = 0; cx <= cols; cx++) {
      const hasV = (cy < rows && vSolid(cx, cy)) || (cy > 0 && vSolid(cx, cy - 1));
      const hasH = (cx < cols && hSolid(cx, cy)) || (cx > 0 && hSolid(cx - 1, cy));
      if (!hasV && !hasH) continue;
      const corner = (cx === 0 || cx === cols) && (cy === 0 || cy === rows);
      const junction = hasV && hasH;
      const big = corner || (junction && rng.chance(0.34));
      posts.push({ x: bx(cx), z: bz(cy), big, lantern: big && (corner || rng.chance(0.42)) });
    }
  }

  /* ── 7. 星果布点：偏向远端与死胡同，且互相拉开 ── */
  const cands = [];
  for (let i = 0; i < cols * rows; i++) {
    if (i === startI || i === exitI) continue;
    const dead = popcount(open[i]) === 1;
    const score = dist[i] * 1.0 + (dead ? 22 : 0) + rng.float(0, 20);
    cands.push({ i, score, dead });
  }
  cands.sort((a, b) => b.score - a.score);
  const fruits = [];
  const taken = new Set([startI, exitI]);
  const farEnough = (i) => {
    const cx = i % cols, cy = (i / cols) | 0;
    for (const f of fruits) {
      if (Math.max(Math.abs(f.cx - cx), Math.abs(f.cy - cy)) < 2) return false;
    }
    return true;
  };
  for (const c of cands) {
    if (fruits.length >= level.fruits) break;
    if (taken.has(c.i) || !farEnough(c.i)) continue;
    taken.add(c.i);
    const cx = c.i % cols, cy = (c.i / cols) | 0;
    fruits.push({
      id: fruits.length, cx, cy,
      x: ccx(cx) + rng.float(-0.55, 0.55),
      z: ccz(cy) + rng.float(-0.55, 0.55),
      dead: c.dead, phase: rng.float(0, 6.28),
    });
  }
  // 数量不够时放宽间距补齐
  if (fruits.length < level.fruits) {
    for (const c of cands) {
      if (fruits.length >= level.fruits) break;
      if (taken.has(c.i)) continue;
      taken.add(c.i);
      const cx = c.i % cols, cy = (c.i / cols) | 0;
      fruits.push({ id: fruits.length, cx, cy, x: ccx(cx), z: ccz(cy), dead: c.dead, phase: rng.float(0, 6.28) });
    }
  }

  /* ── 8. 空间哈希（格尺寸 = CELL） ── */
  const buckets = new Array(cols * rows);
  const put = (bi, b) => {
    const gx0 = clamp(Math.floor((b.x - b.hx + Wd / 2) / CELL), 0, cols - 1);
    const gx1 = clamp(Math.floor((b.x + b.hx + Wd / 2) / CELL), 0, cols - 1);
    const gz0 = clamp(Math.floor((b.z - b.hz + Dd / 2) / CELL), 0, rows - 1);
    const gz1 = clamp(Math.floor((b.z + b.hz + Dd / 2) / CELL), 0, rows - 1);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const k = gz * cols + gx;
        (buckets[k] || (buckets[k] = [])).push(bi);
      }
    }
  };
  segs.forEach((s, i) => put(i, s));

  const nearBoxes = (x, z, r) => {
    const out = [];
    const gx0 = clamp(Math.floor((x - r + Wd / 2) / CELL), 0, cols - 1);
    const gx1 = clamp(Math.floor((x + r + Wd / 2) / CELL), 0, cols - 1);
    const gz0 = clamp(Math.floor((z - r + Dd / 2) / CELL), 0, rows - 1);
    const gz1 = clamp(Math.floor((z + r + Dd / 2) / CELL), 0, rows - 1);
    for (let gz = gz0; gz <= gz1; gz++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const b = buckets[gz * cols + gx];
        if (b) for (let i = 0; i < b.length; i++) out.push(segs[b[i]]);
      }
    return out;
  };

  const solutionCells = dist[exitI];
  const par = (solutionCells * CELL) / 4.3 * 1.9 + level.fruits * 3.2;

  const startCx = startI % cols, startCy = (startI / cols) | 0;
  const exitCx = exitI % cols, exitCy = (exitI / cols) | 0;

  return {
    level, cols, rows, rng,
    W: Wd, D: Dd,
    open, dist,
    segs, posts, fruits,
    nearBoxes,
    cellCenter: (cx, cy) => ({ x: ccx(cx), z: ccz(cy) }),
    cellOf: (x, z) => ({
      cx: clamp(Math.floor((x + Wd / 2) / CELL), 0, cols - 1),
      cy: clamp(Math.floor((z + Dd / 2) / CELL), 0, rows - 1),
    }),
    start: { cx: startCx, cy: startCy, x: ccx(startCx), z: ccz(startCy), cell: startI },
    exit: { cx: exitCx, cy: exitCy, x: ccx(exitCx), z: ccz(exitCy), cell: exitI },
    par,
    solutionCells,
  };
}
