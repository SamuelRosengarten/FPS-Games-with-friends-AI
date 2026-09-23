// Transient visual effects: particles, tracers, decals, debris, casings, smoke, explosions, flash lights
// and ambient dust. Everything lives in one group and is pooled/instanced, so the whole system costs a
// fixed handful of draw calls no matter how much is going on.

import * as THREE from 'three';
import { makeSoftSprite, makeSmokeSprite, makeBulletHole } from './textures.js';

const SURF_COLORS = {
  0: [0.62, 0.58, 0.52], // stone
  1: [0.55, 0.4, 0.25],  // wood
  2: [0.5, 0.5, 0.52],   // metal
  3: [0.78, 0.68, 0.5],  // sand
  4: [0.5, 0.03, 0.03],  // flesh
};

const PARTICLE_VS = /* glsl */`
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uScale;
  varying vec4 vColor;
  #include <fog_pars_vertex>
  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(aSize * uScale / max(0.05, -mvPosition.z), 256.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const PARTICLE_FS = /* glsl */`
  uniform sampler2D uMap;
  varying vec4 vColor;
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
    if (gl_FragColor.a < 0.01) discard;
    #include <fog_fragment>
  }
`;

class ParticleSystem {
  constructor(parent, max, additive, tex) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: tex }, uScale: { value: 400 } }]),
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.material.uniforms.uMap.value = tex;
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    parent.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, a, size, life, grav = 0, drag = 0, grow = 0) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.alpha0[i] = a;
    this.size[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap with last
        const last = --this.count;
        if (i !== last) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[last * 3 + k]; this.vel[i * 3 + k] = this.vel[last * 3 + k]; }
          for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.col[last * 4 + k];
          this.size[i] = this.size[last]; this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
          this.grav[i] = this.grav[last]; this.drag[i] = this.drag[last]; this.grow[i] = this.grow[last]; this.alpha0[i] = this.alpha0[last];
        }
        continue;
      }
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 2] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.col[i * 4 + 3] = this.alpha0[i] * Math.min(1, t * 2.5);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.count);
    if (this.count || this.wasActive) {
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
    }
    this.wasActive = this.count > 0;
  }
}

// ------------------------------------------------------------------ instanced decals (ring buffer)
const _dm = new THREE.Matrix4();
const _dq = new THREE.Quaternion();
const _dp = new THREE.Vector3();
const _ds = new THREE.Vector3();
const _dn = new THREE.Vector3();
const _dz = new THREE.Vector3(0, 0, 1);
const _dr = new THREE.Quaternion();
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

class DecalPool {
  constructor(parent, tex, max, { rough = 0.9, color = 0xffffff, offset = -4, metal = 0 } = {}) {
    const mat = new THREE.MeshStandardMaterial({
      map: tex, color, transparent: true, depthWrite: false, roughness: rough, metalness: metal,
      polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.userData.noAO = true;
    this.mesh.renderOrder = 1;
    this.max = max;
    this.idx = 0;
    this.pts = new Float32Array(max * 3).fill(1e9);
    parent.add(this.mesh);
  }

  add(p, n, size, color = null) {
    const i = this.idx++ % this.max;
    _dn.set(n[0], n[1], n[2]).normalize();
    _dq.setFromUnitVectors(_dz, _dn);
    _dq.multiply(_dr.setFromAxisAngle(_dz, Math.random() * Math.PI * 2));
    _dp.set(p[0] + _dn.x * 0.004, p[1] + _dn.y * 0.004, p[2] + _dn.z * 0.004);
    _dm.compose(_dp, _dq, _ds.set(size, size, size));
    this.mesh.setMatrixAt(i, _dm);
    if (color) this.mesh.setColorAt(i, color);
    this.pts[i * 3] = _dp.x; this.pts[i * 3 + 1] = _dp.y; this.pts[i * 3 + 2] = _dp.z;
    this.mesh.count = Math.min(this.max, Math.max(this.mesh.count, i + 1));
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  removeIn(box, pad = 0.02) {
    let changed = false;
    for (let i = 0; i < this.mesh.count; i++) {
      const x = this.pts[i * 3], y = this.pts[i * 3 + 1], z = this.pts[i * 3 + 2];
      if (x > box.min[0] - pad && x < box.max[0] + pad && y > box.min[1] - pad && y < box.max[1] + pad && z > box.min[2] - pad && z < box.max[2] + pad) {
        this.mesh.setMatrixAt(i, ZERO_M);
        this.pts[i * 3] = 1e9;
        changed = true;
      }
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.mesh.count = 0;
    this.idx = 0;
    this.pts.fill(1e9);
  }
}

// ------------------------------------------------------------------ instanced smoke billboards
const SMOKE_VS = /* glsl */`
  attribute vec4 aOff;   // world centre xyz, size
  attribute vec4 aRot;   // rotation, opacity, tint, ground height
  varying vec2 vUv;
  varying float vA;
  varying float vTint;
  varying float vH;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vA = aRot.y;
    vTint = aRot.z;
    float c = cos(aRot.x), s = sin(aRot.x);
    vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * aOff.w;
    vec4 mvPosition = viewMatrix * vec4(aOff.xyz, 1.0);
    mvPosition.xy += q;
    // world height of this corner (camera up = second row of the view matrix) for ground fade + shading
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vH = (aOff.xyz + camRight * q.x + camUp * q.y).y - aRot.w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const SMOKE_FS = /* glsl */`
  uniform sampler2D uMap;
  uniform vec3 uLight;
  varying vec2 vUv;
  varying float vA;
  varying float vTint;
  varying float vH;
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(uMap, vUv);
    // soften where the billboards cut into the floor
    float a = t.a * vA * smoothstep(-0.05, 0.7, vH);
    if (a < 0.004) discard;
    // lit from above: darker underside reads as volume
    float shade = mix(0.72, 1.06, clamp(vH / 4.0, 0.0, 1.0));
    gl_FragColor = vec4(t.rgb * vTint * shade * uLight, a);
    #include <fog_fragment>
  }
`;

