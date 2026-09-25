// Player characters (third person). Weapon models live in guns.js.

import * as THREE from 'three';
import { PLAYER } from '../shared/constants.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bakedMaterial } from './surface.js';
import { makeRig, operatorGeometry, teamLook, UPPER_ARM, FORE_ARM } from './character.js';
import { M, bakedWeapon, createWeaponModel, weaponTemplate } from './guns.js';

export { teamLook, bakedMaterial, bakedWeapon, createWeaponModel, weaponTemplate };

// Per weapon kind: where the firing hand holds the grip (model space, relative to the aim pivot at
// shoulder height) and how far the shoulders turn (bladed stance) so the support hand reaches forward.
const STANCE = {
  rifle: { grip: [0.1, -0.13, -0.3], twist: -0.35 },
  smg: { grip: [0.1, -0.12, -0.3], twist: -0.3 },
  shotgun: { grip: [0.1, -0.13, -0.3], twist: -0.35 },
  sniper: { grip: [0.1, -0.12, -0.28], twist: -0.38 },
  pistol: { grip: [0.04, -0.07, -0.44], twist: -0.1 },
  knife: { grip: [0.19, -0.26, -0.3], twist: 0, relaxed: true },
  grenade: { grip: [0.19, -0.1, -0.26], twist: 0, relaxed: true },
  bomb: { grip: [0.05, -0.24, -0.34], twist: 0 },
};
const DOWN = new THREE.Vector3(0, -1, 0);
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const POLE = { r: new THREE.Vector3(0.9, -1, 0.35).normalize(), l: new THREE.Vector3(-0.9, -1, 0.2).normalize() };
const RELAXED_L = new THREE.Vector3(-0.2, -0.46, -0.1);
const _limb = new THREE.Euler();
const _ik = { d: new THREE.Vector3(), dir: new THREE.Vector3(), perp: new THREE.Vector3(), u: new THREE.Vector3(), e: new THREE.Vector3(), f: new THREE.Vector3(), q: new THREE.Quaternion(), t: new THREE.Vector3(), v: new THREE.Vector3() };

