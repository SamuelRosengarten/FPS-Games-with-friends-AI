// Depot - a rail depot at night. Site A is a tall warehouse with storage racks and a mezzanine along its
// north wall (two staircases, windows over the yard); site B is the rail yard with a box car, a loading
// platform and stacked containers. Between them: the mid workshop, dumpsters and pallets. Defenders start
// in the north yard by the admin offices, attackers in the parking lot outside the fence.

export default {
  id: 'depot',
  name: 'Depot',
  desc: 'Rail depot at night. A tall warehouse with racks and a mezzanine, a rail yard with a box car, offices and a workshop — bring a flashlight.',
  modes: ['defuse', 'tdm', 'ffa', 'gungame'],
  night: true, // "Map default" time is night
  rows: 36,
  cols: 40,
  cellSize: 2,
  wallHeight: 5,
  buildingHeight: 4.6,
  roofHeight: 3.4,
  roofTop: 4.4,
  mats: {
    wall: 'concrete', wall2: 'concreteDark', building: 'brick', floor: 'asphalt', floor2: 'concrete',
    raised: 'concrete', crate: 'crate', crate2: 'crateDark', low: 'sandbag', roof: 'concreteDark', destructible: 'woodPanel',
  },
  upper: {
    floorY: 3.9,
    slab: 0.3,
    wallHeight: 3.4,
    roofHeight: 3.05,
    mats: { wall: 'brick', floor: 'concrete', slab: 'concrete', roof: 'concrete' },
    carve(u) {
      // the warehouse hall is two storeys tall: walls all round, a roof over the whole hall
      u.fill(6, 20, 6, 35, '#'); u.fill(23, 20, 23, 35, '#');
      u.fill(6, 20, 23, 20, '#'); u.fill(6, 35, 23, 35, '#');
      u.roof(6, 20, 23, 35);
      // mezzanine along the north wall with a railing and the two stair landings
      u.fill(7, 21, 10, 34, '.');
      u.fill(11, 21, 11, 34, '-');
      u.set(11, 22, '.'); u.set(11, 33, '.');
      // windows: north over the yard, west over mid, east over the alley
      u.set(6, 23, 'x'); u.set(6, 30, 'x'); u.set(8, 20, 'x'); u.set(9, 35, 'x');
      // mezzanine office: desks, lockers, a rack and some crates
      u.fill(8, 25, 8, 26, 't'); u.fill(8, 29, 8, 30, 't');
      u.fill(7, 21, 7, 22, 'l');
      u.fill(7, 32, 7, 34, 's');
      u.set(10, 27, 'C'); u.set(9, 34, 'c');
    },
  },
  stairs: [
    { r: 15, c: 22, dir: 'n', len: 4, mat: 'metal' },
    { r: 15, c: 33, dir: 'n', len: 4, mat: 'metal' },
  ],
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
    g.fill(1, 1, 34, 38, '.');

    // --- admin offices (north-west): open-plan office | break room with lockers
    g.fill(1, 1, 7, 10, '%');
    g.fill(2, 2, 6, 5, ','); g.fill(2, 7, 6, 9, ',');
    g.set(4, 6, 'D'); g.set(2, 6, 'w');
    g.set(7, 3, 'D'); g.set(7, 8, 'D'); g.set(3, 10, 'D');
    g.set(7, 5, 'x'); g.set(5, 10, 'x'); g.set(1, 3, 'x'); g.set(1, 8, 'x');
    g.roof(1, 1, 7, 10);
    g.fill(3, 2, 3, 3, 't'); g.fill(5, 2, 5, 3, 't'); g.set(6, 5, 's');
    g.fill(2, 7, 2, 9, 'k'); g.fill(6, 8, 6, 9, 'l'); g.set(4, 8, 't');

    // --- warehouse (site A): tall hall, racks under the mezzanine and along the south wall
    g.fill(6, 20, 23, 35, '%');
    g.fill(7, 21, 22, 34, ',');
    g.set(6, 26, 'D'); g.set(6, 27, 'D'); g.set(6, 33, 'D');          // north doors
    g.fill(23, 26, 23, 29, 'D'); g.set(23, 33, 'D');                  // loading dock doors
    g.set(9, 20, 'D'); g.set(16, 20, 'D'); g.set(13, 20, 'w'); g.set(19, 20, 'w'); // west side
    g.set(11, 20, 'x'); g.set(18, 20, 'x');
    g.set(12, 35, 'D'); g.set(20, 35, 'D'); g.set(15, 35, 'x'); g.set(17, 35, 'x'); // east side
    // under the mezzanine: racks and pallets
    g.fill(8, 21, 8, 24, 's'); g.fill(8, 29, 8, 32, 's');
    g.set(10, 24, 'p'); g.set(10, 31, 'p'); g.fill(7, 28, 7, 29, 'l');
    // hall floor: pallets and crates around the site, racks along the south wall
    g.set(13, 25, 'p'); g.set(14, 30, 'C'); g.set(18, 25, 'C'); g.set(18, 26, 'c'); g.set(17, 30, 'p');
    g.set(12, 28, 'c');
    g.fill(21, 21, 21, 24, 's'); g.fill(21, 31, 21, 34, 's');
    g.set(19, 22, 'p'); g.set(19, 33, 'p');
    g.set(14, 23, 'o'); g.set(14, 32, 'o'); g.set(19, 28, 'o');

    // --- loading dock apron south of the warehouse
    g.fill(24, 23, 25, 32, '1');

    // --- rail yard (site B): box car on track 1, loading platform, containers on track 2, rail office
    g.fill(11, 6, 20, 7, '2');
    g.fill(10, 6, 10, 7, '1'); g.fill(21, 6, 21, 7, '1');
    g.set(12, 7, 'c'); g.set(18, 6, 'C'); g.set(15, 7, 'p');
    g.fill(23, 1, 26, 5, '%');
    g.fill(24, 2, 25, 4, ',');
    g.set(23, 3, 'D'); g.set(25, 5, 'D'); g.set(24, 5, 'x'); g.set(26, 3, 'x');
    g.roof(23, 1, 26, 5);
    g.fill(24, 2, 25, 2, 'l'); g.set(24, 4, 'k');

    // --- mid: workshop with four doors, dumpsters, pallets
    g.fill(14, 13, 19, 17, '%');
    g.fill(15, 14, 18, 16, ',');
    g.set(14, 15, 'D'); g.set(19, 15, 'D'); g.set(16, 13, 'D'); g.set(17, 17, 'D');
    g.set(18, 13, 'x'); g.set(15, 17, 'x');
    g.roof(14, 13, 19, 17);
    g.set(15, 14, 'k'); g.set(18, 16, 's');
    g.set(11, 17, 'p'); g.set(12, 18, 'p'); g.set(21, 12, 'p'); g.set(9, 12, 'C'); g.set(10, 12, 'c');
    g.set(24, 14, 'c'); g.set(25, 14, 'C');

    // --- north yard: containers and cover in front of the warehouse
    g.set(4, 27, 'C'); g.set(5, 31, 'c');

    // --- east alley
    g.set(9, 37, 'c'); g.set(16, 37, 'C'); g.set(22, 36, 'p'); g.set(26, 37, 'c');

    // --- guard hut by the main gate
    g.fill(24, 18, 27, 22, '%');
    g.fill(25, 19, 26, 21, ',');
    g.set(25, 18, 'D'); g.set(24, 21, 'D'); g.set(26, 22, 'x'); g.set(27, 20, 'x'); g.set(24, 19, 'x');
    g.roof(24, 18, 27, 22);
    g.set(25, 21, 'k');

    // --- perimeter fence with three gates, parking lot outside
    g.fill(28, 1, 28, 38, '#');
    g.fill(28, 3, 28, 5, '.'); g.fill(28, 13, 28, 16, '.'); g.fill(28, 35, 28, 37, '.');
    g.set(30, 20, '='); g.set(30, 21, '='); g.set(31, 7, 'c'); g.set(31, 32, 'c');
  },
  zones: {
    A: [13, 24, 18, 31],
    B: [11, 3, 20, 7],
    att: [31, 12, 34, 27],
    def: [1, 13, 4, 24],
  },
  spawnYaw: { att: 0, def: Math.PI },
  props: [
    // rail yard: box car on track 1, containers on track 2
    { kind: 'boxcar', r: 15, c: 2, dx: 1, dir: 'z', mat: 'containerRed', track: 7 },
    { r: 13, c: 9, rows: 3, cols: 1, h: 2.6, mat: 'containerBlue', inset: 0.05, kind: 'container' },
    { r: 19, c: 9, rows: 3, cols: 1, h: 2.6, mat: 'containerGreen', inset: 0.05, kind: 'container' },
    { r: 19, c: 9, rows: 3, cols: 1, h: 2.6, y: 2.6, mat: 'containerYellow', inset: 0.05, kind: 'container' },
    // north yard containers and a van
    { r: 2, c: 29, rows: 1, cols: 3, h: 2.6, mat: 'containerGreen', inset: 0.05, kind: 'container' },
    { r: 2, c: 29, rows: 1, cols: 3, h: 2.6, y: 2.6, mat: 'containerRed', inset: 0.05, kind: 'container' },
    { kind: 'van', r: 3, c: 35, dir: 'x', flip: true },
    // mid and alley
    { kind: 'dumpster', r: 11, c: 14, dir: 'x' },
    { kind: 'dumpster', r: 22, c: 17, dir: 'z' },
    { kind: 'generator', r: 21, c: 15, dir: 'x' },
    { kind: 'car', r: 9, c: 16, dir: 'x', variant: 'wreck' },
    { kind: 'forklift', r: 23, c: 11, dir: 'z', flip: true },
    { kind: 'forklift', r: 16, c: 27, dir: 'x' },
    { kind: 'hvac', r: 12, c: 37, dir: 'z' },
    // parking lot
    { kind: 'car', r: 30, c: 8, dir: 'z' },
    { kind: 'car', r: 30, c: 10, dir: 'z', flip: true },
    { kind: 'car', r: 30, c: 29, dir: 'z' },
    { kind: 'car', r: 30, c: 33, dir: 'z', flip: true },
    { kind: 'van', r: 33, c: 5, dir: 'x' },
    // oil drums
    { r: 26, c: 30, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 9, c: 18, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 20, c: 36, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 10, c: 4, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 3, c: 12, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
  ],
  decor: {
    furniture: 'industrial',
    wallProps: { ac: 0.03, ebox: 0.07, pipe: 0.06, vent: 0.04 },
    clutter: { rocks: 26, trash: 30, cans: 16, pallets: 6, tires: 8, cones: 6, jerry: 6 },
    pipeColor: 0x6a665e,
    skyline: 'industrial',
    trim: 'concrete',
    barbed: true,
    lampPosts: 8,
    wires: 6,
    puddles: 0.08,
    decals: ['crack', 'stain', 'leaves'],
    glass: 0x1c252d,
    litWindows: 0.3,
    signs: [
      { r: 23, c: 25, dir: 's', text: 'A' },
      { r: 22, c: 8, dir: 's', text: 'B' },
      { r: 28, c: 12, dir: 's', text: '← B' },
      { r: 28, c: 17, dir: 's', text: 'A →' },
    ],
  },
  lights: [
    // warehouse hall, mezzanine, offices, workshop, hut, yard lamps
    { r: 15, c: 24, y: 6.4, color: 0xffe0b0, intensity: 5, distance: 16 },
    { r: 15, c: 31, y: 6.4, color: 0xffe0b0, intensity: 5, distance: 16 },
    { r: 20, c: 27, y: 6.4, color: 0xffe0b0, intensity: 4, distance: 14 },
    { r: 9, c: 27, level: 'upper', color: 0xfff0d8, intensity: 3.5, distance: 11 },
    { r: 9, c: 27, y: 3.3, color: 0xffd8a0, intensity: 3, distance: 10 },
    { r: 4, c: 4, color: 0xfff0d8, intensity: 3.5, distance: 10 },
    { r: 4, c: 8, color: 0xffd8a0, intensity: 3, distance: 9 },
    { r: 16, c: 15, color: 0xffcf90, intensity: 3, distance: 9 },
    { r: 25, c: 20, color: 0xffcf90, intensity: 2.5, distance: 8 },
    { r: 24, c: 3, color: 0xffcf90, intensity: 2.5, distance: 8 },
    { r: 1, c: 18, y: 4.2, color: 0xffc27a, intensity: 4, distance: 13 },
    { r: 27, c: 28, y: 4.2, color: 0xb8d0ff, intensity: 4, distance: 13 },
    { r: 12, c: 9, y: 4.2, color: 0xffc27a, intensity: 4, distance: 13 },
    { r: 27, c: 10, y: 4.2, color: 0xffc27a, intensity: 3.5, distance: 12 },
    { r: 14, c: 38, y: 4.2, color: 0xb8d0ff, intensity: 3.5, distance: 12 },
  ],
};
