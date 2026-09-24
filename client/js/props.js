// Detailed models for the map's furniture and vehicles; their collision boxes come from the map builder.
// Tables and office desks with clutter, shelving racks stocked with boxes, counters, locker banks,
// pallet stacks, pillar trim, cars, vans, dumpsters, generators, forklifts, rooftop AC units and rail
// box cars on their track. Everything is merged per material (a handful of draw calls per map) and carries
// the same baked shading as the level geometry: vertex AO plus the indoor flag for the room bounce light.

import * as THREE from 'three';
import { hash2 } from '../shared/constants.js';
import { plainWorldMaterial } from './textures.js';

const Y = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _e = new THREE.Euler();

function rng(seed) {
  let s = Math.floor(seed * 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

class Batch {
  constructor() { this.geos = []; }
  add(geo, m) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(m);
    this.geos.push(g);
  }
  // merge; shade(x, y, z, nx, ny, nz) -> [ao, outdoor]; worldUV > 0 projects metre-scaled UVs
  build(shade, worldUV = 0) {
    if (!this.geos.length) return null;
    let n = 0;
    for (const g of this.geos) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 4);
    let o = 0;
    for (const g of this.geos) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      o += g.attributes.position.count;
      g.dispose();
    }
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
      if (worldUV) {
        const ax = Math.abs(nx), ay = Math.abs(ny);
        if (ay > 0.6) { uv[i * 2] = x / worldUV; uv[i * 2 + 1] = z / worldUV; }
        else if (ax > Math.abs(nz)) { uv[i * 2] = z / worldUV; uv[i * 2 + 1] = y / worldUV; }
        else { uv[i * 2] = x / worldUV; uv[i * 2 + 1] = y / worldUV; }
      }
      const [k, out] = shade(x, y, z, nx, ny, nz);
      col[i * 4] = k; col[i * 4 + 1] = k; col[i * 4 + 2] = k; col[i * 4 + 3] = out;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.computeBoundingSphere();
    return geo;
  }
}

// Local frame of a piece: u along its length, v towards its front, y up from its floor.
class Frame {
  constructor(cx, y0, cz, theta) { this.cx = cx; this.y0 = y0; this.cz = cz; this.t = theta; this.c = Math.cos(theta); this.s = Math.sin(theta); }
  world(u, y, v) { return [this.cx + u * this.c + v * this.s, this.y0 + y, this.cz - u * this.s + v * this.c]; }
  mat(u, y, v, rot = 0, tilt = 0, roll = 0) {
    const [x, yy, z] = this.world(u, y, v);
    _e.set(tilt, this.t + rot, roll, 'YXZ');
    return _m.compose(_p.set(x, yy, z), _q.setFromEuler(_e), _s.set(1, 1, 1));
  }
  box(b, lu, h, lv, u, y, v, rot = 0) { b.add(new THREE.BoxGeometry(lu, h, lv), this.mat(u, y, v, rot)); }
  // cylinder with its axis along 'y', 'u' or 'v'
  cyl(b, r, len, u, y, v, axis = 'y', seg = 14, r2 = r) {
    const g = new THREE.CylinderGeometry(r2, r, len, seg);
    if (axis === 'u') g.rotateZ(Math.PI / 2);
    else if (axis === 'v') g.rotateX(Math.PI / 2);
    b.add(g, this.mat(u, y, v));
  }
  geo(b, g, u, y, v, rot = 0) { b.add(g, this.mat(u, y, v, rot)); }
}
const thetaOf = (axis, front) => (axis === 'x' ? (front > 0 ? 0 : Math.PI) : (front > 0 ? Math.PI / 2 : -Math.PI / 2));
// vehicles: +u towards their front
const thetaFwd = (dir, f) => (dir === 'x' ? (f > 0 ? 0 : Math.PI) : (f > 0 ? -Math.PI / 2 : Math.PI / 2));

// Side-profile extrusion in the (u, y) plane, extruded across v (width) with rounded edges, centred.
function profileGeo(pts, width, bev = 0.04) {
  const sh = new THREE.Shape();
  pts.forEach((q, i) => {
    if (i === 0) sh.moveTo(q[0], q[1]);
    else if (q.length === 4) sh.quadraticCurveTo(q[0], q[1], q[2], q[3]);
    else sh.lineTo(q[0], q[1]);
  });
  const depth = Math.max(0.001, width - bev * 2);
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  return g;
}

