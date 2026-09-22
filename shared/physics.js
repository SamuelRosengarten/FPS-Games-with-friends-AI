// Collision world made of axis aligned boxes, player movement and hitboxes.
// Shared by the server (bots, hit detection, grenades) and the client (local movement, effects).

import { PLAYER, clamp, lerp } from './constants.js';

const CELL = 4;
const SKIN = 0.002;
const EPS = 1e-5;

export class PhysicsWorld {
  constructor(boxes, bounds) {
    // boxes: [{ id, min:[x,y,z], max:[x,y,z], mat, active, destructible, renderOnly }]
    this.boxes = boxes.filter((b) => !b.renderOnly);
    this.byId = new Map();
    for (const b of this.boxes) { if (b.active === undefined) b.active = true; this.byId.set(b.id, b); }
    this.minX = bounds.minX - CELL;
    this.minZ = bounds.minZ - CELL;
    this.cols = Math.ceil((bounds.maxX - this.minX + CELL) / CELL) + 1;
    this.rows = Math.ceil((bounds.maxZ - this.minZ + CELL) / CELL) + 1;
    this.grid = new Array(this.cols * this.rows);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = [];
    this.stamps = new Uint32Array(this.boxes.length);
    this.stamp = 1;
    this.boxes.forEach((b, i) => {
      b._i = i;
      const [c0, r0, c1, r1] = this._cellRange(b.min[0], b.min[2], b.max[0], b.max[2]);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.grid[r * this.cols + c].push(b);
    });
    this._tmp = [];
  }

  _cellRange(minx, minz, maxx, maxz) {
    const c0 = clamp(Math.floor((minx - this.minX) / CELL), 0, this.cols - 1);
    const r0 = clamp(Math.floor((minz - this.minZ) / CELL), 0, this.rows - 1);
    const c1 = clamp(Math.floor((maxx - this.minX) / CELL), 0, this.cols - 1);
    const r1 = clamp(Math.floor((maxz - this.minZ) / CELL), 0, this.rows - 1);
    return [c0, r0, c1, r1];
  }

  _nextStamp() {
    this.stamp++;
    if (this.stamp > 0xfffffff0) { this.stamps.fill(0); this.stamp = 1; }
    return this.stamp;
  }

  setActive(id, active) {
    const b = this.byId.get(id);
    if (b) b.active = active;
  }

  query(minx, miny, minz, maxx, maxy, maxz, out = []) {
    out.length = 0;
    const st = this._nextStamp();
    const [c0, r0, c1, r1] = this._cellRange(minx, minz, maxx, maxz);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.grid[r * this.cols + c];
        for (let k = 0; k < cell.length; k++) {
          const b = cell[k];
          if (this.stamps[b._i] === st) continue;
          this.stamps[b._i] = st;
          if (!b.active) continue;
          if (b.max[0] <= minx || b.min[0] >= maxx || b.max[1] <= miny || b.min[1] >= maxy || b.max[2] <= minz || b.min[2] >= maxz) continue;
          out.push(b);
        }
      }
    }
    return out;
  }

  // True if an axis aligned box overlaps any solid box.
  overlaps(minx, miny, minz, maxx, maxy, maxz) {
    return this.query(minx + EPS, miny + EPS, minz + EPS, maxx - EPS, maxy - EPS, maxz - EPS, this._tmp).length > 0;
  }

  // Walk the XZ grid cells along a ray, calling visit(box) for each unseen box. visit returns the
  // current best t so traversal can stop early.
  _traverse(ox, oz, dx, dz, maxT, visit) {
    const st = this._nextStamp();
    let cx = Math.floor((ox - this.minX) / CELL);
    let cz = Math.floor((oz - this.minZ) / CELL);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > 1e-12 ? CELL / Math.abs(dx) : Infinity;
    const tDeltaZ = Math.abs(dz) > 1e-12 ? CELL / Math.abs(dz) : Infinity;
    let tMaxX = Math.abs(dx) > 1e-12 ? ((this.minX + (cx + (dx > 0 ? 1 : 0)) * CELL) - ox) / dx : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-12 ? ((this.minZ + (cz + (dz > 0 ? 1 : 0)) * CELL) - oz) / dz : Infinity;
    let best = Infinity;
    for (let guard = 0; guard < 4096; guard++) {
      if (cx >= 0 && cz >= 0 && cx < this.cols && cz < this.rows) {
        const cell = this.grid[cz * this.cols + cx];
        for (let k = 0; k < cell.length; k++) {
          const b = cell[k];
          if (this.stamps[b._i] === st) continue;
          this.stamps[b._i] = st;
          if (!b.active) continue;
          best = visit(b);
        }
      } else if ((cx < 0 && stepX < 0) || (cz < 0 && stepZ < 0) || (cx >= this.cols && stepX > 0) || (cz >= this.rows && stepZ > 0)) {
        break;
      }
      const tNext = Math.min(tMaxX, tMaxZ);
      if (best <= tNext || tNext > maxT) break;
      if (tMaxX < tMaxZ) { cx += stepX; tMaxX += tDeltaX; } else { cz += stepZ; tMaxZ += tDeltaZ; }
    }
  }

  // Closest hit along a ray. dir must be normalized. Returns { t, box, n:[x,y,z] } or null.
  raycast(ox, oy, oz, dx, dy, dz, maxT = 1000, filter = null) {
    let hit = null;
    let bestT = maxT;
    this._traverse(ox, oz, dx, dz, maxT, (b) => {
      if (filter && !filter(b)) return bestT;
      const r = rayBox(ox, oy, oz, dx, dy, dz, b, bestT);
      if (r && r.t < bestT) { bestT = r.t; hit = { t: r.t, box: b, n: r.n }; }
      return hit ? bestT : Infinity;
    });
    return hit;
  }

  // All box intersections along a ray sorted by entry distance: [{ t, tOut, box, n }]
  raycastAll(ox, oy, oz, dx, dy, dz, maxT = 1000) {
    const hits = [];
    this._traverse(ox, oz, dx, dz, maxT, (b) => {
      const r = rayBox(ox, oy, oz, dx, dy, dz, b, maxT);
      if (r) hits.push({ t: r.t, tOut: r.tOut, box: b, n: r.n });
      return Infinity;
    });
    hits.sort((a, b) => a.t - b.t);
    return hits;
  }

  lineOfSight(ax, ay, az, bx, by, bz, filter = null) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return true;
    return !this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d, filter);
  }

  // Highest floor surface below a point (for dropping items / grenades).
  groundBelow(x, y, z, maxDrop = 50) {
    const h = this.raycast(x, y, z, 0, -1, 0, maxDrop);
    return h ? y - h.t : y - maxDrop;
  }
}

