// Realistic operator characters: a skeleton plus one smoothly skinned mesh built procedurally.
//
// The body is lofted through anatomical cross-sections (pelvis, waist, chest, shoulders, thighs, calves,
// upper arms, forearms) with blended skin weights across every joint, so knees, elbows, hips and the
// waist bend without gaps. On top of it: a sculpted head with face features, a high-cut helmet with rails
// and NVG shroud, headset, glasses or goggles, balaclava / shemagh, a plate carrier with shoulder straps,
// cummerbund, magazine / admin / radio pouches and hydration carrier, battle belt, drop-leg holster,
// cargo pocket, knee and elbow pads, gloves and boots. Surfaces get camouflage, fabric, webbing, skin,
// leather and rubber detail from the shared surface shader. Geometry is cached per look.

import * as THREE from 'three';
import { Builder, superEllipsoid, pathTube, SURF, weldNormals } from './surface.js';

export const UPPER_ARM = 0.3, FORE_ARM = 0.3;
// Bind pose for the arms (they are driven by two-bone IK every frame).
export const ARM_POSE = { r: { up: [0.55, 0, 0.12], fore: [1.05, 0, 0] }, l: { up: [1.25, 0, -0.55], fore: [0.35, 0.1, 0] } };

export function makeRig() {
  const bones = [];
  const bone = (name, parent, x, y, z) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    if (parent) parent.add(b);
    bones.push(b);
    return b;
  };
  const body = bone('body', null, 0, 0, 0);
  const hips = bone('hips', body, 0, 0.92, 0);
  const legs = [];
  for (const side of [-1, 1]) {
    const thigh = bone('thigh' + side, hips, side * 0.1, -0.03, 0);
    const knee = bone('knee' + side, thigh, 0, -0.44, 0);
    legs.push({ thigh, knee, side });
  }
  const spine = bone('spine', hips, 0, 0.04, 0);
  const chest = bone('chest', spine, 0, 0.3, 0);
  const neck = bone('neck', spine, 0, 0.56, 0);
  const head = bone('head', neck, 0, 0.1, 0);
  const aim = bone('aim', chest, 0, 0.16, 0);
  const arms = {};
  for (const [key, side] of [['r', 1], ['l', -1]]) {
    const grp = bone('arm' + key, aim, side * 0.23, 0, 0);
    const elbow = bone('elbow' + key, grp, 0, -UPPER_ARM, 0);
    grp.rotation.fromArray(ARM_POSE[key].up);
    elbow.rotation.fromArray(ARM_POSE[key].fore);
    arms[key] = { grp, elbow, side };
  }
  body.updateMatrixWorld(true);
  return { bones, body, hips, legs, spine, chest, neck, head, aim, arms };
}

// ------------------------------------------------------------------ looks

const SKINS = [0xbb9a8b, 0x9c7a68, 0x77594a, 0xceb2a3, 0x574137];
const HAIR = [0x2a2018, 0x3b2a1c, 0x16120f, 0x5a4330, 0x1d1712];
const FFA_COLORS = [0xd9483b, 0x3bb4d9, 0x7ed93b, 0xd9b43b, 0xa13bd9, 0xd93b8f, 0x3bd9a1, 0xe0e0e0, 0x8a5a2b, 0x5b6cff];

export function teamLook(team, id = 0, ffa = false) {
  const skin = SKINS[Math.abs(id) % SKINS.length];
  const hair = HAIR[Math.abs(id * 7 + 3) % HAIR.length];
  if (ffa) {
    const c = FFA_COLORS[Math.abs(id) % FFA_COLORS.length];
    return {
      key: 'ffa' + (Math.abs(id) % FFA_COLORS.length), style: 'def', skin, hair, accent: c,
      shirt: 0x55574f, sleeve: [0x5a5c52, 0x3e4038], pants: [0x4d4f47, 0x383a33], gear: 0x3b3d37, gear2: 0x44463f,
      helmet: [0x4a4c45, 0x33352f], helmetTex: SURF.camo, gloves: 0x2b2a27, boots: 0x2a2724, pads: 0x2f302c, lens: 0x1d2227,
      mag: 0x262624, headset: 0x2e2f2c, balaclava: null, scarf: null, uniform: 0x5a5c52,
    };
  }
  if (team === 1) {
    return {
      key: 'att' + (Math.abs(id) % 3), style: 'att', skin, hair, accent: 0xff7a2a,
      shirt: 0x86735a, sleeve: [0x8a785b, 0x55553a], pants: [0x7a6a51, 0x505036], gear: 0x77664b, gear2: 0x5e5a44,
      helmet: [0x857454, 0x585438], helmetTex: SURF.camo, gloves: 0x5a4f41, boots: 0x6b573f, pads: 0x5d5444, lens: 0x3a2d1a,
      mag: 0x8a7a5a, headset: 0x5e5647, balaclava: [0x34332d, 0x2a2a25][Math.abs(id) % 2], scarf: Math.abs(id) % 3 !== 2 ? [0xb8aa8b, 0x6d604a] : null,
      uniform: 0x8c7a5c,
    };
  }
  return {
    key: 'def' + (Math.abs(id) % SKINS.length), style: 'def', skin, hair, accent: 0x3a9cff,
    shirt: 0x2a3244, sleeve: [0x2b3446, 0x1d2431], pants: [0x262d3b, 0x1b212c], gear: 0x1e242e, gear2: 0x252c37,
    helmet: [0x22272e, 0x22272e], helmetTex: SURF.paint, gloves: 0x1c1d1f, boots: 0x1a1a1b, pads: 0x20242b, lens: 0x1b2126,
    mag: 0x232322, headset: 0x2a2b2d, balaclava: null, scarf: null, uniform: 0x2b3446,
  };
}

// ------------------------------------------------------------------ helpers

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (d, w) => Math.exp(-(d * d) / (w * w));
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
// radius multiplier bump around angle `at` (0 = +x/right, PI/2 = +z/back, 3PI/2 = -z/front)
const bump = (at, width, amount) => (th) => 1 + amount * gauss(angDiff(th, at), width);
const both = (...fs) => (th) => fs.reduce((m, f) => m * f(th), 1);
const FRONT = Math.PI * 1.5, BACK = Math.PI * 0.5;

