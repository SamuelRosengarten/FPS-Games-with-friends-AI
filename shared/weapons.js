// Weapon definitions shared between client and server.
// Angles are in degrees, distances in metres, times in seconds.

import { clamp, lerp, DEG, PLAYER } from './constants.js';

const W = {};

function def(id, o) {
  W[id] = Object.freeze({
    id,
    pellets: 1,
    headMul: 4,
    falloff: 0.95,
    range: 200,
    auto: false,
    pen: 0.5,
    wallDmg: 1,
    speed: 1,
    scopedSpeed: null,
    deploy: 0.7,
    killReward: 300,
    ...o,
  });
}

// ---------------------------------------------------------------- melee
def('knife', {
  name: 'Combat Knife', short: 'Knife', type: 'melee', slot: 'knife', price: 0, killReward: 1500,
  damage: 34, heavyDamage: 60, backstab: 90, heavyBackstab: 180,
  interval: 0.42, heavyInterval: 1.0, range: 1.85, speed: 1.0, deploy: 0.45, wallDmg: 1.5,
  sound: { kind: 'knife' },
  model: { kind: 'knife' },
});

// ---------------------------------------------------------------- pistols
def('p9', {
  name: 'P9 Striker', short: 'P9', type: 'pistol', slot: 'secondary', price: 200,
  damage: 28, armorPen: 0.47, falloff: 0.82, interval: 0.15, mag: 20, reserve: 120, reload: 2.2, speed: 0.96, pen: 0.4,
  spread: { base: 0.45, move: 1.5, air: 6, crouch: 0.8, ads: 0.65, bloom: 0.35, bloomMax: 2.2, recover: 6 },
  recoil: { up: 1.1, max: 6, side: 0.5, sideFreq: 1.3, sideStart: 2, rand: 0.35, recover: 9 },
  sound: { freq: 1900, len: 0.16, low: 0.5, vol: 0.8 },
  model: { kind: 'pistol', body: 0x2b2d31, accent: 0x5a5f66, len: 0.19 },
});
def('p2k', {
  name: 'Warden P2', short: 'P2', type: 'pistol', slot: 'secondary', price: 200,
  damage: 35, armorPen: 0.505, falloff: 0.88, interval: 0.17, mag: 12, reserve: 48, reload: 2.2, speed: 0.96, pen: 0.45,
  spread: { base: 0.35, move: 1.3, air: 6, crouch: 0.8, ads: 0.65, bloom: 0.4, bloomMax: 2.3, recover: 6 },
  recoil: { up: 1.35, max: 6.5, side: 0.4, sideFreq: 1.1, sideStart: 2, rand: 0.3, recover: 9 },
  sound: { freq: 1600, len: 0.18, low: 0.6, vol: 0.85 },
  model: { kind: 'pistol', body: 0x1c1e22, accent: 0x8c7853, len: 0.21 },
});
def('deagle', {
  name: 'Magnum .50', short: 'Magnum', type: 'pistol', slot: 'secondary', price: 700,
  damage: 63, armorPen: 0.93, falloff: 0.88, interval: 0.26, mag: 7, reserve: 35, reload: 2.2, speed: 0.93, pen: 0.9, deploy: 0.75,
  spread: { base: 0.4, move: 3.0, air: 8, crouch: 0.8, ads: 0.6, bloom: 1.3, bloomMax: 4.5, recover: 3.5 },
  recoil: { up: 3.4, max: 12, side: 1.1, sideFreq: 1.7, sideStart: 1, rand: 0.6, recover: 6 },
  sound: { freq: 900, len: 0.32, low: 1.1, vol: 1.0 },
  model: { kind: 'pistol', body: 0x9a9da3, accent: 0x3b3d42, len: 0.27, big: true },
});

// ---------------------------------------------------------------- SMGs
def('rattler', {
  name: 'Rattler SMG', short: 'Rattler', type: 'smg', slot: 'primary', price: 1050, killReward: 600,
  damage: 28, armorPen: 0.57, falloff: 0.82, interval: 0.07, auto: true, mag: 30, reserve: 100, reload: 2.4, speed: 0.97, pen: 0.45,
  spread: { base: 0.85, move: 1.4, air: 5, crouch: 0.8, ads: 0.7, bloom: 0.16, bloomMax: 2.2, recover: 7 },
  recoil: { up: 0.7, max: 6, side: 1.8, sideFreq: 1.1, sideStart: 5, rand: 0.35, recover: 8 },
  sound: { freq: 2200, len: 0.12, low: 0.4, vol: 0.75 },
  model: { kind: 'smg', body: 0x2a2c2e, accent: 0x6b6f75, len: 0.34, stubby: true },
});
def('smg', {
  name: 'Hornet SMG', short: 'Hornet', type: 'smg', slot: 'primary', price: 1250, killReward: 600,
  damage: 26, armorPen: 0.6, falloff: 0.86, interval: 0.075, auto: true, mag: 30, reserve: 120, reload: 2.1, speed: 0.96, pen: 0.5,
  spread: { base: 0.6, move: 1.2, air: 5, crouch: 0.8, ads: 0.62, bloom: 0.12, bloomMax: 1.7, recover: 7 },
  recoil: { up: 0.55, max: 5, side: 1.2, sideFreq: 0.9, sideStart: 6, rand: 0.25, recover: 8 },
  sound: { freq: 2000, len: 0.13, low: 0.45, vol: 0.75 },
  model: { kind: 'smg', body: 0x3a3d33, accent: 0x1e1f1c, len: 0.42 },
});

