// Turns a compact grid based map description into collision boxes, spawn points and zones.
//
// Grid legend (each cell is `cellSize` metres, default 2):
//   #  wall (map wall height; interior blocks get taller to form a skyline)
//   %  building wall (building height)
//   .  open floor
//   ,  open floor with the secondary floor material
//   D  doorway (open with a lintel above)
//   x  window (low sill + header, open in the middle)
//   w  destructible wooden wall panel running through the middle of the cell
//   c  crate (1 m)       C  stacked crates (2 m)
//   =  low cover (1 m)
//   1-8 raised floor, n * 0.5 m high
// Roofs are given separately as cell rectangles so crates etc. can be placed under them.

import { hash2 } from '../constants.js';

export const DESTRUCTIBLE_HP = 100;

export class Grid {
  constructor(rows, cols, fill = '#') {
    this.rows = rows;
    this.cols = cols;
    this.cells = [];
    for (let r = 0; r < rows; r++) this.cells.push(new Array(cols).fill(fill));
    this.roofs = [];
    this.alts = [];
  }
  inside(r, c) { return r >= 0 && c >= 0 && r < this.rows && c < this.cols; }
  get(r, c) { return this.inside(r, c) ? this.cells[r][c] : '#'; }
  set(r, c, ch) { if (this.inside(r, c)) this.cells[r][c] = ch; }
  fill(r0, c0, r1, c1, ch) {
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++)
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) this.set(r, c, ch);
  }
  roof(r0, c0, r1, c1) { this.roofs.push([r0, c0, r1, c1]); }
  // mirror a rectangle horizontally (left-right) into the other half
  toString() { return this.cells.map((row) => row.join('')).join('\n'); }
}

const WALLS = new Set(['#', '%']);
const SOLIDISH = new Set(['#', '%', 'w', 'x', 'D']);

export function isOpenChar(ch) {
  return !WALLS.has(ch);
}

