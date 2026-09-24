// Procedural PBR textures (albedo, normal, roughness/metalness) generated at load time, in parallel
// Web Workers when the browser allows it.

import * as THREE from 'three';
import { Noise, MATERIAL_DEFS, generateTextureData, textureSizeFor, clamp01, smooth } from './texgen.js';

export { MATERIAL_DEFS };

// Wrap generated texture data (texgen.js) in three.js textures.
function toTextures(d, aniso) {
  const S = d.size;
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
  return { map: mk(d.albedo, true), normalMap: mk(d.normal, false), roughnessMap: mk(d.rough, false), emissiveMap: d.emissive ? mk(d.emissive, true) : null };
}

// ------------------------------------------------------------------ macro variation
// Large-scale brightness/roughness variation in world space so tiling textures don't repeat visibly.
let macroTex = null;
function getMacroTex() {
  if (macroTex) return macroTex;
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const n1 = new Noise(4242), n2 = new Noise(777);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const i = (y * S + x) * 4;
      data[i] = n1.fbm(u, v, 4, 3) * 255;
      data[i + 1] = n2.fbm(u, v, 4, 6) * 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  macroTex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  macroTex.wrapS = macroTex.wrapT = THREE.RepeatWrapping;
  macroTex.magFilter = THREE.LinearFilter;
  macroTex.minFilter = THREE.LinearMipmapLinearFilter;
  macroTex.generateMipmaps = true;
  macroTex.needsUpdate = true;
  return macroTex;
}

// Parallax occlusion mapping: march the view ray through the height field (roughness alpha) in
// tangent space built from screen-space derivatives, then sample every map at the hit point.
// Fades out with distance so only nearby surfaces pay for it.
const POM_CODE = /* glsl */`
vec2 pomUv = vMapUv;
{
  vec3 pV = normalize(vViewPosition);
  vec3 pN = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 dp1 = dFdx(-vViewPosition), dp2 = dFdy(-vViewPosition);
  vec2 duv1 = dFdx(vMapUv), duv2 = dFdy(vMapUv);
  vec3 dp2perp = cross(dp2, pN), dp1perp = cross(pN, dp1);
  vec3 pT = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 pB = dp2perp * duv1.y + dp1perp * duv2.y;
  float pInv = inversesqrt(max(max(dot(pT, pT), dot(pB, pB)), 1e-24));
  pT *= pInv; pB *= pInv;
  vec3 vt = vec3(dot(pV, pT), dot(pV, pB), dot(pV, pN));
  float pFade = 1.0 - smoothstep(10.0, 22.0, length(vViewPosition));
  if (pFade > 0.01 && vt.z > 0.05) {
    float steps = floor(mix(28.0, 8.0, clamp(vt.z, 0.0, 1.0)));
    float layer = 1.0 / steps;
    vec2 delta = vt.xy / max(vt.z, 0.25) * uPomScale * pFade * layer;
    vec2 uv = vMapUv;
    float cur = 0.0;
    float depth = 1.0 - textureGrad(roughnessMap, uv, duv1, duv2).a;
    for (int i = 0; i < 28; i++) {
      if (cur >= depth) break;
      uv -= delta;
      depth = 1.0 - textureGrad(roughnessMap, uv, duv1, duv2).a;
      cur += layer;
    }
    vec2 prev = uv + delta;
    float after = depth - cur;
    float before = (1.0 - textureGrad(roughnessMap, prev, duv1, duv2).a) - cur + layer;
    pomUv = mix(uv, prev, clamp(after / (after - before + 1e-5), 0.0, 1.0));
  }
}
`;

function pomPatch(sh, scale) {
  sh.uniforms.uPomScale = { value: scale };
  const chunk = (name, from) => THREE.ShaderChunk[name].split(from).join('pomUv');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uPomScale;')
    .replace('#include <map_fragment>', POM_CODE + chunk('map_fragment', 'vMapUv'))
    .replace('#include <roughnessmap_fragment>', chunk('roughnessmap_fragment', 'vRoughnessMapUv'))
    .replace('#include <metalnessmap_fragment>', chunk('metalnessmap_fragment', 'vMetalnessMapUv'))
    .replace('#include <normal_fragment_maps>', chunk('normal_fragment_maps', 'vNormalMapUv'));
}

