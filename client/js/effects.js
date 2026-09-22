// Transient visual effects: particles, tracers, decals, debris, smoke, explosions, flash lights.

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
  constructor(scene, max, additive, tex) {
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
    scene.add(this.points);
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
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}

export class Effects {
  constructor(graphics, quality) {
    this.g = graphics;
    this.scene = graphics.scene;
    this.q = graphics.preset.particles;
    const soft = makeSoftSprite(64);
    this.sparks = new ParticleSystem(this.scene, 1500, true, soft);
    this.dust = new ParticleSystem(this.scene, 2500, false, makeSmokeSprite(64, 7));
    this.smokeTex = makeSmokeSprite(128, 11);
    this.holeTex = makeBulletHole(64);

    // tracers
    this.tracers = [];
    const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 1.8), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.visible = false;
      m.userData.noAO = true;
      this.scene.add(m);
      this.tracers.push({ m, s: new THREE.Vector3(), e: new THREE.Vector3(), d: new THREE.Vector3(), len: 0, t: 0, active: false });
    }

    // decals
    this.decals = [];
    this.decalIdx = 0;
    const decalGeo = new THREE.PlaneGeometry(1, 1);
    const decalMat = new THREE.MeshStandardMaterial({ map: this.holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9 });
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(decalGeo, decalMat);
      m.visible = false;
      m.userData.noAO = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this.decals.push(m);
    }

    // debris chunks
    this.debris = [];
    const dGeo = new THREE.BoxGeometry(1, 1, 1);
    const dMat = new THREE.MeshStandardMaterial({ color: 0xa98457, roughness: 0.8 });
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(dGeo, dMat);
      m.visible = false;
      m.castShadow = true;
      this.scene.add(m);
      this.debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0, floor: 0 });
    }
    this.debrisIdx = 0;

    // flash light pool (fixed count so shaders never recompile)
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 10, 1.8);
      this.scene.add(l);
      this.lights.push({ l, t: 0, dur: 0, peak: 0 });
    }
    this.lightIdx = 0;

    // muzzle flash sprites for other players
    this.flashTex = makeSoftSprite(64, 0.6);
    this.muzzles = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: new THREE.Color(5, 3.2, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      this.scene.add(s);
      this.muzzles.push({ s, t: 0 });
    }
    this.muzzleIdx = 0;

    this.smokes = new Map();
    this.sprites = []; // explosion billboards
  }

  dispose() {
    for (const s of this.smokes.values()) for (const sp of s.sprites) this.scene.remove(sp.s);
    this.smokes.clear();
  }

  reset() {
    for (const d of this.decals) d.visible = false;
    for (const d of this.debris) { d.m.visible = false; d.life = 0; }
    for (const s of this.smokes.values()) for (const sp of s.sprites) this.scene.remove(sp.s);
    this.smokes.clear();
    this.sparks.count = 0;
    this.dust.count = 0;
  }

  setViewport(heightPx, vfov) {
    const s = heightPx / (2 * Math.tan(vfov / 2));
    this.sparks.material.uniforms.uScale.value = s;
    this.dust.material.uniforms.uScale.value = s;
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
    T.m.visible = true;
    T.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), T.d);
  }

  decal(p, n, size = 0.09) {
    const m = this.decals[this.decalIdx++ % this.decals.length];
    m.position.set(p[0] + n[0] * 0.004, p[1] + n[1] * 0.004, p[2] + n[2] * 0.004);
    m.lookAt(p[0] + n[0], p[1] + n[1], p[2] + n[2]);
    m.rotateZ(Math.random() * Math.PI * 2);
    const s = size * (0.8 + Math.random() * 0.4);
    m.scale.set(s, s, s);
    m.visible = true;
  }

  removeDecalsIn(box) {
    for (const d of this.decals) {
      if (!d.visible) continue;
      const p = d.position;
      if (p.x > box.min[0] - 0.02 && p.x < box.max[0] + 0.02 && p.y > box.min[1] - 0.02 && p.y < box.max[1] + 0.02 && p.z > box.min[2] - 0.02 && p.z < box.max[2] + 0.02) d.visible = false;
    }
  }

  impact(p, n, surface, withDecal = true) {
    const q = this.q;
    const c = SURF_COLORS[surface] || SURF_COLORS[0];
    const [x, y, z] = p;
    const [nx, ny, nz] = n;
    if (surface === 4) { this.blood(p, n); return; }
    const count = Math.round((surface === 3 ? 10 : 7) * q);
    for (let i = 0; i < count; i++) {
      const sp = 0.6 + Math.random() * 1.8;
      this.dust.spawn(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03,
        nx * sp + (Math.random() - 0.5) * 1.2, ny * sp + Math.random() * 0.8, nz * sp + (Math.random() - 0.5) * 1.2,
        c[0], c[1], c[2], 0.55, 0.12 + Math.random() * 0.12, 0.5 + Math.random() * 0.5, 1.2, 2.2, 0.45);
    }
    if (surface === 2 || surface === 0) {
      const sparks = Math.round((surface === 2 ? 10 : 3) * q);
      for (let i = 0; i < sparks; i++) {
        const sp = 3 + Math.random() * 6;
        this.sparks.spawn(x, y, z, nx * sp + (Math.random() - 0.5) * 5, ny * sp + Math.random() * 3, nz * sp + (Math.random() - 0.5) * 5,
          3, 2, 0.8, 1, 0.025 + Math.random() * 0.02, 0.15 + Math.random() * 0.25, 9, 0.5);
      }
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
    this.dust.spawn(x, y, z, 0, 0.2, 0, 0.35, 0.02, 0.02, 0.6, 0.3, 0.4, 0, 1, 0.8);
  }

  debrisBurst(box, floorY) {
    const cx = (box.min[0] + box.max[0]) / 2, cy = (box.min[1] + box.max[1]) / 2, cz = (box.min[2] + box.max[2]) / 2;
    for (let i = 0; i < 7; i++) {
      const d = this.debris[this.debrisIdx++ % this.debris.length];
      d.m.position.set(cx + (Math.random() - 0.5) * 0.8, cy + (Math.random() - 0.5) * 0.8, cz + (Math.random() - 0.5) * 0.8);
      const s = 0.06 + Math.random() * 0.2;
      d.m.scale.set(s, s * (0.2 + Math.random() * 0.4), s * (0.4 + Math.random()));
      d.v.set((Math.random() - 0.5) * 5, Math.random() * 3.5, (Math.random() - 0.5) * 5);
      d.w.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      d.life = 3.5 + Math.random();
      d.floor = floorY;
      d.m.visible = true;
    }
    for (let i = 0; i < 16 * this.q; i++) {
      this.dust.spawn(cx + (Math.random() - 0.5), cy + (Math.random() - 0.5), cz + (Math.random() - 0.5),
        (Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2, 0.55, 0.45, 0.32, 0.5, 0.4, 1.2, 0.3, 2, 0.8);
    }
    this.removeDecalsIn(box);
  }

  explosion(p, big = true) {
    const [x, y, z] = p;
    this.flashLight(p, 0xff9040, big ? 60 : 30, 0.45, big ? 22 : 14);
    for (let i = 0; i < 26 * this.q; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = 2 + Math.random() * 7;
      this.sparks.spawn(x, y + 0.2, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 1, Math.sin(a) * Math.cos(e) * sp,
        4, 2.2, 0.7, 1, 0.5 + Math.random() * 0.7, 0.25 + Math.random() * 0.35, -1, 3, 1.5);
    }
    for (let i = 0; i < 30 * this.q; i++) {
      const a = Math.random() * Math.PI * 2, sp = 7 + Math.random() * 10;
      this.sparks.spawn(x, y + 0.2, z, Math.cos(a) * sp, Math.random() * 8, Math.sin(a) * sp, 3.5, 2.2, 0.9, 1, 0.04, 0.5 + Math.random() * 0.6, 12, 0.8);
    }
    for (let i = 0; i < 22 * this.q; i++) {
      const a = Math.random() * Math.PI * 2, sp = Math.random() * 3;
      this.dust.spawn(x + Math.cos(a) * 0.5, y + 0.3 + Math.random() * 0.8, z + Math.sin(a) * 0.5, Math.cos(a) * sp, 0.6 + Math.random() * 1.8, Math.sin(a) * sp,
        0.18, 0.16, 0.15, 0.7, 1.2 + Math.random(), 2.4 + Math.random() * 1.5, -0.3, 1.2, 1.4);
    }
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
    const sprites = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.6) * 3.6;
      const h = Math.random() * 3.2;
      const mat = new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, opacity: 0, color: new THREE.Color().setScalar(tint * (0.82 + Math.random() * 0.18)), rotation: Math.random() * 6.28 });
      const s = new THREE.Sprite(mat);
      s.userData.noAO = true;
      const off = new THREE.Vector3(Math.cos(a) * r, 0.5 + h, Math.sin(a) * r);
      s.position.set(p[0] + off.x * 0.2, p[1] + 0.4, p[2] + off.z * 0.2);
      this.scene.add(s);
      sprites.push({ s, off, size: 3.2 + Math.random() * 2.4, spin: (Math.random() - 0.5) * 0.15, delay: Math.random() * 0.5 });
    }
    this.smokes.set(id, { p, start, until, sprites });
  }

  updateSmokes(now) {
    for (const [id, sm] of this.smokes) {
      const age = (now - sm.start) / 1000;
      const left = (sm.until - now) / 1000;
      if (left < -0.2) {
        for (const sp of sm.sprites) { this.scene.remove(sp.s); sp.s.material.dispose(); }
        this.smokes.delete(id);
        continue;
      }
      for (const sp of sm.sprites) {
        const g = Math.min(1, Math.max(0, (age - sp.delay) / 1.6));
        const e = 1 - Math.pow(1 - g, 3);
        sp.s.position.set(sm.p[0] + sp.off.x * (0.25 + 0.75 * e), sm.p[1] + 0.3 + sp.off.y * (0.3 + 0.7 * e), sm.p[2] + sp.off.z * (0.25 + 0.75 * e));
        const s = sp.size * (0.3 + 0.7 * e);
        sp.s.scale.set(s, s, 1);
        sp.s.material.rotation += sp.spin * 0.016;
        const fade = Math.min(1, Math.max(0, left / 2.5));
        sp.s.material.opacity = 0.92 * Math.min(1, g * 3) * fade;
      }
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt, now) {
    this.sparks.update(dt);
    this.dust.update(dt);
    for (const T of this.tracers) {
      if (!T.active) continue;
      T.t += dt;
      const speed = 420;
      const head = Math.min(T.len, T.t * speed);
      const tailD = Math.max(0, head - 4.5);
      if (tailD >= T.len - 0.01) { T.active = false; T.m.visible = false; continue; }
      const l = head - tailD;
      T.m.position.copy(T.s).addScaledVector(T.d, (head + tailD) / 2);
      T.m.scale.set(0.012, Math.max(0.01, l), 0.012);
    }
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
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.v.y -= 14 * dt;
      d.m.position.addScaledVector(d.v, dt);
      if (d.m.position.y < d.floor + 0.03) {
        d.m.position.y = d.floor + 0.03;
        d.v.y = Math.abs(d.v.y) * 0.3;
        d.v.x *= 0.6; d.v.z *= 0.6;
        d.w.multiplyScalar(0.6);
      }
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      if (d.life < 0.5) d.m.scale.multiplyScalar(0.94);
      if (d.life <= 0) d.m.visible = false;
    }
    this.updateSmokes(now);
  }
}