export function buildMap(def) {
  const cs = def.cellSize ?? 2;
  const g = new Grid(def.rows, def.cols, '#');
  def.carve(g);
  const rows = g.rows, cols = g.cols;
  const wallH = def.wallHeight ?? 6;
  const bldH = def.buildingHeight ?? 4.4;
  const roofH = def.roofHeight ?? 3.4;
  const roofTop = def.roofTop ?? bldH;
  const doorH = def.doorHeight ?? 2.8;
  const mats = {
    wall: 'sandstone', wall2: 'sandstoneDark', building: 'plaster', floor: 'sand', floor2: 'stoneTiles',
    raised: 'stoneTiles', crate: 'crate', low: 'sandbag', roof: 'roof', lintel: 'wood', destructible: 'woodPanel',
    ...(def.mats || {}),
  };

  const x0 = -(cols * cs) / 2;
  const z0 = -(rows * cs) / 2;
  const cellMinX = (c) => x0 + c * cs;
  const cellMinZ = (r) => z0 + r * cs;

  const roofed = [];
  for (let r = 0; r < rows; r++) roofed.push(new Array(cols).fill(false));
  for (const [r0, c0, r1, c1] of g.roofs)
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (g.inside(r, c)) roofed[r][c] = true;

  const openAround = (r, c) => {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      if (g.inside(r + dr, c + dc) && isOpenChar(g.get(r + dr, c + dc))) return true;
    }
    return false;
  };

  // Wall height per '#' cell: walls next to play space use the base height, hidden blocks form a skyline.
  const wallInfo = (r, c) => {
    if (openAround(r, c)) return { h: wallH, mat: mats.wall };
    const k = hash2(r >> 2, c >> 2);
    const h = wallH + [0, 2, 3.5, 5][Math.floor(k * 4)];
    return { h, mat: k > 0.5 ? mats.wall2 : mats.wall };
  };

  const neighborWallTop = (r, c) => {
    let top = 0, mat = null;
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const ch = g.get(r + dr, c + dc);
      if (ch === '#') { const wi = wallInfo(r + dr, c + dc); if (wi.h > top) { top = Math.min(wi.h, wallH); mat = mats.wall; } }
      else if (ch === '%') { if (bldH > top) { top = bldH; mat = mats.building; } }
    }
    if (!mat) { top = wallH; mat = mats.wall; }
    return { top, mat };
  };

  const boxes = [];
  let nextId = 1;
  const add = (minx, miny, minz, maxx, maxy, maxz, mat, extra = {}) => {
    if (maxy - miny < 1e-4) return null;
    const b = { id: nextId++, min: [minx, miny, minz], max: [maxx, maxy, maxz], mat, ...extra };
    boxes.push(b);
    return b;
  };

  // Ground
  add(x0 - 2, -1, z0 - 2, x0 + cols * cs + 2, 0, z0 + rows * cs + 2, mats.floor, { kind: 'ground' });

  // Greedy rectangle merging for a key function.
  const greedy = (keyFn, emit) => {
    const seen = [];
    for (let r = 0; r < rows; r++) seen.push(new Array(cols).fill(false));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (seen[r][c]) continue;
        const k = keyFn(r, c);
        if (k == null) continue;
        let w = 1;
        while (c + w < cols && !seen[r][c + w] && keyFn(r, c + w) === k) w++;
        let h = 1;
        outer: while (r + h < rows) {
          for (let i = 0; i < w; i++) if (seen[r + h][c + i] || keyFn(r + h, c + i) !== k) break outer;
          h++;
        }
        for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) seen[rr][cc] = true;
        emit(k, r, c, r + h - 1, c + w - 1);
      }
    }
  };

  // Walls
  greedy((r, c) => {
    const ch = g.get(r, c);
    if (ch === '#') { const wi = wallInfo(r, c); return `#|${wi.h}|${wi.mat}`; }
    if (ch === '%') return '%';
    return null;
  }, (k, r0, c0, r1, c1) => {
    if (k === '%') add(cellMinX(c0), 0, cellMinZ(r0), cellMinX(c1 + 1), bldH, cellMinZ(r1 + 1), mats.building, { kind: 'wall' });
    else {
      const [, h, mat] = k.split('|');
      add(cellMinX(c0), 0, cellMinZ(r0), cellMinX(c1 + 1), +h, cellMinZ(r1 + 1), mat, { kind: 'wall' });
    }
  });

  // Raised floors and low cover
  greedy((r, c) => {
    const ch = g.get(r, c);
    if (ch >= '1' && ch <= '8') return 'L' + ch;
    if (ch === '=') return '=';
    return null;
  }, (k, r0, c0, r1, c1) => {
    if (k === '=') add(cellMinX(c0) + 0.15, 0, cellMinZ(r0) + 0.15, cellMinX(c1 + 1) - 0.15, 1.0, cellMinZ(r1 + 1) - 0.15, mats.low, { kind: 'cover' });
    else add(cellMinX(c0), 0, cellMinZ(r0), cellMinX(c1 + 1), (+k[1]) * 0.5, cellMinZ(r1 + 1), mats.raised, { kind: 'floor' });
  });

  // Secondary floor material (render only)
  greedy((r, c) => (g.get(r, c) === ',' ? ',' : null), (k, r0, c0, r1, c1) => {
    add(cellMinX(c0), 0, cellMinZ(r0), cellMinX(c1 + 1), 0.012, cellMinZ(r1 + 1), mats.floor2, { kind: 'decal', renderOnly: true });
  });

  // Roofs over open cells
  greedy((r, c) => (roofed[r][c] && isOpenChar(g.get(r, c)) ? 'R' : null), (k, r0, c0, r1, c1) => {
    add(cellMinX(c0), roofH, cellMinZ(r0), cellMinX(c1 + 1), roofTop, cellMinZ(r1 + 1), mats.roof, { kind: 'roof' });
  });

  // Per-cell features
  const destructibles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = g.get(r, c);
      const mx = cellMinX(c), mz = cellMinZ(r);
      const cx = mx + cs / 2, cz = mz + cs / 2;
      const isRoofed = roofed[r][c];
      if (ch === 'c' || ch === 'C') {
        const inset = 0.06 + hash2(r * 7, c * 3) * 0.1;
        const mat = hash2(r, c * 11) > 0.72 ? (mats.crate2 || mats.crate) : mats.crate;
        add(mx + inset, 0, mz + inset, mx + cs - inset, 1.0, mz + cs - inset, mat, { kind: 'crate' });
        if (ch === 'C') {
          const i2 = inset + 0.12 + hash2(c, r) * 0.1;
          add(mx + i2, 1.0, mz + i2, mx + cs - i2, 2.0, mz + cs - i2, mat, { kind: 'crate' });
        }
      } else if (ch === 'D') {
        const { top, mat } = neighborWallTop(r, c);
        const t = isRoofed ? Math.min(top, roofH) : top;
        if (t > doorH) add(mx, doorH, mz, mx + cs, t, mz + cs, mat, { kind: 'lintel' });
      } else if (ch === 'x') {
        const { top, mat } = neighborWallTop(r, c);
        const t = isRoofed ? Math.min(top, roofH) : top;
        add(mx, 0, mz, mx + cs, 1.0, mz + cs, mat, { kind: 'sill' });
        if (t > 2.1) add(mx, 2.1, mz, mx + cs, t, mz + cs, mat, { kind: 'lintel' });
      } else if (ch === 'w') {
        const alongX = SOLIDISH.has(g.get(r, c - 1)) && SOLIDISH.has(g.get(r, c + 1));
        const { top, mat } = neighborWallTop(r, c);
        const t = isRoofed ? Math.min(top, roofH) : top;
        const th = 0.1;
        const panelTop = Math.min(3, t);
        const nCols = Math.round(cs);
        const rowsN = Math.round(panelTop);
        const bw = cs / nCols, bh = panelTop / rowsN;
        for (let i = 0; i < nCols; i++) {
          for (let j = 0; j < rowsN; j++) {
            // pieces of one cell share a group so the whole wall section is reinforced together
            const extra = { kind: 'panel', destructible: true, hp: DESTRUCTIBLE_HP, group: r * cols + c };
            const b = alongX
              ? add(mx + i * bw, j * bh, cz - th, mx + (i + 1) * bw, (j + 1) * bh, cz + th, mats.destructible, extra)
              : add(cx - th, j * bh, mz + i * bw, cx + th, (j + 1) * bh, mz + (i + 1) * bw, mats.destructible, { ...extra });
            destructibles.push(b.id);
          }
        }
        if (t > panelTop + 0.01) {
          if (alongX) add(mx, panelTop, cz - 0.3, mx + cs, t, cz + 0.3, mat, { kind: 'lintel' });
          else add(cx - 0.3, panelTop, mz, cx + 0.3, t, mz + cs, mat, { kind: 'lintel' });
        }
      }
    }
  }

  // Props in cell coordinates: { r, c, rows, cols, h, y, mat, inset }
  for (const p of def.props || []) {
    const inset = p.inset ?? 0.1;
    const y = p.y ?? 0;
    add(cellMinX(p.c) + inset, y, cellMinZ(p.r) + inset, cellMinX(p.c + (p.cols ?? 1)) - inset, y + p.h, cellMinZ(p.r + (p.rows ?? 1)) - inset, p.mat, { kind: p.kind || 'prop' });
  }

  // Floor height at a cell (for spawns)
  const floorAt = (r, c) => {
    const ch = g.get(r, c);
    if (ch >= '1' && ch <= '8') return (+ch) * 0.5;
    return 0;
  };
  const spawnable = (r, c) => {
    const ch = g.get(r, c);
    return ch === '.' || ch === ',' || (ch >= '1' && ch <= '8') || ch === 'D';
  };

  const rectToZone = ([r0, c0, r1, c1]) => ({
    min: [cellMinX(Math.min(c0, c1)), -1, cellMinZ(Math.min(r0, r1))],
    max: [cellMinX(Math.max(c0, c1) + 1), 6, cellMinZ(Math.max(r0, r1) + 1)],
  });

  const zones = {};
  for (const [k, rect] of Object.entries(def.zones || {})) zones[k] = rectToZone(rect);

  const spawnsIn = (rect, yaw) => {
    const [r0, c0, r1, c1] = rect;
    const pts = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (!spawnable(r, c)) continue;
      // keep away from walls a bit for nicer spawns
      pts.push([cellMinX(c) + cs / 2, floorAt(r, c), cellMinZ(r) + cs / 2, yaw, r, c]);
    }
    // spread out: order by a checker pattern so the first N are well distributed
    pts.sort((a, b) => ((a[4] + a[5]) % 2) - ((b[4] + b[5]) % 2) || (hash2(a[4], a[5]) - hash2(b[4], b[5])));
    return pts.map((p) => p.slice(0, 4));
  };

  const spawns = {
    1: def.zones?.att ? spawnsIn(def.zones.att, def.spawnYaw?.att ?? 0) : [],
    2: def.zones?.def ? spawnsIn(def.zones.def, def.spawnYaw?.def ?? Math.PI) : [],
    ffa: [],
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!spawnable(r, c)) continue;
    // FFA spawns need some room around them
    let ok = true;
    for (let dr = -1; dr <= 1 && ok; dr++) for (let dc = -1; dc <= 1; dc++) if (!isOpenChar(g.get(r + dr, c + dc))) { ok = false; break; }
    if (ok && !roofed[r][c]) spawns.ffa.push([cellMinX(c) + cs / 2, floorAt(r, c), cellMinZ(r) + cs / 2, hash2(r, c) * Math.PI * 2]);
    else if (ok) spawns.ffa.push([cellMinX(c) + cs / 2, floorAt(r, c), cellMinZ(r) + cs / 2, hash2(c, r) * Math.PI * 2]);
  }

  const lights = (def.lights || []).map((l) => ({
    x: l.x ?? cellMinX(l.c) + cs / 2,
    y: l.y ?? roofH - 0.25,
    z: l.z ?? cellMinZ(l.r) + cs / 2,
    color: l.color ?? 0xffe2b0,
    intensity: l.intensity ?? 6,
    distance: l.distance ?? 16,
  }));

  return {
    id: def.id,
    name: def.name,
    desc: def.desc || '',
    modes: def.modes,
    theme: def.theme,
    decor: def.decor || {},
    mats,
    cellSize: cs,
    rows, cols,
    x0, z0,
    grid: g.cells.map((row) => row.join('')),
    roofed,
    bounds: { minX: x0, minZ: z0, maxX: x0 + cols * cs, maxZ: z0 + rows * cs },
    boxes,
    destructibles,
    zones,
    spawns,
    lights,
    roofHeight: roofH,
    wallHeight: wallH,
  };
}

export function inZone(zone, x, y, z) {
  return zone && x >= zone.min[0] && x <= zone.max[0] && z >= zone.min[2] && z <= zone.max[2] && y >= zone.min[1] && y <= zone.max[1];
}