// Analytic two-bone IK in the aim bone's space: shoulder S -> target T, elbow bent towards pole.
function solveArm(arm, T, pole) {
  const S = arm.grp.position;
  const a = UPPER_ARM, b = FORE_ARM;
  const d = _ik.d.subVectors(T, S);
  let dist = d.length();
  const maxR = (a + b) * 0.995;
  if (dist > maxR) { d.multiplyScalar(maxR / dist); dist = maxR; }
  if (dist < 0.08) { d.set(0, -0.08, 0); dist = 0.08; }
  const dir = _ik.dir.copy(d).divideScalar(dist);
  const cosA = Math.max(-1, Math.min(1, (a * a + dist * dist - b * b) / (2 * a * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const perp = _ik.perp.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0);
  perp.normalize();
  const u = _ik.u.copy(dir).multiplyScalar(cosA).addScaledVector(perp, sinA);
  const e = _ik.e.copy(S).addScaledVector(u, a);
  const f = _ik.f.copy(S).add(d).sub(e).normalize();
  arm.grp.quaternion.setFromUnitVectors(DOWN, u);
  f.applyQuaternion(_ik.q.copy(arm.grp.quaternion).invert());
  arm.elbow.quaternion.setFromUnitVectors(DOWN, f);
}

export class PlayerModel {
  constructor(look, name = '', showName = false) {
    const L = look;
    const rig = makeRig();
    const { body, hips, legs, spine, chest, neck, head, aim, arms } = rig;
    const mesh = new THREE.SkinnedMesh(operatorGeometry(L), bakedMaterial());
    mesh.add(body);
    mesh.bind(new THREE.Skeleton(rig.bones));
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const weaponMount = new THREE.Group();
    weaponMount.position.fromArray(STANCE.rifle.grip);
    aim.add(weaponMount);
    const bomb = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.12, 0.16, 1, 0.02), M.color(0x5a5245, 0.2, 0.7));
    bomb.position.set(0, -0.04, 0.3);
    bomb.visible = false;
    bomb.castShadow = true;
    chest.add(bomb);

    const root = new THREE.Group();
    root.add(mesh);
    this.root = root;
    this.mesh = mesh;
    this.body = body;
    this.hips = hips;
    this.legs = legs;
    this.spine = spine;
    this.chest = chest;
    this.head = head;
    this.neck = neck;
    this.aim = aim;
    this.arms = arms;
    this.weaponMount = weaponMount;
    this.bombMesh = bomb;
    this.weaponId = null;
    this.weapon = null;
    this.walkPhase = 0;
    this.deathT = -1;
    this.deathX = 0;
    this.deathZ = 1;
    this.deathSpin = 0;
    this.recoil = 0;
    this.reloadT = 0;
    this.reloadK = 0;
    this.breath = Math.random() * 6;

    if (name) {
      this.tag = makeNameTag(name, L.accent);
      this.tag.position.y = 2.1;
      this.tag.visible = showName;
      root.add(this.tag);
    }
  }

  setWeapon(id) {
    if (this.weaponId === id) return;
    this.weaponId = id;
    if (this.weapon) this.weaponMount.remove(this.weapon);
    this.weapon = bakedWeapon(id || 'knife');
    const info = this.weapon.userData;
    const grip = info.grip || [0, 0, 0];
    this.weapon.position.set(-grip[0], -grip[1], -grip[2]);
    if (info.kind === 'knife') { this.weapon.rotation.set(0, 0, 0); this.weapon.position.set(0.02, 0.02, 0.18); }
    if (info.kind === 'grenade' || info.kind === 'bomb') this.weapon.position.set(0.0, 0.0, 0.2);
    if (this.layer != null) this.weapon.layers.set(this.layer);
    if (this.deathT >= 0) this.weapon.visible = false;
    this.weaponMount.add(this.weapon);
  }

  // Render layer for the whole model, including weapons equipped later (own shadow-only body).
  setLayer(layer) {
    this.layer = layer;
    this.root.traverse((o) => o.layers.set(layer));
  }

  muzzleWorld(out = new THREE.Vector3()) {
    if (!this.weapon) return this.root.getWorldPosition(out);
    const m = this.weapon.userData.muzzle || [0, 0, -0.5];
    out.set(m[0], m[1], m[2]);
    return this.weapon.localToWorld(out);
  }

  // push: world-space direction the body is knocked towards (e.g. away from the killer), or a number
  // for a plain backwards (+1) / forwards (-1) fall.
  die(push = 1, pushZ) {
    if (this.deathT >= 0) return;
    this.deathT = 0;
    let lx = 0, lz = 1;
    if (typeof push === 'number' && pushZ === undefined) lz = push >= 0 ? 1 : -1;
    else {
      const yaw = this.root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
      lx = push * c - pushZ * s;
      lz = push * s + pushZ * c;
      const L = Math.hypot(lx, lz) || 1;
      lx /= L; lz /= L;
    }
    this.deathX = lx;
    this.deathZ = lz;
    this.deathSpin = (Math.random() - 0.5) * 0.8;
    this.deathHead = (Math.random() - 0.5) * 1.2;
    if (this.weapon) this.weapon.visible = false; // it drops from the hands
  }

  // A bullet hit: the upper body jolts away from the shot (dirX, dirZ: world direction of travel).
  flinch(dirX, dirZ, headshot = false) {
    const yaw = this.root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
    const lx = dirX * c - dirZ * s, lz = dirX * s + dirZ * c;
    const L = Math.hypot(lx, lz) || 1;
    this.flinchX = lx / L;
    this.flinchZ = lz / L;
    this.flinchHS = headshot;
    this.flinchT = 0;
  }

  revive() {
    this.deathT = -1;
    if (this.weapon) this.weapon.visible = true;
    this.chest.rotation.set(0, 0, 0);
    this.hips.rotation.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.hips.position.set(0, 0.92, 0);
  }

  // s: { x,y,z,yaw,pitch,crouch,lean, speed, vx, vz, alive, onGround, planting, defusing, bomb, reloading }
  update(s, dt) {
    const root = this.root;
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = s.yaw;
    const arms = this.arms;
    if (this.deathT >= 0) {
      // knees give way, then the body topples (accelerating like a fall), hits the ground, settles;
      // arms go limp, the head rolls
      this.deathT = Math.min(1, this.deathT + dt / 1.05);
      const t = this.deathT;
      const sm = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
      const buckle = sm(0, 0.28, t);
      const fall = Math.pow(sm(0.12, 0.7, t), 1.7);
      const u = Math.max(0, (t - 0.7) / 0.3);
      const bounce = t > 0.7 ? Math.sin(u * Math.PI) * (1 - u) * 0.1 : 0;
      const tip = fall * (Math.PI / 2) * 0.96 - bounce;
      this.body.rotation.set(tip * this.deathZ, this.deathSpin * fall, -tip * this.deathX * 0.9);
      this.body.position.set(this.deathX * fall * 0.42, 0, this.deathZ * fall * 0.42);
      this.hips.position.set(0, 0.92 - buckle * 0.26 * (1 - fall * 0.4) - fall * 0.5, 0);
      this.hips.rotation.set(0, 0, 0);
      const slump = buckle * (1 - fall);
      // (positive x tilts a bone's top backwards: the slump is forwards)
      this.spine.rotation.set(-slump * 0.35 - fall * 0.08 * this.deathZ, 0, fall * 0.12 * this.deathX);
      this.chest.rotation.set(-slump * 0.2 - fall * 0.1, 0, 0);
      this.aim.rotation.set(-slump * 0.15, 0, 0);
      this.head.rotation.set(-slump * 0.5 + fall * 0.35 * this.deathZ, fall * this.deathHead * 0.6, fall * this.deathHead * 0.4);
      for (let i = 0; i < 2; i++) {
        const sgn = i ? -1 : 1;
        this.legs[i].thigh.rotation.set(slump * 0.75 + fall * (i ? 0.1 : 0.35), 0, sgn * (0.04 + fall * 0.12));
        this.legs[i].knee.rotation.set(-slump * 1.25 - fall * (i ? 0.2 : 0.55), 0, 0);
      }
      const k = 1 - Math.exp(-dt * 14);
      for (const key of ['r', 'l']) {
        const a = arms[key], side = key === 'r' ? 1 : -1;
        _ik.q.setFromEuler(_limb.set(0.15 + fall * 0.35 * this.deathZ, 0, side * (0.15 + fall * 0.55)));
        a.grp.quaternion.slerp(_ik.q, k);
        _ik.q.setFromEuler(_limb.set(0.35 + slump * 0.4, 0, 0));
        a.elbow.quaternion.slerp(_ik.q, k);
      }
      return;
    }
    const c = s.crouch || 0;
    const speed = s.speed || 0;
    const moving = speed > 0.3 && s.onGround;
    // split velocity into forward / sideways in the model's frame so strafing and backpedalling read correctly
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const vx = s.vx ?? -sy * speed, vz = s.vz ?? -cy * speed;
    const fwd = -(vx * sy + vz * cy), side = vx * cy - vz * sy;
    const fk = speed > 0.01 ? fwd / Math.max(speed, 0.01) : 1;
    const sk = speed > 0.01 ? side / Math.max(speed, 0.01) : 0;
    const amp = Math.min(1, speed / 5) * (1 - c * 0.4);
    if (moving) this.walkPhase += dt * (4 + speed * 1.6) * (1 - c * 0.3) * (fk < -0.3 ? -1 : 1);
    else this.walkPhase *= 0.9;
    const ph = this.walkPhase;
    this.breath += dt;
    // landing dip after a jump or fall
    if (s.onGround && this.wasAir) this.landT = 0;
    this.wasAir = !s.onGround;
    this.landT = Math.min(1, (this.landT ?? 1) + dt / 0.35);
    const land = Math.sin(this.landT * Math.PI) * (1 - this.landT) * 0.16;
    const hipsY = 0.92 - c * 0.4 - (moving ? Math.abs(Math.sin(ph)) * 0.035 * amp : 0) - land;
    this.hips.position.y = hipsY;
    // weight over the stance leg: lateral sway and pelvis roll while walking, a slow shift when idle
    this.hips.position.x = moving ? Math.sin(ph) * 0.022 * amp : Math.sin(this.breath * 0.45) * 0.008;
    this.hips.rotation.z = moving ? Math.sin(ph) * 0.05 * amp : Math.sin(this.breath * 0.45) * 0.012;
    this.hips.rotation.y = moving ? sk * 0.35 * Math.sign(fk || 1) : 0;
    const air = !s.onGround ? 0.5 : 0;
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? 1 : -1;
      const phase = ph + (i ? Math.PI : 0);
      const swing = moving ? Math.sin(phase) * 0.6 * amp : 0;
      const bend = moving ? Math.max(0, Math.sin(phase + Math.PI / 2)) * 0.9 * amp : 0;
      this.legs[i].thigh.rotation.x = swing * Math.max(Math.abs(fk), 0.35) + c * 1.25 + air * (i ? 0.2 : 0.7);
      this.legs[i].knee.rotation.x = -bend - (moving ? 0.12 * amp : 0.04) - c * 2.0 - air * 0.9 - land * 1.4;
      if (land) this.legs[i].thigh.rotation.x += land * 0.7;
      this.legs[i].thigh.rotation.z = sgn * 0.03 + (moving ? Math.sin(phase) * 0.25 * amp * sk * sgn : 0);
    }
    const run = Math.max(0, Math.min(1, (speed - 3.5) / 2));
    this.spine.rotation.x = c * 0.25 + (moving ? (0.05 + run * 0.1) * Math.sign(fk || 1) : 0) + Math.sin(this.breath * 1.7) * 0.012 + land * 0.4;
    this.spine.rotation.z = -(s.lean || 0) * 0.5 - this.hips.rotation.z * 0.8;
    this.spine.rotation.y = (moving ? Math.sin(ph) * 0.06 * amp : 0) - this.hips.rotation.y;
    const pitch = s.pitch || 0;
    this.recoil *= Math.exp(-dt * 14);
    const info = this.weapon?.userData || {};
    const st = STANCE[info.kind] || STANCE.rifle;
    const tw = st.twist;
    let aimX = pitch - c * 0.25 + this.recoil;
    this.head.rotation.x = pitch * 0.6 - c * 0.2;
    if (s.planting || s.defusing) {
      aimX = -0.9;
      this.head.rotation.x = -0.6;
    } else if (s.reinforcing) {
      aimX = -0.35 + Math.sin(this.breath * 9) * 0.06;
      this.head.rotation.x = -0.2;
    }
    // the upper chest takes part of the pitch and most of the bladed-stance twist, the shoulders the rest
    const chestX = Math.max(-0.3, Math.min(0.25, aimX * 0.3));
    this.chest.rotation.set(chestX, tw * 0.7, 0);
    this.aim.rotation.set(aimX - chestX, tw * 0.3, 0);
    if (this.flinchT !== undefined && this.flinchT < 1) {
      this.flinchT = Math.min(1, this.flinchT + dt / 0.3);
      const e = Math.sin(this.flinchT * Math.PI) * (1 - this.flinchT * 0.4);
      this.chest.rotation.x += this.flinchZ * 0.2 * e;
      this.chest.rotation.z -= this.flinchX * 0.16 * e;
      this.head.rotation.x += (this.flinchHS ? 0.5 : 0.12) * this.flinchZ * e;
      this.head.rotation.z -= (this.flinchHS ? 0.35 : 0.06) * this.flinchX * e;
    }
    // reload: weapon rolls towards the body, support hand goes to the magazine and back
    const wantReload = s.reloading ? 1 : 0;
    this.reloadK += (wantReload - this.reloadK) * Math.min(1, dt * 10);
    if (s.reloading) this.reloadT += dt; else this.reloadT = 0;
    const rk = this.reloadK;
    const cyc = Math.sin(this.reloadT * 5.5);
    // the aim bone is turned by `tw`; counter-rotate the weapon so it still points straight ahead
    const wm = this.weaponMount;
    wm.position.fromArray(st.grip).applyAxisAngle(UP_AXIS, -tw);
    wm.rotation.set(rk * 0.15, -tw, rk * 0.55);
    wm.updateMatrix();
    solveArm(arms.r, wm.position, POLE.r);
    // support hand: slide from the fore-grip back towards the firing hand until it is within reach
    const T = _ik.t;
    if (st.relaxed) T.copy(RELAXED_L);
    else {
      const grip = info.grip || [0, 0, 0];
      const fore = info.fore || grip;
      const off = _ik.v.set(fore[0] - grip[0], fore[1] - grip[1], fore[2] - grip[2]).applyQuaternion(wm.quaternion);
      const S = arms.l.grp.position;
      const reach = (UPPER_ARM + FORE_ARM) * 0.97;
      let k = 1;
      for (let i = 0; i < 8; i++) {
        T.copy(wm.position).addScaledVector(off, k);
        if (T.distanceTo(S) <= reach) break;
        k -= 0.125;
      }
      if (rk > 0.01) {
        // magazine sits just below the receiver in front of the grip
        _ik.v.set(0, -0.12 - cyc * 0.05 * rk, -0.1).applyQuaternion(wm.quaternion).add(wm.position);
        T.lerp(_ik.v, rk);
      }
    }
    solveArm(arms.l, T, POLE.l);
    this.bombMesh.visible = !!s.bomb;
  }

  kick(amount = 0.08) { this.recoil = Math.min(0.3, this.recoil + amount); }
}

function makeNameTag(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Segoe UI, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(name, 128, 32);
  g.fillStyle = '#' + new THREE.Color(color).getHexString();
  g.fillText(name, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, fog: false }));
  s.scale.set(0.9, 0.225, 1);
  s.renderOrder = 10;
  return s;
}

export const HEIGHT = PLAYER.height;
