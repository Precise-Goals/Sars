"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky, PointerLockControls, Text, Billboard } from "@react-three/drei";
import { pack, unpack } from "msgpackr";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayerState {
  id: string;
  position: { x: number; y: number; z: number };
  rotY: number;
  health: number;
  score: number;
  isBot: boolean;
  isSprinting: boolean;
  isCrouching: boolean;
  isSliding: boolean;
  team?: "red" | "blue";
}

type ShotTrace = [number, number, number, number]; // [ox, oz, dx, dz]

interface ServerFrame {
  players: PlayerState[];
  shots: ShotTrace[];
  gameMode?: "ffa" | "tdm";
  teamScores?: { red: number; blue: number };
}

interface InputState {
  w: boolean; a: boolean; s: boolean; d: boolean;
  rotY: number;
  shoot: boolean;
  sprint: boolean;
  crouch: boolean;
  slide: boolean;
  jump: boolean;
}

// ─── Bullet muzzle flash + trace ─────────────────────────────────────────────

let traceId = 0;
interface Trace { id: number; ox: number; oz: number; dx: number; dz: number; born: number; }
const TRACE_LEN  = 40;
const TRACE_LIFE = 280;

const BulletTrace = ({ t }: { t: Trace }) => {
  const mat = useRef<THREE.MeshBasicMaterial>(null!);
  useFrame(() => {
    const alpha = Math.max(0, 1 - (Date.now() - t.born) / TRACE_LIFE);
    if (mat.current) mat.current.opacity = alpha;
  });
  const mx = t.ox + t.dx * TRACE_LEN / 2;
  const mz = t.oz + t.dz * TRACE_LEN / 2;
  return (
    <mesh position={[mx, 1.55, mz]} rotation={[0, Math.atan2(t.dx, t.dz), 0]}>
      <boxGeometry args={[0.025, 0.025, TRACE_LEN]} />
      <meshBasicMaterial ref={mat} color="#ffe66d" transparent opacity={1} depthWrite={false} />
    </mesh>
  );
};

const TracesLayer = ({ shots }: { shots: ShotTrace[] }) => {
  const [traces, setTraces] = useState<Trace[]>([]);
  const prevLen = useRef(0);

  useEffect(() => {
    if (shots.length === 0 && prevLen.current === 0) return;
    prevLen.current = shots.length;
    if (shots.length === 0) return;
    const now = Date.now();
    setTraces(prev => {
      const alive = prev.filter(t => Date.now() - t.born < TRACE_LIFE);
      const fresh = shots.map(s => ({ id: traceId++, ox: s[0], oz: s[1], dx: s[2], dz: s[3], born: now }));
      return [...alive, ...fresh];
    });
  }, [shots]);

  useFrame(() => {
    setTraces(prev => {
      const alive = prev.filter(t => Date.now() - t.born < TRACE_LIFE);
      return alive.length === prev.length ? prev : alive;
    });
  });

  return <>{traces.map(t => <BulletTrace key={t.id} t={t} />)}</>;
};

// ─── First-person Gun (L-shape, attached to camera) ──────────────────────────
// Uses camera.add() so it stays glued to the view regardless of camera movement.

