// WebSocket connection with server clock synchronisation.

import { PROTOCOL_VERSION } from '../shared/constants.js';

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.offset = 0;          // serverTime - performance.now()
    this.rtt = 0;
    this.samples = [];
    this.connected = false;
    this.pingTimer = null;
    this.lastMessageAt = 0;
    this.synced = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, msg) {
    const list = this.handlers.get(type);
    if (list) for (const fn of list) {
      try { fn(msg); } catch (e) { console.error('handler error', type, e); }
    }
  }

  url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  connect(name, password) {
    this.close();
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name, password });
      this.samples = [];
      let n = 0;
      const burst = () => {
        if (this.ws !== ws || ws.readyState !== 1) return;
        this.ping();
        if (++n < 6) setTimeout(burst, 150);
      };
      burst();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), 2000);
      this.emit('open');
    };
    ws.onmessage = (ev) => {
      this.lastMessageAt = performance.now();
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'pong') { this.onPong(msg); return; }
      this.emit(msg.t, msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.connected = false;
      clearInterval(this.pingTimer);
      this.emit('close', { code: ev.code, reason: ev.reason });
    };
    ws.onerror = () => {};
  }

  close() {
    clearInterval(this.pingTimer);
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch { /* ignore */ }
    }
    this.connected = false;
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  ping() {
    this.send({ t: 'ping', c: performance.now(), rtt: Math.round(this.rtt) });
  }

  onPong(msg) {
    const now = performance.now();
    const rtt = now - msg.c;
    const offset = msg.s - (msg.c + rtt / 2);
    this.samples.push({ rtt, offset });
    if (this.samples.length > 12) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    if (!this.synced) { this.offset = best.offset; this.synced = true; }
    else this.offset += (best.offset - this.offset) * 0.2;
    const sorted = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
    this.rtt = sorted[Math.floor(sorted.length / 2)];
  }

  serverNow() { return performance.now() + this.offset; }
}
