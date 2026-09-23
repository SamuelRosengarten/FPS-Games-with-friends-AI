import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicsWorld, stepPlayer, rayHitPlayer, eyePosition, heightFor } from '../shared/physics.js';
import { loadMap, MAP_DEFS } from '../shared/maps/index.js';
import { PLAYER } from '../shared/constants.js';

function flatWorld(extra = []) {
  const boxes = [{ id: 1, min: [-50, -1, -50], max: [50, 0, 50], mat: 'sand', kind: 'ground' }, ...extra];
  return new PhysicsWorld(boxes, { minX: -50, minZ: -50, maxX: 50, maxZ: 50 });
}

const body = (x = 0, y = 0.01, z = 0) => ({ x, y, z, vx: 0, vy: 0, vz: 0, onGround: true, crouch: 0, lean: 0 });

test('player settles on the ground and runs at max speed', () => {
  const w = flatWorld();
  const s = body(0, 1, 0);
  for (let i = 0; i < 120; i++) stepPlayer(w, s, { yaw: 0, fwd: 1 }, 1 / 60);
  assert.ok(s.onGround);
  assert.ok(Math.abs(s.y) < 0.01, `y=${s.y}`);
  assert.ok(Math.abs(Math.hypot(s.vx, s.vz) - PLAYER.runSpeed) < 0.05);
  assert.ok(s.z < -5, 'moved forward along -Z');
});

test('walls block movement and the player never tunnels through a thin panel', () => {
  const w = flatWorld([{ id: 2, min: [-5, 0, -3.1], max: [5, 3, -2.9], mat: 'woodPanel' }]);
  const s = body();
  for (let i = 0; i < 300; i++) stepPlayer(w, s, { yaw: 0, fwd: 1 }, 1 / 30);
  assert.ok(s.z > -2.9 + PLAYER.radius - 0.01, `z=${s.z}`);
});

test('step up small ledges but not tall ones', () => {
  const w2 = flatWorld([{ id: 2, min: [-5, 0, -20], max: [5, 0.5, -4], mat: 'concrete' }]);
  const s = body();
  for (let i = 0; i < 120; i++) stepPlayer(w2, s, { yaw: 0, fwd: 1 }, 1 / 60);
  assert.ok(s.y > 0.45, `stepped onto 0.5 m ledge, y=${s.y}`);

  const w3 = flatWorld([{ id: 3, min: [-5, 0, -20], max: [5, 1.0, -4], mat: 'concrete' }]);
  const t = body();
  for (let i = 0; i < 120; i++) stepPlayer(w3, t, { yaw: 0, fwd: 1 }, 1 / 60);
  assert.ok(t.y < 0.1 && t.z > -4, 'blocked by 1 m ledge without jumping');
});

test('jumping clears a 1 m crate', () => {
  const w = flatWorld([{ id: 2, min: [-1, 0, -4], max: [1, 1.0, -2.4], mat: 'crate' }]);
  const s = body(0, 0.01, 0);
  let maxY = 0;
  for (let i = 0; i < 90; i++) {
    stepPlayer(w, s, { yaw: 0, fwd: 1, jump: i === 12 }, 1 / 60);
    maxY = Math.max(maxY, s.y);
  }
  assert.ok(maxY > 1.0, `max height ${maxY}`);
  assert.ok(s.z < -2.4, 'made it onto/over the crate');
});

test('crouching lowers the body and blocks standing under low ceilings', () => {
  const w = flatWorld([{ id: 2, min: [-2, 1.4, -2], max: [2, 2, 2], mat: 'concrete' }]);
  const s = body();
  for (let i = 0; i < 30; i++) stepPlayer(w, s, { yaw: 0, crouch: true }, 1 / 60);
  assert.equal(s.crouch, 1);
  for (let i = 0; i < 30; i++) stepPlayer(w, s, { yaw: 0, crouch: false }, 1 / 60);
  assert.ok(s.crouch > 0.5, 'cannot fully stand up under the ceiling');
  assert.ok(s.y + heightFor(s.crouch) <= 1.4 + 0.01, 'head stays below the ceiling');
});

test('raycasts hit the nearest box and report the face normal', () => {
  const w = flatWorld([{ id: 2, min: [4, 0, -1], max: [5, 3, 1], mat: 'concrete' }, { id: 3, min: [8, 0, -1], max: [9, 3, 1], mat: 'concrete' }]);
  const h = w.raycast(0, 1, 0, 1, 0, 0, 100);
  assert.equal(h.box.id, 2);
  assert.ok(Math.abs(h.t - 4) < 1e-6);
  assert.deepEqual(h.n, [-1, 0, 0]);
  const all = w.raycastAll(0, 1, 0, 1, 0, 0, 100);
  assert.deepEqual(all.map((a) => a.box.id), [2, 3]);
  w.setActive(2, false);
  assert.equal(w.raycast(0, 1, 0, 1, 0, 0, 100).box.id, 3, 'destroyed boxes are skipped');
});

