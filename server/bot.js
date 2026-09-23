// Bot AI. Produces the same movement input a human client would, and fires through the match.

import { TEAM, DEG, clamp, viewDir, wrapAngle } from '../shared/constants.js';
import { WEAPONS, GRENADES, computeSpread, applySpread, recoilOffset } from '../shared/weapons.js';
import { eyePosition, heightFor } from '../shared/physics.js';
import { inZone } from '../shared/maps/builder.js';

const DIFF = {
  easy:   { reaction: 700, turn: 5,  err: 3.4, head: 0.1,  spray: 0.3,  fov: 100, hearing: 22, burst: [2, 4], nade: 0.1 },
  normal: { reaction: 420, turn: 9,  err: 1.9, head: 0.3,  spray: 0.6,  fov: 115, hearing: 32, burst: [3, 6], nade: 0.25 },
  hard:   { reaction: 240, turn: 15, err: 0.9, head: 0.55, spray: 0.85, fov: 130, hearing: 45, burst: [4, 8], nade: 0.4 },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class BotBrain {
  constructor(match, p, difficulty = 'normal') {
    this.m = match;
    this.p = p;
    this.d = DIFF[difficulty] || DIFF.normal;
    this.reset();
  }

  reset() {
    this.target = null;
    this.reactionUntil = 0;
    this.lastSeen = 0;
    this.lastKnown = null;
    this.visible = [];
    this.nextPerceive = 0;
    this.path = null;
    this.pathIdx = 0;
    this.goal = null;
    this.goalKey = null;
    this.repathAt = 0;
    this.arrived = false;
    this.stuckT = 0;
    this.lastPos = null;
    this.lastProgressCheck = 0;
    this.errYaw = 0;
    this.errPitch = 0;
    this.shots = 0;
    this.lastShot = 0;
    this.burstLeft = 0;
    this.burstPauseUntil = 0;
    this.strafeDir = 1;
    this.strafeUntil = 0;
    this.heard = null;
    this.lookAt = null;
    this.use = false;
    this.spot = null;
    this.spotKey = null;
    this.holdLook = null;
    this.nextGlance = 0;
    this.nadeCooldown = 0;
    this.crouchUntil = 0;
    this.aimZone = 'chest';
    this.jumpQueued = false;
    this.faceAt = null;
    this.avertUntil = 0;
    this.reinforceJob = null;
    this.breachDone = false;
    this.smokeDone = false;
  }

  onSpawn() { this.reset(); }
  onRoundStart() {
    this.reset();
    this.buy();
    this.nadeCooldown = this.m.now + rand(4000, 12000);
  }
  dead() {}
  onBombPlanted() { this.spot = null; this.path = null; this.goalKey = null; }
  onFlashed() { this.target = null; }

  onKill(attacker, target) {
    if (this.target === target) { this.target = null; this.shots = 0; }
    if (target === this.p) this.reset();
  }

  hearShot(shooter, o) {
    if (!this.p.alive || !this.m.enemies(this.p, shooter)) return;
    const d = Math.hypot(o[0] - this.p.x, o[2] - this.p.z);
    if (d < this.d.hearing) this.heard = { x: shooter.x, y: shooter.y, z: shooter.z, t: this.m.now };
  }

  onDamaged(attacker, from) {
    if (attacker && this.m.enemies(this.p, attacker)) {
      this.heard = { x: attacker.x, y: attacker.y, z: attacker.z, t: this.m.now };
      if (!this.target) this.lookAt = { x: from[0], y: from[1], z: from[2], t: this.m.now };
    }
  }

  // ---------------------------------------------------------------- buying
  buy() {
    const m = this.m, p = this.p;
    if (!m.modeInfo.economy) return;
    const half = Math.floor(m.settings.maxRounds / 2);
    const pistolRound = m.round === 1 || m.round === half + 1;
    const money = () => p.money;
    if (!p.inv.primary && !pistolRound) {
      if (money() >= 5900 && Math.random() < 0.22) m.onBuy(p, 'awp');
      else if (money() >= 3700) m.onBuy(p, Math.random() < 0.5 ? 'ar' : 'm4');
      else if (money() >= 2700) m.onBuy(p, 'marauder');
      else if (money() >= 1900 && Math.random() < 0.65) m.onBuy(p, pick(['smg', 'rattler', 'shotgun']));
      else if (money() >= 2400 && Math.random() < 0.3) m.onBuy(p, 'scout');
    }
    if (money() >= 1000 && !(p.armor >= 100 && p.helmet)) m.onBuy(p, 'helmet');
    else if (money() >= 650 && p.armor < 100 && (!pistolRound || Math.random() < 0.5)) m.onBuy(p, 'kevlar');
    if (pistolRound && money() >= 700 && Math.random() < 0.35) m.onBuy(p, 'deagle');
    if (p.team === TEAM.DEF && money() >= 400 && Math.random() < 0.6) m.onBuy(p, 'kit');
    if (money() >= 300 && Math.random() < 0.5) m.onBuy(p, 'frag');
    if (money() >= 300 && Math.random() < 0.35) m.onBuy(p, 'smoke');
    if (money() >= 200 && Math.random() < 0.4) m.onBuy(p, 'flash');
    if (p.team === TEAM.ATT && m.mode === 'defuse' && money() >= 400 && Math.random() < 0.3) m.onBuy(p, 'breach');
    if (p.inv.primary) m.onSwitch(p, 'primary');
    else if (p.inv.secondary) m.onSwitch(p, 'secondary');
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
      const pts = [[q.x, q.y + H - 0.15, q.z], [q.x, q.y + H * 0.65, q.z]];
      const dx = q.x - eye[0], dz = q.z - eye[2];
      const dist = Math.hypot(dx, dz);
      if (dist > 95) continue;
      const inFov = dist < 2.5 || (dx * f[0] + dz * f[2]) / (dist || 1) > cosFov;
      if (!inFov) continue;
      let seen = false;
      for (const pt of pts) {
        if (m.world.lineOfSight(eye[0], eye[1], eye[2], pt[0], pt[1], pt[2]) && !m.smokeBlocks(eye, pt)) { seen = true; break; }
      }
      if (seen) this.visible.push({ q, dist });
    }
    // hear running footsteps nearby
    if (!this.visible.length) {
      for (const q of m.players.values()) {
        if (!q.alive || !m.enemies(p, q) || !m.inMatch(q)) continue;
        const sp = Math.hypot(q.vx || 0, q.vz || 0);
        if (sp > 3.2 && !q.walking && q.onGround && Math.hypot(q.x - p.x, q.z - p.z) < 14) {
          this.heard = { x: q.x, y: q.y, z: q.z, t: now };
        }
      }
    }
    if (this.visible.length && p.team === TEAM.DEF && m.mode === 'defuse') {
      const q = this.visible[0].q;
      m.botPlan.alertSite = this.nearestSite(q.x, q.z);
      m.botPlan.alertAt = now;
    }
  }

  nearestSite(x, z) {
    const zs = this.m.map.zones;
    if (!zs.A || !zs.B) return null;
    const c = (zn) => [(zn.min[0] + zn.max[0]) / 2, (zn.min[2] + zn.max[2]) / 2];
    const a = c(zs.A), b = c(zs.B);
    return Math.hypot(x - a[0], z - a[1]) < Math.hypot(x - b[0], z - b[1]) ? 'A' : 'B';
  }

  // ---------------------------------------------------------------- main update
  update(dt, now) {
    const p = this.p, m = this.m;
    const inp = { fwd: 0, right: 0, jump: false, crouch: false, walk: false, yaw: p.yaw, lean: 0 };
    if (now >= this.nextPerceive) {
      this.perceive(now);
      this.nextPerceive = now + 90 + Math.random() * 40;
    }
    // choose target
    if (this.target && (!this.target.alive || !this.visible.some((v) => v.q === this.target))) {
      if (this.target.alive && now - this.lastSeen < 2500) this.lastKnown = { x: this.target.x, y: this.target.y, z: this.target.z, t: this.lastSeen };
      this.target = null;
      this.shots = 0;
    }
    if (!this.target && this.visible.length) {
      this.visible.sort((a, b) => a.dist - b.dist);
      const t = this.visible[0].q;
      const recent = this.lastKnown && now - this.lastKnown.t < 1500;
      this.target = t;
      this.reactionUntil = now + this.d.reaction * rand(0.75, 1.3) * (recent ? 0.5 : 1);
      const e = this.d.err * DEG * (1 + this.visible[0].dist / 40);
      this.errYaw = rand(-e, e) * 2.2;
      this.errPitch = rand(-e, e) * 1.5;
      this.aimZone = Math.random() < this.d.head ? 'head' : 'chest';
      this.burstLeft = Math.round(rand(...this.d.burst));
    }
    if (this.target) {
      this.lastSeen = now;
      this.lastKnown = { x: this.target.x, y: this.target.y, z: this.target.z, t: now };
    }

    // weapon housekeeping
    this.manageWeapon(now);

    // objective / movement
    const goal = this.chooseGoal(now);
    let moveYaw = null;
    if (this.use) {
      // planting / defusing: stand still
    } else if (goal) {
      moveYaw = this.navigate(now, dt, goal, inp);
    }

    // look & fight
    if (this.target && p.blindUntil <= now) {
      this.fight(now, dt, inp, moveYaw);
    } else {
      p.ads = false;
      this.idleLook(now, dt, moveYaw);
      if (p.blindUntil > now) { inp.fwd = -0.5; p.yaw += Math.sin(now / 150) * dt * 2; }
      this.maybeThrowNade(now);
      this.maybeUtility(now);
    }
    if (now < this.crouchUntil) inp.crouch = true;
    if (moveYaw != null && !this.target) {
      const rel = moveYaw - p.yaw;
      const spd = inp._spd ?? 1;
      inp.fwd = Math.cos(rel) * spd;
      inp.right = -Math.sin(rel) * spd;
    }
    inp.yaw = p.yaw;
    p.walking = inp.walk;
    p.using = this.use;
    return inp;
  }

  manageWeapon(now) {
    const p = this.p, m = this.m;
    if (p.cur === 'bomb') m.onSwitch(p, p.inv.primary ? 'primary' : p.inv.secondary ? 'secondary' : 'knife');
    if (GRENADES.includes(p.cur) && !this.throwing) m.onSwitch(p, p.inv.primary ? 'primary' : p.inv.secondary ? 'secondary' : 'knife');
    const it = m.currentItem(p);
    if (p.cur === 'knife' && (p.inv.primary || p.inv.secondary) && m.mode !== 'gungame') {
      const alt = p.inv.primary?.mag + p.inv.primary?.reserve > 0 ? 'primary' : p.inv.secondary ? 'secondary' : null;
      if (alt) m.onSwitch(p, alt);
    }
    if (!it || (p.cur !== 'primary' && p.cur !== 'secondary')) return;
    if (p.reloadUntil) return;
    const w = WEAPONS[it.id];
    if (it.mag === 0) {
      if (it.reserve > 0 && !(this.target && p.cur === 'primary' && p.inv.secondary?.mag > 0)) m.onReload(p);
      else if (p.cur === 'primary' && p.inv.secondary?.mag > 0) m.onSwitch(p, 'secondary');
      else if (it.reserve <= 0) m.onSwitch(p, 'knife');
    } else if (!this.target && it.mag < w.mag * 0.4 && it.reserve > 0 && now - this.lastSeen > 1500) {
      m.onReload(p);
    } else if (!this.target && p.cur === 'secondary' && p.inv.primary && (p.inv.primary.mag > 0 || p.inv.primary.reserve > 0)) {
      m.onSwitch(p, 'primary');
    }
  }

  // ---------------------------------------------------------------- goals
  chooseGoal(now) {
    const m = this.m, p = this.p;
    this.use = false;
    this.faceAt = null;
    if (m.mode === 'defuse') {
      if (m.phase === 'freeze' || m.phase === 'post' || m.phase === 'ended' || m.phase === 'halftime') return null;
      const bomb = m.bomb;
      if (p.team === TEAM.ATT) {
        if (bomb && bomb.state === 'dropped') {
          const bots = m.alive(TEAM.ATT);
          let closest = null, cd = Infinity;
          for (const q of bots) { const d = Math.hypot(q.x - bomb.x, q.z - bomb.z); if (d < cd) { cd = d; closest = q; } }
          if (closest === p) return this.setGoal('bomb', { x: bomb.x, y: bomb.y, z: bomb.z });
        }
        if (p.inv.bomb) {
          const zone = m.map.zones[m.botPlan.site];
          if (inZone(zone, p.x, p.y, p.z) && !this.target && p.onGround) {
            // close enough: plant here once we're a bit inside
            const cx = (zone.min[0] + zone.max[0]) / 2, cz = (zone.min[2] + zone.max[2]) / 2;
            if (Math.hypot(cx - p.x, cz - p.z) < 5 || this.arrived) { this.use = true; return null; }
          }
          return this.setGoal('plant' + m.botPlan.site, this.spotIn(zone, 'plant' + m.botPlan.site, true));
        }
        if (bomb && bomb.state === 'planted') {
          const key = 'guard';
          if (this.spotKey !== key) {
            const n = m.nav.randomNode(Math.random, (nd) => Math.hypot(nd.x - bomb.x, nd.z - bomb.z) < 8 && Math.abs(nd.y - bomb.y) < 2);
            this.spot = { x: n.x, y: n.y, z: n.z };
            this.spotKey = key;
            this.holdLook = { x: bomb.x, y: bomb.y + 1, z: bomb.z };
          }
          return this.setGoal(key, this.spot);
        }
        const zone = m.map.zones[m.botPlan.site];
        return this.setGoal('site' + m.botPlan.site, this.spotIn(zone, 'site' + m.botPlan.site));
      } else {
        if (bomb && bomb.state === 'planted') {
          const d = Math.hypot(bomb.x - p.x, bomb.z - p.z);
          if (d < 1.4 && !this.visible.length) { this.use = true; return null; }
          return this.setGoal('defuse', { x: bomb.x, y: bomb.y, z: bomb.z });
        }
        let site = this.p.id % 2 === 0 ? 'A' : 'B';
        if (m.botPlan.alertSite && now - m.botPlan.alertAt < 25000) site = m.botPlan.alertSite;
        const job = this.reinforceGoal(now, site);
        if (job !== undefined) return job;
        return this.setGoal('hold' + site, this.spotIn(m.map.zones[site], 'hold' + site));
      }
    }
    // deathmatch style
    if (this.lastKnown && now - this.lastKnown.t < 6000) return this.setGoal('chase', this.lastKnown, 1500);
    if (this.heard && now - this.heard.t < 5000) return this.setGoal('heard', this.heard, 1500);
    if (!this.spot || this.arrived && this.spotKey === 'roam') {
      const n = m.nav.randomNode();
      this.spot = { x: n.x, y: n.y, z: n.z };
      this.spotKey = 'roam';
      this.arrived = false;
      this.goalKey = null;
    }
    return this.setGoal('roam', this.spot);
  }

  spotIn(zone, key, center = false) {
    if (this.spotKey !== key || !this.spot) {
      const nodes = this.m.nav.nodesInZone(zone);
      let n = nodes.length ? pick(nodes) : this.m.nav.nearest((zone.min[0] + zone.max[0]) / 2, 0.5, (zone.min[2] + zone.max[2]) / 2);
      if (center && nodes.length) {
        const cx = (zone.min[0] + zone.max[0]) / 2, cz = (zone.min[2] + zone.max[2]) / 2;
        nodes.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
        n = nodes[Math.floor(Math.random() * Math.min(6, nodes.length))];
      }
      this.spot = n ? { x: n.x, y: n.y, z: n.z } : null;
      this.spotKey = key;
      this.holdLook = null;
    }
    return this.spot;
  }

  setGoal(key, pos, refresh = 0) {
    if (!pos) return null;
    if (this.goalKey !== key || (refresh && this.m.now > this.repathAt)) {
      this.goalKey = key;
      this.goal = pos;
      this.path = null;
      this.arrived = false;
    }
    this.goal = pos;
    return pos;
  }

  navigate(now, dt, goal, inp) {
    const m = this.m, p = this.p;
    if (!this.path || now > this.repathAt) {
      this.path = m.nav.findPath(m.world, { x: p.x, y: p.y + 0.1, z: p.z }, goal);
      this.pathIdx = 0;
      this.repathAt = now + 3000 + Math.random() * 2000;
      if (!this.path) {
        this.repathAt = now + 800;
        if (this.spotKey === 'roam') this.spot = null;
        return null;
      }
    }
    const path = this.path;
    // advance waypoints
    while (this.pathIdx < path.length) {
      const wp = path[this.pathIdx];
      const d = Math.hypot(wp.x - p.x, wp.z - p.z);
      if (d < 0.45 || (this.pathIdx < path.length - 1 && d < 0.9 && Math.abs(wp.y - p.y) < 0.6)) this.pathIdx++;
      else break;
    }
    if (this.pathIdx >= path.length) {
      this.arrived = true;
      return null;
    }
    const wp = path[this.pathIdx];
    const dx = wp.x - p.x, dz = wp.z - p.z;
    const dist = Math.hypot(dx, dz);
    // stuck detection
    if (!this.lastPos || now - this.lastProgressCheck > 700) {
      if (this.lastPos) {
        const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
        if (moved < 0.35) this.stuckT += now - this.lastProgressCheck; else this.stuckT = 0;
      }
      this.lastPos = { x: p.x, z: p.z };
      this.lastProgressCheck = now;
    }
    if (this.stuckT > 700 && p.onGround) inp.jump = true;
    if (this.stuckT > 2200) { this.path = null; this.stuckT = 0; this.strafeDir = -this.strafeDir; }
    if (wp.type === 'jump' && dist < 1.4 && p.onGround) { inp.jump = true; }
    if (!p.onGround && p.vy > 0) inp.crouch = true;
    // walk quietly when holding near the goal as a defender
    const goalDist = Math.hypot(goal.x - p.x, goal.z - p.z);
    inp._spd = 1;
    if (m.mode === 'defuse' && goalDist < 6 && p.team === TEAM.DEF) inp.walk = true;
    return Math.atan2(-dx, -dz);
  }

  idleLook(now, dt, moveYaw) {
    const p = this.p;
    let targetYaw = null, targetPitch = 0;
    if (this.faceAt) {
      // working on something (reinforcing): look straight at it
      const eyeY = p.y + 1.6;
      const dx = this.faceAt.x - p.x, dz = this.faceAt.z - p.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(this.faceAt.y - eyeY, Math.hypot(dx, dz) || 0.01);
      return;
    }
    if (now < this.avertUntil) {
      // look away from our own flashbang
      targetYaw = this.avertYaw;
    } else if (this.lookAt && now - this.lookAt.t < 1500) {
      targetYaw = Math.atan2(-(this.lookAt.x - p.x), -(this.lookAt.z - p.z));
    } else if (this.heard && now - this.heard.t < 2500) {
      targetYaw = Math.atan2(-(this.heard.x - p.x), -(this.heard.z - p.z));
    } else if (moveYaw != null) {
      targetYaw = moveYaw;
    } else if (this.arrived) {
      if (!this.holdLook || now > this.nextGlance) {
        this.nextGlance = now + rand(1500, 4000);
        this.holdLook = this.pickHoldLook();
      }
      if (this.holdLook) {
        targetYaw = Math.atan2(-(this.holdLook.x - p.x), -(this.holdLook.z - p.z));
        const dy = (this.holdLook.y ?? p.y + 1.6) - (p.y + 1.6);
        targetPitch = Math.atan2(dy, Math.hypot(this.holdLook.x - p.x, this.holdLook.z - p.z) || 1);
      }
    }
    if (targetYaw != null) {
      const dyaw = wrapAngle(targetYaw - p.yaw);
      p.yaw = wrapAngle(p.yaw + clamp(dyaw * Math.min(1, dt * 6), -7 * dt, 7 * dt));
    }
    p.pitch += (clamp(targetPitch, -0.6, 0.6) - p.pitch) * Math.min(1, dt * 5);
  }

  pickHoldLook() {
    // look along a path towards the enemy spawn / somewhere interesting
    const m = this.m, p = this.p;
    const enemySpawn = m.map.spawns[p.team === TEAM.ATT ? 2 : 1][0] || m.map.spawns.ffa[0];
    if (!enemySpawn) return null;
    const path = m.nav.findPath(m.world, { x: p.x, y: p.y + 0.1, z: p.z }, { x: enemySpawn[0], y: enemySpawn[1], z: enemySpawn[2] }, 8000);
    if (path && path.length > 1) {
      let acc = 0;
      for (let i = 1; i < path.length; i++) {
        acc += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
        if (acc > 6 + Math.random() * 10) return { x: path[i].x, y: path[i].y + 1.5, z: path[i].z };
      }
      const l = path[path.length - 1];
      return { x: l.x, y: l.y + 1.5, z: l.z };
    }
    return { x: p.x + rand(-5, 5), y: p.y + 1.6, z: p.z + rand(-5, 5) };
  }

  // ---------------------------------------------------------------- combat
  fight(now, dt, inp, moveYaw) {
    const m = this.m, p = this.p, t = this.target;
    const eye = eyePosition(p);
    const H = heightFor(t.crouch);
    const aimY = this.aimZone === 'head' ? t.y + H - 0.14 : t.y + H * 0.68;
    // lead slightly with target velocity (bots see real positions)
    const tx = t.x + (t.vx || 0) * 0.05, tz = t.z + (t.vz || 0) * 0.05;
    const dx = tx - eye[0], dy = aimY - eye[1], dz = tz - eye[2];
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(dy, dist || 0.001);
    // error decays over time, target motion keeps some error alive
    const decay = Math.exp(-dt * 2.2);
    this.errYaw *= decay;
    this.errPitch *= decay;
    const tsp = Math.hypot(t.vx || 0, t.vz || 0);
    const jitter = (tsp / 5.6) * this.d.err * DEG * 0.6;
    const aimYaw = wantYaw + this.errYaw + Math.sin(now / 170 + p.id) * jitter;
    const aimPitch = wantPitch + this.errPitch;
    const dyaw = wrapAngle(aimYaw - p.yaw);
    const dpitch = aimPitch - p.pitch;
    const k = Math.min(1, dt * this.d.turn);
    const maxTurn = this.d.turn * 1.4 * dt;
    p.yaw = wrapAngle(p.yaw + clamp(dyaw * k, -maxTurn, maxTurn));
    p.pitch = clamp(p.pitch + clamp(dpitch * k, -maxTurn, maxTurn), -1.5, 1.5);

    const it = m.currentItem(p);
    const w = it ? WEAPONS[it.id] : WEAPONS.knife;
    const isKnife = p.cur === 'knife';
    // movement while fighting
    const ranged = w.type === 'rifle' || w.type === 'sniper' || w.type === 'pistol';
    if (isKnife) {
      const rel = wantYaw - p.yaw;
      inp.fwd = Math.cos(rel);
      inp.right = -Math.sin(rel);
    } else if (ranged && dist > 6) {
      inp.fwd = 0; inp.right = 0; // stand still for accuracy
      if (w.type === 'rifle' && dist > 16 && this.d.head > 0.25 && this.shots > 2) this.crouchUntil = now + 300;
    } else {
      if (now > this.strafeUntil) { this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeUntil = now + rand(350, 800); }
      inp.right = this.strafeDir;
      inp.fwd = w.type === 'shotgun' && dist > 7 ? 0.8 : 0;
    }
    p.ads = w.type === 'sniper' && dist > 6 && now >= this.reactionUntil - 200;

    if (now < this.reactionUntil || p.reloadUntil) return;
    // settled enough to shoot?
    const angErr = Math.hypot(wrapAngle(wantYaw - p.yaw), wantPitch - p.pitch);
    const size = Math.atan2(this.aimZone === 'head' ? 0.16 : 0.3, Math.max(dist, 0.5));
    const tol = w.type === 'sniper' ? size * 1.2 : size * 2.2 + 0.01;
    if (isKnife) {
      if (dist < 1.8 && now >= p.nextFire) {
        m.knifeAttack(p, viewDir(p.yaw, p.pitch), dist < 1.5 && Math.random() < 0.3, now);
        p.nextFire = now + 500;
      }
      return;
    }
    if (angErr > tol) return;
    if (now < this.burstPauseUntil) return;
    if (now < p.nextFire) return;
    if (!w.auto && now - this.lastShot < w.interval * 1000 + rand(60, 220)) return;
    if (w.type === 'sniper' && !p.ads && dist > 6) return;
    this.shoot(now, w, it);
    if (w.auto && dist > 14) {
      this.burstLeft--;
      if (this.burstLeft <= 0) {
        this.burstLeft = Math.round(rand(...this.d.burst));
        this.burstPauseUntil = now + rand(220, 480);
        this.shots = 0;
      }
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
    let best = null, bestD = Infinity;
    for (const id of m.map.destructibles) {
      const b = m.world.byId.get(id);
      // face the middle row of each section so the look ray lands on it
      if (!b.active || b.reinforced || b.min[1] < 0.9 || b.min[1] > 1.1 || m.botPlan.claimed.has(b.group)) continue;
      const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      if (Math.hypot(c[0] - zc[0], c[2] - zc[1]) > 16) continue;
      const thinX = b.max[0] - b.min[0] < b.max[2] - b.min[2];
      for (const s of [1, -1]) {
        const x = c[0] + (thinX ? s * 1.05 : 0), z = c[2] + (thinX ? 0 : s * 1.05);
        const n = m.nav.nearest(x, 0.2, z);
        if (!n || Math.hypot(n.x - x, n.z - z) > 0.55 || n.y > 0.3) continue;
        const d = Math.hypot(n.x - p.x, n.z - p.z);
        if (d < bestD) { bestD = d; best = { id, group: b.group, spot: { x: n.x, y: n.y, z: n.z }, face: { x: c[0], y: 1.45, z: c[2] } }; }
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
    if (now < this.nadeCooldown || !this.lastKnown || m.phase === 'freeze') return;
    const hasFrag = p.inv.nades.frag > 0, hasFlash = p.inv.nades.flash > 0;
    if (!hasFrag && !hasFlash) return;
    const age = now - this.lastKnown.t;
    if (age < 600 || age > 4000) return;
    const d = Math.hypot(this.lastKnown.x - p.x, this.lastKnown.z - p.z);
    if (d < 6 || d > 24) return;
    this.nadeCooldown = now + 8000;
    if (Math.random() > this.d.nade) return;
    if (hasFlash && (!hasFrag || Math.random() < 0.45) && d < 20) {
      // pop flash over the corner, then turn away until it goes off
      const yaw = this.throwAt('flash', this.lastKnown, 13, 0.25);
      this.avertYaw = yaw + Math.PI;
      this.avertUntil = now + 1700;
      return;
    }
    if (hasFrag) this.throwAt('frag', this.lastKnown, 15);
  }

  maybeUtility(now) {
    const m = this.m, p = this.p;
    if (m.mode !== 'defuse' || m.phase !== 'live' || p.team !== TEAM.ATT) return;
    const zone = m.map.zones[m.botPlan.site];
    if (!zone) return;
    const zc = { x: (zone.min[0] + zone.max[0]) / 2, z: (zone.min[2] + zone.max[2]) / 2 };
    const toSite = Math.hypot(zc.x - p.x, zc.z - p.z);
    // smoke off the defenders' approach when we arrive at the site
    if (!this.smokeDone && p.inv.nades.smoke > 0 && toSite < 16 && !m.botPlan.smoked.has(m.botPlan.site)) {
      this.smokeDone = true;
      const ds = m.map.spawns[TEAM.DEF][0];
      if (ds) {
        const path = m.nav.findPath(m.world, { x: zc.x, y: 0.2, z: zc.z }, { x: ds[0], y: ds[1] + 0.1, z: ds[2] }, 6000);
        if (path && path.length > 3) {
          let acc = 0, pt = path[path.length - 1];
          for (let i = 1; i < path.length; i++) {
            acc += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
            if (acc > 9) { pt = path[i]; break; }
          }
          const d = Math.hypot(pt.x - p.x, pt.z - p.z);
          const eye = eyePosition(p);
          if (d > 5 && d < 26 && m.world.lineOfSight(eye[0], eye[1], eye[2], pt.x, pt.y + 1.5, pt.z)) {
            m.botPlan.smoked.add(m.botPlan.site);
            this.throwAt('smoke', pt, 14);
          }
        }
      }
    }
    // breach charge on a wall next to the site
    if (!this.breachDone && p.inv.nades.breach > 0 && toSite < 18) {
      const eye = eyePosition(p);
      for (const id of m.map.destructibles) {
        const b = m.world.byId.get(id);
        if (!b.active || b.min[1] < 0.9 || b.min[1] > 1.1) continue;
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
        // step back from the blast
        this.lookAt = null;
        this.path = null;
        break;
      }
    }
  }
}
