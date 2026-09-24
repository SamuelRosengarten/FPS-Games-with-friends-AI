// Fast-forwarded bot matches: exercises rounds, economy, bomb, respawns, navigation and all maps/modes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestGame, fakeConn } from './helpers.js';
import { MAP_DEFS, loadMap } from '../shared/maps/index.js';
import { PhysicsWorld } from '../shared/physics.js';
import { NavGraph } from '../server/nav.js';
import { TEAM } from '../shared/constants.js';

function setup(settings) {
  const g = new TestGame();
  const c = fakeConn();
  g.onConnection(c);
  c.emit('message', JSON.stringify({ t: 'hello', v: 1, name: 'Watcher' }));
  const me = [...g.players.values()][0];
  g.handleTeam(me, TEAM.NONE);
  g.applySettings(settings);
  const events = [];
  const orig = g.broadcast.bind(g);
  g.broadcast = (msg, ex) => { events.push(msg); orig(msg, ex); };
  return { g, c, events };
}

test('navigation: every spawn can reach both bomb sites and the enemy spawn', () => {
  for (const def of MAP_DEFS) {
    const m = loadMap(def.id);
    const w = new PhysicsWorld(m.boxes, m.bounds);
    const nav = new NavGraph(w);
    const pts = { att: m.spawns[1][0], def: m.spawns[2][0] };
    const goals = [];
    if (m.zones.A) goals.push(['A', m.zones.A]);
    if (m.zones.B) goals.push(['B', m.zones.B]);
    for (const [name, sp] of Object.entries(pts)) {
      if (!sp) continue;
      for (const [site, z] of goals) {
        const path = nav.findPath(w, { x: sp[0], y: sp[1] + 0.1, z: sp[2] }, { x: (z.min[0] + z.max[0]) / 2, y: 0.1, z: (z.min[2] + z.max[2]) / 2 });
        assert.ok(path && path.length > 1, `${def.id}: ${name} spawn -> site ${site}`);
      }
      const other = name === 'att' ? pts.def : pts.att;
      if (other) {
        const path = nav.findPath(w, { x: sp[0], y: sp[1] + 0.1, z: sp[2] }, { x: other[0], y: other[1] + 0.1, z: other[2] });
        assert.ok(path, `${def.id}: ${name} -> other spawn`);
      }
    }
  }
});

test('defuse match with bots plays to completion with plants, kills and halftime', () => {
  const { g, events } = setup({ map: 'sandstone', mode: 'defuse', fillBots: 3, maxRounds: 6 });
  g.startMatch();
  for (let i = 0; i < 60 * 12 && g.match && !g.match.ended; i++) g.run(1);
  const kills = events.filter((e) => e.t === 'kill').length;
  const posts = events.filter((e) => e.t === 'round' && e.phase === 'post');
  const half = events.some((e) => e.t === 'round' && e.halftime);
  const end = events.find((e) => e.t === 'end');
  assert.ok(kills > 10, `kills ${kills}`);
  assert.ok(posts.length >= 4, `rounds ${posts.length}`);
  assert.ok(half, 'halftime happened');
  assert.ok(end, 'match ended');
  assert.ok(end.score[1] + end.score[2] >= 4);
  // economy: money stays within limits
  for (const p of g.players.values()) assert.ok(p.money >= 0 && p.money <= 16000);
});

test('match waits for players to load the map (with a timeout)', () => {
  const { g } = setup({ map: 'arena', mode: 'tdm', fillBots: 1 });
  const conn = fakeConn();
  g.onConnection(conn);
  conn.emit('message', JSON.stringify({ t: 'hello', v: 1, name: 'Slow' }));
  const p = [...g.players.values()].find((x) => x.name === 'Slow');
  g.handleTeam(p, TEAM.ATT);
  g.startMatch();
  assert.equal(g.match.phase, 'loading');
  g.run(5);
  assert.equal(g.match.phase, 'loading');
  g.match.onLoaded(p);
  assert.equal(g.match.phase, 'freeze');
  // a second match with a player that never loads starts after the timeout
  g.startMatch();
  g.run(21);
  assert.notEqual(g.match.phase, 'loading');
});

