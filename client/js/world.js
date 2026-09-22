// Builds renderable meshes for a map: merged static geometry per material, breakable panels, lights, markings.

import * as THREE from 'three';

const STRIPS = [0, 0.35, 1.1, 2.4];

export class WorldView {
  constructor(graphics, textures, map) {
    this.g = graphics;
    this.tex = textures;
    this.map = map;
    this.group = new THREE.Group();
    this.panels = new Map(); // id -> { index }
    this.lights = [];
    this.build();
    graphics.scene.add(this.group);
  }

  dispose() {
    this.g.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }

  // 0 = open sky, 1 = under a roof
  roofedAt(x, z, y = 0) {
    const m = this.map;
    const c = Math.floor((x - m.x0) / m.cellSize), r = Math.floor((z - m.z0) / m.cellSize);
    if (r < 0 || c < 0 || r >= m.rows || c >= m.cols) return false;
    return m.roofed[r][c] && y < m.roofHeight;
  }

  isWallCell(r, c) {
    const m = this.map;
    if (r < 0 || c < 0 || r >= m.rows || c >= m.cols) return true;
    const ch = m.grid[r][c];
    return ch === '#' || ch === '%';
  }

  // Baked ambient term for a vertex.
  ambientAt(x, y, z, nx, ny, nz, kind) {
    let k = 1;
    // contact darkening near the floor on vertical faces
    if (ny === 0 && kind !== 'crate') k *= 0.62 + 0.38 * Math.min(1, Math.pow(y / 1.6, 0.7));
    else if (ny === 0) k *= 0.75 + 0.25 * Math.min(1, y / 0.8);
    // interiors
    const sx = x + nx * 0.25, sz = z + nz * 0.25;
    if (this.roofedAt(sx, sz, y - 0.01)) k *= ny < 0 ? 0.45 : 0.55;
    if (ny < 0) k *= 0.8; // undersides
    return k;
  }

