// First-person weapon + arms with procedural animation.

import * as THREE from 'three';
import { createWeaponModel } from './models.js';
import { WEAPONS } from '../shared/weapons.js';

const HIP = {
  pistol: [0.15, -0.165, -0.36],
  smg: [0.165, -0.185, -0.4],
  rifle: [0.17, -0.19, -0.42],
  shotgun: [0.17, -0.19, -0.42],
  sniper: [0.17, -0.19, -0.42],
  knife: [0.2, -0.2, -0.36],
  grenade: [0.19, -0.19, -0.36],
  bomb: [0.08, -0.24, -0.4],
};
const ADS_Z = { pistol: -0.34, smg: -0.3, rifle: -0.26, shotgun: -0.3, sniper: -0.26 };

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
    if (this.look && this.look.uniform === look.uniform && this.look.gloves === look.gloves) return;
    this.look = look;
    // rebuild arms on all cached models
    for (const [id, m] of this.models) this.buildArms(m, id);
  }

  buildArms(model, id) {
    const old = model.getObjectByName('arms');
    if (old) model.remove(old);
    const look = this.look || { uniform: 0x555555, gloves: 0x222222 };
    const info = model.userData;
    const arms = new THREE.Group();
    arms.name = 'arms';
    const sleeve = new THREE.MeshStandardMaterial({ color: look.uniform, roughness: 0.85 });
    const glove = new THREE.MeshStandardMaterial({ color: look.gloves, roughness: 0.75 });
    const cuff = new THREE.MeshStandardMaterial({ color: look.accent ?? 0x444444, roughness: 0.7 });
    const addArm = (hand, shoulder, left) => {
      const h = new THREE.Vector3(...hand), s = new THREE.Vector3(...shoulder);
      const dir = h.clone().sub(s);
      const len = dir.length();
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, len, 4, 10), sleeve);
      arm.position.copy(s).addScaledVector(dir, 0.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      arms.add(arm);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.039, 0.03, 12), cuff);
      c.position.copy(h).addScaledVector(dir, -0.12 / len);
      c.quaternion.copy(arm.quaternion);
      arms.add(c);
      const gl = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.09), glove);
      gl.position.copy(h);
      gl.quaternion.copy(arm.quaternion);
      arms.add(gl);
      // thumb/fingers hint
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.05), glove);
      f.position.copy(h).add(new THREE.Vector3(left ? 0.02 : -0.02, 0.02, -0.03));
      arms.add(f);
    };
    const grip = info.grip || [0, 0, 0];
    const fore = info.fore || [grip[0] - 0.02, grip[1], grip[2] - 0.2];
    if (info.kind === 'knife' || info.kind === 'grenade') {
      addArm([grip[0] + 0.005, grip[1] - 0.01, grip[2] + 0.03], [grip[0] + 0.12, grip[1] - 0.32, grip[2] + 0.42], false);
    } else if (info.kind === 'bomb') {
      addArm([0.09, -0.02, 0.02], [0.18, -0.35, 0.4], false);
      addArm([-0.09, -0.02, 0.02], [-0.2, -0.35, 0.4], true);
    } else {
      addArm([grip[0] + 0.01, grip[1] - 0.03, grip[2] + 0.03], [grip[0] + 0.1, grip[1] - 0.32, grip[2] + 0.42], false);
      addArm([fore[0] - 0.01, fore[1] - 0.035, fore[2]], [fore[0] - 0.24, fore[1] - 0.3, fore[2] + 0.46], true);
    }
    arms.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
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
    const adsPos = [0, -(info.sightY || 0.08), ADS_Z[kind] ?? -0.3];

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
    let ry = this.sway.x * 1.0 * (1 - ads * 0.6);
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
