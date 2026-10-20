/**
 * art.js — 低多边形建模库：全部构件都是真几何（倒角、收分、券石、花瓣、菌盖、灯罩），
 * 无任何"盒子盖贴图"。顶点色 + flatShading + GPU 粒子。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng, TAU } from './lib.js';

/* ═══════════ 调色板：阳光庭园，暖米石 + 苔绿 + 珊瑚点缀 ═══════════ */
export const PAL = {
  stone:      0xF3E4C8,
  stoneMid:   0xE6D2AE,
  stoneDark:  0xCBB38C,
  stoneCool:  0xD9D2C4,
  hedge:      0x74B24F,
  hedgeDark:  0x558F3B,
  hedgeLite:  0x9ACB63,
  grass:      0x9CC861,
  grassDark:  0x7FAE4C,
  path:       0xF0DEBC,
  wood:       0xB5834F,
  woodDark:   0x8A6136,
  gold:       0xFFC94A,
  goldDeep:   0xE39A1E,
  leaf:       0x6FA845,
  water:      0x8FD6E8,
  skyTop:     0x4E9FE0,
  skyHor:     0xFFE3B8,
  skyBot:     0xBFD6AE,
  sun:        0xFFF3D0,
  petals:     [0xFF93AC, 0xFFC3D2, 0xFFF6F0, 0xC7A4FF, 0xFFD27A, 0xFF7F96],
  caps:       [0xF2748C, 0xF09A5C, 0xE4626F, 0xD9A3E0],
};

/* ═══════════ 几何工具 ═══════════ */

function prep(g) {
  const o = g.index ? g.toNonIndexed() : g;
  o.computeVertexNormals();
  return o;
}

function paint(g, color) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** 顶点色刷白：配 material.vertexColors 用时必须有 color 属性，否则着色器读到 (0,0,0) 全黑 */
export function paintWhite(g) {
  return g.attributes.color ? g : paint(g, 0xffffff);
}

/** 逐顶点微抖动，制造手作感（flatShading 下呈现为刻面） */
function jitter(g, amount, seed = 7) {
  const rng = makeRng(seed);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i,
      pos.getX(i) + (rng.next() - 0.5) * amount,
      pos.getY(i) + (rng.next() - 0.5) * amount,
      pos.getZ(i) + (rng.next() - 0.5) * amount);
  }
  g.computeVertexNormals();
  return g;
}

function tf(g, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rz = 0, rx = 0) {
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

function merge(parts) {
  const list = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const hasColor = list.every((g) => g.attributes.color);
  if (!hasColor) list.forEach((g) => { if (!g.attributes.color) paint(g, 0xffffff); });
  const m = mergeGeometries(list, false);
  m.computeVertexNormals();
  return m;
}

/* ═══════════ 基础构件 ═══════════ */

/**
 * 收分石块：底宽顶窄（batter），1×1×1 单位、底面在 y=0。
 * 用 4 段圆柱旋转 45° 得到方形截面，天然带斜度。
 */
export function blockGeo(taper = 0.035) {
  const rt = (1 - taper) / Math.SQRT2;
  const rb = (1 + taper) / Math.SQRT2;
  const g = new THREE.CylinderGeometry(rt, rb, 1, 4, 1, false);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.5, 0);
  return prep(g);
}

/** 团块（绿篱 / 灌木 / 云）：二十面体 + 位置哈希扰动，保持网格连续不开裂 */
export function blobGeo(seed = 3, squashY = 0.78, rough = 0.3) {
  const g = new THREE.IcosahedronGeometry(0.5, 1).toNonIndexed();
  const pos = g.attributes.position;
  const hash = (x, y, z) => {
    const s = Math.sin(x * 27.13 + y * 91.7 + z * 45.11 + seed * 13.7) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // 顶点按位置取整到网格再哈希 → 重合顶点得到相同位移，网格不裂
    const kx = Math.round(x * 500) / 500, ky = Math.round(y * 500) / 500, kz = Math.round(z * 500) / 500;
    const n = hash(kx, ky, kz);
    const s = 1 + (n - 0.5) * rough * 2;
    pos.setXYZ(i, x * s, y * s * squashY, z * s);
  }
  g.computeVertexNormals();
  g.translate(0, 0.5 * squashY, 0);
  return g;
}