export function buildProps(decor) {
  const map = decor.map;
  const furn = map.boxes.filter((b) => b.kind === 'furn');
  const pillars = map.boxes.filter((b) => b.kind === 'pillar');
  const vehicles = map.boxes.filter((b) => b.main);
  if (!furn.length && !pillars.length && !vehicles.length && !map.boxes.some((b) => b.kind === 'rail')) return;

  // baked shading like world.js: contact darkening near the floor, darker under roofs, indoor flag
  const roofedAt = (x, z, y) => {
    const c = Math.floor((x - map.x0) / map.cellSize), r = Math.floor((z - map.z0) / map.cellSize);
    if (r < 0 || c < 0 || r >= map.rows || c >= map.cols) return false;
    const U = map.upper;
    if (U && y >= U.floorY - 0.05) return U.roofed[r][c] && y < U.floorY + U.roofHeight;
    const ceiling = U && U.grid[r][c] !== ' ' ? U.floorY - 0.3 : U ? U.floorY + U.roofHeight : map.roofHeight;
    return map.roofed[r][c] && y < ceiling;
  };
  const floorOf = (y) => (map.upper && y >= map.upper.floorY - 0.05 ? map.upper.floorY : 0);
  const shade = (x, y, z, nx, ny, nz) => {
    let k = 1;
    const ly = Math.max(0, y - floorOf(y));
    if (Math.abs(ny) < 0.5) k *= 0.7 + 0.3 * Math.min(1, Math.pow(ly / 1.2, 0.7));
    const indoor = roofedAt(x + nx * 0.2, z + nz * 0.2, y + 0.01);
    if (indoor) k *= ny < -0.5 ? 0.55 : 0.68;
    if (ny < -0.5) k *= 0.75;
    return [k, indoor ? 0 : 1];
  };

  const B = {};
  const batch = (name) => (B[name] || (B[name] = new Batch()));
  const P = (params) => plainWorldMaterial(params);
  const mats = {
    wood: () => decor.tex.material('wood'),
    metalTex: () => decor.tex.material('metal'),
    trim: () => decor.tex.material(decor.cfg.trim || map.mats.building || 'concrete'),
    sandbag: () => decor.tex.material('sandbag'),
    steel: () => P({ color: 0x5c6167, metalness: 0.55, roughness: 0.45 }),
    darkSteel: () => P({ color: 0x2c2e31, metalness: 0.5, roughness: 0.55 }),
    rackBlue: () => P({ color: 0x2f5c8f, metalness: 0.3, roughness: 0.5 }),
    rackOrange: () => P({ color: 0xc8581c, metalness: 0.25, roughness: 0.5 }),
    card: () => P({ color: 0xa87d4f, roughness: 0.92 }),
    card2: () => P({ color: 0x8f6a42, roughness: 0.92 }),
    tape: () => P({ color: 0xc9a672, roughness: 0.5 }),
    laminate: () => P({ color: 0x9a958c, roughness: 0.42 }),
    stoneTop: () => P({ color: 0x3b3936, roughness: 0.28, metalness: 0.05 }),
    cabinet: () => P({ color: 0xd4cdbf, roughness: 0.55 }),
    locker: () => P({ color: 0x566860, metalness: 0.35, roughness: 0.48 }),
    hole: () => P({ color: 0x0e0f10, roughness: 0.9 }),
    chrome: () => P({ color: 0xaab0b6, metalness: 1, roughness: 0.25 }),
    paper: () => P({ color: 0xe8e6df, roughness: 0.8 }),
    plasticDark: () => P({ color: 0x1c1d1f, roughness: 0.5 }),
    screen: () => new THREE.MeshStandardMaterial({ color: 0x0b1420, emissive: 0x2a4a66, emissiveIntensity: 0.5, roughness: 0.15, metalness: 0.2 }),
    binder: () => P({ color: 0x2b4f86, roughness: 0.6 }),
    binderR: () => P({ color: 0x8a2a24, roughness: 0.6 }),
    wrap: () => P({ color: 0xaeb2ae, roughness: 0.22, metalness: 0.05 }),
    drumBlue: () => P({ color: 0x24508a, roughness: 0.45 }),
    rubber: () => P({ color: 0x151515, roughness: 0.92 }),
    glass: () => P({ color: 0x141b21, metalness: 0.7, roughness: 0.06 }),
    lampW: () => new THREE.MeshStandardMaterial({ color: 0xf0ece0, emissive: 0x3a3428, roughness: 0.15, metalness: 0.2 }),
    lampR: () => new THREE.MeshStandardMaterial({ color: 0x8a1010, emissive: 0x3a0505, roughness: 0.2, metalness: 0.1 }),
    plate: () => P({ color: 0xe2dccb, roughness: 0.5 }),
    yellow: () => P({ color: 0xd4a01e, metalness: 0.3, roughness: 0.42 }),
    genWhite: () => P({ color: 0xd8d8d0, metalness: 0.3, roughness: 0.45 }),
    hvac: () => P({ color: 0xa9aca8, metalness: 0.45, roughness: 0.45 }),
    dumpGreen: () => P({ color: 0x2f5a3c, metalness: 0.4, roughness: 0.55 }),
    dumpBlue: () => P({ color: 0x2a4c75, metalness: 0.4, roughness: 0.55 }),
    ballast: () => P({ color: 0x5b5752, roughness: 0.95 }),
    sleeper: () => P({ color: 0x4a3a2a, roughness: 0.9 }),
    rail: () => P({ color: 0x6f6a64, metalness: 0.8, roughness: 0.4 }),
    book0: () => P({ color: 0x7a2a22, roughness: 0.7 }),
    book1: () => P({ color: 0x24406a, roughness: 0.7 }),
    book2: () => P({ color: 0x2f5a36, roughness: 0.7 }),
    book3: () => P({ color: 0xb8a67a, roughness: 0.75 }),
    book4: () => P({ color: 0x3a3430, roughness: 0.7 }),
    clay: () => P({ color: 0xa8653e, roughness: 0.85 }),
    clay2: () => P({ color: 0xc9a27a, roughness: 0.85 }),
  };
  // per-colour vehicle paint
  const paints = new Map();
  const paint = (hex, rough = 0.3) => {
    const key = `paint${hex}_${rough}`;
    if (!paints.has(key)) paints.set(key, P({ color: hex, metalness: 0.45, roughness: rough }));
    return key;
  };
  const extraMats = {};

  // ---------------------------------------------------------------- furniture
  const style = decor.cfg.furniture || 'industrial';
  for (const b of furn) {
    const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2], h = b.max[1] - b.min[1];
    const alongX = b.axis === 'x';
    const L = alongX ? w : d, D = alongX ? d : w;
    const front = b.side ? -b.side : 1;
    const fr = new Frame((b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2, thetaOf(b.axis, front));
    const R = rng(b.seed ?? hash2(b.id, 7));
    if (b.furn === 'table') buildTable(fr, L, D, h, R, batch, style);
    else if (b.furn === 'shelf') {
      if (style === 'office') buildBookshelf(fr, L, D, h, R, batch);
      else if (style === 'rustic') buildRusticShelf(fr, L, D, h, R, batch);
      else buildShelf(fr, L, D, h, R, batch, !b.side);
    }
    else if (b.furn === 'counter') buildCounter(fr, L, D, h, R, batch);
    else if (b.furn === 'locker') buildLocker(fr, L, D, h, R, batch);
    else if (b.furn === 'pallets') buildPallets(fr, L, D, h, R, batch);
  }
  // walkway railings: posts and a round top rail over the steel balustrade
  for (const b of map.boxes) {
    if (b.kind !== 'rail') continue;
    const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
    const alongX = w >= d, L = alongX ? w : d;
    const fr = new Frame((b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2, alongX ? 0 : Math.PI / 2);
    fr.cyl(batch('rackOrange'), 0.03, L, 0, 1.07, 0, 'u', 10);
    for (let i = 0; i <= Math.round(L / 1.0); i++) fr.box(batch('darkSteel'), 0.05, 1.05, 0.09, -L / 2 + (i * L) / Math.round(L / 1.0), 0.525, 0);
    fr.box(batch('darkSteel'), L, 0.12, 0.09, 0, 0.06, 0);
  }
  // pillar plinths and capitals
  for (const b of pillars) {
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const fr = new Frame(cx, b.min[1], cz, 0);
    const H = b.max[1] - b.min[1];
    fr.box(batch('trim'), 0.74, 0.16, 0.74, 0, 0.08, 0);
    fr.box(batch('trim'), 0.7, 0.06, 0.7, 0, 0.19, 0);
    fr.box(batch('trim'), 0.76, 0.14, 0.76, 0, H - 0.07, 0);
    fr.box(batch('trim'), 0.68, 0.05, 0.68, 0, H - 0.165, 0);
  }

  // ---------------------------------------------------------------- vehicles and big props
  const CAR_COLORS = [0xd9d6cf, 0x9ea3a8, 0x23324a, 0x5a1d1d, 0x1d1f22, 0xb8a888, 0x3b4a3a, 0x7d2a18];
  for (const b of vehicles) {
    const fr = new Frame(b.cx, b.y, b.cz, thetaFwd(b.dir, b.f));
    const R = rng(hash2(b.pid * 7 + 1, 13));
    if (b.kind === 'car') {
      const wreck = b.variant === 'wreck';
      const col = b.color ?? (wreck ? 0x6b4a36 : CAR_COLORS[Math.floor(R() * CAR_COLORS.length)]);
      buildCar(fr, b.l, b.w, paint(col, wreck ? 0.85 : 0.28), batch, wreck);
    } else if (b.kind === 'van') buildVan(fr, b.l, b.w, paint(b.color ?? 0xdedcd4, 0.32), batch);
    else if (b.kind === 'dumpster') buildDumpster(fr, b.l, b.w, R() < 0.5 ? 'dumpGreen' : 'dumpBlue', batch);
    else if (b.kind === 'generator') buildGenerator(fr, b.l, b.w, R() < 0.6 ? 'yellow' : 'genWhite', batch);
    else if (b.kind === 'forklift') buildForklift(fr, b.l, b.w, batch);
    else if (b.kind === 'hvac') buildHvac(fr, b.l, b.w, batch);
    else if (b.kind === 'boxcar') {
      const key = 'box_' + b.id;
      extraMats[key] = () => decor.tex.material(map.boxes.find((x) => x.id === b.id)?.mat || 'containerRed');
      buildBoxcar(fr, b.l, b.w, key, batch, b.track ?? 0);
    }
  }

  // ---------------------------------------------------------------- meshes
  const WORLD_UV = { wood: 1.6, metalTex: 2, trim: 3, sandbag: 1.2 };
  const CAST = new Set(['wood', 'steel', 'darkSteel', 'rackBlue', 'rackOrange', 'card', 'card2', 'cabinet', 'locker', 'laminate', 'stoneTop', 'wrap', 'drumBlue', 'rubber', 'yellow', 'genWhite', 'hvac', 'dumpGreen', 'dumpBlue', 'metalTex', 'sandbag', 'trim']);
  for (const [name, bt] of Object.entries(B)) {
    let mat;
    if (mats[name]) mat = mats[name]();
    else if (paints.has(name)) mat = paints.get(name);
    else if (extraMats[name]) mat = extraMats[name]();
    else continue;
    const uvScale = WORLD_UV[name] ?? (name.startsWith('box_') ? 6 : 0.5);
    const geo = bt.build(shade, uvScale);
    decor.mesh(geo, mat, { cast: CAST.has(name) || name.startsWith('paint') || name.startsWith('box_') });
  }
}

// ------------------------------------------------------------------ furniture pieces

function buildTable(fr, L, D, H, R, batch, style) {
  const office = style === 'office' ? R() < 0.8 : style === 'rustic' ? false : R() < 0.55;
  const top = office ? 'laminate' : 'wood';
  const legM = office ? 'darkSteel' : 'wood';
  fr.box(batch(top), L, 0.04, D, 0, H - 0.02, 0);
  // apron / frame under the top
  fr.box(batch(legM), L - 0.1, 0.07, 0.025, 0, H - 0.075, D / 2 - 0.05);
  fr.box(batch(legM), L - 0.1, 0.07, 0.025, 0, H - 0.075, -D / 2 + 0.05);
  const legs = Math.max(2, Math.round(L / 1.8) + 1);
  for (let i = 0; i < legs; i++) {
    const u = -L / 2 + 0.06 + (i * (L - 0.12)) / (legs - 1);
    for (const sv of [-1, 1]) fr.box(batch(legM), 0.05, H - 0.04, 0.05, u, (H - 0.04) / 2, sv * (D / 2 - 0.06));
    fr.box(batch(legM), 0.03, 0.06, D - 0.14, u, H - 0.075, 0);
  }
  if (office) fr.box(batch('darkSteel'), L - 0.16, 0.36, 0.015, 0, H - 0.3, -D / 2 + 0.09); // modesty panel
  // clutter per 1.6 m of table
  const n = Math.max(1, Math.round(L / 1.6));
  for (let i = 0; i < n; i++) {
    const cu = -L / 2 + (i + 0.5) * (L / n);
    const k = R();
    const y = H;
    if (style === 'rustic') {
      // clay jars, a bowl, papers
      for (let j = 0; j < 2; j++) {
        const r = 0.07 + R() * 0.06, h = 0.16 + R() * 0.16;
        fr.geo(batch(R() < 0.5 ? 'clay' : 'clay2'), new THREE.LatheGeometry([[0.001, 0], [r * 0.7, 0], [r, h * 0.4], [r * 0.8, h * 0.8], [r * 0.45, h * 0.9], [r * 0.5, h]].map(([a, b2]) => new THREE.Vector2(a, b2)), 12), cu - 0.25 + j * 0.45, y, (R() - 0.5) * D * 0.4);
      }
      fr.geo(batch('clay'), new THREE.CylinderGeometry(0.14, 0.08, 0.07, 14), cu + 0.1, y + 0.035, D * 0.2);
      continue;
    }
    if (k < 0.35) {
      // monitor, keyboard, mug
      fr.box(batch('plasticDark'), 0.2, 0.012, 0.16, cu, y + 0.006, -D * 0.22);
      fr.box(batch('plasticDark'), 0.04, 0.2, 0.03, cu, y + 0.1, -D * 0.22 - 0.02);
      fr.box(batch('plasticDark'), 0.56, 0.34, 0.035, cu, y + 0.33, -D * 0.22);
      fr.box(batch('screen'), 0.52, 0.3, 0.004, cu, y + 0.33, -D * 0.22 + 0.019);
      fr.box(batch('plasticDark'), 0.44, 0.02, 0.14, cu, y + 0.01, D * 0.1);
      fr.cyl(batch('paper'), 0.04, 0.1, cu + 0.36, y + 0.05, D * 0.12, 'y', 12);
    } else if (k < 0.6) {
      // laptop and papers
      fr.box(batch('plasticDark'), 0.34, 0.02, 0.24, cu, y + 0.01, 0.02);
      fr.geo(batch('plasticDark'), new THREE.BoxGeometry(0.34, 0.24, 0.012).translate(0, 0.12, 0).rotateX(-0.3), cu, y + 0.02, -0.1);
      for (let j = 0; j < 3; j++) fr.box(batch('paper'), 0.21, 0.004, 0.297, cu + 0.32 + j * 0.01, y + 0.002 + j * 0.004, 0.05, R() * 0.4 - 0.2);
    } else if (k < 0.8) {
      // binders and a stack of papers
      for (let j = 0; j < 3; j++) fr.box(batch(j % 2 ? 'binderR' : 'binder'), 0.06, 0.3, 0.26, cu - 0.2 + j * 0.065, y + 0.15, -D * 0.25);
      fr.box(batch('paper'), 0.22, 0.05, 0.3, cu + 0.2, y + 0.025, 0.05, 0.2);
    } else {
      // a box of stuff
      fr.box(batch('card'), 0.5, 0.3, 0.36, cu, y + 0.15, 0, R() * 0.5 - 0.25);
    }
  }
}

function buildShelf(fr, L, D, H, R, batch, double) {
  const pallet = L > 3 && R() < 0.5; // heavy pallet racking (orange beams) or light shelving
  const up = pallet ? 'rackBlue' : 'steel', beam = pallet ? 'rackOrange' : 'steel';
  const bays = Math.max(1, Math.round(L / (pallet ? 2.0 : 1.2)));
  for (let i = 0; i <= bays; i++) {
    const u = -L / 2 + 0.03 + (i * (L - 0.06)) / bays;
    for (const sv of [-1, 1]) fr.box(batch(up), 0.05, H, 0.05, u, H / 2, sv * (D / 2 - 0.03));
    // side bracing
    for (let k = 0; k < 3; k++) fr.geo(batch(up), new THREE.BoxGeometry(0.02, 0.02, D - 0.06).rotateX(0.55 * (k % 2 ? 1 : -1)), u, 0.35 + k * 0.62, 0);
  }
  const levels = pallet ? [0.12, 1.1, 2.08] : [0.1, 0.62, 1.14, 1.66, 2.12];
  for (const y of levels) {
    if (y > H) continue;
    for (const sv of [-1, 1]) fr.box(batch(beam), L, pallet ? 0.1 : 0.045, 0.04, 0, y, sv * (D / 2 - 0.03));
    fr.box(batch(pallet ? 'wood' : 'steel'), L - 0.04, 0.025, D - 0.06, 0, y + 0.03, 0);
  }
  // goods: cardboard boxes, plastic bins, drums, sacks
  for (let li = 0; li < levels.length - (pallet ? 0 : 1); li++) {
    const y = levels[li] + 0.045;
    const room = (levels[li + 1] ?? H + 0.4) - levels[li] - 0.12;
    let u = -L / 2 + 0.08;
    while (u < L / 2 - 0.3) {
      const k = R();
      if (k < 0.12) { u += 0.3 + R() * 0.4; continue; } // gap
      const bw = pallet ? 0.9 + R() * 0.8 : 0.28 + R() * 0.34;
      if (u + bw > L / 2 - 0.06) break;
      const bh = Math.min(room, pallet ? 0.5 + R() * 0.4 : 0.18 + R() * 0.26);
      const bd = D * (0.7 + R() * 0.22);
      const cu = u + bw / 2;
      if (k < 0.75 || pallet) {
        const m = R() < 0.6 ? 'card' : 'card2';
        fr.box(batch(m), bw, bh, bd, cu, y + bh / 2, 0, (R() - 0.5) * 0.08);
        fr.box(batch('tape'), 0.05, 0.004, bd + 0.002, cu, y + bh + 0.002, 0);
        if (double) fr.box(batch('tape'), 0.05, 0.004, bd + 0.002, cu, y + bh + 0.002, 0);
      } else if (k < 0.88) {
        for (let j = 0; j < Math.floor(bw / 0.24); j++) fr.cyl(batch('drumBlue'), 0.1, Math.min(room, 0.28), cu - bw / 2 + 0.12 + j * 0.24, y + Math.min(room, 0.28) / 2, 0, 'y', 12);
      } else {
        fr.box(batch('sandbag'), bw, Math.min(room, 0.16), bd, cu, y + 0.08, 0);
      }
      u += bw + 0.03 + R() * 0.06;
    }
  }
}

// wooden bookcase full of books, a few lying flat, the odd box file
function buildBookshelf(fr, L, D, H, R, batch) {
  const n = Math.max(1, Math.round(L / 0.9));
  fr.box(batch('wood'), L, H, 0.03, 0, H / 2, -D / 2 + 0.015);
  for (let i = 0; i <= n; i++) fr.box(batch('wood'), 0.03, H, D, -L / 2 + 0.015 + (i * (L - 0.03)) / n, H / 2, 0);
  const levels = [0.06, 0.44, 0.82, 1.2, 1.58, H - 0.03];
  for (const y of levels) fr.box(batch('wood'), L, 0.03, D, 0, y, 0);
  fr.box(batch('wood'), L + 0.04, 0.05, D + 0.03, 0, H + 0.02, 0.01);
  for (let li = 0; li < levels.length - 1; li++) {
    const y = levels[li] + 0.015;
    let u = -L / 2 + 0.04;
    while (u < L / 2 - 0.08) {
      if (R() < 0.08) { u += 0.1 + R() * 0.25; continue; }
      const t = 0.025 + R() * 0.035, h = 0.2 + R() * 0.12, d = D * (0.6 + R() * 0.3);
      if (u + t > L / 2 - 0.04) break;
      const m = 'book' + Math.floor(R() * 5);
      if (R() < 0.07) { fr.box(batch(m), 0.24, 0.04, d, u + 0.12, y + 0.02, -D / 2 + d / 2 + 0.03); u += 0.26; continue; }
      fr.geo(batch(m), new THREE.BoxGeometry(t, h, d).translate(0, h / 2, 0).rotateZ(R() < 0.06 ? 0.25 : 0), u + t / 2, y, -D / 2 + d / 2 + 0.03);
      u += t + 0.002;
    }
  }
}

// rough wooden shelves with clay pots, jars and sacks
function buildRusticShelf(fr, L, D, H, R, batch) {
  const n = Math.max(1, Math.round(L / 1.2));
  for (let i = 0; i <= n; i++) for (const sv of [-1, 1]) fr.box(batch('wood'), 0.07, H, 0.07, -L / 2 + 0.035 + (i * (L - 0.07)) / n, H / 2, sv * (D / 2 - 0.035));
  const levels = [0.25, 0.9, 1.55, H - 0.04];
  for (const y of levels) fr.box(batch('wood'), L, 0.04, D, 0, y, 0);
  for (let li = 0; li < levels.length - 1; li++) {
    const y = levels[li] + 0.02;
    let u = -L / 2 + 0.12;
    while (u < L / 2 - 0.2) {
      const k = R();
      if (k < 0.15) { u += 0.25; continue; }
      if (k < 0.7) {
        const r = 0.08 + R() * 0.1, h = 0.18 + R() * 0.3;
        fr.geo(batch(R() < 0.5 ? 'clay' : 'clay2'), new THREE.LatheGeometry([[0.001, 0], [r * 0.7, 0], [r, h * 0.4], [r * 0.8, h * 0.8], [r * 0.45, h * 0.9], [r * 0.5, h]].map(([a, b]) => new THREE.Vector2(a, b)), 12), u + r, y, (R() - 0.5) * (D - 2 * r) * 0.6);
        u += 2 * r + 0.05;
      } else {
        const w = 0.35 + R() * 0.2;
        fr.box(batch('sandbag'), w, 0.2 + R() * 0.12, D * 0.8, u + w / 2, y + 0.12, 0, (R() - 0.5) * 0.3);
        u += w + 0.05;
      }
    }
  }
}

function buildCounter(fr, L, D, H, R, batch) {
  const bar = R() < 0.4;
  const body = bar ? 'wood' : 'cabinet';
  fr.box(batch(body), L, H - 0.14, D - 0.06, 0, 0.1 + (H - 0.14) / 2, -0.03);
  fr.box(batch('darkSteel'), L - 0.02, 0.1, D - 0.14, 0, 0.05, -0.07);
  fr.box(batch(bar ? 'wood' : 'stoneTop'), L + 0.02, 0.04, D + 0.02, 0, H - 0.02, 0.01);
  // door and drawer fronts
  const doors = Math.max(1, Math.round(L / 0.6));
  for (let i = 0; i <= doors; i++) fr.box(batch('hole'), 0.008, H - 0.2, 0.006, -L / 2 + (i * L) / doors, 0.1 + (H - 0.2) / 2, D / 2 - 0.058);
  for (let i = 0; i < doors; i++) {
    const u = -L / 2 + ((i + 0.5) * L) / doors;
    fr.box(batch('hole'), L / doors - 0.04, 0.006, 0.006, u, H - 0.2, D / 2 - 0.058);
    fr.box(batch('chrome'), 0.12, 0.014, 0.02, u, H - 0.14, D / 2 - 0.045);
    fr.box(batch('chrome'), 0.014, 0.1, 0.02, u + (i % 2 ? -1 : 1) * (L / doors / 2 - 0.06), H - 0.35, D / 2 - 0.045);
  }
  // something on top
  const k = R();
  if (k < 0.4) { fr.box(batch('plasticDark'), 0.3, 0.36, 0.3, -L / 2 + 0.4, H + 0.18, -0.08); fr.box(batch('chrome'), 0.12, 0.05, 0.1, -L / 2 + 0.4, H + 0.1, 0.1); }
  else if (k < 0.7) { fr.box(batch('plasticDark'), 0.5, 0.3, 0.36, L / 2 - 0.45, H + 0.15, -0.05); fr.box(batch('glass'), 0.3, 0.2, 0.004, L / 2 - 0.5, H + 0.15, 0.132); }
  else fr.box(batch('paper'), 0.22, 0.03, 0.3, 0, H + 0.015, 0, 0.3);
}

function buildLocker(fr, L, D, H, R, batch) {
  fr.box(batch('darkSteel'), L, 0.08, D - 0.06, 0, 0.04, -0.03);
  fr.box(batch('locker'), L, H - 0.08, D, 0, 0.08 + (H - 0.08) / 2, 0);
  fr.box(batch('locker'), L + 0.02, 0.03, D + 0.02, 0, H - 0.015, 0);
  const n = Math.max(1, Math.round(L / 0.4));
  const dw = L / n;
  for (let i = 0; i <= n; i++) fr.box(batch('hole'), 0.008, H - 0.12, 0.006, -L / 2 + i * dw, 0.08 + (H - 0.12) / 2, D / 2 + 0.001);
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + (i + 0.5) * dw;
    for (let k = 0; k < 3; k++) {
      fr.box(batch('hole'), dw * 0.55, 0.012, 0.006, u, H - 0.2 - k * 0.035, D / 2 + 0.001);
      fr.box(batch('hole'), dw * 0.55, 0.012, 0.006, u, 0.25 + k * 0.035, D / 2 + 0.001);
    }
    fr.box(batch('chrome'), 0.022, 0.12, 0.025, u + dw / 2 - 0.06, H * 0.55, D / 2 + 0.012);
    fr.box(batch('plate'), 0.06, 0.035, 0.004, u, H - 0.34, D / 2 + 0.003);
    if (R() < 0.12) fr.geo(batch('locker'), new THREE.BoxGeometry(dw - 0.02, H - 0.2, 0.02).translate(dw / 2 - 0.01, 0, 0), u - dw / 2, 0.08 + (H - 0.12) / 2, D / 2 + 0.01, 0.9);
  }
}

