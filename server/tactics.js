// Tactical map analysis for bots, computed lazily from the nav graph and collision world and cached per map:
// the routes into each bomb site, good holding spots (sight lines on the entrances + cover), staging points
// outside the site, cover near a threat, and where to look while walking a path.

const EYE = 1.6;
const HEAD = 1.45;
const cache = new Map();

export function getTactics(match) {
  const key = match.map.id;
  if (!cache.has(key)) cache.set(key, new Tactics(match.map, match.world, match.nav));
  const t = cache.get(key);
  t.world = match.world; // destructible state belongs to the running match
  return t;
}

// Tiny deterministic PRNG so the analysis is the same every time a map loads.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Tactics {
  constructor(map, world, nav) {
    this.map = map;
    this.world = world;
    this.nav = nav;
    this.sites = {};
  }

  los(a, b, ay = EYE, by = HEAD) {
    return this.world.lineOfSight(a.x, a.y + ay, a.z, b.x, b.y + by, b.z);
  }

  zoneCenter(zone) {
    return { x: (zone.min[0] + zone.max[0]) / 2, y: zone.floor || 0, z: (zone.min[2] + zone.max[2]) / 2 };
  }

  // Number of 8 directions blocked within 1.1 m at chest height: walls/crates to hide behind.
  cover(n) {
    let c = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (this.world.raycast(n.x, n.y + 1.0, n.z, Math.cos(a), 0, Math.sin(a), 1.1)) c++;
    }
    return c;
  }

  site(name) {
    if (this.sites[name]) return this.sites[name];
    const zone = this.map.zones[name];
    if (!zone) return null;
    const nav = this.nav;
    const C = this.zoneCenter(zone);
    const centerNode = nav.nearest(C.x, C.y + 0.2, C.z);
    const rand = rng(name.charCodeAt(0) * 977 + this.map.rows * 31 + this.map.cols);
    const pool = nav.reachable || nav.nodes;
    const R = 11;
    // sample routes into the site from all over the map
    const hits = [];
    const starts = [];
    for (let k = 0; k < 400 && starts.length < 22; k++) {
      const n = pool[Math.floor(rand() * pool.length)];
      if (Math.hypot(n.x - C.x, n.z - C.z) > 28 && n.edges.length >= 5) starts.push(n);
    }
    for (const team of [1, 2]) for (const sp of (this.map.spawns[team] || []).slice(0, 3)) starts.push(nav.nearest(sp[0], sp[1] + 0.1, sp[2]));
    for (const s of starts) {
      if (!s || !centerNode) continue;
      const path = nav.findPath(this.world, s, centerNode, 20000);
      if (!path || path.length < 2) continue;
      const dense = densify(path, 1);
      // first point inside the radius = where the route enters the site
      let entry = -1;
      for (let i = 0; i < dense.length; i++) {
        const p = dense[i];
        if (Math.hypot(p.x - C.x, p.z - C.z) < R && Math.abs(p.y - C.y) < 1.5) { entry = i; break; }
      }
      if (entry < 1) continue;
      const e = dense[entry];
      const st = dense[Math.max(0, entry - 7)];
      hits.push({ x: e.x, y: e.y, z: e.z, stage: { x: st.x, y: st.y, z: st.z }, route: dense.slice(Math.max(0, entry - 22), entry + 1) });
    }
    // cluster entrances
    const entrances = [];
    for (const h of hits) {
      let c = entrances.find((q) => Math.hypot(q.x - h.x, q.z - h.z) < 5 && Math.abs(q.y - h.y) < 1.5);
      if (!c) { c = { x: h.x, y: h.y, z: h.z, stage: h.stage, route: h.route, w: 0 }; entrances.push(c); }
      c.w++;
    }
    entrances.sort((a, b) => b.w - a.w);
    const ents = entrances.slice(0, 4);
    const total = ents.reduce((s, e) => s + e.w, 0) || 1;
    for (const e of ents) e.w /= total;
    // snap stage points to nav nodes
    for (const e of ents) {
      const n = nav.nearest(e.stage.x, e.stage.y + 0.2, e.stage.z);
      if (n) e.stage = { x: n.x, y: n.y, z: n.z };
    }

    // holding spots
    const cands = pool.filter((n) => Math.hypot(n.x - C.x, n.z - C.z) < 13 && Math.abs(n.y - C.y) < 0.6 && n.edges.length >= 3);
    const scored = [];
    for (const n of cands) {
      let score = 0, seen = 0;
      const looks = [];
      for (const e of ents) {
        const d = Math.hypot(e.x - n.x, e.z - n.z);
        if (d < 4 || !this.los(n, e)) continue;
        seen++;
        const ds = d < 7 ? 0.6 : d < 20 ? 1 : 0.7;
        score += e.w * ds * 3;
        looks.push({ x: e.x, y: e.y + HEAD, z: e.z, w: e.w });
      }
      if (!seen) continue;
      const cv = this.cover(n);
      score += cv >= 2 && cv <= 5 ? 0.6 + cv * 0.1 : cv > 5 ? 0.2 : 0;
      score -= Math.max(0, seen - 2) * 0.7;
      score += rand() * 0.15;
      looks.sort((a, b) => b.w - a.w);
      scored.push({ x: n.x, y: n.y, z: n.z, score, looks, cover: cv });
    }
    scored.sort((a, b) => b.score - a.score);
    const holds = [];
    for (const s of scored) {
      if (holds.some((h) => Math.hypot(h.x - s.x, h.z - s.z) < 3)) continue;
      holds.push(s);
      if (holds.length >= 10) break;
    }
    // staging point per entrance: walk back along the route until nothing in the site can see us
    const watchers = [C, ...holds.slice(0, 5)];
    for (const e of ents) {
      const route = e.route || [];
      for (let i = route.length - 4; i >= 0; i--) {
        const q = route[i];
        if (Math.hypot(q.x - e.x, q.z - e.z) < 5) continue;
        if (watchers.some((w) => this.world.lineOfSight(w.x, w.y + EYE, w.z, q.x, q.y + 1.5, q.z))) continue;
        const n = nav.nearest(q.x, q.y + 0.2, q.z);
        if (n) { e.stage = { x: n.x, y: n.y, z: n.z }; e.hidden = true; }
        break;
      }
      delete e.route;
    }
    // spots inside the site to clear / plant from
    const inside = pool.filter((n) => n.x >= zone.min[0] && n.x <= zone.max[0] && n.z >= zone.min[2] && n.z <= zone.max[2] && n.y >= zone.min[1] - 0.2 && n.y <= zone.max[1] && n.edges.length >= 6);
    this.sites[name] = { name, zone, center: C, entrances: ents, holds, inside };
    return this.sites[name];
  }

  // Positions around the planted bomb that can watch it from cover.
  postPlantSpots(bomb, count = 6) {
    const pool = this.nav.reachable || this.nav.nodes;
    const B = { x: bomb.x, y: bomb.y, z: bomb.z };
    const out = [];
    for (const n of pool) {
      const d = Math.hypot(n.x - B.x, n.z - B.z);
      if (d < 4 || d > 15 || Math.abs(n.y - B.y) > 2.5) continue;
      if (!this.los(n, B, EYE, 0.3)) continue;
      const cv = this.cover(n);
      if (cv < 2) continue;
      out.push({ x: n.x, y: n.y, z: n.z, score: cv * 0.3 + (d > 7 ? 1 : 0.4) + Math.random() * 0.3 });
    }
    out.sort((a, b) => b.score - a.score);
    const picked = [];
    for (const s of out) {
      if (picked.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 3)) continue;
      picked.push(s);
      if (picked.length >= count) break;
    }
    return picked;
  }

  // Nearest node (by walking) within maxDist that none of the threats can see.
  coverFrom(from, threats, maxDist = 9) {
    const nav = this.nav;
    const start = nav.nearest(from.x, from.y + 0.2, from.z);
    if (!start || !threats.length) return null;
    const seen = new Set([start.id]);
    let frontier = [{ n: start, d: 0 }];
    let checked = 0;
    while (frontier.length && checked < 220) {
      const next = [];
      for (const { n, d } of frontier) {
        if (d > 0.9) {
          checked++;
          if (threats.every((t) => !this.world.lineOfSight(t.x, t.y + EYE, t.z, n.x, n.y + 1.5, n.z))) return n;
        }
        for (const e of n.edges) {
          if (seen.has(e.to) || e.type !== 'walk') continue;
          seen.add(e.to);
          const m = nav.nodes[e.to];
          const nd = d + e.cost;
          if (nd <= maxDist) next.push({ n: m, d: nd });
        }
      }
      frontier = next;
    }
    return null;
  }

  // Where to look while walking: the farthest point of the upcoming path we can still see (head height).
  lookAhead(eye, path, idx, maxDist = 18) {
    if (!path || idx >= path.length) return null;
    let best = null, acc = 0;
    let prev = { x: eye.x, z: eye.z };
    for (let i = idx; i < path.length && acc < maxDist; i++) {
      const p = path[i];
      acc += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
      if (acc < 2.5) continue;
      if (this.world.lineOfSight(eye.x, eye.y, eye.z, p.x, p.y + HEAD, p.z)) best = { x: p.x, y: p.y + HEAD, z: p.z };
      else if (best) break;
    }
    return best;
  }
}

// Split a smoothed path back into ~step metre pieces (for distance measurements along it).
export function densify(path, step = 1) {
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, type: b.type });
    }
  }
  return out;
}
