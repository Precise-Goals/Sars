"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky, PointerLockControls, Text, Billboard, useGLTF } from "@react-three/drei";
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
  ammo: number;
  reloadTicks: number;
  difficulty?: "easy" | "veteran" | "hardened" | "realtime";
}

type ShotTrace = [number, number, number, number]; // [ox, oz, dx, dz]

interface ServerFrame {
  players: PlayerState[];
  shots: ShotTrace[];
  gameMode?: "practice" | "explore" | "real";
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
  reload: boolean;
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
    const recoilZ = flash.current > 0 ? 0.09 : 0;

    localPos.current.x = THREE.MathUtils.lerp(localPos.current.x, tgtX + bobX, 0.18);
    localPos.current.y = THREE.MathUtils.lerp(localPos.current.y, tgtY + bobY, 0.18);
    localPos.current.z = THREE.MathUtils.lerp(localPos.current.z, -0.48 + recoilZ, 0.22);
    localRotX.current = THREE.MathUtils.lerp(localRotX.current, flash.current > 0 ? -0.15 : 0, 0.22);

    const offset = localPos.current.clone();
    offset.applyQuaternion(state.camera.quaternion);

    g.position.copy(state.camera.position).add(offset);
    g.rotation.copy(state.camera.rotation);
    g.rotateX(localRotX.current);
  });

  return (
    <group ref={groupRef}>
      {/* ── Tactical Hands / Arms ── */}
      {/* Left arm/hand holding barrel */}
      <mesh position={[-0.12, -0.15, -0.1]} rotation={[0.4, 0.2, -0.3]}>
        <capsuleGeometry args={[0.038, 0.28, 6, 12]} />
        <meshStandardMaterial color="#1f2937" roughness={0.85} metalness={0.1} />
      </mesh>
      {/* Right arm/hand holding grip */}
      <mesh position={[0.07, -0.18, 0.08]} rotation={[-0.4, -0.15, 0.25]}>
        <capsuleGeometry args={[0.042, 0.28, 6, 12]} />
        <meshStandardMaterial color="#1f2937" roughness={0.85} metalness={0.1} />
      </mesh>

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

const MinecraftPlayer = ({ player, gameMode, myTeam }: { player: PlayerState; gameMode: string; myTeam?: string }) => {
  const groupRef = useRef<THREE.Group>(null!);
  const leftArm = useRef<THREE.Mesh>(null!);
  const rightArm = useRef<THREE.Mesh>(null!);
  const leftLeg = useRef<THREE.Mesh>(null!);
  const rightLeg = useRef<THREE.Mesh>(null!);

  const targetPos = useRef(new THREE.Vector3(player.position.x, player.position.y, player.position.z));
  const targetRotY = useRef(player.rotY);
  const lastPos = useRef(new THREE.Vector3(player.position.x, player.position.y, player.position.z));
  const swingTime = useRef(0);

  useFrame((state, delta) => {
    // Smoothly interpolate position and rotation
    targetPos.current.set(player.position.x, player.position.y, player.position.z);
    groupRef.current.position.lerp(targetPos.current, 0.3);
    
    targetRotY.current = player.rotY;
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y, targetRotY.current, 0.3
    );

    // Calculate actual speed based on position changes for procedural animation
    const speed = groupRef.current.position.distanceTo(lastPos.current) / (delta || 0.016);
    lastPos.current.copy(groupRef.current.position);
    
    if (speed > 1.0) {
      // Running/Walking swing speed
      swingTime.current += delta * (player.isSprinting ? 12.0 : 8.0);
    } else {
      // Idle reset
      swingTime.current = THREE.MathUtils.lerp(swingTime.current, 0, 0.1);
    }

    const swing = Math.sin(swingTime.current);
    const swingMax = player.isSprinting ? 1.0 : 0.6; // Sprinting increases swing angle
    
    if (leftArm.current) leftArm.current.rotation.x = swing * swingMax;
    if (rightArm.current) rightArm.current.rotation.x = -swing * swingMax;
    if (leftLeg.current) leftLeg.current.rotation.x = -swing * swingMax;
    if (rightLeg.current) rightLeg.current.rotation.x = swing * swingMax;
  });

  const crouchScale = player.isCrouching || player.isSliding ? 0.65 : 1;
  const isEnemy = true; // For now all bots/players are enemies except self
  
  let bodyColor = player.isBot ? "#3b82f6" : "#ef4444";
  const showRedGlow = isEnemy && !player.isBot;
  const shortLabel = player.id.slice(0, 11);

  // Minecraft dimensions based on Y=0 floor:
  // Leg: 0.75 height. Body: 0.75 height. Head: 0.5 height.
  // Arms pivot from shoulders. Legs pivot from waist.

  return (
    <group ref={groupRef} position={[player.position.x, player.position.y, player.position.z]} scale={[1, crouchScale, 1]}>
      {/* ── Glow border shell ── */}
      {showRedGlow && (
        <mesh position={[0, 1.0, 0]} scale={[1.1, 1.0, 1.1]}>
          <boxGeometry args={[0.8, 2.0, 0.8]} />
          <meshBasicMaterial color="#ef4444" wireframe transparent opacity={0.25} />
        </mesh>
      )}

      {/* ── Legs (Pivot at y=0.75) ── */}
      <group position={[0, 0.75, 0]}>
        {/* Left Leg */}
        <mesh ref={leftLeg} position={[-0.15, -0.375, 0]}>
          <boxGeometry args={[0.2, 0.75, 0.2]} />
          <meshStandardMaterial color="#1e3a8a" roughness={0.9} />
        </mesh>
        {/* Right Leg */}
        <mesh ref={rightLeg} position={[0.15, -0.375, 0]}>
          <boxGeometry args={[0.2, 0.75, 0.2]} />
          <meshStandardMaterial color="#1e3a8a" roughness={0.9} />
        </mesh>
      </group>

      {/* ── Body (V-shaped Trapezium) ── */}
      {/* We use a cylinder with 4 segments rotated 45 degrees to make a box with different top/bottom radii */}
      <mesh position={[0, 1.125, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <cylinderGeometry args={[0.35, 0.25, 0.75, 4]} />
        <meshStandardMaterial color={bodyColor} roughness={0.7} />
      </mesh>

      {/* ── Arms (Pivot at shoulders y=1.4) ── */}
      <group position={[0, 1.4, 0]}>
        {/* Left Arm */}
        <mesh ref={leftArm} position={[-0.35, -0.3, 0]}>
          <boxGeometry args={[0.18, 0.7, 0.18]} />
          <meshStandardMaterial color="#fbbf24" roughness={0.5} />
        </mesh>
        {/* Right Arm (Holding Gun) */}
        <mesh ref={rightArm} position={[0.35, -0.3, 0]}>
          <boxGeometry args={[0.18, 0.7, 0.18]} />
          <meshStandardMaterial color="#fbbf24" roughness={0.5} />
          {/* L-shape gun in right hand */}
          <group position={[0, -0.35, -0.15]}>
            <mesh position={[0, 0.02, -0.13]}>
              <boxGeometry args={[0.05, 0.05, 0.3]} />
              <meshStandardMaterial color="#1a1a1a" metalness={0.9} roughness={0.2} />
            </mesh>
            <mesh position={[0, -0.07, 0.03]}>
              <boxGeometry args={[0.05, 0.14, 0.06]} />
              <meshStandardMaterial color="#2a1f1a" roughness={0.8} />
            </mesh>
          </group>
        </mesh>
      </group>

      {/* ── Head (Box) ── */}
      <mesh position={[0, 1.75, 0]} castShadow>
        <boxGeometry args={[0.45, 0.45, 0.45]} />
        <meshStandardMaterial color="#fca5a5" roughness={0.3} />
        {/* Simple Eyes */}
        <mesh position={[-0.1, 0.05, -0.23]}>
          <boxGeometry args={[0.05, 0.05, 0.02]} />
          <meshStandardMaterial color="#000" />
        </mesh>
        <mesh position={[0.1, 0.05, -0.23]}>
          <boxGeometry args={[0.05, 0.05, 0.02]} />
          <meshStandardMaterial color="#000" />
        </mesh>
      </mesh>

      {/* ── Health bar + name ── */}
      <Billboard position={[0, 2.2, 0]}>
        <mesh position={[0, 0.16, 0]}>
          <planeGeometry args={[1.2, 0.12]} />
          <meshBasicMaterial color="#111" transparent opacity={0.7} />
        </mesh>
        <mesh position={[-(1.2 - (1.2 * player.health) / 100) / 2, 0.16, 0.001]}
              scale={[(player.health / 100), 1, 1]}>
          <planeGeometry args={[1.2, 0.12]} />
          <meshBasicMaterial color={player.health > 60 ? "#22c55e" : player.health > 30 ? "#f59e0b" : "#ef4444"} />
        </mesh>
        <Text fontSize={0.22} color="white" anchorX="center" anchorY="middle"
              outlineWidth={0.04} outlineColor="#000" position={[0, 0, 0.002]}>
          {`${player.isBot ? `🤖 [${(player.difficulty ?? "easy").toUpperCase()}]` : "🎮"} ${shortLabel}  ♥${player.health}`}
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
  setFrame, setLocalId, setLocked, setCanLock, setWsStatus, setWs, setSessionId, sensitivity,
}: {
  setFrame: React.Dispatch<React.SetStateAction<ServerFrame>>;
  setLocalId: React.Dispatch<React.SetStateAction<string | null>>;
  setLocked: React.Dispatch<React.SetStateAction<boolean>>;
  setCanLock: React.Dispatch<React.SetStateAction<boolean>>;
  setWsStatus: React.Dispatch<React.SetStateAction<WsStatus>>;
  setWs: React.Dispatch<React.SetStateAction<WebSocket | null>>;
  setSessionId: React.Dispatch<React.SetStateAction<string>>;
  sensitivity: number;
}) => {
  const wsRef      = useRef<WebSocket | null>(null);
  const localIdRef = useRef<string | null>(null);
  const frameRef   = useRef<ServerFrame>({ players: [], shots: [] });
  const inputRef   = useRef<InputState>({
    w: false, a: false, s: false, d: false,
    rotY: 0, shoot: false,
    sprint: false, crouch: false, slide: false, jump: false,
    reload: false,
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

      const s = typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("session") ?? "default") : "default";
      const mode = typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("mode") ?? "real") : "real";
      const ws = new WebSocket(`ws://localhost:8080?session=${s}&mode=${mode}`);
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
            if (p.session && typeof window !== "undefined") {
              setSessionId(p.session as string);
              // Update URL seamlessly for sharing without reloading
              window.history.replaceState({}, '', `/?session=${p.session}&mode=${new URLSearchParams(window.location.search).get("mode") ?? "real"}`);
            }
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
      if (e.code === "KeyR")      i.reload = true;
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
      if (e.code === "KeyR")      i.reload = false;
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
      onUnlock={() => {
        setLocked(false);
        setCanLock(false);
        setTimeout(() => setCanLock(true), 1500); // Browser security cooldown
      }}
      pointerSpeed={sensitivity}
      selector="#play-button"
    />
  );
};

// ─── Arena static geometry ────────────────────────────────────────────────────

const ArenaGeometry = () => {
  const { scene } = useGLTF("/assets/map.glb");

  useEffect(() => {
    scene.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m: any) => {
              m.roughness = Math.max(m.roughness || 0, 0.65);
            });
          } else {
            child.material.roughness = Math.max(child.material.roughness || 0, 0.65);
          }
        }
      }
    });
  }, [scene]);

  return <primitive object={scene} scale={[8, 8, 8]} position={[0, 0, 0]} />;
};