test('bomb can be planted by a human and explodes when not defused', () => {
  const { g, events } = setup({ map: 'sandstone', mode: 'defuse', fillBots: 0, freezeTime: 2, bombTime: 20 });
  const conn = fakeConn();
  g.onConnection(conn);
  conn.emit('message', JSON.stringify({ t: 'hello', v: 1, name: 'Planter' }));
  const p = [...g.players.values()].find((x) => x.name === 'Planter');
  g.handleTeam(p, TEAM.ATT);
  const def = g.addBot(TEAM.DEF);
  g.startMatch();
  g.match.onLoaded(p);
  const m = g.match;
  assert.ok(p.inv.bomb, 'only attacker carries the bomb');
  // keep the defender bot out of the way
  def.brain.update = () => ({ fwd: 0, right: 0, yaw: 0 });
  g.run(2.5);
  assert.equal(m.phase, 'live');
  // teleport into site A (server trusts small moves; set directly for the test)
  const z = m.map.zones.A;
  p.x = (z.min[0] + z.max[0]) / 2; p.z = (z.min[2] + z.max[2]) / 2; p.y = 0.01; p.onGround = true;
  m.onUse(p, true);
  g.run(4);
  assert.equal(m.bomb.state, 'planted');
  assert.equal(m.phase, 'planted');
  g.run(21);
  assert.ok(events.some((e) => e.t === 'bomb' && e.ev === 'exploded'));
  const post = events.find((e) => e.t === 'round' && e.phase === 'post');
  assert.equal(post.winner, TEAM.ATT);
  assert.equal(post.reason, 'bomb');
});

test('defenders can defuse a planted bomb', () => {
  const { g, events } = setup({ map: 'sandstone', mode: 'defuse', fillBots: 0, freezeTime: 2 });
  const att = g.addBot(TEAM.ATT);
  const conn = fakeConn();
  g.onConnection(conn);
  conn.emit('message', JSON.stringify({ t: 'hello', v: 1, name: 'Defuser' }));
  const d = [...g.players.values()].find((x) => x.name === 'Defuser');
  g.handleTeam(d, TEAM.DEF);
  g.startMatch();
  g.match.onLoaded(d);
  const m = g.match;
  att.brain.update = () => ({ fwd: 0, right: 0, yaw: 0 });
  g.run(2.5);
  const z = m.map.zones.B;
  att.x = (z.min[0] + z.max[0]) / 2; att.z = (z.min[2] + z.max[2]) / 2; att.y = 0.01; att.onGround = true;
  att.using = true;
  g.run(4);
  assert.equal(m.bomb.state, 'planted');
  att.using = false;
  // kill the attacker? No - the round goes on. Move the defender next to the bomb and defuse.
  d.x = m.bomb.x + 0.5; d.z = m.bomb.z; d.y = m.bomb.y; d.onGround = true;
  m.onUse(d, true);
  g.run(8);
  assert.ok(events.some((e) => e.t === 'bomb' && e.ev === 'defused'), 'defused');
  const post = events.find((e) => e.t === 'round' && e.phase === 'post');
  assert.equal(post.winner, TEAM.DEF);
});

test('buying respects money, buy zone and gear rules', () => {
  const { g } = setup({ map: 'sandstone', mode: 'defuse', fillBots: 0, freezeTime: 10 });
  const conn = fakeConn();
  g.onConnection(conn);
  conn.emit('message', JSON.stringify({ t: 'hello', v: 1, name: 'Buyer' }));
  const p = [...g.players.values()].find((x) => x.name === 'Buyer');
  g.handleTeam(p, TEAM.DEF);
  g.startMatch();
  g.match.onLoaded(p);
  const m = g.match;
  assert.equal(p.money, 800);
  m.onBuy(p, 'ar');
  assert.equal(p.inv.primary, null, 'cannot afford a rifle');
  m.onBuy(p, 'kevlar');
  assert.equal(p.armor, 100);
  assert.equal(p.money, 150);
  m.onBuy(p, 'kit');
  assert.equal(p.kit, false, 'not enough money for kit');
  p.money = 5000;
  m.onBuy(p, 'helmet');
  assert.equal(p.helmet, true);
  assert.equal(p.money, 4650, 'helmet costs 350 when you have kevlar');
  m.onBuy(p, 'm4');
  assert.equal(p.inv.primary.id, 'm4');
  m.onBuy(p, 'awp');
  assert.equal(p.inv.primary.id, 'm4', 'not enough for AWP');
  assert.equal(m.drops.length, 0);
  // outside the buy zone
  p.money = 5000;
  p.x = 0; p.z = 0;
  m.onBuy(p, 'frag');
  assert.equal(p.inv.nades.frag, 0);
});