/** 立柱：柱础 + 收分柱身 + 束颈 + 柱头（真分层，不是一个盒子） */
export function postGeo(big = false) {
  const h = big ? 3.05 : 2.62;
  const parts = [];
  parts.push(paint(tf(blockGeo(0.06), 0, 0, 0, 0.66, 0.2, 0.66), PAL.stoneDark));
  parts.push(paint(tf(blockGeo(0.05), 0, 0.18, 0, 0.56, 0.13, 0.56), PAL.stoneMid));
  parts.push(paint(tf(blockGeo(0.055), 0, 0.3, 0, 0.46, h - 0.78, 0.46), PAL.stone));
  parts.push(paint(tf(blockGeo(0.03), 0, h - 0.5, 0, 0.54, 0.13, 0.54), PAL.stoneMid));
  parts.push(paint(tf(blockGeo(0.02), 0, h - 0.38, 0, 0.64, 0.17, 0.64), PAL.stone));
  if (big) parts.push(paint(tf(new THREE.CylinderGeometry(0.11, 0.16, 0.22, 6), 0, h - 0.1, 0), PAL.stoneDark));
  return merge(parts);
}

/** 灯柱石件：托座 + 灯框 + 四坡顶 + 尖顶饰 */
export function lampStoneGeo() {
  const parts = [];
  const y0 = 3.05;
  parts.push(paint(tf(blockGeo(0.04), 0, y0 - 0.21, 0, 0.5, 0.22, 0.5), PAL.stoneDark));
  // 灯框四角小柱
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    parts.push(paint(tf(blockGeo(0.02), Math.cos(a) * 0.17, y0, Math.sin(a) * 0.17, 0.075, 0.44, 0.075), PAL.stoneMid));
  }
  // 四坡顶
  const roof = new THREE.ConeGeometry(0.36, 0.3, 4);
  roof.rotateY(Math.PI / 4);
  parts.push(paint(tf(roof, 0, y0 + 0.44, 0), PAL.stoneDark));
  parts.push(paint(tf(new THREE.ConeGeometry(0.07, 0.18, 5), 0, y0 + 0.63, 0), PAL.goldDeep));
  return merge(parts);
}

/** 灯芯（发光体） */
export function lampGlowGeo() {
  const g = new THREE.IcosahedronGeometry(0.15, 0);
  g.translate(0, 3.05 + 0.22, 0);
  return prep(g);
}

/** 星果：五角星挤出成带倒角的实体 + 内芯 */
export function starGeo() {
  const shape = new THREE.Shape();
  const R = 0.46, r = 0.195;
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    if (i) shape.lineTo(x, y); else shape.moveTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.19, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1, curveSegments: 1,
  });
  g.center();
  return prep(g);
}

/** 花：茎 + 两片叶 + 五枚花瓣 + 花心（真分层建模） */
export function flowerGeo(petalColor, seed = 11) {
  const rng = makeRng(seed);
  const parts = [];
  const hgt = 0.42 + rng.float(0, 0.2);
  parts.push(paint(tf(new THREE.CylinderGeometry(0.021, 0.032, hgt, 4), 0, hgt / 2, 0), PAL.leaf));
  // 叶
  for (let i = 0; i < 2; i++) {
    const a = rng.float(0, TAU);
    const leaf = new THREE.ConeGeometry(0.075, 0.24, 3);
    leaf.rotateX(Math.PI / 2.5);
    parts.push(paint(tf(leaf, Math.cos(a) * 0.1, hgt * 0.34, Math.sin(a) * 0.1, 1, 0.4, 1, -a), PAL.leaf));
  }
  // 花瓣
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.float(-0.1, 0.1);
    const petal = new THREE.ConeGeometry(0.088, 0.235, 4);
    petal.scale(1, 1, 0.42);
    petal.rotateX(Math.PI / 2.35);
    parts.push(paint(tf(petal, Math.cos(a) * 0.105, hgt + 0.02, Math.sin(a) * 0.105, 1, 1, 1, -a), petalColor));
  }
  parts.push(paint(tf(new THREE.IcosahedronGeometry(0.072, 0), 0, hgt + 0.045, 0), PAL.gold));
  return merge(parts);
}