class SmokeField {
  constructor(parent, tex, max) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    this.off = new Float32Array(max * 4);
    this.rot = new Float32Array(max * 4);
    this.offAttr = new THREE.InstancedBufferAttribute(this.off, 4).setUsage(THREE.DynamicDrawUsage);
    this.rotAttr = new THREE.InstancedBufferAttribute(this.rot, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOff', this.offAttr);
    geo.setAttribute('aRot', this.rotAttr);
    geo.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: tex }, uLight: { value: new THREE.Color(1, 1, 1) } }]),
      vertexShader: SMOKE_VS,
      fragmentShader: SMOKE_FS,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.material.uniforms.uMap.value = tex;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.userData.noAO = true;
    this.geo = geo;
    this.max = max;
    this.n = 0;
    parent.add(this.mesh);
  }
  begin() { this.n = 0; }
  push(x, y, z, size, rot, alpha, tint, ground) {
    if (this.n >= this.max || alpha <= 0.002) return;
    const i = this.n++;
    this.off[i * 4] = x; this.off[i * 4 + 1] = y; this.off[i * 4 + 2] = z; this.off[i * 4 + 3] = size;
    this.rot[i * 4] = rot; this.rot[i * 4 + 1] = alpha; this.rot[i * 4 + 2] = tint; this.rot[i * 4 + 3] = ground;
  }
  end() {
    this.geo.instanceCount = this.n;
    if (this.n || this.had) { this.offAttr.needsUpdate = true; this.rotAttr.needsUpdate = true; }
    this.had = this.n > 0;
  }
}

// ------------------------------------------------------------------ ambient dust motes (GPU-only)
const MOTES_VS = /* glsl */`
  uniform vec3 uCam;
  uniform float uTime, uBox, uScale, uSize;
  varying float vA;
  void main() {
    vec3 seed = position;
    vec3 p = seed * uBox;
    p += vec3(sin(uTime * 0.13 + seed.y * 40.0) * 0.6, sin(uTime * 0.07 + seed.x * 30.0) * 0.4 + uTime * 0.03, cos(uTime * 0.11 + seed.z * 35.0) * 0.6);
    vec3 h = vec3(uBox * 0.5);
    p = mod(p - uCam + h, uBox) + uCam - h;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float d = -mv.z;
    vA = smoothstep(0.3, 1.2, d) * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, length(p - uCam)));
    vA *= 0.6 + 0.4 * sin(uTime * 0.9 + seed.x * 100.0);
    gl_PointSize = clamp(uSize * uScale / max(0.1, d), 1.0, 6.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const MOTES_FS = /* glsl */`
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.1, length(c)) * vA * uAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

