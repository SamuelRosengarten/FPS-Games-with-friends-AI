// Test helpers: a Game with a fake clock that can be fast-forwarded.
import { Game } from '../server/game.js';

export class TestGame extends Game {
  constructor(opts = {}) {
    super({ log: () => {}, ...opts });
    this.clock = 1000;
    this.sent = [];
  }
  now() { return this.clock; }
  // run the simulation for `seconds` of game time at the server tick rate
  run(seconds, dt = 1 / 60) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      this.clock += dt * 1000;
      if (this.match) this.match.tick(dt);
    }
  }
}

// A fake connection that records messages.
export function fakeConn(local = true) {
  const handlers = {};
  return {
    isLocal: local,
    remoteAddress: local ? '127.0.0.1' : '192.168.1.50',
    bufferedAmount: 0,
    inbox: [],
    on(ev, fn) { handlers[ev] = fn; },
    send(s) { this.inbox.push(JSON.parse(s)); },
    close() { handlers.close?.(); },
    emit(ev, arg) { handlers[ev]?.(arg); },
    last(type) { for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i].t === type) return this.inbox[i]; return null; },
    all(type) { return this.inbox.filter((m) => m.t === type); },
  };
}