// ---------------------------------------------------------------- shotgun
def('shotgun', {
  name: 'Breacher 12', short: 'Breacher', type: 'shotgun', slot: 'primary', price: 1100, killReward: 900,
  damage: 24, pellets: 9, armorPen: 0.5, falloff: 0.42, range: 45, interval: 0.85, mag: 7, reserve: 32, reload: 2.8, speed: 0.92,
  pen: 0.3, wallDmg: 2.6, deploy: 0.75,
  spread: { base: 3.3, move: 1.0, air: 3, crouch: 0.9, ads: 0.8, bloom: 0, bloomMax: 0, recover: 5 },
  recoil: { up: 4.2, max: 10, side: 0.8, sideFreq: 1.3, sideStart: 1, rand: 0.8, recover: 5 },
  sound: { freq: 700, len: 0.38, low: 1.3, vol: 1.0 },
  model: { kind: 'shotgun', body: 0x222222, accent: 0x6b4a2b, len: 0.78 },
});

// ---------------------------------------------------------------- rifles
def('marauder', {
  name: 'Marauder', short: 'Marauder', type: 'rifle', slot: 'primary', price: 2000,
  damage: 30, armorPen: 0.77, falloff: 0.94, interval: 0.09, auto: true, mag: 35, reserve: 90, reload: 2.9, speed: 0.88, pen: 0.85,
  spread: { base: 0.4, move: 4.2, air: 8, crouch: 0.8, ads: 0.6, bloom: 0.14, bloomMax: 2.0, recover: 5 },
  recoil: { up: 0.8, max: 6.5, side: 2.0, sideFreq: 0.6, sideStart: 8, rand: 0.2, recover: 6 },
  sound: { freq: 1500, len: 0.2, low: 0.75, vol: 0.9 },
  model: { kind: 'rifle', body: 0x4a4f3c, accent: 0x2a2a2a, len: 0.82, style: 'marauder' },
});
def('ar', {
  name: 'Striker AR', short: 'Striker', type: 'rifle', slot: 'primary', price: 2700,
  damage: 36, armorPen: 0.775, falloff: 0.96, interval: 0.1, auto: true, mag: 30, reserve: 90, reload: 2.5, speed: 0.86, pen: 1.0,
  deploy: 0.9,
  spread: { base: 0.3, move: 4.5, air: 8, crouch: 0.8, ads: 0.58, bloom: 0.15, bloomMax: 2.0, recover: 5 },
  recoil: { up: 1.0, max: 7.5, side: 2.2, sideFreq: 0.55, sideStart: 8, rand: 0.2, recover: 6 },
  sound: { freq: 1250, len: 0.22, low: 0.9, vol: 0.95 },
  model: { kind: 'rifle', body: 0x252525, accent: 0x7a4a24, len: 0.88, style: 'ak' },
});
def('m4', {
  name: 'Guardian M4', short: 'Guardian', type: 'rifle', slot: 'primary', price: 2900,
  damage: 33, armorPen: 0.7, falloff: 0.95, interval: 0.09, auto: true, mag: 30, reserve: 90, reload: 3.0, speed: 0.9, pen: 0.95,
  deploy: 0.9,
  spread: { base: 0.25, move: 4.0, air: 8, crouch: 0.8, ads: 0.55, bloom: 0.12, bloomMax: 1.7, recover: 5.5 },
  recoil: { up: 0.85, max: 6.5, side: 1.8, sideFreq: 0.6, sideStart: 8, rand: 0.18, recover: 6 },
  sound: { freq: 1450, len: 0.2, low: 0.8, vol: 0.9 },
  model: { kind: 'rifle', body: 0x2d3136, accent: 0x1a1c1f, len: 0.86, style: 'm4' },
});

