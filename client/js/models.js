// Procedural models: weapons (shared by first and third person) and player characters.

import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { PLAYER } from '../shared/constants.js';

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
    return { uniform: 0x4d4a44, pants: 0x3a3833, vest: 0x2a2a2a, accent: c, head: 0x2a2a2a, helmet: c, gloves: 0x1c1c1c, boots: 0x222222, lens: c, balaclava: true };
  }
  if (team === 1) return { uniform: 0x9c8566, pants: 0x74634a, vest: 0x4a4637, accent: 0xff8a3d, head: 0x2b2b2b, helmet: 0x5a513f, gloves: 0x2a2a2a, boots: 0x3a3025, lens: 0xff9a3d, balaclava: true };
  return { uniform: 0x3a4b66, pants: 0x2a3548, vest: 0x1f2a38, accent: 0x4aa8ff, head: 0xc99a7a, helmet: 0x2e3a4a, gloves: 0x1a1a1a, boots: 0x1c1c1c, lens: 0x4ad0ff, balaclava: false };
}

function capsule(r, len, material) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), material);
  return m;
}

export class PlayerModel {
  constructor(look, name = '', showName = false) {
    const L = look;
    const uni = M.color(L.uniform, 0, 0.85);
    const pants = M.color(L.pants, 0, 0.85);
    const vest = M.color(L.vest, 0.05, 0.75);
    const accent = mat('acc' + L.accent, { color: L.accent, roughness: 0.6, emissive: L.accent, emissiveIntensity: 0.15 });
    const gloves = M.color(L.gloves, 0, 0.8);
    const boots = M.color(L.boots, 0, 0.8);
    const skin = M.color(0xc99a7a, 0, 0.7);
    const headMat = M.color(L.balaclava ? L.head : 0xc99a7a, 0, 0.8);
    const helmetMat = M.color(L.helmet, 0.2, 0.55);
    const lens = mat('lens' + L.lens, { color: 0x111111, metalness: 0.9, roughness: 0.1, emissive: L.lens, emissiveIntensity: 0.35 });

    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const hips = new THREE.Group();
    hips.position.y = 0.92;
    body.add(hips);
    hips.add(box(0.34, 0.14, 0.22, pants, 0, 0, 0));

    const legs = [];
    for (const side of [-1, 1]) {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.1, -0.03, 0);
      const tm = capsule(0.075, 0.3, pants);
      tm.position.y = -0.22;
      thigh.add(tm);
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      const sm = capsule(0.065, 0.3, pants);
      sm.position.y = -0.2;
      knee.add(sm);
      knee.add(box(0.12, 0.09, 0.22, boots, 0, -0.41, -0.035));
      knee.add(box(0.13, 0.07, 0.07, accent, 0, -0.02, -0.05)); // knee pad accent
      thigh.add(knee);
      hips.add(thigh);
      legs.push({ thigh, knee });
    }

    const spine = new THREE.Group();
    spine.position.y = 0.04;
    hips.add(spine);
    spine.add(box(0.4, 0.5, 0.22, uni, 0, 0.27, 0));
    spine.add(box(0.44, 0.36, 0.28, vest, 0, 0.3, 0));
    // pouches
    for (let i = -1; i <= 1; i++) spine.add(box(0.09, 0.1, 0.05, vest, i * 0.11, 0.2, -0.16));
    spine.add(box(0.1, 0.035, 0.05, accent, 0.26, 0.42, 0)); // arm band
    const backpack = box(0.3, 0.3, 0.1, M.color(0x2b2b28, 0, 0.8), 0, 0.3, 0.18);
    spine.add(backpack);
    const bomb = box(0.26, 0.12, 0.16, M.color(0x5a5245, 0.2, 0.7), 0, 0.2, 0.26);
    bomb.name = 'bombback';
    bomb.visible = false;
    spine.add(bomb);

