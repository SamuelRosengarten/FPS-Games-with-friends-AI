// Camera lens pass (display space, last in the chain):
//
//  - Lens flare: glare, a starburst and ghost reflections when the sun is in view. Visibility is read
//    from the image itself (the blown-out sun disc), so walls and clouds in front of the sun hide it.
//  - Camera motion blur along the camera's rotation (optional in the normal view).
//  - BodyCam view (like body-worn police cameras and the game "Bodycam"): very wide fisheye lens with
//    barrel distortion and chromatic aberration, rolling-shutter skew on fast turns, a cheap sensor's
//    colours (flat, slightly green, clipped highlights, lifted blacks), noise that grows in the dark,
//    digital over-sharpening halos and a heavy lens vignette.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FS = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 uRes;
  uniform float uTime, uBody, uK, uFlare, uAspect, uRoll;
  uniform vec2 uBlur;           // motion blur extent (uv)
  uniform vec3 uSun;            // xy: sun position (uv), z: 1 when in front of the camera
  uniform vec3 uSunCol;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  // barrel distortion normalised so the frame corners stay the corners (the centre is magnified)
  vec2 barrel(vec2 uv, float k) {
    vec2 p = uv * 2.0 - 1.0;
    p.x *= uAspect;
    float r2 = dot(p, p);
    p *= (1.0 + k * r2) / (1.0 + k * (uAspect * uAspect + 1.0));
    p.x /= uAspect;
    return p * 0.5 + 0.5;
  }

  vec3 tap(vec2 uv, float j) {
#if BLUR
    vec3 s = vec3(0.0);
    for (int i = 0; i < 8; i++) s += texture2D(tDiffuse, uv + uBlur * ((float(i) + j) / 8.0 - 0.5)).rgb;
    return s / 8.0;
#else
    return texture2D(tDiffuse, uv).rgb;
#endif
  }

  void main() {
    float j = hash(gl_FragCoord.xy + fract(uTime * 7.0) * 61.0);
    vec2 uv = barrel(vUv, uK);
    uv.x += uRoll * (vUv.y - 0.5); // rolling shutter: rows are read out one after another
    vec3 c;
    if (uBody > 0.0) {
      // chromatic aberration grows towards the edges of the lens
      vec2 fromC = uv - 0.5;
      float ca = 0.006 * uBody * dot(fromC, fromC) * 4.0;
      c = vec3(tap(0.5 + fromC * (1.0 + ca), j).r, tap(uv, j).g, tap(0.5 + fromC * (1.0 - ca), j).b);
      // cheap digital sharpening: bright/dark halos along edges
      vec2 px = 1.0 / uRes;
      vec3 nb = texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(px.x, 0.0)).rgb
              + texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, uv - vec2(0.0, px.y)).rgb;
      c = max(c + (c - nb * 0.25) * 0.55 * uBody, 0.0);
    } else {
      c = tap(uv, j);
    }

    // lens flare
    if (uFlare > 0.0 && uSun.z > 0.5) {
      vec2 s = uSun.xy;
      float vis = 0.0;
      for (int i = 0; i < 5; i++) {
        float a = float(i) * 1.2566;
        vec2 o = i == 0 ? vec2(0.0) : vec2(cos(a), sin(a)) * 5.0 / uRes;
        vis += smoothstep(0.93, 1.0, luma(texture2D(tDiffuse, s + o).rgb));
      }
      vis /= 5.0;
      if (vis > 0.0) {
        vec2 d = uv - s;
        d.x *= uAspect;
        float r = length(d);
        vec3 fc = uSunCol;
        vec3 f = fc * 0.035 / (r * 9.0 + 0.08);                                   // glare
        float ang = atan(d.y, d.x);
        // starburst from the aperture blades and a horizontal streak: strong on the cheap body-camera lens
        f += fc * pow(abs(cos(ang * 3.0 + 0.4)), 40.0) * exp(-r * mix(10.0, 5.0, uBody)) * mix(0.12, 0.35, uBody);
        f += fc * exp(-abs(d.y) * 240.0) * exp(-abs(d.x) * mix(4.0, 2.2, uBody)) * mix(0.08, 0.18, uBody);
        // ghosts: reflections between the lens elements, along the line through the centre
        vec2 axis = vec2(0.5) - s;
        for (int i = 0; i < 5; i++) {
          float fi = float(i);
          float t = 0.45 + fi * 0.38;
          vec2 g = s + axis * t * 2.0;
          vec2 gd = uv - g;
          gd.x *= uAspect;
          float gr = 0.02 + 0.035 * fract(fi * 0.61 + 0.3);
          vec3 gc = mix(vec3(0.35, 0.6, 1.0), vec3(1.0, 0.55, 0.25), fract(fi * 0.37));
          f += gc * smoothstep(gr, gr * 0.55, length(gd)) * 0.05;
        }
        // a big faint halo ring around the centre
        vec2 hd = uv - 0.5; hd.x *= uAspect;
        f += vec3(0.5, 0.7, 1.0) * smoothstep(0.03, 0.0, abs(length(hd) - 0.42)) * 0.03 * smoothstep(0.7, 0.2, length(s - 0.5));
        c += f * vis * uFlare;
      }
    }

    if (uBody > 0.0) {
      float l = luma(c);
      c = mix(vec3(l), c, mix(1.0, 0.75, uBody));               // flat, washed-out colour
      c *= mix(vec3(1.0), vec3(0.95, 1.02, 0.99), uBody);        // cheap sensor's green cast
      c = mix(c, clamp(c * 1.14 - 0.02, 0.0, 1.0), uBody);       // punchy contrast, clipped highlights
      c = mix(c, 0.035 + c * 0.955, uBody);                      // milky blacks
      // sensor noise, strongest in the shadows (luma plus a little colour noise)
      vec2 np = floor(gl_FragCoord.xy / 1.5);
      float n = hash(np + fract(uTime * 37.0) * 113.0) - 0.5;
      vec3 nc = vec3(hash(np * 1.3 + fract(uTime * 29.0) * 57.0), hash(np * 0.7 + 3.1 + fract(uTime * 23.0) * 41.0), 0.5) - 0.5;
      c += (vec3(n) + vec3(nc.x, nc.y * 0.5, -nc.x) * 0.5) * (0.03 + 0.09 * (1.0 - clamp(l * 1.6, 0.0, 1.0))) * uBody;
      // heavy lens vignette and a dark rim where the lens barrel shows
      vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
      float rr = length(q) / length(vec2(uAspect, 1.0) * 0.5);
      c *= mix(1.0, (1.0 - 0.55 * smoothstep(0.35, 1.0, rr)) * smoothstep(1.08, 0.9, rr), uBody);
    }
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

export class LensPass extends Pass {
  constructor({ blur = false } = {}) {
    super();
    this.mat = new THREE.ShaderMaterial({
      defines: { BLUR: blur ? 1 : 0 },
      uniforms: {
        tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
        uBody: { value: 0 }, uK: { value: 0 }, uFlare: { value: 0 }, uAspect: { value: 16 / 9 }, uRoll: { value: 0 },
        uBlur: { value: new THREE.Vector2() }, uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color(1, 0.85, 0.65) },
      },
      vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }

  setSize(w, h) {
    this.mat.uniforms.uRes.value.set(w, h);
    this.mat.uniforms.uAspect.value = w / Math.max(1, h);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.mat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() { this.mat.dispose(); this.quad.dispose(); }
}
