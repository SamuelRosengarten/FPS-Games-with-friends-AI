// First-person weapon + arms with procedural animation.

import * as THREE from 'three';
import { createWeaponModel } from './models.js';
import { Builder, bakedMaterial, superEllipsoid, SURF } from './surface.js';
import { WEAPONS } from '../shared/weapons.js';

const HIP = {
  pistol: [0.145, -0.165, -0.44],
  smg: [0.16, -0.18, -0.44],
  rifle: [0.19, -0.2, -0.52],
  shotgun: [0.19, -0.2, -0.52],
  sniper: [0.19, -0.2, -0.52],
  knife: [0.18, -0.19, -0.38],
  grenade: [0.17, -0.18, -0.38],
  bomb: [0.06, -0.23, -0.42],
};
const BASE_YAW = { pistol: 0.05, smg: 0.1, rifle: 0.13, shotgun: 0.13, sniper: 0.12, knife: 0, grenade: 0, bomb: 0 };
const ADS_Z = { pistol: -0.42, smg: -0.42, rifle: -0.46, shotgun: -0.44, sniper: -0.4 };

const ease = (t) => t * t * (3 - 2 * t);
const bell = (p, a = 0.14, b = 0.86) => (p < a ? ease(p / a) : p > b ? ease((1 - p) / (1 - b)) : 1);

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(0.15, 'rgba(255,220,120,0.95)');
  grd.addColorStop(0.45, 'rgba(255,140,40,0.45)');
  grd.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,230,160,0.8)';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
    const r = 40 + Math.random() * 22;
    g.lineWidth = 3 + Math.random() * 4;
    g.beginPath();
    g.moveTo(64, 64);
    g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ViewModel {
  constructor(graphics) {
    this.g = graphics;
    this.scene = graphics.vmScene;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.holder = new THREE.Group();
    this.root.add(this.holder);
    this.models = new Map();
    this.current = null;
    this.id = null;
    this.kind = 'knife';
    this.look = null;

    this.flashTex = flashTexture();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffffff }));
    this.flash.visible = false;
    this.flashT = 0;

    this.shells = [];
    const shellGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.022, 8);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.3 });
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(shellGeo, shellMat);
      m.visible = false;
      this.scene.add(m);
      this.shells.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 });
    }
    this.shellIdx = 0;

    // animation state
    this.t = 0;
    this.bobPhase = 0;
    this.sway = new THREE.Vector2();
    this.swayVel = new THREE.Vector2();
    this.kick = 0; this.kickVel = 0;
    this.kickRot = 0; this.kickRotVel = 0;
    this.deployT = 1; this.deployDur = 0.5;
    this.reloadT = -1; this.reloadDur = 1;
    this.action = null; this.actionT = 0; this.actionDur = 0;
    this.slideT = 1;
    this.inspectT = -1;
    this.landDip = 0;
    this.lowered = 0;
    this.visible = true;
  }

  setLook(look) {
    if (this.look && this.look.key === look.key && this.look.uniform === look.uniform && this.look.gloves === look.gloves) return;
    this.look = look;
    // rebuild arms on all cached models
    for (const [id, m] of this.models) this.buildArms(m, id);
  }

  buildArms(model, id) {
    const old = model.getObjectByName('arms');
    if (old) model.remove(old);
    const look = this.look || { sleeve: [0x555555, 0x444444], gloves: 0x222222 };
    const sleeveC = look.sleeve || [look.uniform ?? 0x555555, look.uniform ?? 0x444444];
    const info = model.userData;
    const B = new Builder();
    const UP = new THREE.Vector3(0, 1, 0);
    // geometry is lifted by LIFT so the surface shader's ground dust (based on height) never applies
    const LIFT = 2;
    const V = (v) => v.clone().add(new THREE.Vector3(0, LIFT, 0));
    const frame = (c, t) => {
      let x = new THREE.Vector3().crossVectors(t, UP);
      if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
      x.normalize();
      const z = new THREE.Vector3().crossVectors(x, t).normalize();
      return { c: V(c), x, z };
    };
    const sleeve = { color: sleeveC[0], color2: sleeveC[1], tex: SURF.camo, rough: 0.92 };
    const leather = { color: look.gloves, tex: SURF.leather, rough: 0.7 };
    const rubberK = { color: new THREE.Color(look.gloves).multiplyScalar(0.6).lerp(new THREE.Color(0x2c2b28), 0.3), tex: SURF.rubber, rough: 0.6 };
    // capsule between two points (fingers, thumb)
    const capsule = (a, b, r, o) => {
      const d = b.clone().sub(a);
      const m = new THREE.Matrix4().compose(V(a.clone().addScaledVector(d, 0.5)), new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), new THREE.Vector3(1, 1, 1));
      B.add(new THREE.CapsuleGeometry(r, Math.max(0.001, d.length()), 3, 8), { matrix: m, ...o });
    };
    const addHand = (wrist, palm, left) => {
      const dir = palm.clone().sub(wrist).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
      const H = new THREE.Matrix4().compose(palm, q, new THREE.Vector3(1, 1, 1));
      const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(H);
      const zs = left ? 1 : -1; // side the fingers wrap towards
      const lift = new THREE.Matrix4().makeTranslation(0, LIFT, 0);
      B.add(superEllipsoid(0.026, 0.028, 0.017, 0.5, 0.6, 12, 8), { matrix: lift.clone().multiply(H), p: [0, -0.004, -zs * 0.004], ...leather });
      B.add(superEllipsoid(0.021, 0.014, 0.006, 0.4, 0.5, 10, 6), { matrix: lift.clone().multiply(H), p: [0, 0.006, zs * 0.017], ...rubberK });
      for (let f = 0; f < 4; f++) {
        const x = -0.019 + f * 0.0127;
        const r = f === 3 ? 0.0062 : 0.0071;
        const len = f === 0 || f === 3 ? 0.86 : 1;
        const k = at(x, 0.034, 0);
        const j1 = at(x, 0.034 + 0.02 * len, zs * 0.012);
        const j2 = at(x, 0.04 + 0.012 * len, zs * 0.032 * len);
        const tip = at(x, 0.028, zs * 0.045 * len);
        capsule(k, j1, r, leather);
        capsule(j1, j2, r * 0.95, leather);
        capsule(j2, tip, r * 0.9, leather);
        B.add(superEllipsoid(r * 1.1, r * 0.9, r * 0.6, 0.6, 0.6, 8, 6), { matrix: lift.clone().multiply(H), p: [x, 0.036, -zs * 0.0065], ...rubberK });
      }
      const t0 = at(left ? -0.024 : 0.024, -0.006, zs * 0.008);
      const t1 = at(left ? -0.03 : 0.03, 0.018, zs * 0.03);
      const t2 = at(left ? -0.022 : 0.022, 0.036, zs * 0.046);
      capsule(t0, t1, 0.0085, leather);
      capsule(t1, t2, 0.0078, leather);
    };
    const addArm = (palm, elbow, shoulder, left) => {
      const p = new THREE.Vector3(...palm), e = new THREE.Vector3(...elbow), sh = new THREE.Vector3(...shoulder);
      const wrist = p.clone().add(e.clone().sub(p).normalize().multiplyScalar(0.07));
      const tU = e.clone().sub(sh).normalize(), tF = wrist.clone().sub(e).normalize();
      const tE = tU.clone().add(tF).normalize();
      const on = (a, b, t) => a.clone().lerp(b, t);
      const folds = (amt, seed) => (th) => 1 + amt * Math.sin(th * 3 + seed) * Math.sin(th * 2 + seed * 2);
      const cuffAt = on(wrist, e, 0.3);
      B.tube([
        { ...frame(sh, tU), rx: 0.06, rz: 0.058 },
        { ...frame(on(sh, e, 0.35), tU), rx: 0.057, rz: 0.055, mod: folds(0.03, 1) },
        { ...frame(on(sh, e, 0.7), tU), rx: 0.054, rz: 0.052, mod: folds(0.04, 2) },
        { ...frame(on(sh, e, 0.93), tU), rx: 0.052, rz: 0.05 },
        { ...frame(e, tE), rx: 0.052, rz: 0.053, mod: folds(0.05, 3) },
        { ...frame(on(e, wrist, 0.12), tF), rx: 0.05, rz: 0.048 },
        { ...frame(on(e, wrist, 0.35), tF), rx: 0.048, rz: 0.046, mod: folds(0.05, 4) },
        { ...frame(on(e, wrist, 0.55), tF), rx: 0.046, rz: 0.043, mod: folds(0.04, 5) },
        { ...frame(on(cuffAt, e, 0.06), tF), rx: 0.044, rz: 0.041 },
        { ...frame(cuffAt, tF), rx: 0.046, rz: 0.043 },
        { ...frame(on(cuffAt, wrist, 0.35), tF), rx: 0.045, rz: 0.042 },
      ], { seg: 18, ...sleeve, jitter: 0.03, seed: left ? 3 : 7, capStart: true, capEnd: true });
      // glove gauntlet with a velcro strap
      B.tube([
        { ...frame(on(cuffAt, wrist, 0.1), tF), rx: 0.041, rz: 0.038 },
        { ...frame(on(cuffAt, wrist, 0.7), tF), rx: 0.037, rz: 0.033 },
        { ...frame(wrist, tF), rx: 0.033, rz: 0.028 },
        { ...frame(on(wrist, p, 0.5), tF), rx: 0.03, rz: 0.022 },
      ], { seg: 16, ...leather });
      B.tube([
        { ...frame(on(cuffAt, wrist, 0.45), tF), rx: 0.0405, rz: 0.0375 },
        { ...frame(on(cuffAt, wrist, 0.75), tF), rx: 0.039, rz: 0.0355 },
      ], { seg: 16, ...rubberK });
      if (left) {
        // wristwatch on the support arm, just above the glove
        const wp = on(cuffAt, e, 0.35);
        B.tube([{ ...frame(on(wp, e, 0.08), tF), rx: 0.0475, rz: 0.0445 }, { ...frame(on(wp, wrist, 0.08), tF), rx: 0.0475, rz: 0.0445 }], { seg: 18, color: 0x1b1c1e, tex: SURF.rubber, rough: 0.5 });
        const f = frame(wp, tF);
        const n = f.z.clone().multiplyScalar(-1);
        const m = new THREE.Matrix4().compose(f.c.clone().addScaledVector(n, 0.046), new THREE.Quaternion().setFromUnitVectors(UP, n), new THREE.Vector3(1, 1, 1));
        B.add(new THREE.CylinderGeometry(0.015, 0.015, 0.009, 18), { matrix: m, color: 0x202224, metal: 0.7, rough: 0.35, tex: SURF.metal });
        B.add(new THREE.CylinderGeometry(0.0115, 0.0115, 0.0015, 18), { matrix: m, p: [0, 0.0048, 0], color: 0x0c1a16, emit: 0.35, rough: 0.08 });
      }
      addHand(wrist, p, left);
    };
    const grip = info.grip || [0, 0, 0];
    const fore = info.fore || [grip[0] - 0.02, grip[1], grip[2] - 0.2];
    const g = grip;
    if (info.kind === 'knife' || info.kind === 'grenade') {
      addArm([g[0], g[1] - 0.01, g[2] + 0.02], [g[0] + 0.06, g[1] - 0.2, g[2] + 0.28], [g[0] + 0.2, g[1] - 0.45, g[2] + 0.55], false);
    } else if (info.kind === 'bomb') {
      addArm([0.1, -0.01, 0.02], [0.16, -0.2, 0.3], [0.3, -0.45, 0.55], false);
      addArm([-0.1, -0.01, 0.02], [-0.18, -0.2, 0.3], [-0.32, -0.45, 0.55], true);
    } else if (info.kind === 'pistol') {
      addArm([g[0] + 0.005, g[1] - 0.035, g[2] + 0.025], [g[0] + 0.07, g[1] - 0.2, g[2] + 0.3], [g[0] + 0.22, g[1] - 0.45, g[2] + 0.55], false);
      addArm([g[0] - 0.028, g[1] - 0.045, g[2] + 0.005], [g[0] - 0.15, g[1] - 0.2, g[2] + 0.28], [g[0] - 0.32, g[1] - 0.45, g[2] + 0.5], true);
    } else {
      addArm([g[0] + 0.005, g[1] - 0.035, g[2] + 0.025], [g[0] + 0.08, g[1] - 0.21, g[2] + 0.3], [g[0] + 0.24, g[1] - 0.45, g[2] + 0.55], false);
      addArm([fore[0] - 0.01, fore[1] - 0.04, fore[2]], [fore[0] - 0.2, fore[1] - 0.24, fore[2] + 0.3], [fore[0] - 0.42, fore[1] - 0.5, fore[2] + 0.6], true);
    }
    const arms = new THREE.Mesh(B.build(false), bakedMaterial());
    arms.name = 'arms';
    arms.position.y = -LIFT;
    arms.frustumCulled = false;
    model.add(arms);
  }

  getModel(id) {
    if (!this.models.has(id)) {
      const m = createWeaponModel(id);
      m.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
      this.buildArms(m, id);
      this.models.set(id, m);
    }
    return this.models.get(id);
  }

  setWeapon(id, deploy = 0.5) {
    if (this.current) this.holder.remove(this.current);
    this.id = id;
    const w = WEAPONS[id];
    this.current = id ? this.getModel(id) : null;
    this.kind = this.current?.userData.kind || 'knife';
    if (this.current) {
      this.holder.add(this.current);
      const info = this.current.userData;
      const g = info.grip || [0, 0, 0];
      this.current.position.set(-g[0], -g[1], -g[2]);
      this.current.rotation.set(0, 0, 0);
      if (this.kind === 'knife') { this.current.rotation.set(0.1, 0.35, -0.25); }
      const pin = this.current.getObjectByName('pin');
      if (pin) pin.visible = true;
      this.current.visible = true;
      const mz = info.muzzle || [0, 0, -0.5];
      this.current.add(this.flash);
      this.flash.position.set(mz[0], mz[1], mz[2] - 0.03);
    }
    this.deployT = 0;
    this.deployDur = Math.max(0.2, deploy);
    this.reloadT = -1;
    this.action = null;
    this.inspectT = -1;
    this.slideT = 1;
    void w;
  }

  fire(strength = 1) {
    this.kick += 0.03 * strength;
    this.kickVel += 0.6 * strength;
    this.kickRotVel += 1.1 * strength;
    this.slideT = 0;
    this.inspectT = -1;
    if (this.current && this.kind !== 'knife' && this.kind !== 'grenade') {
      this.flash.visible = true;
      this.flash.material.rotation = Math.random() * Math.PI * 2;
      const s = (this.kind === 'sniper' || this.kind === 'shotgun' ? 0.32 : this.kind === 'pistol' ? 0.18 : 0.24) * (0.8 + Math.random() * 0.4);
      this.flash.scale.set(s, s, s);
      this.flashT = 0.045;
      this.g.vmFlash.intensity = 6;
      this.ejectShell();
    }
  }

  ejectShell() {
    const info = this.current?.userData;
    if (!info?.eject || this.kind === 'shotgun' || this.kind === 'sniper') return;
    const sh = this.shells[this.shellIdx++ % this.shells.length];
    const p = new THREE.Vector3(...info.eject);
    this.current.localToWorld(p);
    sh.m.position.copy(p);
    sh.m.visible = true;
    sh.v.set(0.9 + Math.random() * 0.5, 0.9 + Math.random() * 0.5, 0.1 + Math.random() * 0.2);
    sh.w.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    sh.life = 0.7;
  }

  reload(duration) {
    this.reloadT = 0;
    this.reloadDur = duration;
    this.inspectT = -1;
  }

  cancelReload() { this.reloadT = -1; }

  play(action, duration) {
    this.action = action;
    this.actionT = 0;
    this.actionDur = duration;
    this.inspectT = -1;
  }

  inspect() { if (this.reloadT < 0 && !this.action) this.inspectT = 0; }

  land(strength) { this.landDip = Math.min(0.06, this.landDip + strength * 0.006); }

  setVisible(v) {
    this.visible = v;
    this.root.visible = v;
  }

  // st: { dt, speed, onGround, crouch, ads (0..1), lookDX, lookDY, walking, lower (0..1), time }
  update(st) {
    const dt = st.dt;
    this.t += dt;
    if (!this.current) return;
    const kind = this.kind;
    const hip = HIP[kind] || HIP.rifle;
    const info = this.current.userData;
    const ads = st.ads || 0;
    // the model hangs from its grip (see setWeapon), so the sight line sits at sightY - grip.y in holder space
    const grip = info.grip || [0, 0, 0];
    const adsPos = [grip[0], grip[1] - (info.sightY || 0.08), ADS_Z[kind] ?? -0.3];

    // springs
    const k = 180, d = 22;
    this.kickVel += (-k * this.kick - d * this.kickVel) * dt;
    this.kick += this.kickVel * dt;
    this.kickRotVel += (-k * this.kickRot - d * this.kickRotVel) * dt;
    this.kickRot += this.kickRotVel * dt;
    const swayTarget = new THREE.Vector2(
      Math.max(-0.06, Math.min(0.06, -st.lookDX * 0.9)),
      Math.max(-0.06, Math.min(0.06, -st.lookDY * 0.9)),
    );
    this.swayVel.x += ((swayTarget.x - this.sway.x) * 120 - this.swayVel.x * 16) * dt;
    this.swayVel.y += ((swayTarget.y - this.sway.y) * 120 - this.swayVel.y * 16) * dt;
    this.sway.addScaledVector(this.swayVel, dt);
    this.landDip *= Math.exp(-dt * 8);

    // bob
    const moveAmp = st.onGround ? Math.min(1, st.speed / 5.5) : 0;
    this.bobPhase += dt * (5 + st.speed * 1.4);
    const bobScale = (1 - ads * 0.85) * (st.bob ?? 1);
    const bx = Math.sin(this.bobPhase) * 0.012 * moveAmp * bobScale;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.011 * moveAmp * bobScale;
    const breathe = Math.sin(this.t * 1.6) * 0.002 * (1 - ads * 0.7);

    let px = hip[0] + (adsPos[0] - hip[0]) * ads + bx + this.sway.x * 0.35 * (1 - ads * 0.7);
    let py = hip[1] + (adsPos[1] - hip[1]) * ads + by + breathe - this.landDip + this.sway.y * 0.25 * (1 - ads * 0.7);
    let pz = hip[2] + (adsPos[2] - hip[2]) * ads + this.kick * (1 - ads * 0.4);
    let rx = this.kickRot * 0.09 + this.sway.y * 0.6 * (1 - ads * 0.6);
    let ry = this.sway.x * 1.0 * (1 - ads * 0.6) + (BASE_YAW[kind] || 0) * (1 - ads);
    let rz = this.sway.x * 0.6 - (st.crouch || 0) * 0.04 * (1 - ads) + bx * 1.2;

    // deploy
    if (this.deployT < 1) {
      this.deployT = Math.min(1, this.deployT + dt / this.deployDur);
      const e = 1 - ease(this.deployT);
      py -= 0.22 * e;
      rx -= 0.9 * e;
      rz += 0.25 * e;
    }

    // reload
    const mag = this.current.getObjectByName('mag');
    const pump = this.current.getObjectByName('pump');
    if (mag) { mag.position.y = mag.userData.baseY ?? (mag.userData.baseY = mag.position.y); mag.visible = true; }
    if (this.reloadT >= 0) {
      this.reloadT += dt / this.reloadDur;
      const p = Math.min(1, this.reloadT);
      const b = bell(p);
      rz += 0.5 * b;
      rx += 0.12 * b;
      py -= 0.06 * b;
      px -= 0.03 * b;
      if (mag && kind !== 'shotgun') {
        const by0 = mag.userData.baseY;
        if (p > 0.12 && p < 0.35) mag.position.y = by0 - ease((p - 0.12) / 0.23) * 0.25;
        else if (p >= 0.35 && p < 0.5) mag.visible = false;
        else if (p >= 0.5 && p < 0.68) mag.position.y = by0 - (1 - ease((p - 0.5) / 0.18)) * 0.25;
      }
      if (kind === 'shotgun') {
        py -= Math.sin(p * Math.PI * 8) * 0.01 * b;
      }
      if (p > 0.8 && p < 0.92) { rx += 0.06; pz += 0.02; }
      if (p >= 1) this.reloadT = -1;
    }

    // actions (knife, grenade, plant)
    if (this.action) {
      this.actionT += dt / this.actionDur;
      const p = Math.min(1, this.actionT);
      if (this.action === 'slash') {
        const a = Math.sin(p * Math.PI);
        px -= 0.2 * a; rz -= 1.1 * a; ry += 0.6 * a; pz -= 0.08 * a;
      } else if (this.action === 'stab') {
        const a = p < 0.35 ? ease(p / 0.35) : 1 - ease((p - 0.35) / 0.65);
        pz -= 0.25 * a; px -= 0.08 * a; rx -= 0.2 * a;
      } else if (this.action === 'pullpin') {
        const a = ease(Math.min(1, p * 2));
        pz += 0.08 * a; py += 0.04 * a; rx -= 0.25 * a;
        const pin = this.current.getObjectByName('pin');
        if (pin && p > 0.5) pin.visible = false;
      } else if (this.action === 'throw') {
        const a = p < 0.3 ? ease(p / 0.3) : 1;
        pz -= 0.35 * a; py += 0.1 * a - 0.4 * Math.max(0, (p - 0.3) / 0.7); rx -= 0.8 * a;
        if (p > 0.3) this.current.visible = false;
      } else if (this.action === 'pump') {
        const a = Math.sin(p * Math.PI);
        if (pump) pump.position.z = -0.4 + 0.08 * a;
        rx += 0.05 * a;
      } else if (this.action === 'bolt') {
        const a = Math.sin(p * Math.PI);
        rz += 0.25 * a; py -= 0.03 * a;
      }
      if (p >= 1) {
        if (this.action === 'pump' && pump) pump.position.z = -0.4;
        this.action = null;
      }
    }

    // inspect
    if (this.inspectT >= 0) {
      this.inspectT += dt / 2.6;
      const p = Math.min(1, this.inspectT);
      const b = bell(p, 0.18, 0.82);
      ry += 0.9 * b + Math.sin(p * Math.PI * 2) * 0.2 * b;
      rz += 0.6 * b;
      rx += 0.25 * b;
      px -= 0.08 * b;
      py += 0.03 * b;
      if (p >= 1) this.inspectT = -1;
    }

    // lowered (planting / defusing / buying)
    this.lowered += ((st.lower || 0) - this.lowered) * Math.min(1, dt * 8);
    py -= this.lowered * 0.3;
    rx -= this.lowered * 0.6;

    // pistol slide / bolt blowback
    const slide = this.current.getObjectByName('slide');
    if (this.slideT < 1) {
      this.slideT = Math.min(1, this.slideT + dt / 0.08);
      if (slide) slide.position.z = (slide.userData.baseZ ?? (slide.userData.baseZ = slide.position.z)) + Math.sin(this.slideT * Math.PI) * 0.025;
    }

    const stock = this.current.getObjectByName('stock');
    if (stock) stock.visible = ads < 0.55;

    this.holder.position.set(px, py, pz);
    this.holder.rotation.set(rx, ry, rz);

    // muzzle flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flash.visible = false; this.g.vmFlash.intensity = 0; }
    }

    // shells
    for (const s of this.shells) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.v.y -= 9.8 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.w.x * dt; s.m.rotation.y += s.w.y * dt; s.m.rotation.z += s.w.z * dt;
      if (s.life <= 0) s.m.visible = false;
    }
  }
}
