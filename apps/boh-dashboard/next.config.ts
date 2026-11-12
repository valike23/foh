import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  allowedDevOrigins: ["*.localhost"],
  distDir: process.env.EXA_NEXT_DIST_DIR ?? ".next",
  ...(process.env.EXA_DESKTOP_BUILD === "1" ? { output: "standalone" as const, outputFileTracingRoot: path.resolve(process.cwd(), "../..") } : {}),
  transpilePackages: ["@exa-foh/shared", "@exa-foh/ui"]
};

export default nextConfig;
