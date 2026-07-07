import React from "react";
import GameCanvas from "../components/GameCanvas";

export const metadata = {
  title: "Sars — Multiplayer FPS",
  description: "Browser-native multiplayer first-person shooter built with React Three Fiber.",
};

export default function Home() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-black relative">
      <GameCanvas />
    </main>
  );
}
