import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  distDir: process.env.EXA_NEXT_DIST_DIR ?? ".next",
  devIndicators: false,
  transpilePackages: ["@exa-foh/shared", "@exa-foh/ui"]
};

export default nextConfig;
