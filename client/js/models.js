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
  wood: () => detailed('wood', { color: 0x6b4a2c, metalness: 0, roughness: 0.5 }, 'wood'),
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

// Side-profile extrusion: pts are [z, y] points (or [cz, cy, z, y] quadratic curves) in the gun's side
// view, extruded across X with rounded edges. holes: same format, cut through (trigger guards, thumbholes).
function ext(pts, width, material, o = {}) {
  const path = (P, list) => {
    list.forEach((q, i) => {
      if (i === 0) P.moveTo(q[0], q[1]);
      else if (q.length === 4) P.quadraticCurveTo(q[0], q[1], q[2], q[3]);
      else P.lineTo(q[0], q[1]);
    });
  };
  const sh = new THREE.Shape();
  path(sh, pts);
  for (const h of o.holes || []) { const hp = new THREE.Path(); path(hp, h); sh.holes.push(hp); }
  const bev = o.bevel ?? Math.min(0.0025, width * 0.2);
  const depth = Math.max(0.0005, width - bev * 2);
  const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev * 0.7, bevelSegments: 2, curveSegments: 8 });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2);
  const m = new THREE.Mesh(projectUV(geo), material);
  m.position.set(o.x || 0, o.y || 0, o.z || 0);
  if (o.rx) m.rotation.x = o.rx;
  return m;
}

function buildPistol(o) {
  const g = new THREE.Group();
  const L = o.len;
  const big = !!o.big;
  const W = big ? 0.035 : 0.029;
  const body = M.color(o.body, big ? 0.85 : 0.6, big ? 0.3 : 0.35);
  const frameMat = big ? M.color(o.accent, 0.5, 0.45) : M.polymer();
  const dark = M.gunmetal();
  const top = big ? 0.075 : 0.068;
  // slide: chamfered front, rear and front serrations, ejection port, sights, bore
  const slide = new THREE.Group();
  slide.name = 'slide';
  slide.add(ext([[0.038, 0.036], [0.038, top - 0.004], [0.031, top], [-L + 0.046, top], [-L + 0.03, top - 0.008], [-L + 0.03, 0.036]], W, body, { bevel: 0.0022 }));
  for (let i = 0; i < 7; i++) slide.add(box(W + 0.0012, 0.02, 0.0022, dark, 0, 0.052, 0.03 - i * 0.0055));
  for (let i = 0; i < 4; i++) slide.add(box(W + 0.0012, 0.017, 0.0022, dark, 0, 0.05, -L + 0.075 + i * 0.0055));
  slide.add(box(0.0014, 0.012, 0.034, dark, W / 2 + 0.0002, top - 0.009, -0.03));
  slide.add(box(W * 0.45, 0.004, 0.03, M.steel(), 0, top - 0.001, -0.03));
  slide.add(box(W * 0.75, 0.007, 0.012, dark, 0, top + 0.003, 0.024));
  for (const sx of [-1, 1]) {
    slide.add(box(0.0055, 0.006, 0.012, dark, sx * 0.0055, top + 0.009, 0.024));
    slide.add(box(0.0022, 0.0022, 0.001, M.color(0xe8e8e0, 0, 0.4), sx * 0.0055, top + 0.009, 0.0178));
  }
  slide.add(box(0.0042, 0.008, 0.009, dark, 0, top + 0.004, -L + 0.052));
  slide.add(box(0.0022, 0.0022, 0.001, M.color(0xe8e8e0, 0, 0.4), 0, top + 0.006, -L + 0.0473));
  slide.add(cyl(0.0078, 0.012, M.steel(), 0, 0.052, -L + 0.034));
  slide.add(cyl(0.0048, 0.004, M.color(0x050505, 0.2, 0.9), 0, 0.052, -L + 0.0275));
  if (big) slide.add(box(0.012, 0.016, 0.012, dark, 0, top - 0.006, 0.046));
  g.add(slide);
  // frame: dust cover with rail, trigger guard, grip with a steep back strap and beavertail
  const fz = -L + 0.05;
  const frame = [
    [0.036, 0.036], [fz, 0.036], [fz, 0.016], [-0.07, 0.014],
    [-0.074, -0.018, -0.052, -0.026], [-0.02, -0.026], [-0.008, -0.024, -0.004, -0.012],
    [0.0, -0.04], [0.004, -0.052, 0.01, -0.062], [0.008, -0.072, 0.014, -0.08], [0.018, -0.104],
    [0.062, -0.106], [0.059, -0.06], [0.05, -0.012, 0.064, 0.02], [0.068, 0.03], [0.05, 0.036],
  ];
  const guard = [[-0.06, 0.008], [-0.062, -0.016, -0.048, -0.019], [-0.02, -0.019], [-0.011, -0.017, -0.011, -0.004], [-0.012, 0.008]];
  g.add(ext(frame, W * 0.96, frameMat, { holes: [guard], bevel: 0.0022 }));
  for (let i = 0; i < 3; i++) g.add(box(W * 0.98, 0.003, 0.004, dark, 0, 0.0135, fz + 0.012 + i * 0.012));
  // stippled grip panels, trigger, slide stop, takedown lever, magazine base plate
  for (const sx of [-1, 1]) {
    const panel = box(0.0014, 0.052, 0.034, M.rubber(), sx * (W * 0.48 + 0.0008), -0.058, 0.034);
    panel.rotation.x = 0.22;
    g.add(panel);
  }
  g.add(ext([[-0.03, 0.008], [-0.036, -0.004, -0.029, -0.014], [-0.025, -0.013], [-0.029, -0.004, -0.025, 0.008]], 0.005, M.steel(), { bevel: 0.001 }));
  g.add(box(0.0022, 0.005, 0.024, dark, -W / 2 - 0.0008, 0.03, -0.028));
  g.add(box(0.0022, 0.005, 0.008, dark, -W / 2 - 0.0008, 0.024, -0.06));
  const mag = new THREE.Group();
  mag.name = 'mag';
  mag.add(ext([[0.016, -0.1], [0.016, -0.112], [0.066, -0.114], [0.064, -0.1]], W * 0.92, M.polymer(), { bevel: 0.0015 }));
  g.add(mag);
  return finish(g, { muzzle: [0, 0.052, -L + 0.022], eject: [0.02, 0.066, -0.04], sightY: top + 0.013, fore: [-0.012, -0.03, 0.02], grip: [0, -0.02, 0.02], kind: 'pistol' });
}

