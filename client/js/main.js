// Entry point: wires networking, UI, input, audio, graphics and the client game together.

import { loadSettings, saveSettings } from './settings.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Graphics } from './graphics.js';
import { HUD, esc } from './hud.js';
import { UI } from './ui.js';
import { ClientGame } from './game.js';

const $ = (id) => document.getElementById(id);

const settings = loadSettings();
let graphics;
try {
  graphics = new Graphics($('canvas-wrap'), settings);
} catch (e) {
  document.body.innerHTML = `<div style="padding:40px;font:16px system-ui;color:#fff">Your browser could not start WebGL 2 (${esc(e.message)}).<br>Please use an up-to-date Chrome, Edge, Safari or Firefox with hardware acceleration enabled.</div>`;
  throw e;
}
const input = new Input(settings, graphics.canvas);
const audio = new AudioEngine(settings);
audio.bodycamMic = settings.viewStyle === 'bodycam'; // applied when the audio context starts
const hud = new HUD(settings);
const ui = new UI(settings, input, audio);
const net = new Net();
const game = new ClientGame({ graphics, input, audio, hud, ui, net, settings });

let state = 'title';
let myId = null;
let lobby = null;
let chatOpen = false;
let chatTeam = false;
let suppressPause = false;
let lastEnd = null;
let pending = null; // game messages that arrive while the map is still loading

function toGame(m) {
  if (pending) { pending.push(m); return; }
  game.handle(m);
}

window.__breachpoint = { game, net, graphics, settings, input, ui, get state() { return state; }, get chatOpen() { return chatOpen; } };

// ------------------------------------------------------------------ network
ui.on('join', (name, password) => {
  ui.titleError('Connecting…');
  net.connect(name, password);
});

net.on('welcome', (msg) => {
  myId = msg.id;
  ui.setWelcome(msg);
  ui.titleError('');
  if (state === 'title') { state = 'lobby'; ui.showScreen('lobby'); }
});

net.on('error', (msg) => {
  ui.titleError(msg.msg, msg.needPassword);
  ui.toast(msg.msg, 5000);
});

net.on('close', () => {
  if (state === 'title') { ui.titleError('Could not connect to the server.'); return; }
  game.stop();
  state = 'title';
  closeAllOverlays();
  input.unlock();
  ui.showScreen('title');
  ui.titleError('Disconnected from the server.');
});

net.on('lobby', (l) => {
  lobby = l;
  ui.updateLobby(l);
  game.setLobby(l.players);
});

net.on('chat', (m) => {
  let html;
  if (m.sys) html = esc(m.text);
  else {
    const team = m.pteam ?? lobby?.players.find((p) => p.id === m.from)?.team ?? 0;
    const prefix = (m.dead ? '<span class="dim">*DEAD* </span>' : '') + (m.team ? '<span class="dim">(team) </span>' : '');
    html = `${prefix}<span class="n${team}">${esc(m.name)}</span>: ${esc(m.text)}`;
  }
  hud.chat(html, !!m.sys);
  ui.lobbyChat(m.sys ? `<span class="sys">${html}</span>` : html);
});

net.on('match', async (m) => {
  closeAllOverlays();
  state = 'loading';
  ui.showScreen(null);
  ui.overlay('overlay-loading', true);
  $('loading-text').textContent = 'Loading map…';
  pending = [];
  await new Promise((r) => setTimeout(r, 30));
  try {
    await game.start(m, myId);
  } catch (e) {
    console.error(e);
    ui.toast('Failed to load the map: ' + e.message, 8000);
  }
  const queued = pending;
  pending = null;
  for (const q of queued) game.handle(q);
  net.send({ t: 'loaded' });
  ui.overlay('overlay-loading', false);
  if (state === 'loading') state = 'game';
  lastEnd = null;
});

net.on('lobbyReturn', () => {
  game.stop();
  closeAllOverlays();
  suppressPause = true;
  input.unlock();
  state = 'lobby';
  ui.showScreen('lobby');
});

net.on('end', (m) => {
  lastEnd = m;
  game.phase = 'ended';
  const cls = ui.showEnd(m, { me: myId, myTeam: game.me?.team ?? 0, mode: game.mode, sb: game.sb, round: game.round });
  if (cls === 'win') audio.roundWin(); else if (cls === 'lose') audio.roundLose();
  suppressPause = true;
  input.unlock();
  const tick = () => {
    if (lastEnd !== m) return;
    const left = Math.max(0, Math.ceil((m.returnAt - net.serverNow()) / 1000));
    $('end-return').textContent = `Back to the lobby in ${left}s`;
    if (left > 0) setTimeout(tick, 250);
  };
  tick();
});

