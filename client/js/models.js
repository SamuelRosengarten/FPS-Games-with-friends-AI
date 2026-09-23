// Procedural models: weapons (shared by first and third person) and player characters.

import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { PLAYER } from '../shared/constants.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { gunMaps, projectUV } from './gunmats.js';
import { Builder, bakedMaterial, SURF } from './surface.js';
import { makeRig, operatorGeometry, teamLook, UPPER_ARM, FORE_ARM } from './character.js';

export { teamLook, bakedMaterial };

const matCache = new Map();
function mat(key, params) {
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial(params));
  return matCache.get(key);
}
// Surface detail maps; roughness maps multiply the material roughness, so divide by their average.
const SURF_AVG = { metal: 0.42, polymer: 0.66, wood: 0.52, fabric: 0.8, rubber: 1 };
function detailed(key, params, kind) {
  if (matCache.has(key)) return matCache.get(key);
  const maps = gunMaps()[kind];
  const m = new THREE.MeshStandardMaterial({ ...params, ...maps });
  m.userData.surf = kind;
  if (maps.roughnessMap) m.roughness = Math.min(1, params.roughness / SURF_AVG[kind]);
  m.normalScale.set(0.7, 0.7);
  matCache.set(key, m);
  return m;
}
const M = {
  gunmetal: () => detailed('gunmetal', { color: 0x2a2c30, metalness: 0.75, roughness: 0.38 }, 'metal'),
  steel: () => detailed('steel', { color: 0x8d9299, metalness: 0.9, roughness: 0.3 }, 'metal'),
  blade: () => detailed('blade', { color: 0xc8ccd2, metalness: 1, roughness: 0.2 }, 'metal'),
  polymer: () => detailed('polymer', { color: 0x1c1d1f, metalness: 0.05, roughness: 0.72 }, 'polymer'),
  wood: () => detailed('wood', { color: 0x74431f, metalness: 0, roughness: 0.5 }, 'wood'),
  brass: () => mat('brass', { color: 0xc9a14a, metalness: 1, roughness: 0.3 }),
  glass: () => mat('glass', { color: 0x223344, metalness: 0.9, roughness: 0.05, emissive: 0x0a1a2a }),
  red: () => mat('reddot', { color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 }),
  rubber: () => detailed('rubber', { color: 0x161616, metalness: 0, roughness: 0.9 }, 'rubber'),
  color: (hex, metal = 0.35, rough = 0.5) => detailed(`c${hex}_${metal}_${rough}`, { color: hex, metalness: metal, roughness: rough }, metal >= 0.4 ? 'metal' : 'polymer'),
};