/** 蘑菇：菌柄 + 菌盖 + 盖上腺点 */
export function mushroomGeo(capColor, seed = 5) {
  const rng = makeRng(seed);
  const parts = [];
  const hh = 0.2 + rng.float(0, 0.12);
  parts.push(paint(tf(new THREE.CylinderGeometry(0.062, 0.088, hh, 6), 0, hh / 2, 0), 0xFFF6E8));
  const cap = new THREE.SphereGeometry(0.2, 8, 5, 0, TAU, 0, Math.PI * 0.52);
  cap.scale(1, 0.78, 1);
  parts.push(paint(tf(cap, 0, hh - 0.01, 0), capColor));
  // 裙边
  parts.push(paint(tf(new THREE.CylinderGeometry(0.196, 0.176, 0.035, 8), 0, hh - 0.005, 0), 0xFFE9EE));
  for (let i = 0; i < 5; i++) {
    const a = rng.float(0, TAU), rr = rng.float(0.05, 0.15);
    const dot = new THREE.SphereGeometry(0.031, 5, 4);
    const y = hh - 0.01 + Math.sqrt(Math.max(0, 1 - (rr / 0.2) ** 2)) * 0.2 * 0.78;
    parts.push(paint(tf(dot, Math.cos(a) * rr, y - 0.006, Math.sin(a) * rr, 1, 0.5, 1), 0xFFF9F0));
  }
  return merge(parts);
}

/** 草丛：5 片细长叶，从基部散开 */
export function tuftGeo(seed = 2) {
  const rng = makeRng(seed);
  const parts = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.float(-0.3, 0.3);
    const h = 0.26 + rng.float(0, 0.2);
    const blade = new THREE.ConeGeometry(0.036, h, 3);
    blade.scale(1, 1, 0.45);
    blade.rotateX(rng.float(0.25, 0.55));
    const c = rng.chance(0.28) ? PAL.hedgeLite : (rng.chance(0.5) ? PAL.grass : PAL.grassDark);
    parts.push(paint(tf(blade, Math.cos(a) * 0.05, h / 2, Math.sin(a) * 0.05, 1, 1, 1, -a), c));
  }
  return merge(parts);
}

/** 顶植树：树干 + 三层锥体树冠 */
export function treeGeo(seed = 9) {
  const rng = makeRng(seed);
  const parts = [];
  const th = 0.9 + rng.float(0, 0.5);
  parts.push(paint(tf(new THREE.CylinderGeometry(0.11, 0.17, th, 6), 0, th / 2, 0), PAL.woodDark));
  const layers = 3;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const r = 0.92 - t * 0.42;
    const h = 0.95 - t * 0.24;
    const cone = new THREE.ConeGeometry(r, h, 7);
    jitter(cone, 0.055, seed + i);
    const c = i === 0 ? PAL.hedgeDark : (i === 1 ? PAL.hedge : PAL.hedgeLite);
    parts.push(paint(tf(cone, 0, th + i * 0.5 + h / 2 - 0.24, 0), c));
  }
  return merge(parts);
}

