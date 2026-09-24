// Client-side match: local player simulation, weapons, remote players, world state and feedback.

import * as THREE from 'three';
import {
  TEAM, TEAM_NAMES, PLAYER, FLAG, INTERP_DELAY, USE_RANGE, MODES, DEG, WEATHER,
  clamp, lerp, angleLerp, wrapAngle, viewDir, isEnemy, TAG_MS, tagSlow,
} from '../shared/constants.js';
import { WEAPONS, GRENADES, computeSpread, applySpread, recoilDelta, GUNGAME_ORDER } from '../shared/weapons.js';
import { loadMap } from '../shared/maps/index.js';
import { inZone } from '../shared/maps/builder.js';
import { PhysicsWorld, stepPlayer, eyePosition, leanClearance, rayHitPlayer, heightFor } from '../shared/physics.js';
import { materialInfo } from '../shared/materials.js';
import { TextureLibrary } from './textures.js';
import { WorldView } from './world.js';
import { Decor } from './decor.js';
import { Effects } from './effects.js';
import { ViewModel } from './viewmodel.js';
import { PlayerModel, teamLook, weaponTemplate, bakedWeapon } from './models.js';
import { Radar, esc } from './hud.js';
import { Weather, weatherTheme } from './weather.js';
import { Flashlights, nightTheme } from './night.js';

