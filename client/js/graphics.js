// Renderer, quality presets, post-processing, sky / lighting and dynamic resolution.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// targetMP: megapixels the preset aims to render at the start (dynamic resolution then probes up/down)
export const PRESETS = {
  low:    { label: 'Low',    pixelRatio: 0.75, shadows: 0,    ao: false, bloom: false, aa: 'none', msaa: 0, env: 0.5, particles: 0.5, targetMP: 1.2, grade: false },
  medium: { label: 'Medium', pixelRatio: 1.0,  shadows: 1024, ao: false, bloom: false, aa: 'fxaa', msaa: 0, env: 0.45, particles: 0.75, targetMP: 2.2, grade: true },
  high:   { label: 'High',   pixelRatio: 1.5,  shadows: 2048, ao: false, bloom: true,  aa: 'smaa', msaa: 0, env: 0.45, particles: 1, targetMP: 3.5, grade: true },
  ultra:  { label: 'Ultra',  pixelRatio: 2.0,  shadows: 4096, ao: true,  bloom: true,  aa: 'msaa', msaa: 4, env: 0.5, particles: 1, targetMP: 5.2, grade: true },
};

// Steps taken, in order, when even the minimum render scale can't hold 60 FPS.
const FALLBACKS = ['ao', 'bloom', 'msaa', 'shadows'];

const SKY_VS = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p;
  }
`;
const SKY_FS = /* glsl */`
  uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor, uCloudColor;
  uniform float uCloudCover, uTime, uIntensity, uSunSize;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.45)) : mix(uHorizon, uBottom, pow(min(1.0, -h * 4.0), 0.6));
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(sd, 5.0) * 0.18 + pow(sd, 48.0) * 0.5);
    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.12) * 1.3 + vec2(uTime * 0.006, uTime * 0.002);
      float n = fbm(uv);
      float c = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.32, n);
      c *= smoothstep(0.0, 0.22, h);
      float n2 = fbm(uv + uSunDir.xz * 0.12);
      float shade = clamp((n - n2) * 3.0 + 0.75, 0.45, 1.15);
      vec3 cc = uCloudColor * shade * (0.9 + 0.5 * pow(sd, 6.0));
      col = mix(col, cc, c * 0.92);
    }
    col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.55, sd) * 14.0;
    gl_FragColor = vec4(col * uIntensity, 1.0);
  }
