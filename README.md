# SARS — Browser-Native Multiplayer FPS (Prototype)

> A real-time, browser-native first-person shooter built entirely with Next.js, React Three Fiber, and a Bun WebSocket server. No Unity, no game engine downloads — runs in any modern browser tab.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend Framework | Next.js 16 (App Router) |
| 3D Engine | Three.js + React Three Fiber (`@react-three/fiber`) |
| 3D Helpers | `@react-three/drei` (Sky, PointerLockControls, Text) |
| Game Server | [Bun](https://bun.sh) WebSocket server (`server.ts`) |
| Binary Protocol | [msgpackr](https://github.com/kriszyp/msgpackr) (efficient binary encoding) |
| Styling | Tailwind CSS v4 |
| Language | TypeScript (strict) |

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│  Browser Tab (Next.js / React Three Fiber)                │
│                                                           │
│  ┌──────────────┐  WebSocket (binary/msgpack)  ┌───────┐ │
│  │  GameCanvas  │ ◄────────────────────────── │  Bun  │ │
│  │  (R3F Scene) │ ──── InputData frame ──────► │  WS   │ │
│  └──────────────┘                              │  8080 │ │
│                                                └───┬───┘ │
└────────────────────────────────────────────────────┼──────┘
                                                     │
                                          ┌──────────▼──────────┐
                                          │  SarsMatchManager   │
                                          │  ┌───────────────┐  │
                                          │  │ Human Players │  │
                                          │  │ Bot Players   │  │
                                          │  └───────────────┘  │
                                          │  SarsPhysicsEngine  │
                                          │  ┌───────────────┐  │
                                          │  │ Cylinder AABB │  │
                                          │  │ 2D Hitscan    │  │
                                          │  └───────────────┘  │
                                          └─────────────────────┘
```

### Data Flow

1. **Client → Server (30 Hz):** Each browser tab sends a packed `InputData` frame every render tick via `useFrame`:
   ```ts
   { w, a, s, d: boolean, rotY: number, shoot: boolean }
   ```

2. **Server → Client (30 Hz):** The Bun server broadcasts a packed `ServerFrame` to the `sars-match` pub/sub channel:
   ```ts
   { players: Player[], shots: [ox, oz, dx, dz][] }
   ```

3. **Bot AI (30 Hz):** Bots seek the nearest player, rotate toward them, walk forward, and fire probabilistically.

---

## Project Structure

```
sars/
├── app/
│   ├── layout.tsx          # Root layout with Tailwind, fonts, suppressHydrationWarning
│   ├── page.tsx            # Home page — nav bar + GameCanvas
│   └── play/
│       └── page.tsx        # (Legacy Unity bridge page — unused)
│
├── components/
│   └── GameCanvas.tsx      # Full R3F game scene, HUD, bullet traces, network
│
├── server/
│   ├── engine.ts           # SarsPhysicsEngine — cylinder collision + hitscan
│   └── game-state.ts       # SarsMatchManager — players, bots, input processing
│
├── server.ts               # Bun WebSocket server entry point
├── next.config.ts          # transpilePackages for Three.js ESM
└── package.json
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Bun](https://bun.sh/) >= 1.0

### Install

```bash
npm install
```

### Run (both processes)

```bash
npm run dev:all
```

This uses `concurrently` to start:
- **Next.js dev server** on `http://localhost:3000`
- **Bun game server** on `ws://localhost:8080`

Or run them separately in two terminals:

```bash
# Terminal 1 — Next.js frontend
npm run dev

# Terminal 2 — Bun game server
npm run dev:server
```

### Play

1. Open `http://localhost:3000` in your browser
2. Click the canvas to lock the cursor
3. WASD to move, mouse to aim, left-click to shoot

> **Multi-tab:** Open multiple tabs — each generates a new unique player. Bots automatically fill the remaining slots up to 8 total.

---

## Gameplay

| Mechanic | Detail |
|----------|--------|
| Max players | 8 (bots fill empty slots) |
| Player shape | Cylinder (radius 0.8, height 2.0) |
| Damage per hit | 20 HP |
| Respawn | Instant at a random position |
| Scoring | +1 per kill |
| Bullet traces | Yellow streak fades over 300ms |
| Bot AI | Seek nearest -> rotate -> walk -> shoot (3% chance/tick) |

---

## Physics Engine (`server/engine.ts`)

### `SarsPhysicsEngine.checkPlayerCollision(pos1, pos2)`

Checks XZ-plane circle overlap **and** Y-axis interval overlap for cylindrical bounding boxes.

```
PLAYER_RADIUS = 0.8
PLAYER_HEIGHT = 2.0

XZ: sqrt((x2-x1)^2 + (z2-z1)^2) < RADIUS * 2
Y:  pos1.y < pos2.y + HEIGHT  &&  pos1.y + HEIGHT > pos2.y
```

### `SarsPhysicsEngine.checkHitscan(origin, rotY, target)`

Projects a 2D ray on the XZ plane and checks if the perpendicular distance from the target center to the ray is within `PLAYER_RADIUS`.

```
dir = [sin(rotY), cos(rotY)]
perpDist = |cross(toTarget, dir)|   (2D cross product magnitude)
hit = dot(toTarget, dir) > 0  &&  perpDist <= PLAYER_RADIUS
```

---

## Known Limitations (Prototype Stage)

> This is a proof-of-concept prototype. The following are not yet implemented:

- **No authentication** — player IDs are anonymous UUIDs
- **No lag compensation** — server authority only; fast clients feel input lag
- **No anti-cheat** — all inputs are trusted
- **No persistent scores** — state lives in memory; restarting the server resets everything
- **Bot pathfinding** — bots walk in straight lines (no obstacle avoidance)
- **Single arena** — no map selection or rotation
- **WebSocket only** — no HTTPS/WSS config for production

---

## Roadmap

- [ ] Lag compensation (client-side prediction + server reconciliation)
- [ ] Map editor / multiple arenas
- [ ] Weapon variety (rifle, shotgun, sniper)
- [ ] Persistent leaderboard (Postgres / Redis)
- [ ] WSS + HTTPS for production deployment
- [ ] Better bot AI (pathfinding around cover boxes)
- [ ] Sound effects (Web Audio API)
- [ ] Mobile touch controls

---

## License

MIT — prototype, use freely.
