// Procedural models: weapons (shared by first and third person) and player characters.

import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { PLAYER } from '../shared/constants.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const matCache = new Map();
function mat(key, params) {
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial(params));
  return matCache.get(key);
}
const M = {
  gunmetal: () => mat('gunmetal', { color: 0x2a2c30, metalness: 0.75, roughness: 0.38 }),
  steel: () => mat('steel', { color: 0x8d9299, metalness: 0.9, roughness: 0.28 }),
  blade: () => mat('blade', { color: 0xc8ccd2, metalness: 1, roughness: 0.18 }),
  polymer: () => mat('polymer', { color: 0x1c1d1f, metalness: 0.05, roughness: 0.72 }),
  wood: () => mat('wood', { color: 0x7a4a24, metalness: 0, roughness: 0.55 }),
  brass: () => mat('brass', { color: 0xc9a14a, metalness: 1, roughness: 0.3 }),
  glass: () => mat('glass', { color: 0x223344, metalness: 0.9, roughness: 0.05, emissive: 0x0a1a2a }),
  red: () => mat('reddot', { color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 }),
  rubber: () => mat('rubber', { color: 0x151515, metalness: 0, roughness: 0.9 }),
  color: (hex, metal = 0.35, rough = 0.5) => mat(`c${hex}_${metal}_${rough}`, { color: hex, metalness: metal, roughness: rough }),
};

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}
function cyl(r, len, material, x = 0, y = 0, z = 0, axis = 'z', seg = 14, r2 = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), material);
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
  const L = o.len;
  const ak = o.style === 'ak';
  const m4 = o.style === 'm4';
  const body = M.color(o.body, 0.6, 0.4);
  const furniture = ak ? M.wood() : M.color(o.accent, 0.2, 0.6);
  g.add(box(0.05, 0.07, 0.42, body, 0, 0.045, -0.12));
  // barrel & handguard
  g.add(cyl(0.011, 0.38, M.gunmetal(), 0, 0.055, -0.53));
  g.add(box(0.056, 0.06, 0.26, furniture, 0, 0.048, -0.43));
  if (!ak) g.add(box(0.03, 0.012, 0.26, M.gunmetal(), 0, 0.082, -0.43));
  g.add(cyl(0.017, 0.06, M.gunmetal(), 0, 0.055, -0.74));
  // front sight / gas block
  g.add(box(0.005, 0.04, 0.01, M.gunmetal(), 0, 0.08, -0.66));
  g.add(box(0.024, 0.03, 0.03, M.gunmetal(), 0, 0.062, -0.66));
  // muzzle device with ports
  g.add(cyl(0.015, 0.05, M.gunmetal(), 0, 0.055, -0.775));
  for (let i = 0; i < 3; i++) g.add(box(0.032, 0.006, 0.004, M.polymer(), 0, 0.055, -0.76 - i * 0.012));
  // receiver details: ejection port, charging handle, magwell, trigger guard
  g.add(box(0.052, 0.018, 0.06, M.polymer(), 0.001, 0.058, -0.06));
  g.add(box(0.012, 0.012, 0.03, M.steel(), 0.032, 0.066, ak ? -0.05 : 0.07));
  g.add(box(0.044, 0.04, 0.07, body, 0, 0.0, -0.12));
  g.add(box(0.008, 0.008, 0.07, M.gunmetal(), 0, -0.012, -0.03));
  const trig = box(0.005, 0.02, 0.005, M.steel(), 0, 0.0, -0.04);
  trig.rotation.x = 0.3;
  g.add(trig);
  if (m4 || o.style === 'marauder') for (let i = 0; i < 9; i++) g.add(box(0.034, 0.006, 0.012, M.gunmetal(), 0, 0.09, -0.32 - i * 0.026));
  if (ak) { g.add(box(0.058, 0.01, 0.2, M.wood(), 0, 0.083, -0.45)); g.add(cyl(0.012, 0.25, M.gunmetal(), 0, 0.09, -0.3)); }
  // grip
  const grip = box(0.03, 0.11, 0.045, ak ? M.wood() : M.polymer(), 0, -0.035, 0.03);
  grip.rotation.x = 0.28;
  g.add(grip);
  // stock (hidden in first person while aiming)
  const stock = new THREE.Group();
  stock.name = 'stock';
  if (ak) {
    const st = box(0.045, 0.07, 0.26, M.wood(), 0, 0.012, 0.2);
    st.rotation.x = 0.12;
    stock.add(st);
  } else {
    stock.add(cyl(0.017, 0.2, M.polymer(), 0, 0.045, 0.16));
    stock.add(box(0.05, 0.085, 0.1, M.polymer(), 0, 0.02, 0.25));
  }
  g.add(stock);
  // magazine
  const mag = new THREE.Group();
  if (ak) {
    const m1 = box(0.03, 0.1, 0.05, body, 0, -0.04, 0);
    const m2 = box(0.03, 0.1, 0.05, body, 0, -0.12, 0.02);
    m2.rotation.x = -0.35;
    mag.add(m1, m2);
    m1.material = M.color(0x5a3520, 0.2, 0.5);
    m2.material = m1.material;
  } else {
    mag.add(box(0.028, 0.17, 0.05, M.gunmetal(), 0, -0.07, 0));
  }
  mag.position.set(0, 0.01, -0.12);
  mag.name = 'mag';
  g.add(mag);
  // top: optic or rear sight
  if (m4 || o.style === 'marauder') {
    g.add(box(0.03, 0.012, 0.3, M.gunmetal(), 0, 0.085, -0.12));
    const optic = new THREE.Group();
    // hollow red-dot: base, two side plates, top plate, see-through lens, emissive dot
    optic.add(box(0.034, 0.008, 0.07, M.polymer(), 0, 0.089, -0.06));
    optic.add(box(0.005, 0.03, 0.07, M.polymer(), 0.0145, 0.106, -0.06));
    optic.add(box(0.005, 0.03, 0.07, M.polymer(), -0.0145, 0.106, -0.06));
    optic.add(box(0.034, 0.005, 0.07, M.polymer(), 0, 0.1225, -0.06));
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.024, 0.026), mat('lens-glass', { color: 0x88ccaa, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false }));
    lens.position.set(0, 0.106, -0.094);
    optic.add(lens);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 8, 6), M.red());
    dot.position.set(0, 0.108, -0.093);
    dot.name = 'reddot';
    optic.add(dot);
    g.add(optic);
    return finish(g, { muzzle: [0, 0.055, -0.78], eject: [0.03, 0.06, -0.08], sightY: 0.108, fore: [0, 0.02, -0.42], grip: [0, -0.02, 0.03], kind: 'rifle' });
  }
  g.add(box(0.03, 0.008, 0.04, M.gunmetal(), 0, 0.084, -0.04));
  g.add(box(0.008, 0.016, 0.01, M.gunmetal(), 0.01, 0.094, -0.04));
  g.add(box(0.008, 0.016, 0.01, M.gunmetal(), -0.01, 0.094, -0.04));
  return finish(g, { muzzle: [0, 0.055, -0.78], eject: [0.03, 0.06, -0.08], sightY: 0.1, fore: [0, 0.02, -0.42], grip: [0, -0.02, 0.03], kind: 'rifle' });
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

