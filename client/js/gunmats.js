// Procedural surface detail for weapons and hands: small tileable normal/roughness/albedo maps for
// brushed & scratched metal, stippled polymer, wood grain, grip texture and glove fabric.
// Generated once (a few ms) and shared by every weapon model.

import * as THREE from 'three';

const SIZE = 256;

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// tileable value noise
function vnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a) => ((a % period) + period) % period;
  const a = hash(w(xi), w(yi), seed), b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed), d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, oct, base, seed) {
  let s = 0, amp = 0.5, f = base, n = 0;
  for (let o = 0; o < oct; o++) {
    s += vnoise(x * f, y * f, f, seed + o * 17) * amp;
    n += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / n;
}

// height field -> tangent-space normal map
function normalFromHeight(h, strength) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const hl = h[y * SIZE + ((x - 1 + SIZE) % SIZE)], hr = h[y * SIZE + ((x + 1) % SIZE)];
      const hd = h[((y - 1 + SIZE) % SIZE) * SIZE + x], hu = h[((y + 1) % SIZE) * SIZE + x];
      let nx = (hl - hr) * strength, ny = (hd - hu) * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * SIZE + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

function tex(data, srgb = false) {
  const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// grey-scale value (0..1) array -> roughness texture (in the G channel like three expects)
function roughTex(r) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = Math.max(0, Math.min(255, r[i] * 255));
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  return tex(data);
}

function albedoTex(a) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = Math.max(0, Math.min(255, a[i] * 255));
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  return tex(data, true);
}

let cache = null;

export function gunMaps() {
  if (cache) return cache;
  const N = SIZE * SIZE;
  // ---- metal: fine brushing along U, sparse scratches, soft wear blotches
  const mh = new Float32Array(N), mr = new Float32Array(N), ma = new Float32Array(N);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE;
      const brush = vnoise(u * 3, v * 140, 140, 3) * 0.6 + vnoise(u * 8, v * 260, 260, 5) * 0.4;
      const wear = fbm(u, v, 4, 4, 11);
      const i = y * SIZE + x;
      mh[i] = brush * 0.25 + wear * 0.15;
      mr[i] = 0.3 + brush * 0.18 + (wear > 0.62 ? -0.12 : 0.05);
      ma[i] = 0.9 + wear * 0.1 + brush * 0.05 + (wear > 0.66 ? 0.12 : 0);
    }
  }
  // scratches
  for (let k = 0; k < 60; k++) {
    let x = hash(k, 1, 7) * SIZE, y = hash(k, 2, 7) * SIZE;
    const a = hash(k, 3, 7) * Math.PI * 2, len = 10 + hash(k, 4, 7) * 50;
    for (let s = 0; s < len; s++) {
      const xi = ((Math.round(x) % SIZE) + SIZE) % SIZE, yi = ((Math.round(y) % SIZE) + SIZE) % SIZE;
      const i = yi * SIZE + xi;
      mh[i] -= 0.25; mr[i] -= 0.1; ma[i] += 0.25;
      x += Math.cos(a); y += Math.sin(a);
    }
  }
  // ---- polymer: dense stipple dots
  const ph = new Float32Array(N), pr = new Float32Array(N);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE;
      const dots = vnoise(u * 64, v * 64, 64, 21);
      const mottle = fbm(u, v, 3, 3, 23);
      const i = y * SIZE + x;
      ph[i] = Math.pow(dots, 3) * 0.8 + mottle * 0.1;
      pr[i] = 0.62 + mottle * 0.2 - dots * 0.08;
    }
  }
  // ---- wood: stretched grain rings with pores
  const wh = new Float32Array(N), wa = new Float32Array(N), wr = new Float32Array(N);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE;
      const warp = fbm(u, v, 3, 2, 31) * 3;
      const ring = 0.5 + 0.5 * Math.sin((v * 18 + warp) * Math.PI * 2);
      const pores = vnoise(u * 90, v * 12, 90, 33);
      const i = y * SIZE + x;
      wa[i] = 0.62 + ring * 0.32 - pores * 0.08;
      wh[i] = ring * 0.3 + pores * 0.2;
      wr[i] = 0.42 + ring * 0.12 + pores * 0.1;
    }
  }
  // ---- rubber grip: raised diamond knurling
  const rh = new Float32Array(N);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const a = Math.abs(((x + y) % 16) - 8) / 8, b = Math.abs(((x - y + SIZE * 4) % 16) - 8) / 8;
      rh[y * SIZE + x] = Math.min(a, b);
    }
  }
  // ---- glove fabric: woven threads + knuckle stitching feel
  const gh = new Float32Array(N), gr = new Float32Array(N);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const weave = (Math.sin(x * 0.8) * Math.sin(y * 0.8) + 1) * 0.5;
      const n = fbm(x / SIZE, y / SIZE, 3, 6, 41);
      const i = y * SIZE + x;
      gh[i] = weave * 0.5 + n * 0.3;
      gr[i] = 0.75 + n * 0.15;
    }
  }
  cache = {
    metal: { normalMap: tex(normalFromHeight(mh, 5)), roughnessMap: roughTex(mr), map: albedoTex(ma) },
    polymer: { normalMap: tex(normalFromHeight(ph, 3.5)), roughnessMap: roughTex(pr) },
    wood: { normalMap: tex(normalFromHeight(wh, 3)), roughnessMap: roughTex(wr), map: albedoTex(wa) },
    rubber: { normalMap: tex(normalFromHeight(rh, 4)) },
    fabric: { normalMap: tex(normalFromHeight(gh, 3)), roughnessMap: roughTex(gr) },
  };
  return cache;
}

// Box-projected UVs in metres (tile = size of one texture repeat) so detail has the same density on
// every part regardless of how the part was built.
export function projectUV(geo, tile = 0.06) {
  const P = geo.attributes.position, N = geo.attributes.normal;
  if (!P || !N) return geo;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i)), nz = Math.abs(N.getZ(i));
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    let u, v;
    if (nx >= ny && nx >= nz) { u = z; v = y; }
    else if (ny >= nz) { u = z; v = x; }
    else { u = x; v = y; }
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
