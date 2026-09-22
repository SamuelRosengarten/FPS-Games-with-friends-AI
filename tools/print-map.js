// Prints a map grid with zones overlaid. Usage: node tools/print-map.js [mapId]
import { loadMap, MAP_DEFS } from '../shared/maps/index.js';
const ids = process.argv[2] ? [process.argv[2]] : MAP_DEFS.map((m) => m.id);
for (const id of ids) {
  const m = loadMap(id);
  console.log(`\n== ${m.name} (${m.cols}x${m.rows} cells, ${m.boxes.length} boxes, ${m.destructibles.length} breakable panels)`);
  const rows = m.grid.map((r) => r.split(''));
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) if (m.roofed[r][c] && rows[r][c] === '.') rows[r][c] = ':';
  console.log('    ' + [...Array(m.cols).keys()].map((c) => (c % 10)).join(''));
  rows.forEach((r, i) => console.log(String(i).padStart(3) + ' ' + r.join('')));
  console.log('spawns att', m.spawns[1].length, 'def', m.spawns[2].length, 'ffa', m.spawns.ffa.length);
}