    const neck = new THREE.Group();
    neck.position.y = 0.56;
    spine.add(neck);
    neck.add(cyl(0.05, 0.08, skin, 0, 0.02, 0, 'y'));
    const head = new THREE.Group();
    head.position.y = 0.1;
    neck.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), headMat);
    skull.scale.set(0.95, 1.05, 1);
    skull.position.y = 0.04;
    head.add(skull);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.128, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), helmetMat);
    helmet.position.y = 0.06;
    head.add(helmet);
    const goggles = box(0.2, 0.05, 0.05, lens, 0, 0.06, -0.1);
    head.add(goggles);
    if (!L.balaclava) head.add(box(0.19, 0.075, 0.04, M.color(0x222222, 0.1, 0.8), 0, -0.035, -0.1)); // mask

    // arms + weapon rig (rotates with pitch)
    const aim = new THREE.Group();
    aim.position.set(0, 0.46, 0);
    spine.add(aim);
    const armR = new THREE.Group();
    armR.position.set(0.23, 0, 0);
    const armL = new THREE.Group();
    armL.position.set(-0.23, 0, 0);
    aim.add(armR, armL);
    const mkArm = (grp, upperRot, foreRot) => {
      const up = capsule(0.058, 0.2, uni);
      up.position.y = -0.14;
      grp.add(up);
      const elbow = new THREE.Group();
      elbow.position.y = -0.28;
      grp.add(elbow);
      const fore = capsule(0.052, 0.18, uni);
      fore.position.y = -0.12;
      elbow.add(fore);
      const hand = box(0.07, 0.09, 0.08, gloves, 0, -0.27, 0);
      elbow.add(hand);
      grp.rotation.set(upperRot[0], upperRot[1], upperRot[2]);
      elbow.rotation.set(foreRot[0], foreRot[1], foreRot[2]);
      return { grp, elbow };
    };
    const rArm = mkArm(armR, [0.55, 0, 0.12], [1.05, 0, 0]);
    const lArm = mkArm(armL, [1.25, 0, -0.55], [0.35, 0.1, 0]);
    const weaponMount = new THREE.Group();
    weaponMount.position.set(0.12, -0.14, -0.42);
    aim.add(weaponMount);

    mergeStatic(root);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    this.root = root;
    this.body = body;
    this.hips = hips;
    this.legs = legs;
    this.spine = spine;
    this.head = head;
    this.neck = neck;
    this.aim = aim;
    this.arms = { r: rArm, l: lArm };
    this.weaponMount = weaponMount;
    this.bombMesh = bomb;
    this.weaponId = null;
    this.weapon = null;
    this.walkPhase = 0;
    this.deathT = -1;
    this.deathDir = 1;
    this.recoil = 0;

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
    this.weapon = weaponTemplate(id || 'knife');
    const info = this.weapon.userData;
    const grip = info.grip || [0, 0, 0];
    this.weapon.position.set(-grip[0], -grip[1], -grip[2]);
    if (info.kind === 'knife') { this.weapon.rotation.set(0, 0, 0); this.weapon.position.set(0.02, 0.02, 0.18); }
    if (info.kind === 'grenade' || info.kind === 'bomb') this.weapon.position.set(0.0, 0.0, 0.2);
    this.weapon.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.weaponMount.add(this.weapon);
  }

  muzzleWorld(out = new THREE.Vector3()) {
    if (!this.weapon) return this.root.getWorldPosition(out);
    const m = this.weapon.userData.muzzle || [0, 0, -0.5];
    out.set(m[0], m[1], m[2]);
    return this.weapon.localToWorld(out);
  }

  die(dir = 1) {
    if (this.deathT >= 0) return;
    this.deathT = 0;
    this.deathDir = dir;
  }

  revive() {
    this.deathT = -1;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
  }

  // s: { x,y,z,yaw,pitch,crouch,lean, speed, alive, onGround, planting, defusing, bomb }
  update(s, dt) {
    const root = this.root;
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = s.yaw;
    if (this.deathT >= 0) {
      this.deathT = Math.min(1, this.deathT + dt / 0.55);
      const t = this.deathT;
      const e = t * t * (3 - 2 * t);
      this.body.rotation.x = e * (Math.PI / 2) * this.deathDir;
      this.body.position.y = -e * 0.02 + Math.sin(t * Math.PI) * 0.08;
      this.body.position.z = e * 0.3 * this.deathDir;
      this.hips.position.y = 0.92 - e * 0.72;
      this.aim.rotation.x = 0;
      this.legs[0].thigh.rotation.x = e * 0.4;
      this.legs[1].thigh.rotation.x = -e * 0.2;
      return;
    }
    const c = s.crouch || 0;
    const speed = s.speed || 0;
    const moving = speed > 0.3 && s.onGround;
    const amp = Math.min(1, speed / 5) * (1 - c * 0.4);
    if (moving) this.walkPhase += dt * (4 + speed * 1.6) * (1 - c * 0.3);
    else this.walkPhase *= 0.9;
    const ph = this.walkPhase;
    const hipsY = 0.92 - c * 0.4 - (moving ? Math.abs(Math.sin(ph)) * 0.03 * amp : 0);
    this.hips.position.y = hipsY;
    const air = !s.onGround ? 0.5 : 0;
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? 1 : -1;
      const swing = moving ? Math.sin(ph + (i ? Math.PI : 0)) * 0.6 * amp : 0;
      const bend = moving ? Math.max(0, Math.sin(ph + (i ? Math.PI : 0) + Math.PI / 2)) * 0.9 * amp : 0;
      this.legs[i].thigh.rotation.x = swing + c * 1.25 + air * (i ? 0.2 : 0.7);
      this.legs[i].knee.rotation.x = -bend - c * 2.0 - air * 0.9;
      this.legs[i].thigh.rotation.z = sgn * 0.02;
    }
    this.spine.rotation.x = c * 0.25 + (moving ? 0.05 : 0);
    this.spine.rotation.z = -(s.lean || 0) * 0.5;
    this.spine.rotation.y = moving ? Math.sin(ph) * 0.06 * amp : 0;
    const pitch = s.pitch || 0;
    this.recoil *= Math.exp(-dt * 14);
    this.aim.rotation.x = pitch - c * 0.25 + this.recoil;
    this.head.rotation.x = pitch * 0.6 - c * 0.2;
    if (s.planting || s.defusing) {
      this.aim.rotation.x = -0.9;
      this.head.rotation.x = -0.6;
    }
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