// ------------------------------------------------------------------ canvas textures
function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bloodTexture() {
  return canvasTexture(128, (g, s) => {
    g.fillStyle = 'rgba(70,4,4,0.95)';
    const blob = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    blob(s / 2, s / 2, s * 0.16);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.pow(Math.random(), 0.7) * s * 0.42;
      blob(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, (1 - d / (s * 0.45)) * s * 0.05 + 1);
    }
    g.strokeStyle = 'rgba(70,4,4,0.8)';
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      g.lineWidth = 1 + Math.random() * 2.5;
      g.beginPath();
      g.moveTo(s / 2, s / 2);
      g.lineTo(s / 2 + Math.cos(a) * s * (0.25 + Math.random() * 0.2), s / 2 + Math.sin(a) * s * (0.25 + Math.random() * 0.2));
      g.stroke();
    }
  });
}

function scorchTexture() {
  return canvasTexture(128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(8,7,6,0.95)');
    grd.addColorStop(0.35, 'rgba(18,15,12,0.8)');
    grd.addColorStop(0.7, 'rgba(30,26,22,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(10,8,6,0.55)';
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      g.lineWidth = 1 + Math.random() * 3;
      g.beginPath();
      g.moveTo(s / 2 + Math.cos(a) * s * 0.12, s / 2 + Math.sin(a) * s * 0.12);
      g.lineTo(s / 2 + Math.cos(a) * s * (0.3 + Math.random() * 0.18), s / 2 + Math.sin(a) * s * (0.3 + Math.random() * 0.18));
      g.stroke();
    }
  });
}

