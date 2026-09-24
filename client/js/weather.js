// Weather: rain, thunderstorms and fog. The host picks it in the lobby and the server sends the result
// with the match, so everyone plays in the same conditions (bots see less far in fog too).
//
//  - weatherTheme() turns a map's sunny theme into an overcast / rainy / foggy one (sky, sun, fog, grade)
//    before the environment is set up, so the lighting probe and shadows match the weather.
//  - Rain: thousands of streaks in a box that follows the camera, blown by the wind and stopped by roofs
//    (from the map's roof layout), plus ripples where drops hit the ground. Outdoor surfaces get wet:
//    darker and glossy, so on Epic the streets reflect the world.
//  - Storm: heavier rain, gusty wind, lightning flashes with a bolt in the distance and thunder that
//    arrives later the further away the strike was.
//  - Fog: thick ground fog that hides players beyond ~40 m, with the sun a pale disc behind it.

import * as THREE from 'three';
import { makeRoofTexture, roofTransform } from './lighting.js';
import { WETNESS, RAIN_FX } from './textures.js';
import { WIND } from './decor.js';

const lerpHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

const LOOKS = {
  rain: {
    sun: 0.16, sunTint: [0xb8c4d0, 0.55], sunDisc: 0, sunSize: 0.12,
    hemiSky: [0x9aa6b4, 0.65], hemiGround: [0x4a4a48, 0.5], hemi: 1.3,
    sky: [0x5d6875, 0x8b949c, 0x6a6e70], cloud: 0x9ba2a9, cloudCover: 0.97, fogSky: 0.35,
    fog: [0x8c959c, 0.8], fogNear: 18, fogFar: 150, fogHeight: 60, fogMin: 0.82,
    exposure: 1.15, adaptKey: 0.55, sat: 0.78, contrast: 0.96, gain: [0.97, 1.0, 1.04],
    vol: { density: 0.009, hetero: 0.6, noiseScale: [0.045, 0.02, 0.045], amb: 0.35, ext: 1, mist: 0.8 }, clouds: 1.8,
    rain: 1, wet: 1, wind: [1.2, 0.4], windSway: 1.4, lightning: false,
  },
  storm: {
    sun: 0.09, sunTint: [0xa8b4c4, 0.7], sunDisc: 0, sunSize: 0.14,
    hemiSky: [0x7d8896, 0.75], hemiGround: [0x3a3a3a, 0.6], hemi: 1.05,
    sky: [0x363e48, 0x5f6770, 0x45484b], cloud: 0x6a7179, cloudCover: 1, fogSky: 0.5,
    fog: [0x68707a, 0.85], fogNear: 12, fogFar: 108, fogHeight: 55, fogMin: 0.92,
    exposure: 1.25, adaptKey: 0.35, sat: 0.68, contrast: 1.0, gain: [0.95, 0.99, 1.06],
    vol: { density: 0.011, hetero: 0.7, noiseScale: [0.04, 0.018, 0.04], amb: 0.3, ext: 1, mist: 1.4 }, clouds: 4,
    rain: 1.9, wet: 1, wind: [4.2, 1.6], windSway: 2.4, lightning: true,
  },
  fog: {
    sun: 0.42, sunTint: [0xe8e4dc, 0.5], sunDisc: 0.22, sunSize: 0.08,
    hemiSky: [0xc4c8cc, 0.6], hemiGround: [0x6a665e, 0.4], hemi: 1.1,
    sky: [0xa9afb4, 0xc3c6c6, 0xb0b2b0], cloud: 0xc8cbcc, cloudCover: 0.9, fogSky: 0.9,
    fog: [0xb8bcbc, 0.8], fogNear: 2, fogFar: 58, fogHeight: 26, fogMin: 0.97,
    exposure: 1.05, adaptKey: 0.9, sat: 0.84, contrast: 0.92, gain: [1.0, 1.0, 1.01],
    vol: { density: 0.018, hetero: 0.85, noiseScale: [0.035, 0.09, 0.035], amb: 0.5, ext: 1, mist: 0.5 }, clouds: 0.6,
    rain: 0, wet: 0.35, wind: [0.6, 0.2], windSway: 0.6, lightning: false,
  },
};

