// Keyboard, mouse (pointer lock) and gamepad input mapped to game actions.

const PAD_MAP = {
  jump: [0], crouch: [1], reloadOrUse: [2], nextWeapon: [3], leanL: [4], leanR: [5],
  ads: [6], fire: [7], scoreboard: [8], pause: [9], walkToggle: [10], slot3: [11],
  buy: [12], drop: [13], slot4: [14], lastWeapon: [15],
};
const TRIGGER_THRESHOLD = 0.3;

export class Input {
  constructor(settings, canvas) {
    this.s = settings;
    this.canvas = canvas;
    this.down = new Set();
    this.pressedSet = new Set();
    this.releasedSet = new Set();
    this.mdx = 0;
    this.mdy = 0;
    this.enabled = false;
    this.locked = false;
    this.capture = null;
    this.lastDevice = 'kbm';
    this.pad = null;
    this.padButtons = [];
    this.padPrev = [];
    this.padAxes = [0, 0, 0, 0];
    this.padLookHold = 0;
    this.onLockChange = null;
    this.onKey = null; // raw key hook for UI (chat, menus)
    this.gamepadSupported = typeof navigator.getGamepads === 'function';

    window.addEventListener('keydown', (e) => this.keyDown(e), { capture: true });
    window.addEventListener('keyup', (e) => this.keyUp(e), { capture: true });
    window.addEventListener('mousedown', (e) => this.mouseDown(e));
    window.addEventListener('mouseup', (e) => this.mouseUp(e));
    window.addEventListener('mousemove', (e) => this.mouseMove(e));
    window.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('blur', () => this.clear());
    window.addEventListener('contextmenu', (e) => { if (this.locked || this.enabled) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.clear();
      this.onLockChange?.(this.locked);
    });
    window.addEventListener('gamepadconnected', (e) => { this.lastDevice = 'pad'; this.onPadConnect?.(e.gamepad); });
  }

  clear() {
    for (const k of this.down) this.releasedSet.add(k);
    this.down.clear();
    this.mdx = this.mdy = 0;
  }

