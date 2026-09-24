// Temporal anti-aliasing and temporal upscaling (TAAU) — the same principle as DLSS / FSR 2 / XeSS,
// without the neural network (those can't be reached from a browser):
//
//  1. The world is rendered at an internal resolution (50% to 150% of native) with a different sub-pixel camera
//     jitter every frame (Halton 2,3 sequence).
//  2. Each output pixel reconstructs the current frame from the nearest internal samples, weighted by
//     their distance to the pixel centre, so the jitter sweeps real detail into the output over time.
//  3. Last frame's output (the history) is reprojected with depth and the previous camera matrix,
//     sampled with a sharp Catmull-Rom filter, and clipped against the current neighbourhood's colour
//     range (variance clipping in YCoCg) so moving objects and disocclusions don't ghost.
//  4. The two are blended in a tone-mapped space to avoid flicker; the result becomes the next history.
//
// Output is at display resolution. Fast-moving particles, tracers and smoke (fxScene) are drawn after the
// resolve at full resolution, un-jittered, so they never smear; the first-person weapon is drawn on top
// of everything afterwards with 4x MSAA.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { TAA_NOISE } from './atmosphere.js';

const RESOLVE_FS = /* glsl */`
  uniform sampler2D tCurrent;
  uniform sampler2D tDepth;
  uniform sampler2D tHistory;
  uniform vec2 uCurSize;       // internal resolution
  uniform vec2 uOutSize;       // output resolution
  uniform vec2 uJitter;        // this frame's jitter in internal pixels
  uniform mat4 uInvViewProj;   // current, un-jittered
  uniform mat4 uPrevViewProj;  // previous frame, un-jittered
  uniform float uHistoryValid;
  uniform float uFeedbackMin;
  uniform float uFeedbackMax;
  varying vec2 vUv;

  vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
  vec3 fromYCoCg(vec3 c) { float t = c.x - c.z; return vec3(t + c.y, c.x + c.z, t - c.y); }
  float maxc(vec3 c) { return max(c.r, max(c.g, c.b)); }
  vec3 tm(vec3 c) { return c / (1.0 + maxc(c)); }
  vec3 itm(vec3 c) { return c / max(1e-4, 1.0 - maxc(c)); }

  // 9-tap Catmull-Rom using bilinear fetches (sharp history resampling)
  vec3 historyCR(vec2 uv) {
    vec2 sp = uv * uOutSize;
    vec2 t1 = floor(sp - 0.5) + 0.5;
    vec2 f = sp - t1;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 t0 = (t1 - 1.0) / uOutSize, t3 = (t1 + 2.0) / uOutSize, t12 = (t1 + w2 / w12) / uOutSize;
    vec3 r = vec3(0.0);
    r += texture2D(tHistory, vec2(t0.x, t0.y)).rgb * w0.x * w0.y;
    r += texture2D(tHistory, vec2(t12.x, t0.y)).rgb * w12.x * w0.y;
    r += texture2D(tHistory, vec2(t3.x, t0.y)).rgb * w3.x * w0.y;
    r += texture2D(tHistory, vec2(t0.x, t12.y)).rgb * w0.x * w12.y;
    r += texture2D(tHistory, vec2(t12.x, t12.y)).rgb * w12.x * w12.y;
    r += texture2D(tHistory, vec2(t3.x, t12.y)).rgb * w3.x * w12.y;
    r += texture2D(tHistory, vec2(t0.x, t3.y)).rgb * w0.x * w3.y;
    r += texture2D(tHistory, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;
    r += texture2D(tHistory, vec2(t3.x, t3.y)).rgb * w3.x * w3.y;
    return max(r, vec3(0.0));
  }

  void main() {
    // this output pixel in the (jittered) internal image: the projection offset moves the image by
    // -jitter, so internal pixel t shows the scene at (t + 0.5 + jitter) / size
    vec2 p = (vUv - uJitter / uCurSize) * uCurSize - 0.5;
    vec2 base = floor(p + 0.5);
    float toOut = uOutSize.x / uCurSize.x; // output pixels per internal pixel
    vec3 sum = vec3(0.0), sumS = vec3(0.0);
    float wsum = 0.0, wmax = 0.0, wsumS = 0.0;
    vec3 m1 = vec3(0.0), m2 = vec3(0.0);
    float closest = 1.0;
    ivec2 lim = ivec2(uCurSize) - 1;
    // 3x3 internal pixels, or 5x5 when supersampling (internal pixels smaller than output pixels)
    for (int y = -RADIUS; y <= RADIUS; y++) {
      for (int x = -RADIUS; x <= RADIUS; x++) {
        vec2 t = base + vec2(float(x), float(y));
        ivec2 it = clamp(ivec2(t), ivec2(0), lim);
        vec3 c = max(texelFetch(tCurrent, it, 0).rgb, vec3(0.0));
        vec2 d = (t - p) * toOut;
        float w = exp(-2.3 * dot(d, d));
        sum += c * w; wsum += w; wmax = max(wmax, w);
        // wider kernel (in internal pixels) for disocclusions, so upscaled areas without history aren't blocky
        vec2 di = (t - p) * min(toOut, 1.0);
        float ws = exp(-2.3 * dot(di, di));
        sumS += c * ws; wsumS += ws;
        vec3 yc = toYCoCg(tm(c));
        m1 += yc; m2 += yc * yc;
        float z = texelFetch(tDepth, it, 0).r;
        if (z < closest) closest = z;
      }
    }
    vec3 cur = wsum > 1e-5 ? sum / wsum : max(texelFetch(tCurrent, clamp(ivec2(base), ivec2(0), lim), 0).rgb, vec3(0.0));
    vec3 curSmooth = wsumS > 1e-5 ? sumS / wsumS : cur;

    // reproject with the closest depth of the neighbourhood (keeps thin foreground edges)
    vec4 ndc = vec4(vUv * 2.0 - 1.0, closest * 2.0 - 1.0, 1.0);
    vec4 world = uInvViewProj * ndc;
    world /= world.w;
    vec4 prev = uPrevViewProj * world;
    vec2 prevUv = prev.xy / prev.w * 0.5 + 0.5;

    float valid = uHistoryValid;
    if (any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0)))) valid = 0.0;

    vec3 outc = curSmooth;
    if (valid > 0.5) {
      vec3 hist = historyCR(prevUv);
      // variance clipping of the history against the current neighbourhood
      const float N = float((2 * RADIUS + 1) * (2 * RADIUS + 1));
      vec3 mean = m1 / N;
      vec3 sigma = sqrt(max(m2 / N - mean * mean, vec3(0.0)));
      vec3 bmin = mean - sigma * 1.15, bmax = mean + sigma * 1.15;
      vec3 hy = toYCoCg(tm(hist));
      vec3 center = 0.5 * (bmax + bmin), ext = 0.5 * (bmax - bmin) + 1e-4;
      vec3 v = hy - center;
      vec3 a = abs(v / ext);
      float ma = max(a.x, max(a.y, a.z));
      if (ma > 1.0) hy = center + v / ma;
      // trust the current frame more where a sample lands close to this pixel, and after big motion
      float motion = length((prevUv - vUv) * uOutSize);
      float feedback = mix(uFeedbackMin, uFeedbackMax, clamp(wmax, 0.0, 1.0));
      feedback = min(1.0, feedback + clamp(motion * 0.01, 0.0, 0.15));
      vec3 blended = mix(hy, toYCoCg(tm(cur)), feedback);
      outc = itm(fromYCoCg(blended));
    }
    gl_FragColor = vec4(max(outc, vec3(0.0)), 1.0);
  }
`;

