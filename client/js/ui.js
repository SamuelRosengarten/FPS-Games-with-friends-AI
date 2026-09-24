// Menus: title, lobby, settings, controls, buy menu, scoreboard, pause, team select, match end.

import { MODES, TEAM_NAMES, GAME_NAME } from '../shared/constants.js';
import { WEAPONS, GEAR, BUY_MENU, itemPrice, itemName } from '../shared/weapons.js';
import { ACTIONS, DEFAULTS, keyLabel, saveSettings } from './settings.js';
import { PRESETS } from './graphics.js';
import { esc } from './hud.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(settings, input, audio) {
    this.s = settings;
    this.input = input;
    this.audio = audio;
    this.h = {};
    this.me = null;
    this.isHost = false;
    this.maps = [];
    this.modes = MODES;
    this.lobby = null;
    this.buyFocus = 0;
    this.buyCat = -1;
    this.settingsTab = 'game';
    this.bindTitle();
    this.bindLobby();
    this.bindOverlays();
    this.buildControls();
    document.addEventListener('mouseover', (e) => { if (e.target.closest?.('.btn, .buy-item, .tab')) this.audio.uiHover(); });
    document.addEventListener('click', (e) => { if (e.target.closest?.('.btn, .tab')) this.audio.uiClick(); });
  }

  on(name, fn) { this.h[name] = fn; }
  emit(name, ...a) { return this.h[name]?.(...a); }

  // ---------------------------------------------------------------- screens
  showScreen(name) {
    $('screen-title').hidden = name !== 'title';
    $('screen-lobby').hidden = name !== 'lobby';
    this.screen = name;
  }

  toast(text, ms = 3000) {
    const d = document.createElement('div');
    d.className = 't';
    d.textContent = text;
    $('toast').appendChild(d);
    setTimeout(() => d.remove(), ms);
  }

  overlay(id, show) {
    const el = $(id);
    if (el) el.hidden = !show;
  }
  isOpen(id) { return !$(id).hidden; }
  anyMenuOpen() {
    return ['overlay-buy', 'overlay-pause', 'overlay-settings', 'overlay-controls', 'overlay-team', 'overlay-end'].some((id) => this.isOpen(id));
  }

  // ---------------------------------------------------------------- title
  bindTitle() {
    const name = $('name-input');
    name.value = this.s.name || '';
    const join = () => {
      const n = name.value.trim();
      if (!n) { $('title-error').textContent = 'Please enter a name.'; name.focus(); return; }
      this.s.name = n;
      saveSettings(this.s);
      $('title-error').textContent = '';
      this.audio.init();
      this.emit('join', n, $('password-input').value);
    };
    $('join-btn').onclick = join;
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('password-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('title-settings-btn').onclick = () => this.openSettings();
    $('title-controls-btn').onclick = () => this.overlay('overlay-controls', true);
    fetch('/api/info').then((r) => r.json()).then((info) => {
      $('server-line').textContent = `Server: ${info.name} · ${info.players} player${info.players === 1 ? '' : 's'} online`;
      $('password-field').hidden = !info.password;
    }).catch(() => { $('server-line').textContent = 'Could not reach the server.'; $('server-line').style.color = 'var(--bad)'; });
  }

  titleError(msg, needPassword) {
    $('title-error').textContent = msg || '';
    if (needPassword) $('password-field').hidden = false;
  }

  // ---------------------------------------------------------------- lobby
  bindLobby() {
    document.querySelectorAll('[data-join]').forEach((b) => { b.onclick = () => this.emit('team', +b.dataset.join); });
    document.querySelectorAll('[data-addbot]').forEach((b) => { b.onclick = () => this.emit('host', 'addBot', { team: +b.dataset.addbot }); });
    document.querySelectorAll('[data-rembot]').forEach((b) => { b.onclick = () => this.emit('host', 'removeBot', { team: +b.dataset.rembot }); });
    $('start-btn').onclick = () => this.emit('host', 'start');
    $('shuffle-btn').onclick = () => this.emit('host', 'shuffle');
    $('lobby-leave-btn').onclick = () => this.emit('leave');
    $('lobby-settings-btn').onclick = () => this.openSettings();
    $('rejoin-btn').onclick = () => this.emit('rejoin');
    const sendSetting = () => {
      if (!this.isHost) return;
      this.emit('host', 'settings', {
        settings: {
          mode: $('set-mode').value, map: $('set-map').value, maxRounds: +$('set-rounds').value, roundTime: +$('set-roundtime').value,
          scoreLimit: +$('set-score').value, timeLimit: +$('set-time').value, fillBots: +$('set-fill').value,
          botDifficulty: $('set-botdiff').value, friendlyFire: $('set-ff').value === 'true',
        },
      });
    };
    for (const id of ['set-mode', 'set-map', 'set-rounds', 'set-roundtime', 'set-score', 'set-time', 'set-fill', 'set-botdiff', 'set-ff']) {
      $(id).addEventListener('change', () => {
        if (id === 'set-mode') {
          // pick a map that supports the mode
          const m = this.maps.find((x) => x.id === $('set-map').value);
          if (m && !m.modes.includes($('set-mode').value)) {
            const alt = this.maps.find((x) => x.modes.includes($('set-mode').value));
            if (alt) $('set-map').value = alt.id;
          }
        }
        sendSetting();
      });
    }
    const chat = $('lobby-chat-input');
    chat.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && chat.value.trim()) { this.emit('chat', chat.value.trim(), false); chat.value = ''; }
    });
  }

  setWelcome(msg) {
    this.me = msg.id;
    this.maps = msg.maps;
    this.modes = msg.modes;
    $('set-mode').innerHTML = Object.values(msg.modes).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    $('set-map').innerHTML = msg.maps.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    $('lobby-server-name').textContent = msg.server.name;
    const addrs = msg.server.addresses.map((a) => `http://${a}:${msg.server.port}`);
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    $('lobby-addresses').textContent = local
      ? (addrs.length ? `Friends join at: ${addrs.join('  ·  ')}` : 'Friends join via your IP on port ' + msg.server.port)
      : `Connected to ${location.host}`;
  }

  setHost(isHost) {
    this.isHost = isHost;
    document.body.classList.toggle('is-host', isHost);
    document.body.classList.toggle('not-host', !isHost);
    $('host-badge').textContent = isHost ? '· YOU ARE THE HOST' : '';
  }

  updateLobby(l) {
    this.lobby = l;
    this.setHost(l.hostId === this.me);
    const s = l.settings;
    const ffa = s.mode === 'ffa' || s.mode === 'gungame';
    for (const t of [0, 1, 2]) {
      const list = l.players.filter((p) => p.team === t);
      $(`list-${t}`).innerHTML = list.map((p) => {
        const tags = [p.id === l.hostId ? '<span class="tag host">HOST</span>' : '', p.bot ? '<span class="tag">BOT</span>' : ''].join('');
        const kick = this.isHost && p.id !== this.me ? `<span class="kick" data-kick="${p.id}" title="${p.bot ? 'Remove bot' : 'Kick'}">✕</span>` : '';
        return `<li class="${p.id === this.me ? 'me' : ''}"><span class="nm">${esc(p.name)}</span>${tags}<span class="ping">${p.bot ? '' : p.ping + 'ms'}</span>${kick}</li>`;
      }).join('') || '<li class="dim" style="background:none">—</li>';
    }
    document.querySelectorAll('[data-kick]').forEach((b) => { b.onclick = () => this.emit('host', 'kick', { id: +b.dataset.kick }); });
    $('team-col-2').style.display = ffa ? 'none' : '';
    document.querySelector('#team-col-1 .team-title span').textContent = ffa ? 'PLAYERS' : 'ATTACKERS';
    // settings controls
    const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = String(v); };
    set('set-mode', s.mode); set('set-map', s.map); set('set-rounds', s.maxRounds); set('set-roundtime', s.roundTime);
    set('set-score', s.scoreLimit); set('set-time', s.timeLimit); set('set-fill', s.fillBots); set('set-botdiff', s.botDifficulty);
    set('set-ff', s.friendlyFire);
    ensureOption($('set-rounds'), s.maxRounds); ensureOption($('set-roundtime'), s.roundTime); ensureOption($('set-score'), s.scoreLimit); ensureOption($('set-time'), s.timeLimit);
    $('mode-desc').textContent = this.modes[s.mode]?.desc || '';
    const map = this.maps.find((m) => m.id === s.map);
    $('map-desc').textContent = map ? map.desc : '';
    document.querySelectorAll('.defuse-only').forEach((e) => { e.style.display = s.mode === 'defuse' ? '' : 'none'; });
    document.querySelectorAll('.dm-only').forEach((e) => { e.style.display = s.mode !== 'defuse' ? '' : 'none'; });
    // only offer maps that support the mode
    for (const opt of $('set-map').options) {
      const m = this.maps.find((x) => x.id === opt.value);
      opt.disabled = !!m && !m.modes.includes(s.mode);
    }
    $('rejoin-btn').hidden = !l.inMatch;
    $('start-btn').textContent = l.inMatch ? 'RESTART MATCH' : 'START MATCH';
  }

  lobbyChat(html) {
    const box = $('lobby-chat-log');
    const d = document.createElement('div');
    d.innerHTML = html;
    box.appendChild(d);
    while (box.children.length > 80) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  }

  // ---------------------------------------------------------------- overlays
  bindOverlays() {
    $('resume-btn').onclick = () => this.emit('resume');
    $('pause-settings-btn').onclick = () => this.openSettings();
    $('pause-controls-btn').onclick = () => this.overlay('overlay-controls', true);
    $('pause-leave-btn').onclick = () => this.emit('leave');
    $('pause-end-btn').onclick = () => this.emit('host', 'end');
    $('pause-team-btn').onclick = () => { this.overlay('overlay-pause', false); this.overlay('overlay-team', true); };
    document.querySelectorAll('#overlay-team [data-team]').forEach((b) => {
      b.onclick = () => { this.emit('team', +b.dataset.team); this.overlay('overlay-team', false); this.emit('resume'); };
    });
    $('team-cancel').onclick = () => { this.overlay('overlay-team', false); this.overlay('overlay-pause', true); };
    $('controls-close').onclick = () => this.overlay('overlay-controls', false);
    $('settings-close').onclick = () => this.overlay('overlay-settings', false);
    $('settings-reset').onclick = () => {
      const keepName = this.s.name;
      Object.assign(this.s, structuredClone(DEFAULTS));
      this.s.name = keepName;
      saveSettings(this.s);
      this.emit('settings', 'all');
      this.renderSettings();
    };
    document.querySelectorAll('#settings-tabs .tab').forEach((t) => {
      t.onclick = () => { this.settingsTab = t.dataset.tab; this.renderSettings(); };
    });
    // fullscreen button in the pause menu
    const fs = document.createElement('button');
    fs.className = 'btn';
    fs.textContent = 'Toggle fullscreen';
    fs.onclick = () => this.emit('fullscreen');
    $('pause-controls-btn').after(fs);
  }

  openSettings() {
    this.renderSettings();
    this.overlay('overlay-settings', true);
  }

  renderSettings() {
    document.querySelectorAll('#settings-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === this.settingsTab));
    const body = $('settings-body');
    const s = this.s;
    const rows = [];
    const slider = (key, label, min, max, step, fmt = (v) => v, hint = '', obj = s, sub = null) => {
      const val = sub ? obj[sub][key] : obj[key];
      rows.push(`<div class="srow"><div class="lbl">${label}${hint ? `<small>${hint}</small>` : ''}</div><div class="ctl"><input type="range" data-k="${key}" data-sub="${sub || ''}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="val" data-v="${key}">${fmt(val)}</span></div></div>`);
      this._fmt = this._fmt || {};
      this._fmt[key] = fmt;
    };
    const check = (key, label, hint = '', sub = null) => {
      const val = sub ? s[sub][key] : s[key];
      rows.push(`<div class="srow"><div class="lbl">${label}${hint ? `<small>${hint}</small>` : ''}</div><div class="ctl"><input type="checkbox" data-k="${key}" data-sub="${sub || ''}" ${val ? 'checked' : ''}></div></div>`);
    };
    const select = (key, label, options, hint = '') => {
      rows.push(`<div class="srow"><div class="lbl">${label}${hint ? `<small>${hint}</small>` : ''}</div><div class="ctl"><select data-k="${key}">${options.map(([v, l]) => `<option value="${v}" ${String(s[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>`);
    };
    switch (this.settingsTab) {
      case 'game':
        slider('sens', 'Mouse sensitivity', 0.1, 8, 0.05, (v) => (+v).toFixed(2), 'Same scale as CS (degrees = sens × 0.022 per count)');
        slider('adsSens', 'Aim / scope sensitivity', 0.2, 2, 0.05, (v) => (+v).toFixed(2), 'Multiplier while zoomed');
        check('invertY', 'Invert mouse Y');
        check('rawInput', 'Raw mouse input', 'Disables OS mouse acceleration where supported');
        slider('fov', 'Field of view', 70, 120, 1, (v) => `${v}°`, 'Horizontal at 16:9');
        slider('viewmodelFov', 'Weapon FOV', 50, 90, 1, (v) => `${v}°`);
        slider('bob', 'View bob', 0, 1.5, 0.05, (v) => (+v).toFixed(2));
        select('aimStyle', 'Right-click aim', [['cs', 'Zoom, gun stays on the side (CS2)'], ['ads', 'Aim down the sights']], 'Snipers always use the scope');
        slider('vmX', 'Weapon position: sideways', -4, 4, 0.5, (v) => `${v > 0 ? '+' : ''}${v} cm`, 'Positive moves the gun further right');
        slider('vmY', 'Weapon position: height', -4, 4, 0.5, (v) => `${v > 0 ? '+' : ''}${v} cm`, 'Negative moves the gun lower');
        check('toggleAds', 'Toggle aim (instead of hold)');
        check('toggleLean', 'Toggle lean (instead of hold)');
        break;
      case 'video': {
        select('quality', 'Graphics quality', [['auto', 'Auto (recommended)'], ...Object.entries(PRESETS).map(([k, p]) => [k, p.label])],
          'Ultra: 4K shadows, ambient occlusion, bloom, 4× MSAA, native Retina resolution');
        check('dynamicRes', 'Dynamic resolution', 'Lowers render resolution on the fly to stay above 60 FPS');
        slider('maxRenderScale', 'Max render scale', 0.5, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
        check('showFps', 'Show FPS counter');
        const g = this.emit('gpuInfo');
        if (g) rows.push(`<div class="srow"><div class="lbl">Detected GPU<small>${esc(g)}</small></div><div class="ctl dim">${esc(this.emit('qualityInfo') || '')}</div></div>`);
        break;
      }
      case 'audio':
        slider('volume', 'Master volume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`);
        slider('sfxVolume', 'Effects volume', 0, 1.5, 0.01, (v) => `${Math.round(v * 100)}%`);
        slider('uiVolume', 'Interface volume', 0, 1.5, 0.01, (v) => `${Math.round(v * 100)}%`);
        break;
      case 'crosshair':
        rows.push(`<div class="srow"><div class="lbl">Color</div><div class="ctl"><input type="color" data-k="color" data-sub="crosshair" value="${s.crosshair.color}"></div></div>`);
        slider('size', 'Length', 1, 20, 1, (v) => v, '', s, 'crosshair');
        slider('gap', 'Gap', 0, 20, 1, (v) => v, '', s, 'crosshair');
        slider('thickness', 'Thickness', 1, 6, 1, (v) => v, '', s, 'crosshair');
        check('dot', 'Center dot', '', 'crosshair');
        check('dynamic', 'Dynamic (shows spread)', '', 'crosshair');
        check('outline', 'Outline', '', 'crosshair');
        break;
      case 'keys':
        for (const [action, label] of ACTIONS) {
          const keys = s.keys[action] || [];
          rows.push(`<div class="srow"><div class="lbl">${label}</div><div class="ctl"><button class="btn keybtn" data-bind="${action}" data-slot="0">${keyLabel(keys[0])}</button><button class="btn keybtn" data-bind="${action}" data-slot="1">${keyLabel(keys[1])}</button></div></div>`);
        }
        rows.push('<div class="dim small-text" style="padding:10px 0">Click a box, then press a key or mouse button. Esc clears it. Tip: on Windows, <b>Ctrl+W</b> closes the browser tab — use fullscreen (pause menu) or bind crouch to C if that happens.</div>');
        break;
      case 'pad':
        slider('padSens', 'Look sensitivity', 0.2, 3, 0.05, (v) => (+v).toFixed(2));
        slider('padAdsSens', 'Aim sensitivity', 0.2, 1.5, 0.05, (v) => (+v).toFixed(2));
        slider('padDeadzone', 'Stick deadzone', 0.02, 0.4, 0.01, (v) => (+v).toFixed(2));
        slider('padCurve', 'Response curve', 1, 3, 0.1, (v) => (+v).toFixed(1), '1 = linear, higher = finer aim near center');
        check('padInvertY', 'Invert look Y');
        check('aimAssist', 'Aim assist (slowdown)', 'Slows the camera slightly over enemies');
        check('vibration', 'Vibration');
        rows.push(`<div class="dim small-text" style="padding:10px 0">${this.input.gamepadSupported ? (this.input.pad ? `Connected: ${esc(this.input.pad.id)}` : 'No controller detected — press any button on it.') : 'This browser blocks controllers on http pages (Firefox). Use Chrome/Edge/Safari, or open the game via https (see README).'}</div>`);
        break;
      default: break;
    }
    body.innerHTML = rows.join('');
    body.querySelectorAll('input[type=range]').forEach((el) => {
      el.oninput = () => {
        const k = el.dataset.k, sub = el.dataset.sub;
        const v = +el.value;
        if (sub) s[sub][k] = v; else s[k] = v;
        body.querySelector(`[data-v="${k}"]`).textContent = this._fmt[k](v);
        saveSettings(s);
        this.emit('settings', sub || k);
      };
    });
    body.querySelectorAll('input[type=checkbox], input[type=color], select').forEach((el) => {
      el.onchange = () => {
        const k = el.dataset.k, sub = el.dataset.sub;
        const v = el.type === 'checkbox' ? el.checked : el.value;
        if (sub) s[sub][k] = v; else s[k] = v;
        saveSettings(s);
        this.emit('settings', sub || k);
      };
    });
    body.querySelectorAll('[data-bind]').forEach((el) => {
      el.onclick = () => {
        el.classList.add('listening');
        el.textContent = 'Press…';
        this.input.captureNext((code) => {
          const action = el.dataset.bind, slot = +el.dataset.slot;
          const keys = s.keys[action] ? [...s.keys[action]] : [];
          keys[slot] = code || undefined;
          s.keys[action] = keys.filter((k, i) => k || i === 0).map((k) => k || null).filter(Boolean);
          saveSettings(s);
          this.renderSettings();
          this.buildControls();
        });
      };
    });
  }

  buildControls() {
    const k = (a) => (this.s.keys[a] || []).map(keyLabel).join(' / ') || '—';
    const items = [
      ['h', 'KEYBOARD & MOUSE'],
      ['Move', `${k('forward')} ${k('left')} ${k('back')} ${k('right')}`], ['Jump', k('jump')], ['Crouch', k('crouch')], ['Walk (quiet)', k('walk')],
      ['Fire', k('fire')], ['Aim down sights / scope', k('ads')], ['Reload', k('reload')], ['Use · plant · defuse · pick up · reinforce (hold)', k('use')],
      ['Lean left / right', `${k('leanL')} / ${k('leanR')}`], ['Weapons', '1 2 3 4 5 · wheel'], ['Last weapon', k('lastWeapon')], ['Drop weapon', k('drop')],
      ['Buy menu', k('buy')], ['Scoreboard', k('scoreboard')], ['Chat all / team', `${k('chat')} / ${k('teamChat')}`], ['Inspect weapon', k('inspect')], ['Menu', 'Esc'],
      ['h', 'CONTROLLER (Xbox / PlayStation)'],
      ['Move / look', 'Left stick / right stick'], ['Fire / aim', 'RT / LT  (R2 / L2)'], ['Jump', 'A  (✕)'], ['Crouch', 'B  (○)'],
      ['Reload · hold to use/plant/defuse/reinforce', 'X  (□)'], ['Next weapon', 'Y  (△)'], ['Lean left / right', 'LB / RB  (L1 / R1)'], ['Knife', 'R3'], ['Walk toggle', 'L3'],
      ['Buy menu', 'D-pad up'], ['Drop weapon', 'D-pad down'], ['Grenades', 'D-pad left'], ['Last weapon', 'D-pad right'], ['Scoreboard', 'View / Share'], ['Menu', 'Menu / Options'],
    ];
    $('controls-grid').innerHTML = items.map(([a, b]) => (a === 'h' ? `<h4>${b}</h4>` : `<div class="ci"><span>${a}</span><b>${esc(b)}</b></div>`)).join('');
  }

  // ---------------------------------------------------------------- buy menu
  openBuy(state) {
    this.buyCat = -1;
    this.buyFocus = Math.max(0, this.buyFocus);
    this.renderBuy(state);
    this.overlay('overlay-buy', true);
  }

  renderBuy(state) {
    const { money, inv, team, free, armor, helmet, kit } = state;
    $('buy-money').textContent = free ? '∞' : money;
    const grid = $('buy-grid');
    let idx = 0;
    this.buyItems = [];
    grid.innerHTML = BUY_MENU.map((cat, ci) => {
      const items = cat.items.filter((id) => buyable(id, team, state.mode));
      return `<div class="buy-cat"><div class="buy-cat-title${this.buyCat === ci ? ' sel' : ''}"><b>${ci + 1}</b>${cat.name}</div>${items.map((id, ii) => {
        const w = WEAPONS[id];
        const price = free ? 0 : itemPrice(id);
        let owned = false;
        if (w?.slot === 'primary') owned = inv.primary?.[0] === id;
        else if (w?.slot === 'secondary') owned = inv.secondary?.[0] === id;
        else if (w?.slot === 'grenade') owned = (inv.nades?.[id] || 0) >= w.max;
        else if (id === 'kevlar') owned = armor >= 100;
        else if (id === 'helmet') owned = armor >= 100 && helmet;
        else if (id === 'kit') owned = kit;
        const poor = !free && price > money;
        const stats = w && w.damage ? `DMG ${w.damage}${w.pellets > 1 ? '×' + w.pellets : ''} · ${w.auto ? 'AUTO' : 'SEMI'} · ${w.mag ?? ''}${w.mag ? ' rnd' : ''}` : w?.type === 'grenade' ? (id === 'frag' ? 'High explosive' : id === 'flash' ? 'Blinds enemies' : id === 'breach' ? 'Sticks, blows walls open' : 'Blocks vision 18s') : id === 'kit' ? 'Halves defuse time' : 'Reduces damage';
        const my = idx++;
        this.buyItems.push(id);
        const displayPrice = id === 'helmet' && armor >= 100 && !helmet && !free ? 350 : price;
        return `<button class="buy-item${owned ? ' owned' : ''}${poor ? ' poor' : ''}${this.buyFocus === my ? ' focus' : ''}" data-buy="${id}" data-idx="${my}"><span class="bi-key">${ci + 1}${ii + 1}</span><span class="bi-name">${esc(itemName(id))}</span><span class="bi-price">${free ? 'FREE' : '$' + displayPrice}</span><span class="bi-stats">${stats}</span></button>`;
      }).join('')}</div>`;
    }).join('');
    grid.querySelectorAll('[data-buy]').forEach((b) => {
      b.onclick = () => { this.buyFocus = +b.dataset.idx; this.emit('buy', b.dataset.buy); };
    });
    this.buyState = state;
  }

  buyKey(digit) {
    if (digit < 1 || digit > 6) return;
    if (this.buyCat < 0) {
      this.buyCat = digit - 1;
      this.renderBuy(this.buyState);
    } else {
      const cat = BUY_MENU[this.buyCat];
      const items = cat.items.filter((id) => buyable(id, this.buyState.team, this.buyState.mode));
      const id = items[digit - 1];
      this.buyCat = -1;
      if (id) this.emit('buy', id);
      else this.renderBuy(this.buyState);
    }
  }

  buyNav(dx, dy) {
    // grid navigation for controllers: columns are categories
    const cats = [...document.querySelectorAll('#buy-grid .buy-cat')].map((c) => [...c.querySelectorAll('.buy-item')].map((b) => +b.dataset.idx));
    let ci = cats.findIndex((c) => c.includes(this.buyFocus));
    if (ci < 0) ci = 0;
    let ii = Math.max(0, cats[ci].indexOf(this.buyFocus));
    ci = (ci + dx + cats.length) % cats.length;
    ii = Math.min(cats[ci].length - 1, Math.max(0, ii + dy));
    if (dy && dx === 0) ii = ((cats[ci].indexOf(this.buyFocus) + dy) + cats[ci].length) % cats[ci].length;
    this.buyFocus = cats[ci][ii] ?? 0;
    this.renderBuy(this.buyState);
  }

  buyConfirm() {
    const id = this.buyItems?.[this.buyFocus];
    if (id) this.emit('buy', id);
  }

  // ---------------------------------------------------------------- scoreboard
  renderScoreboard(sb, ctx) {
    if (!sb) return;
    const { mode, me, score, round } = ctx;
    const ffa = mode === 'ffa' || mode === 'gungame';
    $('sb-title').textContent = `${GAME_NAME.toUpperCase()} · ${MODES[mode]?.name?.toUpperCase() || ''}`;
    $('sb-sub').textContent = mode === 'defuse' ? `Round ${round}` : ctx.timeLeft || '';
    const meP = sb.players.find((p) => p.id === me);
    const row = (p) => {
      const icons = [p.bomb ? '💣' : '', p.kit ? '✂' : '', p.helmet ? '⛑' : p.armor ? '🛡' : ''].join(' ');
      const showMoney = mode === 'defuse' && meP && (meP.team === p.team || meP.team === 0);
      const hsp = p.k > 0 ? Math.round((p.hs / p.k) * 100) : 0;
      return `<tr class="${p.alive || mode !== 'defuse' ? '' : 'dead'} ${p.id === me ? 'me' : ''}"><td class="name">${esc(p.name)}${p.bot ? ' <span class="icons">BOT</span>' : ''}<span class="icons">${icons}</span></td>${mode === 'defuse' ? `<td>${showMoney ? '$' + p.money : ''}</td>` : ''}${mode === 'gungame' ? `<td>${p.gg + 1}</td>` : ''}<td>${p.k}</td><td>${p.d}</td><td>${p.a}</td><td>${hsp}%</td><td>${p.dmg}</td>${mode === 'defuse' ? `<td>${p.mvp ? '★' + p.mvp : ''}</td>` : ''}<td>${p.score}</td><td>${p.bot ? 'BOT' : p.ping}</td></tr>`;
    };
    const head = `<tr><th>PLAYER</th>${mode === 'defuse' ? '<th>MONEY</th>' : ''}${mode === 'gungame' ? '<th>LVL</th>' : ''}<th>K</th><th>D</th><th>A</th><th>HS</th><th>DMG</th>${mode === 'defuse' ? '<th>MVP</th>' : ''}<th>SCORE</th><th>PING</th></tr>`;
    const sort = (a, b) => (mode === 'gungame' ? b.gg - a.gg : 0) || b.score - a.score || b.k - a.k;
    let html = '';
    if (ffa) {
      const list = sb.players.filter((p) => p.team !== 0).sort(sort);
      html += `<div class="sb-team ffa"><div class="sb-team-head"><span>PLAYERS</span></div><table class="sb">${head}${list.map(row).join('')}</table></div>`;
    } else {
      for (const t of [1, 2]) {
        const list = sb.players.filter((p) => p.team === t).sort(sort);
        html += `<div class="sb-team ${t === 1 ? 'att' : 'def'}"><div class="sb-team-head"><span>${TEAM_NAMES[t].toUpperCase()}</span><span class="sc">${score?.[t] ?? 0}</span></div><table class="sb">${head}${list.map(row).join('')}</table></div>`;
      }
    }
    const spec = sb.players.filter((p) => p.team === 0);
    if (spec.length) html += `<div class="dim small-text">Spectating: ${spec.map((p) => esc(p.name)).join(', ')}</div>`;
    $('sb-body').innerHTML = html;
    return html;
  }

  showEnd(msg, ctx) {
    const { me, myTeam, mode, sb } = ctx;
    let title = 'DRAW', cls = 'draw', sub = '';
    const ffa = mode === 'ffa' || mode === 'gungame';
    if (ffa) {
      const w = sb?.players.find((p) => p.id === msg.winnerId);
      if (msg.winnerId === me) { title = 'VICTORY'; cls = 'win'; } else { title = 'DEFEAT'; cls = 'lose'; }
      sub = w ? `${w.name} wins the match` : '';
    } else if (msg.winner) {
      const won = msg.winner === myTeam;
      title = myTeam === 0 ? `${TEAM_NAMES[msg.winner].toUpperCase()} WIN` : won ? 'VICTORY' : 'DEFEAT';
      cls = myTeam === 0 ? 'draw' : won ? 'win' : 'lose';
      sub = `${TEAM_NAMES[1]} ${msg.score[1]} – ${msg.score[2]} ${TEAM_NAMES[2]}`;
    } else sub = mode === 'defuse' ? `${msg.score[1]} – ${msg.score[2]}` : 'Time limit reached';
    $('end-title').textContent = title;
    $('end-title').className = 'end-title ' + cls;
    $('end-sub').textContent = sub;
    $('end-board').innerHTML = this.renderScoreboard(sb, { ...ctx, score: msg.score }) || '';
    this.overlay('overlay-end', true);
    return cls;
  }
}

function ensureOption(sel, value) {
  if (![...sel.options].some((o) => o.value === String(value))) {
    const o = document.createElement('option');
    o.value = String(value);
    o.textContent = String(value);
    sel.appendChild(o);
    sel.value = String(value);
  }
}

// Team-only items (defuse kit for defenders, breach charges for attackers) only matter in Defuse.
function buyable(id, team, mode) {
  if (id === 'kit') return team === 2 && mode === 'defuse';
  const w = WEAPONS[id];
  if (w?.team && mode === 'defuse') return team === w.team;
  return true;
}
