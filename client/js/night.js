// Night matches: moonlight, a starry sky, dark haze and map lamps that matter, and weapon flashlights.
//
//  - nightTheme() turns a (possibly already rainy / foggy) map theme into its night version before the
//    environment is built, so the probe, shadows and bounce light are all dark.
//  - Your own flashlight is a shadow-casting spot light on the gun (T toggles it). Other players' lights
//    are spot lights from a small fixed pool (so shaders never recompile) given to the nearest lit
//    players, plus a visible beam in the air and a blinding glare when one points straight at you.

import * as THREE from 'three';
import { viewDir } from '../shared/constants.js';

const lerpHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

export function nightTheme(base) {
  const g = base.grade || {};
  const w = base.weather;
  const d = base.sun.dir;
  // a high moon: short, soft shadows
  const len = Math.hypot(d[0], d[2]) || 1;
  const moonDir = [d[0] / len * 0.55, 0.83, d[2] / len * 0.55];
  const overcast = w && (w.rain > 0 || w.id === 'fog');
  return {
    ...base,
    sun: { dir: moonDir, color: 0x9db4ff, intensity: overcast ? 0.1 : 0.24 },
    sunDisc: overcast ? 0 : 0.2,
    sunSize: 0.06,
    hemi: { sky: 0x2a3a5c, ground: 0x121316, intensity: base.hemi.intensity * (overcast ? 0.12 : 0.16) },
    skyTop: 0x01030a, skyHorizon: overcast ? 0x0b0f16 : 0x0d1728, skyBottom: 0x040509,
    cloudColor: overcast ? 0x10141b : 0x1f2838,
    stars: overcast ? 0 : 1,
    fog: overcast ? lerpHex(base.fog, 0x0a0d12, 0.9) : 0x0a1019,
    fogNear: Math.min(base.fogNear ?? 60, 8), fogFar: Math.min(base.fogFar ?? 260, overcast ? base.fogFar : 130),
    fogHeight: base.fogHeight ?? 40, fogMin: Math.max(base.fogMin ?? 0.45, 0.8), fogSky: Math.max(base.fogSky ?? 0, 0.2),
    exposure: (base.exposure ?? 1) * 1.05,
    adaptKey: 0.5, adaptMax: 3.4, // eyes adjust to the dark, but it stays night
    grade: {
      ...g,
      saturation: (g.saturation ?? 1.05) * 0.62,
      contrast: (g.contrast ?? 1.05) * 1.04,
      gain: (g.gain || [1, 1, 1]).map((v, i) => v * [0.88, 0.96, 1.12][i]),
      lift: [0.0, 0.004, 0.014],
      vignette: (g.vignette ?? 0.3) + 0.08,
    },
    volumetric: { ...(base.volumetric || {}), density: (base.volumetric?.density ?? 0.007) * 0.7, amb: 0.12 },
    roomBounce: 0.18,
    motes: null,
    lamps: 1.7, // map lights and lit windows count for more at night
    night: true,
  };
}

// ------------------------------------------------------------------ beams and glare

const BEAM_VS = /* glsl */`
  varying float vAlong;
  varying float vFacing;
  #include <fog_pars_vertex>
  void main() {
    vAlong = -position.z; // 0 at the lamp, 1 at the far end (geometry is unit length along -Z)
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mvPosition.xyz)));
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const BEAM_FS = /* glsl */`
  uniform vec3 uColor;
  uniform float uStrength;
  varying float vAlong;
  varying float vFacing;
  #include <fog_pars_fragment>
  void main() {
    // brightest along the core of the cone (the side the view looks through the most air)
    float a = pow(vFacing, 2.0) * pow(1.0 - vAlong, 1.6) * smoothstep(0.0, 0.04, vAlong) * uStrength;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <fog_fragment>
  }
