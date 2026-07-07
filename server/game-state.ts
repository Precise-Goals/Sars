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
  ammo: number;
  reloadTicks: number;
  difficulty?: "easy" | "veteran" | "hardened" | "realtime";
  shootCooldownTicks: number;
  velocityY: number;
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
  reload?: boolean;
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
  public botDifficultySetting: "random" | "easy" | "veteran" | "hardened" | "realtime" = "random";
  public pendingShots: [number, number, number, number][] = [];

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

  public setBotDifficulty(diff: "random" | "easy" | "veteran" | "hardened" | "realtime"): void {
    this.botDifficultySetting = diff;
    for (const bot of this.players.values()) {
      if (!bot.isBot) continue;
      if (diff === "random") {
        const r = Math.random();
        if (r < 0.40) bot.difficulty = "easy";
        else if (r < 0.70) bot.difficulty = "veteran";
        else if (r < 0.90) bot.difficulty = "hardened";
        else bot.difficulty = "realtime";
      } else {
        bot.difficulty = diff;
      }
    }
  }

  private spawnBot(): void {
    const slot = this.botCount();
    const name = BOT_NAMES[slot % BOT_NAMES.length];
    const id   = `${name}_${Math.random().toString(36).slice(2, 6)}`;
    const bot = this.makePlayer(id, true);
    
    const diff = this.botDifficultySetting;
    if (diff === "random") {
      const r = Math.random();
      if (r < 0.40) bot.difficulty = "easy";
      else if (r < 0.70) bot.difficulty = "veteran";
      else if (r < 0.90) bot.difficulty = "hardened";
      else bot.difficulty = "realtime";
    } else {
      bot.difficulty = diff;
    }
    
    this.players.set(id, bot);
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
      ammo: 30,
      reloadTicks: 0,
      shootCooldownTicks: 0,
      velocityY: 0,
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

  public tickReloads(): void {
    for (const player of this.players.values()) {
      if (player.reloadTicks > 0) {
        player.reloadTicks -= 1;
        if (player.reloadTicks === 0) {
          player.ammo = 30;
        }
      }
      if (player.shootCooldownTicks > 0) {
        player.shootCooldownTicks -= 1;
      }
    }
  }

  public tickPhysics(): void {
    for (const player of this.players.values()) {
      if (player.velocityY !== 0 || player.position.y > 0) {
        player.position.y += player.velocityY;
        player.velocityY -= 0.018; // Gravity
        if (player.position.y <= 0) {
          player.position.y = 0;
          player.velocityY = 0;
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
    // Determine difficulty-based variables
    let speed = BOT_BASE_SPEED;
    let shootChance = BOT_SHOOT_CHANCE;
    
    if (bot.difficulty === "easy") {
      speed = BOT_BASE_SPEED * 0.75;
      shootChance = 0.015;
    } else if (bot.difficulty === "veteran") {
      speed = BOT_BASE_SPEED * 1.0;
      shootChance = 0.035;
    } else if (bot.difficulty === "hardened") {
      speed = BOT_BASE_SPEED * 1.35;
      shootChance = 0.055;
    } else if (bot.difficulty === "realtime") {
      speed = BOT_BASE_SPEED * 1.6;
      shootChance = 0.08;
    }

    // Initialize custom ticking properties for bots
    if ((bot as any).slideTicks === undefined) (bot as any).slideTicks = 0;
    if ((bot as any).crouchTicks === undefined) (bot as any).crouchTicks = 0;

    // Hardened and Realtime bots slide and crouch dynamically during chase/patrol
    if (bot.difficulty === "hardened" || bot.difficulty === "realtime") {
      if (!bot.isSliding && !bot.isCrouching && Math.random() < 0.04) {
        if (Math.random() < 0.5) {
          bot.isSliding = true;
          (bot as any).slideTicks = 15; // 15 server ticks slide duration
          bot.isCrouching = false;
        } else {
          bot.isCrouching = true;
          (bot as any).crouchTicks = 20 + Math.floor(Math.random() * 20);
          bot.isSliding = false;
        }
      }
    } else if (bot.difficulty === "veteran" && Math.random() < 0.02) {
      if (!bot.isCrouching) {
        bot.isCrouching = true;
        (bot as any).crouchTicks = 25;
      }
    }

    // Tick slide/crouch states
    if (bot.isSliding) {
      if ((bot as any).slideTicks > 0) {
        (bot as any).slideTicks--;
        speed *= 1.35; // speed boost while sliding
      } else {
        bot.isSliding = false;
      }
    }
    if (bot.isCrouching) {
      if ((bot as any).crouchTicks > 0) {
        (bot as any).crouchTicks--;
        speed *= 0.5; // slow down while crouching
      } else {
        bot.isCrouching = false;
      }
    }

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
      bot.rotY      = lerpAngle(bot.rotY, Math.atan2(-dx, -dz), 0.08);
    } else {
      bot.rotY += (Math.random() - 0.5) * 0.12;
    }

    // Walk toward target unless already very close
    if (!target || nearestDist > 4) {
      const cand: Vector3 = {
        // Move in forward direction (-sin, -cos)
        x: bot.position.x - Math.sin(bot.rotY) * speed,
        y: bot.position.y,
        z: bot.position.z - Math.cos(bot.rotY) * speed,
      };
      // simple arena clamp so bots don't leave bounds
      cand.x = Math.max(-29, Math.min(29, cand.x));
      cand.z = Math.max(-29, Math.min(29, cand.z));

      const botHeight = (bot.isCrouching || bot.isSliding) ? 1.3 : 2.0;
      const blocked = [...this.players.values()].some(
        p => p.id !== bot.id && SarsPhysicsEngine.checkPlayerCollision(cand, p.position)
      ) || SarsPhysicsEngine.checkObstacleCollision(cand, botHeight);
      if (!blocked) { bot.position.x = cand.x; bot.position.z = cand.z; }
    }

    // Shoot
    if (target && Math.random() < shootChance) {
      if (bot.reloadTicks === 0) {
        if (bot.ammo > 0) {
          bot.ammo -= 1;
          
          // Apply spread/accuracy differences based on difficulty
          let shootRot = bot.rotY;
          if (bot.difficulty === "hardened") {
            shootRot += (Math.random() - 0.5) * 0.15;
          } else if (bot.difficulty === "veteran") {
            shootRot += (Math.random() - 0.5) * 0.25;
          } else if (bot.difficulty === "easy") {
            shootRot += (Math.random() - 0.5) * 0.35;
          }

          if (this.onShot) {
            const dirX = -Math.sin(shootRot);
            const dirZ = -Math.cos(shootRot);
            this.onShot(bot.position.x, bot.position.z, dirX, dirZ);
          }
          this.applyHitscan(bot, target, shootRot);
          if (bot.ammo === 0) {
            bot.reloadTicks = 45; // Auto-reload bot
          }
        } else {
          bot.reloadTicks = 45; // Auto-reload bot
        }
      }
    }
  }

  // ── Human input processing ────────────────────────────────────────────────

  public processInput(playerId: string, input: InputData): void {
    const player = this.players.get(playerId);
    if (!player || player.isBot) return;

    // NaN protection & Input Sanitization
    if (typeof input.rotY !== "number" || Number.isNaN(input.rotY) || !Number.isFinite(input.rotY)) {
      player.rotY = 0;
    } else {
      player.rotY = input.rotY;
    }

    player.isSprinting = input.sprint && !input.crouch && !input.slide;
    player.isCrouching = input.crouch && !input.slide;
    player.isSliding   = input.slide;

    // Speed selection
    let speed = NORMAL_SPEED;
    if (player.isSprinting) speed = SPRINT_SPEED;
    if (player.isCrouching) speed = CROUCH_SPEED;
    if (player.isSliding)   speed = SPRINT_SPEED * 1.35; // slide burst

    // Jump input trigger
    if (input.jump && player.position.y <= 0 && player.velocityY === 0) {
      player.velocityY = 0.22;
    }

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

    // Speedhack prevention (server safety validation)
    const maxAllowedSpeed = SPRINT_SPEED * 1.4;
    const actualLen = Math.hypot(dx, dz);
    if (actualLen > maxAllowedSpeed) {
      dx = (dx / actualLen) * maxAllowedSpeed;
      dz = (dz / actualLen) * maxAllowedSpeed;
    }

    const cand: Vector3 = {
      x: Math.max(-29, Math.min(29, player.position.x + dx)),
      y: player.position.y,
      z: Math.max(-29, Math.min(29, player.position.z + dz)),
    };

    // NaN check on final positions
    if (Number.isNaN(cand.x) || !Number.isFinite(cand.x)) cand.x = player.position.x;
    if (Number.isNaN(cand.z) || !Number.isFinite(cand.z)) cand.z = player.position.z;

    const playerHeight = (player.isCrouching || player.isSliding) ? 1.3 : 2.0;
    const blocked = [...this.players.entries()].some(
      ([id, p]) => id !== playerId && SarsPhysicsEngine.checkPlayerCollision(cand, p.position)
    ) || SarsPhysicsEngine.checkObstacleCollision(cand, playerHeight);
    if (!blocked) { player.position.x = cand.x; player.position.z = cand.z; }

    // Reload input check
    if (input.reload && player.reloadTicks === 0 && player.ammo < 30) {
      player.reloadTicks = 45;
    }

    // Shoot — once per click (server prevents auto-fire spam by checking shoot boolean)
    if (input.shoot) {
      if (player.reloadTicks === 0 && player.shootCooldownTicks === 0) {
        if (player.ammo > 0) {
          player.ammo -= 1;
          
          // Set dynamic cooldown ticks based on movement stance
          // Crouching: 4 ticks (133ms), Standing: 5 ticks (166ms), Sliding: 7 ticks (233ms), Sprinting: 10 ticks (333ms)
          if (player.isCrouching) {
            player.shootCooldownTicks = 4;
          } else if (player.isSliding) {
            player.shootCooldownTicks = 7;
          } else if (player.isSprinting) {
            player.shootCooldownTicks = 10;
          } else {
            player.shootCooldownTicks = 5;
          }

          for (const [id, target] of this.players) {
            if (id === playerId) continue;
            this.applyHitscan(player, target);
          }
          if (player.ammo === 0) {
            player.reloadTicks = 45; // Auto-reload when magazine is empty
          }
        } else {
          player.reloadTicks = 45; // Auto-reload if trying to shoot with empty mag
        }
      }
    }
  }

  // ── Shared hit logic ──────────────────────────────────────────────────────

  private applyHitscan(shooter: Player, target: Player, angleOverride?: number): void {
    if (this.gameMode === "tdm" && shooter.team === target.team) return;

    const rotY = angleOverride !== undefined ? angleOverride : shooter.rotY;

    if (!SarsPhysicsEngine.checkHitscan(shooter.position, rotY, target.position)) return;

    // Check if there is an obstacle blocking the bullet path before it hits the target.
    const targetDist = Math.hypot(target.position.x - shooter.position.x, target.position.z - shooter.position.z);
    const bulletHeight = shooter.position.y + (shooter.isSliding ? 0.45 : shooter.isCrouching ? 0.75 : 1.55);
    const rayOrigin = { x: shooter.position.x, y: bulletHeight, z: shooter.position.z };
    if (SarsPhysicsEngine.checkBulletObstacleCollision(rayOrigin, rotY, targetDist)) {
      return; // Bullet blocked by obstacle!
    }

    // Segment damage: head = 80%, body = 40%, leg = 15%
    // Bullet height depends on shooter stance: Sliding (0.45), Crouching (0.75), Standing (1.55)
    const targetHeight = (target.isCrouching || target.isSliding) ? 1.3 : 2.0;
    const relativeHitY = bulletHeight - target.position.y;

    let damage = 40; // Default bodyshot (40 HP)
    if (relativeHitY < 0.35 * targetHeight) {
      damage = 15; // Legshot (15 HP)
    } else if (relativeHitY > 0.80 * targetHeight) {
      damage = 80; // Headshot (80 HP)
    }

    target.health -= damage;
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
