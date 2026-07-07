import { RoomPhysics, Vector3 } from "./engine";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  position: Vector3;
  rotY: number;
  health: number;
  score: number;
  isBot: boolean;
  isSprinting: boolean;
  isCrouching: boolean;
  isSliding: boolean;
  team?: "red" | "blue";
  ammo: number;
  reloadTicks: number;
  difficulty?: "easy" | "veteran" | "hardened" | "realtime";
  shootCooldownTicks: number;
  velocityY: number; // For true gravity jumping
}

export interface InputData {
  w: boolean; a: boolean; s: boolean; d: boolean;
  rotY: number; shoot: boolean; sprint: boolean; crouch: boolean; slide: boolean; jump: boolean; reload?: boolean;
}

export type GameMode = "practice" | "explore" | "real";

// ─── Constants (Krunker-Style Fluency) ────────────────────────────────────────

const BOT_NAMES = ["BOT_Raven", "BOT_Cipher", "BOT_Jinx", "BOT_Specter", "BOT_Vex", "BOT_Phantom", "BOT_Nova", "BOT_Wraith"];

const TICK_RATE        = 30;
const DT               = 1.0 / TICK_RATE;

// Speeds are in units per second (much faster and snappier than before)
const NORMAL_SPEED     = 14.0;
const SPRINT_SPEED     = 24.0;
const CROUCH_SPEED     = 7.0;
const SLIDE_SPEED      = 32.0; // High burst speed for sliding
const BOT_BASE_SPEED   = 12.0;
const BOT_SHOOT_CHANCE = 0.05;

const GRAVITY          = -55.0;
const JUMP_VELOCITY    = 20.0;

const MAP_BOUNDS = { minX: -29, maxX: 29, minZ: -29, maxZ: 29 };

// ─── Match Manager ────────────────────────────────────────────────────────────

export class SarsMatchManager {
  public players: Map<string, Player> = new Map();
  public gameMode: GameMode = "real";
  public maxLobbySize = 8;
  
  public teamScores = { red: 0, blue: 0 };
  public pendingShots: [number, number, number, number, number, number][] = [];
  
  public physics: RoomPhysics;

  constructor(roomId: string, mode: GameMode = "real") {
    this.gameMode = mode;
    this.physics = new RoomPhysics(roomId);
  }

  // ── Player lifecycle ──────────────────────────────────────────────────────

  public addPlayer(id: string): void {
    this.players.set(id, this.makePlayer(id, false));
    this.rebalanceBots();
  }

  public removePlayer(id: string): void {
    this.players.delete(id);
    this.physics.removePlayer(id);
    this.rebalanceBots();
  }

  // ── Bot management ────────────────────────────────────────────────────────

  private rebalanceBots(): void {
    const humans = this.humanCount();
    const bots   = this.botCount();
    
    let targetBots = 0;
    if (this.gameMode === "explore") {
      targetBots = 0; // No bots in explore
    } else if (this.gameMode === "practice") {
      targetBots = Math.max(0, this.maxLobbySize - 1); // Fill with bots for 1 human
    } else if (this.gameMode === "real") {
      targetBots = Math.max(0, this.maxLobbySize - humans); // Backfill empty slots
    }

    if (bots < targetBots) {
      for (let i = bots; i < targetBots; i++) this.spawnBot();
    } else if (bots > targetBots) {
      const excess = [...this.players.values()].filter(p => p.isBot).slice(targetBots);
      for (const b of excess) {
        this.players.delete(b.id);
        this.physics.removePlayer(b.id);
      }
    }
  }

  private spawnBot(): void {
    const slot = this.botCount();
    const name = BOT_NAMES[slot % BOT_NAMES.length];
    const id   = `${name}_${Math.random().toString(36).slice(2, 6)}`;
    const bot = this.makePlayer(id, true);
    bot.difficulty = "hardened"; // Default bot difficulty
    this.players.set(id, bot);
  }

  private makePlayer(id: string, isBot: boolean): Player {
    const spawnPos = this.randomSpawn();
    this.physics.addPlayer(id, spawnPos);
    
    return {
      id,
      position: spawnPos,
      rotY: Math.random() * Math.PI * 2,
      health: 100,
      score: 0,
      isBot,
      isSprinting: false,
      isCrouching: false,
      isSliding:   false,
      ammo: 30,
      reloadTicks: 0,
      shootCooldownTicks: 0,
      velocityY: 0,
    };
  }

