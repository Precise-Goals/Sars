import { SarsPhysicsEngine } from "./engine";
import type { Vector3 } from "./engine";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  position: Vector3;
  rotY: number;
  health: number;
  score: number;
  isBot: boolean;
  // Movement state flags broadcast to clients
  isSprinting: boolean;
  isCrouching: boolean;
  isSliding: boolean;
  team?: "red" | "blue";
}

export interface InputData {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  rotY: number;
  shoot: boolean;
  sprint: boolean;   // Left Shift
  crouch: boolean;   // C
  slide: boolean;    // X
  jump: boolean;     // Space
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BOT_NAMES = [
  "BOT_Raven", "BOT_Cipher", "BOT_Jinx", "BOT_Specter",
  "BOT_Vex", "BOT_Phantom", "BOT_Nova", "BOT_Wraith",
];

const MAX_LOBBY_SIZE   = 8;
const NORMAL_SPEED     = 0.15;
const SPRINT_SPEED     = 0.28;
const CROUCH_SPEED     = 0.07;
const BOT_BASE_SPEED   = 0.09;
const BOT_SHOOT_CHANCE = 0.03;

// ─── Match Manager ────────────────────────────────────────────────────────────

export class SarsMatchManager {
  public players: Map<string, Player> = new Map();
  public gameMode: "ffa" | "tdm" = "ffa";
  public teamScores = { red: 0, blue: 0 };
  public onShot?: (ox: number, oz: number, dx: number, dz: number) => void;

  // ── Player lifecycle ──────────────────────────────────────────────────────

  public addPlayer(id: string): void {
    this.players.set(id, this.makePlayer(id, false));
    this.rebalanceBots();
    this.balanceTeams();
  }

  public removePlayer(id: string): void {
    this.players.delete(id);
    this.rebalanceBots();
    this.balanceTeams();
  }

  // ── Bot management ────────────────────────────────────────────────────────

  private rebalanceBots(): void {
    const humans = this.humanCount();
    const bots   = this.botCount();
    const target = Math.max(0, MAX_LOBBY_SIZE - humans);

    if (bots < target) {
      for (let i = bots; i < target; i++) this.spawnBot();
    } else if (bots > target) {
      const excess = [...this.players.values()]
        .filter(p => p.isBot)
        .slice(target);
      for (const b of excess) this.players.delete(b.id);
    }
  }

  private spawnBot(): void {
    const slot = this.botCount();
    const name = BOT_NAMES[slot % BOT_NAMES.length];
    const id   = `${name}_${Math.random().toString(36).slice(2, 6)}`;
    this.players.set(id, this.makePlayer(id, true));
  }

  private makePlayer(id: string, isBot: boolean): Player {
    return {
      id,
      position: this.randomSpawn(),
      rotY: Math.random() * Math.PI * 2,
      health: 100,
      score: 0,
      isBot,
      isSprinting: false,
      isCrouching: false,
      isSliding:   false,
    };
  }

  public setGameMode(mode: "ffa" | "tdm"): void {
    if (this.gameMode === mode) return;
    this.gameMode = mode;
    this.teamScores = { red: 0, blue: 0 };
    for (const p of this.players.values()) {
      p.score = 0;
      p.health = 100;
      p.position = this.randomSpawn();
    }
    this.balanceTeams();
  }