/** 圆灌木 */
export function bushGeo(seed = 4) {
  const parts = [];
  const rng = makeRng(seed);
  for (let i = 0; i < 3; i++) {
    const a = rng.float(0, TAU), rr = rng.float(0, 0.2);
    const s = 0.6 + rng.float(0, 0.4);
    const b = blobGeo(seed + i * 3, 0.8, 0.26);
    parts.push(paint(tf(b, Math.cos(a) * rr, rng.float(0, 0.1), Math.sin(a) * rr, s, s * 0.9, s), i === 1 ? PAL.hedgeLite : PAL.hedge));
  }
  return merge(parts);
}

/** 低多边形云：5 团 blob 合并 */
export function cloudGeo(seed = 21) {
  const rng = makeRng(seed);
  const parts = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const s = 1.1 + rng.float(0, 1.5);
    const b = blobGeo(seed + i, 0.55, 0.2);
    const shade = 0xFFFFFF - Math.floor(rng.float(0, 0x0d0d0d));
    parts.push(paint(tf(b, (i - n / 2) * 1.15 + rng.float(-0.3, 0.3), rng.float(0, 0.35), rng.float(-0.5, 0.5), s, s * 0.8, s * 0.85), shade));
  }
  return merge(parts);
}

/**
 * 树篱脊：沿长轴细分的盒子 + 位置哈希扰动，顶部内收并起伏。
 * 连续一整条（不是稀疏球块），剪影才是"修剪过的绿篱"。长轴为 X。
 */
export function hedgeRidgeGeo(seed = 5) {
  const g = new THREE.BoxGeometry(1, 1, 1, 16, 2, 2);
  const pos = g.attributes.position;
  const hash = (x, y, z) => {
    const s = Math.sin(x * 31.7 + y * 57.3 + z * 23.9 + seed * 7.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const kx = Math.round(x * 200) / 200, ky = Math.round(y * 200) / 200, kz = Math.round(z * 200) / 200;
    const n = hash(kx, ky, kz);
    const top = Math.max(0, y + 0.5);              // 底 0 → 顶 1
    const crown = smooth(0.5, 1.0, top);           // 只在最顶部收边，保持平顶
    const taper = 1 - crown * 0.18;
    const nx = x * (0.96 + n * 0.10);
    const nz = z * taper * (0.96 + hash(kz, kx, ky) * 0.12);
    const ny = y + (n - 0.5) * (0.10 + crown * 0.46);   // 顶面大起伏 → 修剪过的蓬感
    pos.setXYZ(i, nx, ny, nz);
  }
  g.computeVertexNormals();
  g.translate(0, 0.5, 0);
  return g;
}

/** 石子（刷白，交给 instanceColor 上色） */
export function pebbleGeo(seed = 6) {
  return paint(prep(blobGeo(seed, 0.55, 0.42)), 0xffffff);
}

/** 长椅：座板条 + 靠板条 + 石墩 */
export function benchGeo() {
  const parts = [];
  for (let i = 0; i < 4; i++)
    parts.push(paint(tf(blockGeo(0.02), 0, 0.52, -0.3 + i * 0.2, 1.7, 0.075, 0.16), PAL.wood));
  for (let i = 0; i < 3; i++)
    parts.push(paint(tf(blockGeo(0.02), 0, 0.78 + i * 0.19, -0.42, 1.66, 0.075, 0.14), PAL.wood));
  for (const sx of [-0.66, 0.66])
    parts.push(paint(tf(blockGeo(0.05), sx, 0, 0, 0.22, 0.55, 0.72), PAL.stoneMid));
  for (const sx of [-0.66, 0.66])
    parts.push(paint(tf(blockGeo(0.05), sx, 0.5, -0.42, 0.2, 0.5, 0.16), PAL.stoneDark));
  return merge(parts);
}

/** 喷泉：八角池 + 中柱 + 上盘 + 水面 */
export function fountainGeo() {
  const parts = [];
  parts.push(paint(tf(new THREE.CylinderGeometry(1.5, 1.62, 0.34, 8), 0, 0.17, 0), PAL.stoneMid));
  parts.push(paint(tf(new THREE.CylinderGeometry(1.34, 1.34, 0.16, 8), 0, 0.4, 0), PAL.stoneDark));
  parts.push(paint(tf(new THREE.CylinderGeometry(1.28, 1.28, 0.05, 8), 0, 0.46, 0), PAL.water));
  parts.push(paint(tf(new THREE.CylinderGeometry(0.19, 0.3, 0.85, 8), 0, 0.48, 0), PAL.stone));
  parts.push(paint(tf(new THREE.CylinderGeometry(0.62, 0.5, 0.13, 8), 0, 1.34, 0), PAL.stoneMid));
  parts.push(paint(tf(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 8), 0, 1.42, 0), PAL.water));
  parts.push(paint(tf(new THREE.SphereGeometry(0.14, 7, 5), 0, 1.55, 0), PAL.gold));
  return merge(parts);
}

