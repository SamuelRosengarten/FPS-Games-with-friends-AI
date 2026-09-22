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
import { Sky } from 'three/addons/objects/Sky.js';
import { makeCloudTexture } from './textures.js';

export const PRESETS = {
  low:    { label: 'Low',    pixelRatio: 0.75, shadows: 0,    ao: false, bloom: false, aa: 'none', msaa: 0, env: 0.55, particles: 0.5 },
  medium: { label: 'Medium', pixelRatio: 1.0,  shadows: 1024, ao: false, bloom: false, aa: 'fxaa', msaa: 0, env: 0.6, particles: 0.75 },
  high:   { label: 'High',   pixelRatio: 1.5,  shadows: 2048, ao: false, bloom: true,  aa: 'smaa', msaa: 0, env: 0.65, particles: 1 },
  ultra:  { label: 'Ultra',  pixelRatio: 2.0,  shadows: 4096, ao: true,  bloom: true,  aa: 'msaa', msaa: 4, env: 0.7, particles: 1 },
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
    this.renderScale = 1;
    // materials need recompiling when shadows toggle
    this.scene.traverse((o) => { if (o.material) { const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach((m) => { m.needsUpdate = true; }); } });
    this.buildComposer();
    this.resize();
  }

  basePixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(dpr, this.preset.pixelRatio) * (this.s.maxRenderScale || 1);
  }

  buildComposer() {
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      for (const pass of this.composer.passes) pass.dispose?.();
    }
    const p = this.preset;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: p.msaa });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = null;
    if (p.ao) {
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
    if (p.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.92);
      composer.addPass(this.bloom);
    }
    composer.addPass(new OutputPass());
    if (p.aa === 'smaa') composer.addPass(new SMAAPass());
    else if (p.aa === 'fxaa') composer.addPass(new FXAAPass());
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
    if (this.sky) { scene.remove(this.sky); this.sky.material.dispose(); }
    if (this.clouds) { scene.remove(this.clouds); }
    if (this.envTex) { this.envTex.dispose(); this.envTex = null; }

    const sd = new THREE.Vector3(...th.sun.dir).normalize();
    // sky
    const sky = new Sky();
    sky.scale.setScalar(2800);
    const u = sky.material.uniforms;
    const skyCfg = th.sky || {};
    u.turbidity.value = skyCfg.turbidity ?? 6;
    u.rayleigh.value = skyCfg.rayleigh ?? 1.6;
    u.mieCoefficient.value = skyCfg.mie ?? 0.005;
    u.mieDirectionalG.value = skyCfg.mieG ?? 0.8;
    u.sunPosition.value.copy(sd);
    sky.userData.noAO = true;
    sky.frustumCulled = false;
    this.sky = sky;
    scene.add(sky);

    // environment map from the sky (image based lighting + reflections)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(100);
    Object.assign(envSky.material.uniforms.turbidity, { value: u.turbidity.value });
    envSky.material.uniforms.rayleigh.value = u.rayleigh.value;
    envSky.material.uniforms.mieCoefficient.value = u.mieCoefficient.value;
    envSky.material.uniforms.mieDirectionalG.value = u.mieDirectionalG.value;
    envSky.material.uniforms.sunPosition.value.copy(sd);
    envScene.add(envSky);
    // a ground disc so the lower hemisphere isn't black
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: th.hemi.ground }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    envScene.add(ground);
    const envRT = pmrem.fromScene(envScene, 0.02);
    this.envTex = envRT.texture;
    scene.environment = this.envTex;
    scene.environmentIntensity = this.preset.env * (th.envIntensity ?? 1);
    this.vmScene.environment = this.envTex;
    this.vmScene.environmentIntensity = 0.7;
    pmrem.dispose();
    envSky.material.dispose();

    // clouds
    if (!this.cloudTex) this.cloudTex = makeCloudTexture(512);
    const clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, depthWrite: false, fog: false, opacity: th.cloudOpacity ?? 0.8, color: th.cloudColor ?? 0xffffff }),
    );
    clouds.material.map.repeat.set(5, 5);
    clouds.rotation.x = Math.PI / 2;
    clouds.position.y = 220;
    clouds.renderOrder = -1;
    clouds.userData.noAO = true;
    this.clouds = clouds;
    scene.add(clouds);

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
    this.hemi.intensity = th.hemi.intensity * 0.55;
    scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
    scene.background = new THREE.Color(th.fog);
    this.renderer.toneMappingExposure = th.exposure ?? 1;
    // viewmodel lighting follows the map mood
    this.vmHemi.color.set(th.hemi.sky);
    this.vmHemi.groundColor.set(th.hemi.ground);
    this.vmSun.color.set(th.sun.color);
    this.themeHemi = th.hemi.intensity;
    this.themeSun = th.sun.intensity;
  }

  // indoor = 0..1 how much the player is under a roof (dims the viewmodel lighting)
  setViewmodelLight(indoor) {
    const k = 1 - indoor * 0.55;
    this.vmHemi.intensity = (this.themeHemi || 1) * 1.1 * k;
    this.vmSun.intensity = (this.themeSun || 2.5) * 0.75 * (1 - indoor * 0.8);
  }

  // ---------------------------------------------------------------- frame
  render(dt) {
    this.updateDynamicRes(dt);
    if (this.clouds) this.clouds.material.map.offset.x += dt * 0.002;
    this.composer.render(dt);
  }

  updateDynamicRes(dt) {
    const ms = dt * 1000;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) { this.fps = this.fpsFrames / this.fpsTime; this.fpsFrames = 0; this.fpsTime = 0; }
    if (!this.s.dynamicRes || ms > 250) return;
    this.frameEma += (ms - this.frameEma) * 0.08;
    const now = performance.now();
    if (this.frameEma > 18.2) {
      this.slowTime += dt;
      this.fastTime = 0;
      if (this.slowTime > 0.35 && this.renderScale > 0.5) {
        this.renderScale = Math.max(0.5, this.renderScale * 0.88);
        this.slowTime = 0;
        this.lastDrop = now;
        this.frameEma = 16.7;
        this.resize();
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

  resolutionLabel() {
    const c = this.canvas;
    return `${c.width}×${c.height}`;
  }
}