// A copy of the map theme adjusted for the weather (the clear-weather theme is returned as is).
export function weatherTheme(base, weather) {
  const L = LOOKS[weather];
  if (!L) return base;
  const g = base.grade || {};
  return {
    ...base,
    sun: { ...base.sun, color: lerpHex(base.sun.color, L.sunTint[0], L.sunTint[1]), intensity: base.sun.intensity * L.sun },
    sunDisc: L.sunDisc,
    sunSize: L.sunSize,
    hemi: {
      sky: lerpHex(base.hemi.sky, L.hemiSky[0], L.hemiSky[1]),
      ground: lerpHex(base.hemi.ground, L.hemiGround[0], L.hemiGround[1]),
      intensity: base.hemi.intensity * L.hemi,
    },
    skyTop: L.sky[0], skyHorizon: L.sky[1], skyBottom: L.sky[2],
    cloudColor: L.cloud, cloudCover: L.cloudCover, fogSky: L.fogSky,
    fog: lerpHex(base.fog, L.fog[0], L.fog[1]), fogNear: L.fogNear, fogFar: L.fogFar, fogHeight: L.fogHeight, fogMin: L.fogMin,
    skylineFogNear: base.fogNear, skylineFogFar: base.fogFar,
    exposure: (base.exposure ?? 1) * L.exposure,
    adaptKey: L.adaptKey, // storms are meant to look dark: the eye adapts less
    grade: {
      ...g,
      saturation: (g.saturation ?? 1.05) * L.sat,
      contrast: (g.contrast ?? 1.05) * L.contrast,
      gain: (g.gain || [1, 1, 1]).map((v, i) => v * L.gain[i]),
    },
    volumetric: { ...(base.volumetric || {}), ...L.vol }, // drifting fog banks / rain curtains (Ultra, Epic)
    cloudSpeed: L.clouds,
    motes: L.rain ? null : base.motes,
    weather: { id: weather, rain: L.rain, wet: L.wet, wind: L.wind, windSway: L.windSway, lightning: L.lightning },
  };
}

// ------------------------------------------------------------------ rain streaks

const RAIN_VS = /* glsl */`
  uniform vec3 uCam, uBox, uVel;
  uniform float uTime, uLen, uWidth, uPx, uRoofOn;
  uniform sampler2D tRoof;
  uniform vec4 uRoofXf;
  attribute vec4 aSeed;
  varying float vA;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    // bigger drops fall faster, look longer and catch more light
    float size = aSeed.w;
    vec3 vel = uVel * (0.8 + 0.4 * size);
    vec3 p = aSeed.xyz * uBox + vel * uTime;
    p = uCam + mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5; // wrap into the box around the camera
    float hide = p.y < -0.3 ? 1.0 : 0.0;
    if (uRoofOn > 0.5) {
      vec4 r = texture2D(tRoof, (p.xz - uRoofXf.xy) * uRoofXf.zw);
      if (r.r > 0.5 && p.y < r.g * 20.0 + 0.3) hide = 1.0; // under a roof: dry
    }
    vec3 dir = normalize(vel);
    vec3 toCam = cameraPosition - p;
    float dist = length(toCam);
    vec3 side = normalize(cross(dir, toCam / max(dist, 1e-3)));
    // streaks thinner than ~1.3 px are drawn 1.3 px wide and fainter instead (no shimmering)
    float width = uWidth * (0.6 + 0.8 * size);
    float px = width * uPx / max(dist, 0.1);
    float w = width * max(1.0, 1.3 / max(px, 1e-3));
    float glint = 0.55 + 0.9 * fract(size * 7.13 + aSeed.x * 3.1);
    vA = (1.0 - hide) * min(1.0, px / 1.3 + 0.25) * smoothstep(0.3, 1.2, dist) * glint;
    vec3 pos = p + side * position.x * w + dir * position.y * uLen * (0.7 + 0.6 * size);
    vUv = position.xy;
    vec4 mvPosition = viewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    if (hide > 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    #include <fog_vertex>
  }
`;