function buildSMG(o) {
  const g = new THREE.Group();
  const L = o.len;
  const body = M.color(o.body, 0.45, 0.45);
  const dark = M.gunmetal();
  const poly = M.polymer();
  const stock = new THREE.Group();
  stock.name = 'stock';
  const mag = new THREE.Group();
  mag.name = 'mag';
  if (o.stubby) {
    // compact PDW: boxy upper with a sloped nose, full-length rail, magazine in the grip, folding foregrip
    g.add(ext([[0.055, 0.036], [0.055, 0.078], [-0.14, 0.078], [-0.19, 0.058], [-0.19, 0.034]], 0.044, body, { bevel: 0.003 }));
    g.add(box(0.026, 0.01, 0.24, dark, 0, 0.083, -0.06));
    for (let i = 0; i < 10; i++) g.add(box(0.03, 0.005, 0.008, dark, 0, 0.089, 0.05 - i * 0.024));
    g.add(ext([[0.05, 0.036], [-0.12, 0.036], [-0.12, 0.02], [-0.065, 0.016], [-0.07, -0.016, -0.05, -0.022], [-0.02, -0.022], [-0.008, -0.02, -0.004, -0.01], [0.002, -0.05], [0.01, -0.105], [0.052, -0.105], [0.046, -0.05], [0.04, -0.01, 0.05, 0.03]], 0.04, poly, { holes: [[[-0.058, 0.008], [-0.06, -0.012, -0.046, -0.015], [-0.018, -0.015], [-0.011, -0.013, -0.011, -0.002], [-0.012, 0.008]]], bevel: 0.003 }));
    mag.add(ext([[0.008, -0.103], [0.008, -0.118], [0.056, -0.118], [0.054, -0.103]], 0.036, poly, { bevel: 0.002 }));
    g.add(ext([[-0.13, 0.02], [-0.16, 0.02], [-0.168, -0.07], [-0.14, -0.07]], 0.026, poly, { bevel: 0.004 }));
    g.add(cyl(0.0095, 0.07, dark, 0, 0.056, -0.22));
    g.add(cyl(0.0125, 0.03, dark, 0, 0.056, -0.265));
    for (let i = 0; i < 4; i++) g.add(box(0.004, 0.003, 0.022, M.color(0x050505, 0.2, 0.9), Math.cos(i * Math.PI / 2) * 0.012, 0.056 + Math.sin(i * Math.PI / 2) * 0.012, -0.268));
    g.add(ext([[-0.16, 0.093], [-0.16, 0.108], [-0.172, 0.108], [-0.176, 0.093]], 0.014, dark, { bevel: 0.001 }));
    g.add(ext([[0.03, 0.093], [0.03, 0.11], [0.012, 0.11], [0.01, 0.093]], 0.022, dark, { bevel: 0.001 }));
    for (const sx of [-1, 1]) stock.add(box(0.008, 0.008, 0.16, dark, sx * 0.014, 0.05, 0.12));
    stock.add(ext([[0.19, 0.075], [0.21, 0.075], [0.215, 0.0], [0.195, 0.0]], 0.046, M.rubber(), { bevel: 0.004 }));
    g.add(stock);
    g.add(mag);
    return finish(g, { muzzle: [0, 0.056, -0.285], eject: [0.025, 0.07, -0.05], sightY: 0.112, fore: [0, -0.035, -0.15], grip: [0, -0.02, 0.015], kind: 'smg' });
  }
  // classic roller-delayed SMG: pressed receiver, cocking tube, slim handguard, curved magazine, drum rear sight
  g.add(ext([[0.08, 0.032], [0.08, 0.076], [-0.18, 0.076], [-0.19, 0.068], [-0.19, 0.03]], 0.04, body, { bevel: 0.004 }));
  for (const sx of [-1, 1]) g.add(box(0.0012, 0.006, 0.2, dark, sx * 0.0202, 0.06, -0.06));
  g.add(cyl(0.011, 0.2, body, 0, 0.083, -0.26));
  g.add(box(0.006, 0.012, 0.018, dark, -0.014, 0.088, -0.33));
  g.add(ext([[-0.19, 0.068], [-0.35, 0.064], [-0.36, 0.05], [-0.36, 0.022], [-0.19, 0.02]], 0.046, M.color(o.accent, 0.1, 0.7), { bevel: 0.006 }));
  for (let i = 0; i < 6; i++) g.add(box(0.047, 0.03, 0.004, M.color(0x0b0b0b, 0.1, 0.9), 0, 0.044, -0.22 - i * 0.022));
  g.add(cyl(0.0095, 0.06, dark, 0, 0.052, -0.39));
  g.add(cyl(0.012, 0.022, dark, 0, 0.052, -0.425));
  // hooded front sight and drum rear sight
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0022, 6, 16, Math.PI), dark);
  hood.position.set(0, 0.098, -0.33);
  hood.rotation.y = Math.PI / 2;
  g.add(hood);
  g.add(box(0.0035, 0.012, 0.004, dark, 0, 0.094, -0.33));
  g.add(cyl(0.012, 0.018, dark, 0, 0.092, 0.05, 'x', 12));
  g.add(box(0.012, 0.012, 0.02, dark, 0, 0.08, 0.05));
  // trigger group with grip and guard
  g.add(ext([[0.06, 0.032], [-0.075, 0.032], [-0.075, 0.018], [-0.078, -0.016, -0.056, -0.022], [-0.02, -0.022], [-0.006, -0.02, 0.0, -0.01], [0.004, -0.04], [0.008, -0.052, 0.012, -0.06], [0.016, -0.1], [0.052, -0.1], [0.05, -0.05], [0.046, -0.01, 0.06, 0.032]], 0.036, poly, { holes: [[[-0.062, 0.008], [-0.064, -0.012, -0.05, -0.015], [-0.02, -0.015], [-0.01, -0.013, -0.01, -0.002], [-0.012, 0.008]]], bevel: 0.003 }));
  g.add(ext([[-0.034, 0.006], [-0.04, -0.004, -0.033, -0.012], [-0.029, -0.011], [-0.033, -0.003, -0.029, 0.006]], 0.005, M.steel(), { bevel: 0.001 }));
  // curved magazine in front of the trigger group
  mag.add(ext([[-0.1, 0.03], [-0.13, 0.03], [-0.132, -0.06, -0.104, -0.15], [-0.078, -0.144], [-0.1, -0.06, -0.1, 0.03]], 0.024, M.gunmetal(), { bevel: 0.0015 }));
  for (let i = 0; i < 3; i++) mag.add(box(0.0255, 0.003, 0.022, dark, 0, -0.02 - i * 0.035, -0.114 + i * 0.004));
  g.add(ext([[-0.095, 0.034], [-0.135, 0.034], [-0.135, 0.01], [-0.095, 0.01]], 0.03, body, { bevel: 0.002 }));
  // retractable stock
  for (const sx of [-1, 1]) stock.add(box(0.008, 0.01, 0.2, dark, sx * 0.016, 0.06, 0.18));
  stock.add(ext([[0.27, 0.085], [0.29, 0.085], [0.3, 0.06, 0.29, 0.0], [0.27, 0.0], [0.278, 0.04, 0.27, 0.085]], 0.044, M.rubber(), { bevel: 0.004 }));
  g.add(stock);
  g.add(mag);
  return finish(g, { muzzle: [0, 0.052, -0.44], eject: [0.025, 0.065, -0.1], sightY: 0.101, fore: [0, 0.01, -0.28], grip: [0, -0.02, 0.015], kind: 'smg' });
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
  const dark = M.gunmetal();
  const wood = M.wood();
  // receiver with ejection port, barrel with vent rib and bead, magazine tube and cap
  g.add(ext([[0.045, 0.012], [0.045, 0.072], [0.03, 0.08], [-0.18, 0.08], [-0.18, 0.012]], 0.048, dark, { bevel: 0.003 }));
  g.add(box(0.0014, 0.022, 0.07, M.color(0x050505, 0.2, 0.9), 0.0243, 0.058, -0.07));
  g.add(box(0.0014, 0.016, 0.1, M.color(0x050505, 0.2, 0.9), 0, 0.012, -0.08));
  g.add(cyl(0.0125, 0.57, dark, 0, 0.062, -0.465));
  g.add(box(0.008, 0.005, 0.55, dark, 0, 0.077, -0.46));
  for (let i = 0; i < 12; i++) g.add(box(0.006, 0.004, 0.005, dark, 0, 0.0725, -0.2 - i * 0.045));
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0025, 8, 6), M.color(0xd8d0b0, 0.8, 0.3));
  bead.position.set(0, 0.0815, -0.735);
  g.add(bead);
  g.add(cyl(0.0115, 0.48, dark, 0, 0.03, -0.42));
  g.add(cyl(0.0135, 0.03, dark, 0, 0.03, -0.675));
  g.add(cyl(0.006, 0.004, M.color(0x050505, 0.2, 0.9), 0, 0.062, -0.752));
  // wooden pump with grooves (animated)
  const pump = new THREE.Group();
  pump.name = 'pump';
  pump.add(ext([[0.08, 0.018], [0.085, 0.0, 0.08, -0.018], [-0.08, -0.018], [-0.085, 0.0, -0.08, 0.018]], 0.05, wood, { bevel: 0.006 }));
  for (let i = 0; i < 9; i++) pump.add(box(0.0515, 0.034, 0.003, M.color(0x2a1a0e, 0, 0.9), 0, 0, -0.06 + i * 0.015));
  pump.position.set(0, 0.03, -0.4);
  g.add(pump);
  // trigger guard, trigger, safety
  g.add(ext([[0.02, 0.014], [-0.06, 0.014], [-0.064, -0.016, -0.046, -0.022], [0.0, -0.022], [0.02, -0.02, 0.02, 0.014]], 0.012, M.polymer(), { holes: [[[-0.05, 0.008], [-0.052, -0.012, -0.04, -0.015], [0.006, -0.015], [0.012, -0.013, 0.012, 0.008]]], bevel: 0.0015 }));
  g.add(ext([[-0.024, 0.01], [-0.03, 0.0, -0.022, -0.008], [-0.019, -0.007], [-0.024, 0.0, -0.02, 0.01]], 0.005, M.steel(), { bevel: 0.001 }));
  g.add(cyl(0.0035, 0.052, M.color(0xa02020, 0.2, 0.5), 0, 0.02, 0.012, 'x', 8));
  // wooden stock with comb, wrist and recoil pad
  const stock = new THREE.Group();
  stock.name = 'stock';
  stock.add(ext([[0.045, 0.072], [0.1, 0.068], [0.36, 0.058], [0.365, -0.07], [0.2, -0.045], [0.1, -0.012, 0.045, 0.012]], 0.044, wood, { bevel: 0.007 }));
  stock.add(ext([[0.362, 0.06], [0.382, 0.06], [0.387, -0.07], [0.367, -0.072]], 0.046, M.rubber(), { bevel: 0.004 }));
  g.add(stock);
  return finish(g, { muzzle: [0, 0.062, -0.75], eject: [0.03, 0.058, -0.07], sightY: 0.085, fore: [0, 0.01, -0.4], grip: [0, -0.02, 0.05], kind: 'shotgun', pump: true });
}