function buildPallets(fr, L, D, H, R, batch) {
  // pallet: stringers, top deck boards, bottom boards
  for (const sv of [-1, 0, 1]) fr.box(batch('wood'), L, 0.1, 0.09, 0, 0.07, sv * (D / 2 - 0.045));
  for (let i = 0; i < 7; i++) fr.box(batch('wood'), 0.1, 0.022, D, -L / 2 + 0.05 + (i * (L - 0.1)) / 6, 0.131, 0);
  for (let i = 0; i < 3; i++) fr.box(batch('wood'), 0.12, 0.02, D, -L / 2 + 0.06 + (i * (L - 0.12)) / 2, 0.01, 0);
  const y0 = 0.142, lh = H - y0;
  const k = R();
  if (k < 0.55) {
    // cardboard boxes under stretch wrap
    const nu = 2, nv = 2, nh = Math.max(2, Math.round(lh / 0.38));
    const bh = lh / nh;
    for (let a = 0; a < nu; a++) for (let c = 0; c < nv; c++) for (let e = 0; e < nh; e++) {
      fr.box(batch(R() < 0.7 ? 'card' : 'card2'), L / nu - 0.02, bh - 0.01, D / nv - 0.02, -L / 2 + (a + 0.5) * (L / nu), y0 + (e + 0.5) * bh, -D / 2 + (c + 0.5) * (D / nv));
    }
    fr.box(batch('wrap'), L + 0.012, lh * 0.82, D + 0.012, 0, y0 + lh * 0.45, 0);
  } else if (k < 0.8) {
    // sacks in layers
    const layers = Math.max(3, Math.round(lh / 0.2));
    for (let e = 0; e < layers; e++) for (let j = 0; j < 2; j++) fr.box(batch('sandbag'), L - 0.06, lh / layers - 0.012, D / 2 - 0.03, 0, y0 + (e + 0.5) * (lh / layers), (j ? 1 : -1) * (D / 4), (e % 2 ? 0.04 : -0.04));
  } else {
    // plastic drums
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      fr.cyl(batch('drumBlue'), L / 4 - 0.02, Math.min(lh, 0.92), su * L / 4, y0 + Math.min(lh, 0.92) / 2, sv * D / 4, 'y', 16);
      fr.cyl(batch('plasticDark'), 0.04, 0.02, su * L / 4 + 0.08, y0 + Math.min(lh, 0.92) + 0.01, sv * D / 4, 'y', 8);
    }
  }
}

