// Procedural weapon models, shared by the first-person view model, third-person players and world drops.
//
// Every gun is built at real-world scale from side-profile extrusions (receivers, frames, stocks), lofted
// cross-sections (grips, handguards, stocks, slides), lathed parts (barrels, muzzle devices, scopes),
// prisms (rails, handguards) and small hardware (pins, screws, levers, engraved markings), then given a
// physically based finish: anodised and parkerised metal, blued steel, polymer, varnished wood and
// rubber, with handling wear rubbed into the edges.
//
// Convention: barrel points to -Z, origin at the firing hand's grip, +Y up, +X is the gun's right side
// (ejection port). Metres. The first-person camera mostly sees the left side and the top.

import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { gunMaps, projectUV } from './gunmats.js';
import { Builder, bakedMaterial, SURF } from './surface.js';

// ------------------------------------------------------------------ materials

const matCache = new Map();
function mat(key, params) {
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial(params));
  return matCache.get(key);
}
// Surface detail maps; roughness maps multiply the material roughness, so divide by their average.
const SURF_AVG = { metal: 0.42, polymer: 0.66, wood: 0.52, fabric: 0.8, rubber: 1 };
const NORMAL_K = { metal: 0.35, polymer: 0.4, wood: 0.45, fabric: 0.7, rubber: 0.7 };

