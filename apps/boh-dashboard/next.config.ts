import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  allowedDevOrigins: ["*.localhost"],
  distDir: process.env.EXA_NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@exa-foh/shared", "@exa-foh/ui"]
};

export default nextConfig;