// ------------------------------------------------------------------ vehicles

function wheel(fr, batch, u, v, r = 0.32, w = 0.22, hub = 'chrome') {
  fr.cyl(batch('rubber'), r, w, u, r, v, 'v', 20);
  fr.cyl(batch(hub), r * 0.6, 0.02, u, r, v + Math.sign(v) * (w / 2 + 0.004), 'v', 16);
  fr.cyl(batch('darkSteel'), r * 0.2, 0.024, u, r, v + Math.sign(v) * (w / 2 + 0.008), 'v', 10);
}

function buildCar(fr, L, W, paintKey, batch, wreck) {
  const hl = L / 2;
  // side profile: bumpers, hood, belt line, trunk, and the two wheel arches along the bottom
  const pts = [
    [hl - 0.02, 0.34], [hl, 0.55], [hl - 0.04, 0.74], [hl - 0.25, 0.84], [0.9, 0.95], [-1.45, 0.96], [-hl + 0.3, 0.9],
    [-hl + 0.02, 0.78], [-hl, 0.52], [-hl + 0.03, 0.34],
    [-1.76, 0.34], [-1.78, 0.7, -1.36, 0.72], [-0.94, 0.7, -0.96, 0.34],
    [0.96, 0.34], [0.94, 0.7, 1.36, 0.72], [1.78, 0.7, 1.76, 0.34],
  ];
  fr.geo(batch(paintKey), profileGeo(pts, W, 0.07), 0, 0, 0);
  // greenhouse: tinted glass shell, painted roof and pillars
  const cabin = [[0.92, 0.93], [0.3, 1.38], [-0.85, 1.4], [-1.44, 0.95]];
  fr.geo(batch(wreck ? 'hole' : 'glass'), profileGeo(cabin, W - 0.3, 0.05), 0, 0, 0);
  fr.box(batch(paintKey), 1.12, 0.035, W - 0.34, -0.27, 1.405, 0);
  const pillar = (u0, y0, u1, y1, t) => {
    const len = Math.hypot(u1 - u0, y1 - y0), a = Math.atan2(y1 - y0, u1 - u0);
    for (const sv of [-1, 1]) fr.geo(batch(paintKey), new THREE.BoxGeometry(len, t, 0.05).rotateZ(a), (u0 + u1) / 2, (y0 + y1) / 2, sv * (W / 2 - 0.16));
  };
  pillar(0.92, 0.95, 0.3, 1.39, 0.07);
  pillar(-0.3, 0.95, -0.3, 1.39, 0.08);
  pillar(-0.86, 1.39, -1.44, 0.96, 0.16);
  // wheels, inner fenders, underbody
  for (const su of [-1, 1]) for (const sv of [-1, 1]) wheel(fr, batch, su * 1.36, sv * (W / 2 - 0.13), wreck ? 0.3 : 0.33, 0.21, wreck ? 'darkSteel' : 'chrome');
  for (const su of [-1, 1]) fr.box(batch('hole'), 0.8, 0.36, W - 0.46, su * 1.36, 0.53, 0);
  fr.box(batch('darkSteel'), L - 1.9, 0.14, W - 0.3, 0, 0.27, 0);
  // lights, grille, plates, mirrors, handles, door seams
  for (const sv of [-1, 1]) {
    fr.box(batch(wreck ? 'hole' : 'lampW'), 0.05, 0.1, 0.34, hl - 0.03, 0.72, sv * (W / 2 - 0.3));
    fr.box(batch(wreck ? 'hole' : 'lampR'), 0.05, 0.12, 0.3, -hl + 0.03, 0.78, sv * (W / 2 - 0.3));
    fr.box(batch(paintKey), 0.14, 0.09, 0.14, 0.78, 1.0, sv * (W / 2 + 0.03));
    for (const u of [0.15, -0.85]) fr.box(batch('chrome'), 0.14, 0.025, 0.03, u, 0.86, sv * (W / 2 + 0.005));
    for (const u of [0.88, -0.28, -1.28]) fr.box(batch('hole'), 0.008, 0.5, 0.012, u, 0.66, sv * (W / 2 + 0.002));
  }
  fr.box(batch('hole'), 0.04, 0.14, W * 0.42, hl - 0.02, 0.6, 0);
  fr.box(batch('plate'), 0.02, 0.11, 0.5, hl + 0.005, 0.44, 0);
  fr.box(batch('plate'), 0.02, 0.11, 0.5, -hl - 0.005, 0.56, 0);
}

