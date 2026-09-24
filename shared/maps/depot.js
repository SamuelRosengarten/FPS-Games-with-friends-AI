// Depot - a small rail depot, played at night by default: a dark warehouse (site A), a container yard
// (site B), a loading dock and a guard hut. Made for flashlights.

export default {
  id: 'depot',
  name: 'Depot',
  desc: 'Small rail depot at night. A dark warehouse, a container yard and a guard hut — bring a flashlight.',
  modes: ['defuse', 'tdm', 'ffa', 'gungame'],
  night: true, // "Map default" time is night
  rows: 28,
  cols: 28,
  cellSize: 2,
  wallHeight: 5,
  buildingHeight: 4.6,
  roofHeight: 3.6,
  roofTop: 4.6,
  mats: {
    wall: 'concrete', wall2: 'concreteDark', building: 'brick', floor: 'asphalt', floor2: 'concrete',
    raised: 'concrete', crate: 'crate', crate2: 'crateDark', low: 'sandbag', roof: 'concreteDark', destructible: 'woodPanel',
  },
  theme: {
    // daytime look (the map is normally played at night: see nightTheme)
    motes: { color: 0xdfe6ee, alpha: 0.3, count: 350 },
    grade: { gain: [0.97, 1.0, 1.04], lift: [0.0, 0.008, 0.02], contrast: 1.1, saturation: 0.88, vignette: 0.32, grain: 0.025 },
    cloudCover: 0.7, cloudColor: 0xd5dbe2,
    skyTop: 0x4a5a70, skyHorizon: 0xaeb8c0, skyBottom: 0x66645e,
    fog: 0x9aa3ab, fogNear: 50, fogFar: 220,
    sun: { dir: [0.55, 0.6, -0.45], color: 0xffe6cc, intensity: 2.6 },
    hemi: { sky: 0xc0cde0, ground: 0x5a564e, intensity: 1.15 },
    exposure: 1.05,
    volumetric: { density: 0.007 },
    ambientSound: 'industrial',
  },
  carve(g) {
    g.fill(1, 1, 26, 26, '.');

    // warehouse (site A inside)
    g.fill(9, 8, 18, 21, '%');
    g.fill(10, 9, 17, 20, ',');
    g.roof(9, 8, 18, 21);
    g.set(18, 11, 'D'); g.set(18, 18, 'D');   // south doors
    g.set(9, 12, 'D'); g.set(9, 17, 'D');     // north doors
    g.set(14, 8, 'D'); g.set(12, 21, 'D');    // west / east doors
    g.set(18, 14, 'x'); g.set(18, 15, 'w');   // south window + breakable panel
    g.set(9, 14, 'x'); g.set(9, 15, 'x');
    g.set(11, 8, 'x'); g.set(16, 8, 'w');
    g.set(15, 21, 'x'); g.set(16, 21, 'w');
    // shelving, crates and cover inside
    g.fill(11, 10, 11, 12, 'C');
    g.fill(16, 16, 16, 18, 'C');
    g.set(13, 15, 'c'); g.set(14, 11, 'c'); g.set(15, 11, 'C');
    g.fill(13, 18, 13, 19, '=');
    g.set(11, 17, 'c');

    // guard hut in the south-east corner
    g.fill(20, 21, 24, 25, '%');
    g.fill(21, 22, 23, 24, ',');
    g.roof(20, 21, 24, 25);
    g.set(20, 23, 'D'); g.set(22, 21, 'D'); g.set(24, 23, 'x'); g.set(22, 25, 'x');
    g.set(21, 24, 'c');

    // loading dock on the east side (1 m platform with steps)
    g.fill(8, 24, 12, 26, '2');
    g.fill(8, 23, 12, 23, '1');

    // west yard (site B) cover
    g.set(13, 4, 'C'); g.set(13, 5, 'c'); g.set(17, 2, 'c');
    g.fill(19, 3, 19, 5, '=');

    // north yard
    g.fill(6, 3, 6, 5, '='); g.fill(6, 22, 6, 24, '=');
    g.set(7, 15, 'C'); g.set(7, 16, 'c');
    g.set(2, 4, 'c'); g.set(2, 23, 'C');

    // south yard
    g.fill(21, 12, 21, 13, '='); g.fill(21, 16, 21, 17, '=');
    g.set(20, 8, 'C'); g.set(20, 19, 'c');
    g.set(25, 4, 'c'); g.set(25, 5, 'C');
  },
  zones: {
    A: [11, 14, 17, 20],
    B: [10, 1, 17, 6],
    att: [23, 9, 25, 18],
    def: [2, 10, 4, 17],
  },
  spawnYaw: { att: 0, def: Math.PI },
  props: [
    // shipping containers in the west yard and along the east fence
    { r: 10, c: 3, rows: 3, cols: 1, h: 2.6, mat: 'containerBlue', inset: 0.05, kind: 'container' },
    { r: 15, c: 5, rows: 3, cols: 1, h: 2.6, mat: 'containerRed', inset: 0.05, kind: 'container' },
    { r: 15, c: 5, rows: 3, cols: 1, h: 2.6, y: 2.6, mat: 'containerGreen', inset: 0.05, kind: 'container' },
    { r: 19, c: 23, rows: 1, cols: 3, h: 2.6, mat: 'containerYellow', inset: 0.05, kind: 'container' },
    { r: 22, c: 1, rows: 1, cols: 3, h: 2.6, mat: 'containerGreen', inset: 0.05, kind: 'container' },
    // parked truck in the north yard
    { r: 6, c: 9, rows: 1, cols: 3, h: 2.7, mat: 'darkMetal', inset: 0.15, kind: 'truck' },
    { r: 6, c: 12, rows: 1, cols: 1, h: 2.1, mat: 'containerBlue', inset: 0.3, kind: 'truck' },
    // oil drums
    { r: 17, c: 13, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 10, c: 20, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 13, c: 26, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 18, c: 1, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 3, c: 20, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 24, c: 19, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
  ],
  decor: {
    wallProps: { ac: 0.03, ebox: 0.07, pipe: 0.06, vent: 0.04 },
    clutter: { rocks: 20, trash: 22, cans: 12, pallets: 8, tires: 6, cones: 4, jerry: 5 },
    pipeColor: 0x6a665e,
    skyline: 'industrial',
    trim: 'concrete',
    barbed: true,
    lampPosts: 6,
    wires: 4,
    puddles: 0.08,
    decals: ['crack', 'stain', 'leaves'],
    glass: 0x1c252d,
    litWindows: 0.3,
    signs: [
      { r: 18, c: 16, dir: 's', text: 'A' },
      { r: 9, c: 3, dir: 's', text: '← B' },
    ],
  },
  lights: [
    // warehouse and hut ceiling lights, and a few wall lamps outside
    { r: 12, c: 11, color: 0xffd8a0, intensity: 3.5, distance: 11 },
    { r: 15, c: 18, color: 0xffd8a0, intensity: 3.5, distance: 11 },
    { r: 22, c: 23, color: 0xffcf90, intensity: 2.5, distance: 8 },
    { r: 1, c: 7, y: 4.2, color: 0xffc27a, intensity: 4, distance: 12 },
    { r: 26, c: 20, y: 4.2, color: 0xffc27a, intensity: 4, distance: 12 },
    { r: 14, c: 26, y: 4.2, color: 0xb8d0ff, intensity: 3.5, distance: 12 },
    { r: 14, c: 1, y: 4.2, color: 0xffc27a, intensity: 3.5, distance: 12 },
  ],
};
