import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // three.js and R3F ship as ESM — Next.js needs to transpile them
  transpilePackages: ["three", "@react-three/fiber", "@react-three/drei"],
};

export default nextConfig;
