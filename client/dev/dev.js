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
  if (q.get('dead')) window.__players.forEach((m, i) => { m.die(i % 2 ? 1 : -1); for (let k = 0; k < 60; k++) m.update({ x: m.root.position.x, y: 0, z: 0, yaw: m.root.rotation.y }, 0.016); });
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
  g.camera.position.set(0, 1.1, 2.4);
  g.camera.lookAt(0, 1.0, 0);
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