// ---------------------------------------------------------------- snipers
def('scout', {
  name: 'Kestrel', short: 'Kestrel', type: 'sniper', slot: 'primary', price: 1700,
  damage: 88, armorPen: 0.85, falloff: 0.98, interval: 1.25, mag: 10, reserve: 90, reload: 3.0, speed: 0.95, scopedSpeed: 0.88,
  pen: 1.4, deploy: 1.0,
  scope: [0.42, 0.2],
  spread: { base: 2.2, scoped: 0.06, move: 5, air: 6, crouch: 0.85, bloom: 0, bloomMax: 0, recover: 5 },
  recoil: { up: 2.4, max: 6, side: 0.4, sideFreq: 1, sideStart: 1, rand: 0.4, recover: 4 },
  sound: { freq: 1100, len: 0.45, low: 1.0, vol: 1.0 },
  model: { kind: 'sniper', body: 0x3d4a3a, accent: 0x1f1f1f, len: 1.0 },
});
def('awp', {
  name: 'Longbow', short: 'Longbow', type: 'sniper', slot: 'primary', price: 4750, killReward: 100,
  damage: 115, armorPen: 0.975, falloff: 0.99, interval: 1.46, mag: 5, reserve: 30, reload: 3.6, speed: 0.82, scopedSpeed: 0.6,
  pen: 2.5, deploy: 1.2, headMul: 4,
  scope: [0.38, 0.12],
  spread: { base: 5.0, scoped: 0.03, move: 8, air: 10, crouch: 0.85, bloom: 0, bloomMax: 0, recover: 5 },
  recoil: { up: 3.6, max: 8, side: 0.5, sideFreq: 1, sideStart: 1, rand: 0.4, recover: 3 },
  sound: { freq: 700, len: 0.7, low: 1.5, vol: 1.1 },
  model: { kind: 'sniper', body: 0x3b4d2e, accent: 0x1b1b1b, len: 1.15, heavy: true },
});

// ---------------------------------------------------------------- grenades & bomb
def('frag', {
  name: 'Frag Grenade', short: 'Frag', type: 'grenade', slot: 'grenade', price: 300, max: 1,
  damage: 98, radius: 7.5, fuse: 1.7, speed: 1.0, deploy: 0.5, interval: 0.9,
  model: { kind: 'grenade', body: 0x3f4a2c },
});
def('flash', {
  name: 'Flashbang', short: 'Flash', type: 'grenade', slot: 'grenade', price: 200, max: 2,
  fuse: 1.5, speed: 1.0, deploy: 0.5, interval: 0.9,
  model: { kind: 'grenade', body: 0x9aa0a6 },
});
def('smoke', {
  name: 'Smoke Grenade', short: 'Smoke', type: 'grenade', slot: 'grenade', price: 300, max: 1,
  fuse: 1.4, speed: 1.0, deploy: 0.5, interval: 0.9, duration: 18, radius: 4.6,
  model: { kind: 'grenade', body: 0x5b6d7a },
});
def('breach', {
  name: 'Breach Charge', short: 'Breach', type: 'grenade', slot: 'grenade', price: 400, max: 1, team: 1,
  damage: 80, radius: 3.6, breakRadius: 2.1, fuse: 1.6, sticky: true, speed: 1.0, deploy: 0.5, interval: 0.9,
  model: { kind: 'grenade', body: 0x3b3f36 },
});
def('bomb', {
  name: 'Bomb', short: 'Bomb', type: 'bomb', slot: 'bomb', price: 0, speed: 1.0, deploy: 0.6, interval: 1,
  model: { kind: 'bomb' },
});

export const WEAPONS = Object.freeze(W);

export const GRENADES = ['frag', 'flash', 'smoke', 'breach'];

export const GEAR = Object.freeze({
  kevlar: { id: 'kevlar', name: 'Kevlar Vest', price: 650 },
  helmet: { id: 'helmet', name: 'Kevlar + Helmet', price: 1000 },
  kit: { id: 'kit', name: 'Defuse Kit', price: 400, team: 2 },
});

// Buy menu layout.
export const BUY_MENU = [
  { name: 'Pistols', items: ['p9', 'p2k', 'deagle'] },
  { name: 'SMGs & Heavy', items: ['rattler', 'smg', 'shotgun'] },
  { name: 'Rifles', items: ['marauder', 'ar', 'm4'] },
  { name: 'Snipers', items: ['scout', 'awp'] },
  { name: 'Gear', items: ['kevlar', 'helmet', 'kit'] },
  { name: 'Grenades', items: ['frag', 'flash', 'smoke', 'breach'] },
];

export const GUNGAME_ORDER = ['smg', 'rattler', 'shotgun', 'marauder', 'm4', 'ar', 'scout', 'awp', 'deagle', 'p2k', 'p9', 'knife'];

