// Texture generation worker: builds one material's texture data per message (see texgen.js).
import { generateTextureData } from './texgen.js';

self.onmessage = (e) => {
  const { id, name, size } = e.data;
  try {
    const d = generateTextureData(name, size);
    const buffers = [d.albedo.buffer, d.normal.buffer, d.rough.buffer];
    if (d.emissive) buffers.push(d.emissive.buffer);
    self.postMessage({ id, ...d }, buffers);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