const _v1 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _q1 = new THREE.Quaternion();
const _s1 = new THREE.Vector3();
const _c1 = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class Effects {
  constructor(graphics) {
    this.g = graphics;
    this.scene = graphics.scene;
    this.q = graphics.preset.particles;
    this.world = null;
    const root = this.root = new THREE.Group();
    this.scene.add(root);
    const soft = makeSoftSprite(64);
    this.smokeTex = makeSmokeSprite(128, 11);
    this.sparks = new ParticleSystem(root, 1500, true, soft);
    this.fire = new ParticleSystem(root, 300, true, this.smokeTex);
    this.dust = new ParticleSystem(root, 2500, false, makeSmokeSprite(64, 7));
    this.holeTex = makeBulletHole(64);

    // tracers (one instanced draw)
    this.tracers = [];
    this.tracerMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 1.8), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 40);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.userData.noAO = true;
    for (let i = 0; i < 40; i++) {
      this.tracerMesh.setMatrixAt(i, ZERO_M);
      this.tracers.push({ i, s: new THREE.Vector3(), e: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion(), len: 0, t: 0, active: false });
    }
    root.add(this.tracerMesh);

    // decals
    this.holes = new DecalPool(root, this.holeTex, 200);
    this.bloodDecals = new DecalPool(root, bloodTexture(), 64, { rough: 0.35, offset: -5 });
    this.scorches = new DecalPool(root, scorchTexture(), 12, { rough: 1, offset: -3 });

    // debris chunks (one instanced draw, per-instance colour)
    this.debris = [];
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), 96);
    this.debrisMesh.castShadow = true;
    this.debrisMesh.frustumCulled = false;
    for (let i = 0; i < 96; i++) {
      this.debrisMesh.setMatrixAt(i, ZERO_M);
      this.debrisMesh.setColorAt(i, _c1.set(0xa98457));
      this.debris.push({ i, p: new THREE.Vector3(), r: new THREE.Euler(), s: new THREE.Vector3(), v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0, floor: 0 });
    }
    root.add(this.debrisMesh);
    this.debrisIdx = 0;

    // spent casings
    this.casings = [];
    this.casingMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.03, 6), new THREE.MeshStandardMaterial({ color: 0xd4a84c, metalness: 1, roughness: 0.3 }), 64);
    this.casingMesh.frustumCulled = false;
    this.casingMesh.castShadow = false;
    for (let i = 0; i < 64; i++) {
      this.casingMesh.setMatrixAt(i, ZERO_M);
      this.casingMesh.setColorAt(i, _c1.set(0xffffff));
      this.casings.push({ i, p: new THREE.Vector3(), r: new THREE.Euler(), v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0, floor: 0, bounces: 0, scale: 1 });
    }
    root.add(this.casingMesh);
    this.casingIdx = 0;
    this.onCasingBounce = null;

    // flash light pool (fixed count so shaders never recompile)
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 10, 1.8);
      root.add(l);
      this.lights.push({ l, t: 0, dur: 0, peak: 0 });
    }
    this.lightIdx = 0;

    // muzzle flash sprites for other players
    this.flashTex = makeSoftSprite(64, 0.6);
    this.muzzles = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: new THREE.Color(5, 3.2, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      root.add(s);
      this.muzzles.push({ s, t: 0 });
    }
    this.muzzleIdx = 0;

    // explosion shockwave rings
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.93, 1, 48, 1);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.82, 0.7), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      m.userData.noAO = true;
      root.add(m);
      this.rings.push({ m, t: 1 });
    }

    // smoke grenades
    this.smokes = new Map();
    this.smokeField = new SmokeField(root, this.smokeTex, 520);

    // ambient motes
    this.motes = null;
  }

  setWorld(world) { this.world = world; }

  // theme.motes: { color, alpha, count, size } — floating dust in the air around the camera
  setAmbient(cfg) {
    if (this.motes) { this.root.remove(this.motes); this.motes.geometry.dispose(); this.motes = null; }
    if (!cfg || this.q < 0.5) return;
    const count = Math.round((cfg.count ?? 500) * Math.min(1, this.q));
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < pos.length; i++) pos[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: 16 }, uScale: { value: 400 }, uSize: { value: cfg.size ?? 0.012 },
        uColor: { value: new THREE.Color(cfg.color ?? 0xfff0d0) }, uAlpha: { value: cfg.alpha ?? 0.5 },
      },
      vertexShader: MOTES_VS,
      fragmentShader: MOTES_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(geo, mat);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 4;
    this.motes.userData.noAO = true;
    this.root.add(this.motes);
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.smokes.clear();
  }

  reset() {
    this.holes.clear();
    this.bloodDecals.clear();
    this.scorches.clear();
    for (const d of this.debris) { d.life = 0; this.debrisMesh.setMatrixAt(d.i, ZERO_M); }
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    for (const c of this.casings) { c.life = 0; this.casingMesh.setMatrixAt(c.i, ZERO_M); }
    this.casingMesh.instanceMatrix.needsUpdate = true;
    this.smokes.clear();
    this.sparks.count = 0;
    this.dust.count = 0;
    this.fire.count = 0;
  }

  setViewport(heightPx, vfov) {
    const s = heightPx / (2 * Math.tan(vfov / 2));
    this.sparks.material.uniforms.uScale.value = s;
    this.dust.material.uniforms.uScale.value = s;
    this.fire.material.uniforms.uScale.value = s;
    if (this.motes) this.motes.material.uniforms.uScale.value = s;
  }

  flashLight(pos, color = 0xffb060, peak = 14, dur = 0.06, dist = 9) {
    const L = this.lights[this.lightIdx++ % this.lights.length];
    L.l.position.set(pos[0], pos[1], pos[2]);
    L.l.color.set(color);
    L.l.distance = dist;
    L.peak = peak;
    L.dur = dur;
    L.t = dur;
    L.l.intensity = peak;
  }

  muzzleFlash(pos, big = false) {
    const M = this.muzzles[this.muzzleIdx++ % this.muzzles.length];
    M.s.position.copy(pos);
    const s = (big ? 0.7 : 0.45) * (0.8 + Math.random() * 0.4);
    M.s.scale.set(s, s, s);
    M.s.material.rotation = Math.random() * 6.28;
    M.s.visible = true;
    M.t = 0.05;
    this.flashLight([pos.x, pos.y, pos.z], 0xffb060, big ? 16 : 10, 0.06, 8);
    this.muzzleSmoke([pos.x, pos.y, pos.z], null, big ? 1.6 : 1);
  }

  // lingering grey wisps at the barrel after a shot
  muzzleSmoke(p, dir = null, amount = 1) {
    const n = Math.round((1 + Math.random() * 2) * amount * this.q);
    for (let i = 0; i < n; i++) {
      const f = dir ? 0.4 + Math.random() * 0.6 : 0;
      this.dust.spawn(p[0], p[1], p[2],
        (dir ? dir[0] * f : 0) + (Math.random() - 0.5) * 0.3, 0.25 + Math.random() * 0.35 + (dir ? dir[1] * f : 0), (dir ? dir[2] * f : 0) + (Math.random() - 0.5) * 0.3,
        0.72, 0.71, 0.7, 0.14 + Math.random() * 0.08, 0.05 + Math.random() * 0.04, 0.9 + Math.random() * 0.8, -0.15, 1.8, 0.35);
    }
  }

  // Spent brass. v = world velocity; big = shotgun shell / sniper case.
  casing(p, v, big = false) {
    if (this.q < 0.4) return;
    const c = this.casings[this.casingIdx++ % this.casings.length];
    c.p.set(p[0], p[1], p[2]);
    c.v.set(v[0], v[1], v[2]);
    c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    c.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    c.life = 6;
    c.bounces = 0;
    c.scale = big ? 1.7 : 1;
    c.floor = this.world ? this.world.groundBelow(p[0], p[1], p[2], 6) : p[1] - 1.6;
    this.casingMesh.setColorAt(c.i, _c1.set(big ? 0xc0392b : 0xffffff));
    this.casingMesh.instanceColor.needsUpdate = true;
  }

  tracer(from, to, chance = 1) {
    if (Math.random() > chance) return;
    const T = this.tracers.find((t) => !t.active);
    if (!T) return;
    T.s.set(from[0], from[1], from[2]);
    T.e.set(to[0], to[1], to[2]);
    T.d.copy(T.e).sub(T.s);
    T.len = T.d.length();
    if (T.len < 1.5) return;
    T.d.normalize();
    T.t = 0;
    T.active = true;
    T.q.setFromUnitVectors(UP, T.d);
  }

  decal(p, n, size = 0.09) {
    this.holes.add(p, n, size * (0.8 + Math.random() * 0.4));
  }

  bloodDecal(p, n, size = 0.5) {
    const k = 0.7 + Math.random() * 0.5;
    this.bloodDecals.add(p, n, size * (0.7 + Math.random() * 0.6), _c1.setRGB(k, k * 0.9, k * 0.9));
  }

  scorch(p) {
    this.scorches.add([p[0], p[1] + 0.01, p[2]], [0, 1, 0], 2.4 + Math.random() * 0.6);
  }

  removeDecalsIn(box) {
    this.holes.removeIn(box);
    this.bloodDecals.removeIn(box);
  }

  impact(p, n, surface, withDecal = true) {
    const q = this.q;
    const c = SURF_COLORS[surface] || SURF_COLORS[0];
    const [x, y, z] = p;
    const [nx, ny, nz] = n;
    if (surface === 4) { this.blood(p, n); return; }
    // fast spray
    const count = Math.round((surface === 3 ? 10 : 7) * q);
    for (let i = 0; i < count; i++) {
      const sp = 0.6 + Math.random() * 1.8;
      this.dust.spawn(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03,
        nx * sp + (Math.random() - 0.5) * 1.2, ny * sp + Math.random() * 0.8, nz * sp + (Math.random() - 0.5) * 1.2,
        c[0], c[1], c[2], 0.55, 0.12 + Math.random() * 0.12, 0.5 + Math.random() * 0.5, 1.2, 2.2, 0.45);
    }
    // slow lingering puff
    if (surface !== 2) {
      for (let i = 0; i < Math.max(1, Math.round(2 * q)); i++) {
        this.dust.spawn(x + nx * 0.08, y + ny * 0.08, z + nz * 0.08, nx * 0.35 + (Math.random() - 0.5) * 0.2, 0.08 + Math.random() * 0.1, nz * 0.35 + (Math.random() - 0.5) * 0.2,
          c[0] * 0.95, c[1] * 0.95, c[2] * 0.95, 0.22, 0.2 + Math.random() * 0.1, 1.4 + Math.random() * 0.8, -0.05, 1.5, 0.35);
      }
    }
    // chips that fall
    if (surface === 0 || surface === 3) {
      for (let i = 0; i < 4 * q; i++) {
        const sp = 1.5 + Math.random() * 2.5;
        this.dust.spawn(x, y, z, nx * sp + (Math.random() - 0.5) * 2, ny * sp + Math.random() * 2, nz * sp + (Math.random() - 0.5) * 2,
          c[0] * 0.55, c[1] * 0.55, c[2] * 0.55, 1, 0.022 + Math.random() * 0.015, 0.5 + Math.random() * 0.4, 9.8, 0.3);
      }
    }
    if (surface === 2 || surface === 0) {
      const sparks = Math.round((surface === 2 ? 12 : 3) * q);
      for (let i = 0; i < sparks; i++) {
        const sp = 3 + Math.random() * 6;
        this.sparks.spawn(x, y, z, nx * sp + (Math.random() - 0.5) * 5, ny * sp + Math.random() * 3, nz * sp + (Math.random() - 0.5) * 5,
          3, 2, 0.8, 1, 0.025 + Math.random() * 0.02, 0.15 + Math.random() * 0.25, 9, 0.5);
      }
      if (surface === 2) this.sparks.spawn(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02, 0, 0, 0, 5, 3.6, 2, 1, 0.14, 0.05, 0, 0, 0);
    }
    if (surface === 1) {
      for (let i = 0; i < 5 * q; i++) {
        const sp = 1 + Math.random() * 3;
        this.dust.spawn(x, y, z, nx * sp + (Math.random() - 0.5) * 2, ny * sp + Math.random() * 2, nz * sp + (Math.random() - 0.5) * 2,
          0.45, 0.32, 0.18, 1, 0.035, 0.6 + Math.random() * 0.4, 9, 0.5);
      }
    }
    if (withDecal && surface !== 3) this.decal(p, n);
  }

  blood(p, n) {
    const [x, y, z] = p;
    for (let i = 0; i < 12 * this.q; i++) {
      const sp = 0.5 + Math.random() * 2.2;
      this.dust.spawn(x, y, z, (Math.random() - 0.5) * sp + n[0], (Math.random() - 0.2) * sp, (Math.random() - 0.5) * sp + n[2],
        0.42, 0.02, 0.02, 0.9, 0.06 + Math.random() * 0.1, 0.35 + Math.random() * 0.35, 6, 1.5, 0.3);
    }
    // fine mist
    for (let i = 0; i < 3 * this.q; i++) {
      this.dust.spawn(x, y, z, (Math.random() - 0.5) * 0.6 + n[0] * 0.8, (Math.random() - 0.3) * 0.4, (Math.random() - 0.5) * 0.6 + n[2] * 0.8,
        0.35, 0.02, 0.02, 0.45, 0.14 + Math.random() * 0.1, 0.5 + Math.random() * 0.3, 0.5, 2.5, 0.6);
    }
  }

  debrisBurst(box, floorY, color = 0xa98457) {
    const cx = (box.min[0] + box.max[0]) / 2, cy = (box.min[1] + box.max[1]) / 2, cz = (box.min[2] + box.max[2]) / 2;
    for (let i = 0; i < 9; i++) {
      const s = 0.06 + Math.random() * 0.2;
      this.chunk([cx + (Math.random() - 0.5) * 0.8, cy + (Math.random() - 0.5) * 0.8, cz + (Math.random() - 0.5) * 0.8],
        [(Math.random() - 0.5) * 5, Math.random() * 3.5, (Math.random() - 0.5) * 5], [s, s * (0.2 + Math.random() * 0.4), s * (0.4 + Math.random())], floorY, color);
    }
    for (let i = 0; i < 16 * this.q; i++) {
      this.dust.spawn(cx + (Math.random() - 0.5), cy + (Math.random() - 0.5), cz + (Math.random() - 0.5),
        (Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2, 0.55, 0.45, 0.32, 0.5, 0.4, 1.2, 0.3, 2, 0.8);
    }
    this.removeDecalsIn(box);
  }

  chunk(p, v, s, floorY, color) {
    const d = this.debris[this.debrisIdx++ % this.debris.length];
    d.p.set(p[0], p[1], p[2]);
    d.s.set(s[0], s[1], s[2]);
    d.v.set(v[0], v[1], v[2]);
    d.w.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    d.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    d.life = 3.5 + Math.random();
    d.floor = floorY;
    this.debrisMesh.setColorAt(d.i, _c1.set(color));
    this.debrisMesh.instanceColor.needsUpdate = true;
  }

  explosion(p, big = true) {
    const [x, y, z] = p;
    const q = this.q;
    const floor = this.world ? this.world.groundBelow(x, y + 0.3, z, 3) : y;
    this.flashLight(p, 0xff9040, big ? 60 : 30, 0.45, big ? 22 : 14);
    // fireball
    for (let i = 0; i < 16 * q; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.3, sp = 1.5 + Math.random() * 3.5;
      const hot = Math.random();
      this.fire.spawn(x + Math.cos(a) * 0.2, y + 0.3 + Math.random() * 0.3, z + Math.sin(a) * 0.2, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 1.2, Math.sin(a) * Math.cos(e) * sp,
        2.6 + hot * 1.6, 1.0 + hot * 0.8, 0.25 + hot * 0.2, 0.9, 0.8 + Math.random() * 0.7, 0.28 + Math.random() * 0.3, -1.5, 4, 3.2);
    }
    // embers and fast sparks
    for (let i = 0; i < 26 * q; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = 2 + Math.random() * 7;
      this.sparks.spawn(x, y + 0.2, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 1, Math.sin(a) * Math.cos(e) * sp,
        4, 2.2, 0.7, 1, 0.5 + Math.random() * 0.7, 0.25 + Math.random() * 0.35, -1, 3, 1.5);
    }
    for (let i = 0; i < 30 * q; i++) {
      const a = Math.random() * Math.PI * 2, sp = 7 + Math.random() * 10;
      this.sparks.spawn(x, y + 0.2, z, Math.cos(a) * sp, Math.random() * 8, Math.sin(a) * sp, 3.5, 2.2, 0.9, 1, 0.04, 0.5 + Math.random() * 0.6, 12, 0.8);
    }
    // rolling dark smoke column
    for (let i = 0; i < 22 * q; i++) {
      const a = Math.random() * Math.PI * 2, sp = Math.random() * 3;
      this.dust.spawn(x + Math.cos(a) * 0.5, y + 0.3 + Math.random() * 0.8, z + Math.sin(a) * 0.5, Math.cos(a) * sp, 0.6 + Math.random() * 1.8, Math.sin(a) * sp,
        0.16, 0.14, 0.13, 0.7, 1.2 + Math.random(), 2.4 + Math.random() * 1.5, -0.3, 1.2, 1.4);
    }
    // ground dust ring
    for (let i = 0; i < 16 * q; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3, sp = 5 + Math.random() * 3;
      this.dust.spawn(x, floor + 0.15, z, Math.cos(a) * sp, 0.3, Math.sin(a) * sp, 0.55, 0.5, 0.44, 0.35, 0.5, 1.2 + Math.random() * 0.6, 0, 2.6, 1.1);
    }
    for (let i = 0; i < 6; i++) {
      const s = 0.04 + Math.random() * 0.06;
      this.chunk([x, y + 0.2, z], [(Math.random() - 0.5) * 9, 3 + Math.random() * 5, (Math.random() - 0.5) * 9], [s, s, s], floor, 0x3a3530);
    }
    const R = this.rings.find((r) => r.t >= 1) || this.rings[0];
    R.t = 0;
    R.m.position.set(x, floor + 0.06, z);
    R.m.visible = true;
    if (big && y - floor < 1.5) this.scorch([x, floor, z]);
  }

  flashbang(p) {
    const [x, y, z] = p;
    this.flashLight(p, 0xffffff, 120, 0.25, 26);
    for (let i = 0; i < 20 * this.q; i++) {
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 6;
      this.sparks.spawn(x, y, z, Math.cos(a) * sp, Math.random() * 5, Math.sin(a) * sp, 4, 4, 4, 1, 0.05, 0.3, 10, 1);
    }
    this.sparks.spawn(x, y, z, 0, 0, 0, 6, 6, 6, 1, 2.5, 0.12, 0, 0, 10);
    this.dust.spawn(x, y, z, 0, 0.3, 0, 0.8, 0.8, 0.8, 0.5, 0.6, 1.5, 0, 1, 0.6);
  }

  // ---------------------------------------------------------------- smoke grenades
  addSmoke(id, p, start, until, now, tint = 0.82) {
    if (this.smokes.has(id)) return;
    const n = Math.round(44 * Math.max(0.6, this.q));
    const puffs = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.6) * 3.6;
      const h = Math.pow(Math.random(), 1.4) * 3.2;
      puffs.push({
        off: new THREE.Vector3(Math.cos(a) * r, 0.5 + h, Math.sin(a) * r),
        size: 3.2 + Math.random() * 2.4, rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.15, delay: Math.random() * 0.5,
        tint: tint * (0.74 + Math.random() * 0.26), drift: Math.random() * 6.28,
      });
    }
    const ground = this.world ? this.world.groundBelow(p[0], p[1] + 0.3, p[2], 3) : p[1];
    this.smokes.set(id, { p, start, until, puffs, ground });
  }

  updateSmokes(now, dt) {
    const F = this.smokeField;
    F.begin();
    const t = now / 1000;
    for (const [id, sm] of this.smokes) {
      const age = (now - sm.start) / 1000;
      const left = (sm.until - now) / 1000;
      if (left < -0.2) { this.smokes.delete(id); continue; }
      const fade = Math.min(1, Math.max(0, left / 2.5));
      for (const sp of sm.puffs) {
        const g = Math.min(1, Math.max(0, (age - sp.delay) / 1.6));
        const e = 1 - Math.pow(1 - g, 3);
        sp.rot += sp.spin * dt;
        const wob = 0.12 * Math.sin(t * 0.4 + sp.drift);
        const s = sp.size * (0.3 + 0.7 * e) * (1 + (1 - fade) * 0.25);
        F.push(sm.p[0] + sp.off.x * (0.25 + 0.75 * e) + wob, sm.p[1] + sp.off.y * (0.3 + 0.7 * e) + (1 - fade) * 0.6, sm.p[2] + sp.off.z * (0.25 + 0.75 * e) - wob,
          s, sp.rot, 0.92 * Math.min(1, g * 3) * fade, sp.tint, sm.ground);
      }
    }
    F.end();
  }

  // ---------------------------------------------------------------- per frame
  update(dt, now) {
    this.sparks.update(dt);
    this.dust.update(dt);
    this.fire.update(dt);
    let tracerDirty = false;
    for (const T of this.tracers) {
      if (!T.active) continue;
      tracerDirty = true;
      T.t += dt;
      const speed = 420;
      const head = Math.min(T.len, T.t * speed);
      const tailD = Math.max(0, T.t * speed - 4.5);
      if (tailD >= T.len - 0.01) { T.active = false; this.tracerMesh.setMatrixAt(T.i, ZERO_M); continue; }
      const l = head - tailD;
      _v1.copy(T.s).addScaledVector(T.d, (head + tailD) / 2);
      _m1.compose(_v1, T.q, _s1.set(0.012, Math.max(0.01, l), 0.012));
      this.tracerMesh.setMatrixAt(T.i, _m1);
    }
    if (tracerDirty) this.tracerMesh.instanceMatrix.needsUpdate = true;
    for (const L of this.lights) {
      if (L.t <= 0) continue;
      L.t -= dt;
      L.l.intensity = L.t > 0 ? L.peak * (L.t / L.dur) : 0;
    }
    for (const M of this.muzzles) {
      if (M.t <= 0) continue;
      M.t -= dt;
      if (M.t <= 0) M.s.visible = false;
    }
    for (const R of this.rings) {
      if (R.t >= 1) continue;
      R.t = Math.min(1, R.t + dt / 0.35);
      const e = 1 - Math.pow(1 - R.t, 2);
      R.m.scale.setScalar(0.5 + e * 7);
      R.m.material.opacity = 0.3 * (1 - R.t) * (1 - R.t);
      if (R.t >= 1) R.m.visible = false;
    }
    let debrisDirty = false;
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      debrisDirty = true;
      d.life -= dt;
      d.v.y -= 14 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < d.floor + 0.03) {
        d.p.y = d.floor + 0.03;
        d.v.y = Math.abs(d.v.y) * 0.3;
        d.v.x *= 0.6; d.v.z *= 0.6;
        d.w.multiplyScalar(0.6);
      }
      d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
      if (d.life < 0.5) d.s.multiplyScalar(0.94);
      if (d.life <= 0) this.debrisMesh.setMatrixAt(d.i, ZERO_M);
      else this.debrisMesh.setMatrixAt(d.i, _m1.compose(d.p, _q1.setFromEuler(d.r), d.s));
    }
    if (debrisDirty) this.debrisMesh.instanceMatrix.needsUpdate = true;
    let casingDirty = false;
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      casingDirty = true;
      c.life -= dt;
      if (c.bounces < 4) {
        c.v.y -= 9.8 * dt;
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
        if (c.p.y < c.floor + 0.006) {
          c.p.y = c.floor + 0.006;
          if (c.bounces === 0 && this.onCasingBounce) this.onCasingBounce([c.p.x, c.p.y, c.p.z], c.scale > 1);
          c.bounces++;
          c.v.set(c.v.x * 0.45, Math.abs(c.v.y) * 0.32, c.v.z * 0.45);
          c.w.multiplyScalar(0.5);
          if (c.bounces >= 4) { c.r.x = Math.PI / 2; c.r.z = 0; }
        }
      }
      const s = c.life < 0.4 ? c.scale * (c.life / 0.4) : c.scale;
      if (c.life <= 0) this.casingMesh.setMatrixAt(c.i, ZERO_M);
      else this.casingMesh.setMatrixAt(c.i, _m1.compose(c.p, _q1.setFromEuler(c.r), _s1.set(s, s, s)));
    }
    if (casingDirty) this.casingMesh.instanceMatrix.needsUpdate = true;
    if (this.motes) {
      const u = this.motes.material.uniforms;
      u.uCam.value.copy(this.g.camera.position);
      u.uTime.value += dt;
    }
    this.updateSmokes(now, dt);
  }
}

