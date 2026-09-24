// Lighting and atmosphere upgrades applied as global shader-chunk patches plus an environment probe:
//
//  - Aerial perspective: the fog is tinted towards the sun's colour when looking at the sun and thins
//    out with altitude, so distant hills are hazy at their base and crisp at the top.
//  - Contact-hardening soft shadows (PCSS) on the sun: sharp where an object touches the ground,
//    wider and softer the further the shadow falls from its caster (Ultra only).
//  - An environment probe captured from the finished map, so ambient light and reflections come from
//    the real surroundings (sunlit sand and walls bounce warm light) instead of only the sky.

import * as THREE from 'three';

// Frame index for the shadow filter's noise. With temporal anti-aliasing on, the renderer bumps it every
// frame so the rotated Poisson pattern changes and the TAA history averages it into a smooth penumbra.
// A plain {x, y} object is shared by reference when three.js clones the built-in material uniforms,
// so one write reaches every lit material.
export const TAA_NOISE = { x: 0, y: 0 };
for (const lib of Object.values(THREE.ShaderLib)) {
  if (lib.fragmentShader?.includes('#include <shadowmap_pars_fragment>')) lib.uniforms.uTaaNoise = { value: TAA_NOISE };
}

const ORIGINAL = {
  fog_pars_vertex: THREE.ShaderChunk.fog_pars_vertex,
  fog_vertex: THREE.ShaderChunk.fog_vertex,
  fog_pars_fragment: THREE.ShaderChunk.fog_pars_fragment,
  fog_fragment: THREE.ShaderChunk.fog_fragment,
  shadowmap_pars_fragment: THREE.ShaderChunk.shadowmap_pars_fragment,
};

const f = (v) => (Number.isFinite(v) ? v.toFixed(5) : '0.0');
const v3 = (a) => `vec3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;

function patchFog(o) {
  THREE.ShaderChunk.fog_pars_vertex = `${ORIGINAL.fog_pars_vertex}
#ifdef USE_FOG
  varying vec3 vFogDir;
#endif`;
  THREE.ShaderChunk.fog_vertex = `${ORIGINAL.fog_vertex}
#ifdef USE_FOG
  vFogDir = transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `${ORIGINAL.fog_pars_fragment}
#ifdef USE_FOG
  varying vec3 vFogDir;
  #define ATMO_SUN_DIR ${v3(o.sunDir)}
  #define ATMO_SUN_COL ${v3(o.sunCol)}
  #define ATMO_H0 ${f(o.h0)}
  #define ATMO_H1 ${f(o.h1)}
  #define ATMO_HMIN ${f(o.hMin)}
#endif`;
  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 atmoDir = normalize( vFogDir );
  float atmoH = cameraPosition.y + vFogDir.y;
  fogFactor *= mix( 1.0, ATMO_HMIN, smoothstep( ATMO_H0, ATMO_H1, atmoH ) );
  float atmoSun = pow( max( dot( atmoDir, ATMO_SUN_DIR ), 0.0 ), 6.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor + ATMO_SUN_COL * atmoSun, fogFactor );
#endif`;
}