// Slab test. Returns { t, tOut, n } or null. If the origin is inside, t = 0.
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    const di = d[i], oi = o[i], mn = b.min[i], mx = b.max[i];
    if (Math.abs(di) < 1e-12) {
      if (oi < mn || oi > mx) return null;
    } else {
      const inv = 1 / di;
      let t1 = (mn - oi) * inv, t2 = (mx - oi) * inv;
      let s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  const n = [0, 0, 0];
  if (axis >= 0) n[axis] = sign; else { n[0] = -dx; n[1] = -dy; n[2] = -dz; }
  return { t: tmin, tOut: tmax, n };
}

// ------------------------------------------------------------------ player movement

export function heightFor(crouch) { return lerp(PLAYER.height, PLAYER.crouchHeight, crouch); }
export function eyeHeight(crouch) { return heightFor(crouch) - PLAYER.eyeFromTop; }

function bodyCollides(world, x, y, z, hw, h) {
  return world.overlaps(x - hw, y, z - hw, x + hw, y + h, z + hw);
}

// Sweep the body along one axis, stopping at the first box. Returns the distance actually moved.
function sweep(world, s, hw, h, axis, delta) {
  if (delta === 0) return 0;
  const orig = delta;
  const bmin = [s.x - hw, s.y, s.z - hw];
  const bmax = [s.x + hw, s.y + h, s.z + hw];
  const qmin = bmin.slice(), qmax = bmax.slice();
  if (delta > 0) qmax[axis] += delta; else qmin[axis] += delta;
  const cands = world.query(qmin[0], qmin[1], qmin[2], qmax[0], qmax[1], qmax[2], world._tmp);
  for (let k = 0; k < cands.length; k++) {
    const b = cands[k];
    let skip = false;
    for (let a = 0; a < 3; a++) {
      if (a === axis) continue;
      if (b.max[a] <= bmin[a] + EPS || b.min[a] >= bmax[a] - EPS) { skip = true; break; }
    }
    if (skip) continue;
    if (delta > 0) {
      const gap = b.min[axis] - bmax[axis];
      if (gap >= -0.01) delta = Math.min(delta, gap - SKIN);
    } else {
      const gap = b.max[axis] - bmin[axis];
      if (gap <= 0.01) delta = Math.max(delta, gap + SKIN);
    }
  }
  if ((orig > 0 && delta < 0) || (orig < 0 && delta > 0)) delta = 0;
  if (axis === 0) s.x += delta; else if (axis === 1) s.y += delta; else s.z += delta;
  return delta;
}

