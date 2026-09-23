// Bot diagnostics: runs fast-forwarded bot-only matches and reports how the bots behave.
//   node tools/bot-report.js [map] [mode] [difficulty] [minutes]
import { TestGame, fakeConn } from '../tests/helpers.js';
import { TEAM } from '../shared/constants.js';
import { eyePosition } from '../shared/physics.js';

const [map = 'sandstone', mode = 'tdm', difficulty = 'normal', minutes = '4'] = process.argv.slice(2);

const g = new TestGame();
const c = fakeConn();
g.onConnection(c);
c.emit('message', JSON.stringify({ t: 'hello', v: 1, name: 'Obs' }));
g.handleTeam([...g.players.values()][0], TEAM.NONE);
g.applySettings({ map, mode, fillBots: 5, botDifficulty: difficulty, maxRounds: 16, scoreLimit: 999, timeLimit: +minutes + 1 });
const ev = [];
const orig = g.broadcast.bind(g);
g.broadcast = (m, ex) => { ev.push(m); orig(m, ex); };
g.startMatch();
const m = g.match;

const S = new Map(); // per bot stats
const stat = (p) => {
  if (!S.has(p.id)) S.set(p.id, { name: p.name, shots: 0, hits: 0, kills: 0, deaths: 0, stuckMs: 0, aliveMs: 0, idleMs: 0, wallStareMs: 0, blindsided: 0, deathsSeenNoShot: 0, reacts: [], firstHit: [], engagements: 0, won: 0 });
  return S.get(p.id);
};

// hook damage/kill
const origApply = m.applyDamage.bind(m);
m.applyDamage = (target, h, a, attacker, w, o) => {
  if (attacker && attacker.bot && attacker !== target) {
    const s = stat(attacker);
    s.hits++;
    if (attacker.eng && !attacker.eng.hit) { attacker.eng.hit = true; s.firstHit.push(m.now - attacker.eng.t); }
  }
  return origApply(target, h, a, attacker, w, o);
};
const origKill = m.kill.bind(m);
m.kill = (target, attacker, w, o) => {
  if (target.alive) {
    if (target.bot) {
      const s = stat(target);
      s.deaths++;
      const b = target.brain;
      const saw = b && b.visible.some((v) => v.q === attacker);
      if (attacker && attacker !== target && !saw && !(b.target === attacker)) s.blindsided++;
      if (attacker && b && b.target === attacker && !target.eng?.shot) s.deathsSeenNoShot++;
    }
    if (attacker && attacker.bot && attacker !== target) {
      stat(attacker).kills++;
      if (attacker.eng && attacker.eng.q === target) stat(attacker).won++;
    }
  }
  return origKill(target, attacker, w, o);
};
const origFire = m.fire.bind(m);
m.fire = (p, o, d, ts, fb) => {
  const r = origFire(p, o, d, ts, fb);
  if (r && p.bot) { stat(p).shots++; if (p.eng && !p.eng.shot) { p.eng.shot = true; stat(p).reacts.push(m.now - p.eng.t); } }
  return r;
};

const dt = 1 / 60;
const total = +minutes * 60;
let t = 0;
while (t < total && g.match && !g.match.ended) {
  g.clock += dt * 1000;
  m.tick(dt);
  t += dt;
  for (const p of g.players.values()) {
    if (!p.bot || !p.alive || !m.inMatch(p)) continue;
    const s = stat(p);
    s.aliveMs += dt * 1000;
    const b = p.brain;
    const sp = Math.hypot(p.vx || 0, p.vz || 0);
    // wants to move along a path but isn't getting anywhere
    const moving = b.path && b.pathIdx < b.path.length && !b.target && !b.use;
    p.slowMs = moving && sp < 0.8 ? (p.slowMs || 0) + dt * 1000 : 0;
    if (p.slowMs > 500) { s.stuckMs += dt * 1000; if (!p.stuckAt) p.stuckAt = [Math.round(p.x), Math.round(p.y * 10) / 10, Math.round(p.z)]; }
    else if (p.stuckAt) { (s.stuckSpots ||= []).push(p.stuckAt); p.stuckAt = null; }
    if (sp < 0.3 && !b.target && !b.use && m.phase === 'live') s.idleMs += dt * 1000;
    // looking straight into a wall less than 1.2 m away while not fighting
    if (!b.target) {
      const e = eyePosition(p);
      const d = [-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch)];
      const h = m.world.raycast(e[0], e[1], e[2], d[0], d[1], d[2], 1.2);
      if (h) s.wallStareMs += dt * 1000;
    }
    // engagement tracking
    if (b.target && (!p.eng || p.eng.q !== b.target)) { p.eng = { q: b.target, t: m.now, shot: false, hit: false }; s.engagements++; }
    if (!b.target) p.eng = null;
  }
}

const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : '-');
const rows = [...S.values()];
const sum = (k) => rows.reduce((x, r) => x + r[k], 0);
console.log(`${map} ${mode} ${difficulty} ${minutes}min: kills ${ev.filter((e) => e.t === 'kill').length}, rounds ${ev.filter((e) => e.t === 'round' && e.phase === 'post').length}`);
if (mode === 'defuse') {
  const posts = ev.filter((e) => e.t === 'round' && e.phase === 'post');
  const reasons = {};
  for (const e of posts) reasons[e.reason] = (reasons[e.reason] || 0) + 1;
  console.log('round endings', JSON.stringify(reasons), 'plants', ev.filter((e) => e.t === 'bomb' && e.ev === 'planted').map((e) => e.site).join(''),
    'reinforced', ev.filter((e) => e.t === 'snd' && e.s === 'reinforced').length, 'nades', JSON.stringify(ev.filter((e) => e.t === 'nade').reduce((a, e) => { a[e.type] = (a[e.type] || 0) + 1; return a; }, {})));
}
console.log(`accuracy ${(sum('hits') / Math.max(1, sum('shots')) * 100).toFixed(1)}%  shots ${sum('shots')}  engagements ${sum('engagements')}  won ${sum('won')}`);
console.log(`reaction to first shot ${avg(rows.flatMap((r) => r.reacts))} ms, to first hit ${avg(rows.flatMap((r) => r.firstHit))} ms`);
console.log(`deaths ${sum('deaths')}: blindsided ${sum('blindsided')}, saw killer but never shot ${sum('deathsSeenNoShot')}`);
const alive = sum('aliveMs');
const spots = {};
for (const r of rows) for (const sp of r.stuckSpots || []) { const k = sp.join(','); spots[k] = (spots[k] || 0) + 1; }
console.log('top stuck spots', Object.entries(spots).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}×${v}`).join('  '));
console.log(`time share: stuck ${(sum('stuckMs') / alive * 100).toFixed(1)}%  idle ${(sum('idleMs') / alive * 100).toFixed(1)}%  staring at wall ${(sum('wallStareMs') / alive * 100).toFixed(1)}%`);
