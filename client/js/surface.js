// Shared "baked" material for characters and third-person weapons plus the geometry builder that feeds it.
//
// Every vertex carries its own colour, a second colour (camouflage), roughness / metalness / emissive and
// a surface type. The fragment shader adds real surface detail per type with triplanar sampling in the
// mesh's bind-pose space (so patterns stick to a skinned body while it animates): camouflage blotches,
// fabric weave and wrinkles, MOLLE webbing, skin pores, brushed metal, stippled polymer, wood grain,
// rubber tread. Normals are perturbed from the detail height with screen-space derivatives, so no UVs
// or tangents are needed. One material, one draw call per character.

import * as THREE from 'three';

export const SURF = { none: 0, camo: 1, fabric: 2, skin: 3, rubber: 4, webbing: 5, metal: 6, polymer: 7, wood: 8, paint: 9, leather: 10 };

const SIZE = 512;

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
// tileable value noise with integer period
function vnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a) => ((a % period) + period) % period;
  const a = hash(w(xi), w(yi), seed), b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed), d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(u, v, oct, base, seed) {
  let s = 0, amp = 0.5, f = base, n = 0;
  for (let o = 0; o < oct; o++) {
    s += vnoise(u * f, v * f, f, seed + o * 17) * amp;
    n += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / n;
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function dataTex(data) {
  const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

let texCache = null;
// fabric: R camo blotches, G camo dark spots, B weave height, A wrinkles
// hard:   R brushed metal + scratches, G stipple / pores, B wood grain, A tread / knurl
function detailTextures() {
  if (texCache) return texCache;
  const fab = new Uint8Array(SIZE * SIZE * 4), hard = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE, i = (y * SIZE + x) * 4;
      // camouflage: warped low-frequency blobs + smaller branching spots
      const wu = u + (fbm(u, v, 3, 3, 91) - 0.5) * 0.18, wv = v + (fbm(u, v, 3, 3, 93) - 0.5) * 0.18;
      const blob = smooth(0.47, 0.53, fbm(wu, wv, 4, 3, 11));
      const spot = smooth(0.6, 0.65, fbm(wu * 1.0, wv, 4, 6, 23)) * (1 - blob * 0.5);
      // plain weave: over/under threads with slubs
      const t = 32;
      const tx = Math.sin(u * t * Math.PI * 2), ty = Math.sin(v * t * Math.PI * 2);
      const cell = ((Math.floor(u * t * 2) + Math.floor(v * t * 2)) & 1) ? Math.abs(tx) : Math.abs(ty);
      const weave = 0.35 + cell * 0.5 + (vnoise(u * 64, v * 8, 64, 31) - 0.5) * 0.2;
      // wrinkles: ridged noise stretched along one axis, a few octaves
      const r1 = 1 - Math.abs(fbm(u, v * 0.5, 3, 8, 41) * 2 - 1);
      const r2 = 1 - Math.abs(fbm(u * 0.5, v, 3, 16, 43) * 2 - 1);
      const wr = Math.pow(r1, 3) * 0.6 + Math.pow(r2, 4) * 0.4;
      fab[i] = blob * 255; fab[i + 1] = spot * 255; fab[i + 2] = Math.max(0, Math.min(1, weave)) * 255; fab[i + 3] = wr * 255;

      // brushed metal with a few scratches (scratches added below), soft wear
      const brush = vnoise(u * 4, v * 180, 180, 3) * 0.6 + vnoise(u * 9, v * 320, 320, 5) * 0.4;
      const wear = fbm(u, v, 4, 4, 13);
      // stipple (polymer) / pores (skin)
      const dots = Math.pow(vnoise(u * 96, v * 96, 96, 51), 3) * 0.8 + fbm(u, v, 2, 24, 53) * 0.2;
      // wood grain
      const warp = fbm(u, v, 3, 2, 61) * 3;
      const ring = 0.5 + 0.5 * Math.sin((v * 14 + warp) * Math.PI * 2);
      const grain = ring * 0.7 + vnoise(u * 120, v * 10, 120, 63) * 0.3;
      // tread / knurling diamonds
      const a = Math.abs(((x + y) % 32) - 16) / 16, b = Math.abs(((x - y + SIZE * 4) % 32) - 16) / 16;
      const knurl = Math.min(a, b);
      hard[i] = (brush * 0.7 + wear * 0.3) * 255; hard[i + 1] = dots * 255; hard[i + 2] = grain * 255; hard[i + 3] = knurl * 255;
    }
  }
  for (let k = 0; k < 90; k++) {
    let x = hash(k, 1, 7) * SIZE, y = hash(k, 2, 7) * SIZE;
    const ang = hash(k, 3, 7) * Math.PI * 2, len = 12 + hash(k, 4, 7) * 70;
    for (let s = 0; s < len; s++) {
      const xi = ((Math.round(x) % SIZE) + SIZE) % SIZE, yi = ((Math.round(y) % SIZE) + SIZE) % SIZE;
      hard[(yi * SIZE + xi) * 4] = 255;
      x += Math.cos(ang); y += Math.sin(ang);
    }
  }
  texCache = { fabric: dataTex(fab), hard: dataTex(hard) };
  return texCache;
}

const SHADER_VERT_PARS = /* glsl */`
attribute vec3 aMat;
attribute vec3 aCol2;
attribute vec2 aTex;
varying vec3 vMat;
varying vec3 vCol2;
varying vec2 vTex;
varying vec3 vBPos;
varying vec3 vBNrm;
`;

const SHADER_FRAG_PARS = /* glsl */`
uniform sampler2D uDetailFabric;
uniform sampler2D uDetailHard;
varying vec3 vMat;
varying vec3 vCol2;
varying vec2 vTex;
varying vec3 vBPos;
varying vec3 vBNrm;
vec4 triSample(sampler2D t, vec3 p, vec3 w) {
  return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
}
float sIs(float id, float k) { return 1.0 - step(0.5, abs(id - k)); }
vec3 perturbNormalDeriv(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos)), sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

// Evaluated right after the vertex colour is applied. Produces sH (detail height) and sRough.
const SHADER_SURFACE = /* glsl */`
float sId = floor(vTex.x + 0.5);
float sK = vTex.y;
vec3 sW = pow(abs(normalize(vBNrm)), vec3(4.0));
sW /= (sW.x + sW.y + sW.z);
float isCamo = sIs(sId, 1.0), isFab = sIs(sId, 2.0), isSkin = sIs(sId, 3.0), isRub = sIs(sId, 4.0), isWeb = sIs(sId, 5.0);
float isMet = sIs(sId, 6.0), isPoly = sIs(sId, 7.0), isWood = sIs(sId, 8.0), isPaint = sIs(sId, 9.0), isLea = sIs(sId, 10.0);
float anyFab = isCamo + isFab + isWeb;
vec4 fA = triSample(uDetailFabric, vBPos * 3.0, sW);
vec4 fB = triSample(uDetailFabric, vBPos * 34.0, sW);
float hardScale = isMet * 9.0 + isPoly * 26.0 + isSkin * 34.0 + isWood * 4.0 + isRub * 22.0 + isPaint * 55.0 + isLea * 18.0 + 10.0 * (1.0 - isMet - isPoly - isSkin - isWood - isRub - isPaint - isLea);
vec4 hA = triSample(uDetailHard, vBPos * hardScale, sW);
// camouflage: base colour, second colour, dark spots
vec3 camoCol = mix(diffuseColor.rgb, vCol2, fA.r);
camoCol = mix(camoCol, diffuseColor.rgb * 0.42, fA.g * 0.85);
diffuseColor.rgb = mix(diffuseColor.rgb, camoCol, isCamo);
// MOLLE webbing rows (1 inch webbing, 1 inch gaps) and stitching
float webRow = smoothstep(0.42, 0.5, fract(vBPos.y / 0.0508)) * (1.0 - smoothstep(0.92, 1.0, fract(vBPos.y / 0.0508)));
float webStitch = 1.0 - smoothstep(0.0, 0.08, abs(fract((vBPos.x + vBPos.z) / 0.038) - 0.5) - 0.42);
diffuseColor.rgb *= mix(1.0, 0.78 + 0.22 * webRow, isWeb);
// fabric thread shading, skin blotchiness, wood grain, metal scratches
diffuseColor.rgb *= 1.0 + anyFab * (fB.b - 0.55) * 0.22 * sK;
diffuseColor.rgb *= 1.0 + isSkin * (fA.r - 0.5) * 0.12;
diffuseColor.rgb *= 1.0 + isWood * (hA.b - 0.5) * 0.55;
diffuseColor.rgb *= 1.0 + isMet * (smoothstep(0.85, 1.0, hA.r) * 0.6 - 0.05);
diffuseColor.rgb *= 1.0 + isLea * (fA.a - 0.5) * 0.25;
// dust and dirt collecting towards the ground on clothing and boots (characters stand at y = 0)
float sDust = (1.0 - smoothstep(0.04, 0.6, vBPos.y)) * (anyFab + isLea) * 0.3;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.37, 0.3) * (0.8 + 0.4 * fA.a), sDust);
float sH = anyFab * (fB.b * 0.28 + fA.a * 0.72 * sK + isWeb * webRow * 1.2 + isWeb * webStitch * 0.3)
         + isSkin * hA.g * 0.35
         + isRub * hA.a * 1.2
         + isMet * hA.r * 0.25
         + isPoly * hA.g * 0.6
         + isWood * hA.b * 0.35
         + isPaint * hA.g * 0.12
         + isLea * (hA.g * 0.3 + fA.a * 0.6);