function buildVan(fr, L, W, paintKey, batch) {
  const hl = L / 2;
  const pts = [
    [hl - 0.02, 0.36], [hl, 0.78], [hl - 0.1, 1.04], [hl - 0.75, 1.3], [hl - 1.3, 2.02], [-hl + 0.04, 2.06], [-hl, 1.95], [-hl, 0.36],
    [-1.7 - 0.42, 0.36], [-1.7 - 0.44, 0.75, -1.7, 0.77], [-1.7 + 0.44, 0.75, -1.7 + 0.42, 0.36],
    [1.7 - 0.42, 0.36], [1.7 - 0.44, 0.75, 1.7, 0.77], [1.7 + 0.44, 0.75, 1.7 + 0.42, 0.36],
  ];
  fr.geo(batch(paintKey), profileGeo(pts, W, 0.08), 0, 0, 0);
  // windshield and front side windows
  const a = Math.atan2(2.0 - 1.32, -(1.3 - 0.75));
  fr.geo(batch('glass'), new THREE.BoxGeometry(0.86, 0.012, W - 0.3).rotateZ(a + Math.PI), hl - 1.02, 1.67, 0);
  for (const sv of [-1, 1]) {
    fr.box(batch('glass'), 0.62, 0.46, 0.01, hl - 1.25, 1.62, sv * (W / 2 + 0.002));
    fr.box(batch('hole'), 0.008, 1.3, 0.012, hl - 1.6, 1.1, sv * (W / 2 + 0.003));
    fr.box(batch('hole'), 0.008, 1.3, 0.012, -0.4, 1.1, sv * (W / 2 + 0.003));
    fr.box(batch('lampW'), 0.05, 0.14, 0.3, hl - 0.02, 0.9, sv * (W / 2 - 0.3));
    fr.box(batch('lampR'), 0.05, 0.3, 0.12, -hl - 0.01, 1.2, sv * (W / 2 - 0.12));
    fr.box(batch(paintKey), 0.14, 0.2, 0.08, hl - 0.95, 1.3, sv * (W / 2 + 0.07));
  }
  fr.box(batch('hole'), 0.012, 1.55, 0.01, -hl - 0.004, 1.15, 0);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) wheel(fr, batch, su * 1.7, sv * (W / 2 - 0.14), 0.36, 0.22);
  for (const su of [-1, 1]) fr.box(batch('hole'), 0.84, 0.4, W - 0.5, su * 1.7, 0.56, 0);
  fr.box(batch('darkSteel'), L - 2.4, 0.16, W - 0.3, 0, 0.3, 0);
  fr.box(batch('hole'), 0.04, 0.2, W * 0.5, hl - 0.01, 0.65, 0);
  fr.box(batch('plate'), 0.02, 0.11, 0.5, -hl - 0.012, 0.6, 0);
}

