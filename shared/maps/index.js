import { buildMap } from './builder.js';
import sandstone from './sandstone.js';
import compound from './compound.js';
import arena from './arena.js';
import embassy from './embassy.js';

export const MAP_DEFS = [sandstone, compound, embassy, arena];

const cache = new Map();

export function getMap(id) {
  if (!cache.has(id)) {
    const def = MAP_DEFS.find((m) => m.id === id) || MAP_DEFS[0];
    cache.set(id, buildMap(def));
  }
  return cache.get(id);
}

// Fresh copy (destructible state is mutated per match).
export function loadMap(id) {
  const def = MAP_DEFS.find((m) => m.id === id) || MAP_DEFS[0];
  return buildMap(def);
}

export function mapList() {
  return MAP_DEFS.map((m) => ({ id: m.id, name: m.name, desc: m.desc, modes: m.modes }));
}