// Writes the (internal resolution) scene depth into the output target's depth buffer so effects drawn
// after the resolve are still hidden behind walls.
const DEPTH_FS = /* glsl */`
  uniform sampler2D tDepth;
  varying vec2 vUv;
  void main() { gl_FragDepth = texture2D(tDepth, vUv).r; gl_FragColor = vec4(0.0); }
`;

const COPY_FS = /* glsl */`
  uniform sampler2D tSrc;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tSrc, vUv); }
`;

// Composite a premultiplied (MSAA-resolved) overlay onto the frame.
const OVER_FS = /* glsl */`
  uniform sampler2D tSrc;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tSrc, vUv); }
`;

const VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}

const _vp = new THREE.Matrix4();

const _camPos = new THREE.Vector3();

// Replaces RenderPass (+ GTAO) at the start of the composer chain.
export class TemporalPass extends Pass {
  constructor(scene, camera, opts = {}) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.fxScene = opts.fxScene || null; // child scene of `scene` drawn after the resolve
    this.prevCamPos = new THREE.Vector3();
    this.needsSwap = true;
    this.scale = opts.scale ?? 1;   // internal / output resolution
    this.gtao = null;               // optional GTAOPass run at internal resolution
    this.lighting = null;           // optional ScreenLighting (volumetric light, reflections)
    this.frame = 0;
    this.outW = 1; this.outH = 1;
    this.inW = 1; this.inH = 1;
    const depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.aoRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.history = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }));
    this.hIdx = 0;
    this.historyValid = false;
    this.prevViewProj = new THREE.Matrix4();
    this.resolveMat = new THREE.ShaderMaterial({
      uniforms: {
        tCurrent: { value: null }, tDepth: { value: depthTexture }, tHistory: { value: null },
        uCurSize: { value: new THREE.Vector2(1, 1) }, uOutSize: { value: new THREE.Vector2(1, 1) },
        uJitter: { value: new THREE.Vector2() },
        uInvViewProj: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() },
        uHistoryValid: { value: 0 }, uFeedbackMin: { value: 0.06 }, uFeedbackMax: { value: 0.16 },
      },
      defines: { RADIUS: 1 },
      vertexShader: VS, fragmentShader: RESOLVE_FS, depthTest: false, depthWrite: false,
    });
    this.copyMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null } }, vertexShader: VS, fragmentShader: COPY_FS, depthTest: false, depthWrite: false });
    this.depthMat = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: depthTexture } }, vertexShader: VS, fragmentShader: DEPTH_FS,
      depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true, colorWrite: false,
    });
    this.quad = new FullScreenQuad(this.resolveMat);
  }

  setScale(s) {
    this.scale = Math.max(0.25, Math.min(2, s));
    this.setSize(this.outW, this.outH);
  }

  setSize(w, h) {
    const changedOut = w !== this.outW || h !== this.outH;
    this.outW = Math.max(1, Math.round(w));
    this.outH = Math.max(1, Math.round(h));
    this.inW = Math.max(1, Math.round(this.outW * this.scale));
    this.inH = Math.max(1, Math.round(this.outH * this.scale));
    this.sceneRT.setSize(this.inW, this.inH);
    this.aoRT.setSize(this.inW, this.inH);
    if (this.gtao) this.gtao.setSize(this.inW, this.inH);
    if (this.lighting) this.lighting.setSize(this.inW, this.inH);
    if (changedOut) {
      for (const h2 of this.history) h2.setSize(this.outW, this.outH);
      this.historyValid = false;
    }
    // Current-frame weight ranges from uFeedbackMin (no sample near this output pixel) to uFeedbackMax
    // (a sample right on it). When upscaling, most frames only have distant samples for a given output
    // pixel, so those frames count much less and the close hits build up the detail.
    const r = Math.min(1, this.scale);
    this.resolveMat.uniforms.uFeedbackMin.value = (0.05 + 0.03 * r) * r * r;
    this.resolveMat.uniforms.uFeedbackMax.value = 0.12 + 0.08 * r;
    const radius = this.scale > 1.05 ? 2 : 1;
    if (this.resolveMat.defines.RADIUS !== radius) {
      this.resolveMat.defines.RADIUS = radius;
      this.resolveMat.needsUpdate = true;
    }
  }

  reset() { this.historyValid = false; }

  render(renderer, writeBuffer) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    // a teleport (respawn, spectating someone else) makes the history useless
    cam.getWorldPosition(_camPos);
    if (_camPos.distanceToSquared(this.prevCamPos) > 6) this.historyValid = false;
    this.prevCamPos.copy(_camPos);
    TAA_NOISE.x = this.frame % 64;
    // un-jittered matrices for reprojection
    _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const invVP = this.resolveMat.uniforms.uInvViewProj.value.copy(_vp).invert();
    // jitter the projection by a sub-pixel offset of the internal grid
    const i = (this.frame % 16) + 1;
    const jx = halton(i, 2) - 0.5, jy = halton(i, 3) - 0.5;
    const pm = cam.projectionMatrix.elements;
    pm[8] += (jx * 2) / this.inW;
    pm[9] += (jy * 2) / this.inH;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

    const autoClear = renderer.autoClear;
    renderer.autoClear = true;
    const fx = this.fxScene;
    if (fx) fx.visible = false;
    TAA_NOISE.y = this.lighting?.ssr ? 1 : 0; // glossy materials write their reflectivity into alpha
    renderer.setRenderTarget(this.sceneRT);
    renderer.render(this.scene, cam);
    TAA_NOISE.y = 0;
    if (fx) fx.visible = true;
    renderer.autoClear = false; // the full-screen passes below must not clear their targets
    let color = this.sceneRT.texture;
    if (this.gtao) {
      this.gtao.render(renderer, this.aoRT, this.sceneRT);
      color = this.aoRT.texture;
    }
    if (this.lighting) color = this.lighting.render(renderer, cam, color, this.sceneRT.texture, this.sceneRT.depthTexture, this.frame);
    cam.updateProjectionMatrix(); // drop the jitter again

    // resolve into the next history buffer
    const src = this.history[this.hIdx], dst = this.history[1 - this.hIdx];
    const u = this.resolveMat.uniforms;
    u.tCurrent.value = color;
    u.tHistory.value = src.texture;
    u.uCurSize.value.set(this.inW, this.inH);
    u.uOutSize.value.set(this.outW, this.outH);
    u.uJitter.value.set(jx, jy);
    u.uPrevViewProj.value.copy(this.prevViewProj);
    u.uHistoryValid.value = this.historyValid ? 1 : 0;
    this.quad.material = this.resolveMat;
    renderer.setRenderTarget(dst);
    this.quad.render(renderer);
    // hand the frame to the rest of the chain
    this.copyMat.uniforms.tSrc.value = dst.texture;
    this.quad.material = this.copyMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    // particles, tracers and smoke at output resolution, depth-tested against the scene
    if (fx && fx.children.length) {
      this.quad.material = this.depthMat;
      this.quad.render(renderer);
      renderer.render(fx, cam);
    }
    renderer.autoClear = autoClear;

    this.hIdx = 1 - this.hIdx;
    this.historyValid = true;
    this.prevViewProj.copy(_vp);
    this.frame++;
    void invVP;
  }

  dispose() {
    this.sceneRT.dispose();
    this.aoRT.dispose();
    for (const h of this.history) h.dispose();
    this.resolveMat.dispose();
    this.copyMat.dispose();
    this.depthMat.dispose();
    this.quad.dispose();
    this.gtao?.dispose();
    this.lighting?.dispose();
    TAA_NOISE.x = 0;
    TAA_NOISE.y = 0;
  }
}

// Draws the first-person weapon into its own 4x MSAA target and composites it over the frame, so it
// stays sharp and anti-aliased even though the world uses TAA.
export class OverlayMSAAPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: this.rt.texture } }, vertexShader: VS, fragmentShader: OVER_FS,
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.quad = new FullScreenQuad(this.mat);
    this._clear = new THREE.Color();
  }
  setSize(w, h) { this.rt.setSize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); }
  render(renderer, writeBuffer, readBuffer) {
    const oldColor = renderer.getClearColor(this._clear), oldAlpha = renderer.getClearAlpha(), autoClear = renderer.autoClear;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(oldColor, oldAlpha);
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
    void writeBuffer;
  }
  dispose() { this.rt.dispose(); this.mat.dispose(); this.quad.dispose(); }
}
