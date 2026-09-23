// In-game HUD (DOM overlay) and radar.

import { WEAPONS, GRENADES } from '../shared/weapons.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class HUD {
  constructor(settings) {
    this.s = settings;
    this.root = $('hud');
    this.cache = {};
    this.ch = { t: document.querySelector('#crosshair .t'), b: document.querySelector('#crosshair .b'), l: document.querySelector('#crosshair .l'), r: document.querySelector('#crosshair .r'), dot: document.querySelector('#crosshair .dot') };
    this.hitT = 0;
    this.centerT = 0;
    this.hintText = '';
    this.slotsFadeAt = 0;
    this.moneyDeltaT = 0;
    this.applyCrosshair();
  }

  show(v) { this.root.hidden = !v; }

  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  applyCrosshair() {
    const c = this.s.crosshair;
    document.documentElement.style.setProperty('--ch-color', c.color);
    this.ch.dot.hidden = !c.dot;
    this.layoutCrosshair(c.gap);
  }

  layoutCrosshair(gap) {
    const c = this.s.crosshair;
    const t = c.thickness, len = c.size;
    const g = Math.round(gap);
    const set = (el, x, y, w, h) => { el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;${c.outline ? '' : 'box-shadow:none;'}`; };
    set(this.ch.t, -t / 2, -g - len, t, len);
    set(this.ch.b, -t / 2, g, t, len);
    set(this.ch.l, -g - len, -t / 2, len, t);
    set(this.ch.r, g, -t / 2, len, t);
    set(this.ch.dot, -t / 2, -t / 2, t, t);
    this.ch.dot.hidden = !c.dot;
  }

  // spreadPx: dynamic gap in pixels
  crosshair(visible, spreadPx) {
    const el = $('crosshair');
    const v = visible ? '' : 'none';
    if (this.cache.chv !== v) { this.cache.chv = v; el.style.display = v; }
    if (!visible) return;
    const gap = this.s.crosshair.dynamic ? this.s.crosshair.gap + spreadPx : this.s.crosshair.gap;
    const r = Math.round(gap);
    if (this.cache.chg !== r) { this.cache.chg = r; this.layoutCrosshair(r); }
  }

  hitmarker(hs, kill) {
    const el = $('hitmarker');
    el.className = kill ? 'kill' : hs ? 'hs' : '';
    el.style.opacity = '1';
    this.hitT = kill ? 0.45 : 0.22;
  }

  damage(relAngle, amount) {
    const box = $('dmg-indicators');
    const d = document.createElement('div');
    d.className = 'dmg-ind';
    d.style.transform = `rotate(${relAngle}rad)`;
    d.style.opacity = String(Math.min(1, 0.4 + amount / 50));
    box.appendChild(d);
    setTimeout(() => { d.style.transition = 'opacity .6s'; d.style.opacity = '0'; }, 500);
    setTimeout(() => d.remove(), 1200);
    const f = $('dmg-flash');
    f.style.transition = 'none';
    f.style.opacity = String(Math.min(0.9, amount / 60 + 0.25));
    requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = '0'; });
  }

  vitals(hp, armor, helmet, kit, bomb) {
    this.set('hp', $('hp'), String(hp));
    const low = hp <= 25;
    if (this.cache.hpLow !== low) { this.cache.hpLow = low; $('hp').classList.toggle('low', low); }
    this.set('armor', $('armor'), String(armor));
    const cls = 'icon armor-icon' + (armor > 0 ? ' on' : '') + (helmet ? ' helmet' : '');
    this.set('armorCls', $('armor-icon'), cls, 'className');
    this.set('kit', $('kit-icon'), !kit, 'hidden');
    this.set('bombc', $('bomb-carry'), !bomb, 'hidden');
    const vig = hp > 0 && hp < 40 ? (40 - hp) / 40 : 0;
    this.set('vig', $('vignette').style, String(vig), 'opacity');
  }

  money(m, show = true) {
    this.set('moneyShow', $('money-box'), !show, 'hidden');
    const prev = this.cache.money;
    this.set('money', $('money'), String(m));
    if (prev != null && prev !== String(m)) {
      const delta = m - +prev;
      const d = $('money-delta');
      d.textContent = (delta > 0 ? '+' : '') + delta;
      d.className = delta < 0 ? 'neg' : '';
      d.style.opacity = '1';
      clearTimeout(this.moneyTimer);
      this.moneyTimer = setTimeout(() => { d.style.opacity = '0'; }, 1600);
    }
  }

  ammo(name, mag, res, magSize, showAmmo) {
    this.set('wname', $('weapon-name'), name);
    this.set('mag', $('ammo-mag'), showAmmo ? String(mag) : '');
    this.set('res', $('ammo-res'), showAmmo ? String(res) : '');
    this.set('sep', document.querySelector('.ammo .sep'), showAmmo ? '/' : '');
    const low = showAmmo && magSize && mag <= Math.ceil(magSize * 0.25);
    if (this.cache.magLow !== low) { this.cache.magLow = low; $('ammo-mag').classList.toggle('low', low); }
  }

  slots(inv, cur, now) {
    const key = JSON.stringify([inv, cur]);
    if (this.cache.slots !== key) {
      this.cache.slots = key;
      const rows = [];
      if (inv.primary) rows.push([1, WEAPONS[inv.primary[0]].short, cur === 'primary']);
      if (inv.secondary) rows.push([2, WEAPONS[inv.secondary[0]].short, cur === 'secondary']);
      rows.push([3, 'Knife', cur === 'knife']);
      for (const g of GRENADES) if (inv.nades?.[g] > 0) rows.push([4, WEAPONS[g].short + (inv.nades[g] > 1 ? ` ×${inv.nades[g]}` : ''), cur === g]);
      if (inv.bomb) rows.push([5, 'Bomb', cur === 'bomb']);
      $('weapon-slots').innerHTML = rows.map(([k, n, c]) => `<div class="ws${c ? ' cur' : ''}"><b>${k}</b>${esc(n)}</div>`).join('');
      this.slotsFadeAt = now + 2500;
      $('weapon-slots').classList.remove('fade');
    } else if (now > this.slotsFadeAt && this.slotsFadeAt) {
      this.slotsFadeAt = 0;
      $('weapon-slots').classList.add('fade');
    }
  }

  showSlots(now) { this.slotsFadeAt = now + 2500; $('weapon-slots').classList.remove('fade'); }

  timer(text, low, label) {
    this.set('timer', $('round-timer'), text);
    if (this.cache.timerLow !== low) { this.cache.timerLow = low; $('round-timer').classList.toggle('low', low); }
    this.set('rlabel', $('round-label'), label);
  }

  scores(left, right, aliveL, totalL, aliveR, totalR, leftCls = 'left', ffa = false) {
    this.set('sl', $('score-left'), String(left));
    this.set('sr', $('score-right'), String(right));
    const dots = (alive, total) => Array.from({ length: Math.min(total, 10) }, (_, i) => `<i class="${i < alive ? '' : 'dead'}"></i>`).join('');
    this.set('al', $('alive-left'), dots(aliveL, totalL), 'innerHTML');
    this.set('ar', $('alive-right'), dots(aliveR, totalR), 'innerHTML');
    this.set('ffa', document.querySelector('.team-side.right'), ffa, 'hidden');
  }

  bombPlanted(show, text = 'BOMB PLANTED') {
    this.set('bombShow', $('bomb-indicator'), !show, 'hidden');
    this.set('bombText', $('bomb-text'), text);
  }

  killfeed(entry, mine) {
    const box = $('killfeed');
    const d = document.createElement('div');
    d.className = 'kf' + (mine ? ' mine' : '');
    d.innerHTML = entry;
    box.appendChild(d);
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => { d.style.transition = 'opacity .5s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 600); }, 6500);
  }

  center(big, small = '', cls = '', dur = 3) {
    const el = $('center-msg');
    el.querySelector('.big').textContent = big;
    el.querySelector('.small').textContent = small;
    el.className = 'show ' + cls;
    this.centerT = dur;
  }

  hint(html) {
    if (this.hintText === html) return;
    this.hintText = html;
    const el = $('hint');
    if (html) el.innerHTML = html;
    el.classList.toggle('show', !!html);
  }

  report(html, dur = 7) {
    const el = $('dmg-report');
    if (!el) return;
    clearTimeout(this.reportTimer);
    if (!html) { el.hidden = true; return; }
    el.innerHTML = html;
    el.hidden = false;
    el.classList.remove('fade');
    this.reportTimer = setTimeout(() => { el.classList.add('fade'); this.reportTimer = setTimeout(() => { el.hidden = true; }, 600); }, dur * 1000);
  }

  progress(label, frac, kind) {
    const el = $('progress');
    if (label == null) { if (!el.hidden) el.hidden = true; return; }
    el.hidden = false;
    el.className = kind || '';
    this.set('plabel', el.querySelector('.label'), label);
    el.querySelector('.fill').style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`;
  }

  chat(html, sys = false) {
    const box = $('chat-log');
    const d = document.createElement('div');
    d.className = 'cm';
    d.innerHTML = sys ? `<span class="sys">${html}</span>` : html;
    box.appendChild(d);
    while (box.children.length > 8) box.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 9000);
  }

  spectate(text) {
    const el = $('spectate-info');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    this.set('spec', el, text, 'innerHTML');
  }

  death(html) {
    const el = $('death-info');
    if (!html) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = html;
  }

  gg(text) {
    const el = $('gg-info');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    this.set('gg', el, text, 'innerHTML');
  }

  scope(on) { this.set('scope', $('scope'), !on, 'hidden'); }

  fps(text) {
    const el = $('fps');
    el.hidden = !text;
    if (text) this.set('fpsT', el, text);
  }

  netWarn(on) { this.set('netw', $('net-warn'), !on, 'hidden'); }

  update(dt) {
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) $('hitmarker').style.opacity = '0';
    }
    if (this.centerT > 0) {
      this.centerT -= dt;
      if (this.centerT <= 0) $('center-msg').classList.remove('show');
    }
  }
}

