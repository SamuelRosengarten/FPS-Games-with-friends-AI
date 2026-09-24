// Eye adaptation: the average brightness of the view (centre-weighted, in log space) sets a target
// exposure, and the actual exposure drifts towards it over a second or two — step from the sunny street
// into a dark room and it slowly opens up, step back out and it quickly settles down again. Adaptation
// is partial and clamped so rooms still read darker than outdoors and nothing gets washed out.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const METER_FS = /* glsl */`
  uniform sampler2D tSrc;
  uniform sampler2D tPrev;
  uniform float uDt, uKey, uStrength, uMin, uMax, uUp, uDown, uReset;
  uniform vec2 uOffset;
  varying vec2 vUv;
  void main() {
    float sum = 0.0, wsum = 0.0;
    for (int y = 0; y < 12; y++) {
      for (int x = 0; x < 16; x++) {
        vec2 uv = (vec2(float(x), float(y)) + uOffset) / vec2(16.0, 12.0);
        vec2 d = (uv - 0.5) * vec2(1.6, 1.2);
        float w = exp(-dot(d, d) * 2.5);
        float l = dot(texture2D(tSrc, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
        sum += log(max(l, 1e-4)) * w;
        wsum += w;
      }
    }
    float avg = exp(sum / wsum);
    float target = clamp(pow(uKey / avg, uStrength), uMin, uMax);
    float prev = texture2D(tPrev, vec2(0.5)).r;
    float rate = target > prev ? uUp : uDown;
    float e = uReset > 0.5 ? target : prev + (target - prev) * (1.0 - exp(-uDt * rate));
    gl_FragColor = vec4(e, avg, target, 1.0);
  }
`;

const APPLY_FS = /* glsl */`
  uniform sampler2D tSrc;
  uniform sampler2D tExp;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tSrc, vUv);
    gl_FragColor = vec4(c.rgb * texture2D(tExp, vec2(0.5)).r, c.a);
  }
`;

export class ExposurePass extends Pass {
  constructor(opts = {}) {
    super();
    this.needsSwap = true;
    this.lum = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
    this.idx = 0;
    this.frame = 0;
    this.meter = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: null }, tPrev: { value: null }, uOffset: { value: new THREE.Vector2(0.5, 0.5) },
        uDt: { value: 1 / 60 }, uReset: { value: 1 },
        uKey: { value: opts.key ?? 0.18 }, uStrength: { value: opts.strength ?? 0.55 },
        uMin: { value: opts.min ?? 0.8 }, uMax: { value: opts.max ?? 1.75 },
        uUp: { value: opts.up ?? 1.1 }, uDown: { value: opts.down ?? 2.6 },
      },
      vertexShader: VS, fragmentShader: METER_FS, depthTest: false, depthWrite: false,
    });
    this.apply = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, tExp: { value: null } }, vertexShader: VS, fragmentShader: APPLY_FS, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.meter);
  }

  // jump straight to the target exposure (new map, respawn)
  reset() { this.meter.uniforms.uReset.value = 1; }

  render(renderer, writeBuffer, readBuffer, deltaTime) {
    const src = this.lum[this.idx], dst = this.lum[1 - this.idx];
    const m = this.meter.uniforms;
    m.tSrc.value = readBuffer.texture;
    m.tPrev.value = src.texture;
    m.uDt.value = Math.min(0.1, deltaTime || 1 / 60);
    // a different sample grid every frame; the adaptation smooths it out
    this.frame++;
    m.uOffset.value.set((this.frame * 0.618034) % 1, (this.frame * 0.754878) % 1);
    this.quad.material = this.meter;
    renderer.setRenderTarget(dst);
    this.quad.render(renderer);
    m.uReset.value = 0;
    this.apply.uniforms.tSrc.value = readBuffer.texture;
    this.apply.uniforms.tExp.value = dst.texture;
    this.quad.material = this.apply;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    this.idx = 1 - this.idx;
  }

  // [exposure, average luminance, target] (debugging)
  read(renderer) {
    const out = new Float32Array(4);
    renderer.readRenderTargetPixels(this.lum[this.idx], 0, 0, 1, 1, out);
    return [...out.slice(0, 3)];
  }

  dispose() {
    for (const t of this.lum) t.dispose();
    this.meter.dispose();
    this.apply.dispose();
    this.quad.dispose();
  }
}