function buildDumpster(fr, L, W, paintName, batch) {
  const body = new THREE.Shape();
  body.moveTo(-W / 2 + 0.08, 0.14); body.lineTo(W / 2 - 0.08, 0.14); body.lineTo(W / 2, 1.14); body.lineTo(-W / 2, 1.14);
  const g = new THREE.ExtrudeGeometry(body, { depth: L - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelOffset: -0.03, bevelSegments: 2 });
  g.translate(0, 0, -(L - 0.06) / 2);
  g.rotateY(Math.PI / 2);
  fr.geo(batch(paintName), g, 0, 0, 0);
  for (let i = 0; i < 4; i++) for (const sv of [-1, 1]) fr.geo(batch(paintName), new THREE.BoxGeometry(0.06, 1.0, 0.04).rotateX(sv * 0.08), -L / 2 + 0.3 + i * ((L - 0.6) / 3), 0.64, sv * (W / 2 - 0.02));
  for (const sv of [-1, 1]) fr.box(batch('darkSteel'), 0.5, 0.14, 0.12, 0, 0.8, sv * (W / 2 + 0.03));
  fr.box(batch(paintName), L + 0.02, 0.06, W + 0.04, 0, 1.15, 0);
  // two plastic lids, one propped open
  fr.geo(batch('plasticDark'), new THREE.BoxGeometry(L / 2 - 0.03, 0.05, W + 0.08).rotateX(0.06), -L / 4, 1.21, 0);
  fr.geo(batch('plasticDark'), new THREE.BoxGeometry(L / 2 - 0.03, 0.05, W + 0.08).translate(0, 0, (W + 0.08) / 2).rotateX(-0.45), L / 4, 1.2, -W / 2 - 0.04);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    fr.box(batch('darkSteel'), 0.06, 0.06, 0.06, su * (L / 2 - 0.15), 0.11, sv * (W / 2 - 0.15));
    fr.cyl(batch('rubber'), 0.055, 0.04, su * (L / 2 - 0.15), 0.055, sv * (W / 2 - 0.15), 'v', 12);
  }
}