/** 出口拱门尺寸：跨走廊门洞，墩落在两侧墙体内，券石自 pierH 起拱 */
export const ARCH_DIM = { R: 1.55, T: 0.5, pierH: 1.5, depth: 0.95, pierX: 1.95 };

/** 出口拱门：双墩 + 9 块券石 + 拱心石（真砌法，每块沿弧线切向摆放） */
export function archGeo() {
  const { R, T, pierH, depth, pierX } = ARCH_DIM;
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push(paint(tf(blockGeo(0.05), sx * pierX, 0, 0, 0.8, pierH + 0.2, depth), PAL.stone));
    parts.push(paint(tf(blockGeo(0.04), sx * pierX, 0, 0, 0.94, 0.24, depth + 0.14), PAL.stoneDark));
    parts.push(paint(tf(blockGeo(0.03), sx * pierX, pierH - 0.02, 0, 0.9, 0.16, depth + 0.08), PAL.stoneMid));
  }
  const n = 9;
  const Rc = R + T / 2;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * (i + 0.5)) / n;
    const chord = 2 * Rc * Math.tan(Math.PI / (2 * n)) * 1.24;
    const keystone = i === (n - 1) / 2;
    const g = blockGeo(0.02);
    g.translate(0, -0.5, 0);                       // 先居中，才能绕自身中心旋转
    g.scale(chord, T * (keystone ? 1.26 : 1), depth * 0.98);
    g.rotateZ(a + Math.PI / 2);                  // 长轴贴合弧线切向
    g.translate(Math.cos(a) * Rc, pierH + Math.sin(a) * Rc, 0);
    parts.push(paint(g, keystone ? PAL.stoneDark : (i % 2 ? PAL.stone : PAL.stoneMid)));
  }
  // 拱顶小饰
  parts.push(paint(tf(new THREE.ConeGeometry(0.18, 0.34, 5), 0, pierH + Rc + T * 0.63 + 0.14, 0), PAL.goldDeep));
  return merge(parts);
}

/** 蝴蝶翅膀（单侧） */
export function wingGeo() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.16, 0.22, 0.34, 0.2, 0.3, 0.02);
  shape.bezierCurveTo(0.28, -0.12, 0.12, -0.16, 0, 0);
  const g = new THREE.ShapeGeometry(shape, 6);
  return prep(g);
}

/* ═══════════ 程序化贴图（Canvas，无外部资源） ═══════════ */