// PCSS for the (orthographic) sun shadow: blocker search, penumbra from the blocker distance, then a
// rotated Poisson-disk filter of that width. Replaces the PCF_SOFT branch of getShadow().
function patchShadows(o) {
  const src = ORIGINAL.shadowmap_pars_fragment;
  if (!o) { THREE.ShaderChunk.shadowmap_pars_fragment = src; return; }
  const a = src.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )');
  const b = src.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )');
  if (a < 0 || b < 0) { THREE.ShaderChunk.shadowmap_pars_fragment = src; return; }
  const helpers = `
  #define PCSS_DEPTH_RANGE ${f(o.depthRange)}
  #define PCSS_FRUSTUM ${f(o.frustum)}
  #define PCSS_SUN_SIZE ${f(o.sunSize)}
  #define PCSS_TEXELS ${f(o.texels)}
  uniform vec2 uTaaNoise;
  const vec2 pcssDisk[24] = vec2[](
    vec2(-0.613, 0.617), vec2(0.171, -0.041), vec2(-0.299, 0.791), vec2(0.645, 0.493),
    vec2(-0.652, 0.718), vec2(0.422, -0.024), vec2(-0.108, -0.414), vec2(0.163, 0.891),
    vec2(-0.915, -0.221), vec2(0.505, -0.673), vec2(-0.263, -0.945), vec2(0.853, -0.217),
    vec2(-0.453, 0.063), vec2(0.037, 0.491), vec2(-0.781, -0.574), vec2(0.931, 0.284),
    vec2(0.254, -0.388), vec2(-0.129, 0.189), vec2(0.617, 0.083), vec2(-0.404, -0.531),
    vec2(0.321, 0.588), vec2(-0.861, 0.339), vec2(0.021, -0.771), vec2(0.742, -0.521)
  );
  float pcssShadow( sampler2D shadowMap, vec2 shadowMapSize, vec3 coord ) {
    vec2 texel = 1.0 / shadowMapSize;
    float ang = fract( 52.9829189 * fract( dot( gl_FragCoord.xy + 5.588238 * uTaaNoise.x, vec2( 0.06711056, 0.00583715 ) ) ) ) * 6.2831853;
    mat2 rot = mat2( cos( ang ), sin( ang ), - sin( ang ), cos( ang ) );
    // blocker search over the region a sun-sized light could be hidden behind
    // (limits are in 4096-map texels, so a bigger map gives the same penumbra, only finer)
    float searchR = clamp( PCSS_SUN_SIZE * 12.0 / PCSS_FRUSTUM, 3.0 * texel.x, 16.0 * PCSS_TEXELS * texel.x );
    float sum = 0.0, n = 0.0;
    for ( int i = 0; i < 12; i ++ ) {
      vec2 off = rot * pcssDisk[ i * 2 ] * searchR;
      float d = unpackRGBAToDepth( texture2D( shadowMap, coord.xy + off ) );
      if ( d < coord.z ) { sum += d; n += 1.0; }
    }
    if ( n < 0.5 ) return 1.0;
    if ( n > 11.5 ) return 0.0; // the whole search region is behind a caster: deep shadow
    float blockerDist = ( coord.z - sum / n ) * PCSS_DEPTH_RANGE; // metres between caster and receiver
    float r = clamp( blockerDist * PCSS_SUN_SIZE / PCSS_FRUSTUM, 1.3 * texel.x, 10.0 * PCSS_TEXELS * texel.x );
    float lit = 0.0;
    for ( int i = 0; i < 24; i ++ ) lit += texture2DCompare( shadowMap, coord.xy + rot * pcssDisk[ i ] * r, coord.z );
    return lit / 24.0;
  }
`;
  const branch = `#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			shadow = pcssShadow( shadowMap, shadowMapSize, shadowCoord.xyz );
		`;
  let out = src.slice(0, a) + branch + src.slice(b);
  // helpers go right before getShadow()
  const g = out.indexOf('float getShadow(');
  out = out.slice(0, g) + helpers + out.slice(g);
  THREE.ShaderChunk.shadowmap_pars_fragment = out;
}

// Apply the per-map settings. Materials compiled with the old chunks are flagged for recompiling.
export function applyAtmosphere(graphics, map, { pcss }) {
  const th = map.theme;
  const sd = new THREE.Vector3(...th.sun.dir).normalize();
  const sc = new THREE.Color(th.sun.color).multiplyScalar(0.45 * Math.min(1.5, (th.sun.intensity || 3) / 3));
  patchFog({ sunDir: [sd.x, sd.y, sd.z], sunCol: [sc.r, sc.g, sc.b], h0: 3, h1: th.fogHeight ?? 70, hMin: 0.45 });
  const cam = graphics.sun.shadow.camera;
  const texels = graphics.sun.shadow.mapSize.x / 4096;
  patchShadows(pcss ? { depthRange: cam.far - cam.near, frustum: cam.right - cam.left, sunSize: th.sunSize ?? 0.025, texels } : null);
  for (const scene of [graphics.scene, graphics.vmScene]) {
    scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
  }
}

// Pick an open, unroofed spot near the middle of the map for the environment probe.
export function probeSpot(map) {
  const cx = map.cols / 2, cr = map.rows / 2;
  let best = null, bestScore = -Infinity;
  const open = (r, c) => {
    if (r < 0 || c < 0 || r >= map.rows || c >= map.cols) return false;
    const ch = map.grid[r][c];
    return (ch === '.' || ch === ',') && !map.roofed[r][c];
  };
  for (let r = 1; r < map.rows - 1; r++) {
    for (let c = 1; c < map.cols - 1; c++) {
      if (!open(r, c)) continue;
      let o = 0;
      for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) if (open(r + dr, c + dc)) o++;
      const score = o - Math.hypot(r - cr, c - cx) * 0.6;
      if (score > bestScore) { bestScore = score; best = [r, c]; }
    }
  }
  if (!best) best = [Math.floor(cr), Math.floor(cx)];
  return new THREE.Vector3(map.x0 + (best[1] + 0.5) * map.cellSize, 3.5, map.z0 + (best[0] + 0.5) * map.cellSize);
}