function moveHorizontal(world, s, hw, h, dx, dz) {
  const x0 = s.x, y0 = s.y, z0 = s.z;
  const ax = sweep(world, s, hw, h, 0, dx);
  const az = sweep(world, s, hw, h, 2, dz);
  const blocked = Math.abs(ax) < Math.abs(dx) - 1e-5 || Math.abs(az) < Math.abs(dz) - 1e-5;
  if (!blocked || !s.onGround) return;
  const sx = s.x, sy = s.y, sz = s.z;
  s.x = x0; s.y = y0; s.z = z0;
  const up = sweep(world, s, hw, h, 1, PLAYER.stepHeight);
  if (up <= 0.01) { s.x = sx; s.y = sy; s.z = sz; return; }
  sweep(world, s, hw, h, 0, dx);
  sweep(world, s, hw, h, 2, dz);
  const want = -(up + 0.02);
  const down = sweep(world, s, hw, h, 1, want);
  const landed = down > want + 1e-5;
  const p1 = (sx - x0) ** 2 + (sz - z0) ** 2;
  const p2 = (s.x - x0) ** 2 + (s.z - z0) ** 2;
  if (!landed || p2 <= p1 + 1e-7) { s.x = sx; s.y = sy; s.z = sz; }
  else s.stepped = (s.stepped || 0) + (s.y - y0);
}

/**
 * Advance a player body.
 * s:   { x, y, z, vx, vy, vz, onGround, crouch, lean }
 * inp: { fwd, right, jump, crouch, walk, yaw, lean, speedMul, frozen }
 */
export function stepPlayer(world, s, inp, dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 125)));
  const h = dt / n;
  s.stepped = 0;
  s.landed = 0;
  let jumped = false;
  for (let i = 0; i < n; i++) {
    const j = stepOnce(world, s, inp, h, !jumped && inp.jump);
    if (j) jumped = true;
  }
  return jumped;
}

function stepOnce(world, s, inp, dt, wantJump) {
  const hw = PLAYER.radius;
  // --- crouch
  const target = inp.crouch ? 1 : 0;
  if (s.crouch !== target) {
    const rate = dt / PLAYER.crouchTime;
    const nc = target > s.crouch ? Math.min(target, s.crouch + rate) : Math.max(target, s.crouch - rate);
    const hOld = heightFor(s.crouch), hNew = heightFor(nc);
    if (hNew < hOld) {
      if (!s.onGround) s.y += hOld - hNew;
      s.crouch = nc;
    } else {
      if (s.onGround) {
        if (!bodyCollides(world, s.x, s.y, s.z, hw, hNew)) s.crouch = nc;
      } else {
        const dy = hNew - hOld;
        if (!bodyCollides(world, s.x, s.y - dy, s.z, hw, hNew)) { s.y -= dy; s.crouch = nc; }
        else if (!bodyCollides(world, s.x, s.y, s.z, hw, hNew)) s.crouch = nc;
      }
    }
  }
  const h = heightFor(s.crouch);

  // --- lean
  const lt = clamp(inp.lean || 0, -1, 1);
  if (s.lean !== lt) {
    const rate = dt / PLAYER.leanTime;
    s.lean = lt > s.lean ? Math.min(lt, s.lean + rate) : Math.max(lt, s.lean - rate);
  }

  // --- wish velocity
  let fwd = inp.frozen ? 0 : (inp.fwd || 0);
  let right = inp.frozen ? 0 : (inp.right || 0);
  const len = Math.hypot(fwd, right);
  if (len > 1) { fwd /= len; right /= len; }
  const sy = Math.sin(inp.yaw), cy = Math.cos(inp.yaw);
  // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
  let wx = -sy * fwd + cy * right;
  let wz = -cy * fwd - sy * right;
  const wl = Math.hypot(wx, wz);
  const mag = Math.min(1, Math.hypot(fwd, right));
  if (wl > 1e-6) { wx /= wl; wz /= wl; }
  const speedFactor = Math.min(inp.walk ? PLAYER.walkMul : 1, lerp(1, PLAYER.crouchMul, s.crouch));
  const wishSpeed = PLAYER.runSpeed * (inp.speedMul || 1) * speedFactor * mag;

  if (s.onGround) {
    // friction
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > 0) {
      const drop = Math.max(sp, PLAYER.stopSpeed) * PLAYER.friction * dt;
      const ns = Math.max(0, sp - drop);
      s.vx *= ns / sp; s.vz *= ns / sp;
    }
    accelerate(s, wx, wz, wishSpeed, PLAYER.accel, dt);
    if (wantJump && !inp.frozen) {
      s.vy = PLAYER.jumpSpeed;
      s.onGround = false;
      wantJump = 'done';
    }
  } else {
    accelerate(s, wx, wz, Math.min(wishSpeed, PLAYER.airSpeedCap), PLAYER.airAccel, dt, wishSpeed);
  }

  // clamp horizontal speed to something sane
  const hs = Math.hypot(s.vx, s.vz);
  const cap = PLAYER.runSpeed * 1.6;
  if (hs > cap) { s.vx *= cap / hs; s.vz *= cap / hs; }

  s.vy -= PLAYER.gravity * dt;
  if (s.vy < -40) s.vy = -40;

  const wasGround = s.onGround;
  moveHorizontal(world, s, hw, h, s.vx * dt, s.vz * dt);

  const dyWant = s.vy * dt;
  const dy = sweep(world, s, hw, h, 1, dyWant);
  if (dyWant < 0) {
    if (dy > dyWant + 1e-6) {
      if (!s.onGround && s.vy < -3) s.landed = Math.max(s.landed || 0, -s.vy);
      s.onGround = true; s.vy = 0;
    } else if (wasGround && s.vy <= 0) {
      const y0 = s.y;
      const d = sweep(world, s, hw, h, 1, -PLAYER.stepHeight);
      if (d > -PLAYER.stepHeight + 1e-5) { s.onGround = true; s.vy = 0; s.stepped = (s.stepped || 0) + (s.y - y0); }
      else { s.y = y0; s.onGround = false; }
    } else {
      s.onGround = false;
    }
  } else {
    if (dy < dyWant - 1e-6) s.vy = 0; // bumped head
    s.onGround = false;
  }
  return wantJump === 'done';
}

