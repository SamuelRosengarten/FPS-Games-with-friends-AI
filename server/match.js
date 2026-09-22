// A running match: map, players' match state, rounds, combat, grenades, bomb, drops and bots.

import {
  TEAM, PLAYER, FLAG, ECONOMY, MAX_LAG_COMP, USE_RANGE, BOMB_RADIUS, BOMB_DAMAGE, MODES,
  clamp, viewDir, isEnemy, wrapAngle,
} from '../shared/constants.js';
import { WEAPONS, GEAR, GRENADES, DEFAULT_PISTOL, GUNGAME_ORDER, computeDamage, itemPrice } from '../shared/weapons.js';
import { loadMap } from '../shared/maps/index.js';
import { inZone } from '../shared/maps/builder.js';
import { PhysicsWorld, stepPlayer, rayHitPlayer, eyePosition, heightFor, rayBox } from '../shared/physics.js';
import { materialInfo } from '../shared/materials.js';
import { getNav } from './nav.js';
import { BotBrain } from './bot.js';

const SURFACE_IDX = { stone: 0, wood: 1, metal: 2, sand: 3, flesh: 4 };
const HISTORY_MS = 1000;
const GRENADE_R = 0.07;

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export class Match {
  constructor(game, settings) {
    this.game = game;
    this.settings = { ...settings };
    this.mode = settings.mode;
    this.modeInfo = MODES[this.mode];
    this.map = loadMap(settings.map);
    if (!this.map.modes.includes(this.mode)) this.mode = this.map.modes[0];
    this.world = new PhysicsWorld(this.map.boxes, this.map.bounds);
    this.nav = getNav(this.map.id, this.world);
    this.nav.markReachable([...this.map.spawns[1], ...this.map.spawns[2]]);
    this.round = 0;
    this.score = { 1: 0, 2: 0 };
    this.lossStreak = { 1: 0, 2: 0 };
    this.phase = 'waiting';
    this.phaseEnd = 0;
    this.roundStart = 0;
    this.halftimeDone = false;
    this.bomb = null;
    this.grenades = [];
    this.smokes = [];
    this.drops = [];
    this.nextEnt = 1;
    this.wallUpdates = new Map();
    this.tickCount = 0;
    this.lastScoreboard = 0;
    this.endsAt = 0;
    this.ended = false;
    this.botPlan = { site: 'A', alertSite: null, alertAt: 0 };
    this.feed = [];
  }

  get now() { return this.game.now(); }
  get players() { return this.game.players; }

  inMatch(p) { return p.team === TEAM.ATT || p.team === TEAM.DEF; }
  teamPlayers(team) { return [...this.players.values()].filter((p) => p.team === team); }
  alive(team) { return [...this.players.values()].filter((p) => p.alive && (team == null ? this.inMatch(p) : p.team === team)); }
  enemies(a, b) { return isEnemy(this.mode, a, b); }

  // ------------------------------------------------------------------ lifecycle

  start() {
    for (const p of this.players.values()) this.resetPlayerForMatch(p);
    if (this.modeInfo.rounds) {
      this.startRound();
    } else {
      this.phase = 'freeze';
      this.roundStart = this.now;
      this.phaseEnd = this.now + 4000;
      this.endsAt = this.now + 4000 + this.settings.timeLimit * 60000;
      for (const p of this.players.values()) if (this.inMatch(p)) this.spawnDM(p, true);
      this.broadcastRound();
    }
  }

  resetPlayerForMatch(p) {
    p.alive = false;
    p.hp = 0;
    p.armor = 0;
    p.helmet = false;
    p.kit = false;
    p.money = this.settings.startMoney;
    p.inv = emptyInventory();
    p.cur = 'knife';
    p.stats = { k: 0, d: 0, a: 0, hs: 0, dmg: 0, score: 0, mvp: 0 };
    p.ggLevel = 0;
    p.loadout = { primary: null, secondary: null };
    p.respawnAt = 0;
    p.brain = p.bot ? new BotBrain(this, p, this.settings.botDifficulty) : null;
    p.hist = [];
  }

  addPlayer(p) {
    // mid-match join
    this.resetPlayerForMatch(p);
    if (!this.modeInfo.rounds && this.inMatch(p)) p.respawnAt = this.now + 1500;
    this.game.send(p, { t: 'match', ...this.matchInfo() });
    this.sendYou(p);
  }

  removePlayer(p) {
    if (p.alive) {
      this.dropAll(p);
      p.alive = false;
    }
    if (this.bomb && this.bomb.carrier === p.id) this.dropBomb(p);
    this.checkRoundEnd();
  }

  teamChanged(p) {
    if (p.alive) {
      this.dropAll(p);
      p.alive = false;
      p.hp = 0;
      this.game.broadcast({ t: 'kill', k: null, v: p.id, w: 'suicide' });
    }
    p.inv = emptyInventory();
    p.money = Math.max(p.money, this.settings.startMoney);
    if (p.bot && !p.brain) p.brain = new BotBrain(this, p, this.settings.botDifficulty);
    if (!this.modeInfo.rounds && this.inMatch(p)) p.respawnAt = this.now + 2000;
    this.checkRoundEnd();
    this.sendYou(p);
  }

  matchInfo() {
    return {
      map: this.map.id,
      mode: this.mode,
      settings: this.settings,
      state: {
        phase: this.phase,
        round: this.round,
        endsAt: this.phaseEnd,
        matchEndsAt: this.endsAt,
        score: this.score,
        bomb: this.bombInfo(),
        smokes: this.smokes.map((s) => [s.id, r2(s.x), r2(s.y), r2(s.z), s.until, s.start]),
        walls: this.map.destructibles.map((id) => this.world.byId.get(id)).filter((b) => b.hp < 100).map((b) => [b.id, Math.max(0, Math.round(b.hp))]),
        drops: this.drops.map((d) => [d.id, d.wid, r2(d.x), r2(d.y), r2(d.z)]),
      },
    };
  }

  // ------------------------------------------------------------------ rounds (defuse)

  startRound() {
    const now = this.now;
    this.round++;
    this.phase = 'freeze';
    this.roundStart = now;
    this.phaseEnd = now + this.settings.freezeTime * 1000;
    this.resetWorldState();
    const att = this.teamPlayers(TEAM.ATT);
    const def = this.teamPlayers(TEAM.DEF);
    const spawnList = { 1: shuffle(this.map.spawns[1].slice()), 2: shuffle(this.map.spawns[2].slice()) };
    const idx = { 1: 0, 2: 0 };
    for (const p of [...att, ...def]) {
      const survived = p.alive && this.round > 1;
      if (!survived) {
        p.inv = emptyInventory();
        p.inv.secondary = makeWeapon(DEFAULT_PISTOL[p.team]);
        p.armor = 0; p.helmet = false; p.kit = false;
      } else {
        if (!p.inv.secondary && !p.inv.primary) p.inv.secondary = makeWeapon(DEFAULT_PISTOL[p.team]);
      }
      if (p.team !== TEAM.DEF) p.kit = false;
      p.inv.bomb = false;
      const list = spawnList[p.team];
      const sp = list[idx[p.team]++ % Math.max(1, list.length)] || [0, 0, 0, 0];
      this.spawn(p, sp);
      p.cur = p.inv.primary ? 'primary' : p.inv.secondary ? 'secondary' : 'knife';
      p.roundKills = 0;
      p.roundDmg = 0;
    }
    // bomb to a random attacker (prefer humans a bit less than bots so humans can choose)
    this.bomb = null;
    const aliveAtt = att.filter((p) => p.alive);
    if (aliveAtt.length) {
      const carrier = aliveAtt[Math.floor(Math.random() * aliveAtt.length)];
      carrier.inv.bomb = true;
      this.bomb = { state: 'carried', carrier: carrier.id, x: 0, y: 0, z: 0 };
    }
    this.botPlan = { site: Math.random() < 0.5 ? 'A' : 'B', alertSite: null, alertAt: 0 };
    for (const p of [...att, ...def]) {
      this.sendYou(p);
      if (p.brain) p.brain.onRoundStart();
    }
    this.broadcastRound();
    this.game.broadcast({ t: 'bombinfo', b: this.bombInfo() });
  }

  resetWorldState() {
    for (const id of this.map.destructibles) {
      const b = this.world.byId.get(id);
      b.hp = 100;
      b.active = true;
    }
    this.wallUpdates.clear();
    this.grenades = [];
    this.smokes = [];
    this.drops = [];
    this.game.broadcast({ t: 'reset' });
  }

  endRound(winner, reason) {
    if (this.phase === 'post' || this.phase === 'ended') return;
    const now = this.now;
    this.phase = 'post';
    this.phaseEnd = now + 5500;
    this.score[winner]++;
    const loser = winner === TEAM.ATT ? TEAM.DEF : TEAM.ATT;
    this.lossStreak[winner] = Math.max(0, this.lossStreak[winner] - 1);
    this.lossStreak[loser] = Math.min(4, this.lossStreak[loser] + 1);
    const objective = reason === 'bomb' || reason === 'defused';
    const winMoney = objective ? ECONOMY.winObjective : ECONOMY.winElim;
    let lossMoney = Math.min(ECONOMY.lossMax, ECONOMY.lossBase + ECONOMY.lossStep * (this.lossStreak[loser] - 1));
    const planted = this.bomb && (this.bomb.state === 'planted' || this.bomb.state === 'defused' || this.bomb.state === 'exploded');
    for (const p of this.teamPlayers(winner)) this.addMoney(p, winMoney);
    for (const p of this.teamPlayers(loser)) {
      let m = lossMoney;
      if (loser === TEAM.ATT && planted) m += ECONOMY.plantBonusTeam;
      // attackers that survive a time-out get nothing (like CS)
      if (loser === TEAM.ATT && reason === 'time' && p.alive) m = 0;
      this.addMoney(p, m);
    }
    // MVP
    let mvp = null;
    for (const p of this.teamPlayers(winner)) {
      if (!mvp || (p.roundKills || 0) > (mvp.roundKills || 0) || ((p.roundKills || 0) === (mvp.roundKills || 0) && (p.roundDmg || 0) > (mvp.roundDmg || 0))) mvp = p;
    }
    if (reason === 'defused' && this.bomb?.defuser) mvp = this.players.get(this.bomb.defuser) || mvp;
    if (reason === 'bomb' && this.bomb?.planter) mvp = this.players.get(this.bomb.planter) || mvp;
    if (mvp) mvp.stats.mvp++;
    for (const p of this.players.values()) this.sendYou(p);
    this.broadcastRound({ winner, reason, mvp: mvp?.id ?? null });
    this.sendScoreboard();
  }

  afterPost() {
    const half = Math.floor(this.settings.maxRounds / 2);
    const winAt = half + 1;
    const total = this.score[1] + this.score[2];
    if (this.score[1] >= winAt) return this.endMatch(TEAM.ATT);
    if (this.score[2] >= winAt) return this.endMatch(TEAM.DEF);
    if (total >= this.settings.maxRounds) return this.endMatch(0);
    if (total === half && !this.halftimeDone) {
      this.halftimeDone = true;
      this.phase = 'halftime';
      this.phaseEnd = this.now + 5000;
      for (const p of this.players.values()) {
        if (!this.inMatch(p)) continue;
        p.team = p.team === TEAM.ATT ? TEAM.DEF : TEAM.ATT;
        p.money = this.settings.startMoney;
        p.inv = emptyInventory();
        p.alive = false;
        p.armor = 0; p.helmet = false; p.kit = false;
      }
      this.score = { 1: this.score[2], 2: this.score[1] };
      this.lossStreak = { 1: 0, 2: 0 };
      this.broadcastRound({ halftime: true });
      this.game.broadcastLobby();
      return;
    }
    this.startRound();
  }

  endMatch(winner, reason = '') {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    this.phaseEnd = this.now + 12000;
    let winnerId = null;
    if (this.mode === 'ffa' || this.mode === 'gungame') {
      const list = [...this.players.values()].filter((p) => this.inMatch(p));
      list.sort((a, b) => (this.mode === 'gungame' ? b.ggLevel - a.ggLevel : 0) || b.stats.k - a.stats.k || a.stats.d - b.stats.d);
      winnerId = list[0]?.id ?? null;
    }
    this.sendScoreboard();
    this.game.broadcast({ t: 'end', winner, winnerId, reason, score: this.score, returnAt: this.phaseEnd });
  }

  addMoney(p, amount) {
    p.money = clamp(p.money + amount, 0, ECONOMY.maxMoney);
  }

  broadcastRound(extra = {}) {
    this.game.broadcast({
      t: 'round', phase: this.phase, round: this.round, endsAt: this.phaseEnd, matchEndsAt: this.endsAt,
      score: this.score, maxRounds: this.settings.maxRounds, buyEnds: this.roundStart + this.settings.buyTime * 1000, ...extra,
    });
  }

  checkRoundEnd() {
    if (this.mode !== 'defuse') return;
    if (this.phase !== 'live' && this.phase !== 'planted') return;
    const attTotal = this.teamPlayers(TEAM.ATT).length;
    const defTotal = this.teamPlayers(TEAM.DEF).length;
    const attAlive = this.alive(TEAM.ATT).length;
    const defAlive = this.alive(TEAM.DEF).length;
    if (this.phase === 'live') {
      if (attTotal > 0 && attAlive === 0) return this.endRound(TEAM.DEF, 'elim');
      if (defTotal > 0 && defAlive === 0) return this.endRound(TEAM.ATT, 'elim');
    } else if (defTotal > 0 && defAlive === 0) {
      return this.endRound(TEAM.ATT, 'elim');
    }
  }

  // ------------------------------------------------------------------ spawning

  spawn(p, sp) {
    p.alive = true;
    p.hp = PLAYER.maxHealth;
    p.x = sp[0]; p.y = sp[1] + 0.02; p.z = sp[2];
    p.vx = p.vy = p.vz = 0;
    p.yaw = sp[3] ?? 0;
    p.pitch = 0;
    p.crouch = 0; p.lean = 0;
    p.onGround = true;
    p.walking = false;
    p.ads = false;
    p.using = false;
    p.plantEnd = 0;
    p.defuseEnd = 0;
    p.reloadUntil = 0;
    p.deployUntil = this.now + 300;
    p.nextFire = 0;
    p.blindUntil = 0;
    p.dmgTaken = new Map();
    p.spawnedAt = this.now;
    p.spawnProtectUntil = this.modeInfo.rounds ? 0 : this.now + 2000;
    p.buyUntil = this.modeInfo.rounds ? 0 : this.now + 12000;
    p.hist = [];
    p.tpId = (p.tpId || 0) + 1;
    this.game.send(p, { t: 'tp', id: p.tpId, p: [r3(p.x), r3(p.y), r3(p.z)], yaw: r3(p.yaw), pitch: 0 });
    if (p.brain) p.brain.onSpawn();
  }

  spawnDM(p, initial = false) {
    const pts = this.mode === 'tdm' && initial ? this.map.spawns[p.team] : this.map.spawns.ffa;
    let best = null, bestScore = -Infinity;
    const others = [...this.players.values()].filter((o) => o !== p && o.alive && this.inMatch(o));
    for (let k = 0; k < 40; k++) {
      const sp = pts[Math.floor(Math.random() * pts.length)];
      if (!sp) break;
      let minEnemy = 60, minFriend = 60, seen = false;
      for (const o of others) {
        const d = Math.hypot(o.x - sp[0], o.z - sp[2]);
        if (this.enemies(p, o)) {
          minEnemy = Math.min(minEnemy, d);
          if (d < 30 && this.world.lineOfSight(sp[0], sp[1] + 1.6, sp[2], o.x, o.y + 1.6, o.z)) seen = true;
        } else minFriend = Math.min(minFriend, d);
      }
      const s = Math.min(minEnemy, 35) - (seen ? 30 : 0) - (this.mode === 'tdm' ? minFriend * 0.15 : 0) + Math.random() * 4;
      if (s > bestScore) { bestScore = s; best = sp; }
    }
    best = best || pts[0] || [0, 0, 0, 0];
    // face towards the map centre
    const yaw = Math.atan2(best[0], best[2]);
    p.inv = emptyInventory();
    if (this.mode === 'gungame') {
      this.giveGunGameWeapon(p, false);
    } else {
      p.inv.secondary = makeWeapon(p.loadout?.secondary || DEFAULT_PISTOL[p.team] || 'p9');
      if (p.loadout?.primary) p.inv.primary = makeWeapon(p.loadout.primary);
      else if (p.bot) {
        const pick = ['ar', 'm4', 'smg', 'marauder', 'shotgun', 'awp', 'scout', 'rattler'][Math.floor(Math.random() * 8)];
        p.inv.primary = makeWeapon(pick);
      }
      p.armor = 100; p.helmet = true;
    }
    this.spawn(p, [best[0], best[1], best[2], yaw]);
    p.cur = p.inv.primary ? 'primary' : p.inv.secondary ? 'secondary' : 'knife';
    this.sendYou(p);
  }

  giveGunGameWeapon(p, announce = true) {
    const wid = GUNGAME_ORDER[Math.min(p.ggLevel, GUNGAME_ORDER.length - 1)];
    const w = WEAPONS[wid];
    p.inv.primary = null;
    p.inv.secondary = null;
    if (w.slot === 'primary') p.inv.primary = makeWeapon(wid);
    else if (w.slot === 'secondary') p.inv.secondary = makeWeapon(wid);
    p.armor = 100; p.helmet = true;
    p.cur = w.slot === 'knife' ? 'knife' : w.slot;
    p.reloadUntil = 0;
    p.deployUntil = this.now + w.deploy * 1000;
    if (announce) this.sendYou(p);
  }

  // ------------------------------------------------------------------ tick

  tick(dt) {
    const now = this.now;
    this.tickCount++;

    // phase transitions
    if (this.phase === 'freeze' && now >= this.phaseEnd) {
      this.phase = 'live';
      this.phaseEnd = this.modeInfo.rounds ? now + this.settings.roundTime * 1000 : this.endsAt;
      this.broadcastRound();
    } else if (this.phase === 'live' && this.modeInfo.rounds && now >= this.phaseEnd) {
      this.endRound(TEAM.DEF, 'time');
    } else if (this.phase === 'live' && !this.modeInfo.rounds && now >= this.endsAt) {
      this.timeLimitReached();
    } else if (this.phase === 'post' && now >= this.phaseEnd) {
      this.afterPost();
    } else if (this.phase === 'halftime' && now >= this.phaseEnd) {
      this.startRound();
    } else if (this.phase === 'ended' && now >= this.phaseEnd) {
      this.game.returnToLobby();
      return;
    }

    // bots
    for (const p of this.players.values()) {
      if (!p.bot || !p.brain || !this.inMatch(p)) continue;
      if (!p.alive) { p.brain.dead(now); continue; }
      const inp = p.brain.update(dt, now);
      const frozen = this.phase === 'freeze' || this.phase === 'ended' || this.isUsing(p);
      stepPlayer(this.world, p, { ...inp, frozen, speedMul: this.speedMulFor(p) }, dt);
    }

    // timers for all players
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (!this.modeInfo.rounds && this.inMatch(p) && p.respawnAt && now >= p.respawnAt && this.phase !== 'ended') {
          p.respawnAt = 0;
          this.spawnDM(p);
        }
        continue;
      }
      if (p.reloadUntil && now >= p.reloadUntil) this.finishReload(p);
      if (p.y < -20) this.kill(p, null, 'fall');
      this.updateUse(p, now);
      this.autoPickup(p);
    }

    this.updateGrenades(dt, now);
    this.updateBomb(now);
    this.smokes = this.smokes.filter((s) => s.until > now);

    // record history for lag compensation
    for (const p of this.players.values()) {
      if (!this.inMatch(p)) continue;
      p.hist.push({ t: now, x: p.x, y: p.y, z: p.z, yaw: p.yaw, crouch: p.crouch, lean: p.lean, alive: p.alive });
      while (p.hist.length && p.hist[0].t < now - HISTORY_MS) p.hist.shift();
    }

    if (this.wallUpdates.size) {
      this.game.broadcast({ t: 'walls', d: [...this.wallUpdates.entries()].map(([id, hp]) => [id, Math.max(0, Math.round(hp))]) });
      this.wallUpdates.clear();
    }

    if (this.tickCount % 2 === 0) this.sendSnapshot(now);
    if (now - this.lastScoreboard > 1000) { this.lastScoreboard = now; this.sendScoreboard(); }
  }

  timeLimitReached() {
    if (this.mode === 'tdm') {
      const k1 = this.teamKills(TEAM.ATT), k2 = this.teamKills(TEAM.DEF);
      this.endMatch(k1 > k2 ? TEAM.ATT : k2 > k1 ? TEAM.DEF : 0, 'time');
    } else this.endMatch(0, 'time');
  }

  teamKills(team) { return this.score[team]; }

  speedMulFor(p) {
    const item = this.currentItem(p);
    const w = item ? WEAPONS[item.id] : WEAPONS.knife;
    return (p.ads && w.scopedSpeed) ? w.scopedSpeed : w.speed;
  }

  currentItem(p) {
    switch (p.cur) {
      case 'primary': return p.inv.primary;
      case 'secondary': return p.inv.secondary;
      case 'knife': return { id: 'knife' };
      case 'bomb': return p.inv.bomb ? { id: 'bomb' } : null;
      default: return GRENADES.includes(p.cur) && p.inv.nades[p.cur] > 0 ? { id: p.cur } : null;
    }
  }

  isUsing(p) { return !!(p.plantEnd || p.defuseEnd); }

  sendSnapshot(now) {
    const ps = [];
    for (const p of this.players.values()) {
      if (!this.inMatch(p)) continue;
      let flags = 0;
      if (p.alive) flags |= FLAG.ALIVE;
      if (p.onGround) flags |= FLAG.GROUND;
      if (p.walking) flags |= FLAG.WALK;
      if (p.plantEnd) flags |= FLAG.PLANT;
      if (p.defuseEnd) flags |= FLAG.DEFUSE;
      if (p.reloadUntil) flags |= FLAG.RELOAD;
      if (p.ads) flags |= FLAG.ADS;
      if (p.inv.bomb) flags |= FLAG.BOMB;
      if (p.kit) flags |= FLAG.KIT;
      if (p.helmet) flags |= FLAG.HELMET;
      if (p.blindUntil > now) flags |= FLAG.BLIND;
      if (p.spawnProtectUntil > now) flags |= FLAG.PROTECT;
      const item = this.currentItem(p);
      ps.push([p.id, r2(p.x), r2(p.y), r2(p.z), r3(p.yaw), r3(p.pitch), r2(p.crouch), r2(p.lean), flags, item ? item.id : 'knife', Math.max(0, Math.round(p.hp))]);
    }
    const gs = this.grenades.map((g) => [g.id, g.type, r2(g.x), r2(g.y), r2(g.z)]);
    const msg = JSON.stringify({ t: 's', ts: Math.round(now), p: ps, g: gs });
    for (const p of this.players.values()) {
      if (p.conn && p.conn.bufferedAmount < 512 * 1024) p.conn.send(msg);
    }
  }

  sendScoreboard() {
    const list = [];
    for (const p of this.players.values()) {
      list.push({
        id: p.id, name: p.name, team: p.team, bot: p.bot, alive: p.alive, ping: p.ping || 0,
        k: p.stats?.k ?? 0, d: p.stats?.d ?? 0, a: p.stats?.a ?? 0, hs: p.stats?.hs ?? 0, dmg: Math.round(p.stats?.dmg ?? 0),
        score: p.stats?.score ?? 0, mvp: p.stats?.mvp ?? 0, money: p.money ?? 0, gg: p.ggLevel ?? 0,
        armor: p.armor > 0, helmet: !!p.helmet, kit: !!p.kit, bomb: !!p.inv?.bomb,
        wpn: p.inv?.primary?.id || p.inv?.secondary?.id || 'knife',
      });
    }
    this.game.broadcast({ t: 'sb', players: list, rounds: this.round });
  }

  sendYou(p) {
    if (!p.conn || !p.inv) return;
    const pack = (it) => (it ? [it.id, it.mag, it.reserve] : null);
    this.game.send(p, {
      t: 'you', alive: p.alive, hp: Math.max(0, Math.round(p.hp)), armor: Math.round(p.armor), helmet: p.helmet, kit: p.kit,
      money: p.money, cur: p.cur,
      inv: { primary: pack(p.inv.primary), secondary: pack(p.inv.secondary), nades: p.inv.nades, bomb: p.inv.bomb },
      gg: p.ggLevel, buyUntil: p.buyUntil || 0, team: p.team,
    });
  }

  // ------------------------------------------------------------------ client input

  onInput(p, m) {
    if (!p.alive || !this.inMatch(p) || p.bot) return;
    if (m.tp !== p.tpId) return;
    const pos = m.p, vel = m.v;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(Number.isFinite)) return;
    const frozen = this.phase === 'freeze' || this.isUsing(p);
    const d = Math.hypot(pos[0] - p.x, pos[2] - p.z);
    if (d > 8 || (frozen && d > 0.6) || Math.abs(pos[1] - p.y) > 8) {
      // way off - put the client back where we think it is
      p.tpId++;
      this.game.send(p, { t: 'tp', id: p.tpId, p: [r3(p.x), r3(p.y), r3(p.z)], yaw: r3(p.yaw), pitch: r3(p.pitch) });
      return;
    }
    const b = this.map.bounds;
    p.x = clamp(pos[0], b.minX, b.maxX);
    p.y = clamp(pos[1], -30, 40);
    p.z = clamp(pos[2], b.minZ, b.maxZ);
    if (Array.isArray(vel) && vel.every(Number.isFinite)) { p.vx = vel[0]; p.vy = vel[1]; p.vz = vel[2]; }
    if (Number.isFinite(m.yaw)) p.yaw = wrapAngle(m.yaw);
    if (Number.isFinite(m.pitch)) p.pitch = clamp(m.pitch, -1.56, 1.56);
    p.crouch = clamp(+m.c || 0, 0, 1);
    p.lean = clamp(+m.l || 0, -1, 1);
    p.onGround = !!m.g;
    p.walking = !!m.w;
    p.ads = !!m.a;
    p.lastInputAt = this.now;
  }

  canFight(p) {
    return p.alive && this.phase !== 'freeze' && this.phase !== 'ended' && this.phase !== 'halftime' && !this.isUsing(p);
  }

  onSwitch(p, slot) {
    if (!p.alive) return;
    const valid = ['primary', 'secondary', 'knife', 'bomb', ...GRENADES];
    if (!valid.includes(slot)) return;
    if (slot === 'primary' && !p.inv.primary) return;
    if (slot === 'secondary' && !p.inv.secondary) return;
    if (slot === 'bomb' && !p.inv.bomb) return;
    if (GRENADES.includes(slot) && !(p.inv.nades[slot] > 0)) return;
    if (p.cur === slot) return;
    p.cur = slot;
    p.reloadUntil = 0;
    p.ads = false;
    const it = this.currentItem(p);
    const w = WEAPONS[it?.id || 'knife'];
    p.deployUntil = this.now + w.deploy * 1000;
  }

  onReload(p) {
    if (!p.alive || p.reloadUntil) return;
    const it = this.currentItem(p);
    if (!it || !(p.cur === 'primary' || p.cur === 'secondary')) return;
    const w = WEAPONS[it.id];
    if (it.mag >= w.mag || it.reserve <= 0) return;
    p.reloadUntil = this.now + w.reload * 1000;
    p.reloadSlot = p.cur;
    this.game.broadcast({ t: 'snd', s: 'reload', id: p.id, w: it.id }, p);
  }

  finishReload(p) {
    p.reloadUntil = 0;
    if (p.cur !== p.reloadSlot) return;
    const it = this.currentItem(p);
    if (!it) return;
    const w = WEAPONS[it.id];
    const need = w.mag - it.mag;
    const take = Math.min(need, it.reserve);
    it.mag += take;
    it.reserve -= take;
    this.sendYou(p);
  }

  // Shared by humans and bots. dirs: array of unit vectors. ts: server time the shooter saw.
  fire(p, origin, dirs, ts, fromBot = false) {
    const now = this.now;
    if (!this.canFight(p)) return false;
    if (p.cur !== 'primary' && p.cur !== 'secondary') return false;
    const it = this.currentItem(p);
    if (!it) return false;
    const w = WEAPONS[it.id];
    if (now < p.deployUntil - 80) return false;
    if (p.reloadUntil) return false;
    if (now < p.nextFire - 25) return false;
    if (it.mag <= 0) return false;
    it.mag--;
    p.nextFire = Math.max(now, p.nextFire) + w.interval * 1000 * (fromBot ? 1 : 0.92);
    if (p.nextFire < now) p.nextFire = now + w.interval * 1000 * 0.92;
    p.lastShotAt = now;
    p.spawnProtectUntil = 0;
    // validate origin
    const eye = eyePosition(p);
    let o = origin;
    if (!o || !o.every(Number.isFinite) || Math.hypot(o[0] - eye[0], o[1] - eye[1], o[2] - eye[2]) > 1.5) o = eye;
    const t = clamp(Number.isFinite(ts) ? ts : now, now - MAX_LAG_COMP, now);
    const ends = [];
    const n = Math.min(dirs.length, w.pellets);
    for (let i = 0; i < n; i++) {
      let d = dirs[i];
      if (!Array.isArray(d) || !d.every(Number.isFinite)) continue;
      const l = Math.hypot(d[0], d[1], d[2]);
      if (l < 1e-6) continue;
      d = [d[0] / l, d[1] / l, d[2] / l];
      const r = this.traceBullet(p, w, o, d, t);
      ends.push(r);
    }
    this.game.broadcast({ t: 'fire', id: p.id, w: w.id, o: o.map(r2), e: ends }, fromBot ? null : p);
    // bots hear gunfire
    for (const b of this.players.values()) if (b.brain && b !== p) b.brain.hearShot(p, o);
    return true;
  }

  // Returns [x,y,z, nx,ny,nz, surface]
  traceBullet(shooter, w, o, d, t) {
    const range = w.range;
    const walls = this.world.raycastAll(o[0], o[1], o[2], d[0], d[1], d[2], range);
    const hits = [];
    for (const q of this.players.values()) {
      if (q === shooter || !this.inMatch(q)) continue;
      const st = this.stateAt(q, t);
      if (!st || !st.alive) continue;
      const r = rayHitPlayer(o[0], o[1], o[2], d[0], d[1], d[2], range, st);
      if (r) hits.push({ t: r.t, zone: r.zone, player: q });
    }
    hits.sort((a, b) => a.t - b.t);
    let power = w.pen;
    let mul = 1;
    let wallbang = false;
    let wi = 0, hi = 0;
    let end = { t: range, n: [0, 0, 0], surface: 0 };
    while (wi < walls.length || hi < hits.length) {
      const wall = walls[wi], hit = hits[hi];
      if (wall && (!hit || wall.t <= hit.t)) {
        wi++;
        const info = materialInfo(wall.box.mat);
        if (wall.box.destructible) this.damageWall(wall.box, w.damage * w.wallDmg * mul * 0.5);
        const thick = wall.tOut - wall.t;
        const cost = thick * info.pen;
        if (!(cost < power)) {
          end = { t: wall.t, n: wall.n, surface: SURFACE_IDX[info.surface] ?? 0 };
          break;
        }
        power -= cost;
        mul *= w.pen >= 2 ? 0.8 : 0.62;
        wallbang = true;
      } else {
        hi++;
        const q = hit.player;
        if (!this.enemies(shooter, q) && !this.settings.friendlyFire) continue;
        const dmg = computeDamage(w, hit.t, hit.zone, q);
        let hp = dmg.health * mul;
        if (!this.enemies(shooter, q)) hp *= 0.35;
        const point = [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t];
        this.applyDamage(q, hp, dmg.armor * mul, shooter, w.id, { hs: hit.zone === 'head', wallbang, from: o, point });
        end = { t: hit.t, n: [-d[0], -d[1], -d[2]], surface: SURFACE_IDX.flesh, player: q.id };
        break;
      }
    }
    const ep = [o[0] + d[0] * end.t, o[1] + d[1] * end.t, o[2] + d[2] * end.t];
    return [r2(ep[0]), r2(ep[1]), r2(ep[2]), end.n[0], end.n[1], end.n[2], end.surface];
  }

  stateAt(q, t) {
    const h = q.hist;
    if (!h || !h.length) return { x: q.x, y: q.y, z: q.z, yaw: q.yaw, crouch: q.crouch, lean: q.lean, alive: q.alive };
    if (t >= h[h.length - 1].t) {
      const last = h[h.length - 1];
      return { ...last, alive: q.alive && last.alive };
    }
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (a.t <= t && t <= b.t) {
        const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
        return {
          x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k,
          yaw: b.yaw, crouch: a.crouch + (b.crouch - a.crouch) * k, lean: a.lean + (b.lean - a.lean) * k,
          alive: a.alive && q.alive,
        };
      }
    }
    return { ...h[0], alive: h[0].alive && q.alive };
  }

  onKnife(p, m) {
    const now = this.now;
    if (!this.canFight(p) || p.cur !== 'knife') return;
    const w = WEAPONS.knife;
    const heavy = !!m.heavy;
    if (now < p.deployUntil - 80 || now < p.nextFire - 40) return;
    p.nextFire = now + (heavy ? w.heavyInterval : w.interval) * 1000 * 0.9;
    p.spawnProtectUntil = 0;
    let d = m.d;
    if (!Array.isArray(d) || !d.every(Number.isFinite)) d = viewDir(p.yaw, p.pitch);
    const l = Math.hypot(...d) || 1;
    d = d.map((v) => v / l);
    this.knifeAttack(p, d, heavy, clamp(Number.isFinite(m.ts) ? m.ts : now, now - MAX_LAG_COMP, now));
  }

  knifeAttack(p, d, heavy, t) {
    const w = WEAPONS.knife;
    const o = eyePosition(p);
    const wall = this.world.raycast(o[0], o[1], o[2], d[0], d[1], d[2], w.range);
    const maxT = wall ? wall.t : w.range;
    let best = null;
    for (const q of this.players.values()) {
      if (q === p || !this.inMatch(q)) continue;
      const st = this.stateAt(q, t);
      if (!st.alive) continue;
      // slightly generous: test a few rays in a small cone
      for (const off of [[0, 0], [0.12, 0], [-0.12, 0], [0, -0.15]]) {
        const dd = [d[0] + off[0] * Math.cos(p.yaw), d[1] + off[1], d[2] - off[0] * Math.sin(p.yaw)];
        const ll = Math.hypot(...dd);
        const r = rayHitPlayer(o[0], o[1], o[2], dd[0] / ll, dd[1] / ll, dd[2] / ll, maxT, st);
        if (r && (!best || r.t < best.t)) best = { t: r.t, q, st, zone: r.zone };
      }
    }
    if (best && (this.enemies(p, best.q) || this.settings.friendlyFire)) {
      const q = best.q;
      const f = [-Math.sin(best.st.yaw), -Math.cos(best.st.yaw)];
      const to = [q.x - p.x, q.z - p.z];
      const tl = Math.hypot(...to) || 1;
      const back = (f[0] * to[0] + f[1] * to[1]) / tl > 0.45;
      let dmg = back ? (heavy ? w.heavyBackstab : w.backstab) : (heavy ? w.heavyDamage : w.damage);
      if (!this.enemies(p, q)) dmg *= 0.35;
      const armorFactor = q.armor > 0 ? 0.85 : 1;
      this.applyDamage(q, dmg * armorFactor, q.armor > 0 ? dmg * 0.15 : 0, p, 'knife', { hs: false, from: o, knife: true });
      this.game.broadcast({ t: 'snd', s: 'knifehit', id: p.id, p: [r2(q.x), r2(q.y + 1.2), r2(q.z)] });
    } else if (wall) {
      if (wall.box.destructible) this.damageWall(wall.box, heavy ? 100 : 50);
      const ep = [o[0] + d[0] * wall.t, o[1] + d[1] * wall.t, o[2] + d[2] * wall.t];
      this.game.broadcast({ t: 'snd', s: 'knifewall', id: p.id, p: ep.map(r2), n: wall.n, m: SURFACE_IDX[materialInfo(wall.box.mat).surface] ?? 0 });
    } else {
      this.game.broadcast({ t: 'snd', s: 'knifeswing', id: p.id }, p);
    }
  }

  onThrow(p, m) {
    if (!this.canFight(p)) return;
    const type = p.cur;
    if (!GRENADES.includes(type) || !(p.inv.nades[type] > 0)) return;
    const now = this.now;
    if (now < p.deployUntil - 80) return;
    const w = WEAPONS[type];
    p.inv.nades[type]--;
    p.spawnProtectUntil = 0;
    const eye = eyePosition(p);
    let o = m.o;
    if (!Array.isArray(o) || !o.every(Number.isFinite) || Math.hypot(o[0] - eye[0], o[1] - eye[1], o[2] - eye[2]) > 1.5) o = eye;
    let v = m.v;
    if (!Array.isArray(v) || !v.every(Number.isFinite)) v = viewDir(p.yaw, p.pitch).map((x) => x * 16);
    const sp = Math.hypot(...v);
    if (sp > 26) v = v.map((x) => (x * 26) / sp);
    // make sure the start point isn't inside a wall
    const dir = viewDir(p.yaw, p.pitch);
    const hit = this.world.raycast(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], 0.5);
    if (hit) o = eye;
    const g = {
      id: this.nextEnt++, type, thrower: p.id, team: p.team,
      x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2],
      explodeAt: now + w.fuse * 1000, restTime: 0, maxAt: now + 6000,
    };
    this.grenades.push(g);
    this.game.broadcast({ t: 'snd', s: 'throw', id: p.id, g: type });
    // switch to the next available item
    const next = p.inv.nades[type] > 0 ? type : p.inv.primary ? 'primary' : p.inv.secondary ? 'secondary' : 'knife';
    p.cur = next;
    p.deployUntil = now + 500;
    this.sendYou(p);
  }

  onDrop(p) {
    if (!p.alive || this.mode === 'gungame') return;
    if (p.cur === 'bomb') { this.dropBomb(p, true); p.cur = p.inv.primary ? 'primary' : p.inv.secondary ? 'secondary' : 'knife'; this.sendYou(p); return; }
    if (p.cur !== 'primary' && p.cur !== 'secondary') return;
    this.dropWeapon(p, p.cur, true);
    p.cur = p.inv.primary ? 'primary' : p.inv.secondary ? 'secondary' : 'knife';
    p.reloadUntil = 0;
    p.deployUntil = this.now + 500;
    this.sendYou(p);
  }

  // ------------------------------------------------------------------ buying

  canBuy(p) {
    if (!p.alive) return false;
    if (this.mode === 'gungame') return false;
    if (this.modeInfo.economy) {
      if (this.now > this.roundStart + this.settings.buyTime * 1000) return false;
      if (this.phase !== 'freeze' && this.phase !== 'live') return false;
      const zone = this.map.zones[p.team === TEAM.ATT ? 'att' : 'def'];
      return inZone(zone, p.x, p.y, p.z);
    }
    return this.now < (p.buyUntil || 0);
  }

  onBuy(p, item) {
    if (!this.canBuy(p)) return;
    const free = !this.modeInfo.economy;
    let price = itemPrice(item);
    if (!Number.isFinite(price)) return;
    const w = WEAPONS[item];
    if (w) {
      if (w.slot === 'primary' || w.slot === 'secondary') {
        if (p.inv[w.slot]?.id === item) return;
        if (!free && p.money < price) return;
        if (p.inv[w.slot]) {
          if (free) p.inv[w.slot] = null;
          else this.dropWeapon(p, w.slot, false);
        }
        p.inv[w.slot] = makeWeapon(item);
        p.cur = w.slot;
        p.reloadUntil = 0;
        p.deployUntil = this.now + w.deploy * 1000;
        if (free) p.loadout[w.slot] = item;
      } else if (w.slot === 'grenade') {
        const total = GRENADES.reduce((s, g) => s + p.inv.nades[g], 0);
        if (p.inv.nades[item] >= w.max || total >= 4) return;
        if (!free && p.money < price) return;
        p.inv.nades[item]++;
      } else return;
    } else if (item === 'kevlar') {
      if (p.armor >= 100) return;
      if (!free && p.money < price) return;
      p.armor = 100;
    } else if (item === 'helmet') {
      if (p.armor >= 100 && p.helmet) return;
      if (p.armor >= 100) price = 350;
      if (!free && p.money < price) return;
      p.armor = 100;
      p.helmet = true;
    } else if (item === 'kit') {
      if (p.team !== TEAM.DEF || p.kit || this.mode !== 'defuse') return;
      if (!free && p.money < price) return;
      p.kit = true;
    } else return;
    if (!free) p.money -= price;
    this.sendYou(p);
  }

  // ------------------------------------------------------------------ damage

  applyDamage(target, health, armorDmg, attacker, weaponId, opts = {}) {
    if (!target.alive) return;
    const now = this.now;
    if (target.spawnProtectUntil > now) return;
    const before = target.hp;
    target.hp -= health;
    target.armor = Math.max(0, target.armor - armorDmg);
    if (target.armor <= 0) target.helmet = false;
    const dealt = Math.min(before, health);
    if (attacker && attacker !== target) {
      attacker.stats.dmg += dealt;
      attacker.roundDmg = (attacker.roundDmg || 0) + dealt;
      target.dmgTaken.set(attacker.id, (target.dmgTaken.get(attacker.id) || 0) + dealt);
    }
    const from = opts.from || (attacker ? [attacker.x, attacker.y + 1.5, attacker.z] : [target.x, target.y, target.z]);
    this.game.send(target, { t: 'dmg', from: from.map(r2), amt: Math.round(dealt), hp: Math.max(0, Math.round(target.hp)), armor: Math.round(target.armor) });
    const killed = target.hp <= 0;
    if (attacker && attacker !== target) {
      this.game.send(attacker, { t: 'hit', dmg: Math.round(dealt), hs: !!opts.hs, kill: killed, id: target.id, armor: target.armor > 0, p: opts.point ? opts.point.map(r2) : null });
    }
    if (target.brain) target.brain.onDamaged(attacker, from);
    if (killed) this.kill(target, attacker, weaponId, opts);
  }

  kill(target, attacker, weaponId, opts = {}) {
    if (!target.alive) return;
    const now = this.now;
    target.alive = false;
    target.hp = 0;
    target.plantEnd = 0;
    target.defuseEnd = 0;
    target.using = false;
    target.reloadUntil = 0;
    target.stats.d++;
    target.diedAt = now;
    let assister = null;
    const enemyKill = attacker && attacker !== target && this.enemies(attacker, target);
    if (attacker && attacker !== target) {
      if (enemyKill) {
        attacker.stats.k++;
        attacker.roundKills = (attacker.roundKills || 0) + 1;
        attacker.stats.score += 2;
        if (opts.hs) attacker.stats.hs++;
        if (this.modeInfo.economy) this.addMoney(attacker, WEAPONS[weaponId]?.killReward ?? 300);
        if (this.mode === 'tdm') this.score[attacker.team]++;
      } else {
        attacker.stats.k--;
        attacker.stats.score -= 2;
        if (this.modeInfo.economy) this.addMoney(attacker, -300);
      }
      let bestDmg = 40;
      for (const [id, dmg] of target.dmgTaken) {
        if (id === attacker.id) continue;
        const q = this.players.get(id);
        if (q && dmg >= bestDmg && this.enemies(q, target)) { bestDmg = dmg; assister = q; }
      }
      if (assister) { assister.stats.a++; assister.stats.score += 1; }
    } else if (!attacker) {
      target.stats.score -= 1;
    }
    this.dropAll(target);
    this.game.broadcast({
      t: 'kill', k: attacker ? attacker.id : null, v: target.id, w: weaponId, hs: !!opts.hs, wb: !!opts.wallbang,
      a: assister ? assister.id : null, p: [r2(target.x), r2(target.y), r2(target.z)],
    });
    for (const b of this.players.values()) if (b.brain) b.brain.onKill(attacker, target);
    this.sendYou(target);
    if (attacker && attacker !== target) this.sendYou(attacker);

    if (this.mode === 'defuse') {
      this.checkRoundEnd();
    } else {
      if (this.phase !== 'ended') target.respawnAt = now + 2500;
      if (this.mode === 'gungame' && enemyKill) this.gunGameProgress(attacker, target, weaponId);
      if (this.mode === 'tdm' && enemyKill && this.score[attacker.team] >= this.settings.scoreLimit) this.endMatch(attacker.team, 'score');
      if (this.mode === 'ffa' && enemyKill && attacker.stats.k >= this.settings.scoreLimit) this.endMatch(0, 'score');
    }
    this.sendScoreboard();
  }

  gunGameProgress(attacker, victim, weaponId) {
    const last = GUNGAME_ORDER.length - 1;
    if (weaponId === 'knife' && victim.ggLevel > 0) {
      victim.ggLevel--;
    }
    if (attacker.ggLevel >= last) {
      if (weaponId === 'knife') {
        attacker.ggLevel = last + 1;
        this.endMatch(0, 'gungame');
      }
      return;
    }
    const cur = GUNGAME_ORDER[attacker.ggLevel];
    if (weaponId === cur || weaponId === 'knife' || weaponId === 'frag') {
      attacker.ggLevel++;
      if (attacker.alive) this.giveGunGameWeapon(attacker);
      this.game.send(attacker, { t: 'gg', level: attacker.ggLevel, w: GUNGAME_ORDER[attacker.ggLevel] });
    }
  }

  damageWall(box, amount) {
    if (!box.active || !box.destructible) return;
    box.hp -= amount;
    if (box.hp <= 0) {
      box.hp = 0;
      box.active = false;
    }
    this.wallUpdates.set(box.id, box.hp);
  }

  // ------------------------------------------------------------------ drops & bomb

  dropAll(p) {
    if (p.inv.bomb) this.dropBomb(p);
    if (this.mode === 'gungame') return;
    if (p.inv.primary) this.dropWeapon(p, 'primary', false);
    else if (p.inv.secondary && p.inv.secondary.id !== DEFAULT_PISTOL[p.team]) this.dropWeapon(p, 'secondary', false);
  }

  dropPoint(p, thrown) {
    const f = viewDir(p.yaw, 0);
    let x = p.x + (thrown ? f[0] * 1.2 : 0), z = p.z + (thrown ? f[2] * 1.2 : 0);
    const y0 = p.y + 1.0;
    if (thrown && !this.world.lineOfSight(p.x, y0, p.z, x, y0, z)) { x = p.x; z = p.z; }
    const y = this.world.groundBelow(x, y0, z, 30);
    return [x, y, z];
  }

  dropWeapon(p, slot, thrown) {
    const it = p.inv[slot];
    if (!it) return;
    p.inv[slot] = null;
    const [x, y, z] = this.dropPoint(p, thrown);
    const d = { id: this.nextEnt++, wid: it.id, mag: it.mag, reserve: it.reserve, x, y, z, t: this.now, by: p.id };
    this.drops.push(d);
    if (this.drops.length > 40) {
      const old = this.drops.shift();
      this.game.broadcast({ t: 'drop-', id: old.id });
    }
    this.game.broadcast({ t: 'drop+', d: [d.id, d.wid, r2(x), r2(y), r2(z)] });
  }

  dropBomb(p, thrown = false) {
    if (!p.inv.bomb || !this.bomb) return;
    p.inv.bomb = false;
    const [x, y, z] = this.dropPoint(p, thrown);
    Object.assign(this.bomb, { state: 'dropped', carrier: null, x, y, z, droppedAt: this.now, droppedBy: p.id });
    this.game.broadcast({ t: 'bombinfo', b: this.bombInfo() });
  }

  bombInfo() {
    const b = this.bomb;
    if (!b) return null;
    return { state: b.state, carrier: b.carrier ?? null, p: [r2(b.x), r2(b.y), r2(b.z)], site: b.site ?? null, explodeAt: b.explodeAt ?? 0, defuser: b.defuser ?? null, defuseEnd: b.defuseEnd ?? 0 };
  }

  autoPickup(p) {
    const now = this.now;
    if (this.bomb && this.bomb.state === 'dropped' && p.team === TEAM.ATT && this.mode === 'defuse') {
      const b = this.bomb;
      if (Math.hypot(b.x - p.x, b.z - p.z) < 1.1 && Math.abs(b.y - p.y) < 1.6 && !(b.droppedBy === p.id && now - b.droppedAt < 1500)) {
        p.inv.bomb = true;
        Object.assign(b, { state: 'carried', carrier: p.id });
        this.game.broadcast({ t: 'bombinfo', b: this.bombInfo() });
        this.game.send(p, { t: 'snd', s: 'pickup', w: 'bomb' });
        this.sendYou(p);
      }
    }
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (d.by === p.id && now - d.t < 1500) continue;
      if (Math.hypot(d.x - p.x, d.z - p.z) > 1.1 || Math.abs(d.y - p.y) > 1.6) continue;
      const slot = WEAPONS[d.wid].slot;
      if (p.inv[slot]) continue;
      this.pickUp(p, d, i);
      return;
    }
  }

  pickUp(p, d, i) {
    const slot = WEAPONS[d.wid].slot;
    p.inv[slot] = { id: d.wid, mag: d.mag, reserve: d.reserve };
    this.drops.splice(i, 1);
    this.game.broadcast({ t: 'drop-', id: d.id });
    this.game.send(p, { t: 'snd', s: 'pickup', w: d.wid });
    this.sendYou(p);
  }

  onUse(p, on) {
    p.using = !!on;
    if (!on) { p.plantEnd = 0; this.cancelDefuse(p); return; }
    if (!p.alive) return;
    // swap with a weapon on the floor we're looking at
    const eye = eyePosition(p);
    const dir = viewDir(p.yaw, p.pitch);
    let best = null, bestD = USE_RANGE + 0.5;
    this.drops.forEach((d, i) => {
      const dx = d.x - eye[0], dy = d.y + 0.1 - eye[1], dz = d.z - eye[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist > USE_RANGE + 0.6) return;
      const dot = (dx * dir[0] + dy * dir[1] + dz * dir[2]) / dist;
      if (dot > 0.8 && dist < bestD) { bestD = dist; best = i; }
    });
    const nearBomb = this.bomb && this.bomb.state === 'planted' && p.team === TEAM.DEF;
    if (best != null && !nearBomb && this.mode !== 'gungame') {
      const d = this.drops[best];
      const slot = WEAPONS[d.wid].slot;
      if (p.inv[slot]) this.dropWeapon(p, slot, true);
      this.pickUp(p, d, this.drops.indexOf(d));
      p.cur = slot;
      p.deployUntil = this.now + WEAPONS[d.wid].deploy * 1000;
      p.reloadUntil = 0;
      this.sendYou(p);
      p.using = false;
    }
  }

  plantZone(p) {
    if (inZone(this.map.zones.A, p.x, p.y, p.z)) return 'A';
    if (inZone(this.map.zones.B, p.x, p.y, p.z)) return 'B';
    return null;
  }

  updateUse(p, now) {
    if (this.mode !== 'defuse' || !this.bomb) return;
    const b = this.bomb;
    // planting
    if (p.team === TEAM.ATT && p.inv.bomb && b.state === 'carried') {
      if (p.using && p.onGround && (this.phase === 'live') && this.plantZone(p)) {
        if (!p.plantEnd) {
          p.plantEnd = now + this.settings.plantTime * 1000;
          p.plantPos = [p.x, p.z];
          this.game.broadcast({ t: 'bomb', ev: 'planting', id: p.id, endsAt: p.plantEnd });
        } else if (Math.hypot(p.x - p.plantPos[0], p.z - p.plantPos[1]) > 0.6) {
          p.plantEnd = 0;
          this.game.broadcast({ t: 'bomb', ev: 'cancel', id: p.id });
        } else if (now >= p.plantEnd) {
          this.plant(p);
        }
      } else if (p.plantEnd) {
        p.plantEnd = 0;
        this.game.broadcast({ t: 'bomb', ev: 'cancel', id: p.id });
      }
    }
    // defusing
    if (p.team === TEAM.DEF && b.state === 'planted' && this.phase === 'planted') {
      const dist = Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
      if (p.using && dist < USE_RANGE + 0.3 && p.onGround) {
        if (!p.defuseEnd && !b.defuser) {
          p.defuseEnd = now + (p.kit ? this.settings.kitDefuseTime : this.settings.defuseTime) * 1000;
          b.defuser = p.id;
          b.defuseEnd = p.defuseEnd;
          this.game.broadcast({ t: 'bomb', ev: 'defusing', id: p.id, endsAt: p.defuseEnd, kit: p.kit });
        } else if (p.defuseEnd && now >= p.defuseEnd) {
          this.defuse(p);
        }
      } else if (p.defuseEnd) {
        this.cancelDefuse(p);
      }
    }
  }

  cancelDefuse(p) {
    if (!p.defuseEnd) return;
    p.defuseEnd = 0;
    if (this.bomb && this.bomb.defuser === p.id) {
      this.bomb.defuser = null;
      this.bomb.defuseEnd = 0;
      this.game.broadcast({ t: 'bomb', ev: 'cancel', id: p.id });
    }
  }

  plant(p) {
    const now = this.now;
    p.plantEnd = 0;
    p.using = false;
    p.inv.bomb = false;
    const site = this.plantZone(p);
    Object.assign(this.bomb, {
      state: 'planted', carrier: null, x: p.x, y: p.y, z: p.z, site, planter: p.id,
      plantedAt: now, explodeAt: now + this.settings.bombTime * 1000, defuser: null, defuseEnd: 0,
    });
    this.phase = 'planted';
    this.phaseEnd = this.bomb.explodeAt;
    this.addMoney(p, ECONOMY.plantBonusPlayer);
    p.stats.score += 2;
    p.cur = p.inv.primary ? 'primary' : p.inv.secondary ? 'secondary' : 'knife';
    this.sendYou(p);
    this.game.broadcast({ t: 'bomb', ev: 'planted', id: p.id, site, p: [r2(p.x), r2(p.y), r2(p.z)], explodeAt: this.bomb.explodeAt });
    this.game.broadcast({ t: 'bombinfo', b: this.bombInfo() });
    this.broadcastRound();
    for (const b of this.players.values()) if (b.brain) b.brain.onBombPlanted();
    this.checkRoundEnd();
  }

  defuse(p) {
    p.defuseEnd = 0;
    p.using = false;
    this.bomb.state = 'defused';
    this.addMoney(p, ECONOMY.defuseBonusPlayer);
    p.stats.score += 2;
    this.game.broadcast({ t: 'bomb', ev: 'defused', id: p.id });
    this.game.broadcast({ t: 'bombinfo', b: this.bombInfo() });
    this.endRound(TEAM.DEF, 'defused');
  }

  updateBomb(now) {
    const b = this.bomb;
    if (!b) return;
    if (b.state === 'carried') {
      const c = this.players.get(b.carrier);
      if (!c || !c.alive || !c.inv.bomb) {
        if (c && c.inv.bomb) this.dropBomb(c);
        else if (!c || !c.alive) { b.state = 'dropped'; this.game.broadcast({ t: 'bombinfo', b: this.bombInfo() }); }
      } else { b.x = c.x; b.y = c.y; b.z = c.z; }
    }
    if (b.state === 'planted' && this.phase === 'planted' && now >= b.explodeAt) {
      b.state = 'exploded';
      this.game.broadcast({ t: 'bomb', ev: 'exploded', p: [r2(b.x), r2(b.y), r2(b.z)] });
      const planter = this.players.get(b.planter);
      for (const q of this.players.values()) {
        if (!q.alive) continue;
        const d = Math.hypot(q.x - b.x, q.y - b.y, q.z - b.z);
        if (d > BOMB_RADIUS * 1.4) continue;
        const dmg = BOMB_DAMAGE * Math.exp(-((d / (BOMB_RADIUS * 0.45)) ** 2));
        if (dmg < 1) continue;
        this.applyDamage(q, q.armor > 0 ? dmg * 0.7 : dmg, dmg * 0.3, planter && this.enemies(planter, q) ? planter : null, 'bomb', { from: [b.x, b.y + 0.3, b.z] });
      }
      this.endRound(TEAM.ATT, 'bomb');
    }
  }

  // ------------------------------------------------------------------ grenades

  updateGrenades(dt, now) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (const g of this.grenades) {
      for (let s = 0; s < steps; s++) this.stepGrenade(g, h);
      const speed = Math.hypot(g.vx, g.vy, g.vz);
      if (speed < 0.4 && g.resting) g.restTime += dt; else g.restTime = 0;
      const w = WEAPONS[g.type];
      if (g.type === 'smoke') {
        if (g.restTime > 0.25 || now >= g.maxAt) g.detonate = true;
      } else if (now >= g.explodeAt) g.detonate = true;
    }
    const done = this.grenades.filter((g) => g.detonate);
    this.grenades = this.grenades.filter((g) => !g.detonate);
    for (const g of done) this.detonate(g, now);
  }

  stepGrenade(g, h) {
    g.vy -= 15 * h;
    const box = (x, y, z) => this.world.overlaps(x - GRENADE_R, y - GRENADE_R, z - GRENADE_R, x + GRENADE_R, y + GRENADE_R, z + GRENADE_R);
    g.resting = false;
    // move per axis and bounce
    const axes = [['x', 'vx'], ['z', 'vz'], ['y', 'vy']];
    for (const [a, va] of axes) {
      const dv = g[va] * h;
      if (!dv) continue;
      const old = g[a];
      g[a] += dv;
      if (box(g.x, g.y, g.z)) {
        g[a] = old;
        const impact = Math.abs(g[va]);
        if (a === 'y') {
          if (g.vy < 0) g.resting = true;
          g.vy = -g.vy * 0.35;
          g.vx *= 0.7; g.vz *= 0.7;
          if (Math.abs(g.vy) < 1.0) g.vy = 0;
        } else {
          g[va] = -g[va] * 0.45;
          g.vy *= 0.9;
        }
        if (impact > 2.5 && (!g.lastBounce || this.now - g.lastBounce > 90)) {
          g.lastBounce = this.now;
          this.game.broadcast({ t: 'snd', s: 'bounce', p: [r2(g.x), r2(g.y), r2(g.z)], g: g.type });
        }
      }
    }
    if (g.y < -10) { g.y = -10; g.vy = 0; g.resting = true; }
  }

  detonate(g, now) {
    const p = [r2(g.x), r2(g.y), r2(g.z)];
    const thrower = this.players.get(g.thrower) || null;
    if (g.type === 'frag') {
      const w = WEAPONS.frag;
      this.game.broadcast({ t: 'nade', type: 'frag', p });
      for (const q of this.players.values()) {
        if (!q.alive || !this.inMatch(q)) continue;
        const cx = q.x, cy = q.y + heightFor(q.crouch) * 0.6, cz = q.z;
        const d = Math.hypot(cx - g.x, cy - g.y, cz - g.z);
        if (d > w.radius) continue;
        let mul = 1;
        const hits = this.world.raycastAll(g.x, g.y, g.z, (cx - g.x) / d, (cy - g.y) / d, (cz - g.z) / d, d);
        let blocked = false;
        for (const hh of hits) {
          if (hh.box.destructible) mul *= 0.5;
          else { blocked = true; break; }
        }
        if (blocked) continue;
        const friendly = thrower && !this.enemies(thrower, q) && q !== thrower;
        if (friendly && !this.settings.friendlyFire) continue;
        let dmg = w.damage * Math.pow(1 - d / w.radius, 1.4) * mul;
        if (friendly) dmg *= 0.35;
        if (dmg < 1) continue;
        const armored = q.armor > 0;
        this.applyDamage(q, armored ? dmg * 0.6 : dmg, armored ? dmg * 0.4 : 0, thrower, 'frag', { from: [g.x, g.y, g.z] });
      }
      // blow up nearby breakable panels
      for (const id of this.map.destructibles) {
        const b = this.world.byId.get(id);
        if (!b.active) continue;
        const bx = (b.min[0] + b.max[0]) / 2, by = (b.min[1] + b.max[1]) / 2, bz = (b.min[2] + b.max[2]) / 2;
        const d = Math.hypot(bx - g.x, by - g.y, bz - g.z);
        if (d < 3.8) this.damageWall(b, 420 * (1 - d / 3.8) + 20);
      }
    } else if (g.type === 'flash') {
      this.game.broadcast({ t: 'nade', type: 'flash', p });
      for (const q of this.players.values()) {
        if (!q.alive || !this.inMatch(q)) continue;
        const eye = eyePosition(q);
        const dx = g.x - eye[0], dy = g.y - eye[1], dz = g.z - eye[2];
        const d = Math.hypot(dx, dy, dz);
        if (d > 40) continue;
        if (!this.world.lineOfSight(g.x, g.y, g.z, eye[0], eye[1], eye[2])) continue;
        if (this.smokeBlocks([g.x, g.y, g.z], eye)) continue;
        const v = viewDir(q.yaw, q.pitch);
        const dot = (dx * v[0] + dy * v[1] + dz * v[2]) / (d || 1);
        let dur;
        if (dot > 0.6) dur = 4.6;
        else if (dot > 0.1) dur = 3.0;
        else if (dot > -0.4) dur = 1.6;
        else dur = 0.8;
        dur *= clamp(1.25 - d / 32, 0.25, 1);
        if (dur < 0.3) continue;
        q.blindUntil = Math.max(q.blindUntil || 0, now + dur * 1000);
        this.game.send(q, { t: 'flashed', dur: Math.round(dur * 100) / 100, amt: dot > 0.1 ? 1 : 0.7 });
        if (q.brain) q.brain.onFlashed(dur);
      }
    } else if (g.type === 'smoke') {
      const w = WEAPONS.smoke;
      const s = { id: g.id, x: g.x, y: g.y, z: g.z, start: now, until: now + w.duration * 1000, radius: w.radius };
      this.smokes.push(s);
      this.game.broadcast({ t: 'nade', type: 'smoke', id: s.id, p, until: s.until, start: s.start });
    }
  }

  // Does any smoke block the segment a->b?
  smokeBlocks(a, b) {
    const now = this.now;
    for (const s of this.smokes) {
      const grow = clamp((now - s.start) / 1500, 0.2, 1);
      const fade = clamp((s.until - now) / 2000, 0, 1);
      const r = s.radius * grow * (fade > 0.3 ? 1 : fade / 0.3);
      if (r < 0.5) continue;
      const cy = s.y + r * 0.45;
      if (segmentSphere(a, b, [s.x, cy, s.z], r)) return true;
    }
    return false;
  }
}

function segmentSphere(a, b, c, r) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const fx = a[0] - c[0], fy = a[1] - c[1], fz = a[2] - c[2];
  const A = dx * dx + dy * dy + dz * dz;
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const C = fx * fx + fy * fy + fz * fz - r * r;
  if (C < 0) return true;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return false;
  const sq = Math.sqrt(disc);
  const t1 = (-B - sq) / (2 * A), t2 = (-B + sq) / (2 * A);
  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
}

export function emptyInventory() {
  return { primary: null, secondary: null, nades: { frag: 0, flash: 0, smoke: 0 }, bomb: false };
}

export function makeWeapon(id) {
  const w = WEAPONS[id];
  return { id, mag: w.mag ?? 0, reserve: w.reserve ?? 0 };
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export { segmentSphere, rayBox };