function buildGenerator(fr, L, W, paintName, batch) {
  fr.box(batch('darkSteel'), L, 0.12, W, 0, 0.06, 0);
  fr.box(batch(paintName), L - 0.08, 1.2, W - 0.06, 0, 0.72, 0);
  fr.box(batch(paintName), L - 0.02, 0.05, W, 0, 1.345, 0);
  for (const sv of [-1, 1]) for (let i = 0; i < 9; i++) fr.box(batch('hole'), 0.5, 0.025, 0.012, -L / 2 + 0.45, 0.35 + i * 0.09, sv * (W / 2 - 0.025));
  for (const sv of [-1, 1]) for (let i = 0; i < 9; i++) fr.box(batch('hole'), 0.5, 0.025, 0.012, L / 2 - 0.45, 0.35 + i * 0.09, sv * (W / 2 - 0.025));
  fr.box(batch('darkSteel'), 0.5, 0.45, 0.012, 0.05, 0.8, W / 2 - 0.022);
  fr.box(batch('screen'), 0.14, 0.08, 0.006, 0.05, 0.9, W / 2 - 0.013);
  fr.cyl(batch('darkSteel'), 0.06, 0.35, -L / 2 + 0.35, 1.52, -0.1, 'y', 12);
  for (const su of [-1, 1]) fr.geo(batch('darkSteel'), new THREE.TorusGeometry(0.05, 0.012, 6, 12), su * (L / 2 - 0.25), 1.39, 0);
}