net.on('you', (m) => {
  toGame(m);
  if (ui.isOpen('overlay-buy')) ui.renderBuy(game.buyState());
});

for (const t of ['s', 'tp', 'fire', 'hit', 'dmg', 'kill', 'walls', 'nade', 'flashed', 'bomb', 'bombinfo', 'drop+', 'drop-', 'sb', 'round', 'snd', 'gg', 'reset']) {
  net.on(t, (m) => toGame(m));
}

// ------------------------------------------------------------------ UI actions
ui.on('team', (team) => net.send({ t: 'team', team }));
ui.on('host', (action, payload = {}) => net.send({ t: 'host', action, ...payload }));
ui.on('chat', (text, team) => net.send({ t: 'chat', text, team }));
ui.on('buy', (item) => {
  if (!game.canBuy()) { audio.denied(); return; }
  net.send({ t: 'buy', item });
  audio.buy();
});
ui.on('resume', () => {
  ui.overlay('overlay-pause', false);
  audio.init();
  input.lock();
});
ui.on('leave', () => {
  net.close();
  game.stop();
  closeAllOverlays();
  input.unlock();
  state = 'title';
  ui.showScreen('title');
});
ui.on('rejoin', () => net.send({ t: 'team', team: lobby?.players.find((p) => p.id === myId)?.team || 1 }));
ui.on('fullscreen', () => toggleFullscreen());
ui.on('gpuInfo', () => graphics.gpu);
ui.on('qualityInfo', () => `Using: ${graphics.quality.toUpperCase()}`);
ui.on('settings', (key) => {
  if (['quality', 'aa', 'volumetrics', 'reflections', 'eyeAdaptation', 'motionBlur', 'all'].includes(key)) graphics.applyQuality();
  if (['viewStyle', 'all'].includes(key)) { graphics.setViewStyle(settings.viewStyle); audio.setBodycam(settings.viewStyle === 'bodycam'); }
  if (['maxRenderScale', 'dynamicRes', 'upscaling'].includes(key)) { graphics.renderScale = graphics.initialScale(); graphics.resize(); }
  if (['sharpness', 'all'].includes(key)) graphics.applySharpness();
  if (['volume', 'sfxVolume', 'uiVolume', 'all'].includes(key)) audio.applyVolume();
  if (['crosshair', 'all'].includes(key)) hud.applyCrosshair();
  if (['fov', 'all'].includes(key)) graphics.setFov(settings.fov);
  if (['viewmodelFov', 'all'].includes(key)) graphics.setViewmodelFov(settings.viewmodelFov);
  saveSettings(settings);
});

function toggleFullscreen() {
  if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
  const el = document.documentElement;
  const p = el.requestFullscreen?.({ navigationUI: 'hide' });
  if (p?.then) p.then(() => navigator.keyboard?.lock?.().catch(() => {})).catch(() => {});
}

function closeAllOverlays() {
  for (const id of ['overlay-buy', 'overlay-pause', 'overlay-settings', 'overlay-controls', 'overlay-team', 'overlay-end', 'overlay-scoreboard']) ui.overlay(id, false);
  closeChat();
}

// ------------------------------------------------------------------ menus in game
function openBuy() {
  if (!game.canBuy()) { audio.denied(); return; }
  ui.openBuy(game.buyState());
  suppressPause = true;
  input.unlock();
}
function closeBuy(relock = true) {
  ui.overlay('overlay-buy', false);
  if (relock) input.lock();
}

function openChat(team) {
  chatOpen = true;
  chatTeam = team;
  game.chatOpen = true;
  $('chat-mode').textContent = team ? 'TEAM' : 'ALL';
  $('chat-input-wrap').hidden = false;
  $('chat-log').classList.add('open');
  const inp = $('chat-input');
  inp.value = '';
  setTimeout(() => inp.focus(), 0);
}
function closeChat() {
  chatOpen = false;
  game.chatOpen = false;
  $('chat-input-wrap').hidden = true;
  $('chat-log').classList.remove('open');
  $('chat-input').blur();
}
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = $('chat-input').value.trim();
    if (text) net.send({ t: 'chat', text, team: chatTeam });
    closeChat();
    e.preventDefault();
  } else if (e.key === 'Escape') {
    closeChat();
    e.preventDefault();
  }
  e.stopPropagation();
});