test('hitboxes: head, chest and legs zones', () => {
  const p = { x: 0, y: 0, z: 0, yaw: 0, crouch: 0, lean: 0 };
  assert.equal(rayHitPlayer(0, 1.65, -5, 0, 0, 1, 20, p).zone, 'head');
  assert.equal(rayHitPlayer(0, 1.3, -5, 0, 0, 1, 20, p).zone, 'chest');
  assert.equal(rayHitPlayer(0, 0.4, -5, 0, 0, 1, 20, p).zone, 'legs');
  assert.equal(rayHitPlayer(0, 2.2, -5, 0, 0, 1, 20, p), null);
  // crouched head is lower
  const c = { ...p, crouch: 1 };
  assert.equal(rayHitPlayer(0, 1.65, -5, 0, 0, 1, 20, c), null);
  assert.equal(rayHitPlayer(0, 1.05, -5, 0, 0, 1, 20, c).zone, 'head');
  // leaning moves the head sideways
  const l = { ...p, lean: 1 };
  assert.equal(rayHitPlayer(0.38, 1.62, -5, 0, 0, 1, 20, l).zone, 'head');
  const eye = eyePosition({ ...l, yaw: 0 });
  assert.ok(eye[0] > 0.3);
});

test('every map builds, has spawns and a closed boundary', () => {
  for (const def of MAP_DEFS) {
    const m = loadMap(def.id);
    assert.ok(m.boxes.length > 50, `${m.id} boxes`);
    if (m.modes.includes('defuse')) {
      assert.ok(m.zones.A && m.zones.B, `${m.id} has sites`);
      assert.ok(m.spawns[1].length >= 5 && m.spawns[2].length >= 5, `${m.id} team spawns`);
    }
    assert.ok(m.spawns.ffa.length > 20, `${m.id} ffa spawns`);
    for (let c = 0; c < m.cols; c++) {
      assert.equal(m.grid[0][c], '#');
      assert.equal(m.grid[m.rows - 1][c], '#');
    }
    // spawn points are not inside geometry
    const w = new PhysicsWorld(m.boxes, m.bounds);
    for (const sp of [...m.spawns[1], ...m.spawns[2]]) {
      assert.ok(!w.overlaps(sp[0] - 0.35, sp[1] + 0.05, sp[2] - 0.35, sp[0] + 0.35, sp[1] + 1.8, sp[2] + 0.35), `${m.id} spawn clear at ${sp}`);
    }
  }
});

test('embassy: both staircases can be walked up to the second floor and site A is reachable', async () => {
  const { NavGraph } = await import('../server/nav.js');
  const m = loadMap('embassy');
  const w = new PhysicsWorld(m.boxes, m.bounds);
  const cell = (r, c) => [m.x0 + c * m.cellSize + m.cellSize / 2, m.z0 + r * m.cellSize + m.cellSize / 2];
  const fy = m.upper.floorY;
  // inside staircase: start in the lobby south of it and run north
  for (const [r, c] of [[23, 29], [18, 32]]) {
    const [x, z] = cell(r, c);
    const s = body(x, 0.01, z);
    for (let i = 0; i < 240; i++) stepPlayer(w, s, { yaw: 0, fwd: 1 }, 1 / 60);
    assert.ok(Math.abs(s.y - fy) < 0.05, `stairs at ${r},${c}: ended at y=${s.y.toFixed(2)} z=${s.z.toFixed(1)}`);
  }
  // a player upstairs stands on the slab, one downstairs has headroom under it
  const [ux, uz] = cell(20, 12);
  const up = body(ux, fy + 0.5, uz);
  for (let i = 0; i < 60; i++) stepPlayer(w, up, { yaw: 0 }, 1 / 60);
  assert.ok(Math.abs(up.y - fy) < 0.01 && up.onGround);
  // bots can path from both spawns to nodes inside the upstairs site
  const nav = new NavGraph(w);
  nav.markReachable([...m.spawns[1], ...m.spawns[2]]);
  const inA = nav.nodesInZone(m.zones.A);
  // (floor nodes plus the conference table tops)
  assert.ok(inA.length > 10 && inA.every((n) => n.y > fy - 0.1 && n.y < fy + 1.1), 'site A nodes are on the upper floor');
  const floorA = inA.filter((n) => Math.abs(n.y - fy) < 0.05);
  for (const sp of [m.spawns[1][0], m.spawns[2][0]]) {
    const path = nav.findPath(w, { x: sp[0], y: sp[1] + 0.1, z: sp[2] }, floorA[Math.floor(floorA.length / 2)]);
    assert.ok(path && path.length > 5, 'path to site A');
    // stairs are walked, not jumped
    assert.ok(path.filter((p) => p.type === 'jump').length === 0, 'no jumps needed to reach site A');
  }
  // upper-floor FFA spawns exist
  assert.ok(m.spawns.ffa.some((p) => Math.abs(p[1] - fy) < 0.01));
});
