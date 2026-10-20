/**
 * world.js — 场景组装：实例化墙/柱/绿篱/花草、地貌、天穹、光照、
 * 出口拱门与传送门、星果、蝴蝶、GPU 粒子、拾取爆裂、探索格（小地图用）。
 */
import * as THREE from 'three';
import { CELL, T, H } from './maze.js';
import { TAU, clamp, lerp } from './lib.js';
import * as A from './art.js';

const WALL_H = H;

/* ─────────────── 拾取爆裂（池化） ─────────────── */
class Burst {
  constructor(tex) {
    const N = 24;
    this.N = N;
    this.life = 0;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
    this.pts = new THREE.Points(geo, new THREE.PointsMaterial({
      map: tex, color: 0xFFD873, size: 0.5, sizeAttenuation: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 1,
    }));
    this.pts.frustumCulled = false;
    this.pts.visible = false;
    this.vel = vel;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.42, 20),
      new THREE.MeshBasicMaterial({ color: 0xFFE9A8, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    this.ring.visible = false;
    this.ring.frustumCulled = false;
    this.grp = new THREE.Group();
    this.grp.add(this.pts, this.ring);
  }
  fire(x, y, z) {
    const pos = this.pts.geometry.attributes.position.array;
    for (let i = 0; i < this.N; i++) {
      const a = (i / this.N) * TAU + Math.random() * 0.4;
      const el = Math.random() * 1.1 + 0.15;
      const sp = 1.5 + Math.random() * 2.4;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      this.vel[i * 3] = Math.cos(a) * sp * Math.cos(el);
      this.vel[i * 3 + 1] = Math.sin(el) * sp;
      this.vel[i * 3 + 2] = Math.sin(a) * sp * Math.cos(el);
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    this.grp.position.set(0, 0, 0);
    this.ring.position.set(x, y, z);
    this.ring.scale.setScalar(1);
    this.pts.visible = this.ring.visible = true;
    this.pts.material.opacity = 1;
    this.ring.material.opacity = 0.85;
    this.life = 1;
  }
  update(dt) {
    if (this.life <= 0) return;
    this.life -= dt * 1.35;
    const pos = this.pts.geometry.attributes.position.array;
    for (let i = 0; i < this.N; i++) {
      this.vel[i * 3 + 1] -= 5.4 * dt;
      pos[i * 3] += this.vel[i * 3] * dt;
      pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    this.pts.material.opacity = Math.max(0, this.life);
    const k = 1 + (1 - this.life) * 4.2;
    this.ring.scale.setScalar(k);
    this.ring.material.opacity = Math.max(0, this.life) * 0.8;
    if (this.life <= 0) this.pts.visible = this.ring.visible = false;
  }
}

/* ─────────────── 实例化辅助 ─────────────── */
function instanced(geo, mat, count, castShadow = true, receiveShadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  m.count = count;
  m.castShadow = castShadow;
  m.receiveShadow = receiveShadow;
  m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  return m;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
function setI(mesh, i, x, y, z, sx, sy, sz, ry = 0, color = null) {
  _q.setFromAxisAngle(_p.set(0, 1, 0), ry);
  _m.compose(new THREE.Vector3(x, y, z), _q, _s.set(sx, sy, sz));
  mesh.setMatrixAt(i, _m);
  if (color !== null) mesh.setColorAt(i, _c.set(color));
}

/* ═══════════════════════════════════════════════════════════ */

export function createWorld(scene, maze, quality) {
  const rng = maze.rng;
  const root = new THREE.Group();
  scene.add(root);

  const disposables = [];
  const keep = (o) => (disposables.push(o), o);

  const W = maze.W, D = maze.D;
  const padX = W / 2 + 3.2, padZ = D / 2 + 3.2;

  /* ── 纹理与材质 ── */
  const texPath = keep(A.texPath(1));
  const texGrass = keep(A.texGrass(1));
  const texGlow = keep(A.texGlow());
  const texPetal = keep(A.texPetal());

  const matStone = keep(A.matStd({ roughness: 0.9, map: keep(A.texStone(2)) }));
  const matProp = keep(A.matProp());
  const matGlow = keep(new THREE.MeshBasicMaterial({ color: 0xFFF0C0, toneMapped: false }));

  /* ── 地貌 ── */
  const grassGeo = keep(new THREE.PlaneGeometry(600, 600));
  const grassMat = keep(new THREE.MeshStandardMaterial({
    map: texGrass, roughness: 1, metalness: 0, flatShading: false,
  }));
  texGrass.repeat.set(60, 60);
  const grass = new THREE.Mesh(grassGeo, grassMat);
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.78;
  grass.receiveShadow = true;
  root.add(grass);

  // 台基（迷宫所在的抬高石台）
  const slabGeo = keep(new THREE.BoxGeometry(padX * 2, 0.8, padZ * 2));
  const slabMat = keep(A.matStd({ color: A.PAL.stoneDark, roughness: 0.95 }));
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.position.y = -0.4;
  slab.receiveShadow = true;
  slab.castShadow = true;
  root.add(slab);

  // 台面铺装
  texPath.repeat.set(padX / 2.2, padZ / 2.2);
  const deckGeo = keep(new THREE.PlaneGeometry(padX * 2, padZ * 2));
  const deckMat = keep(new THREE.MeshStandardMaterial({ map: texPath, roughness: 0.94, metalness: 0 }));
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 0.004;
  deck.receiveShadow = true;
  root.add(deck);

  // 台缘压条
  const kerbN = Math.ceil((padX * 2 + padZ * 2) * 2 / 1.3);
  const kerb = instanced(keep(A.blockGeo(0.03)), matStone, kerbN, true, true);
  {
    let i = 0;
    const step = 1.3;
    for (let x = -padX + step / 2; x < padX && i < kerbN; x += step) {
      setI(kerb, i++, x, 0.0, -padZ + 0.16, step * 0.98, 0.2, 0.34, 0, A.PAL.stoneMid);
      setI(kerb, i++, x, 0.0, padZ - 0.16, step * 0.98, 0.2, 0.34, 0, A.PAL.stoneMid);
    }
    for (let z = -padZ + step; z < padZ - step && i < kerbN - 1; z += step) {
      setI(kerb, i++, -padX + 0.16, 0.0, z, 0.34, 0.2, step * 0.98, 0, A.PAL.stoneMid);
      setI(kerb, i++, padX - 0.16, 0.0, z, 0.34, 0.2, step * 0.98, 0, A.PAL.stoneMid);
    }
    kerb.count = i;
    kerb.instanceMatrix.needsUpdate = true;
    if (kerb.instanceColor) kerb.instanceColor.needsUpdate = true;
  }
  root.add(kerb);

  /* ── 墙体：石身 + 基座 + 压顶 + 绿篱冠 ── */
  const segs = maze.segs;
  const nSeg = segs.length;
  const wallBody = instanced(keep(A.blockGeo(0.042)), matStone, nSeg);
  const wallBase = instanced(keep(A.blockGeo(0.05)), matStone, nSeg);
  const wallCap = instanced(keep(A.blockGeo(0.025)), matStone, nSeg);

  const toneWall = [A.PAL.stone, A.PAL.stone, A.PAL.stoneMid, 0xEADCC0, 0xF7EBD4];
  for (let i = 0; i < nSeg; i++) {
    const s = segs[i];
    const w = s.hx * 2, d = s.hz * 2;
    const tint = s.outer ? A.PAL.stoneMid : toneWall[Math.floor(rng.next() * toneWall.length)];
    setI(wallBody, i, s.x, 0.16, s.z, w, WALL_H - 0.16, d, 0, tint);
    setI(wallBase, i, s.x, 0, s.z, w + 0.11, 0.24, d + 0.11, 0, A.PAL.stoneDark);
    setI(wallCap, i, s.x, WALL_H - 0.14, s.z, w + 0.17, 0.17, d + 0.17, 0, A.PAL.stoneMid);
  }
  [wallBody, wallBase, wallCap].forEach((m) => {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    root.add(m);
  });

  // 绿篱冠：每段墙一条连续树篱脊（长轴 X，竖墙旋转 90°）
  const hedgeGeoA = keep(A.hedgeRidgeGeo(3));
  const hedgeGeoB = keep(A.hedgeRidgeGeo(17));
  const matHedge = keep(A.matStd({ roughness: 0.95 }));
  const hedgeA = instanced(hedgeGeoA, matHedge, Math.ceil(nSeg / 2));
  const hedgeB = instanced(hedgeGeoB, matHedge, Math.floor(nSeg / 2) + 1);
  let ia = 0, ib = 0;
  const hedgeTone = [A.PAL.hedge, A.PAL.hedgeDark, 0x6AA84A, A.PAL.hedgeLite, 0x86BE5C];
  const CAP_H = 0.46;
  for (let i = 0; i < nSeg; i++) {
    const s = segs[i];
    const len = (s.vert ? s.hz : s.hx) * 2;
    const ry = s.vert ? Math.PI / 2 : 0;
    const tone = hedgeTone[Math.floor(rng.next() * hedgeTone.length)];
    const sy = CAP_H * rng.float(0.88, 1.18);
    const w = T * 1.58;
    if (i % 2 === 0) setI(hedgeA, ia++, s.x, WALL_H - 0.02, s.z, len, sy, w, ry, tone);
    else setI(hedgeB, ib++, s.x, WALL_H - 0.02, s.z, len, sy, w, ry, tone);
  }
  hedgeA.count = ia; hedgeB.count = ib;
  [hedgeA, hedgeB].forEach((m) => {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    root.add(m);
  });

  // 墙头探出的小花：让绿篱有"活"的边缘
  const wallFlowerN = Math.ceil(nSeg * 0.30);
  const wfMeshes = [];
  for (let v = 0; v < 5; v++) {
    const geo = keep(A.flowerGeo(A.PAL.petals[v], 40 + v));
    wfMeshes.push({ m: instanced(geo, matProp, Math.ceil(wallFlowerN / 5), true, false), i: 0 });
  }
  for (let i = 0; i < nSeg; i++) {
    if (!rng.chance(0.30)) continue;
    const s = segs[i];
    const n = rng.int(1, 2);
    for (let k = 0; k < n; k++) {
      const slot = wfMeshes[Math.floor(rng.next() * wfMeshes.length)];
      if (slot.i >= slot.m.count) continue;
      const along = (s.vert ? s.hz : s.hx) * 2;
      const off = rng.float(-0.42, 0.42) * along;
      const across = rng.float(-0.16, 0.16);
      const x = s.vert ? s.x + across : s.x + off;
      const z = s.vert ? s.z + off : s.z + across;
      const sc = rng.float(0.72, 1.0);
      setI(slot.m, slot.i++, x, WALL_H + CAP_H * 0.55, z, sc, sc, sc, rng.float(0, TAU));
    }
  }
  wfMeshes.forEach((s) => {
    if (!s.i) { s.m.dispose(); return; }
    s.m.count = s.i;
    s.m.instanceMatrix.needsUpdate = true;
    root.add(s.m);
  });

  /* ── 立柱与灯柱 ── */
  const smallPosts = maze.posts.filter((p) => !p.big);
  const bigPosts = maze.posts.filter((p) => p.big);
  const lamps = maze.posts.filter((p) => p.lantern);
  const postS = instanced(keep(A.postGeo(false)), matProp, smallPosts.length);
  const postB = instanced(keep(A.postGeo(true)), matProp, bigPosts.length);
  smallPosts.forEach((p, i) => setI(postS, i, p.x, 0, p.z, 1, rng.float(0.96, 1.05), 1, rng.float(0, TAU)));
  bigPosts.forEach((p, i) => setI(postB, i, p.x, 0, p.z, 1, rng.float(0.98, 1.04), 1, rng.float(0, TAU)));
  const lampStone = instanced(keep(A.lampStoneGeo()), matProp, lamps.length);
  const lampGlow = instanced(keep(A.lampGlowGeo()), matGlow, lamps.length, false, false);
  lamps.forEach((p, i) => {
    setI(lampStone, i, p.x, 0, p.z, 1, 1, 1, rng.float(0, TAU));
    setI(lampGlow, i, p.x, 0, p.z, rng.float(0.9, 1.15), rng.float(0.9, 1.15), rng.float(0.9, 1.15), 0);
  });
  [postS, postB, lampStone, lampGlow].forEach((m) => { m.instanceMatrix.needsUpdate = true; root.add(m); });
  const lampMat = matGlow;

  /* ── 可通行的格子集合（用于摆放装饰） ── */
  const openCells = [];
  for (let cy = 0; cy < maze.rows; cy++)
    for (let cx = 0; cx < maze.cols; cx++) openCells.push({ cx, cy });
  const fruitCells = new Set(maze.fruits.map((f) => f.cy * maze.cols + f.cx));
  const reserved = new Set([maze.start.cell, maze.exit.cell, ...fruitCells]);

  /* ── 星果 ── */
  const starGeo = keep(A.starGeo());
  const coreGeo = keep(new THREE.OctahedronGeometry(0.15, 0));
  const matStar = keep(new THREE.MeshStandardMaterial({
    color: A.PAL.gold, emissive: new THREE.Color(0xFFAE1E), emissiveIntensity: 0.95,
    roughness: 0.28, metalness: 0.25, flatShading: true,
  }));
  const matCore = keep(new THREE.MeshBasicMaterial({ color: 0xFFF3C4, toneMapped: false }));
  const matSprite = keep(new THREE.SpriteMaterial({
    map: texGlow, color: 0xFFD479, transparent: true, opacity: 0.62,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));

  const fruits = maze.fruits.map((f) => {
    const g = new THREE.Group();
    const star = new THREE.Mesh(starGeo, matStar);
    star.castShadow = true;
    star.scale.setScalar(0.92);
    const core = new THREE.Mesh(coreGeo, matCore);
    const halo = new THREE.Sprite(matSprite.clone());
    halo.scale.setScalar(2.5);
    g.add(star, core, halo);
    g.position.set(f.x, 1.22, f.z);
    root.add(g);
    return { ...f, grp: g, star, core, halo, taken: false, t: f.phase, pull: 0 };
  });

  /* ── 出口拱门 + 传送门 ── */
  const exitGrp = new THREE.Group();
  const arch = new THREE.Mesh(keep(A.archGeo()), matProp);
  arch.castShadow = true;
  arch.receiveShadow = true;
  exitGrp.add(arch);

  // 门内辉光面
  const portalTex = keep(A.texGlow());
  const portalMat = keep(new THREE.MeshBasicMaterial({
    map: portalTex, color: 0xFFCF8A, transparent: true, opacity: 0.34,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  const portal = new THREE.Mesh(keep(new THREE.CircleGeometry(1.42, 24)), portalMat);
  portal.position.set(0, A.ARCH_DIM.pierH + 0.05, 0);
  exitGrp.add(portal);

  const ringMat = keep(new THREE.MeshStandardMaterial({
    color: A.PAL.gold, emissive: new THREE.Color(0xFFB62E), emissiveIntensity: 0.55,
    roughness: 0.3, metalness: 0.4, flatShading: true,
  }));
  const rings = [];
  [[1.22, 0.05, 1.0], [0.92, 0.04, -1.5], [0.6, 0.032, 2.2]].forEach(([r, tb, sp]) => {
    const m = new THREE.Mesh(keep(new THREE.TorusGeometry(r, tb, 4, 14)), ringMat);
    m.position.copy(portal.position);
    m.userData.spin = sp;
    exitGrp.add(m);
    rings.push(m);
  });

  // 拱门两侧攀爬的花环与小花
  const garlandGeo = keep(A.blobGeo(31, 0.8, 0.3));
  const garland = instanced(garlandGeo, matStone, 22, true, false);
  {
    let i = 0;
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 7 && i < 22; k++) {
        const y = 0.3 + k * 0.3;
        const a = k * 0.9;
        setI(garland, i++, sx * A.ARCH_DIM.pierX + Math.cos(a) * 0.3, y, Math.sin(a) * 0.28,
          0.4 + rng.float(0, 0.18), 0.34, 0.4, rng.float(0, TAU),
          k % 3 === 0 ? A.PAL.hedgeLite : A.PAL.hedge);
      }
      for (let k = 0; k < 4 && i < 22; k++) {
        const y = 0.55 + k * 0.5;
        setI(garland, i++, sx * (A.ARCH_DIM.pierX + 0.36), y, 0.3, 0.19, 0.19, 0.19, 0, A.PAL.petals[k % A.PAL.petals.length]);
      }
    }
    garland.count = i;
    garland.instanceMatrix.needsUpdate = true;
    if (garland.instanceColor) garland.instanceColor.needsUpdate = true;
  }
  exitGrp.add(garland);

  // 出口朝向：让它面向迷宫内部（背对外边界）
  const ex = maze.exit;
  exitGrp.position.set(ex.x, 0, ex.z);
  let exitYaw = 0;
  {
    const openBits = maze.open[ex.cell];
    if (openBits & 1) exitYaw = Math.PI;        // 北开口 → 面朝 -Z
    else if (openBits & 4) exitYaw = 0;         // 南开口 → 面朝 +Z
    else if (openBits & 8) exitYaw = -Math.PI / 2;
    else if (openBits & 2) exitYaw = Math.PI / 2;
  }
  exitGrp.rotation.y = exitYaw;
  root.add(exitGrp);

  const exitLight = new THREE.PointLight(0xFFC46A, 0, 18, 2);
  exitLight.position.set(ex.x, 2.1, ex.z);
  root.add(exitLight);
  const exitPos = { x: ex.x, z: ex.z };

  /* ── 场景装饰：花、草、蘑菇、灌木、石、长椅、喷泉、顶植树 ── */
  const decoScale = quality === 'low' ? 0.55 : quality === 'mid' ? 0.85 : 1.0;

  // 收集可用摆放点：迷宫内空地 + 台缘外圈草地
  const spotsIn = [];
  for (const c of openCells) {
    if (reserved.has(c.cy * maze.cols + c.cx)) continue;
    const p = maze.cellCenter(c.cx, c.cy);
    spotsIn.push({ x: p.x, z: p.z, cx: c.cx, cy: c.cy, out: false });
  }
  const spotsOut = [];
  const ringR = Math.max(padX, padZ);
  for (let i = 0; i < 190; i++) {
    const a = rng.float(0, TAU);
    const r = ringR + rng.float(4, 62);
    spotsOut.push({ x: Math.cos(a) * r * 1.15, z: Math.sin(a) * r, out: true });
  }

  /**
   * 在给定摆点集合上随机散布实例化构件。
   * 逐点掷骰（而不是"凑够 total 就 break"），否则装饰会全挤在列表前段。
   */
  function scatter(list, geoFactory, variants, perSpot, opts = {}) {
    const maxPer = opts.maxCount || 1;
    const expect = list.length * perSpot * decoScale * ((1 + maxPer) / 2);
    const cap = Math.max(4, Math.ceil((expect / variants) * 2.4));
    const meshes = [];
    for (let v = 0; v < variants; v++) {
      const geo = keep(geoFactory(v));
      if (!geo.attributes.color) A.paintWhite(geo);
      meshes.push({ m: instanced(geo, matProp, cap, !!opts.shadow, !!opts.shadow), i: 0 });
    }
    for (const sp of list) {
      if (!rng.chance(perSpot * decoScale)) continue;
      const n = opts.count ? opts.count() : 1;
      for (let k = 0; k < n; k++) {
        const slot = meshes[Math.floor(rng.next() * variants)];
        if (slot.i >= cap) continue;
        const rad = opts.radius === undefined ? 1.05 : opts.radius;
        const a = rng.float(0, TAU), rr = rad * Math.sqrt(rng.next());
        const sc = (opts.scale || 1) * rng.float(0.78, 1.28);
        setI(slot.m, slot.i++,
          sp.x + Math.cos(a) * rr, opts.y || 0, sp.z + Math.sin(a) * rr,
          sc, sc * rng.float(0.88, 1.16), sc, rng.float(0, TAU));
      }
    }
    let added = 0;
    for (const s of meshes) {
      if (s.i === 0) { s.m.dispose(); continue; }
      s.m.count = s.i;
      s.m.instanceMatrix.needsUpdate = true;
      root.add(s.m);
      added += s.i;
    }
    return added;
  }

  // 迷宫内：草丛 + 石子 + 零星小花 + 蘑菇
  scatter(spotsIn, () => A.tuftGeo(rng.int(1, 999)), 1, 0.75, { radius: 1.15, scale: 1.05, shadow: true, maxCount: 3, count: () => rng.int(1, 3) });
  scatter(spotsIn, () => A.pebbleGeo(rng.int(1, 999)), 2, 0.4, { radius: 1.2, scale: 0.42, y: 0.02, shadow: true, maxCount: 2, count: () => rng.int(1, 2) });
  scatter(spotsIn, (v) => A.flowerGeo(A.PAL.petals[v], rng.int(1, 999)), 6, 0.55, { radius: 1.2, scale: 1.0, shadow: true, maxCount: 3, count: () => rng.int(1, 3) });
  scatter(spotsIn, (v) => A.mushroomGeo(A.PAL.caps[v], rng.int(1, 999)), 4, 0.14, { radius: 1.1, scale: 1.1, shadow: true, maxCount: 2, count: () => rng.int(1, 2) });

  // 台缘外：树、灌木、花丛、草、蘑菇
  scatter(spotsOut, () => A.treeGeo(rng.int(1, 999)), 1, 0.20, { radius: 6, scale: 1.55, y: -0.78, shadow: true, maxCount: 2, count: () => rng.int(1, 2) });
  scatter(spotsOut, () => A.bushGeo(rng.int(1, 999)), 1, 0.34, { radius: 6, scale: 1.3, y: -0.78, shadow: true, maxCount: 2, count: () => rng.int(1, 2) });
  scatter(spotsOut, (v) => A.flowerGeo(A.PAL.petals[v], rng.int(1, 999)), 6, 0.62, { radius: 6, scale: 1.4, y: -0.78, shadow: true, maxCount: 4, count: () => rng.int(1, 4) });
  scatter(spotsOut, () => A.tuftGeo(rng.int(1, 999)), 1, 0.7, { radius: 6, scale: 1.45, y: -0.78, shadow: true, maxCount: 3, count: () => rng.int(1, 3) });
  scatter(spotsOut, (v) => A.mushroomGeo(A.PAL.caps[v], rng.int(1, 999)), 4, 0.16, { radius: 6, scale: 1.45, y: -0.78, shadow: true, maxCount: 3, count: () => rng.int(1, 3) });

  /* ── 地标：喷泉（迷宫中心）+ 长椅 + 顶植树，帮助认路 ── */
  const landmarks = [];
  {
    const ccx = Math.floor(maze.cols / 2), ccy = Math.floor(maze.rows / 2);
    const c = maze.cellCenter(ccx, ccy);
    const f = new THREE.Mesh(keep(A.fountainGeo()), matProp);
    f.position.set(c.x, 0, c.z);
    f.castShadow = f.receiveShadow = true;
    root.add(f);
    landmarks.push({ kind: 'fountain', x: c.x, z: c.z });
  }
  const benchGeo = keep(A.benchGeo());
  // 长椅不挡出口/起点/星果所在格及其邻格
  const blockedCells = new Set();
  for (const k of [maze.start.cell, maze.exit.cell, ...fruitCells]) {
    const bx = k % maze.cols, by = (k / maze.cols) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = bx + dx, cy = by + dy;
      if (cx >= 0 && cy >= 0 && cx < maze.cols && cy < maze.rows) blockedCells.add(cy * maze.cols + cx);
    }
  }
  const benchSpots = rng.shuffle(spotsIn.filter((s) => maze.dist[s.cy * maze.cols + s.cx] > 3 && !blockedCells.has(s.cy * maze.cols + s.cx)))
    .slice(0, Math.min(6, Math.floor(spotsIn.length / 14)));
  if (benchSpots.length) {
    const benches = instanced(benchGeo, matProp, benchSpots.length);
    benchSpots.forEach((s, i) => {
      setI(benches, i, s.x, 0, s.z, 1, 1, 1, rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]));
    });
    benches.instanceMatrix.needsUpdate = true;
    root.add(benches);
  }

  /* ── 远景：丘陵 + 云 ── */
  const hillGeo = keep(A.blobGeo(77, 0.34, 0.22));
  const matHill = keep(A.matStd({ color: 0x8FBE77, roughness: 1 }));
  const hills = instanced(hillGeo, matHill, 16, false, false);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + rng.float(-0.15, 0.15);
    const r = rng.float(125, 215);
    const sx = rng.float(40, 96);
    setI(hills, i, Math.cos(a) * r, -3.6, Math.sin(a) * r, sx, rng.float(16, 40), sx * rng.float(0.7, 1.2), rng.float(0, TAU),
      i % 3 === 0 ? 0x86B46E : 0x9CC484);
  }
  hills.instanceMatrix.needsUpdate = true;
  if (hills.instanceColor) hills.instanceColor.needsUpdate = true;
  root.add(hills);

  const clouds = [];
  const cloudMat = keep(A.matProp({ roughness: 1, emissive: new THREE.Color(0x334455), emissiveIntensity: 0.12 }));
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(keep(A.cloudGeo(rng.int(1, 500))), cloudMat);
    const a = rng.float(0, TAU);
    const r = rng.float(70, 190);
    c.position.set(Math.cos(a) * r, rng.float(38, 66), Math.sin(a) * r);
    const s = rng.float(6, 15);
    c.scale.set(s, s * rng.float(0.5, 0.75), s * rng.float(0.7, 1));
    c.userData.vx = rng.float(0.5, 1.5) * (rng.chance(0.5) ? 1 : -1);
    c.userData.r = r;
    root.add(c);
    clouds.push(c);
  }

  /* ── 蝴蝶（3 个 InstancedMesh：左翅/右翅/身） ── */
  const BF = quality === 'low' ? 8 : 16;
  const wingGeo = keep(A.wingGeo());
  // 蝴蝶很小，用无光照材质保证永远是明亮的粉彩，不会逆光成黑斑
  const matWing = keep(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const wingL = instanced(wingGeo, matWing, BF, false, false);
  const wingR = instanced(wingGeo, matWing, BF, false, false);
  const bodyM = instanced(keep(A.blobGeo(88, 1.6, 0.2)), matWing, BF, false, false);
  const bfColors = [0xFFB3C7, 0xFFE08A, 0xC7E9FF, 0xFFD6A5, 0xE0C3FC, 0xFFFFFF];
  const flies = [];
  for (let i = 0; i < BF; i++) {
    const home = spotsIn.length ? rng.pick(spotsIn) : { x: 0, z: 0 };
    flies.push({
      hx: home.x, hz: home.z,
      r: rng.float(1.2, 4.2), sp: rng.float(0.35, 0.95) * (rng.chance(0.5) ? -1 : 1),
      ph: rng.float(0, TAU), y: rng.float(1.15, 2.6), flap: rng.float(9, 15),
      c: bfColors[i % bfColors.length],
    });
    wingL.setColorAt(i, _c.set(bfColors[i % bfColors.length]));
    wingR.setColorAt(i, _c.set(bfColors[i % bfColors.length]));
    bodyM.setColorAt(i, _c.set(0x4A3B2A));
  }
  [wingL, wingR, bodyM].forEach((m) => { if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  root.add(wingL, wingR, bodyM);

  /* ── GPU 粒子：飘落花瓣 + 悬浮花粉 ── */
  const petalCount = quality === 'low' ? 140 : quality === 'mid' ? 260 : 400;
  const petals = A.makeParticleField({
    count: petalCount, box: { x: W + 26, y: 16, z: D + 26 }, map: texPetal,
    color: 0xFFD3DE, size: 13, speed: 0.55, spin: 1.1, opacity: 0.78, seed: 5,
  });
  const pollen = A.makeParticleField({
    count: Math.floor(petalCount * 0.6), box: { x: W + 18, y: 7, z: D + 18 }, map: texGlow,
    color: 0xFFF0B4, size: 6.5, speed: 0.24, spin: 0.2, opacity: 0.7, seed: 9,
  });
  root.add(petals, pollen);

  /* ── 光照 ── */
  const hemi = new THREE.HemisphereLight(0xCFE9FF, 0xBFA06A, 0.95);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xFFF2D6, 2.35);
  sun.position.set(26, 38, 20);
  sun.castShadow = quality !== 'low';
  const shSize = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(shSize, shSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  const S = Math.min(30, Math.max(18, Math.max(W, D) * 0.42));
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.035;
  root.add(sun);
  root.add(sun.target);
  const fill = new THREE.DirectionalLight(0xBFD9FF, 0.42);
  fill.position.set(-22, 16, -18);
  root.add(fill);

  /* ── 拾取爆裂池 ── */
  const bursts = [];
  for (let i = 0; i < 4; i++) {
    const b = new Burst(texGlow);
    root.add(b.grp);
    bursts.push(b);
  }
  let burstIdx = 0;

  /* ── 探索格（小地图雾） ── */
  const nCells = maze.cols * maze.rows;
  const seen = new Uint8Array(nCells);
  const reveal = new Float32Array(nCells);
  let seenCount = 0;

  function markExplored(x, z) {
    // 半径 ≈ 1.18 格：点亮脚下这格 + 四条能看进去的走廊，斜角不点亮
    const R = CELL * 1.18;
    const c = maze.cellOf(x, z);
    for (let gy = Math.max(0, c.cy - 2); gy <= Math.min(maze.rows - 1, c.cy + 2); gy++) {
      for (let gx = Math.max(0, c.cx - 2); gx <= Math.min(maze.cols - 1, c.cx + 2); gx++) {
        const k = gy * maze.cols + gx;
        if (seen[k]) continue;
        const p = maze.cellCenter(gx, gy);
        if (Math.hypot(p.x - x, p.z - z) > R) continue;
        seen[k] = 1;
        seenCount++;
      }
    }
  }

  /* ── 每帧更新 ── */
  const _e = new THREE.Euler();

  function update(dt, time, player) {
    // 星果：浮动 + 自旋 + 靠近吸附
    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      if (f.taken) continue;
      f.t += dt;
      const bob = Math.sin(f.t * 1.9) * 0.13;
      f.grp.position.y = 1.22 + bob;
      f.star.rotation.y = f.t * 1.5;
      f.star.rotation.z = Math.sin(f.t * 0.9) * 0.16;
      f.core.rotation.y = -f.t * 2.6;
      f.core.rotation.x = f.t * 1.4;
      const pulse = 0.86 + Math.sin(f.t * 3.1) * 0.14;
      f.halo.scale.setScalar(2.5 * pulse);
      f.halo.material.opacity = 0.5 + pulse * 0.18;
      // 吸附：玩家靠近时轻微飘向玩家
      const dx = player.x - f.grp.position.x, dz = player.z - f.grp.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.4) {
        f.pull = Math.min(1, f.pull + dt * 2.6);
        f.grp.position.x = f.x + dx * f.pull * 0.34;
        f.grp.position.z = f.z + dz * f.pull * 0.34;
        f.grp.position.y += f.pull * 0.22;
      } else if (f.pull > 0) {
        f.pull = Math.max(0, f.pull - dt * 2);
        f.grp.position.x = lerp(f.grp.position.x, f.x, 0.2);
        f.grp.position.z = lerp(f.grp.position.z, f.z, 0.2);
      }
    }

    // 传送门
    // 传送门（玩家靠近时更亮，起引导作用）
    const dExit = Math.hypot(player.x - exitPos.x, player.z - exitPos.z);
    const near = clamp(1 - dExit / 14, 0, 1);
    const pp = 0.82 + Math.sin(time * 2.1) * 0.18;
    portalMat.opacity = 0.24 + pp * 0.10 + near * 0.16;
    portal.scale.setScalar(0.96 + pp * 0.05 + near * 0.08);
    for (const r of rings) {
      r.rotation.z += dt * r.userData.spin * (0.55 + near * 0.9);
      r.rotation.x = Math.sin(time * 0.7 + r.userData.spin) * 0.32;
    }
    exitLight.intensity = (1.5 + Math.sin(time * 2.4) * 0.5) * (1 + near * 1.8);
    lampMat.color.setHSL(0.12, 0.62, 0.72 + Math.sin(time * 3.3) * 0.05);

    // 蝴蝶
    for (let i = 0; i < BF; i++) {
      const b = flies[i];
      const a = time * b.sp + b.ph;
      const x = b.hx + Math.cos(a) * b.r + Math.sin(a * 0.37) * 0.7;
      const z = b.hz + Math.sin(a * 1.13) * b.r;
      const y = b.y + Math.sin(time * 1.7 + b.ph) * 0.35;
      const fl = Math.sin(time * b.flap + b.ph) * 0.85;
      // 机头对准飞行方向（dx/dt, dz/dt）
      const heading = Math.atan2(-Math.sin(a) * b.r * b.sp, Math.cos(a * 1.13) * b.r * 1.13 * b.sp);
      // 贴脸时缩到看不见，避免糊成一块色斑
      const dCam = Math.hypot(x - player.x, z - player.z);
      const sc = dCam < 1.5 ? 0.001 : 0.5;
      _p.set(x, y, z);

      _q.setFromEuler(_e.set(0, heading, fl));
      _m.compose(_p, _q, _s.set(sc, sc, sc));
      wingR.setMatrixAt(i, _m);
      _q.setFromEuler(_e.set(0, heading, -fl));
      _m.compose(_p, _q, _s.set(-sc, sc, sc));
      wingL.setMatrixAt(i, _m);
      _q.setFromEuler(_e.set(0, heading, 0));
      _m.compose(_p, _q, _s.set(0.13, 0.13, 0.3));
      bodyM.setMatrixAt(i, _m);
    }
    wingL.instanceMatrix.needsUpdate = true;
    wingR.instanceMatrix.needsUpdate = true;
    bodyM.instanceMatrix.needsUpdate = true;

    // 粒子
    petals.material.uniforms.uTime.value = time;
    pollen.material.uniforms.uTime.value = time;

    // 云
    for (const c of clouds) {
      c.position.x += c.userData.vx * dt;
      if (c.position.x > 230) c.position.x = -230;
      if (c.position.x < -230) c.position.x = 230;
    }

    // 阴影相机跟随玩家 → 近处阴影锐利
    sun.position.set(player.x + 26, 38, player.z + 20);
    sun.target.position.set(player.x, 0, player.z);
    sun.target.updateMatrixWorld();

    // 爆裂
    for (const b of bursts) b.update(dt);

    // 探索格淡入
    for (let i = 0; i < nCells; i++) {
      if (seen[i] && reveal[i] < 1) reveal[i] = Math.min(1, reveal[i] + dt * 3.4);
    }
  }

  function takeFruit(i) {
    const f = fruits[i];
    if (!f || f.taken) return false;
    f.taken = true;
    f.grp.visible = false;
    const b = bursts[burstIdx++ % bursts.length];
    b.fire(f.grp.position.x, f.grp.position.y, f.grp.position.z);
    return true;
  }

  /** 拾取判定：返回刚吃到的星果序号数组 */
  function collectNear(x, z, y) {
    const got = [];
    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      if (f.taken) continue;
      const dx = f.grp.position.x - x, dz = f.grp.position.z - z, dy = f.grp.position.y - y;
      if (dx * dx + dz * dz < 1.15 * 1.15 && Math.abs(dy) < 1.9) got.push(i);
    }
    return got;
  }

  function dispose() {
    for (const d of disposables) if (d && d.dispose) d.dispose();
    scene.remove(root);
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => m.dispose());
      }
    });
  }

  return {
    root, fruits, update, takeFruit, collectNear, dispose,
    markExplored, seen, reveal,
    exploredRatio: () => seenCount / nCells,
    nCells,
    exitGroup: exitGrp,
    exitWorld: new THREE.Vector3(ex.x, 0, ex.z),
    lights: { hemi, sun, fill, exitLight },
    stats: {
      segments: nSeg,
      posts: maze.posts.length,
      lamps: lamps.length,
      hedge: nSeg,
      fruits: fruits.length,
      butterflies: BF,
      petals: petalCount,
    },
  };
}
