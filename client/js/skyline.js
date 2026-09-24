// Distant scenery beyond the playable area so there is depth above the walls: a band of buildings or
// trees close in and terrain silhouettes (dunes and mesas, hills) further out, sized to rise above the
// map walls and placed inside the fog range so they fade like real aerial perspective.
// No collision, no shadows; everything is merged into a handful of meshes.
//
// Styles: 'desert' (flat-roofed town, domes, minarets, dunes, mesas), 'industrial' (warehouses,
// smoke stacks, silos, cranes, water tower, hills), 'city' (towers with setbacks, far hills) and
// 'hills' (conifer forest, ruined towers, rolling hills).

import * as THREE from 'three';
import { hash2 } from '../shared/constants.js';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const PLAIN = 0.02; // uv of a plain wall texel in the facade texture

// Deterministic random stream.
function rng(seed) {
  let i = 0;
  return () => hash2(seed, i++ * 7919 + 13);
}

// Accumulates non-indexed triangles with colour and facade uvs.
class Merge {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; }

  // geo: THREE geometry in local space; facade = [cellW, floorH] gives box faces window uvs.
  add(geo, pos, rotY, scale, color, facade = null, baseY = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position, N = g.attributes.normal;
    tmpM.compose(pos, tmpQ.setFromAxisAngle(UP, rotY), scale);
    const nm = new THREE.Matrix3().getNormalMatrix(tmpM);
    let hx = 0, hz = 0;
    if (facade) {
      g.computeBoundingBox();
      hx = g.boundingBox.min.x; hz = g.boundingBox.min.z;
    }
    const c = color.isColor ? color : tmpC.set(color);
    for (let i = 0; i < P.count; i++) {
      const lx = P.getX(i), ly = P.getY(i), lz = P.getZ(i);
      tmpP.set(lx, ly, lz).applyMatrix4(tmpM);
      tmpN.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(nm).normalize();
      this.pos.push(tmpP.x, tmpP.y, tmpP.z);
      this.nor.push(tmpN.x, tmpN.y, tmpN.z);
      this.col.push(c.r, c.g, c.b);
      if (facade && Math.abs(N.getY(i)) < 0.5) {
        const along = Math.abs(N.getX(i)) > 0.5 ? (lz - hz) * scale.z : (lx - hx) * scale.x;
        this.uv.push(along / (facade[0] * 8), (tmpP.y - baseY) / (facade[1] * 8)); // 8x8 windows per repeat
      } else {
        this.uv.push(PLAIN, PLAIN);
      }
    }
    if (g !== geo) g.dispose();
  }

  box(w, h, d, x, y0, z, rotY, color, facade = null) {
    const g = new THREE.BoxGeometry(w, h, d);
    this.add(g, tmpP.set(x, y0 + h / 2, z).clone(), rotY, tmpS.set(1, 1, 1).clone(), color, facade, y0);
    g.dispose();
  }

  cyl(rTop, rBot, h, x, y0, z, color, seg = 10) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, rTop <= 0.001);
    this.add(g, tmpP.set(x, y0 + h / 2, z).clone(), 0, tmpS.set(1, 1, 1).clone(), color);
    g.dispose();
  }

  dome(r, x, y0, z, color, seg = 12) {
    const g = new THREE.SphereGeometry(r, seg, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    this.add(g, tmpP.set(x, y0, z).clone(), 0, tmpS.set(1, 1, 1).clone(), color);
    g.dispose();
  }

  // triangular prism roof along local X (gable / sawtooth pieces)
  prism(w, h, d, x, y0, z, rotY, color, slant = 0.5) {
    const s = new THREE.Shape();
    s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(-d / 2 + d * slant, h); s.lineTo(-d / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    g.rotateY(Math.PI / 2);
    this.add(g, tmpP.set(x, y0, z).clone(), rotY, tmpS.set(1, 1, 1).clone(), color);
    g.dispose();
  }

  get empty() { return this.pos.length === 0; }

  build() {
    if (this.empty) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.computeBoundingSphere();
    return geo;
  }
}

// 8x8 window cells per texture repeat so the pattern doesn't visibly tile.
function facadeTexture(style) {
  const S = 512, cells = 8, cw = S / cells;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  const r = rng(style.length * 131 + 7);
  // subtle wall grime per cell
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const v = 225 + Math.floor(r() * 30);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x * cw, y * cw, cw, cw);
    }
  }
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const k = r();
      const px = x * cw, py = (cells - 1 - y) * cw; // v grows upward
      if (style === 'desert') {
        if (k < 0.45) continue;
        const w = cw * 0.26, h = cw * 0.36;
        g.fillStyle = k > 0.9 ? '#6b4a2e' : '#1e1a17';
        g.fillRect(px + cw / 2 - w / 2, py + cw * 0.3, w, h);
        g.beginPath(); g.arc(px + cw / 2, py + cw * 0.3, w / 2, Math.PI, 0); g.fill();
      } else if (style === 'city') {
        const tone = k < 0.25 ? '#3d5670' : k < 0.5 ? '#2a3440' : k < 0.8 ? '#1b222b' : '#8a8f86';
        g.fillStyle = tone;
        g.fillRect(px + cw * 0.08, py + cw * 0.14, cw * 0.84, cw * 0.66);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(px + cw * 0.08, py + cw * 0.14, cw * 0.84, cw * 0.1);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(px + cw * 0.48, py + cw * 0.14, cw * 0.04, cw * 0.66);
      } else {
        // industrial: vertical cladding ribs and a high strip of windows every other floor
        g.fillStyle = 'rgba(0,0,0,0.12)';
        for (let i = 0; i < 8; i++) g.fillRect(px + i * cw / 8, py, 2, cw);
        if (y % 2 === 1 && k > 0.2) {
          g.fillStyle = k > 0.85 ? '#56616a' : '#20262b';
          g.fillRect(px + cw * 0.05, py + cw * 0.2, cw * 0.9, cw * 0.25);
        }
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Soft round puff for chimney smoke.
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 1D periodic value noise over the angle (period = n samples).
function angNoise(seed, n) {
  const vals = [];
  for (let i = 0; i < n; i++) vals.push(hash2(seed, i));
  return (a) => {
    const f = ((a / (Math.PI * 2)) % 1 + 1) % 1 * n;
    const i = Math.floor(f), t = f - i;
    const s = t * t * (3 - 2 * t);
    return vals[i % n] * (1 - s) + vals[(i + 1) % n] * s;
  };
}

export class Skyline {
  constructor(map, style) {
    this.map = map;
    this.style = style;
    this.group = new THREE.Group();
    this.smoke = null;
    const b = map.bounds;
    this.cx = (b.minX + b.maxX) / 2;
    this.cz = (b.minZ + b.maxZ) / 2;
    this.hw = (b.maxX - b.minX) / 2;
    this.hd = (b.maxZ - b.minZ) / 2;
    this.R0 = Math.hypot(this.hw, this.hd);
    this.fogFar = map.theme?.fogFar ?? 260;
    this.fogNear = map.theme?.fogNear ?? 60;
    this.buildings = new Merge();
    this.solid = new Merge();
    this.terrain = new Merge();
    this.stacks = [];
    const f = {
      desert: () => this.desert(),
      industrial: () => this.industrial(),
      city: () => this.city(),
      hills: () => this.hills(),
    }[style];
    if (f) f();
    this.finish();
  }

  // Lots on rectangles around the map, `rows` deep: returns [{x, z, rotY, depthIndex}].
  lots(offsets, spacing, seed, skip = 0.2) {
    const out = [];
    const r = rng(seed);
    offsets.forEach((off, di) => {
      const hw = this.hw + off, hd = this.hd + off;
      const sides = [
        [[-hw, -hd], [hw, -hd], 0], [[hw, -hd], [hw, hd], -Math.PI / 2],
        [[hw, hd], [-hw, hd], Math.PI], [[-hw, hd], [-hw, -hd], Math.PI / 2],
      ];
      for (const [a, b2, rot] of sides) {
        const len = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
        const n = Math.max(1, Math.floor(len / spacing));
        for (let i = 0; i < n; i++) {
          if (r() < skip) continue;
          const t = (i + 0.5 + (r() - 0.5) * 0.4) / n;
          out.push({ x: this.cx + a[0] + (b2[0] - a[0]) * t, z: this.cz + a[1] + (b2[1] - a[1]) * t, rotY: rot + (r() - 0.5) * 0.12, depth: di, r: r() });
        }
      }
    });
    return out;
  }

  // A ring of terrain between radii rIn..rOut around the map centre. heightAt(angle) gives the peak
  // height, profile the cross-section [[radialT, heightFrac], ...], colorAt(y, h, angle) the colour.
  ring(rIn, rOut, heightAt, profile, colorAt, seg = 220, o = {}) {
    const T = this.terrain;
    // refine the cross-section so slopes are smooth
    const prof = [];
    for (let k = 0; k < profile.length - 1; k++) {
      const [t0, f0] = profile[k], [t1, f1] = profile[k + 1];
      for (let j = 0; j < 3; j++) {
        const u = j / 3, s2 = u * u * (3 - 2 * u);
        prof.push([t0 + (t1 - t0) * u, f0 + (f1 - f0) * s2]);
      }
    }
    prof.push(profile[profile.length - 1]);
    const K = prof.length;
    const place = (a, rr) => {
      // a rounded rectangle (superellipse) around the map so the gap is similar on all sides
      const off = rr - this.R0, c = Math.cos(a), sn = Math.sin(a);
      return [this.cx + Math.sign(c) * Math.abs(c) ** (1 / 3) * (this.hw + off), this.cz + Math.sign(sn) * Math.abs(sn) ** (1 / 3) * (this.hd + off)];
    };
    const G = [];
    for (let si = 0; si <= seg; si++) {
      const a = (si / seg) * Math.PI * 2;
      const row = [];
      for (let k = 0; k < K; k++) {
        const [t, fr] = prof[k];
        // ridges wander a little from ring to ring
        const peak = heightAt(a + (t - 0.5) * 0.08);
        const rr = rIn + (rOut - rIn) * t;
        const [x, z] = place(a, rr);
        row.push({ x, y: peak * fr - 0.6, z, peak, a, t });
      }
      G.push(row);
    }
    // smooth normals from the grid (facing the map)
    const N = G.map((row, si) => row.map((v, k) => {
      const sA = G[(si - 1 + seg) % seg][k], sB = G[(si + 1) % seg][k];
      const kA = row[Math.max(0, k - 1)], kB = row[Math.min(K - 1, k + 1)];
      const ax = sB.x - sA.x, ay = sB.y - sA.y, az = sB.z - sA.z;
      const bx = kB.x - kA.x, by = kB.y - kA.y, bz = kB.z - kA.z;
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      return [nx / l, ny / l, nz / l];
    }));
    const patch = angNoise(o.seed ?? 7, 97), patch2 = angNoise((o.seed ?? 7) + 5, 31);
    const col = (v, n) => {
      const c = colorAt(v.y + 0.6, v.peak, v.a).clone();
      // vegetation patches and bare, lighter rock on steep slopes
      const pv = 0.78 + patch(v.a * 3 + v.t * 2.1) * 0.3 + patch2(v.a + v.t) * 0.12;
      c.multiplyScalar(pv);
      if (o.rock) c.lerp(o.rock, Math.max(0, Math.min(1, (0.8 - n[1]) * 2.2)) * 0.6);
      return c;
    };
    const emit = (v, n) => {
      T.pos.push(v.x, v.y, v.z);
      T.nor.push(n[0], n[1], n[2]);
      const c = col(v, n);
      T.col.push(c.r, c.g, c.b);
      T.uv.push(PLAIN, PLAIN);
    };
    for (let si = 0; si < seg; si++) {
      for (let k = 0; k < K - 1; k++) {
        const a = [G[si][k], N[si][k]], b = [G[si + 1][k], N[(si + 1) % seg][k]];
        const c = [G[si + 1][k + 1], N[(si + 1) % seg][k + 1]], d = [G[si][k + 1], N[si][k + 1]];
        for (const [p1, p2, p3] of [[a, b, c], [a, c, d]]) { emit(...p1); emit(...p2); emit(...p3); }
      }
    }
    // trees scattered on the slopes facing the map
    if (o.trees) {
      const r = rng((o.seed ?? 7) * 31 + 3);
      for (let i = 0; i < o.trees.count; i++) {
        const si = Math.floor(r() * seg), k = 1 + Math.floor(r() * (K * (o.trees.upTo ?? 0.55)));
        const v = G[si][Math.min(K - 1, k)], n = N[si][Math.min(K - 1, k)];
        if (n[1] < 0.55) continue;
        const h = o.trees.h[0] + r() * (o.trees.h[1] - o.trees.h[0]);
        const tc = new THREE.Color(o.trees.color).multiplyScalar(0.8 + r() * 0.35);
        this.solid.cyl(0.05, h * 0.28, h, v.x + (r() - 0.5) * 4, v.y + 0.3, v.z + (r() - 0.5) * 4, tc, 6);
      }
    }
  }

  // --------------------------------------------------------------- styles

  desert() {
    const F = this.fogFar;
    const facade = [3, 3.2];
    const palette = [0xd8c09a, 0xcfb58c, 0xe2cfaa, 0xc4a57a, 0xdcc6a0];
    for (const L of this.lots([18, 32, 48], 11, 11, 0.25)) {
      const r = rng(Math.floor(L.x * 13 + L.z * 7));
      const col = new THREE.Color(palette[Math.floor(r() * palette.length)]).multiplyScalar(0.9 + r() * 0.15);
      const w = 3 * (2 + Math.floor(r() * 3)), d = 6 + r() * 6;
      const h = 3.2 * (2 + Math.floor(r() * (L.depth + 2))) + 0.4;
      this.buildings.box(w, h, d, L.x, 0, L.z, L.rotY, col, facade);
      // parapet and rooftop box
      this.solid.box(w + 0.3, 0.5, d + 0.3, L.x, h, L.z, L.rotY, col.clone().multiplyScalar(0.92));
      if (r() < 0.35) this.solid.box(2, 2.2, 2, L.x + (r() - 0.5) * w * 0.5, h, L.z + (r() - 0.5) * d * 0.4, L.rotY, col.clone().multiplyScalar(0.85));
      if (r() < 0.12) this.solid.dome(Math.min(w, d) * 0.35, L.x, h + 0.4, L.z, new THREE.Color(r() < 0.5 ? 0x3e7f86 : 0xe8dcc0));
      if (r() < 0.25) this.solid.cyl(0.9, 0.9, 1.3, L.x - w * 0.25, h + 0.4, L.z, new THREE.Color(0x9aa0a3), 8); // water tank
    }
    // a mosque: big dome + two minarets on opposite sides
    const r = rng(77);
    for (let k = 0; k < 2; k++) {
      const a = r() * Math.PI * 2 + k * Math.PI;
      const d = this.R0 + 42;
      const x = this.cx + Math.cos(a) * d, z = this.cz + Math.sin(a) * d;
      const stone = new THREE.Color(0xe6d5b0);
      this.buildings.box(18, 9.6, 18, x, 0, z, a, stone, facade);
      this.solid.cyl(6.2, 6.8, 2, x, 9.6, z, stone, 16);
      this.solid.dome(6.2, x, 11.6, z, new THREE.Color(k ? 0x3f8a8f : 0xc9a24a), 20);
      this.solid.cyl(0.08, 0.15, 3, x, 17.6, z, new THREE.Color(0xc9a24a), 6);
      for (const s of [-1, 1]) {
        const mx = x + Math.cos(a + Math.PI / 2) * 12 * s, mz = z + Math.sin(a + Math.PI / 2) * 12 * s;
        this.solid.cyl(1.3, 1.6, 26, mx, 0, mz, stone, 10);
        this.solid.cyl(2.1, 1.8, 1.2, mx, 20, mz, stone.clone().multiplyScalar(0.9), 10);
        this.solid.cyl(1.1, 1.1, 4, mx, 26, mz, stone, 10);
        this.solid.cyl(0.01, 1.3, 3.5, mx, 30, mz, new THREE.Color(0x3f8a8f), 10);
      }
    }
    // dunes close to the town, mesas far out
    const dn = angNoise(5, 24), dn2 = angNoise(9, 61);
    const sand = new THREE.Color(0xd9bf8e), sandDark = new THREE.Color(0xb99a6c);
    this.ring(this.R0 + 70, this.R0 + 70 + F * 0.28, (a) => 5 + dn(a) * 9 + dn2(a) * 3,
      [[0, 0], [0.35, 0.7], [0.55, 1], [0.8, 0.65], [1, 0.4]],
      (y, h) => tmpC.copy(sandDark).lerp(sand, Math.min(1, y / Math.max(1, h))), 220, { seed: 3 });
    const mn = angNoise(21, 14), mn2 = angNoise(33, 47);
    const rock = new THREE.Color(0xb06f48), rockLight = new THREE.Color(0xd09a6c), rockDark = new THREE.Color(0x8a5238);
    this.ring(F * 0.55, F * 0.9, (a) => {
      const m = mn(a);
      const plateau = m > 0.5 ? 1 : m > 0.4 ? (m - 0.4) * 10 : 0;
      return 14 + plateau * (38 + mn2(a) * 26) + mn2(a) * 8;
    }, [[0, 0], [0.12, 0.25], [0.2, 0.96], [0.3, 1], [0.7, 1], [1, 0.8]],
    (y) => {
      const band = Math.sin(y * 0.55) * 0.5 + 0.5;
      return tmpC.copy(rockDark).lerp(y > 30 ? rockLight : rock, Math.min(1, y / 18)).lerp(rockLight, band * 0.18);
    }, 220, { seed: 5, trees: { count: 90, color: 0x6a6a3a, h: [2, 4], upTo: 0.25 } });
  }

  industrial() {
    const F = this.fogFar;
    const facade = [4, 4.5];
    const cladding = [0x8d9296, 0x7a7f7c, 0x9c8f7a, 0x6f7a82, 0xa3a39a];
    const r = rng(41);
    for (const L of this.lots([22, 45], 26, 5, 0.3)) {
      const col = new THREE.Color(cladding[Math.floor(r() * cladding.length)]);
      const w = 4 * (4 + Math.floor(r() * 4)), d = 14 + r() * 10, h = 4.5 * (2 + Math.floor(r() * 2)) + 0.3;
      this.buildings.box(w, h, d, L.x, 0, L.z, L.rotY, col, facade);
      // sawtooth roof
      const teeth = Math.floor(w / 5);
      for (let i = 0; i < teeth; i++) {
        const off = -w / 2 + (i + 0.5) * (w / teeth);
        const ox = Math.cos(L.rotY) * off, oz = -Math.sin(L.rotY) * off;
        this.solid.prism(d, 2.6, w / teeth, L.x + ox, h, L.z + oz, L.rotY + Math.PI / 2, col.clone().multiplyScalar(0.8), 0.05);
      }
      if (r() < 0.3) this.solid.cyl(0.6, 0.6, 6, L.x, h, L.z, new THREE.Color(0x777777), 8);
    }
    // smoke stacks with red/white bands
    const nStacks = 3;
    for (let k = 0; k < nStacks; k++) {
      const a = r() * Math.PI * 2;
      const d = this.R0 + 60 + r() * 30;
      const x = this.cx + Math.cos(a) * d, z = this.cz + Math.sin(a) * d;
      const h = 45 + r() * 20;
      const bands = 8;
      for (let i = 0; i < bands; i++) {
        const y0 = (h / bands) * i;
        const t0 = 1 - i / bands, t1 = 1 - (i + 1) / bands;
        this.solid.cyl(1.6 + t1 * 1.4, 1.6 + t0 * 1.4, h / bands, x, y0, z, new THREE.Color(i >= bands - 2 && i % 2 === 0 ? 0xb8412c : i >= bands - 2 ? 0xe8e4dc : 0x9a948a), 12);
      }
      this.stacks.push([x, h, z]);
      this.buildings.box(16, 12, 20, x + 10, 0, z, a, new THREE.Color(0x8a8a86), facade);
    }
    // silos
    for (let k = 0; k < 2; k++) {
      const a = r() * Math.PI * 2;
      const d = this.R0 + 40;
      const x0 = this.cx + Math.cos(a) * d, z0 = this.cz + Math.sin(a) * d;
      for (let i = 0; i < 4; i++) {
        const x = x0 + Math.cos(a + Math.PI / 2) * (i - 1.5) * 8.4, z = z0 + Math.sin(a + Math.PI / 2) * (i - 1.5) * 8.4;
        this.solid.cyl(4, 4, 22, x, 0, z, new THREE.Color(0xc9c7bf), 16);
        this.solid.cyl(0.6, 4, 3, x, 22, z, new THREE.Color(0xa9a7a0), 16);
      }
    }
    // tower crane
    {
      const a = r() * Math.PI * 2, d = this.R0 + 55;
      const x = this.cx + Math.cos(a) * d, z = this.cz + Math.sin(a) * d;
      const yel = new THREE.Color(0xd9a520);
      for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) this.solid.box(0.25, 48, 0.25, x + ox, 0, z + oz, 0, yel);
      for (let y = 3; y < 48; y += 3) this.solid.box(1.9, 0.18, 1.9, x, y, z, 0, yel);
      const jr = a + 1.1;
      this.solid.box(46, 1.2, 1.2, x + Math.cos(jr) * 12, 48, z - Math.sin(jr) * 12, jr, yel);
      this.solid.box(4, 3, 3, x - Math.cos(jr) * 10, 45.5, z + Math.sin(jr) * 10, jr, new THREE.Color(0x777770));
      this.solid.box(2.4, 2.2, 2.2, x, 45.4, z, jr, new THREE.Color(0xeeeeee));
      this.solid.cyl(0.05, 0.05, 18, x + Math.cos(jr) * 26, 30, z - Math.sin(jr) * 26, new THREE.Color(0x222222), 4);
    }
    // water tower
    {
      const a = r() * Math.PI * 2, d = this.R0 + 30;
      const x = this.cx + Math.cos(a) * d, z = this.cz + Math.sin(a) * d;
      const steel = new THREE.Color(0x8c969c);
      for (const [ox, oz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) this.solid.box(0.35, 20, 0.35, x + ox, 0, z + oz, 0, steel);
      this.solid.cyl(4.5, 4.5, 6, x, 20, z, new THREE.Color(0xa7b1b6), 16);
      this.solid.cyl(0.3, 4.8, 2, x, 26, z, steel, 16);
    }
    // power pylons in a line across one side
    {
      const a = r() * Math.PI * 2;
      for (let i = -3; i <= 3; i++) {
        const d = this.R0 + 70;
        const ang = a + i * 0.28;
        const x = this.cx + Math.cos(ang) * d, z = this.cz + Math.sin(ang) * d;
        const g = new THREE.Color(0x5f6568);
        this.solid.cyl(0.4, 2.2, 30, x, 0, z, g, 4);
        this.solid.box(12, 0.4, 0.4, x, 24, z, -ang, g);
        this.solid.box(9, 0.4, 0.4, x, 28, z, -ang, g);
      }
    }
    // low scrubby hills
    const hn = angNoise(71, 18), hn2 = angNoise(73, 53);
    const grass = new THREE.Color(0x5b6641), dirt = new THREE.Color(0x5a5446), grassLight = new THREE.Color(0x717d52);
    this.ring(F * 0.5, F * 0.92, (a) => 18 + hn(a) * 34 + hn2(a) * 10,
      [[0, 0], [0.3, 0.55], [0.6, 1], [1, 0.85]],
      (y, h) => tmpC.copy(dirt).lerp(grass, Math.min(1, y / 10)).lerp(grassLight, Math.max(0, (y - h * 0.6) / Math.max(1, h * 0.4)) * 0.5),
      220, { seed: 11, rock: new THREE.Color(0x7d786c), trees: { count: 320, color: 0x34422a, h: [6, 11] } });
  }

  city() {
    const F = this.fogFar;
    const facade = [3, 3.5];
    const shells = [0xcfc6b6, 0xb9b2a6, 0x9aa3ab, 0xd8d2c4, 0x8f8a84, 0xc2b49a, 0x7d8a94];
    const r = rng(97);
    for (const L of this.lots([24, 44, 66], 17, 3, 0.18)) {
      const col = new THREE.Color(shells[Math.floor(r() * shells.length)]);
      const w = 3 * (4 + Math.floor(r() * 4)), d = 12 + r() * 10;
      const tall = L.depth === 0 ? 0.5 : 1;
      const h = 3.5 * Math.round(5 + r() * r() * 18 * tall + L.depth * 3) + 0.5;
      this.buildings.box(w, h, d, L.x, 0, L.z, L.rotY, col, facade);
      this.solid.box(w + 0.4, 0.6, d + 0.4, L.x, h, L.z, L.rotY, col.clone().multiplyScalar(0.85));
      if (h > 40 && r() < 0.7) {
        const h2 = 3.5 * Math.round(3 + r() * 6);
        this.buildings.box(w * 0.66, h2, d * 0.66, L.x, h + 0.6, L.z, L.rotY, col.clone().multiplyScalar(0.95), facade);
        if (r() < 0.6) this.solid.cyl(0.12, 0.25, 8 + r() * 10, L.x, h + 0.6 + h2, L.z, new THREE.Color(0x9a9a9a), 5);
      } else {
        for (let i = 0; i < 2; i++) this.solid.box(2.5, 1.8, 2.5, L.x + (r() - 0.5) * w * 0.5, h + 0.6, L.z + (r() - 0.5) * d * 0.5, L.rotY, new THREE.Color(0x8b8e90));
      }
    }
    const hn = angNoise(81, 16), hn2 = angNoise(83, 41);
    const far = new THREE.Color(0x66755f), farLight = new THREE.Color(0x839077);
    this.ring(F * 0.62, F * 0.97, (a) => 22 + hn(a) * 45 + hn2(a) * 12,
      [[0, 0], [0.4, 0.6], [0.7, 1], [1, 0.9]],
      (y, h) => tmpC.copy(far).lerp(farLight, Math.min(1, y / Math.max(1, h))),
      220, { seed: 13, rock: new THREE.Color(0x857f74), trees: { count: 260, color: 0x3a4a30, h: [7, 12] } });
  }

  hills() {
    const F = this.fogFar;
    const r = rng(61);
    const needle = [0x2f4a2c, 0x35542f, 0x2a4128, 0x3d5a34];
    const bark = new THREE.Color(0x4a3a2a);
    // conifer forest in bands around the arena
    for (const L of this.lots([10, 17, 24, 32, 42], 5.5, 17, 0.15)) {
      const s = 0.8 + L.r * 0.7 + L.depth * 0.08;
      const x = L.x + (r() - 0.5) * 3, z = L.z + (r() - 0.5) * 3;
      const col = new THREE.Color(needle[Math.floor(r() * needle.length)]);
      this.solid.cyl(0.25 * s, 0.35 * s, 3 * s, x, 0, z, bark, 5);
      const tiers = 4;
      for (let k = 0; k < tiers; k++) {
        const y = (1.8 + k * 2.3) * s, rr = (3.2 - k * 0.65) * s;
        this.solid.cyl(0.05, rr, (4.2 - k * 0.4) * s, x + (r() - 0.5) * 0.3, y, z + (r() - 0.5) * 0.3, col.clone().multiplyScalar(0.9 + k * 0.1 + r() * 0.1), 9);
      }
    }
    // ruined watch towers
    for (let k = 0; k < 3; k++) {
      const a = r() * Math.PI * 2;
      const d = this.R0 + 55 + r() * 25;
      const x = this.cx + Math.cos(a) * d, z = this.cz + Math.sin(a) * d;
      const stone = new THREE.Color(0x8e857a);
      const h = 16 + r() * 10;
      this.solid.cyl(3.6, 4.2, h, x, 0, z, stone, 14);
      for (let i = 0; i < 8; i++) {
        if (r() < 0.3) continue;
        const aa = (i / 8) * Math.PI * 2;
        this.solid.box(1.4, 1.6, 0.9, x + Math.cos(aa) * 3.3, h, z + Math.sin(aa) * 3.3, -aa, stone);
      }
    }
    const hn = angNoise(91, 15), hn2 = angNoise(93, 43);
    const grass = new THREE.Color(0x4c6236), grassLight = new THREE.Color(0x6f7f45), rock = new THREE.Color(0x6b6258);
    this.ring(F * 0.5, F * 0.92, (a) => 18 + hn(a) * 42 + hn2(a) * 10,
      [[0, 0], [0.35, 0.6], [0.65, 1], [1, 0.8]],
      (y, h) => tmpC.copy(grass).lerp(grassLight, Math.min(1, y / 20)).lerp(rock, Math.max(0, (y - 35) / 25)),
      220, { seed: 17, rock: new THREE.Color(0x6b6258), trees: { count: 420, color: 0x2c4026, h: [7, 13], upTo: 0.7 } });
  }

  // --------------------------------------------------------------- meshes

  finish() {
    const add = (geo, mat) => {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = false;
      m.receiveShadow = false;
      m.matrixAutoUpdate = false;
      m.frustumCulled = false; // the ring surrounds the camera
      m.userData.noAO = true;
      this.group.add(m);
      return m;
    };
    const plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.6 });
    if (!this.buildings.empty) {
      const style = this.style === 'desert' ? 'desert' : this.style === 'city' ? 'city' : 'industrial';
      add(this.buildings.build(), new THREE.MeshStandardMaterial({ vertexColors: true, map: facadeTexture(style), roughness: 0.85, metalness: 0, envMapIntensity: 0.7 }));
    }
    add(this.solid.build(), plain);
    add(this.terrain.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.5 }));
    if (this.stacks.length) {
      const per = 14;
      const n = this.stacks.length * per;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      const mat = new THREE.PointsMaterial({ map: puffTexture(), size: 16, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false, color: 0xd9d6d0, fog: true });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.userData.noAO = true;
      this.group.add(pts);
      this.smoke = { pts, per };
    }
  }

  update(t) {
    if (!this.smoke) return;
    const { pts, per } = this.smoke;
    const P = pts.geometry.attributes.position;
    let i = 0;
    for (const [x, h, z] of this.stacks) {
      for (let k = 0; k < per; k++, i++) {
        const life = ((t * 0.06 + k / per + x * 0.01) % 1 + 1) % 1;
        const drift = life * 38;
        P.setXYZ(i, x + drift * 0.9 + Math.sin(t * 0.3 + k) * 1.5, h + 2 + life * 22, z + drift * 0.35);
      }
    }
    P.needsUpdate = true;
  }
}