function accelerate(s, wx, wz, wishSpeed, accel, dt, accelSpeed = wishSpeed) {
  const cur = s.vx * wx + s.vz * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const a = Math.min(accel * dt * accelSpeed, add);
  s.vx += a * wx; s.vz += a * wz;
}

// How far (0..1) the player can lean in `dir` (-1 left, 1 right) before the head hits a wall.
export function leanClearance(world, s, yaw, dir) {
  if (!dir) return 0;
  const eyeY = s.y + eyeHeight(s.crouch);
  const rx = Math.cos(yaw) * dir, rz = -Math.sin(yaw) * dir;
  const hit = world.raycast(s.x, eyeY, s.z, rx, 0, rz, PLAYER.leanOffset + 0.2);
  if (!hit) return 1;
  return clamp((hit.t - 0.2) / PLAYER.leanOffset, 0, 1);
}

// Eye position including lean.
export function eyePosition(p, out = [0, 0, 0]) {
  const lean = p.lean || 0;
  out[0] = p.x + Math.cos(p.yaw) * lean * PLAYER.leanOffset;
  out[1] = p.y + eyeHeight(p.crouch || 0) - Math.abs(lean) * 0.06;
  out[2] = p.z - Math.sin(p.yaw) * lean * PLAYER.leanOffset;
  return out;
}

// ------------------------------------------------------------------ hitboxes

// Zones in player local space: x = right, y = up from feet, z = forward.
export function playerZones(p) {
  const H = heightFor(p.crouch || 0);
  const lean = p.lean || 0;
  return [
    { zone: 'head', min: [lean * 0.38 - 0.13, H - 0.29, -0.12], max: [lean * 0.38 + 0.13, H + 0.01, 0.16] },
    { zone: 'chest', min: [lean * 0.24 - 0.28, H * 0.58, -0.17], max: [lean * 0.24 + 0.28, H - 0.29, 0.17] },
    { zone: 'stomach', min: [lean * 0.1 - 0.22, H * 0.46, -0.16], max: [lean * 0.1 + 0.22, H * 0.58, 0.16] },
    { zone: 'legs', min: [-0.22, 0, -0.15], max: [0.22, H * 0.46, 0.15] },
  ];
}

// Ray vs a player's hitboxes. p: { x, y, z, yaw, crouch, lean }. Returns { t, zone } or null.
export function rayHitPlayer(ox, oy, oz, dx, dy, dz, maxT, p) {
  // cheap bounding test
  const H = heightFor(p.crouch || 0);
  const bb = { min: [p.x - 0.75, p.y, p.z - 0.75], max: [p.x + 0.75, p.y + H + 0.05, p.z + 0.75] };
  if (!rayBox(ox, oy, oz, dx, dy, dz, bb, maxT)) return null;
  const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
  // world -> local: lx = right·v, lz = forward·v ; right=(c,0,-s), forward=(-s,0,-c)
  const rx = ox - p.x, rz = oz - p.z;
  const lox = rx * c - rz * s, loz = -rx * s - rz * c, loy = oy - p.y;
  const ldx = dx * c - dz * s, ldz = -dx * s - dz * c, ldy = dy;
  let best = null;
  for (const z of playerZones(p)) {
    const r = rayBox(lox, loy, loz, ldx, ldy, ldz, z, best ? best.t : maxT);
    if (r && (!best || r.t < best.t)) best = { t: r.t, zone: z.zone };
  }
  return best;
}
