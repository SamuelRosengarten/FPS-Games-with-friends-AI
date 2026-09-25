// Embassy - a two-storey embassy in a walled compound. Site A is the conference room upstairs,
// site B the garage on the ground floor. The lobby has an open atrium overlooked by an upstairs
// gallery, an inside staircase, an outside staircase up to a side door of A and a balcony over the
// main entrance.

export default {
  id: 'embassy',
  name: 'Embassy',
  desc: 'Two floors: fight up the stairs to the conference room or breach the garage. Atrium, balcony and an outside staircase.',
  modes: ['defuse', 'tdm', 'ffa', 'gungame'],
  rows: 36,
  cols: 40,
  cellSize: 2,
  wallHeight: 5,
  buildingHeight: 3.6,
  roofHeight: 3.3,
  roofTop: 3.6,
  mats: {
    wall: 'brick', wall2: 'concreteDark', building: 'sandstone', floor: 'stoneTiles', floor2: 'tiles',
    raised: 'concrete', crate: 'crate', crate2: 'crateDark', low: 'concrete', roof: 'roof', lintel: 'plaster', destructible: 'woodPanel', pillar: 'plaster',
  },
  upper: {
    floorY: 3.6,
    slab: 0.3,
    wallHeight: 3.4,
    roofHeight: 3.05,
    mats: { wall: 'plaster', floor: 'wood', slab: 'ceiling', roof: 'ceiling' },
    carve(u) {
      // shell and floor
      u.fill(7, 9, 24, 30, '#');
      u.fill(8, 10, 23, 29, '.');
      u.roof(7, 9, 24, 30);
      // library (above the garage) | conference room = site A
      u.fill(8, 18, 15, 18, '#');
      u.set(11, 18, 'w'); u.set(12, 18, 'w');
      u.fill(16, 10, 16, 29, '#');
      u.set(16, 14, 'D');
      u.set(16, 21, 'w'); u.set(16, 22, 'w');
      u.set(16, 25, 'D');
      // library: rows of bookshelves and reading tables | conference room: the long table, cabinets
      u.fill(9, 11, 9, 13, 's'); u.fill(9, 15, 9, 16, 's'); u.fill(14, 11, 14, 13, 's'); u.fill(14, 15, 14, 16, 's');
      u.fill(11, 12, 11, 13, 't'); u.fill(12, 15, 12, 16, 't'); u.fill(8, 10, 8, 11, 'k');
      u.fill(11, 22, 11, 25, 't'); u.fill(12, 22, 12, 25, 't');
      u.fill(8, 27, 8, 28, 'l'); u.fill(15, 19, 15, 20, 'k'); u.set(14, 28, 'C'); u.set(9, 20, 'c'); u.set(14, 24, 'o');
      // atrium over the lobby with a parapet ring
      u.fill(17, 15, 22, 23, '=');
      u.fill(18, 16, 21, 22, ' ');
      // stair well (inside staircase runs north along the east wall)
      u.fill(19, 29, 22, 29, ' ');
      u.fill(19, 28, 22, 28, '=');
      // gallery offices around the atrium
      u.fill(18, 11, 18, 12, 't'); u.fill(21, 11, 21, 12, 't'); u.fill(23, 11, 23, 13, 's');
      u.fill(17, 25, 17, 26, 'k'); u.set(20, 25, 't'); u.fill(23, 24, 23, 26, 's'); u.set(23, 21, 'c');
      // windows and doors in the outer walls
      u.set(7, 12, 'x'); u.set(7, 15, 'x'); u.set(7, 22, 'x'); u.set(7, 26, 'x');
      u.set(11, 9, 'x'); u.set(19, 9, 'x');
      u.set(20, 30, 'x');
      u.set(24, 12, 'x'); u.set(24, 15, 'x'); u.set(24, 24, 'x'); u.set(24, 27, 'x');
      // side door from site A onto the outside landing
      u.set(11, 30, 'D'); u.set(12, 30, 'D');
      u.fill(10, 31, 13, 33, '=');
      u.fill(11, 31, 13, 32, '.');
      // balcony over the main entrance
      u.set(24, 19, 'D'); u.set(24, 20, 'D');
      u.fill(25, 17, 27, 22, '=');
      u.fill(25, 18, 26, 21, '.');
    },
  },
  stairs: [
    { r: 22, c: 29, dir: 'n', len: 4, mat: 'wood' },
    { r: 17, c: 32, dir: 'n', len: 4, mat: 'concrete' },
  ],
  theme: {
    motes: { color: 0xffe8c8, alpha: 0.45, count: 500 },
    grade: { gain: [1.03, 1.0, 0.96], lift: [0.01, 0.008, 0.012], contrast: 1.08, saturation: 1.05, vignette: 0.3, grain: 0.02 },
    cloudCover: 0.35, cloudColor: 0xfff1de,
    sky: { turbidity: 5, rayleigh: 2.4, mie: 0.005, mieG: 0.82 },
    skyTop: 0x3a67a6, skyHorizon: 0xeed3ae, skyBottom: 0x6b6254,
    fog: 0xd6c9b4, fogNear: 70, fogFar: 260,
    sun: { dir: [-0.45, 0.52, 0.72], color: 0xffe1bb, intensity: 3.0 },
    hemi: { sky: 0xbfd2ea, ground: 0x6a604f, intensity: 1.1 },
    exposure: 1.05,
    volumetric: { density: 0.006 }, // dust in the air for volumetric sunlight (Ultra / Epic)
    ambientSound: 'wind',
  },
  carve(g) {
    g.fill(1, 1, 34, 38, '.');
    // building shell (ground floor)
    g.fill(7, 9, 24, 30, '%');
    g.fill(8, 10, 23, 29, ',');
    // garage = site B | centre hall | offices
    g.fill(8, 18, 15, 18, '%');
    g.fill(8, 23, 15, 23, '%');
    g.fill(16, 10, 16, 29, '%');
    g.set(10, 18, 'D');
    g.set(11, 23, 'D'); g.set(13, 23, 'w');
    g.set(16, 13, 'D');
    g.set(16, 15, 'w'); g.set(16, 16, 'w');
    g.set(16, 20, ','); g.set(16, 21, ',');
    g.set(16, 26, 'D');
    // outer openings
    g.fill(11, 9, 13, 9, 'D');           // garage door to the west alley
    g.set(7, 13, 'D'); g.set(7, 21, 'D'); // back doors from the garden
    g.set(7, 26, 'x');
    g.set(10, 30, 'x'); g.set(13, 30, 'x'); g.set(20, 30, 'x');
    g.set(20, 9, 'D');
    g.set(24, 19, 'D'); g.set(24, 20, 'D'); // main entrance
    g.set(24, 13, 'x'); g.set(24, 26, 'x');
    // garage (B): workbench, tool racks, lockers, crates, a pillar; a car parked inside (props)
    g.fill(8, 10, 8, 11, 'k'); g.fill(8, 15, 8, 16, 's'); g.fill(15, 15, 15, 16, 'l');
    g.set(14, 11, 'c'); g.set(14, 12, 'C'); g.set(9, 13, 'p'); g.set(11, 12, 'o');
    // offices: rows of desks, filing cabinets
    g.fill(9, 24, 9, 25, 't'); g.fill(9, 27, 9, 28, 't'); g.fill(12, 24, 12, 25, 't'); g.fill(12, 27, 12, 28, 't');
    g.fill(15, 27, 15, 29, 'l'); g.set(8, 29, 's');
    // centre hall: security desk, lockers
    g.set(12, 20, 'c'); g.set(14, 19, 'k'); g.fill(8, 19, 8, 20, 'l');
    // lobby: reception desk, pillars round the atrium, planters, waiting area, shelves
    g.fill(18, 18, 18, 20, 'k');
    g.set(21, 16, '='); g.set(21, 22, '=');
    g.set(17, 15, 'o'); g.set(17, 23, 'o'); g.set(22, 15, 'o'); g.set(22, 23, 'o');
    g.set(20, 11, 't'); g.set(20, 27, 't'); g.fill(23, 10, 23, 12, 's'); g.fill(17, 26, 17, 28, 'k'); g.set(22, 11, 'c');
    // courtyard: fountain and planters
    g.fill(29, 18, 30, 21, '2');
    g.fill(27, 10, 27, 12, '='); g.fill(27, 27, 27, 29, '=');
    g.fill(32, 15, 32, 16, '='); g.fill(32, 23, 32, 24, '=');
    g.set(30, 8, 'C'); g.set(30, 31, 'C'); g.set(26, 14, 'c'); g.set(26, 25, 'c');
    // west alley and the gardener's shed
    g.set(9, 4, 'C'); g.set(15, 6, 'c'); g.fill(19, 2, 19, 3, '='); g.set(24, 5, 'C');
    g.fill(25, 1, 29, 5, '%'); g.fill(26, 2, 28, 4, ',');
    g.set(25, 3, 'D'); g.set(27, 5, 'D'); g.set(29, 3, 'x');
    g.roof(25, 1, 29, 5);
    g.fill(26, 2, 26, 3, 's'); g.set(28, 2, 'p');
    // guard house at the south gate
    g.fill(30, 30, 34, 36, '%'); g.fill(31, 31, 33, 35, ',');
    g.set(30, 32, 'D'); g.set(32, 30, 'D'); g.set(30, 34, 'x'); g.set(32, 36, 'x');
    g.roof(30, 30, 34, 36);
    g.set(31, 35, 'k'); g.fill(33, 31, 33, 32, 'l'); g.set(31, 33, 't');
    // east garden
    g.fill(7, 34, 7, 36, '='); g.set(21, 35, 'C'); g.set(26, 34, 'c'); g.set(4, 35, 'C');
    // north garden
    g.set(5, 10, 'C'); g.set(5, 29, 'C'); g.fill(5, 18, 5, 21, '=');
  },
  props: [
    // car in the garage, parked cars and a van outside, garden generator, roof AC units
    { kind: 'car', r: 12, c: 16, dir: 'z', color: 0x1d1f22 },
    { kind: 'van', r: 12, c: 5, dir: 'z', color: 0xe4e2dc },
    { kind: 'car', r: 29, c: 26, dir: 'x', color: 0x23324a },
    { kind: 'car', r: 33, c: 9, dir: 'x', color: 0x9ea3a8 },
    { kind: 'car', r: 22, c: 36, dir: 'z', color: 0x5a1d1d },
    { kind: 'generator', r: 17, c: 35, dir: 'z' },
    { kind: 'hvac', r: 9, c: 13, dir: 'x', y: 7.0 },
    { kind: 'hvac', r: 9, c: 16, dir: 'x', y: 7.0 },
    { kind: 'hvac', r: 20, c: 26, dir: 'z', y: 7.0 },
    // posts holding up the balcony and the outside landing
    { r: 27, c: 17, h: 3.3, mat: 'sandstoneLight', inset: 0.7 },
    { r: 27, c: 22, h: 3.3, mat: 'sandstoneLight', inset: 0.7 },
    { r: 10, c: 33, h: 3.3, mat: 'concrete', inset: 0.7 },
    { r: 13, c: 33, h: 3.3, mat: 'concrete', inset: 0.7 },
    { r: 3, c: 7, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 14, c: 17, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 33, c: 2, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
  ],
  zones: {
    A: [8, 19, 15, 29, 'upper'],
    B: [8, 10, 15, 17],
    att: [32, 12, 34, 27],
    def: [2, 12, 4, 27],
  },
  spawnYaw: { att: 0, def: Math.PI },
  // few lights on purpose: every point light costs on every lit pixel
  lights: [
    { r: 11, c: 13, color: 0xfff0d8, distance: 18 },
    { r: 11, c: 24, color: 0xfff0d8, distance: 18 },
    { r: 20, c: 19, color: 0xffe2b0, intensity: 7, distance: 22 },
    { r: 11, c: 13, level: 'upper', color: 0xffe2b0, distance: 18 },
    { r: 11, c: 24, level: 'upper', color: 0xfff0d8, distance: 20 },
    { r: 20, c: 19, level: 'upper', color: 0xfff0d8, intensity: 8, distance: 22 },
  ],
  decor: {
    furniture: 'office',
    wallProps: { ac: 0.06, ebox: 0.03, pipe: 0.05, vent: 0.03 },
    clutter: { rocks: 20, trash: 10, cans: 6, pots: 6 },
    skyline: 'city',
    fountain: [29, 18, 30, 21],
    flags: [{ r: 23, c: 17, h: 4.5 }, { r: 23, c: 22, h: 4.5 }, { r: 35, c: 18, h: 4, design: 'embassy' }, { r: 35, c: 21, h: 4, design: 'embassy' }],
    trim: 'plasterDark',
    palms: 10,
    grass: 'green',
    lampPosts: 6,
    wires: 4,
    decals: ['crack', 'leaves', 'stain'],
    litWindows: 0.25,
    signs: [
      { r: 24, c: 17, dir: 's', text: 'A ↑' },
      { r: 24, c: 22, dir: 's', text: '← B', color: '#e8d23a' },
      { r: 16, c: 18, dir: 's', text: 'A ↑' },
    ],
  },
};
