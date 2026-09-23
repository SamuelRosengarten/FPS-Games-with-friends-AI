# BREACHPOINT

A self-hosted, multiplayer tactical FPS for you and your friends — inspired by Counter-Strike 2 and Rainbow Six Siege.
One friend runs the server, everyone else plays in the browser. Works on **MacBook (Apple Silicon M1–M4)** and **Windows PCs**,
with **keyboard & mouse or a controller**.

- **4 game modes**: Defuse (round-based bomb plant/defuse with economy), Team Deathmatch, Free For All, Gun Game
- **4 maps**: *Sandstone* (desert town, long mid + tunnels), *Compound* (fortified building with breakable walls),
  *Embassy* (two floors: atrium, balcony, inside and outside staircases), *Arena* (compact deathmatch)
- **11 guns + knife + frag/flash/smoke grenades + breach charges**, learnable recoil patterns, movement/jump inaccuracy,
  aim-down-sights, sniper scopes, tagging (getting hit slows you down)
- **R6-style destruction**: breakable wooden walls you can shoot or blow holes through, wall-banging, leaning (Q/E);
  Defenders **reinforce walls** with steel (bullet- and grenade-proof), Attackers blow them open with **breach charges**
- **CS-style economy**: buy menu, kill rewards, loss bonus, armor & helmet, defuse kits, dropped weapons you can pick up
- **Bots** with 4 difficulty levels (Easy → Expert) that aim like people (reaction time, flicks that over/undershoot,
  recoil control, counter-strafing, bursts at range), remember where they last saw you, hold angles and pre-aim corners,
  stage out of sight and execute onto sites together, retake, play post-plant, call out enemies to human teammates,
  buy as a team (eco / force / full buy), throw frags, pop-flashes and smokes, reinforce walls and use breach charges
- **Lag-compensated hit detection**, spectating, killfeed, damage given/taken report, scoreboard, two-floor radar, chat,
  3D audio with sounds muffled behind walls
- **Realistic operators**: smoothly skinned soldiers with sculpted faces, high-cut helmets with headsets, goggles or
  ballistic glasses, balaclavas and shemaghs, plate carriers with magazine / radio / admin pouches, battle belts,
  holsters, knee and elbow pads, gloves and boots — with camouflage, fabric weave, MOLLE webbing, skin, leather and
  rubber surface detail (Attackers in desert multicam, Defenders in navy)
- **High-end graphics** (Ultra preset for M-series Pro/Max and RTX GPUs): 4K shadow maps, ambient occlusion (GTAO), bloom,
  4× MSAA, physically based materials, sky lighting, per-map colour grading, a distant skyline around every map (desert town
  with mesas, factories with smoking stacks, a city of towers, forested hills), detailed map dressing (windows, palms and
  grass swaying in the wind, waving flags, a fountain, rooftop clutter, AC units, pipes, wires, graffiti, puddles, rocks,
  litter, pallets, tyres…), real stacked sandbags, oil drums, a box truck, shipping containers with door hardware,
  parallax-mapped bricks, stone, tiles and planks with real depth on Ultra, detailed weapon models (extruded frames,
  serrations, scopes) with wood grain, brushed/scratched metal and stippled polymer, gloved hands with real fingers,
  shell casings, blood
  splatter, fireballs, dust motes, and a dynamic-resolution system with automatic effect fallbacks that keeps you
  **above 60 FPS**
- 100% procedural: textures, models and sounds are generated in code — no downloads besides this repo

---

## Quick start

### 1. The host (the friend who runs the server)

1. Install **Node.js LTS** (version 18 or newer) from <https://nodejs.org>.
2. Download this repository (green **Code** button → **Download ZIP**, then unzip it) or `git clone` it.
3. Start the server:
   - **Mac**: double-click `start-server.command`
     (the first time macOS may block it — right-click the file → **Open** → **Open**).
     Or in Terminal: `cd` into the folder and run `npm start`.
   - **Windows**: double-click `start-server.bat`.
     If Windows Firewall asks, click **Allow access** (tick *Private networks*).
   - **Linux**: `./start-server.sh`
4. Your browser opens `http://localhost:3000` automatically. Enter a name and press **PLAY**.
   You are the **host**: pick the mode, map and bots in the lobby and press **START MATCH**.

The server window shows the addresses your friends should use, for example:

```
 You (host) play at:     http://localhost:3000
 Friends on your network / VPN open one of:
     http://192.168.1.23:3000    (en0)
```

Keep that window open while you play. Close it (or press Ctrl+C) to stop the server.

### 2. Friends

Friends don't install anything — they open the host's address in **Chrome, Edge, Safari or Firefox**, type a name and click **PLAY**.

