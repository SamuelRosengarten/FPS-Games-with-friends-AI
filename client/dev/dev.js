// Developer model viewer: /dev/?view=vm&w=ar  |  /dev/?view=players  |  /dev/?view=weapons
import * as THREE from 'three';
import { Graphics } from '../js/graphics.js';
import { ViewModel } from '../js/viewmodel.js';
import { PlayerModel, teamLook, createWeaponModel } from '../js/models.js';
import { loadSettings } from '../js/settings.js';
import { getMap } from '../shared/maps/index.js';
import { WEAPONS } from '../shared/weapons.js';
import { TextureLibrary } from '../js/textures.js';
import { WorldView } from '../js/world.js';
import { Effects } from '../js/effects.js';
import { Decor } from '../js/decor.js';
import { PhysicsWorld } from '../shared/physics.js';

const q = new URLSearchParams(location.search);
const settings = { ...loadSettings(), quality: q.get('quality') || 'high', dynamicRes: false };
const g = new Graphics(document.getElementById('wrap'), settings);
const map = getMap(q.get('map') || 'sandstone');
g.setupEnvironment(map);
const view0 = q.get('view') || 'vm';
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0xb09878, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
if (view0 !== 'map') g.scene.add(floor);
const wall = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 0.5), new THREE.MeshStandardMaterial({ color: 0xc8a878, roughness: 0.9 }));
wall.position.set(0, 2, -6);
wall.castShadow = wall.receiveShadow = true;
if (view0 !== 'map') g.scene.add(wall);
const view = view0;
const label = document.getElementById('label');
let vm;
if (view === 'vm') {
  vm = new ViewModel(g);
  vm.setLook(teamLook(+(q.get('team') || 1), 1, false));
  vm.setWeapon(q.get('w') || 'ar', 0.01);
  vm.deployT = 1;
  g.camera.position.set(0, 1.68, 2);
  label.textContent = `viewmodel: ${q.get('w') || 'ar'}${q.get('ads') ? ' (ADS)' : ''}`;
} else if (view === 'map') {
  const tex = new TextureLibrary(g.renderer, g.quality);
  const mats = [...new Set([...map.boxes.map((b) => b.mat), 'woodPanel', 'lamp', 'barrel', map.decor?.trim || map.mats.building || 'concrete'])];
  await tex.prepare(mats);
  const wv = new WorldView(g, tex, map);
  const decor = q.get('decor') === '0' ? null : new Decor(g, tex, map);
  if (q.get('probe') !== '0') g.captureEnvironment(map, [decor?.skyline?.group]);
  if (q.get('reinforce')) map.destructibles.forEach((id, i) => { if (Math.floor(i / 6) % 2 === 0) wv.setPanelReinforced(id, true); });
  window.__decor = decor;
  const cam = (q.get('cam') || '0,1.7,0,0,0').split(',').map(Number);
  g.camera.position.set(cam[0], cam[1], cam[2]);
  g.camera.rotation.set(cam[4] || 0, cam[3] || 0, 0);
  // a few characters for scale
  const sp = [...map.spawns[1].slice(0, 2), ...map.spawns[2].slice(0, 2)];
  sp.forEach((p, i) => {
    const m = new PlayerModel(teamLook(i < 2 ? 1 : 2, i, false));
    m.setWeapon(['ar', 'smg', 'm4', 'awp'][i]);
    m.update({ x: p[0], y: p[1], z: p[2], yaw: p[3], pitch: 0, crouch: 0, lean: 0, speed: 0, onGround: true }, 0.016);
    g.scene.add(m.root);
  });
  if (q.get('fx')) {
    // effects test: explosion ahead, impacts + blood on the nearest wall, casings, muzzle smoke
    const fx = new Effects(g);
    const world = new PhysicsWorld(map.boxes, map.bounds);
    fx.setWorld(world);
    fx.setAmbient(map.theme.motes);
    const yaw = cam[3], dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    const ex = [cam[0] + dx * 7, world.groundBelow(cam[0] + dx * 7, 3, cam[2] + dz * 7, 5) + 0.1, cam[2] + dz * 7];
    const which = q.get('fx');
    if (which.includes('e')) fx.explosion(ex, true);
    if (which.includes('s')) fx.addSmoke(1, [ex[0] + 3, ex[1], ex[2]], performance.now() - 3000, performance.now() + 20000, performance.now(), 0.85);
    const h = world.raycast(cam[0], cam[1], cam[2], dx, -0.05, dz, 40);
    if (h && which.includes('i')) {
      for (let i = 0; i < 12; i++) {
        const p = [cam[0] + dx * h.t + (Math.random() - 0.5) * 1.5 * Math.abs(dz), cam[1] - 0.05 * h.t + (Math.random() - 0.5), cam[2] + dz * h.t + (Math.random() - 0.5) * 1.5 * Math.abs(dx)];
        fx.impact(p, h.n, i % 3, true);
      }
      fx.bloodDecal([cam[0] + dx * h.t, cam[1] - 0.05 * h.t + 0.4, cam[2] + dz * h.t], h.n, 0.7);
      fx.bloodDecal([cam[0] + dx * (h.t - 1.5), world.groundBelow(cam[0] + dx * (h.t - 1.5), 2, cam[2] + dz * (h.t - 1.5)), cam[2] + dz * (h.t - 1.5)], [0, 1, 0], 1);
    }
    if (which.includes('c')) for (let i = 0; i < 8; i++) fx.casing([cam[0] + dx * 1.2 + 0.3, cam[1] - 0.2, cam[2] + dz * 1.2], [Math.cos(yaw) * 1.5 + (Math.random() - 0.5), 1.5, -Math.sin(yaw) * 1.5], i % 4 === 0);
    window.__fx = fx;
  }
  if (q.get('smoke')) {
    const fx = new Effects(g);
    fx.addSmoke(1, [cam[0] - Math.sin(cam[3]) * 8, 0, cam[2] - Math.cos(cam[3]) * 8], performance.now() - 3000, performance.now() + 20000, performance.now(), 0.85);
    window.__fx = fx;
  }
  label.textContent = `${map.name} ${q.get('cam')}`;
  void wv;
} else if (view === 'players') {
  const specs = [[1, 0, 0], [2, 0, 0], [1, 1, 0], [2, 0, 1], [1, 0, -1]];
  window.__players = [];
  specs.forEach(([team, crouch, lean], i) => {
    const m = new PlayerModel(teamLook(team, i, false), `Player${i}`, true);
    window.__players.push(m);
    m.setWeapon(['ar', 'm4', 'awp', 'smg', 'deagle'][i]);
    m.update({ x: (i - 2) * 1.4, y: 0, z: 0, yaw: Math.PI + (i - 2) * 0.35, pitch: 0, crouch, lean, speed: 0, onGround: true }, 0.016);
    g.scene.add(m.root);
  });
  const pc = (q.get('cam') || '0,1.5,5.5,0,1,0').split(',').map(Number);
  g.camera.position.set(pc[0], pc[1], pc[2]);
  g.camera.lookAt(pc[3], pc[4], pc[5]);
  if (q.get('dead')) window.__players.forEach((m, i) => { m.die(i % 2 ? 1 : -1); for (let k = 0; k < +(q.get('dead')) ; k++) m.update({ x: m.root.position.x, y: 0, z: 0, yaw: m.root.rotation.y }, 0.016); });
  if (q.get('walk')) window.__players.forEach((m, i) => { for (let k = 0; k < +(q.get('walk')) + i * 7; k++) m.update({ x: m.root.position.x, y: 0, z: 0, yaw: m.root.rotation.y, pitch: 0, crouch: 0, lean: 0, speed: +(q.get('speed') || 5.5), vx: -Math.sin(m.root.rotation.y) * +(q.get('speed') || 5.5), vz: -Math.cos(m.root.rotation.y) * +(q.get('speed') || 5.5), onGround: true }, 0.016); });
  if (q.get('reload')) window.__players.forEach((m) => { for (let k = 0; k < 20; k++) m.update({ x: m.root.position.x, y: 0, z: 0, yaw: m.root.rotation.y, pitch: 0, crouch: 0, lean: 0, speed: 0, onGround: true, reloading: true }, 0.016); });
  label.textContent = 'player models';
} else {
  const ids = Object.keys(WEAPONS);
  ids.forEach((id, i) => {
    const m = createWeaponModel(id);
    m.position.set((i % 5 - 2) * 0.55, 1.2 + Math.floor(i / 5) * -0.35 + 0.4, 0);
    m.rotation.y = Math.PI / 2;
    g.scene.add(m);
  });
  const wc = (q.get('cam') || '0,1.1,2.4,0,1.0,0').split(',').map(Number);
  g.camera.position.set(wc[0], wc[1], wc[2]);
  g.camera.lookAt(wc[3], wc[4], wc[5]);
  label.textContent = 'weapons';
}
g.setFov(settings.fov);
let t = 0;
function loop() {
  const dt = 1 / 60;
  t += dt;
  if (window.__fx) window.__fx.update(dt, performance.now());
  if (window.__decor) window.__decor.update(dt, t);
  if (vm) vm.update({ dt, speed: 0, onGround: true, crouch: 0, ads: q.get('ads') ? 1 : 0, lookDX: 0, lookDY: 0, bob: 1 });
  g.render(dt);
  requestAnimationFrame(loop);
}
loop();
window.__ready = true;
window.__vm = vm; window.__g = g;