  lock() {
    if (!this.canvas || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: !!this.s.rawInput });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch { /* ignore */ } });
    } catch {
      try { this.canvas.requestPointerLock(); } catch { /* ignore */ }
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  captureNext(cb) { this.capture = cb; }

  keyDown(e) {
    if (this.capture) {
      e.preventDefault();
      e.stopPropagation();
      const cb = this.capture; this.capture = null;
      cb(e.code === 'Escape' ? null : e.code);
      return;
    }
    if (this.onKey && this.onKey(e, true)) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    this.lastDevice = 'kbm';
    if (this.enabled) {
      // stop the browser from scrolling / tabbing / opening menus while playing
      if (['Tab', 'Space', 'AltLeft', 'AltRight', 'ControlLeft', 'Backquote', 'Slash', 'Quote', 'F1', 'F3', 'F6', 'F7'].includes(e.code) || e.ctrlKey || e.metaKey && e.code !== 'KeyQ') {
        if (!(e.metaKey && ['KeyR', 'KeyQ', 'KeyW'].includes(e.code))) e.preventDefault();
      }
    }
    if (e.repeat) return;
    this.down.add(e.code);
    this.pressedSet.add(e.code);
  }

  keyUp(e) {
    if (this.onKey && this.onKey(e, false)) return;
    if (this.down.has(e.code)) {
      this.down.delete(e.code);
      this.releasedSet.add(e.code);
    }
    // macOS doesn't send keyup for other keys while Cmd is held
    if (e.key === 'Meta') this.clear();
  }

  mouseDown(e) {
    const code = 'Mouse' + e.button;
    if (this.capture) {
      if (e.target?.classList?.contains('keybtn') && e.button === 0) return; // clicking the bind button itself
      e.preventDefault();
      const cb = this.capture; this.capture = null;
      cb(code);
      return;
    }
    if (!this.locked) return;
    this.lastDevice = 'kbm';
    this.down.add(code);
    this.pressedSet.add(code);
  }

  mouseUp(e) {
    const code = 'Mouse' + e.button;
    if (this.down.has(code)) {
      this.down.delete(code);
      this.releasedSet.add(code);
    }
  }

  mouseMove(e) {
    if (!this.locked) return;
    let dx = e.movementX || 0, dy = e.movementY || 0;
    // Some browsers report a huge jump right after locking
    if (Math.abs(dx) > 600 || Math.abs(dy) > 600) return;
    this.mdx += dx;
    this.mdy += dy;
    if (dx || dy) this.lastDevice = 'kbm';
  }

  wheel(e) {
    if (this.capture) {
      e.preventDefault();
      const cb = this.capture; this.capture = null;
      cb(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
      return;
    }
    if (!this.locked) return;
    e.preventDefault();
    const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
    this.pressedSet.add(code);
    this.releasedSet.add(code);
  }

  // ---------------------------------------------------------------- gamepad
  pollPad() {
    this.padPrev = this.padButtons;
    this.padButtons = [];
    this.pad = null;
    if (!this.gamepadSupported) return;
    let pads;
    try { pads = navigator.getGamepads(); } catch { return; }
    for (const p of pads) {
      if (p && p.connected && p.buttons.length >= 12) { this.pad = p; break; }
    }
    if (!this.pad) return;
    const p = this.pad;
    this.padButtons = p.buttons.map((b, i) => (i === 6 || i === 7 ? b.value > TRIGGER_THRESHOLD : b.pressed));
    this.padAxes = [p.axes[0] || 0, p.axes[1] || 0, p.axes[2] || 0, p.axes[3] || 0];
    if (this.padButtons.some(Boolean) || this.padAxes.some((a) => Math.abs(a) > 0.3)) this.lastDevice = 'pad';
  }

  padDown(action) {
    const b = PAD_MAP[action];
    return !!b && b.some((i) => this.padButtons[i]);
  }
  padPressed(action) {
    const b = PAD_MAP[action];
    return !!b && b.some((i) => this.padButtons[i] && !this.padPrev[i]);
  }
  padReleased(action) {
    const b = PAD_MAP[action];
    return !!b && b.some((i) => !this.padButtons[i] && this.padPrev[i]);
  }
  padButtonPressed(i) { return this.padButtons[i] && !this.padPrev[i]; }

  rumble(strong = 0.5, weak = 0.5, ms = 80) {
    if (!this.s.vibration || !this.pad) return;
    const act = this.pad.vibrationActuator;
    try {
      if (act?.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak });
    } catch { /* unsupported */ }
  }

  // ---------------------------------------------------------------- actions
  keysFor(action) { return this.s.keys[action] || []; }

  isDown(action) {
    if (!this.enabled) return false;
    for (const k of this.keysFor(action)) if (this.down.has(k)) return true;
    return this.padDown(action);
  }

  pressed(action) {
    if (!this.enabled) return false;
    for (const k of this.keysFor(action)) if (this.pressedSet.has(k)) return true;
    return this.padPressed(action);
  }

  released(action) {
    for (const k of this.keysFor(action)) if (this.releasedSet.has(k)) return true;
    return this.padReleased(action);
  }

  // Movement axes: x = strafe right, y = forward. Length <= 1.
  move() {
    if (!this.enabled) return { x: 0, y: 0, analog: false };
    let x = 0, y = 0;
    if (this.isDown('right')) x += 1;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('forward')) y += 1;
    if (this.isDown('back')) y -= 1;
    let analog = false;
    if (this.pad) {
      const dz = this.s.padDeadzone;
      const ax = this.padAxes[0], ay = -this.padAxes[1];
      const m = Math.hypot(ax, ay);
      if (m > dz) {
        const k = Math.min(1, (m - dz) / (1 - dz)) / m;
        x += ax * k; y += ay * k;
        analog = true;
      }
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y, analog };
  }

  // Look delta in radians for this frame. ads: 0..1, zoom: fov multiplier for scoped sensitivity.
  look(dt, zoom = 1, assist = 1) {
    if (!this.enabled) { this.mdx = this.mdy = 0; return { dx: 0, dy: 0 }; }
    const s = this.s;
    const deg = Math.PI / 180;
    const mouseScale = s.sens * 0.022 * deg * (zoom < 1 ? zoom * s.adsSens : 1);
    let dx = this.mdx * mouseScale;
    let dy = this.mdy * mouseScale * (s.invertY ? -1 : 1);
    this.mdx = this.mdy = 0;
    if (this.pad) {
      const dz = s.padDeadzone;
      const rx = this.padAxes[2], ry = this.padAxes[3];
      const m = Math.hypot(rx, ry);
      if (m > dz) {
        const n = Math.min(1, (m - dz) / (1 - dz));
        const curved = Math.pow(n, s.padCurve);
        if (n > 0.95) this.padLookHold += dt; else this.padLookHold = 0;
        const boost = 1 + Math.min(1, Math.max(0, this.padLookHold - 0.25) / 0.35) * 0.9;
        const rate = 250 * deg * s.padSens * boost * (zoom < 1 ? s.padAdsSens * Math.max(0.35, zoom * 1.6) : 1) * assist;
        dx += (rx / m) * curved * rate * dt;
        dy += (ry / m) * curved * rate * dt * (s.padInvertY ? -1 : 1);
      } else this.padLookHold = 0;
    }
    return { dx, dy };
  }

  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
  }
}
