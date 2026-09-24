// Sandstone - a sun-baked desert town. B is a walled courtyard reached through the long covered tunnels,
// the B doors gatehouse or the mid-to-B alley; A is a plaza with a raised platform, reached over the short
// catwalk from mid, through long A and its double doors, or from CT. Mid is a long street overlooked from
// the upper floors of the houses on both sides. Lower tunnels link T spawn to mid and B.

export default {
  id: 'sandstone',
  name: 'Sandstone',
  desc: 'Sun-baked desert town. Long mid watched from upstairs windows, covered tunnels to B, a catwalk and long doors to A.',
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
    raised: 'stoneTiles', crate: 'crate', crate2: 'crateDark', low: 'sandbag', roof: 'wood', destructible: 'woodPanel', pillar: 'sandstone',
  },
  upper: {
    floorY: 3.7,
    slab: 0.3,
    wallHeight: 3.2,
    roofHeight: 2.9,
    mats: { wall: 'sandstoneLight', floor: 'stoneTiles', slab: 'wood', roof: 'wood' },
    carve(u) {
      // B window house: a room over B with its window
      u.fill(4, 11, 10, 14, '#'); u.fill(5, 12, 9, 13, '.');
      u.set(7, 11, 'x'); u.set(4, 13, 'x'); u.set(10, 12, 'x');
      u.fill(6, 13, 9, 13, ' ');                  // stair well
      u.set(5, 12, 't'); u.set(9, 12, 'c');
      u.roof(4, 11, 10, 14);
      // mid-left house: upstairs over mid and the B alley
      u.fill(12, 10, 19, 17, '#'); u.fill(13, 11, 18, 16, '.');
      u.set(14, 17, 'x'); u.set(17, 17, 'x'); u.set(16, 10, 'x'); u.set(12, 13, 'x');
      u.fill(15, 11, 18, 11, ' ');                // stair well
      u.fill(13, 13, 13, 14, 't'); u.set(18, 15, 'C'); u.set(18, 13, 's');
      u.roof(12, 10, 19, 17);
      // mid-right house: upstairs over mid and long A
      u.fill(13, 23, 21, 31, '#'); u.fill(14, 24, 20, 30, '.');
      u.set(15, 23, 'x'); u.set(18, 23, 'x'); u.set(17, 31, 'x'); u.set(13, 27, 'x'); u.set(21, 28, 'x');
      u.fill(17, 30, 20, 30, ' ');                // stair well
      u.fill(14, 24, 14, 25, 's'); u.set(16, 27, 't'); u.set(20, 25, 'c'); u.set(19, 27, 'C');
      u.roof(13, 23, 21, 31);
    },
  },
  stairs: [
    { r: 9, c: 13, dir: 'n', len: 4, mat: 'wood' },
    { r: 18, c: 11, dir: 'n', len: 4, mat: 'wood' },
    { r: 20, c: 30, dir: 'n', len: 4, mat: 'wood' },
  ],
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
    volumetric: { density: 0.008 }, // dust in the air for volumetric sunlight (Ultra / Epic)
    ambientSound: 'wind',
  },
  carve(g) {
    g.fill(1, 1, 38, 38, '.');

    // ---------------------------------------------------------------- north: B, CT, A
    // B courtyard with a raised back platform
    g.fill(2, 2, 3, 6, '2'); g.fill(4, 2, 4, 3, '1');
    g.fill(3, 7, 3, 9, ','); g.fill(5, 3, 9, 9, ',');
    g.set(5, 5, 'C'); g.set(5, 6, 'c'); g.set(8, 3, 'c'); g.set(8, 8, 'C'); g.set(9, 8, 'c');
    g.fill(10, 2, 10, 3, '='); g.set(2, 9, 'c');
    // B doors gatehouse from CT
    g.fill(1, 11, 3, 14, '%');
    g.fill(2, 12, 2, 13, ',');
    g.set(2, 11, 'D'); g.set(2, 14, 'D'); g.set(1, 12, 'x');
    g.roof(1, 11, 3, 14);
    // B window house (stairs up to the window room)
    g.fill(4, 11, 10, 14, '%');
    g.fill(5, 12, 9, 13, ',');
    g.set(4, 12, 'D'); g.set(10, 12, 'D'); g.set(7, 11, 'x'); g.set(5, 14, 'D');
    g.set(5, 12, 'k');

    // CT spawn: fountain square
    g.fill(2, 19, 3, 20, '2');
    g.set(1, 16, 'c'); g.set(4, 23, 'C'); g.set(4, 24, 'c'); g.set(1, 26, 'c');

    // mid doors house: west room | covered hall | east room
    g.fill(6, 15, 11, 24, '%');
    g.fill(7, 16, 10, 23, ',');
    g.fill(7, 18, 10, 18, '%'); g.fill(7, 21, 10, 21, '%');
    g.set(8, 18, 'D'); g.set(9, 21, 'D');
    g.fill(6, 19, 6, 20, 'D'); g.fill(11, 19, 11, 20, 'D');
    g.set(8, 15, 'x'); g.set(9, 24, 'D'); g.set(6, 16, 'D'); g.set(11, 23, 'x');
    g.roof(6, 15, 11, 24);
    g.set(9, 17, 't'); g.set(10, 16, 's'); g.set(7, 23, 'k'); g.set(10, 22, 'c'); g.set(8, 19, 'c');

    // A plaza: raised platform in the corner, steps, cover
    g.fill(2, 33, 5, 37, '2');
    g.fill(6, 33, 6, 34, '1'); g.fill(4, 32, 5, 32, '1');
    g.fill(7, 28, 10, 36, ',');
    g.set(3, 29, 'C'); g.set(3, 30, 'c'); g.set(8, 30, 'c'); g.set(9, 30, 'C'); g.set(7, 36, 'c');
    g.set(2, 36, 'c'); g.set(10, 35, '='); g.set(10, 36, '=');

    // short A: steps up from mid onto the catwalk, along to A, steps down
    g.set(12, 22, '1'); g.set(12, 23, '2'); g.set(12, 24, '3');
    g.fill(11, 25, 12, 29, '4');
    g.set(11, 30, '3'); g.set(12, 30, '3'); g.set(11, 31, '2'); g.set(11, 32, '1');

    // ---------------------------------------------------------------- middle
    // mid street cover
    g.fill(17, 19, 17, 20, 'C'); g.set(22, 18, 'c'); g.set(26, 21, 'c'); g.set(29, 19, '='); g.set(29, 20, '=');
    g.set(13, 21, 'c');

    // B tunnels: long covered hall with a colonnade, exits to B, the alley and T side
    g.fill(12, 2, 30, 7, '%');
    g.fill(13, 3, 29, 6, ',');
    g.fill(12, 4, 12, 5, 'D'); g.fill(30, 4, 30, 5, 'D');
    g.set(16, 7, 'D'); g.set(25, 7, 'D'); g.set(12, 7, 'x'); g.set(21, 7, 'w');
    g.roof(12, 2, 30, 7);
    for (const r of [15, 19, 23, 27]) { g.set(r, 4, 'o'); g.set(r, 5, 'o'); }
    g.set(14, 3, 'c'); g.set(18, 6, 'C'); g.set(22, 3, 'c'); g.set(26, 6, 'c'); g.set(28, 3, 'p');

    // alley between the tunnels and the mid-left house
    g.set(14, 9, 'c'); g.set(18, 8, 'c');

    // mid-left house (shop): stairs up to the windows over mid
    g.fill(12, 10, 19, 17, '%');
    g.fill(13, 11, 18, 16, ',');
    g.set(13, 10, 'D'); g.set(16, 17, 'D');
    g.set(14, 17, 'x'); g.set(18, 17, 'w'); g.set(17, 10, 'x');
    g.fill(13, 13, 13, 15, 'k'); g.set(16, 14, 't'); g.set(18, 16, 's');

    // mid-right house: two rooms, stairs up, door out to long A
    g.fill(13, 23, 21, 31, '%');
    g.fill(14, 24, 20, 30, ',');
    g.fill(14, 27, 20, 27, '%'); g.set(16, 27, 'D'); g.set(19, 27, 'D');
    g.set(16, 23, 'D'); g.set(15, 31, 'D');
    g.set(14, 23, 'x'); g.set(20, 23, 'w'); g.set(17, 31, 'x');
    g.fill(14, 24, 14, 25, 'k'); g.set(18, 25, 't'); g.set(20, 24, 'c'); g.set(14, 29, 's'); g.set(15, 28, 'C');

    // long A: corner, long doors, cover
    g.set(13, 34, 'c'); g.set(13, 35, 'C'); g.set(17, 37, 'c'); g.set(20, 33, 'c');
    g.fill(22, 32, 23, 38, '#');
    g.fill(22, 34, 23, 35, 'D');
    g.set(26, 36, 'C'); g.set(27, 36, 'c'); g.set(28, 33, 'c'); g.set(31, 37, 'c');
    // house on the T side of long doors
    g.fill(24, 32, 29, 34, '%');
    g.fill(25, 33, 28, 33, ',');
    g.set(27, 34, 'D'); g.set(29, 33, 'D'); g.set(25, 34, 'x');
    g.roof(24, 32, 29, 34);

    // lower tunnels: from T spawn to the B tunnels and up to mid
    g.fill(20, 10, 30, 15, '%');
    g.fill(21, 11, 29, 14, ',');
    g.fill(21, 13, 26, 13, '%'); g.set(23, 13, 'D');
    g.set(25, 10, 'D'); g.set(30, 12, 'D'); g.set(21, 15, 'D'); g.set(27, 15, 'x');
    g.roof(20, 10, 30, 15);
    g.set(22, 11, 'c'); g.set(28, 14, 'C'); g.set(24, 14, 'p');
    // passage between the lower tunnels and mid
    g.set(24, 16, 'c'); g.set(28, 17, 'c');

    // mid-right lower block (T side)
    g.fill(23, 23, 29, 29, '%');
    g.fill(24, 24, 28, 28, ',');
    g.set(23, 26, 'D'); g.set(29, 25, 'D'); g.set(26, 23, 'x'); g.set(26, 29, 'D');
    g.roof(23, 23, 29, 29);
    g.fill(24, 24, 24, 25, 't'); g.set(28, 28, 's'); g.set(26, 26, 'o');

    // ---------------------------------------------------------------- south: T spawn and approaches
    g.set(33, 14, 'c'); g.set(36, 23, 'C'); g.set(37, 23, 'c'); g.set(34, 26, 'c');
    g.set(33, 5, 'c'); g.set(35, 8, 'C'); g.set(32, 30, 'c'); g.set(35, 33, 'C');
    g.fill(31, 16, 31, 17, '='); g.fill(31, 22, 31, 23, '=');
  },
  zones: {
    A: [7, 28, 10, 36],
    B: [5, 3, 9, 9],
    att: [33, 15, 38, 24],
    def: [1, 16, 4, 23],
  },
  spawnYaw: { att: 0, def: Math.PI },
  props: [
    { kind: 'car', r: 8, c: 33, dir: 'z', variant: 'wreck' },
    { kind: 'car', r: 34, c: 30, dir: 'x', color: 0xd9d6cf },
    { kind: 'van', r: 36, c: 6, dir: 'x', color: 0xc8b89a },
    { kind: 'car', r: 18, c: 35, dir: 'z', variant: 'wreck' },
    { kind: 'generator', r: 2, c: 27, dir: 'z' },
    { kind: 'dumpster', r: 30, c: 9, dir: 'x' },
    // oil drums (0.76 m wide, 1 m tall)
    { r: 11, c: 2, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 12, c: 37, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 30, c: 21, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 35, c: 3, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 32, c: 36, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 19, c: 22, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 3, c: 11, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 21, c: 9, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
  ],
  decor: {
    furniture: 'rustic',
    wallProps: { ac: 0.05, ebox: 0.03, pipe: 0.035, vent: 0.02 },
    clutter: { rocks: 80, trash: 18, cans: 10, pots: 14, jerry: 4 },
    rockColor: 0x9c8466,
    skyline: 'desert',
    flags: [{ r: 12, c: 18, h: 4, design: 'desert' }, { r: 12, c: 21, h: 4, design: 'desert' }],
    fountain: [2, 19, 3, 20],
    trim: 'sandstoneLight',
    palms: 16,
    grass: 'dry',
    awnings: [['#b8412c', '#eadfc6'], ['#2f6f8a', '#eadfc6'], ['#6a8a3a', '#efe6c8']],
    wires: 14,
    decals: ['crack', 'sand', 'stain'],
    litWindows: 0.04,
    tankColor: 0xe0d8c4,
    signs: [
      { r: 32, c: 15, dir: 's', text: '← B' },
      { r: 32, c: 24, dir: 's', text: 'A →' },
      { r: 5, c: 15, dir: 's', text: '← B' },
      { r: 5, c: 24, dir: 's', text: 'A →' },
      { r: 21, c: 32, dir: 'w', text: 'A ↑' },
      { r: 12, c: 8, dir: 'n', text: '← B' },
    ],
  },
  lights: [
    { r: 17, c: 4, color: 0xffc27a, intensity: 5, distance: 14 },
    { r: 25, c: 5, color: 0xffc27a, intensity: 5, distance: 14 },
    { r: 25, c: 12, color: 0xffc27a, intensity: 4, distance: 12 },
    { r: 8, c: 19, color: 0xffd9a0, intensity: 4, distance: 10 },
    { r: 16, c: 13, color: 0xffd9a0, intensity: 3.5, distance: 10 },
    { r: 17, c: 26, color: 0xffd9a0, intensity: 3.5, distance: 10 },
    { r: 26, c: 26, color: 0xffd9a0, intensity: 3.5, distance: 10 },
  ],
};