// Weapon parts: chamfered edges (they catch highlights) and metre-scaled UVs for the detail maps.
function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const mn = Math.min(w, h, d);
  const geo = mn >= 0.008 ? new RoundedBoxGeometry(w, h, d, 1, Math.min(0.0035, mn * 0.2)) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(projectUV(geo), material);
  m.position.set(x, y, z);
  return m;
}
function cyl(r, len, material, x = 0, y = 0, z = 0, axis = 'z', seg = 14, r2 = r) {
  const m = new THREE.Mesh(projectUV(new THREE.CylinderGeometry(r2, r, len, seg)), material);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  else if (axis === 'x') m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

// Merge unnamed sibling meshes that share a material into one mesh (fewer draw calls).
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
export function mergeStatic(group) {
  for (const child of [...group.children]) if (!child.isMesh && child.children.length) mergeStatic(child);
  const buckets = new Map();
  for (const c of group.children) {
    if (!c.isMesh || c.name || c.children.length || !c.geometry.attributes.normal) continue;
    const key = c.material.uuid;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  }
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const pos = [], nor = [], uv = [], idx = [];
    for (const m of meshes) {
      m.updateMatrix();
      const nm = new THREE.Matrix3().getNormalMatrix(m.matrix);
      const g = m.geometry;
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      const base = pos.length / 3;
      for (let i = 0; i < P.count; i++) {
        _v.fromBufferAttribute(P, i).applyMatrix4(m.matrix);
        _n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        pos.push(_v.x, _v.y, _v.z);
        nor.push(_n.x, _n.y, _n.z);
        if (U) uv.push(U.getX(i), U.getY(i)); else uv.push(0, 0);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
      else for (let i = 0; i < P.count; i++) idx.push(base + i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const merged = new THREE.Mesh(geo, meshes[0].material);
    merged.castShadow = meshes[0].castShadow;
    merged.receiveShadow = meshes[0].receiveShadow;
    for (const m of meshes) { group.remove(m); m.geometry.dispose(); }
    group.add(merged);
  }
  return group;
}

// ------------------------------------------------------------------ weapons
// Convention: barrel points to -Z, origin at the firing hand grip, +Y up. Metres.

function finish(g, info) {
  mergeStatic(g);
  g.userData = { ...info };
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function buildPistol(o) {
  const g = new THREE.Group();
  const L = o.len;
  const body = M.color(o.body, 0.6, 0.35);
  const frameMat = M.color(o.accent, 0.25, 0.6);
  const W = o.big ? 0.036 : 0.03;
  // slide with chamfered top, serrations and ejection port
  const slide = new THREE.Group();
  slide.name = 'slide';
  slide.add(box(W, 0.03, L, body, 0, 0.05, -L / 2 + 0.035));
  slide.add(box(W * 0.78, 0.01, L * 0.98, body, 0, 0.069, -L / 2 + 0.035));
  for (let i = 0; i < 5; i++) {
    slide.add(box(W + 0.002, 0.022, 0.003, M.gunmetal(), 0, 0.05, 0.02 - i * 0.008));
  }
  slide.add(box(W * 0.5, 0.004, 0.035, M.polymer(), 0.0, 0.0745, -0.045));
  slide.add(box(0.006, 0.008, 0.008, M.polymer(), 0, 0.077, -L + 0.045));   // front sight
  slide.add(box(0.006, 0.009, 0.007, M.polymer(), 0.0065, 0.077, 0.016));
  slide.add(box(0.006, 0.009, 0.007, M.polymer(), -0.0065, 0.077, 0.016));
  g.add(slide);
  g.add(cyl(0.007, 0.018, M.steel(), 0, 0.052, -L + 0.027));                  // barrel crown
  // frame, rail, trigger
  g.add(box(W * 0.95, 0.024, L * 0.78, frameMat, 0, 0.024, -L * 0.39 + 0.035));
  g.add(box(W * 0.8, 0.008, L * 0.3, frameMat, 0, 0.009, -L * 0.62));
  const grip = box(W * 0.95, o.big ? 0.12 : 0.105, 0.048, M.polymer(), 0, -0.035, 0.022);
  grip.rotation.x = 0.22;
  g.add(grip);
  const texture = box(W + 0.002, 0.05, 0.03, M.rubber(), 0, -0.035, 0.022);
  texture.rotation.x = 0.22;
  g.add(texture);
  g.add(box(W * 0.9, 0.012, 0.02, M.polymer(), 0, 0.012, 0.035)); // beavertail
  g.add(box(0.006, 0.006, 0.048, M.polymer(), 0, -0.006, -0.03));  // trigger guard bottom
  g.add(box(0.006, 0.026, 0.006, M.polymer(), 0, 0.004, -0.054));  // guard front
  const trig = box(0.004, 0.018, 0.004, M.steel(), 0, 0.004, -0.022);
  trig.rotation.x = 0.3;
  g.add(trig);
  const mag = new THREE.Group();
  mag.add(box(W * 0.8, 0.02, 0.038, M.gunmetal(), 0, -0.085, 0.034));
  mag.children[0].rotation.x = 0.22;
  mag.name = 'mag';
  g.add(mag);
  return finish(g, { muzzle: [0, 0.052, -L + 0.018], eject: [0.02, 0.066, -0.04], sightY: 0.081, fore: [-0.012, -0.03, 0.02], grip: [0, -0.02, 0.02], kind: 'pistol' });
}

function buildSMG(o) {
  const g = new THREE.Group();
  const L = o.len;
  const body = M.color(o.body, 0.45, 0.45);
  g.add(box(0.045, 0.06, L * 0.62, body, 0, 0.045, -L * 0.25));
  g.add(cyl(0.011, L * 0.3, M.gunmetal(), 0, 0.052, -L * 0.6 - L * 0.12));
  if (!o.stubby) g.add(cyl(0.02, 0.08, M.polymer(), 0, 0.052, -L * 0.72));
  const grip = box(0.028, 0.1, 0.04, M.polymer(), 0, -0.03, 0.015);
  grip.rotation.x = 0.2;
  g.add(grip);
  const mag = box(0.026, 0.16, 0.034, M.gunmetal(), 0, -0.05, -0.1);
  mag.name = 'mag';
  g.add(mag);
  // stock
  const stock = new THREE.Group();
  stock.name = 'stock';
  stock.add(box(0.012, 0.012, 0.18, M.gunmetal(), 0.015, 0.06, 0.12));
  stock.add(box(0.012, 0.012, 0.18, M.gunmetal(), -0.015, 0.06, 0.12));
  stock.add(box(0.04, 0.07, 0.015, M.polymer(), 0, 0.045, 0.21));
  g.add(stock);
  // sights / rail
  g.add(box(0.03, 0.01, L * 0.4, M.gunmetal(), 0, 0.08, -L * 0.2));
  g.add(box(0.005, 0.016, 0.008, M.gunmetal(), 0, 0.092, -L * 0.42));
  g.add(box(0.007, 0.016, 0.01, M.gunmetal(), 0.0075, 0.093, 0.02));
  g.add(box(0.007, 0.016, 0.01, M.gunmetal(), -0.0075, 0.093, 0.02));
  g.add(box(0.03, 0.035, 0.05, M.color(o.accent, 0.3, 0.6), 0, 0.01, -L * 0.42));
  return finish(g, { muzzle: [0, 0.052, -L * 0.87], eject: [0.025, 0.06, -0.08], sightY: 0.1, fore: [0, 0.0, -L * 0.42], grip: [0, -0.02, 0.015], kind: 'smg' });
}

function buildRifle(o) {
  const g = new THREE.Group();
  const ak = o.style === 'ak';
  const body = M.color(o.body, 0.6, 0.4);
  const dark = M.gunmetal();
  const furniture = ak ? M.wood() : M.color(o.accent, 0.2, 0.6);
  const add = (m, rx = 0, ry = 0, rz = 0) => { if (rx || ry || rz) m.rotation.set(rx, ry, rz); g.add(m); return m; };
  const stock = new THREE.Group();
  stock.name = 'stock';
  const mag = new THREE.Group();
  mag.name = 'mag';
  if (ak) {
    // receiver: lower body, domed dust cover with ribs, trunnion, rivets, selector lever
    add(box(0.046, 0.05, 0.36, body, 0, 0.032, -0.12));
    add(box(0.044, 0.026, 0.3, body, 0, 0.068, -0.08));
    for (let i = 0; i < 4; i++) add(box(0.047, 0.004, 0.006, dark, 0, 0.068, 0.04 + i * 0.012));
    add(box(0.049, 0.058, 0.045, body, 0, 0.04, -0.31));
    for (const [y, z] of [[0.02, -0.3], [0.05, -0.3], [0.02, -0.16], [0.01, 0.02], [0.04, 0.02]]) add(cyl(0.0032, 0.05, M.steel(), 0, y, z, 'x', 8));
    add(box(0.003, 0.014, 0.1, M.steel(), 0.025, 0.05, -0.04), 0.06);
    add(box(0.012, 0.018, 0.012, M.steel(), 0.028, 0.068, -0.03)); // charging handle
    // wooden handguards around the gas tube, gas block, barrel, front sight, slant brake
    add(box(0.054, 0.042, 0.2, furniture, 0, 0.036, -0.43));
    for (let i = 0; i < 3; i++) add(box(0.056, 0.004, 0.16, M.color(0x3a2212, 0, 0.8), 0, 0.02 + i * 0.012, -0.43));
    add(box(0.044, 0.026, 0.19, furniture, 0, 0.078, -0.44));
    add(cyl(0.0095, 0.08, dark, 0, 0.078, -0.57));
    add(box(0.028, 0.036, 0.03, dark, 0, 0.066, -0.62));
    add(cyl(0.0085, 0.34, dark, 0, 0.055, -0.66));
    add(box(0.022, 0.022, 0.03, dark, 0, 0.07, -0.72));
    add(box(0.004, 0.028, 0.008, dark, 0.009, 0.092, -0.72));
    add(box(0.004, 0.028, 0.008, dark, -0.009, 0.092, -0.72));
    add(box(0.003, 0.02, 0.004, dark, 0, 0.09, -0.72));
    add(cyl(0.013, 0.045, dark, 0, 0.055, -0.8));
    add(box(0.028, 0.012, 0.02, M.polymer(), 0, 0.066, -0.815), 0.5);
    // rear sight block and leaf
    add(box(0.03, 0.018, 0.04, dark, 0, 0.09, -0.3));
    add(box(0.024, 0.004, 0.06, dark, 0, 0.1, -0.27), -0.05);
    add(box(0.005, 0.008, 0.004, dark, 0, 0.106, -0.245));
    // trigger guard + trigger
    add(box(0.007, 0.004, 0.07, M.steel(), 0, -0.017, -0.03));
    add(box(0.007, 0.03, 0.005, M.steel(), 0, -0.004, -0.064));
    add(box(0.005, 0.02, 0.005, M.steel(), 0, -0.002, -0.04), 0.3);
    // wooden pistol grip
    add(box(0.03, 0.11, 0.042, furniture, 0, -0.04, 0.03), 0.3);
    // curved "banana" magazine: one extruded side profile (x of the shape = -z of the gun)
    const mm = M.color(0x6a3c1e, 0.2, 0.5);
    const prof = new THREE.Shape();
    prof.moveTo(0.026, 0);
    prof.lineTo(-0.026, 0);
    prof.quadraticCurveTo(-0.012, -0.1, 0.035, -0.185);
    prof.lineTo(0.088, -0.17);
    prof.quadraticCurveTo(0.03, -0.09, 0.026, 0);
    const mgeo = new THREE.ExtrudeGeometry(prof, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 10 });
    mgeo.rotateY(Math.PI / 2);
    mgeo.translate(-0.013, 0, 0);
    mag.add(new THREE.Mesh(projectUV(mgeo), mm));
    for (let i = 0; i < 3; i++) {
      const rib = box(0.03, 0.005, 0.04, mm, 0, -0.045 - i * 0.045, -0.006 - i * i * 0.006 - i * 0.008);
      rib.rotation.x = 0.15 + i * 0.14;
      mag.add(rib);
    }
    mag.position.set(0, 0.01, -0.115);
    // wooden stock with steel butt plate
    const st = box(0.042, 0.062, 0.24, furniture, 0, 0.012, 0.2);
    st.rotation.x = 0.1;
    stock.add(st);
    const heel = box(0.044, 0.1, 0.06, furniture, 0, -0.012, 0.3);
    heel.rotation.x = 0.1;
    stock.add(heel);
    const plate = box(0.046, 0.104, 0.008, M.steel(), 0, -0.014, 0.332);
    plate.rotation.x = 0.1;
    stock.add(plate);
    g.add(stock);
    g.add(mag);
    return finish(g, { muzzle: [0, 0.055, -0.83], eject: [0.03, 0.06, -0.08], sightY: 0.1, fore: [0, 0.02, -0.42], grip: [0, -0.02, 0.03], kind: 'rifle' });
  }
  // AR platform: upper/lower receivers, rails, M-LOK handguard, forward assist, buffer tube stock
  add(box(0.044, 0.05, 0.2, body, 0, 0.02, -0.07));
  add(box(0.05, 0.052, 0.085, body, 0, -0.002, -0.12));
  add(box(0.046, 0.04, 0.22, body, 0, 0.064, -0.08));
  add(box(0.03, 0.012, 0.36, dark, 0, 0.09, -0.16));
  for (let i = 0; i < 12; i++) add(box(0.034, 0.006, 0.01, dark, 0, 0.097, -0.01 - i * 0.026));
  add(cyl(0.009, 0.03, body, 0.029, 0.066, 0.0));
  add(box(0.04, 0.008, 0.024, M.polymer(), 0, 0.078, 0.04));
  add(box(0.002, 0.02, 0.055, dark, 0.024, 0.062, -0.05));
  add(box(0.004, 0.012, 0.024, M.steel(), 0.024, 0.042, -0.1));
  // handguard with slots
  add(box(0.054, 0.054, 0.3, furniture, 0, 0.058, -0.36));
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) add(box(0.002, 0.012, 0.03, M.rubber(), sx * 0.0275, 0.052, -0.26 - i * 0.045));
  for (let i = 0; i < 5; i++) add(box(0.02, 0.002, 0.03, M.rubber(), 0, 0.0305, -0.26 - i * 0.045));
  add(cyl(0.0085, 0.18, dark, 0, 0.058, -0.6));
  add(box(0.024, 0.03, 0.025, dark, 0, 0.066, -0.53));
  // flash hider with prongs
  add(cyl(0.012, 0.03, dark, 0, 0.058, -0.705));
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    add(box(0.006, 0.006, 0.03, dark, Math.cos(a) * 0.009, 0.058 + Math.sin(a) * 0.009, -0.735));
  }
  // trigger guard, trigger, grip
  add(box(0.007, 0.004, 0.065, M.polymer(), 0, -0.012, -0.03));
  add(box(0.005, 0.02, 0.005, M.steel(), 0, 0.002, -0.04), 0.3);
  add(box(0.03, 0.105, 0.044, M.polymer(), 0, -0.036, 0.03), 0.3);
  for (let i = 0; i < 3; i++) add(box(0.031, 0.01, 0.006, M.rubber(), 0, -0.02 - i * 0.022, 0.01 - i * 0.007), 0.3);
  // slightly curved magazine with base plate
  const m1 = box(0.025, 0.09, 0.056, M.gunmetal(), 0, -0.035, 0.0);
  const m2 = box(0.025, 0.08, 0.056, M.gunmetal(), 0, -0.112, 0.012);
  m2.rotation.x = -0.18;
  const base = box(0.03, 0.01, 0.062, M.polymer(), 0, -0.152, 0.02);
  base.rotation.x = -0.18;
  mag.add(m1, m2, base);
  for (let i = 0; i < 3; i++) mag.add(box(0.026, 0.004, 0.044, M.gunmetal(), 0, -0.02 - i * 0.03, -0.001));
  mag.position.set(0, 0.0, -0.12);
  // buffer tube and adjustable stock
  stock.add(cyl(0.013, 0.2, dark, 0, 0.058, 0.13));
  for (let i = 0; i < 5; i++) stock.add(box(0.004, 0.006, 0.006, M.steel(), 0, 0.044, 0.08 + i * 0.022));
  stock.add(box(0.044, 0.07, 0.13, M.polymer(), 0, 0.045, 0.23));
  stock.add(box(0.036, 0.022, 0.1, M.polymer(), 0, 0.085, 0.22));
  stock.add(box(0.046, 0.09, 0.014, M.rubber(), 0, 0.04, 0.298));
  g.add(stock);
  g.add(mag);
  // red-dot optic on the rail
  const optic = new THREE.Group();
  optic.add(box(0.034, 0.008, 0.07, M.polymer(), 0, 0.089, -0.06));
  optic.add(box(0.005, 0.03, 0.07, M.polymer(), 0.0145, 0.106, -0.06));
  optic.add(box(0.005, 0.03, 0.07, M.polymer(), -0.0145, 0.106, -0.06));
  optic.add(box(0.034, 0.005, 0.07, M.polymer(), 0, 0.1225, -0.06));
  optic.add(cyl(0.006, 0.012, M.polymer(), 0.02, 0.108, -0.05, 'x', 10));
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.024, 0.026), mat('lens-glass', { color: 0x88ccaa, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false }));
  lens.position.set(0, 0.106, -0.094);
  optic.add(lens);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 8, 6), M.red());
  dot.position.set(0, 0.108, -0.093);
  dot.name = 'reddot';
  optic.add(dot);
  g.add(optic);
  return finish(g, { muzzle: [0, 0.058, -0.75], eject: [0.03, 0.06, -0.08], sightY: 0.108, fore: [0, 0.02, -0.42], grip: [0, -0.02, 0.03], kind: 'rifle' });
}

