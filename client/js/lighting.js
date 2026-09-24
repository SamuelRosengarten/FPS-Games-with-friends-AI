// Screen-space lighting pass for the temporal AA pipeline (Ultra / Epic), run on the jittered internal
// image before the resolve so its per-pixel noise is averaged away by the TAA history:
//
//  - Volumetric sunlight: every pixel marches its view ray through the air, looks up the sun's shadow
//    map at each step and adds the light scattered towards the camera by dust. Rays crossing sunlit
//    air between shadows form light shafts (doorways, windows, gaps between buildings) and the air
//    glows around the sun. Interiors are dustier than open air (from the map's roof layout).
//  - Screen-space reflections: glossy surfaces (tiles, puddles, water, polished metal) write their
//    smoothness into the colour target's alpha; for those pixels a reflected ray is traced through the
//    depth buffer and the colour it hits is blended in with Fresnel.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FS = /* glsl */`
  #include <packing>
  uniform sampler2D tColor;     // scene colour (after AO)
  uniform sampler2D tMask;      // scene colour target: alpha = 1 - reflectivity
  uniform sampler2D tDepth;
  uniform sampler2D tShadow;
  uniform sampler2D tRoof;      // r: roofed, g: roof height / 20 m
  uniform mat4 uProj, uInvProj, uCamWorld, uShadowMat;
  uniform vec3 uCamPos, uSunDir, uSunCol;
  uniform vec4 uRoofXf;         // x0, z0, 1/width, 1/depth
  uniform vec2 uSize;
  uniform float uFrame, uShadowOn, uRoofOn;
  uniform float uDensity, uIndoor, uHeight, uGround, uMaxDist;
  uniform int uDebug;           // 1: reflectivity mask, 2: reflections only, 3: scattered light only
  varying vec2 vUv;

  vec3 viewPos(vec2 uv, float z) {
    vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
  float ign(vec2 p, float k) { return fract(52.9829189 * fract(dot(p + 5.588238 * (uFrame + k), vec2(0.06711056, 0.00583715)))); }

#if VOL_STEPS > 0
  float sunVisible(vec3 p) {
    if (uShadowOn < 0.5) return 1.0;
    vec4 s = uShadowMat * vec4(p, 1.0);
    vec3 c = s.xyz / s.w;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    return step(c.z - 0.0008, unpackRGBAToDepth(texture2D(tShadow, c.xy)));
  }
  float density(vec3 p) {
    float d = uDensity * exp(-max(p.y - uGround, 0.0) / uHeight);
    if (uRoofOn > 0.5) {
      vec4 r = texture2D(tRoof, (p.xz - uRoofXf.xy) * uRoofXf.zw);
      d *= 1.0 + uIndoor * r.r * step(p.y, r.g * 20.0);
    }
    return d;
  }
#endif

#if SSR
  vec3 viewNormal(vec2 uv, vec3 p) {
    vec2 px = 1.0 / uSize;
    vec3 l = viewPos(uv - vec2(px.x, 0.0), texture2D(tDepth, uv - vec2(px.x, 0.0)).r);
    vec3 r = viewPos(uv + vec2(px.x, 0.0), texture2D(tDepth, uv + vec2(px.x, 0.0)).r);
    vec3 d = viewPos(uv - vec2(0.0, px.y), texture2D(tDepth, uv - vec2(0.0, px.y)).r);
    vec3 u = viewPos(uv + vec2(0.0, px.y), texture2D(tDepth, uv + vec2(0.0, px.y)).r);
    // take the neighbour on the same surface (smaller depth step) on each axis
    vec3 dx = abs(l.z - p.z) < abs(r.z - p.z) ? p - l : r - p;
    vec3 dy = abs(d.z - p.z) < abs(u.z - p.z) ? p - d : u - p;
    return normalize(cross(dx, dy));
  }
  vec2 project(vec3 p) { vec4 c = uProj * vec4(p, 1.0); return c.xy / c.w * 0.5 + 0.5; }
  float sceneZ(vec2 uv) { return viewPos(uv, texture2D(tDepth, uv).r).z; }
#endif

  void main() {
    vec3 col = texture2D(tColor, vUv).rgb;
    float z = texture2D(tDepth, vUv).r;
    vec3 dbg = vec3(0.0);
    vec3 vp = viewPos(vUv, z);

#if SSR
    float refl = 1.0 - texture2D(tMask, vUv).a;
    if (refl > 0.02 && z < 1.0) {
      vec3 n = viewNormal(vUv, vp);
      vec3 V = normalize(vp);
      vec3 R = reflect(V, n);
      // glossy blur: jitter the ray for less smooth surfaces (TAA averages the samples)
      float rough = clamp(1.0 - sqrt(refl), 0.0, 1.0);
      vec3 h = vec3(ign(gl_FragCoord.xy, 1.0), ign(gl_FragCoord.xy, 7.0), ign(gl_FragCoord.xy, 13.0)) - 0.5;
      R = normalize(R + h * rough * 0.35);
      float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(-V, n), 0.0, 1.0), 5.0);
      float w = refl * (0.15 + 0.85 * fres) * (1.0 - smoothstep(0.2, 0.6, R.z));
      if (w > 0.01) {
        float dist = -vp.z;
        float stepLen = 0.08 + dist * 0.012;
        float t = stepLen * (0.3 + ign(gl_FragCoord.xy, 3.0));
        float prevT = 0.0;
        float hitT = -1.0;
        vec2 hitUv = vec2(0.0);
        for (int i = 0; i < SSR_STEPS; i++) {
          vec3 p = vp + R * t;
          if (p.z > -0.05) break;
          vec2 uv = project(p);
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
          float dz = sceneZ(uv) - p.z; // > 0: the ray passed behind the surface
          if (dz > 0.0 && dz < 0.25 + t * 0.06) {
            // refine between the last two steps
            float a = prevT, b = t;
            for (int k = 0; k < 5; k++) {
              float m = 0.5 * (a + b);
              vec3 q = vp + R * m;
              if (sceneZ(project(q)) - q.z > 0.0) b = m; else a = m;
            }
            hitT = b;
            hitUv = project(vp + R * b);
            break;
          }
          prevT = t;
          t += stepLen;
          stepLen *= 1.18;
        }
        if (hitT > 0.0) {
          vec2 e = min(hitUv, 1.0 - hitUv);
          float conf = smoothstep(0.0, 0.07, min(e.x, e.y)) * (1.0 - smoothstep(18.0, 30.0, hitT));
          col = mix(col, texture2D(tColor, hitUv).rgb, w * conf);
          dbg = texture2D(tColor, hitUv).rgb * w * conf;
        }
      }
    }
