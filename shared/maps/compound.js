// Compound - a fortified building in an industrial yard. Lots of breakable walls, windows and doors.
// Defenders start inside, attackers breach from the yard.

export default {
  id: 'compound',
  name: 'Compound',
  desc: 'Fortified building in a container yard. Breach walls, peek windows and fight room to room.',
  modes: ['defuse', 'tdm', 'ffa', 'gungame'],
  rows: 38,
  cols: 40,
  cellSize: 2,
  wallHeight: 5,
  buildingHeight: 4.4,
  roofHeight: 3.3,
  roofTop: 4.4,
  mats: {
    wall: 'concrete', wall2: 'concreteDark', building: 'brick', floor: 'asphalt', floor2: 'tiles',
    raised: 'concrete', crate: 'crate', crate2: 'crateDark', low: 'sandbag', roof: 'concreteDark', destructible: 'woodPanel',
  },
  theme: {
    cloudCover: 0.62, cloudColor: 0xdfe4ea,
    sky: { turbidity: 7, rayleigh: 2.2, mie: 0.006, mieG: 0.8 },
    skyTop: 0x4b5f7a, skyHorizon: 0xb9c2c9, skyBottom: 0x6d6a62,
    fog: 0xa3abb3, fogNear: 60, fogFar: 240,
    sun: { dir: [-0.5, 0.62, 0.35], color: 0xffe2c4, intensity: 2.8 },
    hemi: { sky: 0xc4d2e6, ground: 0x5f5a50, intensity: 1.15 },
    exposure: 1.05,
    ambientSound: 'industrial',
  },
  carve(g) {
    g.fill(1, 1, 36, 38, '.');
    // building shell
    g.fill(3, 8, 19, 31, '%');
    g.roof(3, 8, 19, 31);
    // rooms
    g.fill(4, 9, 11, 16, ',');   // west room (B)
    g.fill(4, 23, 11, 30, ',');  // east room (A)
    g.fill(4, 18, 10, 21, ',');  // center room
    g.fill(13, 9, 18, 30, ',');  // south hall
    // interior doors
    g.fill(7, 17, 8, 17, 'D');
    g.fill(7, 22, 8, 22, 'D');
    g.fill(11, 19, 12, 20, 'D');
    g.set(12, 11, 'D');
    g.set(12, 14, 'w'); g.set(12, 15, 'w');
    g.set(12, 28, 'D');
    g.set(12, 24, 'w'); g.set(12, 25, 'w');
    // exterior openings
    g.fill(19, 19, 19, 20, 'D');
    g.fill(7, 8, 8, 8, 'D');
    g.set(5, 8, 'x'); g.set(10, 8, 'x');
    g.fill(7, 31, 8, 31, 'D');
    g.set(5, 31, 'x'); g.set(10, 31, 'x');
    g.set(3, 10, 'x'); g.set(3, 15, 'x');
    g.set(3, 24, 'x'); g.set(3, 29, 'x');
    g.fill(3, 12, 3, 13, 'w');
    g.fill(3, 26, 3, 27, 'w');
    g.set(16, 8, 'D');
    g.set(15, 31, 'D');
    g.fill(19, 12, 19, 13, 'w');
    g.fill(19, 26, 19, 27, 'w');
    g.set(19, 16, 'x'); g.set(19, 23, 'x');

    // interior cover
    g.set(6, 11, 'c'); g.set(9, 14, 'C'); g.set(9, 15, 'c');
    g.set(6, 27, 'C'); g.set(6, 28, 'c'); g.set(9, 24, 'c');
    g.set(15, 14, 'c'); g.set(16, 25, 'c'); g.set(15, 20, 'c');
    g.set(4, 18, 'c'); g.set(4, 21, 'c');

    // yard cover
    g.set(22, 20, 'C'); g.set(24, 18, 'c'); g.set(27, 9, 'C'); g.set(28, 30, 'c');
    g.set(21, 35, 'C'); g.set(13, 4, 'c'); g.set(5, 35, 'C'); g.set(1, 20, 'c'); g.set(1, 21, 'c');
    g.set(9, 3, 'c'); g.set(9, 4, 'C'); g.set(30, 3, 'c');
    g.fill(30, 17, 30, 18, '='); g.fill(30, 21, 30, 22, '=');
    g.fill(24, 2, 24, 3, '='); g.fill(24, 36, 24, 37, '=');
    // loading dock platform on the east side
    g.fill(13, 34, 17, 37, '2');
    g.fill(13, 33, 17, 33, '1');
    // raised walkway west
    g.fill(28, 1, 29, 5, '2');
    g.set(30, 1, '1'); g.set(30, 2, '1');
  },
  zones: {
    A: [4, 23, 11, 30],
    B: [4, 9, 11, 16],
    att: [32, 12, 36, 27],
    def: [4, 18, 10, 21],
  },
  spawnYaw: { att: 0, def: Math.PI },
  props: [
    // shipping containers (1 cell wide x 3 long, 2.6 m tall)
    { r: 23, c: 12, rows: 3, cols: 1, h: 2.6, mat: 'containerRed', inset: 0.05, kind: 'container' },
    { r: 26, c: 24, rows: 1, cols: 3, h: 2.6, mat: 'containerBlue', inset: 0.05, kind: 'container' },
    { r: 28, c: 33, rows: 3, cols: 1, h: 2.6, mat: 'containerGreen', inset: 0.05, kind: 'container' },
    { r: 21, c: 4, rows: 1, cols: 3, h: 2.6, mat: 'containerYellow', inset: 0.05, kind: 'container' },
    { r: 21, c: 4, rows: 1, cols: 3, h: 2.6, y: 2.6, mat: 'containerBlue', inset: 0.05, kind: 'container' },
    { r: 1, c: 26, rows: 1, cols: 3, h: 2.6, mat: 'containerGreen', inset: 0.05, kind: 'container' },
    { r: 33, c: 32, rows: 1, cols: 3, h: 2.6, mat: 'containerRed', inset: 0.05, kind: 'container' },
    { r: 33, c: 4, rows: 3, cols: 1, h: 2.6, mat: 'containerYellow', inset: 0.05, kind: 'container' },
    // truck
    { r: 26, c: 5, rows: 1, cols: 3, h: 2.7, mat: 'darkMetal', inset: 0.15, kind: 'truck' },
    { r: 26, c: 8, rows: 1, cols: 1, h: 2.1, mat: 'containerRed', inset: 0.3, kind: 'truck' },
  ],
  lights: [
    { r: 7, c: 12, color: 0xfff0d6, intensity: 7, distance: 16 },
    { r: 7, c: 26, color: 0xfff0d6, intensity: 7, distance: 16 },
    { r: 7, c: 19, color: 0xffe0b0, intensity: 5, distance: 12 },
    { r: 15, c: 14, color: 0xfff0d6, intensity: 6, distance: 16 },
    { r: 15, c: 25, color: 0xfff0d6, intensity: 6, distance: 16 },
  ],
};
