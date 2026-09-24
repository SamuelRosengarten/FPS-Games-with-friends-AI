// Compound - a fortified building in an industrial yard. Lots of breakable walls, windows and doors.
// Defenders start inside, attackers breach from the yard.

export default {
  id: 'compound',
  name: 'Compound',
  desc: 'Two-storey fortified HQ in a container yard: server room, armoury, a floor hatch, outside stairs. Breach walls and fight room to room.',
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
    motes: { color: 0xdfe6ee, alpha: 0.3, count: 400 },
    grade: { gain: [0.96, 1.0, 1.05], lift: [0.0, 0.01, 0.025], contrast: 1.12, saturation: 0.9, vignette: 0.32, grain: 0.025 },
    cloudCover: 0.62, cloudColor: 0xdfe4ea,
    sky: { turbidity: 7, rayleigh: 2.2, mie: 0.006, mieG: 0.8 },
    skyTop: 0x4b5f7a, skyHorizon: 0xb9c2c9, skyBottom: 0x6d6a62,
    fog: 0xa3abb3, fogNear: 60, fogFar: 240,
    sun: { dir: [-0.5, 0.62, 0.35], color: 0xffe2c4, intensity: 2.8 },
    hemi: { sky: 0xc4d2e6, ground: 0x5f5a50, intensity: 1.15 },
    exposure: 1.05,
    volumetric: { density: 0.007 }, // dust in the air for volumetric sunlight (Ultra / Epic)
    ambientSound: 'industrial',
  },
  upper: {
    floorY: 3.6,
    slab: 0.3,
    wallHeight: 3.4,
    roofHeight: 3.05,
    mats: { wall: 'plaster', floor: 'tiles', slab: 'concrete', roof: 'ceiling' },
    carve(u) {
      u.fill(3, 8, 19, 31, '#');
      u.fill(4, 9, 18, 30, '.');
      u.roof(3, 8, 19, 31);
      // north rooms: offices | command centre with a floor hatch over the security room | quarters
      u.fill(4, 14, 11, 14, '#'); u.set(8, 14, 'D'); u.set(5, 14, 'w');
      u.fill(4, 25, 11, 25, '#'); u.set(7, 25, 'D'); u.set(10, 25, 'w');
      u.fill(8, 19, 9, 20, ' ');
      u.fill(7, 19, 7, 20, '-'); u.fill(10, 19, 10, 20, '-'); u.fill(8, 18, 9, 18, '-'); u.fill(8, 21, 9, 21, '-');
      // corridor with the two stair wells, railings along them
      u.fill(12, 9, 12, 30, '#');
      u.set(12, 9, 'D'); u.set(12, 19, 'D'); u.set(12, 30, 'D'); u.set(12, 16, 'w'); u.set(12, 23, 'w');
      u.fill(13, 10, 13, 13, ' '); u.fill(13, 26, 13, 29, ' ');
      u.fill(14, 10, 14, 13, '-'); u.fill(14, 26, 14, 29, '-');
      // south rooms: lounge | radio room
      u.fill(15, 9, 15, 30, '#');
      u.set(15, 12, 'D'); u.set(15, 20, 'D'); u.set(15, 27, 'D'); u.set(15, 17, 'w');
      u.fill(16, 19, 18, 19, '#'); u.set(17, 19, 'w');
      // windows all round, doors to the two outside staircases
      for (const c of [11, 17, 22, 28]) { u.set(3, c, 'x'); u.set(19, c, 'x'); }
      for (const r of [5, 10, 17]) { u.set(r, 8, 'x'); u.set(r, 31, 'x'); }
      u.set(7, 8, 'D'); u.set(14, 31, 'D');
      u.set(7, 6, '.'); u.set(7, 7, '-');
      u.set(14, 33, '.'); u.set(14, 32, '-');
      // furniture
      u.fill(5, 10, 5, 11, 't'); u.fill(9, 10, 9, 11, 't'); u.fill(4, 13, 6, 13, 's'); u.set(11, 12, 'k');
      u.fill(4, 16, 4, 18, 'k'); u.fill(4, 21, 4, 23, 'k'); u.fill(11, 16, 11, 17, 't'); u.fill(11, 22, 11, 23, 'l'); u.set(6, 23, 'C');
      u.fill(4, 27, 4, 30, 'l'); u.fill(7, 28, 7, 29, 't'); u.fill(10, 28, 10, 29, 't'); u.set(9, 26, 'c');
      u.fill(17, 10, 17, 11, 't'); u.fill(18, 15, 18, 17, 's'); u.set(16, 14, 'c');
      u.fill(16, 21, 16, 23, 'k'); u.fill(18, 26, 18, 29, 's'); u.fill(17, 24, 17, 25, 't'); u.set(16, 29, 'C');
    },
  },
  stairs: [
    { r: 13, c: 10, dir: 'e', len: 4, mat: 'concrete' },
    { r: 13, c: 29, dir: 'w', len: 4, mat: 'concrete' },
    { r: 18, c: 33, dir: 'n', len: 4, mat: 'metal' },
    { r: 11, c: 6, dir: 'n', len: 4, mat: 'metal' },
  ],
  carve(g) {
    g.fill(1, 1, 36, 38, '.');
    // building shell (two storeys: the upper floor is its roof)
    g.fill(3, 8, 19, 31, '%');
    g.fill(4, 9, 18, 30, ',');
    // north rooms: server room (B) | security office (defender spawn) | armoury (A)
    g.fill(4, 17, 11, 17, '%'); g.set(7, 17, 'D'); g.set(9, 17, 'w');
    g.fill(4, 22, 11, 22, '%'); g.set(8, 22, 'D'); g.set(5, 22, 'w');
    // corridor between the north and south rooms
    g.fill(12, 9, 12, 30, '%');
    g.set(12, 15, 'D'); g.fill(12, 19, 12, 20, 'D'); g.set(12, 24, 'D'); g.set(12, 14, 'w'); g.set(12, 25, 'w');
    // south rooms: workshop | canteen | storage
    g.fill(15, 9, 15, 30, '%');
    g.set(15, 11, 'D'); g.set(15, 19, 'D'); g.set(15, 27, 'D'); g.set(15, 21, 'w');
    g.fill(16, 15, 18, 15, '%'); g.set(17, 15, 'w');
    g.fill(16, 23, 18, 23, '%'); g.set(17, 23, 'D');
    // exterior openings
    g.set(8, 8, 'D'); g.set(14, 8, 'D'); g.set(5, 8, 'x'); g.set(10, 8, 'x'); g.set(17, 8, 'x');
    g.set(8, 31, 'D'); g.set(14, 31, 'D'); g.set(5, 31, 'x'); g.set(10, 31, 'x'); g.set(17, 31, 'x');
    g.set(3, 10, 'x'); g.set(3, 15, 'x'); g.set(3, 24, 'x'); g.set(3, 29, 'x');
    g.fill(3, 12, 3, 13, 'w'); g.fill(3, 26, 3, 27, 'w'); g.set(3, 20, 'D');
    g.fill(19, 19, 19, 20, 'D');
    g.fill(19, 12, 19, 13, 'w'); g.fill(19, 26, 19, 27, 'w');
    g.set(19, 17, 'x'); g.set(19, 22, 'x');
    // server room: rack rows, a desk, crates
    g.fill(5, 11, 9, 11, 's'); g.fill(5, 14, 9, 14, 's');
    g.set(10, 15, 't'); g.set(4, 16, 'k'); g.set(11, 9, 'c'); g.set(4, 9, 'C');
    // security office: lockers, briefing table
    g.fill(4, 18, 4, 19, 'l'); g.fill(7, 19, 7, 20, 't'); g.set(11, 21, 'k');
    // armoury: counters, lockers, weapon racks, crates, a pillar
    g.fill(4, 23, 4, 25, 'k'); g.fill(4, 28, 4, 30, 'l'); g.fill(11, 23, 11, 24, 's');
    g.set(9, 24, 'C'); g.set(9, 25, 'c'); g.set(6, 29, 'o'); g.set(10, 30, 'c');
    // corridor cover
    g.set(14, 16, 'c'); g.set(14, 23, 'c');
    // workshop: benches, racks, pallets
    g.fill(18, 9, 18, 10, 'k'); g.set(16, 14, 's'); g.set(18, 13, 'p'); g.set(16, 9, 'c');
    // canteen: tables and the kitchen counter
    g.fill(17, 17, 17, 18, 't'); g.fill(17, 20, 17, 21, 't'); g.fill(16, 21, 16, 22, 'k');
    // storage: shelves and pallets
    g.fill(16, 24, 16, 26, 's'); g.fill(16, 28, 16, 30, 's'); g.set(18, 25, 'p'); g.set(18, 29, 'p');

    // yard cover
    g.set(22, 20, 'C'); g.set(24, 18, 'c'); g.set(27, 9, 'C'); g.set(28, 30, 'c');
    g.set(21, 35, 'C'); g.set(13, 4, 'c'); g.set(5, 35, 'C'); g.set(1, 20, 'c'); g.set(1, 21, 'c');
    g.set(9, 3, 'c'); g.set(9, 4, 'C'); g.set(30, 3, 'c');
    g.fill(30, 17, 30, 18, '='); g.fill(30, 21, 30, 22, '=');
    g.fill(24, 2, 24, 3, '='); g.fill(24, 36, 24, 37, '=');
    // guard post by the gate and a pallet stack area
    g.fill(31, 34, 34, 37, '%'); g.fill(32, 35, 33, 36, ',');
    g.set(31, 35, 'D'); g.set(33, 34, 'D'); g.set(32, 37, 'x'); g.set(34, 36, 'x');
    g.roof(31, 34, 34, 37);
    g.set(32, 36, 'k');
    g.set(14, 35, 'p'); g.set(15, 36, 'p'); g.set(16, 35, 'p');
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
    // oil drums
    { r: 20, c: 9, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 20, c: 30, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 25, c: 17, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 2, c: 7, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 11, c: 36, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 31, c: 8, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    // vehicles and machinery
    { kind: 'forklift', r: 17, c: 36, dir: 'z' },
    { kind: 'car', r: 22, c: 29, dir: 'x', color: 0x1d1f22 },
    { kind: 'car', r: 36, c: 8, dir: 'x', color: 0x9ea3a8 },
    { kind: 'van', r: 22, c: 9, dir: 'x', color: 0xdedcd4 },
    { kind: 'generator', r: 1, c: 12, dir: 'x' },
    { kind: 'dumpster', r: 20, c: 16, dir: 'x' },
    { kind: 'dumpster', r: 20, c: 23, dir: 'x' },
    { kind: 'hvac', r: 6, c: 12, dir: 'x', y: 7.0 },
    { kind: 'hvac', r: 15, c: 27, dir: 'z', y: 7.0 },
    // truck
    { r: 26, c: 5, rows: 1, cols: 3, h: 2.7, mat: 'darkMetal', inset: 0.15, kind: 'truck' },
    { r: 26, c: 8, rows: 1, cols: 1, h: 2.1, mat: 'containerRed', inset: 0.3, kind: 'truck' },
  ],
  decor: {
    furniture: 'industrial',
    wallProps: { ac: 0.03, ebox: 0.06, pipe: 0.05, vent: 0.04 },
    clutter: { rocks: 30, trash: 24, cans: 12, pallets: 7, tires: 6, cones: 6, jerry: 5 },
    pipeColor: 0x6e6a62,
    skyline: 'industrial',
    flags: [{ r: 19, c: 14, h: 5, design: 'company' }, { r: 19, c: 25, h: 5, design: 'company' }],
    trim: 'concrete',
    barbed: true,
    lampPosts: 8,
    wires: 6,
    puddles: 0.07,
    decals: ['crack', 'stain', 'leaves'],
    glass: 0x1e2a33,
    litWindows: 0.18,
    signs: [
      { r: 19, c: 10, dir: 's', text: '← B' },
      { r: 19, c: 29, dir: 's', text: 'A →' },
      { r: 12, c: 17, dir: 's', text: '← B', color: '#e8d23a' },
      { r: 12, c: 22, dir: 's', text: 'A →', color: '#e8d23a' },
    ],
  },
  lights: [
    { r: 7, c: 19, level: 'upper', color: 0xfff0d6, intensity: 5, distance: 14 },
    { r: 13, c: 20, level: 'upper', color: 0xfff0d6, intensity: 4, distance: 14 },
    { r: 7, c: 12, color: 0xfff0d6, intensity: 7, distance: 16 },
    { r: 7, c: 26, color: 0xfff0d6, intensity: 7, distance: 16 },
    { r: 7, c: 19, color: 0xffe0b0, intensity: 5, distance: 12 },
    { r: 15, c: 14, color: 0xfff0d6, intensity: 6, distance: 16 },
    { r: 15, c: 25, color: 0xfff0d6, intensity: 6, distance: 16 },
  ],
};