`;

// Unit-length cone along -Z, narrow end at the origin (the lamp).
function beamGeometry(angle) {
  const g = new THREE.CylinderGeometry(0.03, Math.tan(angle), 1, 20, 1, true);
  g.translate(0, -0.5, 0);
  g.rotateX(Math.PI / 2);
  return g;
}

function glareTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.08, 'rgba(255,250,235,0.9)');
  gr.addColorStop(0.3, 'rgba(255,240,210,0.25)');
  gr.addColorStop(1, 'rgba(255,240,210,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  // thin horizontal flare
  const lg = x.createLinearGradient(0, 0, 128, 0);
  lg.addColorStop(0, 'rgba(200,220,255,0)'); lg.addColorStop(0.5, 'rgba(220,235,255,0.6)'); lg.addColorStop(1, 'rgba(200,220,255,0)');
  x.fillStyle = lg;
  x.fillRect(0, 62, 128, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Projected beam pattern for our own light: a hot centre, the reflector's ring and a wide dim spill.
function beamPattern() {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d');
  const img = x.createImageData(N, N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N * 2 - 1, v = (j + 0.5) / N * 2 - 1;
      const r = Math.hypot(u, v);
      const hot = Math.exp(-(r * r) / 0.035);
      const body = 1 - smooth(0.2, 0.5, r);
      const ring = Math.exp(-((r - 0.46) ** 2) / 0.004) * 0.1;
      const spill = (1 - smooth(0.45, 1.0, r)) * 0.16;
      const val = Math.min(1, hot * 0.6 + body * 0.45 + ring + spill);
      const k = (j * N + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(Math.pow(val, 1 / 2.2) * 255);
      img.data[k + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

const BEAM_ANGLE = 0.36;
const POOL = 3;
const MAX_BEAMS = 10;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = [0, 0, 0];

export class Flashlights {
  constructor(graphics, audio) {
    this.g = graphics;
    this.audio = audio;
    this.active = false;
  }

  // Call after the world exists. Only night matches get lights (their count is fixed for the match).
  setup(night, world, haze = 0) {
    this.dispose();
    this.active = night;
    if (!night) return;
    const g = this.g;
    this.world = world;
    // own flashlight: a bright, narrow spot on the gun with a soft edge, casting shadows
    const own = new THREE.SpotLight(0xfff0dc, 0, 42, BEAM_ANGLE * 1.45, 0.15, 1.4);
    own.castShadow = true;
    this.pattern = beamPattern();
    own.map = this.pattern; // (projected textures need the light's shadow map, so only our own light has one)
    own.shadow.mapSize.set(1024, 1024);
    own.shadow.camera.near = 0.2;
    own.shadow.camera.far = 42;
    own.shadow.bias = -0.0004;
    own.shadow.normalBias = 0.02;
    g.scene.add(own, own.target);
    this.own = own;
    // other players' lights
    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const l = new THREE.SpotLight(0xfff0dc, 0, 36, BEAM_ANGLE, 0.6, 1.4);
      g.scene.add(l, l.target);
      this.pool.push(l);
    }
    // beams in the air (stronger in rain and fog) and glare sprites
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(1, 0.95, 0.85) }, uStrength: { value: 0.12 + haze * 0.12 } }]),
      vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
    });
    const geo = beamGeometry(BEAM_ANGLE);
    this.beamGeo = geo;
    this.beams = [];
    this.glareTex = glareTexture();
    for (let i = 0; i < MAX_BEAMS; i++) {
      const m = new THREE.Mesh(geo, this.beamMat);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 6;
      m.userData.noAO = true;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glareTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false }));
      s.visible = false;
      s.renderOrder = 7;
      g.fxScene.add(m, s);
      this.beams.push({ m, s });
    }
    g.vmTorch.intensity = 0;
  }

  // on: own light state · eye: [x,y,z] · yaw/pitch of the local player (or null when dead)
  // remotes: [{ pos: Vector3 (lamp), yaw, pitch, id }] of other players whose light is on
  update(dt, local, remotes) {
    if (!this.active) return;
    const g = this.g, cam = g.camera;
    // own light rides on the gun: a little right of and below the eye, so shadows show some parallax
    if (local && local.on) {
      const right = _v.set(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = _v2.set(0, 1, 0).applyQuaternion(cam.quaternion);
      this.own.position.copy(cam.position).addScaledVector(right, 0.16).addScaledVector(up, -0.14);
      viewDir(local.yaw, local.pitch, _d);
      this.own.target.position.set(this.own.position.x + _d[0] * 10, this.own.position.y + _d[1] * 10, this.own.position.z + _d[2] * 10);
      this.own.intensity = 48;
      g.vmTorch.intensity = 0.6;
    } else {
      this.own.intensity = 0;
      g.vmTorch.intensity = 0;
    }
    // nearest lit players get the real lights, everyone lit gets a beam
    const camPos = cam.position;
    const sorted = remotes.map((r) => ({ r, d: r.pos.distanceToSquared(camPos) })).sort((a, b) => a.d - b.d);
    for (let i = 0; i < POOL; i++) {
      const l = this.pool[i];
      const e = sorted[i];
      if (!e) { l.intensity = 0; continue; }
      viewDir(e.r.yaw, e.r.pitch, _d);
      l.position.copy(e.r.pos);
      l.target.position.set(e.r.pos.x + _d[0] * 10, e.r.pos.y + _d[1] * 10, e.r.pos.z + _d[2] * 10);
      l.intensity = 34;
    }
    for (let i = 0; i < MAX_BEAMS; i++) {
      const { m, s } = this.beams[i];
      const e = sorted[i];
      if (!e) { m.visible = false; s.visible = false; continue; }
      const r = e.r;
      viewDir(r.yaw, r.pitch, _d);
      // the beam ends where it hits something
      const hit = this.world.raycast(r.pos.x, r.pos.y, r.pos.z, _d[0], _d[1], _d[2], 30);
      const len = hit ? Math.max(0.5, hit.t) : 30;
      m.position.copy(r.pos);
      m.lookAt(r.pos.x + _d[0], r.pos.y + _d[1], r.pos.z + _d[2]);
      m.rotateY(Math.PI); // geometry points along -Z; lookAt aims +Z
      m.scale.set(len, len, len);
      m.visible = true;
      // glare: a light pointing right at us is blinding
      const tx = camPos.x - r.pos.x, ty = camPos.y - r.pos.y, tz = camPos.z - r.pos.z;
      const dist = Math.hypot(tx, ty, tz) || 1;
      const align = (tx * _d[0] + ty * _d[1] + tz * _d[2]) / dist;
      let k = Math.max(0, (align - 0.86) / 0.14);
      if (k > 0 && !this.world.lineOfSight(camPos.x, camPos.y, camPos.z, r.pos.x, r.pos.y, r.pos.z)) k = 0;
      s.visible = k > 0.01;
      if (s.visible) {
        s.position.copy(r.pos);
        const size = (0.4 + 2.6 * k * k) * Math.min(1, 6 / dist + 0.5) * Math.min(dist, 25) * 0.12;
        s.scale.set(size * 2.2, size, 1);
        s.material.opacity = Math.min(1, 0.35 + k);
      }
    }
  }

  toggleSound() {
    if (!this.audio?.ok?.()) return;
    const a = this.audio, t = a.now, out = a.out(null);
    out.gain.value = 0.25;
    a.burst(out, t, { type: 'bandpass', freq: 3200, q: 3, peak: 0.6, decay: 0.03 });
    a.tone(out, t, { type: 'square', freq: 1800, to: 1400, peak: 0.08, decay: 0.02 });
    a.track(0.1);
  }

  dispose() {
    const g = this.g;
    if (this.own) { g.scene.remove(this.own, this.own.target); this.own.dispose(); this.own = null; }
    for (const l of this.pool || []) { g.scene.remove(l, l.target); l.dispose(); }
    this.pool = [];
    for (const { m, s } of this.beams || []) { g.fxScene.remove(m, s); s.material.dispose(); }
    this.beams = [];
    this.beamGeo?.dispose();
    this.beamMat?.dispose();
    this.glareTex?.dispose();
    this.pattern?.dispose();
    this.beamGeo = this.beamMat = this.glareTex = this.pattern = null;
    if (g.vmTorch) g.vmTorch.intensity = 0;
    this.active = false;
  }
}
