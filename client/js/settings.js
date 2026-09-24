// Player settings persisted in localStorage.

const KEY = 'breachpoint.settings.v1';

export const ACTIONS = [
  ['forward', 'Move forward'], ['back', 'Move back'], ['left', 'Strafe left'], ['right', 'Strafe right'],
  ['jump', 'Jump'], ['crouch', 'Crouch'], ['walk', 'Walk (quiet)'],
  ['fire', 'Fire'], ['ads', 'Aim / scope'], ['reload', 'Reload'], ['use', 'Use / plant / defuse'],
  ['leanL', 'Lean left'], ['leanR', 'Lean right'], ['drop', 'Drop weapon'], ['inspect', 'Inspect weapon'],
  ['slot1', 'Primary weapon'], ['slot2', 'Pistol'], ['slot3', 'Knife'], ['slot4', 'Grenades'], ['slot5', 'Bomb'],
  ['nextWeapon', 'Next weapon'], ['prevWeapon', 'Previous weapon'], ['lastWeapon', 'Last weapon'],
  ['buy', 'Buy menu'], ['scoreboard', 'Scoreboard'], ['chat', 'Chat (all)'], ['teamChat', 'Chat (team)'],
];

export const DEFAULTS = {
  name: '',
  // mouse
  sens: 1.6,             // like CS: degrees per mouse count = sens * 0.022
  adsSens: 1.0,
  invertY: false,
  rawInput: true,
  // view
  fov: 100,              // horizontal FOV at 16:9
  viewmodelFov: 68,
  bob: 1,
  aimStyle: 'cs',        // cs: zoom keeps the gun at the side (like CS2) | ads: aim down the sights
  vmX: 0,                // weapon position offsets in cm (like viewmodel_offset_x / _y)
  vmY: 0,
  // controller
  padSens: 1.0,
  padAdsSens: 0.55,
  padInvertY: false,
  padDeadzone: 0.14,
  padCurve: 2.0,
  aimAssist: true,
  vibration: true,
  // audio
  volume: 0.8,
  sfxVolume: 1.0,
  uiVolume: 0.7,
  // video
  quality: 'auto',       // auto | low | medium | high | ultra | epic
  aa: 'auto',            // auto (from the preset) | taa | msaa | smaa | fxaa | none
  upscaling: 'native',   // temporal upscaling: native | quality | balanced | performance
  sharpness: 0.5,
  dynamicRes: true,
  maxRenderScale: 1.0,
  showFps: false,
  // hud
  crosshair: { color: '#52ff8a', size: 6, gap: 4, thickness: 2, dot: false, dynamic: true, outline: true },
  toggleLean: false,
  toggleAds: false,
  keys: {
    forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    jump: ['Space'], crouch: ['ControlLeft', 'KeyC'], walk: ['ShiftLeft'],
    fire: ['Mouse0'], ads: ['Mouse2'], reload: ['KeyR'], use: ['KeyF'],
    leanL: ['KeyQ'], leanR: ['KeyE'], drop: ['KeyG'], inspect: ['KeyV'],
    slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'], slot5: ['Digit5'],
    nextWeapon: ['WheelDown'], prevWeapon: ['WheelUp'], lastWeapon: ['KeyX'],
    buy: ['KeyB'], scoreboard: ['Tab'], chat: ['KeyY', 'Enter'], teamChat: ['KeyU'],
  },
};

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return structuredClone(base);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(base)) {
    const bv = base[k], ov = over[k];
    if (ov === undefined) out[k] = structuredClone(bv);
    else if (bv && typeof bv === 'object' && !Array.isArray(bv)) out[k] = deepMerge(bv, ov);
    else if (typeof ov === typeof bv) out[k] = ov;
    else out[k] = structuredClone(bv);
  }
  return out;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return deepMerge(DEFAULTS, raw ? JSON.parse(raw) : null);
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function keyLabel(code) {
  if (!code) return '—';
  const map = {
    Mouse0: 'Mouse 1', Mouse1: 'Mouse 3', Mouse2: 'Mouse 2', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
    WheelUp: 'Wheel Up', WheelDown: 'Wheel Down', Space: 'Space', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', AltLeft: 'L-Alt', AltRight: 'R-Alt', MetaLeft: 'Cmd', MetaRight: 'Cmd',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Tab: 'Tab', Backquote: '`',
    CapsLock: 'Caps', Backspace: 'Backspace',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
