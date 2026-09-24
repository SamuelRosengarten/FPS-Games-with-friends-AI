// Shared constants used by both the server and the browser client.

export const GAME_NAME = 'Breachpoint';
export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 3000;

export const TICK_RATE = 60;          // server simulation ticks per second
export const SNAPSHOT_RATE = 30;      // world snapshots per second sent to clients
export const INTERP_DELAY = 100;      // ms clients render remote players in the past
export const MAX_LAG_COMP = 350;      // ms the server will rewind for hit detection

export const TEAM = Object.freeze({ NONE: 0, ATT: 1, DEF: 2 });
export const TEAM_NAMES = { 0: 'Spectators', 1: 'Attackers', 2: 'Defenders' };
export const TEAM_SHORT = { 0: 'SPEC', 1: 'ATK', 2: 'DEF' };

export const PLAYER = Object.freeze({
  radius: 0.35,          // half-width of the collision box
  height: 1.8,
  crouchHeight: 1.2,
  eyeFromTop: 0.12,      // eye height = height - eyeFromTop
  stepHeight: 0.55,
  gravity: 18,
  jumpSpeed: 6.4,
  runSpeed: 5.6,         // m/s with knife out; weapons scale this
  walkMul: 0.52,
  crouchMul: 0.36,
  accel: 5.5,
  airAccel: 12,
  airSpeedCap: 0.9,
  friction: 5.2,
  stopSpeed: 2.0,
  crouchTime: 0.14,      // seconds to fully crouch
  leanTime: 0.18,
  leanOffset: 0.38,      // metres the head moves sideways at full lean
  maxHealth: 100,
  maxArmor: 100,
});

// Tagging: taking damage slows you for a moment. Returns the fraction of speed lost.
export const TAG_MS = 450;
export function tagSlow(amt, left) {
  const k = Math.min(1, Math.max(0, left));
  return Math.min(1, Math.max(0, amt)) * 0.55 * k * k;
}

// Snapshot flag bits.
export const FLAG = Object.freeze({
  ALIVE: 1,
  GROUND: 2,
  WALK: 4,
  PLANT: 8,
  DEFUSE: 16,
  RELOAD: 32,
  ADS: 64,
  BOMB: 128,
  KIT: 256,
  HELMET: 512,
  BLIND: 1024,
  PROTECT: 2048,
  REINFORCE: 4096,
});

export const MODES = {
  defuse: {
    id: 'defuse', name: 'Defuse', teams: true, rounds: true, economy: true,
    desc: 'Round based. Attackers plant the bomb at site A or B, defenders stop them. No respawns. Buy weapons with money earned each round.',
  },
  tdm: {
    id: 'tdm', name: 'Team Deathmatch', teams: true, rounds: false, economy: false,
    desc: 'Two teams, instant respawns. First team to the kill limit wins. All weapons are free.',
  },
  ffa: {
    id: 'ffa', name: 'Free For All', teams: false, rounds: false, economy: false,
    desc: 'Everyone for themselves with instant respawns. First to the kill limit wins.',
  },
  gungame: {
    id: 'gungame', name: 'Gun Game', teams: false, rounds: false, economy: false,
    desc: 'Every kill upgrades your weapon. First to get a kill with the final weapon (knife) wins. Getting knifed sends you back a level.',
  },
};

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'defuse',
  map: 'sandstone',
  maxRounds: 12,          // defuse: halftime after half, win at half + 1
  roundTime: 115,         // seconds
  freezeTime: 8,
  buyTime: 25,            // seconds from round start (incl. freeze)
  bombTime: 40,
  plantTime: 3.2,
  defuseTime: 7,
  kitDefuseTime: 3.5,
  scoreLimit: 40,         // tdm team kills / ffa kills
  timeLimit: 10,          // minutes for tdm/ffa/gungame
  friendlyFire: false,
  botDifficulty: 'normal',
  fillBots: 0,            // fill each team up to this many players with bots
  startMoney: 800,
  weather: 'clear',       // clear | rain | storm | fog | random
});

// Weather the host can pick. sight: how far anyone can make out a player (bots use it; the client's fog
// is tuned to match) · hearing: footstep hearing range multiplier (rain masks footsteps).
export const WEATHER = Object.freeze({
  clear: { id: 'clear', name: 'Clear', sight: 110, hearing: 1 },
  rain: { id: 'rain', name: 'Rain', sight: 85, hearing: 0.8 },
  storm: { id: 'storm', name: 'Thunderstorm', sight: 62, hearing: 0.65 },
  fog: { id: 'fog', name: 'Fog', sight: 42, hearing: 1 },
});

// 'random' picks one per match (clear twice as likely).
export function resolveWeather(w, rand = Math.random) {
  if (WEATHER[w]) return w;
  const pool = ['clear', 'clear', 'rain', 'storm', 'fog'];
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

export const ECONOMY = Object.freeze({
  maxMoney: 16000,
  winElim: 3250,
  winObjective: 3500,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 3400,
  plantBonusTeam: 800,
  plantBonusPlayer: 300,
  defuseBonusPlayer: 300,
});

export const USE_RANGE = 1.9;   // metres to defuse / pick up
export const BOMB_RADIUS = 18;  // lethal-ish explosion radius
export const BOMB_DAMAGE = 500;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export const DEG = Math.PI / 180;

// Direction the player looks at for a given yaw/pitch (Three.js convention: yaw 0 looks down -Z).
export function viewDir(yaw, pitch, out = [0, 0, 0]) {
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp;
  out[1] = Math.sin(pitch);
  out[2] = -Math.cos(yaw) * cp;
  return out;
}

export function isEnemy(mode, a, b) {
  if (a === b) return false;
  if (mode === 'ffa' || mode === 'gungame') return true;
  return a.team !== b.team;
}

// Small deterministic PRNG (mulberry32) for anything that must match between client and server.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function sanitizeName(name) {
  let s = String(name ?? '').replace(/[^\p{L}\p{N} _\-.\[\]()!?#@*+]/gu, '').trim();
  if (s.length > 16) s = s.slice(0, 16);
  return s || 'Player';
}