---

## Playing together over the internet

If everyone is on the **same Wi-Fi / network**, just use the `http://192.168.x.x:3000` address shown by the server.

For friends in **other houses**, pick one of these:

### Option A — Tailscale (recommended, free, no router setup, secure)

1. Everyone installs [Tailscale](https://tailscale.com/download) and signs in.
2. The host invites friends to their tailnet (Tailscale admin console → *Users* → *Invite*),
   or shares just their computer (*Machines* → the host PC → *Share…*).
3. Friends open `http://<host's Tailscale IP>:3000` (the IP starting with `100.`; the server also prints it).

Bonus: `tailscale serve 3000` on the host gives a proper `https://...ts.net` address — handy for controllers on Firefox (see below).

### Option B — Port forwarding

1. In your router settings, forward **TCP port 3000** to the host computer's local IP.
2. Find your public IP (e.g. search "what is my ip").
3. Friends open `http://<your public IP>:3000`.
4. Consider adding a password: `node server/index.js --password yoursecret`.

### Option C — Tunnel services

Tools like [playit.gg](https://playit.gg), [ngrok](https://ngrok.com) (`ngrok http 3000`) or Cloudflare Tunnel also work
(websockets are supported; https tunnels work out of the box).

---

## Controls

| Action | Keyboard & mouse | Controller (Xbox / PlayStation) |
|---|---|---|
| Move / look | W A S D / mouse | Left stick / right stick |
| Fire / aim down sights (scope) | Left click / right click | RT / LT (R2 / L2) |
| Jump / crouch | Space / Ctrl or C | A (✕) / B (○) |
| Walk quietly (no footsteps) | Shift | L3 (toggle) |
| Reload | R | X (□) — **hold X** to plant / defuse / pick up |
| Use: plant, defuse, pick up weapon, reinforce wall (Defenders, hold) | F | hold X (□) |
| Lean left / right | Q / E | LB / RB (L1 / R1) |
| Weapons | 1 primary, 2 pistol, 3 knife, 4 grenades, 5 bomb, mouse wheel | Y next weapon, R3 knife, D-pad ← grenades, D-pad → last weapon |
| Last weapon | X | D-pad → |
| Drop weapon | G | D-pad ↓ |
| Buy menu | B (then number keys or click) | D-pad ↑ (D-pad to move, A to buy, B to close) |
| Scoreboard | Tab (hold) | View / Share (hold) |
| Chat all / team | Y (or Enter) / U | — |
| Inspect weapon | V | — |
| Menu | Esc | Menu / Options |

Grenades: **left click** throws hard, **right click** lobs underhand. Knife: left click slash, right click heavy stab (backstabs are lethal).
All keys can be rebound in **Settings → Keys**.

---

## Game modes

- **Defuse** — Attackers must plant the bomb at site **A** or **B**; Defenders stop them or defuse it (a kit halves the defuse time).
  No respawns within a round. Money is earned from wins, losses (with a loss bonus), kills and plants.
  Teams swap sides at halftime. Default: 12 rounds, first to 7.
- **Team Deathmatch** — instant respawns, all weapons free (press B after spawning to choose your loadout). First team to the kill limit.
- **Free For All** — everyone against everyone, first to the kill limit.
- **Gun Game** — every kill gives you the next weapon; the last one is the knife. Getting knifed sends you back a level.

The host can change rounds, round time, kill/time limits, friendly fire, and fill teams with **bots** (Easy / Normal / Hard /
Expert) from the lobby. *Easy* is relaxed, *Normal* is a fair fight for casual players, *Hard* punishes mistakes and *Expert*
has near-pro reactions and aim — use it when you want a real challenge. Players can join a match that is already running.

### Weapons

| Slot | Weapons |
|---|---|
| Pistols | P9 Striker (Attacker default), Warden P2 (Defender default), Magnum .50 |
| SMGs & heavy | Rattler SMG, Hornet SMG, Breacher 12 shotgun (great for breaking walls) |
| Rifles | Marauder, Striker AR (one-tap headshots), Guardian M4 (red dot, easier recoil) |
| Snipers | Kestrel (light, fast), Longbow (one shot to the body) |
| Gear | Kevlar, Kevlar + Helmet, Defuse kit (Defenders) |
| Grenades | Frag, Flashbang, Smoke, Breach charge (Attackers in Defuse: sticks to walls and blows reinforced walls open) |

Tips: sprays follow a fixed pattern (pull down and slightly sideways to control it), shooting while running or jumping is very
inaccurate — stop (or counter-strafe) before you shoot. Walking (Shift) makes you silent. Wooden walls can be shot through —
unless a Defender reinforced them (each Defender can reinforce 2 wall sections per round, also during buy time: look at a
wooden wall and hold **F**). Only a breach charge opens a reinforced wall.

---

## Graphics & performance

Open **Settings → Video**:

- **Auto** picks a preset for your GPU. MacBook Pro M-series (Pro/Max) and RTX cards get **Ultra**:
  native Retina resolution, 4096² soft shadows, GTAO ambient occlusion, bloom, 4× MSAA, 1024² PBR textures.
- **Dynamic resolution** (on by default) lowers the render resolution for a moment if the frame rate drops below 60 FPS
  and restores it when there's headroom, so the game stays smooth. You can cap it with *Max render scale*.
- Friends on older laptops can pick **High**, **Medium** or **Low**.
- If your GPU still can't hold 60 FPS at the lowest resolution, the game switches off the most expensive effects one by one
  (ambient occlusion, bloom, MSAA, shadow resolution) and tells you in the FPS line.
- Turn on **Show FPS counter** to see FPS, preset, resolution, draw calls, CPU time and ping.

Browser tips: use an up-to-date **Chrome, Edge or Safari** with hardware acceleration enabled. On a 120 Hz ProMotion
MacBook, Chrome renders at 120 FPS. Use fullscreen (pause menu → *Toggle fullscreen*) for the best experience.

---

## Server options

```
node server/index.js [--port 3000] [--name "Sam's server"] [--password secret] [--no-open]
```

- `--port` — change the port (default 3000; also `PORT` env var)
- `--name` — server name shown in the lobby
- `--password` — require a password to join
- `--no-open` — don't open the browser on start

---

## Troubleshooting

- **Friends can't connect** — make sure they use the address printed by the server (not `localhost`), that the host allowed Node.js
  through the firewall (Windows: *Windows Defender Firewall → Allow an app → Node.js*; macOS: *System Settings → Network → Firewall*),
  and for internet play see [Playing together over the internet](#playing-together-over-the-internet).
- **"Port 3000 is already in use"** — the server is already running, or start it on another port: `node server/index.js --port 3001`.
- **Controller not detected** — press any button on it while the game tab is focused. Firefox only allows controllers on
  `https://` pages; use Chrome/Edge/Safari or an https address (e.g. `tailscale serve`).
- **Ctrl+W closed my tab on Windows** — Ctrl is crouch by default and Ctrl+W is a browser shortcut. Use fullscreen mode
  (the game then captures the keyboard), or rebind crouch to C in *Settings → Keys*. The game also asks before leaving.
- **Game version mismatch** — the host updated the game: refresh the page (Ctrl+F5 / Cmd+Shift+R).
- **Low FPS** — lower the preset in *Settings → Video* and keep *Dynamic resolution* on. Make sure the browser uses the GPU
  (chrome://gpu should show hardware acceleration).

---

## For developers

```
npm test          # physics, networking, navigation and full bot-match simulations
npm run dev       # start the server without opening a browser
node tools/bot-report.js sandstone defuse hard 3   # bot quality metrics: accuracy, reaction, stuck/idle time…
```

- `server/` — zero-dependency Node server: HTTP + WebSocket (`websocket.js`), lobby & host controls (`game.js`),
  match simulation with rounds/economy/grenades/bomb/lag compensation (`match.js`), bot AI (`bot.js`), map analysis for bots —
  site entrances, holding angles, hidden staging points, post-plant spots (`tactics.js`) — and navigation mesh (`nav.js`)
- `shared/` — code used by both server and browser: constants, weapons, physics & hitboxes, maps (grid-based map format in `shared/maps/`)
- `client/` — the browser game: renderer & post-processing (`graphics.js`), procedural textures, world, models, viewmodel,
  effects, synthesized audio, input (keyboard/mouse/gamepad), HUD and menus. Characters are built in `character.js`
  on the shared surface-detail material and geometry builder in `surface.js`. `client/dev/` is a small model viewer
  (`/dev/?view=players`, `?view=weapons`, `?view=vm&w=ar`, `?view=map&map=compound&cam=x,y,z,yaw,pitch`).
- Maps are ASCII-style grids carved with a few helper calls — see `shared/maps/sandstone.js`, and `node tools/print-map.js` to preview.
  A map can add a second floor (`upper` grid) and staircases (`stairs`) — see `shared/maps/embassy.js`. Cosmetic dressing is
  configured per map in `decor` and generated by `client/js/decor.js` (the distant scenery by `client/js/skyline.js`).

Three.js (MIT) is vendored in `client/vendor/three` so the game works offline on a LAN.
