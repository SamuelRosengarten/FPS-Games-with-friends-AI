// Procedural PBR textures (albedo, normal, roughness/metalness) generated at load time.

import * as THREE from 'three';

// ------------------------------------------------------------------ tileable noise

function makeRand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Noise {
  constructor(seed) {
    const r = makeRand(seed);
    this.perm = new Uint8Array(512);
    this.vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) { this.perm[i] = i; this.vals[i] = r(); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [this.perm[i], this.perm[j]] = [this.perm[j], this.perm[i]]; }
    for (let i = 0; i < 256; i++) this.perm[i + 256] = this.perm[i];
  }
  // value noise with integer period for seamless tiling
  v(x, y, period) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const p = this.perm, vv = this.vals;
    const a = vv[p[p[x0] + y0]], b = vv[p[p[x1] + y0]], c = vv[p[p[x0] + y1]], d = vv[p[p[x1] + y1]];
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  }
  // fbm over unit square coordinates u,v in [0,1)
  fbm(u, v, base = 4, oct = 5, gain = 0.5) {
    let amp = 1, sum = 0, norm = 0, f = base;
    for (let o = 0; o < oct; o++) {
      sum += this.v(u * f, v * f, f) * amp;
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

// ------------------------------------------------------------------ texture canvas

class TexCanvas {
  constructor(size) {
    this.size = size;
    this.col = new Float32Array(size * size * 3);
    this.h = new Float32Array(size * size);
    this.r = new Float32Array(size * size).fill(0.8);
    this.m = new Float32Array(size * size);
    this.e = null;
  }
  each(fn) {
    const S = this.size;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        fn(x / S, y / S, i, x, y);
      }
    }
  }
  set(i, c, h, r, m = 0) {
    this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
    this.h[i] = h; this.r[i] = r; this.m[i] = m;
  }
}

function toTextures(tc, normalStrength, aniso) {
  const S = tc.size;
  const albedo = new Uint8Array(S * S * 4);
  const normal = new Uint8Array(S * S * 4);
  const rough = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    albedo[i * 4] = Math.round(clamp01(tc.col[i * 3]) * 255);
    albedo[i * 4 + 1] = Math.round(clamp01(tc.col[i * 3 + 1]) * 255);
    albedo[i * 4 + 2] = Math.round(clamp01(tc.col[i * 3 + 2]) * 255);
    albedo[i * 4 + 3] = 255;
    rough[i * 4] = 255;
    rough[i * 4 + 1] = Math.round(clamp01(tc.r[i]) * 255);
    rough[i * 4 + 2] = Math.round(clamp01(tc.m[i]) * 255);
    rough[i * 4 + 3] = 255;
  }
  const H = tc.h;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S, xp = (x + 1) % S, ym = (y - 1 + S) % S, yp = (y + 1) % S;
      const dx = (H[y * S + xp] - H[y * S + xm]) * normalStrength;
      const dy = (H[yp * S + x] - H[ym * S + x]) * normalStrength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * S + x) * 4;
      normal[i] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[i + 3] = 255;
    }
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  let emissive = null;
  if (tc.e) {
    const ed = new Uint8Array(S * S * 4);
    for (let i = 0; i < S * S; i++) {
      ed[i * 4] = Math.round(clamp01(tc.e[i * 3]) * 255);
      ed[i * 4 + 1] = Math.round(clamp01(tc.e[i * 3 + 1]) * 255);
      ed[i * 4 + 2] = Math.round(clamp01(tc.e[i * 3 + 2]) * 255);
      ed[i * 4 + 3] = 255;
    }
    emissive = mk(ed, true);
  }
  return { map: mk(albedo, true), normalMap: mk(normal, false), roughnessMap: mk(rough, false), emissiveMap: emissive };
}

// ------------------------------------------------------------------ pattern helpers

