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
    sky: { turbidity: 2.2, rayleigh: 1.1, mie: 0.0035, mieG: 0.86 },
    skyTop: 0x3b78c9, skyHorizon: 0xd8e4ec, skyBottom: 0xc9b28c,
    fog: 0xd6c8ad, fogNear: 55, fogFar: 190,
    sun: { dir: [0.42, 0.78, 0.46], color: 0xfff1da, intensity: 2.8 },
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
  props: [],
  lights: [
    { r: 16, c: 4, color: 0xffc27a, intensity: 5, distance: 14 },
    { r: 26, c: 5, color: 0xffc27a, intensity: 5, distance: 14 },
    { r: 20, c: 12, color: 0xffc27a, intensity: 4, distance: 12 },
  ],
};