function buildGrenade(o, id) {
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

const FFA_COLORS = [0xd9483b, 0x3bb4d9, 0x7ed93b, 0xd9b43b, 0xa13bd9, 0xd93b8f, 0x3bd9a1, 0xe0e0e0, 0x8a5a2b, 0x5b6cff];

export function teamLook(team, id, ffa) {
  if (ffa) {
    const c = FFA_COLORS[id % FFA_COLORS.length];
    return { uniform: 0x4d4a44, pants: 0x3a3833, vest: 0x2e2e2c, pack: 0x2b2b28, accent: c, head: 0x2a2a2a, helmet: c, gloves: 0x1c1c1c, boots: 0x222222, pads: 0x262626, lens: c, balaclava: true, ears: false };
  }
  if (team === 1) return { uniform: 0x9c8566, pants: 0x74634a, vest: 0x4a4637, pack: 0x5b513c, accent: 0xff8a3d, head: 0x2b2b2b, helmet: 0x5a513f, gloves: 0x2a2a2a, boots: 0x3a3025, pads: 0x3b3830, lens: 0xff9a3d, balaclava: true, ears: false };
  return { uniform: 0x3a4b66, pants: 0x2a3548, vest: 0x1f2a38, pack: 0x222a33, accent: 0x4aa8ff, head: 0xc99a7a, helmet: 0x2e3a4a, gloves: 0x1a1a1a, boots: 0x1c1c1c, pads: 0x1d2229, lens: 0x4ad0ff, balaclava: false, ears: true };
}

// Every part of a character (and every third-person weapon) is merged into one geometry that carries
// per-vertex colour, roughness, metalness and emissive, so they all share this single material.
let bakedMat = null;
export function bakedMaterial() {
  if (bakedMat) return bakedMat;
  bakedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  bakedMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aMat;\nvarying vec3 vMat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMat;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vMat.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMat.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vMat.z;');
  };
  bakedMat.customProgramCacheKey = () => 'baked-vertex-material';
  return bakedMat;
}