// Running-bond blocks. Returns { bx, by, fx, fy, edge, id } for a point in unit space.
function blocks(u, v, cols, rows, stagger = 0.5, jitter = null) {
  const row = Math.floor(v * rows);
  const off = (row % 2) * stagger;
  let x = u * cols + off;
  const col = Math.floor(x);
  const fx = x - col, fy = v * rows - row;
  const ex = Math.min(fx, 1 - fx) / cols * rows, ey = Math.min(fy, 1 - fy);
  return { col: ((col % cols) + cols) % cols, row, fx, fy, edge: Math.min(ex, ey), id: row * 131 + (((col % cols) + cols) % cols) * 17 };
}

function hashf(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ------------------------------------------------------------------ material recipes

const RECIPES = {
  sand(tc, n) {
    const base = hex(0xc9ad7c), dark = hex(0xa88a5c);
    tc.each((u, v, i) => {
      const big = n.fbm(u, v, 3, 4);
      const grain = n.v(u * 256, v * 256, 256);
      const ripple = Math.sin((u * 18 + n.fbm(u, v, 4, 3) * 5) * Math.PI * 2) * 0.5 + 0.5;
      const t = big * 0.7 + grain * 0.15;
      const c = [mix(dark[0], base[0], t) + grain * 0.04, mix(dark[1], base[1], t) + grain * 0.035, mix(dark[2], base[2], t) + grain * 0.03];
      const pebble = smooth(0.8, 0.9, n.v(u * 64, v * 64, 64)) * 0.35;
      tc.set(i, c.map((x) => x - pebble * 0.12), ripple * 0.25 + grain * 0.35 + big * 0.3 + pebble, 0.97 - pebble * 0.1);
    });
  },
  dirt(tc, n) {
    const base = hex(0x7a6048), dark = hex(0x4e3c2c);
    tc.each((u, v, i) => {
      const big = n.fbm(u, v, 4, 5);
      const grain = n.v(u * 200, v * 200, 200);
      const peb = smooth(0.74, 0.86, n.v(u * 48, v * 48, 48)) * 0.7;
      const t = clamp01(big * 1.2 - 0.1);
      const c = [mix(dark[0], base[0], t), mix(dark[1], base[1], t), mix(dark[2], base[2], t)];
      const pc = [0.46, 0.42, 0.37];
      tc.set(i, [mix(c[0], pc[0], peb) + grain * 0.05, mix(c[1], pc[1], peb) + grain * 0.04, mix(c[2], pc[2], peb) + grain * 0.03], big * 0.5 + peb * 0.6 + grain * 0.2, 0.95 - peb * 0.2);
    });
  },
  stoneBlocks(tc, n, opt) {
    const base = hex(opt.color), var2 = hex(opt.color2 ?? opt.color);
    tc.each((u, v, i) => {
      const b = blocks(u, v, opt.cols ?? 4, opt.rows ?? 8, 0.5);
      const bh = hashf(b.id);
      const noise = n.fbm(u, v, 8, 5);
      const fine = n.v(u * 180, v * 180, 180);
      const mortar = 1 - smooth(0.0, opt.mortar ?? 0.06, b.edge);
      const t = bh * 0.6 + noise * 0.4;
      let c = [mix(base[0], var2[0], t), mix(base[1], var2[1], t), mix(base[2], var2[2], t)];
      const shade = 0.88 + bh * 0.2 + (noise - 0.5) * 0.25 + fine * 0.06;
      c = c.map((x) => x * shade);
      const mc = c.map((x) => x * 0.62);
      const weather = smooth(0.55, 0.8, n.fbm(u + 0.3, v * 0.5, 4, 4)) * 0.18;
      c = c.map((x, k) => mix(x, mc[k], mortar) - weather * (k === 2 ? 0.02 : 0.08));
      const chip = smooth(0.8, 0.95, n.v(u * 24 + bh * 7, v * 24, 24)) * (1 - mortar) * 0.6;
      const h = (1 - mortar) * (0.7 + noise * 0.3) - chip * 0.3 + fine * 0.08;
      tc.set(i, c, h, 0.88 + fine * 0.08 - weather * 0.1);
    });
  },
  plaster(tc, n, opt) {
    const base = hex(opt.color);
    tc.each((u, v, i) => {
      const big = n.fbm(u, v, 3, 5);
      const fine = n.v(u * 220, v * 220, 220);
      const stain = smooth(0.58, 0.85, n.fbm(u * 0.7 + 0.2, v, 2, 4)) * (1 - v) * 0.9;
      const crack = smooth(0.012, 0.0, Math.abs(n.fbm(u, v, 6, 4) - 0.5)) * smooth(0.6, 0.7, n.fbm(u, v, 3, 3));
      const shade = 0.93 + (big - 0.5) * 0.14 + fine * 0.05 - stain * 0.18 - crack * 0.35;
      tc.set(i, base.map((x) => x * shade), big * 0.3 + fine * 0.3 - crack * 0.6, 0.9);
    });
  },
  tiles(tc, n, opt) {
    const base = hex(opt.color), alt = hex(opt.color2 ?? opt.color), grout = hex(opt.grout ?? 0x5a5550);
    const N = opt.count ?? 4;
    tc.each((u, v, i) => {
      const x = u * N, y = v * N;
      const cx = Math.floor(x), cy = Math.floor(y);
      const fx = x - cx, fy = y - cy;
      const e = Math.min(fx, 1 - fx, fy, 1 - fy);
      const g = 1 - smooth(0.015, 0.035, e);
      const id = cx * 7 + cy * 13;
      const hsh = hashf(id + (opt.seed || 0));
      const checker = opt.checker ? (cx + cy) % 2 : hsh > 0.5 ? 1 : 0;
      let c = checker ? alt : base;
      const dirt = n.fbm(u, v, 4, 5);
      const fine = n.v(u * 200, v * 200, 200);
      const shade = 0.85 + hsh * 0.18 + (dirt - 0.5) * 0.25;
      c = c.map((k) => k * shade);
      c = c.map((k, j) => mix(k, grout[j], g));
      const worn = smooth(0.6, 0.9, dirt) * 0.15;
      tc.set(i, c.map((k) => k - worn * 0.2 + fine * 0.03), (1 - g) * 0.8 + fine * 0.05 + (hsh - 0.5) * 0.05, mix(opt.rough ?? 0.55, 0.95, g) + worn);
    });
  },
  brick(tc, n) {
    tc.each((u, v, i) => {
      const b = blocks(u, v, 8, 24, 0.5);
      const bh = hashf(b.id);
      const noise = n.fbm(u, v, 8, 4);
      const fine = n.v(u * 256, v * 256, 256);
      const mortar = 1 - smooth(0.04, 0.12, b.edge);
      const reds = [[0.52, 0.29, 0.22], [0.58, 0.34, 0.26], [0.46, 0.26, 0.2], [0.62, 0.4, 0.31]];
      let c = reds[Math.floor(bh * 4)].map((x) => x * (0.85 + noise * 0.3 + fine * 0.08));
      const soot = smooth(0.6, 0.9, n.fbm(u, v * 0.5, 3, 4)) * 0.25;
      c = c.map((x) => x * (1 - soot));
      const mc = [0.62, 0.6, 0.55].map((x) => x * (0.8 + noise * 0.2));
      c = c.map((x, k) => mix(x, mc[k], mortar));
      tc.set(i, c, (1 - mortar) * (0.75 + fine * 0.25), 0.88 + fine * 0.1);
    });
  },
  concrete(tc, n, opt) {
    const base = hex(opt.color);
    tc.each((u, v, i) => {
      const big = n.fbm(u, v, 4, 6);
      const fine = n.v(u * 256, v * 256, 256);
      const pores = smooth(0.82, 0.86, n.v(u * 90, v * 90, 90));
      const seamX = 1 - smooth(0.0, 0.006, Math.abs(((u * 2) % 1) - 0.5) - 0.494);
      const seamY = 1 - smooth(0.0, 0.006, Math.abs(((v * 2) % 1) - 0.5) - 0.494);
      const seam = Math.max(seamX, seamY) * (opt.seams ? 1 : 0);
      const drip = smooth(0.55, 0.9, n.fbm(u * 3, v * 0.3, 4, 3)) * 0.15;
      const shade = 0.86 + (big - 0.5) * 0.3 + fine * 0.07 - pores * 0.25 - seam * 0.2 - drip;
      tc.set(i, base.map((x) => x * shade), big * 0.4 + fine * 0.3 - pores * 0.5 - seam * 0.4, 0.9 - big * 0.1);
    });
  },
  asphalt(tc, n) {
    tc.each((u, v, i) => {
      const big = n.fbm(u, v, 4, 5);
      const fine = n.v(u * 256, v * 256, 256);
      const agg = smooth(0.6, 0.9, n.v(u * 128 + 3.3, v * 128, 128));
      const crack = smooth(0.01, 0.0, Math.abs(n.fbm(u, v, 5, 4) - 0.5)) * smooth(0.55, 0.65, n.fbm(u + 0.5, v, 2, 3));
      const s = 0.2 + big * 0.07 + fine * 0.06 + agg * 0.08 - crack * 0.12;
      tc.set(i, [s, s * 0.98, s * 0.96], fine * 0.4 + agg * 0.4 - crack, 0.85 - agg * 0.2);
    });
  },
  planks(tc, n, opt) {
    const base = hex(opt.color), dark = hex(opt.dark ?? 0x4a3322);
    const count = opt.count ?? 8;
    tc.each((u, v, i) => {
      const a = opt.vertical ? u : v, b = opt.vertical ? v : u;
      const row = Math.floor(a * count);
      const fa = a * count - row;
      const off = hashf(row * 3.1) ;
      const seamAlong = ((b + off) % (1 / (opt.seg ?? 1))) * (opt.seg ?? 1);
      const e = Math.min(fa, 1 - fa);
      const gap = 1 - smooth(0.02, 0.06, e);
      const endGap = 1 - smooth(0.0, 0.008, Math.min(seamAlong, 1 - seamAlong));
      const grain = n.v(b * 6 + row * 13.7, a * count * 40, 256);
      const ring = Math.sin((b * 30 + n.fbm(u, v, 4, 3) * 6 + row * 2.1) * Math.PI) * 0.5 + 0.5;
      const t = hashf(row + 17) * 0.5 + ring * 0.3 + grain * 0.2;
      let c = [mix(dark[0], base[0], t), mix(dark[1], base[1], t), mix(dark[2], base[2], t)];
      const g = Math.max(gap, endGap);
      c = c.map((x) => x * (1 - g * 0.65));
      const knot = smooth(0.06, 0.0, Math.hypot(((b * 3 + row * 0.37) % 1) - 0.5, fa - 0.5) - 0.02) * (hashf(row * 9) > 0.6 ? 1 : 0);
      c = c.map((x) => x * (1 - knot * 0.45));
      tc.set(i, c, (1 - g) * 0.8 + grain * 0.1 + ring * 0.05, 0.78 + grain * 0.1);
    });
  },
  crate(tc, n, opt) {
    const base = hex(opt.color), dark = hex(opt.dark);
    tc.each((u, v, i) => {
      const frame = 0.13;
      const inFrame = u < frame || u > 1 - frame || v < frame || v > 1 - frame;
      // diagonal brace
      const diag = Math.abs(u - v) < frame * 0.55 && !inFrame;
      const plankRow = Math.floor(v * 6);
      const fv = v * 6 - plankRow;
      const plankGap = 1 - smooth(0.02, 0.07, Math.min(fv, 1 - fv));
      const grain = n.v(u * 8 + plankRow * 5.3, v * 120, 256);
      const ring = Math.sin((u * 20 + n.fbm(u, v, 4, 3) * 4) * Math.PI) * 0.5 + 0.5;
      let t = hashf(plankRow * 2.3) * 0.4 + ring * 0.3 + grain * 0.3;
      let h = 0.4 + grain * 0.1;
      let rough = 0.8;
      if (inFrame || diag) {
        t = 0.55 + grain * 0.3 + ring * 0.15;
        h = 0.85 + grain * 0.1;
        const fe = inFrame ? Math.min(Math.abs(u - frame), Math.abs(u - (1 - frame)), Math.abs(v - frame), Math.abs(v - (1 - frame))) : 1;
        h -= (1 - smooth(0, 0.01, fe)) * 0.3;
      } else {
        h -= plankGap * 0.35;
      }
      let c = [mix(dark[0], base[0], t), mix(dark[1], base[1], t), mix(dark[2], base[2], t)];
      if (!inFrame && !diag) c = c.map((x) => x * (1 - plankGap * 0.5));
      // nails
      const nail = [[frame / 2, frame / 2], [1 - frame / 2, frame / 2], [frame / 2, 1 - frame / 2], [1 - frame / 2, 1 - frame / 2]]
        .some(([nx, ny]) => Math.hypot(u - nx, v - ny) < 0.012);
      if (nail) { c = [0.35, 0.35, 0.36]; h = 0.95; rough = 0.4; }
      const dirt = smooth(0.5, 0.9, n.fbm(u, v, 3, 4)) * 0.2;
      c = c.map((x) => x * (1 - dirt));
      if (opt.stencil && !inFrame && !diag) {
        // simple stencil stripe
        if (v > 0.44 && v < 0.56 && u > 0.25 && u < 0.75) c = c.map((x, k) => mix(x, [0.9, 0.85, 0.7][k] * 0.8, 0.5));
      }
      tc.set(i, c, h, rough, nail ? 0.8 : 0);
    });
  },
  corrugated(tc, n, opt) {
    const base = hex(opt.color);
    tc.each((u, v, i) => {
      const ridge = Math.sin(u * Math.PI * 2 * 24);
      const prof = Math.abs(ridge) ** 0.6 * Math.sign(ridge);
      const big = n.fbm(u, v, 4, 5);
      const fine = n.v(u * 256, v * 256, 256);
      const rust = smooth(0.62, 0.82, n.fbm(u + 0.1, v, 5, 5) + (1 - v) * 0.12);
      const scratch = smooth(0.985, 1, n.v(u * 6, v * 180, 180)) * 0.5;
      const paint = base.map((x) => x * (0.85 + big * 0.2 + prof * 0.06));
      const rc = [0.42, 0.22, 0.12].map((x) => x * (0.8 + fine * 0.4));
      let c = paint.map((x, k) => mix(x, rc[k], rust));
      c = c.map((x) => x + scratch * 0.2);
      // frame bands top & bottom
      const band = v < 0.04 || v > 0.96;
      if (band) c = c.map((x) => x * 0.7);
      tc.set(i, c, prof * 0.5 + 0.5 - rust * 0.1 + fine * 0.05, mix(0.55, 0.9, rust), mix(0.35, 0.1, rust));
    });
  },
  metalPlate(tc, n, opt) {
    const base = hex(opt.color);
    tc.each((u, v, i) => {
      const brushed = n.v(u * 4, v * 256, 256);
      const big = n.fbm(u, v, 4, 4);
      const px = (u * 2) % 1, py = (v * 2) % 1;
      const seam = 1 - smooth(0.0, 0.01, Math.min(px, 1 - px, py, 1 - py));
      const rivet = [[0.06, 0.06], [0.94, 0.06], [0.06, 0.94], [0.94, 0.94], [0.5, 0.06], [0.5, 0.94]]
        .reduce((m, [rx, ry]) => Math.max(m, smooth(0.028, 0.012, Math.hypot(px - rx, py - ry))), 0);
      const grime = smooth(0.55, 0.85, big) * 0.3;
      const c = base.map((x) => x * (0.8 + brushed * 0.25 - grime - seam * 0.3 + rivet * 0.15));
      tc.set(i, c, 0.5 + rivet * 0.4 - seam * 0.4 + brushed * 0.05, 0.45 + grime * 0.8 + brushed * 0.1, opt.metal ?? 0.85);
    });
  },
  sandbag(tc, n) {
    tc.each((u, v, i) => {
      const b = blocks(u, v, 2, 4, 0.5);
      const cx = b.fx - 0.5, cy = b.fy - 0.5;
      const bulge = Math.max(0, 1 - (cx * cx * 3.2 + cy * cy * 3.6));
      const weave = (Math.sin(u * 400) * Math.sin(v * 400)) * 0.5 + 0.5;
      const big = n.fbm(u, v, 4, 4);
      const t = hashf(b.id);
      const c = [0.62, 0.55, 0.4].map((x) => x * (0.7 + bulge * 0.35 + big * 0.15 + t * 0.08 + weave * 0.04));
      tc.set(i, c, Math.sqrt(bulge) * 0.9 + weave * 0.03, 0.97);
    });
  },
  lamp(tc) {
    tc.e = new Float32Array(tc.size * tc.size * 3);
    tc.each((u, v, i) => {
      const inner = u > 0.08 && u < 0.92 && v > 0.08 && v < 0.92;
      tc.set(i, inner ? [0.95, 0.95, 0.9] : [0.3, 0.3, 0.32], inner ? 0.4 : 0.6, 0.4, inner ? 0 : 0.8);
      const e = inner ? 1 : 0;
      tc.e[i * 3] = e; tc.e[i * 3 + 1] = e * 0.93; tc.e[i * 3 + 2] = e * 0.8;
    });
  },
};

// material name -> { recipe, opt, scale (m per repeat), normal strength, extra material params }
export const MATERIAL_DEFS = {
  sand: { r: 'sand', scale: 6, ns: 1.6 },
  dirt: { r: 'dirt', scale: 5, ns: 4 },
  grass: { r: 'dirt', scale: 5, ns: 4 },
  sandstone: { r: 'stoneBlocks', opt: { color: 0xd1b084, color2: 0xbb9466, cols: 3, rows: 6 }, scale: 3, ns: 3.2 },
  sandstoneDark: { r: 'stoneBlocks', opt: { color: 0xb08a60, color2: 0x96714b, cols: 2, rows: 5 }, scale: 3, ns: 3.2 },
  sandstoneLight: { r: 'plaster', opt: { color: 0xe0cda8 }, scale: 4, ns: 3 },
  stoneTiles: { r: 'tiles', opt: { color: 0xb8a58a, color2: 0xa89478, grout: 0x6e6252, count: 4, rough: 0.8 }, scale: 3, ns: 5 },
  tiles: { r: 'tiles', opt: { color: 0xc9c6bd, color2: 0x8f8c86, grout: 0x4d4b47, count: 6, checker: true, rough: 0.35 }, scale: 3, ns: 4 },
  plaster: { r: 'plaster', opt: { color: 0xd8d2c4 }, scale: 4, ns: 3 },
  plasterDark: { r: 'plaster', opt: { color: 0x8b867c }, scale: 4, ns: 3 },
  brick: { r: 'brick', scale: 2.5, ns: 5 },
  concrete: { r: 'concrete', opt: { color: 0xa3a39e, seams: true }, scale: 4, ns: 4 },
  concreteDark: { r: 'concrete', opt: { color: 0x6c6c6a, seams: false }, scale: 4, ns: 4 },
  asphalt: { r: 'asphalt', scale: 5, ns: 4 },
  roof: { r: 'concrete', opt: { color: 0x7a7672 }, scale: 4, ns: 3 },
  crate: { r: 'crate', opt: { color: 0xb88a55, dark: 0x6d4b2b }, scale: 0, ns: 5 },
  crateDark: { r: 'crate', opt: { color: 0x6b7042, dark: 0x3b3e24, stencil: true }, scale: 0, ns: 5 },
  wood: { r: 'planks', opt: { color: 0x9a7048, dark: 0x5a3c22, count: 8, seg: 2 }, scale: 2.5, ns: 4 },
  woodPanel: { r: 'planks', opt: { color: 0xc49a66, dark: 0x8a6238, count: 6, vertical: true, seg: 1 }, scale: 2, ns: 4 },
  metal: { r: 'metalPlate', opt: { color: 0x9aa0a6 }, scale: 2, ns: 3 },
  darkMetal: { r: 'metalPlate', opt: { color: 0x3a3e44, metal: 0.6 }, scale: 2, ns: 3 },
  containerRed: { r: 'corrugated', opt: { color: 0x9c2f22 }, scale: 6, ns: 7 },
  containerBlue: { r: 'corrugated', opt: { color: 0x245a8c }, scale: 6, ns: 7 },
  containerGreen: { r: 'corrugated', opt: { color: 0x3d6b3a }, scale: 6, ns: 7 },
  containerYellow: { r: 'corrugated', opt: { color: 0xc49a2a }, scale: 6, ns: 7 },
  barrel: { r: 'corrugated', opt: { color: 0xc8c8c4 }, scale: 6, ns: 4 },
  sandbag: { r: 'sandbag', scale: 2, ns: 5 },
  lamp: { r: 'lamp', scale: 0, ns: 1 },
};

export class TextureLibrary {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.size = quality === 'ultra' ? 1024 : quality === 'low' ? 256 : 512;
    this.aniso = Math.min(renderer.capabilities.getMaxAnisotropy(), quality === 'ultra' ? 16 : quality === 'high' ? 8 : 4);
    this.cache = new Map();
    this.materials = new Map();
  }

  textures(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    const d = MATERIAL_DEFS[name] || MATERIAL_DEFS.concrete;
    // generate at 512 max for speed, but big surfaces at the full size
    const size = d.scale >= 4 || d.r === 'corrugated' ? this.size : Math.min(this.size, 512);
    const tc = new TexCanvas(size);
    const seed = [...name].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
    const n = new Noise(seed);
    RECIPES[d.r](tc, n, d.opt || {});
    const tex = toTextures(tc, d.ns * (size / 512), this.aniso);
    this.cache.set(name, tex);
    return tex;
  }

  material(name) {
    if (this.materials.has(name)) return this.materials.get(name);
    const t = this.textures(name);
    const d = MATERIAL_DEFS[name] || {};
    const m = new THREE.MeshStandardMaterial({
      map: t.map,
      normalMap: t.normalMap,
      roughnessMap: t.roughnessMap,
      metalnessMap: t.roughnessMap,
      roughness: 1,
      metalness: 1,
      vertexColors: true,
    });
    if (t.emissiveMap) {
      m.emissiveMap = t.emissiveMap;
      m.emissive = new THREE.Color(1, 0.95, 0.85);
      m.emissiveIntensity = 3.5;
    }
    m.userData.scale = d.scale ?? 3;
    this.materials.set(name, m);
    return m;
  }

  // Warm up (generate) a list of materials, yielding between each so the loading screen can update.
  async prepare(names, onProgress) {
    let i = 0;
    for (const n of names) {
      this.material(n);
      onProgress?.(++i / names.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}

// Soft round sprite used by particles / smoke.
export function makeSoftSprite(size = 64, falloff = 1.0) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4 * falloff, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Cloudy puff texture for smoke grenades / explosions.
export function makeSmokeSprite(size = 128, seed = 3) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const n = new Noise(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const f = n.fbm(u, v, 4, 5);
      const a = clamp01((1 - d) * 1.4 - 0.1) * (0.55 + f * 0.7);
      const i = (y * size + x) * 4;
      const s = 200 + f * 55;
      img.data[i] = s; img.data[i + 1] = s; img.data[i + 2] = s;
      img.data[i + 3] = Math.round(clamp01(a) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeBulletHole(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(8,6,5,1)');
  grd.addColorStop(0.18, 'rgba(15,12,10,0.95)');
  grd.addColorStop(0.3, 'rgba(40,34,28,0.6)');
  grd.addColorStop(0.55, 'rgba(60,52,44,0.25)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  // cracks
  g.strokeStyle = 'rgba(20,16,12,0.5)';
  g.lineWidth = 1;
  for (let k = 0; k < 6; k++) {
    const a = Math.random() * Math.PI * 2;
    g.beginPath();
    g.moveTo(size / 2, size / 2);
    g.lineTo(size / 2 + Math.cos(a) * size * 0.35, size / 2 + Math.sin(a) * size * 0.35);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeCloudTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const n = new Noise(99);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const f = n.fbm(u, v, 3, 6, 0.55);
      const a = smooth(0.45, 0.75, f);
      const i = (y * size + x) * 4;
      const s = 235 + (f - 0.5) * 30;
      img.data[i] = s; img.data[i + 1] = s; img.data[i + 2] = s + 5;
      img.data[i + 3] = Math.round(a * 230);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