// Handling wear, computed per pixel from the surface curvature (screen-space derivatives of the normal):
// the finish is rubbed off convex edges and chamfers (bare steel on painted / anodised metal, polished
// highlights on polymer, pale worn varnish on wood) and grime collects in concave corners. It fades out
// once a chamfer is smaller than a pixel (third person, far away) so it never shimmers.
const WEAR_CODE = {
  metal: `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.5, 0.49), wear);
    metalnessFactor = mix(metalnessFactor, 1.0, wear); roughnessFactor = mix(roughnessFactor, 0.26, wear);`,
  polymer: `diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.5 + 0.02, wear * 0.6);
    roughnessFactor = mix(roughnessFactor, 0.36, wear);`,
  wood: `diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.4 + vec3(0.035, 0.022, 0.01), wear * 0.7);
    roughnessFactor = mix(roughnessFactor, 0.6, wear);`,
  rubber: `diffuseColor.rgb *= 1.0 + wear * 0.3;`,
};
function addWear(m, kind, amount) {
  const code = WEAR_CODE[kind];
  if (!code) return;
  m.onBeforeCompile = (s) => {
    s.uniforms.uWear = { value: amount };
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uWear;
float wearHash(vec2 i) { return fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453); }
float wearNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wearHash(i), wearHash(i + vec2(1.0, 0.0)), f.x), mix(wearHash(i + vec2(0.0, 1.0)), wearHash(i + vec2(1.0)), f.x), f.y);
}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
{
  vec3 wn = normalize(vNormal);
  vec3 wp = -vViewPosition;
  vec3 dpx = dFdx(wp), dpy = dFdy(wp);
  float kx = dot(dFdx(wn), dpx) / max(dot(dpx, dpx), 1e-14);
  float ky = dot(dFdy(wn), dpy) / max(dot(dpy, dpy), 1e-14);
  float curv = max(kx, ky);                        // 1/m, convex > 0
  float foot = length(dpx) + length(dpy);          // pixel footprint in metres
  float near = 1.0 - smoothstep(0.0016, 0.005, foot);
  float n = wearNoise(vNormalMapUv * 1.7) * 0.6 + wearNoise(vNormalMapUv * 6.3) * 0.4;
  float wear = smoothstep(110.0, 320.0, curv) * smoothstep(0.5, 0.72, n + uWear * 0.12) * uWear * near;
  float cav = smoothstep(30.0, 160.0, -min(kx, ky)) * near;
  ${code}
  diffuseColor.rgb *= 1.0 - cav * 0.4;
  roughnessFactor = min(1.0, roughnessFactor + cav * 0.15);
}`);
  };
  m.customProgramCacheKey = () => 'wear-' + kind;
}

function detailed(key, params, kind) {
  if (matCache.has(key)) return matCache.get(key);
  const maps = gunMaps()[kind];
  const { wear, normal, ...p } = params;
  // varnished wood gets a clear coat: the glossy lacquer layer over the grain
  const m = kind === 'wood'
    ? new THREE.MeshPhysicalMaterial({ ...p, ...maps, clearcoat: 0.5, clearcoatRoughness: 0.34 })
    : new THREE.MeshStandardMaterial({ ...p, ...maps });
  m.userData.surf = kind;
  if (maps.roughnessMap) m.roughness = Math.min(1, p.roughness / SURF_AVG[kind]);
  const nk = normal ?? NORMAL_K[kind];
  m.normalScale.set(nk, nk);
  addWear(m, kind, wear ?? (kind === 'metal' ? 0.85 : 0.6));
  matCache.set(key, m);
  return m;
}

export const M = {
  // black finishes are still dark grey in real life (and the metal ones reflect): physically plausible albedos
  anod: () => detailed('anod', { color: 0x44474d, metalness: 0.35, roughness: 0.42, wear: 0.9 }, 'metal'),
  park: () => detailed('park', { color: 0x484a4d, metalness: 0.35, roughness: 0.56, wear: 0.75 }, 'metal'),
  blued: () => detailed('blued', { color: 0x464c55, metalness: 0.5, roughness: 0.3, wear: 0.85 }, 'metal'),
  nitride: () => detailed('nitride', { color: 0x44484e, metalness: 0.4, roughness: 0.38, wear: 0.8 }, 'metal'),
  gunmetal: () => detailed('gunmetal', { color: 0x4a4e55, metalness: 0.6, roughness: 0.36 }, 'metal'),
  steel: () => detailed('steel', { color: 0x8d9299, metalness: 0.9, roughness: 0.3, wear: 0.35 }, 'metal'),
  bright: () => detailed('bright', { color: 0xb4b8bd, metalness: 1, roughness: 0.22, wear: 0.2 }, 'metal'),
  blade: () => detailed('blade', { color: 0xc8ccd2, metalness: 1, roughness: 0.2, wear: 0 }, 'metal'),
  polymer: () => detailed('polymer', { color: 0x303236, metalness: 0.04, roughness: 0.62 }, 'polymer'),
  stipple: () => detailed('stipple', { color: 0x2e3033, metalness: 0.03, roughness: 0.78, normal: 0.9, wear: 0.3 }, 'polymer'),
  od: () => detailed('od', { color: 0x5a6048, metalness: 0.03, roughness: 0.66 }, 'polymer'),
  fde: () => detailed('fde', { color: 0x8f7a5a, metalness: 0.03, roughness: 0.66 }, 'polymer'),
  wood: () => detailed('wood', { color: 0x70421f, metalness: 0, roughness: 0.5, wear: 0.75 }, 'wood'),
  brass: () => mat('brass', { color: 0xc9a14a, metalness: 1, roughness: 0.3 }),
  hole: () => mat('hole', { color: 0x0b0b0c, metalness: 0.2, roughness: 0.9 }),
  lens: () => mat('lens', { color: 0x16222e, metalness: 1, roughness: 0.04, emissive: 0x0a1624, emissiveIntensity: 0.6 }),
  glass: () => mat('glass', { color: 0x223344, metalness: 0.9, roughness: 0.05, emissive: 0x0a1a2a }),
  red: () => mat('reddot', { color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 }),
  dot: () => mat('sightdot', { color: 0xeeeede, emissive: 0xbfeecc, emissiveIntensity: 0.35, roughness: 0.4 }),
  rubber: () => detailed('rubber', { color: 0x252525, metalness: 0, roughness: 0.85, wear: 0.3 }, 'rubber'),
  color: (hex, metal = 0.35, rough = 0.5) => {
    // Dark gun finishes are paint, parkerizing or anodizing: a dark-grey coat with ordinary reflections,
    // not a near-black bare metal (which renders as a featureless silhouette).
    const c = new THREE.Color(hex);
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    let m = metal;
    if (lum < 0.3) {
      c.lerp(new THREE.Color(metal >= 0.4 ? 0x5a5e64 : 0x46494d), metal >= 0.4 ? 0.3 : 0.2);
      if (metal >= 0.4) m = Math.min(metal, 0.32);
    }
    const h = c.getHex();
    return detailed(`c${h}_${m}_${rough}`, { color: h, metalness: m, roughness: rough }, metal >= 0.4 ? 'metal' : 'polymer');
  },
};

// Engraved / printed markings: light text on a transparent plane lying on a flat side of the gun.
const markCache = new Map();
function markMat(lines, aspect, color) {
  const key = lines.join('|') + aspect.toFixed(2) + color;
  if (markCache.has(key)) return markCache.get(key);
  const H = 64 * lines.length, Wd = Math.round(H * aspect);
  const c = document.createElement('canvas');
  c.width = Math.min(1024, Wd); c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.textBaseline = 'middle';
  lines.forEach((t, i) => {
    let fs = 46;
    g.font = `bold ${fs}px "DejaVu Sans Mono", monospace`;
    while (g.measureText(t).width > c.width * 0.96 && fs > 10) { fs -= 2; g.font = `bold ${fs}px "DejaVu Sans Mono", monospace`; }
    g.fillText(t, 2, 32 + i * 64);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.5, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.userData.decal = true;
  markCache.set(key, m);
  return m;
}
function marking(lines, w, h, x, y, z, side = -1, color = 'rgba(205,205,196,0.8)') {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), markMat(lines, w / h, color));
  m.position.set(x, y, z);
  m.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
  return m;
}

// ------------------------------------------------------------------ geometry helpers

// chamfered box (edges catch highlights) with metre-scaled UVs for the detail maps
function box(w, h, d, material, x = 0, y = 0, z = 0, r) {
  const mn = Math.min(w, h, d);
  const rad = r ?? Math.min(0.0035, mn * 0.2);
  const geo = mn >= 0.005 && rad > 0.0002 ? new RoundedBoxGeometry(w, h, d, 1, Math.min(rad, mn * 0.45)) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(projectUV(geo), material);
  m.position.set(x, y, z);
  return m;
}
function cyl(r, len, material, x = 0, y = 0, z = 0, axis = 'z', seg = 16, r2 = r) {
  const m = new THREE.Mesh(projectUV(new THREE.CylinderGeometry(r2, r, len, seg)), material);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  else if (axis === 'x') m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}
function place(m, o) {
  m.position.set(o.x || 0, o.y || 0, o.z || 0);
  if (o.rx || o.ry || o.rz) m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  return m;
}
function shapeOf(pts, S = new THREE.Shape()) {
  pts.forEach((q, i) => {
    if (i === 0) S.moveTo(q[0], q[1]);
    else if (q.length === 4) S.quadraticCurveTo(q[0], q[1], q[2], q[3]);
    else S.lineTo(q[0], q[1]);
  });
  return S;
}

// Side-profile extrusion: pts are [z, y] points (or [cz, cy, z, y] quadratic curves) in the gun's side
// view, extruded across X with rounded edges. holes: same format, cut through (trigger guards, thumbholes).
function ext(pts, width, material, o = {}) {
  const sh = shapeOf(pts);
  for (const h of o.holes || []) sh.holes.push(shapeOf(h, new THREE.Path()));
  const bev = Math.min(o.bevel ?? Math.min(0.0025, width * 0.2), width * 0.45);
  const depth = Math.max(0.0004, width - bev * 2);
  const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev * 0.8, bevelOffset: -bev * 0.8, bevelSegments: o.seg ?? 2, curveSegments: o.curve ?? 8 });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2);
  return place(new THREE.Mesh(projectUV(geo), material), o);
}

// Cross-section prism: pts are [x, y] (or quadratic) points, extruded along Z over len, centred at o.z.
function prismGeo(pts, len, bev = 0.0012, curve = 6) {
  const b = Math.min(bev, len * 0.3);
  const depth = Math.max(0.0004, len - b * 2);
  const geo = new THREE.ExtrudeGeometry(shapeOf(pts), { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.8, bevelOffset: -b * 0.8, bevelSegments: 2, curveSegments: curve });
  geo.translate(0, 0, -depth / 2);
  return projectUV(geo);
}
function prism(pts, len, material, o = {}) {
  return place(new THREE.Mesh(prismGeo(pts, len, o.bevel, o.curve), material), o);
}

// Lofted part: rounded (superellipse) cross-sections swept along Z, for stocks, grips, slides and
// handguards with real contours instead of flat slabs. secs: [[z, yTop, yBottom, width, xOffset?], ...];
// p: squareness (2 = ellipse, 4+ = rounded rectangle). The end caps get their own vertices so the ends
// stay crisp.
function loft(secs, material, p = 2.6, o = {}) {
  const S = secs[0][0] > secs[secs.length - 1][0] ? [...secs].reverse() : secs;
  const seg = o.seg ?? 20;
  const pos = [], idx = [];
  const ring = ([z, yt, yb, w, xo = 0]) => {
    const cy = (yt + yb) / 2, hh = (yt - yb) / 2, hw = w / 2;
    const out = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2 + (o.rot ?? 0), c = Math.cos(a), sn = Math.sin(a);
      out.push([xo + Math.sign(c) * Math.abs(c) ** (2 / p) * hw, cy + Math.sign(sn) * Math.abs(sn) ** (2 / p) * hh, z]);
    }
    return out;
  };
  const rings = S.map(ring);
  for (const r of rings) for (const v of r) pos.push(...v);
  const n = S.length;
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < seg; i++) {
      const a = r * seg + i, b = r * seg + (i + 1) % seg, c = (r + 1) * seg + (i + 1) % seg, d = (r + 1) * seg + i;
      idx.push(a, b, c, a, c, d);
    }
  }
  const sideGeo = new THREE.BufferGeometry();
  sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sideGeo.setIndex(idx);
  sideGeo.computeVertexNormals();
  // caps: separate flat fans
  const cp = [], cn = [], ci = [];
  for (const [r, first] of [[0, true], [n - 1, false]]) {
    const base = cp.length / 3;
    const [z, yt, yb, , xo = 0] = S[r];
    cp.push(xo, (yt + yb) / 2, z);
    for (const v of rings[r]) cp.push(...v);
    for (let i = 0; i <= seg; i++) cn.push(0, 0, first ? -1 : 1);
    for (let i = 0; i < seg; i++) {
      const a = base + 1 + i, b = base + 1 + (i + 1) % seg;
      if (first) ci.push(base, b, a); else ci.push(base, a, b);
    }
  }
  // merge side + caps
  const sp = sideGeo.attributes.position.array, sn = sideGeo.attributes.normal.array;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...sp, ...cp], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([...sn, ...cn], 3));
  const off = sp.length / 3;
  geo.setIndex([...idx, ...ci.map((i) => i + off)]);
  return place(new THREE.Mesh(projectUV(geo), material), o);
}

// Lathed part: pts are [radius, z] along the axis (Z by default, o.axis 'y' / 'x'), for barrels,
// muzzle devices, buffer tubes, scope bodies and knobs. o.slant: shear the front face (slant brakes).
function lathe(pts, material, o = {}) {
  const geo = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-5), z)), o.seg ?? 20);
  if (o.axis !== 'y') geo.rotateX(Math.PI / 2);
  if (o.axis === 'x') geo.rotateY(Math.PI / 2);
  if (o.slant) {
    const P = geo.attributes.position;
    let zmin = Infinity;
    for (let i = 0; i < P.count; i++) zmin = Math.min(zmin, P.getZ(i));
    for (let i = 0; i < P.count; i++) if (P.getZ(i) < zmin + 1e-5) P.setZ(i, P.getZ(i) + P.getY(i) * o.slant);
    geo.computeVertexNormals();
  }
  return place(new THREE.Mesh(projectUV(geo), material), o);
}

// MIL-STD-1913 rail along Z: a continuous dovetail with cross-slotted lugs every 10 mm.
// o.y is the top of the rail, o.rz rolls it onto a side (-PI/2 = right, PI/2 = left).
let railGeos = null;
function rail(len, material, o = {}) {
  if (!railGeos) {
    railGeos = {
      tooth: prismGeo([[-0.0106, -0.0031], [0.0106, -0.0031], [0.0106, -0.0026], [0.008, 0], [-0.008, 0], [-0.0106, -0.0026]], 0.0052, 0.0004),
    };
  }
  const g = new THREE.Group();
  g.add(prism([[-0.0079, -0.0095], [0.0079, -0.0095], [0.0079, -0.006], [0.0106, -0.0038], [0.0106, -0.003], [-0.0106, -0.003], [-0.0106, -0.0038], [-0.0079, -0.006]], len, material, { bevel: 0.0004 }));
  const n = Math.max(1, Math.floor((len - 0.003) / 0.01));
  const z0 = -((n - 1) * 0.01) / 2;
  for (let i = 0; i < n; i++) {
    const t = new THREE.Mesh(railGeos.tooth, material);
    t.position.z = z0 + i * 0.01;
    g.add(t);
  }
  return place(g, o);
}

// cross pin / rivet through the receiver, visible on both sides
function pin(r, width, material, y, z, x = 0) { return cyl(r, width, material, x, y, z, 'x', 10); }
// screw head on a side (side -1 left, 1 right) with its slot
function screw(r, material, x, y, z, side = -1) {
  const g = new THREE.Group();
  g.add(cyl(r, 0.0014, material, x, y, z, 'x', 12));
  g.add(box(0.0006, r * 1.6, r * 0.35, M.hole(), x + side * 0.0007, y, z));
  return g;
}
function named(name) { const g = new THREE.Group(); g.name = name; return g; }

// Merge unnamed sibling meshes that share a material into one mesh (fewer draw calls).
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
export function mergeStatic(group) {
  for (const child of [...group.children]) if (!child.isMesh && child.children.length) mergeStatic(child);
  const buckets = new Map();
  for (const c of group.children) {
    if (!c.isMesh || c.name || c.children.length || !c.geometry.attributes.normal) continue;
    const key = c.material.uuid;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  }
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const pos = [], nor = [], uv = [], idx = [];
    for (const m of meshes) {
      m.updateMatrix();
      const nm = new THREE.Matrix3().getNormalMatrix(m.matrix);
      const g = m.geometry;
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      const base = pos.length / 3;
      for (let i = 0; i < P.count; i++) {
        _v.fromBufferAttribute(P, i).applyMatrix4(m.matrix);
        _n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        pos.push(_v.x, _v.y, _v.z);
        nor.push(_n.x, _n.y, _n.z);
        if (U) uv.push(U.getX(i), U.getY(i)); else uv.push(0, 0);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
      else for (let i = 0; i < P.count; i++) idx.push(base + i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const merged = new THREE.Mesh(geo, meshes[0].material);
    merged.castShadow = meshes[0].castShadow;
    merged.receiveShadow = meshes[0].receiveShadow;
    for (const m of meshes) group.remove(m);
    group.add(merged);
  }
  return group;
}

function finish(g, info) {
  mergeStatic(g);
  g.userData = { ...info };
  g.traverse((o) => { if (o.isMesh) { o.castShadow = !o.material.transparent; o.receiveShadow = true; } });
  return g;
}

// ------------------------------------------------------------------ shared sub-assemblies

// Holographic sight (EXPS style): base with the transverse battery cap, a hooded window with the
// reticle ring and dot. Centre of the window at y + 0.029 (returned).
function holoSight(g, y, z, body) {
  const hole = M.hole();
  g.add(box(0.032, 0.013, 0.094, body, 0, y + 0.0065, z));
  g.add(box(0.03, 0.006, 0.07, body, 0, y - 0.002, z + 0.004)); // mount
  g.add(cyl(0.0085, 0.036, body, 0, y + 0.006, z - 0.05, 'x', 16)); // battery cap
  g.add(cyl(0.0065, 0.0395, M.rubber(), 0, y + 0.006, z - 0.05, 'x', 16));
  // hood: two side walls and a rounded top
  for (const sx of [-1, 1]) g.add(box(0.0032, 0.034, 0.058, body, sx * 0.0164, y + 0.03, z - 0.012, 0.0012));
  g.add(loft([[z - 0.041, y + 0.05, y + 0.044, 0.036], [z + 0.017, y + 0.05, y + 0.044, 0.036]], body, 4));
  // rear buttons and the QD lever on the left of the mount
  g.add(marking(['HWS · XPS3'], 0.03, 0.006, -0.0181, y + 0.03, z - 0.012));
  g.add(box(0.005, 0.006, 0.007, M.rubber(), -0.0165, y + 0.007, z + 0.038));
  g.add(box(0.005, 0.006, 0.007, M.rubber(), -0.0165, y + 0.007, z + 0.028));
  g.add(box(0.004, 0.007, 0.024, M.steel(), -0.0165, y - 0.001, z + 0.004));
  // window: tinted glass and the reticle (65 MOA ring and 1 MOA dot)
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.029, 0.028), mat('holo-glass', { color: 0x99bbcc, metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false }));
  glass.position.set(0, y + 0.028, z - 0.03);
  g.add(glass);
  const ret = new THREE.Group();
  ret.name = 'reddot';
  const ringM = mat('holo-ring', { color: 0xff3030, emissive: 0xff2020, emissiveIntensity: 2.2, transparent: true, opacity: 0.85, depthWrite: false });
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.0052, 0.00028, 4, 32), ringM);
  const r2 = new THREE.Mesh(new THREE.CircleGeometry(0.0006, 10), ringM);
  ret.add(r1, r2);
  ret.position.set(0, y + 0.028, z - 0.029);
  g.add(ret);
  g.add(box(0.03, 0.0012, 0.002, hole, 0, y + 0.0132, z - 0.03));
  return y + 0.028;
}

// Micro red dot (T-2 style) on its own riser: tube with objective hood, turrets and a lens with the dot.
function microDot(g, y, z, body) {
  const cy = y + 0.022;
  g.add(box(0.026, 0.008, 0.034, body, 0, y + 0.004, z));
  g.add(box(0.018, 0.01, 0.026, body, 0, y + 0.011, z));
  g.add(lathe([[0.0118, 0.022], [0.0125, 0.016], [0.0125, -0.014], [0.0135, -0.02], [0.0135, -0.03], [0.0125, -0.031]], body, { y: cy, z }));
  g.add(cyl(0.0058, 0.009, body, 0.014, cy, z - 0.002, 'x', 12));
  g.add(cyl(0.0058, 0.009, body, 0, cy + 0.014, z - 0.002, 'y', 12));
  g.add(cyl(0.0112, 0.001, mat('dot-lens', { color: 0x88aa99, metalness: 0.6, roughness: 0.05, transparent: true, opacity: 0.3, depthWrite: false }), 0, cy, z - 0.024));
  const d = new THREE.Mesh(new THREE.SphereGeometry(0.0008, 8, 6), M.red());
  d.name = 'reddot';
  d.position.set(0, cy, z - 0.02);
  g.add(d);
  return cy;
}

// Riflescope: tube, objective bell with sunshade, eyepiece with power ring and eyecup, knurled turrets,
// rings with cap screws on a rail. Returns nothing; centre line at y.
function scope(g, y, zFront, zBack, o = {}) {
  const body = M.anod(), dark = M.polymer();
  const R = o.tube ?? 0.015, obj = o.obj ?? 0.028;
  const zt0 = zFront + (o.bell ?? 0.12), zt1 = zBack - 0.07;
  g.add(cyl(R, zt1 - zt0, body, 0, y, (zt0 + zt1) / 2, 'z', 24));
  g.add(lathe([[R, zt0], [R + 0.002, zt0 - 0.016], [obj - 0.002, zFront + 0.035], [obj, zFront + 0.03], [obj, zFront + 0.004], [obj - 0.0015, zFront]], body, { y, seg: 28 }));
  g.add(lathe([[R, zt1], [R + 0.003, zt1 + 0.012], [R + 0.006, zt1 + 0.03], [R + 0.006, zBack - 0.02], [R + 0.0065, zBack - 0.018]], body, { y, seg: 24 }));
  // power ring ridges and the rubber eyecup
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rb = box(0.0024, 0.0018, 0.012, dark, Math.cos(a) * (R + 0.0068), y + Math.sin(a) * (R + 0.0068), zt1 + 0.022);
    rb.rotation.z = a;
    g.add(rb);
  }
  g.add(lathe([[R + 0.0062, zBack - 0.02], [R + 0.0075, zBack - 0.012], [R + 0.0075, zBack]], M.rubber(), { y, seg: 24 }));
  // turrets: elevation on top, windage on the right, parallax on the left
  const tz = (zt0 + zt1) / 2 - 0.005;
  g.add(cyl(R + 0.001, 0.034, body, 0, y, tz, 'z', 24)); // saddle
  g.add(box(0.03, 0.014, 0.03, body, 0, y + R * 0.6, tz, 0.004));
  const knob = (x, yy, axis) => {
    g.add(cyl(0.0125, 0.017, body, x, yy, tz, axis, 20));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const k = axis === 'y'
        ? box(0.0016, 0.012, 0.0016, dark, x + Math.cos(a) * 0.0127, yy + 0.002, tz + Math.sin(a) * 0.0127, 0)
        : box(0.012, 0.0016, 0.0016, dark, x + Math.sign(x) * 0.002, yy + Math.cos(a) * 0.0127, tz + Math.sin(a) * 0.0127, 0);
      g.add(k);
    }
  };
  knob(0, y + R + 0.012, 'y');
  knob(R + 0.012, y, 'x');
  g.add(cyl(0.011, 0.012, body, -(R + 0.008), y, tz, 'x', 20));
  // lenses
  g.add(cyl(obj - 0.0022, 0.0012, M.lens(), 0, y, zFront + 0.003, 'z', 28));
  g.add(cyl(R + 0.0045, 0.0012, M.lens(), 0, y, zBack - 0.004, 'z', 24));
  // rings on the rail
  for (const z of o.rings) {
    g.add(box(0.03, 0.014, 0.022, body, 0, o.base + 0.007, z));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.0035, 0.0038, 8, 28), body);
    ring.position.set(0, y, z);
    ring.scale.z = 2.6;
    g.add(ring);
    for (const sx of [-1, 1]) g.add(cyl(0.0022, 0.004, M.steel(), sx * (R + 0.004), y + 0.004, z, 'x', 8));
  }
}

// Curved box magazine side profile (x of the shape = gun z): top from z0 (rear) to z1 (front), sweeping
// forward by `sweep` over `drop`.
function curvedMag(z0, z1, top, drop, sweep, width, material, o = {}) {
  const d = z0 - z1;
  const pts = [[z0, top], [z1, top], [z1 - sweep * 0.25, top - drop * 0.5, z1 - sweep, top - drop], [z0 - sweep - d * 0.05, top - drop - d * 0.25], [z0 - sweep * 0.2, top - drop * 0.5, z0, top]];
  return ext(pts, width, material, { bevel: o.bevel ?? 0.002 });
}

// ------------------------------------------------------------------ AK pattern (Striker AR)

function akReceiver(g, recv, W, o = {}) {
  const hole = M.hole(), st = M.steel();
  // stamped receiver box between the rear and front trunnions
  g.add(ext([[0.086, 0.068], [0.086, 0.024], [0.078, 0.012], [0.062, 0.006], [-0.15, 0.006], [-0.164, 0.013], [-0.176, 0.02], [-0.176, 0.068]], W, recv, { bevel: 0.0016 }));
  // trunnion rivets, trigger and hammer pins
  for (const [z, y] of [[0.074, 0.02], [0.074, 0.052], [0.058, 0.012], [-0.162, 0.03], [-0.162, 0.054], [-0.148, 0.022], [-0.148, 0.05]]) g.add(pin(0.0026, W + 0.0014, recv, y, z));
  g.add(pin(0.0022, W + 0.0016, st, 0.022, -0.028));
  g.add(pin(0.0022, W + 0.0016, st, 0.03, -0.002));
  // magazine guide dimples pressed into both sides
  for (const sx of [-1, 1]) {
    const dm = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), recv);
    dm.scale.set(0.0011, 0.0058, 0.011);
    dm.position.set(sx * W / 2, 0.042, -0.098);
    g.add(dm);
  }
  // trigger guard, trigger and magazine catch
  g.add(ext([[-0.068, 0.006], [-0.068, -0.019], [-0.06, -0.026], [0.006, -0.026], [0.014, -0.02], [0.018, 0.006], [0.012, 0.006], [0.009, -0.017], [0.004, -0.021], [-0.058, -0.021], [-0.063, -0.016], [-0.063, 0.006]], 0.0065, recv, { bevel: 0.0012 }));
  g.add(ext([[-0.022, 0.006], [-0.028, -0.004, -0.021, -0.015], [-0.017, -0.014], [-0.021, -0.005, -0.017, 0.006]], 0.0048, st, { bevel: 0.0009 }));
  g.add(ext([[-0.063, 0.006], [-0.064, -0.01], [-0.071, -0.015], [-0.074, -0.012], [-0.069, 0.006]], 0.012, st, { bevel: 0.001 }));
  // right side: selector lever over the carrier slot, ejection port, charging handle on the carrier
  g.add(ext([[0.084, 0.065], [0.084, 0.052], [-0.058, 0.054], [-0.072, 0.047], [-0.082, 0.04], [-0.089, 0.043], [-0.082, 0.056], [-0.058, 0.064]], 0.0022, recv, { x: W / 2 + 0.0012, bevel: 0.0008 }));
  g.add(cyl(0.0055, 0.003, recv, W / 2 + 0.002, 0.059, 0.078, 'x', 14));
  g.add(box(0.0008, 0.013, 0.072, hole, W / 2 + 0.0003, 0.066, -0.092));
  g.add(box(0.0006, 0.008, 0.06, st, W / 2 + 0.0006, 0.066, -0.09));
  if (!o.leftCharger) {
    g.add(box(0.016, 0.006, 0.008, st, W / 2 + 0.008, 0.066, -0.034));
    g.add(cyl(0.0058, 0.011, st, W / 2 + 0.019, 0.066, -0.034, 'x', 12));
  }
  // left side: optic side rail with its dovetail and rivets
  if (o.sideRail !== false) {
    g.add(ext([[-0.06, 0.03], [0.05, 0.03], [0.054, 0.036], [0.054, 0.056], [-0.064, 0.056], [-0.064, 0.036]], 0.0032, recv, { x: -(W / 2 + 0.0016), bevel: 0.0008 }));
    g.add(box(0.0022, 0.006, 0.112, recv, -(W / 2 + 0.004), 0.047, -0.005));
    for (const z of [-0.045, 0.0, 0.04]) g.add(cyl(0.0026, 0.0012, st, -(W / 2 + 0.0034), 0.036, z, 'x', 10));
  }
  // marking on the left above the trigger
  g.add(marking(['№ 1974 ПЛ'], 0.034, 0.006, -(W / 2) - 0.0003, 0.016, -0.03));
}

// Pistol grip loft (local z runs down the grip), tilted back by `tilt` rad.
function pistolGrip(g, material, y, z, tilt, secs, p = 2.8) {
  g.add(loft(secs, material, p, { x: 0, y, z, rx: Math.PI / 2 - tilt }));
}

function buildAK() {
  const g = new THREE.Group();
  const recv = M.blued(), wood = M.wood(), hole = M.hole(), st = M.steel(), park = M.park();
  const W = 0.031, B = 0.056;
  const stock = named('stock'), mag = named('mag');
  akReceiver(g, recv, W);
  // domed dust cover with transverse ribs, recoil spring button behind it
  const cover = [[-0.162, 0.082, 0.058, W + 0.0012], [-0.04, 0.085, 0.058, W + 0.0012]];
  for (const z of [-0.02, 0.006, 0.032, 0.058]) cover.push([z - 0.004, 0.085, 0.058, W + 0.0012], [z - 0.0016, 0.0868, 0.058, W + 0.0026], [z + 0.0016, 0.0868, 0.058, W + 0.0026], [z + 0.004, 0.085, 0.058, W + 0.0012]);
  cover.push([0.08, 0.085, 0.058, W + 0.0012], [0.087, 0.0835, 0.058, W + 0.0005]);
  g.add(loft(cover, recv, 3.2));
  g.add(cyl(0.0045, 0.006, st, 0, 0.077, 0.09, 'z', 14));
  // rear sight block and tangent leaf with its slider and U-notch
  g.add(ext([[-0.158, 0.062], [-0.158, 0.086], [-0.166, 0.09], [-0.204, 0.09], [-0.212, 0.084], [-0.212, 0.058], [-0.2, 0.048], [-0.17, 0.048]], 0.03, recv, { bevel: 0.0018 }));
  g.add(ext([[-0.204, 0.09], [-0.144, 0.0915], [-0.143, 0.0945], [-0.204, 0.0935]], 0.019, recv, { bevel: 0.0006 }));
  g.add(box(0.023, 0.0065, 0.009, recv, 0, 0.093, -0.182));
  for (const sx of [-1, 1]) g.add(box(0.0055, 0.0055, 0.004, recv, sx * 0.0058, 0.097, -0.1445));
  g.add(marking(['1 2 3 4 5 6 7 8'], 0.05, 0.0035, 0, 0.0917, -0.174, -1, 'rgba(220,220,210,0.75)').rotateX(-Math.PI / 2).rotateY(Math.PI / 2));
  // barrel, gas block with the gas tube, front sight tower, slant brake, cleaning rod
  g.add(lathe([[0.0096, -0.176], [0.0092, -0.21], [0.0088, -0.4], [0.0082, -0.5], [0.0079, -0.54]], park, { y: B }));
  g.add(ext([[-0.402, 0.046], [-0.402, 0.095], [-0.41, 0.098], [-0.424, 0.098], [-0.431, 0.09], [-0.431, 0.046], [-0.425, 0.042], [-0.408, 0.042]], 0.026, recv, { bevel: 0.002 }));
  g.add(cyl(0.0092, 0.07, recv, 0, 0.084, -0.37, 'z', 16));
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) g.add(cyl(0.0014, 0.001, hole, sx * 0.0092, 0.084, -0.388 + i * 0.006, 'x', 8));
  g.add(ext([[-0.497, 0.044], [-0.497, 0.07], [-0.505, 0.077], [-0.531, 0.077], [-0.536, 0.066], [-0.537, 0.044], [-0.53, 0.038], [-0.505, 0.038]], 0.024, recv, { bevel: 0.0018 }));
  for (const sx of [-1, 1]) g.add(ext([[-0.508, 0.074], [-0.508, 0.096, -0.515, 0.1015], [-0.52, 0.1015], [-0.526, 0.096, -0.526, 0.074]], 0.0028, recv, { x: sx * 0.0095, bevel: 0.0006 }));
  g.add(cyl(0.0014, 0.02, recv, 0, 0.087, -0.517, 'y', 8));
  g.add(box(0.008, 0.012, 0.014, recv, 0, 0.034, -0.52));
  g.add(cyl(0.0028, 0.165, st, 0, 0.036, -0.455, 'z', 10));
  g.add(cyl(0.0036, 0.008, st, 0, 0.036, -0.536, 'z', 10));
  g.add(lathe([[0.0112, -0.537], [0.0118, -0.54], [0.0118, -0.574]], recv, { y: B, slant: 0.9 }));
  g.add(cyl(0.0048, 0.001, hole, 0, B - 0.003, -0.571));
  // handguard retainer ferrule with sling loop
  g.add(lathe([[0.011, -0.366], [0.0125, -0.368], [0.0125, -0.378], [0.011, -0.38]], recv, { y: B }));
  // wooden lower handguard (palm swell) and upper handguard around the gas tube with its lock lever
  g.add(loft([[-0.206, 0.068, 0.03, 0.04], [-0.212, 0.071, 0.024, 0.047], [-0.24, 0.072, 0.017, 0.053], [-0.3, 0.072, 0.016, 0.054], [-0.34, 0.071, 0.02, 0.05], [-0.36, 0.07, 0.026, 0.045], [-0.366, 0.068, 0.03, 0.04]], wood, 2.5));
  g.add(loft([[-0.21, 0.094, 0.071, 0.028], [-0.218, 0.0975, 0.068, 0.034], [-0.33, 0.0975, 0.069, 0.034], [-0.338, 0.094, 0.071, 0.029]], wood, 2.3));
  g.add(ext([[-0.2, 0.078], [-0.2, 0.086], [-0.222, 0.084], [-0.222, 0.08]], 0.004, recv, { x: 0.017, bevel: 0.0008 }));
  // black polymer pistol grip, swelling at the palm
  pistolGrip(g, M.polymer(), 0.008, 0.03, 0.3, [[0.0, 0.017, -0.017, 0.028], [0.03, 0.02, -0.02, 0.031], [0.07, 0.02, -0.02, 0.031], [0.1, 0.018, -0.017, 0.029], [0.106, 0.014, -0.012, 0.024]]);
  // stamped steel magazine: curved body, pressed side ribs, front lug and floor plate
  mag.add(ext([[-0.071, 0.012], [-0.126, 0.012], [-0.128, 0.0], [-0.136, -0.09, -0.212, -0.17], [-0.166, -0.192], [-0.098, -0.1, -0.077, 0.0], [-0.071, 0.0]], 0.027, M.park(), { bevel: 0.0014 }));
  mag.add(ext([[-0.084, -0.008], [-0.116, -0.008], [-0.124, -0.09, -0.188, -0.158], [-0.17, -0.172], [-0.104, -0.09, -0.084, -0.008]], 0.0286, M.park(), { bevel: 0.0008 }));
  mag.add(ext([[-0.214, -0.166], [-0.219, -0.174], [-0.168, -0.199], [-0.162, -0.19]], 0.03, M.park(), { bevel: 0.0012 }));
  mag.add(box(0.012, 0.006, 0.008, M.park(), 0, 0.009, -0.13));
  // wooden stock: slim wrist dropping to a deep butt, stock tang, steel butt plate, sling loop
  stock.add(loft([[0.084, 0.066, 0.014, 0.03], [0.1, 0.064, 0.006, 0.032], [0.14, 0.061, -0.012, 0.034], [0.2, 0.056, -0.04, 0.038], [0.26, 0.051, -0.066, 0.041], [0.31, 0.047, -0.086, 0.043], [0.33, 0.046, -0.092, 0.043]], wood, 2.8));
  stock.add(loft([[0.329, 0.048, -0.094, 0.045], [0.337, 0.047, -0.095, 0.044]], recv, 3.6));
  stock.add(box(0.012, 0.003, 0.05, recv, 0, 0.0655, 0.106));
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0016, 6, 16), st);
  loop.position.set(-0.0215, -0.03, 0.27);
  loop.rotation.y = Math.PI / 2;
  stock.add(loop);
  g.add(stock, mag);
  return finish(g, { muzzle: [0, B, -0.574], eject: [0.03, 0.066, -0.09], sightY: 0.0965, fore: [0, 0.022, -0.29], grip: [0, -0.02, 0.035], kind: 'rifle' });
}

// ------------------------------------------------------------------ Galil ACE style (Marauder)

function buildGalil(o) {
  const g = new THREE.Group();
  const recv = M.park(), poly = M.polymer(), furn = M.od(), st = M.steel(), hole = M.hole(), al = M.anod();
  const W = 0.031, B = 0.056;
  const stock = named('stock'), mag = named('mag');
  akReceiver(g, recv, W, { leftCharger: true, sideRail: false });
  // flat-topped cover with a full-length top rail
  g.add(loft([[-0.162, 0.08, 0.058, W + 0.0012], [0.086, 0.08, 0.058, W + 0.0012]], recv, 4.5));
  g.add(rail(0.24, al, { y: 0.0895, z: -0.04 }));
  // left-side charging handle bent up for the support hand
  g.add(box(0.014, 0.006, 0.008, st, -(W / 2 + 0.007), 0.066, -0.11));
  g.add(ext([[-0.106, 0.064], [-0.114, 0.064], [-0.12, 0.078], [-0.11, 0.08]], 0.007, st, { x: -(W / 2 + 0.016), bevel: 0.0012 }));
  // polymer handguard with side and bottom rails, gas block with a hooded front sight
  g.add(loft([[-0.176, 0.078, 0.028, 0.044], [-0.182, 0.08, 0.026, 0.048], [-0.38, 0.08, 0.026, 0.048], [-0.386, 0.078, 0.03, 0.044]], poly, 4.2));
  g.add(rail(0.19, al, { y: 0.0895, z: -0.28 }));
  for (const sx of [-1, 1]) g.add(rail(0.1, al, { x: sx * 0.0335, y: 0.053, z: -0.31, rz: sx * Math.PI / 2 }));
  for (let i = 0; i < 7; i++) for (const sx of [-1, 1]) g.add(box(0.0012, 0.018, 0.006, hole, sx * 0.0241, 0.053, -0.2 - i * 0.012));
  g.add(lathe([[0.0092, -0.386], [0.0086, -0.48]], recv, { y: B }));
  g.add(ext([[-0.44, 0.044], [-0.44, 0.072], [-0.446, 0.078], [-0.462, 0.078], [-0.466, 0.07], [-0.466, 0.044]], 0.024, recv, { bevel: 0.0018 }));
  for (const sx of [-1, 1]) g.add(ext([[-0.448, 0.074], [-0.448, 0.106, -0.454, 0.111], [-0.459, 0.111], [-0.464, 0.106, -0.464, 0.074]], 0.0026, recv, { x: sx * 0.0095 }));
  g.add(cyl(0.0014, 0.028, recv, 0, 0.094, -0.456, 'y', 8));
  // flash hider with slots
  g.add(lathe([[0.0086, -0.48], [0.0108, -0.482], [0.0108, -0.525], [0.0096, -0.528]], recv, { y: B }));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = box(0.0026, 0.0012, 0.028, hole, Math.cos(a) * 0.0108, B + Math.sin(a) * 0.0108, -0.51, 0);
    s.rotation.z = a + Math.PI / 2;
    g.add(s);
  }
  // micro red dot on the top rail
  const sightY = microDot(g, 0.0895, -0.02, al);
  // ergonomic grip, polymer 35-round magazine
  pistolGrip(g, poly, 0.008, 0.03, 0.32, [[0.0, 0.018, -0.018, 0.029], [0.03, 0.021, -0.021, 0.032], [0.07, 0.021, -0.02, 0.032], [0.098, 0.019, -0.017, 0.03], [0.106, 0.014, -0.012, 0.025]], 3);
  mag.add(ext([[-0.071, 0.012], [-0.126, 0.012], [-0.128, 0.0], [-0.134, -0.09, -0.2, -0.176], [-0.152, -0.196], [-0.094, -0.1, -0.077, 0.0], [-0.071, 0.0]], 0.0275, furn, { bevel: 0.0018 }));
  for (let i = 0; i < 5; i++) {
    const r = box(0.0288, 0.003, 0.03, furn, 0, -0.03 - i * 0.03, -0.1 - i * i * 0.0028 - i * 0.004);
    r.rotation.x = -0.1 - i * 0.12;
    mag.add(r);
  }
  mag.add(ext([[-0.2, -0.172], [-0.204, -0.181], [-0.154, -0.203], [-0.148, -0.195]], 0.031, poly, { bevel: 0.0012 }));
  // side-folding polymer stock: hinge block, skeletal body with cheek rest, rubber pad
  stock.add(box(0.034, 0.05, 0.022, recv, 0, 0.04, 0.097));
  stock.add(cyl(0.005, 0.054, st, 0.0145, 0.04, 0.097, 'y', 10));
  stock.add(ext([[0.106, 0.068], [0.3, 0.07], [0.312, 0.064], [0.312, -0.07], [0.3, -0.076], [0.27, -0.076], [0.14, -0.012], [0.106, 0.014]], 0.034, furn, { bevel: 0.005, holes: [[[0.15, 0.052], [0.286, 0.054], [0.29, -0.048], [0.27, -0.056], [0.16, -0.004], [0.142, 0.016]]] }));
  stock.add(loft([[0.16, 0.084, 0.062, 0.03], [0.3, 0.086, 0.062, 0.034]], furn, 3));
  stock.add(ext([[0.312, 0.068], [0.326, 0.068], [0.326, -0.074], [0.312, -0.074]], 0.038, M.rubber(), { bevel: 0.004 }));
  g.add(stock, mag);
  return finish(g, { muzzle: [0, B, -0.528], eject: [0.03, 0.066, -0.09], sightY, fore: [0, 0.022, -0.29], grip: [0, -0.02, 0.035], kind: 'rifle' });
}

// ------------------------------------------------------------------ M4 carbine (Guardian M4)

function buildM4() {
  const g = new THREE.Group();
  const al = M.anod(), st = M.steel(), park = M.park(), poly = M.polymer(), hole = M.hole();
  const B = 0.058, WL = 0.026, WU = 0.025;
  const stock = named('stock'), mag = named('mag');
  // lower receiver: buffer tower, trigger pocket, magazine well with flared bottom, pivot lug
  g.add(ext([[0.036, 0.046], [0.036, 0.077], [0.058, 0.077], [0.058, 0.03], [0.05, 0.018], [0.032, 0.012], [-0.075, 0.012], [-0.08, 0.004], [-0.084, -0.022], [-0.088, -0.03], [-0.162, -0.03], [-0.166, -0.022], [-0.166, 0.03], [-0.176, 0.034], [-0.18, 0.046]], WL, al, { bevel: 0.0018 }));
  g.add(ext([[-0.083, -0.016], [-0.087, -0.033], [-0.163, -0.033], [-0.167, -0.016]], 0.031, al, { bevel: 0.002 }));
  g.add(box(0.029, 0.03, 0.006, al, 0, -0.012, -0.169)); // magwell front ridge
  // upper receiver: flat top, forward assist housing, ejection port with the carrier, brass deflector
  g.add(ext([[0.036, 0.046], [0.036, 0.0735], [0.032, 0.0755], [-0.18, 0.0755], [-0.184, 0.072], [-0.184, 0.046]], WU, al, { bevel: 0.0018 }));
  g.add(rail(0.21, al, { y: 0.085, z: -0.073 }));
  g.add(box(0.0008, 0.015, 0.064, hole, WU / 2 + 0.0003, 0.058, -0.074));
  g.add(box(0.0006, 0.009, 0.05, M.bright(), WU / 2 + 0.0006, 0.058, -0.072));
  g.add(ext([[-0.034, 0.05], [-0.034, 0.074], [-0.022, 0.074], [-0.014, 0.05]], 0.006, al, { x: WU / 2 + 0.003, bevel: 0.0012 }));
  const fa = cyl(0.0078, 0.036, al, 0.016, 0.066, 0.008, 'z', 16);
  g.add(fa);
  g.add(cyl(0.0064, 0.008, st, 0.016, 0.066, 0.029, 'z', 16));
  // charging handle latch at the rear
  g.add(box(0.034, 0.006, 0.011, al, 0, 0.072, 0.031));
  g.add(box(0.014, 0.008, 0.018, al, 0, 0.071, 0.028));
  // folded back-up sights on the rails
  g.add(box(0.021, 0.008, 0.024, al, 0, 0.089, 0.014));
  g.add(box(0.021, 0.009, 0.022, al, 0, 0.0895, -0.418));
  // lower hardware: bolt catch, selector with markings, takedown pins, trigger pins, mag release
  g.add(ext([[-0.064, 0.02], [-0.064, 0.042], [-0.074, 0.043], [-0.081, 0.035], [-0.079, 0.02]], 0.003, al, { x: -(WL / 2 + 0.0015), bevel: 0.0008 }));
  g.add(cyl(0.0056, 0.003, st, -(WL / 2 + 0.0015), 0.032, 0.014, 'x', 16));
  g.add(ext([[0.02, 0.029], [-0.006, 0.03], [-0.008, 0.034], [0.02, 0.036]], 0.0026, st, { x: -(WL / 2 + 0.0032), bevel: 0.0008 }));
  for (const [z, y] of [[0.03, 0.039], [-0.172, 0.04]]) g.add(pin(0.0032, WL + 0.0012, st, y, z));
  for (const [z, y] of [[-0.03, 0.024], [-0.006, 0.03]]) g.add(pin(0.0022, WL + 0.0012, st, y, z));
  g.add(cyl(0.005, 0.003, st, WL / 2 + 0.0015, 0.021, -0.078, 'x', 14));
  g.add(marking(['SAFE', 'SEMI AUTO'], 0.024, 0.009, -(WL / 2) - 0.0003, 0.022, 0.024));
  g.add(marking(['GUARDIAN ARMS', 'M4A1 CARBINE', 'CAL 5.56 MM', 'SN BP-041772'], 0.056, 0.024, -(WL / 2) - 0.0003, 0.001, -0.125));
  // enlarged trigger guard and trigger
  g.add(ext([[-0.074, 0.012], [-0.074, -0.017], [-0.066, -0.024], [0.0, -0.024], [0.01, -0.016], [0.014, 0.012], [0.008, 0.012], [0.005, -0.014], [0.0, -0.018], [-0.064, -0.018], [-0.068, -0.014], [-0.068, 0.012]], 0.0095, poly, { bevel: 0.0015 }));
  g.add(ext([[-0.036, 0.012], [-0.043, 0.0, -0.036, -0.011], [-0.032, -0.01], [-0.036, 0.0, -0.031, 0.012]], 0.0048, st, { bevel: 0.0009 }));
  // octagonal free-float M-LOK handguard with a top rail
  const oct = [];
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4, r = 0.0205 / Math.cos(Math.PI / 8); oct.push([Math.cos(a) * r, Math.sin(a) * r]); }
  g.add(prism(oct, 0.25, al, { y: 0.0555, z: -0.307, bevel: 0.0016 }));
  g.add(rail(0.24, al, { y: 0.085, z: -0.307 }));
  const slotM = hole;
  for (let i = 0; i < 5; i++) {
    const z = -0.215 - i * 0.046;
    for (const sx of [-1, 1]) {
      g.add(box(0.0012, 0.0075, 0.032, slotM, sx * 0.0207, 0.0555, z, 0.0005));
      const d = box(0.0012, 0.0075, 0.032, slotM, sx * 0.0146, 0.0555 - 0.0146, z, 0.0005);
      d.rotation.z = -sx * Math.PI / 4;
      g.add(d);
    }
    g.add(box(0.0075, 0.0012, 0.032, slotM, 0, 0.0348, z, 0.0005));
  }
  g.add(marking(['GUARDIAN · M-LOK'], 0.05, 0.0055, -0.0209, 0.0555, -0.26));
  // barrel, crush washer, A2 birdcage flash hider with five slots
  g.add(lathe([[0.0092, -0.43], [0.0085, -0.434], [0.0085, -0.482]], park, { y: B }));
  g.add(lathe([[0.0105, -0.482], [0.0112, -0.484], [0.0112, -0.526], [0.0098, -0.529]], park, { y: B }));
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i - 2) * 0.72;
    const s = box(0.0024, 0.0014, 0.026, hole, Math.cos(a) * 0.0112, B + Math.sin(a) * 0.0112, -0.51, 0);
    s.rotation.z = a + Math.PI / 2;
    g.add(s);
  }
  g.add(cyl(0.0046, 0.001, hole, 0, B, -0.529));
  // buffer tube with castle nut and end plate, SOPMOD-style stock with battery tubes, cheek weld, pad
  stock.add(lathe([[0.0145, 0.058], [0.0145, 0.24], [0.013, 0.244]], park, { y: B }));
  stock.add(lathe([[0.0175, 0.058], [0.0175, 0.068], [0.016, 0.07]], park, { y: B }));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; stock.add(box(0.004, 0.0035, 0.01, hole, Math.cos(a) * 0.0176, B + Math.sin(a) * 0.0176, 0.064, 0).rotateZ(a)); }
  stock.add(loft([[0.13, 0.078, 0.038, 0.033], [0.15, 0.083, 0.03, 0.037], [0.2, 0.087, 0.012, 0.04], [0.26, 0.089, -0.008, 0.042], [0.296, 0.089, -0.014, 0.042]], poly, 3.4));
  for (const sx of [-1, 1]) stock.add(loft([[0.165, 0.084, 0.064, 0.016, sx * 0.019], [0.175, 0.086, 0.062, 0.018, sx * 0.02], [0.286, 0.086, 0.062, 0.018, sx * 0.02], [0.292, 0.084, 0.064, 0.016, sx * 0.019]], poly, 2.2));
  stock.add(box(0.012, 0.008, 0.03, poly, 0, 0.036, 0.16));
  stock.add(loft([[0.295, 0.09, -0.016, 0.043], [0.308, 0.089, -0.017, 0.042]], M.rubber(), 3.6));
  // angled grip with a beavertail
  pistolGrip(g, poly, 0.012, 0.022, 0.36, [[0.0, 0.017, -0.018, 0.028], [0.02, 0.019, -0.021, 0.03], [0.05, 0.018, -0.022, 0.031], [0.08, 0.019, -0.02, 0.03], [0.098, 0.018, -0.017, 0.028], [0.104, 0.013, -0.012, 0.024]], 3);
  g.add(ext([[0.02, 0.012], [0.042, 0.009], [0.046, -0.002], [0.026, 0.0]], 0.028, poly, { bevel: 0.003 }));
  // polymer magazine with grip ribs and a flared floor plate
  mag.add(ext([[-0.089, 0.03], [-0.154, 0.03], [-0.157, -0.06, -0.172, -0.146], [-0.108, -0.152], [-0.097, -0.06, -0.089, 0.03]], 0.0235, M.color(0x2a2b2d, 0.05, 0.68), { bevel: 0.002 }));
  for (let i = 0; i < 4; i++) {
    const r = box(0.0252, 0.0028, 0.056, poly, 0, -0.088 - i * 0.012, -0.132 - i * 0.004);
    r.rotation.x = -0.1 - i * 0.03;
    mag.add(r);
  }
  mag.add(ext([[-0.106, -0.148], [-0.108, -0.162], [-0.178, -0.156], [-0.174, -0.142]], 0.029, poly, { bevel: 0.0025 }));
  g.add(stock, mag);
  // holographic sight on the receiver rail
  const sightY = holoSight(g, 0.085, -0.07, al);
  return finish(g, { muzzle: [0, B, -0.529], eject: [0.03, 0.06, -0.075], sightY, fore: [0, 0.018, -0.3], grip: [0, -0.02, 0.03], kind: 'rifle' });
}

// ------------------------------------------------------------------ SMGs

function buildMP5(o) {
  const g = new THREE.Group();
  const body = M.color(o.body, 0.45, 0.5), poly = M.polymer(), st = M.steel(), hole = M.hole(), park = M.park();
  const B = 0.052, W = 0.036;
  const stock = named('stock'), mag = named('mag');
  // pressed-steel receiver with the cocking tube along its top, stamped ribs, end cap
  g.add(loft([[0.074, 0.084, 0.034, W], [-0.176, 0.084, 0.034, W], [-0.18, 0.083, 0.036, W - 0.002]], body, 3));
  for (const y of [0.048, 0.068]) g.add(box(W + 0.0014, 0.0035, 0.22, body, 0, y, -0.06, 0.0012));
  g.add(cyl(0.0125, 0.18, body, 0, 0.0715, -0.26, 'z', 20));
  g.add(loft([[0.074, 0.08, 0.038, W - 0.002], [0.084, 0.078, 0.04, W - 0.004]], park, 3.4));
  g.add(box(0.0008, 0.011, 0.05, hole, W / 2 + 0.0003, 0.066, -0.062));
  g.add(box(0.0006, 0.007, 0.04, M.bright(), W / 2 + 0.0006, 0.066, -0.06));
  // magazine well and paddle release
  g.add(ext([[-0.104, 0.036], [-0.104, 0.012], [-0.109, 0.008], [-0.153, 0.008], [-0.157, 0.012], [-0.157, 0.036]], 0.034, body, { bevel: 0.0016 }));
  g.add(ext([[-0.098, 0.01], [-0.096, -0.004], [-0.09, -0.006], [-0.092, 0.01]], 0.02, st, { bevel: 0.001 }));
  // cocking handle folded forward on the left of the tube
  g.add(ext([[-0.226, 0.07], [-0.26, 0.074], [-0.262, 0.08], [-0.226, 0.078]], 0.004, st, { x: -0.0145, bevel: 0.0008 }));
  g.add(cyl(0.0042, 0.012, poly, -0.019, 0.077, -0.262, 'x', 10));
  // hooded front sight and diopter drum rear sight
  g.add(ext([[-0.336, 0.08], [-0.336, 0.09], [-0.35, 0.09], [-0.354, 0.08]], 0.018, body, { bevel: 0.0012 }));
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.0105, 0.0022, 8, 20), body);
  hood.position.set(0, 0.1005, -0.345);
  g.add(hood);
  g.add(box(0.0024, 0.012, 0.003, body, 0, 0.096, -0.345));
  g.add(box(0.02, 0.012, 0.022, body, 0, 0.088, 0.052));
  g.add(cyl(0.0095, 0.024, body, 0, 0.1, 0.052, 'x', 16));
  for (let i = 0; i < 4; i++) g.add(cyl(0.0022, 0.001, hole, 0, 0.1 + Math.cos(i * 1.57) * 0.0065, 0.052 + Math.sin(i * 1.57) * 0.0065, 'x', 8).translateY(0.012));
  // slim ribbed handguard, barrel with three lugs and the thread cap
  g.add(loft([[-0.18, 0.064, 0.03, 0.04], [-0.19, 0.065, 0.026, 0.046], [-0.32, 0.065, 0.028, 0.046], [-0.33, 0.064, 0.032, 0.04]], poly, 2.6));
  for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) g.add(box(0.0012, 0.018, 0.005, hole, sx * 0.0229, 0.045, -0.205 - i * 0.02, 0));
  g.add(lathe([[0.0092, -0.33], [0.0092, -0.366]], park, { y: B }));
  for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + (i * Math.PI * 2) / 3; g.add(box(0.005, 0.004, 0.01, park, Math.cos(a) * 0.0105, B + Math.sin(a) * 0.0105, -0.356).rotateZ(a)); }
  g.add(lathe([[0.0098, -0.366], [0.0105, -0.368], [0.0105, -0.384], [0.009, -0.386]], park, { y: B }));
  g.add(cyl(0.0046, 0.001, hole, 0, B, -0.3865));
  // polymer trigger group with grip, guard, selector and trigger
  g.add(ext([[0.066, 0.036], [-0.074, 0.036], [-0.074, 0.02], [-0.078, -0.016, -0.056, -0.022], [-0.02, -0.022], [-0.006, -0.02, 0.0, -0.01], [0.004, -0.04], [0.008, -0.052, 0.012, -0.06], [0.016, -0.1], [0.052, -0.1], [0.05, -0.05], [0.046, -0.01, 0.066, 0.036]], 0.034, poly, { holes: [[[-0.062, 0.01], [-0.064, -0.012, -0.05, -0.015], [-0.02, -0.015], [-0.01, -0.013, -0.01, -0.002], [-0.012, 0.01]]], bevel: 0.003 }));
  g.add(ext([[-0.034, 0.008], [-0.04, -0.004, -0.033, -0.012], [-0.029, -0.011], [-0.033, -0.003, -0.029, 0.008]], 0.005, st, { bevel: 0.001 }));
  g.add(cyl(0.006, 0.003, st, -0.0185, 0.024, 0.02, 'x', 14));
  g.add(box(0.003, 0.004, 0.02, st, -0.0195, 0.024, 0.01));
  for (const [z, y] of [[0.05, 0.032], [-0.05, 0.03]]) g.add(pin(0.0026, 0.0356, st, y, z));
  // curved steel magazine with ribs and floor plate
  mag.add(curvedMag(-0.108, -0.153, 0.02, 0.16, 0.05, 0.022, park));
  for (let i = 0; i < 3; i++) { const r = box(0.0235, 0.0028, 0.04, park, 0, -0.02 - i * 0.04, -0.137 - i * 0.012); r.rotation.x = -0.12 - i * 0.12; mag.add(r); }
  mag.add(ext([[-0.2, -0.136], [-0.205, -0.146], [-0.16, -0.16], [-0.154, -0.15]], 0.026, park, { bevel: 0.0012 }));
  // retractable stock: two struts and the rubber butt pad
  for (const sx of [-1, 1]) stock.add(box(0.006, 0.012, 0.19, park, sx * 0.0195, 0.063, 0.17, 0.002));
  stock.add(loft([[0.258, 0.1, -0.004, 0.044], [0.272, 0.1, -0.005, 0.044]], M.rubber(), 3.4));
  stock.add(box(0.04, 0.016, 0.012, park, 0, 0.063, 0.25));
  g.add(stock, mag);
  return finish(g, { muzzle: [0, B, -0.386], eject: [0.025, 0.066, -0.06], sightY: 0.1, fore: [0, 0.012, -0.26], grip: [0, -0.02, 0.018], kind: 'smg' });
}

function buildMP7(o) {
  const g = new THREE.Group();
  const body = M.polymer(), al = M.anod(), st = M.steel(), hole = M.hole(), park = M.park();
  const B = 0.056, W = 0.044;
  const stock = named('stock'), mag = named('mag');
  // polymer upper with sloped nose, full top rail, side rails at the front, ejection port
  g.add(ext([[0.056, 0.03], [0.056, 0.076], [0.05, 0.08], [-0.13, 0.08], [-0.17, 0.066], [-0.19, 0.06], [-0.19, 0.036], [-0.13, 0.03]], W, body, { bevel: 0.0045 }));
  g.add(rail(0.2, al, { y: 0.0895, z: -0.05 }));
  for (const sx of [-1, 1]) g.add(rail(0.05, al, { x: sx * (W / 2 + 0.0095), y: 0.05, z: -0.15, rz: -sx * Math.PI / 2 }));
  g.add(box(0.0008, 0.012, 0.045, hole, W / 2 + 0.0003, 0.062, -0.04));
  g.add(box(0.0006, 0.007, 0.036, M.bright(), W / 2 + 0.0006, 0.062, -0.038));
  g.add(box(0.034, 0.006, 0.012, al, 0, 0.078, 0.05));
  for (const [z, y] of [[0.03, 0.04], [-0.1, 0.04]]) g.add(pin(0.0028, W + 0.001, st, y, z));
  g.add(marking(['4.6x30 · RATTLER'], 0.05, 0.0055, -(W / 2) - 0.0003, 0.046, -0.07));
  // barrel and knurled thread protector
  g.add(lathe([[0.0095, -0.19], [0.0092, -0.236]], park, { y: B }));
  g.add(lathe([[0.0112, -0.236], [0.012, -0.238], [0.012, -0.26], [0.0105, -0.262]], park, { y: B }));
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; g.add(box(0.0015, 0.0012, 0.018, hole, Math.cos(a) * 0.012, B + Math.sin(a) * 0.012, -0.249, 0).rotateZ(a)); }
  // flip-up sights
  g.add(ext([[-0.114, 0.09], [-0.114, 0.1], [-0.126, 0.1], [-0.128, 0.09]], 0.016, al, { bevel: 0.001 }));
  for (const sx of [-1, 1]) g.add(box(0.0028, 0.014, 0.01, al, sx * 0.0066, 0.105, -0.12));
  g.add(box(0.0022, 0.012, 0.0022, al, 0, 0.103, -0.12));
  g.add(box(0.022, 0.006, 0.018, al, 0, 0.093, 0.022));
  const peep = new THREE.Mesh(new THREE.TorusGeometry(0.0065, 0.0025, 8, 18), al);
  peep.position.set(0, 0.108, 0.022);
  g.add(peep);
  for (const sx of [-1, 1]) g.add(box(0.003, 0.012, 0.012, al, sx * 0.009, 0.102, 0.022));
  // grip frame with the magazine inside, trigger guard, ambi selector
  g.add(ext([[0.05, 0.036], [-0.12, 0.036], [-0.12, 0.02], [-0.065, 0.016], [-0.07, -0.016, -0.05, -0.022], [-0.02, -0.022], [-0.008, -0.02, -0.004, -0.01], [0.002, -0.05], [0.01, -0.104], [0.054, -0.104], [0.048, -0.05], [0.04, -0.01, 0.05, 0.036]], 0.038, body, { holes: [[[-0.058, 0.008], [-0.06, -0.012, -0.046, -0.015], [-0.018, -0.015], [-0.011, -0.013, -0.011, -0.002], [-0.012, 0.008]]], bevel: 0.0035 }));
  for (const sx of [-1, 1]) g.add(ext([[0.012, -0.03], [0.02, -0.098], [0.048, -0.098], [0.042, -0.03]], 0.0015, M.stipple(), { x: sx * 0.0195, bevel: 0.0005 }));
  g.add(ext([[-0.032, 0.006], [-0.038, -0.004, -0.031, -0.012], [-0.027, -0.011], [-0.031, -0.003, -0.027, 0.006]], 0.005, st, { bevel: 0.001 }));
  g.add(cyl(0.0055, 0.042, st, 0, 0.024, 0.032, 'x', 14));
  mag.add(ext([[0.009, -0.103], [0.008, -0.118], [0.057, -0.118], [0.055, -0.103]], 0.035, body, { bevel: 0.002 }));
  // folding vertical foregrip (deployed)
  g.add(box(0.026, 0.012, 0.03, body, 0, 0.026, -0.142));
  g.add(ext([[-0.13, 0.024], [-0.156, 0.024], [-0.162, -0.066, -0.15, -0.07], [-0.136, -0.07], [-0.13, -0.064, -0.13, 0.024]], 0.024, body, { bevel: 0.004 }));
  for (let i = 0; i < 4; i++) g.add(box(0.0245, 0.003, 0.02, body, 0, -0.012 - i * 0.014, -0.147));
  // telescoping stock: rods and a small butt plate
  for (const sx of [-1, 1]) stock.add(cyl(0.0042, 0.16, st, sx * 0.015, 0.05, 0.13, 'z', 10));
  stock.add(ext([[0.2, 0.078], [0.214, 0.078], [0.218, 0.0], [0.202, 0.0]], 0.048, body, { bevel: 0.004 }));
  stock.add(ext([[0.214, 0.078], [0.22, 0.078], [0.224, 0.0], [0.218, 0.0]], 0.048, M.rubber(), { bevel: 0.002 }));
  g.add(stock, mag);
  return finish(g, { muzzle: [0, B, -0.262], eject: [0.026, 0.066, -0.04], sightY: 0.108, fore: [0, -0.02, -0.145], grip: [0, -0.02, 0.018], kind: 'smg' });
}

// ------------------------------------------------------------------ shotgun (870 pattern)

function buildShotgun() {
  const g = new THREE.Group();
  const recv = M.park(), st = M.steel(), wood = M.wood(), hole = M.hole(), poly = M.polymer(), blued = M.blued();
  const B = 0.062, W = 0.034;
  // receiver with rounded top, ejection and loading ports, pins
  g.add(loft([[0.046, 0.073, 0.012, W], [0.032, 0.078, 0.012, W], [-0.172, 0.078, 0.012, W], [-0.176, 0.076, 0.014, W - 0.002]], recv, 4.2));
  g.add(box(0.0008, 0.02, 0.078, hole, W / 2 + 0.0003, 0.056, -0.072));
  g.add(box(0.0006, 0.012, 0.05, M.bright(), W / 2 + 0.0006, 0.058, -0.06));
  g.add(box(0.02, 0.0008, 0.09, hole, 0, 0.0118, -0.085));
  for (const z of [-0.02, 0.022]) g.add(pin(0.0028, W + 0.0012, st, 0.022, z));
  g.add(marking(['BREACHER 12', '12 GA · 3" SHELLS'], 0.056, 0.012, -(W / 2) - 0.0003, 0.046, -0.08));
  // trigger plate with guard, trigger, cross-bolt safety, slide release
  g.add(ext([[0.04, 0.014], [-0.075, 0.014], [-0.078, -0.018, -0.06, -0.024], [-0.004, -0.024], [0.012, -0.018, 0.022, 0.014]], 0.026, poly, { holes: [[[-0.062, 0.008], [-0.064, -0.012, -0.052, -0.017], [-0.004, -0.017], [0.006, -0.013, 0.008, 0.008]]], bevel: 0.002 }));
  g.add(ext([[-0.03, 0.01], [-0.036, 0.0, -0.028, -0.009], [-0.025, -0.008], [-0.03, 0.0, -0.026, 0.01]], 0.005, st, { bevel: 0.001 }));
  g.add(cyl(0.0036, 0.03, M.color(0xa02020, 0.2, 0.5), 0, 0.006, 0.012, 'x', 10));
  g.add(ext([[-0.076, 0.008], [-0.086, 0.004], [-0.088, -0.006], [-0.08, -0.004]], 0.004, st, { x: -0.014, bevel: 0.0008 }));
  // barrel with its collar and bead, magazine tube with knurled cap, barrel clamp
  g.add(lathe([[0.0145, -0.172], [0.0145, -0.2], [0.0124, -0.206], [0.0122, -0.66]], blued, { y: B, seg: 22 }));
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0024, 10, 8), M.bright());
  bead.position.set(0, B + 0.0138, -0.652);
  g.add(bead);
  g.add(cyl(0.0056, 0.001, hole, 0, B, -0.6605));
  g.add(lathe([[0.011, -0.172], [0.011, -0.6]], blued, { y: 0.034 }));
  g.add(lathe([[0.0118, -0.6], [0.0132, -0.602], [0.0132, -0.628], [0.009, -0.634]], recv, { y: 0.034 }));
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.add(box(0.0016, 0.0014, 0.022, hole, Math.cos(a) * 0.0132, 0.034 + Math.sin(a) * 0.0132, -0.615, 0).rotateZ(a)); }
  g.add(loft([[-0.574, 0.078, 0.02, 0.03], [-0.588, 0.078, 0.02, 0.03]], recv, 3.2));
  // wooden pump with grooves and its action bars (animated)
  const pump = named('pump');
  const ps = [];
  for (let i = 0; i <= 16; i++) {
    const z = 0.075 - i * (0.15 / 16);
    const groove = i > 1 && i < 15 && i % 2 === 0;
    const k = Math.sin((i / 16) * Math.PI);
    ps.push([z, 0.028 + 0.004 * k - (groove ? 0.0018 : 0), -0.02 - 0.006 * k + (groove ? 0.0018 : 0), 0.046 + 0.008 * k - (groove ? 0.004 : 0)]);
  }
  pump.add(loft(ps, wood, 2.4));
  for (const sx of [-1, 1]) pump.add(box(0.0022, 0.006, 0.2, st, sx * 0.0125, 0.0, 0.17));
  pump.position.set(0, 0.034, -0.4);
  g.add(pump);
  // wooden stock with comb, wrist and recoil pad
  const stock = named('stock');
  stock.add(loft([[0.045, 0.073, 0.014, 0.034], [0.07, 0.07, 0.0, 0.034], [0.12, 0.066, -0.02, 0.036], [0.2, 0.062, -0.045, 0.04], [0.3, 0.058, -0.066, 0.043], [0.342, 0.056, -0.072, 0.044]], wood, 2.6));
  stock.add(loft([[0.341, 0.058, -0.074, 0.046], [0.366, 0.058, -0.075, 0.045]], M.rubber(), 3.4));
  for (let i = 0; i < 4; i++) stock.add(box(0.0462, 0.0015, 0.018, hole, 0, 0.04 - i * 0.03, 0.357, 0));
  g.add(stock);
  return finish(g, { muzzle: [0, B, -0.66], eject: [0.03, 0.058, -0.07], sightY: 0.08, fore: [0, 0.01, -0.4], grip: [0, -0.02, 0.05], kind: 'shotgun', pump: true });
}

// ------------------------------------------------------------------ bolt-action rifles

function boltHandle(g, B, z) {
  const bolt = named('bolt');
  const st = M.steel();
  bolt.add(cyl(0.0042, 0.045, st, 0.034, B - 0.006, z, 'x', 10).rotateZ(-0.35));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 14, 10), M.polymer());
  knob.scale.set(1, 1, 1.25);
  knob.position.set(0.056, B - 0.016, z + 0.004);
  bolt.add(knob);
  g.add(bolt);
}

function buildAWM(o) {
  const g = new THREE.Group();
  const green = M.color(o.body, 0.12, 0.6), st = M.steel(), park = M.park(), poly = M.polymer(), hole = M.hole(), al = M.anod();
  const B = 0.064;
  const mag = named('mag');
  // thumbhole stock: forend, receiver bed, grip, butt; separate adjustable cheek piece; pad with spacers
  g.add(ext([[-0.47, 0.054], [-0.1, 0.054], [-0.09, 0.06], [0.14, 0.06], [0.17, 0.078], [0.39, 0.082], [0.4, 0.078], [0.4, -0.08], [0.39, -0.086], [0.2, -0.086], [0.14, -0.106], [0.092, -0.108], [0.076, -0.06], [0.07, -0.02], [0.05, -0.012], [-0.06, -0.012], [-0.42, 0.002], [-0.47, 0.02]], 0.052, green, { bevel: 0.008, seg: 3, holes: [[[0.128, 0.036], [0.2, 0.04], [0.216, 0.0, 0.196, -0.056], [0.142, -0.06], [0.12, -0.02, 0.128, 0.036]]] }));
  g.add(ext([[0.175, 0.08], [0.37, 0.084], [0.37, 0.104], [0.19, 0.1]], 0.04, green, { bevel: 0.006 }));
  for (let i = 0; i < 2; i++) g.add(cyl(0.004, 0.02, st, 0, 0.09, 0.22 + i * 0.1, 'y', 10));
  g.add(ext([[0.4, 0.08], [0.404, 0.08], [0.404, -0.084], [0.4, -0.084]], 0.05, poly, { bevel: 0.001 }));
  g.add(ext([[0.404, 0.08], [0.422, 0.08], [0.424, -0.084], [0.404, -0.084]], 0.054, M.rubber(), { bevel: 0.004 }));
  // rear monopod under the butt
  g.add(cyl(0.0065, 0.03, st, 0, -0.096, 0.34, 'y', 12));
  g.add(cyl(0.011, 0.008, poly, 0, -0.098, 0.34, 'y', 16));
  // chassis seam and the forend sling stud
  g.add(box(0.0022, 0.03, 0.4, poly, 0, 0.04, -0.27, 0));
  g.add(cyl(0.004, 0.012, st, 0, 0.0, -0.44, 'y', 10));
  // steel receiver, bolt shroud, trigger guard, trigger, detachable magazine
  g.add(cyl(0.0195, 0.3, park, 0, B, -0.02, 'z', 22));
  g.add(lathe([[0.017, 0.13], [0.017, 0.14], [0.013, 0.152], [0.006, 0.156]], park, { y: B }));
  g.add(box(0.0008, 0.014, 0.06, hole, 0.0195, B + 0.004, -0.02));
  g.add(ext([[-0.012, -0.008], [-0.016, -0.036, 0.0, -0.043], [0.05, -0.043], [0.066, -0.036, 0.068, -0.008]], 0.012, poly, { holes: [[[-0.004, -0.01], [-0.006, -0.03, 0.006, -0.036], [0.044, -0.036], [0.058, -0.03, 0.058, -0.01]]], bevel: 0.0015 }));
  g.add(ext([[0.024, -0.01], [0.018, -0.02, 0.025, -0.029], [0.029, -0.028], [0.025, -0.02, 0.029, -0.01]], 0.005, st, { bevel: 0.001 }));
  mag.add(ext([[-0.09, -0.01], [-0.09, -0.04], [-0.02, -0.04], [-0.02, -0.01]], 0.034, park, { bevel: 0.002 }));
  mag.add(ext([[-0.092, -0.04], [-0.092, -0.048], [-0.018, -0.048], [-0.018, -0.04]], 0.037, poly, { bevel: 0.0015 }));
  g.add(mag);
  // fluted barrel with a large double-port muzzle brake
  g.add(lathe([[0.0148, -0.17], [0.0142, -0.24], [0.0125, -0.7]], park, { y: B, seg: 24 }));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    g.add(box(0.0034, 0.0012, 0.36, hole, Math.cos(a) * 0.0131, B + Math.sin(a) * 0.0131, -0.45, 0).rotateZ(a + Math.PI / 2));
  }
  g.add(lathe([[0.0125, -0.7], [0.018, -0.703], [0.018, -0.778], [0.0165, -0.782]], park, { y: B, seg: 24 }));
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) g.add(box(0.001, 0.016, 0.012, hole, sx * 0.0182, B, -0.718 - i * 0.022, 0));
  g.add(cyl(0.006, 0.001, hole, 0, B, -0.7825));
  // folded bipod under the forend
  g.add(box(0.034, 0.018, 0.034, park, 0, -0.004, -0.435));
  for (const sx of [-1, 1]) {
    g.add(cyl(0.0048, 0.18, st, sx * 0.011, -0.006, -0.33, 'z', 10));
    g.add(cyl(0.0065, 0.012, M.rubber(), sx * 0.011, -0.006, -0.236, 'z', 10));
  }
  boltHandle(g, B, 0.09);
  g.add(marking(['LONGBOW .338 LAPUA MAG'], 0.07, 0.006, -0.0198, B, -0.07));
  // rail, rings and a big riflescope
  g.add(rail(0.24, al, { y: 0.095, z: -0.02 }));
  scope(g, 0.128, -0.31, 0.185, { rings: [-0.1, 0.05], base: 0.095, tube: 0.015, obj: 0.029, bell: 0.13 });
  return finish(g, { muzzle: [0, B, -0.782], eject: [0.03, 0.07, -0.02], sightY: 0.128, fore: [0, 0.0, -0.3], grip: [0, -0.03, 0.08], kind: 'sniper' });
}

function buildScout(o) {
  const g = new THREE.Group();
  const body = M.color(o.body, 0.15, 0.62), st = M.steel(), park = M.park(), poly = M.polymer(), hole = M.hole(), al = M.anod();
  const B = 0.062;
  const mag = named('mag');
  // aluminium chassis: M-LOK forend, receiver bed with magwell, vertical grip
  g.add(loft([[-0.44, 0.054, 0.02, 0.038], [-0.43, 0.056, 0.016, 0.044], [-0.1, 0.056, 0.012, 0.046]], body, 4.2));
  for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) g.add(box(0.0012, 0.008, 0.03, hole, sx * 0.0229, 0.036, -0.4 + i * 0.058, 0.0005));
  g.add(ext([[-0.1, 0.058], [0.1, 0.058], [0.1, 0.01], [0.07, -0.014], [-0.06, -0.014], [-0.1, 0.012]], 0.046, body, { bevel: 0.004 }));
  pistolGrip(g, poly, 0.0, 0.08, 0.16, [[0.0, 0.019, -0.019, 0.03], [0.03, 0.022, -0.022, 0.033], [0.07, 0.022, -0.02, 0.033], [0.1, 0.019, -0.017, 0.03], [0.106, 0.015, -0.013, 0.026]], 3);
  // skeleton stock with cheek riser and butt pad
  g.add(ext([[0.095, 0.058], [0.33, 0.072], [0.34, 0.068], [0.34, -0.066], [0.33, -0.072], [0.17, -0.072], [0.13, -0.05], [0.115, 0.0], [0.095, 0.016]], 0.034, body, { bevel: 0.005, holes: [[[0.14, 0.046], [0.318, 0.056], [0.322, -0.05], [0.18, -0.055], [0.15, -0.035], [0.138, 0.0]]] }));
  g.add(ext([[0.17, 0.072], [0.3, 0.078], [0.3, 0.092], [0.18, 0.088]], 0.032, body, { bevel: 0.005 }));
  g.add(ext([[0.34, 0.072], [0.354, 0.072], [0.356, -0.068], [0.34, -0.068]], 0.04, M.rubber(), { bevel: 0.004 }));
  // receiver, bolt shroud, guard, trigger, magazine
  g.add(cyl(0.0172, 0.27, park, 0, B, -0.02, 'z', 20));
  g.add(lathe([[0.0155, 0.115], [0.0155, 0.124], [0.012, 0.134], [0.005, 0.137]], park, { y: B }));
  g.add(box(0.0008, 0.012, 0.055, hole, 0.0172, B + 0.004, -0.02));
  g.add(ext([[-0.03, 0.0], [-0.034, -0.026, -0.02, -0.032], [0.03, -0.032], [0.046, -0.026, 0.05, 0.0]], 0.012, poly, { holes: [[[-0.022, -0.002], [-0.024, -0.02, -0.014, -0.025], [0.026, -0.025], [0.04, -0.02, 0.04, -0.002]]], bevel: 0.0015 }));
  g.add(ext([[0.01, -0.002], [0.004, -0.012, 0.011, -0.021], [0.015, -0.02], [0.011, -0.012, 0.015, -0.002]], 0.005, st, { bevel: 0.001 }));
  mag.add(ext([[-0.085, 0.0], [-0.085, -0.028], [-0.035, -0.028], [-0.035, 0.0]], 0.03, poly, { bevel: 0.002 }));
  mag.add(ext([[-0.087, -0.028], [-0.087, -0.034], [-0.033, -0.034], [-0.033, -0.028]], 0.032, poly, { bevel: 0.0012 }));
  g.add(mag);
  // barrel and compact brake
  g.add(lathe([[0.0125, -0.155], [0.0118, -0.24], [0.0105, -0.6]], park, { y: B, seg: 22 }));
  g.add(lathe([[0.0105, -0.6], [0.0138, -0.602], [0.0138, -0.632], [0.0125, -0.635]], park, { y: B }));
  for (let i = 0; i < 2; i++) for (const sx of [-1, 1]) g.add(box(0.001, 0.01, 0.008, hole, sx * 0.014, B, -0.612 - i * 0.012, 0));
  g.add(cyl(0.005, 0.001, hole, 0, B, -0.6355));
  boltHandle(g, B, 0.085);
  g.add(marking(['KESTREL · .308 WIN'], 0.05, 0.0055, -0.0174, B, -0.06));
  g.add(rail(0.2, al, { y: 0.09, z: -0.02 }));
  scope(g, 0.122, -0.27, 0.16, { rings: [-0.09, 0.04], base: 0.09, tube: 0.0127, obj: 0.023, bell: 0.1 });
  return finish(g, { muzzle: [0, B, -0.635], eject: [0.03, 0.07, -0.03], sightY: 0.122, fore: [0, 0.0, -0.3], grip: [0, -0.03, 0.08], kind: 'sniper' });
}

// ------------------------------------------------------------------ pistols

function pistolSights(slide, top, zr, zf, dark) {
  const dot = M.dot();
  slide.add(box(0.017, 0.0055, 0.008, dark, 0, top + 0.0027, zr));
  slide.add(box(0.0036, 0.0036, 0.0085, M.hole(), 0, top + 0.0042, zr));
  for (const sx of [-1, 1]) slide.add(box(0.0022, 0.0022, 0.0006, dot, sx * 0.0048, top + 0.0033, zr + 0.004));
  slide.add(box(0.0036, 0.0058, 0.006, dark, 0, top + 0.0029, zf));
  slide.add(box(0.0022, 0.0022, 0.0006, dot, 0, top + 0.0036, zf + 0.003));
  return top + 0.0056;
}

// polymer striker pistol frame: dust cover with a rail slot, squared guard, grip with finger grooves
function strikerFrame(g, zf, frameM, W, o = {}) {
  const frame = [
    [0.036, 0.035], [zf, 0.035], [zf, 0.019], [-0.07, 0.015],
    [-0.074, -0.018, -0.054, -0.024], [-0.022, -0.024], [-0.01, -0.022, -0.006, -0.012],
    [-0.004, -0.03], [0.0, -0.044, 0.006, -0.05], [0.004, -0.058, 0.01, -0.066], [0.008, -0.075, 0.014, -0.082], [0.019, -0.106],
    [0.059, -0.109], [0.056, -0.065], [0.047, -0.025, 0.052, 0.004], [0.06, 0.018], [0.052, 0.03], [0.036, 0.035],
  ];
  const guard = [[-0.062, 0.009], [-0.064, -0.014, -0.052, -0.017], [-0.02, -0.017], [-0.012, -0.015, -0.012, -0.004], [-0.014, 0.009]];
  g.add(ext(frame, W, frameM, { holes: [guard], bevel: 0.0026 }));
  for (let i = 0; i < 2; i++) g.add(box(W + 0.001, 0.0028, 0.004, M.hole(), 0, 0.0215, zf + 0.013 + i * 0.011, 0));
  // stippled grip panels
  for (const sx of [-1, 1]) g.add(ext([[0.014, -0.034], [0.02, -0.1], [0.052, -0.102], [0.048, -0.034], [0.044, -0.02]], 0.0012, M.stipple(), { x: sx * (W / 2 + 0.0005), bevel: 0.0004 }));
  // trigger with safety blade, slide stop, takedown lever
  g.add(ext([[-0.03, 0.01], [-0.036, -0.002, -0.029, -0.013], [-0.025, -0.012], [-0.029, -0.002, -0.025, 0.01]], 0.0055, o.triggerM || M.polymer(), { bevel: 0.0012 }));
  g.add(box(0.0016, 0.012, 0.0024, M.polymer(), 0, -0.004, -0.0295));
  g.add(box(0.0022, 0.0045, 0.022, M.nitride(), -W / 2 - 0.0008, 0.031, -0.03));
  for (const sx of [-1, 1]) g.add(box(0.0018, 0.004, 0.008, M.nitride(), sx * (W / 2 + 0.0006), 0.0255, -0.058));
  for (const z of [-0.01, 0.02]) g.add(pin(0.0018, W + 0.0012, M.nitride(), 0.026, z));
}

function buildGlock(o) {
  const g = new THREE.Group();
  const W = 0.0255, B = 0.05, top = 0.0645;
  const slideM = M.nitride(), dark = M.nitride(), hole = M.hole();
  const slide = named('slide');
  slide.add(loft([[0.038, top - 0.0005, 0.035, W], [0.034, top, 0.035, W], [-0.14, top, 0.035, W], [-0.147, top - 0.0015, 0.037, W - 0.001], [-0.152, top - 0.0045, 0.041, W - 0.003]], slideM, 6));
  for (let i = 0; i < 8; i++) slide.add(box(W + 0.0012, 0.02, 0.0016, slideM, 0, 0.049, 0.031 - i * 0.0038, 0));
  for (let i = 0; i < 5; i++) slide.add(box(W + 0.0008, 0.015, 0.0014, slideM, 0, 0.047, -0.124 - i * 0.0035, 0));
  slide.add(box(0.011, 0.0008, 0.03, hole, 0.0045, top + 0.0002, -0.018));
  slide.add(box(0.0008, 0.008, 0.03, hole, W / 2 + 0.0002, top - 0.004, -0.018));
  slide.add(box(0.0102, 0.0014, 0.028, M.steel(), 0.0045, top + 0.0003, -0.018, 0.0005));
  slide.add(box(0.0012, 0.004, 0.012, slideM, W / 2 + 0.0005, 0.057, -0.004));
  slide.add(box(0.012, 0.018, 0.0012, M.polymer(), 0, 0.049, 0.0385));
  slide.add(cyl(0.0068, 0.004, M.steel(), 0, B, -0.1505));
  slide.add(cyl(0.0046, 0.0012, hole, 0, B, -0.1525));
  slide.add(marking(['P9 STRIKER', '9x19'], 0.034, 0.009, -W / 2 - 0.0003, 0.048, -0.075));
  const sy = pistolSights(slide, top, 0.03, -0.143, dark);
  g.add(slide);
  strikerFrame(g, -0.136, M.polymer(), 0.0242);
  g.add(cyl(0.0042, 0.0022, M.polymer(), 0, 0.04, -0.137));
  const mag = named('mag');
  mag.add(ext([[0.018, -0.106], [0.016, -0.118], [0.063, -0.121], [0.06, -0.107]], 0.0245, M.polymer(), { bevel: 0.0016 }));
  g.add(mag);
  return finish(g, { muzzle: [0, B, -0.155], eject: [0.02, 0.066, -0.02], sightY: sy, fore: [-0.012, -0.03, 0.02], grip: [0, -0.02, 0.02], kind: 'pistol' });
}

function buildUSP(o) {
  const g = new THREE.Group();
  const W = 0.026, B = 0.051, top = 0.066;
  const slideM = M.nitride(), frameM = M.fde(), hole = M.hole(), st = M.steel();
  const slide = named('slide');
  slide.add(loft([[0.042, top - 0.001, 0.034, W], [0.038, top, 0.034, W], [-0.158, top, 0.034, W], [-0.166, top - 0.003, 0.036, W - 0.0015], [-0.171, top - 0.007, 0.039, W - 0.004]], slideM, 3.4));
  for (let i = 0; i < 9; i++) slide.add(box(W + 0.0008, 0.018, 0.0016, slideM, 0, 0.048, 0.035 - i * 0.0036, 0));
  slide.add(box(0.0008, 0.01, 0.034, hole, W / 2 + 0.0002, top - 0.006, -0.02));
  slide.add(box(0.0006, 0.007, 0.03, M.steel(), W / 2 + 0.0004, top - 0.006, -0.02));
  slide.add(cyl(0.0068, 0.004, st, 0, B, -0.1695));
  slide.add(cyl(0.0046, 0.0012, hole, 0, B, -0.1715));
  slide.add(marking(['WARDEN P2', '.45 AUTO'], 0.034, 0.009, -W / 2 - 0.0003, 0.046, -0.08));
  const sy = pistolSights(slide, top, 0.034, -0.162, slideM);
  g.add(slide);
  // exposed hammer and the frame-mounted decocker
  g.add(ext([[0.04, 0.046], [0.05, 0.056], [0.056, 0.06, 0.054, 0.064], [0.047, 0.062], [0.04, 0.054]], 0.008, st, { bevel: 0.0012 }));
  g.add(ext([[0.026, 0.028], [0.042, 0.03], [0.046, 0.022], [0.032, 0.018]], 0.003, slideM, { x: -(0.0125 + 0.0015), bevel: 0.0008 }));
  strikerFrame(g, -0.154, frameM, 0.025, { triggerM: slideM });
  for (const sx of [-1, 1]) g.add(box(0.001, 0.0022, 0.07, hole, sx * 0.0126, 0.028, -0.115, 0));
  g.add(cyl(0.0042, 0.0022, frameM, 0, 0.04, -0.155));
  const mag = named('mag');
  mag.add(ext([[0.018, -0.106], [0.016, -0.118], [0.063, -0.121], [0.06, -0.107]], 0.0255, M.polymer(), { bevel: 0.0016 }));
  g.add(mag);
  return finish(g, { muzzle: [0, B, -0.172], eject: [0.02, 0.066, -0.02], sightY: sy, fore: [-0.012, -0.03, 0.02], grip: [0, -0.02, 0.02], kind: 'pistol' });
}

function buildDeagle(o) {
  const g = new THREE.Group();
  const steel = M.color(o.body, 0.85, 0.3), dark = M.nitride(), hole = M.hole(), rub = M.rubber();
  const bore = 0.063;
  // fixed barrel: tall trapezoid section with the gas cylinder below the bore, rail and front sight on top
  g.add(prism([[-0.0175, 0.03], [0.0175, 0.03], [0.0175, 0.05], [0.0115, 0.08], [-0.0115, 0.08], [-0.0175, 0.05]], 0.19, steel, { z: -0.17, bevel: 0.0016 }));
  g.add(rail(0.15, steel, { y: 0.0895, z: -0.165 }));
  g.add(box(0.0042, 0.007, 0.008, dark, 0, 0.0925, -0.253));
  g.add(box(0.0022, 0.0022, 0.0006, M.dot(), 0, 0.0935, -0.2488));
  g.add(cyl(0.0078, 0.002, M.bright(), 0, bore, -0.2645));
  g.add(cyl(0.0064, 0.001, hole, 0, bore, -0.2658));
  g.add(marking(['MAGNUM .50 AE'], 0.07, 0.008, -0.0176, 0.042, -0.18));
  // slide at the rear with serrations, ambi safety levers, rear sight; exposed hammer
  const slide = named('slide');
  slide.add(loft([[0.048, 0.0835, 0.036, 0.033], [0.044, 0.084, 0.036, 0.034], [-0.07, 0.084, 0.036, 0.034], [-0.078, 0.081, 0.036, 0.033]], steel, 4.2));
  for (let i = 0; i < 10; i++) slide.add(box(0.0352, 0.024, 0.0018, steel, 0, 0.058, 0.04 - i * 0.004, 0));
  for (const sx of [-1, 1]) {
    slide.add(cyl(0.0068, 0.003, dark, sx * 0.0178, 0.068, 0.03, 'x', 16));
    slide.add(ext([[0.03, 0.066], [0.018, 0.064], [0.016, 0.07], [0.03, 0.072]], 0.003, dark, { x: sx * 0.0186, bevel: 0.0008 }));
  }
  slide.add(box(0.0008, 0.014, 0.04, hole, 0.0172, 0.07, -0.03));
  slide.add(box(0.022, 0.009, 0.01, dark, 0, 0.0885, 0.036));
  slide.add(box(0.0042, 0.0042, 0.0105, hole, 0, 0.0912, 0.036));
  g.add(slide);
  g.add(ext([[0.048, 0.052], [0.058, 0.066], [0.065, 0.07, 0.063, 0.075], [0.052, 0.07], [0.048, 0.062]], 0.01, dark, { bevel: 0.0014 }));
  // steel frame with the big squared trigger guard, slide release, trigger, mag release
  g.add(ext([[0.046, 0.036], [-0.13, 0.036], [-0.13, 0.024], [-0.086, 0.02], [-0.088, -0.006], [-0.087, -0.022, -0.074, -0.03], [-0.02, -0.03], [-0.01, -0.028, -0.006, -0.016], [0.0, -0.04], [0.012, -0.12], [0.066, -0.124], [0.062, -0.06], [0.052, -0.01, 0.062, 0.022], [0.062, 0.03], [0.05, 0.036]], 0.03, steel, { holes: [[[-0.078, 0.012], [-0.08, -0.016, -0.066, -0.022], [-0.02, -0.022], [-0.012, -0.019, -0.012, -0.004], [-0.014, 0.012]]], bevel: 0.0026 }));
  g.add(ext([[-0.03, 0.012], [-0.037, 0.0, -0.03, -0.012], [-0.026, -0.011], [-0.03, 0.0, -0.025, 0.012]], 0.006, dark, { bevel: 0.0012 }));
  g.add(ext([[-0.04, 0.03], [-0.004, 0.03], [0.0, 0.036], [-0.036, 0.038]], 0.003, dark, { x: -0.0165, bevel: 0.0008 }));
  g.add(cyl(0.0045, 0.003, dark, -0.0165, 0.006, -0.004, 'x', 12));
  // wraparound rubber grip with finger grooves
  g.add(ext([[0.002, -0.03], [0.0, -0.045, 0.008, -0.052], [0.006, -0.064, 0.012, -0.07], [0.01, -0.084, 0.016, -0.09], [0.018, -0.118], [0.064, -0.121], [0.06, -0.06], [0.054, -0.02], [0.006, -0.02]], 0.035, rub, { bevel: 0.004 }));
  const mag = named('mag');
  mag.add(ext([[0.014, -0.12], [0.012, -0.131], [0.07, -0.134], [0.067, -0.122]], 0.031, steel, { bevel: 0.0016 }));
  g.add(mag);
  return finish(g, { muzzle: [0, bore, -0.268], eject: [0.025, 0.08, -0.03], sightY: 0.0958, fore: [-0.012, -0.03, 0.02], grip: [0, -0.02, 0.022], kind: 'pistol' });
}

// ------------------------------------------------------------------ knife

// Clip-point blade: spine, fuller groove, flat grind to a fine edge; flat faces shade crisp.
function bladeGeometry() {
  const N = 26, pos = [];
  const L0 = -0.05, L1 = -0.238;
  const sec = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, z = L0 + (L1 - L0) * t;
    // spine: straight, then the clip swoops down to the tip; edge: straight, then curves up to the tip
    const spine = t < 0.62 ? 0.032 - t * 0.003 : 0.0301 - ((t - 0.62) / 0.38) ** 1.4 * 0.0181;
    const edge = t < 0.7 ? 0.0 + (t < 0.04 ? 0.004 * (1 - t / 0.04) : 0) : ((t - 0.7) / 0.3) ** 2 * 0.012;
    const tip = t >= 1 ? 1 : 0;
    const th = 0.0026 * (1 - t * 0.55) * (1 - tip);
    const grind = edge + (spine - edge) * 0.52;
    const fuller = t > 0.1 && t < 0.58 ? Math.sin(((t - 0.1) / 0.48) * Math.PI) : 0;
    sec.push({ z, spine: Math.max(spine, edge), edge, grind: Math.max(grind, edge), th, fuller, fy: edge + (spine - edge) * 0.72 });
  }
  // cross-section points (right side top -> bottom, then left side bottom -> top)
  const pts = (s) => {
    const f = s.th * (1 - s.fuller * 0.45);
    return [
      [s.th * 0.7, s.spine], [s.th, s.spine - 0.0012], [s.th, s.fy + 0.0025], [f, s.fy], [s.th, s.fy - 0.0025], [s.th, s.grind], [0.00025, s.edge],
      [-0.00025, s.edge], [-s.th, s.grind], [-s.th, s.fy - 0.0025], [-f, s.fy], [-s.th, s.fy + 0.0025], [-s.th, s.spine - 0.0012], [-s.th * 0.7, s.spine],
    ];
  };
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < N; i++) {
    const A = pts(sec[i]), Bp = pts(sec[i + 1]);
    const za = sec[i].z, zb = sec[i + 1].z;
    for (let k = 0; k < A.length; k++) {
      const k2 = (k + 1) % A.length;
      const a = [A[k][0], A[k][1], za], b = [A[k2][0], A[k2][1], za], c = [Bp[k2][0], Bp[k2][1], zb], d = [Bp[k][0], Bp[k][1], zb];
      tri(a, c, b); tri(a, d, c);
    }
  }
  // ricasso end cap
  const A = pts(sec[0]);
  for (let k = 1; k < A.length - 1; k++) tri([A[0][0], A[0][1], L0], [A[k][0], A[k][1], L0], [A[k + 1][0], A[k + 1][1], L0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return projectUV(geo);
}

function buildKnife() {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(bladeGeometry(), M.blade());
  g.add(blade);
  // cross guard, stacked leather washer handle with grooves, steel pommel
  g.add(loft([[-0.047, 0.037, -0.006, 0.013], [-0.05, 0.038, -0.007, 0.013]], M.steel(), 3.2));
  const secs = [];
  for (let i = 0; i <= 22; i++) {
    const z = -0.046 + i * (0.108 / 22);
    const bump = i % 2 === 0 ? 0 : 0.0009;
    const swell = Math.sin((i / 22) * Math.PI) * 0.0025;
    secs.push([z, 0.028 + swell - bump, 0.004 - swell * 0.6 + bump, 0.02 + swell * 0.8 - bump]);
  }
  g.add(loft(secs, M.color(0x5c3b22, 0.0, 0.62), 2.2));
  g.add(loft([[0.062, 0.03, 0.003, 0.021], [0.07, 0.029, 0.004, 0.02], [0.074, 0.025, 0.008, 0.016]], M.steel(), 2.6));
  return finish(g, { muzzle: [0, 0.02, -0.26], sightY: 0.02, grip: [0, 0.015, 0.01], kind: 'knife' });
}

// ------------------------------------------------------------------ grenades, breach charge, bomb

function grenadeFuze(g, bodyTop, bodyR, color) {
  const st = M.steel();
  g.add(lathe([[0.0085, bodyTop - 0.004], [0.0085, bodyTop + 0.012], [0.0065, bodyTop + 0.016], [0.0, bodyTop + 0.017]], st, { axis: 'y', seg: 16 }));
  g.add(box(0.012, 0.01, 0.014, st, 0.004, bodyTop + 0.008, 0));
  // spoon down the side
  g.add(ext([[0.008, bodyTop + 0.018], [0.014, bodyTop + 0.018], [bodyR + 0.007, bodyTop - 0.012, bodyR + 0.004, bodyTop - bodyR * 1.2], [bodyR + 0.001, bodyTop - bodyR * 1.25], [bodyR + 0.002, bodyTop - 0.012, 0.012, bodyTop + 0.014], [0.008, bodyTop + 0.014]], 0.011, color || M.color(0x5e6450, 0.4, 0.5), { bevel: 0.0008, rz: 0, ry: -Math.PI / 2 }));
  // safety pin and ring
  g.add(cyl(0.0012, 0.022, st, -0.002, bodyTop + 0.008, 0, 'z', 6));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0115, 0.0016, 8, 20), st);
  ring.position.set(-0.004, bodyTop + 0.009, -0.021);
  ring.rotation.y = Math.PI / 2;
  ring.name = 'pin';
  g.add(ring);
}

function buildBreach(o) {
  const g = new THREE.Group();
  const body = M.color(o.body, 0.2, 0.75);
  g.add(box(0.15, 0.1, 0.035, body, 0, 0, 0));
  g.add(box(0.13, 0.08, 0.012, M.color(0x8a7a52, 0, 0.9), 0, 0, 0.022));
  g.add(box(0.16, 0.02, 0.04, M.rubber(), 0, 0.03, 0));
  g.add(box(0.16, 0.02, 0.04, M.rubber(), 0, -0.03, 0));
  g.add(box(0.035, 0.03, 0.02, M.polymer(), 0.045, 0.0, 0.032));
  g.add(box(0.008, 0.008, 0.006, M.red(), 0.045, 0.012, 0.044));
  g.add(cyl(0.003, 0.08, M.color(0xb03020, 0, 0.6), -0.02, 0.0, 0.03, 'x', 5));
  return finish(g, { muzzle: [0, 0, 0], sightY: 0, grip: [0, 0, 0], kind: 'grenade' });
}

function buildGrenade(o, id) {
  if (id === 'breach') return buildBreach(o);
  const g = new THREE.Group();
  const hole = M.hole();
  if (id === 'frag') {
    const body = M.color(o.body, 0.2, 0.55);
    g.add(lathe([[0.0, -0.034], [0.012, -0.0335], [0.024, -0.028], [0.031, -0.016], [0.033, 0.0], [0.031, 0.014], [0.025, 0.025], [0.014, 0.032], [0.009, 0.033]], body, { axis: 'y', seg: 24 }));
    g.add(lathe([[0.0296, 0.016], [0.0288, 0.02]], M.color(0xd8b02a, 0.1, 0.5), { axis: 'y', seg: 24 }));
    grenadeFuze(g, 0.032, 0.033);
  } else if (id === 'flash') {
    const body = M.color(o.body, 0.8, 0.35);
    g.add(lathe([[0.0, -0.056], [0.019, -0.056], [0.0215, -0.052], [0.0215, 0.04], [0.019, 0.045], [0.009, 0.046]], body, { axis: 'y', seg: 24 }));
    for (let r = 0; r < 4; r++) for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + (r % 2) * 0.39;
      const h = cyl(0.0034, 0.002, hole, Math.cos(a) * 0.0214, -0.036 + r * 0.02, Math.sin(a) * 0.0214, 'x', 10);
      h.rotation.set(0, -a, Math.PI / 2);
      g.add(h);
    }
    grenadeFuze(g, 0.045, 0.0215, M.steel());
  } else {
    const body = M.color(o.body, 0.3, 0.55);
    g.add(lathe([[0.0, -0.058], [0.027, -0.058], [0.03, -0.054], [0.03, 0.046], [0.027, 0.05], [0.01, 0.051]], body, { axis: 'y', seg: 24 }));
    g.add(lathe([[0.0304, -0.01], [0.0304, 0.012]], M.color(0x99aa55, 0.1, 0.6), { axis: 'y', seg: 24 }));
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; g.add(cyl(0.0035, 0.002, hole, Math.cos(a) * 0.018, 0.0505, Math.sin(a) * 0.018, 'y', 10)); }
    grenadeFuze(g, 0.051, 0.03);
  }
  return finish(g, { muzzle: [0, 0, 0], sightY: 0, grip: [0, 0, 0], kind: 'grenade' });
}

function buildBomb() {
  const g = new THREE.Group();
  g.add(box(0.2, 0.08, 0.13, M.color(0x5a5245, 0.2, 0.7), 0, 0, 0));
  g.add(box(0.12, 0.012, 0.08, M.polymer(), 0.02, 0.046, 0));
  g.add(box(0.06, 0.004, 0.03, mat('bombscreen', { color: 0x102010, emissive: 0x30ff60, emissiveIntensity: 1.2 }), 0.03, 0.054, -0.015));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) g.add(box(0.012, 0.006, 0.012, M.color(0x999999, 0.2, 0.5), 0.0 + i * 0.018, 0.054, 0.012 + j * 0.014));
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), mat('bombled', { color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 4 }));
  led.position.set(-0.07, 0.05, -0.04);
  led.name = 'led';
  g.add(led);
  g.add(cyl(0.02, 0.2, M.color(0x7a2a20, 0.1, 0.6), 0, 0.0, 0.08, 'x'));
  g.add(cyl(0.02, 0.2, M.color(0x7a2a20, 0.1, 0.6), 0, 0.0, -0.08, 'x'));
  return finish(g, { muzzle: [0, 0, 0], sightY: 0, grip: [0, 0, 0], kind: 'bomb' });
}

// ------------------------------------------------------------------ factory

const BUILDERS = {
  knife: buildKnife, p9: buildGlock, p2k: buildUSP, deagle: buildDeagle, rattler: buildMP7, smg: buildMP5,
  shotgun: buildShotgun, marauder: buildGalil, ar: buildAK, m4: buildM4, scout: buildScout, awp: buildAWM, bomb: buildBomb,
};
const BY_KIND = { pistol: buildGlock, smg: buildMP5, rifle: buildM4, shotgun: buildShotgun, sniper: buildScout, bomb: buildBomb, knife: buildKnife };

export function createWeaponModel(id) {
  const w = WEAPONS[id];
  if (!w) return buildKnife();
  const o = w.model || {};
  if (o.kind === 'grenade') return buildGrenade(o, id);
  return (BUILDERS[id] || BY_KIND[o.kind] || buildKnife)(o);
}

// Shared template per weapon for cheap cloning (third-person / world drops)
const weaponCache = new Map();
export function weaponTemplate(id) {
  if (!weaponCache.has(id)) weaponCache.set(id, createWeaponModel(id));
  const t = weaponCache.get(id);
  const c = t.clone(true);
  c.userData = { ...t.userData };
  return c;
}

// Third-person / world weapon: the full weapon model flattened into one baked mesh (one draw call) that
// keeps each part's colour, roughness, metalness and surface detail type. Decals and glass are left out.
const SURF_OF = { metal: SURF.metal, polymer: SURF.polymer, wood: SURF.wood, rubber: SURF.rubber, fabric: SURF.fabric };
const bakedWeaponCache = new Map();
export function bakedWeapon(id) {
  if (!bakedWeaponCache.has(id)) {
    const src = createWeaponModel(id);
    src.updateMatrixWorld(true);
    const b = new Builder();
    src.traverse((m) => {
      if (!m.isMesh || !m.visible) return;
      const mt = m.material;
      if (mt.userData.decal || mt.transparent) return;
      const glow = mt.emissive && mt.emissiveIntensity > 0 && mt.emissive.getHex() !== 0 && mt.emissiveIntensity > 0.7;
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      if (!geo.attributes.normal) geo.computeVertexNormals();
      b.add(geo, {
        matrix: m.matrixWorld,
        color: glow && mt.color.getHex() === mt.emissive.getHex() ? mt.emissive.getHex() : mt.color.getHex(),
        rough: mt.roughness ?? 0.5, metal: mt.metalness ?? 0,
        emit: glow ? Math.min(3, mt.emissiveIntensity * (mt.emissive.r + mt.emissive.g + mt.emissive.b) / 3 * 2) : 0,
        tex: SURF_OF[mt.userData.surf] ?? SURF.none,
      });
    });
    bakedWeaponCache.set(id, { geo: b.build(false), info: { ...src.userData } });
  }
  const c = bakedWeaponCache.get(id);
  const mesh = new THREE.Mesh(c.geo, bakedMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { ...c.info };
  return mesh;
}
