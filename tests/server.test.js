// End-to-end checks against a real server process over WebSocket (Node's built-in client).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
let proc;

before(async () => {
  proc = spawn(process.execPath, ['server/index.js', '--port', String(PORT), '--no-open'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 8000);
    proc.stdout.on('data', (d) => { if (String(d).includes('is running')) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
});

after(() => proc?.kill());

function client(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const inbox = [];
  const waiters = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  };
  const c = {
    ws, inbox,
    send: (o) => ws.send(JSON.stringify(o)),
    wait: (pred, ms = 5000) => new Promise((resolve, reject) => {
      const found = inbox.find(pred);
      if (found) return resolve(found);
      const w = { pred, resolve };
      waiters.push(w);
      setTimeout(() => reject(new Error('timeout waiting for message')), ms);
    }),
    open: new Promise((r) => { ws.onopen = r; }),
  };
  c.hello = async () => { await c.open; c.send({ t: 'hello', v: PROTOCOL_VERSION, name }); return c.wait((m) => m.t === 'welcome'); };
  return c;
}

test('serves the client and shared modules over http', async () => {
  const html = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.text());
  assert.match(html, /BREACH/);
  const js = await fetch(`http://127.0.0.1:${PORT}/shared/weapons.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const three = await fetch(`http://127.0.0.1:${PORT}/vendor/three/three.module.min.js`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(three.status, 200);
  const bad = await fetch(`http://127.0.0.1:${PORT}/../package.json`);
  assert.notEqual(bad.status, 200);
  const info = await fetch(`http://127.0.0.1:${PORT}/api/info`).then((r) => r.json());
  assert.equal(typeof info.name, 'string');
});

test('lobby, host controls, match start and snapshots over websocket', async () => {
  const a = client('Alice');
  const wa = await a.hello();
  assert.equal(wa.host, true, 'first player is host');
  const b = client('Bob');
  const wb = await b.hello();
  assert.equal(wb.host, false);
  assert.notEqual(wa.id, wb.id);

  // duplicate names get a suffix
  const c = client('Alice');
  await c.hello();
  const lobby = await c.wait((m) => m.t === 'lobby' && m.players.length === 3);
  assert.ok(lobby.players.some((p) => p.name === 'Alice2'));
  c.ws.close();

  // non-host cannot change settings
  b.send({ t: 'host', action: 'settings', settings: { map: 'compound' } });
  // host can
  a.send({ t: 'host', action: 'settings', settings: { map: 'arena', mode: 'tdm' } });
  const l2 = await a.wait((m) => m.t === 'lobby' && m.settings.map === 'arena');
  assert.equal(l2.settings.mode, 'tdm');

  // chat
  b.send({ t: 'chat', text: 'hello there' });
  const chat = await a.wait((m) => m.t === 'chat' && m.text === 'hello there');
  assert.equal(chat.name, 'Bob');

  // start match
  a.send({ t: 'host', action: 'addBot', team: 2 });
  a.send({ t: 'host', action: 'start' });
  const match = await b.wait((m) => m.t === 'match');
  assert.equal(match.map, 'arena');
  const tp = await b.wait((m) => m.t === 'tp');
  const snap = await b.wait((m) => m.t === 's' && m.p.length >= 3);
  assert.ok(snap.p.every((p) => Array.isArray(p) && p.length === 11));
  const you = await b.wait((m) => m.t === 'you' && m.alive);
  assert.ok(you.inv.secondary, 'spawned with a pistol');

  // movement input is accepted and reflected in snapshots
  const bid = wb.id;
  const target = [tp.p[0] + 0.5, tp.p[1], tp.p[2]];
  await new Promise((r) => setTimeout(r, 4200)); // wait for the start countdown
  for (let i = 0; i < 5; i++) {
    b.send({ t: 'in', tp: tp.id, p: target, v: [0, 0, 0], yaw: 1, pitch: 0, c: 0, l: 0, g: 1, w: 0, a: 0 });
    await new Promise((r) => setTimeout(r, 30));
  }
  const moved = await a.wait((m) => m.t === 's' && m.p.some((p) => p[0] === bid && Math.abs(p[1] - target[0]) < 0.02), 3000);
  assert.ok(moved);

  // shooting uses ammo (server confirms via reload later) and broadcasts fire
  b.send({ t: 'shoot', ts: 0, o: null, d: [[0, 0, -1]] });
  const fire = await a.wait((m) => m.t === 'fire' && m.id === bid, 3000);
  assert.equal(fire.e.length, 1);

  // teleport cheats get corrected
  b.send({ t: 'in', tp: tp.id, p: [target[0] + 40, target[1], target[2]], v: [0, 0, 0], yaw: 1, pitch: 0, c: 0, l: 0, g: 1, w: 0, a: 0 });
  const fix = await b.wait((m) => m.t === 'tp' && m.id > tp.id, 3000);
  assert.ok(Math.abs(fix.p[0] - target[0]) < 0.1);

  a.ws.close();
  // host migrates to Bob
  const hostMsg = await b.wait((m) => m.t === 'host' && m.host === true, 3000);
  assert.ok(hostMsg);
  b.ws.close();
});

test('rejects clients with the wrong protocol version', async () => {
  const c = client('Old');
  await c.open;
  c.send({ t: 'hello', v: -1, name: 'Old' });
  const err = await c.wait((m) => m.t === 'error');
  assert.match(err.msg, /version/i);
});