function buildShotgun(o) {
  const g = new THREE.Group();
  g.add(box(0.05, 0.07, 0.28, M.gunmetal(), 0, 0.04, -0.06));
  g.add(cyl(0.013, 0.55, M.gunmetal(), 0, 0.062, -0.46));
  g.add(cyl(0.012, 0.45, M.gunmetal(), 0, 0.03, -0.4));
  const pump = cyl(0.022, 0.16, M.wood(), 0, 0.03, -0.4);
  pump.name = 'pump';
  g.add(pump);
  const grip = box(0.03, 0.1, 0.045, M.wood(), 0, -0.03, 0.06);
  grip.rotation.x = 0.35;
  g.add(grip);
  const st = box(0.045, 0.08, 0.28, M.wood(), 0, 0.02, 0.24);
  st.rotation.x = 0.12;
  st.name = 'stock';
  g.add(st);
  g.add(box(0.008, 0.012, 0.01, M.steel(), 0, 0.078, -0.71));
  return finish(g, { muzzle: [0, 0.062, -0.74], eject: [0.03, 0.05, -0.05], sightY: 0.085, fore: [0, 0.01, -0.4], grip: [0, -0.02, 0.05], kind: 'shotgun', pump: true });
}

function buildSniper(o) {
  const g = new THREE.Group();
  const heavy = o.heavy;
  const body = M.color(o.body, 0.2, 0.55);
  g.add(box(0.05, 0.065, 0.36, M.gunmetal(), 0, 0.045, -0.08));
  g.add(cyl(heavy ? 0.014 : 0.011, heavy ? 0.6 : 0.5, M.gunmetal(), 0, 0.055, heavy ? -0.56 : -0.5));
  if (heavy) g.add(cyl(0.022, 0.07, M.gunmetal(), 0, 0.055, -0.88));
  // chassis / stock
  g.add(box(0.058, 0.07, 0.4, body, 0, 0.025, -0.3));
  const stock = new THREE.Group();
  stock.name = 'stock';
  stock.add(box(0.05, 0.1, 0.32, body, 0, 0.02, 0.24));
  stock.add(box(0.05, 0.03, 0.2, body, 0, 0.08, 0.26));
  g.add(stock);
  const grip = box(0.03, 0.1, 0.045, body, 0, -0.035, 0.04);
  grip.rotation.x = 0.3;
  g.add(grip);
  // scope
  g.add(cyl(0.02, 0.3, M.polymer(), 0, 0.125, -0.1));
  g.add(cyl(0.028, 0.06, M.polymer(), 0, 0.125, -0.27, 'z', 16, 0.02));
  g.add(cyl(0.024, 0.05, M.polymer(), 0, 0.125, 0.06));
  g.add(cyl(0.024, 0.005, M.glass(), 0, 0.125, -0.3));
  g.add(box(0.012, 0.04, 0.02, M.gunmetal(), 0, 0.095, -0.18));
  g.add(box(0.012, 0.04, 0.02, M.gunmetal(), 0, 0.095, -0.0));
  // bolt
  const bolt = cyl(0.006, 0.05, M.steel(), 0.035, 0.06, 0.02, 'x');
  bolt.name = 'bolt';
  g.add(bolt);
  const mag = box(0.03, 0.05, 0.08, M.gunmetal(), 0, -0.01, -0.12);
  mag.name = 'mag';
  g.add(mag);
  return finish(g, { muzzle: [0, 0.055, heavy ? -0.92 : -0.76], eject: [0.03, 0.06, -0.02], sightY: 0.125, fore: [0, 0.0, -0.36], grip: [0, -0.02, 0.04], kind: 'sniper' });
}