export function addMacroVariation(m, pomScale = 0) {
  const tex = getMacroTex();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMacroTex = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;\nvarying vec3 vMacroNrm;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 macroM = modelMatrix;
        #ifdef USE_INSTANCING
          macroM = modelMatrix * instanceMatrix;
        #endif
        vMacroPos = (macroM * vec4(transformed, 1.0)).xyz;
        vMacroNrm = normalize(mat3(macroM) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uMacroTex;\nvarying vec3 vMacroPos;\nvarying vec3 vMacroNrm;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 macroA = abs(vMacroNrm);
        vec2 macroUV = macroA.y > max(macroA.x, macroA.z) ? vMacroPos.xz : (macroA.x > macroA.z ? vMacroPos.zy : vMacroPos.xy);
        float macroN1 = texture2D(uMacroTex, macroUV * 0.019).r;
        float macroN2 = texture2D(uMacroTex, macroUV * 0.071).g;
        diffuseColor.rgb *= mix(0.8, 1.14, macroN1) * mix(0.92, 1.06, macroN2);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * mix(0.86, 1.1, macroN2), 0.04, 1.0);`);
    if (pomScale) pomPatch(sh, pomScale);
    specOcclusion(sh);
  };
  m.customProgramCacheKey = () => (pomScale ? 'macro-variation-pom' : 'macro-variation');
}

function addPom(m, pomScale) {
  m.onBeforeCompile = (sh) => { pomPatch(sh, pomScale); specOcclusion(sh); };
  m.customProgramCacheKey = () => 'pom';
}

// Light bounced around inside rooms, set per map (setupEnvironment). The outdoor probe only reaches
// interiors through their openings, which left ceilings nearly black; real rooms are filled by light
// bouncing off the floor and walls.
export const ROOM_BOUNCE = { value: new THREE.Color(0, 0, 0) };

// The baked vertex colour is an ambient-occlusion term (interiors, wall bases); apply it to the sky
// reflections too so glossy floors indoors don't mirror a bright sky. Vertex alpha 0 marks indoor
// surfaces, which get the room bounce light (a little more on ceilings, lit from the floor).
function specOcclusion(sh) {
  sh.uniforms.uRoomBounce = ROOM_BOUNCE;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uRoomBounce;')
    .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
    #ifdef USE_COLOR_ALPHA
      irradiance += uRoomBounce * ( 1.0 - vColor.a ) * ( 0.85 - 0.15 * inverseTransformDirection( geometryNormal, viewMatrix ).y );
    #endif`)
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>
    #ifdef USE_COLOR
      reflectedLight.indirectSpecular *= mix(1.0, smoothstep(0.35, 1.0, vColor.g), 0.85);
    #endif`);
}

function addSpecOcclusion(m) {
  m.onBeforeCompile = (sh) => specOcclusion(sh);
  m.customProgramCacheKey = () => 'spec-occlusion';
}

// A few module workers that generate texture data in parallel (one material per job).
class TexturePool {
  static get() {
    if (TexturePool.failed || typeof Worker === 'undefined') return null;
    if (!TexturePool.inst) {
      try { TexturePool.inst = new TexturePool(); } catch { TexturePool.failed = true; return null; }
    }
    return TexturePool.inst;
  }

  constructor() {
    const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    this.jobs = new Map();
    this.nextId = 1;
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./texworker.js', import.meta.url), { type: 'module' });
      w.busy = 0;
      w.onmessage = (e) => {
        const job = this.jobs.get(e.data.id);
        if (!job) return;
        this.jobs.delete(e.data.id);
        w.busy--;
        if (e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data);
      };
      w.onerror = (e) => {
        // a worker that can't start (old browser, blocked) fails its jobs; callers fall back to the main thread
        e.preventDefault?.();
        TexturePool.failed = true;
        for (const [id, job] of this.jobs) if (job.w === w) { this.jobs.delete(id); job.reject(new Error('texture worker failed')); }
      };
      this.workers.push(w);
    }
  }

  run(name, size) {
    const w = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
    const id = this.nextId++;
    w.busy++;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject, w });
      w.postMessage({ id, name, size });
    });
  }
}

export class TextureLibrary {
  constructor(renderer, quality) {
    this.renderer = renderer;
    const top = quality === 'epic' || quality === 'ultra';
    this.size = quality === 'epic' ? 2048 : top ? 1024 : quality === 'low' ? 256 : 512;
    this.smallSize = quality === 'epic' ? 1024 : 512; // cap for materials on smaller-scale surfaces and props
    this.aniso = Math.min(renderer.capabilities.getMaxAnisotropy(), top ? 16 : quality === 'high' ? 8 : 4);
    this.cache = new Map();
    this.materials = new Map();
  }

  textures(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    const tex = toTextures(generateTextureData(name, textureSizeFor(name, this.size, this.smallSize)), this.aniso);
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
    // parallax depth only on Ultra and Epic
    const pom = this.size >= 1024 && d.pom ? d.pom / (d.scale || 1) : 0;
    if ((d.scale ?? 3) >= 2 && this.size >= 512) addMacroVariation(m, pom);
    else if (pom) addPom(m, pom);
    else addSpecOcclusion(m);
    this.materials.set(name, m);
    return m;
  }

  // Warm up (generate) a list of materials. Texture data is made in parallel workers when possible;
  // anything they can't do is generated here, yielding between materials so the loading screen updates.
  async prepare(names, onProgress) {
    const todo = [...new Set(names)].filter((n) => !this.cache.has(n));
    let done = 0, shown = 0;
    const total = names.length;
    const report = (v) => { shown = Math.max(shown, v); onProgress?.(shown); };
    const pool = todo.length > 1 ? TexturePool.get() : null;
    if (pool) {
      await Promise.all(todo.map((n) => pool.run(n, textureSizeFor(n, this.size, this.smallSize)).then((d) => {
        if (!this.cache.has(n)) this.cache.set(n, toTextures(d, this.aniso));
        report(Math.min(0.95, ++done / total));
      }, () => {})));
    }
    let i = 0;
    for (const n of names) {
      const fresh = !this.cache.has(n);
      this.material(n);
      report(++i / total);
      if (fresh) await new Promise((r) => setTimeout(r, 0));
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