  build() {
    const map = this.map;
    const byMat = new Map();
    const push = (mat) => {
      if (!byMat.has(mat)) byMat.set(mat, { pos: [], nor: [], uv: [], col: [], idx: [] });
      return byMat.get(mat);
    };

    for (const b of map.boxes) {
      if (b.destructible) continue;
      if (b.kind === 'ground') { this.buildGround(push(b.mat), b); continue; }
      const buf = push(b.mat);
      this.addBox(buf, b);
    }

    for (const [matName, buf] of byMat) {
      if (!buf.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
      geo.setIndex(buf.idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.tex.material(matName));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
    }

    this.buildPanels();
    this.buildLights();
    this.buildMarkings();
  }

  // Ground split into per-cell quads so it can carry baked shading.
  buildGround(buf, b) {
    const m = this.map;
    const cs = m.cellSize;
    const scale = this.tex.material(b.mat).userData.scale || 6;
    const shadeAt = (r, c) => {
      // r, c are corner indices; average the 4 cells around the corner
      let roof = 0, wall = 0;
      for (const [dr, dc] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
        const rr = r + dr, cc = c + dc;
        if (this.isWallCell(rr, cc)) wall++;
        else if (rr >= 0 && cc >= 0 && rr < m.rows && cc < m.cols && m.roofed[rr][cc]) roof++;
      }
      let k = 1 - wall * 0.1;
      const open = 4 - wall;
      if (open > 0) k *= 1 - (roof / open) * 0.45;
      return Math.max(0.35, k);
    };
    // corner shades
    const shades = [];
    for (let r = 0; r <= m.rows; r++) { shades.push([]); for (let c = 0; c <= m.cols; c++) shades[r].push(shadeAt(r, c)); }
    const base = buf.pos.length / 3;
    const W = m.cols + 1;
    for (let r = 0; r <= m.rows; r++) {
      for (let c = 0; c <= m.cols; c++) {
        const x = m.x0 + c * cs, z = m.z0 + r * cs;
        buf.pos.push(x, 0, z);
        buf.nor.push(0, 1, 0);
        buf.uv.push(x / scale, -z / scale);
        const k = shades[r][c];
        buf.col.push(k, k, k);
      }
    }
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        if (this.isWallCell(r, c)) continue; // hidden under walls
        const a = base + r * W + c, bb = a + 1, cc = a + W, d = cc + 1;
        buf.idx.push(a, cc, bb, bb, cc, d);
      }
    }
    // outer apron beyond the grid so the horizon isn't empty
    const ext = 600;
    const b0 = buf.pos.length / 3;
    const x0 = m.x0 - ext, x1 = m.x0 + m.cols * cs + ext, z0 = m.z0 - ext, z1 = m.z0 + m.rows * cs + ext;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      buf.pos.push(x, -0.02, z); buf.nor.push(0, 1, 0); buf.uv.push(x / scale, -z / scale); buf.col.push(0.9, 0.9, 0.9);
    }
    buf.idx.push(b0, b0 + 2, b0 + 1, b0 + 1, b0 + 2, b0 + 3);
  }

  addBox(buf, b) {
    const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    const matScale = this.tex.material(b.mat).userData.scale;
    const perFace = !matScale; // crates etc: 0..1 per face
    const sc = matScale || 1;
    const kind = b.kind;
    const faces = [];
    // +X, -X
    faces.push({ n: [1, 0, 0], corners: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], u: 'z', flipU: true });
    faces.push({ n: [-1, 0, 0], corners: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], u: 'z' });
    // +Z, -Z
    faces.push({ n: [0, 0, 1], corners: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], u: 'x' });
    faces.push({ n: [0, 0, -1], corners: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], u: 'x', flipU: true });
    // +Y
    faces.push({ n: [0, 1, 0], corners: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], top: true });
    // -Y (skip when resting on the ground)
    if (y0 > 0.01) faces.push({ n: [0, -1, 0], corners: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], top: true });

    for (const f of faces) {
      const [nx, ny, nz] = f.n;
      if (!f.top) {
        // split vertical faces into horizontal strips for smooth contact shading near the floor
        const hs = [y0];
        for (const s of STRIPS) if (s > y0 + 0.05 && s < y1 - 0.05 && y0 < 0.01) hs.push(s);
        hs.push(y1);
        const [c0, c1] = [f.corners[0], f.corners[1]];
        for (let i = 0; i < hs.length - 1; i++) {
          const ya = hs[i], yb = hs[i + 1];
          const quad = [[c0[0], ya, c0[2]], [c1[0], ya, c1[2]], [c1[0], yb, c1[2]], [c0[0], yb, c0[2]]];
          this.pushQuad(buf, quad, f, perFace, sc, kind, b);
        }
      } else {
        this.pushQuad(buf, f.corners, f, perFace, sc, kind, b);
      }
    }
  }

  pushQuad(buf, quad, f, perFace, sc, kind, b) {
    const [nx, ny, nz] = f.n;
    const base = buf.pos.length / 3;
    const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    for (const p of quad) {
      buf.pos.push(p[0], p[1], p[2]);
      buf.nor.push(nx, ny, nz);
      let u, v;
      if (perFace) {
        if (f.top) { u = (p[0] - x0) / (x1 - x0 || 1); v = (p[2] - z0) / (z1 - z0 || 1); }
        else if (f.u === 'x') { u = (p[0] - x0) / (x1 - x0 || 1); v = (p[1] - y0) / (y1 - y0 || 1); }
        else { u = (p[2] - z0) / (z1 - z0 || 1); v = (p[1] - y0) / (y1 - y0 || 1); }
        if (f.flipU) u = 1 - u;
      } else {
        if (f.top) { u = p[0] / sc; v = -p[2] / sc; }
        else if (f.u === 'x') { u = (f.flipU ? -p[0] : p[0]) / sc; v = p[1] / sc; }
        else { u = (f.flipU ? -p[2] : p[2]) / sc; v = p[1] / sc; }
      }
      buf.uv.push(u, v);
      const k = this.ambientAt(p[0], p[1], p[2], nx, ny, nz, kind);
      buf.col.push(k, k, k);
    }
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  buildPanels() {
    const ids = this.map.destructibles;
    if (!ids.length) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    // world-ish UVs are not possible with instancing; the plank texture reads fine per block
    const mat = this.tex.material('woodPanel').clone();
    mat.vertexColors = false;
    const mesh = new THREE.InstancedMesh(geo, mat, ids.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    this.panelBoxes = [];
    ids.forEach((id, i) => {
      const b = this.map.boxes.find((x) => x.id === id);
      this.panelBoxes.push(b);
      this.panels.set(id, { index: i, box: b, hp: 100 });
      this.setPanelMatrix(mesh, i, b, 1);
      const indoor = this.roofedAt((b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2, 1) ? 0.6 : 1;
      col.setScalar(indoor);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.panelMesh = mesh;
    this.group.add(mesh);
  }

  setPanelMatrix(mesh, i, b, s) {
    const m4 = new THREE.Matrix4();
    const sx = (b.max[0] - b.min[0]) * s, sy = (b.max[1] - b.min[1]) * s, sz = (b.max[2] - b.min[2]) * s;
    m4.makeScale(Math.max(sx, 1e-4), Math.max(sy, 1e-4), Math.max(sz, 1e-4));
    m4.setPosition((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    mesh.setMatrixAt(i, m4);
  }

  // Returns true if the panel was just destroyed.
  setPanelHp(id, hp) {
    const p = this.panels.get(id);
    if (!p || !this.panelMesh) return false;
    const was = p.hp;
    p.hp = hp;
    const b = p.box;
    const col = new THREE.Color();
    const indoor = this.roofedAt((b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2, 1) ? 0.6 : 1;
    if (hp <= 0) {
      this.setPanelMatrix(this.panelMesh, p.index, b, 0);
    } else {
      this.setPanelMatrix(this.panelMesh, p.index, b, 1);
      col.setScalar(indoor * (0.45 + 0.55 * (hp / 100)));
      this.panelMesh.setColorAt(p.index, col);
      if (this.panelMesh.instanceColor) this.panelMesh.instanceColor.needsUpdate = true;
    }
    this.panelMesh.instanceMatrix.needsUpdate = true;
    return was > 0 && hp <= 0;
  }

  resetPanels() {
    for (const [id] of this.panels) this.setPanelHp(id, 100);
  }

  buildLights() {
    const lampMat = this.tex.material('lamp');
    const geo = new THREE.BoxGeometry(1.1, 0.08, 0.35);
    for (const l of this.map.lights) {
      const light = new THREE.PointLight(l.color, l.intensity * 1.6, l.distance * 1.2, 1.6);
      light.position.set(l.x, l.y - 0.15, l.z);
      this.group.add(light);
      this.lights.push(light);
      const fixture = new THREE.Mesh(geo, lampMat);
      fixture.position.set(l.x, l.y + 0.2, l.z);
      fixture.material = lampMat;
      this.group.add(fixture);
    }
  }

  buildMarkings() {
    const zones = this.map.zones;
    for (const site of ['A', 'B']) {
      const z = zones[site];
      if (!z) continue;
      const cx = (z.min[0] + z.max[0]) / 2, cz = (z.min[2] + z.max[2]) / 2;
      const size = Math.min(z.max[0] - z.min[0], z.max[2] - z.min[2]) * 0.55;
      const tex = letterTexture(site);
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cx, 0.02, cz);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      // outline of the plant zone
      const w = z.max[0] - z.min[0], d = z.max[2] - z.min[2];
      const outline = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: zoneOutlineTexture(w / d), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }));
      outline.rotation.x = -Math.PI / 2;
      outline.position.set(cx, 0.015, cz);
      outline.receiveShadow = true;
      this.group.add(outline);
    }
  }
}

function letterTexture(ch) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.font = '900 200px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(220, 40, 30, 0.55)';
  g.fillText(ch, 128, 140);
  // spray paint speckle
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] > 0) img.data[i + 3] *= 0.7 + Math.random() * 0.3;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function zoneOutlineTexture(aspect) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.max(64, Math.round(512 / aspect));
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(230, 200, 60, 0.5)';
  g.lineWidth = 8;
  g.setLineDash([28, 18]);
  g.strokeRect(6, 6, c.width - 12, c.height - 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