function buildSniper(o) {
  const g = new THREE.Group();
  const heavy = !!o.heavy;
  const body = M.color(o.body, 0.15, 0.62);
  const dark = M.gunmetal();
  const poly = M.polymer();
  const front = heavy ? -0.44 : -0.4;
  // chassis: forend, receiver bed, pistol grip (thumbhole on the heavy rifle)
  const hole = heavy ? [[[0.075, 0.03], [0.14, 0.03], [0.15, 0.0, 0.13, -0.02], [0.09, -0.02], [0.07, 0.0, 0.075, 0.03]]] : [];
  const chassis = heavy
    ? [[front, 0.058], [0.05, 0.058], [0.07, 0.07], [0.36, 0.08], [0.37, -0.08], [0.3, -0.085], [0.16, -0.035], [0.115, -0.1], [0.07, -0.1], [0.06, -0.035], [0.02, -0.012], [front + 0.03, 0.012], [front, 0.03]]
    : [[front, 0.056], [0.05, 0.056], [0.33, 0.07], [0.34, -0.07], [0.2, -0.05], [0.09, -0.025], [0.085, -0.1], [0.045, -0.1], [0.04, -0.03], [0.02, -0.012], [front + 0.03, 0.014], [front, 0.03]];
  g.add(ext(chassis, 0.05, body, { holes: hole, bevel: 0.006 }));
  g.add(ext([[-0.032, 0.012], [-0.036, -0.018, -0.02, -0.024], [0.022, -0.024], [0.03, -0.012, 0.026, 0.012]], 0.012, poly, { holes: [[[-0.024, 0.008], [-0.026, -0.012, -0.016, -0.016], [0.016, -0.016], [0.02, -0.01, 0.018, 0.008]]], bevel: 0.0015 }));
  g.add(ext([[-0.006, 0.006], [-0.012, -0.004, -0.005, -0.012], [-0.001, -0.011], [-0.005, -0.004, -0.002, 0.006]], 0.005, M.steel(), { bevel: 0.001 }));
  // cheek riser, butt pad
  g.add(ext([[0.14, 0.078], [0.3, 0.084], [0.3, 0.1], [0.16, 0.098]], 0.036, body, { bevel: 0.005 }));
  g.add(ext([[heavy ? 0.37 : 0.34, heavy ? 0.082 : 0.072], [heavy ? 0.39 : 0.36, heavy ? 0.082 : 0.072], [heavy ? 0.392 : 0.362, heavy ? -0.084 : -0.072], [heavy ? 0.372 : 0.342, heavy ? -0.084 : -0.072]], 0.052, M.rubber(), { bevel: 0.004 }));
  // round steel receiver, barrel, muzzle brake
  g.add(cyl(0.02, 0.26, dark, 0, 0.066, -0.06));
  g.add(cyl(0.021, 0.02, dark, 0, 0.066, 0.075));
  g.add(box(0.006, 0.014, 0.05, M.color(0x050505, 0.2, 0.9), 0.019, 0.074, -0.04));
  const bl = heavy ? 0.52 : 0.42;
  g.add(cyl(heavy ? 0.0145 : 0.012, bl, dark, 0, 0.062, -0.19 - bl / 2, 'z', 16, heavy ? 0.0125 : 0.011));
  if (heavy) {
    g.add(box(0.034, 0.028, 0.075, dark, 0, 0.062, -0.745));
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) g.add(box(0.002, 0.014, 0.012, M.color(0x050505, 0.2, 0.9), sx * 0.0171, 0.062, -0.72 - i * 0.022));
  } else {
    g.add(cyl(0.0135, 0.02, dark, 0, 0.062, -0.62));
  }
  // bolt handle (animated)
  const bolt = new THREE.Group();
  bolt.name = 'bolt';
  bolt.add(cyl(0.004, 0.045, M.steel(), 0.035, 0.066, 0.03, 'x', 8));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), M.polymer());
  knob.position.set(0.058, 0.064, 0.034);
  bolt.add(knob);
  g.add(bolt);
  // detachable box magazine
  const mag = new THREE.Group();
  mag.name = 'mag';
  mag.add(ext([[-0.06, 0.02], [-0.06, -0.03], [0.02, -0.03], [0.02, 0.02]], 0.03, M.gunmetal(), { bevel: 0.002 }));
  mag.add(ext([[-0.062, -0.03], [-0.062, -0.037], [0.022, -0.037], [0.022, -0.03]], 0.033, poly, { bevel: 0.0015 }));
  g.add(mag);
  // folded bipod on the heavy rifle
  if (heavy) {
    g.add(box(0.03, 0.02, 0.03, dark, 0, 0.01, front + 0.05));
    for (const sx of [-1, 1]) g.add(cyl(0.0045, 0.2, M.steel(), sx * 0.012, 0.004, front + 0.15));
  }
  // scope: rail, rings, tube, turrets, objective and ocular bells, lenses
  g.add(box(0.022, 0.008, 0.22, dark, 0, 0.09, -0.06));
  for (const z of [-0.14, 0.01]) {
    g.add(box(0.026, 0.014, 0.022, dark, 0, 0.1, z));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0205, 0.004, 6, 18), dark);
    ring.position.set(0, 0.128, z);
    g.add(ring);
  }
  g.add(cyl(0.017, 0.24, poly, 0, 0.128, -0.07));
  g.add(cyl(0.027, 0.07, poly, 0, 0.128, -0.23, 'z', 20, 0.018));
  g.add(cyl(0.027, 0.02, poly, 0, 0.128, -0.275));
  g.add(cyl(0.022, 0.06, poly, 0, 0.128, 0.08, 'z', 18, 0.018));
  g.add(cyl(0.024, 0.025, M.rubber(), 0, 0.128, 0.12));
  g.add(cyl(0.011, 0.022, dark, 0, 0.152, -0.07, 'y', 14));
  g.add(cyl(0.011, 0.022, dark, 0.024, 0.128, -0.07, 'x', 14));
  g.add(cyl(0.024, 0.004, M.glass(), 0, 0.128, -0.286));
  g.add(cyl(0.02, 0.004, M.glass(), 0, 0.128, 0.134));
  return finish(g, { muzzle: [0, 0.062, heavy ? -0.785 : -0.63], eject: [0.03, 0.07, -0.03], sightY: 0.128, fore: [0, 0.0, -0.3], grip: [0, -0.03, 0.08], kind: 'sniper' });
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
const _limb = new THREE.Euler();
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
    if (this.deathT >= 0) this.weapon.visible = false;
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
    this.deathHead = (Math.random() - 0.5) * 1.2;
    if (this.weapon) this.weapon.visible = false; // it drops from the hands
  }

  // A bullet hit: the upper body jolts away from the shot (dirX, dirZ: world direction of travel).
  flinch(dirX, dirZ, headshot = false) {
    const yaw = this.root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
    const lx = dirX * c - dirZ * s, lz = dirX * s + dirZ * c;
    const L = Math.hypot(lx, lz) || 1;
    this.flinchX = lx / L;
    this.flinchZ = lz / L;
    this.flinchHS = headshot;
    this.flinchT = 0;
  }

  revive() {
    this.deathT = -1;
    if (this.weapon) this.weapon.visible = true;
    this.chest.rotation.set(0, 0, 0);
    this.hips.rotation.set(0, 0, 0);
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
      // knees give way, then the body topples (accelerating like a fall), hits the ground, settles;
      // arms go limp, the head rolls
      this.deathT = Math.min(1, this.deathT + dt / 1.05);
      const t = this.deathT;
      const sm = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
      const buckle = sm(0, 0.28, t);
      const fall = Math.pow(sm(0.12, 0.7, t), 1.7);
      const u = Math.max(0, (t - 0.7) / 0.3);
      const bounce = t > 0.7 ? Math.sin(u * Math.PI) * (1 - u) * 0.1 : 0;
      const tip = fall * (Math.PI / 2) * 0.96 - bounce;
      this.body.rotation.set(tip * this.deathZ, this.deathSpin * fall, -tip * this.deathX * 0.9);
      this.body.position.set(this.deathX * fall * 0.42, 0, this.deathZ * fall * 0.42);
      this.hips.position.set(0, 0.92 - buckle * 0.26 * (1 - fall * 0.4) - fall * 0.5, 0);
      this.hips.rotation.set(0, 0, 0);
      const slump = buckle * (1 - fall);
      // (positive x tilts a bone's top backwards: the slump is forwards)
      this.spine.rotation.set(-slump * 0.35 - fall * 0.08 * this.deathZ, 0, fall * 0.12 * this.deathX);
      this.chest.rotation.set(-slump * 0.2 - fall * 0.1, 0, 0);
      this.aim.rotation.set(-slump * 0.15, 0, 0);
      this.head.rotation.set(-slump * 0.5 + fall * 0.35 * this.deathZ, fall * this.deathHead * 0.6, fall * this.deathHead * 0.4);
      for (let i = 0; i < 2; i++) {
        const sgn = i ? -1 : 1;
        this.legs[i].thigh.rotation.set(slump * 0.75 + fall * (i ? 0.1 : 0.35), 0, sgn * (0.04 + fall * 0.12));
        this.legs[i].knee.rotation.set(-slump * 1.25 - fall * (i ? 0.2 : 0.55), 0, 0);
      }
      const k = 1 - Math.exp(-dt * 14);
      for (const key of ['r', 'l']) {
        const a = arms[key], side = key === 'r' ? 1 : -1;
        _ik.q.setFromEuler(_limb.set(0.15 + fall * 0.35 * this.deathZ, 0, side * (0.15 + fall * 0.55)));
        a.grp.quaternion.slerp(_ik.q, k);
        _ik.q.setFromEuler(_limb.set(0.35 + slump * 0.4, 0, 0));
        a.elbow.quaternion.slerp(_ik.q, k);
      }
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
    // landing dip after a jump or fall
    if (s.onGround && this.wasAir) this.landT = 0;
    this.wasAir = !s.onGround;
    this.landT = Math.min(1, (this.landT ?? 1) + dt / 0.35);
    const land = Math.sin(this.landT * Math.PI) * (1 - this.landT) * 0.16;
    const hipsY = 0.92 - c * 0.4 - (moving ? Math.abs(Math.sin(ph)) * 0.035 * amp : 0) - land;
    this.hips.position.y = hipsY;
    // weight over the stance leg: lateral sway and pelvis roll while walking, a slow shift when idle
    this.hips.position.x = moving ? Math.sin(ph) * 0.022 * amp : Math.sin(this.breath * 0.45) * 0.008;
    this.hips.rotation.z = moving ? Math.sin(ph) * 0.05 * amp : Math.sin(this.breath * 0.45) * 0.012;
    this.hips.rotation.y = moving ? sk * 0.35 * Math.sign(fk || 1) : 0;
    const air = !s.onGround ? 0.5 : 0;
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? 1 : -1;
      const phase = ph + (i ? Math.PI : 0);
      const swing = moving ? Math.sin(phase) * 0.6 * amp : 0;
      const bend = moving ? Math.max(0, Math.sin(phase + Math.PI / 2)) * 0.9 * amp : 0;
      this.legs[i].thigh.rotation.x = swing * Math.max(Math.abs(fk), 0.35) + c * 1.25 + air * (i ? 0.2 : 0.7);
      this.legs[i].knee.rotation.x = -bend - (moving ? 0.12 * amp : 0.04) - c * 2.0 - air * 0.9 - land * 1.4;
      if (land) this.legs[i].thigh.rotation.x += land * 0.7;
      this.legs[i].thigh.rotation.z = sgn * 0.03 + (moving ? Math.sin(phase) * 0.25 * amp * sk * sgn : 0);
    }
    const run = Math.max(0, Math.min(1, (speed - 3.5) / 2));
    this.spine.rotation.x = c * 0.25 + (moving ? (0.05 + run * 0.1) * Math.sign(fk || 1) : 0) + Math.sin(this.breath * 1.7) * 0.012 + land * 0.4;
    this.spine.rotation.z = -(s.lean || 0) * 0.5 - this.hips.rotation.z * 0.8;
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
    if (this.flinchT !== undefined && this.flinchT < 1) {
      this.flinchT = Math.min(1, this.flinchT + dt / 0.3);
      const e = Math.sin(this.flinchT * Math.PI) * (1 - this.flinchT * 0.4);
      this.chest.rotation.x += this.flinchZ * 0.2 * e;
      this.chest.rotation.z -= this.flinchX * 0.16 * e;
      this.head.rotation.x += (this.flinchHS ? 0.5 : 0.12) * this.flinchZ * e;
      this.head.rotation.z -= (this.flinchHS ? 0.35 : 0.06) * this.flinchX * e;
    }
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
