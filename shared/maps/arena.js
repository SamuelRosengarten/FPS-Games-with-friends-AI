// Arena - a symmetric map for deathmatch style modes at dusk. Four two-storey corner towers are linked by
// catwalks along the sides; stairs climb from the raised centre platform straight up to each catwalk, so
// the fight runs on three levels: the yard, the platform and the catwalk ring.

function tower(g, r0, c0) {
  g.fill(r0, c0, r0 + 6, c0 + 6, '%');
  g.fill(r0 + 1, c0 + 1, r0 + 5, c0 + 5, ',');
}
function upperTower(u, r0, c0) {
  u.fill(r0, c0, r0 + 6, c0 + 6, '#');
  u.fill(r0 + 1, c0 + 1, r0 + 5, c0 + 5, '.');
  u.roof(r0, c0, r0 + 6, c0 + 6);
}

export default {
  id: 'arena',
  name: 'Arena',
  desc: 'Symmetric arena at dusk: two-storey corner towers, a catwalk ring and a raised centre platform. Made for deathmatch.',
  modes: ['tdm', 'ffa', 'gungame'],
  rows: 32,
  cols: 32,
  cellSize: 2,
  wallHeight: 5,
  buildingHeight: 4.2,
  roofHeight: 3.2,
  roofTop: 4.0,
  mats: {
    wall: 'brick', wall2: 'concreteDark', building: 'plasterDark', floor: 'dirt', floor2: 'tiles',
    raised: 'concrete', crate: 'crate', crate2: 'crateDark', low: 'sandbag', roof: 'concreteDark', destructible: 'woodPanel', pillar: 'concrete',
  },
  upper: {
    floorY: 3.5,
    slab: 0.3,
    wallHeight: 3.2,
    roofHeight: 2.9,
    mats: { wall: 'plasterDark', floor: 'wood', slab: 'concreteDark', roof: 'concreteDark' },
    carve(u) {
      upperTower(u, 2, 2); upperTower(u, 2, 23); upperTower(u, 23, 2); upperTower(u, 23, 23);
      // stair wells inside the towers
      u.fill(4, 3, 7, 3, ' '); u.fill(4, 28, 7, 28, ' '); u.fill(24, 3, 27, 3, ' '); u.fill(24, 28, 27, 28, ' ');
      // tower doors onto the catwalks, windows over the yard
      u.set(5, 8, 'D'); u.set(8, 5, 'D'); u.set(5, 23, 'D'); u.set(8, 26, 'D');
      u.set(26, 8, 'D'); u.set(23, 5, 'D'); u.set(26, 23, 'D'); u.set(23, 26, 'D');
      u.set(8, 7, 'x'); u.set(7, 8, 'x'); u.set(8, 24, 'x'); u.set(7, 23, 'x');
      u.set(23, 7, 'x'); u.set(24, 8, 'x'); u.set(23, 24, 'x'); u.set(24, 23, 'x');
      u.set(2, 5, 'x'); u.set(2, 26, 'x'); u.set(29, 5, 'x'); u.set(29, 26, 'x');
      // catwalk ring along the four sides, with the stair landings
      u.fill(5, 9, 5, 22, '-'); u.fill(26, 9, 26, 22, '-');
      u.fill(9, 5, 22, 5, '-'); u.fill(9, 26, 22, 26, '-');
      u.set(5, 15, '.'); u.set(26, 16, '.'); u.set(16, 5, '.'); u.set(15, 26, '.');
      // tower rooms: a desk, crates, lockers
      u.fill(3, 5, 3, 6, 't'); u.set(6, 6, 'c'); u.fill(3, 25, 3, 26, 't'); u.set(6, 25, 'c');
      u.fill(28, 5, 28, 6, 'l'); u.set(25, 6, 'c'); u.fill(28, 25, 28, 26, 'l'); u.set(25, 25, 'c');
    },
  },
  stairs: [
    // inside the towers
    { r: 7, c: 3, dir: 'n', len: 4, mat: 'wood' },
    { r: 7, c: 28, dir: 'n', len: 4, mat: 'wood' },
    { r: 24, c: 3, dir: 's', len: 4, mat: 'wood' },
    { r: 24, c: 28, dir: 's', len: 4, mat: 'wood' },
    // from the platform steps up to the catwalks
    { r: 9, c: 15, dir: 'n', len: 4, mat: 'metal' },
    { r: 22, c: 16, dir: 's', len: 4, mat: 'metal' },
    { r: 16, c: 9, dir: 'w', len: 4, mat: 'metal' },
    { r: 15, c: 22, dir: 'e', len: 4, mat: 'metal' },
  ],
  theme: {
    motes: { color: 0xffb070, alpha: 0.5, count: 450, size: 0.014 },
    grade: { gain: [1.02, 0.99, 1.0], lift: [0.025, 0.01, 0.035], contrast: 1.08, saturation: 0.96, vignette: 0.34, grain: 0.025 },
    cloudCover: 0.45, cloudColor: 0xffb48a,
    sky: { turbidity: 4, rayleigh: 2.8, mie: 0.005, mieG: 0.85 },
    skyTop: 0x1f2150, skyHorizon: 0xf2a066, skyBottom: 0x3a2c2c,
    fog: 0x9a7070, fogNear: 50, fogFar: 200,
    sun: { dir: [-0.8, 0.34, 0.25], color: 0xffc9a0, intensity: 3.1 },
    hemi: { sky: 0xb4aee0, ground: 0x5e4a40, intensity: 1.25 },
    exposure: 1.15,
    volumetric: { density: 0.011 }, // dust in the air for volumetric sunlight (Ultra / Epic)
    ambientSound: 'wind',
  },
  carve(g) {
    g.fill(1, 1, 30, 30, '.');
    // corner towers: ground doors, a breakable wall, windows, furniture
    tower(g, 2, 2); tower(g, 2, 23); tower(g, 23, 2); tower(g, 23, 23);
    g.set(8, 4, 'D'); g.set(4, 8, 'D'); g.set(6, 8, 'w'); g.set(8, 6, 'x');
    g.set(8, 27, 'D'); g.set(4, 23, 'D'); g.set(6, 23, 'w'); g.set(8, 25, 'x');
    g.set(23, 4, 'D'); g.set(27, 8, 'D'); g.set(25, 8, 'w'); g.set(23, 6, 'x');
    g.set(23, 27, 'D'); g.set(27, 23, 'D'); g.set(25, 23, 'w'); g.set(23, 25, 'x');
    g.fill(3, 5, 3, 6, 'k'); g.set(6, 6, 't'); g.fill(3, 25, 3, 26, 'k'); g.set(6, 25, 't');
    g.fill(28, 5, 28, 6, 's'); g.set(25, 6, 'p'); g.fill(28, 25, 28, 26, 's'); g.set(25, 25, 'p');

    // central platform (2 m) with steps on all four sides
    g.fill(13, 13, 18, 18, '4');
    g.fill(12, 15, 12, 16, '3'); g.fill(11, 15, 11, 16, '2'); g.fill(10, 15, 10, 16, '1');
    g.fill(19, 15, 19, 16, '3'); g.fill(20, 15, 20, 16, '2'); g.fill(21, 15, 21, 16, '1');
    g.fill(15, 12, 16, 12, '3'); g.fill(15, 11, 16, 11, '2'); g.fill(15, 10, 16, 10, '1');
    g.fill(15, 19, 16, 19, '3'); g.fill(15, 20, 16, 20, '2'); g.fill(15, 21, 16, 21, '1');

    // posts under the catwalks
    for (const c of [11, 19]) { g.set(5, c, 'o'); g.set(26, c + 1, 'o'); }
    for (const r of [11, 20]) { g.set(r, 5, 'o'); g.set(r + 1, 26, 'o'); }

    // yard cover
    g.set(10, 10, 'C'); g.set(10, 21, 'C'); g.set(21, 10, 'C'); g.set(21, 21, 'C');
    g.set(11, 10, 'c'); g.set(10, 20, 'c'); g.set(20, 21, 'c'); g.set(21, 11, 'c');
    g.fill(3, 12, 3, 13, '='); g.fill(3, 18, 3, 19, '='); g.fill(28, 12, 28, 13, '='); g.fill(28, 18, 28, 19, '=');
    g.set(13, 7, 'c'); g.set(18, 24, 'c'); g.set(7, 18, 'c'); g.set(24, 13, 'c');
    g.set(8, 13, 'p'); g.set(23, 18, 'p');
  },
  zones: {
    att: [11, 1, 20, 3],
    def: [11, 28, 20, 30],
  },
  spawnYaw: { att: -Math.PI / 2, def: Math.PI / 2 },
  props: [
    // cover on the platform
    { r: 14, c: 14, h: 1.0, y: 2.0, mat: 'crate', inset: 0.2, kind: 'crate' },
    { r: 17, c: 17, h: 1.0, y: 2.0, mat: 'crateDark', inset: 0.2, kind: 'crate' },
    // containers and vehicles along the sides
    { r: 1, c: 10, rows: 1, cols: 3, h: 2.6, mat: 'containerRed', inset: 0.05, kind: 'container' },
    { r: 30, c: 19, rows: 1, cols: 3, h: 2.6, mat: 'containerBlue', inset: 0.05, kind: 'container' },
    { kind: 'car', r: 9, c: 23, dir: 'z', variant: 'wreck' },
    { kind: 'car', r: 22, c: 8, dir: 'z', flip: true, variant: 'wreck' },
    { kind: 'dumpster', r: 12, c: 8, dir: 'z' },
    { kind: 'dumpster', r: 19, c: 23, dir: 'z' },
    { r: 2, c: 16, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 29, c: 15, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 9, c: 9, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
    { r: 22, c: 22, h: 1.0, mat: 'metal', inset: 0.62, kind: 'barrel' },
  ],
  decor: {
    furniture: 'industrial',
    wallProps: { ebox: 0.03, pipe: 0.04, vent: 0.03 },
    clutter: { rocks: 50, trash: 10, cans: 6, tires: 5, pallets: 3 },
    skyline: 'hills',
    trim: 'concrete',
    torches: 16,
    grass: 'green',
    decals: ['crack', 'leaves', 'stain'],
    litWindows: 0.35,
    glass: 0x1a1d26,
  },
  lights: [
    { r: 5, c: 5, color: 0xffd9a0, intensity: 5, distance: 12 },
    { r: 5, c: 26, color: 0xffd9a0, intensity: 5, distance: 12 },
    { r: 26, c: 5, color: 0xffd9a0, intensity: 5, distance: 12 },
    { r: 26, c: 26, color: 0xffd9a0, intensity: 5, distance: 12 },
    { r: 5, c: 5, level: 'upper', color: 0xfff0d6, intensity: 4, distance: 10 },
    { r: 26, c: 26, level: 'upper', color: 0xfff0d6, intensity: 4, distance: 10 },
  ],
};