const FirstPersonGun = ({ isSprinting, isCrouching, isShooting }: {
  isSprinting: boolean;
  isCrouching: boolean;
  isShooting: boolean;
}) => {
  const groupRef   = useRef<THREE.Group>(null!);
  const time       = useRef(0);
  const flash      = useRef(0);
  const [showFlash, setShowFlash] = useState(false);

  const localPos = useRef(new THREE.Vector3(0.27, -0.30, -0.48));
  const localRotX = useRef(0);

  useFrame((state, delta) => {
    time.current += delta;
    if (isShooting && flash.current <= 0) {
      flash.current = 0.1;
      setShowFlash(true);
    }
    if (flash.current > 0) {
      flash.current -= delta;
      if (flash.current <= 0) setShowFlash(false);
    }

    const g = groupRef.current;
    if (!g) return;

    const bobSpeed  = isSprinting ? 9 : 4;
    const bobAmount = isSprinting ? 0.045 : isCrouching ? 0.005 : 0.015;
    const bobY = Math.sin(time.current * bobSpeed) * bobAmount;
    const bobX = Math.sin(time.current * bobSpeed * 0.5) * bobAmount * 0.5;

    const tgtY = isCrouching ? -0.38 : isSprinting ? -0.25 : -0.30;
    const tgtX = isSprinting ? 0.20 : 0.27;
    const recoilZ = flash.current > 0 ? 0.04 : 0;

    localPos.current.x = THREE.MathUtils.lerp(localPos.current.x, tgtX + bobX, 0.18);
    localPos.current.y = THREE.MathUtils.lerp(localPos.current.y, tgtY + bobY, 0.18);
    localPos.current.z = THREE.MathUtils.lerp(localPos.current.z, -0.48 + recoilZ, 0.22);
    localRotX.current = THREE.MathUtils.lerp(localRotX.current, flash.current > 0 ? -0.07 : 0, 0.22);

    const offset = localPos.current.clone();
    offset.applyQuaternion(state.camera.quaternion);

    g.position.copy(state.camera.position).add(offset);
    g.rotation.copy(state.camera.rotation);
    g.rotateX(localRotX.current);
  });

  return (
    <group ref={groupRef}>
      {/* Barrel */}
      <mesh position={[0, 0.024, -0.17]}>
        <boxGeometry args={[0.054, 0.054, 0.36]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.9} roughness={0.2} />
      </mesh>
      {/* Slide */}
      <mesh position={[0, 0.063, -0.13]}>
        <boxGeometry args={[0.044, 0.028, 0.26]} />
        <meshStandardMaterial color="#0d0d0d" metalness={1} roughness={0.08} />
      </mesh>
      {/* Grip — the L drop */}
      <mesh position={[0, -0.082, 0.038]}>
        <boxGeometry args={[0.054, 0.165, 0.068]} />
        <meshStandardMaterial color="#261a14" metalness={0.15} roughness={0.82} />
      </mesh>
      {/* Trigger guard */}
      <mesh position={[0, -0.033, -0.008]}>
        <boxGeometry args={[0.028, 0.018, 0.076]} />
        <meshStandardMaterial color="#111" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* Muzzle flash */}
      {showFlash && (
        <mesh position={[0, 0.024, -0.37]}>
          <sphereGeometry args={[0.058, 6, 6]} />
          <meshBasicMaterial color="#fff5a0" />
        </mesh>
      )}
    </group>
  );
};

// ─── Enemy player model ───────────────────────────────────────────────────────