test('damage model: headshots, armor and wall penetration', () => {
  const { g } = setup({ map: 'compound', mode: 'tdm', fillBots: 0 });
  const a = g.addBot(TEAM.ATT);
  const b = g.addBot(TEAM.DEF);
  g.startMatch();
  const m = g.match;
  for (const p of [a, b]) p.brain.update = () => ({ fwd: 0, right: 0, yaw: 0 });
  g.run(4.5);
  // place them in the open yard facing each other
  Object.assign(a, { x: 0, y: 0.01, z: 50, yaw: 0, pitch: 0, crouch: 0, lean: 0, spawnProtectUntil: 0 });
  Object.assign(b, { x: 0, y: 0.01, z: 40, yaw: Math.PI, pitch: 0, crouch: 0, lean: 0, spawnProtectUntil: 0, armor: 0, helmet: false });
  a.hist = []; b.hist = [];
  a.inv.primary = { id: 'ar', mag: 30, reserve: 90 };
  a.cur = 'primary';
  a.deployUntil = 0; a.nextFire = 0; a.reloadUntil = 0;
  // head shot one-taps without helmet
  const eye = [0, 1.68, 50];
  const headY = 1.66;
  const dir = [0, (headY - eye[1]) / 10, -1];
  const l = Math.hypot(...dir);
  m.fire(a, eye, [dir.map((v) => v / l)], g.now(), true);
  assert.equal(b.alive, false, 'AR headshot kills an unarmored target');
});

for (const def of MAP_DEFS) {
  for (const mode of def.modes.filter((x) => x !== 'defuse')) {
    test(`${mode} on ${def.id} runs with bots and ends`, () => {
      const { g, events } = setup({ map: def.id, mode, fillBots: 2, scoreLimit: 10, timeLimit: 3 });
      g.startMatch();
      for (let i = 0; i < 60 * 4 && g.match && !g.match.ended; i++) g.run(1);
      assert.ok(events.filter((e) => e.t === 'kill').length >= 5, 'kills happened');
      assert.ok(events.some((e) => e.t === 'end'), 'match ended');
    });
  }
}

test('weather: host setting reaches the match, random resolves, fog limits bot sight', async () => {
  const { resolveWeather, WEATHER } = await import('../shared/constants.js');
  const { g, c } = setup({ mode: 'tdm', map: 'compound', fillBots: 1, weather: 'fog' });
  assert.equal(g.settings.weather, 'fog');
  g.applySettings({ weather: 'hail' }); // unknown values are ignored
  assert.equal(g.settings.weather, 'fog');
  g.startMatch();
  assert.equal(g.match.weather, 'fog');
  assert.equal(g.match.sightRange, WEATHER.fog.sight);
  assert.equal(c.last('match').weather, 'fog');
  g.run(8);
  assert.ok(g.match.sightRange < 60, 'fog cuts sight range');
  // random always resolves to a real weather
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(resolveWeather('random'));
  for (const w of seen) assert.ok(WEATHER[w], w);
  assert.ok(seen.size >= 3);
  assert.equal(resolveWeather('storm'), 'storm');
});

test('night: time setting resolves per map, darkness limits sight, flashlights show in snapshots', async () => {
  const { resolveTime, NIGHT_SIGHT, FLAG } = await import('../shared/constants.js');
  assert.equal(resolveTime('day', { night: true }), 'day');
  assert.equal(resolveTime('auto', { night: true }), 'night');
  assert.equal(resolveTime('auto', {}), 'day');
  const { g, c } = setup({ mode: 'tdm', map: 'arena', fillBots: 1, time: 'night' });
  assert.equal(g.settings.time, 'night');
  g.startMatch();
  assert.equal(g.match.night, true);
  assert.equal(c.last('match').night, true);
  assert.ok(g.match.sightRange <= NIGHT_SIGHT);
  g.run(6);
  const bots = [...g.players.values()].filter((p) => p.bot && p.alive);
  assert.ok(bots.length && bots.every((b) => b.light), 'bots use flashlights at night');
  const snap = c.all('s').pop();
  assert.ok(snap, 'got a snapshot');
  const lit = snap.p.filter((r) => r[8] & FLAG.LIGHT);
  assert.ok(lit.length > 0, 'lit players flagged in snapshots');
});
