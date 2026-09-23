// Navigation graph for bots, generated from the collision world on a 1 m grid.
// Supports multiple floor levels, step/jump/drop edges and edges blocked by breakable panels.

import { PLAYER } from '../shared/constants.js';

const RES = 1.0;
const HW = 0.36;
const BODY_H = 1.75;
const STEP = PLAYER.stepHeight;
const JUMP_UP = 1.05;
const MAX_DROP = 4.5;

const cache = new Map();

export function getNav(mapId, world) {
  if (!cache.has(mapId)) cache.set(mapId, new NavGraph(world));
  return cache.get(mapId);
}

export class NavGraph {
  constructor(world) {
    const t0 = Date.now();
    this.minX = world.minX + 4;
    this.minZ = world.minZ + 4;
    const b = world.boxes.find((x) => x.kind === 'ground');
    const maxX = b ? b.max[0] - 2 : this.minX + 100;
    const maxZ = b ? b.max[2] - 2 : this.minZ + 100;
    this.cols = Math.floor((maxX - this.minX) / RES);
    this.rows = Math.floor((maxZ - this.minZ) / RES);
    this.columns = new Array(this.cols * this.rows);
    this.nodes = [];
    const tmp = [];
    // Destructible boxes are ignored while sampling so we can record them as edge blockers.
    const solidOverlap = (minx, miny, minz, maxx, maxy, maxz, blockers) => {
      const res = world.query(minx, miny, minz, maxx, maxy, maxz, tmp);
      let hard = false;
      for (const bx of res) {
        if (bx.destructible) { if (blockers) blockers.add(bx.id); }
        else { hard = true; break; }
      }
      return hard;
    };
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const x = this.minX + (i + 0.5) * RES;
        const z = this.minZ + (j + 0.5) * RES;
        const col = [];
        const boxes = world.query(x - 0.01, -2, z - 0.01, x + 0.01, 50, z + 0.01, tmp).filter((bx) => !bx.destructible);
        const tops = new Set();
        for (const bx of boxes) tops.add(Math.round(bx.max[1] * 1000) / 1000);
        const sorted = [...tops].sort((a, b2) => a - b2);
        for (const h of sorted) {
          if (h > 12) continue;
          if (solidOverlap(x - HW, h + 0.05, z - HW, x + HW, h + BODY_H, z + HW, null)) continue;
          // must have floor under most of the footprint (avoid nodes on thin ledges)
          const node = { id: this.nodes.length, x, y: h, z, i, j, edges: [] };
          this.nodes.push(node);
          col.push(node.id);
        }
        this.columns[j * this.cols + i] = col;
      }
    }
    // edges
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const n of this.nodes) {
      for (const [di, dj] of dirs) {
        const ni = n.i + di, nj = n.j + dj;
        if (ni < 0 || nj < 0 || ni >= this.cols || nj >= this.rows) continue;
        for (const mid of this.columns[nj * this.cols + ni]) {
          const m = this.nodes[mid];
          const dy = m.y - n.y;
          let type = null;
          if (Math.abs(dy) <= STEP) type = 'walk';
          else if (dy > STEP && dy <= JUMP_UP) type = 'jump';
          else if (dy < -STEP && dy >= -MAX_DROP) type = 'drop';
          if (!type) continue;
          const blockers = new Set();
          const top = Math.max(n.y, m.y);
          const check = (px, pz) => solidOverlap(px - HW, top + 0.05, pz - HW, px + HW, top + BODY_H, pz + HW, blockers);
          const mx = (n.x + m.x) / 2, mz = (n.z + m.z) / 2;
          if (check(mx, mz)) continue;
          if (di && dj) {
            if (check(n.x + di * RES, n.z) || check(n.x, n.z + dj * RES)) continue;
          }
          if (type === 'drop' || type === 'jump') {
            // need clear space above the lower node too
            const low = type === 'drop' ? m : n;
            if (solidOverlap(low.x - HW, low.y + 0.05, low.z - HW, low.x + HW, top + BODY_H, low.z + HW, blockers)) continue;
          }
          const dist = Math.hypot(m.x - n.x, m.z - n.z, dy);
          const cost = dist * (type === 'jump' ? 3 : type === 'drop' ? 1.5 : 1);
          n.edges.push({ to: m.id, cost, type, blockers: blockers.size ? [...blockers] : null });
        }
      }
    }
    // prefer the middle of corridors: nodes next to walls/edges cost a bit more to walk through
    for (const n of this.nodes) {
      const walk = n.edges.filter((e) => e.type === 'walk').length;
      n.pen = Math.max(0, 8 - walk) * 0.1;
    }
    for (const n of this.nodes) for (const e of n.edges) e.cost += this.nodes[e.to].pen;
    this.gScore = new Float64Array(this.nodes.length);
    this.from = new Int32Array(this.nodes.length);
    this.stampArr = new Uint32Array(this.nodes.length);
    this.closedArr = new Uint32Array(this.nodes.length);
    this.stamp = 0;
    this.buildMs = Date.now() - t0;
  }

  columnAt(x, z) {
    const i = Math.floor((x - this.minX) / RES), j = Math.floor((z - this.minZ) / RES);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return null;
    return this.columns[j * this.cols + i];
  }

  nearest(x, y, z) {
    const i0 = Math.floor((x - this.minX) / RES), j0 = Math.floor((z - this.minZ) / RES);
    let best = null, bestD = Infinity;
    for (let r = 0; r <= 4; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = i0 + di, j = j0 + dj;
          if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) continue;
          for (const id of this.columns[j * this.cols + i]) {
            const n = this.nodes[id];
            if (n.y > y + 0.8) continue;
            const d = Math.hypot(n.x - x, (n.y - y) * 2, n.z - z);
            if (d < bestD) { bestD = d; best = n; }
          }
        }
      }
      if (best) return best;
    }
    return best;
  }

  // Flood fill from the given positions so random goals are always reachable.
  markReachable(points) {
    if (this._reachMarked) return;
    this._reachMarked = true;
    const queue = [];
    for (const p of points) {
      const n = this.nearest(p[0], p[1] + 0.1, p[2]);
      if (n && !n.reach) { n.reach = true; queue.push(n); }
    }
    while (queue.length) {
      const n = queue.pop();
      for (const e of n.edges) {
        const m = this.nodes[e.to];
        if (!m.reach) { m.reach = true; queue.push(m); }
      }
    }
    this.reachable = this.nodes.filter((n) => n.reach);
  }

  randomNode(rand = Math.random, filter = null) {
    const pool = this.reachable && this.reachable.length ? this.reachable : this.nodes;
    for (let k = 0; k < 200; k++) {
      const n = pool[Math.floor(rand() * pool.length)];
      if (n.edges.length >= 5 && (!filter || filter(n))) return n;
    }
    return pool[Math.floor(rand() * pool.length)];
  }

  nodesInZone(zone) {
    return (this.reachable || this.nodes).filter((n) => n.x >= zone.min[0] && n.x <= zone.max[0] && n.z >= zone.min[2] && n.z <= zone.max[2] && n.y >= zone.min[1] - 0.2 && n.y <= zone.max[1] && n.edges.length >= 5);
  }

  // A* search. Returns array of {x,y,z,type} waypoints or null.
  findPath(world, from, to, maxIter = 30000) {
    const start = typeof from === 'object' && 'id' in from ? from : this.nearest(from.x, from.y, from.z);
    const goal = typeof to === 'object' && 'id' in to ? to : this.nearest(to.x, to.y, to.z);
    if (!start || !goal) return null;
    if (start === goal) return [{ x: goal.x, y: goal.y, z: goal.z, type: 'walk' }];
    this.stamp++;
    const st = this.stamp;
    const g = this.gScore, from2 = this.from, stamps = this.stampArr, closed = this.closedArr;
    const heap = new MinHeap();
    stamps[start.id] = st; g[start.id] = 0; from2[start.id] = -1;
    heap.push(start.id, this._h(start, goal));
    let iter = 0;
    while (heap.size && iter++ < maxIter) {
      const cur = heap.pop();
      if (cur === goal.id) break;
      if (closed[cur] === st) continue;
      closed[cur] = st;
      const n = this.nodes[cur];
      for (const e of n.edges) {
        if (e.blockers && e.blockers.some((id) => world.byId.get(id)?.active)) continue;
        const ng = g[cur] + e.cost;
        if (stamps[e.to] !== st || ng < g[e.to]) {
          stamps[e.to] = st;
          g[e.to] = ng;
          from2[e.to] = cur;
          heap.push(e.to, ng + this._h(this.nodes[e.to], goal));
        }
      }
    }
    if (stamps[goal.id] !== st) return null;
    const path = [];
    let c = goal.id;
    let guard = 0;
    while (c !== -1 && guard++ < 100000) {
      const nd = this.nodes[c];
      const prev = from2[c];
      let type = 'walk';
      if (prev !== -1) {
        const e = this.nodes[prev].edges.find((ed) => ed.to === c);
        if (e) type = e.type;
      }
      path.push({ x: nd.x, y: nd.y, z: nd.z, type });
      c = prev;
    }
    path.reverse();
    return this.smooth(world, path);
  }

  _h(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

  // Remove intermediate waypoints where a straight walk is clear.
  smooth(world, path) {
    if (path.length <= 2) return path;
    const out = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = Math.min(path.length - 1, i + 10);
      for (; j > i + 1; j--) {
        if (this._straight(world, path, i, j)) break;
      }
      out.push(path[j]);
      i = j;
    }
    return out;
  }

  _straight(world, path, i, j) {
    for (let k = i + 1; k <= j; k++) if (path[k].type !== 'walk') return false;
    const a = path[i], b = path[j];
    if (Math.abs(a.y - b.y) > 0.3) return false;
    for (let k = i; k <= j; k++) if (Math.abs(path[k].y - a.y) > 0.3) return false;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(d / 0.4);
    const tmp = [];
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      if (world.query(x - HW - 0.05, a.y + 0.1, z - HW - 0.05, x + HW + 0.05, a.y + BODY_H, z + HW + 0.05, tmp).length) return false;
      const col = this.columnAt(x, z);
      if (!col || !col.some((id) => Math.abs(this.nodes[id].y - a.y) < 0.3)) return false;
    }
    return true;
  }
}

class MinHeap {
  constructor() { this.ids = []; this.keys = []; }
  get size() { return this.ids.length; }
  push(id, key) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop() {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop(), lastKey = keys.pop();
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      while (true) {
        let l = 2 * i + 1, r = l + 1, m = i;
        let mk = lastKey;
        if (l < n && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < n && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        ids[i] = ids[m]; keys[i] = keys[m];
        i = m;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}
