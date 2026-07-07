import type { ServerWebSocket } from "bun";
import { pack, unpack } from "msgpackr";
import { SarsMatchManager } from "./server/game-state";
import type { InputData } from "./server/game-state";

// ─── Concurrent Sessions Map ──────────────────────────────────────────────────

const matches = new Map<string, SarsMatchManager>();

function getOrCreateMatch(sessionId: string): SarsMatchManager {
  let match = matches.get(sessionId);
  if (!match) {
    match = new SarsMatchManager();
    match.onShot = (ox, oz, dx, dz) => {
      match!.pendingShots.push([ox, oz, dx, dz]);
    };
    matches.set(sessionId, match);
    console.log(`[Sars][${sessionId}] Initialized session.`);
  }
  return match;
}

// ─── Per-connection data ──────────────────────────────────────────────────────

interface WsData {
  id: string;
  session: string;
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = Bun.serve<WsData>({
  port: Number(process.env.PORT ?? 8080),

  fetch(req, server) {
    const url = new URL(req.url);
    const session = url.searchParams.get("session") ?? "default";
    const upgraded = server.upgrade(req, {
      data: { id: crypto.randomUUID(), session },
    });
    if (upgraded) return undefined;
    return new Response("Sars Game Server — connect via WebSocket", { status: 200 });
  },

  websocket: {
    open(ws: ServerWebSocket<WsData>) {
      const sessionId = ws.data.session;
      const match = getOrCreateMatch(sessionId);
      
      const humanCount = Array.from(match.players.values()).filter(p => !p.isBot).length;
      if (humanCount >= 8) {
        ws.send(pack({ type: "ERROR", reason: "Lobby is full (max 8 players)" }));
        ws.close();
        return;
      }
      ws.subscribe(`sars-match:${sessionId}`);
      match.addPlayer(ws.data.id);
      ws.send(pack({ type: "INIT", id: ws.data.id }));
      console.log(`[Sars][${sessionId}] Player connected: ${ws.data.id}`);
    },

    message(ws: ServerWebSocket<WsData>, message: string | ArrayBuffer | Uint8Array) {
      let buf: Uint8Array;
      if (message instanceof Uint8Array) {
        buf = message;
      } else if (message instanceof ArrayBuffer) {
        buf = new Uint8Array(message);
      } else {
        return; // ignore plain-text frames
      }

      const sessionId = ws.data.session;
      const match = getOrCreateMatch(sessionId);

      try {
        const msg = unpack(buf);
        if (msg && msg.type === "CHANGE_MODE") {
          match.setGameMode(msg.mode);
          return;
        }
        if (msg && msg.type === "SET_BOT_DIFFICULTY") {
          match.setBotDifficulty(msg.difficulty);
          return;
        }

        const input = msg as InputData;

        // Record human shot trace
        if (input.shoot) {
          const shooter = match.players.get(ws.data.id);
          if (shooter && shooter.reloadTicks === 0 && shooter.shootCooldownTicks === 0 && shooter.ammo > 0) {
            const dirX = -Math.sin(shooter.rotY);
            const dirZ = -Math.cos(shooter.rotY);
            match.pendingShots.push([
              shooter.position.x,
              shooter.position.z,
              dirX,
              dirZ,
            ]);
          }
        }

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
        // Garbage collect empty session matches to keep memory footprint low
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
  for (const [sessionId, match] of matches.entries()) {
    // Tick game components for this match
    match.tickReloads();
    match.tickBots();
    match.tickPhysics(); // Authoritative vertical physics

    const state = Array.from(match.players.values());
    const shots = match.pendingShots.splice(0); // drain and reset

    server.publish(`sars-match:${sessionId}`, pack({
      players: state,
      shots,
      gameMode: match.gameMode,
      teamScores: match.teamScores
    }));
  }
}, 1000 / 30);

console.log(`[Sars] Server running on ws://localhost:${server.port}`);
