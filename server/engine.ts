export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

export interface BoundingBox {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
}

export const CRATES: [number, number][] = [
    [-9, -9], [9, 9], [0, 16], [-16, 0], [16, -6],
    [6, -19], [-11, 13], [13, -16], [-20, 20], [20, -20],
];

export const PILLARS: [number, number][] = [
    [0, 8], [-8, 0], [8, 0]
];

export const OBSTACLES: BoundingBox[] = [
    ...CRATES.map(([x, z]) => ({
        minX: x - 1.25,
        maxX: x + 1.25,
        minY: 0,
        maxY: 2,
        minZ: z - 1.25,
        maxZ: z + 1.25,
    })),
    ...PILLARS.map(([x, z]) => ({
        minX: x - 0.6,
        maxX: x + 0.6,
        minY: 0,
        maxY: 4,
        minZ: z - 0.6,
        maxZ: z + 0.6,
    })),
];

export class SarsPhysicsEngine {
    public static readonly PLAYER_RADIUS = 0.8;
    public static readonly PLAYER_HEIGHT = 2.0;

    /**
     * Checks for collision between two players represented by cylindrical bounding boxes.
     * @param pos1 Position of the first player (base of the cylinder)
     * @param pos2 Position of the second player (base of the cylinder)
     * @returns True if the cylinders overlap, false otherwise
     */
    public static checkPlayerCollision(pos1: Vector3, pos2: Vector3): boolean {
        // Check Y axis overlap (height)
        const yOverlap = pos1.y < pos2.y + this.PLAYER_HEIGHT && pos1.y + this.PLAYER_HEIGHT > pos2.y;
        if (!yOverlap) {
            return false;
        }

        // Check XZ plane overlap (radius)
        const dx = pos1.x - pos2.x;
        const dz = pos1.z - pos2.z;
        const distanceSq = dx * dx + dz * dz;
        const minDistanceSq = (this.PLAYER_RADIUS * 2) * (this.PLAYER_RADIUS * 2);

        return distanceSq < minDistanceSq;
    }

    /**
     * Checks if a player cylinder at a target position intersects any scene obstacle.
     * @param pos Candidate base position of the player
     * @param customHeight Height of the player depending on stance
     * @returns True if colliding with any obstacle, false otherwise
     */
    public static checkObstacleCollision(pos: Vector3, customHeight?: number): boolean {
        const height = customHeight ?? this.PLAYER_HEIGHT;
        const pMinX = pos.x - this.PLAYER_RADIUS;
        const pMaxX = pos.x + this.PLAYER_RADIUS;
        const pMinY = pos.y;
        const pMaxY = pos.y + height;
        const pMinZ = pos.z - this.PLAYER_RADIUS;
        const pMaxZ = pos.z + this.PLAYER_RADIUS;

        for (const obs of OBSTACLES) {
            const overlap = (
                pMinX < obs.maxX && pMaxX > obs.minX &&
                pMinY < obs.maxY && pMaxY > obs.minY &&
                pMinZ < obs.maxZ && pMaxZ > obs.minZ
            );
            if (overlap) {
                return true;
            }
        }
        return false;
    }

    /**
     * Checks if a 2D hitscan ray (on the XZ plane) intersects a target's cylindrical bounding box.
     * @param origin Origin of the hitscan ray
     * @param rotY Y-rotation angle in radians (yaw)
     * @param target Base position of the target cylinder
     * @returns True if the ray intersects the target, false otherwise
     */
    public static checkHitscan(origin: Vector3, rotY: number, target: Vector3): boolean {
        // Check Y-axis bounds (hitscan must be within target's height)
        if (origin.y < target.y || origin.y > target.y + this.PLAYER_HEIGHT) {
            return false;
        }

        // Direction vector of the ray on the XZ plane
        const dirX = -Math.sin(rotY);
        const dirZ = -Math.cos(rotY);

        // Vector from origin to target center
        const dx = target.x - origin.x;
        const dz = target.z - origin.z;

        // Check if the target is behind the origin
        const dot = dx * dirX + dz * dirZ;
        if (dot < 0) {
            return false;
        }

        // Calculate perpendicular distance from the target to the ray
        const perpDistance = Math.abs(dx * dirZ - dz * dirX);

        return perpDistance <= this.PLAYER_RADIUS;
    }

    /**
     * Checks if a 2D horizontal ray intersects an obstacle closer than the target.
     * @param origin Starting point of the bullet ray
     * @param rotY Y-rotation (yaw) of the shooter
     * @param targetDist Distance from the shooter to the target player
     * @returns True if blocked by an obstacle, false otherwise
     */
    public static checkBulletObstacleCollision(origin: Vector3, rotY: number, targetDist: number): boolean {
        // Direction vector of the ray on the XZ plane
        const dirX = -Math.sin(rotY);
        const dirZ = -Math.cos(rotY);

        for (const obs of OBSTACLES) {
            // Check Y bounds overlap
            if (origin.y < obs.minY || origin.y > obs.maxY) {
                continue;
            }

            // Ray-Box 2D intersection on XZ plane using slabs method
            let tmin = -Infinity;
            let tmax = Infinity;

            // X-slab
            if (Math.abs(dirX) < 1e-6) {
                if (origin.x < obs.minX || origin.x > obs.maxX) {
                    continue;
                }
            } else {
                const tx1 = (obs.minX - origin.x) / dirX;
                const tx2 = (obs.maxX - origin.x) / dirX;
                tmin = Math.max(tmin, Math.min(tx1, tx2));
                tmax = Math.min(tmax, Math.max(tx1, tx2));
            }

            // Z-slab
            if (Math.abs(dirZ) < 1e-6) {
                if (origin.z < obs.minZ || origin.z > obs.maxZ) {
                    continue;
                }
            } else {
                const tz1 = (obs.minZ - origin.z) / dirZ;
                const tz2 = (obs.maxZ - origin.z) / dirZ;
                tmin = Math.max(tmin, Math.min(tz1, tz2));
                tmax = Math.min(tmax, Math.max(tz1, tz2));
            }

            if (tmax >= tmin && tmax >= 0) {
                const hitDist = tmin < 0 ? 0 : tmin;
                if (hitDist < targetDist) {
                    return true; // Obstacle blocks the bullet path before target is reached
                }
            }
        }

        return false;
    }
}
