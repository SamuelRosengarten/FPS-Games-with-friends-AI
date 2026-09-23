// Breach charges, wall reinforcement, damage reports and tagging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestGame, fakeConn } from './helpers.js';
import { TEAM, viewDir } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { eyePosition } from '../shared/physics.js';

function setup(settings) {
  const g = new TestGame();
  const c = fakeConn();
  g.onConnection(c);
  c.emit('message', JSON.stringify({ t: 'hello', v: 1, name: 'Watcher' }));
  g.handleTeam([...g.players.values()][0], TEAM.NONE);
  g.applySettings(settings);
  const events = [];
  const orig = g.broadcast.bind(g);
  g.broadcast = (msg, ex) => { events.push(msg); orig(msg, ex); };
  return { g, events };
}

function human(g, name, team) {
  const conn = fakeConn();
  g.onConnection(conn);
  conn.emit('message', JSON.stringify({ t: 'hello', v: 1, name }));
  const p = [...g.players.values()].find((x) => x.name === name);
  g.handleTeam(p, team);
  return { p, conn };
}

const still = () => ({ fwd: 0, right: 0, yaw: 0 });

// A breakable panel and a free standing spot `dist` metres in front of it (either side).
function panelSpot(m, dist = 1.2) {
  for (const id of m.map.destructibles) {
    const b = m.world.byId.get(id);
    const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    if (b.min[1] > 0.5) continue;
    const alongX = b.max[0] - b.min[0] < b.max[2] - b.min[2];
    for (const s of [1, -1]) {
      const n = alongX ? [s, 0, 0] : [0, 0, s];
      const x = c[0] + n[0] * dist, z = c[2] + n[2] * dist;
      const floor = m.world.groundBelow(x, 1.5, z, 3);
      if (Math.abs(floor) > 0.05) continue;
      if (m.world.overlaps(x - 0.4, 0.05, z - 0.4, x + 0.4, 1.8, z + 0.4)) continue;
      return { b, c, n, x, z };
    }
  }
  return null;
}