function buildKnife() {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.2, 0.004);
  shape.quadraticCurveTo(0.23, 0.012, 0.235, 0.028);
  shape.lineTo(0.12, 0.034);
  shape.lineTo(0, 0.03);
  shape.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1 });
  const blade = new THREE.Mesh(geo, M.blade());
  blade.rotation.y = Math.PI / 2;
  blade.position.set(-0.002, 0.0, -0.05);
  g.add(blade);
  g.add(box(0.012, 0.05, 0.012, M.gunmetal(), 0, 0.015, -0.045));
  const handle = cyl(0.014, 0.11, M.rubber(), 0, 0.015, 0.01);
  g.add(handle);
  g.add(cyl(0.016, 0.012, M.gunmetal(), 0, 0.015, 0.07));
  return finish(g, { muzzle: [0, 0.02, -0.28], sightY: 0.02, grip: [0, 0.015, 0.01], kind: 'knife' });
}

function buildBreach(o) {
  const g = new THREE.Group();
  const body = M.color(o.body, 0.2, 0.75);
  g.add(box(0.15, 0.1, 0.035, body, 0, 0, 0));
  g.add(box(0.13, 0.08, 0.012, M.color(0x8a7a52, 0, 0.9), 0, 0, 0.022)); // explosive block
  g.add(box(0.16, 0.02, 0.04, M.rubber(), 0, 0.03, 0)); // strap
  g.add(box(0.16, 0.02, 0.04, M.rubber(), 0, -0.03, 0));
  g.add(box(0.035, 0.03, 0.02, M.polymer(), 0.045, 0.0, 0.032)); // detonator
  const led = box(0.008, 0.008, 0.006, M.red(), 0.045, 0.012, 0.044);
  g.add(led);
  g.add(cyl(0.003, 0.08, M.color(0xb03020, 0, 0.6), -0.02, 0.0, 0.03, 'x', 5));
  return finish(g, { muzzle: [0, 0, 0], sightY: 0, grip: [0, 0, 0], kind: 'grenade' });
}

