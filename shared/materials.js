// Surface materials. `pen` is how hard a material is to shoot through per metre (Infinity = bulletproof).
// `surface` picks footstep / impact effects on the client.

export const MATERIALS = {
  sand:            { pen: Infinity, surface: 'sand' },
  dirt:            { pen: Infinity, surface: 'sand' },
  grass:           { pen: Infinity, surface: 'sand' },
  sandstone:       { pen: Infinity, surface: 'stone' },
  sandstoneDark:   { pen: Infinity, surface: 'stone' },
  sandstoneLight:  { pen: Infinity, surface: 'stone' },
  stoneTiles:      { pen: Infinity, surface: 'stone' },
  tiles:           { pen: Infinity, surface: 'stone' },
  plaster:         { pen: Infinity, surface: 'stone' },
  plasterDark:     { pen: Infinity, surface: 'stone' },
  brick:           { pen: Infinity, surface: 'stone' },
  concrete:        { pen: Infinity, surface: 'stone' },
  concreteDark:    { pen: Infinity, surface: 'stone' },
  asphalt:         { pen: Infinity, surface: 'stone' },
  sandbag:         { pen: Infinity, surface: 'sand' },
  roof:            { pen: Infinity, surface: 'stone' },
  crate:           { pen: 2.5, surface: 'wood' },
  crateDark:       { pen: 2.5, surface: 'wood' },
  wood:            { pen: 1.5, surface: 'wood' },
  woodPanel:       { pen: 0.8, surface: 'wood' },
  metal:           { pen: 5, surface: 'metal' },
  darkMetal:       { pen: 5, surface: 'metal' },
  containerRed:    { pen: 6, surface: 'metal' },
  containerBlue:   { pen: 6, surface: 'metal' },
  containerGreen:  { pen: 6, surface: 'metal' },
  containerYellow: { pen: 6, surface: 'metal' },
  lamp:            { pen: Infinity, surface: 'metal' },
};

export function materialInfo(name) {
  return MATERIALS[name] || { pen: Infinity, surface: 'stone' };
}