// Preload the GLB model to speed up rendering
useGLTF.preload("/assets/map.glb");

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function GameCanvas() {
  const [frame,     setFrame]     = useState<ServerFrame>({ players: [], shots: [] });
  const [localId,   setLocalId]   = useState<string | null>(null);
  const [locked,    setLocked]    = useState(false);
  const [canLock,   setCanLock]   = useState(true);
  const [wsStatus,  setWsStatus]  = useState<WsStatus>("connecting");
  const [ws,        setWs]        = useState<WebSocket | null>(null);

  const [sensitivity, setSensitivity] = useState(1.0);
  const [botDifficultySetting, setBotDifficultySetting] = useState<"random" | "easy" | "veteran" | "hardened" | "realtime">("random");
  const [showSettings, setShowSettings] = useState(false);
  const [sessionId, setSessionId] = useState("default");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      const s = searchParams.get("session") ?? "default";
      setSessionId(s);

      // Handle and suppress browser-specific Pointer Lock security rejections
      const handleRejection = (event: PromiseRejectionEvent) => {
        const reason = event.reason;
        if (
          reason &&
          (reason.name === "WrongDocumentError" ||
            (reason.message && reason.message.includes("pointer lock")) ||
            (reason.message && reason.message.includes("PointerLockControls")))
        ) {
          event.preventDefault(); // Suppress the unhandled rejection warning
          console.warn("[Sars] Suppressed browser pointer lock security error:", reason.message || reason);
        }
      };

      window.addEventListener("unhandledrejection", handleRejection);

      // Handle synchronous security errors thrown by the browser
      const handleError = (event: ErrorEvent) => {
        if (event.message && (event.message.includes("Pointer lock") || event.message.includes("PointerLockControls"))) {
          event.preventDefault();
          console.warn("[Sars] Suppressed synchronous pointer lock error.");
        }
      };
      window.addEventListener("error", handleError);

      return () => {
        window.removeEventListener("unhandledrejection", handleRejection);
        window.removeEventListener("error", handleError);
      };
    }
  }, []);

  const myPlayer   = frame.players.find(p => p.id === localId);
  const botCount   = frame.players.filter(p => p.isBot).length;
  const humanCount = frame.players.filter(p => !p.isBot).length;

  const gameMode = frame.gameMode ?? "real";
  const teamScores = frame.teamScores ?? { red: 0, blue: 0 };

  const selectMode = (mode: string) => {
    // Navigate to reload page with the new mode cleanly
    const newSession = Math.random().toString(36).slice(2, 8);
    window.location.href = `/?mode=${mode}&session=${mode}_${newSession}`;
  };

  // Stance label
  const stance = myPlayer?.isSliding ? "SLIDE" : myPlayer?.isCrouching ? "CROUCH"
    : myPlayer?.isSprinting ? "SPRINT" : "";

  const isOffline = wsStatus === "error" || wsStatus === "reconnecting" || wsStatus === "connecting";

  return (
    <div className="w-full h-full relative bg-zinc-950">

      {/* ── Top Navigation Bar ─────────────────────────────────────────── */}
      <nav className="absolute top-0 left-0 w-full h-14 bg-black/70 backdrop-blur-md border-b border-zinc-800/80 z-40 flex items-center justify-between px-6 shadow-2xl pointer-events-auto">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-blue-600 flex items-center justify-center shadow-[0_0_12px_rgba(37,99,235,0.6)]">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" />
            </svg>
          </div>
          <span className="text-zinc-100 text-base font-black tracking-[0.2em]">SARS</span>
          <span className="text-zinc-600 text-xs font-semibold tracking-widest hidden sm:block">MULTIPLAYER</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1 text-xs text-zinc-500 font-mono bg-zinc-900/80 border border-zinc-800 rounded px-2 py-1">
            <span className="text-green-500 animate-pulse">●</span>
            <span>session: {sessionId}</span>
          </div>
          <button
            title="Settings"
            onClick={(e) => {
              e.stopPropagation();
              setShowSettings(prev => !prev);
            }}
            className="text-zinc-400 hover:text-white transition-colors p-1.5 rounded-full hover:bg-zinc-800/80 active:scale-95 cursor-pointer pointer-events-auto"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </nav>

      {/* ── Settings Panel Overlay ────────────────────────────────────────── */}
      {showSettings && (
        <div 
          onClick={() => setShowSettings(false)}
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md cursor-pointer pointer-events-auto select-none"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="w-[440px] bg-zinc-950/90 border border-zinc-800/80 p-6 rounded-2xl shadow-2xl flex flex-col gap-6 cursor-default pointer-events-auto"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <span className="text-white font-black tracking-wider text-base">GAME SETTINGS</span>
              <button 
                onClick={() => setShowSettings(false)}
                className="text-zinc-500 hover:text-white text-[10px] font-bold font-mono tracking-widest border border-zinc-800 hover:border-zinc-700 px-2.5 py-1 rounded-md cursor-pointer"
              >
                CLOSE
              </button>
            </div>

            {/* Mouse Sensitivity */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400 font-bold tracking-wider">MOUSE SENSITIVITY</span>
                <span className="text-blue-400 text-xs font-mono font-bold">{sensitivity.toFixed(1)}x</span>
              </div>
              <input 
                type="range"
                min="0.2"
                max="3.0"
                step="0.1"
                value={sensitivity}
                onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                className="w-full h-1 bg-zinc-900 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>

            {/* Bot Difficulty Settings */}
            <div className="flex flex-col gap-2.5">
              <span className="text-[10px] text-zinc-400 font-bold tracking-wider">BOT DIFFICULTY LEVEL</span>
              <div className="grid grid-cols-2 gap-2">
                {(["random", "easy", "veteran", "hardened", "realtime"] as const).map((diff) => (
                  <button
                    key={diff}
                    onClick={() => {
                      setBotDifficultySetting(diff);
                      if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(pack({ type: "SET_BOT_DIFFICULTY", difficulty: diff }));
                      }
                    }}
                    className={`px-3 py-2 rounded-xl text-[9px] font-black tracking-widest border transition-all duration-200 cursor-pointer ${
                      botDifficultySetting === diff
                        ? "bg-blue-600 text-white border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]"
                        : "bg-zinc-900/60 text-zinc-500 border-zinc-800 hover:text-zinc-300 hover:bg-zinc-900"
                    }`}
                  >
                    {diff.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Keybinds or controls options */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] text-zinc-400 font-bold tracking-wider mb-1">KEYBOARD CONTROLS</span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] text-zinc-500 font-mono bg-zinc-900/40 p-4 border border-zinc-800/40 rounded-xl">
                <div className="flex justify-between border-b border-zinc-800/30 pb-0.5">
                  <span>WASD</span>
                  <span className="text-zinc-300 font-bold">Move</span>
                </div>
                <div className="flex justify-between border-b border-zinc-800/30 pb-0.5">
                  <span>LMB</span>
                  <span className="text-zinc-300 font-bold">Shoot</span>
                </div>
                <div className="flex justify-between border-b border-zinc-800/30 pb-0.5">
                  <span>R</span>
                  <span className="text-zinc-300 font-bold">Reload</span>
                </div>
                <div className="flex justify-between border-b border-zinc-800/30 pb-0.5">
                  <span>SPACE</span>
                  <span className="text-zinc-300 font-bold">Jump</span>
                </div>
                <div className="flex justify-between border-b border-zinc-800/30 pb-0.5">
                  <span>SHIFT</span>
                  <span className="text-zinc-300 font-bold">Sprint</span>
                </div>
                <div className="flex justify-between border-b border-zinc-800/30 pb-0.5">
                  <span>C</span>
                  <span className="text-zinc-300 font-bold">Crouch</span>
                </div>
                <div className="flex justify-between border-b border-zinc-800/30 pb-0.5">
                  <span>X</span>
                  <span className="text-zinc-300 font-bold">Slide</span>
                </div>
                <div className="flex justify-between border-b border-zinc-800/30 pb-0.5">
                  <span>ESC</span>
                  <span className="text-zinc-300 font-bold">Unlock</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
          </div>

          {/* Stance indicator — bottom centre */}
          {stance && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
              <div className="px-4 py-1 bg-white/10 backdrop-blur-sm rounded-full text-white text-xs font-black tracking-[0.3em] border border-white/20">
                {stance}
              </div>
            </div>
          )}

          {/* Ammo display — bottom right */}
          <div className="absolute bottom-28 right-6 flex flex-col items-end gap-0.5 pointer-events-none select-none">
            <span className="text-[10px] text-zinc-500 font-bold tracking-[0.2em]">AMMO</span>
            {myPlayer && myPlayer.reloadTicks > 0 ? (
              <span className="text-yellow-500 text-2xl font-black tracking-widest animate-pulse font-mono">RELOADING</span>
            ) : (
              <span className="text-white text-4xl font-black font-mono">
                {myPlayer?.ammo ?? 30}<span className="text-zinc-500 text-xl font-normal"> / 30</span>
              </span>
            )}
          </div>

          {/* Ammo / controls hint — bottom right */}
          <div className="absolute bottom-8 right-6 flex flex-col items-end gap-1 text-[10px] text-zinc-600 font-mono">
            <span>R — Reload</span>
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

          {/* Scoreboard — top right */}
          <div className="absolute top-16 right-4 flex flex-col gap-1 w-48">
            <div className="text-[9px] text-zinc-500 font-bold tracking-[0.2em] mb-0.5 text-right">
              {humanCount} HUMAN · {botCount} BOT
            </div>
            {[...frame.players].sort((a,b) => b.score - a.score).map(p => {
              const isSelf = p.id === localId;
              const rowClass = isSelf
                ? "bg-blue-600/40 border-blue-500/40 text-white"
                : "bg-black/40 border-white/5 text-zinc-400";
              const botTag = p.isBot ? ` [${(p.difficulty ?? "easy").toUpperCase().slice(0, 4)}]` : "";
              return (
                <div key={p.id} className={`flex items-center justify-between px-2 py-1 rounded text-[10px] font-mono border ${rowClass}`}>
                  <span className={p.isBot ? "text-purple-300" : "text-green-300"}>
                    {p.isBot ? "🤖" : "🎮"} {p.id.slice(0, 7)}{botTag}
                  </span>
                  <span>{p.score}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Cooldown Click Blocker ─────────────────────────────────────────── */}
      {!canLock && (
        <div className="absolute inset-0 z-50 pointer-events-auto cursor-wait" />
      )}

      {/* ── Click-to-play splash ──────────────────────────────────────────── */}
      {!locked && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-b from-black/85 to-black/65 backdrop-blur-sm pointer-events-none select-none">
          <div className="text-center">
            <div className="text-white text-6xl font-black tracking-[0.5em] mb-1 drop-shadow-2xl">SARS</div>
            <div className="text-zinc-500 text-xs font-bold tracking-[0.4em] mb-4">MULTIPLAYER FPS</div>
            
            {/* Giant PLAY Button */}
            <div className="mb-6 flex justify-center pointer-events-auto">
              <button
                id="play-button"
                type="button"
                className={`group relative inline-flex items-center justify-center gap-3 px-16 py-6 bg-blue-600 rounded-2xl border-b-[6px] border-blue-800 text-white font-black text-3xl tracking-[0.2em] shadow-[0_0_50px_rgba(37,99,235,0.4)] transition-all duration-150 active:translate-y-1.5 active:border-b-0 cursor-pointer ${canLock ? "hover:bg-blue-500 hover:shadow-[0_0_80px_rgba(59,130,246,0.6)]" : "opacity-50"}`}
              >
                {canLock ? "CLICK TO PLAY" : "PLEASE WAIT..."}
              </button>
            </div>

            {/* Sub options */}
            <div className="flex gap-4 justify-center pointer-events-auto">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectMode("real");
                }}
                className="px-6 py-3 bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 hover:bg-zinc-800 text-[11px] font-black tracking-widest rounded-xl transition-all cursor-pointer"
              >
                REAL MATCHMAKING
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectMode("practice");
                }}
                className="px-6 py-3 bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 hover:bg-zinc-800 text-[11px] font-black tracking-widest rounded-xl transition-all cursor-pointer"
              >
                PRACTICE BOTS
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectMode("explore");
                }}
                className="px-6 py-3 bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 hover:bg-zinc-800 text-[11px] font-black tracking-widest rounded-xl transition-all cursor-pointer"
              >
                EXPLORE MAP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Three.js Canvas ───────────────────────────────────────────────── */}
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
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

        <React.Suspense fallback={null}>
          <ArenaGeometry />
        </React.Suspense>
        <TracesLayer shots={frame.shots} />
        <NetworkController setFrame={setFrame} setLocalId={setLocalId} setLocked={setLocked} setCanLock={setCanLock} setWsStatus={setWsStatus} setWs={setWs} setSessionId={setSessionId} sensitivity={sensitivity} />
        <CameraRig myPlayer={myPlayer} locked={locked} />

        {/* Enemies — every player except local */}
        {frame.players
          .filter(p => p.id !== localId)
          .map(p => <MinecraftPlayer key={p.id} player={p} gameMode={gameMode} myTeam={myPlayer?.team} />)
        }
      </Canvas>
    </div>
  );
}