function buildForklift(fr, L, W, batch) {
  const hl = L / 2;
  fr.box(batch('yellow'), 1.6, 0.55, W - 0.1, -0.25, 0.48, 0);
  fr.box(batch('yellow'), 0.5, 0.9, W, -hl + 0.3, 0.65, 0);
  fr.geo(batch('yellow'), new THREE.CylinderGeometry(0.45, 0.45, W, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateY(Math.PI / 2).scale(0.5, 1, 1), -hl + 0.55, 1.1, 0);
  fr.box(batch('rubber'), 0.45, 0.12, 0.5, -0.35, 0.82, 0);
  fr.box(batch('rubber'), 0.1, 0.5, 0.5, -0.58, 1.1, 0);
  fr.cyl(batch('darkSteel'), 0.025, 0.6, 0.25, 1.05, 0, 'y', 8);
  fr.geo(batch('rubber'), new THREE.TorusGeometry(0.16, 0.018, 6, 16).rotateX(Math.PI / 2 - 0.5), 0.22, 1.35, 0);
  // overhead guard
  for (const su of [-1, 1]) for (const sv of [-1, 1]) fr.box(batch('darkSteel'), 0.06, 1.3, 0.06, su > 0 ? 0.45 : -0.75, 1.5, sv * (W / 2 - 0.08));
  for (let i = 0; i < 6; i++) fr.box(batch('darkSteel'), 1.26, 0.04, 0.04, -0.15, 2.16, -W / 2 + 0.08 + (i * (W - 0.16)) / 5);
  for (const su of [-1, 1]) fr.box(batch('darkSteel'), 0.06, 0.05, W - 0.1, su > 0 ? 0.45 : -0.75, 2.16, 0);
  // mast, carriage and forks
  for (const sv of [-1, 1]) fr.box(batch('darkSteel'), 0.1, 2.15, 0.1, 0.72, 1.12, sv * 0.36);
  fr.box(batch('darkSteel'), 0.08, 0.5, 0.9, 0.8, 0.35, 0);
  for (const sv of [-1, 1]) { fr.box(batch('darkSteel'), 0.05, 0.6, 0.1, 0.84, 0.35, sv * 0.28); fr.box(batch('darkSteel'), 1.05, 0.045, 0.1, 1.35, 0.06, sv * 0.28); }
  wheel(fr, batch, 0.45, W / 2 - 0.14, 0.3, 0.24, 'darkSteel');
  wheel(fr, batch, 0.45, -(W / 2 - 0.14), 0.3, 0.24, 'darkSteel');
  wheel(fr, batch, -0.8, W / 2 - 0.14, 0.25, 0.2, 'darkSteel');
  wheel(fr, batch, -0.8, -(W / 2 - 0.14), 0.25, 0.2, 'darkSteel');
}

function buildHvac(fr, L, W, batch) {
  fr.box(batch('darkSteel'), L, 0.1, W, 0, 0.05, 0);
  fr.box(batch('hvac'), L - 0.04, 1.05, W - 0.04, 0, 0.62, 0);
  fr.box(batch('hvac'), L, 0.04, W, 0, 1.16, 0);
  fr.cyl(batch('hole'), 0.42, 0.03, L * 0.12, 1.19, 0, 'y', 24);
  for (let i = 0; i < 7; i++) fr.box(batch('darkSteel'), 0.018, 0.02, 0.86, L * 0.12 - 0.36 + i * 0.12, 1.21, 0);
  fr.cyl(batch('darkSteel'), 0.07, 0.04, L * 0.12, 1.22, 0, 'y', 10);
  for (let i = 0; i < 10; i++) fr.box(batch('hole'), L - 0.2, 0.02, 0.01, 0, 0.3 + i * 0.075, W / 2 - 0.015);
  for (const su of [-0.3, -0.15]) fr.cyl(batch('chrome'), 0.025, 0.5, su * L, 0.25, -W / 2 - 0.06, 'y', 8);
}

function buildBoxcar(fr, L, W, bodyKey, batch, track) {
  const hl = L / 2;
  // body with corrugated sides, roof and a sliding door each side
  fr.box(batch(bodyKey), L, 2.85, W, 0, 1.05 + 1.425, 0);
  fr.box(batch('darkSteel'), L + 0.04, 0.1, W + 0.06, 0, 3.95, 0);
  fr.box(batch('darkSteel'), L + 0.04, 0.12, W + 0.04, 0, 1.08, 0);
  for (const sv of [-1, 1]) {
    fr.box(batch(bodyKey), 3.0, 2.6, 0.06, 0.4, 2.42, sv * (W / 2 + 0.03));
    fr.box(batch('darkSteel'), 3.9, 0.08, 0.1, 0.4, 3.78, sv * (W / 2 + 0.06));
    fr.box(batch('darkSteel'), 3.9, 0.08, 0.1, 0.4, 1.2, sv * (W / 2 + 0.06));
    for (const du of [-1.3, 2.1]) fr.box(batch('chrome'), 0.04, 1.6, 0.05, du, 2.4, sv * (W / 2 + 0.08));
    // corner ladders
    for (const su of [-1, 1]) for (let k = 0; k < 7; k++) fr.box(batch('darkSteel'), 0.4, 0.03, 0.03, su * (hl - 0.35), 1.5 + k * 0.33, sv * (W / 2 + 0.07));
  }
  // underframe, bogies with wheels, couplers
  fr.box(batch('darkSteel'), L - 1.0, 0.25, 0.5, 0, 0.9, 0);
  for (const su of [-1, 1]) {
    const bu = su * 4.6;
    for (const sv of [-1, 1]) fr.box(batch('darkSteel'), 2.5, 0.32, 0.14, bu, 0.55, sv * 0.86);
    fr.box(batch('darkSteel'), 0.4, 0.3, W - 0.6, bu, 0.8, 0);
    for (const wu of [-0.85, 0.85]) {
      fr.cyl(batch('darkSteel'), 0.08, W - 1.0, bu + wu, 0.42, 0, 'v', 10);
      for (const sv of [-1, 1]) fr.cyl(batch('rail'), 0.42, 0.1, bu + wu, 0.42, sv * 0.72, 'v', 22);
    }
    fr.box(batch('darkSteel'), 0.5, 0.25, 0.3, su * (hl + 0.2), 0.95, 0);
  }
  // track: ballast, sleepers, rails
  const tl = L + 4 + track * 2;
  fr.box(batch('ballast'), tl, 0.08, 3.3, 0, 0.04, 0);
  for (let u = -tl / 2 + 0.3; u < tl / 2; u += 0.65) fr.box(batch('sleeper'), 0.24, 0.12, 2.6, u, 0.1, 0);
  for (const sv of [-1, 1]) { fr.box(batch('rail'), tl, 0.16, 0.07, 0, 0.24, sv * 0.72); fr.box(batch('rail'), tl, 0.03, 0.14, 0, 0.17, sv * 0.72); }
}