const EnemyPlayer = ({ player, gameMode }: { player: PlayerState; gameMode: "ffa" | "tdm" }) => {
  const groupRef = useRef<THREE.Group>(null!);
  const targetPos = useRef(new THREE.Vector3(player.position.x, player.position.y, player.position.z));
  const targetRotY = useRef(player.rotY);

  useFrame(() => {
    targetPos.current.set(player.position.x, player.position.y, player.position.z);
    groupRef.current.position.lerp(targetPos.current, 0.25);
    targetRotY.current = player.rotY;
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y, targetRotY.current, 0.25
    );
  });

  const crouchScale = player.isCrouching || player.isSliding ? 0.65 : 1;
  
  let bodyColor = player.isBot
    ? (player.health <= 40 ? "#f97316" : "#818cf8")
    : (player.health <= 40 ? "#ef4444" : "#3b82f6");

  if (gameMode === "tdm") {
    if (player.team === "red") {
      bodyColor = player.health <= 40 ? "#f97316" : "#ef4444";
    } else if (player.team === "blue") {
      bodyColor = player.health <= 40 ? "#60a5fa" : "#3b82f6";
    }
  }

  const shortLabel = player.id.slice(0, 11);

  return (
    <group ref={groupRef} position={[player.position.x, player.position.y, player.position.z]}>
      {/* ── Body cylinder */}
      <mesh position={[0, crouchScale, 0]} scale={[1, crouchScale, 1]} castShadow>
        <cylinderGeometry args={[0.5, 0.5, 2, 16]} />
        <meshStandardMaterial color={bodyColor} roughness={0.45} metalness={0.25} />
      </mesh>

      {/* ── Head sphere */}
      <mesh position={[0, crouchScale * 2 + 0.45, 0]} castShadow>
        <sphereGeometry args={[0.35, 14, 14]} />
        <meshStandardMaterial color={bodyColor} roughness={0.3} />
      </mesh>

      {/* ── L-shape gun in right hand */}
      <group position={[0.55, crouchScale * 1.1, -0.15]}>
        {/* Barrel */}
        <mesh position={[0, 0.02, -0.13]}>
          <boxGeometry args={[0.05, 0.05, 0.3]} />
          <meshStandardMaterial color="#1a1a1a" metalness={0.9} roughness={0.2} />
        </mesh>
        {/* Grip */}
        <mesh position={[0, -0.07, 0.03]}>
          <boxGeometry args={[0.05, 0.14, 0.06]} />
          <meshStandardMaterial color="#2a1f1a" roughness={0.8} />
        </mesh>
      </group>

      {/* ── Health bar + name */}
      <Billboard position={[0, crouchScale * 2 + 1.0, 0]}>
        {/* Background bar */}
        <mesh position={[0, 0.16, 0]}>
          <planeGeometry args={[1.2, 0.12]} />
          <meshBasicMaterial color="#111" transparent opacity={0.7} />
        </mesh>
        {/* Health fill */}
        <mesh position={[-(1.2 - (1.2 * player.health) / 100) / 2, 0.16, 0.001]}
              scale={[(player.health / 100), 1, 1]}>
          <planeGeometry args={[1.2, 0.12]} />
          <meshBasicMaterial
            color={player.health > 60 ? "#22c55e" : player.health > 30 ? "#f59e0b" : "#ef4444"}
          />
        </mesh>
        {/* Label */}
        <Text fontSize={0.22} color="white" anchorX="center" anchorY="middle"
              outlineWidth={0.04} outlineColor="#000" position={[0, 0, 0.002]}>
          {`${player.isBot ? "🤖" : "🎮"} ${gameMode === "tdm" ? (player.team === "red" ? "[RED] " : "[BLUE] ") : ""}${shortLabel}  ♥${player.health}`}
        </Text>
      </Billboard>
    </group>
  );
};

// ─── CameraRig ────────────────────────────────────────────────────────────────

const CameraRig = ({ myPlayer, locked }: {
  myPlayer: PlayerState | undefined;
  locked: boolean;
}) => {
  const { camera } = useThree();
  const targetPos  = useRef(new THREE.Vector3(0, 1.8, 0));
  const [isShooting, setIsShooting] = useState(false);

  useEffect(() => {
    const md = () => setIsShooting(true);
    const mu = () => setIsShooting(false);
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup",   mu);
    return () => {
      window.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup",   mu);
    };
  }, []);

  useFrame(() => {
    if (!myPlayer) return;
    const eyeH = myPlayer.isCrouching ? 1.0 : myPlayer.isSliding ? 0.7 : 1.8;
    targetPos.current.set(myPlayer.position.x, myPlayer.position.y + eyeH, myPlayer.position.z);
    camera.position.lerp(targetPos.current, 0.3);
  });

  // Gun is always mounted (camera.add keeps it hidden when not locked naturally
  // via pointer lock — but we conditionally render for cleanliness)
  return locked ? (
    <FirstPersonGun
      isSprinting={myPlayer?.isSprinting ?? false}
      isCrouching={myPlayer?.isCrouching ?? false}
      isShooting={isShooting}
    />
  ) : null;
};

// ─── Network controller ───────────────────────────────────────────────────────

export type WsStatus = "connecting" | "connected" | "error" | "reconnecting";

