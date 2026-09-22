#!/usr/bin/env node
// Breachpoint server entry point. Serves the game to browsers and runs the multiplayer simulation.
//
//   node server/index.js [--port 3000] [--name "My Server"] [--password secret] [--no-open]

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from './websocket.js';
import { createStaticHandler } from './static.js';
import { Game } from './game.js';
import { DEFAULT_PORT, GAME_NAME } from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { port: +(process.env.PORT || DEFAULT_PORT), name: process.env.SERVER_NAME || '', password: process.env.SERVER_PASSWORD || '', open: true, host: '0.0.0.0' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--port' || a === '-p') out.port = +next();
    else if (a === '--name') out.name = next();
    else if (a === '--password') out.password = next();
    else if (a === '--no-open') out.open = false;
    else if (a === '--host') out.host = next();
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function lanAddresses() {
  const res = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) res.push({ name, address: i.address });
    }
  }
  // Prefer typical home LAN ranges first, then VPNs like Tailscale (100.x) / ZeroTier.
  const rank = (a) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : a.startsWith('172.') ? 2 : a.startsWith('100.') ? 3 : 4);
  res.sort((x, y) => rank(x.address) - rank(y.address));
  return res;
}

function openBrowser(url) {
  try {
    const opts = { detached: true, stdio: 'ignore' };
    let child;
    if (process.platform === 'darwin') child = spawn('open', [url], opts);
    else if (process.platform === 'win32') child = spawn('cmd', ['/c', 'start', '', url], opts);
    else child = spawn('xdg-open', [url], opts);
    child.on('error', () => {});
    child.unref();
  } catch { /* ignore */ }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`${GAME_NAME} server\n\n  node server/index.js [--port 3000] [--name "My Server"] [--password secret] [--no-open]\n`);
  process.exit(0);
}

const addrs = lanAddresses();
const serverName = args.name || `${os.hostname().replace(/\.local$/, '')}'s server`;
const game = new Game({ name: serverName, password: args.password, addresses: addrs.map((a) => a.address), port: args.port });

const serveStatic = createStaticHandler([
  { prefix: '/shared/', dir: path.join(ROOT, 'shared') },
  { prefix: '/', dir: path.join(ROOT, 'client') },
]);

const server = http.createServer((req, res) => {
  if (req.url === '/api/info') {
    const body = JSON.stringify({ name: serverName, players: [...game.players.values()].filter((p) => !p.bot).length, password: !!args.password, addresses: game.addresses, port: args.port });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(body);
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer(server, { path: '/ws' });
wss.on('connection', (conn) => game.onConnection(conn));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${args.port} is already in use. Is the server already running?\n  Start on another port with:  node server/index.js --port ${args.port + 1}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(args.port, args.host, () => {
  game.start();
  const local = `http://localhost:${args.port}`;
  const line = '─'.repeat(58);
  console.log(`\n  ${line}`);
  console.log(`   ${GAME_NAME.toUpperCase()}  ·  server "${serverName}" is running`);
  console.log(`  ${line}`);
  console.log(`   You (host) play at:     ${local}`);
  if (addrs.length) {
    console.log(`   Friends on your network / VPN open one of:`);
    for (const a of addrs) console.log(`       http://${a.address}:${args.port}    (${a.name})`);
  }
  console.log(`   Over the internet: see README (Tailscale / port forward)`);
  if (args.password) console.log(`   Password protected: yes`);
  console.log(`  ${line}`);
  console.log(`   Keep this window open while you play. Ctrl+C to stop.\n`);
  if (args.open && !process.env.NO_OPEN) openBrowser(local);
});

function shutdown() {
  console.log('\n  Shutting down...');
  wss.close();
  game.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
