import type { ServerWebSocket } from "bun";
import { pack, unpack } from "msgpackr";
import { SarsMatchManager, GameMode } from "./server/game-state";
import type { InputData } from "./server/game-state";
import { initPhysicsEngine, stepGlobalPhysics } from "./server/engine";

// ─── Concurrent Sessions Map ──────────────────────────────────────────────────

const matches = new Map<string, SarsMatchManager>();

function getOrCreateMatch(sessionId: string, mode: GameMode = "real"): SarsMatchManager {
  let match = matches.get(sessionId);
  if (!match) {
    match = new SarsMatchManager(sessionId, mode);
    matches.set(sessionId, match);
    console.log(`[Sars][${sessionId}] Created new room (Mode: ${mode}).`);
  }
  return match;
}

// Seamless Matchmaking logic
function findOpenRealSession(): string {
  for (const [sessionId, match] of matches.entries()) {
    if (match.gameMode === "real") {
      const humanCount = Array.from(match.players.values()).filter(p => !p.isBot).length;
      if (humanCount < match.maxLobbySize) {
        return sessionId;
      }
    }
  }
  // No open session found, generate a new one
  return `real_${crypto.randomUUID()}`;
}

// ─── Per-connection data ──────────────────────────────────────────────────────

interface WsData {
  id: string;
  session: string;
  mode: GameMode;
}

// ─── Server ───────────────────────────────────────────────────────────────────

async function startServer() {
  console.log("[Sars] Initializing Rapier3D Global Physics World...");
  await initPhysicsEngine();

  const server = Bun.serve<WsData>({
    port: Number(process.env.PORT ?? 8080),

    fetch(req, server) {
      const url = new URL(req.url);
      const mode = (url.searchParams.get("mode") as GameMode) || "real";
      
      let session = "";
      if (mode === "practice" || mode === "explore") {
        // Private rooms always get unique IDs
        session = `${mode}_${crypto.randomUUID()}`;
      } else {
        // Real mode: find an open session or use the provided one
        const reqSession = url.searchParams.get("session");
        if (reqSession && reqSession !== "default") {
          session = reqSession;
        } else {
          session = findOpenRealSession();
        }
      }

      const upgraded = server.upgrade(req, {
        data: { id: crypto.randomUUID(), session, mode },
      });
      if (upgraded) return undefined;
      return new Response("Sars Game Server — connect via WebSocket", { status: 200 });
    },

    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        const sessionId = ws.data.session;
        const match = getOrCreateMatch(sessionId, ws.data.mode);
        
        const humanCount = Array.from(match.players.values()).filter(p => !p.isBot).length;
        if (humanCount >= match.maxLobbySize) {
          ws.send(pack({ type: "ERROR", reason: "Lobby is full (max 8 players)" }));
          ws.close();
          return;
        }
        ws.subscribe(`sars-match:${sessionId}`);
        match.addPlayer(ws.data.id);
        ws.send(pack({ type: "INIT", id: ws.data.id, session: sessionId }));
        console.log(`[Sars][${sessionId}] Player connected: ${ws.data.id}`);
      },

      message(ws: ServerWebSocket<WsData>, message: string | ArrayBuffer | Uint8Array) {
        let buf: Uint8Array;
        if (message instanceof Uint8Array) {
          buf = message;
        } else if (message instanceof ArrayBuffer) {
          buf = new Uint8Array(message);
        } else {
          return;
        }

        const sessionId = ws.data.session;
        const match = matches.get(sessionId);
        if (!match) return;

        try {
          const msg = unpack(buf);
          const input = msg as InputData;

          match.processInput(ws.data.id, input);
        } catch (e) {
          console.error(`[Sars][${sessionId}] Bad message from ${ws.data.id}:`, e);
        }
      },

      close(ws: ServerWebSocket<WsData>) {
        const sessionId = ws.data.session;
        const match = matches.get(sessionId);
        if (match) {
          match.removePlayer(ws.data.id);
          const humanCount = Array.from(match.players.values()).filter(p => !p.isBot).length;
          if (humanCount === 0) {
            matches.delete(sessionId);
            console.log(`[Sars][${sessionId}] Disposed empty session.`);
          }
        }
        ws.unsubscribe(`sars-match:${sessionId}`);
        console.log(`[Sars][${sessionId}] Player disconnected: ${ws.data.id}`);
      },
    },
  });

  // ─── 30 Hz game loop ─────────────────────────────────────────────────────────

  setInterval(() => {
    // 1. Tick logic & inputs for all matches
    for (const match of matches.values()) {
      match.tickReloads();
      match.tickBots();
    }

    // 2. Step the Global Physics World ONCE per tick (Massive RAM optimization)
    stepGlobalPhysics();

    // 3. Resolve kinematic movements & broadcast state
    for (const [sessionId, match] of matches.entries()) {
      match.tickPhysics();
      const state = Array.from(match.players.values());
      const shots = match.pendingShots.splice(0);

      server.publish(`sars-match:${sessionId}`, pack({
        players: state,
        shots,
        gameMode: match.gameMode,
        teamScores: match.teamScores
      }));
    }
  }, 1000 / 30);

  console.log(`[Sars] Server running on ws://localhost:${server.port}`);
}

startServer().catch(console.error);