const RAIN_FS = /* glsl */`
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vA;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    float across = 1.0 - abs(vUv.x);
    float along = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
    float a = across * across * along * uAlpha * vA;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    #include <fog_fragment>
  }
`;

class Rain {
  constructor(count, roofTex, roofXf) {
    const base = new THREE.InstancedBufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    base.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    base.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    base.instanceCount = count;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(34, 22, 34) }, uVel: { value: new THREE.Vector3(0, -9, 0) },
        uTime: { value: 0 }, uLen: { value: 0.5 }, uWidth: { value: 0.006 }, uPx: { value: 800 },
        uRoofOn: { value: roofTex ? 1 : 0 }, tRoof: { value: roofTex }, uRoofXf: { value: roofXf || new THREE.Vector4() },
        uColor: { value: new THREE.Color(0.7, 0.75, 0.8) }, uAlpha: { value: 0.32 },
      }]),
      vertexShader: RAIN_VS, fragmentShader: RAIN_FS,
      transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    });
    this.mat.uniforms.tRoof.value = roofTex;
    this.mat.uniforms.uRoofXf.value = roofXf || new THREE.Vector4();
    this.mesh = new THREE.Mesh(base, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.userData.noAO = true;
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

// ------------------------------------------------------------------ ripples where drops land

const RIPPLE_VS = /* glsl */`
  uniform float uTime;
  attribute vec4 aData; // x, y, z, birth time
  varying float vAge;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vAge = clamp((uTime - aData.w) / 0.4, 0.0, 1.0);
    float r = 0.03 + vAge * 0.13;
    vec3 p = aData.xyz + vec3(position.x * r, 0.015, position.y * r);
    vUv = position.xy;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    if (vAge >= 1.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    #include <fog_vertex>
  }
`;
const RIPPLE_FS = /* glsl */`
  uniform vec3 uColor;
  varying float vAge;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    float d = length(vUv);
    float ring = smoothstep(0.62, 0.86, d) * smoothstep(1.0, 0.88, d);
    float a = ring * (1.0 - vAge) * 0.45;
    if (a < 0.005) discard;
    gl_FragColor = vec4(uColor, a);
    #include <fog_fragment>
  }
`;

// A crown of droplets thrown up where a drop hits hard ground (camera-facing).
const CROWN_VS = /* glsl */`
  uniform float uTime;
  attribute vec4 aData;
  varying float vAge, vSeed;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vAge = clamp((uTime - aData.w) / 0.3, 0.0, 1.0);
    vSeed = fract(aData.x * 13.13 + aData.z * 7.71);
    vec3 c = aData.xyz;
    vec3 toCam = normalize(cameraPosition - c);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    vec3 p = c + right * position.x * 0.07 + vec3(0.0, (position.y * 0.5 + 0.5) * 0.08, 0.0);
    vUv = vec2(position.x, position.y * 0.5 + 0.5);
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    if (vAge >= 1.0 || length(cameraPosition - c) > 9.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    #include <fog_vertex>
  }
`;
const CROWN_FS = /* glsl */`
  uniform vec3 uColor;
  varying float vAge, vSeed;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    float a = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float spread = (fract(vSeed * 5.3 + fi * 0.618) * 2.0 - 1.0) * 0.9;
      float up = 0.45 + 0.55 * fract(vSeed * 9.1 + fi * 0.37);
      vec2 d = vec2(spread * vAge, up * 3.6 * vAge * (1.0 - vAge));
      a += smoothstep(0.1, 0.03, length((vUv - d) * vec2(1.0, 1.15)));
    }
    a *= (1.0 - vAge) * 0.7;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, min(a, 0.9));
    #include <fog_fragment>
  }
`;

class Ripples {
  constructor(max) {
    this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    this.data = new Float32Array(max * 4).fill(-100);
    this.attr = new THREE.InstancedBufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aData', this.attr);
    g.instanceCount = max;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.8, 0.85, 0.9) } }]),
      vertexShader: RIPPLE_VS, fragmentShader: RIPPLE_FS, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    // droplet crowns share the splash data
    const g2 = new THREE.InstancedBufferGeometry();
    g2.setAttribute('position', g.attributes.position);
    g2.setIndex([0, 1, 2, 0, 2, 3]);
    g2.setAttribute('aData', this.attr);
    g2.instanceCount = max;
    this.crownMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.8, 0.85, 0.9) } }]),
      vertexShader: CROWN_VS, fragmentShader: CROWN_FS, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    });
    this.crowns = new THREE.Mesh(g2, this.crownMat);
    this.crowns.frustumCulled = false;
    this.crowns.renderOrder = 4;
    this.mesh.add(this.crowns);
    this.idx = 0;
    this.acc = 0;
  }
  spawn(x, y, z, t) {
    const i = this.idx++ % this.max;
    this.data.set([x, y, z, t], i * 4);
    this.dirty = true;
  }
  flush() {
    if (!this.dirty) return;
    this.attr.needsUpdate = true;
    this.dirty = false;
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.crowns.geometry.dispose(); this.crownMat.dispose(); }
}

