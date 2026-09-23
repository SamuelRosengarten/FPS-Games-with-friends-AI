// Sandstone - a sunny desert town with two bomb sites, a long mid, covered tunnels and a long A lane.

export default {
  id: 'sandstone',
  name: 'Sandstone',
  desc: 'Sun-baked desert town. Long sightlines through mid, tight tunnels to B, and a long corner to A.',
  modes: ['defuse', 'tdm', 'ffa', 'gungame'],
  rows: 40,
  cols: 40,
  cellSize: 2,
  wallHeight: 6,
  buildingHeight: 4.4,
  roofHeight: 3.4,
  roofTop: 4.2,
  mats: {
    wall: 'sandstone', wall2: 'sandstoneDark', building: 'sandstoneLight', floor: 'sand', floor2: 'stoneTiles',
    raised: 'stoneTiles', crate: 'crate', crate2: 'crateDark', low: 'sandbag', roof: 'wood', destructible: 'woodPanel',
  },
  theme: {
    motes: { color: 0xffe2b0, alpha: 0.55, count: 600 },
    grade: { gain: [1.05, 1.0, 0.92], lift: [0.015, 0.01, 0.0], contrast: 1.1, saturation: 1.1, vignette: 0.3, grain: 0.02 },
    cloudCover: 0.32, cloudColor: 0xffffff,
    sky: { turbidity: 2.2, rayleigh: 1.1, mie: 0.0035, mieG: 0.86 },
    skyTop: 0x2466c2, skyHorizon: 0xc4d8ea, skyBottom: 0xc9b28c,
    fog: 0xc9d3d6, fogNear: 90, fogFar: 320,
    sun: { dir: [0.42, 0.72, 0.46], color: 0xfff0d6, intensity: 3.4 },
    hemi: { sky: 0xcfe2ff, ground: 0x9c7c55, intensity: 1.0 },
    exposure: 1.0,
    ambientSound: 'wind',
  },
  carve(g) {
    // defender spawn + routes out
    g.fill(1, 15, 5, 24, '.');
    g.fill(2, 12, 4, 14, '.');
    g.fill(2, 25, 4, 27, '.');
    // bomb site areas
    g.fill(2, 2, 12, 11, '.');
    g.fill(2, 28, 12, 37, '.');
    // mid plaza and its doors
    g.fill(8, 15, 12, 24, '.');
    g.fill(6, 19, 7, 20, 'D');
    g.fill(9, 12, 11, 14, '.');
    g.fill(9, 25, 11, 27, '.');
    // mid
    g.fill(13, 18, 31, 21, '.');
    // attacker spawn and exits
    g.fill(32, 14, 38, 25, '.');
    g.fill(32, 3, 35, 13, '.');
    g.fill(32, 26, 35, 36, '.');
    // B tunnels (roofed)
    g.fill(13, 3, 31, 6, '.');
    g.roof(13, 3, 31, 6);
    g.fill(20, 7, 21, 17, '.');
    g.roof(20, 7, 21, 17);
    g.fill(20, 17, 21, 17, 'D');
    // long A with long doors
    g.fill(13, 33, 31, 37, '.');
    g.fill(22, 33, 23, 37, '#');
    g.fill(22, 34, 23, 35, 'D');
    // mid to long connector, blocked by a breakable wall
    g.fill(18, 22, 19, 32, '.');
    g.fill(18, 27, 19, 27, 'w');

    // decorative tiled floors
    g.fill(4, 3, 9, 9, ',');
    g.fill(4, 30, 9, 36, ',');
    g.fill(9, 17, 11, 22, ',');

    // --- B site cover
    g.set(5, 4, 'C'); g.set(5, 5, 'C'); g.set(6, 4, 'c');
    g.set(8, 8, 'c'); g.set(8, 9, 'c'); g.set(9, 9, 'C');
    g.fill(2, 2, 3, 5, '2'); g.set(4, 2, '1'); g.set(4, 3, '1');
    g.set(11, 9, '='); g.set(11, 10, '=');
    // --- A site cover
    g.set(5, 31, 'C'); g.set(6, 31, 'C'); g.set(5, 32, 'c');
    g.set(8, 35, 'c'); g.set(9, 35, 'c'); g.set(8, 36, 'C');
    g.fill(2, 34, 3, 37, '2'); g.set(4, 36, '1'); g.set(4, 37, '1');
    g.set(11, 30, '='); g.set(11, 31, '=');
    // --- plaza / mid
    g.set(10, 16, 'C'); g.set(11, 16, 'c'); g.set(9, 23, 'c');
    g.set(16, 19, 'c');
    g.set(24, 20, 'C'); g.set(24, 21, 'C');
    g.set(28, 18, 'c');
    // --- long A
    g.set(15, 36, 'C'); g.set(16, 36, 'c');
    g.set(27, 33, 'c');
    g.set(30, 37, 'C');
    // --- attacker spawn
    g.set(34, 15, 'c'); g.set(36, 23, 'C'); g.set(37, 23, 'c');
    g.set(33, 8, 'c'); g.set(34, 30, 'c');
    // --- tunnels
    g.set(17, 3, 'c'); g.set(25, 6, 'c'); g.set(29, 3, 'C');
    // --- DS
    g.set(2, 16, 'c'); g.set(2, 23, 'C');
  },
  zones: {
    A: [4, 30, 9, 36],
    B: [4, 3, 9, 9],
    att: [33, 15, 38, 24],
    def: [1, 16, 5, 23],
  },
  spawnYaw: { att: 0, def: Math.PI },
  props: [
    // oil drums (0.76 m wide, 1 m tall)
    { r: 11, c: 2, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 12, c: 37, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 13, c: 21, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 31, c: 21, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 35, c: 3, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 32, c: 36, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 19, c: 22, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 3, c: 11, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
  ],
  decor: {
    skyline: 'desert',
    flags: [{ r: 13, c: 17, h: 4, design: 'desert' }, { r: 13, c: 22, h: 4, design: 'desert' }],
    trim: 'sandstoneLight',
    palms: 16,
    grass: 'dry',
    awnings: [['#b8412c', '#eadfc6'], ['#2f6f8a', '#eadfc6'], ['#6a8a3a', '#efe6c8']],
    wires: 12,
    decals: ['crack', 'sand', 'stain'],
    litWindows: 0.04,
    tankColor: 0xe0d8c4,
    signs: [
      { r: 31, c: 15, dir: 's', text: '← B' },
      { r: 31, c: 23, dir: 's', text: 'A →' },
      { r: 7, c: 16, dir: 's', text: '← B' },
      { r: 7, c: 23, dir: 's', text: 'A →' },
      { r: 21, c: 32, dir: 'e', text: 'A →' },
      { r: 14, c: 7, dir: 'w', text: '← B' },
    ],
  },
  lights: [
    { r: 16, c: 4, color: 0xffc27a, intensity: 5, distance: 14 },
    { r: 26, c: 5, color: 0xffc27a, intensity: 5, distance: 14 },
    { r: 20, c: 12, color: 0xffc27a, intensity: 4, distance: 12 },
  ],
};