#endif

#if VOL_STEPS > 0
    vec3 wp = (uCamWorld * vec4(vp, 1.0)).xyz;
    vec3 ray = wp - uCamPos;
    float dist = length(ray);
    vec3 dir = ray / max(dist, 1e-4);
    float len = min(dist, uMaxDist);
    // Henyey-Greenstein forward scattering plus a little isotropic scatter
    float g = 0.6, gg = g * g;
    float phase = 0.0796 * ((1.0 - gg) / pow(1.0 + gg - 2.0 * g * dot(dir, uSunDir), 1.5) * 0.8 + 0.2);
    float jit = ign(gl_FragCoord.xy, 0.0);
    float acc = 0.0, od = 0.0;
    for (int i = 0; i < VOL_STEPS; i++) {
      float a = float(i) / float(VOL_STEPS), b = float(i + 1) / float(VOL_STEPS);
      float t0 = len * a * a, t1 = len * b * b; // denser steps near the camera
      vec3 p = uCamPos + dir * mix(t0, t1, jit);
      float d = density(p);
      float seg = t1 - t0;
      acc += d * sunVisible(p) * seg * exp(-od);
      od += d * seg;
    }
    col = col * exp(-od * 0.25) + uSunCol * (acc * phase);
    if (uDebug == 3) dbg = uSunCol * (acc * phase) * 8.0;