function canvasTex(size, draw, repeat = 1) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  draw(c, size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 庭园路：暖砂 + 碎石 + 勾缝 */
export function texPath(repeat = 1) {
  return canvasTex(256, (c, s) => {
    c.fillStyle = '#EFDCB9';
    c.fillRect(0, 0, s, s);
    const rng = makeRng(1234);
    for (let i = 0; i < 2600; i++) {
      const v = rng.float(0, 1);
      c.fillStyle = v < 0.4 ? 'rgba(255,250,238,.5)' : v < 0.75 ? 'rgba(198,172,133,.42)' : 'rgba(150,128,98,.3)';
      const r = rng.float(0.6, 2.6);
      c.beginPath();
      c.arc(rng.float(0, s), rng.float(0, s), r, 0, TAU);
      c.fill();
    }
    // 勾缝：不规则石板
    c.strokeStyle = 'rgba(160,136,102,.28)';
    c.lineWidth = 1.6;
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * s;
      c.beginPath();
      c.moveTo(0, p);
      for (let x = 0; x <= s; x += 16) c.lineTo(x, p + Math.sin(x * 0.05 + i) * 1.6);
      c.stroke();
      c.beginPath();
      c.moveTo(p, 0);
      for (let y = 0; y <= s; y += 16) c.lineTo(p + Math.cos(y * 0.05 + i * 2) * 1.6, y);
      c.stroke();
    }
  }, repeat);
}

/** 草地 */
export function texGrass(repeat = 1) {
  return canvasTex(256, (c, s) => {
    c.fillStyle = '#93C25A';
    c.fillRect(0, 0, s, s);
    const rng = makeRng(99);
    for (let i = 0; i < 5200; i++) {
      const v = rng.float(0, 1);
      c.fillStyle = v < 0.35 ? 'rgba(176,214,110,.55)' : v < 0.7 ? 'rgba(112,164,66,.5)' : 'rgba(214,232,150,.35)';
      c.fillRect(rng.float(0, s), rng.float(0, s), rng.float(1, 3.4), rng.float(1, 2));
    }
  }, repeat);
}

/** 石墙灰泥：极淡的斑驳 + 勾缝，避免大平面发闷 */
export function texStone(repeat = 2) {
  return canvasTex(256, (c, s) => {
    c.fillStyle = '#FFFFFF';
    c.fillRect(0, 0, s, s);
    const rng = makeRng(4242);
    for (let i = 0; i < 1500; i++) {
      const v = rng.float(0, 1);
      c.fillStyle = v < 0.5 ? 'rgba(255,255,255,.5)' : v < 0.85 ? 'rgba(196,178,148,.16)' : 'rgba(150,132,104,.13)';
      c.beginPath();
      c.arc(rng.float(0, s), rng.float(0, s), rng.float(0.7, 3.2), 0, TAU);
      c.fill();
    }
    c.strokeStyle = 'rgba(150,132,104,.055)';
    c.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * s;
      c.beginPath();
      c.moveTo(0, p);
      for (let x = 0; x <= s; x += 12) c.lineTo(x, p + Math.sin(x * 0.06 + i) * 1.4);
      c.stroke();
    }
  }, repeat);
}

/** 柔光圆点（发光精灵 / 粒子） */
export function texGlow(power = 2.4) {
  return canvasTex(64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.28, 'rgba(255,255,255,.72)');
    g.addColorStop(0.62, 'rgba(255,255,255,.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
}

/** 花瓣精灵：一枚带缺口的椭圆 */
export function texPetal() {
  return canvasTex(64, (c, s) => {
    c.clearRect(0, 0, s, s);
    c.translate(s / 2, s / 2);
    const g = c.createRadialGradient(0, 0, 2, 0, 0, s * 0.46);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,240,244,.94)');
    g.addColorStop(1, 'rgba(255,220,230,.5)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(0, 0, s * 0.44, s * 0.27, 0, 0, TAU);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.85)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-s * 0.4, 0);
    c.lineTo(s * 0.4, 0);
    c.stroke();
  });
}

/* ═══════════ 材质 ═══════════ */

export function matStd(opts = {}) {
  return new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: 0.86,
    metalness: 0.0,
    ...opts,
  });
}

export function matProp(opts = {}) {
  return matStd({ vertexColors: true, ...opts });
}

/* ═══════════ 天穹（GPU 渐变 + 太阳辉光） ═══════════ */