export { esc };

// ------------------------------------------------------------------ radar

export class Radar {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.ppm = 4; // pixels per metre in the baked image
    this.bake();
  }

  bake() {
    const m = this.map;
    const ppm = this.ppm;
    const W = m.cols * m.cellSize * ppm, H = m.rows * m.cellSize * ppm;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const cs = m.cellSize * ppm;
    g.fillStyle = '#1a1f26';
    g.fillRect(0, 0, W, H);
    for (let r = 0; r < m.rows; r++) {
      for (let col = 0; col < m.cols; col++) {
        const ch = m.grid[r][col];
        let fill = null;
        if (ch === '#' || ch === '%') fill = null;
        else if (ch >= '1' && ch <= '8') fill = `hsl(210, 8%, ${34 + (+ch) * 3}%)`;
        else fill = m.roofed[r][col] ? '#3b434d' : '#4c5561';
        if (fill) { g.fillStyle = fill; g.fillRect(col * cs, r * cs, cs + 0.5, cs + 0.5); }
      }
    }
    // obstacles from boxes (crates, props, panels, sills)
    const obstacles = (g, upper) => {
      for (const b of m.boxes) {
        if (b.kind === 'ground' || b.kind === 'roof' || b.kind === 'lintel' || b.kind === 'wall' || b.kind === 'floor' || b.kind === 'slab' || b.renderOnly) continue;
        if (!!upper !== !!(b.floorY && b.min[1] >= b.floorY - 0.01)) continue;
        g.fillStyle = b.kind === 'panel' ? '#8a6a44' : b.kind === 'sill' ? '#5d6773' : b.kind === 'stair' ? '#6a7480' : '#2a3038';
        g.fillRect((b.min[0] - m.x0) * ppm, (b.min[2] - m.z0) * ppm, (b.max[0] - b.min[0]) * ppm, (b.max[2] - b.min[2]) * ppm);
      }
    };
    obstacles(g, false);
    // outline walls
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    // second storey: the ground floor dimmed underneath, upper floor cells on top
    if (m.upper) {
      const u = document.createElement('canvas');
      u.width = W; u.height = H;
      const ug = u.getContext('2d');
      ug.fillStyle = '#1a1f26';
      ug.fillRect(0, 0, W, H);
      ug.globalAlpha = 0.35;
      ug.drawImage(c, 0, 0);
      ug.globalAlpha = 1;
      for (let r = 0; r < m.rows; r++) {
        for (let col = 0; col < m.cols; col++) {
          const ch = m.upper.grid[r][col];
          if (ch === ' ') continue;
          ug.fillStyle = ch === '#' ? '#1a1f26' : ch === '=' ? '#3a424c' : '#56606c';
          ug.fillRect(col * cs, r * cs, cs + 0.5, cs + 0.5);
        }
      }
      obstacles(ug, true);
      this.upperImage = u;
      this.upperCtx = ug;
    }
    // sites
    for (const site of ['A', 'B']) {
      const z = m.zones[site];
      if (!z) continue;
      if (z.floor > 0 && this.upperCtx) { this.drawSite(this.upperCtx, site, z, cs); this.drawSite(g, site, z, cs, true); continue; }
      if (this.upperCtx) this.drawSite(this.upperCtx, site, z, cs, true);
      this.drawSite(g, site, z, cs);
    }
    this.image = c;
  }

  // other = the site is on another floor than this image (drawn faintly)
  drawSite(g, site, z, cs, other = false) {
    const m = this.map, ppm = this.ppm;
    const x = (z.min[0] - m.x0) * ppm, y = (z.min[2] - m.z0) * ppm, w = (z.max[0] - z.min[0]) * ppm, h = (z.max[2] - z.min[2]) * ppm;
    g.fillStyle = other ? 'rgba(220, 60, 50, 0.07)' : 'rgba(220, 60, 50, 0.18)';
    g.fillRect(x, y, w, h);
    g.fillStyle = other ? 'rgba(255, 90, 80, 0.35)' : 'rgba(255, 90, 80, 0.9)';
    g.font = `bold ${Math.round(cs * 1.6)}px Arial`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(other ? site + (z.floor > 0 ? '↑' : '↓') : site, x + w / 2, y + h / 2);
  }

  // players: [{ x, z, yaw, color, self, enemy, dead }], bomb: {x,z,planted}
  draw(me, players, bomb, zoom = 3.2) {
    const g = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const m = this.map;
    g.clearRect(0, 0, W, H);
    g.save();
    g.beginPath();
    g.roundRect ? g.roundRect(0, 0, W, H, 12) : g.rect(0, 0, W, H);
    g.clip();
    g.translate(W / 2, H / 2);
    g.rotate(me.yaw);
    const s = zoom / this.ppm;
    g.globalAlpha = 0.9;
    const upstairs = this.upperImage && me.y != null && me.y > m.upper.floorY - 0.8;
    g.drawImage(upstairs ? this.upperImage : this.image, (m.x0 - me.x) * zoom, (m.z0 - me.z) * zoom, this.image.width * s, this.image.height * s);
    g.globalAlpha = 1;
    const toR = (x, z) => [(x - me.x) * zoom, (z - me.z) * zoom];
    if (bomb) {
      const [bx, bz] = toR(bomb.x, bomb.z);
      g.fillStyle = bomb.planted ? (Math.floor(performance.now() / 300) % 2 ? '#ff3030' : '#ff9090') : '#ffcc40';
      g.fillRect(bx - 4, bz - 4, 8, 8);
    }
    for (const p of players) {
      if (p.self) continue;
      const [px, pz] = toR(p.x, p.z);
      // players on the other floor are drawn faded
      g.globalAlpha = m.upper && p.y != null && (p.y > m.upper.floorY - 0.8) !== !!upstairs ? 0.4 : 1;
      if (p.dead) {
        g.strokeStyle = p.color;
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(px - 3, pz - 3); g.lineTo(px + 3, pz + 3); g.moveTo(px + 3, pz - 3); g.lineTo(px - 3, pz + 3); g.stroke();
        continue;
      }
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(px, pz, p.enemy ? 4.5 : 4, 0, Math.PI * 2);
      g.fill();
      if (!p.enemy) {
        g.strokeStyle = p.color;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(px, pz);
        g.lineTo(px - Math.sin(p.yaw) * 9, pz - Math.cos(p.yaw) * 9);
        g.stroke();
      }
    }
    g.restore();
    // self arrow (always up)
    g.save();
    g.translate(W / 2, H / 2);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath();
    g.fill();
    g.restore();
  }
}
