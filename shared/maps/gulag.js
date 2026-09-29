// Gulag - a prison camp on a cold, grey morning. A long cell block (site A) and the mess hall (site B)
// face each other across the camp, with the tiled shower hall in the middle as the fight for mid. Two
// guard towers in opposite corners overlook the exercise yards where the teams start.

function guardTower(g, r0, c0) {
  g.fill(r0, c0, r0 + 4, c0 + 4, '%');
  g.fill(r0 + 1, c0 + 1, r0 + 3, c0 + 3, ',');
}

export default {
  id: 'gulag',
  name: 'Gulag',
  desc: 'Prison camp under a cold grey sky: a cell block, the tiled shower hall in the middle, the mess hall and two guard towers over the yards.',
  modes: ['defuse', 'tdm', 'ffa', 'gungame'],
  rows: 36,
  cols: 36,
  cellSize: 2,
  wallHeight: 6.5,
  buildingHeight: 4.2,
  roofHeight: 3.2,
  roofTop: 4.2,
  mats: {
    wall: 'concrete', wall2: 'concreteDark', building: 'plasterDark', floor: 'dirt', floor2: 'tiles',
    raised: 'concrete', crate: 'crateDark', crate2: 'crate', low: 'sandbag', roof: 'concreteDark', destructible: 'woodPanel', pillar: 'concrete',
  },
  upper: {
    floorY: 3.5,
    slab: 0.3,
    wallHeight: 3.2,
    roofHeight: 2.9,
    mats: { wall: 'concreteDark', floor: 'wood', slab: 'concreteDark', roof: 'concreteDark' },
    carve(u) {
      // guard tower platforms with a parapet on the sides that face the camp, reached by outside stairs
      u.fill(1, 1, 5, 5, '.');
      u.fill(5, 1, 5, 4, '='); u.fill(1, 5, 3, 5, '=');
      u.set(5, 6, '.');
      u.fill(30, 30, 34, 34, '.');
      u.fill(30, 31, 30, 34, '='); u.fill(32, 30, 34, 30, '=');
      u.set(30, 29, '.');
      u.set(2, 2, 'c'); u.set(33, 33, 'c');
    },
  },
  stairs: [
    { r: 9, c: 6, dir: 'n', len: 4, mat: 'metal' },
    { r: 26, c: 29, dir: 's', len: 4, mat: 'metal' },
  ],
  theme: {
    motes: { color: 0xe6ecf2, alpha: 0.25, count: 300 },
    grade: { gain: [0.95, 0.99, 1.05], lift: [0.005, 0.012, 0.03], contrast: 1.1, saturation: 0.78, vignette: 0.36, grain: 0.03 },
    cloudCover: 0.8, cloudColor: 0xc9ced4,
    sky: { turbidity: 8, rayleigh: 1.6, mie: 0.006, mieG: 0.8 },
    skyTop: 0x55657a, skyHorizon: 0xb4bcc4, skyBottom: 0x5a5c5e,
    fog: 0x9aa3ad, fogNear: 45, fogFar: 200,
    sun: { dir: [0.45, 0.42, -0.55], color: 0xe8ecf2, intensity: 2.3 },
    hemi: { sky: 0xb8c6d8, ground: 0x4e4c48, intensity: 1.25 },
    exposure: 1.08,
    volumetric: { density: 0.008 }, // cold haze for volumetric sunlight (Ultra / Epic)
    ambientSound: 'wind',
  },
  carve(g) {
    g.fill(1, 1, 34, 34, '.');
    // guard towers (NW and SE), a door into each base
    guardTower(g, 1, 1); g.set(5, 3, 'D'); g.set(3, 5, 'x');
    guardTower(g, 30, 30); g.set(30, 32, 'D'); g.set(32, 30, 'x');

    // ---- cell block (site A): five cells off a long corridor
    g.fill(2, 8, 9, 27, '%');
    g.fill(3, 9, 8, 26, ',');
    for (const c of [12, 16, 20, 24]) g.fill(3, c, 4, c, '%');
    g.fill(5, 9, 5, 26, '%');
    for (const c of [10, 14, 18, 22, 25]) g.set(5, c, 'D');
    // bunks and lockers in the cells
    g.fill(3, 9, 3, 10, 'k'); g.fill(3, 13, 3, 14, 'k'); g.fill(3, 17, 3, 18, 'k'); g.fill(3, 21, 3, 22, 'k');
    g.set(3, 26, 'l'); g.set(4, 15, 'c'); g.set(4, 23, 'c');
    // corridor: doors at both ends, onto the yard in the middle, breakable panels, windows
    g.set(7, 8, 'D'); g.set(7, 27, 'D');
    g.set(9, 12, 'D'); g.set(9, 23, 'D');
    g.set(9, 15, 'w'); g.set(9, 20, 'w');
    g.set(9, 17, 'x'); g.set(9, 18, 'x'); g.set(2, 11, 'x'); g.set(2, 19, 'x');
    g.fill(8, 24, 8, 26, 'l'); g.fill(8, 9, 8, 10, 'k');
    g.set(7, 16, 'c'); g.set(6, 20, 'C');
    g.roof(2, 8, 9, 27);

    // ---- shower hall (mid): tiled, pillars and half-height stall walls
    g.fill(13, 12, 22, 23, '%');
    g.fill(14, 13, 21, 22, ',');
    g.fill(17, 12, 18, 12, 'D'); g.fill(17, 23, 18, 23, 'D');
    g.set(13, 17, 'D'); g.set(22, 18, 'D');
    g.set(13, 14, 'x'); g.set(13, 21, 'x'); g.set(22, 14, 'x'); g.set(22, 21, 'x');
    g.set(13, 19, 'w'); g.set(22, 16, 'w');
    for (const [r, c] of [[16, 16], [16, 19], [19, 16], [19, 19]]) g.set(r, c, 'o');
    g.fill(14, 15, 15, 15, '='); g.fill(14, 20, 15, 20, '=');
    g.fill(20, 15, 21, 15, '='); g.fill(20, 20, 21, 20, '=');
    g.roof(13, 12, 22, 23);

    // ---- mess hall (site B): long tables, the kitchen at the back
    g.fill(26, 8, 33, 27, '%');
    g.fill(27, 9, 32, 26, ',');
    g.fill(28, 11, 28, 14, 't'); g.fill(28, 18, 28, 21, 't');
    g.fill(30, 11, 30, 14, 't'); g.fill(30, 18, 30, 21, 't');
    g.fill(32, 22, 32, 26, 'k');
    g.fill(27, 26, 29, 26, 's');
    g.set(29, 16, 'o'); g.set(32, 9, 'C'); g.set(31, 10, 'c');
    g.set(29, 8, 'D'); g.set(29, 27, 'D');
    g.set(26, 13, 'D'); g.set(26, 22, 'D');
    g.set(26, 17, 'x'); g.set(26, 18, 'x'); g.set(33, 13, 'x'); g.set(33, 20, 'x');
    g.set(26, 10, 'w'); g.set(26, 25, 'w');
    g.roof(26, 8, 33, 27);

    // ---- yards
    // west (attackers): woodpile, sandbags, crates
    g.set(10, 5, 'C'); g.set(11, 5, 'c'); g.fill(15, 6, 16, 6, '='); g.fill(20, 6, 21, 6, '=');
    g.set(24, 5, 'C'); g.set(25, 6, 'c'); g.set(18, 9, 'p');
    g.fill(29, 2, 30, 3, '2'); g.set(31, 2, '1'); g.set(31, 3, '1');
    // east (defenders)
    g.set(25, 30, 'C'); g.set(24, 30, 'c'); g.fill(19, 29, 20, 29, '='); g.fill(14, 29, 15, 29, '=');
    g.set(11, 30, 'C'); g.set(10, 29, 'c'); g.set(17, 26, 'p');
    g.fill(7, 32, 8, 33, '2'); g.set(9, 32, '1'); g.set(9, 33, '1');
    // between the buildings
    g.set(11, 15, 'c'); g.set(11, 20, 'C'); g.set(24, 15, 'C'); g.set(24, 20, 'c');
    g.fill(11, 10, 11, 11, '='); g.fill(24, 24, 24, 25, '=');
  },
  zones: {
    A: [6, 9, 8, 26],
    B: [27, 9, 32, 24],
    att: [14, 1, 21, 3],
    def: [14, 32, 21, 34],
  },
  spawnYaw: { att: -Math.PI / 2, def: Math.PI / 2 },
  props: [
    // supply trucks and containers in the free corners
    { r: 1, c: 29, rows: 1, cols: 3, h: 2.6, mat: 'containerGreen', inset: 0.05, kind: 'container' },
    { r: 3, c: 33, rows: 3, cols: 1, h: 2.6, mat: 'containerRed', inset: 0.05, kind: 'container' },
    { r: 34, c: 3, rows: 1, cols: 3, h: 2.6, mat: 'containerBlue', inset: 0.05, kind: 'container' },
    { r: 22, c: 32, rows: 1, cols: 3, h: 2.7, mat: 'darkMetal', inset: 0.15, kind: 'truck' },
    { kind: 'van', r: 12, c: 3, dir: 'z', color: 0x4a5a3e },
    { kind: 'generator', r: 10, c: 25, dir: 'x' },
    { kind: 'dumpster', r: 25, c: 11, dir: 'x' },
    { kind: 'hvac', r: 5, c: 12, dir: 'x', y: 4.2 },
    { kind: 'hvac', r: 30, c: 22, dir: 'z', y: 4.2 },
    // oil drums
    { r: 12, c: 8, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 23, c: 27, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 10, c: 21, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 25, c: 14, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
  ],
  decor: {
    furniture: 'industrial',
    wallProps: { ebox: 0.05, pipe: 0.06, vent: 0.04 },
    clutter: { rocks: 40, trash: 14, cans: 8, tires: 4, pallets: 4, jerry: 3 },
    pipeColor: 0x5e625e,
    skyline: 'hills',
    trim: 'concrete',
    barbed: true,
    lampPosts: 6,
    wires: 5,
    puddles: 0.06,
    grass: 'dry',
    decals: ['crack', 'stain', 'leaves'],
    glass: 0x1c232a,
    litWindows: 0.2,
    signs: [
      { r: 9, c: 13, dir: 's', text: 'A', color: '#e8d23a' },
      { r: 26, c: 14, dir: 'n', text: 'B', color: '#e8d23a' },
    ],
  },
  lights: [
    { r: 7, c: 12, color: 0xfff0d6, intensity: 6, distance: 14 },
    { r: 7, c: 22, color: 0xfff0d6, intensity: 6, distance: 14 },
    { r: 17, c: 17, color: 0xe8f0ff, intensity: 7, distance: 16 },
    { r: 29, c: 13, color: 0xffe0b0, intensity: 6, distance: 14 },
    { r: 29, c: 21, color: 0xffe0b0, intensity: 6, distance: 14 },
    { r: 3, c: 3, color: 0xffd9a0, intensity: 4, distance: 8 },
    { r: 32, c: 32, color: 0xffd9a0, intensity: 4, distance: 8 },
  ],
};
