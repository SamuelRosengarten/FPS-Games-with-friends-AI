// Lobby, connections, host controls. Owns the current Match.

import { performance } from 'node:perf_hooks';
import {
  PROTOCOL_VERSION, TICK_RATE, TEAM, MODES, DEFAULT_SETTINGS, WEATHER, sanitizeName, clamp,
} from '../shared/constants.js';
import { mapList, MAP_DEFS } from '../shared/maps/index.js';
import { Match } from './match.js';

const BOT_NAMES = [
  'Viper', 'Ghost', 'Jackal', 'Nomad', 'Havoc', 'Raven', 'Blitz', 'Echo', 'Maverick', 'Kodiak',
  'Saber', 'Onyx', 'Talon', 'Rook', 'Wraith', 'Cobra', 'Nova', 'Bishop', 'Hex', 'Dingo',
];

export class Game {
  constructor({ name = 'Breachpoint Server', password = '', addresses = [], port = 3000, log = console.log } = {}) {
    this.serverName = name;
    this.password = password;
    this.addresses = addresses;
    this.port = port;
    this.log = log;
    this.players = new Map();
    this.nextId = 1;
    this.settings = { ...DEFAULT_SETTINGS };
    this.match = null;
    this.hostId = null;
    this.lastTick = this.now();
    this.lastLobby = 0;
    this.timer = null;
  }

  now() { return performance.now(); }

  start() {
    const interval = 1000 / TICK_RATE;
    this.timer = setInterval(() => this.tick(), interval);
  }

  stop() { clearInterval(this.timer); }

  tick() {
    const now = this.now();
    const dt = clamp((now - this.lastTick) / 1000, 0.001, 0.1);
    this.lastTick = now;
    try {
      if (this.match) this.match.tick(dt);
    } catch (e) {
      this.log('match tick error:', e);
    }
    if (now - this.lastLobby > 2000) {
      this.lastLobby = now;
      this.broadcastLobby();
    }
  }

  // ------------------------------------------------------------------ connections

  onConnection(conn) {
    conn.player = null;
    conn.msgCount = 0;
    conn.msgWindow = this.now();
    conn.on('message', (raw) => {
      const now = this.now();
      if (now - conn.msgWindow > 1000) { conn.msgWindow = now; conn.msgCount = 0; }
      if (++conn.msgCount > 400) return; // flood protection
      if (typeof raw !== 'string' || raw.length > 20000) return;
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      try {
        this.onMessage(conn, msg);
      } catch (e) {
        this.log('message error:', msg.t, e);
      }
    });
    conn.on('close', () => {
      if (conn.player) this.removePlayer(conn.player);
    });
  }

  send(p, msg) {
    if (p && p.conn) p.conn.send(JSON.stringify(msg));
  }