function frameOf(bone, x = 0, y = 0, z = 0) {
  const m = bone.matrixWorld;
  return {
    c: V(x, y, z).applyMatrix4(m),
    x: new THREE.Vector3().setFromMatrixColumn(m, 0).normalize(),
    y: new THREE.Vector3().setFromMatrixColumn(m, 1).normalize(),
    z: new THREE.Vector3().setFromMatrixColumn(m, 2).normalize(),
  };
}
function mixFrame(a, b, t) {
  return { c: a.c.clone().lerp(b.c, t), x: a.x.clone().lerp(b.x, t).normalize(), y: a.y.clone().lerp(b.y, t).normalize(), z: a.z.clone().lerp(b.z, t).normalize() };
}
const WORLD = { x: V(1, 0, 0), y: V(0, 1, 0), z: V(0, 0, 1) };
const ring = (f, rx, rz, w, extra = {}) => ({ c: f.c.clone(), x: f.x, z: f.z, rx, rz, w, ...extra });
const wring = (y, rx, rz, w, extra = {}, zc = 0, xc = 0) => ({ c: V(xc, y, zc), x: WORLD.x, z: WORLD.z, rx, rz, w, ...extra });
const mixColor = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);

// Band around an ellipse (in a bone's local XZ plane) between heights y0..y1 with some thickness.
function bandRings(y0, y1, rx, rz, thick, w0, w1, xc = 0, zc = 0) {
  // bottom inner -> bottom outer -> top outer -> top inner keeps the faces pointing outwards
  return [
    wring(y0, rx - thick, rz - thick, w0, {}, zc, xc),
    wring(y0, rx, rz, w0, {}, zc, xc),
    wring(y1, rx, rz, w1, {}, zc, xc),
    wring(y1, rx - thick, rz - thick, w1, {}, zc, xc),
  ];
}

// ------------------------------------------------------------------ the operator

const geoCache = new Map();

export function operatorGeometry(look) {
  const key = look.key || JSON.stringify(look);
  if (geoCache.has(key)) return geoCache.get(key);
  const rig = makeRig();
  const b = new Builder(rig.bones);
  buildOperator(b, rig, look);
  const geo = b.build(true);
  geoCache.set(key, geo);
  return geo;
}

