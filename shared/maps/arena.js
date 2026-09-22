// Arena - a compact symmetric map for deathmatch style modes, with a raised centre platform.

function room(g, r0, c0) {
  g.fill(r0, c0, r0 + 5, c0 + 5, '#');
  g.fill(r0 + 1, c0 + 1, r0 + 4, c0 + 4, ',');
  g.roof(r0, c0, r0 + 5, c0 + 5);
}

export default {
  id: 'arena',
  name: 'Arena',
  desc: 'Compact symmetric arena at dusk. Fast fights around a raised centre platform. Made for deathmatch.',
  modes: ['tdm', 'ffa', 'gungame'],
  rows: 30,
  cols: 30,
  cellSize: 2,
  wallHeight: 5,
  buildingHeight: 4.2,
  roofHeight: 3.2,
  roofTop: 4.0,
  mats: {
    wall: 'brick', wall2: 'concreteDark', building: 'plasterDark', floor: 'dirt', floor2: 'tiles',
    raised: 'concrete', crate: 'crate', crate2: 'crateDark', low: 'sandbag', roof: 'concreteDark', destructible: 'woodPanel',
  },
  theme: {
    skyTop: 0x1f2150, skyHorizon: 0xf2a066, skyBottom: 0x3a2c2c,
    fog: 0x8a6468, fogNear: 30, fogFar: 130,
    sun: { dir: [-0.8, 0.38, 0.25], color: 0xffb57a, intensity: 2.4 },
    hemi: { sky: 0xa89ad8, ground: 0x5a4238, intensity: 1.1 },
    exposure: 1.1,
    ambientSound: 'wind',
  },
  carve(g) {
    g.fill(1, 1, 28, 28, '.');
    // central platform (2 m) with stairs north and south, crate jumps east and west
    g.fill(12, 12, 17, 17, '4');
    g.fill(11, 14, 11, 15, '3'); g.fill(10, 14, 10, 15, '2'); g.fill(9, 14, 9, 15, '1');
    g.fill(18, 14, 18, 15, '3'); g.fill(19, 14, 19, 15, '2'); g.fill(20, 14, 20, 15, '1');
    g.set(14, 10, 'c'); g.set(14, 11, 'C');
    g.set(15, 19, 'c'); g.set(15, 18, 'C');

    // corner rooms
    room(g, 3, 3); room(g, 3, 21); room(g, 21, 3); room(g, 21, 21);
    // NW
    g.set(8, 5, 'D'); g.set(5, 8, 'D'); g.set(7, 8, 'x'); g.set(8, 7, 'w');
    // NE
    g.set(8, 24, 'D'); g.set(5, 21, 'D'); g.set(7, 21, 'x'); g.set(8, 22, 'w');
    // SW
    g.set(21, 5, 'D'); g.set(24, 8, 'D'); g.set(22, 8, 'x'); g.set(21, 7, 'w');
    // SE
    g.set(21, 24, 'D'); g.set(24, 21, 'D'); g.set(22, 21, 'x'); g.set(21, 22, 'w');

    // partition walls with breakable centres
    g.fill(6, 12, 6, 17, '#'); g.set(6, 14, 'w'); g.set(6, 15, 'w'); g.set(6, 12, 'x'); g.set(6, 17, 'x');
    g.fill(23, 12, 23, 17, '#'); g.set(23, 14, 'w'); g.set(23, 15, 'w'); g.set(23, 12, 'x'); g.set(23, 17, 'x');
    g.fill(12, 6, 17, 6, '#'); g.set(14, 6, 'D'); g.set(15, 6, 'w'); g.set(12, 6, 'x'); g.set(17, 6, 'x');
    g.fill(12, 23, 17, 23, '#'); g.set(15, 23, 'D'); g.set(14, 23, 'w'); g.set(12, 23, 'x'); g.set(17, 23, 'x');

    // pillars and crates
    g.set(10, 10, 'C'); g.set(10, 19, 'C'); g.set(19, 10, 'C'); g.set(19, 19, 'C');
    g.set(2, 14, 'c'); g.set(27, 15, 'c'); g.set(14, 2, 'c'); g.set(15, 27, 'c');
    g.set(2, 10, '='); g.set(27, 19, '='); g.set(19, 2, '='); g.set(10, 27, '=');
    g.set(4, 12, 'c'); g.set(25, 17, 'c'); g.set(17, 4, 'c'); g.set(12, 25, 'c');
  },
  zones: {
    att: [10, 1, 19, 4],
    def: [10, 25, 19, 28],
  },
  spawnYaw: { att: -Math.PI / 2, def: Math.PI / 2 },
  props: [],
  lights: [
    { r: 5, c: 5, color: 0xffd9a0, intensity: 5, distance: 12 },
    { r: 5, c: 24, color: 0xffd9a0, intensity: 5, distance: 12 },
    { r: 24, c: 5, color: 0xffd9a0, intensity: 5, distance: 12 },
    { r: 24, c: 24, color: 0xffd9a0, intensity: 5, distance: 12 },
  ],
};
