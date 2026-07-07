export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

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
}