export const DEFAULT_PISTOL = { 1: 'p9', 2: 'p2k' };

export function itemPrice(id) {
  return WEAPONS[id]?.price ?? GEAR[id]?.price ?? Infinity;
}
export function itemName(id) {
  return WEAPONS[id]?.name ?? GEAR[id]?.name ?? id;
}

// Cumulative recoil offset [yawDeg, pitchDeg] after `i` shots of a spray. Deterministic so players can learn it.
export function recoilOffset(w, i) {
  const r = w.recoil;
  if (!r || i <= 0) return [0, 0];
  const pitch = r.max * (1 - Math.exp(-(i * r.up) / r.max));
  let yaw;
  if (i < r.sideStart) yaw = Math.sin(i * 1.7) * 0.12 * r.side;
  else yaw = r.side * Math.sin((i - r.sideStart) * r.sideFreq) * Math.min(1, (i - r.sideStart + 1) / 3);
  return [yaw, pitch];
}

// Recoil to add for shot number `i` (0-based).
export function recoilDelta(w, i) {
  const a = recoilOffset(w, i);
  const b = recoilOffset(w, i + 1);
  return [b[0] - a[0], b[1] - a[1]];
}

// Current inaccuracy (half-angle degrees).
// st: { speed, onGround, crouch (0..1), ads (0..1), scoped (bool), bloom }
export function computeSpread(w, st) {
  const s = w.spread;
  if (!s) return 0;
  let base = s.base;
  if (w.scope && st.scoped) base = s.scoped;
  let spread = base + (st.bloom || 0);
  const maxSpeed = PLAYER.runSpeed * (st.scoped && w.scopedSpeed ? w.scopedSpeed : w.speed);
  const walkSpeed = maxSpeed * 0.34;
  const moveFrac = clamp((st.speed - walkSpeed) / (maxSpeed - walkSpeed), 0, 1);
  spread += s.move * moveFrac * moveFrac + s.move * 0.08 * clamp(st.speed / walkSpeed, 0, 1);
  if (!st.onGround) spread += s.air;
  spread *= lerp(1, s.crouch ?? 0.8, st.crouch || 0);
  if (!w.scope) spread *= lerp(1, s.ads ?? 0.65, st.ads || 0);
  return spread;
}

// Rotate a unit direction randomly inside a cone of `spreadDeg`. rand is a () => [0,1) function.
export function applySpread(dir, spreadDeg, rand, out = [0, 0, 0]) {
  const [dx, dy, dz] = dir;
  if (spreadDeg <= 0) { out[0] = dx; out[1] = dy; out[2] = dz; return out; }
  // Build basis
  let ux, uy, uz;
  if (Math.abs(dy) < 0.99) { ux = 0; uy = 1; uz = 0; } else { ux = 1; uy = 0; uz = 0; }
  // right = dir x up
  let rx = dy * uz - dz * uy, ry = dz * ux - dx * uz, rz = dx * uy - dy * ux;
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  // up2 = right x dir
  const vx = ry * dz - rz * dy, vy = rz * dx - rx * dz, vz = rx * dy - ry * dx;
  const ang = rand() * Math.PI * 2;
  const u = rand();
  const r = Math.tan(spreadDeg * DEG * (0.35 * Math.sqrt(u) + 0.65 * u));
  const ox = Math.cos(ang) * r, oy = Math.sin(ang) * r;
  let nx = dx + rx * ox + vx * oy, ny = dy + ry * ox + vy * oy, nz = dz + rz * ox + vz * oy;
  const nl = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / nl; out[1] = ny / nl; out[2] = nz / nl;
  return out;
}

export function moveSpeedFor(weaponId, scoped) {
  const w = WEAPONS[weaponId];
  if (!w) return 1;
  return scoped && w.scopedSpeed ? w.scopedSpeed : w.speed;
}

// Damage after range falloff, hitgroup and armor. Returns { health, armor }.
export function computeDamage(w, dist, zone, target) {
  let dmg = w.damage * Math.pow(w.falloff, dist / 10);
  const mul = zone === 'head' ? w.headMul : zone === 'stomach' ? 1.25 : zone === 'legs' ? 0.75 : 1;
  dmg *= mul;
  let armorDmg = 0;
  const armored = target.armor > 0 && (zone === 'head' ? target.helmet : zone !== 'legs');
  if (armored && w.armorPen != null) {
    const hp = dmg * w.armorPen;
    armorDmg = Math.min(target.armor, (dmg - hp) * 0.5);
    dmg = hp;
  }
  return { health: Math.max(1, Math.round(dmg)), armor: Math.round(armorDmg) };
}