  public balanceTeams(): void {
    if (this.gameMode === "ffa") {
      for (const p of this.players.values()) {
        p.team = undefined;
      }
      return;
    }

    // In TDM, split 4 vs 4
    const all = [...this.players.values()].sort((a, b) => {
      // humans first
      if (a.isBot !== b.isBot) return a.isBot ? 1 : -1;
      return a.id.localeCompare(b.id);
    });

    for (let i = 0; i < all.length; i++) {
      all[i].team = (i % 2 === 0) ? "red" : "blue";
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
    // Find nearest enemy
    let nearestDist = Infinity;
    let target: Player | null = null;
    for (const p of all) {
      if (p.id === bot.id) continue;
      if (this.gameMode === "tdm" && p.team === bot.team) continue;
      const dx = p.position.x - bot.position.x;
      const dz = p.position.z - bot.position.z;
      const d  = Math.hypot(dx, dz);
      if (d < nearestDist) { nearestDist = d; target = p; }
    }

    if (target) {
      const dx      = target.position.x - bot.position.x;
      const dz      = target.position.z - bot.position.z;
      // Face target (negative Z is forward, so angle must be Math.atan2(-dx, -dz))
      bot.rotY      = lerpAngle(bot.rotY, Math.atan2(-dx, -dz), 0.06);
    } else {
      bot.rotY += (Math.random() - 0.5) * 0.12;
    }

    // Walk toward target unless already very close
    if (!target || nearestDist > 4) {
      const cand: Vector3 = {
        // Move in forward direction (-sin, -cos)
        x: bot.position.x - Math.sin(bot.rotY) * BOT_BASE_SPEED,
        y: bot.position.y,
        z: bot.position.z - Math.cos(bot.rotY) * BOT_BASE_SPEED,
      };
      // simple arena clamp so bots don't leave bounds
      cand.x = Math.max(-29, Math.min(29, cand.x));
      cand.z = Math.max(-29, Math.min(29, cand.z));

      const blocked = [...this.players.values()].some(
        p => p.id !== bot.id && SarsPhysicsEngine.checkPlayerCollision(cand, p.position)
      );
      if (!blocked) { bot.position.x = cand.x; bot.position.z = cand.z; }
    }

    // Shoot
    if (target && Math.random() < BOT_SHOOT_CHANCE) {
      if (this.onShot) {
        const dirX = -Math.sin(bot.rotY);
        const dirZ = -Math.cos(bot.rotY);
        this.onShot(bot.position.x, bot.position.z, dirX, dirZ);
      }
      this.applyHitscan(bot, target);
    }
  }

  // ── Human input processing ────────────────────────────────────────────────

  public processInput(playerId: string, input: InputData): void {
    const player = this.players.get(playerId);
    if (!player || player.isBot) return;

    player.rotY      = input.rotY;
    player.isSprinting = input.sprint && !input.crouch && !input.slide;
    player.isCrouching = input.crouch && !input.slide;
    player.isSliding   = input.slide;

    // Speed selection
    let speed = NORMAL_SPEED;
    if (player.isSprinting) speed = SPRINT_SPEED;
    if (player.isCrouching) speed = CROUCH_SPEED;
    if (player.isSliding)   speed = SPRINT_SPEED * 1.3; // slide burst

    // Height adjustment for crouching
    const targetY = player.isCrouching || player.isSliding ? 0 : 0;
    player.position.y = targetY; // Y movement reserved for future jump physics

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
    if (len > 0) { dx = (dx / len) * speed; dz = (dz / len) * speed; }

    const cand: Vector3 = {
      x: Math.max(-29, Math.min(29, player.position.x + dx)),
      y: player.position.y,
      z: Math.max(-29, Math.min(29, player.position.z + dz)),
    };

    const blocked = [...this.players.entries()].some(
      ([id, p]) => id !== playerId && SarsPhysicsEngine.checkPlayerCollision(cand, p.position)
    );
    if (!blocked) { player.position.x = cand.x; player.position.z = cand.z; }

    // Shoot — once per click (server prevents auto-fire spam by checking shoot boolean)
    if (input.shoot) {
      for (const [id, target] of this.players) {
        if (id === playerId) continue;
        this.applyHitscan(player, target);
      }
    }
  }

  // ── Shared hit logic ──────────────────────────────────────────────────────

  private applyHitscan(shooter: Player, target: Player): void {
    if (this.gameMode === "tdm" && shooter.team === target.team) return;

    if (!SarsPhysicsEngine.checkHitscan(shooter.position, shooter.rotY, target.position)) return;
    target.health -= 20;
    if (target.health <= 0) {
      target.health   = 100;
      target.position = this.randomSpawn();
      shooter.score  += 1;
      if (this.gameMode === "tdm" && shooter.team) {
        this.teamScores[shooter.team] += 1;
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private randomSpawn(): Vector3 {
    return {
      x: (Math.random() - 0.5) * 50,
      y: 0,
      z: (Math.random() - 0.5) * 50,
    };
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