const _pm = new THREE.Matrix4();
const _pq = new THREE.Quaternion();
const _pe = new THREE.Euler();
const _ps = new THREE.Vector3();
const _pp = new THREE.Vector3();
const _pc = new THREE.Color();
const _pn = new THREE.Matrix3();
const _pv = new THREE.Vector3();
const IDENTITY = new THREE.Matrix4();

class PartBuilder {
  constructor() { this.parts = []; }
  // geo is consumed. o: { p, r, s, rough, metal, emit }
  add(bone, geo, color, o = {}) {
    _pm.compose(_pp.fromArray(o.p || [0, 0, 0]), _pq.setFromEuler(_pe.fromArray([...(o.r || [0, 0, 0]), 'XYZ'])), _ps.fromArray(o.s || [1, 1, 1]));
    geo.applyMatrix4(_pm);
    this.parts.push({ bone, geo, color, rough: o.rough ?? 0.8, metal: o.metal ?? 0, emit: o.emit ?? 0 });
  }
  // Bake parts into one geometry. With bones, positions go to bind-pose space and get skin attributes.
  build(bones = null) {
    let nv = 0, ni = 0;
    for (const p of this.parts) { nv += p.geo.attributes.position.count; ni += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), am = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const si = bones ? new Uint16Array(nv * 4) : null, sw = bones ? new Float32Array(nv * 4) : null;
    let o = 0, oi = 0;
    for (const p of this.parts) {
      const mw = p.bone ? p.bone.matrixWorld : IDENTITY;
      _pn.getNormalMatrix(mw);
      const P = p.geo.attributes.position, N = p.geo.attributes.normal;
      _pc.set(p.color);
      const bi = bones && p.bone ? Math.max(0, bones.indexOf(p.bone)) : 0;
      for (let i = 0; i < P.count; i++) {
        _pv.fromBufferAttribute(P, i).applyMatrix4(mw);
        pos[(o + i) * 3] = _pv.x; pos[(o + i) * 3 + 1] = _pv.y; pos[(o + i) * 3 + 2] = _pv.z;
        _pv.fromBufferAttribute(N, i).applyMatrix3(_pn).normalize();
        nor[(o + i) * 3] = _pv.x; nor[(o + i) * 3 + 1] = _pv.y; nor[(o + i) * 3 + 2] = _pv.z;
        col[(o + i) * 3] = _pc.r; col[(o + i) * 3 + 1] = _pc.g; col[(o + i) * 3 + 2] = _pc.b;
        am[(o + i) * 3] = p.rough; am[(o + i) * 3 + 1] = p.metal; am[(o + i) * 3 + 2] = p.emit;
        if (si) { si[(o + i) * 4] = bi; sw[(o + i) * 4] = 1; }
      }
      if (p.geo.index) for (let i = 0; i < p.geo.index.count; i++) idx[oi++] = o + p.geo.index.getX(i);
      else for (let i = 0; i < P.count; i++) idx[oi++] = o + i;
      o += P.count;
      p.geo.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aMat', new THREE.BufferAttribute(am, 3));
    if (si) {
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;
  }
}

// Third-person / world weapon: the full weapon model flattened into one baked mesh (one draw call).
const bakedWeaponCache = new Map();
export function bakedWeapon(id) {
  if (!bakedWeaponCache.has(id)) {
    const src = createWeaponModel(id);
    src.updateMatrixWorld(true);
    const pb = new PartBuilder();
    src.traverse((m) => {
      if (!m.isMesh || !m.visible) return;
      const mt = m.material;
      const glow = mt.emissive && mt.emissiveIntensity > 0 && mt.emissive.getHex() !== 0;
      const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      pb.add(null, geo, glow && mt.emissive.getHex() !== 0 && mt.color.getHex() === mt.emissive.getHex() ? mt.emissive.getHex() : mt.color.getHex(), {
        rough: mt.roughness ?? 0.5, metal: mt.metalness ?? 0, emit: glow ? Math.min(3, mt.emissiveIntensity * (mt.emissive.r + mt.emissive.g + mt.emissive.b) / 3 * 2) : 0,
      });
    });
    bakedWeaponCache.set(id, { geo: pb.build(), info: { ...src.userData } });
  }
  const c = bakedWeaponCache.get(id);
  const mesh = new THREE.Mesh(c.geo, bakedMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { ...c.info };
  return mesh;
}

const RB = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
const CAP = (r, len, seg = 10) => new THREE.CapsuleGeometry(r, len, 3, seg);
const CYL = (rt, rb, h, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const SPH = (r, ws = 14, hs = 10, t0 = 0, tl = Math.PI) => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, t0, tl);
const shade = (hex, k) => _pc.set(hex).multiplyScalar(k).getHex();

// Bind pose for the arms (they are driven by two-bone IK every frame).
const ARM_POSE = { r: { up: [0.55, 0, 0.12], fore: [1.05, 0, 0] }, l: { up: [1.25, 0, -0.55], fore: [0.35, 0.1, 0] } };
const UPPER_ARM = 0.3, FORE_ARM = 0.3;
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
    const pb = new PartBuilder();
    const bones = [];
    const bone = (parent, x, y, z) => {
      const b = new THREE.Bone();
      b.position.set(x, y, z);
      if (parent) parent.add(b);
      bones.push(b);
      return b;
    };
    const faceCol = L.balaclava ? L.head : 0xc99a7a;
    const dark = 0x1b1b1b;

    const body = bone(null, 0, 0, 0);
    const hips = bone(body, 0, 0.92, 0);
    pb.add(hips, RB(0.34, 0.17, 0.23, 0.05), L.pants);
    pb.add(hips, RB(0.365, 0.05, 0.25, 0.015), 0x2a2620, { p: [0, 0.075, 0], rough: 0.6 });
    pb.add(hips, RB(0.06, 0.04, 0.02, 0.006), 0x8a877e, { p: [0, 0.075, -0.13], rough: 0.35, metal: 0.8 });
    pb.add(hips, RB(0.11, 0.11, 0.07, 0.02), L.vest, { p: [-0.14, 0.0, 0.12] });

    const legs = [];
    for (const side of [-1, 1]) {
      const thigh = bone(hips, side * 0.1, -0.03, 0);
      pb.add(thigh, CAP(0.08, 0.27), L.pants, { p: [0, -0.22, 0], rough: 0.9 });
      pb.add(thigh, RB(0.05, 0.13, 0.12, 0.015), shade(L.pants, 0.88), { p: [side * 0.075, -0.22, 0] });
      if (side === 1) {
        pb.add(thigh, RB(0.065, 0.17, 0.1, 0.02), L.vest, { p: [0.1, -0.13, 0.0] });
        pb.add(thigh, RB(0.035, 0.07, 0.045, 0.008), 0x1c1d1f, { p: [0.1, -0.02, 0.02], rough: 0.7 });
      }
      const knee = bone(thigh, 0, -0.44, 0);
      pb.add(knee, CAP(0.068, 0.27), L.pants, { p: [0, -0.2, 0], rough: 0.9 });
      pb.add(knee, RB(0.12, 0.13, 0.075, 0.03), L.pads, { p: [0, -0.02, -0.06], rough: 0.6 });
      pb.add(knee, RB(0.124, 0.022, 0.078, 0.006), L.accent, { p: [0, -0.03, -0.062], emit: 0.25 });
      pb.add(knee, RB(0.125, 0.15, 0.14, 0.035), L.boots, { p: [0, -0.37, 0.0], rough: 0.7 });
      pb.add(knee, RB(0.125, 0.075, 0.25, 0.03), L.boots, { p: [0, -0.425, -0.05], rough: 0.7 });
      pb.add(knee, RB(0.13, 0.03, 0.26, 0.01), 0x121212, { p: [0, -0.463, -0.05], rough: 0.95 });
      legs.push({ thigh, knee });
    }

    const spine = bone(hips, 0, 0.04, 0);
    pb.add(spine, RB(0.33, 0.22, 0.2, 0.06), L.uniform, { p: [0, 0.12, 0], rough: 0.9 });
    pb.add(spine, RB(0.42, 0.3, 0.24, 0.07), L.uniform, { p: [0, 0.37, 0], rough: 0.9 });
    pb.add(spine, RB(0.445, 0.2, 0.25, 0.04), L.vest, { p: [0, 0.27, 0] });
    pb.add(spine, RB(0.37, 0.32, 0.06, 0.025), L.vest, { p: [0, 0.34, -0.125] });
    pb.add(spine, RB(0.37, 0.33, 0.06, 0.025), L.vest, { p: [0, 0.35, 0.125] });
    for (const sx of [-1, 1]) pb.add(spine, RB(0.075, 0.035, 0.31, 0.012), L.vest, { p: [sx * 0.135, 0.52, 0] });
    for (let i = -1; i <= 1; i++) {
      pb.add(spine, RB(0.085, 0.12, 0.055, 0.015), shade(L.vest, 0.82), { p: [i * 0.098, 0.25, -0.172] });
      pb.add(spine, RB(0.06, 0.03, 0.035, 0.006), 0x1c1d1f, { p: [i * 0.098, 0.325, -0.172], rough: 0.6 });
    }
    pb.add(spine, RB(0.07, 0.1, 0.05, 0.012), shade(L.vest, 0.82), { p: [-0.13, 0.44, -0.168] });
    pb.add(spine, RB(0.075, 0.042, 0.012, 0.004), L.accent, { p: [0.1, 0.45, -0.158], emit: 0.5 });
    pb.add(spine, CYL(0.1, 0.12, 0.07, 12), L.uniform, { p: [0, 0.54, 0], rough: 0.9 });
    pb.add(spine, RB(0.28, 0.31, 0.11, 0.035), L.pack, { p: [0, 0.33, 0.205] });
    pb.add(spine, CYL(0.05, 0.05, 0.27, 10), shade(L.pack, 0.85), { p: [0, 0.51, 0.2], r: [0, 0, Math.PI / 2] });
    pb.add(spine, RB(0.08, 0.05, 0.012, 0.004), L.accent, { p: [0, 0.42, 0.262], emit: 0.6 });
    pb.add(spine, CYL(0.005, 0.005, 0.32, 5), dark, { p: [-0.11, 0.62, 0.22], r: [0.12, 0, 0.1], rough: 0.5 });

    const neck = bone(spine, 0, 0.56, 0);
    pb.add(neck, CYL(0.05, 0.056, 0.1, 10), faceCol, { p: [0, 0.02, 0] });
    const head = bone(neck, 0, 0.1, 0);
    pb.add(head, SPH(0.115, 16, 12), faceCol, { p: [0, 0.04, 0], s: [0.95, 1.05, 1], rough: 0.8 });
    if (!L.balaclava) {
      pb.add(head, RB(0.19, 0.075, 0.045, 0.02), 0x232323, { p: [0, -0.035, -0.095] });
    } else {
      pb.add(head, RB(0.17, 0.05, 0.04, 0.015), shade(L.head, 1.3), { p: [0, -0.02, -0.098] });
    }
    pb.add(head, SPH(0.133, 18, 10, 0, Math.PI * 0.52), L.helmet, { p: [0, 0.06, 0], rough: 0.55, metal: 0.15 });
    pb.add(head, CYL(0.138, 0.138, 0.024, 20, true), shade(L.helmet, 0.8), { p: [0, 0.052, 0], rough: 0.6 });
    pb.add(head, RB(0.055, 0.04, 0.03, 0.008), 0x2a2c30, { p: [0, 0.15, -0.115], rough: 0.4, metal: 0.7 });
    for (const sx of [-1, 1]) {
      pb.add(head, RB(0.025, 0.05, 0.14, 0.01), 0x2a2c30, { p: [sx * 0.131, 0.1, 0], rough: 0.5, metal: 0.5 });
      if (L.ears) pb.add(head, CYL(0.042, 0.042, 0.04, 12), 0x202224, { p: [sx * 0.125, 0.02, 0], r: [0, 0, Math.PI / 2], rough: 0.7 });
    }
    pb.add(head, CYL(0.121, 0.121, 0.026, 16, true), dark, { p: [0, 0.07, 0], rough: 0.8 });
    pb.add(head, RB(0.2, 0.058, 0.05, 0.018), L.lens, { p: [0, 0.07, -0.103], rough: 0.12, metal: 0.6, emit: 0.3 });
    pb.add(head, RB(0.212, 0.068, 0.04, 0.02), dark, { p: [0, 0.07, -0.094], rough: 0.7 });

    const aim = bone(spine, 0, 0.46, 0);
    const arms = {};
    for (const [key, side] of [['r', 1], ['l', -1]]) {
      const grp = bone(aim, side * 0.23, 0, 0);
      pb.add(grp, SPH(0.072, 10, 8, 0, Math.PI / 2), L.vest, { p: [0, -0.015, 0], s: [1, 0.85, 1.05] });
      pb.add(grp, CAP(0.06, 0.2), L.uniform, { p: [0, -0.15, 0], rough: 0.9 });
      if (side === 1) pb.add(grp, CYL(0.064, 0.064, 0.035, 12, true), L.accent, { p: [0, -0.09, 0], emit: 0.4 });
      const elbow = bone(grp, 0, -UPPER_ARM, 0);
      pb.add(elbow, RB(0.085, 0.075, 0.075, 0.025), L.pads, { p: [0, 0.0, 0.035], rough: 0.6 });
      pb.add(elbow, CAP(0.054, 0.18), L.uniform, { p: [0, -0.125, 0], rough: 0.9 });
      pb.add(elbow, CYL(0.059, 0.059, 0.05, 10), L.gloves, { p: [0, -0.23, 0] });
      pb.add(elbow, RB(0.075, 0.1, 0.085, 0.025), L.gloves, { p: [0, -FORE_ARM, 0] });
      grp.rotation.fromArray(ARM_POSE[key].up);
      elbow.rotation.fromArray(ARM_POSE[key].fore);
      arms[key] = { grp, elbow };
    }

    // bind pose -> skinned mesh
    body.updateMatrixWorld(true);
    const geo = pb.build(bones);
    const mesh = new THREE.SkinnedMesh(geo, bakedMaterial());
    mesh.add(body);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const weaponMount = new THREE.Group();
    weaponMount.position.fromArray(STANCE.rifle.grip);
    aim.add(weaponMount);
    const bomb = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.12, 0.16, 1, 0.02), M.color(0x5a5245, 0.2, 0.7));
    bomb.position.set(0, 0.22, 0.3);
    bomb.visible = false;
    bomb.castShadow = true;
    spine.add(bomb);

    const root = new THREE.Group();
    root.add(mesh);
    this.root = root;
    this.mesh = mesh;
    this.body = body;
    this.hips = hips;
    this.legs = legs;
    this.spine = spine;
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
    this.weaponMount.add(this.weapon);
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
      this.aim.rotation.x = -f * 0.6;
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
    this.aim.rotation.set(pitch - c * 0.25 + this.recoil, tw, 0);
    this.head.rotation.x = pitch * 0.6 - c * 0.2;
    if (s.planting || s.defusing) {
      this.aim.rotation.x = -0.9;
      this.head.rotation.x = -0.6;
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