const SURFACE_IDX = { stone: 0, wood: 1, metal: 2, sand: 3 };
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class ClientGame {
  constructor(ctx) {
    Object.assign(this, ctx); // graphics, input, audio, hud, ui, net, settings
    this.g = this.graphics;
    this.tex = null;
    this.active = false;
    this.lobbyPlayers = new Map();
    this.players = new Map();
    this.grenades = new Map();
    this.stuck = new Map();
    this.drops = new Map();
    this.sb = null;
  }

  // ------------------------------------------------------------------ lifecycle
  async start(msg, myId) {
    this.stop();
    this.myId = myId;
    this.mode = msg.mode;
    this.modeInfo = MODES[msg.mode];
    this.matchSettings = msg.settings;
    this.ffa = msg.mode === 'ffa' || msg.mode === 'gungame';
    this.map = loadMap(msg.map);
    this.weatherId = msg.weather || 'clear';
    this.map.theme = weatherTheme(this.map.theme, this.weatherId); // before the environment is set up
    this.night = !!msg.night;
    if (this.night) this.map.theme = nightTheme(this.map.theme);
    this.lightOn = true;
    this.lightHintUntil = performance.now() + 25000;
    this.world = new PhysicsWorld(this.map.boxes, this.map.bounds);
    if (!this.tex || this.tex.quality !== this.g.quality) {
      this.tex = new TextureLibrary(this.g.renderer, this.g.quality);
      this.tex.quality = this.g.quality;
    }
    const mats = [...new Set([...this.map.boxes.map((b) => b.mat), 'woodPanel', 'lamp', 'barrel', 'metal', this.map.decor?.trim || this.map.mats.building || 'concrete'])];
    const t0 = performance.now();
    const wx = (this.weatherId !== 'clear' && WEATHER[this.weatherId] ? ` · ${WEATHER[this.weatherId].name}` : '') + (this.night ? ' · Night' : '');
    await this.tex.prepare(mats, (f) => { document.getElementById('loading-text').textContent = `Building ${this.map.name}${wx}… ${Math.round(f * 100)}%`; });
    const t1 = performance.now();
    this.g.setupEnvironment(this.map);
    const tEnv = performance.now();
    this.worldView = new WorldView(this.g, this.tex, this.map);
    const t2 = performance.now();
    this.decor = new Decor(this.g, this.tex, this.map);
    this.g.captureEnvironment(this.map, [this.decor.skyline?.group]);
    console.info(`[breachpoint] textures ${Math.round(t1 - t0)} ms, env ${Math.round(tEnv - t1)} ms, world ${Math.round(t2 - tEnv)} ms, decor ${Math.round(performance.now() - t2)} ms (${mats.length} materials, ${this.g.quality}) ${JSON.stringify(this.decor.timings)}`);
    this.effects = new Effects(this.g);
    this.effects.setWorld(this.world);
    this.effects.setAmbient(this.map.theme.motes);
    this.weatherFx = this.weatherFx || new Weather(this.g, this.audio);
    this.weatherFx.setup(this.map, this.world);
    this.torches = this.torches || new Flashlights(this.g, this.audio);
    const wcfg = this.map.theme.weather;
    this.torches.setup(this.night, this.world, wcfg ? (wcfg.id === 'fog' ? 1.6 : wcfg.rain > 0 ? 1 : 0.3) : 0);
    this.audio.isOutdoor = (pos) => !this.worldView.roofedAt(pos[0], pos[2], pos[1] + 0.5);
    this.effects.onCasingBounce = (p, big) => this.audio.casing(p, big);
    this.audio.occlusion = (pos) => {
      const l = this.audio.listener;
      const a = this.world.lineOfSight(l.x, l.y, l.z, pos[0], pos[1], pos[2]);
      const b = this.world.lineOfSight(l.x, l.y, l.z, pos[0], pos[1] + 0.9, pos[2]);
      return a && b ? 0 : a || b ? 0.5 : 1;
    };
    this.viewmodel = this.viewmodel || new ViewModel(this.g);
    this.viewmodel.setVisible(true);
    this.radar = new Radar(document.getElementById('radar'), this.map);
    this.g.camera.layers.enable(0);
    this.g.camera.layers.disable(2);
    this.g.sun.shadow.camera.layers.enable(2);

    const st = msg.state;
    this.phase = st.phase;
    this.round = st.round;
    this.endsAt = st.endsAt;
    this.matchEndsAt = st.matchEndsAt;
    this.score = st.score;
    this.buyEnds = 0;
    this.bomb = st.bomb;
    this.bombModel = null;
    // created up-front: adding a light mid-round would force every lit shader to recompile (a hitch)
    if (!this.bombLight) this.bombLight = new THREE.PointLight(0xff2020, 0, 3, 2);
    this.bombLight.intensity = 0;
    this.g.scene.add(this.bombLight);
    this.nextBeep = 0;
    for (const [id, x, y, z, until, start] of st.smokes || []) this.effects.addSmoke(id, [x, y, z], start, until, this.net.serverNow(), this.smokeTint());
    for (const [id, hp, r] of st.walls || []) this.applyWall(id, hp, false, !!r);
    for (const d of st.drops || []) this.addDrop(d);

    this.me = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, crouch: 0, lean: 0, yaw: 0, pitch: 0,
      alive: false, hp: 0, armor: 0, helmet: false, kit: false, money: 0, team: this.lobbyPlayers.get(myId)?.team ?? 0,
      inv: { primary: null, secondary: null, nades: { frag: 0, flash: 0, smoke: 0, breach: 0 }, bomb: false }, cur: 'knife', gg: 0, buyUntil: 0,
    };
    this.tpId = 0;
    this.w = { nextFire: 0, reloadEnd: 0, deployEnd: 0, shots: 0, lastShot: 0, bloom: 0, punchYaw: 0, punchPitch: 0, ads: 0, adsHeld: false, scope: 0, pin: false, lob: false, lastSlot: 'secondary', dryClick: false, rezoomAt: 0 };
    this.stepDist = 0;
    this.stepSmooth = 0;
    this.shake = 0;
    this.leanToggle = 0;
    this.walkToggle = false;
    this.usingHeld = false;
    this.padUse = false;
    this.deadAt = 0;
    this.killerId = null;
    this.specId = null;
    this.freeCam = null;
    this.flash = { until: 0, start: 0, dur: 0 };
    this.lastSend = 0;
    this.lastLocalFire = 0;
    this.progress = null;
    this.chatOpen = false;
    this.lastMoveSpeed = 0;
    this.visibleEnemies = new Map();
    // own model (shadow only)
    this.ownModel = new PlayerModel(teamLook(this.me.team, myId, this.ffa));
    this.ownModel.setLayer(2);
    this.g.scene.add(this.ownModel.root);
    this.active = true;
    this.audio.startAmbient(this.map.theme.ambientSound);
    this.hud.show(true);
    this.syncPlayers();
    this.g.setFov(this.settings.fov);
    this.onRound({ phase: st.phase, round: st.round, endsAt: st.endsAt, matchEndsAt: st.matchEndsAt, score: st.score, silent: true });
    this.updateBombModel();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.audio.occlusion = null;
    this.audio.isOutdoor = null;
    this.worldView?.dispose();
    this.decor?.dispose();
    this.effects?.dispose();
    this.weatherFx?.dispose();
    this.torches?.dispose();
    this.g.setHurt(0);
    for (const p of this.players.values()) this.g.scene.remove(p.model.root);
    this.players.clear();
    for (const g of this.grenades.values()) this.g.scene.remove(g.mesh);
    this.grenades.clear();
    for (const d of this.drops.values()) this.g.scene.remove(d.mesh);
    this.drops.clear();
    if (this.bombModel) this.g.scene.remove(this.bombModel);
    if (this.ownModel) this.g.scene.remove(this.ownModel.root);
    this.audio.stopAmbient();
    this.hud.show(false);
    this.hud.scope(false);
    document.body.classList.remove('bodycam');
    this.viewmodel?.setVisible(false);
  }

  smokeTint() {
    return this.map.id === 'arena' ? 0.62 : this.map.id === 'compound' ? 0.72 : 0.85;
  }

  setLobby(players) {
    this.lobbyPlayers = new Map(players.map((p) => [p.id, p]));
    if (this.active) this.syncPlayers();
  }

  syncPlayers() {
    for (const [id, lp] of this.lobbyPlayers) {
      if (id === this.myId) {
        if (this.me.team !== lp.team) {
          this.me.team = lp.team;
          this.rebuildOwnModel();
        }
        continue;
      }
      let rp = this.players.get(id);
      if (rp && rp.team !== lp.team) { this.g.scene.remove(rp.model.root); this.players.delete(id); rp = null; }
      if (!rp && (lp.team === TEAM.ATT || lp.team === TEAM.DEF)) {
        const model = new PlayerModel(teamLook(lp.team, id, this.ffa), lp.name, false);
        model.root.visible = false;
        this.g.scene.add(model.root);
        rp = { id, name: lp.name, team: lp.team, bot: lp.bot, model, snaps: [], state: null, alive: false, weapon: 'knife', stepAcc: 0, lastPos: null, onGround: true, fallStart: 0, deadAt: 0 };
        this.players.set(id, rp);
      }
    }
    for (const [id, rp] of this.players) {
      if (!this.lobbyPlayers.has(id)) { this.g.scene.remove(rp.model.root); this.players.delete(id); }
    }
    this.viewmodel.setLook(teamLook(this.me.team || 1, this.myId, this.ffa));
  }

  rebuildOwnModel() {
    if (this.ownModel) this.g.scene.remove(this.ownModel.root);
    this.ownModel = new PlayerModel(teamLook(this.me.team, this.myId, this.ffa));
    this.ownModel.setLayer(2);
    this.g.scene.add(this.ownModel.root);
    this.viewmodel.setLook(teamLook(this.me.team || 1, this.myId, this.ffa));
  }

  nameOf(id) { return this.lobbyPlayers.get(id)?.name ?? '?'; }
  teamOf(id) { return id === this.myId ? this.me.team : this.lobbyPlayers.get(id)?.team ?? 0; }
  isEnemyId(id) {
    if (id === this.myId) return false;
    if (this.ffa) return true;
    return this.teamOf(id) !== this.me.team;
  }

  // ------------------------------------------------------------------ network handlers
  handle(msg) {
    if (!this.active) return;
    switch (msg.t) {
      case 's': this.onSnapshot(msg); break;
      case 'you': this.onYou(msg); break;
      case 'tp': this.onTeleport(msg); break;
      case 'fire': this.onRemoteFire(msg); break;
      case 'hit': this.onHit(msg); break;
      case 'dmg': this.onDamage(msg); break;
      case 'kill': this.onKill(msg); break;
      case 'walls': for (const [id, hp, r] of msg.d) this.applyWall(id, hp, true, !!r); break;
      case 'report': this.onReport(msg); break;
      case 'reinforce': this.onReinforce(msg); break;
      case 'nade': this.onNade(msg); break;
      case 'flashed': this.onFlashed(msg); break;
      case 'bomb': this.onBombEvent(msg); break;
      case 'bombinfo': this.bomb = msg.b; this.updateBombModel(); break;
      case 'drop+': this.addDrop(msg.d); break;
      case 'drop-': this.removeDrop(msg.id); break;
      case 'sb': this.sb = msg; if (this.ui.isOpen('overlay-scoreboard')) this.renderScoreboard(); break;
      case 'round': this.onRound(msg); break;
      case 'snd': this.onSound(msg); break;
      case 'gg': this.hud.center(`LEVEL ${msg.level + 1}`, WEAPONS[msg.w]?.name || '', 'good', 1.6); this.audio.buy(); break;
      case 'reset': this.onReset(); break;
      default: break;
    }
  }

  onReset() {
    for (const d of this.drops.values()) this.g.scene.remove(d.mesh);
    this.drops.clear();
    for (const g of this.grenades.values()) this.g.scene.remove(g.mesh);
    this.grenades.clear();
    this.effects.reset();
    this.worldView.resetPanels();
    for (const id of this.map.destructibles) { const b = this.world.byId.get(id); if (b) { b.active = true; b.hp = 100; b.reinforced = false; } }
    this.stuck.clear();
    for (const rp of this.players.values()) { rp.model.revive(); rp.deadAt = 0; }
  }

  onSnapshot(msg) {
    const t = msg.ts;
    for (const a of msg.p) {
      const id = a[0];
      if (id === this.myId) {
        this.meServer = a;
        continue;
      }
      const rp = this.players.get(id);
      if (!rp) continue;
      rp.snaps.push({ t, x: a[1], y: a[2], z: a[3], yaw: a[4], pitch: a[5], crouch: a[6], lean: a[7], flags: a[8], w: a[9], hp: a[10] });
      if (rp.snaps.length > 40) rp.snaps.shift();
    }
    const seen = new Set();
    for (const [id, type, x, y, z] of msg.g) {
      seen.add(id);
      let g = this.grenades.get(id);
      if (!g) {
        const mesh = bakedWeapon(type);
        mesh.scale.setScalar(1.3);
        this.g.scene.add(mesh);
        g = { mesh, snaps: [], type };
        this.grenades.set(id, g);
      }
      g.snaps.push({ t, x, y, z });
      if (g.snaps.length > 20) g.snaps.shift();
    }
    for (const [id, g] of this.grenades) {
      if (!seen.has(id)) { this.g.scene.remove(g.mesh); this.grenades.delete(id); }
    }
  }

  onYou(m) {
    const me = this.me;
    const wasAlive = me.alive;
    const prevCur = me.cur;
    const prevId = this.curItemId();
    const recentFire = performance.now() - this.lastLocalFire < 300;
    const localMag = this.curItem()?.[1];
    me.hp = m.hp; me.armor = m.armor; me.helmet = m.helmet; me.kit = m.kit; me.money = m.money; me.gg = m.gg; me.buyUntil = m.buyUntil;
    me.team = m.team;
    me.reinforceLeft = m.rf || 0;
    me.inv = m.inv;
    me.alive = m.alive;
    if (m.cur !== me.cur || !wasAlive) me.cur = m.cur;
    // keep predicted ammo while firing so the counter doesn't jump
    if (recentFire && prevCur === me.cur && this.curItemId() === prevId && localMag != null) {
      const it = this.curItem();
      if (it) it[1] = Math.min(it[1], localMag);
    }
    if (!wasAlive && me.alive) this.onRespawn();
    else if (this.curItemId() !== prevId) this.equipVisual(false);
    if (wasAlive && !me.alive) this.w.pin = false;
  }

  onRespawn() {
    const w = this.w;
    w.punchYaw = w.punchPitch = 0;
    w.shots = 0; w.bloom = 0; w.ads = 0; w.scope = 0; w.reloadEnd = 0; w.pin = false;
    this.hud.death(null);
    this.hud.spectate(null);
    this.specId = null;
    this.freeCam = null;
    this.flash.until = 0;
    this.equipVisual(true);
    this.viewmodel.setVisible(true);
  }

  onTeleport(m) {
    const me = this.me;
    this.tpId = m.id;
    me.x = m.p[0]; me.y = m.p[1]; me.z = m.p[2];
    me.vx = me.vy = me.vz = 0;
    me.yaw = m.yaw; me.pitch = m.pitch || 0;
    me.crouch = 0; me.lean = 0;
    me.onGround = true;
    this.stepSmooth = 0;
  }

  onHit(m) {
    this.hud.hitmarker(m.hs, m.kill);
    this.audio.hitmarker(m.hs, m.kill, m.armor);
    const target = this.players.get(m.id);
    if (target && !m.kill && target.state) target.model.flinch(target.state.x - this.me.x, target.state.z - this.me.z, m.hs);
    if (m.p) {
      this.effects.blood(m.p, [0, 0, 0]);
      const eye = eyePosition(this.me);
      this.bloodSplatter(m.p, [m.p[0] - eye[0], m.p[1] - eye[1], m.p[2] - eye[2]]);
    }
    if (m.kill) this.input.rumble(0.3, 0.6, 120);
  }

  onReport(m) {
    const row = (id, dmg, hits, cls) => `<div class="dr-row ${cls}"><span>${esc(this.nameOf(id))}</span><b>${dmg}</b><i>${hits} hit${hits === 1 ? '' : 's'}</i></div>`;
    let html = '';
    if (m.given.length) html += `<div class="dr-title">Damage given</div>${m.given.map(([id, d, h]) => row(id, d, h, 'given')).join('')}`;
    if (m.taken.length) html += `<div class="dr-title">Damage taken</div>${m.taken.map(([id, d, h]) => row(id, d, h, 'taken')).join('')}`;
    this.hud.report(html, 7);
  }

  onReinforce(m) {
    if (m.left != null) this.me.reinforceLeft = m.left;
    if (m.ev === 'start') this.progress = { label: 'REINFORCING WALL', start: this.net.serverNow(), end: m.endsAt, kind: 'defuse' };
    else {
      this.progress = null;
      if (m.ev === 'done') this.hud.center('WALL REINFORCED', `${m.left} reinforcement${m.left === 1 ? '' : 's'} left`, 'good', 1.4);
    }
  }

  // Panel the local player is looking at that can be reinforced (defenders, Defuse only).
  reinforceTarget() {
    const me = this.me;
    if (this.mode !== 'defuse' || me.team !== TEAM.DEF || !(me.reinforceLeft > 0)) return null;
    if (this.phase !== 'freeze' && this.phase !== 'live') return null;
    const eye = eyePosition(me);
    const d = viewDir(me.yaw, me.pitch);
    const h = this.world.raycast(eye[0], eye[1], eye[2], d[0], d[1], d[2], 2.3);
    if (!h || !h.box.destructible || !h.box.active || h.box.reinforced) return null;
    return h.box;
  }

  // Blood on the wall (or floor) behind a hit, along the bullet's direction.
  bloodSplatter(p, dir) {
    const L = Math.hypot(dir[0], dir[1], dir[2]);
    if (L < 1e-3) return;
    const dx = dir[0] / L, dy = dir[1] / L - 0.25, dz = dir[2] / L;
    const n = Math.hypot(dx, dy, dz);
    const h = this.world.raycast(p[0], p[1], p[2], dx / n, dy / n, dz / n, 2.6);
    if (h) {
      const t = h.t;
      this.effects.bloodDecal([p[0] + dx / n * t, p[1] + dy / n * t, p[2] + dz / n * t], h.n, 0.35 + (2.6 - t) * 0.12);
    }
  }

  onDamage(m) {
    const me = this.me;
    me.hp = m.hp;
    me.armor = m.armor;
    const [sx, , sz] = m.from;
    const ang = Math.atan2(-(sx - me.x), -(sz - me.z));
    const rel = wrapAngle(ang - me.yaw);
    if (Math.hypot(sx - me.x, sz - me.z) > 0.5) this.hud.damage(-rel, m.amt);
    this.audio.hurt();
    this.w.punchPitch += Math.min(0.05, m.amt * 0.0012);
    this.shake = Math.min(1, this.shake + m.amt / 60);
    this.hurtFlash = Math.min(1, (this.hurtFlash || 0) + 0.25 + m.amt / 60);
    if (m.amt > 0) { this.tagAmt = Math.min(1, m.amt / 60 + 0.3); this.tagUntil = performance.now() + TAG_MS; }
    this.input.rumble(0.8, 0.4, 150);
  }

  onKill(m) {
    const killer = m.k != null ? this.nameOf(m.k) : null;
    const victim = this.nameOf(m.v);
    const cls = (id) => (this.ffa ? 'tf' : `t${this.teamOf(id)}`);
    const wname = m.w === 'suicide' ? 'switched team' : m.w === 'fall' ? 'fell' : m.w === 'bomb' ? 'BOMB' : WEAPONS[m.w]?.short || m.w;
    let html = '';
    if (killer && m.k !== m.v) html += `<span class="${cls(m.k)}">${esc(killer)}</span>`;
    if (m.a != null) html += ` + <span class="${cls(m.a)}">${esc(this.nameOf(m.a))}</span>`;
    html += ` <span class="w">${esc(wname)}</span>`;
    if (m.wb) html += '<span class="wb">⟂ WALL</span>';
    if (m.hs) html += '<span class="hs">◉ HS</span>';
    html += ` <span class="${cls(m.v)}">${esc(victim)}</span>`;
    const mine = m.k === this.myId || m.v === this.myId;
    this.hud.killfeed(html, mine);
    const rp = this.players.get(m.v);
    if (rp) {
      rp.alive = false;
      rp.deadAt = performance.now();
      // knock the body away from the killer
      const kp = m.k === this.myId ? this.me : this.players.get(m.k)?.state;
      const vp = rp.state;
      if (kp && vp && m.k !== m.v && Math.hypot(vp.x - kp.x, vp.z - kp.z) > 0.1) rp.model.die(vp.x - kp.x, vp.z - kp.z);
      else rp.model.die(Math.random() < 0.5 ? 1 : -1);
      if (vp && m.w !== 'suicide' && m.w !== 'fall') {
        const fy = this.world.groundBelow(vp.x, vp.y + 0.3, vp.z, 2);
        setTimeout(() => this.active && this.effects.bloodDecal([vp.x, fy, vp.z], [0, 1, 0], 0.9), 450);
      }
    }
    if (m.v === this.myId) {
      this.me.alive = false;
      this.deadAt = performance.now();
      this.killerId = m.k;
      this.deathPos = [this.me.x, this.me.y + 1.5, this.me.z];
      this.viewmodel.setVisible(false);
      this.hud.scope(false);
      this.w.scope = 0;
      this.usingHeld = false;
      this.net.send({ t: 'use', on: false });
      let info = killer && m.k !== this.myId ? `Killed by <b>${esc(killer)}</b> · ${esc(wname)}${m.hs ? ' · headshot' : ''}` : 'You died';
      const krp = this.players.get(m.k);
      if (krp?.state) info += `<small>${esc(killer)} has ${krp.snaps.at(-1)?.hp ?? '?'} HP left</small>`;
      if (!this.modeInfo.rounds) info += '<small>Respawning…</small>';
      this.hud.death(info);
      this.input.rumble(1, 1, 300);
    }
    if (m.k === this.myId && m.v !== this.myId) {
      this.audio.hitmarker(m.hs, true);
    }
  }

  applyWall(id, hp, fx, reinforced = false) {
    const b = this.world.byId.get(id);
    if (!b) return;
    b.hp = hp;
    if (!!b.reinforced !== reinforced && hp > 0) {
      b.reinforced = reinforced;
      this.worldView.setPanelReinforced(id, reinforced);
    }
    if (hp <= 0) b.reinforced = false;
    if (hp <= 0 && b.active) {
      b.active = false;
      const broke = this.worldView.setPanelHp(id, 0);
      if (fx && broke) {
        const floor = this.world.groundBelow((b.min[0] + b.max[0]) / 2, b.min[1] + 0.05, (b.min[2] + b.max[2]) / 2, 10);
        this.effects.debrisBurst(b, floor);
        this.audio.impact(1, [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]);
      } else if (!fx) this.effects.removeDecalsIn(b);
    } else if (hp > 0) {
      this.worldView.setPanelHp(id, hp);
    }
  }

  onNade(m) {
    const p = m.p;
    const d = Math.hypot(p[0] - this.me.x, p[1] - this.me.y, p[2] - this.me.z);
    if (m.type === 'frag') {
      this.effects.explosion(p, true);
      this.audio.explosion(p);
      this.shake = Math.min(1.5, this.shake + Math.max(0, 1.4 - d / 14));
      if (d < 12) this.input.rumble(1, 0.8, 350);
    } else if (m.type === 'breach') {
      this.effects.explosion(p, false);
      const n = m.n || [0, 1, 0];
      // splinters blown out through the wall
      const floor = this.world.groundBelow(p[0], p[1], p[2], 4);
      for (let i = 0; i < 10; i++) {
        const s = 0.05 + Math.random() * 0.14;
        this.effects.chunk(p, [-n[0] * (4 + Math.random() * 5) + (Math.random() - 0.5) * 4, 1 + Math.random() * 3, -n[2] * (4 + Math.random() * 5) + (Math.random() - 0.5) * 4],
          [s, s * 0.3, s * (0.5 + Math.random())], floor, 0x8a6238);
      }
      this.audio.explosion(p);
      this.shake = Math.min(1.5, this.shake + Math.max(0, 1.1 - d / 12));
      if (d < 10) this.input.rumble(0.9, 0.7, 300);
      for (const [id, st] of this.stuck) if (Math.hypot(st.p[0] - p[0], st.p[1] - p[1], st.p[2] - p[2]) < 0.6) this.stuck.delete(id);
    } else if (m.type === 'flash') {
      this.effects.flashbang(p);
      this.audio.flashPop(p);
    } else if (m.type === 'smoke') {
      this.effects.addSmoke(m.id, p, m.start, m.until, this.net.serverNow(), this.smokeTint());
      this.audio.smokePop(p);
    }
  }

  onFlashed(m) {
    const now = performance.now();
    const dur = m.dur * 1000;
    this.flash = { start: now, until: now + dur, dur, capture: true, amt: m.amt };
    this.audio.flashRing(m.dur * 0.9);
  }

  onBombEvent(m) {
    const now = this.net.serverNow();
    if (m.ev === 'planting') {
      const rp = this.players.get(m.id);
      const pos = m.id === this.myId ? null : rp?.state ? [rp.state.x, rp.state.y + 0.5, rp.state.z] : null;
      this.audio.keypad(pos);
      if (m.id === this.myId) this.progress = { label: 'PLANTING BOMB', start: now, end: m.endsAt, kind: '' };
    } else if (m.ev === 'defusing') {
      const rp = this.players.get(m.id);
      const pos = m.id === this.myId ? null : rp?.state ? [rp.state.x, rp.state.y + 0.5, rp.state.z] : null;
      this.audio.defuseClicks(pos);
      if (m.id === this.myId) this.progress = { label: m.kit ? 'DEFUSING (KIT)' : 'DEFUSING', start: now, end: m.endsAt, kind: 'defuse' };
    } else if (m.ev === 'cancel') {
      if (m.id === this.myId) this.progress = null;
    } else if (m.ev === 'planted') {
      if (m.id === this.myId) this.progress = null;
      this.hud.center('BOMB PLANTED', `Site ${m.site}`, 'bad', 3);
      this.audio.bombPlanted();
    } else if (m.ev === 'defused') {
      this.progress = null;
      this.hud.center('BOMB DEFUSED', '', 'def', 3);
      this.audio.roundWin();
    } else if (m.ev === 'exploded') {
      const p = m.p;
      this.effects.explosion(p, true);
      this.effects.explosion([p[0] + 1, p[1] + 1.5, p[2]], true);
      this.effects.flashLight(p, 0xffaa60, 200, 1.2, 60);
      this.audio.explosion(p);
      const d = Math.hypot(p[0] - this.me.x, p[2] - this.me.z);
      this.shake = Math.min(2, this.shake + Math.max(0.3, 2 - d / 20));
    }
  }

  onRound(m) {
    const prev = this.phase;
    this.phase = m.phase;
    this.round = m.round;
    this.endsAt = m.endsAt;
    this.matchEndsAt = m.matchEndsAt ?? this.matchEndsAt;
    this.score = m.score;
    if (m.buyEnds) this.buyEnds = m.buyEnds;
    if (m.silent) return;
    const myTeam = this.me.team;
    if (m.phase === 'freeze') {
      if (this.modeInfo.rounds) {
        const half = Math.floor((m.maxRounds || 12) / 2);
        const last = this.score[1] === half || this.score[2] === half;
        this.hud.center(`ROUND ${m.round}`, last ? 'MATCH POINT' : 'BUY PHASE — press B', '', 3);
      } else this.hud.center('GET READY', MODES[this.mode].name, '', 3);
      this.progress = null;
      this.ui.overlay('overlay-end', false);
    } else if (m.phase === 'live' && prev === 'freeze') {
      this.hud.center('GO!', this.modeInfo.rounds ? (myTeam === 1 ? 'Plant the bomb or eliminate the enemy' : 'Defend the sites') : '', myTeam === 1 ? 'att' : 'def', 1.8);
      this.audio.roundStart();
    } else if (m.phase === 'post') {
      const w = m.winner;
      const reasons = { elim: 'Enemy eliminated', bomb: 'The bomb exploded', defused: 'The bomb was defused', time: 'Time ran out' };
      const mvp = m.mvp != null ? `MVP: ${this.nameOf(m.mvp)}` : '';
      this.hud.center(`${TEAM_NAMES[w].toUpperCase()} WIN`, `${reasons[m.reason] || ''}${mvp ? ' · ' + mvp : ''}`, w === 1 ? 'att' : 'def', 5);
      if (myTeam === w) this.audio.roundWin(); else this.audio.roundLose();
      this.progress = null;
    } else if (m.phase === 'halftime') {
      this.hud.center('HALFTIME', 'Switching sides', '', 4.5);
    }
  }

  onSound(m) {
    const rp = this.players.get(m.id);
    const pos = rp?.state ? [rp.state.x, rp.state.y + 1.2, rp.state.z] : m.p || null;
    switch (m.s) {
      case 'reload': if (m.id !== this.myId) this.audio.reload(m.w, pos, false); break;
      case 'knifehit': this.audio.knifeHit(m.p, true); break;
      case 'knifewall':
        this.audio.knifeHit(m.p, false);
        this.effects.impact(m.p, m.n, m.m, true);
        break;
      case 'knifeswing': if (m.id !== this.myId) this.audio.knifeSwing(pos); break;
      case 'bounce': this.audio.bounce(m.p); break;
      case 'pickup': this.audio.pickup(); break;
      case 'throw': if (m.id !== this.myId) this.audio.throwWhoosh(pos); break;
      case 'stick':
        this.audio.stick(m.p);
        this.stuck.set(m.id, { p: m.p, n: m.n || [0, 1, 0], until: m.until, nextBeep: 0 });
        break;
      case 'reinforcing': this.audio.reinforcing(m.p); break;
      case 'reinforced': this.audio.reinforced(m.p); break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ drops, bomb, grenades
  addDrop(d) {
    const [id, wid, x, y, z] = d;
    if (this.drops.has(id)) return;
    const mesh = bakedWeapon(wid);
    mesh.position.set(x, y + 0.035, z);
    mesh.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2);
    if (WEAPONS[wid]?.slot === 'grenade') mesh.rotation.z = 0;
    mesh.scale.setScalar(1.15);
    this.g.scene.add(mesh);
    this.drops.set(id, { id, wid, x, y, z, mesh });
  }

  removeDrop(id) {
    const d = this.drops.get(id);
    if (!d) return;
    this.g.scene.remove(d.mesh);
    this.drops.delete(id);
  }

  updateBombModel() {
    const b = this.bomb;
    const show = b && (b.state === 'dropped' || b.state === 'planted' || b.state === 'defused');
    if (!show) {
      if (this.bombModel) { this.g.scene.remove(this.bombModel); this.bombModel = null; }
      return;
    }
    if (!this.bombModel) {
      this.bombModel = weaponTemplate('bomb');
      this.bombModel.scale.setScalar(1.6);
      this.g.scene.add(this.bombModel);
    }
    this.bombModel.position.set(b.p[0], b.p[1] + 0.065, b.p[2]);
    this.bombLight.position.set(b.p[0], b.p[1] + 0.3, b.p[2]);
  }

  // ------------------------------------------------------------------ inventory helpers
  curItem() {
    const inv = this.me.inv;
    if (this.me.cur === 'primary') return inv.primary;
    if (this.me.cur === 'secondary') return inv.secondary;
    return null;
  }
  curItemId() {
    const c = this.me.cur;
    if (c === 'primary') return this.me.inv.primary?.[0] || 'knife';
    if (c === 'secondary') return this.me.inv.secondary?.[0] || 'knife';
    if (c === 'bomb') return 'bomb';
    if (GRENADES.includes(c)) return c;
    return 'knife';
  }
  hasSlot(slot) {
    const inv = this.me.inv;
    if (slot === 'primary') return !!inv.primary;
    if (slot === 'secondary') return !!inv.secondary;
    if (slot === 'knife') return true;
    if (slot === 'bomb') return !!inv.bomb;
    if (GRENADES.includes(slot)) return inv.nades?.[slot] > 0;
    return false;
  }

  equipVisual(fromRespawn) {
    const id = this.curItemId();
    const w = WEAPONS[id];
    this.viewmodel.setWeapon(id, fromRespawn ? 0.35 : w.deploy);
    this.w.deployEnd = performance.now() + w.deploy * 1000;
    this.w.reloadEnd = 0;
    this.w.scope = 0;
    this.w.shots = 0;
    this.w.pin = false;
    if (!fromRespawn) this.audio.deploy();
  }

  switchTo(slot) {
    const me = this.me;
    if (!me.alive) return;
    if (GRENADES.includes(slot) && GRENADES.includes(me.cur) && me.cur === slot) return;
    if (!this.hasSlot(slot) || me.cur === slot) return;
    if (this.w.pin) return;
    this.w.lastSlot = me.cur;
    me.cur = slot;
    this.equipVisual(false);
    this.net.send({ t: 'switch', w: slot });
    this.hud.showSlots(performance.now());
  }

  cycleGrenade() {
    const avail = GRENADES.filter((g) => this.me.inv.nades?.[g] > 0);
    if (!avail.length) return;
    const i = avail.indexOf(this.me.cur);
    this.switchTo(avail[(i + 1) % avail.length]);
  }

  cycleWeapon(dir) {
    const order = ['primary', 'secondary', 'knife', ...GRENADES, 'bomb'].filter((s) => this.hasSlot(s));
    const i = order.indexOf(this.me.cur);
    const next = order[(i + dir + order.length) % order.length];
    this.switchTo(next);
  }

  // ------------------------------------------------------------------ frame
  frame(dt, playing) {
    if (!this.active) return;
    const now = performance.now();
    const serverNow = this.net.serverNow();
    const me = this.me;

    let look = { dx: 0, dy: 0 };
    const w = this.w;
    const zoom = this.currentZoom();
    const assist = this.aimAssistFactor();
    if (playing) look = this.input.look(dt, zoom, assist);
    else this.input.look(dt);

    if (me.alive) {
      me.yaw = wrapAngle(me.yaw - look.dx);
      me.pitch = clamp(me.pitch - look.dy, -1.54, 1.54);
      this.updateLocal(dt, now, serverNow, playing);
    } else {
      this.updateDead(dt, now, playing);
    }

    this.updateRemotes(dt, serverNow);
    this.updateWorldObjects(dt, serverNow, now);
    this.effects.update(dt, serverNow);
    this.decor.update(dt, now / 1000);
    this.updateCamera(dt, now, look);
    this.updateHud(dt, now, serverNow);
    if (me.alive && now - this.lastSend > 15) this.sendInput(now);
  }

  currentZoom() {
    const w = this.w;
    const wd = WEAPONS[this.curItemId()];
    if (wd?.scope && w.scope > 0) return wd.scope[w.scope - 1];
    if (wd && (wd.type === 'rifle' || wd.type === 'smg' || wd.type === 'pistol' || wd.type === 'shotgun')) {
      const z = wd.type === 'rifle' ? 0.8 : wd.type === 'shotgun' ? 0.9 : 0.86;
      return lerp(1, z, w.ads);
    }
    return 1;
  }

  aimAssistFactor() {
    if (this.input.lastDevice !== 'pad' || !this.settings.aimAssist || !this.me.alive) return 1;
    const eye = eyePosition(this.me);
    const d = viewDir(this.me.yaw, this.me.pitch);
    for (const rp of this.players.values()) {
      if (!rp.alive || !rp.state || !this.isEnemyId(rp.id)) continue;
      const s = rp.state;
      const dist = Math.hypot(s.x - eye[0], s.z - eye[2]);
      if (dist > 60) continue;
      const fat = { ...s };
      const hit = rayHitPlayer(eye[0], eye[1], eye[2], d[0], d[1], d[2], 80, fat)
        || rayHitPlayer(eye[0], eye[1], eye[2], d[0] + 0.02, d[1], d[2], 80, fat)
        || rayHitPlayer(eye[0], eye[1], eye[2], d[0] - 0.02, d[1], d[2], 80, fat);
      if (hit) return 0.5;
    }
    return 1;
  }

  updateLocal(dt, now, serverNow, playing) {
    const me = this.me;
    const w = this.w;
    const inp = this.input;
    const wid = this.curItemId();
    const wd = WEAPONS[wid];
    const frozen = this.phase === 'freeze' || this.phase === 'halftime' || this.phase === 'ended' || !!this.progress || this.chatOpen;

    // ---- weapon selection
    if (playing) {
      if (inp.pressed('slot1')) this.switchTo('primary');
      if (inp.pressed('slot2')) this.switchTo('secondary');
      if (inp.pressed('slot3')) this.switchTo('knife');
      if (inp.pressed('slot4')) GRENADES.includes(me.cur) ? this.cycleGrenade() : this.cycleGrenade();
      if (inp.pressed('slot5')) this.switchTo('bomb');
      if (inp.pressed('nextWeapon')) this.cycleWeapon(1);
      if (inp.pressed('prevWeapon')) this.cycleWeapon(-1);
      if (inp.pressed('lastWeapon')) this.switchTo(this.hasSlot(w.lastSlot) ? w.lastSlot : me.inv.primary ? 'primary' : 'secondary');
      if (inp.pressed('drop')) this.net.send({ t: 'drop' });
      if (inp.pressed('inspect')) this.viewmodel.inspect();
      if (inp.pressed('flashlight') && this.night) { this.lightOn = !this.lightOn; this.torches?.toggleSound(); }
      if (inp.pressed('walkToggle')) this.walkToggle = !this.walkToggle;
    }

    // ---- interaction (plant / defuse / pick up)
    const useTarget = this.useTarget();
    let useDown = playing && (inp.isDown('use') || (me.cur === 'bomb' && inp.isDown('fire') && useTarget === 'plant'));
    if (playing && inp.padPressed('reloadOrUse')) {
      if (useTarget) this.padUse = true;
      else this.reload(now);
    }
    if (this.padUse) {
      if (inp.padDown('reloadOrUse')) useDown = true;
      else this.padUse = false;
    }
    if (useDown !== this.usingHeld) {
      this.usingHeld = useDown;
      this.net.send({ t: 'use', on: useDown });
      if (!useDown) this.progress = null;
    }

    // ---- movement
    const mv = playing ? inp.move() : { x: 0, y: 0 };
    let leanTarget = 0;
    if (playing) {
      if (this.settings.toggleLean) {
        if (inp.pressed('leanL')) this.leanToggle = this.leanToggle === -1 ? 0 : -1;
        if (inp.pressed('leanR')) this.leanToggle = this.leanToggle === 1 ? 0 : 1;
        leanTarget = this.leanToggle;
      } else leanTarget = (inp.isDown('leanR') ? 1 : 0) - (inp.isDown('leanL') ? 1 : 0);
    }
    if (leanTarget) leanTarget *= leanClearance(this.world, me, me.yaw, Math.sign(leanTarget));
    const scoped = wd?.scope && w.scope > 0;
    let speedMul = (scoped && wd.scopedSpeed ? wd.scopedSpeed : wd?.speed || 1) * lerp(1, 0.8, wd?.scope ? 0 : w.ads);
    if (this.tagUntil > now) speedMul *= 1 - tagSlow(this.tagAmt, (this.tagUntil - now) / TAG_MS);
    const jumpPressed = playing && inp.pressed('jump');
    const jumped = stepPlayer(this.world, me, {
      fwd: mv.y, right: mv.x, jump: jumpPressed, crouch: playing && inp.isDown('crouch'),
      walk: playing && (inp.isDown('walk') || this.walkToggle), yaw: me.yaw, lean: leanTarget, speedMul, frozen,
    }, dt);
    me.walking = playing && (inp.isDown('walk') || this.walkToggle);
    if (jumped) this.audio.jump(null, true);
    if (me.stepped > 0) this.stepSmooth -= me.stepped;
    if (me.landed > 4) {
      this.audio.land(this.surfaceUnder(), null, me.landed, true);
      this.viewmodel.land(me.landed);
      this.stepSmooth -= Math.min(0.12, me.landed * 0.012);
    }
    // footsteps
    const hs = Math.hypot(me.vx, me.vz);
    this.lastMoveSpeed = hs;
    if (me.onGround && hs > 3.1 && !me.walking && me.crouch < 0.5) {
      this.stepDist += hs * dt;
      if (this.stepDist > 2.2) { this.stepDist = 0; this.audio.footstep(this.surfaceUnder(), null, 1, true); }
    } else if (me.onGround && hs > 0.5) {
      this.stepDist += hs * dt * 0.4;
      if (this.stepDist > 2.2) this.stepDist = 0;
    }

    // ---- ADS / scope
    const canAds = wd && ['rifle', 'smg', 'pistol', 'shotgun', 'sniper'].includes(wd.type) && now >= w.deployEnd && !w.reloadEnd;
    if (playing && canAds) {
      if (wd.scope) {
        if (inp.pressed('ads')) {
          w.scope = (w.scope + 1) % (wd.scope.length + 1);
          this.audio.uiClick();
        }
      } else if (this.settings.toggleAds) {
        if (inp.pressed('ads')) w.adsHeld = !w.adsHeld;
      } else w.adsHeld = inp.isDown('ads');
    } else if (!canAds) { w.adsHeld = false; if (w.reloadEnd) w.scope = 0; }
    if (w.rezoomAt && now >= w.rezoomAt) { w.scope = w.rezoomLevel || 1; w.rezoomAt = 0; }
    const adsTarget = wd?.scope ? 0 : (w.adsHeld && canAds ? 1 : 0);
    w.ads = clamp(w.ads + (adsTarget ? dt : -dt) / 0.16, 0, 1);

    // ---- reload
    if (playing && inp.pressed('reload')) this.reload(now);
    if (w.reloadEnd && now >= w.reloadEnd) {
      w.reloadEnd = 0;
      const it = this.curItem();
      if (it) {
        const need = WEAPONS[it[0]].mag - it[1];
        const take = Math.min(need, it[2]);
        it[1] += take; it[2] -= take;
      }
    }

    // ---- recoil recovery & bloom
    const sinceShot = (now - w.lastShot) / 1000;
    if (wd?.recoil) {
      if (sinceShot > wd.interval * 1.4) {
        const rec = wd.recoil.recover;
        w.punchPitch *= Math.exp(-dt * rec);
        w.punchYaw *= Math.exp(-dt * rec);
        w.shots = Math.max(0, w.shots - dt * 22);
      }
      w.bloom = Math.max(0, w.bloom - (wd.spread?.recover || 5) * dt);
    } else {
      w.punchPitch *= Math.exp(-dt * 8);
      w.punchYaw *= Math.exp(-dt * 8);
    }

    // ---- firing
    if (playing) this.handleFire(now, dt);
  }

  surfaceUnder() {
    const me = this.me;
    const h = this.world.raycast(me.x, me.y + 0.1, me.z, 0, -1, 0, 0.5);
    return materialInfo(h?.box.mat).surface;
  }

  useTarget() {
    const me = this.me;
    if (!me.alive || this.mode !== 'defuse') return this.dropTarget() ? 'pickup' : null;
    const b = this.bomb;
    if (me.team === TEAM.ATT && me.inv.bomb && this.phase === 'live' && me.onGround) {
      const zones = this.map.zones;
      if (inZone(zones.A, me.x, me.y, me.z) || inZone(zones.B, me.x, me.y, me.z)) return 'plant';
    }
    if (me.team === TEAM.DEF && b && b.state === 'planted' && this.phase === 'planted') {
      if (Math.hypot(b.p[0] - me.x, b.p[1] - me.y, b.p[2] - me.z) < USE_RANGE + 0.2) return 'defuse';
    }
    if (this.reinforceTarget()) return 'reinforce';
    return this.dropTarget() ? 'pickup' : null;
  }

  dropTarget() {
    const me = this.me;
    const eye = eyePosition(me);
    const dir = viewDir(me.yaw, me.pitch);
    let best = null, bd = USE_RANGE + 0.5;
    for (const d of this.drops.values()) {
      const dx = d.x - eye[0], dy = d.y + 0.1 - eye[1], dz = d.z - eye[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist > USE_RANGE + 0.6) continue;
      const dot = (dx * dir[0] + dy * dir[1] + dz * dir[2]) / dist;
      if (dot > 0.8 && dist < bd) { bd = dist; best = d; }
    }
    return best;
  }

  reload(now) {
    const w = this.w;
    const it = this.curItem();
    if (!it || w.reloadEnd || now < w.deployEnd - 50) return;
    const wd = WEAPONS[it[0]];
    if (it[1] >= wd.mag || it[2] <= 0) return;
    w.reloadEnd = now + wd.reload * 1000;
    w.scope = 0;
    w.adsHeld = false;
    this.viewmodel.reload(wd.reload);
    this.audio.reload(it[0], null, true);
    this.net.send({ t: 'reload' });
  }

  handleFire(now, dt) {
    const me = this.me, w = this.w, inp = this.input;
    const wid = this.curItemId();
    const wd = WEAPONS[wid];
    const blocked = this.phase === 'freeze' || this.phase === 'halftime' || this.phase === 'ended' || !!this.progress || now < w.deployEnd;
    if (!wd) return;
    if (wd.type === 'grenade') {
      if (blocked) return;
      if (!w.pin && (inp.pressed('fire') || inp.pressed('ads'))) {
        w.pin = true;
        w.lob = inp.isDown('ads') && !inp.isDown('fire');
        this.viewmodel.play('pullpin', 0.35);
        this.audio.pinPull();
        w.pinAt = now;
      } else if (w.pin && !inp.isDown('fire') && !inp.isDown('ads') && now - w.pinAt > 250) {
        w.pin = false;
        const both = w.lob;
        const speed = both ? 8.5 : 17;
        const d = viewDir(me.yaw, me.pitch + 0.08);
        const eye = eyePosition(me);
        const v = [d[0] * speed + me.vx * 0.6, d[1] * speed + (both ? 1.5 : 1.2) + Math.max(0, me.vy) * 0.5, d[2] * speed + me.vz * 0.6];
        const o = [eye[0] + d[0] * 0.3, eye[1] - 0.1, eye[2] + d[2] * 0.3];
        this.net.send({ t: 'throw', o, v });
        this.viewmodel.play('throw', 0.45);
        this.audio.throwWhoosh(null);
        w.deployEnd = now + 600;
      }
      return;
    }
    if (wd.type === 'bomb') return;
    if (wd.type === 'melee') {
      if (blocked || now < w.nextFire) return;
      const heavy = inp.isDown('ads');
      if (inp.isDown('fire') || heavy) {
        w.nextFire = now + (heavy ? wd.heavyInterval : wd.interval) * 1000;
        const d = viewDir(me.yaw + w.punchYaw, me.pitch + w.punchPitch);
        this.net.send({ t: 'knife', d, heavy, ts: this.net.serverNow() - INTERP_DELAY });
        this.viewmodel.play(heavy ? 'stab' : 'slash', heavy ? 0.6 : 0.34);
        this.audio.knifeSwing(null);
      }
      return;
    }
    // guns
    const it = this.curItem();
    if (!it) return;
    const trigger = wd.auto ? inp.isDown('fire') : inp.pressed('fire');
    if (inp.released('fire')) w.dryClick = false;
    if (!trigger || blocked || w.reloadEnd) {
      if (inp.pressed('fire') && w.reloadEnd && wd.type === 'shotgun' && it[1] > 0) {
        // shotguns can interrupt a reload
        w.reloadEnd = 0;
        this.viewmodel.cancelReload();
      } else return;
    }
    if (now < w.nextFire) return;
    if (it[1] <= 0) {
      if (!w.dryClick) { this.audio.dryFire(); w.dryClick = true; }
      if (it[2] > 0) this.reload(now);
      return;
    }
    this.fireGun(now, wd, it);
  }

  fireGun(now, wd, it) {
    const me = this.me, w = this.w;
    it[1]--;
    this.lastLocalFire = now;
    w.nextFire = Math.max(now, w.nextFire + wd.interval * 1000);
    if (w.nextFire < now) w.nextFire = now + wd.interval * 1000;
    if (w.nextFire - now > wd.interval * 1000) w.nextFire = now + wd.interval * 1000;
    const scoped = wd.scope && w.scope > 0;
    const spread = computeSpread(wd, {
      speed: Math.hypot(me.vx, me.vz), onGround: me.onGround, crouch: me.crouch, ads: w.ads, scoped, bloom: w.bloom,
    });
    const base = viewDir(me.yaw + w.punchYaw, me.pitch + w.punchPitch);
    const eye = eyePosition(me);
    const dirs = [];
    for (let i = 0; i < wd.pellets; i++) dirs.push(applySpread(base, spread, Math.random).map((v) => Math.round(v * 100000) / 100000));
    this.net.send({ t: 'shoot', ts: Math.round(this.net.serverNow() - INTERP_DELAY), o: eye.map((v) => Math.round(v * 1000) / 1000), d: dirs });
    // local effects
    const muzzle = tmpV.set(0.12, -0.1, -0.6).applyQuaternion(this.g.camera.quaternion).add(this.g.camera.position);
    for (const d of dirs) {
      const hit = this.world.raycast(eye[0], eye[1], eye[2], d[0], d[1], d[2], wd.range);
      const t = hit ? hit.t : wd.range;
      const end = [eye[0] + d[0] * t, eye[1] + d[1] * t, eye[2] + d[2] * t];
      // did we hit a player first? (server confirms, show no wall impact then)
      let playerFirst = false;
      for (const rp of this.players.values()) {
        if (!rp.alive || !rp.state) continue;
        const r = rayHitPlayer(eye[0], eye[1], eye[2], d[0], d[1], d[2], t, rp.state);
        if (r) { playerFirst = true; break; }
      }
      if (hit && !playerFirst) {
        const surf = hit.box.reinforced ? 2 : SURFACE_IDX[materialInfo(hit.box.mat).surface] ?? 0;
        this.effects.impact(end, hit.n, surf, true);
        if (Math.random() < 0.5) this.audio.impact(surf, end);
      }
      if (wd.pellets === 1 || Math.random() < 0.35) this.effects.tracer([muzzle.x, muzzle.y, muzzle.z], end, wd.auto ? 0.5 : 1);
    }
    // recoil
    const idx = Math.floor(w.shots);
    const rd = recoilDelta(wd, idx);
    const rnd = (Math.random() - 0.5) * (wd.recoil?.rand || 0);
    w.punchPitch += rd[1] * DEG;
    w.punchYaw -= (rd[0] + rnd) * DEG;
    w.shots += 1;
    w.lastShot = now;
    w.bloom = Math.min(wd.spread?.bloomMax || 0, w.bloom + (wd.spread?.bloom || 0));
    this.shake = Math.min(1, this.shake + (wd.type === 'sniper' || wd.type === 'shotgun' ? 0.25 : 0.05));
    this.viewmodel.fire(wd.type === 'sniper' || wd.type === 'shotgun' ? 1.6 : wd.type === 'pistol' ? 1.1 : 1);
    this.audio.gunshot(wd.id, null, true);
    this.effects.flashLight([muzzle.x, muzzle.y, muzzle.z], 0xffb060, 8, 0.05, 7);
    this.effects.muzzleSmoke([muzzle.x, muzzle.y, muzzle.z], base, wd.type === 'shotgun' || wd.type === 'sniper' ? 1.6 : 1);
    {
      // brass flies out to the right of the view
      const q = this.g.camera.quaternion;
      const ep = tmpV.set(0.1, -0.08, -0.3).applyQuaternion(q).add(this.g.camera.position);
      const right = tmpV2.set(1, 0, 0).applyQuaternion(q);
      const out = 1.6 + Math.random() * 0.8, up = 1.5 + Math.random() * 0.8;
      this.effects.casing([ep.x, ep.y, ep.z], [right.x * out + me.vx, up + right.y * out, right.z * out + me.vz], wd.type === 'shotgun');
    }
    this.input.rumble(wd.type === 'sniper' || wd.type === 'shotgun' ? 0.8 : 0.25, 0.4, 60);
    if (wd.type === 'shotgun') setTimeout(() => this.viewmodel.play('pump', 0.45), 250);
    if (wd.type === 'sniper') {
      const lvl = w.scope;
      w.scope = 0;
      setTimeout(() => this.viewmodel.play('bolt', 0.6), 200);
      if (lvl > 0) { w.rezoomAt = now + wd.interval * 1000 * 0.9; w.rezoomLevel = lvl; }
    }
    if (it[1] === 0 && it[2] > 0) setTimeout(() => { if (this.active && this.curItem() === it) this.reload(performance.now()); }, 350);
  }

  sendInput(now) {
    this.lastSend = now;
    const me = this.me;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    this.net.send({
      t: 'in', tp: this.tpId, p: [r3(me.x), r3(me.y), r3(me.z)], v: [r3(me.vx), r3(me.vy), r3(me.vz)],
      yaw: r3(me.yaw), pitch: r3(me.pitch), c: Math.round(me.crouch * 100) / 100, l: Math.round(me.lean * 100) / 100,
      g: me.onGround ? 1 : 0, w: me.walking ? 1 : 0, a: this.w.ads > 0.5 || this.w.scope > 0 ? 1 : 0,
      fl: this.night && this.lightOn ? 1 : 0,
    });
  }

  // ------------------------------------------------------------------ death / spectate
  updateDead(dt, now, playing) {
    const inp = this.input;
    const spectator = this.me.team === TEAM.NONE;
    if (!spectator && (!this.modeInfo.rounds || now - this.deadAt < 2500)) { this.specId = null; return; }
    const mates = [...this.players.values()].filter((p) => p.alive && p.state && (spectator || this.ffa || p.team === this.me.team));
    if (!mates.length) { this.specId = null; return; }
    let idx = mates.findIndex((p) => p.id === this.specId);
    if (idx < 0) idx = 0;
    if (playing && (inp.pressed('fire') || inp.padButtonPressed?.(0))) idx = (idx + 1) % mates.length;
    if (playing && (inp.pressed('ads'))) idx = (idx - 1 + mates.length) % mates.length;
    const target = mates[idx];
    if (this.specId !== target.id) {
      this.specId = target.id;
      this.viewmodel.setWeapon(target.state.w || 'knife', 0.2);
      this.viewmodel.setLook(teamLook(target.team, target.id, this.ffa));
    }
  }

  // ------------------------------------------------------------------ remote players
  updateRemotes(dt, serverNow) {
    const renderT = serverNow - INTERP_DELAY;
    const mePos = this.me;
    for (const rp of this.players.values()) {
      const snaps = rp.snaps;
      if (!snaps.length) { rp.model.root.visible = false; continue; }
      let a = snaps[0], b = snaps[0];
      for (let i = snaps.length - 1; i >= 0; i--) {
        if (snaps[i].t <= renderT) { a = snaps[i]; b = snaps[Math.min(i + 1, snaps.length - 1)]; break; }
      }
      let k = b.t > a.t ? (renderT - a.t) / (b.t - a.t) : 0;
      k = clamp(k, 0, 1.5);
      const s = {
        x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k),
        yaw: angleLerp(a.yaw, b.yaw, Math.min(1, k)), pitch: lerp(a.pitch, b.pitch, Math.min(1, k)),
        crouch: lerp(a.crouch, b.crouch, Math.min(1, k)), lean: lerp(a.lean, b.lean, Math.min(1, k)),
        flags: b.flags, w: b.w, hp: b.hp,
      };
      const alive = !!(s.flags & FLAG.ALIVE);
      const prev = rp.state;
      const idt = 1 / Math.max(dt, 1e-3);
      const speed = prev ? Math.hypot(s.x - prev.x, s.z - prev.z) * idt : 0;
      rp.smoothSpeed = lerp(rp.smoothSpeed || 0, Math.min(speed, 8), 0.2);
      s.speed = rp.smoothSpeed;
      rp.svx = lerp(rp.svx || 0, prev ? clamp((s.x - prev.x) * idt, -8, 8) : 0, 0.2);
      rp.svz = lerp(rp.svz || 0, prev ? clamp((s.z - prev.z) * idt, -8, 8) : 0, 0.2);
      s.vx = rp.svx; s.vz = rp.svz;
      s.reloading = !!(s.flags & FLAG.RELOAD);
      s.onGround = !!(s.flags & FLAG.GROUND);
      s.planting = !!(s.flags & FLAG.PLANT);
      s.defusing = !!(s.flags & FLAG.DEFUSE);
      s.reinforcing = !!(s.flags & FLAG.REINFORCE);
      s.bomb = !!(s.flags & FLAG.BOMB);
      s.alive = alive;
      if (alive && !rp.alive) { rp.model.revive(); }
      if (!alive && rp.alive) rp.model.die(Math.random() < 0.5 ? 1 : -1);  // kill message missed
      rp.alive = alive;
      rp.state = s;
      const root = rp.model.root;
      const fadeBody = !this.modeInfo.rounds && !alive && performance.now() - (rp.deadAt || 0) > 4000;
      root.visible = !fadeBody && (alive || rp.deadAt > 0 || this.modeInfo.rounds);
      if (!alive && !rp.deadAt && !this.modeInfo.rounds) root.visible = false;
      if (this.specId === rp.id && !this.me.alive) root.visible = false;
      rp.model.setWeapon(s.w);
      rp.model.update(s, dt);
      if (rp.model.tag) rp.model.tag.visible = alive && !this.ffa && rp.team === this.me.team && this.me.team !== TEAM.NONE;
      // footsteps & landing sounds
      if (alive) {
        if (s.onGround && !(s.flags & FLAG.WALK) && s.speed > 3.1 && s.crouch < 0.5) {
          rp.stepAcc += s.speed * dt;
          if (rp.stepAcc > 2.2) {
            rp.stepAcc = 0;
            const h = this.world.raycast(s.x, s.y + 0.1, s.z, 0, -1, 0, 0.5);
            this.audio.footstep(materialInfo(h?.box.mat).surface, [s.x, s.y, s.z], 1, false);
          }
        }
        if (s.onGround && !rp.onGround && prev && rp.fallStart - s.y > 1.2) this.audio.land('stone', [s.x, s.y, s.z], 5, false);
        if (!s.onGround && rp.onGround) rp.fallStart = s.y;
        if (!s.onGround) rp.fallStart = Math.max(rp.fallStart, s.y);
        rp.onGround = s.onGround;
      }
      void mePos;
    }
  }

  onRemoteFire(m) {
    const rp = this.players.get(m.id);
    const wd = WEAPONS[m.w];
    let from;
    if (rp && rp.model.root.visible && rp.state) {
      from = rp.model.muzzleWorld(new THREE.Vector3());
      rp.model.kick(wd?.type === 'sniper' ? 0.25 : 0.08);
    } else from = new THREE.Vector3(m.o[0], m.o[1], m.o[2]);
    this.effects.muzzleFlash(from, wd?.type === 'sniper' || wd?.type === 'shotgun');
    this.audio.gunshot(m.w, [m.o[0], m.o[1], m.o[2]], false);
    if (rp && rp.model.root.visible && rp.model.weapon && wd?.type !== 'knife') {
      const w = rp.model.weapon;
      const ej = w.userData.eject;
      if (ej && from.distanceToSquared(this.g.camera.position) < 900) {
        const p = w.localToWorld(tmpV.set(ej[0], ej[1], ej[2]));
        const yaw = rp.state.yaw;
        const out = 1.4 + Math.random();
        this.effects.casing([p.x, p.y, p.z], [Math.cos(yaw) * out, 1.6 + Math.random(), -Math.sin(yaw) * out], wd.type === 'shotgun');
      }
    }
    const eye = eyePosition(this.me);
    for (const e of m.e) {
      const [x, y, z, nx, ny, nz, surf] = e;
      if (surf !== 4) this.effects.impact([x, y, z], [nx, ny, nz], surf, true);
      else {
        this.effects.blood([x, y, z], [nx, ny, nz]);
        this.bloodSplatter([x, y, z], [x - m.o[0], y - m.o[1], z - m.o[2]]);
      }
      this.effects.tracer([from.x, from.y, from.z], [x, y, z], m.e.length > 1 ? 0.3 : wd?.auto ? 0.6 : 1);
      // bullet whiz near our head
      if (this.me.alive) {
        const d = [x - m.o[0], y - m.o[1], z - m.o[2]];
        const L = Math.hypot(...d);
        if (L > 1) {
          const t = clamp(((eye[0] - m.o[0]) * d[0] + (eye[1] - m.o[1]) * d[1] + (eye[2] - m.o[2]) * d[2]) / (L * L), 0, 1);
          const cx = m.o[0] + d[0] * t, cy = m.o[1] + d[1] * t, cz = m.o[2] + d[2] * t;
          const dist = Math.hypot(cx - eye[0], cy - eye[1], cz - eye[2]);
          if (dist < 1.6 && t > 0.05 && t < 0.98) this.audio.whiz([cx, cy, cz]);
        }
      }
    }
  }

  // ------------------------------------------------------------------ world objects
  updateWorldObjects(dt, serverNow, now) {
    const renderT = serverNow - INTERP_DELAY;
    for (const g of this.grenades.values()) {
      const sn = g.snaps;
      let a = sn[0], b = sn[0];
      for (let i = sn.length - 1; i >= 0; i--) {
        if (sn[i].t <= renderT) { a = sn[i]; b = sn[Math.min(i + 1, sn.length - 1)]; break; }
      }
      const k = b.t > a.t ? clamp((renderT - a.t) / (b.t - a.t), 0, 1) : 0;
      const st = this.stuck.get(g.id);
      if (st) {
        // flush against the surface, blinking faster as the fuse runs out
        g.mesh.position.set(st.p[0], st.p[1], st.p[2]);
        g.mesh.quaternion.setFromUnitVectors(tmpV2.set(0, 0, 1), tmpV.set(st.n[0], st.n[1], st.n[2]));
        const left = st.until - serverNow;
        if (now >= st.nextBeep && left > 0) {
          st.nextBeep = now + clamp(left / 5, 70, 300);
          this.audio.breachBeep(st.p);
          this.effects.sparks.spawn(st.p[0] + st.n[0] * 0.03, st.p[1] + st.n[1] * 0.03, st.p[2] + st.n[2] * 0.03, 0, 0, 0, 6, 0.4, 0.3, 1, 0.07, 0.06, 0, 0, 0);
        }
        continue;
      }
      g.mesh.position.set(lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.z, b.z, k));
      g.mesh.rotation.x += dt * 8;
      g.mesh.rotation.z += dt * 5;
    }
    for (const d of this.drops.values()) {
      d.mesh.position.y = d.y + 0.035 + Math.sin(now / 500 + d.id) * 0.0;
    }
    // bomb
    const b = this.bomb;
    if (this.bombModel && b) {
      const led = this.bombModel.getObjectByName('led');
      if (b.state === 'planted') {
        const left = b.explodeAt - serverNow;
        const interval = clamp(left / 40, 0.12, 1) * 1000;
        if (now >= this.nextBeep && left > 0) {
          this.nextBeep = now + interval;
          this.audio.bombBeep([b.p[0], b.p[1] + 0.2, b.p[2]], left < 8000);
          this.bombBlinkUntil = now + 90;
        }
        const on = now < (this.bombBlinkUntil || 0);
        if (led) led.visible = on;
        if (this.bombLight) this.bombLight.intensity = on ? 3 : 0;
      } else {
        if (led) led.visible = false;
        if (this.bombLight) this.bombLight.intensity = 0;
      }
    }
    // own shadow model
    if (this.ownModel) {
      const me = this.me;
      this.ownModel.root.visible = me.alive;
      if (me.alive) {
        this.ownModel.setWeapon(this.curItemId());
        this.ownModel.update({ ...me, speed: this.lastMoveSpeed, planting: false, defusing: false, bomb: me.inv.bomb }, dt);
      }
    }
  }

  // ------------------------------------------------------------------ camera
  updateCamera(dt, now, look) {
    const cam = this.g.camera;
    const me = this.me;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake;
    const shx = (Math.random() - 0.5) * sh * 0.03, shy = (Math.random() - 0.5) * sh * 0.03;
    this.stepSmooth *= Math.exp(-dt * 14);
    let zoom = 1;
    let vmVisible = true;
    let indoor = 0;
    const ws = this.w;
    if (me.alive) {
      const eye = eyePosition(me);
      cam.position.set(eye[0], eye[1] + this.stepSmooth, eye[2]);
      cam.rotation.set(me.pitch + ws.punchPitch + shy, me.yaw + ws.punchYaw + shx, -me.lean * 0.13);
      if (this.bodycam) this.bodycamMotion(dt, look);
      zoom = this.currentZoom();
      const wd = WEAPONS[this.curItemId()];
      const scoped = wd?.scope && ws.scope > 0;
      this.hud.scope(scoped);
      vmVisible = !scoped;
      this.viewmodel.update({
        dt, speed: this.lastMoveSpeed, onGround: me.onGround, crouch: me.crouch, ads: ws.ads, bob: this.settings.bob,
        lookDX: look.dx, lookDY: look.dy, lower: this.progress ? 1 : 0,
        aimStyle: this.settings.aimStyle, offX: (this.settings.vmX || 0) / 100 + (this.bodycam ? -0.1 : 0), offY: (this.settings.vmY || 0) / 100 + (this.bodycam ? -0.035 : 0),
        bodycam: this.bodycam,
      });
      indoor = this.worldView.roofedAt(me.x, me.z, me.y + 1) ? 1 : 0;
    } else {
      const spec = this.specId != null ? this.players.get(this.specId) : null;
      if (spec && spec.state) {
        const s = spec.state;
        const eye = eyePosition(s);
        cam.position.set(eye[0], eye[1], eye[2]);
        cam.rotation.set(s.pitch, s.yaw, -s.lean * 0.13);
        if ((s.w || 'knife') !== this.viewmodel.id) this.viewmodel.setWeapon(s.w || 'knife', 0.2);
        this.viewmodel.update({ dt, speed: s.speed || 0, onGround: s.onGround, crouch: s.crouch, ads: 0, lookDX: 0, lookDY: 0, lower: s.planting || s.defusing ? 1 : 0, offX: (this.settings.vmX || 0) / 100, offY: (this.settings.vmY || 0) / 100 });
        vmVisible = true;
        const w = WEAPONS[s.w];
        this.hud.spectate(`Spectating <b>${esc(spec.name)}</b> · ${s.hp} HP · ${esc(w?.short || '')}<small>Fire / Aim: switch player</small>`);
        indoor = this.worldView.roofedAt(s.x, s.z, s.y + 1) ? 1 : 0;
      } else {
        // death cam: look at the killer from above the body
        vmVisible = false;
        this.hud.spectate(this.modeInfo.rounds && performance.now() - this.deadAt > 2500 ? 'No teammates alive' : null);
        const dp = this.deathPos || [me.x, me.y + 1.6, me.z];
        const k = Math.min(1, (performance.now() - this.deadAt) / 1200);
        const killer = this.killerId != null ? this.players.get(this.killerId)?.state : null;
        cam.position.set(dp[0], dp[1] + k * 1.6, dp[2]);
        if (killer) {
          const tx = killer.x - dp[0], ty = killer.y + 1.4 - cam.position.y, tz = killer.z - dp[2];
          const yaw = Math.atan2(-tx, -tz), pitch = Math.atan2(ty, Math.hypot(tx, tz));
          cam.rotation.set(lerp(cam.rotation.x, pitch, 0.08), angleLerp(cam.rotation.y, yaw, 0.08), 0);
        } else cam.rotation.set(lerp(me.pitch, -0.5, k), me.yaw, 0);
      }
    }
    this.viewmodel.setVisible(vmVisible);
    this.g.setViewmodelLight(indoor);
    this.weatherFx?.update(dt, indoor);
    this.updateTorches(dt);
    // the BodyCam view is a very wide fisheye lens (the lens pass squeezes the edges back in)
    const targetFov = this.bodycam ? 118 : this.settings.fov;
    this.curZoom = this.curZoom ? lerp(this.curZoom, zoom, Math.min(1, dt * 18)) : zoom;
    if (Math.abs(this.curZoom - zoom) < 0.002) this.curZoom = zoom;
    this.g.setFov(targetFov, this.curZoom);
    this.g.setViewmodelFov(this.settings.viewmodelFov * (1 - ws.ads * 0.12));
    this.effects.setViewport(this.g.canvas.height, this.g.vfovRad || 1.2);
    // audio listener
    const fwd = tmpV.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.audio.setListener([cam.position.x, cam.position.y, cam.position.z], [fwd.x, fwd.y, fwd.z]);
  }

  get bodycam() { return this.settings.viewStyle === 'bodycam'; }

  // Flashlights at night: ours (or the spectated player's) from the camera, everyone else's from their gun.
  updateTorches(dt) {
    const T = this.torches;
    if (!T?.active) return;
    const me = this.me;
    let local = null, skip = null;
    if (me.alive) local = { on: this.lightOn, yaw: me.yaw + this.w.punchYaw, pitch: me.pitch + this.w.punchPitch };
    else if (this.specId != null) {
      const sp = this.players.get(this.specId);
      if (sp?.state) { local = { on: !!(sp.state.flags & FLAG.LIGHT), yaw: sp.state.yaw, pitch: sp.state.pitch }; skip = sp; }
    }
    const remotes = [];
    for (const rp of this.players.values()) {
      if (rp === skip || !rp.alive || !rp.state || !(rp.state.flags & FLAG.LIGHT) || !rp.model.root.visible) continue;
      remotes.push({ pos: rp.model.muzzleWorld(new THREE.Vector3()), yaw: rp.state.yaw, pitch: rp.state.pitch, id: rp.id });
    }
    T.update(dt, local, remotes);
  }

  // A body-worn camera sits on the chest: each step bounces and rocks it, it rolls into turns and drifts
  // with breathing. Only tiny rotations, so the centre of the screen still matches where bullets go.
  bodycamMotion(dt, look) {
    const cam = this.g.camera, me = this.me;
    const bc = this.bc || (this.bc = { phase: 0, roll: 0, amp: 0, t: 0 });
    bc.t += dt;
    const sp = me.onGround ? Math.min(1.3, this.lastMoveSpeed / 5.5) : 0;
    bc.amp += (sp - bc.amp) * Math.min(1, dt * 6);
    bc.phase += dt * (5 + this.lastMoveSpeed * 1.4);
    const ads = this.w.ads;
    const a = bc.amp * (1 - ads * 0.55) * (0.4 + 0.6 * (this.settings.bob ?? 1));
    const step = Math.abs(Math.cos(bc.phase));
    const side = Math.sin(bc.phase);
    cam.position.y += (0.012 - step * 0.032) * a;
    cam.position.x += Math.cos(me.yaw) * side * 0.02 * a;
    cam.position.z -= Math.sin(me.yaw) * side * 0.02 * a;
    const turn = clamp(-(look?.dx || 0) * 1.4, -0.05, 0.05);
    bc.roll += (turn - bc.roll) * Math.min(1, dt * 5);
    const t = bc.t, calm = 1 - ads * 0.7;
    cam.rotation.z += bc.roll + side * 0.016 * a + Math.sin(t * 0.7) * 0.004 * calm;
    cam.rotation.x += (Math.sin(t * 1.3) * 0.0022 + Math.sin(t * 3.1 + 1) * 0.0008) * calm + step * 0.004 * a;
    cam.rotation.y += (Math.sin(t * 0.9 + 2) * 0.0018 + Math.sin(t * 2.3) * 0.0007) * calm;
  }

  // Timestamp overlay of the BodyCam view (date, time in UTC, device and unit).
  updateBodycamOsd() {
    const el = this.osd || (this.osd = document.getElementById('bodycam-osd'));
    if (!el) return;
    const on = this.bodycam;
    if (el.hidden === on) el.hidden = !on;
    document.body.classList.toggle('bodycam', on);
    if (!on) return;
    const d = new Date();
    const sec = Math.floor(d.getTime() / 1000);
    if (sec === this.osdSec) return;
    this.osdSec = sec;
    const p = (n) => String(n).padStart(2, '0');
    el.querySelector('.l1').textContent = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
    const unit = ((this.myId || 1) * 2654435761 >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 7);
    el.querySelector('.l2').textContent = `BODY 3  X${unit}`;
  }

  // ------------------------------------------------------------------ HUD
  updateHud(dt, now, serverNow) {
    const me = this.me;
    const hud = this.hud;
    hud.update(dt);
    const wid = this.curItemId();
    const wd = WEAPONS[wid];
    // crosshair
    let chVisible = me.alive && !(wd?.scope && this.w.scope > 0) && wd?.type !== 'sniper';
    if (wd?.type === 'sniper' && this.w.scope === 0 && me.alive) chVisible = false;
    let spreadPx = 0;
    if (wd?.spread && me.alive) {
      const sp = computeSpread(wd, { speed: this.lastMoveSpeed, onGround: me.onGround, crouch: me.crouch, ads: this.w.ads, scoped: false, bloom: this.w.bloom });
      spreadPx = (Math.tan(sp * DEG) / Math.tan((this.g.vfovRad || 1.2) / 2)) * (window.innerHeight / 2) * 0.9;
    }
    if (this.bodycam) { chVisible = chVisible && this.settings.bodycamCrosshair; spreadPx *= 1.42; } // no crosshair on body cameras; the lens magnifies the centre
    hud.crosshair(chVisible && (this.settings.aimStyle !== 'ads' || this.w.ads < 0.8), Math.min(60, spreadPx));
    this.updateBodycamOsd();
    hud.vitals(me.hp, me.armor, me.helmet, me.kit, me.inv.bomb);
    // low-health desaturation + red vignette, with a short flash on every hit taken
    this.hurtFlash = Math.max(0, (this.hurtFlash || 0) - dt * 1.8);
    const low = me.alive && me.hp < 35 ? (1 - me.hp / 35) * (0.75 + 0.25 * Math.sin(now * 0.006)) : 0;
    this.g.setHurt(me.alive ? Math.min(1, Math.max(low * 0.85, this.hurtFlash * 0.55)) : 0);
    hud.money(me.money, this.modeInfo.economy);
    const it = this.curItem();
    hud.ammo(wd?.name || '', it ? it[1] : 0, it ? it[2] : 0, wd?.mag, !!it);
    hud.slots(me.inv, me.cur, now);
    // timer
    let label = '', ms = 0;
    if (this.modeInfo.rounds) {
      ms = this.endsAt - serverNow;
      label = this.phase === 'freeze' ? 'BUY PHASE' : this.phase === 'planted' ? 'BOMB' : this.phase === 'post' ? 'ROUND OVER' : `ROUND ${this.round}`;
    } else {
      ms = this.phase === 'freeze' ? this.endsAt - serverNow : this.matchEndsAt - serverNow;
      label = MODES[this.mode].name.toUpperCase();
    }
    const planted = this.phase === 'planted';
    hud.timer(planted ? '💣' : fmtTime(ms), (this.phase === 'live' && ms < 15000) || planted, label);
    hud.bombPlanted(planted, this.bomb?.site ? `BOMB PLANTED · SITE ${this.bomb.site}` : 'BOMB PLANTED');
    // scores
    if (this.ffa) {
      const mine = this.sb?.players.find((p) => p.id === this.myId);
      const best = this.sb ? Math.max(0, ...this.sb.players.filter((p) => p.id !== this.myId).map((p) => (this.mode === 'gungame' ? p.gg + 1 : p.k))) : 0;
      hud.scores(this.mode === 'gungame' ? (mine?.gg ?? 0) + 1 : mine?.k ?? 0, best, 0, 0, 0, 0, 'left', true);
    } else {
      const count = (t) => {
        let alive = (this.me.team === t && me.alive) ? 1 : 0, total = this.me.team === t ? 1 : 0;
        for (const rp of this.players.values()) if (rp.team === t) { total++; if (rp.alive) alive++; }
        return [alive, total];
      };
      const [a1, t1] = count(1), [a2, t2] = count(2);
      hud.scores(this.score?.[1] ?? 0, this.score?.[2] ?? 0, a1, t1, a2, t2);
    }
    // gun game
    if (this.mode === 'gungame' && me.alive) {
      const next = GUNGAME_ORDER[Math.min(me.gg + 1, GUNGAME_ORDER.length - 1)];
      hud.gg(`Level <b>${me.gg + 1}</b> / ${GUNGAME_ORDER.length} · next: ${esc(WEAPONS[next]?.short || '')}`);
    } else hud.gg(null);
    // hints
    let hint = '';
    if (me.alive) {
      const ut = this.useTarget();
      const k = this.keyName('use');
      if (ut === 'plant') hint = `Hold <b>${k}</b> to plant the bomb`;
      else if (ut === 'defuse') hint = `Hold <b>${k}</b> to defuse${me.kit ? '' : ' (no kit)'}`;
      else if (ut === 'reinforce') hint = `Hold <b>${k}</b> to reinforce this wall (${me.reinforceLeft} left)`;
      else if (ut === 'pickup') { const d = this.dropTarget(); hint = `Press <b>${k}</b> to pick up ${esc(WEAPONS[d.wid]?.name || '')}`; }
      else if (this.canBuy() && this.modeInfo.economy && this.phase === 'freeze') hint = `Press <b>${this.keyName('buy')}</b> to open the buy menu`;
      else if (this.canBuy() && !this.modeInfo.economy && this.mode !== 'gungame') hint = `Press <b>${this.keyName('buy')}</b> to choose your loadout`;
      if (me.inv.bomb && !ut && this.phase === 'live' && this.mode === 'defuse') hint = hint || 'You have the bomb — plant it at site <b>A</b> or <b>B</b>';
    }
    if (!hint && this.night && me.alive && performance.now() < (this.lightHintUntil || 0)) hint = `Night: press <b>${this.keyName('flashlight')}</b> to switch your flashlight ${this.lightOn ? 'off' : 'on'}`;
    hud.hint(hint);
    // progress bar
    if (this.progress) {
      const p = this.progress;
      hud.progress(p.label, (serverNow - p.start) / (p.end - p.start), p.kind);
    } else hud.progress(null);
    // radar
    this.radarFrame = (this.radarFrame || 0) + 1;
    if (this.radarFrame % 2 === 0) this.drawRadar();
    // flash overlay
    this.updateFlash(now);
    hud.fps(this.settings.showFps ? `${this.g.perfLabel()} · CPU ${this.cpuMs?.toFixed(1) ?? '?'} ms · ping ${Math.round(this.net.rtt)} ms` : '');
    hud.netWarn(this.net.connected && performance.now() - this.net.lastMessageAt > 3000);
  }

  keyName(action) {
    if (this.input.lastDevice === 'pad') return action === 'use' ? 'X' : action === 'buy' ? 'D-pad ↑' : '';
    const code = this.settings.keys[action]?.[0];
    if (!code) return '?';
    return code.startsWith('Key') ? code.slice(3) : code.replace('Digit', '');
  }

  drawRadar() {
    const me = this.me;
    const spec = !me.alive && this.specId != null ? this.players.get(this.specId)?.state : null;
    const center = spec ? { x: spec.x, y: spec.y, z: spec.z, yaw: spec.yaw } : { x: me.x, y: me.y, z: me.z, yaw: me.yaw };
    const list = [];
    const eye = eyePosition(me);
    const now = performance.now();
    for (const rp of this.players.values()) {
      const s = rp.state;
      if (!s) continue;
      const enemy = this.isEnemyId(rp.id);
      if (enemy) {
        if (!rp.alive) continue;
        // spotted if visible to us (cheap line of sight check a few times per second)
        if (!rp.nextSpot || now > rp.nextSpot) {
          rp.nextSpot = now + 150;
          const vis = me.alive && this.world.lineOfSight(eye[0], eye[1], eye[2], s.x, s.y + 1.4, s.z);
          const dir = viewDir(me.yaw, 0);
          const dx = s.x - me.x, dz = s.z - me.z;
          const inFront = (dx * dir[0] + dz * dir[2]) / (Math.hypot(dx, dz) || 1) > 0.3;
          if (vis && inFront) rp.spottedUntil = now + 1500;
        }
        if (!(rp.spottedUntil > now)) continue;
      }
      const color = this.ffa ? '#ff5050' : enemy ? '#ff4040' : rp.team === 1 ? '#ff9a4d' : '#4aa8ff';
      list.push({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, color, enemy, dead: !rp.alive });
    }
    const b = this.bomb;
    let bomb = null;
    if (b && (me.team === TEAM.ATT || b.state === 'planted') && b.state !== 'exploded' && b.state !== 'defused') {
      if (b.state === 'carried') {
        const c = this.players.get(b.carrier);
        if (c?.state) bomb = { x: c.state.x, z: c.state.z, planted: false };
        else if (b.carrier === this.myId) bomb = null;
      } else bomb = { x: b.p[0], z: b.p[2], planted: b.state === 'planted' };
    }
    this.radar.draw(center, list, bomb);
  }

  updateFlash(now) {
    const f = this.flash;
    const white = document.getElementById('flash-white');
    const after = document.getElementById('flash-after');
    if (!f.until || now > f.until) {
      if (white.style.opacity !== '0') { white.style.opacity = '0'; after.style.opacity = '0'; }
      return;
    }
    const t = (now - f.start) / f.dur;
    const full = 0.55;
    const a = t < full ? 1 : 1 - (t - full) / (1 - full);
    white.style.opacity = String(Math.max(0, a * (f.amt || 1)) * (t < full ? 1 : 0.85));
    after.style.opacity = String(Math.max(0, Math.min(1, (1 - t) * 1.4)) * 0.8);
  }

  // called right after rendering: grab the frame for the flashbang afterimage
  afterRender() {
    if (!this.flash.capture) return;
    this.flash.capture = false;
    const c = document.getElementById('flash-after');
    const src = this.g.canvas;
    c.width = Math.max(1, Math.floor(src.width / 2));
    c.height = Math.max(1, Math.floor(src.height / 2));
    try { c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); } catch { /* ignore */ }
  }

  canBuy() {
    const me = this.me;
    if (!me.alive || this.mode === 'gungame') return false;
    if (this.modeInfo.economy) {
      if (this.phase !== 'freeze' && this.phase !== 'live') return false;
      if (this.net.serverNow() > this.buyEnds) return false;
      const zone = this.map.zones[me.team === TEAM.ATT ? 'att' : 'def'];
      return inZone(zone, me.x, me.y, me.z);
    }
    return this.net.serverNow() < (me.buyUntil || 0) + 0 || performance.now() < (this.localBuyUntil || 0);
  }

  buyState() {
    const me = this.me;
    return { money: me.money, inv: me.inv, team: me.team, free: !this.modeInfo.economy, armor: me.armor, helmet: me.helmet, kit: me.kit, mode: this.mode };
  }

  renderScoreboard() {
    const ms = this.modeInfo.rounds ? 0 : this.matchEndsAt - this.net.serverNow();
    this.ui.renderScoreboard(this.sb, { mode: this.mode, me: this.myId, score: this.score, round: this.round, timeLeft: ms > 0 ? fmtTime(ms) + ' left' : '' });
  }

  pickHeightFor(c) { return heightFor(c); }
}