const NetworkController = ({
  setFrame, setLocalId, setLocked, setWsStatus, setWs,
}: {
  setFrame: React.Dispatch<React.SetStateAction<ServerFrame>>;
  setLocalId: React.Dispatch<React.SetStateAction<string | null>>;
  setLocked: React.Dispatch<React.SetStateAction<boolean>>;
  setWsStatus: React.Dispatch<React.SetStateAction<WsStatus>>;
  setWs: React.Dispatch<React.SetStateAction<WebSocket | null>>;
}) => {
  const wsRef      = useRef<WebSocket | null>(null);
  const localIdRef = useRef<string | null>(null);
  const frameRef   = useRef<ServerFrame>({ players: [], shots: [] });
  const inputRef   = useRef<InputState>({
    w: false, a: false, s: false, d: false,
    rotY: 0, shoot: false,
    sprint: false, crouch: false, slide: false, jump: false,
  });
  const retryCount  = useRef(0);
  const retryTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyed   = useRef(false);
  const { camera }  = useThree();

  const connect = useRef<() => void>(() => {});

  useEffect(() => {
    destroyed.current = false;

    connect.current = () => {
      if (destroyed.current) return;
      setWsStatus("connecting");

      const ws = new WebSocket("ws://localhost:8080");
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      setWs(ws);

      ws.onopen = () => {
        if (destroyed.current) { ws.close(); return; }
        retryCount.current = 0;
        setWsStatus("connected");
        console.log("[Sars] Connected to game server");
      };

      ws.onerror = () => {
        setWsStatus("error");
        console.warn("[Sars] WebSocket connection failed. Is the server running? (npm run dev:server)");
      };

      ws.onclose = (ev) => {
        if (destroyed.current) return;
        console.log(`[Sars] WS closed (code=${ev.code})`);
        const delay = Math.min(500 * Math.pow(2, retryCount.current), 5000);
        retryCount.current += 1;
        setWsStatus("reconnecting");
        retryTimer.current = setTimeout(connect.current, delay);
      };

      ws.onmessage = event => {
        if (!(event.data instanceof ArrayBuffer)) return;
        try {
          const p = unpack(new Uint8Array(event.data));
          if (p?.type === "INIT") {
            localIdRef.current = p.id as string;
            setLocalId(p.id as string);
          } else if (p?.players) {
            frameRef.current = p as ServerFrame;
            setFrame(p as ServerFrame);
          }
        } catch (e) { console.error("[Sars] Decode err:", e); }
      };
    };

    connect.current();

    return () => {
      destroyed.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      wsRef.current?.close();
      setWs(null);
    };
  }, [setFrame, setLocalId, setWsStatus, setWs]);

  // Keys
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      const i = inputRef.current;
      if (e.code === "KeyW")      i.w = true;
      if (e.code === "KeyA")      i.a = true;
      if (e.code === "KeyS")      i.s = true;
      if (e.code === "KeyD")      i.d = true;
      if (e.code === "Space")     { i.jump = true; e.preventDefault(); }
      if (e.code === "ShiftLeft") i.sprint = true;
      if (e.code === "KeyC")      i.crouch = true;
      if (e.code === "KeyX")      i.slide = true;
    };
    const up = (e: KeyboardEvent) => {
      const i = inputRef.current;
      if (e.code === "KeyW")      i.w = false;
      if (e.code === "KeyA")      i.a = false;
      if (e.code === "KeyS")      i.s = false;
      if (e.code === "KeyD")      i.d = false;
      if (e.code === "Space")     i.jump = false;
      if (e.code === "ShiftLeft") i.sprint = false;
      if (e.code === "KeyC")      i.crouch = false;
      if (e.code === "KeyX")      i.slide = false;
    };
    const md = () => { inputRef.current.shoot = true; };
    const mu = () => { inputRef.current.shoot = false; };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup",   up);
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup",   mu);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup",   up);
      window.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup",   mu);
    };
  }, []);

  useFrame(() => {
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
    inputRef.current.rotY = euler.y;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(pack(inputRef.current));
    }
  });

  return (
    <PointerLockControls
      onLock={() => setLocked(true)}
      onUnlock={() => setLocked(false)}
    />
  );
};

// ─── Arena static geometry ────────────────────────────────────────────────────

