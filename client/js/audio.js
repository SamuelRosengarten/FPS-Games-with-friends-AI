// Procedural sound engine: every sound is synthesised with WebAudio (no asset files).

import { WEAPONS } from '../shared/weapons.js';

export class AudioEngine {
  constructor(settings) {
    this.s = settings;
    this.ctx = null;
    this.active = 0;
    this.listener = { x: 0, y: 0, z: 0 };
    this.ambient = null;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 8;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.2;
    this.master.connect(this.muffle).connect(this.comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.ui = ctx.createGain();
    this.ui.connect(this.master);
    // reverb send
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(1.8, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.55;
    this.reverb.connect(this.reverbGain).connect(this.sfx);
    // noise buffers
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.pink = ctx.createBuffer(1, len, ctx.sampleRate);
    const pd = this.pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      pd[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    this.applyVolume();
    if (ctx.listener.positionX) {
      ctx.listener.positionX.value = 0;
    }
  }

  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = this.s.volume;
    this.sfx.gain.value = this.s.sfxVolume;
    this.ui.gain.value = this.s.uiVolume;
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return buf;
  }

  get now() { return this.ctx.currentTime; }

  setListener(pos, fwd, up = [0, 1, 0]) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    this.listener.x = pos[0]; this.listener.y = pos[1]; this.listener.z = pos[2];
    const t = this.now;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos[0], t, 0.01);
      l.positionY.setTargetAtTime(pos[1], t, 0.01);
      l.positionZ.setTargetAtTime(pos[2], t, 0.01);
      l.forwardX.setTargetAtTime(fwd[0], t, 0.01);
      l.forwardY.setTargetAtTime(fwd[1], t, 0.01);
      l.forwardZ.setTargetAtTime(fwd[2], t, 0.01);
      l.upX.value = up[0]; l.upY.value = up[1]; l.upZ.value = up[2];
    } else {
      l.setPosition(pos[0], pos[1], pos[2]);
      l.setOrientation(fwd[0], fwd[1], fwd[2], up[0], up[1], up[2]);
    }
  }

  dist(pos) {
    if (!pos) return 0;
    return Math.hypot(pos[0] - this.listener.x, pos[1] - this.listener.y, pos[2] - this.listener.z);
  }

  // Output node for a sound at `pos` (null = 2D, attached to the listener).
  out(pos, { ref = 3, rolloff = 1.15, reverb = 0, bus = null, maxDist = 160 } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let last = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = ref;
      p.rolloffFactor = rolloff;
      p.maxDistance = maxDist;
      if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; }
      else p.setPosition(pos[0], pos[1], pos[2]);
      g.connect(p);
      last = p;
      const d = this.dist(pos);
      // walls between us and the source muffle it (0 = clear, 1 = fully blocked)
      const occ = d > 1.5 && this.occlusion ? this.occlusion(pos) : 0;
      let cutoff = d > 18 ? Math.max(700, 16000 / (1 + (d - 18) / 9)) : 20000;
      if (occ > 0) cutoff = Math.min(cutoff, 16000 * (1 - occ) + 650 * occ);
      if (cutoff < 19000) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = cutoff;
        last.connect(lp);
        last = lp;
      }
      if (occ > 0) {
        const og = ctx.createGain();
        og.gain.value = 1 - 0.5 * occ;
        last.connect(og);
        last = og;
      }
    }
    last.connect(bus || this.sfx);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      last.connect(s).connect(this.reverb);
    }
    return g;
  }

  noiseSrc(buf = this.noise) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = buf.duration;
    return src;
  }

  env(gainNode, t, attack, peak, decay, curve = 'exp') {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    if (curve === 'exp') g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    else g.linearRampToValueAtTime(0, t + attack + decay);
  }

  // noise burst through a filter
  burst(dest, t, { type = 'bandpass', freq = 1000, q = 1, attack = 0.002, peak = 1, decay = 0.1, buf = this.noise, sweepTo = null, rate = 1 } = {}) {
    const ctx = this.ctx;
    const src = this.noiseSrc(buf);
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, attack, peak, decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay + 0.05);
    return src;
  }

  tone(dest, t, { type = 'sine', freq = 440, to = null, attack = 0.002, peak = 0.5, decay = 0.2, detune = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
    o.detune.value = detune;
    const g = ctx.createGain();
    this.env(g, t, attack, peak, decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
    return o;
  }

  ok() { return this.ctx && this.ctx.state === 'running' && this.active < 64; }

  track(sec) {
    this.active++;
    setTimeout(() => this.active--, sec * 1000 + 100);
  }

  // ---------------------------------------------------------------- weapons
  gunshot(weaponId, pos, local = false) {
    if (!this.ok()) return;
    const w = WEAPONS[weaponId];
    const s = w?.sound || { freq: 1400, len: 0.2, low: 0.8, vol: 0.9 };
    const t = this.now;
    const d = this.dist(pos);
    const vol = (s.vol || 1) * (local ? 0.55 : 0.8);
    const out = this.out(local ? null : pos, { ref: 6, rolloff: 0.9, reverb: local ? 0.22 : 0.35 + Math.min(0.5, d / 80) });
    out.gain.value = vol;
    const pitch = 1 + (Math.random() - 0.5) * 0.08;
    // sharp crack
    this.burst(out, t, { type: 'highpass', freq: 2400 * pitch, q: 0.7, attack: 0.0008, peak: 1.4, decay: 0.035 });
    // body
    this.burst(out, t, { type: 'bandpass', freq: s.freq * pitch, q: 0.9, attack: 0.001, peak: 1.6, decay: s.len, sweepTo: s.freq * 0.45 });
    this.burst(out, t, { type: 'lowpass', freq: 900, q: 0.5, attack: 0.002, peak: 1.2 * s.low, decay: s.len * 1.4, buf: this.pink, rate: 0.7 });
    // thump
    this.tone(out, t, { type: 'sine', freq: 150 * pitch, to: 42, attack: 0.001, peak: 0.9 * s.low, decay: 0.12 + s.low * 0.05 });
    // mechanical
    if (local) this.tone(out, t + 0.03, { type: 'square', freq: 2400, to: 1800, attack: 0.0005, peak: 0.04, decay: 0.03 });
    this.track(s.len + 0.3);
  }

  dryFire() {
    if (!this.ok()) return;
    const t = this.now, out = this.out(null);
    out.gain.value = 0.4;
    this.tone(out, t, { type: 'square', freq: 1800, to: 1200, attack: 0.0005, peak: 0.25, decay: 0.03 });
    this.burst(out, t, { type: 'highpass', freq: 3000, peak: 0.4, decay: 0.02 });
    this.track(0.1);
  }

  reload(weaponId, pos, local = true) {
    if (!this.ok()) return;
    const w = WEAPONS[weaponId];
    if (!w || !w.reload) return;
    const t = this.now;
    const out = this.out(local ? null : pos, { ref: 2, rolloff: 1.6 });
    out.gain.value = local ? 0.45 : 0.6;
    const T = w.reload;
    const click = (at, f, v = 0.5) => {
      this.burst(out, t + at, { type: 'bandpass', freq: f, q: 4, attack: 0.001, peak: v, decay: 0.05 });
      this.tone(out, t + at, { type: 'triangle', freq: f * 0.5, to: f * 0.3, attack: 0.001, peak: v * 0.3, decay: 0.04 });
    };
    if (w.type === 'shotgun') {
      for (let i = 0; i < 4; i++) click(0.3 + i * (T - 0.8) / 4, 1500, 0.4);
      click(T - 0.35, 900, 0.7); click(T - 0.2, 1300, 0.6);
    } else {
      click(T * 0.18, 1100, 0.5);          // mag out
      click(T * 0.55, 1600, 0.6);          // mag in
      click(T * 0.62, 2200, 0.35);
      click(T * 0.82, 900, 0.7);           // bolt / slide
      click(T * 0.86, 1400, 0.5);
    }
    this.track(T + 0.2);
  }

  deploy(local = true) {
    if (!this.ok()) return;
    const t = this.now, out = this.out(null);
    out.gain.value = 0.25;
    this.burst(out, t, { type: 'bandpass', freq: 1800, q: 3, peak: 0.5, decay: 0.06 });
    this.burst(out, t + 0.12, { type: 'bandpass', freq: 1200, q: 3, peak: 0.4, decay: 0.05 });
    this.track(0.3);
  }

  knifeSwing(pos) {
    if (!this.ok()) return;
    const t = this.now, out = this.out(pos, { ref: 2, rolloff: 2 });
    out.gain.value = 0.5;
    this.burst(out, t, { type: 'bandpass', freq: 900, q: 1.5, attack: 0.05, peak: 0.7, decay: 0.16, sweepTo: 3500 });
    this.track(0.3);
  }

  knifeHit(pos, flesh = true) {
    if (!this.ok()) return;
    const t = this.now, out = this.out(pos, { ref: 2, rolloff: 1.5 });
    out.gain.value = 0.8;
    if (flesh) {
      this.burst(out, t, { type: 'lowpass', freq: 700, peak: 1, decay: 0.12 });
      this.tone(out, t, { freq: 110, to: 60, peak: 0.6, decay: 0.1 });
    } else {
      this.burst(out, t, { type: 'bandpass', freq: 3200, q: 6, peak: 0.8, decay: 0.12 });
      this.tone(out, t, { type: 'triangle', freq: 2600, to: 2400, peak: 0.25, decay: 0.2 });
    }
    this.track(0.3);
  }

  // ---------------------------------------------------------------- movement
  footstep(surface, pos, vol = 1, local = false) {
    if (!this.ok()) return;
    const t = this.now;
    const out = this.out(local ? null : pos, { ref: 2.5, rolloff: 1.4, maxDist: 40 });
    out.gain.value = vol * (local ? 0.28 : 0.9);
    const r = 0.9 + Math.random() * 0.2;
    switch (surface) {
      case 'metal':
        this.burst(out, t, { type: 'bandpass', freq: 2600 * r, q: 5, peak: 0.6, decay: 0.09 });
        this.tone(out, t, { type: 'triangle', freq: 420 * r, to: 380, peak: 0.25, decay: 0.12 });
        break;
      case 'wood':
        this.burst(out, t, { type: 'bandpass', freq: 700 * r, q: 2, peak: 0.9, decay: 0.07 });
        this.tone(out, t, { freq: 140 * r, to: 90, peak: 0.4, decay: 0.07 });
        break;
      case 'sand':
        this.burst(out, t, { type: 'lowpass', freq: 1100 * r, q: 0.6, attack: 0.008, peak: 0.8, decay: 0.09, buf: this.pink });
        this.burst(out, t + 0.015, { type: 'highpass', freq: 3500, peak: 0.12, decay: 0.05 });
        break;
      default:
        this.burst(out, t, { type: 'bandpass', freq: 1500 * r, q: 1.2, peak: 0.7, decay: 0.05 });
        this.tone(out, t, { freq: 90 * r, to: 60, peak: 0.45, decay: 0.06 });
    }
    this.track(0.2);
  }

  land(surface, pos, strength = 1, local = false) {
    if (!this.ok()) return;
    const t = this.now;
    const out = this.out(local ? null : pos, { ref: 2.5, rolloff: 1.4, maxDist: 40 });
    out.gain.value = Math.min(1, 0.4 + strength * 0.08) * (local ? 0.4 : 1);
    this.burst(out, t, { type: 'lowpass', freq: surface === 'metal' ? 2200 : 800, peak: 1, decay: 0.12 });
    this.tone(out, t, { freq: 80, to: 45, peak: 0.7, decay: 0.12 });
    this.track(0.25);
  }

  jump(pos, local = false) {
    if (!this.ok()) return;
    const t = this.now;
    const out = this.out(local ? null : pos, { ref: 2, rolloff: 1.5, maxDist: 30 });
    out.gain.value = local ? 0.15 : 0.5;
    this.burst(out, t, { type: 'bandpass', freq: 600, q: 1, peak: 0.5, decay: 0.06 });
    this.track(0.15);
  }

  // ---------------------------------------------------------------- impacts
  impact(surface, pos) {
    if (!this.ok() || this.active > 48) return;
    const t = this.now;
    const out = this.out(pos, { ref: 1.5, rolloff: 1.8, maxDist: 50 });
    out.gain.value = 0.35;
    if (surface === 2) {
      this.burst(out, t, { type: 'bandpass', freq: 3800, q: 8, peak: 0.8, decay: 0.08 });
      this.tone(out, t, { type: 'sine', freq: 2800 + Math.random() * 1500, peak: 0.15, decay: 0.25 });
    } else if (surface === 1) {
      this.burst(out, t, { type: 'bandpass', freq: 900, q: 2, peak: 0.9, decay: 0.06 });
    } else if (surface === 4) {
      this.burst(out, t, { type: 'lowpass', freq: 600, peak: 1, decay: 0.08 });
    } else {
      this.burst(out, t, { type: 'bandpass', freq: 2200, q: 1.5, peak: 0.7, decay: 0.05 });
    }
    this.track(0.3);
  }

  whiz(pos) {
    if (!this.ok()) return;
    const t = this.now;
    const out = this.out(pos, { ref: 1, rolloff: 2 });
    out.gain.value = 0.35;
    this.burst(out, t, { type: 'bandpass', freq: 3000, q: 3, attack: 0.03, peak: 0.6, decay: 0.08, sweepTo: 1500 });
    this.track(0.2);
  }

  // ---------------------------------------------------------------- feedback
  hitmarker(hs = false, kill = false, armor = false) {
    if (!this.ok()) return;
    const t = this.now;
    const out = this.out(null, { bus: this.ui });
    out.gain.value = 0.55;
    if (hs) {
      this.tone(out, t, { type: 'sine', freq: 3300, peak: 0.35, decay: 0.28 });
      this.tone(out, t, { type: 'sine', freq: 4950, peak: 0.12, decay: 0.2 });
      this.burst(out, t, { type: 'highpass', freq: 5000, peak: 0.3, decay: 0.03 });
    } else {
      this.tone(out, t, { type: 'triangle', freq: armor ? 1100 : 1500, to: armor ? 900 : 1200, peak: 0.3, decay: 0.05 });
    }
    if (kill) {
      this.tone(out, t + 0.05, { type: 'sine', freq: 880, peak: 0.25, decay: 0.25 });
      this.tone(out, t + 0.11, { type: 'sine', freq: 1320, peak: 0.2, decay: 0.3 });
    }
    this.track(0.5);
  }

  hurt() {
    if (!this.ok()) return;
    const t = this.now;
    const out = this.out(null);
    out.gain.value = 0.6;
    this.burst(out, t, { type: 'lowpass', freq: 500, peak: 1, decay: 0.15 });
    this.tone(out, t, { freq: 120, to: 70, peak: 0.6, decay: 0.12 });
    this.track(0.3);
  }

  // ---------------------------------------------------------------- grenades & bomb
  explosion(pos) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos, { ref: 8, rolloff: 0.7, reverb: 0.8, maxDist: 250 });
    out.gain.value = 1.4;
    this.burst(out, t, { type: 'lowpass', freq: 5000, q: 0.5, attack: 0.002, peak: 1.6, decay: 1.4, sweepTo: 180 });
    this.burst(out, t, { type: 'lowpass', freq: 400, q: 0.7, attack: 0.005, peak: 1.4, decay: 2.2, buf: this.pink, rate: 0.5 });
    this.tone(out, t, { freq: 70, to: 28, attack: 0.004, peak: 1.2, decay: 0.9 });
    for (let i = 0; i < 6; i++) this.burst(out, t + 0.1 + Math.random() * 0.6, { type: 'bandpass', freq: 2000 + Math.random() * 3000, q: 3, peak: 0.25, decay: 0.05 });
    this.track(2.5);
  }

  flashPop(pos) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos, { ref: 5, rolloff: 0.9, reverb: 0.6 });
    out.gain.value = 1.1;
    this.burst(out, t, { type: 'highpass', freq: 1200, peak: 1.5, decay: 0.3 });
    this.burst(out, t, { type: 'lowpass', freq: 1500, peak: 1.0, decay: 0.6, sweepTo: 200 });
    this.track(0.8);
  }

  smokePop(pos) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos, { ref: 4, rolloff: 1 });
    out.gain.value = 0.7;
    this.burst(out, t, { type: 'lowpass', freq: 900, peak: 0.8, decay: 0.2 });
    this.burst(out, t + 0.05, { type: 'highpass', freq: 2500, attack: 0.2, peak: 0.35, decay: 2.8, buf: this.pink });
    this.track(3.2);
  }

  bounce(pos) {
    if (!this.ok()) return;
    const t = this.now;
    const out = this.out(pos, { ref: 1.5, rolloff: 1.6 });
    out.gain.value = 0.5;
    this.burst(out, t, { type: 'bandpass', freq: 2800, q: 6, peak: 0.6, decay: 0.05 });
    this.tone(out, t, { type: 'triangle', freq: 1900, peak: 0.15, decay: 0.08 });
    this.track(0.15);
  }

  // breach charge slapped onto a surface
  stick(pos) {
    if (!this.ok()) return;
    const t = this.now;
    const out = this.out(pos, { ref: 2, rolloff: 1.4 });
    out.gain.value = 0.6;
    this.burst(out, t, { type: 'lowpass', freq: 900, q: 1, peak: 0.8, decay: 0.07 });
    this.tone(out, t, { type: 'square', freq: 180, to: 120, peak: 0.12, decay: 0.05 });
    this.track(0.2);
  }

  breachBeep(pos) {
    if (!this.ok()) return;
    const out = this.out(pos, { ref: 2.5, rolloff: 1.3 });
    out.gain.value = 0.35;
    this.tone(out, this.now, { type: 'square', freq: 2400, peak: 0.25, decay: 0.05 });
    this.track(0.1);
  }

  // metal plates being bolted onto a wall
  reinforcing(pos) {
    if (!this.ok()) return;
    const t = this.now;
    const out = this.out(pos, { ref: 3, rolloff: 1.2, reverb: 0.2 });
    out.gain.value = 0.5;
    for (let i = 0; i < 5; i++) {
      const tt = t + i * 0.45 + Math.random() * 0.1;
      this.burst(out, tt, { type: 'bandpass', freq: 1200 + Math.random() * 600, q: 4, peak: 0.6, decay: 0.12 });
      this.tone(out, tt, { type: 'triangle', freq: 620 + Math.random() * 120, peak: 0.12, decay: 0.25 });
    }
    this.track(2.6);
  }

  reinforced(pos) {
    if (!this.ok()) return;
    const t = this.now;
    const out = this.out(pos, { ref: 3, rolloff: 1.2, reverb: 0.3 });
    out.gain.value = 0.7;
    this.burst(out, t, { type: 'lowpass', freq: 600, q: 1, peak: 1, decay: 0.25 });
    this.tone(out, t, { type: 'triangle', freq: 220, to: 160, peak: 0.3, decay: 0.5 });
    this.tone(out, t, { type: 'sine', freq: 880, peak: 0.08, decay: 0.8 });
    this.track(0.9);
  }

  // spent brass hitting the floor
  casing(pos, big = false) {
    if (!this.ok() || this.dist(pos) > 14) return;
    const t = this.now;
    const out = this.out(pos, { ref: 1, rolloff: 2 });
    out.gain.value = big ? 0.22 : 0.16;
    if (big) {
      this.burst(out, t, { type: 'bandpass', freq: 900, q: 3, peak: 0.5, decay: 0.05 });
      this.burst(out, t + 0.09, { type: 'bandpass', freq: 800, q: 3, peak: 0.25, decay: 0.04 });
    } else {
      const f = 3400 + Math.random() * 1800;
      this.tone(out, t, { type: 'sine', freq: f, peak: 0.3, decay: 0.08 });
      this.tone(out, t + 0.06 + Math.random() * 0.04, { type: 'sine', freq: f * 1.12, peak: 0.14, decay: 0.06 });
      this.burst(out, t, { type: 'highpass', freq: 5000, q: 1, peak: 0.25, decay: 0.02 });
    }
    this.track(0.25);
  }

  pinPull() {
    if (!this.ok()) return;
    const t = this.now, out = this.out(null);
    out.gain.value = 0.35;
    this.tone(out, t, { type: 'triangle', freq: 3500, to: 2800, peak: 0.3, decay: 0.05 });
    this.burst(out, t + 0.08, { type: 'bandpass', freq: 2200, q: 5, peak: 0.4, decay: 0.05 });
    this.track(0.2);
  }

  throwWhoosh(pos) {
    if (!this.ok()) return;
    const t = this.now, out = this.out(pos, { ref: 2, rolloff: 2 });
    out.gain.value = 0.4;
    this.burst(out, t, { type: 'bandpass', freq: 600, q: 1, attack: 0.04, peak: 0.6, decay: 0.2, sweepTo: 2000 });
    this.track(0.3);
  }

  bombBeep(pos, urgent = false) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(pos, { ref: 6, rolloff: 0.8 });
    out.gain.value = 0.55;
    this.tone(out, t, { type: 'sine', freq: urgent ? 2100 : 1850, attack: 0.004, peak: 0.6, decay: 0.09 });
    this.track(0.15);
  }

  keypad(pos) {
    if (!this.ok()) return;
    const t = this.now;
    const out = this.out(pos, { ref: 3, rolloff: 1.2 });
    out.gain.value = 0.5;
    for (let i = 0; i < 7; i++) this.tone(out, t + i * 0.35, { type: 'square', freq: 1200 + Math.random() * 900, peak: 0.12, decay: 0.07 });
    this.track(2.6);
  }

  defuseClicks(pos) {
    if (!this.ok()) return;
    const t = this.now;
    const out = this.out(pos, { ref: 3, rolloff: 1.2 });
    out.gain.value = 0.5;
    for (let i = 0; i < 5; i++) this.burst(out, t + i * 0.5, { type: 'bandpass', freq: 2500, q: 5, peak: 0.5, decay: 0.04 });
    this.track(2.6);
  }

  flashRing(duration) {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.out(null, { bus: this.master });
    out.gain.value = 0.18;
    this.tone(out, t, { type: 'sine', freq: 3600, attack: 0.01, peak: 0.6, decay: duration });
    const f = this.muffle.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(500, t);
    f.exponentialRampToValueAtTime(20000, t + duration * 1.1);
    this.track(duration);
  }

  // ---------------------------------------------------------------- UI & announcer-ish cues
  uiClick() {
    if (!this.ok()) return;
    const t = this.now, out = this.out(null, { bus: this.ui });
    out.gain.value = 0.35;
    this.tone(out, t, { type: 'triangle', freq: 1400, to: 1100, peak: 0.3, decay: 0.04 });
    this.track(0.1);
  }

  uiHover() {
    if (!this.ok()) return;
    const t = this.now, out = this.out(null, { bus: this.ui });
    out.gain.value = 0.15;
    this.tone(out, t, { type: 'sine', freq: 2200, peak: 0.2, decay: 0.025 });
    this.track(0.05);
  }

  buy() {
    if (!this.ok()) return;
    const t = this.now, out = this.out(null, { bus: this.ui });
    out.gain.value = 0.4;
    this.tone(out, t, { type: 'triangle', freq: 1320, peak: 0.3, decay: 0.08 });
    this.tone(out, t + 0.07, { type: 'triangle', freq: 1760, peak: 0.3, decay: 0.12 });
    this.burst(out, t + 0.05, { type: 'bandpass', freq: 2000, q: 3, peak: 0.3, decay: 0.08 });
    this.track(0.3);
  }

  denied() {
    if (!this.ok()) return;
    const t = this.now, out = this.out(null, { bus: this.ui });
    out.gain.value = 0.35;
    this.tone(out, t, { type: 'square', freq: 220, peak: 0.2, decay: 0.12 });
    this.track(0.2);
  }

  pickup() {
    if (!this.ok()) return;
    const t = this.now, out = this.out(null);
    out.gain.value = 0.35;
    this.burst(out, t, { type: 'bandpass', freq: 1600, q: 2, peak: 0.6, decay: 0.08 });
    this.burst(out, t + 0.1, { type: 'bandpass', freq: 1100, q: 3, peak: 0.5, decay: 0.06 });
    this.track(0.3);
  }

  chord(freqs, { type = 'triangle', gap = 0.09, peak = 0.22, decay = 0.6 } = {}) {
    if (!this.ok()) return;
    const t = this.now, out = this.out(null, { bus: this.ui });
    out.gain.value = 0.5;
    freqs.forEach((f, i) => {
      this.tone(out, t + i * gap, { type, freq: f, peak, decay });
      this.tone(out, t + i * gap, { type: 'sine', freq: f * 2, peak: peak * 0.3, decay: decay * 0.7 });
    });
    this.track(decay + freqs.length * gap);
  }

  roundStart() { this.chord([392, 523, 659], { gap: 0.07, decay: 0.35 }); }
  roundWin() { this.chord([523, 659, 784, 1047], { gap: 0.1, decay: 0.9 }); }
  roundLose() { this.chord([440, 349, 294], { gap: 0.16, decay: 0.9, type: 'sawtooth', peak: 0.1 }); }
  bombPlanted() { this.chord([880, 660, 880, 660], { type: 'square', gap: 0.18, peak: 0.08, decay: 0.15 }); }
  tick() {
    if (!this.ok()) return;
    const t = this.now, out = this.out(null, { bus: this.ui });
    out.gain.value = 0.25;
    this.tone(out, t, { type: 'sine', freq: 1000, peak: 0.25, decay: 0.05 });
    this.track(0.1);
  }

  // ---------------------------------------------------------------- ambience
  startAmbient(kind) {
    if (!this.ctx) return;
    this.stopAmbient();
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(kind === 'industrial' ? 0.07 : 0.09, ctx.currentTime + 2);
    g.connect(this.sfx);
    const src = this.noiseSrc(this.pink);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = kind === 'industrial' ? 300 : 520;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = kind === 'industrial' ? 80 : 260;
    lfo.connect(lfoGain).connect(f.frequency);
    src.connect(f).connect(g);
    src.start();
    lfo.start();
    const nodes = [src, lfo];
    if (kind === 'industrial') {
      const hum = ctx.createOscillator();
      hum.frequency.value = 55;
      const hg = ctx.createGain();
      hg.gain.value = 0.12;
      hum.connect(hg).connect(g);
      hum.start();
      nodes.push(hum);
    }
    this.ambient = { g, nodes };
  }

  stopAmbient() {
    if (!this.ambient) return;
    const { g, nodes } = this.ambient;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + 0.5);
    for (const n of nodes) n.stop(t + 0.6);
    this.ambient = null;
  }
}