#endif

    gl_FragColor = vec4(uDebug == 0 ? col : uDebug == 1 ? vec3(1.0 - texture2D(tMask, vUv).a) : dbg, 1.0);
  }
`;

export class ScreenLighting {
  constructor({ volSteps = 16, ssr = true } = {}) {
    this.volSteps = volSteps;
    this.ssr = ssr;
    this.mat = new THREE.ShaderMaterial({
      defines: { VOL_STEPS: volSteps, SSR: ssr ? 1 : 0, SSR_STEPS: 28 },
      uniforms: {
        tColor: { value: null }, tMask: { value: null }, tDepth: { value: null }, tShadow: { value: null }, tRoof: { value: null },
        uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() }, uShadowMat: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
        uRoofXf: { value: new THREE.Vector4() }, uSize: { value: new THREE.Vector2(1, 1) },
        uFrame: { value: 0 }, uShadowOn: { value: 0 }, uRoofOn: { value: 0 },
        uDebug: { value: 0 }, uDensity: { value: 0.007 }, uIndoor: { value: 3 }, uHeight: { value: 18 }, uGround: { value: 0 }, uMaxDist: { value: 45 },
      },
      vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.roofTex = null;
    this.sun = null;
  }

  setSize(w, h) {
    this.rt.setSize(w, h);
    this.mat.uniforms.uSize.value.set(w, h);
  }

  // Per-map settings: roof layout (dustier air indoors) and the theme's haze.
  setMap(map, sun) {
    this.sun = sun;
    const u = this.mat.uniforms;
    const v = map.theme.volumetric || {};
    u.uDensity.value = v.density ?? 0.007;
    u.uIndoor.value = v.indoor ?? 3;
    u.uHeight.value = v.height ?? 18;
    u.uMaxDist.value = v.maxDist ?? 45;
    u.uGround.value = map.bounds.minY ?? 0;
    this.roofTex?.dispose();
    const { cols, rows } = map;
    const data = new Uint8Array(cols * rows * 4);
    const U = map.upper;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!map.roofed[r][c]) continue;
        const top = U && U.roofed[r][c] ? U.floorY + U.roofHeight : (U && U.grid[r][c] !== ' ' ? U.floorY : map.roofHeight);
        const i = (r * cols + c) * 4;
        data[i] = 255;
        data[i + 1] = Math.min(255, Math.round((top + 0.3) / 20 * 255));
      }
    }
    const t = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    this.roofTex = t;
    u.tRoof.value = t;
    u.uRoofOn.value = 1;
    u.uRoofXf.value.set(map.x0, map.z0, 1 / (cols * map.cellSize), 1 / (rows * map.cellSize));
  }

  // colorTex: scene colour after AO · maskTex: raw scene colour (alpha = 1 - reflectivity)
  render(renderer, camera, colorTex, maskTex, depthTex, frame) {
    const u = this.mat.uniforms;
    u.tColor.value = colorTex;
    u.tMask.value = maskTex;
    u.tDepth.value = depthTex;
    u.uProj.value.copy(camera.projectionMatrix);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    camera.getWorldPosition(u.uCamPos.value);
    u.uFrame.value = frame % 64;
    const sun = this.sun;
    if (sun) {
      u.uSunDir.value.copy(sun.position).sub(sun.target.position).normalize();
      u.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity);
      const map = sun.castShadow && sun.shadow.map;
      u.uShadowOn.value = map ? 1 : 0;
      u.tShadow.value = map ? map.texture : null;
      u.uShadowMat.value.copy(sun.shadow.matrix);
    }
    renderer.setRenderTarget(this.rt);
    this.quad.render(renderer);
    return this.rt.texture;
  }

  dispose() {
    this.mat.dispose();
    this.quad.dispose();
    this.rt.dispose();
    this.roofTex?.dispose();
  }
}