const ArenaGeometry = () => (
  <>
    {/* Ground */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[300, 300]} />
      <meshStandardMaterial color="#0b1120" roughness={0.95} />
    </mesh>
    {/* Grid */}
    <gridHelper args={[120, 60, "#1e3a5f", "#0c1a2e"]} position={[0, 0.015, 0]} />

    {/* Perimeter walls */}
    {([
      { p: [0, 2, 30]  as [number,number,number], r: [0,0,0]          as [number,number,number], w: 60, h: 4 },
      { p: [0, 2, -30] as [number,number,number], r: [0,0,0]          as [number,number,number], w: 60, h: 4 },
      { p: [30,2,  0]  as [number,number,number], r: [0,Math.PI/2, 0] as [number,number,number], w: 60, h: 4 },
      { p: [-30,2, 0]  as [number,number,number], r: [0,Math.PI/2, 0] as [number,number,number], w: 60, h: 4 },
    ]).map((w, i) => (
      <mesh key={i} position={w.p} rotation={w.r} receiveShadow castShadow>
        <boxGeometry args={[w.w, w.h, 0.5]} />
        <meshStandardMaterial color="#1e293b" roughness={0.8} />
      </mesh>
    ))}

    {/* Cover crates */}
    {([
      [-9, -9], [9, 9], [0, 16], [-16, 0], [16, -6],
      [6, -19], [-11, 13], [13, -16], [-20, 20], [20, -20],
    ] as [number,number][]).map(([x, z], i) => (
      <mesh key={i} position={[x, 1, z]} castShadow receiveShadow>
        <boxGeometry args={[2.5, 2, 2.5]} />
        <meshStandardMaterial color="#1e3a5f" roughness={0.7} metalness={0.2} />
      </mesh>
    ))}

    {/* Taller cover pillars */}
    {([ [0, 8], [-8, 0], [8, 0] ] as [number,number][]).map(([x, z], i) => (
      <mesh key={`pillar-${i}`} position={[x, 2, z]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 4, 1.2]} />
        <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.3} />
      </mesh>
    ))}
  </>
);

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function GameCanvas() {
  const [frame,     setFrame]     = useState<ServerFrame>({ players: [], shots: [] });
  const [localId,   setLocalId]   = useState<string | null>(null);
  const [locked,    setLocked]    = useState(false);
  const [wsStatus,  setWsStatus]  = useState<WsStatus>("connecting");
  const [ws,        setWs]        = useState<WebSocket | null>(null);

  const myPlayer   = frame.players.find(p => p.id === localId);
  const botCount   = frame.players.filter(p => p.isBot).length;
  const humanCount = frame.players.filter(p => !p.isBot).length;

  const gameMode = frame.gameMode ?? "ffa";
  const teamScores = frame.teamScores ?? { red: 0, blue: 0 };

  const changeMode = (mode: "ffa" | "tdm") => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(pack({ type: "CHANGE_MODE", mode }));
    }
  };

  // Stance label
  const stance = myPlayer?.isSliding ? "SLIDE" : myPlayer?.isCrouching ? "CROUCH"
    : myPlayer?.isSprinting ? "SPRINT" : "";

  const isOffline = wsStatus === "error" || wsStatus === "reconnecting" || wsStatus === "connecting";

  return (
    <div className="w-full h-full relative bg-zinc-950">

      {/* ── Server offline banner ─────────────────────────────────────────── */}
      {isOffline && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className={`flex items-center gap-3 px-5 py-2.5 rounded-xl border text-sm font-bold tracking-wide shadow-2xl backdrop-blur-md ${
            wsStatus === "error"
              ? "bg-red-900/70 border-red-500/40 text-red-300"
              : "bg-yellow-900/60 border-yellow-500/40 text-yellow-300"
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              wsStatus === "error" ? "bg-red-400" :
              wsStatus === "reconnecting" ? "bg-yellow-400 animate-pulse" :
              "bg-yellow-400 animate-pulse"
            }`} />
            {wsStatus === "error" && "Server unreachable — start it with: npm run dev:server"}
            {wsStatus === "reconnecting" && "Reconnecting to game server…"}
            {wsStatus === "connecting" && "Connecting to game server…"}
          </div>
        </div>
      )}

      {/* ── HUD ──────────────────────────────────────────────────────────── */}
      {locked && (
        <div className="absolute inset-0 pointer-events-none z-20 select-none">

          {/* Health + Score — bottom left */}
          <div className="absolute bottom-8 left-6 flex flex-col gap-2 w-52">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-zinc-400 font-bold tracking-[0.2em]">HEALTH</span>
              <span className="text-white text-xs font-black">{myPlayer?.health ?? 100}</span>
            </div>
            <div className="w-full h-2.5 bg-zinc-900 rounded-full overflow-hidden border border-white/5">
              <div className="h-full rounded-full transition-all duration-200"
                style={{
                  width: `${myPlayer?.health ?? 100}%`,
                  background: (myPlayer?.health ?? 100) > 60 ? "#22c55e"
                    : (myPlayer?.health ?? 100) > 30 ? "#f59e0b" : "#ef4444",
                }}
              />
            </div>
            <div className="mt-1 text-[10px] text-blue-400 font-bold tracking-[0.2em]">SCORE</div>
            <div className="text-white text-3xl font-black leading-none">{myPlayer?.score ?? 0}</div>
            {gameMode === "tdm" && myPlayer?.team && (
              <div className="mt-2 text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: myPlayer.team === "red" ? "#f87171" : "#60a5fa" }}>
                TEAM {myPlayer.team}
              </div>
            )}
          </div>

          {/* Stance indicator — bottom centre */}
          {stance && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
              <div className="px-4 py-1 bg-white/10 backdrop-blur-sm rounded-full text-white text-xs font-black tracking-[0.3em] border border-white/20">
                {stance}
              </div>
            </div>
          )}

          {/* Ammo / controls hint — bottom right */}
          <div className="absolute bottom-8 right-6 flex flex-col items-end gap-1 text-[10px] text-zinc-600 font-mono">
            <span>SHIFT — Sprint</span>
            <span>C — Crouch</span>
            <span>X — Slide</span>
            <span>SPACE — Jump</span>
            <span>LMB — Shoot</span>
          </div>

          {/* Crosshair — centre */}
          <div className="absolute inset-0 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <line x1="14" y1="2"  x2="14" y2="10" stroke="white" strokeWidth="1.5" strokeOpacity="0.85" />
              <line x1="14" y1="18" x2="14" y2="26" stroke="white" strokeWidth="1.5" strokeOpacity="0.85" />
              <line x1="2"  y1="14" x2="10" y2="14" stroke="white" strokeWidth="1.5" strokeOpacity="0.85" />
              <line x1="18" y1="14" x2="26" y2="14" stroke="white" strokeWidth="1.5" strokeOpacity="0.85" />
              <circle cx="14" cy="14" r="2.5" stroke="white" strokeWidth="1" strokeOpacity="0.5" fill="none" />
            </svg>
          </div>

          {/* Team Score Overlay — top center */}
          {gameMode === "tdm" && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 flex gap-6 px-6 py-2.5 bg-black/60 border border-white/10 rounded-2xl backdrop-blur-md">
              <div className="flex flex-col items-center">
                <span className="text-[9px] text-red-400 font-bold tracking-[0.2em]">RED TEAM</span>
                <span className="text-white text-xl font-black">{teamScores.red}</span>
              </div>
              <div className="w-[1px] bg-white/10 self-stretch" />
              <div className="flex flex-col items-center">
                <span className="text-[9px] text-blue-400 font-bold tracking-[0.2em]">BLUE TEAM</span>
                <span className="text-white text-xl font-black">{teamScores.blue}</span>
              </div>
            </div>
          )}

          {/* Scoreboard — top right */}
          <div className="absolute top-16 right-4 flex flex-col gap-1 w-48">
            <div className="text-[9px] text-zinc-500 font-bold tracking-[0.2em] mb-0.5 text-right">
              {humanCount} HUMAN · {botCount} BOT
            </div>
            {[...frame.players].sort((a,b) => b.score - a.score).map(p => {
              const isSelf = p.id === localId;
              const rowClass = gameMode === "tdm"
                ? (p.team === "red"
                    ? `bg-red-950/40 ${isSelf ? "border-red-500 text-white font-black" : "border-red-900/40 text-red-200"}`
                    : `bg-blue-950/40 ${isSelf ? "border-blue-500 text-white font-black" : "border-blue-900/40 text-blue-200"}`)
                : (isSelf
                    ? "bg-blue-600/40 border-blue-500/40 text-white"
                    : "bg-black/40 border-white/5 text-zinc-400");
              const namePrefix = gameMode === "tdm" ? (p.team === "red" ? "[R] " : "[B] ") : "";
              return (
                <div key={p.id} className={`flex items-center justify-between px-2 py-1 rounded text-[10px] font-mono border ${rowClass}`}>
                  <span className={p.isBot ? "text-purple-300" : "text-green-300"}>
                    {p.isBot ? "🤖" : "🎮"} {namePrefix}{p.id.slice(0, 9)}
                  </span>
                  <span>{p.score}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Click-to-play splash ──────────────────────────────────────────── */}
      {!locked && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-b from-black/85 to-black/65 backdrop-blur-sm pointer-events-none select-none">
          <div className="text-center">
            <div className="text-white text-6xl font-black tracking-[0.5em] mb-1 drop-shadow-2xl">SARS</div>
            <div className="text-zinc-500 text-xs font-bold tracking-[0.4em] mb-4">MULTIPLAYER FPS</div>
            
            {/* Game Mode Selector */}
            <div className="mb-8 flex gap-3 justify-center pointer-events-auto">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  changeMode("ffa");
                }}
                className={`px-4 py-2 rounded-xl text-[10px] font-black tracking-wider transition-all duration-200 border cursor-pointer ${
                  gameMode === "ffa"
                    ? "bg-blue-600 text-white border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                    : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                FREE FOR ALL (8 Players)
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  changeMode("tdm");
                }}
                className={`px-4 py-2 rounded-xl text-[10px] font-black tracking-wider transition-all duration-200 border cursor-pointer ${
                  gameMode === "tdm"
                    ? "bg-blue-600 text-white border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                    : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                TEAM DEATHMATCH (4 VS 4)
              </button>
            </div>

            <div className="inline-flex items-center gap-2 px-8 py-3.5 bg-blue-600/90 rounded-full border border-blue-400/40 text-white font-black text-sm tracking-widest animate-pulse shadow-[0_0_40px_rgba(59,130,246,0.4)]">
              CLICK TO PLAY
            </div>
            <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-1.5 text-zinc-600 text-xs text-left mx-auto w-fit">
              <span>WASD</span><span className="text-zinc-500">Move</span>
              <span>SHIFT</span><span className="text-zinc-500">Sprint</span>
              <span>C</span><span className="text-zinc-500">Crouch</span>
              <span>X</span><span className="text-zinc-500">Slide</span>
              <span>SPACE</span><span className="text-zinc-500">Jump</span>
              <span>LMB</span><span className="text-zinc-500">Shoot</span>
              <span>ESC</span><span className="text-zinc-500">Unlock cursor</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Three.js Canvas ───────────────────────────────────────────────── */}
      <Canvas
        shadows
        camera={{ fov: 80, near: 0.05, far: 600, position: [0, 1.8, 0] }}
        style={{ position: "absolute", inset: 0 }}
      >
        <Sky sunPosition={[80, 25, 80]} turbidity={6} rayleigh={0.6} />
        <ambientLight intensity={0.3} />
        <directionalLight position={[30, 60, 20]} intensity={1.5} castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-far={200}
          shadow-camera-left={-80} shadow-camera-right={80}
          shadow-camera-top={80}  shadow-camera-bottom={-80}
        />
        <hemisphereLight args={["#87ceeb", "#0f172a", 0.25]} />

        <ArenaGeometry />
        <TracesLayer shots={frame.shots} />
        <NetworkController setFrame={setFrame} setLocalId={setLocalId} setLocked={setLocked} setWsStatus={setWsStatus} setWs={setWs} />
        <CameraRig myPlayer={myPlayer} locked={locked} />

        {/* Enemies — every player except local */}
        {frame.players
          .filter(p => p.id !== localId)
          .map(p => <EnemyPlayer key={p.id} player={p} gameMode={gameMode} />)
        }
      </Canvas>
    </div>
  );
}