function buildOperator(B, R, L) {
  const { hips, spine, chest, neck, head, legs, arms } = R;
  const att = L.style === 'att';
  const hood = L.balaclava; // attackers wear a balaclava
  const faceCol = hood || L.skin;

  // ---------------------------------------------------------------- legs (trousers)
  for (const { thigh, knee, side } of legs) {
    const sx = side * 0.1;
    const wT = (t) => [[thigh, 1 - t], [knee, t]];
    const calf = bump(BACK, 0.9, 0.12);
    const rings = [
      wring(0.965, 0.07, 0.08, [[hips, 1]], {}, 0, sx),
      wring(0.9, 0.099, 0.104, [[hips, 0.45], [thigh, 0.55]], {}, 0.002, sx),
      wring(0.8, 0.094, 0.099, [[thigh, 1]], {}, 0, sx),
      wring(0.69, 0.085, 0.089, [[thigh, 1]], {}, 0, sx),
      wring(0.58, 0.075, 0.079, wT(0.08), {}, 0, sx),
      wring(0.505, 0.069, 0.074, wT(0.3), {}, -0.002, sx),
      wring(0.45, 0.067, 0.073, wT(0.5), {}, -0.004, sx),
      wring(0.395, 0.064, 0.07, wT(0.78), {}, -0.002, sx),
      wring(0.33, 0.066, 0.072, [[knee, 1]], { mod: calf }, 0.004, sx),
      wring(0.25, 0.061, 0.066, [[knee, 1]], { mod: calf }, 0.004, sx),
      wring(0.17, 0.055, 0.059, [[knee, 1]], {}, 0.002, sx),
      wring(0.12, 0.052, 0.056, [[knee, 1]], {}, 0.002, sx),
    ];
    B.tube(rings, { seg: 18, color: L.pants[0], color2: L.pants[1], tex: SURF.camo, rough: 0.92, jitter: 0.035, seed: side + 5, capStart: true });

    // knee pad: hard shell + strap
    B.add(superEllipsoid(0.056, 0.066, 0.026, 0.35, 0.4, 10, 8, { bend: 5 }), { p: [sx, 0.455, -0.074], color: L.pads, rough: 0.55, tex: SURF.polymer, weights: [[thigh, 0.3], [knee, 0.7]] });
    B.add(superEllipsoid(0.04, 0.03, 0.012, 0.4, 0.4, 10, 6, { bend: 7 }), { p: [sx, 0.462, -0.098], color: mixColor(L.pads, 0x000000, 0.25), rough: 0.7, tex: SURF.rubber, weights: [[thigh, 0.3], [knee, 0.7]] });
    B.tube(bandRings(0.405, 0.425, 0.072, 0.078, 0.006, [[knee, 0.8], [thigh, 0.2]], [[knee, 0.8], [thigh, 0.2]], sx, -0.002), { seg: 18, color: 0x1f1f1d, tex: SURF.webbing, rough: 0.8 });

    // boot: shaft, foot, toe cap, sole, heel, tongue, laces
    const boot = { color: L.boots, tex: SURF.leather, rough: 0.72, weights: [[knee, 1]] };
    B.tube([
      wring(0.215, 0.058, 0.063, [[knee, 1]], {}, 0.004, sx),
      wring(0.16, 0.057, 0.062, [[knee, 1]], {}, 0.003, sx),
      wring(0.1, 0.055, 0.061, [[knee, 1]], {}, 0.0, sx),
      wring(0.05, 0.054, 0.062, [[knee, 1]], {}, 0.0, sx),
    ], { seg: 16, ...boot, capStart: true });
    B.tube([wring(0.222, 0.06, 0.066, [[knee, 1]], {}, 0.004, sx), wring(0.205, 0.061, 0.067, [[knee, 1]], {}, 0.004, sx)], { seg: 16, color: mixColor(L.boots, 0x000000, 0.35), tex: SURF.leather, rough: 0.8 });
    B.add(superEllipsoid(0.052, 0.046, 0.12, 0.45, 0.55, 12, 8), { p: [sx, 0.056, -0.05], ...boot });
    B.add(superEllipsoid(0.05, 0.032, 0.048, 0.5, 0.6, 12, 8), { p: [sx, 0.04, -0.132], ...boot, color: mixColor(L.boots, 0x000000, 0.2), tex: SURF.rubber, rough: 0.8 });
    B.add(superEllipsoid(0.057, 0.013, 0.14, 0.15, 0.35, 12, 4), { p: [sx, 0.013, -0.046], color: 0x1c1a17, tex: SURF.rubber, rough: 0.95, weights: [[knee, 1]] });
    B.add(superEllipsoid(0.052, 0.018, 0.04, 0.2, 0.4, 12, 6), { p: [sx, 0.022, 0.045], color: 0x1c1a17, tex: SURF.rubber, rough: 0.95, weights: [[knee, 1]] });
    B.add(superEllipsoid(0.028, 0.045, 0.012, 0.4, 0.5, 10, 8), { p: [sx, 0.115, -0.066], r: [-0.35, 0, 0], ...boot, color: mixColor(L.boots, 0xffffff, 0.08) });
    for (let i = 0; i < 4; i++) {
      B.add(superEllipsoid(0.03, 0.0035, 0.004, 0.3, 0.3, 8, 4), { p: [sx, 0.083 + i * 0.022, -0.083 + i * 0.008], r: [-0.35, 0, 0], color: 0x1a1816, rough: 0.8, tex: SURF.fabric, weights: [[knee, 1]] });
    }
  }

  // battle belt, buckle, drop-leg holster, cargo pocket
  B.tube(bandRings(0.945, 0.992, 0.172, 0.117, 0.006, [[hips, 1]], [[hips, 0.8], [spine, 0.2]]), { seg: 24, color: L.gear, tex: SURF.webbing, rough: 0.85 });
  B.add(superEllipsoid(0.034, 0.02, 0.008, 0.2, 0.25, 10, 6), { bone: hips, p: [0, 0.048, -0.122], color: 0x2a2a2a, rough: 0.35, metal: 0.6, tex: SURF.metal });
  {
    const thigh = legs[1].thigh;
    const wh = (v) => { const t = smoothstep(0.93, 0.86, v.y); return [[thigh, t], [hips, 1 - t]]; };
    B.tube(bandRings(0.785, 0.81, 0.101, 0.106, 0.006, [[thigh, 1]], [[thigh, 1]], 0.1, 0), { seg: 18, color: 0x24231f, tex: SURF.webbing, rough: 0.85 });
    B.tube(bandRings(0.695, 0.72, 0.093, 0.097, 0.006, [[thigh, 1]], [[thigh, 1]], 0.1, 0), { seg: 18, color: 0x24231f, tex: SURF.webbing, rough: 0.85 });
    B.add(superEllipsoid(0.01, 0.085, 0.045, 0.2, 0.3, 8, 10), { p: [0.206, 0.79, 0.0], color: L.gear, tex: SURF.webbing, rough: 0.85, weights: wh });
    B.add(superEllipsoid(0.022, 0.072, 0.04, 0.35, 0.45, 12, 10), { p: [0.228, 0.785, -0.012], color: 0x1f1f1f, tex: SURF.polymer, rough: 0.5, weights: wh });
    B.add(superEllipsoid(0.013, 0.036, 0.02, 0.3, 0.4, 8, 8), { p: [0.228, 0.872, 0.01], r: [-0.25, 0, 0], color: 0x1b1b1b, tex: SURF.polymer, rough: 0.6, weights: wh });
    B.strap([V(0.16, 0.975, 0.0), V(0.19, 0.93, 0.0), V(0.204, 0.875, 0.0)], [V(1, 0.3, 0), V(1, 0.15, 0), V(1, 0, 0)], 0.035, 0.005, { color: L.gear, tex: SURF.webbing, rough: 0.85, weights: [[[hips, 1]], [[hips, 0.5], [thigh, 0.5]], [[thigh, 1]]] });
    const lt = legs[0].thigh;
    B.add(superEllipsoid(0.013, 0.058, 0.052, 0.35, 0.4, 8, 10), { p: [-0.2, 0.7, 0.004], color: L.pants[0], color2: L.pants[1], tex: SURF.camo, rough: 0.9, weights: [[lt, 1]] });
    B.add(superEllipsoid(0.016, 0.018, 0.055, 0.3, 0.35, 8, 6), { p: [-0.203, 0.757, 0.004], color: mixColor(L.pants[0], 0x000000, 0.12), color2: L.pants[1], tex: SURF.camo, rough: 0.9, weights: [[lt, 1]] });
    // dump pouch on the back of the belt
    B.add(superEllipsoid(0.07, 0.05, 0.03, 0.4, 0.5, 12, 8, { bend: -1.2 }), { bone: hips, p: [-0.06, 0.01, 0.14], color: L.gear2, tex: SURF.fabric, rough: 0.9 });
  }

  // ---------------------------------------------------------------- torso (shirt)
  const wS = (t) => [[hips, 1 - t], [spine, t]];
  const wC = (t) => [[spine, 1 - t], [chest, t]];
  const butt = bump(BACK, 0.8, 0.09);
  const pecs = bump(FRONT, 0.9, 0.06);
  B.tube([
    wring(0.84, 0.09, 0.075, [[hips, 1]]),
    wring(0.885, 0.166, 0.11, [[hips, 1]], { mod: butt }, 0.004),
    wring(0.955, 0.164, 0.108, wS(0.2)),
    wring(1.03, 0.153, 0.102, wS(0.7)),
    wring(1.11, 0.158, 0.106, [[spine, 1]]),
    wring(1.2, 0.17, 0.115, wC(0.45), {}, -0.004),
    wring(1.29, 0.18, 0.122, wC(0.85), { mod: pecs }, -0.008),
    wring(1.36, 0.186, 0.12, [[chest, 1]], {}, -0.005),
    wring(1.42, 0.18, 0.108, [[chest, 1]], { n: 3 }),
    wring(1.465, 0.152, 0.097, [[chest, 0.8], [neck, 0.2]], { n: 2.6 }, 0.006),
    wring(1.5, 0.105, 0.08, [[chest, 0.5], [neck, 0.5]], {}, 0.01),
    wring(1.525, 0.072, 0.068, [[chest, 0.3], [neck, 0.7]], {}, 0.012),
  ], { seg: 24, color: L.shirt, color2: L.sleeve[1], tex: att ? SURF.camo : SURF.fabric, rough: 0.92, jitter: 0.02, seed: 3, capStart: true, capEnd: true });

  // neck (skin or balaclava)
  B.tube([
    wring(1.46, 0.072, 0.07, [[chest, 0.7], [neck, 0.3]], {}, 0.012),
    wring(1.51, 0.063, 0.062, [[neck, 1]], {}, 0.012),
    wring(1.565, 0.061, 0.062, [[neck, 0.7], [head, 0.3]], {}, 0.012),
    wring(1.615, 0.055, 0.058, [[neck, 0.3], [head, 0.7]], {}, 0.01),
  ], { seg: 16, color: faceCol, tex: hood ? SURF.fabric : SURF.skin, rough: hood ? 0.9 : 0.6, capEnd: true });
  B.tube(bandRings(1.5, 1.525, 0.074, 0.072, 0.006, [[chest, 0.5], [neck, 0.5]], [[chest, 0.3], [neck, 0.7]], 0, 0.012), { seg: 18, color: L.shirt, color2: L.sleeve[1], tex: att ? SURF.camo : SURF.fabric, rough: 0.92 });
  if (L.scarf) {
    B.tube([
      wring(1.455, 0.105, 0.1, [[chest, 0.8], [neck, 0.2]], {}, 0.012),
      wring(1.5, 0.088, 0.087, [[chest, 0.3], [neck, 0.7]], {}, 0.008),
      wring(1.545, 0.08, 0.082, [[neck, 1]], {}, 0.002),
      wring(1.585, 0.074, 0.078, [[neck, 0.5], [head, 0.5]], {}, -0.004),
    ], { seg: 20, color: L.scarf[0], color2: L.scarf[1], tex: SURF.camo, rough: 0.95, jitter: 0.16, seed: 11, capEnd: false });
    // folds of the wrap and the tail hanging down the chest
    for (let k = 0; k < 3; k++) {
      B.tube([
        wring(1.47 + k * 0.035, 0.095 - k * 0.008, 0.094 - k * 0.006, [[chest, 0.5], [neck, 0.5]], {}, 0.01 - k * 0.004),
        wring(1.49 + k * 0.035, 0.097 - k * 0.008, 0.096 - k * 0.006, [[neck, 1]], {}, 0.01 - k * 0.004),
      ], { seg: 20, color: mixColor(L.scarf[0], 0x000000, 0.12), color2: L.scarf[1], tex: SURF.camo, rough: 0.95, jitter: 0.2, seed: 30 + k });
    }
    B.add(superEllipsoid(0.055, 0.075, 0.012, 0.5, 0.9, 12, 10, { taper: 0.6, bend: 3 }), { p: [0.02, 1.4, -0.14], r: [-0.25, 0, 0.15], color: L.scarf[0], color2: L.scarf[1], tex: SURF.camo, rough: 0.95, weights: [[chest, 1]] });
  }

  // ---------------------------------------------------------------- arms (sleeves, pads, gloves)
  for (const key of ['r', 'l']) {
    const { grp, elbow, side } = arms[key];
    const fU = (y) => frameOf(grp, 0, y, 0);
    const fF = (y) => frameOf(elbow, 0, y, 0);
    const wA = (t) => [[grp, 1 - t], [elbow, t]];
    const bicep = bump(FRONT, 0.9, 0.06);
    const mid = mixFrame(fU(-UPPER_ARM), fF(0), 0.5);
    B.tube([
      ring(fU(0.045), 0.048, 0.048, [[chest, 0.6], [grp, 0.4]]),
      ring(fU(0.0), 0.055, 0.053, [[chest, 0.3], [grp, 0.7]]),
      ring(fU(-0.06), 0.056, 0.053, [[grp, 0.92], [chest, 0.08]]),
      ring(fU(-0.13), 0.053, 0.05, [[grp, 1]], { mod: bicep }),
      ring(fU(-0.2), 0.05, 0.049, [[grp, 1]], { mod: bicep }),
      ring(fU(-0.26), 0.047, 0.047, wA(0.15)),
      ring(mid, 0.046, 0.048, wA(0.5)),
      ring(fF(-0.04), 0.047, 0.045, wA(0.85)),
      ring(fF(-0.1), 0.045, 0.042, [[elbow, 1]]),
      ring(fF(-0.17), 0.04, 0.036, [[elbow, 1]]),
      ring(fF(-0.21), 0.04, 0.036, [[elbow, 1]]),
    ], { seg: 16, color: L.sleeve[0], color2: L.sleeve[1], tex: SURF.camo, rough: 0.92, jitter: 0.04, seed: side * 3 + 20, capStart: true });
    // shoulder patch (team colour) and velcro field
    B.add(superEllipsoid(0.034, 0.04, 0.0035, 0.2, 0.25, 8, 6), { bone: grp, p: [side * 0.057, -0.08, 0.004], r: [0, side * Math.PI / 2, 0], color: mixColor(L.sleeve[0], 0x000000, 0.2), rough: 0.9, tex: SURF.fabric, texK: 0.6 });
    B.add(superEllipsoid(0.022, 0.015, 0.003, 0.15, 0.2, 8, 6), { bone: grp, p: [side * 0.0605, -0.07, 0.004], r: [0, side * Math.PI / 2, 0], color: L.accent, rough: 0.75, emit: 0.02, tex: SURF.fabric, texK: 0.4 });
    // elbow pad
    B.add(superEllipsoid(0.04, 0.046, 0.02, 0.4, 0.45, 12, 8, { bend: 8 }), { bone: grp, p: [0, -0.303, 0.046], r: [0.55, 0, 0], color: L.pads, tex: SURF.polymer, rough: 0.55, weights: wA(0.5) });
    // glove: gauntlet, back of hand, fingers wrapped around a grip, knuckle pads, thumb
    const glove = { bone: elbow, color: L.gloves, tex: SURF.leather, rough: 0.7, weights: [[elbow, 1]] };
    B.tube([ring(fF(-0.195), 0.046, 0.043, [[elbow, 1]]), ring(fF(-0.24), 0.04, 0.036, [[elbow, 1]]), ring(fF(-0.265), 0.037, 0.03, [[elbow, 1]])], { seg: 14, color: L.gloves, tex: SURF.leather, rough: 0.7 });
    B.add(superEllipsoid(0.041, 0.045, 0.021, 0.5, 0.6, 12, 8), { ...glove, p: [0, -0.302, 0.002] });
    B.add(superEllipsoid(0.04, 0.02, 0.026, 0.55, 0.6, 12, 8), { ...glove, p: [0, -0.342, -0.014] });
    for (let i = 0; i < 4; i++) {
      B.add(superEllipsoid(0.0085, 0.012, 0.0105, 0.7, 0.7, 8, 6), { ...glove, p: [(i - 1.5) * 0.02, -0.337, 0.011], color: mixColor(L.gloves, 0x000000, 0.25), tex: SURF.rubber });
    }
    B.add(new THREE.CapsuleGeometry(0.011, 0.038, 3, 8), { ...glove, p: [-side * 0.036, -0.31, -0.02], r: [0.5, 0, -side * 0.6] });
    B.add(superEllipsoid(0.03, 0.012, 0.004, 0.3, 0.3, 8, 4), { ...glove, p: [0, -0.3, 0.024], color: mixColor(L.gloves, 0x000000, 0.35), tex: SURF.rubber });
  }

  // ---------------------------------------------------------------- plate carrier
  const wPlate = (v) => { const t = smoothstep(1.1, 1.24, v.y); return [[chest, t], [spine, 1 - t]]; };
  const gear = { color: L.gear, tex: SURF.webbing, rough: 0.88 };
  B.add(superEllipsoid(0.152, 0.168, 0.026, 0.12, 0.15, 16, 8, { bend: 1.8, taper: -0.1 }), { p: [0, 1.265, -0.163], ...gear, weights: wPlate });
  B.add(superEllipsoid(0.152, 0.17, 0.026, 0.12, 0.15, 16, 8, { bend: -1.8, taper: -0.1 }), { p: [0, 1.27, 0.152], ...gear, weights: wPlate });
  B.tube(bandRings(1.1, 1.255, 0.196, 0.134, 0.008, [[spine, 0.8], [chest, 0.2]], [[chest, 0.7], [spine, 0.3]], 0, -0.004), { seg: 28, ...gear });
  for (const s of [-1, 1]) {
    const pts = [V(s * 0.092, 1.4, -0.168), V(s * 0.1, 1.458, -0.118), V(s * 0.106, 1.487, -0.03), V(s * 0.102, 1.478, 0.06), V(s * 0.094, 1.41, 0.15)];
    const ups = [V(0, 0.25, -1), V(0, 1, -0.7), V(0, 1, -0.1), V(0, 1, 0.6), V(0, 0.25, 1)];
    B.strap(pts, ups, 0.056, 0.014, { ...gear, weights: pts.map(() => [[chest, 1]]) });
  }
  // front: three rifle magazine pouches with magazines, admin pouch with team patch
  const plateZ = (x) => -0.163 - 0.026 + 1.8 * x * x;
  for (let i = -1; i <= 1; i++) {
    const x = i * 0.074;
    B.add(superEllipsoid(0.034, 0.052, 0.021, 0.3, 0.4, 10, 8), { p: [x, 1.188, plateZ(x) - 0.02], r: [0, -x * 2.4, 0], color: L.gear2, tex: SURF.fabric, rough: 0.9, weights: wPlate });
    B.add(superEllipsoid(0.027, 0.03, 0.0115, 0.15, 0.2, 10, 8), { p: [x, 1.244, plateZ(x) - 0.019], r: [0.08, -x * 2.4, 0], color: L.mag, tex: SURF.polymer, rough: 0.55, weights: wPlate });
    B.add(superEllipsoid(0.007, 0.013, 0.004, 0.3, 0.3, 6, 6), { p: [x, 1.255, plateZ(x) - 0.034], r: [0.1, -x * 2.4, 0], color: 0x151515, tex: SURF.rubber, rough: 0.8, weights: wPlate });
  }
  B.add(superEllipsoid(0.072, 0.036, 0.014, 0.3, 0.35, 14, 8, { bend: 1.8 }), { p: [0, 1.338, plateZ(0) - 0.012], color: L.gear2, tex: SURF.fabric, rough: 0.9, weights: [[chest, 1]] });
  B.add(superEllipsoid(0.03, 0.019, 0.003, 0.15, 0.2, 8, 6), { p: [0.036, 1.342, plateZ(0.036) - 0.027], color: L.accent, rough: 0.7, emit: 0.06, tex: SURF.fabric, texK: 0.4, weights: [[chest, 1]] });
  // left side: radio in its pouch with antenna; right side: grenade pouch
  B.add(superEllipsoid(0.028, 0.052, 0.034, 0.35, 0.4, 10, 10), { p: [-0.212, 1.19, -0.012], color: L.gear2, tex: SURF.fabric, rough: 0.9, weights: wPlate });
  B.add(superEllipsoid(0.022, 0.03, 0.028, 0.25, 0.3, 10, 8), { p: [-0.212, 1.25, -0.012], color: 0x202020, tex: SURF.polymer, rough: 0.5, weights: [[chest, 1]] });
  B.add(pathTube([V(-0.212, 1.27, -0.004), V(-0.212, 1.38, 0.01), V(-0.2, 1.5, 0.04), V(-0.185, 1.62, 0.075)], 0.0035, 5), { color: 0x151515, rough: 0.6, tex: SURF.rubber, weights: [[chest, 1]] });
  B.add(superEllipsoid(0.028, 0.042, 0.03, 0.4, 0.5, 10, 8), { p: [0.212, 1.17, -0.03], color: L.gear2, tex: SURF.fabric, rough: 0.9, weights: wPlate });
  // back: hydration carrier with drag handle
  B.add(superEllipsoid(0.118, 0.16, 0.036, 0.3, 0.35, 12, 8, { bend: -1.5 }), { p: [0, 1.245, 0.2], color: L.gear2, tex: SURF.webbing, rough: 0.9, weights: wPlate });
  B.add(pathTube([V(-0.045, 1.425, 0.176), V(-0.03, 1.455, 0.19), V(0.03, 1.455, 0.19), V(0.045, 1.425, 0.176)], 0.008, 6), { color: 0x1f1f1d, tex: SURF.webbing, rough: 0.85, weights: [[chest, 1]] });

  // ---------------------------------------------------------------- head
  const hc = V(0, 0.045, 0.005); // head centre relative to the head bone
  const skinC = new THREE.Color(L.skin), hairC = new THREE.Color(L.hair);
  const lipC = skinC.clone().multiplyScalar(0.8).lerp(new THREE.Color(0x8e4a45), 0.22);
  const stubbleC = skinC.clone().lerp(new THREE.Color(0x3a322c), 0.22);
  const hoodC = hood ? new THREE.Color(hood) : null;
  const headGeo = new THREE.SphereGeometry(1, 44, 34);
  const P = headGeo.attributes.position;
  const cols = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    let X = x * 0.074, Y = y * 0.113, Z = z * 0.097;
    const front = Math.max(0, -z);
    const ax = Math.abs(x);
    // skull and jaw
    const low = smoothstep(0.15, -0.95, y);
    X *= 1 - 0.3 * low;
    Z *= z > 0 ? 1 - 0.36 * low : 1 - 0.06 * low;
    if (z < 0) Z *= 0.95;
    if (z > 0 && y > -0.25) Z *= 1.05;
    X -= Math.sign(x) * 0.003 * gauss(y - 0.18, 0.2) * gauss(ax - 0.93, 0.12);       // temples
    X *= 1 + 0.06 * gauss(y + 0.62, 0.2) * (1 - front);                             // jaw angle
    X *= 1 - 0.1 * front * front * smoothstep(0.5, 0.1, y);                         // face narrower than the skull
    // relief on the face (positive = towards the viewer)
    let out = 0, cav = 0;
    out += 0.0075 * gauss(y - 0.27, 0.11) * gauss(x, 0.6);                          // brow ridge
    for (const s of [-1, 1]) {
      const sock = gauss(y - 0.1, 0.1) * gauss(x - s * 0.42, 0.17);
      out -= 0.012 * sock; cav += sock * 0.55;                                     // eye sockets
      out += 0.003 * gauss(y + 0.33, 0.14) * gauss(x - s * 0.55, 0.18);             // cheeks
      const ala = gauss(y + 0.22, 0.06) * gauss(x - s * 0.11, 0.06);
      out += 0.0065 * ala;                                                          // nostril wings
      cav += gauss(y + 0.265, 0.035) * gauss(x - s * 0.075, 0.045) * 0.8;            // nostrils
      cav += gauss(y + 0.515, 0.03) * gauss(x - s * 0.25, 0.05) * 0.5;              // mouth corners
      // nasolabial fold from the nostril wing to the mouth corner
      const ft = Math.max(0, Math.min(1, (-0.24 - y) / 0.26));
      const fx = s * (0.16 + 0.13 * ft), fy = -0.24 - 0.26 * ft;
      const fold = gauss(Math.hypot(x - fx, (y - fy) * 0.6), 0.035) * (y < -0.2 && y > -0.52 ? 1 : 0);
      out -= 0.0014 * fold; cav += fold * 0.3;
      cav += gauss(y - 0.2, 0.05) * gauss(x - s * 0.42, 0.2) * 0.35;                // under the brow
    }
    X += Math.sign(x) * 0.0045 * gauss(y + 0.06, 0.16) * gauss(ax - 0.68, 0.2) * front; // cheekbones
    // nose: bridge between the eyes down to the tip, then back in to the upper lip
    let nose = 0;
    if (y <= 0.22 && y >= -0.2) { const t = (0.22 - y) / 0.42; nose = 0.004 + 0.0175 * Math.pow(t, 1.7); }
    else if (y < -0.2 && y > -0.32) nose = 0.0215 * Math.pow(1 - (-0.2 - y) / 0.12, 0.8);
    const nw = 0.075 + 0.06 * smoothstep(0.2, -0.2, y);
    out += nose * gauss(x, nw);
    out -= 0.0015 * gauss(y + 0.34, 0.04) * gauss(x, 0.12);                          // philtrum
    out += 0.0042 * gauss(y + 0.46, 0.035) * gauss(x, 0.24);                         // upper lip
    out -= 0.0022 * gauss(y + 0.515, 0.018) * gauss(x, 0.26);                        // mouth line
    cav += gauss(y + 0.515, 0.02) * gauss(x, 0.24) * 0.6;
    out += 0.0045 * gauss(y + 0.57, 0.04) * gauss(x, 0.22);                          // lower lip
    out -= 0.002 * gauss(y + 0.68, 0.05) * gauss(x, 0.25);                           // lip-chin groove
    out += 0.0068 * gauss(y + 0.82, 0.1) * gauss(x, 0.3);                            // chin
    Z -= out * front * (z < -0.2 ? 1 : smoothstep(0, -0.2, z));
    P.setXYZ(i, X + hc.x, Y + hc.y, Z + hc.z);
    // colour: skin / hair / lips / stubble, darkened in cavities
    let c;
    if (hoodC) {
      const open = Z < -0.05 && Math.abs(X) < 0.05 && Y > -0.002 && Y < 0.03;
      c = open ? skinC.clone() : hoodC.clone();
    } else if ((Y > 0.036 && Z > -0.068) || (Z > 0.035 && Y > -0.03)) c = skinC.clone().lerp(hairC, 0.72);
    else if (front > 0.6 && Math.abs(y + 0.515) < 0.07 && ax < 0.26) c = lipC.clone();
    else if (y < -0.3 && z < 0.3 && ax < 0.9) c = stubbleC.clone();
    else c = skinC.clone();
    if (!hoodC || (Z < -0.05 && Math.abs(X) < 0.05 && Y > -0.002 && Y < 0.03)) c.multiplyScalar(1 - Math.min(0.55, cav * 0.5));
    if (y < -0.75) c.multiplyScalar(0.9);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  headGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  headGeo.computeVertexNormals();
  weldNormals(headGeo);
  B.add(headGeo, { bone: head, vertexColors: true, tex: hood ? SURF.fabric : SURF.skin, rough: hood ? 0.9 : 0.5, texK: hood ? 0.6 : 1 });
  const skinPart = { bone: head, color: hoodC || skinC, tex: hood ? SURF.fabric : SURF.skin, rough: hood ? 0.9 : 0.5 };
  // ears, eyes with lids, brows
  const irisC = [0x3d2b1d, 0x4a6a7a, 0x4f5a34, 0x2a1d14][Math.abs(L.hair) % 4];
  for (const s of [-1, 1]) {
    B.add(superEllipsoid(0.011, 0.03, 0.019, 0.6, 0.6, 10, 8), { ...skinPart, p: [s * 0.073, hc.y - 0.002, hc.z + 0.012], r: [0, s * 0.3, 0] });
    const ec = [s * 0.031, hc.y + 0.011, hc.z - 0.0685];
    B.add(new THREE.SphereGeometry(0.0105, 10, 6), { bone: head, p: ec, rough: 0.08, tex: SURF.none, color: (p) => (p.z < -0.0097 ? 0x080706 : p.z < -0.0074 ? irisC : 0xdcd4ca) });
    if (!hood || true) {
      const lidC = (hoodC && false) || skinC.clone().multiplyScalar(0.86);
      B.add(new THREE.SphereGeometry(0.0114, 12, 4, 0, Math.PI * 2, 0, 1.2), { bone: head, p: ec, r: [-0.15, 0, 0], color: lidC, tex: SURF.skin, rough: 0.5 });
      B.add(new THREE.SphereGeometry(0.0111, 12, 3, 0, Math.PI * 2, 2.02, Math.PI - 2.02), { bone: head, p: ec, color: lidC, tex: SURF.skin, rough: 0.5 });
    }
    if (!hood) B.add(superEllipsoid(0.016, 0.0032, 0.0045, 0.4, 0.4, 8, 4), { bone: head, p: [s * 0.032, hc.y + 0.028, hc.z - 0.0875], r: [0, s * 0.25, -s * 0.12], color: hairC, rough: 0.9, tex: SURF.fabric });
  }

  // ---------------------------------------------------------------- helmet
  const hh = hc.clone().add(V(0, 0.006, 0.004));
  const HA = 0.1, HB = 0.128, HC = 0.12;
  const edgeY = (th) => {
    const d = Math.abs(angDiff(th, 0)) / Math.PI * 180;
    const keys = [[0, 0.03], [35, 0.022], [72, 0.058], [105, 0.05], [140, 0.0], [180, -0.022]];
    for (let k = 1; k < keys.length; k++) {
      if (d <= keys[k][0]) {
        const t = (d - keys[k - 1][0]) / (keys[k][0] - keys[k - 1][0]);
        const s = t * t * (3 - 2 * t);
        return keys[k - 1][1] + (keys[k][1] - keys[k - 1][1]) * s;
      }
    }
    return keys[keys.length - 1][1];
  };
  const shellPoint = (th, phi, k = 1) => V(HA * k * Math.sin(phi) * Math.sin(th), HB * k * Math.cos(phi), -HC * k * Math.sin(phi) * Math.cos(th));
  const shell = (k, inward) => {
    const segT = inward ? 24 : 34, segP = inward ? 5 : 10;
    const pos = [], nor = [], idx = [];
    for (let i = 0; i <= segT; i++) {
      const th = (i / segT) * Math.PI * 2;
      const pmax = Math.acos(Math.max(-1, Math.min(1, edgeY(th) / HB)));
      for (let j = 0; j <= segP; j++) {
        const phi = (j / segP) * pmax;
        const p = shellPoint(th, phi, k);
        const n = V(p.x / (HA * HA), p.y / (HB * HB), p.z / (HC * HC)).normalize();
        pos.push(p.x + hh.x, p.y + hh.y, p.z + hh.z);
        if (inward) nor.push(-n.x, -n.y, -n.z); else nor.push(n.x, n.y, n.z);
      }
    }
    for (let i = 0; i < segT; i++) {
      for (let j = 0; j < segP; j++) {
        const a = i * (segP + 1) + j, bb = a + 1, c = a + segP + 1, d = c + 1;
        if (inward) idx.push(a, c, bb, bb, c, d); else idx.push(a, bb, c, bb, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
  };
  const helmet = { bone: head, color: L.helmet[0], color2: L.helmet[1], tex: L.helmetTex, rough: L.helmetTex === SURF.paint ? 0.48 : 0.9, metal: L.helmetTex === SURF.paint ? 0.05 : 0 };
  B.add(shell(1, false), helmet);
  B.add(shell(0.93, true), { bone: head, color: 0x1e1e1c, tex: SURF.fabric, rough: 0.95 });
  // rubber edge trim
  const edge = [];
  for (let i = 0; i < 48; i++) {
    const th = (i / 48) * Math.PI * 2;
    const pmax = Math.acos(Math.max(-1, Math.min(1, edgeY(th) / HB)));
    edge.push(shellPoint(th, pmax, 0.965).add(hh));
  }
  B.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, true), 64, 0.0058, 4, true), { bone: head, color: 0x151515, tex: SURF.rubber, rough: 0.8 });
  // side rails
  for (const s of [-1, 1]) {
    const pts = [], ups = [];
    for (let k = 0; k <= 6; k++) {
      const th = s * (1.0 + (k / 6) * 1.2);
      const phi = Math.acos(0.074 / HB);
      const p = shellPoint(th, phi, 1.0);
      const n = V(p.x / (HA * HA), p.y / (HB * HB), p.z / (HC * HC)).normalize();
      pts.push(p.add(hh)); ups.push(n);
    }
    B.strap(pts, ups, 0.017, 0.007, { bone: head, color: 0x202224, tex: SURF.polymer, rough: 0.55, weights: pts.map(() => [[head, 1]]) });
  }
  // NVG shroud, counterweight pouch, IR / team patch
  {
    const phi = Math.acos(0.078 / HB);
    const p = shellPoint(0, phi, 1.0).add(hh);
    B.add(superEllipsoid(0.024, 0.02, 0.008, 0.25, 0.3, 10, 8), { bone: head, p: [p.x, p.y, p.z - 0.004], r: [-0.62, 0, 0], color: 0x1c1d1f, tex: SURF.metal, rough: 0.45, metal: 0.6 });
    B.add(superEllipsoid(0.008, 0.01, 0.01, 0.4, 0.4, 6, 6), { bone: head, p: [p.x, p.y - 0.018, p.z - 0.012], color: 0x1c1d1f, tex: SURF.metal, rough: 0.45, metal: 0.6 });
    const q = shellPoint(Math.PI, Math.acos(0.05 / HB), 1.0).add(hh);
    B.add(superEllipsoid(0.021, 0.015, 0.003, 0.15, 0.2, 8, 6), { bone: head, p: [q.x, q.y, q.z + 0.003], r: [0.45, 0, 0], color: L.accent, rough: 0.7, emit: 0.07, tex: SURF.fabric, texK: 0.4 });
    const w = shellPoint(Math.PI, Math.acos(0.005 / HB), 1.0).add(hh);
    B.add(superEllipsoid(0.034, 0.02, 0.012, 0.35, 0.4, 10, 8, { bend: -3 }), { bone: head, p: [w.x, w.y, w.z + 0.006], r: [0.15, 0, 0], color: L.gear2, tex: SURF.fabric, rough: 0.9 });
  }
  // chin strap
  for (const s of [-1, 1]) {
    const pts = [V(s * 0.086, 0.02, 0.0), V(s * 0.08, -0.03, -0.005), V(s * 0.062, -0.078, -0.03), V(s * 0.03, -0.1, -0.05), V(0, -0.104, -0.056)].map((v) => v.add(hc));
    const ups = [V(s, 0, 0), V(s, -0.2, 0), V(s, -0.6, -0.3), V(s * 0.4, -1, -0.4), V(0, -1, -0.4)];
    B.strap(pts, ups, 0.014, 0.003, { bone: head, color: 0x1d1d1b, tex: SURF.webbing, rough: 0.85, weights: pts.map(() => [[head, 1]]) });
  }
  // headset ear cups and mic boom
  for (const s of [-1, 1]) {
    B.add(superEllipsoid(0.017, 0.037, 0.031, 0.5, 0.6, 12, 10), { bone: head, p: [s * 0.087, hc.y - 0.004, hc.z + 0.012], color: L.headset, tex: SURF.polymer, rough: 0.6 });
    B.add(superEllipsoid(0.006, 0.012, 0.012, 0.5, 0.5, 6, 6), { bone: head, p: [s * 0.105, hc.y + 0.004, hc.z + 0.012], color: 0x151515, tex: SURF.rubber, rough: 0.7 });
  }
  B.add(pathTube([V(-0.093, -0.02, 0.0), V(-0.085, -0.045, -0.045), V(-0.058, -0.058, -0.085), V(-0.035, -0.06, -0.097)].map((v) => v.add(hc)), 0.0028, 5), { bone: head, color: 0x151515, rough: 0.6, tex: SURF.rubber });
  B.add(new THREE.SphereGeometry(0.0075, 8, 6), { bone: head, p: [hc.x - 0.031, hc.y - 0.06, hc.z - 0.1], color: 0x121212, tex: SURF.fabric, rough: 0.95 });

  // eyewear: goggles (attackers) or ballistic glasses (defenders)
  const band = (a, c, y0, y1, t0, t1, segs = 20) => {
    const pos = [], nor = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const th = t0 + (i / segs) * (t1 - t0);
      for (const [j, y] of [[0, y0], [1, y1]]) {
        const bulge = 1 + 0.03 * Math.sin((j ? 1 : 0) * Math.PI);
        const x = a * Math.sin(th) * bulge, z = -c * Math.cos(th) * bulge;
        pos.push(x + hc.x, y + hc.y, z + hc.z);
        const n = V(x / (a * a), 0, z / (c * c)).normalize();
        nor.push(n.x, n.y, n.z);
      }
    }
    for (let i = 0; i < segs; i++) {
      const p0 = i * 2, p1 = p0 + 1, p2 = p0 + 2, p3 = p0 + 3;
      idx.push(p0, p1, p2, p1, p3, p2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
  };
  if (att) {
    B.add(band(0.084, 0.101, -0.004, 0.044, -1.5, 1.5, 22), { bone: head, color: 0x262622, tex: SURF.rubber, rough: 0.8 });
    B.add(band(0.087, 0.106, 0.0, 0.04, -1.3, 1.3, 22), { bone: head, color: L.lens, rough: 0.05, metal: 0.75 });
    const strapPts = [];
    for (let k = 0; k <= 16; k++) {
      const th = 1.45 + (k / 16) * (Math.PI * 2 - 2.9);
      strapPts.push(V(0.102 * Math.sin(th), 0.028, -0.124 * Math.cos(th)).add(hc));
    }
    B.add(pathTube(strapPts, 0.005, 4), { bone: head, color: 0x3b3a30, tex: SURF.webbing, rough: 0.85 });
  } else {
    B.add(band(0.084, 0.104, -0.003, 0.028, -1.25, 1.25, 20), { bone: head, color: L.lens, rough: 0.05, metal: 0.7 });
    B.add(pathTube([-1.25, -0.8, -0.3, 0, 0.3, 0.8, 1.25].map((th) => V(0.085 * Math.sin(th), 0.029, -0.105 * Math.cos(th)).add(hc)), 0.0022, 4), { bone: head, color: 0x151515, rough: 0.5, tex: SURF.polymer });
    for (const s of [-1, 1]) B.add(pathTube([V(s * 0.08, 0.027, -0.03), V(s * 0.082, 0.024, 0.0), V(s * 0.078, 0.018, 0.02)].map((v) => v.add(hc)), 0.002, 4), { bone: head, color: 0x151515, rough: 0.5, tex: SURF.polymer });
  }
}
