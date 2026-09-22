// Minimal RFC 6455 WebSocket server (text frames, ping/pong, close). No dependencies.

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class WebSocketServer extends EventEmitter {
  constructor(httpServer, { path = '/ws', maxPayload = 256 * 1024 } = {}) {
    super();
    this.path = path;
    this.maxPayload = maxPayload;
    this.clients = new Set();
    httpServer.on('upgrade', (req, socket, head) => this._onUpgrade(req, socket, head));
    this._heartbeat = setInterval(() => {
      const now = Date.now();
      for (const c of this.clients) {
        if (now - c.lastSeen > 30000) c.terminate();
        else c._sendFrame(0x9, Buffer.alloc(0));
      }
    }, 10000);
    this._heartbeat.unref?.();
  }

  close() {
    clearInterval(this._heartbeat);
    for (const c of this.clients) c.terminate();
  }

  _onUpgrade(req, socket, head) {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== this.path || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15000);
    const conn = new WebSocketConnection(socket, req, this.maxPayload);
    this.clients.add(conn);
    conn.on('close', () => this.clients.delete(conn));
    if (head && head.length) conn._onData(head);
    this.emit('connection', conn, req);
  }
}

export class WebSocketConnection extends EventEmitter {
  constructor(socket, req, maxPayload) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.remoteAddress = normalizeAddress(req.socket.remoteAddress);
    this.buffer = Buffer.alloc(0);
    this.fragments = null;
    this.fragOpcode = 0;
    this.closed = false;
    this.lastSeen = Date.now();
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._finish());
    socket.on('error', () => this._finish());
  }

  get isLocal() {
    const a = this.remoteAddress;
    return a === '127.0.0.1' || a === '::1' || a === 'localhost';
  }

  get bufferedAmount() {
    return this.socket.writableLength;
  }

  send(data) {
    if (this.closed) return;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    this._sendFrame(Buffer.isBuffer(data) ? 0x2 : 0x1, payload);
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const r = Buffer.from(reason, 'utf8');
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this._sendFrame(0x8, p);
    this.closed = true;
    setTimeout(() => this.socket.destroy(), 200).unref?.();
    this._finish();
  }

  terminate() {
    this.socket.destroy();
    this._finish();
  }

  _finish() {
    if (this._done) return;
    this._done = true;
    this.closed = true;
    this.emit('close');
  }

  _sendFrame(opcode, payload) {
    if (this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this.terminate();
    }
  }

  _onData(chunk) {
    this.lastSeen = Date.now();
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (true) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) { this.close(1009, 'too big'); return; }
        len = Number(big);
        off = 10;
      }
      if (len > this.maxPayload) { this.close(1009, 'too big'); return; }
      if (!masked) { this.close(1002, 'unmasked'); return; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      off += 4;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = buf[off + i] ^ mask[i & 3];
      this.buffer = buf.subarray(off + len);
      this._onFrame(fin, opcode, payload);
      if (this.closed) return;
    }
  }

  _onFrame(fin, opcode, payload) {
    switch (opcode) {
      case 0x0: // continuation
        if (!this.fragments) { this.close(1002, 'bad continuation'); return; }
        this.fragments.push(payload);
        if (fin) {
          const all = Buffer.concat(this.fragments);
          const op = this.fragOpcode;
          this.fragments = null;
          this._deliver(op, all);
        }
        break;
      case 0x1:
      case 0x2:
        if (!fin) { this.fragments = [payload]; this.fragOpcode = opcode; return; }
        this._deliver(opcode, payload);
        break;
      case 0x8:
        if (!this.closed) {
          this._sendFrame(0x8, payload.subarray(0, 2));
          this.closed = true;
          setTimeout(() => this.socket.destroy(), 100).unref?.();
          this._finish();
        }
        break;
      case 0x9:
        this._sendFrame(0xA, payload);
        break;
      case 0xA:
        break;
      default:
        this.close(1002, 'bad opcode');
    }
  }

  _deliver(opcode, payload) {
    if (opcode === 0x1) this.emit('message', payload.toString('utf8'));
    else this.emit('message', payload);
  }
}

function normalizeAddress(a) {
  if (!a) return '';
  if (a.startsWith('::ffff:')) return a.slice(7);
  return a;
}
