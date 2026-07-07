"use client";

import React, { useEffect, useRef } from "react";
import { Unity, useUnityContext } from "react-unity-webgl";
import { pack, unpack } from "msgpackr";

export default function PlayPage() {
  const { unityProvider, sendMessage } = useUnityContext({
    loaderUrl: "/build/myunityapp.loader.js", // Placeholder build paths
    dataUrl: "/build/myunityapp.data",
    frameworkUrl: "/build/myunityapp.framework.js",
    codeUrl: "/build/myunityapp.wasm",
  });

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Establish WebSocket connection to the local server
    const ws = new WebSocket("ws://localhost:8080");
    
    // Set binaryType to receive raw buffers
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected to the local game server.");
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        try {
          // Unpack the msgpack payload from the server
          const payload = unpack(new Uint8Array(event.data));
          
          // Stringify it as requested for the Unity bridge
          const jsonString = JSON.stringify(payload);
          
          // Pass this stringified state to the Unity WebGL instance
          sendMessage("GameController", "SyncServerState", jsonString);
        } catch (error) {
          console.error("Error unpacking msgpack or sending to Unity:", error);
        }
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("WebSocket connection closed.");
    };

    // Expose the global function mapped via [DllImport("__Internal")] in Unity
    // We parse the JSON from Unity, pack it to msgpack, and send it to our server.
    // @ts-ignore
    window.SendInputToServer = (inputJson: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          const inputData = JSON.parse(inputJson);
          const binaryPayload = pack(inputData);
          wsRef.current.send(binaryPayload);
        } catch (e) {
          console.error("Failed to parse and pack Unity input:", e);
        }
      }
    };

    // Cleanly close on component unmount
    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      
      // @ts-ignore
      delete window.SendInputToServer;
    };
  }, [sendMessage]);

  return (
    <div className="w-screen h-screen bg-black overflow-hidden flex items-center justify-center">
      <Unity 
        unityProvider={unityProvider} 
        style={{ width: "100%", height: "100%" }} 
      />
    </div>
  );
}