export function makeSky() {
  const geo = new THREE.SphereGeometry(1, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(PAL.skyTop) },
      uHor: { value: new THREE.Color(PAL.skyHor) },
      uBot: { value: new THREE.Color(PAL.skyBot) },
      uSun: { value: new THREE.Color(PAL.sun) },
      uSunDir: { value: new THREE.Vector3(0.42, 0.62, 0.35).normalize() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uBot; uniform vec3 uSun; uniform vec3 uSunDir;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.0
          ? mix(uHor, uTop, pow(clamp(h,0.0,1.0), 0.58))
          : mix(uHor, uBot, pow(clamp(-h,0.0,1.0), 0.45));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        c += uSun * (pow(s, 620.0) * 3.4 + pow(s, 14.0) * 0.30 + pow(s, 3.0) * 0.06);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(900);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return mesh;
}

/* ═══════════ GPU 粒子场（花瓣 / 花粉），顶点着色器内漂移 + 自旋 ═══════════ */

export function makeParticleField({ count, box, map, color, size, speed = 1, spin = 1, opacity = 1, seed = 1 }) {
  const rng = makeRng(seed);
  const pos = new Float32Array(count * 3);
  const aSeed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng.float(-box.x / 2, box.x / 2);
    pos[i * 3 + 1] = rng.float(0.2, box.y);
    pos[i * 3 + 2] = rng.float(-box.z / 2, box.z / 2);
    aSeed[i * 4] = rng.next();
    aSeed[i * 4 + 1] = rng.next();
    aSeed[i * 4 + 2] = rng.float(0.25, 1.3);
    aSeed[i * 4 + 3] = rng.float(0.5, 1.5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, box.y / 2, 0), Math.hypot(box.x, box.y, box.z));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uMap: { value: map },
      uColor: { value: new THREE.Color(color) },
      uSize: { value: size },
      uBoxY: { value: box.y },
      uSpeed: { value: speed },
      uSpin: { value: spin },
      uOpacity: { value: opacity },
      uPix: { value: 1 },
    },
    vertexShader: /* glsl */`
      attribute vec4 aSeed;
      uniform float uTime; uniform float uSize; uniform float uBoxY; uniform float uSpeed; uniform float uSpin; uniform float uPix;
      varying vec2 vRot; varying float vAlpha; varying float vTint;
      void main(){
        float t = uTime * uSpeed;
        vec3 p = position;
        float fall = 0.22 + aSeed.x * 0.5;
        p.y = mod(p.y - t * fall, uBoxY);
        float sw = t * (0.5 + aSeed.z * 0.5) + aSeed.y * 6.2831;
        p.x += sin(sw) * aSeed.z * 1.35;
        p.z += cos(sw * 0.83 + aSeed.x * 3.1) * aSeed.z * 1.05;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = max(0.001, -mv.z);
        // 近处限尺寸 + 淡出：否则贴脸的粒子会变成糊满屏幕的巨块
        gl_PointSize = min(uSize * aSeed.w * uPix * (340.0 / dist), 96.0 * uPix);
        gl_Position = projectionMatrix * mv;
        float a = uTime * uSpin * (0.6 + aSeed.x) + aSeed.y * 6.2831;
        vRot = vec2(cos(a), sin(a));
        vAlpha = smoothstep(0.0, 1.6, p.y) * smoothstep(uBoxY, uBoxY - 2.2, p.y) * smoothstep(0.5, 2.4, dist);
        vTint = 0.75 + aSeed.z * 0.4;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity;
      varying vec2 vRot; varying float vAlpha; varying float vTint;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        uv = mat2(vRot.x, -vRot.y, vRot.y, vRot.x) * uv + 0.5;
        vec4 t = texture2D(uMap, uv);
        if (t.a < 0.03) discard;
        gl_FragColor = vec4(uColor * vTint * t.rgb, t.a * vAlpha * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return pts;
}
