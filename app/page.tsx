import React from "react";
import GameCanvas from "../components/GameCanvas";

export const metadata = {
  title: "Sars — Multiplayer FPS",
  description: "Browser-native multiplayer first-person shooter built with React Three Fiber.",
};

export default function Home() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-black relative">
      {/* Top Navigation Bar */}
      <nav className="absolute top-0 left-0 w-full h-14 bg-black/70 backdrop-blur-md border-b border-zinc-800/80 z-50 flex items-center justify-between px-6 shadow-2xl">
        {/* Logo + Title */}
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-blue-600 flex items-center justify-center shadow-[0_0_12px_rgba(37,99,235,0.6)]">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" />
            </svg>
          </div>
          <span className="text-zinc-100 text-base font-black tracking-[0.2em]">SARS</span>
          <span className="text-zinc-600 text-xs font-semibold tracking-widest hidden sm:block">MULTIPLAYER</span>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1 text-xs text-zinc-500 font-mono bg-zinc-900/80 border border-zinc-800 rounded px-2 py-1">
            <span className="text-green-500">●</span>
            <span>ws://localhost:8080</span>
          </div>
          <button
            title="Settings"
            className="text-zinc-400 hover:text-white transition-colors p-1.5 rounded-full hover:bg-zinc-800/80 active:scale-95"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </nav>

      {/* Game Canvas — fills the full screen, sits behind nav */}
      <div className="absolute inset-0">
        <GameCanvas />
      </div>
    </main>
  );
}