input.onKey = (e, down) => {
  if (state !== 'game') return false;
  if (e.target === $('chat-input')) return false;
  const code = e.code;
  const is = (action) => (settings.keys[action] || []).includes(code);
  if (is('scoreboard')) {
    e.preventDefault();
    if (down && !e.repeat) { game.renderScoreboard(); ui.overlay('overlay-scoreboard', true); }
    if (!down) ui.overlay('overlay-scoreboard', false);
    return true;
  }
  if (!down) return false;
  if (ui.isOpen('overlay-buy')) {
    if (is('buy') || code === 'Escape') { e.preventDefault(); closeBuy(code !== 'Escape'); return true; }
    if (code.startsWith('Digit')) { e.preventDefault(); ui.buyKey(+code.slice(5)); return true; }
    return true;
  }
  if (ui.anyMenuOpen() || chatOpen) return false;
  if (is('buy') && !e.repeat) { e.preventDefault(); openBuy(); return true; }
  if ((is('chat') || is('teamChat')) && !e.repeat) { e.preventDefault(); openChat(is('teamChat')); return true; }
  return false;
};

input.onLockChange = (locked) => {
  if (state !== 'game') return;
  if (locked) { ui.overlay('overlay-pause', false); return; }
  if (suppressPause) { suppressPause = false; return; }
  if (!ui.anyMenuOpen() && !chatOpen && input.lastDevice !== 'pad') ui.overlay('overlay-pause', true);
};

$('click-to-play').addEventListener('click', () => { audio.init(); input.lock(); });
graphics.canvas.addEventListener('click', () => { if (state === 'game' && !ui.anyMenuOpen()) { audio.init(); input.lock(); } });

window.addEventListener('beforeunload', (e) => {
  if (state === 'game') { e.preventDefault(); e.returnValue = ''; }
});

// ------------------------------------------------------------------ controller menu handling
function padMenus() {
  if (!input.pad) return;
  const p = (i) => input.padButtonPressed(i);
  if (state !== 'game') return;
  if (p(9)) { // start
    if (ui.isOpen('overlay-pause')) ui.overlay('overlay-pause', false);
    else if (!ui.anyMenuOpen()) ui.overlay('overlay-pause', true);
  }
  if (ui.isOpen('overlay-pause')) {
    if (p(0)) ui.overlay('overlay-pause', false);
    return;
  }
  const back = input.padButtons[8];
  if (back && !ui.isOpen('overlay-scoreboard')) { game.renderScoreboard(); ui.overlay('overlay-scoreboard', true); }
  else if (!back && input.padPrev[8]) ui.overlay('overlay-scoreboard', false);
  if (ui.isOpen('overlay-buy')) {
    if (p(12)) ui.buyNav(0, -1);
    if (p(13)) ui.buyNav(0, 1);
    if (p(14)) ui.buyNav(-1, 0);
    if (p(15)) ui.buyNav(1, 0);
    if (p(0)) ui.buyConfirm();
    if (p(1)) closeBuy(false);
    return;
  }
  if (!ui.anyMenuOpen() && p(12)) openBuy();
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
function loop(t) {
  const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
  last = t;
  input.pollPad();
  if (state === 'game') {
    const menus = ui.anyMenuOpen() || chatOpen;
    const playing = !menus && (input.locked || input.lastDevice === 'pad');
    input.enabled = playing;
    padMenus();
    const c0 = performance.now();
    game.frame(dt, playing);
    graphics.render(dt);
    game.afterRender();
    game.cpuMs = game.cpuMs == null ? 0 : game.cpuMs * 0.95 + (performance.now() - c0) * 0.05;
    const showClick = !input.locked && !menus && input.lastDevice !== 'pad' && !ui.isOpen('overlay-pause');
    if ($('click-to-play').hidden === showClick) $('click-to-play').hidden = !showClick;
    if (ui.isOpen('overlay-buy')) {
      const left = game.modeInfo.economy ? Math.max(0, Math.ceil((game.buyEnds - net.serverNow()) / 1000)) : Math.max(0, Math.ceil(((game.me.buyUntil || 0) - net.serverNow()) / 1000));
      $('buy-timer').textContent = `Buy time: ${left}s`;
      if (!game.canBuy()) closeBuy(true);
    }
  } else {
    input.enabled = false;
    if (!$('click-to-play').hidden) $('click-to-play').hidden = true;
  }
  input.endFrame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// auto-join if a name is saved and ?autojoin is in the URL (handy for testing)
const params = new URLSearchParams(location.search);
if (params.has('name')) { $('name-input').value = params.get('name'); }
if (params.has('autojoin')) setTimeout(() => $('join-btn').click(), 200);
