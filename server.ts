import { pack, unpack } from 'msgpackr';
import { SarsMatchManager, Player, InputData } from './server/game-state';

const matchManager = new SarsMatchManager();

// Setup the WebSocket server using Bun
const server = Bun.serve<{ id: string }>({
    port: process.env.PORT || 8080,
    fetch(req, server) {
        // Upgrade incoming HTTP requests to WebSocket
        const upgraded = server.upgrade(req, {
            data: {
                id: crypto.randomUUID(), // Assign unique ID
            }
        });
        
        if (upgraded) {
            return undefined;
        }

        return new Response("Not Found", { status: 404 });
    },
    websocket: {
        open(ws) {
            // Subscribe to the game match channel
            ws.subscribe('sars-match');
            
            // Instantiate a new player with the generated ID
            matchManager.addPlayer(ws.data.id);
            
            console.log(`Player connected: ${ws.data.id}`);
        },
        message(ws, message) {
            // Unpack binary payload with msgpackr
            try {
                if (message instanceof Buffer || message instanceof Uint8Array) {
                    const input: InputData = unpack(message);
                    matchManager.processInput(ws.data.id, input);
                }
            } catch (err) {
                console.error("Failed to unpack message from", ws.data.id, err);
            }
        },
        close(ws) {
            matchManager.removePlayer(ws.data.id);
            ws.unsubscribe('sars-match');
            console.log(`Player disconnected: ${ws.data.id}`);
        }
    }
});

// Run a 30Hz update loop to broadcast player state
setInterval(() => {
    // Collect updated player states
    const playersArray: Player[] = Array.from(matchManager.players.values());
    
    // Pack into a binary buffer
    const stateBuffer = pack(playersArray);

    // Publish to everyone subscribed to 'sars-match'
    server.publish('sars-match', stateBuffer);
}, 1000 / 30);

console.log(`Sars Match Server running on port ${server.port}`);