function buildGrenade(o, id) {
  if (id === 'breach') return buildBreach(o);
  const g = new THREE.Group();
  const body = M.color(o.body, 0.3, 0.6);
  if (id === 'frag') {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 10), body);
    s.scale.set(1, 1.2, 1);
    g.add(s);
  } else {
    g.add(cyl(0.028, 0.1, body, 0, 0, 0, 'y'));
    g.add(cyl(0.029, 0.015, M.color(id === 'smoke' ? 0x99aa55 : 0x333333), 0, 0.02, 0, 'y'));
  }
  g.add(cyl(0.012, 0.02, M.steel(), 0, 0.05, 0, 'y'));
  const spoon = box(0.01, 0.07, 0.004, M.steel(), 0.018, 0.02, 0);
  spoon.rotation.z = -0.15;
  g.add(spoon);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0022, 6, 14), M.steel());
  ring.position.set(-0.018, 0.058, 0);
  ring.name = 'pin';
  g.add(ring);
  return finish(g, { muzzle: [0, 0, 0], sightY: 0, grip: [0, 0, 0], kind: 'grenade' });
}

function buildBomb() {
  const g = new THREE.Group();
  g.add(box(0.2, 0.08, 0.13, M.color(0x5a5245, 0.2, 0.7), 0, 0, 0));
  g.add(box(0.12, 0.012, 0.08, M.polymer(), 0.02, 0.046, 0));
  const screen = box(0.06, 0.004, 0.03, mat('bombscreen', { color: 0x102010, emissive: 0x30ff60, emissiveIntensity: 1.2 }), 0.03, 0.054, -0.015);
  g.add(screen);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) g.add(box(0.012, 0.006, 0.012, M.color(0x999999, 0.2, 0.5), 0.0 + i * 0.018, 0.054, 0.012 + j * 0.014));
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), mat('bombled', { color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 4 }));
  led.position.set(-0.07, 0.05, -0.04);
  led.name = 'led';
  g.add(led);
  g.add(cyl(0.02, 0.2, M.color(0x7a2a20, 0.1, 0.6), 0, 0.0, 0.08, 'x'));
  g.add(cyl(0.02, 0.2, M.color(0x7a2a20, 0.1, 0.6), 0, 0.0, -0.08, 'x'));
  return finish(g, { muzzle: [0, 0, 0], sightY: 0, grip: [0, 0, 0], kind: 'bomb' });
}