function faceTarget(p, t) {
  const eye = eyePosition(p);
  const dx = t[0] - eye[0], dy = t[1] - eye[1], dz = t[2] - eye[2];
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

test('defenders reinforce panels; reinforced panels stop bullets and frags but not breach charges', () => {
  const { g, events } = setup({ map: 'compound', mode: 'defuse', fillBots: 0, freezeTime: 15 });
  const { p: d, conn } = human(g, 'Wall', TEAM.DEF);
  const att = g.addBot(TEAM.ATT);
  g.startMatch();
  g.match.onLoaded(d);
  const m = g.match;
  att.brain.update = still;
  assert.equal(m.phase, 'freeze');
  assert.equal(d.reinforceLeft, 2);
  const spot = panelSpot(m);
  assert.ok(spot, 'map has a reachable panel');
  Object.assign(d, { x: spot.x, y: 0.01, z: spot.z, onGround: true, crouch: 0 });
  faceTarget(d, [spot.c[0], 1.4, spot.c[2]]);
  m.onUse(d, true);
  g.run(1);
  assert.ok(d.reinforceEnd > 0, 'reinforcing started');
  assert.ok(conn.last('reinforce')?.ev === 'start');
  g.run(2);
  assert.equal(spot.b.reinforced, true, 'panel reinforced');
  const group = m.map.destructibles.map((id) => m.world.byId.get(id)).filter((b) => b.group === spot.b.group);
  assert.ok(group.length >= 4 && group.every((b) => b.reinforced), 'the whole wall section is reinforced');
  assert.equal(d.reinforceLeft, 1);
  assert.equal(conn.last('reinforce').ev, 'done');
  assert.ok(events.some((e) => e.t === 'walls' && e.d.some(([id, , r]) => id === spot.b.id && r === 1)));

  // a sniper shot from the other side hits steel and stops
  const o = [spot.c[0] - spot.n[0] * 3, 1.4, spot.c[2] - spot.n[2] * 3];
  const dir = [spot.n[0], 0, spot.n[2]];
  const end = m.traceBullet(att, WEAPONS.awp, o, dir, g.now());
  assert.equal(end[6], 2, 'metal impact');
  assert.equal(spot.b.hp, 100);
  assert.ok(spot.b.active);

  // frag right next to it does nothing to the panel
  m.detonate({ id: 999, type: 'frag', x: spot.c[0] - spot.n[0] * 0.4, y: 0.3, z: spot.c[2] - spot.n[2] * 0.4, thrower: att.id }, g.now());
  assert.ok(spot.b.active, 'frag cannot break reinforced wall');

  // breach charge on the far side blows it open and hurts the defender behind it
  const hp0 = d.hp;
  assert.ok(group.every((b) => b.active));
  m.detonate({ id: 1000, type: 'breach', x: spot.c[0] - spot.n[0] * 0.12, y: 1.0, z: spot.c[2] - spot.n[2] * 0.12, normal: [-spot.n[0], 0, -spot.n[2]], thrower: att.id }, g.now());
  assert.ok(group.every((b) => !b.active), 'breach opens the whole reinforced section');
  assert.ok(d.hp < hp0, 'blast reaches through the opened wall');
  assert.ok(events.some((e) => e.t === 'nade' && e.type === 'breach'));
});

test('breach charges stick where they land and detonate after the fuse; buy rules per team', () => {
  const { g, events } = setup({ map: 'compound', mode: 'defuse', fillBots: 0, freezeTime: 1 });
  const { p: a } = human(g, 'Breacher', TEAM.ATT);
  const { p: d } = human(g, 'Defender', TEAM.DEF);
  g.startMatch();
  g.match.onLoaded(a);
  g.match.onLoaded(d);
  const m = g.match;
  // buying: attackers only in Defuse
  a.money = d.money = 5000;
  m.onBuy(d, 'breach');
  assert.equal(d.inv.nades.breach, 0, 'defenders cannot buy breach charges');
  m.onBuy(a, 'breach');
  assert.equal(a.inv.nades.breach, 1);
  m.onBuy(a, 'breach');
  assert.equal(a.inv.nades.breach, 1, 'max one');
  for (let i = 0; i < 40 && m.phase !== 'live'; i++) g.run(0.5);
  assert.equal(m.phase, 'live');
  const spot = panelSpot(m, 2);
  Object.assign(a, { x: spot.x, y: 0.01, z: spot.z, onGround: true });
  faceTarget(a, [spot.c[0], 1.2, spot.c[2]]);
  m.onSwitch(a, 'breach');
  a.deployUntil = 0;
  const v = viewDir(a.yaw, a.pitch).map((x) => x * 10);
  m.onThrow(a, { o: eyePosition(a), v });
  assert.equal(a.inv.nades.breach, 0);
  g.run(0.4);
  const gr = m.grenades.find((x) => x.type === 'breach');
  assert.ok(gr && gr.stuck, 'charge stuck to the panel');
  assert.ok(events.some((e) => e.t === 'snd' && e.s === 'stick'));
  const pos = [gr.x, gr.y, gr.z];
  g.run(0.5);
  assert.deepEqual([gr.x, gr.y, gr.z], pos, 'does not move once stuck');
  g.run(1.5);
  assert.ok(events.some((e) => e.t === 'nade' && e.type === 'breach'), 'detonated');
  assert.equal(spot.b.active, false, 'panel destroyed');
});

test('damage report on death and tagging slow-down', () => {
  const { g } = setup({ map: 'compound', mode: 'tdm', fillBots: 0 });
  const { p: v, conn } = human(g, 'Victim', TEAM.DEF);
  const a = g.addBot(TEAM.ATT);
  g.startMatch();
  g.match.onLoaded(v);
  const m = g.match;
  a.brain.update = still;
  g.run(4.5);
  Object.assign(a, { x: 0, y: 0.01, z: 50, yaw: 0, pitch: 0, crouch: 0, lean: 0, spawnProtectUntil: 0 });
  Object.assign(v, { x: 0, y: 0.01, z: 40, yaw: Math.PI, pitch: 0, crouch: 0, lean: 0, spawnProtectUntil: 0, armor: 0, helmet: false });
  a.hist = []; v.hist = [];
  a.inv.primary = { id: 'p9', mag: 20, reserve: 90 };
  a.inv.secondary = null;
  a.cur = 'primary';
  a.deployUntil = 0; a.nextFire = 0; a.reloadUntil = 0;
  const base = m.speedMulFor(v);
  const eye = [0, 1.68, 50];
  const chest = [0, (1.25 - eye[1]) / 10, -1];
  const l = Math.hypot(...chest);
  m.fire(a, eye, [chest.map((x) => x / l)], g.now(), true);
  assert.ok(v.hp < 100 && v.alive);
  assert.ok(v.tagUntil > g.now(), 'tagged');
  assert.ok(m.speedMulFor(v) < base * 0.9, 'slowed while tagged');
  g.run(0.6);
  assert.ok(Math.abs(m.speedMulFor(v) - base) < 1e-9, 'tag wears off');
  // (the test spot is outside the playable area, so put the shooter back after simulating)
  Object.assign(a, { x: 0, y: 0.01, z: 50, vx: 0, vy: 0, vz: 0 });
  a.hist = []; v.hist = [];
  for (let i = 0; i < 12 && v.alive; i++) {
    a.nextFire = 0;
    m.fire(a, eye, [chest.map((x) => x / l)], g.now(), true);
  }
  assert.equal(v.alive, false);
  const rep = conn.last('report');
  assert.ok(rep, 'victim receives a damage report');
  const row = rep.taken.find(([id]) => id === a.id);
  assert.ok(row && row[1] >= 99 && row[2] >= 3, `taken ${JSON.stringify(rep.taken)}`);
});