float sRough = 1.0 + anyFab * (fB.b - 0.5) * 0.15 + isMet * (hA.r - 0.5) * 0.5 + isPoly * (hA.g - 0.3) * 0.3 + isSkin * (hA.g - 0.4) * 0.3;
float sBump = anyFab * 1.6 + isSkin * 0.9 + isRub * 2.5 + isMet * 0.8 + isPoly * 1.2 + isWood * 0.8 + isPaint * 0.6 + isLea * 1.4;
`;

let bakedMat = null;
export function bakedMaterial() {
  if (bakedMat) return bakedMat;
  const tex = detailTextures();
  bakedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  bakedMat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetailFabric = { value: tex.fabric };
    sh.uniforms.uDetailHard = { value: tex.hard };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + SHADER_VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vCol2 = aCol2; vTex = aTex; vBPos = position; vBNrm = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SHADER_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + SHADER_SURFACE)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(vMat.x * sRough, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMat.y;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = perturbNormalDeriv(-vViewPosition, normal, vec2(dFdx(sH), dFdy(sH)) * sBump, faceDirection);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vMat.z;');
  };
  bakedMat.customProgramCacheKey = () => 'baked-surface-v2';
  return bakedMat;
}

// ------------------------------------------------------------------ geometry builder

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

function toColor(out, c) {
  if (c === undefined || c === null) return out.setRGB(1, 1, 1);
  if (c.isColor) return out.copy(c);
  return out.set(c);
}

export function localMatrix(o = {}) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(o.p || [0, 0, 0]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray([...(o.r || [0, 0, 0]), 'XYZ'])),
    new THREE.Vector3().fromArray(o.s || [1, 1, 1]),
  );
}

// Accumulates geometry in bind-pose space with skin weights and surface attributes.
// Weights: [[bone, w], ...] (bones are THREE.Bone objects or indices).
export class Builder {
  constructor(bones = null) {
    this.bones = bones;
    this.pos = []; this.nor = []; this.col = []; this.col2 = []; this.mat = []; this.tex = [];
    this.si = []; this.sw = []; this.idx = [];
  }

  boneIndex(b) {
    if (typeof b === 'number') return b;
    return this.bones ? Math.max(0, this.bones.indexOf(b)) : 0;
  }

  pushWeights(w) {
    const list = (w || [[0, 1]]).map(([b, k]) => [this.boneIndex(b), k]).filter((e) => e[1] > 0);
    list.sort((a, b) => b[1] - a[1]);
    const top = list.slice(0, 4);
    const sum = top.reduce((s, e) => s + e[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.si.push(top[k] ? top[k][0] : 0);
      this.sw.push(top[k] ? top[k][1] / sum : 0);
    }
  }

  pushAttrs(color, o, local, vc = null) {
    if (vc) _c.copy(vc); else toColor(_c, typeof color === 'function' ? color(local) : color);
    toColor(_c2, o.color2 ?? color);
    this.col.push(_c.r, _c.g, _c.b);
    this.col2.push(_c2.r, _c2.g, _c2.b);
    this.mat.push(o.rough ?? 0.8, o.metal ?? 0, o.emit ?? 0);
    this.tex.push(o.tex ?? 0, o.texK ?? 1);
  }

  // Add a geometry. o: { bone, p, r, s (local transform on the bone), matrix (instead of bone),
  //   color (hex | Color | fn(localPos)), color2, rough, metal, emit, tex, texK,
  //   weights ([[bone,w]] or fn(bindPos, localPos) -> [[bone,w]]) }
  add(geo, o = {}) {
    const g = geo;
    const P = g.attributes.position, N = g.attributes.normal;
    const local = localMatrix(o);
    const world = o.matrix ? o.matrix.clone().multiply(local) : (o.bone ? o.bone.matrixWorld.clone().multiply(local) : local);
    _nm.getNormalMatrix(world);
    const base = this.pos.length / 3;
    const loc = new THREE.Vector3();
    const VC = o.vertexColors ? g.attributes.color : null;
    const vc = new THREE.Color();
    for (let i = 0; i < P.count; i++) {
      loc.fromBufferAttribute(P, i);
      _v.copy(loc).applyMatrix4(world);
      this.pos.push(_v.x, _v.y, _v.z);
      _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      this.nor.push(_n.x, _n.y, _n.z);
      if (VC) vc.setRGB(VC.getX(i), VC.getY(i), VC.getZ(i));
      this.pushAttrs(o.color, o, loc, VC ? vc : null);
      const w = typeof o.weights === 'function' ? o.weights(_v, loc) : (o.weights || (o.bone ? [[o.bone, 1]] : [[0, 1]]));
      this.pushWeights(w);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    g.dispose();
  }

  // Loft a tube through rings (bind space). ring: { c: Vector3, x: Vector3, z: Vector3 (unit axes of the
  // cross-section), rx, rz, n (superellipse exponent, 2 = ellipse), mod(theta) -> radius multiplier,
  // w: weights }. theta = 0 points along +x, PI/2 along +z. Caps close the ends.
  tube(rings, o = {}) {
    const seg = o.seg || 18;
    const base = this.pos.length / 3;
    const ringVerts = [];
    const jitter = o.jitter || 0;
    rings.forEach((R, ri) => {
      const n = R.n || 2;
      const verts = [];
      for (let k = 0; k <= seg; k++) {
        const th = (k / seg) * Math.PI * 2;
        const c = Math.cos(th), s = Math.sin(th);
        let px = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * R.rx;
        let pz = Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * R.rz;
        let m = R.mod ? R.mod(th) : 1;
        if (jitter) m *= 1 + (hash(ri * 7 + (o.seed || 0), k % seg, 5) - 0.5) * jitter;
        px *= m; pz *= m;
        const v = new THREE.Vector3().copy(R.c).addScaledVector(R.x, px).addScaledVector(R.z, pz);
        verts.push(v);
      }
      ringVerts.push(verts);
    });
    // positions
    for (let ri = 0; ri < rings.length; ri++) {
      for (let k = 0; k <= seg; k++) {
        const v = ringVerts[ri][k];
        this.pos.push(v.x, v.y, v.z);
        this.nor.push(0, 0, 0);
        this.pushAttrs(rings[ri].color ?? o.color, o, v);
        this.pushWeights(rings[ri].w);
      }
    }
    // outward faces need the rings to advance along cross(z, x); flip the winding otherwise
    const R0 = rings[0], R1 = rings[1];
    const adv = new THREE.Vector3().subVectors(R1.c, R0.c);
    const flip = (new THREE.Vector3().crossVectors(R0.z, R0.x).dot(adv) < 0) !== !!o.flip ? 1 : 0;
    for (let ri = 0; ri < rings.length - 1; ri++) {
      for (let k = 0; k < seg; k++) {
        const a = base + ri * (seg + 1) + k, b = a + 1, c = a + seg + 1, d = c + 1;
        if (flip) this.idx.push(a, b, c, b, d, c);
        else this.idx.push(a, c, b, b, c, d);
      }
    }
    // caps
    const cap = (ri, dirSign) => {
      const R = rings[ri];
      const ci = this.pos.length / 3;
      this.pos.push(R.c.x, R.c.y, R.c.z);
      this.nor.push(0, 0, 0);
      this.pushAttrs(R.color ?? o.color, o, R.c);
      this.pushWeights(R.w);
      for (let k = 0; k < seg; k++) {
        const a = base + ri * (seg + 1) + k, b = a + 1;
        if ((dirSign > 0) !== !!flip) this.idx.push(ci, a, b); else this.idx.push(ci, b, a);
      }
    };
    if (o.capStart) cap(0, 1);
    if (o.capEnd) cap(rings.length - 1, -1);
    this.smoothNormals(base, this.pos.length / 3, seg);
  }

  // A flat strap along a path (bind space). pts: Vector3[], ups: Vector3[] (surface normal at each
  // point), width, thick, weights: per-point weights.
  strap(pts, ups, width, thick, o = {}) {
    if (o.bone) {
      const m = o.bone.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(m);
      pts = pts.map((p) => p.clone().applyMatrix4(m));
      ups = ups.map((u) => u.clone().applyMatrix3(nm).normalize());
    }
    const base = this.pos.length / 3;
    const n = pts.length;
    const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]; // across, out
    for (let i = 0; i < n; i++) {
      const t = new THREE.Vector3().subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      const up = ups[i].clone().addScaledVector(t, -ups[i].dot(t)).normalize();
      const side = new THREE.Vector3().crossVectors(t, up).normalize();
      for (const [a, b] of corners) {
        const v = pts[i].clone().addScaledVector(side, a * width).addScaledVector(up, b * thick);
        this.pos.push(v.x, v.y, v.z);
        this.nor.push(0, 0, 0);
        this.pushAttrs(o.color, o, v);
        this.pushWeights(o.weights ? o.weights[i] : null);
      }
    }
    // 4 sides as quads between consecutive cross-sections
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < 4; s++) {
        const a = base + i * 4 + s, b = base + i * 4 + ((s + 1) % 4), c = a + 4, d = b + 4;
        this.idx.push(a, c, b, b, c, d);
      }
    }
    const e = base + (n - 1) * 4;
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.idx.push(e, e + 2, e + 1, e, e + 3, e + 2);
    this.smoothNormals(base, this.pos.length / 3);
  }

  // Area-weighted normals for vertices [v0, v1) from the triangles that reference them. Vertices at the
  // same position on a tube seam (seg given) share their normal.
  smoothNormals(v0, v1, seg = 0) {
    const acc = new Float32Array((v1 - v0) * 3);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let t = 0; t < this.idx.length; t += 3) {
      const a = this.idx[t], b = this.idx[t + 1], c = this.idx[t + 2];
      if (a < v0 || b < v0 || c < v0 || a >= v1 || b >= v1 || c >= v1) continue;
      A.fromArray(this.pos, a * 3); B.fromArray(this.pos, b * 3); C.fromArray(this.pos, c * 3);
      e1.subVectors(B, A); e2.subVectors(C, A);
      const nx = e1.y * e2.z - e1.z * e2.y, ny = e1.z * e2.x - e1.x * e2.z, nz = e1.x * e2.y - e1.y * e2.x;
      for (const i of [a, b, c]) { const k = (i - v0) * 3; acc[k] += nx; acc[k + 1] += ny; acc[k + 2] += nz; }
    }
    if (seg) {
      // merge seam columns (k = 0 and k = seg) of each ring
      const rows = Math.floor((v1 - v0) / (seg + 1));
      for (let r = 0; r < rows; r++) {
        const i0 = r * (seg + 1), i1 = i0 + seg;
        for (let k = 0; k < 3; k++) { const s = acc[i0 * 3 + k] + acc[i1 * 3 + k]; acc[i0 * 3 + k] = s; acc[i1 * 3 + k] = s; }
      }
    }
    for (let i = 0; i < v1 - v0; i++) {
      const x = acc[i * 3], y = acc[i * 3 + 1], z = acc[i * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      this.nor[(v0 + i) * 3] = x / l; this.nor[(v0 + i) * 3 + 1] = y / l; this.nor[(v0 + i) * 3 + 2] = z / l;
    }
  }

  build(skinned = true) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('aCol2', new THREE.Float32BufferAttribute(this.col2, 3));
    geo.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 3));
    geo.setAttribute('aTex', new THREE.Float32BufferAttribute(this.tex, 2));
    if (skinned) {
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    }
    const nv = this.pos.length / 3;
    geo.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    geo.computeBoundingSphere();
    return geo;
  }
}

// ------------------------------------------------------------------ primitives (local space)

const sgnPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

// Superellipsoid: e1 (vertical) and e2 (horizontal) roundness; ~0.1 = box with soft edges, 1 = ellipsoid.
// bend: z offset per x^2 (wraps a flat pouch around a curved body), taper: width scale at the top.
export function superEllipsoid(a, b, c, e1 = 0.3, e2 = 0.3, ws = 16, hs = 10, o = {}) {
  // fewer segments on small parts: detail where it can be seen
  const size = Math.max(a, b, c);
  ws = Math.min(ws, Math.max(6, Math.round(size * 200)));
  hs = Math.min(hs, Math.max(4, Math.round(size * 130)));
  const pos = [], nor = [], idx = [];
  for (let j = 0; j <= hs; j++) {
    const v = -Math.PI / 2 + (j / hs) * Math.PI;
    const cv = Math.cos(v), sv = Math.sin(v);
    for (let i = 0; i <= ws; i++) {
      const u = -Math.PI + (i / ws) * Math.PI * 2;
      const cu = Math.cos(u), su = Math.sin(u);
      let x = a * sgnPow(cv, e1) * sgnPow(cu, e2);
      const y = b * sgnPow(sv, e1);
      let z = c * sgnPow(cv, e1) * sgnPow(su, e2);
      let nx = sgnPow(cv, 2 - e1) * sgnPow(cu, 2 - e2) / a;
      let ny = sgnPow(sv, 2 - e1) / b;
      let nz = sgnPow(cv, 2 - e1) * sgnPow(su, 2 - e2) / c;
      if (o.taper) { const k = 1 + o.taper * (y / b); x *= k; }
      if (o.bend) { z += o.bend * x * x; nx += -2 * o.bend * x * nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      pos.push(x, y, z);
      nor.push(nx / l, ny / l, nz / l);
    }
  }
  for (let j = 0; j < hs; j++) {
    for (let i = 0; i < ws; i++) {
      const a0 = j * (ws + 1) + i, b0 = a0 + 1, c0 = a0 + ws + 1, d0 = c0 + 1;
      idx.push(a0, b0, c0, b0, d0, c0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  // the winding above faces inward for this parametrisation; flip
  const ix = g.index.array;
  for (let t = 0; t < ix.length; t += 3) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
  return g;
}

// Tube along a path in local space (cables, antennas, mic booms, straps with round section).
export function pathTube(points, radius, seg = 6) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, Math.max(4, Math.min(24, points.length * 2)), radius, seg, false);
}

// Average normals of vertices that share a position (hides UV seams after deforming a sphere).
export function weldNormals(geo) {
  const P = geo.attributes.position, N = geo.attributes.normal;
  const map = new Map();
  for (let i = 0; i < P.count; i++) {
    const k = `${Math.round(P.getX(i) * 1e4)},${Math.round(P.getY(i) * 1e4)},${Math.round(P.getZ(i) * 1e4)}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  }
  for (const ids of map.values()) {
    if (ids.length < 2) continue;
    let x = 0, y = 0, z = 0;
    for (const i of ids) { x += N.getX(i); y += N.getY(i); z += N.getZ(i); }
    const l = Math.hypot(x, y, z) || 1;
    for (const i of ids) N.setXYZ(i, x / l, y / l, z / l);
  }
  return geo;
}


export { hash as surfHash };