const weaponCache = new Map();

export function createWeaponModel(id) {
  const w = WEAPONS[id];
  if (!w) return buildKnife();
  const o = w.model || {};
  switch (o.kind) {
    case 'pistol': return buildPistol(o);
    case 'smg': return buildSMG(o);
    case 'rifle': return buildRifle(o);
    case 'shotgun': return buildShotgun(o);
    case 'sniper': return buildSniper(o);
    case 'grenade': return buildGrenade(o, id);
    case 'bomb': return buildBomb();
    default: return buildKnife();
  }
}

// Shared template per weapon for cheap cloning (third-person / world drops)
export function weaponTemplate(id) {
  if (!weaponCache.has(id)) weaponCache.set(id, createWeaponModel(id));
  const t = weaponCache.get(id);
  const c = t.clone(true);
  c.userData = { ...t.userData };
  return c;
}

// ------------------------------------------------------------------ player characters

// Third-person / world weapon: the full weapon model flattened into one baked mesh (one draw call) that
// keeps each part's colour, roughness, metalness and surface detail type.
const SURF_OF = { metal: SURF.metal, polymer: SURF.polymer, wood: SURF.wood, rubber: SURF.rubber, fabric: SURF.fabric };
const bakedWeaponCache = new Map();
export function bakedWeapon(id) {
  if (!bakedWeaponCache.has(id)) {
    const src = createWeaponModel(id);
    src.updateMatrixWorld(true);
    const b = new Builder();
    src.traverse((m) => {
      if (!m.isMesh || !m.visible) return;
      const mt = m.material;
      const glow = mt.emissive && mt.emissiveIntensity > 0 && mt.emissive.getHex() !== 0;
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      if (!geo.attributes.normal) geo.computeVertexNormals();
      b.add(geo, {
        matrix: m.matrixWorld,
        color: glow && mt.color.getHex() === mt.emissive.getHex() ? mt.emissive.getHex() : mt.color.getHex(),
        rough: mt.roughness ?? 0.5, metal: mt.metalness ?? 0,
        emit: glow ? Math.min(3, mt.emissiveIntensity * (mt.emissive.r + mt.emissive.g + mt.emissive.b) / 3 * 2) : 0,
        tex: SURF_OF[mt.userData.surf] ?? SURF.none,
      });
    });
    bakedWeaponCache.set(id, { geo: b.build(false), info: { ...src.userData } });
  }
  const c = bakedWeaponCache.get(id);
  const mesh = new THREE.Mesh(c.geo, bakedMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { ...c.info };
  return mesh;
}

// Per weapon kind: where the firing hand holds the grip (model space, relative to the aim pivot at
// shoulder height) and how far the shoulders turn (bladed stance) so the support hand reaches forward.
const STANCE = {
  rifle: { grip: [0.1, -0.13, -0.3], twist: -0.35 },
  smg: { grip: [0.1, -0.12, -0.3], twist: -0.3 },
  shotgun: { grip: [0.1, -0.13, -0.3], twist: -0.35 },
  sniper: { grip: [0.1, -0.12, -0.28], twist: -0.38 },
  pistol: { grip: [0.04, -0.07, -0.44], twist: -0.1 },
  knife: { grip: [0.19, -0.26, -0.3], twist: 0, relaxed: true },
  grenade: { grip: [0.19, -0.1, -0.26], twist: 0, relaxed: true },
  bomb: { grip: [0.05, -0.24, -0.34], twist: 0 },
};
const DOWN = new THREE.Vector3(0, -1, 0);
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const POLE = { r: new THREE.Vector3(0.9, -1, 0.35).normalize(), l: new THREE.Vector3(-0.9, -1, 0.2).normalize() };
const RELAXED_L = new THREE.Vector3(-0.2, -0.46, -0.1);
const _ik = { d: new THREE.Vector3(), dir: new THREE.Vector3(), perp: new THREE.Vector3(), u: new THREE.Vector3(), e: new THREE.Vector3(), f: new THREE.Vector3(), q: new THREE.Quaternion(), t: new THREE.Vector3(), v: new THREE.Vector3() };

// Analytic two-bone IK in the aim bone's space: shoulder S -> target T, elbow bent towards pole.
function solveArm(arm, T, pole) {
  const S = arm.grp.position;
  const a = UPPER_ARM, b = FORE_ARM;
  const d = _ik.d.subVectors(T, S);
  let dist = d.length();
  const maxR = (a + b) * 0.995;
  if (dist > maxR) { d.multiplyScalar(maxR / dist); dist = maxR; }
  if (dist < 0.08) { d.set(0, -0.08, 0); dist = 0.08; }
  const dir = _ik.dir.copy(d).divideScalar(dist);
  const cosA = Math.max(-1, Math.min(1, (a * a + dist * dist - b * b) / (2 * a * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const perp = _ik.perp.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0);
  perp.normalize();
  const u = _ik.u.copy(dir).multiplyScalar(cosA).addScaledVector(perp, sinA);
  const e = _ik.e.copy(S).addScaledVector(u, a);
  const f = _ik.f.copy(S).add(d).sub(e).normalize();
  arm.grp.quaternion.setFromUnitVectors(DOWN, u);
  f.applyQuaternion(_ik.q.copy(arm.grp.quaternion).invert());
  arm.elbow.quaternion.setFromUnitVectors(DOWN, f);
}

export class PlayerModel {
  constructor(look, name = '', showName = false) {
    const L = look;
    const rig = makeRig();
    const { body, hips, legs, spine, chest, neck, head, aim, arms } = rig;
    const mesh = new THREE.SkinnedMesh(operatorGeometry(L), bakedMaterial());
    mesh.add(body);
    mesh.bind(new THREE.Skeleton(rig.bones));
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const weaponMount = new THREE.Group();
    weaponMount.position.fromArray(STANCE.rifle.grip);
    aim.add(weaponMount);
    const bomb = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.12, 0.16, 1, 0.02), M.color(0x5a5245, 0.2, 0.7));
    bomb.position.set(0, -0.04, 0.3);
    bomb.visible = false;
    bomb.castShadow = true;
    chest.add(bomb);

    const root = new THREE.Group();
    root.add(mesh);
    this.root = root;
    this.mesh = mesh;
    this.body = body;
    this.hips = hips;
    this.legs = legs;
    this.spine = spine;
    this.chest = chest;
    this.head = head;
    this.neck = neck;
    this.aim = aim;
    this.arms = arms;
    this.weaponMount = weaponMount;
    this.bombMesh = bomb;
    this.weaponId = null;
    this.weapon = null;
    this.walkPhase = 0;
    this.deathT = -1;
    this.deathX = 0;
    this.deathZ = 1;
    this.deathSpin = 0;
    this.recoil = 0;
    this.reloadT = 0;
    this.reloadK = 0;
    this.breath = Math.random() * 6;

    if (name) {
      this.tag = makeNameTag(name, L.accent);
      this.tag.position.y = 2.1;
      this.tag.visible = showName;
      root.add(this.tag);
    }
  }

  setWeapon(id) {
    if (this.weaponId === id) return;
    this.weaponId = id;
    if (this.weapon) this.weaponMount.remove(this.weapon);
    this.weapon = bakedWeapon(id || 'knife');
    const info = this.weapon.userData;
    const grip = info.grip || [0, 0, 0];
    this.weapon.position.set(-grip[0], -grip[1], -grip[2]);
    if (info.kind === 'knife') { this.weapon.rotation.set(0, 0, 0); this.weapon.position.set(0.02, 0.02, 0.18); }
    if (info.kind === 'grenade' || info.kind === 'bomb') this.weapon.position.set(0.0, 0.0, 0.2);
    if (this.layer != null) this.weapon.layers.set(this.layer);
    this.weaponMount.add(this.weapon);
  }

  // Render layer for the whole model, including weapons equipped later (own shadow-only body).
  setLayer(layer) {
    this.layer = layer;
    this.root.traverse((o) => o.layers.set(layer));
  }

  muzzleWorld(out = new THREE.Vector3()) {
    if (!this.weapon) return this.root.getWorldPosition(out);
    const m = this.weapon.userData.muzzle || [0, 0, -0.5];
    out.set(m[0], m[1], m[2]);
    return this.weapon.localToWorld(out);
  }

  // push: world-space direction the body is knocked towards (e.g. away from the killer), or a number
  // for a plain backwards (+1) / forwards (-1) fall.
  die(push = 1, pushZ) {
    if (this.deathT >= 0) return;
    this.deathT = 0;
    let lx = 0, lz = 1;
    if (typeof push === 'number' && pushZ === undefined) lz = push >= 0 ? 1 : -1;
    else {
      const yaw = this.root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
      lx = push * c - pushZ * s;
      lz = push * s + pushZ * c;
      const L = Math.hypot(lx, lz) || 1;
      lx /= L; lz /= L;
    }
    this.deathX = lx;
    this.deathZ = lz;
    this.deathSpin = (Math.random() - 0.5) * 0.8;
  }

  revive() {
    this.deathT = -1;
    this.chest.rotation.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.hips.position.set(0, 0.92, 0);
  }

  // s: { x,y,z,yaw,pitch,crouch,lean, speed, vx, vz, alive, onGround, planting, defusing, bomb, reloading }
  update(s, dt) {
    const root = this.root;
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = s.yaw;
    const arms = this.arms;
    if (this.deathT >= 0) {
      this.deathT = Math.min(1, this.deathT + dt / 0.6);
      const t = this.deathT;
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      const fall = t < 0.8 ? t / 0.8 : 1;
      const f = fall * fall * (3 - 2 * fall);
      const bounce = t > 0.8 ? Math.sin((t - 0.8) / 0.2 * Math.PI) * 0.04 : 0;
      this.body.rotation.set(f * (Math.PI / 2) * this.deathZ - bounce, this.deathSpin * e, -f * (Math.PI / 2) * this.deathX * 0.9);
      this.body.position.set(this.deathX * e * 0.35, Math.sin(Math.min(1, t * 1.6) * Math.PI) * 0.06, this.deathZ * e * 0.35);
      this.hips.position.y = 0.92 - f * 0.74;
      this.chest.rotation.set(-f * 0.2, 0, 0);
      this.aim.rotation.set(-f * 0.4, 0, 0);
      this.head.rotation.x = f * 0.5 * this.deathZ;
      this.legs[0].thigh.rotation.x = f * 0.45;
      this.legs[1].thigh.rotation.x = -f * 0.25;
      this.legs[0].knee.rotation.x = -f * 0.6;
      this.legs[1].knee.rotation.x = -f * 0.2;
      void arms;
      return;
    }
    const c = s.crouch || 0;
    const speed = s.speed || 0;
    const moving = speed > 0.3 && s.onGround;
    // split velocity into forward / sideways in the model's frame so strafing and backpedalling read correctly
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const vx = s.vx ?? -sy * speed, vz = s.vz ?? -cy * speed;
    const fwd = -(vx * sy + vz * cy), side = vx * cy - vz * sy;
    const fk = speed > 0.01 ? fwd / Math.max(speed, 0.01) : 1;
    const sk = speed > 0.01 ? side / Math.max(speed, 0.01) : 0;
    const amp = Math.min(1, speed / 5) * (1 - c * 0.4);
    if (moving) this.walkPhase += dt * (4 + speed * 1.6) * (1 - c * 0.3) * (fk < -0.3 ? -1 : 1);
    else this.walkPhase *= 0.9;
    const ph = this.walkPhase;
    this.breath += dt;
    const hipsY = 0.92 - c * 0.4 - (moving ? Math.abs(Math.sin(ph)) * 0.03 * amp : 0);
    this.hips.position.y = hipsY;
    this.hips.rotation.y = moving ? sk * 0.35 * Math.sign(fk || 1) : 0;
    const air = !s.onGround ? 0.5 : 0;
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? 1 : -1;
      const phase = ph + (i ? Math.PI : 0);
      const swing = moving ? Math.sin(phase) * 0.6 * amp : 0;
      const bend = moving ? Math.max(0, Math.sin(phase + Math.PI / 2)) * 0.9 * amp : 0;
      this.legs[i].thigh.rotation.x = swing * Math.max(Math.abs(fk), 0.35) + c * 1.25 + air * (i ? 0.2 : 0.7);
      this.legs[i].knee.rotation.x = -bend - c * 2.0 - air * 0.9;
      this.legs[i].thigh.rotation.z = sgn * 0.03 + (moving ? Math.sin(phase) * 0.25 * amp * sk * sgn : 0);
    }
    this.spine.rotation.x = c * 0.25 + (moving ? 0.05 * Math.sign(fk || 1) : 0) + Math.sin(this.breath * 1.7) * 0.012;
    this.spine.rotation.z = -(s.lean || 0) * 0.5;
    this.spine.rotation.y = (moving ? Math.sin(ph) * 0.06 * amp : 0) - this.hips.rotation.y;
    const pitch = s.pitch || 0;
    this.recoil *= Math.exp(-dt * 14);
    const info = this.weapon?.userData || {};
    const st = STANCE[info.kind] || STANCE.rifle;
    const tw = st.twist;
    let aimX = pitch - c * 0.25 + this.recoil;
    this.head.rotation.x = pitch * 0.6 - c * 0.2;
    if (s.planting || s.defusing) {
      aimX = -0.9;
      this.head.rotation.x = -0.6;
    } else if (s.reinforcing) {
      aimX = -0.35 + Math.sin(this.breath * 9) * 0.06;
      this.head.rotation.x = -0.2;
    }
    // the upper chest takes part of the pitch and most of the bladed-stance twist, the shoulders the rest
    const chestX = Math.max(-0.3, Math.min(0.25, aimX * 0.3));
    this.chest.rotation.set(chestX, tw * 0.7, 0);
    this.aim.rotation.set(aimX - chestX, tw * 0.3, 0);
    // reload: weapon rolls towards the body, support hand goes to the magazine and back
    const wantReload = s.reloading ? 1 : 0;
    this.reloadK += (wantReload - this.reloadK) * Math.min(1, dt * 10);
    if (s.reloading) this.reloadT += dt; else this.reloadT = 0;
    const rk = this.reloadK;
    const cyc = Math.sin(this.reloadT * 5.5);
    // the aim bone is turned by `tw`; counter-rotate the weapon so it still points straight ahead
    const wm = this.weaponMount;
    wm.position.fromArray(st.grip).applyAxisAngle(UP_AXIS, -tw);
    wm.rotation.set(rk * 0.15, -tw, rk * 0.55);
    wm.updateMatrix();
    solveArm(arms.r, wm.position, POLE.r);
    // support hand: slide from the fore-grip back towards the firing hand until it is within reach
    const T = _ik.t;
    if (st.relaxed) T.copy(RELAXED_L);
    else {
      const grip = info.grip || [0, 0, 0];
      const fore = info.fore || grip;
      const off = _ik.v.set(fore[0] - grip[0], fore[1] - grip[1], fore[2] - grip[2]).applyQuaternion(wm.quaternion);
      const S = arms.l.grp.position;
      const reach = (UPPER_ARM + FORE_ARM) * 0.97;
      let k = 1;
      for (let i = 0; i < 8; i++) {
        T.copy(wm.position).addScaledVector(off, k);
        if (T.distanceTo(S) <= reach) break;
        k -= 0.125;
      }
      if (rk > 0.01) {
        // magazine sits just below the receiver in front of the grip
        _ik.v.set(0, -0.12 - cyc * 0.05 * rk, -0.1).applyQuaternion(wm.quaternion).add(wm.position);
        T.lerp(_ik.v, rk);
      }
    }
    solveArm(arms.l, T, POLE.l);
    this.bombMesh.visible = !!s.bomb;
  }

  kick(amount = 0.08) { this.recoil = Math.min(0.3, this.recoil + amount); }
}

function makeNameTag(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Segoe UI, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(name, 128, 32);
  g.fillStyle = '#' + new THREE.Color(color).getHexString();
  g.fillText(name, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, fog: false }));
  s.scale.set(0.9, 0.225, 1);
  s.renderOrder = 10;
  return s;
}

export const HEIGHT = PLAYER.height;