  public tickReloads(): void {
    for (const player of this.players.values()) {
      if (player.reloadTicks > 0) {
        player.reloadTicks -= 1;
        if (player.reloadTicks === 0) player.ammo = 30;
      }
      if (player.shootCooldownTicks > 0) player.shootCooldownTicks -= 1;
    }
  }

  public tickPhysics(): void {
    for (const [id, player] of this.players.entries()) {
      const body = this.physics.playerBodies.get(id);
      if (body) {
        const p = body.translation();
        player.position.x = p.x;
        player.position.y = p.y;
        player.position.z = p.z;
        
        if (p.y < -25) { // Fallen out of world
          this.physics.teleportPlayer(id, this.randomSpawn());
        }
      }
    }
  }

  private humanCount() { return [...this.players.values()].filter(p => !p.isBot).length; }
  private botCount()   { return [...this.players.values()].filter(p =>  p.isBot).length; }

  // ── Bot AI tick ───────────────────────────────────────────────────────────

  public tickBots(): void {
    const all = [...this.players.values()];
    for (const bot of all.filter(p => p.isBot)) {
      this.tickBot(bot, all);
    }
  }

  private tickBot(bot: Player, all: Player[]): void {
    let speed = BOT_BASE_SPEED;

    let nearestDist = Infinity;
    let target: Player | null = null;
    for (const p of all) {
      if (p.id === bot.id) continue;
      
      const dx = p.position.x - bot.position.x;
      const dz = p.position.z - bot.position.z;
      const d  = Math.hypot(dx, dz);
      
      if (d < nearestDist) { 
        // Only target if there is a clear line of sight
        const headHeight = bot.position.y + 1.55;
        const targetHeight = p.position.y + 1.55;
        const hasLoS = this.physics.checkLineOfSight(
            { x: bot.position.x, y: headHeight, z: bot.position.z },
            { x: p.position.x, y: targetHeight, z: p.position.z }
        );

        if (hasLoS) {
          nearestDist = d; 
          target = p; 
        }
      }
    }

    if (target) {
      const dx = target.position.x - bot.position.x;
      const dz = target.position.z - bot.position.z;
      bot.rotY = lerpAngle(bot.rotY, Math.atan2(-dx, -dz), 0.15); // Snappier aiming
    } else {
      bot.rotY += (Math.random() - 0.5) * 0.15;
    }

    let dx = 0, dz = 0;
    if (!target || nearestDist > 5) {
      dx = -Math.sin(bot.rotY) * speed * DT;
      dz = -Math.cos(bot.rotY) * speed * DT;
      bot.isSprinting = true;
    } else {
      bot.isSprinting = false;
    }

    // Bot Gravity & Jump
    bot.velocityY += GRAVITY * DT;
    let dy = bot.velocityY * DT;

    const res = this.physics.movePlayer(bot.id, { x: dx, y: dy, z: dz }, false);
    if (res && res.grounded) {
      bot.velocityY = -2.0;
      // Randomly jump during combat if close
      if (target && nearestDist < 12 && Math.random() < 0.02) {
        bot.velocityY = JUMP_VELOCITY;
      }
    }

    if (target && Math.random() < BOT_SHOOT_CHANCE) {
      if (bot.reloadTicks === 0) {
        if (bot.ammo > 0) {
          bot.ammo -= 1;
          let shootRot = bot.rotY + (Math.random() - 0.5) * 0.15; // Tightened bot accuracy
          this.applyHitscan(bot, shootRot);
          if (bot.ammo === 0) bot.reloadTicks = 45;
        } else {
          bot.reloadTicks = 45;
        }
      }
    }
  }

  // ── Human input processing ────────────────────────────────────────────────