  broadcast(msg, except = null) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.conn && p !== except) p.conn.send(s);
  }

  onMessage(conn, msg) {
    const p = conn.player;
    if (!p) {
      if (msg.t === 'hello') this.handleHello(conn, msg);
      else if (msg.t === 'ping') conn.send(JSON.stringify({ t: 'pong', c: msg.c, s: this.now() }));
      return;
    }
    const m = this.match;
    switch (msg.t) {
      case 'ping':
        this.send(p, { t: 'pong', c: msg.c, s: this.now() });
        if (Number.isFinite(msg.rtt)) p.ping = clamp(Math.round(msg.rtt), 0, 9999);
        break;
      case 'chat': this.handleChat(p, msg); break;
      case 'team': this.handleTeam(p, msg.team); break;
      case 'host': this.handleHost(p, msg); break;
      case 'in': m?.onInput(p, msg); break;
      case 'shoot': if (m && Array.isArray(msg.d)) m.fire(p, msg.o, msg.d, msg.ts); break;
      case 'knife': m?.onKnife(p, msg); break;
      case 'reload': m?.onReload(p); break;
      case 'switch': m?.onSwitch(p, msg.w); break;
      case 'buy': m?.onBuy(p, String(msg.item)); break;
      case 'drop': m?.onDrop(p); break;
      case 'throw': m?.onThrow(p, msg); break;
      case 'use': m?.onUse(p, !!msg.on); break;
      case 'loaded': m?.onLoaded(p); break;
      default: break;
    }
  }

  handleHello(conn, msg) {
    if (msg.v !== PROTOCOL_VERSION) {
      conn.send(JSON.stringify({ t: 'error', msg: 'Game version mismatch - refresh the page (Ctrl+F5 / Cmd+Shift+R).' }));
      conn.close(4000, 'version');
      return;
    }
    if (this.password && msg.password !== this.password) {
      conn.send(JSON.stringify({ t: 'error', msg: 'Wrong server password.', needPassword: true }));
      conn.close(4001, 'password');
      return;
    }
    const humans = [...this.players.values()].filter((x) => !x.bot);
    if (humans.length >= 16) {
      conn.send(JSON.stringify({ t: 'error', msg: 'Server is full.' }));
      conn.close(4002, 'full');
      return;
    }
    let name = sanitizeName(msg.name);
    const taken = new Set([...this.players.values()].map((x) => x.name.toLowerCase()));
    if (taken.has(name.toLowerCase())) {
      let i = 2;
      while (taken.has(`${name}${i}`.toLowerCase())) i++;
      name = `${name.slice(0, 14)}${i}`;
    }
    const p = this.createPlayer(name, false, conn);
    conn.player = p;
    // host: first local connection wins, else first player
    if (!this.hostId || !this.players.has(this.hostId) || (conn.isLocal && !this.players.get(this.hostId)?.conn?.isLocal)) {
      this.setHost(p);
    }
    // join the smaller team
    p.team = this.smallerTeam();
    this.send(p, {
      t: 'welcome', id: p.id, v: PROTOCOL_VERSION, host: p.id === this.hostId,
      server: { name: this.serverName, addresses: this.addresses, port: this.port },
      maps: mapList(), modes: MODES, settings: this.settings,
    });
    this.log(`+ ${p.name} joined (${conn.remoteAddress})`);
    this.systemChat(`${p.name} joined the game`);
    if (this.match) {
      if (this.settings.fillBots > 0) this.balanceBots();
      this.match.addPlayer(p);
    }
    this.broadcastLobby();
  }

  createPlayer(name, bot, conn = null) {
    const p = {
      id: this.nextId++, name, bot, conn, team: TEAM.NONE, ping: 0,
      alive: false, hp: 0, armor: 0, helmet: false, kit: false, money: 0,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, crouch: 0, lean: 0, onGround: true,
      inv: { primary: null, secondary: null, nades: { frag: 0, flash: 0, smoke: 0, breach: 0 }, bomb: false },
      cur: 'knife', stats: { k: 0, d: 0, a: 0, hs: 0, dmg: 0, score: 0, mvp: 0 }, hist: [],
      tpId: 0, dmgTaken: new Map(),
    };
    this.players.set(p.id, p);
    return p;
  }

  setHost(p) {
    this.hostId = p.id;
    this.send(p, { t: 'host', host: true });
  }

  removePlayer(p) {
    if (!this.players.has(p.id)) return;
    this.match?.removePlayer(p);
    this.players.delete(p.id);
    if (!p.bot) {
      this.log(`- ${p.name} left`);
      this.systemChat(`${p.name} left the game`);
    }
    if (this.hostId === p.id) {
      this.hostId = null;
      const humans = [...this.players.values()].filter((x) => !x.bot);
      const next = humans.find((x) => x.conn?.isLocal) || humans[0];
      if (next) { this.setHost(next); this.systemChat(`${next.name} is now the host`); }
    }
    const humans = [...this.players.values()].filter((x) => !x.bot);
    if (!humans.length) {
      // nobody left: go back to the lobby and drop bots
      for (const b of [...this.players.values()]) this.players.delete(b.id);
      this.match = null;
    } else if (this.match && this.settings.fillBots > 0) {
      this.balanceBots();
    }
    this.broadcastLobby();
  }

  smallerTeam() {
    if (this.settings.mode === 'ffa' || this.settings.mode === 'gungame') return TEAM.ATT;
    let a = 0, d = 0;
    for (const p of this.players.values()) { if (p.team === TEAM.ATT) a++; else if (p.team === TEAM.DEF) d++; }
    return a <= d ? TEAM.ATT : TEAM.DEF;
  }

  // ------------------------------------------------------------------ chat / team

  handleChat(p, msg) {
    const text = String(msg.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 140);
    if (!text) return;
    const team = !!msg.team;
    const out = { t: 'chat', from: p.id, name: p.name, text, team, pteam: p.team, dead: !!this.match && !p.alive };
    if (team) {
      for (const q of this.players.values()) if (q.team === p.team) this.send(q, out);
    } else this.broadcast(out);
  }

  systemChat(text) {
    this.broadcast({ t: 'chat', from: null, name: '', text, sys: true });
  }

  handleTeam(p, team) {
    team = +team;
    if (![TEAM.NONE, TEAM.ATT, TEAM.DEF].includes(team) || p.team === team) return;
    const ffa = this.settings.mode === 'ffa' || this.settings.mode === 'gungame';
    if (ffa && team === TEAM.DEF) team = TEAM.ATT;
    p.team = team;
    if (this.match) {
      if (this.settings.fillBots > 0) this.balanceBots();
      this.match.teamChanged(p);
    }
    this.broadcastLobby();
  }

  // ------------------------------------------------------------------ host controls

  handleHost(p, msg) {
    if (p.id !== this.hostId) return;
    switch (msg.action) {
      case 'settings': this.applySettings(msg.settings || {}); break;
      case 'addBot': this.addBot(+msg.team || this.smallerTeam()); break;
      case 'removeBot': this.removeBot(+msg.team || 0); break;
      case 'kick': {
        const q = this.players.get(+msg.id);
        if (!q || q === p) return;
        if (q.bot) this.removePlayer(q);
        else { this.send(q, { t: 'error', msg: 'You were kicked by the host.' }); q.conn?.close(4003, 'kicked'); this.removePlayer(q); }
        break;
      }
      case 'move': {
        const q = this.players.get(+msg.id);
        if (q) this.handleTeam(q, +msg.team);
        break;
      }
      case 'shuffle': this.shuffleTeams(); break;
      case 'start': this.startMatch(); break;
      case 'end': this.returnToLobby(); break;
      default: break;
    }
  }

  applySettings(s) {
    const cur = this.settings;
    const next = { ...cur };
    if (s.mode in MODES) next.mode = s.mode;
    if (MAP_DEFS.some((m) => m.id === s.map)) next.map = s.map;
    const def = MAP_DEFS.find((m) => m.id === next.map);
    if (!def.modes.includes(next.mode)) {
      // keep the mode the host just picked if possible by switching map instead
      if (s.mode && !s.map) next.map = (MAP_DEFS.find((m) => m.modes.includes(next.mode)) || def).id;
      else next.mode = def.modes[0];
    }
    const num = (k, a, b) => { if (Number.isFinite(+s[k])) next[k] = clamp(Math.round(+s[k]), a, b); };
    num('maxRounds', 2, 30);
    if (next.maxRounds % 2) next.maxRounds++;
    num('roundTime', 30, 300);
    num('freezeTime', 2, 30);
    num('buyTime', 5, 90);
    num('bombTime', 20, 90);
    num('scoreLimit', 5, 200);
    num('timeLimit', 1, 60);
    num('fillBots', 0, 8);
    num('startMoney', 0, 16000);
    if (typeof s.friendlyFire === 'boolean') next.friendlyFire = s.friendlyFire;
    if (['easy', 'normal', 'hard', 'expert'].includes(s.botDifficulty)) next.botDifficulty = s.botDifficulty;
    if (WEATHER[s.weather] || s.weather === 'random') next.weather = s.weather;
    const modeChanged = next.mode !== cur.mode;
    this.settings = next;
    if (modeChanged) {
      const ffa = next.mode === 'ffa' || next.mode === 'gungame';
      if (ffa) for (const p of this.players.values()) if (p.team === TEAM.DEF) p.team = TEAM.ATT;
      if (!ffa) this.shuffleTeams(true);
    }
    this.broadcastLobby();
  }

  addBot(team) {
    const bots = [...this.players.values()].filter((p) => p.bot);
    if (bots.length >= 16) return;
    const used = new Set(bots.map((b) => b.name));
    const base = BOT_NAMES.find((n) => !used.has(`BOT ${n}`)) || `Bot${this.nextId}`;
    const b = this.createPlayer(`BOT ${base}`, true);
    const ffa = this.settings.mode === 'ffa' || this.settings.mode === 'gungame';
    b.team = ffa ? TEAM.ATT : (team === TEAM.DEF ? TEAM.DEF : TEAM.ATT);
    if (this.match) this.match.addPlayer(b);
    this.broadcastLobby();
    return b;
  }

  removeBot(team) {
    const bots = [...this.players.values()].filter((p) => p.bot && (!team || p.team === team));
    const b = bots[bots.length - 1];
    if (b) this.removePlayer(b);
  }

  // Keep each team filled up to settings.fillBots with bots.
  balanceBots() {
    const n = this.settings.fillBots;
    if (!n) return;
    const ffa = this.settings.mode === 'ffa' || this.settings.mode === 'gungame';
    const teams = ffa ? [TEAM.ATT] : [TEAM.ATT, TEAM.DEF];
    for (const t of teams) {
      const target = ffa ? n * 2 : n;
      const members = [...this.players.values()].filter((p) => p.team === t);
      let count = members.length;
      while (count < target) { this.addBot(t); count++; }
      const bots = members.filter((p) => p.bot);
      while (count > target && bots.length) { this.removePlayer(bots.pop()); count--; }
    }
  }

  shuffleTeams(keepHumansTogether = false) {
    const ffa = this.settings.mode === 'ffa' || this.settings.mode === 'gungame';
    const list = [...this.players.values()].filter((p) => p.team !== TEAM.NONE || p.bot);
    if (ffa) { for (const p of list) p.team = TEAM.ATT; this.broadcastLobby(); return; }
    const humans = list.filter((p) => !p.bot);
    const bots = list.filter((p) => p.bot);
    if (!keepHumansTogether) humans.sort(() => Math.random() - 0.5);
    let a = 0, d = 0;
    for (const p of [...humans, ...bots]) {
      if (a <= d) { p.team = TEAM.ATT; a++; } else { p.team = TEAM.DEF; d++; }
    }
    this.broadcastLobby();
  }

  startMatch() {
    if (this.match) this.match = null;
    const ffa = this.settings.mode === 'ffa' || this.settings.mode === 'gungame';
    for (const p of this.players.values()) {
      if (ffa && p.team === TEAM.DEF) p.team = TEAM.ATT;
    }
    this.balanceBots();
    this.match = new Match(this, this.settings);
    this.log(`Match started: ${MODES[this.match.mode].name} on ${this.match.map.name}`);
    this.broadcast({ t: 'match', ...this.match.matchInfo() });
    this.match.start();
    this.broadcastLobby();
  }

  returnToLobby() {
    if (!this.match) return;
    this.match = null;
    for (const p of this.players.values()) { p.alive = false; }
    this.broadcast({ t: 'lobbyReturn' });
    this.broadcastLobby();
  }

  lobbyState() {
    return {
      t: 'lobby',
      hostId: this.hostId,
      inMatch: !!this.match,
      settings: this.settings,
      serverName: this.serverName,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, ping: p.ping || 0 })),
    };
  }

  broadcastLobby() {
    this.broadcast(this.lobbyState());
  }
}
