import type { ServerWebSocket } from "bun";
import { pack, unpack } from "msgpackr";
import { SarsMatchManager } from "./server/game-state";
import type { InputData } from "./server/game-state";

// ─── Match state ─────────────────────────────────────────────────────────────

const matchManager = new SarsMatchManager();

// Pending bullet-trace events for the next broadcast: [originX, originZ, dirX, dirZ]
const pendingShots: [number, number, number, number][] = [];

// ─── Per-connection data ──────────────────────────────────────────────────────

interface WsData {
  id: string;
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = Bun.serve<WsData>({
  port: Number(process.env.PORT ?? 8080),

  fetch(req, server) {
    const upgraded = server.upgrade(req, {
      data: { id: crypto.randomUUID() },
    });
    if (upgraded) return undefined;
    return new Response("Sars Game Server — connect via WebSocket", { status: 200 });
  },

  websocket: {
    open(ws: ServerWebSocket<WsData>) {
      ws.subscribe("sars-match");
      matchManager.addPlayer(ws.data.id);
      ws.send(pack({ type: "INIT", id: ws.data.id }));
      console.log(`[Sars] Player connected:    ${ws.data.id}`);
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

      try {
        const input = unpack(buf) as InputData;

        // Record shot origin before processing so we can broadcast the trace
        if (input.shoot) {
          const shooter = matchManager.players.get(ws.data.id);
          if (shooter) {
            const dirX = Math.sin(shooter.rotY);
            const dirZ = Math.cos(shooter.rotY);
            pendingShots.push([
              shooter.position.x,
              shooter.position.z,
              dirX,
              dirZ,
            ]);
          }
        }

        matchManager.processInput(ws.data.id, input);
      } catch (e) {
        console.error(`[Sars] Bad message from ${ws.data.id}:`, e);
      }
    },

    close(ws: ServerWebSocket<WsData>) {
      matchManager.removePlayer(ws.data.id);
      ws.unsubscribe("sars-match");
      console.log(`[Sars] Player disconnected: ${ws.data.id}`);
    },
  },
});

// ─── 30 Hz game loop ─────────────────────────────────────────────────────────

setInterval(() => {
  // Tick bot AI
  matchManager.tickBots();

  // Collect any bot shots for traces
  // (bot shots are generated inside tickBots, we sample post-tick from bot positions)

  // Broadcast state + shot traces to all subscribers
  const state = Array.from(matchManager.players.values());
  const shots = pendingShots.splice(0); // drain and reset

  server.publish("sars-match", pack({ players: state, shots }));
}, 1000 / 30);

console.log(`[Sars] Server running on ws://localhost:${server.port}`);