// ------------------------------------------------------------------ lightning bolt

function boltGeometry(x, z, top, k, rand) {
  const pos = [];
  const seg = (ax, ay, az, bx, by, bz, w) => {
    // camera-independent ribbon: two crossed quads
    for (const [ox, oz] of [[w, 0], [0, w]]) {
      pos.push(ax - ox, ay, az - oz, ax + ox, ay, az + oz, bx + ox, by, bz + oz);
      pos.push(ax - ox, ay, az - oz, bx + ox, by, bz + oz, bx - ox, by, bz - oz);
    }
  };
  const branch = (sx, sy, sz, len, w, depth) => {
    let px = sx, py = sy, pz = sz;
    const steps = Math.max(4, Math.round(len / (14 * k)));
    for (let i = 0; i < steps; i++) {
      const nx = px + (rand() - 0.5) * 16 * k, ny = py - len / steps * (0.7 + rand() * 0.6), nz = pz + (rand() - 0.5) * 16 * k;
      seg(px, py, pz, nx, Math.max(0, ny), nz, w);
      if (depth < 2 && rand() < 0.22) branch(nx, ny, nz, len * 0.35, w * 0.55, depth + 1);
      px = nx; py = ny; pz = nz;
      if (py <= 0) break;
    }
  };
  branch(x, top, z, top, 2 * k, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// ------------------------------------------------------------------ weather controller

export class Weather {
  constructor(graphics, audio) {
    this.g = graphics;
    this.audio = audio;
    this.id = 'clear';
    this.rain = null;
    this.ripples = null;
    this.bolt = null;
    this.flash = 0;
    this.pulses = [];
    this.nextStrike = 0;
    this.t = 0;
  }

  // Call after setupEnvironment (the theme must already be the weather theme) and once the world exists.
  setup(map, world) {
    this.dispose();
    const w = map.theme.weather;
    this.map = map;
    this.world = world;
    this.cfg = w || null;
    this.id = w?.id || 'clear';
    WETNESS.value = w?.wet ?? 0;
    RAIN_FX.value.x = w?.rain ?? 0;
    WIND.speed = w ? 0.8 + w.windSway * 0.5 : 1;
    WIND.amp.value = w?.windSway ?? 1;
    const g = this.g;
    this.baseHemi = g.hemi.intensity;
    this.baseSky = g.sky?.material.uniforms.uIntensity.value ?? 1;
    this.baseSun = { pos: g.sun.position.clone(), color: g.sun.color.clone(), intensity: g.sun.intensity, vm: g.vmSun.intensity };
    this.sunMoved = false;
    if (!w) return;
    const q = Math.max(0.35, g.preset.particles ?? 1);
    if (w.rain > 0) {
      this.roofTex = makeRoofTexture(map);
      this.rain = new Rain(Math.round(9000 * w.rain * q), this.roofTex, roofTransform(map));
      const u = this.rain.mat.uniforms;
      u.uVel.value.set(w.wind[0], -9.5 - w.rain * 1.2, w.wind[1]);
      u.uLen.value = 0.42 + w.rain * 0.12;
      u.uAlpha.value = 0.3 + w.rain * 0.05;
      this.ripples = new Ripples(Math.round(260 * q * w.rain));
      g.fxScene.add(this.rain.mesh, this.ripples.mesh);
    }
    if (w.lightning) {
      this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6.5, 8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
      this.nextStrike = 5 + Math.random() * 8;
    }
    this.audio?.startRain?.(w.rain, w.lightning);
    if (this.audio) this.audio.wetness = w.rain > 0 ? 1 : w.wet * 0.4;
  }

  strike() {
    if (!this.boltMat) return;
    const cam = this.g.camera.position;
    // far out beyond the skyline: the bolt shows against the sky above the horizon (buildings and hills
    // in front of it hide its lower part, like a real distant strike)
    const a = Math.random() * Math.PI * 2;
    const dist = 900 + Math.random() * 900;
    const x = cam.x + Math.cos(a) * dist, z = cam.z + Math.sin(a) * dist;
    const k = dist / 300;
    // the flash lights the scene from the strike's direction, high up in the clouds
    this.boltDir = new THREE.Vector3(Math.cos(a), 0.95 + Math.random() * 0.5, Math.sin(a)).normalize();
    if (this.bolt) { this.g.fxScene.remove(this.bolt); this.bolt.geometry.dispose(); }
    let s = Math.random() * 1e6;
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    this.bolt = new THREE.Mesh(boltGeometry(x, z, dist * (0.62 + Math.random() * 0.2), k, rand), this.boltMat);
    this.bolt.frustumCulled = false;
    this.g.fxScene.add(this.bolt);
    // two or three flickers
    const n = 2 + (Math.random() < 0.5 ? 1 : 0);
    let t = this.t;
    this.pulses = [];
    for (let i = 0; i < n; i++) {
      this.pulses.push({ t, dur: 0.06 + Math.random() * 0.07, k: i === 0 ? 1 : 0.5 + Math.random() * 0.5 });
      t += 0.08 + Math.random() * 0.12;
    }
    this.boltUntil = t + 0.05;
    // closer-feeling strikes (brighter flash) get a louder, sooner crack
    const strength = Math.random();
    this.audio?.thunder?.(0.3 + (1 - strength) * 2.6, strength);
    this.nextStrike = this.t + 7 + Math.random() * 16;
  }

  // indoor: 0..1 how much the listener / camera is under a roof
  update(dt, indoor = 0) {
    if (!this.cfg) return;
    this.t += dt;
    RAIN_FX.value.y = this.t % 1000;
    const g = this.g;
    const cam = g.camera.position;
    // gusts: the wind rises and falls instead of blowing steadily
    const t = this.t;
    const gust = Math.max(0, 0.55 + 0.3 * Math.sin(t * 0.23) * Math.sin(t * 0.61 + 1.7) + 0.25 * Math.sin(t * 1.3 + Math.sin(t * 0.4) * 2));
    WIND.amp.value = this.cfg.windSway * (0.55 + 0.8 * gust);
    if (this.rain) {
      const u = this.rain.mat.uniforms;
      u.uVel.value.x = this.cfg.wind[0] * (0.35 + 1.2 * gust);
      u.uVel.value.z = this.cfg.wind[1] * (0.35 + 1.2 * gust);
      u.uCam.value.copy(cam);
      u.uTime.value = this.t % 1000;
      u.uPx.value = g.canvas.height / (2 * Math.tan((g.vfovRad || 1.2) / 2));
      // the rain picks up the ambient light (and lightning)
      u.uColor.value.copy(g.hemi.color).multiplyScalar(0.55 * (g.hemi.intensity / Math.max(0.1, this.baseHemi)) + 0.12);
      this.ripples.mat.uniforms.uTime.value = this.t;
      this.ripples.mat.uniforms.uColor.value.copy(u.uColor.value).multiplyScalar(1.2);
      this.ripples.crownMat.uniforms.uTime.value = this.t;
      this.ripples.crownMat.uniforms.uColor.value.copy(u.uColor.value).multiplyScalar(1.5);
      // ripples on whatever surface is under the sky near the camera
      this.ripples.acc += dt * 170 * this.cfg.rain;
      let n = Math.min(12, Math.floor(this.ripples.acc));
      this.ripples.acc -= n;
      while (n-- > 0) {
        const r = Math.sqrt(Math.random()) * 13, a = Math.random() * Math.PI * 2;
        const x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
        const top = cam.y + 25;
        const y = this.world.groundBelow(x, top, z, 60);
        if (y > top - 59) this.ripples.spawn(x, y, z, this.t);
      }
      this.ripples.flush();
    }
    if (this.cfg.lightning) {
      if (this.t >= this.nextStrike) this.strike();
      let f = 0;
      for (const p of this.pulses) {
        const k = (this.t - p.t) / p.dur;
        if (k >= 0 && k < 3) f = Math.max(f, p.k * (k < 1 ? 1 : Math.exp(-(k - 1) * 3)));
      }
      this.flash = f;
      // the flash is a real light from the strike: hard, blue-white, casting sharp shadows (the sun's
      // shadow map is re-aimed for those few frames), with the sky lit up around the bolt
      const sun = g.sun;
      if (f > 0.02 && this.boltDir) {
        sun.position.copy(sun.target.position).addScaledVector(this.boltDir, 120);
        sun.color.setRGB(0.78, 0.85, 1.0);
        sun.intensity = this.baseSun.intensity + f * 4.5;
        this.sunMoved = true;
      } else if (this.sunMoved) {
        sun.position.copy(this.baseSun.pos);
        sun.color.copy(this.baseSun.color);
        sun.intensity = this.baseSun.intensity;
        this.sunMoved = false;
      }
      g.hemi.intensity = this.baseHemi * (1 + f * 1.2 * (1 - indoor * 0.6));
      if (g.sky) {
        const su = g.sky.material.uniforms;
        su.uIntensity.value = this.baseSky * (1 + f * 0.7);
        su.uFlash.value = f;
        if (this.boltDir) su.uFlashDir.value.copy(this.boltDir);
      }
      // (the weapon in hand follows the sun and sky lights: see Graphics.updateViewmodelLighting)
      if (this.bolt) this.bolt.visible = this.t < this.boltUntil && f > 0.05;
    }
    this.audio?.setRainIndoor?.(indoor);
  }

  dispose() {
    const g = this.g;
    if (this.rain) { g.fxScene.remove(this.rain.mesh); this.rain.dispose(); this.rain = null; }
    if (this.ripples) { g.fxScene.remove(this.ripples.mesh); this.ripples.dispose(); this.ripples = null; }
    if (this.bolt) { g.fxScene.remove(this.bolt); this.bolt.geometry.dispose(); this.bolt = null; }
    this.boltMat?.dispose();
    this.boltMat = null;
    this.roofTex?.dispose();
    this.roofTex = null;
    if (this.cfg?.lightning) {
      g.hemi.intensity = this.baseHemi;
      if (g.sky) { g.sky.material.uniforms.uIntensity.value = this.baseSky; g.sky.material.uniforms.uFlash.value = 0; }
      if (this.sunMoved) {
        g.sun.position.copy(this.baseSun.pos);
        g.sun.color.copy(this.baseSun.color);
        g.sun.intensity = this.baseSun.intensity;
        this.sunMoved = false;
      }
    }
    this.cfg = null;
    WETNESS.value = 0;
    RAIN_FX.value.x = 0;
    WIND.speed = 1;
    WIND.amp.value = 1;
    this.audio?.stopRain?.();
    if (this.audio) this.audio.wetness = 0;
  }
}