`;

function makeSky(theme, radius) {
  const lin = (hex) => new THREE.Color(hex);
  const sd = new THREE.Vector3(...theme.sun.dir).normalize();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: lin(theme.skyTop) },
      uHorizon: { value: lin(theme.skyHorizon) },
      uBottom: { value: lin(theme.skyBottom) },
      uSunDir: { value: sd },
      uSunColor: { value: lin(theme.sun.color).multiplyScalar(1.0) },
      uCloudColor: { value: lin(theme.cloudColor ?? 0xffffff) },
      uCloudCover: { value: theme.cloudCover ?? 0.4 },
      uTime: { value: 0 },
      uIntensity: { value: theme.skyIntensity ?? 1.0 },
      uSunSize: { value: 0.0009 },
    },
    vertexShader: SKY_VS,
    fragmentShader: SKY_FS,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.userData.noAO = true;
  return mesh;
}

// Display-space color grading: lift/gain tint, contrast, saturation, vignette, film grain, low-health desaturation.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uContrast: { value: 1.05 },
    uSaturation: { value: 1.05 },
    uVignette: { value: 0.28 },
    uGrain: { value: 0.025 },
    uTime: { value: 0 },
    uHurt: { value: 0 },
    uCA: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 uLift, uGain;
    uniform float uContrast, uSaturation, uVignette, uGrain, uTime, uHurt, uCA;
    varying vec2 vUv;
    void main() {
      // slight lateral chromatic aberration towards the frame edges, like a real lens
      vec2 cd = vUv - 0.5;
      vec2 co = cd * dot(cd, cd) * 0.014 * (uCA + uHurt * 1.5);
      vec3 c = vec3(texture2D(tDiffuse, vUv + co).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - co).b);
      c = c * uGain + uLift * (1.0 - c);
      c = (c - 0.5) * uContrast + 0.5;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation * (1.0 - uHurt * 0.7));
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.82);
      float v = smoothstep(0.78, 0.2, length(d));
      c *= mix(1.0 - uVignette - uHurt * 0.35, 1.0, v);
      c.r += uHurt * (1.0 - v) * 0.18;
      float n = fract(sin(dot(vUv * (fract(uTime) * 91.7 + 1.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      c += n * uGrain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

// Hide sprites / transparent effects from the AO g-buffer.
GTAOPass.prototype._overrideVisibility = function () {
  const cache = this._visibilityCache;
  this.scene.traverse((o) => {
    if (!o.visible) return;
    if (o.isPoints || o.isLine || o.isSprite || o.userData.noAO || (o.material && o.material.transparent)) {
      o.visible = false;
      cache.push(o);
    }
  });
};

// Draws the first-person weapon on top of the world (after AO, before bloom/tonemapping).
class OverlayPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
    this.clear = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }
}

export function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { return ''; }
}

export function detectQuality(renderer) {
  const g = gpuName(renderer).toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(g)) return 'low';
  if (/apple m[1-9] (pro|max|ultra)|apple m[3-9]/.test(g)) return 'ultra';
  if (/apple/.test(g)) return 'ultra'; // Safari reports "Apple GPU"; dynamic resolution keeps it smooth
  if (/rtx|radeon rx [5-9]\d{3}|rx 6\d{3}|rx 7\d{3}|arc a7/.test(g)) return 'ultra';
  if (/gtx|radeon|rx |arc/.test(g)) return 'high';
  if (/intel|uhd|iris|mali|adreno/.test(g)) return 'medium';
  return 'high';
}

export class Graphics {
  constructor(container, settings) {
    this.s = settings;
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.info.autoReset = false; // we reset once per frame so the counters cover every pass
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.gpu = gpuName(renderer);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.04, 3000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(settings.viewmodelFov, 1, 0.01, 20);

    this.renderScale = 1;
    this.frameEma = 16.7;
    this.slowTime = 0;
    this.fastTime = 0;
    this.lastDrop = 0;
    this.fps = 60;
    this.fpsFrames = 0;
    this.fpsTime = 0;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x8a6d4a, 0.9);
    this.scene.add(this.hemi);
    // viewmodel lights
    this.vmHemi = new THREE.HemisphereLight(0xffffff, 0x666666, 1.2);
    this.vmSun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.vmSun.position.set(0.6, 1, 0.4);
    this.vmScene.add(this.vmHemi, this.vmSun);
    this.vmFlash = new THREE.PointLight(0xffc070, 0, 3, 1.5);
    this.vmFlash.position.set(0.1, -0.05, -0.8);
    this.vmScene.add(this.vmFlash);

    this.applyQuality();
    window.addEventListener('resize', () => this.resize());
  }

  get quality() { return this.qualityName; }

  applyQuality() {
    let q = this.s.quality;
    if (q === 'auto' || !PRESETS[q]) q = detectQuality(this.renderer);
    this.qualityName = q;
    this.preset = PRESETS[q];
    const p = this.preset;
    this.renderer.shadowMap.enabled = p.shadows > 0;
    this.sun.castShadow = p.shadows > 0;
    if (p.shadows) {
      this.sun.shadow.mapSize.set(p.shadows, p.shadows);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.degrade = 0;
    this.renderScale = this.initialScale();
    // materials need recompiling when shadows toggle
    this.scene.traverse((o) => { if (o.material) { const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach((m) => { m.needsUpdate = true; }); } });
    this.buildComposer();
    this.resize();
  }

  basePixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(dpr, this.preset.pixelRatio) * (this.s.maxRenderScale || 1);
  }

  // Start below full resolution on very large / Retina screens so the first seconds are smooth.
  initialScale() {
    if (!this.s.dynamicRes) return 1;
    const pr = this.basePixelRatio();
    const mp = (window.innerWidth * pr) * (window.innerHeight * pr) / 1e6;
    return Math.max(0.55, Math.min(1, Math.sqrt(this.preset.targetMP / Math.max(mp, 0.1))));
  }

  // Is a feature still active after automatic fallbacks?
  feature(name) {
    const i = FALLBACKS.indexOf(name);
    return i < 0 || this.degrade <= i;
  }

  buildComposer() {
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      for (const pass of this.composer.passes) pass.dispose?.();
    }
    const p = this.preset;
    const msaa = this.feature('msaa') ? p.msaa : 0;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: msaa });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = null;
    if (p.ao && this.feature('ao')) {
      const gtao = new GTAOPass(this.scene, this.camera, 1, 1);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.9;
      gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.5, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      const origSize = gtao.setSize.bind(gtao);
      gtao.setSize = (w, h) => origSize(Math.max(1, Math.floor(w * 0.6)), Math.max(1, Math.floor(h * 0.6)));
      composer.addPass(gtao);
      this.gtao = gtao;
    }
    this.overlay = new OverlayPass(this.vmScene, this.vmCamera);
    composer.addPass(this.overlay);
    this.bloom = null;
    if (p.bloom && this.feature('bloom')) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.92);
      composer.addPass(this.bloom);
    }
    composer.addPass(new OutputPass());
    this.grade = null;
    if (p.grade) {
      this.grade = new ShaderPass(GradeShader);
      this.grade.uniforms.uCA.value = p.pixelRatio >= 1.5 ? 1 : 0;
      if (this.gradeCfg) this.applyGrade(this.gradeCfg);
      composer.addPass(this.grade);
    }
    const aa = p.aa === 'msaa' && !msaa ? 'fxaa' : p.aa;
    if (aa === 'smaa') composer.addPass(new SMAAPass());
    else if (aa === 'fxaa') composer.addPass(new FXAAPass());
    this.composer = composer;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.basePixelRatio() * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.vmCamera.aspect = w / h;
    this.setFov(this.baseFov || this.s.fov);
    this.vmCamera.updateProjectionMatrix();
  }

  // Horizontal FOV defined at 16:9, converted to the vertical FOV three.js uses.
  setFov(hfov16x9, zoom = 1) {
    this.baseFov = hfov16x9;
    const v = 2 * Math.atan(Math.tan((hfov16x9 * Math.PI) / 360) / (16 / 9));
    const vz = 2 * Math.atan(Math.tan(v / 2) * zoom);
    const deg = (vz * 180) / Math.PI;
    if (Math.abs(this.camera.fov - deg) > 1e-4) {
      this.camera.fov = deg;
      this.camera.updateProjectionMatrix();
    }
    this.vfovRad = vz;
  }

  setViewmodelFov(f) {
    this.vmCamera.fov = f;
    this.vmCamera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- environment
  setupEnvironment(map) {
    const th = map.theme;
    const scene = this.scene;
    if (this.sky) { scene.remove(this.sky); this.sky.material.dispose(); this.sky.geometry.dispose(); }
    if (this.envTex) { this.envTex.dispose(); this.envTex = null; }

    const sd = new THREE.Vector3(...th.sun.dir).normalize();
    const sky = makeSky(th, 2500);
    this.sky = sky;
    scene.add(sky);

    // environment map from the sky (image based lighting + reflections)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = makeSky({ ...th, cloudCover: (th.cloudCover ?? 0.4) * 0.6 }, 100);
    envScene.add(envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 24), new THREE.MeshBasicMaterial({ color: th.hemi.ground }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -3;
    envScene.add(ground);
    const envRT = pmrem.fromScene(envScene, 0.03);
    this.envTex = envRT.texture;
    scene.environment = this.envTex;
    scene.environmentIntensity = this.preset.env * (th.envIntensity ?? 1);
    this.vmScene.environment = this.envTex;
    this.vmScene.environmentIntensity = 0.6;
    pmrem.dispose();
    envSky.material.dispose();
    envSky.geometry.dispose();

    // lights
    const b = map.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const half = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 4;
    this.sun.color.set(th.sun.color);
    this.sun.intensity = th.sun.intensity;
    this.sun.position.set(cx + sd.x * 120, sd.y * 120, cz + sd.z * 120);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 10; sc.far = 320;
    sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2;
    this.hemi.color.set(th.hemi.sky);
    this.hemi.groundColor.set(th.hemi.ground);
    this.hemi.intensity = th.hemi.intensity * 0.4;
    scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
    scene.background = new THREE.Color(th.fog);
    this.renderer.toneMappingExposure = th.exposure ?? 1;
    // viewmodel lighting follows the map mood
    this.vmHemi.color.set(th.hemi.sky);
    this.vmHemi.groundColor.set(th.hemi.ground);
    this.vmSun.color.set(th.sun.color);
    this.themeHemi = th.hemi.intensity;
    this.themeSun = th.sun.intensity;
    this.applyGrade(th.grade || {});
  }

  applyGrade(g) {
    this.gradeCfg = g;
    if (!this.grade) return;
    const u = this.grade.uniforms;
    u.uLift.value.set(...(g.lift || [0, 0, 0]));
    u.uGain.value.set(...(g.gain || [1, 1, 1]));
    u.uContrast.value = g.contrast ?? 1.05;
    u.uSaturation.value = g.saturation ?? 1.05;
    u.uVignette.value = g.vignette ?? 0.28;
    u.uGrain.value = g.grain ?? 0.02;
  }

  // 0..1 low-health effect (desaturation + red vignette)
  setHurt(v) { if (this.grade) this.grade.uniforms.uHurt.value = v; }

  // indoor = 0..1 how much the player is under a roof (dims the viewmodel lighting)
  setViewmodelLight(indoor) {
    const k = 1 - indoor * 0.5;
    this.vmHemi.intensity = (this.themeHemi || 1) * 0.75 * k;
    this.vmSun.intensity = (this.themeSun || 2.5) * 0.45 * (1 - indoor * 0.8);
  }

  // ---------------------------------------------------------------- frame
  render(dt) {
    this.renderer.info.reset();
    this.updateDynamicRes(dt);
    if (this.grade) this.grade.uniforms.uTime.value += dt;
    if (this.sky) {
      this.sky.material.uniforms.uTime.value += dt;
      this.sky.position.copy(this.camera.position);
    }
    this.composer.render(dt);
  }

  updateDynamicRes(dt) {
    const ms = dt * 1000;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) { this.fps = this.fpsFrames / this.fpsTime; this.fpsFrames = 0; this.fpsTime = 0; }
    if (!this.s.dynamicRes || ms > 100) return; // ignore hitches (shader compiles, tab switches)
    this.frameEma += (ms - this.frameEma) * 0.08;
    const now = performance.now();
    const MIN = 0.5;
    if (this.frameEma > 18.2) {
      this.slowTime += dt;
      this.fastTime = 0;
      if (this.slowTime > 0.35 && this.renderScale > MIN) {
        this.renderScale = Math.max(MIN, this.renderScale * 0.88);
        this.slowTime = 0;
        this.lastDrop = now;
        this.frameEma = 16.7;
        this.resize();
      } else if (this.slowTime > 2 && this.renderScale <= MIN && this.degrade < FALLBACKS.length) {
        // still too slow at the lowest resolution: switch off the most expensive effect
        this.degrade++;
        this.slowTime = 0;
        this.frameEma = 16.7;
        this.lastDrop = now;
        if (FALLBACKS[this.degrade - 1] === 'shadows' && this.preset.shadows > 1024) {
          const size = this.preset.shadows / 2;
          this.sun.shadow.mapSize.set(size, size);
          if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
        }
        this.buildComposer();
        this.renderScale = 0.75;
        this.resize();
        console.info(`[breachpoint] performance fallback: disabled ${FALLBACKS[this.degrade - 1]}`);
      }
    } else {
      this.slowTime = 0;
      if (this.frameEma < 17.0 && this.renderScale < 1) {
        this.fastTime += dt;
        const wait = now - this.lastDrop < 12000 ? 6 : 2;
        if (this.fastTime > wait) {
          this.renderScale = Math.min(1, this.renderScale * 1.07);
          this.fastTime = 0;
          this.resize();
        }
      } else this.fastTime = 0;
    }
  }

  perfLabel() {
    const info = this.renderer.info.render;
    const off = FALLBACKS.slice(0, this.degrade);
    return `${Math.round(this.fps)} FPS · ${this.quality.toUpperCase()}${off.length ? ` (−${off.join(', −')})` : ''} · ${this.resolutionLabel()} (${Math.round(this.renderScale * 100)}%) · ${info.calls} calls · ${Math.round(info.triangles / 1000)}k tris`;
  }

  resolutionLabel() {
    const c = this.canvas;
    return `${c.width}×${c.height}`;
  }
}
