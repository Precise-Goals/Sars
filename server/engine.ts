import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readFileSync, existsSync } from "fs";

export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

let preloadedVertices: Float32Array = new Float32Array(0);
let preloadedIndices: Uint32Array = new Uint32Array(0);

export let globalWorld: RAPIER.World;
export let mapCollider: RAPIER.Collider;

const colliderRooms = new Map<number, string>(); // Maps a collider handle to a session/room ID

export async function initPhysicsEngine() {
    await RAPIER.init();

    // Extreme Krunker-style gravity (-55 m/s^2) for fast, snappy jumps
    globalWorld = new RAPIER.World({ x: 0, y: -55.0, z: 0 });

    const glbPath = "assets/industry.glb";
    const scale = 8.0;

    if (!existsSync(glbPath)) {
        console.warn(`[SarsPhysicsEngine] GLB file not found at ${glbPath}.`);
        return;
    }

    try {
        const buffer = readFileSync(glbPath);
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const loader = new GLTFLoader();

        const gltf: any = await new Promise((resolve, reject) => {
            loader.parse(arrayBuffer, '', resolve, reject);
        });

        const positions: number[] = [];
        const indices: number[] = [];
        let indexOffset = 0;

        gltf.scene.updateMatrixWorld(true);

        gltf.scene.traverse((node: any) => {
            if (node.isMesh) {
                const mesh = node as THREE.Mesh;
                const geometry = mesh.geometry;
                
                if (!geometry.attributes.position) return;

                const posAttribute = geometry.attributes.position;
                const indexAttribute = geometry.index;

                const localPositions = new Float32Array(posAttribute.array.length);
                for (let i = 0; i < posAttribute.count; i++) {
                    const vec = new THREE.Vector3();
                    vec.fromBufferAttribute(posAttribute, i);
                    vec.applyMatrix4(mesh.matrixWorld);
                    vec.multiplyScalar(scale);
                    
                    localPositions[i * 3] = vec.x;
                    localPositions[i * 3 + 1] = vec.y;
                    localPositions[i * 3 + 2] = vec.z;
                }

                for (let i = 0; i < localPositions.length; i++) positions.push(localPositions[i]);

                if (indexAttribute) {
                    for (let i = 0; i < indexAttribute.count; i++) {
                        indices.push(indexAttribute.getX(i) + indexOffset);
                    }
                } else {
                    for (let i = 0; i < posAttribute.count; i++) indices.push(i + indexOffset);
                }
                indexOffset += posAttribute.count;
            }
        });

        preloadedVertices = new Float32Array(positions);
        preloadedIndices = new Uint32Array(indices);
        
        const colliderDesc = RAPIER.ColliderDesc.trimesh(preloadedVertices, preloadedIndices);
        mapCollider = globalWorld.createCollider(colliderDesc);

        console.log(`[SarsPhysicsEngine] Global map Trimesh generated with ${preloadedVertices.length / 3} vertices.`);
    } catch (err) {
        console.error("[SarsPhysicsEngine] Failed to parse GLB file for physics:", err);
    }
}

export function stepGlobalPhysics() {
    if (globalWorld) globalWorld.step();
}

export class RoomPhysics {
    public roomId: string;
    public characterControllers: Map<string, RAPIER.KinematicCharacterController> = new Map();
    public playerBodies: Map<string, RAPIER.RigidBody> = new Map();
    public playerColliders: Map<string, RAPIER.Collider> = new Map();

    constructor(roomId: string) {
        this.roomId = roomId;
    }

    public addPlayer(id: string, startPos: Vector3): void {
        const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(startPos.x, startPos.y, startPos.z);
        const body = globalWorld.createRigidBody(bodyDesc);

        const colliderDesc = RAPIER.ColliderDesc.capsule(0.6, 0.4); 
        const collider = globalWorld.createCollider(colliderDesc, body);

        colliderRooms.set(collider.handle, this.roomId);

        // Krunker style movement uses slightly more offset to prevent sticking to micro-bumps
        const characterController = globalWorld.createCharacterController(0.1); 
        characterController.enableAutostep(0.5, 0.2, true);
        characterController.enableSnapToGround(0.3);

        this.playerBodies.set(id, body);
        this.playerColliders.set(id, collider);
        this.characterControllers.set(id, characterController);
    }

    public removePlayer(id: string): void {
        const body = this.playerBodies.get(id);
        const collider = this.playerColliders.get(id);
        
        if (collider) colliderRooms.delete(collider.handle);
        if (body) globalWorld.removeRigidBody(body); // Automatically removes the attached collider

        this.playerBodies.delete(id);
        this.playerColliders.delete(id);
        this.characterControllers.delete(id);
    }

    public movePlayer(id: string, desiredMovement: Vector3): { pos: Vector3; grounded: boolean } | null {
        const controller = this.characterControllers.get(id);
        const body = this.playerBodies.get(id);
        const collider = this.playerColliders.get(id);

        if (!controller || !body || !collider) return null;

        controller.computeColliderMovement(
            collider,
            { x: desiredMovement.x, y: desiredMovement.y, z: desiredMovement.z },
            undefined, undefined, undefined, undefined,
            (c: RAPIER.Collider) => {
                // Only collide with the global map OR players in the EXACT SAME room
                return c.handle === mapCollider.handle || colliderRooms.get(c.handle) === this.roomId;
            }
        );

        const movement = controller.computedMovement();
        const pos = body.translation();

        const newPos = { x: pos.x + movement.x, y: pos.y + movement.y, z: pos.z + movement.z };
        body.setNextKinematicTranslation(newPos);

        return { pos: newPos, grounded: controller.computedGrounded() };
    }

    public teleportPlayer(id: string, pos: Vector3): void {
        const body = this.playerBodies.get(id);
        if (body) {
            body.setTranslation(pos, true);
        }
    }

    public checkHitscan(origin: Vector3, dir: Vector3, maxDistance: number): string | null {
        const ray = new RAPIER.Ray(
            { x: origin.x, y: origin.y, z: origin.z },
            { x: dir.x, y: dir.y, z: dir.z }
        );

        let closestHitId: string | null = null;
        let closestDist = maxDistance;

        // Using standard castRay with predicate to only hit map or same-room players
        const hit = globalWorld.castRay(ray, maxDistance, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, undefined, undefined, undefined, (c: RAPIER.Collider) => {
            return c.handle === mapCollider.handle || colliderRooms.get(c.handle) === this.roomId;
        });
        
        if (hit && hit.collider) {
            // Did we hit a player?
            for (const [id, collider] of this.playerColliders.entries()) {
                if (collider.handle === hit.collider.handle) {
                    return id;
                }
            }
        }
        return null;
    }
}