  public processInput(playerId: string, input: InputData): void {
    const player = this.players.get(playerId);
    if (!player || player.isBot) return;

    if (typeof input.rotY !== "number" || Number.isNaN(input.rotY) || !Number.isFinite(input.rotY)) {
      player.rotY = 0;
    } else {
      player.rotY = input.rotY;
    }

    player.isSprinting = input.sprint && !input.crouch && !input.slide;
    player.isCrouching = input.crouch && !input.slide;
    player.isSliding   = input.slide;

    let speed = NORMAL_SPEED;
    if (player.isSprinting) speed = SPRINT_SPEED;
    if (player.isCrouching) speed = CROUCH_SPEED;
    if (player.isSliding)   speed = SLIDE_SPEED; // Massive burst for krunker sliding

    const fwdX = -Math.sin(player.rotY);
    const fwdZ = -Math.cos(player.rotY);
    const rgtX = Math.cos(player.rotY);
    const rgtZ = -Math.sin(player.rotY);

    let dx = 0, dz = 0;
    if (input.w) { dx += fwdX; dz += fwdZ; }
    if (input.s) { dx -= fwdX; dz -= fwdZ; }
    if (input.a) { dx -= rgtX; dz -= rgtZ; }
    if (input.d) { dx += rgtX; dz += rgtZ; }

    const len = Math.hypot(dx, dz);
    if (len > 0) { 
      dx = (dx / len) * speed * DT; 
      dz = (dz / len) * speed * DT; 
    }

    // Apply true gravity
    player.velocityY += GRAVITY * DT;
    let dy = player.velocityY * DT;

    // Apply exact collision resolving using Rapier Character Controller
    const res = this.physics.movePlayer(playerId, { x: dx, y: dy, z: dz }, input.jump);

    if (res && res.grounded) {
      player.velocityY = -2.0; // Stick slightly to slopes
      if (input.jump) {
        player.velocityY = JUMP_VELOCITY; // Snappy high jump
      }
    }

    if (input.reload && player.reloadTicks === 0 && player.ammo < 30) player.reloadTicks = 45;

    if (input.shoot) {
      if (player.reloadTicks === 0 && player.shootCooldownTicks === 0) {
        if (player.ammo > 0) {
          player.ammo -= 1;
          player.shootCooldownTicks = 10; // Tactical fire rate
          this.applyHitscan(player, player.rotY);
          if (player.ammo === 0) player.reloadTicks = 45;
        } else {
          player.reloadTicks = 45;
        }
      }
    }
  }

  // ── Shared hit logic ──────────────────────────────────────────────────────

  private applyHitscan(shooter: Player, rotY: number): void {
    const dirX = -Math.sin(rotY);
    const dirZ = -Math.cos(rotY);

    // Precise weapon barrel offset (0.35 right, 0.3 forward)
    const offsetX = 0.35;
    const offsetZ = -0.3;
    const rightX = Math.cos(rotY);
    const rightZ = -Math.sin(rotY);

    const gunX = shooter.position.x + (rightX * offsetX) + (dirX * Math.abs(offsetZ));
    const gunZ = shooter.position.z + (rightZ * offsetX) + (dirZ * Math.abs(offsetZ));
    const bulletHeight = shooter.position.y + (shooter.isSliding ? 0.45 : shooter.isCrouching ? 0.75 : 1.55);

    const origin = { x: gunX, y: bulletHeight, z: gunZ };
    const direction = { x: dirX, y: 0, z: dirZ }; // Horizontal shooting

    const { hitId, distance } = this.physics.checkHitscan(origin, direction, 100.0);
    
    // Add visual tracer starting EXACTLY at the gun barrel, bounded by the hit distance
    this.pendingShots.push([gunX, bulletHeight, gunZ, dirX, dirZ, distance]);

    if (hitId && hitId !== shooter.id) {
      const target = this.players.get(hitId);
      if (target) {
        target.health -= 40;
        if (target.health <= 0) {
          target.health   = 100;
          this.physics.teleportPlayer(target.id, this.randomSpawn());
          shooter.score  += 1;
        }
      }
    }
  }

  private randomSpawn(): Vector3 {
    const width = MAP_BOUNDS.maxX - MAP_BOUNDS.minX;
    const depth = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
    const rx = MAP_BOUNDS.minX + Math.random() * width;
    const rz = MAP_BOUNDS.minZ + Math.random() * depth;
    return { x: rx, y: 5.0, z: rz };
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
