// Bot AI. Produces the same movement input a human client would and fires through the match.
//
// Layers, top to bottom:
//   perception & memory (sight, footsteps, gunfire, damage, team callouts)
//   target selection (threat scoring, holding a lost target's angle)
//   aim model (reaction time, flick with over/undershoot that settles, tracking noise, recoil control)
//   fire discipline & combat movement (counter-strafe before shooting, bursts/taps by range, jiggle strafes,
//     crouch spraying, falling back to cover to reload or when outnumbered)
//   objectives (Defuse: attacker staging → execute with utility → plant → post-plant, defender site
//     assignment, holding angles, rotations, reinforcing, retakes; deathmatch: hunting)
//   navigation (smoothed path following, unsticking, spacing from teammates) and crosshair placement
//     while moving (pre-aiming corners and known enemy positions at head height).

import { TEAM, DEG, clamp, viewDir, wrapAngle, PLAYER } from '../shared/constants.js';
import { WEAPONS, GRENADES, computeSpread, applySpread, recoilOffset } from '../shared/weapons.js';
import { eyePosition, heightFor } from '../shared/physics.js';
import { inZone } from '../shared/maps/builder.js';
import { getTactics } from './tactics.js';

const DIFF = {
  easy: {
    reaction: 520, settle: 0.34, err: 3.2, noise: 1.3, head: 0.12, spray: 0.3, fov: 110, hearing: 24,
    turn: 9, maxTurn: 9, strafe: 0.25, crouch: 0.1, preaim: 0.35, nade: 0.2, burst: 0.7, tapGap: 380, callouts: 0.25,
  },
  normal: {
    reaction: 320, settle: 0.23, err: 1.9, noise: 0.7, head: 0.32, spray: 0.62, fov: 120, hearing: 34,
    turn: 14, maxTurn: 14, strafe: 0.6, crouch: 0.35, preaim: 0.7, nade: 0.45, burst: 1, tapGap: 260, callouts: 0.5,
  },
  hard: {
    reaction: 200, settle: 0.15, err: 1.0, noise: 0.35, head: 0.58, spray: 0.88, fov: 130, hearing: 46,
    turn: 22, maxTurn: 20, strafe: 0.9, crouch: 0.55, preaim: 1, nade: 0.7, burst: 1.25, tapGap: 190, callouts: 0.7,
  },
  expert: {
    reaction: 150, settle: 0.11, err: 0.6, noise: 0.22, head: 0.75, spray: 0.95, fov: 140, hearing: 55,
    turn: 30, maxTurn: 26, strafe: 1, crouch: 0.6, preaim: 1, nade: 0.85, burst: 1.4, tapGap: 150, callouts: 0.8,
  },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.75;
const HEAD_Y = 1.5;

export class BotBrain {
  constructor(match, p, difficulty = 'normal') {
    this.m = match;
    this.p = p;
    this.d = DIFF[difficulty] || DIFF.normal;
    this.seed = Math.random() * 100;
    this.mem = new Map();
    this.reset();
  }

  reset() {
    this.visible = [];
    this.nextPerceive = 0;
    this.target = null;
    this.lastTarget = null;
    this.reactUntil = 0;
    this.lostAt = 0;
    this.lastSeenPos = null;
    this.errYaw = 0;
    this.errPitch = 0;
    this.aimZone = 'chest';
    this.shots = 0;
    this.lastShot = 0;
    this.burstLeft = 0;
    this.pauseUntil = 0;
    this.cstate = 'shoot';
    this.cstateUntil = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.crouchSpray = false;
    this.path = null;
    this.pathIdx = 0;
    this.goal = null;
    this.goalKey = null;
    this.repathAt = 0;
    this.arrived = false;
    this.stuckT = 0;
    this.slowT = 0;
    this.backoffUntil = 0;
    this.lastPos = null;
    this.lastProgressCheck = 0;
    this.use = false;
    this.faceAt = null;
    this.holdSpot = null;
    this.holdLook = null;
    this.nextGlance = 0;
    this.lookPoint = null;
    this.nextLook = 0;
    this.avertUntil = 0;
    this.avertYaw = 0;
    this.nadeCooldown = 0;
    this.crouchUntil = 0;
    this.retreat = null;
    this.retreatUntil = 0;
    this.hurtAt = 0;
    this.reinforceJob = null;
    this.noJobUntil = 0;
    this.breachDone = false;
    this.utilityDone = false;
    this.walkNear = false;
    this.throwing = false;
    this.lastCallout = 0;
    this.lastContact = 0;
    this.patrol = null;
  }

  // ---------------------------------------------------------------- match events
  onSpawn() { this.reset(); this.mem.clear(); }
  onRoundStart() {
    this.reset();
    this.mem.clear();
    this.buy();
    this.nadeCooldown = this.m.now + rand(3000, 9000);
  }
  dead() {}
  onBombPlanted() { this.goalKey = null; this.path = null; this.holdSpot = null; }
  onFlashed(dur) {
    this.target = null;
    this.reactUntil = this.m.now + dur * 1000;
  }

  onKill(attacker, target) {
    if (target === this.p) { this.reset(); return; }
    if (this.target === target) { this.target = null; this.shots = 0; this.lostAt = 0; }
    this.mem.delete(target.id);
    // a teammate died: we now know roughly where the killer is (trade)
    if (attacker && attacker !== target && !this.m.enemies(this.p, target) && this.m.enemies(this.p, attacker)) {
      const d = Math.hypot(attacker.x - this.p.x, attacker.z - this.p.z);
      if (d < 45) this.remember(attacker, false, 1.5);
    }
  }

  hearShot(shooter, o) {
    if (!this.p.alive || !this.m.enemies(this.p, shooter)) return;
    const d = Math.hypot(o[0] - this.p.x, o[2] - this.p.z);
    if (d < this.d.hearing * 1.6) this.remember(shooter, false, clamp(d / 12, 0.5, 4));
  }

  onDamaged(attacker, from) {
    this.hurtAt = this.m.now;
    if (attacker && this.m.enemies(this.p, attacker)) {
      this.remember(attacker, false, 0.5);
      if (!this.target) { this.lookPoint = { x: from[0], y: from[1], z: from[2] }; this.nextLook = this.m.now + 700; }
    }
  }

  // ---------------------------------------------------------------- memory
  intel() {
    const m = this.m;
    if (!m.botIntel) m.botIntel = { 1: new Map(), 2: new Map() };
    return m.botIntel[this.p.team] || new Map();
  }

  remember(q, seen, noise = 0) {
    const e = {
      x: q.x + (noise ? gauss() * noise : 0), y: q.y, z: q.z + (noise ? gauss() * noise : 0),
      t: this.m.now, seen, vx: q.vx || 0, vz: q.vz || 0,
    };
    this.mem.set(q.id, e);
    if (seen && this.m.mode !== 'ffa' && this.m.mode !== 'gungame') this.intel().set(q.id, e);
  }

  // Freshest/nearest remembered enemy position (own memory and team callouts).
  bestThreat(maxAge = 6000) {
    const now = this.m.now, p = this.p;
    let best = null, bestS = Infinity;
    const consider = (id, e, teamInfo) => {
      const q = this.m.players.get(id);
      if (!q || !q.alive || !this.m.enemies(p, q)) return;
      const age = now - e.t;
      if (age > maxAge) return;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      const s = d + age / 150 + (teamInfo ? 6 : 0);
      if (s < bestS) { bestS = s; best = { ...e, id, age, d }; }
    };
    for (const [id, e] of this.mem) consider(id, e, false);
    if (this.m.mode !== 'ffa' && this.m.mode !== 'gungame') for (const [id, e] of this.intel()) consider(id, e, true);
    return best;
  }

  // ---------------------------------------------------------------- perception
  perceive(now) {
    const m = this.m, p = this.p;
    this.visible = [];
    if (p.blindUntil > now) return;
    const eye = eyePosition(p);
    const f = viewDir(p.yaw, 0);
    const cosFov = Math.cos((this.d.fov / 2) * DEG);
    for (const q of m.players.values()) {
      if (!q.alive || q === p || !m.inMatch(q) || !m.enemies(p, q)) continue;
      const H = heightFor(q.crouch);
      const dx = q.x - eye[0], dz = q.z - eye[2];
      const dist = Math.hypot(dx, dz);
      if (dist > 110) continue;
      const cosA = (dx * f[0] + dz * f[2]) / (dist || 1);
      // things right in front of you, or someone you're already fighting, are noticed more easily
      const tracked = q === this.target || (this.mem.get(q.id)?.seen && now - this.mem.get(q.id).t < 1500);
      if (dist > 2.5 && cosA < cosFov && !(tracked && cosA > cosFov - 0.25)) continue;
      let seen = false;
      for (const hy of [H - 0.15, H * 0.62, H * 0.3]) {
        if (m.world.lineOfSight(eye[0], eye[1], eye[2], q.x, q.y + hy, q.z) && !m.smokeBlocks(eye, [q.x, q.y + hy, q.z])) { seen = true; break; }
      }
      if (!seen) continue;
      // threat: close, facing us, recently hurt us, current target
      const qf = viewDir(q.yaw, 0);
      const facing = (-dx * qf[0] - dz * qf[2]) / (dist || 1);
      let score = 12 / Math.max(2, dist) + (facing > 0.85 ? 1.2 : 0) + (q === this.target ? 1.5 : 0) + (q.lastShotAt && now - q.lastShotAt < 600 && facing > 0.7 ? 1 : 0);
      if (q.hp < 40) score += 0.4;
      this.visible.push({ q, dist, score, cosA });
      this.remember(q, true);
    }
    this.visible.sort((a, b) => b.score - a.score);
    // footsteps of running enemies
    for (const q of m.players.values()) {
      if (!q.alive || !m.enemies(p, q) || !m.inMatch(q) || this.visible.some((v) => v.q === q)) continue;
      const sp = Math.hypot(q.vx || 0, q.vz || 0);
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (sp > 3.2 && !q.walking && q.onGround && d < 18 && Math.abs(q.y - p.y) < 3) this.remember(q, false, 1.2);
    }
    if (this.visible.length) {
      const q = this.visible[0].q;
      if (m.mode === 'defuse' && p.team === TEAM.DEF) {
        const site = this.nearestSite(q.x, q.z);
        if (site) { this.plan().alertSite = site; this.plan().alertAt = now; }
      }
      if (now - this.lastContact > 8000) this.callout(`Enemy spotted ${this.placeName(q)}`);
      this.lastContact = now;
      if (m.mode === 'defuse' && p.team === TEAM.ATT && this.m.map.zones[this.plan().site]) this.plan().contactAt = now;
    }
    // incoming flashbangs we can see: look away before they pop
    for (const g of m.grenades) {
      if (g.type !== 'flash') continue;
      const d = Math.hypot(g.x - eye[0], g.y - eye[1], g.z - eye[2]);
      if (d > 20 || g.explodeAt - now > 750 || g.explodeAt < now) continue;
      if (!m.world.lineOfSight(eye[0], eye[1], eye[2], g.x, g.y, g.z)) continue;
      this.avertYaw = Math.atan2(g.x - p.x, g.z - p.z);
      this.avertUntil = g.explodeAt + 250;
    }
  }

  nearestSite(x, z, max = 18) {
    const zs = this.m.map.zones;
    let best = null, bd = max;
    for (const s of ['A', 'B']) {
      const zn = zs[s];
      if (!zn) continue;
      const d = Math.hypot(x - (zn.min[0] + zn.max[0]) / 2, z - (zn.min[2] + zn.max[2]) / 2);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  placeName(q) {
    const s = this.nearestSite(q.x, q.z, 16);
    if (s) return `at ${s}`;
    const b = this.m.map.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    if (Math.hypot(q.x - cx, q.z - cz) < 14) return 'mid';
    return 'close by';
  }

  callout(text) {
    const m = this.m, now = m.now;
    if (m.mode === 'ffa' || m.mode === 'gungame' || now - this.lastCallout < 12000 || Math.random() > this.d.callouts) return;
    const team = m.botPlan?.lastCallout || {};
    if (now - (team[this.p.team] || 0) < 5000) return;
    if (m.botPlan) { m.botPlan.lastCallout = team; team[this.p.team] = now; }
    this.lastCallout = now;
    // only worth saying if a human is on the team
    const humans = [...m.players.values()].some((q) => !q.bot && q.team === this.p.team);
    if (humans) m.game.handleChat(this.p, { text, team: true });
  }

  plan() {
    const m = this.m;
    if (!m.botPlan) m.botPlan = { site: 'A', alertSite: null, alertAt: 0, claimed: new Set(), smoked: new Set() };
    const pl = m.botPlan;
    pl.holdClaims ||= new Map();
    pl.stageClaims ||= new Map();
    pl.postClaims ||= new Map();
    pl.defSites ||= new Map();
    return pl;
  }

  // ---------------------------------------------------------------- main update
  update(dt, now) {
    const p = this.p, m = this.m;
    const inp = { fwd: 0, right: 0, jump: false, crouch: false, walk: false, yaw: p.yaw, lean: 0 };
    if (now >= this.nextPerceive) {
      this.perceive(now);
      this.nextPerceive = now + 70 + Math.random() * 50;
    }
    this.selectTarget(now);
    this.manageWeapon(now);

    const goal = this.chooseGoal(now);
    let moveYaw = null;
    let spd = 1;
    const engaged = this.target && this.visibleTarget() && now >= this.reactUntil - 60;
    if (!engaged) p.ads = false;
    if (this.retreat && now > this.retreatUntil) this.retreat = null;
    if (this.use) {
      // planting / defusing / reinforcing: stand still
    } else if (engaged) {
      const mv = this.combatMove(now, dt, inp);
      moveYaw = mv.yaw; spd = mv.spd;
    } else if (this.retreat && now < this.retreatUntil) {
      moveYaw = this.navigate(now, dt, this.retreat, inp);
    } else if (this.target && this.lostAt && now - this.lostAt < 1600) {
      // just lost sight: hold the angle they left through (crosshair already on it)
      if (this.d.crouch > 0.3 && Math.random() < dt * 0.4) this.crouchUntil = now + 500;
    } else if (goal) {
      moveYaw = this.navigate(now, dt, goal, inp);
      spd = inp._spd ?? 1;
    }

    // aim / look
    if (engaged || (this.target && now < this.reactUntil && this.visibleTarget())) this.aimAtTarget(now, dt);
    else this.lookAround(now, dt, moveYaw);
    if (p.blindUntil > now) { inp.fwd = -0.4; p.yaw += Math.sin(now / 140 + this.seed) * dt * 2.5; moveYaw = null; }

    if (engaged && p.blindUntil <= now) this.tryFire(now, dt);
    else if (!this.target) {
      this.maybeThrowNade(now);
      this.maybeUtility(now);
    }

    if (now < this.crouchUntil || (engaged && this.crouchSpray && this.cstate === 'shoot')) inp.crouch = true;
    if (moveYaw != null) {
      // steer away from teammates we're about to bump into
      let sx = -Math.sin(moveYaw), sz = -Math.cos(moveYaw);
      for (const q of m.players.values()) {
        if (q === p || !q.alive || q.team !== p.team || m.enemies(p, q)) continue;
        const dx = p.x - q.x, dz = p.z - q.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.1 && d > 0.01) { sx += (dx / d) * (1.1 - d) * 1.5; sz += (dz / d) * (1.1 - d) * 1.5; }
      }
      const my = Math.atan2(-sx, -sz);
      const rel = my - p.yaw;
      inp.fwd = Math.cos(rel) * spd;
      inp.right = -Math.sin(rel) * spd;
    }
    if (now < this.backoffUntil) { inp.fwd = -inp.fwd || -1; inp.right = -inp.right; }
    inp.yaw = p.yaw;
    p.walking = inp.walk;
    p.using = this.use;
    return inp;
  }

  visibleTarget() { return this.target && this.visible.some((v) => v.q === this.target); }

  // ---------------------------------------------------------------- targets
  selectTarget(now) {
    const p = this.p;
    if (this.target) {
      if (!this.target.alive) { this.target = null; this.lostAt = 0; }
      else if (this.visibleTarget()) { this.lostAt = 0; this.lastSeenPos = { x: this.target.x, y: this.target.y, z: this.target.z, crouch: this.target.crouch }; }
      else {
        if (!this.lostAt) this.lostAt = now;
        if (now - this.lostAt > 1600) { this.target = null; this.lostAt = 0; this.shots = 0; }
      }
    }
    if (!this.visible.length || p.blindUntil > now) return;
    const best = this.visible[0];
    const cur = this.visible.find((v) => v.q === this.target);
    if (!this.target || !cur || (best.q !== this.target && best.score > cur.score * 1.8)) this.acquire(best, now);
  }

  acquire(v, now) {
    const p = this.p, q = v.q;
    const prev = this.lastTarget === q && this.lostAt && now - this.lostAt < 1600;
    const eye = eyePosition(p);
    const want = Math.atan2(-(q.x - eye[0]), -(q.z - eye[2]));
    const off = Math.abs(wrapAngle(want - p.yaw));
    let react = this.d.reaction * rand(0.8, 1.25);
    if (off < 0.3) react *= 0.75;
    else if (off > 1.1) react *= 1.35;
    if (prev) react *= 0.3;
    if (now - this.hurtAt < 800) react *= 0.85;
    this.target = q;
    this.lastTarget = q;
    this.lostAt = 0;
    this.reactUntil = now + react;
    // initial aim error grows with distance and with how far we have to flick; bias along the flick (overshoot)
    const e = this.d.err * DEG * (1 + v.dist / 35) + off * 0.05;
    const flickSign = Math.sign(wrapAngle(want - p.yaw)) || 1;
    this.errYaw = (gauss() * 0.8 + (Math.random() < 0.6 ? 0.9 : -0.5) * flickSign) * e * (prev ? 0.35 : 1);
    this.errPitch = gauss() * e * 0.6 * (prev ? 0.35 : 1);
    this.aimZone = Math.random() < this.d.head ? 'head' : 'chest';
    this.burstLeft = 0;
    this.pauseUntil = 0;
    this.cstate = 'shoot';
    this.crouchSpray = Math.random() < this.d.crouch && v.dist > 14;
  }

  // ---------------------------------------------------------------- aiming
  turnToward(yaw, pitch, dt, gain, max) {
    const p = this.p;
    const k = 1 - Math.exp(-dt * gain);
    const dy = wrapAngle(yaw - p.yaw);
    p.yaw = wrapAngle(p.yaw + clamp(dy * k, -max * dt, max * dt));
    const dp = clamp(pitch, -1.3, 1.3) - p.pitch;
    p.pitch += clamp(dp * k, -max * dt, max * dt);
  }

  targetPoint() {
    const t = this.target;
    const H = heightFor(t.crouch);
    const y = this.aimZone === 'head' ? t.y + H - 0.13 : t.y + H * 0.66;
    return { x: t.x + (t.vx || 0) * 0.04, y, z: t.z + (t.vz || 0) * 0.04 };
  }

  aimAtTarget(now, dt) {
    const p = this.p;
    const eye = eyePosition(p);
    const t = this.target;
    const tp = this.targetPoint();
    const dx = tp.x - eye[0], dy = tp.y - eye[1], dz = tp.z - eye[2];
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(dy, dist || 0.001);
    if (now < this.reactUntil) return; // haven't noticed yet: keep looking where we were
    const decay = Math.exp(-dt / this.d.settle);
    this.errYaw *= decay;
    this.errPitch *= decay;
    // moving targets are harder to track
    const tsp = Math.hypot(t.vx || 0, t.vz || 0);
    const n = this.d.noise * DEG * (0.35 + tsp / 5) * (1 + dist / 60);
    const ny = Math.sin(now / 210 + this.seed) * n, np = Math.cos(now / 290 + this.seed * 1.7) * n * 0.6;
    this.turnToward(wantYaw + this.errYaw + ny, wantPitch + this.errPitch + np, dt, this.d.turn * 1.4, this.d.maxTurn * 1.5);
    this.aimErr = Math.hypot(wrapAngle(wantYaw - p.yaw), wantPitch - p.pitch);
    this.aimDist = dist;
  }

  // Crosshair placement when not fighting.
  lookAround(now, dt, moveYaw) {
    const p = this.p, m = this.m;
    const eye = eyePosition(p);
    const e = { x: eye[0], y: eye[1], z: eye[2] };
    let pt = null;
    let gain = 7, max = 7;
    if (this.faceAt) {
      const dx = this.faceAt.x - p.x, dz = this.faceAt.z - p.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(this.faceAt.y - eye[1], Math.hypot(dx, dz) || 0.01);
      return;
    }
    if (now < this.avertUntil) {
      this.turnToward(this.avertYaw, -0.4, dt, 14, 16);
      return;
    }
    if (this.target && this.lostAt && this.lastSeenPos) {
      // hold the angle where they disappeared, at head height
      const s = this.lastSeenPos;
      pt = { x: s.x, y: s.y + heightFor(s.crouch || 0) - 0.15, z: s.z };
      gain = 12; max = 12;
    } else if (this.lookPoint && now < this.nextLook) {
      pt = this.lookPoint; gain = 12; max = 14;
    } else {
      const th = this.bestThreat(3500);
      if (th && th.d < 45) {
        // pre-aim where the enemy will appear: straight at them if there's a line of sight, otherwise the
        // farthest visible point of the route between us (the corner they'll come around), at head height
        if (!this.threatLook || now > this.threatLook.until || this.threatLook.id !== th.id) {
          let look = null;
          if (m.world.lineOfSight(e.x, e.y, e.z, th.x, th.y + HEAD_Y, th.z)) look = { x: th.x, y: th.y + HEAD_Y, z: th.z };
          else {
            const route = m.nav.findPath(m.world, { x: p.x, y: p.y + 0.1, z: p.z }, { x: th.x, y: th.y + 0.1, z: th.z }, 6000);
            look = route ? getTactics(m).lookAhead(e, route, 1, 30) : null;
          }
          this.threatLook = { id: th.id, pt: look, until: now + 400 };
        }
        if (this.threatLook.pt) { pt = this.threatLook.pt; gain = 9; max = 10; }
      }
      if (pt) {
        // (pre-aiming a threat)
      } else if (this.holdLook && (this.arrived || this.use)) {
        pt = this.holdLook;
      } else if (this.clearLooks && this.clearLooks.length) {
        // entering a site: check the spots defenders like to hold
        pt = this.pickVisible(e, this.clearLooks);
        if (pt) { gain = 10; max = 10; }
      }
      if (!pt && moveYaw != null) {
        if (!this.lookPoint || now > this.nextLook) {
          this.lookPoint = getTactics(m).lookAhead(e, this.path, this.pathIdx);
          this.nextLook = now + 300;
        }
        pt = this.lookPoint;
        if (!pt) { this.turnToward(moveYaw, 0, dt, 6, 6); return; }
      }
    }
    if (!pt) return;
    const dx = pt.x - eye[0], dz = pt.z - eye[2];
    const h = Math.hypot(dx, dz) || 0.01;
    let pitch = Math.atan2(pt.y - eye[1], h);
    // worse bots let their crosshair sag towards the floor
    pitch -= (1 - this.d.preaim) * 0.12;
    this.turnToward(Math.atan2(-dx, -dz), pitch, dt, gain, max);
  }

  pickVisible(e, pts) {
    let best = null, bd = Infinity;
    for (const q of pts) {
      const d = Math.hypot(q.x - e.x, q.z - e.z);
      if (d < 2 || d > 30 || d > bd) continue;
      if (!this.m.world.lineOfSight(e.x, e.y, e.z, q.x, q.y, q.z)) continue;
      bd = d; best = q;
    }
    return best;
  }

  // ---------------------------------------------------------------- combat
  currentWeapon() {
    const it = this.m.currentItem(this.p);
    return { it, w: it ? WEAPONS[it.id] : WEAPONS.knife };
  }

  // Movement while a target is visible. Returns { yaw, spd } in world space (yaw null = stand still).
  combatMove(now, dt, inp) {
    const p = this.p, t = this.target, m = this.m;
    const { w } = this.currentWeapon();
    const dist = Math.hypot(t.x - p.x, t.z - p.z);
    const toT = Math.atan2(-(t.x - p.x), -(t.z - p.z));
    // outnumbered and hurt, or out of ammo: fall back to cover
    if ((p.hp < 35 && this.visible.length >= 2) || this.needsCover) {
      if (!this.retreat || now > this.retreatUntil) {
        const cov = getTactics(m).coverFrom(p, this.visible.map((v) => v.q), 8);
        if (cov) { this.retreat = { x: cov.x, y: cov.y, z: cov.z }; this.retreatUntil = now + 2500; this.path = null; }
      }
      if (this.retreat) {
        const y = this.navigate(now, dt, this.retreat, inp);
        if (y != null) return { yaw: y, spd: 1 };
      }
    }
    if (w.type === 'melee') return { yaw: toT, spd: 1 };
    const speed = Math.hypot(p.vx, p.vz);
    const strafeYaw = toT + (Math.PI / 2) * this.strafeDir;
    // shotguns close the distance
    if (w.type === 'shotgun' && dist > 9) return { yaw: toT + this.strafeDir * 0.5, spd: 1 };
    // SMGs are accurate enough on the move up close
    if (w.type === 'smg' && dist < 13) {
      if (now > this.cstateUntil) { this.strafeDir = -this.strafeDir; this.cstateUntil = now + rand(250, 550); }
      return { yaw: strafeYaw, spd: 0.8 };
    }
    // everything else: counter-strafe to a stop, shoot, then jiggle sideways between bursts
    if (this.cstate === 'strafe') {
      if (now > this.cstateUntil) { this.cstate = 'shoot'; this.cstateUntil = 0; }
      else return { yaw: strafeYaw, spd: 1 };
    }
    if (speed > 1.2) {
      // press the opposite direction of our velocity to stop quickly
      return { yaw: Math.atan2(p.vx, p.vz), spd: this.d.strafe > 0.5 ? 1 : 0.5 };
    }
    return { yaw: null, spd: 0 };
  }

  tryFire(now, dt) {
    const p = this.p, m = this.m, t = this.target;
    if (now < this.reactUntil || p.reloadUntil) return;
    const { it, w } = this.currentWeapon();
    const eye = eyePosition(p);
    const dist = this.aimDist ?? Math.hypot(t.x - p.x, t.z - p.z);
    if (w.type === 'melee') {
      if (dist < 1.8 && now >= p.nextFire) {
        m.knifeAttack(p, viewDir(p.yaw, p.pitch), dist < 1.5 && Math.random() < 0.3, now);
        p.nextFire = now + 500;
      }
      return;
    }
    if (!it || (p.cur !== 'primary' && p.cur !== 'secondary')) return;
    p.ads = w.type === 'sniper' && dist > 5;
    // on target?
    const size = Math.atan2(this.aimZone === 'head' ? 0.15 : 0.28, Math.max(dist, 0.5));
    const tol = w.type === 'sniper' ? size * 1.1 : size * 2 + 0.008;
    if ((this.aimErr ?? 1) > tol) return;
    // accurate weapons need us (nearly) stopped
    const speed = Math.hypot(p.vx, p.vz);
    const maxSp = PLAYER.runSpeed * w.speed;
    const accurate = w.type === 'rifle' || w.type === 'pistol' || w.type === 'sniper';
    if (accurate && dist > 4 && speed > maxSp * 0.36) return;
    if (w.type === 'sniper' && (speed > 0.8 || this.aimErr > size * 0.9)) return;
    if (now < this.pauseUntil || now < p.nextFire) return;
    // semi-auto tapping rhythm
    const tapGap = Math.max(w.interval * 1000, (this.d.tapGap * (0.6 + dist / 40)));
    if (!w.auto && now - this.lastShot < tapGap) return;
    // don't shoot through a teammate
    for (const q of m.players.values()) {
      if (q === p || !q.alive || q.team !== p.team || m.enemies(p, q)) continue;
      const qd = Math.hypot(q.x - eye[0], q.z - eye[2]);
      if (qd > dist) continue;
      const f = viewDir(p.yaw, 0);
      const along = (q.x - eye[0]) * f[0] + (q.z - eye[2]) * f[2];
      const side = Math.abs((q.x - eye[0]) * f[2] - (q.z - eye[2]) * f[0]);
      if (along > 0 && side < 0.6) { this.cstate = 'strafe'; this.cstateUntil = now + 300; return; }
    }
    if (this.burstLeft <= 0) {
      const b = dist < 8 ? 30 : dist < 16 ? rand(5, 9) : dist < 28 ? rand(3, 5) : rand(1, 3);
      this.burstLeft = Math.max(1, Math.round(b * this.d.burst));
    }
    this.shoot(now, w, it);
    this.burstLeft--;
    if (this.burstLeft <= 0 && w.auto) {
      this.pauseUntil = now + (dist < 16 ? rand(120, 260) : rand(260, 460));
      this.shots = 0;
      if (Math.random() < this.d.strafe && dist > 6) {
        this.cstate = 'strafe';
        this.strafeDir = Math.random() < 0.65 ? -this.strafeDir : this.strafeDir;
        this.cstateUntil = now + rand(180, 380);
      }
    } else if (!w.auto && Math.random() < this.d.strafe * 0.5 && dist > 8) {
      this.cstate = 'strafe';
      this.strafeDir = -this.strafeDir;
      this.cstateUntil = now + rand(150, 300);
    }
  }

  shoot(now, w, it) {
    const m = this.m, p = this.p;
    if (now - this.lastShot > Math.max(350, w.interval * 1000 * 2.5)) this.shots = 0;
    const rec = recoilOffset(w, this.shots);
    const comp = 1 - this.d.spray;
    const yaw = p.yaw - rec[0] * DEG * comp;
    const pitch = p.pitch + rec[1] * DEG * comp;
    const base = viewDir(yaw, pitch);
    const speed = Math.hypot(p.vx, p.vz);
    const spread = computeSpread(w, { speed, onGround: p.onGround, crouch: p.crouch, ads: p.ads ? 1 : 0, scoped: p.ads, bloom: Math.min(w.spread.bloomMax, this.shots * w.spread.bloom) });
    const dirs = [];
    for (let i = 0; i < w.pellets; i++) dirs.push(applySpread(base, spread, Math.random));
    if (m.fire(p, eyePosition(p), dirs, now, true)) {
      this.shots++;
      this.lastShot = now;
    }
  }

  manageWeapon(now) {
    const p = this.p, m = this.m;
    this.needsCover = false;
    if (p.cur === 'bomb') m.onSwitch(p, p.inv.primary ? 'primary' : p.inv.secondary ? 'secondary' : 'knife');
    if (GRENADES.includes(p.cur) && !this.throwing) m.onSwitch(p, p.inv.primary ? 'primary' : p.inv.secondary ? 'secondary' : 'knife');
    const it = m.currentItem(p);
    if (p.cur === 'knife' && (p.inv.primary || p.inv.secondary) && m.mode !== 'gungame') {
      const alt = p.inv.primary?.mag + p.inv.primary?.reserve > 0 ? 'primary' : p.inv.secondary ? 'secondary' : null;
      if (alt) m.onSwitch(p, alt);
    }
    if (!it || (p.cur !== 'primary' && p.cur !== 'secondary')) return;
    const w = WEAPONS[it.id];
    if (p.reloadUntil) {
      if (this.visible.length) this.needsCover = true;
      return;
    }
    const fighting = this.target && this.visibleTarget();
    if (it.mag === 0) {
      // switching to the pistol is faster than reloading mid-fight
      if (fighting && p.cur === 'primary' && p.inv.secondary?.mag > 0) m.onSwitch(p, 'secondary');
      else if (it.reserve > 0) { m.onReload(p); if (fighting) this.needsCover = true; }
      else if (p.cur === 'primary' && p.inv.secondary?.mag > 0) m.onSwitch(p, 'secondary');
      else m.onSwitch(p, 'knife');
    } else if (!fighting && !this.lostAt && it.mag < w.mag * 0.45 && it.reserve > 0 && now - this.lastShot > 1200) {
      m.onReload(p);
    } else if (!fighting && p.cur === 'secondary' && p.inv.primary && (p.inv.primary.mag > 0 || p.inv.primary.reserve > 0)) {
      m.onSwitch(p, 'primary');
    }
  }

  // ---------------------------------------------------------------- objectives
  chooseGoal(now) {
    const m = this.m, p = this.p;
    this.use = false;
    this.faceAt = null;
    this.clearLooks = null;
    this.walkNear = false;
    if (m.mode === 'defuse') {
      if (m.phase === 'freeze' || m.phase === 'post' || m.phase === 'ended' || m.phase === 'halftime') return null;
      return p.team === TEAM.ATT ? this.attackerGoal(now) : this.defenderGoal(now);
    }
    return this.huntGoal(now);
  }

  attackerGoal(now) {
    const m = this.m, p = this.p, pl = this.plan(), T = getTactics(m);
    const bomb = m.bomb;
    if (bomb && bomb.state === 'dropped') {
      let closest = null, cd = Infinity;
      for (const q of m.alive(TEAM.ATT)) { if (!q.bot) continue; const d = Math.hypot(q.x - bomb.x, q.z - bomb.z); if (d < cd) { cd = d; closest = q; } }
      if (closest === p) return this.setGoal('bomb', { x: bomb.x, y: bomb.y, z: bomb.z });
    }
    if (bomb && bomb.state === 'planted') {
      // post-plant: watch the bomb from cover
      pl.post ||= T.postPlantSpots(bomb, 6);
      let spot = pl.postClaims.get(p.id);
      if (!spot) {
        spot = pl.post.find((s) => ![...pl.postClaims.values()].includes(s)) || pl.post[0];
        if (spot) pl.postClaims.set(p.id, spot);
      }
      if (spot) {
        this.holdLook = { x: bomb.x, y: bomb.y + 0.9, z: bomb.z };
        this.walkNear = true;
        return this.setGoal('post', spot);
      }
      return this.setGoal('guard', { x: bomb.x, y: bomb.y, z: bomb.z });
    }
    const S = T.site(pl.site);
    if (!S) return null;
    // choose the route: the entrance whose staging point is closest to our spawn
    if (!pl.entrance) {
      const sp = m.map.spawns[TEAM.ATT][0] || [0, 0, 0];
      const ents = S.entrances.slice().sort((a, b) => (b.hidden ? 1 : 0) - (a.hidden ? 1 : 0) || Math.hypot(a.stage.x - sp[0], a.stage.z - sp[2]) - Math.hypot(b.stage.x - sp[0], b.stage.z - sp[2]));
      pl.entrance = ents.length > 1 && Math.random() < 0.3 ? ents[1] : ents[0] || { ...S.center, stage: S.center };
    }
    const liveFor = now - (m.liveAt || now);
    const timeLeft = m.phaseEnd - now;
    if (!pl.executing) {
      const near = (q) => Math.hypot(q.x - pl.entrance.stage.x, q.z - pl.entrance.stage.z) < 7;
      const atStage = m.alive(TEAM.ATT).filter(near).length;
      const alive = m.alive(TEAM.ATT).length;
      const carrier = m.alive(TEAM.ATT).find((q) => q.inv.bomb);
      const carrierReady = !carrier || !carrier.bot || near(carrier);
      if ((atStage >= Math.max(1, Math.ceil(alive * 0.7)) && carrierReady) || liveFor > 45000 || timeLeft < 45000) {
        pl.executing = true;
        pl.executeAt = now;
        this.callout(`Go go go, hitting ${pl.site}!`);
      }
    }
    if (!pl.executing) {
      // spread out around the staging point and watch the entrance
      let spot = pl.stageClaims.get(p.id);
      if (!spot) {
        const k = pl.stageClaims.size;
        const a = k * 2.1;
        const n = m.nav.nearest(pl.entrance.stage.x + Math.cos(a) * (k ? 1.6 : 0), pl.entrance.stage.y + 0.2, pl.entrance.stage.z + Math.sin(a) * (k ? 1.6 : 0));
        spot = n ? { x: n.x, y: n.y, z: n.z } : pl.entrance.stage;
        pl.stageClaims.set(p.id, spot);
      }
      this.holdLook = { x: pl.entrance.x, y: pl.entrance.y + HEAD_Y, z: pl.entrance.z };
      return this.setGoal('stage' + pl.site, spot);
    }
    // executing
    this.clearLooks = S.holds.map((h) => ({ x: h.x, y: h.y + HEAD_Y, z: h.z }));
    if (now - pl.executeAt < 9000 && !inZone(S.zone, p.x, p.y, p.z)) {
      const myD = Math.hypot(S.center.x - p.x, S.center.z - p.z);
      const others = m.alive(TEAM.ATT).filter((q) => q !== p).map((q) => Math.hypot(S.center.x - q.x, S.center.z - q.z)).sort((a, b) => a - b);
      if (others.length && myD < others[0] - 6) {
        // too far ahead of the pack: hold here and watch the site for a moment
        this.holdLook = this.clearLooks.length ? this.clearLooks[0] : null;
        this.arrived = true;
        return null;
      }
    }
    if (p.inv.bomb) {
      if (inZone(S.zone, p.x, p.y, p.z) && !this.visible.length && p.onGround) {
        const d = Math.hypot(S.center.x - p.x, S.center.z - p.z);
        if (d < 5 || this.arrived) { this.use = true; return null; }
      }
      const spot = this.spotIn('plant' + pl.site, S.inside.length ? S.inside : null, S.center, true);
      return this.setGoal('plant' + pl.site, spot);
    }
    // clear the site: walk to the spots defenders hold
    let spot = pl.holdClaims.get(p.id);
    if (!spot) {
      const taken = new Set(pl.holdClaims.values());
      spot = S.holds.find((h) => !taken.has(h)) || S.holds[0] || S.center;
      pl.holdClaims.set(p.id, spot);
    }
    this.holdLook = spot.looks?.[0] || null;
    return this.setGoal('clear' + pl.site, spot);
  }

  defenderGoal(now) {
    const m = this.m, p = this.p, pl = this.plan(), T = getTactics(m);
    const bomb = m.bomb;
    if (bomb && bomb.state === 'planted') {
      const d = Math.hypot(bomb.x - p.x, bomb.z - p.z);
      const site = bomb.site || this.nearestSite(bomb.x, bomb.z, 40) || 'A';
      const S = T.site(site);
      pl.post ||= T.postPlantSpots(bomb, 6);
      const left = bomb.explodeAt - now;
      const defTime = (p.kit ? m.settings.kitDefuseTime : m.settings.defuseTime) * 1000;
      if (d < 1.4 && !this.visible.length) { this.use = true; this.faceAt = { x: bomb.x, y: bomb.y, z: bomb.z }; return null; }
      // regroup outside the site before retaking unless time is short
      if (S && !pl.retaking) {
        const ents = S.entrances.slice().sort((a, b) => Math.hypot(a.stage.x - p.x, a.stage.z - p.z) - Math.hypot(b.stage.x - p.x, b.stage.z - p.z));
        const e = ents[0];
        const alive = m.alive(TEAM.DEF);
        const grouped = e ? alive.filter((q) => Math.hypot(q.x - e.stage.x, q.z - e.stage.z) < 7).length : 0;
        if (!e || grouped >= Math.min(2, alive.length) || left < defTime + 9000 || alive.length === 1) pl.retaking = true;
        else {
          this.holdLook = { x: e.x, y: e.y + HEAD_Y, z: e.z };
          return this.setGoal('regroup', e.stage);
        }
      }
      this.clearLooks = pl.post.map((s) => ({ x: s.x, y: s.y + HEAD_Y, z: s.z }));
      return this.setGoal('defuse', { x: bomb.x, y: bomb.y, z: bomb.z });
    }
    // site assignment: split across both sites, the last one floats and rotates
    if (!pl.defSites.has(p.id)) {
      const n = pl.defSites.size;
      pl.defSites.set(p.id, ['A', 'B', 'A', 'B', 'R'][n % 5]);
    }
    let site = pl.defSites.get(p.id);
    if (site === 'R') site = pl.alertSite && now - pl.alertAt < 30000 ? pl.alertSite : (p.id % 2 ? 'A' : 'B');
    if (pl.alertSite && now - pl.alertAt < 20000 && site !== pl.alertSite) {
      // rotate if the other site is getting hit (keep at least one anchor)
      const mine = [...pl.defSites.entries()].filter(([id, s]) => s === site && this.m.players.get(id)?.alive);
      if (mine.length > 1 && mine[mine.length - 1][0] === p.id) {
        if (this.goalKey !== 'hold' + pl.alertSite) this.callout(`Rotating to ${pl.alertSite}`);
        site = pl.alertSite;
      }
    }
    const job = this.reinforceGoal(now, site);
    if (job !== undefined) return job;
    const S = T.site(site);
    if (!S) return null;
    const key = 'hold' + site;
    if (!this.holdSpot || this.holdSpot.site !== site) {
      const claims = pl.holdClaims;
      claims.delete(p.id);
      const taken = new Set(claims.values());
      const spot = S.holds.find((h) => !taken.has(h)) || S.holds[Math.floor(Math.random() * S.holds.length)] || { ...S.center, looks: [] };
      claims.set(p.id, spot);
      this.holdSpot = { ...spot, site, spot };
    }
    const hs = this.holdSpot;
    if (this.arrived && now > this.nextGlance) {
      const looks = hs.looks || [];
      this.holdLook = looks.length ? (Math.random() < 0.7 ? looks[0] : pick(looks)) : this.holdLook;
      this.nextGlance = now + rand(2500, 5000);
      if (Math.random() < this.d.crouch * 0.5) this.crouchUntil = now + rand(1500, 4000);
    } else if (!this.holdLook && hs.looks?.length) this.holdLook = hs.looks[0];
    this.walkNear = true;
    return this.setGoal(key, hs);
  }

  // Deathmatch: go where the enemies are; otherwise patrol busy areas.
  huntGoal(now) {
    const m = this.m, p = this.p;
    const th = this.bestThreat(7000);
    if (th) return this.setGoal('hunt' + th.id, { x: th.x, y: th.y, z: th.z }, 1200);
    if (!this.patrol || (this.arrived && this.goalKey === 'patrol')) {
      const hot = hotspots(m);
      const n = hot.length ? pick(hot) : m.nav.randomNode();
      this.patrol = { x: n.x, y: n.y, z: n.z };
      this.goalKey = null;
      this.arrived = false;
    }
    return this.setGoal('patrol', this.patrol);
  }

  spotIn(key, nodes, center, nearCenter = false) {
    if (this.goalKey === key && this.goal) return this.goal;
    if (!nodes || !nodes.length) return center;
    let n = pick(nodes);
    if (nearCenter) {
      const sorted = nodes.slice().sort((a, b) => Math.hypot(a.x - center.x, a.z - center.z) - Math.hypot(b.x - center.x, b.z - center.z));
      n = sorted[Math.floor(Math.random() * Math.min(5, sorted.length))];
    }
    return { x: n.x, y: n.y, z: n.z };
  }

  setGoal(key, pos, refresh = 0) {
    if (!pos) return null;
    if (this.goalKey !== key || (refresh && this.m.now > this.repathAt)) {
      if (this.goalKey !== key) this.arrived = false;
      this.goalKey = key;
      this.path = null;
    }
    this.goal = pos;
    return pos;
  }

  // ---------------------------------------------------------------- navigation
  navigate(now, dt, goal, inp) {
    const m = this.m, p = this.p;
    if (!this.path || now > this.repathAt) {
      this.path = m.nav.findPath(m.world, { x: p.x, y: p.y + 0.1, z: p.z }, goal);
      this.pathIdx = 0;
      this.repathAt = now + 2500 + Math.random() * 1500;
      if (!this.path) {
        this.repathAt = now + 700;
        if (this.goalKey === 'patrol') this.patrol = null;
        return null;
      }
    }
    const path = this.path;
    while (this.pathIdx < path.length) {
      const wp = path[this.pathIdx];
      const d = Math.hypot(wp.x - p.x, wp.z - p.z);
      if (d < 0.5 || (this.pathIdx < path.length - 1 && d < 1.1 && Math.abs(wp.y - p.y) < 0.6)) this.pathIdx++;
      else break;
    }
    const goalDist = Math.hypot(goal.x - p.x, goal.z - p.z);
    if (this.pathIdx >= path.length || (goalDist < 0.6 && Math.abs(goal.y - p.y) < 0.8)) {
      this.arrived = true;
      return null;
    }
    const wp = path[this.pathIdx];
    // steer towards a point a little ahead on the path (smooth corners), unless we must jump/climb
    let tx = wp.x, tz = wp.z;
    if (wp.type === 'walk' && this.pathIdx < path.length - 1) {
      const nx = path[this.pathIdx + 1];
      const d = Math.hypot(wp.x - p.x, wp.z - p.z);
      if (d < 1.6 && nx.type === 'walk' && Math.abs(nx.y - wp.y) < 0.3) {
        const k = 1 - d / 1.6;
        tx = wp.x + (nx.x - wp.x) * k * 0.5;
        tz = wp.z + (nx.z - wp.z) * k * 0.5;
      }
    }
    // stuck detection
    if (!this.lastPos || now - this.lastProgressCheck > 600) {
      if (this.lastPos) {
        const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
        if (moved < 0.3) this.stuckT += now - this.lastProgressCheck; else this.stuckT = 0;
      }
      this.lastPos = { x: p.x, z: p.z };
      this.lastProgressCheck = now;
    }
    if (this.stuckT > 600 && p.onGround) inp.jump = true;
    if (this.stuckT > 1500) {
      this.path = null;
      this.stuckT = 0;
      this.backoffUntil = now + 350;
      this.strafeDir = -this.strafeDir;
    }
    if (wp.type === 'jump' && Math.hypot(wp.x - p.x, wp.z - p.z) < 1.5 && p.onGround) inp.jump = true;
    if (!p.onGround && p.vy > 0) inp.crouch = true;
    inp._spd = 1;
    // walk quietly near the end of the route (holding, post-plant) or when enemies are known close by
    const th = this.bestThreat(4000);
    const executing = this.m.mode === 'defuse' && p.team === TEAM.ATT && this.plan().executing;
    if ((this.walkNear && goalDist < 7) || (th && th.d < 11 && this.m.mode === 'defuse' && !executing)) inp.walk = true;
    return Math.atan2(-(tx - p.x), -(tz - p.z));
  }

  // ---------------------------------------------------------------- utility
  // Defenders spend the first part of the round plating walls near their site.
  // Returns a goal, null (working in place) or undefined (nothing to do).
  reinforceGoal(now, site) {
    const m = this.m, p = this.p;
    if (m.phase !== 'live' || !(p.reinforceLeft > 0) || now - (m.liveAt || 0) > 30000 || this.visible.length || this.target) return undefined;
    let job = this.reinforceJob;
    if (job) {
      const b = m.world.byId.get(job.id);
      if (!b.active || b.reinforced) { m.botPlan.claimed.delete(job.group); job = this.reinforceJob = null; }
    }
    if (!job) {
      if (this.noJobUntil > now) return undefined;
      job = this.reinforceJob = this.findReinforceJob(site);
      if (!job) { this.noJobUntil = now + 5000; return undefined; }
      m.botPlan.claimed.add(job.group);
    }
    if (Math.hypot(job.spot.x - p.x, job.spot.z - p.z) < 0.55 && p.onGround) {
      this.faceAt = job.face;
      this.use = true;
      return null;
    }
    return this.setGoal('reinforce' + job.id, job.spot);
  }

  findReinforceJob(site) {
    const m = this.m, p = this.p;
    const zone = m.map.zones[site];
    if (!zone) return null;
    const zc = [(zone.min[0] + zone.max[0]) / 2, (zone.min[2] + zone.max[2]) / 2];
    const floor = zone.floor || 0;
    let best = null, bestD = Infinity;
    for (const id of m.map.destructibles) {
      const b = m.world.byId.get(id);
      // face the middle row of each section so the look ray lands on it
      if (!b.active || b.reinforced || b.min[1] < floor + 0.9 || b.min[1] > floor + 1.1 || m.botPlan.claimed.has(b.group)) continue;
      const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      if (Math.hypot(c[0] - zc[0], c[2] - zc[1]) > 16) continue;
      const thinX = b.max[0] - b.min[0] < b.max[2] - b.min[2];
      for (const s of [1, -1]) {
        const x = c[0] + (thinX ? s * 1.05 : 0), z = c[2] + (thinX ? 0 : s * 1.05);
        const n = m.nav.nearest(x, floor + 0.2, z);
        if (!n || Math.hypot(n.x - x, n.z - z) > 0.55 || Math.abs(n.y - floor) > 0.3) continue;
        const d = Math.hypot(n.x - p.x, n.z - p.z);
        if (d < bestD) { bestD = d; best = { id, group: b.group, spot: { x: n.x, y: n.y, z: n.z }, face: { x: c[0], y: floor + 1.45, z: c[2] } }; }
      }
    }
    return best;
  }

  throwAt(type, target, speed, arc = 0.08) {
    const m = this.m, p = this.p;
    const d = Math.hypot(target.x - p.x, target.z - p.z);
    const g = 15;
    const s = clamp((g * d) / (speed * speed), 0, 1);
    const ang = 0.5 * Math.asin(s) + arc;
    const yaw = Math.atan2(-(target.x - p.x), -(target.z - p.z));
    const prev = p.cur;
    p.cur = type;
    p.deployUntil = 0;
    this.throwing = true;
    m.onThrow(p, { o: eyePosition(p), v: viewDir(yaw, ang).map((x) => x * speed) });
    this.throwing = false;
    if (p.cur === type) p.cur = prev;
    return yaw;
  }

  maybeThrowNade(now) {
    const m = this.m, p = this.p;
    if (now < this.nadeCooldown || m.phase === 'freeze') return;
    const hasFrag = p.inv.nades.frag > 0, hasFlash = p.inv.nades.flash > 0;
    if (!hasFrag && !hasFlash) return;
    const th = this.bestThreat(4000);
    if (!th || th.age < 500) return;
    if (th.d < 6 || th.d > 24) return;
    this.nadeCooldown = now + 7000;
    if (Math.random() > this.d.nade) return;
    if (hasFlash && (!hasFrag || Math.random() < 0.45) && th.d < 20) {
      // pop flash over the corner, then turn away until it goes off
      const yaw = this.throwAt('flash', th, 13, 0.25);
      this.avertYaw = yaw + Math.PI;
      this.avertUntil = now + 1700;
      return;
    }
    if (hasFrag) this.throwAt('frag', th, 15);
  }

  maybeUtility(now) {
    const m = this.m, p = this.p;
    if (m.mode !== 'defuse' || m.phase !== 'live') return;
    const pl = this.plan();
    const T = getTactics(m);
    if (p.team === TEAM.ATT && pl.executing && !this.utilityDone && now - pl.executeAt < 4000) {
      const S = T.site(pl.site);
      if (!S) return;
      const eye = eyePosition(p);
      const e = { x: eye[0], y: eye[1], z: eye[2] };
      // smoke off the best defender position we can see, then flash into the site
      if (p.inv.nades.smoke > 0 && !pl.smoked.has(pl.site)) {
        const tgt = S.holds.find((h) => { const d = Math.hypot(h.x - p.x, h.z - p.z); return d > 6 && d < 28 && m.world.lineOfSight(e.x, e.y, e.z, h.x, h.y + 1.2, h.z); });
        if (tgt) { pl.smoked.add(pl.site); this.throwAt('smoke', tgt, 14); this.utilityDone = true; return; }
      }
      if (p.inv.nades.flash > 0) {
        const d = Math.hypot(S.center.x - p.x, S.center.z - p.z);
        if (d > 5 && d < 24) {
          const yaw = this.throwAt('flash', S.center, 12, 0.3);
          this.avertYaw = yaw + Math.PI;
          this.avertUntil = now + 1600;
          this.utilityDone = true;
          return;
        }
      }
    }
    // breach charge on a wall next to the site
    if (p.team === TEAM.ATT && !this.breachDone && p.inv.nades.breach > 0) {
      const zone = m.map.zones[pl.site];
      if (!zone) return;
      const zc = { x: (zone.min[0] + zone.max[0]) / 2, z: (zone.min[2] + zone.max[2]) / 2 };
      if (Math.hypot(zc.x - p.x, zc.z - p.z) > 18) return;
      const eye = eyePosition(p);
      for (const id of m.map.destructibles) {
        const b = m.world.byId.get(id);
        const fl = zone.floor || 0;
        if (!b.active || b.min[1] < fl + 0.9 || b.min[1] > fl + 1.1) continue;
        const c = { x: (b.min[0] + b.max[0]) / 2, y: (b.min[1] + b.max[1]) / 2, z: (b.min[2] + b.max[2]) / 2 };
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < 3 || d > 6 || Math.hypot(c.x - zc.x, c.z - zc.z) > 14) continue;
        const h = m.world.raycast(eye[0], eye[1], eye[2], (c.x - eye[0]) / d, (c.y - eye[1]) / d, (c.z - eye[2]) / d, d + 0.5);
        if (!h || h.box !== b) continue;
        this.breachDone = true;
        const yaw = Math.atan2(-(c.x - p.x), -(c.z - p.z));
        const pitch = Math.atan2(c.y - eye[1], d);
        const prev = p.cur;
        p.cur = 'breach';
        p.deployUntil = 0;
        this.throwing = true;
        m.onThrow(p, { o: eye, v: viewDir(yaw, pitch + 0.05).map((x) => x * 11) });
        this.throwing = false;
        if (p.cur === 'breach') p.cur = prev;
        this.path = null;
        break;
      }
    }
    // defenders: flash an entrance the attackers are coming through
    if (p.team === TEAM.DEF && p.inv.nades.flash > 0 && now > this.nadeCooldown) {
      const th = this.bestThreat(2500);
      if (th && th.d > 7 && th.d < 20 && Math.random() < this.d.nade * 0.5) {
        this.nadeCooldown = now + 9000;
        const yaw = this.throwAt('flash', th, 12, 0.3);
        this.avertYaw = yaw + Math.PI;
        this.avertUntil = now + 1600;
      }
    }
  }

  // ---------------------------------------------------------------- buying
  buy() {
    const m = this.m, p = this.p;
    if (!m.modeInfo.economy) return;
    const half = Math.floor(m.settings.maxRounds / 2);
    const pistolRound = m.round === 1 || m.round === half + 1;
    const lastOfHalf = m.round === half || m.round === m.settings.maxRounds;
    const winAt = half + 1;
    const matchPoint = m.score[1] === winAt - 1 || m.score[2] === winAt - 1;
    const team = m.teamPlayers(p.team);
    const teamAvg = team.reduce((s, q) => s + (q.money || 0), 0) / Math.max(1, team.length);
    const money = () => p.money;
    const att = p.team === TEAM.ATT;
    if (pistolRound) {
      if (Math.random() < 0.55) m.onBuy(p, 'kevlar');
      else if (Math.random() < 0.4) m.onBuy(p, att ? 'p2k' : 'p9');
      if (money() >= 200) m.onBuy(p, 'flash');
      if (money() >= 300 && Math.random() < 0.5) m.onBuy(p, 'smoke');
    } else {
      const force = lastOfHalf || matchPoint;
      const eco = !force && teamAvg < 2400 && money() < 3700;
      if (eco) {
        if (money() > 1400 && Math.random() < 0.35) m.onBuy(p, 'deagle');
      } else {
        if (!p.inv.primary) {
          const awper = team.some((q) => q !== p && q.inv?.primary?.id === 'awp');
          if (money() >= 5750 && !awper && Math.random() < 0.3) m.onBuy(p, 'awp');
          else if (money() >= 3700) m.onBuy(p, att ? (Math.random() < 0.75 ? 'ar' : 'm4') : (Math.random() < 0.75 ? 'm4' : 'ar'));
          else if (money() >= 2650) m.onBuy(p, 'marauder');
          else if (money() >= 2400 && Math.random() < 0.3) m.onBuy(p, 'scout');
          else if (money() >= 1700) m.onBuy(p, pick(['smg', 'smg', 'rattler', 'shotgun']));
        }
        if (money() >= 1000 && !(p.armor >= 100 && p.helmet)) m.onBuy(p, 'helmet');
        else if (money() >= 650 && p.armor < 100) m.onBuy(p, 'kevlar');
        if (!att && money() >= 400 && Math.random() < 0.7) m.onBuy(p, 'kit');
        if (money() >= 300 && Math.random() < 0.7) m.onBuy(p, 'smoke');
        if (money() >= 200 && Math.random() < 0.7) m.onBuy(p, 'flash');
        if (money() >= 300 && Math.random() < 0.5) m.onBuy(p, 'frag');
        if (att && money() >= 400 && Math.random() < 0.35) m.onBuy(p, 'breach');
      }
    }
    if (p.inv.primary) m.onSwitch(p, 'primary');
    else if (p.inv.secondary) m.onSwitch(p, 'secondary');
  }
}

// Well-connected open nodes spread over the map: where deathmatch fights happen.
const hotCache = new WeakMap();
function hotspots(m) {
  if (hotCache.has(m.nav)) return hotCache.get(m.nav);
  const pool = (m.nav.reachable || m.nav.nodes).filter((n) => n.edges.length >= 8);
  const out = [];
  for (let k = 0; k < pool.length && out.length < 40; k += Math.max(1, Math.floor(pool.length / 120))) {
    const n = pool[k];
    if (out.some((q) => Math.hypot(q.x - n.x, q.z - n.z) < 8)) continue;
    out.push(n);
  }
  hotCache.set(m.nav, out);
  return out;
}
