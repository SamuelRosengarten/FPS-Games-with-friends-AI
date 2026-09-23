// Purely cosmetic map dressing generated from the map grid: wall caps, background building windows,
// rooftop clutter, vegetation, awnings, wires, signs, ground decals and puddles. Nothing here collides.
// Everything is merged or instanced so the whole set costs only a handful of draw calls.

import * as THREE from 'three';
import { hash2 } from '../shared/constants.js';
import { Skyline } from './skyline.js';
import { Builder, bakedMaterial, superEllipsoid, weldNormals, SURF } from './surface.js';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Shared wind clock for vegetation / cloth vertex animation.
const windTime = { value: 0 };

// Sways vertices in world space (applied after projection setup so instanced meshes move coherently).
// weight: GLSL expression for how much a vertex moves (0 at the root).
function addWind(mat, { amp = 0.1, freq = 1.3, weight = 'max(position.y, 0.0)', attr = false } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWindTime = windTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uWindTime;
${attr ? 'attribute float aWind;' : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 wBase = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  wBase = instanceMatrix * wBase;
  #endif
  wBase = modelMatrix * wBase;
  float wK = ${weight};
  float wPh = uWindTime * ${freq.toFixed(3)} + wBase.x * 0.23 + wBase.z * 0.31;
  vec3 wOff = vec3(sin(wPh) + 0.35 * sin(wPh * 2.7 + 1.3), 0.15 * sin(wPh * 1.9), 0.6 * cos(wPh * 0.8 + 0.5)) * ${amp.toFixed(3)} * wK;
  mvPosition.xyz += (viewMatrix * vec4(wOff, 0.0)).xyz;
  gl_Position = projectionMatrix * mvPosition;
}`);
  };
  mat.customProgramCacheKey = () => `wind-${amp}-${freq}-${weight}`;
  return mat;
}

// ------------------------------------------------------------------ small geometry helpers

class Batch {
  constructor() { this.geos = []; }
  add(geo, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    this.geos.push(g);
  }
  box(w, h, d, x, y, z, rotY = 0) {
    tmpM.compose(tmpP.set(x, y, z), tmpQ.setFromAxisAngle(UP, rotY), tmpS.set(1, 1, 1));
    this.add(new THREE.BoxGeometry(w, h, d), tmpM);
  }
  build(worldUV = 0) {
    if (!this.geos.length) return null;
    let count = 0;
    for (const g of this.geos) count += g.attributes.position.count;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    let o = 0;
    for (const g of this.geos) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      uv.set(g.attributes.uv.array, o * 2);
      o += g.attributes.position.count;
      g.dispose();
    }
    if (worldUV) {
      for (let i = 0; i < count; i++) {
        const nx = Math.abs(nor[i * 3]), ny = Math.abs(nor[i * 3 + 1]);
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        if (ny > 0.5) { uv[i * 2] = x / worldUV; uv[i * 2 + 1] = z / worldUV; }
        else if (nx > 0.5) { uv[i * 2] = z / worldUV; uv[i * 2 + 1] = y / worldUV; }
        else { uv[i * 2] = x / worldUV; uv[i * 2 + 1] = y / worldUV; }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    return geo;
  }
}

function canvasTex(w, h, draw, srgb = true, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d', { willReadFrequently: true }), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const texCache = new Map();
function cached(key, fn) {
  if (!texCache.has(key)) texCache.set(key, fn());
  return texCache.get(key);
}

// Window pane: frame + mullions over a vertical gradient (reflection); lit variant is a warm interior
// with curtains, used as the emissive map.
function windowTex(lit) {
  return cached(lit ? 'winLit' : 'win', () => canvasTex(64, 96, (g, w, h) => {
    if (lit) {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#fff1c8'); grd.addColorStop(1, '#b8743a');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.fillStyle = '#3a1d10';
      g.fillRect(4, 4, 14, h - 8); g.fillRect(w - 18, 4, 14, h - 8);
      g.fillRect(0, h * 0.62, w, 3);
    } else {
      const grd = g.createLinearGradient(0, 0, w * 0.4, h);
      grd.addColorStop(0, '#d9e2ea'); grd.addColorStop(0.45, '#7f8c96'); grd.addColorStop(0.5, '#4b565e'); grd.addColorStop(1, '#2a3036');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath(); g.moveTo(8, h); g.lineTo(28, 0); g.lineTo(36, 0); g.lineTo(16, h); g.fill();
    }
    g.fillStyle = lit ? '#000' : '#3b3a36';
    g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4); g.fillRect(0, 0, 4, h); g.fillRect(w - 4, 0, 4, h);
    g.fillRect(w / 2 - 2, 0, 4, h); g.fillRect(0, h * 0.38, w, 3);
  }));
}

function palmTex() {
  return cached('palm', () => canvasTex(256, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // central rib
    g.strokeStyle = '#5b6a2c';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, h / 2); g.quadraticCurveTo(w / 2, h / 2 - 4, w, h / 2); g.stroke();
    // leaflets
    for (let i = 0; i < 46; i++) {
      const x = 6 + i * (w - 12) / 46;
      const len = (h / 2 - 2) * Math.sin((x / w) * Math.PI) * (0.8 + Math.random() * 0.25);
      for (const s of [-1, 1]) {
        const shade = 70 + Math.random() * 40;
        g.strokeStyle = `rgb(${shade * 0.7 | 0},${shade + 35 | 0},${shade * 0.35 | 0})`;
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(x, h / 2);
        g.lineTo(x + 7, h / 2 + s * len);
        g.stroke();
      }
    }
  }));
}

function grassTex(dry) {
  return cached('grass' + dry, () => canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = 10 + Math.random() * (w - 20);
      const bend = (Math.random() - 0.5) * 30;
      const top = 20 + Math.random() * 70;
      const c = dry ? [150 + Math.random() * 50, 130 + Math.random() * 40, 70 + Math.random() * 30] : [70 + Math.random() * 40, 110 + Math.random() * 50, 40 + Math.random() * 20];
      g.strokeStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      g.lineWidth = 1.5 + Math.random() * 1.5;
      g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + bend * 0.3, h - top * 0.6, x + bend, h - top); g.stroke();
    }
  }));
}

function awningTex(c1, c2) {
  return cached('awn' + c1 + c2, () => canvasTex(128, 64, (g, w, h) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? c1 : c2; g.fillRect(i * w / 8, 0, w / 8 + 1, h); }
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
    // scalloped edge
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(i * w / 8 + w / 16, h + 4, w / 16, 0, Math.PI * 2); g.fill(); }
  }, true, false));
}

function decalTex(kind) {
  return cached('decal' + kind, () => canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    if (kind === 'crack') {
      g.strokeStyle = 'rgba(25,20,15,0.55)';
      const branch = (x, y, a, len, width, depth) => {
        if (depth > 4 || len < 4) return;
        const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
        g.lineWidth = width;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
        branch(x2, y2, a + (Math.random() - 0.5) * 1.2, len * 0.7, width * 0.7, depth + 1);
        if (Math.random() < 0.6) branch(x2, y2, a + (Math.random() - 0.5) * 2, len * 0.5, width * 0.6, depth + 1);
      };
      for (let k = 0; k < 3; k++) branch(64, 64, Math.random() * 6.28, 22, 2.5, 0);
    } else if (kind === 'stain') {
      for (let k = 0; k < 9; k++) {
        const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50, r = 12 + Math.random() * 26;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(20,18,16,0.35)');
        grd.addColorStop(1, 'rgba(20,18,16,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
      }
    } else if (kind === 'sand') {
      for (let k = 0; k < 7; k++) {
        const x = 64 + (Math.random() - 0.5) * 60, y = 64 + (Math.random() - 0.5) * 60, r = 16 + Math.random() * 28;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(214,186,138,0.55)');
        grd.addColorStop(1, 'rgba(214,186,138,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
      }
    } else if (kind === 'leaves') {
      for (let k = 0; k < 40; k++) {
        const x = 20 + Math.random() * 88, y = 20 + Math.random() * 88;
        g.fillStyle = `rgba(${90 + Math.random() * 60 | 0},${70 + Math.random() * 40 | 0},${30 | 0},0.8)`;
        g.beginPath(); g.ellipse(x, y, 4, 2, Math.random() * 6, 0, Math.PI * 2); g.fill();
      }
    }
  }, true));
}

function signTex(text, color) {
  return cached('sign' + text + color, () => canvasTex(256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = '900 92px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 6);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 0) img.data[i + 3] *= 0.65 + Math.random() * 0.35;
    // drips
    g.putImageData(img, 0, 0);
    g.fillStyle = color;
    for (let k = 0; k < 6; k++) {
      const x = 40 + Math.random() * (w - 80);
      g.globalAlpha = 0.5;
      g.fillRect(x, h / 2 + 30, 2, 10 + Math.random() * 20);
    }
  }));
}

// ------------------------------------------------------------------ decor

// One filled sandbag: a pillow with a folded, narrower tied end and lumpy fabric.
function sandbagGeometry(seed) {
  const g = superEllipsoid(0.29, 0.078, 0.16, 0.55, 0.3, 10, 5);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const t = x / 0.29;
    if (t > 0.62) { const k = (t - 0.62) / 0.38; z *= 1 - k * 0.35; y *= 1 - k * 0.45; }
    if (y > 0) y *= 0.85;
    y += (hash2(Math.round(x * 40) + seed * 97, Math.round(z * 40)) - 0.5) * 0.012;
    x += (hash2(Math.round(z * 30), Math.round(y * 30) + seed) - 0.5) * 0.01;
    P.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  weldNormals(g);
  const b = new Builder();
  b.add(g, { color: 0xffffff, tex: SURF.fabric, texK: 1.4, rough: 0.97 });
  return b.build(false);
}

// Fictional flag designs.
function flagTex(design) {
  return cached('flag-' + design, () => canvasTex(256, 154, (g, w, h) => {
    if (design === 'company') {
      g.fillStyle = '#f2efe8'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e0701f';
      g.beginPath(); g.moveTo(0, h * 0.62); g.lineTo(w, h * 0.22); g.lineTo(w, h * 0.42); g.lineTo(0, h * 0.82); g.fill();
      g.fillStyle = '#2b2f36'; g.font = 'bold 44px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText('BRX', 16, 14);
    } else if (design === 'desert') {
      g.fillStyle = '#c9923e'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2f6f75'; g.fillRect(0, h * 0.66, w, h * 0.34);
      g.fillStyle = '#efe6cf'; g.fillRect(0, h * 0.58, w, h * 0.08);
      g.beginPath(); g.arc(w * 0.3, h * 0.33, h * 0.16, 0, Math.PI * 2); g.fill();
    } else {
      // embassy: maroon / ivory diagonal with a gold roundel
      g.fillStyle = '#efe7d6'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#7a1f2b';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(0, h); g.fill();
      g.strokeStyle = '#d4a93c'; g.lineWidth = 9;
      g.beginPath(); g.arc(w * 0.5, h * 0.5, h * 0.24, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#d4a93c';
      g.beginPath(); g.moveTo(w * 0.5, h * 0.34); g.lineTo(w * 0.56, h * 0.58); g.lineTo(w * 0.44, h * 0.58); g.fill();
    }
    // weathering
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.03})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1 + Math.random() * 3);
    }
  }));
}

// Round soft droplet sprite.
function dropTex() {
  return cached('drop', () => canvasTex(32, 32, (g) => {
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
  }));
}

// Tileable ripple normal map for water.
function waterNormalTex() {
  return cached('water-normal', () => {
    const S = 128;
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let v = 0;
        for (let k = 0; k < 6; k++) {
          const fx = 1 + Math.floor(hash2(k, 1) * 4), fy = 1 + Math.floor(hash2(k, 2) * 4), ph = hash2(k, 3) * 6.28;
          v += Math.sin(((x * fx + y * fy) / S) * Math.PI * 2 * (1 + (k % 3)) + ph) / (1 + k * 0.5);
        }
        hgt[y * S + x] = v;
      }
    }
    const data = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x - 1 + S) % S)];
        const dy = hgt[((y + 1) % S) * S + x] - hgt[((y - 1 + S) % S) * S + x];
        const n = new THREE.Vector3(-dx * 0.6, -dy * 0.6, 1).normalize();
        const i = (y * S + x) * 4;
        data[i] = (n.x * 0.5 + 0.5) * 255; data[i + 1] = (n.y * 0.5 + 0.5) * 255; data[i + 2] = (n.z * 0.5 + 0.5) * 255; data[i + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  });
}

export class Decor {
  constructor(graphics, textures, map) {
    this.g = graphics;
    this.tex = textures;
    this.map = map;
    this.cfg = map.decor || {};
    this.group = new THREE.Group();
    this.animated = [];
    this.build();
    graphics.scene.add(this.group);
  }

  dispose() {
    this.g.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }

  cellCenter(r, c) {
    const m = this.map;
    return [m.x0 + (c + 0.5) * m.cellSize, m.z0 + (r + 0.5) * m.cellSize];
  }
  ch(r, c) {
    const m = this.map;
    if (r < 0 || c < 0 || r >= m.rows || c >= m.cols) return '#';
    return m.grid[r][c];
  }
  isWall(r, c) { const ch = this.ch(r, c); return ch === '#' || ch === '%'; }
  isOpen(r, c) { return !this.isWall(r, c); }
  roofed(r, c) { const m = this.map; return r >= 0 && c >= 0 && r < m.rows && c < m.cols && m.roofed[r][c]; }

  mesh(geo, mat, { cast = false, receive = true } = {}) {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.group.add(m);
    return m;
  }

  build() {
    const cfg = this.cfg;
    const steps = [
      ['caps', () => this.buildCaps()],
      ['windows', () => cfg.windows !== false && this.buildWindows()],
      ['rooftop', () => cfg.rooftop !== false && this.buildRooftop()],
      ['palms', () => cfg.palms && this.buildPalms(cfg.palms)],
      ['grass', () => cfg.grass && this.buildGrass(cfg.grass === 'dry')],
      ['awnings', () => cfg.awnings && this.buildAwnings(cfg.awnings)],
      ['wires', () => cfg.wires && this.buildWires(cfg.wires)],
      ['barbed', () => cfg.barbed && this.buildBarbedWire()],
      ['torches', () => cfg.torches && this.buildTorches(cfg.torches)],
      ['lamps', () => cfg.lampPosts && this.buildLampPosts(cfg.lampPosts)],
      ['signs', () => this.buildSigns(cfg.signs || [])],
      ['decals', () => this.buildDecals(cfg.decals || ['crack', 'stain'])],
      ['puddles', () => cfg.puddles && this.buildPuddles(cfg.puddles)],
      ['sandbags', () => this.buildSandbags()],
      ['containers', () => this.buildContainers()],
      ['crates', () => this.buildCrateTrim()],
      ['trucks', () => this.buildTrucks()],
      ['wallProps', () => cfg.wallProps && this.buildWallProps(cfg.wallProps)],
      ['clutter', () => cfg.clutter && this.buildClutter(cfg.clutter)],
      ['flags', () => cfg.flags && this.buildFlags(cfg.flags)],
      ['fountain', () => cfg.fountain && this.buildFountain(cfg.fountain)],
      ['skyline', () => cfg.skyline && this.buildSkyline(cfg.skyline)],
    ];
    this.timings = {};
    for (const [name, fn] of steps) {
      const t0 = performance.now();
      fn();
      this.timings[name] = Math.round(performance.now() - t0);
    }
  }

  // Stone caps on wall tops and a plinth at the bottom: breaks up the big flat boxes.
  buildCaps() {
    const capMat = this.tex.material(this.cfg.trim || this.map.mats.building || 'concrete');
    const caps = new Batch();
    const plinths = new Batch();
    const up = this.map.upper;
    for (const b of this.map.boxes) {
      if (b.kind !== 'wall' && b.kind !== 'sill' && b.kind !== 'cover') continue;
      if (b.kind === 'cover' && b.mat === 'sandbag') continue; // real bags instead
      // ground-floor walls that carry a second storey have no visible top
      if (up && Math.abs(b.max[1] - up.floorY) < 0.05) continue;
      const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2], h = b.max[1];
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      const o = b.kind === 'wall' ? 0.07 : 0.04;
      const t = b.kind === 'wall' ? 0.16 : 0.08;
      caps.box(w + o * 2, t, d + o * 2, cx, h + t / 2 - 0.02, cz);
      if (b.kind === 'wall') {
        caps.box(w + 0.02, 0.06, d + 0.02, cx, h - 0.25, cz); // thin band under the cap
        plinths.box(w + 0.05, 0.28, d + 0.05, cx, b.min[1] + 0.14, cz);
      }
    }
    const sc = capMat.userData.scale || 3;
    this.mesh(caps.build(sc), withoutVertexColors(capMat, 1.05), { cast: true });
    this.mesh(plinths.build(sc), withoutVertexColors(capMat, 0.78), { cast: false });
  }

  // Windows on the tall background blocks so the skyline reads as buildings.
  buildWindows() {
    const m = this.map;
    const glassMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.cfg.glass ?? 0x26303a).lerp(new THREE.Color(0xffffff), 0.5), map: windowTex(false), metalness: 0.3, roughness: 0.12, envMapIntensity: 1.4 });
    const frameMat = withoutVertexColors(this.tex.material(this.cfg.trim || m.mats.building || 'concrete'), 0.9);
    const winGeo = new THREE.BoxGeometry(1, 1, 1);
    const wins = [];
    const frames = [];
    const litChance = this.cfg.litWindows ?? 0.12;
    for (const b of m.boxes) {
      if (b.kind !== 'wall' || b.upper || b.max[1] < m.wallHeight + 1.8) continue;
      const faces = [
        { n: [1, 0, 0], len: b.max[2] - b.min[2], at: (t) => [b.max[0], b.min[2] + t], rot: Math.PI / 2 },
        { n: [-1, 0, 0], len: b.max[2] - b.min[2], at: (t) => [b.min[0], b.min[2] + t], rot: Math.PI / 2 },
        { n: [0, 0, 1], len: b.max[0] - b.min[0], at: (t) => [b.min[0] + t, b.max[2]], rot: 0 },
        { n: [0, 0, -1], len: b.max[0] - b.min[0], at: (t) => [b.min[0] + t, b.min[2]], rot: 0 },
      ];
      for (const f of faces) {
        const count = Math.floor((f.len - 0.8) / 2.4);
        if (count < 1) continue;
        const pad = (f.len - count * 2.4) / 2 + 1.2;
        for (let y = m.wallHeight + 1.2; y < b.max[1] - 1.1; y += 2.6) {
          for (let i = 0; i < count; i++) {
            const [x, z] = f.at(pad + i * 2.4);
            const lit = hash2(Math.round(x * 3 + y), Math.round(z * 3 - y)) < litChance;
            wins.push({ x: x + f.n[0] * 0.02, y, z: z + f.n[2] * 0.02, rot: f.rot, lit });
            frames.push({ x: x + f.n[0] * 0.05, y: y - 0.8, z: z + f.n[2] * 0.05, rot: f.rot });
          }
        }
      }
    }
    if (!wins.length) return;
    const litMat = new THREE.MeshStandardMaterial({ color: 0x3a2a18, map: windowTex(false), emissive: 0xffb866, emissiveMap: windowTex(true), emissiveIntensity: 1.8, roughness: 0.3 });
    for (const lit of [false, true]) {
      const list = wins.filter((w) => w.lit === lit);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(winGeo, lit ? litMat : glassMat, list.length);
      list.forEach((w, i) => {
        tmpM.compose(tmpP.set(w.x, w.y, w.z), tmpQ.setFromAxisAngle(UP, w.rot), tmpS.set(1.1, 1.45, 0.06));
        mesh.setMatrixAt(i, tmpM);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = !lit;
      this.group.add(mesh);
    }
    const sills = new THREE.InstancedMesh(winGeo, frameMat, frames.length);
    frames.forEach((w, i) => {
      tmpM.compose(tmpP.set(w.x, w.y, w.z), tmpQ.setFromAxisAngle(UP, w.rot), tmpS.set(1.35, 0.12, 0.18));
      sills.setMatrixAt(i, tmpM);
    });
    sills.instanceMatrix.needsUpdate = true;
    sills.castShadow = true;
    this.group.add(sills);
  }

  // Water tanks, AC units and antennas on the rooftops.
  buildRooftop() {
    const m = this.map;
    const metal = new Batch();
    const tanks = new Batch();
    for (const b of m.boxes) {
      if (b.kind !== 'wall' || b.max[1] < m.wallHeight + 1.8) continue;
      const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
      if (w < 3 || d < 3) continue;
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, top = b.max[1] + 0.12;
      const h = hash2(Math.round(cx * 7), Math.round(cz * 7));
      if (h < 0.45) {
        tmpM.compose(tmpP.set(cx + (h - 0.2) * w * 0.4, top + 1.3, cz), tmpQ.identity(), tmpS.set(1, 1, 1));
        tanks.add(new THREE.CylinderGeometry(0.9, 0.9, 1.8, 16), tmpM);
        for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) metal.box(0.1, 0.5, 0.1, tmpP.x + dx, top + 0.2, cz + dz);
      } else if (h < 0.8) {
        metal.box(1.4, 0.9, 1.0, cx - w * 0.2, top + 0.45, cz + d * 0.15);
        metal.box(1.0, 0.7, 0.8, cx + w * 0.2, top + 0.35, cz - d * 0.2);
      } else {
        metal.box(0.08, 3.5, 0.08, cx, top + 1.75, cz);
        metal.box(1.2, 0.05, 0.05, cx, top + 3.0, cz);
        metal.box(0.8, 0.05, 0.05, cx, top + 3.3, cz, Math.PI / 2);
      }
    }
    // big flat roofs (out of reach): tar membrane, AC units, vents and skylights
    const membrane = new Batch();
    const glass = new Batch();
    for (const b of m.boxes) {
      if (b.kind !== 'roof' || b.max[1] < 3.5) continue;
      const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
      if (w < 6 || d < 6) continue;
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, top = b.max[1];
      membrane.box(w - 0.3, 0.03, d - 0.3, cx, top + 0.015, cz);
      const n = Math.min(8, Math.floor((w * d) / 45));
      for (let i = 0; i < n; i++) {
        const h = hash2(Math.round(cx * 5) + i * 31, Math.round(cz * 5) + i * 17);
        const x = b.min[0] + 1.6 + hash2(i * 7, Math.round(cx)) * (w - 3.2);
        const z = b.min[2] + 1.6 + hash2(Math.round(cz), i * 11) * (d - 3.2);
        if (h < 0.4) {
          metal.box(1.3, 0.8, 0.9, x, top + 0.4, z);
          metal.box(1.36, 0.06, 0.96, x, top + 0.83, z);
          tanks.add(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 12), tmpM.compose(tmpP.set(x + 0.2, top + 0.87, z), tmpQ.identity(), tmpS.set(1, 1, 1)));
        } else if (h < 0.65) {
          metal.box(0.2, 0.7, 0.2, x, top + 0.35, z);
          tanks.add(new THREE.CylinderGeometry(0.26, 0.2, 0.25, 10), tmpM.compose(tmpP.set(x, top + 0.8, z), tmpQ.identity(), tmpS.set(1, 1, 1)));
        } else if (h < 0.85) {
          metal.box(2.2, 0.35, 1.4, x, top + 0.175, z);
          glass.box(2.0, 0.04, 1.2, x, top + 0.36, z);
        } else {
          tanks.add(new THREE.SphereGeometry(0.45, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), tmpM.compose(tmpP.set(x, top + 1.0, z), tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -2.2), tmpS.set(1, 0.35, 1)));
          metal.box(0.06, 0.9, 0.06, x, top + 0.45, z);
        }
      }
    }
    const mg = membrane.build(3);
    if (mg) this.mesh(mg, withoutVertexColors(this.tex.material(m.mats.raised || m.mats.roof || 'concrete'), 0.62), { cast: false });
    this.mesh(glass.build(), new THREE.MeshStandardMaterial({ color: 0x3a4a58, metalness: 0.4, roughness: 0.08, envMapIntensity: 1.5 }), { cast: false });
    this.mesh(metal.build(), new THREE.MeshStandardMaterial({ color: 0x8a8f94, metalness: 0.6, roughness: 0.5 }), { cast: true });
    this.mesh(tanks.build(), new THREE.MeshStandardMaterial({ color: this.cfg.tankColor ?? 0xd8d2c0, metalness: 0.3, roughness: 0.6 }), { cast: true });
  }

  // Palm trees on top of the hidden blocks, visible above the walls.
  buildPalms(count) {
    const m = this.map;
    const spots = [];
    for (let r = 1; r < m.rows - 1; r++) {
      for (let c = 1; c < m.cols - 1; c++) {
        if (this.ch(r, c) !== '#') continue;
        let nearOpen = false;
        for (let dr = -2; dr <= 2 && !nearOpen; dr++) for (let dc = -2; dc <= 2; dc++) if (this.isOpen(r + dr, c + dc)) { nearOpen = true; break; }
        if (nearOpen) continue;
        spots.push([r, c, hash2(r * 13, c * 7)]);
      }
    }
    spots.sort((a, b) => a[2] - b[2]);
    const chosen = [];
    for (const s of spots) {
      if (chosen.length >= count) break;
      if (chosen.some((o) => Math.abs(o[0] - s[0]) + Math.abs(o[1] - s[1]) < 5)) continue;
      chosen.push(s);
    }
    const trunk = new Batch();
    const leaves = new Batch();
    const tops = [];
    for (const [r, c, h] of chosen) {
      const [x, z] = this.cellCenter(r, c);
      const base = this.topAt(x, z);
      const height = 4.5 + h * 3.5;
      const lean = (hash2(c, r) - 0.5) * 0.5;
      const dir = hash2(r + 3, c) * Math.PI * 2;
      let px = x, pz = z, py = base;
      const segs = 7;
      for (let i = 0; i < segs; i++) {
        const t = i / segs;
        const nx = x + Math.cos(dir) * lean * height * (t + 1 / segs) ** 2;
        const nz = z + Math.sin(dir) * lean * height * (t + 1 / segs) ** 2;
        const ny = base + height * (i + 1) / segs;
        const a = new THREE.Vector3(px, py, pz), b = new THREE.Vector3(nx, ny, nz);
        const len = a.distanceTo(b);
        const g = new THREE.CylinderGeometry(0.17 - t * 0.06, 0.2 - t * 0.06, len, 8);
        tmpM.compose(a.clone().add(b).multiplyScalar(0.5), tmpQ.setFromUnitVectors(UP, b.clone().sub(a).normalize()), tmpS.set(1, 1, 1));
        trunk.add(g, tmpM);
        px = nx; py = ny; pz = nz;
      }
      const top = new THREE.Vector3(px, py, pz);
      tops.push(top);
      const fronds = 9;
      for (let i = 0; i < fronds; i++) {
        const a = (i / fronds) * Math.PI * 2 + h * 3;
        const droop = 0.35 + hash2(i, r + c) * 0.4;
        const L = 3.2 + hash2(r, i) * 1.0;
        const g = new THREE.PlaneGeometry(L, 0.9, 6, 1);
        const p = g.attributes.position;
        for (let k = 0; k < p.count; k++) {
          const u = (p.getX(k) + L / 2) / L;
          p.setX(k, u * L);
          p.setY(k, p.getY(k) - droop * L * u * u);
        }
        g.rotateX(-Math.PI / 2 + 0.25);
        g.computeVertexNormals();
        tmpM.compose(top, tmpQ.setFromAxisAngle(UP, a), tmpS.set(1, 1, 1));
        leaves.add(g, tmpM);
      }
    }
    this.mesh(trunk.build(), new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 0.95 }), { cast: true });
    const leafGeo = leaves.build();
    if (!leafGeo) return;
    // sway weight grows towards the frond tips (distance from the crown)
    const P = leafGeo.attributes.position;
    const wgt = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) {
      let best = 1e9;
      for (const q of tops) best = Math.min(best, Math.hypot(P.getX(i) - q.x, P.getY(i) - q.y, P.getZ(i) - q.z));
      wgt[i] = Math.min(1, best / 4.2) ** 2;
    }
    leafGeo.setAttribute('aWind', new THREE.BufferAttribute(wgt, 1));
    const tex = palmTex();
    const leafMat = addWind(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, color: 0xd8e8b0 }), { amp: 0.28, freq: 1.1, weight: 'aWind', attr: true });
    const lm = this.mesh(leafGeo, leafMat, { cast: true });
    // shadows sway with the leaves
    lm.customDepthMaterial = addWind(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.45, side: THREE.DoubleSide }), { amp: 0.28, freq: 1.1, weight: 'aWind', attr: true });
  }

  topAt(x, z) {
    let top = 0;
    for (const b of this.map.boxes) {
      if (b.kind !== 'wall') continue;
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) top = Math.max(top, b.max[1]);
    }
    return top;
  }

  // Grass / dry bush tufts along wall bases in open (unroofed) cells.
  buildGrass(dry) {
    const m = this.map;
    const pts = [];
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        const ch = this.ch(r, c);
        if (ch !== '.' || this.roofed(r, c)) continue;
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          if (!this.isWall(r + dr, c + dc)) continue;
          if (hash2(r * 31 + dr, c * 17 + dc) > 0.35) continue;
          const [x, z] = this.cellCenter(r, c);
          const along = (hash2(c, r * 3 + dr) - 0.5) * 1.6;
          const px = x + dc * (m.cellSize / 2 - 0.25) + (dr ? along : 0);
          const pz = z + dr * (m.cellSize / 2 - 0.25) + (dc ? along : 0);
          pts.push([px, pz, 0.4 + hash2(r, c + dr * 5) * 0.5]);
        }
      }
    }
    if (!pts.length) return;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    const mat = addWind(new THREE.MeshStandardMaterial({ map: grassTex(dry), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 }), { amp: dry ? 0.05 : 0.08, freq: 1.7, weight: 'position.y * position.y' });
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length * 2);
    pts.forEach(([x, z, s], i) => {
      for (let k = 0; k < 2; k++) {
        tmpM.compose(tmpP.set(x, 0, z), tmpQ.setFromAxisAngle(UP, k * Math.PI / 2 + s * 5), tmpS.set(s * 1.4, s, s * 1.4));
        mesh.setMatrixAt(i * 2 + k, tmpM);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  // Striped cloth awnings on outside walls, above head height.
  buildAwnings(colors) {
    const m = this.map;
    const batches = colors.map(() => new Batch());
    const rods = new Batch();
    let n = 0;
    for (let r = 1; r < m.rows - 1; r++) {
      for (let c = 1; c < m.cols - 1; c++) {
        if (this.ch(r, c) !== '#') continue;
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const rr = r + dr, cc = c + dc;
          if (!this.isOpen(rr, cc) || this.roofed(rr, cc) || this.ch(rr, cc) === 'D') continue;
          if (hash2(r * 7 + dr * 3, c * 11 + dc) > 0.07) continue;
          const [x, z] = this.cellCenter(r, c);
          const fx = x + dc * m.cellSize / 2, fz = z + dr * m.cellSize / 2;
          const g = new THREE.PlaneGeometry(2.2, 1.3, 1, 4);
          const p = g.attributes.position;
          for (let k = 0; k < p.count; k++) p.setZ(k, Math.sin(((p.getY(k) + 0.65) / 1.3) * Math.PI) * 0.08);
          g.computeVertexNormals();
          g.rotateX(-Math.PI / 2 + 0.55);
          g.translate(0, 0, 0.55);
          const rot = Math.atan2(dc, dr);
          tmpM.compose(tmpP.set(fx, 2.95, fz), tmpQ.setFromAxisAngle(UP, rot), tmpS.set(1, 1, 1));
          batches[n++ % colors.length].add(g, tmpM);
          // support rods
          const rod = new THREE.CylinderGeometry(0.015, 0.015, 1.2, 5);
          rod.rotateX(Math.PI / 2 - 0.55);
          rod.translate(0, -0.25, 0.5);
          for (const off of [-1.05, 1.05]) {
            tmpM.compose(tmpP.set(fx + Math.cos(rot) * off, 2.95, fz - Math.sin(rot) * off), tmpQ.setFromAxisAngle(UP, rot), tmpS.set(1, 1, 1));
            rods.add(rod.clone(), tmpM);
          }
        }
      }
    }
    colors.forEach(([c1, c2], i) => {
      const mat = new THREE.MeshStandardMaterial({ map: awningTex(c1, c2), side: THREE.DoubleSide, roughness: 0.9, alphaTest: 0.3 });
      this.mesh(batches[i].build(), mat, { cast: true });
    });
    this.mesh(rods.build(), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.7, roughness: 0.4 }), { cast: true });
  }

  // Sagging cables strung across alleys.
  buildWires(count) {
    const m = this.map;
    const tubes = new Batch();
    const found = [];
    const tryLine = (r, c, dr, dc) => {
      // walk from wall cell (r,c) through open cells until the next wall
      let len = 0;
      let rr = r + dr, cc = c + dc;
      while (this.isOpen(rr, cc) && len < 12) { rr += dr; cc += dc; len++; }
      if (len < 2 || len > 9 || !this.isWall(rr, cc)) return null;
      for (let k = 1; k <= len; k++) if (this.roofed(r + dr * k, c + dc * k)) return null;
      return len;
    };
    for (let r = 1; r < m.rows - 1 && found.length < count; r++) {
      for (let c = 1; c < m.cols - 1 && found.length < count; c++) {
        if (!this.isWall(r, c) || hash2(r * 5, c * 9) > 0.08) continue;
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          const len = tryLine(r, c, dr, dc);
          if (!len) continue;
          const [x0, z0] = this.cellCenter(r, c);
          const a = new THREE.Vector3(x0 + dc * m.cellSize / 2, m.wallHeight - 0.3, z0 + dr * m.cellSize / 2);
          const b = new THREE.Vector3(a.x + dc * len * m.cellSize, a.y - 0.2 * hash2(c, r), a.z + dr * len * m.cellSize);
          const mid = a.clone().add(b).multiplyScalar(0.5);
          mid.y -= 0.35 + len * 0.12;
          const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
          tubes.add(new THREE.TubeGeometry(curve, 16, 0.018, 4, false), tmpM.identity());
          if (hash2(r, c) < 0.5) {
            const b2 = b.clone(); b2.y -= 0.4;
            const a2 = a.clone(); a2.y -= 0.35;
            const mid2 = a2.clone().add(b2).multiplyScalar(0.5); mid2.y -= 0.5 + len * 0.1;
            tubes.add(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a2, mid2, b2), 16, 0.014, 4, false), tmpM.identity());
          }
          found.push([r, c]);
          break;
        }
      }
    }
    this.mesh(tubes.build(), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }), { cast: true });
  }

  // Coiled wire along the top of the outer walls.
  buildBarbedWire() {
    const m = this.map;
    const rings = [];
    for (const b of m.boxes) {
      if (b.kind !== 'wall' || Math.abs(b.max[1] - m.wallHeight) > 0.01) continue;
      const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
      const alongX = w >= d;
      const len = alongX ? w : d;
      if (len < 4) continue;
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      for (let t = 0.3; t < len - 0.3; t += 0.45) {
        const x = alongX ? b.min[0] + t : cx, z = alongX ? cz : b.min[2] + t;
        rings.push([x, b.max[1] + 0.32, z, alongX]);
      }
    }
    if (!rings.length) return;
    const geo = new THREE.TorusGeometry(0.22, 0.009, 3, 8);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x777b80, metalness: 0.8, roughness: 0.4 }), rings.length);
    rings.forEach(([x, y, z, alongX], i) => {
      tmpM.compose(tmpP.set(x, y, z), tmpQ.setFromEuler(new THREE.Euler(0.15 * Math.sin(i), alongX ? Math.PI / 2 : 0, 0)), tmpS.set(1, 1, 1));
      mesh.setMatrixAt(i, tmpM);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  // Wall-mounted braziers with flickering flames (dusk maps).
  buildTorches(count) {
    const m = this.map;
    const metal = new Batch();
    const flames = [];
    let n = 0;
    for (let r = 1; r < m.rows - 1 && n < count; r++) {
      for (let c = 1; c < m.cols - 1 && n < count; c++) {
        if (!this.isWall(r, c)) continue;
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          if (!this.isOpen(r + dr, c + dc) || this.roofed(r + dr, c + dc)) continue;
          if (hash2(r * 3 + dc, c * 5 + dr) > 0.05) continue;
          const [x, z] = this.cellCenter(r, c);
          const fx = x + dc * (m.cellSize / 2 + 0.22), fz = z + dr * (m.cellSize / 2 + 0.22);
          metal.box(0.08, 0.5, 0.08, x + dc * (m.cellSize / 2 + 0.05), 2.35, z + dr * (m.cellSize / 2 + 0.05));
          tmpM.compose(tmpP.set(fx, 2.62, fz), tmpQ.identity(), tmpS.set(1, 1, 1));
          metal.add(new THREE.CylinderGeometry(0.2, 0.1, 0.22, 10, 1, true), tmpM);
          flames.push([fx, 2.8, fz]);
          n++;
          break;
        }
      }
    }
    this.mesh(metal.build(), new THREE.MeshStandardMaterial({ color: 0x2a2624, metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide }), { cast: true });
    if (!flames.length) return;
    const geo = new THREE.ConeGeometry(0.16, 0.5, 8, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 2.0, 0.5), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, flames.length * 2);
    mesh.userData.noAO = true;
    this.group.add(mesh);
    this.animated.push({ type: 'flames', mesh, flames });
  }

  // Street lamp posts with glowing heads on yard walls.
  buildLampPosts(count) {
    const m = this.map;
    const metal = new Batch();
    const heads = new Batch();
    let n = 0;
    for (let r = 1; r < m.rows - 1 && n < count; r++) {
      for (let c = 1; c < m.cols - 1 && n < count; c++) {
        if (!this.isWall(r, c)) continue;
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          if (!this.isOpen(r + dr, c + dc) || this.roofed(r + dr, c + dc)) continue;
          if (hash2(r * 17 + dc, c * 13 + dr) > 0.04) continue;
          const [x, z] = this.cellCenter(r, c);
          const wx = x + dc * (m.cellSize / 2), wz = z + dr * (m.cellSize / 2);
          metal.box(0.1, 1.0, 0.1, wx + dc * 0.05, m.wallHeight - 0.9, wz + dr * 0.05);
          const armLen = 1.2;
          metal.box(dc ? armLen : 0.08, 0.08, dr ? armLen : 0.08, wx + dc * armLen / 2, m.wallHeight - 0.45, wz + dr * armLen / 2);
          heads.box(0.5, 0.12, 0.3, wx + dc * armLen, m.wallHeight - 0.52, wz + dr * armLen, dc ? 0 : Math.PI / 2);
          n++;
          break;
        }
      }
    }
    this.mesh(metal.build(), new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.7, roughness: 0.45 }), { cast: true });
    this.mesh(heads.build(), new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffe0a0, emissiveIntensity: 2.5 }), { cast: false });
  }

  // Spray-painted site arrows on walls. sign: { r, c, dir: 'n'|'s'|'e'|'w', text, color }
  buildSigns(signs) {
    const m = this.map;
    for (const s of signs) {
      const [x, z] = this.cellCenter(s.r, s.c);
      const d = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[s.dir];
      const px = x + d[0] * (m.cellSize / 2 + 0.012), pz = z + d[1] * (m.cellSize / 2 + 0.012);
      const mat = new THREE.MeshStandardMaterial({ map: signTex(s.text, s.color || '#d23a2a'), transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9), mat);
      mesh.position.set(px, s.y ?? 1.9, pz);
      mesh.rotation.y = Math.atan2(d[0], d[1]);
      mesh.receiveShadow = true;
      mesh.userData.noAO = true;
      this.group.add(mesh);
    }
  }

  // Cracks, stains, drifted sand and leaves on the ground.
  buildDecals(kinds) {
    const m = this.map;
    const lists = kinds.map(() => []);
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        const ch = this.ch(r, c);
        if (ch !== '.' && ch !== ',') continue;
        const h = hash2(r * 19, c * 23);
        if (h > 0.16) continue;
        const k = Math.floor(hash2(c * 3, r * 5) * kinds.length);
        const [x, z] = this.cellCenter(r, c);
        lists[k].push([x + (hash2(r, c * 2) - 0.5) * 1.2, z + (hash2(r * 2, c) - 0.5) * 1.2, 1.0 + hash2(c, r) * 1.6, h * 40]);
      }
    }
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    kinds.forEach((kind, i) => {
      const list = lists[i];
      if (!list.length) return;
      const mat = new THREE.MeshStandardMaterial({ map: decalTex(kind), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, z, s, rot], j) => {
        tmpM.compose(tmpP.set(x, 0.006 + i * 0.001, z), tmpQ.setFromAxisAngle(UP, rot), tmpS.set(s, 1, s));
        mesh.setMatrixAt(j, tmpM);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.userData.noAO = true;
      mesh.renderOrder = 1;
      this.group.add(mesh);
    });
  }

  // Reflective rain puddles.
  buildPuddles(chance) {
    const m = this.map;
    const pts = [];
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        if (this.ch(r, c) !== '.' || this.roofed(r, c)) continue;
        if (hash2(r * 41, c * 37) > chance) continue;
        const [x, z] = this.cellCenter(r, c);
        pts.push([x, z, 0.8 + hash2(c, r * 9) * 1.4, hash2(r, c) * 6]);
      }
    }
    if (!pts.length) return;
    const tex = cached('puddle', () => canvasTex(128, 128, (g, w, h) => {
      const grd = g.createRadialGradient(64, 64, 10, 64, 64, 62);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.7, 'rgba(255,255,255,0.9)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(64, 64, 62, 44, 0.3, 0, Math.PI * 2); g.fill();
    }, false));
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x121518, alphaMap: tex, transparent: true, roughness: 0.05, metalness: 0.35, envMapIntensity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    pts.forEach(([x, z, s, rot], i) => {
      tmpM.compose(tmpP.set(x, 0.008, z), tmpQ.setFromAxisAngle(UP, rot), tmpS.set(s * 1.4, 1, s));
      mesh.setMatrixAt(i, tmpM);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.userData.noAO = true;
    this.group.add(mesh);
  }

  // Sandbag walls: the collision box is dressed with individual stacked bags in a running bond.
  buildSandbags() {
    const boxes = this.map.boxes.filter((b) => b.kind === 'cover' && b.mat === 'sandbag');
    if (!boxes.length) return;
    const templates = [sandbagGeometry(1), sandbagGeometry(2), sandbagGeometry(3)];
    const items = [[], [], []];
    const BL = 0.56;
    let seq = 0;
    for (const b of boxes) {
      const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2], h = b.max[1] - b.min[1];
      const alongX = w >= d;
      const L = alongX ? w : d, D = alongX ? d : w;
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, y0 = b.min[1];
      const courses = Math.max(1, Math.round(h / 0.155));
      const ch = h / courses;
      const place = (u, v, y, across) => {
        const k = seq++;
        const x = alongX ? cx + u : cx + v, z = alongX ? cz + v : cz + u;
        const rot = (alongX !== across ? 0 : Math.PI / 2) + (hash2(k, 3) - 0.5) * 0.16 + (hash2(k, 9) > 0.5 ? Math.PI : 0);
        items[k % 3].push([x, y, z, rot, (hash2(k, 5) - 0.5) * 0.08, 0.94 + hash2(k, 7) * 0.12, k]);
      };
      for (let k = 0; k < courses; k++) {
        const y = y0 + ch * (k + 0.5);
        const off = (k % 2) * BL * 0.5;
        for (let u = -L / 2 + BL * 0.5 - off; u < L / 2 - BL * 0.3; u += BL) {
          if (u < -L / 2 + BL * 0.3) continue;
          for (const sv of [-1, 1]) place(u, sv * (D / 2 - 0.1), y, false);
        }
        const inner = D - 0.34;
        const m = Math.max(1, Math.round(inner / BL));
        for (let j = 0; j < m; j++) {
          const v = -inner / 2 + (j + 0.5) * (inner / m);
          for (const su of [-1, 1]) place(su * (L / 2 - 0.1), v, y, true);
        }
      }
      const rows = Math.max(1, Math.round(D / 0.33));
      for (let r = 0; r < rows; r++) {
        const v = -D / 2 + (r + 0.5) * (D / rows);
        const off = (r % 2) * BL * 0.5;
        for (let u = -L / 2 + BL * 0.5 - off; u < L / 2 - BL * 0.3; u += BL) {
          if (u < -L / 2 + BL * 0.3) continue;
          place(u, v, y0 + h - 0.045, false);
        }
      }
    }
    const tints = [0xb3a383, 0xa69676, 0x9b8c6c, 0xbcab88, 0x8e8163];
    const col = new THREE.Color();
    templates.forEach((geo, t) => {
      const list = items[t];
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, bakedMaterial(), list.length);
      list.forEach(([x, y, z, rot, tilt, sc, k], i) => {
        tmpM.compose(tmpP.set(x, y, z), tmpQ.setFromEuler(new THREE.Euler(tilt, rot, tilt * 0.5, 'YXZ')), tmpS.set(sc, 0.95 + (sc - 1) * 0.5, sc));
        mesh.setMatrixAt(i, tmpM);
        mesh.setColorAt(i, col.set(tints[k % tints.length]));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    });
  }

  // Shipping containers: corner posts and castings, top / bottom rails and door locking bars.
  buildContainers() {
    const byMat = new Map();
    const steel = new Batch();
    for (const b of this.map.boxes) {
      if (b.kind !== 'container') continue;
      if (!byMat.has(b.mat)) byMat.set(b.mat, new Batch());
      const frame = byMat.get(b.mat);
      const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, y0 = b.min[1];
      const o = 0.02;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = cx + sx * (w / 2 - 0.06 + o), z = cz + sz * (d / 2 - 0.06 + o);
        frame.box(0.16, h, 0.16, x, y0 + h / 2, z);
        for (const top of [0, 1]) steel.box(0.19, 0.13, 0.19, x + sx * 0.012, y0 + (top ? h - 0.065 : 0.065), z + sz * 0.012);
      }
      // rails along all four sides, top and bottom
      for (const top of [0, 1]) {
        const y = y0 + (top ? h - 0.07 : 0.07);
        for (const sz of [-1, 1]) frame.box(w - 0.3, 0.14, 0.1, cx, y, cz + sz * (d / 2 + o - 0.03));
        for (const sx of [-1, 1]) frame.box(0.1, 0.14, d - 0.3, cx + sx * (w / 2 + o - 0.03), y, cz);
      }
      // door end: four vertical locking bars with handles and cam keepers
      const alongX = w >= d;
      const endW = alongX ? d : w;
      for (let k = 0; k < 4; k++) {
        const t = -endW / 2 + endW * (0.14 + k * 0.24);
        const px = alongX ? cx + w / 2 + o + 0.035 : cx + t, pz = alongX ? cz + t : cz + d / 2 + o + 0.035;
        tmpM.compose(tmpP.set(px, y0 + h / 2, pz), tmpQ.identity(), tmpS.set(1, 1, 1));
        steel.add(new THREE.CylinderGeometry(0.018, 0.018, h - 0.3, 8), tmpM);
        const hx = alongX ? px + 0.03 : px + 0.08, hz = alongX ? pz + 0.08 : pz + 0.03;
        steel.box(alongX ? 0.03 : 0.2, 0.04, alongX ? 0.2 : 0.03, hx, y0 + h * 0.45, hz);
        for (const top of [0, 1]) steel.box(0.07, 0.07, 0.07, px, y0 + (top ? h - 0.2 : 0.2), pz);
      }
    }
    for (const [mat, batch] of byMat) {
      this.mesh(batch.build(this.tex.material(mat).userData.scale || 6), withoutVertexColors(this.tex.material(mat), 0.82), { cast: true });
    }
    this.mesh(steel.build(), new THREE.MeshStandardMaterial({ color: 0x3b3a38, metalness: 0.75, roughness: 0.55 }), { cast: true });
  }

  // Outside wall faces next to open, unroofed floor: (face centre, outward normal, rotation, wall top).
  outsideFaces() {
    const m = this.map, cs = m.cellSize, out = [];
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        if (!this.isWall(r, c)) continue;
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nch = this.ch(r + dr, c + dc);
          if ((nch !== '.' && nch !== ',') || this.roofed(r + dr, c + dc)) continue;
          const [x, z] = this.cellCenter(r, c);
          out.push({ r, c, dr, dc, x: x + dc * cs / 2, z: z + dr * cs / 2, rot: Math.atan2(dc, dr), top: this.topAt(x, z) || this.map.wallHeight });
        }
      }
    }
    return out;
  }

  // Wall furniture: AC units, electrical boxes with conduit, drainpipes and louvred vents.
  buildWallProps(cfg) {
    const white = new Batch(), grey = new Batch(), dark = new Batch(), pipes = new Batch();
    const cs = this.map.cellSize;
    for (const f of this.outsideFaces()) {
      const h = hash2(f.r * 41 + f.dr * 7 + 3, f.c * 29 + f.dc * 13);
      const along = (hash2(f.c * 7 + f.dr, f.r * 3 + f.dc) - 0.5) * cs * 0.55;
      const cr = Math.cos(f.rot), sr = Math.sin(f.rot);
      // local (lx along the wall, lz out of the wall) -> world
      const W = (lx, lz) => [f.x + (lx + along) * cr + lz * sr, f.z - (lx + along) * sr + lz * cr];
      const bx = (batch, w, hh, d, lx, y, lz) => { const [x, z] = W(lx, lz); batch.box(w, hh, d, x, y, z, f.rot); };
      const vcyl = (batch, r, y0, y1, lx, lz, seg = 10) => { const [x, z] = W(lx, lz); tmpM.compose(tmpP.set(x, (y0 + y1) / 2, z), tmpQ.identity(), tmpS.set(1, 1, 1)); batch.add(new THREE.CylinderGeometry(r, r, y1 - y0, seg), tmpM); };
      let acc = 0;
      if (h < (acc += cfg.ac || 0) && f.top > 3.3) {
        const y = Math.min(f.top - 0.6, 2.75);
        bx(white, 0.78, 0.52, 0.3, 0, y, 0.17);
        bx(dark, 0.44, 0.42, 0.012, 0.13, y, 0.325);
        const [x, z] = W(-0.2, 0.33);
        tmpM.compose(tmpP.set(x, y, z), tmpQ.setFromEuler(new THREE.Euler(Math.PI / 2, f.rot, 0, 'YXZ')), tmpS.set(1, 1, 1));
        dark.add(new THREE.CylinderGeometry(0.17, 0.17, 0.012, 20), tmpM);
        for (const sx of [-0.3, 0.3]) bx(grey, 0.04, 0.04, 0.34, sx, y - 0.28, 0.17);
        vcyl(pipes, 0.008, 0.2, y - 0.26, 0.34, 0.05, 6);
      } else if (h < (acc += cfg.ebox || 0)) {
        bx(grey, 0.36, 0.46, 0.14, 0, 1.5, 0.07);
        bx(dark, 0.004, 0.42, 0.004, 0.0, 1.5, 0.142);
        bx(dark, 0.03, 0.05, 0.02, 0.14, 1.5, 0.15);
        vcyl(pipes, 0.016, 1.73, f.top - 0.15, 0.1, 0.03, 8);
      } else if (h < (acc += cfg.pipe || 0)) {
        vcyl(pipes, 0.045, 0.16, f.top - 0.08, 0, 0.07, 12);
        for (let y = 0.9; y < f.top - 0.3; y += 1.3) bx(dark, 0.12, 0.035, 0.08, 0, y, 0.04);
        const [x, z] = W(0, 0.12);
        tmpM.compose(tmpP.set(x, 0.12, z), tmpQ.setFromEuler(new THREE.Euler(Math.PI / 2 - 0.5, f.rot, 0, 'YXZ')), tmpS.set(1, 1, 1));
        pipes.add(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 12), tmpM);
        bx(pipes, 0.22, 0.09, 0.14, 0, f.top - 0.04, 0.07);
      } else if (h < (acc += cfg.vent || 0)) {
        const y = hash2(f.r, f.c) > 0.5 ? 0.45 : Math.min(f.top - 0.5, 2.9);
        bx(grey, 0.42, 0.32, 0.035, 0, y, 0.018);
        for (let k = 0; k < 5; k++) bx(dark, 0.36, 0.022, 0.03, 0, y - 0.11 + k * 0.055, 0.03);
      }
    }
    this.mesh(white.build(), new THREE.MeshStandardMaterial({ color: 0xd6d3cb, metalness: 0.25, roughness: 0.55 }), { cast: true });
    this.mesh(grey.build(), new THREE.MeshStandardMaterial({ color: 0x8b8f93, metalness: 0.6, roughness: 0.45 }), { cast: true });
    this.mesh(dark.build(), new THREE.MeshStandardMaterial({ color: 0x2a2b2c, metalness: 0.4, roughness: 0.6 }), { cast: false });
    this.mesh(pipes.build(), new THREE.MeshStandardMaterial({ color: this.cfg.pipeColor ?? 0x77736b, metalness: 0.5, roughness: 0.5 }), { cast: true });
  }

  // Small things lying around: rocks, paper, cans, pallets, tyres, traffic cones, jerry cans, clay pots.
  buildClutter(cfg) {
    const m = this.map, cs = m.cellSize;
    // open floor cells, with the direction of a neighbouring wall if there is one
    const cells = [];
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        const ch = this.ch(r, c);
        if (ch !== '.' && ch !== ',') continue;
        let wall = null;
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (this.isWall(r + dr, c + dc)) { wall = [dr, dc]; break; }
        cells.push({ r, c, wall, roofed: this.roofed(r, c) });
      }
    }
    const near = cells.filter((q) => q.wall);
    let seq = 1;
    const pick = (list, outside = false) => {
      for (let tries = 0; tries < 30; tries++) {
        const q = list[Math.floor(hash2(seq * 13, tries * 7 + 1) * list.length)];
        seq++;
        if (!q || (outside && q.roofed)) continue;
        return q;
      }
      return null;
    };
    // position against the wall of a near-wall cell (or anywhere in a cell)
    const spotAt = (q, inset, spread = 0.7) => {
      const [x, z] = this.cellCenter(q.r, q.c);
      const j = (hash2(seq * 5, q.r) - 0.5) * cs * spread;
      seq++;
      if (!q.wall) return [x + (hash2(seq, 3) - 0.5) * cs * 0.8, z + (hash2(3, seq) - 0.5) * cs * 0.8];
      const [dr, dc] = q.wall;
      return [x + dc * (cs / 2 - inset) + (dr ? j : 0), z + dr * (cs / 2 - inset) + (dc ? j : 0)];
    };
    const inst = (geo, mat, list, cast = true) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const col = new THREE.Color();
      list.forEach((it, i) => {
        tmpM.compose(tmpP.set(it.x, it.y, it.z), tmpQ.setFromEuler(new THREE.Euler(it.rx || 0, it.ry || 0, it.rz || 0, 'YXZ')), tmpS.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1));
        mesh.setMatrixAt(i, tmpM);
        if (it.color !== undefined) mesh.setColorAt(i, col.set(it.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    // rocks and pebbles along wall bases
    if (cfg.rocks) {
      const geo = new THREE.IcosahedronGeometry(1, 1);
      const P = geo.attributes.position;
      for (let i = 0; i < P.count; i++) {
        const k = 0.75 + hash2(Math.round(P.getX(i) * 50) + 7, Math.round(P.getY(i) * 50) + Math.round(P.getZ(i) * 31)) * 0.45;
        P.setXYZ(i, P.getX(i) * k, P.getY(i) * k * 0.7, P.getZ(i) * k);
      }
      geo.computeVertexNormals();
      const list = [];
      for (let i = 0; i < cfg.rocks; i++) {
        const q = pick(near);
        if (!q) break;
        const [x, z] = spotAt(q, 0.15 + hash2(i, 9) * 0.3, 0.95);
        const sz = 0.025 + Math.pow(hash2(i, 11), 2) * 0.11;
        const tone = 0.8 + hash2(i, 13) * 0.35;
        list.push({ x, y: sz * 0.25, z, s: sz, ry: hash2(i, 15) * 6.28, color: new THREE.Color(this.cfg.rockColor ?? 0x8a8377).multiplyScalar(tone) });
      }
      inst(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: false }), list);
    }
    // sheets of paper, lying slightly curled
    if (cfg.trash) {
      const geo = new THREE.PlaneGeometry(0.21, 0.297, 3, 3);
      const P = geo.attributes.position;
      for (let i = 0; i < P.count; i++) P.setZ(i, (P.getX(i) * P.getX(i) * 1.6 + Math.abs(P.getY(i)) * 0.05));
      geo.rotateX(-Math.PI / 2);
      geo.computeVertexNormals();
      const list = [];
      for (let i = 0; i < cfg.trash; i++) {
        const q = pick(i % 3 ? near : cells);
        if (!q) break;
        const [x, z] = spotAt(q, 0.3 + hash2(i, 3) * 0.4);
        list.push({ x, y: 0.006, z, ry: hash2(i, 5) * 6.28, color: [0xe4e0d6, 0xd8d2c2, 0xcfc8b4, 0xe8e6e0][i % 4] });
      }
      inst(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide }), list, false);
    }
    // drink cans on their side
    if (cfg.cans) {
      const list = [];
      for (let i = 0; i < cfg.cans; i++) {
        const q = pick(i % 2 ? near : cells);
        if (!q) break;
        const [x, z] = spotAt(q, 0.25);
        list.push({ x, y: 0.033, z, rz: Math.PI / 2, ry: hash2(i, 7) * 6.28, color: [0xb02a22, 0xc8ccd0, 0x2f6a3a, 0x284a9a][i % 4] });
      }
      inst(new THREE.CylinderGeometry(0.033, 0.033, 0.122, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.8, roughness: 0.35 }), list, false);
    }
    // wooden pallets flat on the ground against walls
    if (cfg.pallets) {
      const b = new Batch();
      for (let k = 0; k < 7; k++) b.box(1.2, 0.022, 0.1, 0, 0.133, -0.35 + k * 0.1167);
      for (const zz of [-0.35, 0, 0.35]) for (const xx of [-0.55, 0, 0.55]) b.box(0.1, 0.078, 0.1, xx, 0.083, zz);
      for (const zz of [-0.35, 0, 0.35]) b.box(1.2, 0.022, 0.1, 0, 0.033, zz);
      for (let k = 0; k < 3; k++) b.box(1.2, 0.022, 0.1, 0, 0.011, -0.35 + k * 0.35);
      const geo = b.build(1.2);
      const list = [];
      for (let i = 0; i < cfg.pallets; i++) {
        const q = pick(near, true);
        if (!q) break;
        const [x, z] = spotAt(q, 0.45, 0.3);
        const [dr] = q.wall;
        list.push({ x, y: 0, z, ry: (dr ? 0 : Math.PI / 2) + (hash2(i, 3) - 0.5) * 0.2, color: new THREE.Color(0xffffff).multiplyScalar(0.75 + hash2(i, 5) * 0.3) });
      }
      inst(geo, withoutVertexColors(this.tex.material(m.mats.floor2 === 'wood' ? 'wood' : 'woodPanel'), 0.9), list);
    }
    // tyres lying flat
    if (cfg.tires) {
      const list = [];
      for (let i = 0; i < cfg.tires; i++) {
        const q = pick(near, true);
        if (!q) break;
        const [x, z] = spotAt(q, 0.42, 0.5);
        const stack = hash2(i, 9) > 0.6 ? 2 : 1;
        for (let k = 0; k < stack; k++) list.push({ x: x + k * 0.03, y: 0.1 + k * 0.2, z, rx: Math.PI / 2, rz: hash2(i, k) * 6 });
      }
      inst(new THREE.TorusGeometry(0.29, 0.1, 10, 22), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }), list);
    }
    // traffic cones
    if (cfg.cones) {
      const b = new Batch();
      b.box(0.36, 0.03, 0.36, 0, 0.015, 0);
      tmpM.compose(tmpP.set(0, 0.26, 0), tmpQ.identity(), tmpS.set(1, 1, 1));
      b.add(new THREE.CylinderGeometry(0.025, 0.13, 0.46, 16), tmpM);
      const white = new THREE.CylinderGeometry(0.068, 0.088, 0.08, 16);
      tmpM.compose(tmpP.set(0, 0.31, 0), tmpQ.identity(), tmpS.set(1.02, 1, 1.02));
      const geo = b.build();
      const bands = new Batch();
      bands.add(white, tmpM);
      const list = [];
      for (let i = 0; i < cfg.cones; i++) {
        const q = pick(cells, true);
        if (!q) break;
        const [x, z] = spotAt(q, 0.5);
        list.push({ x, y: 0, z, ry: hash2(i, 3) * 6.28 });
      }
      inst(geo, new THREE.MeshStandardMaterial({ color: 0xe0561c, roughness: 0.55 }), list);
      inst(bands.build(), new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.3, metalness: 0.2 }), list, false);
    }
    // jerry cans against walls
    if (cfg.jerry) {
      const g = superEllipsoid(0.085, 0.235, 0.175, 0.2, 0.2, 10, 8);
      g.translate(0, 0.235, 0);
      const list = [];
      for (let i = 0; i < cfg.jerry; i++) {
        const q = pick(near);
        if (!q) break;
        const [x, z] = spotAt(q, 0.12);
        const [dr] = q.wall;
        list.push({ x, y: 0, z, ry: (dr ? Math.PI / 2 : 0) + (hash2(i, 3) - 0.5) * 0.4, color: [0x4a5a32, 0x8a2a1e, 0x3c4a2a][i % 3] });
      }
      inst(g, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.4, roughness: 0.5 }), list);
    }
    // terracotta pots and jars
    if (cfg.pots) {
      const prof = [[0, 0], [0.12, 0], [0.17, 0.08], [0.2, 0.2], [0.18, 0.32], [0.1, 0.4], [0.085, 0.44], [0.1, 0.47], [0.085, 0.48], [0.07, 0.44], [0, 0.44]].map(([x, y]) => new THREE.Vector2(x, y));
      const geo = new THREE.LatheGeometry(prof, 18);
      const list = [];
      for (let i = 0; i < cfg.pots; i++) {
        const q = pick(near);
        if (!q) break;
        const [x, z] = spotAt(q, 0.25);
        const sc = 0.75 + hash2(i, 5) * 0.55;
        list.push({ x, y: 0, z, s: sc, ry: hash2(i, 7) * 6, color: [0xa5603a, 0xb87a4c, 0x94553a, 0xc49a6a][i % 4] });
      }
      inst(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), list);
    }
  }

  // Box truck: the larger 'truck' box is the cargo body, the smaller one next to it the cab.
  buildTrucks() {
    const boxes = this.map.boxes.filter((b) => b.kind === 'truck');
    if (!boxes.length) return;
    const vol = (b) => (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]);
    const bodyBox = boxes.reduce((a, b) => (vol(b) > vol(a) ? b : a));
    const cabBox = boxes.find((b) => b !== bodyBox) || null;
    const paint = new Batch(), light = new Batch(), steel = new Batch(), rubber = new Batch(), glass = new Batch(), chrome = new Batch(), lamps = new Batch();
    const bw = bodyBox.max[0] - bodyBox.min[0], bd = bodyBox.max[2] - bodyBox.min[2], bh = bodyBox.max[1] - bodyBox.min[1];
    const alongX = bw >= bd;
    const L = alongX ? bw : bd, W = alongX ? bd : bw;
    const bc = [(bodyBox.min[0] + bodyBox.max[0]) / 2, (bodyBox.min[2] + bodyBox.max[2]) / 2];
    // forward direction (towards the cab)
    let f = 1;
    if (cabBox) {
      const cc = [(cabBox.min[0] + cabBox.max[0]) / 2, (cabBox.min[2] + cabBox.max[2]) / 2];
      f = Math.sign(alongX ? cc[0] - bc[0] : cc[1] - bc[1]) || 1;
    }
    // helpers in truck space: u along the length (towards the cab), v across, y up
    const P = (u, v) => (alongX ? [bc[0] + u * f, bc[1] + v] : [bc[0] + v, bc[1] + u * f]);
    const add = (batch, lu, h, lv, u, y, v) => { const [x, z] = P(u, v); batch.box(alongX ? lu : lv, h, alongX ? lv : lu, x, y, z); };
    const wheel = (u, v, r = 0.48, w = 0.3) => {
      const [x, z] = P(u, v);
      tmpM.compose(tmpP.set(x, r, z), tmpQ.setFromEuler(new THREE.Euler(alongX ? Math.PI / 2 : 0, 0, alongX ? 0 : Math.PI / 2)), tmpS.set(1, 1, 1));
      rubber.add(new THREE.CylinderGeometry(r, r, w, 22), tmpM);
      const hv = v + Math.sign(v) * (w / 2 + 0.005);
      const [hx, hz] = P(u, hv);
      tmpM.compose(tmpP.set(hx, r, hz), tmpQ.setFromEuler(new THREE.Euler(alongX ? Math.PI / 2 : 0, 0, alongX ? 0 : Math.PI / 2)), tmpS.set(1, 1, 1));
      chrome.add(new THREE.CylinderGeometry(r * 0.52, r * 0.55, 0.02, 16), tmpM);
    };
    // cargo body on the chassis
    const y0 = 1.0;
    add(light, L - 0.1, bh - y0, W, 0, y0 + (bh - y0) / 2, 0);
    for (let u = -L / 2 + 0.3; u < L / 2 - 0.2; u += 0.62) for (const sv of [-1, 1]) add(light, 0.06, bh - y0 - 0.1, 0.03, u, y0 + (bh - y0) / 2, sv * (W / 2 + 0.012));
    for (const top of [0, 1]) for (const sv of [-1, 1]) add(steel, L - 0.1, 0.08, 0.05, 0, top ? bh - 0.04 : y0 + 0.04, sv * (W / 2 + 0.02));
    // rear doors with locking bars
    add(steel, 0.04, bh - y0 - 0.1, W - 0.1, -L / 2 + 0.03, y0 + (bh - y0) / 2, 0);
    for (const sv of [-0.3, -0.12, 0.12, 0.3]) { const [x, z] = P(-L / 2 + 0.0, sv * W); tmpM.compose(tmpP.set(x, y0 + (bh - y0) / 2, z), tmpQ.identity(), tmpS.set(1, 1, 1)); chrome.add(new THREE.CylinderGeometry(0.018, 0.018, bh - y0 - 0.2, 8), tmpM); }
    add(lamps, 0.03, 0.08, 0.16, -L / 2 - 0.01, y0 - 0.1, W / 2 - 0.15);
    add(lamps, 0.03, 0.08, 0.16, -L / 2 - 0.01, y0 - 0.1, -W / 2 + 0.15);
    // chassis, bumpers, fuel tank, underride guard, mud flaps
    for (const sv of [-0.3, 0.3]) add(steel, L + (cabBox ? 1.6 : 0), 0.22, 0.12, cabBox ? 0.8 : 0, 0.82, sv * W);
    add(steel, 0.12, 0.2, W, -L / 2 - 0.02, 0.62, 0);
    for (const sv of [-1, 1]) add(steel, L * 0.45, 0.06, 0.03, 0.05 * L, 0.6, sv * (W / 2 - 0.02));
    { const [x, z] = P(L * 0.28, -(W / 2 - 0.25)); tmpM.compose(tmpP.set(x, 0.72, z), tmpQ.setFromEuler(new THREE.Euler(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0)), tmpS.set(1, 1, 1)); chrome.add(new THREE.CylinderGeometry(0.24, 0.24, 0.9, 16), tmpM); }
    for (const u of [-L / 2 + 0.75, -L / 2 + 1.75]) for (const sv of [-1, 1]) { wheel(u, sv * (W / 2 - 0.18)); wheel(u, sv * (W / 2 - 0.5)); }
    for (const sv of [-1, 1]) add(rubber, 0.02, 0.45, 0.5, -L / 2 + 0.2, 0.42, sv * (W / 2 - 0.3));
    // cab
    if (cabBox) {
      const cw = cabBox.max[0] - cabBox.min[0], cd = cabBox.max[2] - cabBox.min[2];
      const CL = (alongX ? cw : cd) + 0.3, CW = W;
      const cu = L / 2 + 0.15 + CL / 2;
      const top = 2.55;
      add(paint, CL, 0.75, CW, cu, 1.3, 0);                       // lower body
      add(paint, CL - 0.35, top - 1.68, CW, cu - 0.17, (top + 1.68) / 2, 0); // cabin
      add(paint, CL - 0.3, 0.06, CW + 0.02, cu - 0.15, top + 0.03, 0);       // roof lip
      // windshield (front) and side windows
      add(glass, 0.03, 0.62, CW - 0.16, cu + CL / 2 - 0.35 + 0.012, 2.05, 0);
      for (const sv of [-1, 1]) add(glass, CL * 0.42, 0.5, 0.02, cu + CL * 0.05, 2.08, sv * (CW / 2 + 0.006));
      // grille, bumper, headlights, mirrors, steps, exhaust stack
      add(steel, 0.03, 0.5, CW * 0.6, cu + CL / 2 + 0.01, 1.3, 0);
      for (let k = 0; k < 5; k++) add(chrome, 0.035, 0.03, CW * 0.6, cu + CL / 2 + 0.02, 1.1 + k * 0.1, 0);
      add(steel, 0.18, 0.2, CW + 0.1, cu + CL / 2 + 0.06, 0.72, 0);
      for (const sv of [-1, 1]) {
        add(lamps, 0.03, 0.12, 0.22, cu + CL / 2 + 0.015, 1.05, sv * (CW / 2 - 0.2));
        add(steel, 0.05, 0.3, 0.04, cu + CL / 2 - 0.45, 2.1, sv * (CW / 2 + 0.2));
        add(steel, 0.04, 0.03, 0.22, cu + CL / 2 - 0.45, 2.2, sv * (CW / 2 + 0.1));
        add(steel, 0.3, 0.03, 0.18, cu - 0.1, 0.55, sv * (CW / 2 + 0.03));
        wheel(cu + 0.05, sv * (CW / 2 - 0.2));
      }
      { const [x, z] = P(cu - CL / 2 - 0.05, CW / 2 - 0.15); tmpM.compose(tmpP.set(x, 2.05, z), tmpQ.identity(), tmpS.set(1, 1, 1)); chrome.add(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 12), tmpM); }
    }
    const metalTex = this.tex.material('metal');
    this.mesh(light.build(2), withoutVertexColors(metalTex, 1.25), { cast: true });
    this.mesh(paint.build(), new THREE.MeshStandardMaterial({ color: 0x8e2619, metalness: 0.35, roughness: 0.32, envMapIntensity: 1.2 }), { cast: true });
    this.mesh(steel.build(), new THREE.MeshStandardMaterial({ color: 0x2a2b2d, metalness: 0.6, roughness: 0.55 }), { cast: true });
    this.mesh(chrome.build(), new THREE.MeshStandardMaterial({ color: 0xa0a4a8, metalness: 1, roughness: 0.28 }), { cast: true });
    this.mesh(rubber.build(), new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0, roughness: 0.92 }), { cast: true });
    this.mesh(glass.build(), new THREE.MeshStandardMaterial({ color: 0x1b242b, metalness: 0.6, roughness: 0.05, envMapIntensity: 1.6 }), { cast: false });
    this.mesh(lamps.build(), new THREE.MeshStandardMaterial({ color: 0xffe9c8, emissive: 0x332a1e, roughness: 0.2, metalness: 0.2 }), { cast: false });
  }

  // Steel corner caps on wooden crates, carry handles on the military boxes.
  buildCrateTrim() {
    const caps = new Batch();
    const handles = new Batch();
    for (const b of this.map.boxes) {
      if (b.kind !== 'crate') continue;
      const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, cy = (b.min[1] + b.max[1]) / 2;
      if (b.mat === 'crate') {
        const s = 0.085;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          caps.box(s, s, s, cx + sx * (w / 2 - s / 2 + 0.006), cy + sy * (h / 2 - s / 2 + 0.006), cz + sz * (d / 2 - s / 2 + 0.006));
        }
      } else {
        const alongX = w >= d;
        for (const sd of [-1, 1]) {
          const x = alongX ? cx : cx + sd * (w / 2 + 0.02), z = alongX ? cz + sd * (d / 2 + 0.02) : cz;
          for (let k = 0; k < Math.max(1, Math.round(h / 1.0)); k++) {
            const y = b.min[1] + (k + 0.62) * Math.min(1, h);
            handles.box(alongX ? 0.18 : 0.03, 0.03, alongX ? 0.03 : 0.18, x, y, z);
            handles.box(alongX ? 0.03 : 0.05, 0.05, alongX ? 0.05 : 0.03, x - (alongX ? 0.09 : 0), y + 0.01, z - (alongX ? 0 : 0.09));
            handles.box(alongX ? 0.03 : 0.05, 0.05, alongX ? 0.05 : 0.03, x + (alongX ? 0.09 : 0), y + 0.01, z + (alongX ? 0 : 0.09));
          }
        }
      }
    }
    this.mesh(caps.build(), new THREE.MeshStandardMaterial({ color: 0x3a3632, metalness: 0.7, roughness: 0.5 }), { cast: false });
    this.mesh(handles.build(), new THREE.MeshStandardMaterial({ color: 0x1e1f1d, metalness: 0.4, roughness: 0.6 }), { cast: false });
  }

  // Highest surface under a point (walls, roofs, raised floors) for things standing on top of the map.
  heightAt(x, z) {
    let top = 0;
    for (const b of this.map.boxes) {
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) top = Math.max(top, b.max[1]);
    }
    return top;
  }

  // Flag poles on rooftops / wall tops with cloth waving in the wind.
  // flags: [{ r, c, h?, design?, yaw? }]
  buildFlags(flags) {
    const poles = new Batch();
    const knobs = new Batch();
    flags.forEach((f, i) => {
      const [x, z] = this.cellCenter(f.r, f.c);
      const base = f.y ?? this.heightAt(x, z);
      const h = f.h ?? 5;
      tmpM.compose(tmpP.set(x, base + h / 2, z), tmpQ.identity(), tmpS.set(1, 1, 1));
      poles.add(new THREE.CylinderGeometry(0.035, 0.05, h, 8), tmpM);
      tmpM.compose(tmpP.set(x, base + 0.15, z), tmpQ.identity(), tmpS.set(1, 1, 1));
      poles.add(new THREE.CylinderGeometry(0.12, 0.16, 0.3, 8), tmpM);
      tmpM.compose(tmpP.set(x, base + h + 0.05, z), tmpQ.identity(), tmpS.set(1, 1, 1));
      knobs.add(new THREE.SphereGeometry(0.08, 8, 6), tmpM);
      const L = f.w ?? 1.9, H = L * 0.6;
      const geo = new THREE.PlaneGeometry(L, H, 18, 6);
      geo.translate(L / 2 + 0.04, 0, 0);
      const mat = new THREE.MeshStandardMaterial({ map: flagTex(f.design || 'embassy'), side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
      const flagU = { uFlag: { value: new THREE.Vector2(i * 1.7, L) } };
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uWindTime = windTime;
        sh.uniforms.uFlag = flagU.uFlag;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform vec2 uFlag; // seed, length')
          .replace('#include <beginnormal_vertex>', `
float fU = uv.x;
float fPh = uWindTime * 5.2 - fU * 7.5 + position.y * 1.4 + uFlag.x;
float fAmp = 0.13 + 0.04 * sin(uWindTime * 0.6 + uFlag.x);
float fDz = (cos(fPh) * -7.5 * fAmp * fU + sin(fPh) * fAmp) / uFlag.y;
vec3 objectNormal = normalize(vec3(-fDz, 0.0, 1.0));
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed.z += sin(fPh) * fAmp * fU;
transformed.x -= fU * 0.06 * (1.0 - cos(fPh));
transformed.y -= fU * fU * 0.1;`);
      };
      mat.customProgramCacheKey = () => 'flag-cloth';
      const cloth = new THREE.Mesh(geo, mat);
      cloth.position.set(x, base + h - H / 2 - 0.05, z);
      cloth.rotation.y = f.yaw ?? 0;
      cloth.castShadow = false; // the depth pass wouldn't wave with it
      cloth.receiveShadow = true;
      cloth.userData.noAO = true;
      this.group.add(cloth);
    });
    this.mesh(poles.build(), new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.85, roughness: 0.3 }), { cast: true });
    this.mesh(knobs.build(), new THREE.MeshStandardMaterial({ color: 0xd8b04a, metalness: 1, roughness: 0.25 }), { cast: false });
  }

  // Dress a raised block as a fountain: stone rim, rippling water and a spray jet.
  // fountain: [r0, c0, r1, c1] cells of the block.
  buildFountain([r0, c0, r1, c1]) {
    const m = this.map;
    const cs = m.cellSize;
    const x0 = m.x0 + c0 * cs, x1 = m.x0 + (c1 + 1) * cs, z0 = m.z0 + r0 * cs, z1 = m.z0 + (r1 + 1) * cs;
    const top = this.heightAt((x0 + x1) / 2, (z0 + z1) / 2);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    const stone = withoutVertexColors(this.tex.material(this.cfg.trim || m.mats.building || 'concrete'), 1.1);
    const rim = new Batch();
    const t = 0.32, rh = 0.22;
    rim.box(w + 0.1, rh, t, cx, top + rh / 2, z0 + t / 2 - 0.05);
    rim.box(w + 0.1, rh, t, cx, top + rh / 2, z1 - t / 2 + 0.05);
    rim.box(t, rh, d - t * 2 + 0.1, x0 + t / 2 - 0.05, top + rh / 2, cz);
    rim.box(t, rh, d - t * 2 + 0.1, x1 - t / 2 + 0.05, top + rh / 2, cz);
    // tiered centre piece
    for (const [r, h, y] of [[0.55, 0.5, 0], [1.05, 0.12, 0.5], [0.22, 0.7, 0.62], [0.55, 0.08, 1.32], [0.1, 0.25, 1.4]]) {
      tmpM.compose(tmpP.set(cx, top + y + h / 2, cz), tmpQ.identity(), tmpS.set(1, 1, 1));
      rim.add(new THREE.CylinderGeometry(r, r * 1.05, h, 20), tmpM);
    }
    const sc = stone.userData.scale || 3;
    this.mesh(rim.build(sc), stone, { cast: true });
    // water surface with two scrolling normal maps
    const n1 = waterNormalTex(), n2 = n1.clone();
    n1.repeat.set(w / 2.5, d / 2.5);
    n2.repeat.set(w / 1.7, d / 1.7);
    n2.needsUpdate = true;
    const water = new THREE.MeshStandardMaterial({ color: 0x1d4a55, roughness: 0.04, metalness: 0.15, normalMap: n1, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.6, transparent: true, opacity: 0.88 });
    water.onBeforeCompile = (sh) => {
      sh.uniforms.normalMap2 = { value: n2 };
      sh.uniforms.normalMap2Transform = { value: n2.matrix };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform mat3 normalMap2Transform;\nvarying vec2 vNormalMap2Uv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvNormalMap2Uv = ( normalMap2Transform * vec3( uv, 1 ) ).xy;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D normalMap2;\nvarying vec2 vNormalMap2Uv;')
        .replace('#include <normal_fragment_maps>', `
vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
vec3 mapN2 = texture2D( normalMap2, vNormalMap2Uv ).xyz * 2.0 - 1.0;
mapN = normalize( vec3( mapN.xy + mapN2.xy, mapN.z * mapN2.z ) );
mapN.xy *= normalScale;
normal = normalize( tbn * mapN );`);
    };
    const wgeo = new THREE.PlaneGeometry(w - t * 2 + 0.1, d - t * 2 + 0.1);
    wgeo.rotateX(-Math.PI / 2);
    const wm = new THREE.Mesh(wgeo, water);
    wm.position.set(cx, top + 0.13, cz);
    wm.receiveShadow = true;
    wm.userData.noAO = true;
    this.group.add(wm);
    // spray: droplets arcing out of the top bowl
    const drops = [];
    for (let i = 0; i < 240; i++) {
      const a = hash2(i, 5) * Math.PI * 2, sp = 0.3 + hash2(i, 9) * 0.45;
      drops.push([Math.cos(a) * sp, Math.sin(a) * sp, 2.1 + hash2(i, 13) * 0.9, hash2(i, 17)]);
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(drops.length * 3), 3));
    const smat = new THREE.PointsMaterial({ color: 0xdff4ff, size: 0.06, map: dropTex(), transparent: true, opacity: 0.7, depthWrite: false });
    const spray = new THREE.Points(sgeo, smat);
    spray.frustumCulled = false;
    spray.userData.noAO = true;
    this.group.add(spray);
    this.animated.push({ type: 'water', tex: n1, tex2: n2, spray, drops, x: cx, y: top + 1.65, z: cz });
  }

  buildSkyline(style) {
    this.skyline = new Skyline(this.map, style);
    this.group.add(this.skyline.group);
  }

  update(dt, t) {
    windTime.value = t;
    this.skyline?.update(t);
    for (const a of this.animated) {
      if (a.type === 'water') {
        a.tex.offset.set(t * 0.021, t * 0.013);
        a.tex2.offset.set(-t * 0.017, t * 0.024);
        a.tex2.updateMatrix();
        const P = a.spray.geometry.attributes.position;
        a.drops.forEach(([vx, vz, v0, ph], i) => {
          const life = ((t * 0.9 + ph) % 1 + 1) % 1 * 1.1;
          P.setXYZ(i, a.x + vx * life, a.y + v0 * life - 4.9 * life * life, a.z + vz * life);
        });
        P.needsUpdate = true;
      } else if (a.type === 'flames') {
        a.flames.forEach(([x, y, z], i) => {
          for (let k = 0; k < 2; k++) {
            const f = 0.8 + 0.3 * Math.sin(t * (9 + k * 4) + i * 3.1) + 0.15 * Math.sin(t * 23 + i);
            tmpM.compose(tmpP.set(x, y + f * 0.1 * (k ? 0.6 : 1), z), tmpQ.setFromAxisAngle(UP, t * (k ? -2 : 1.5)), tmpS.set(k ? 0.6 : 1, f * (k ? 0.7 : 1), k ? 0.6 : 1));
            a.mesh.setMatrixAt(i * 2 + k, tmpM);
          }
        });
        a.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}

// Map materials use vertex colours for baked shading; decor meshes don't have them.
const plainCache = new Map();
function withoutVertexColors(mat, tint = 1) {
  const key = mat.uuid + tint;
  if (!plainCache.has(key)) {
    const m = mat.clone();
    m.vertexColors = false;
    m.color = new THREE.Color(tint, tint, tint);
    plainCache.set(key, m);
  }
  return plainCache.get(key);
}
