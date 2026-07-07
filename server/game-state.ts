import { SarsPhysicsEngine, Vector3 } from './engine';

export interface Player {
    id: string;
    position: Vector3;
    rotY: number;
    health: number;
    score: number;
}

export interface InputData {
    w: boolean;
    a: boolean;
    s: boolean;
    d: boolean;
    rotY: number;
    shoot: boolean;
}

export class SarsMatchManager {
    public players: Map<string, Player> = new Map();
    private readonly PLAYER_SPEED = 0.2; // Arbitrary movement unit per tick

    /**
     * Adds a new player to the match.
     */
    public addPlayer(id: string): void {
        this.players.set(id, {
            id,
            position: this.getRandomSpawnPosition(),
            rotY: 0,
            health: 100,
            score: 0
        });
    }

    /**
     * Removes a player from the match.
     */
    public removePlayer(id: string): void {
        this.players.delete(id);
    }

    /**
     * Processes input from a player, updating movement, collisions, and shooting logic.
     */
    public processInput(playerId: string, input: InputData): void {
        const player = this.players.get(playerId);
        if (!player) return;

        // Update player's rotation
        player.rotY = input.rotY;

        // --- Movement Logic ---
        let moveX = 0;
        let moveZ = 0;

        // Forward vector
        const forwardX = Math.sin(player.rotY);
        const forwardZ = Math.cos(player.rotY);

        // Right vector (rotY + PI/2)
        const rightX = Math.cos(player.rotY);
        const rightZ = -Math.sin(player.rotY);

        if (input.w) {
            moveX += forwardX;
            moveZ += forwardZ;
        }
        if (input.s) {
            moveX -= forwardX;
            moveZ -= forwardZ;
        }
        if (input.a) {
            moveX -= rightX;
            moveZ -= rightZ;
        }
        if (input.d) {
            moveX += rightX;
            moveZ += rightZ;
        }

        // Normalize movement to prevent moving faster diagonally
        const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (length > 0) {
            moveX = (moveX / length) * this.PLAYER_SPEED;
            moveZ = (moveZ / length) * this.PLAYER_SPEED;
        }

        const newPosition: Vector3 = {
            x: player.position.x + moveX,
            y: player.position.y,
            z: player.position.z + moveZ
        };

        // --- Collision Logic ---
        let hasCollision = false;
        for (const [otherId, otherPlayer] of this.players) {
            if (otherId === playerId) continue;

            if (SarsPhysicsEngine.checkPlayerCollision(newPosition, otherPlayer.position)) {
                hasCollision = true;
                break;
            }
        }

        // Apply movement if no collision
        if (!hasCollision) {
            player.position.x = newPosition.x;
            player.position.z = newPosition.z;
        }

        // --- Shooting Logic ---
        if (input.shoot) {
            for (const [otherId, otherPlayer] of this.players) {
                if (otherId === playerId) continue;

                const isHit = SarsPhysicsEngine.checkHitscan(player.position, player.rotY, otherPlayer.position);
                if (isHit) {
                    otherPlayer.health -= 20;

                    // Handle player death
                    if (otherPlayer.health <= 0) {
                        otherPlayer.health = 100;
                        otherPlayer.position = this.getRandomSpawnPosition();
                        player.score += 1;
                    }
                }
            }
        }
    }

    private getRandomSpawnPosition(): Vector3 {
        // Simple random spawn around the center (from -20 to 20 on X and Z axis)
        return {
            x: (Math.random() - 0.5) * 40,
            y: 0,
            z: (Math.random() - 0.5) * 40
        };
    }
}
