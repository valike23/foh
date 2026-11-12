import { spawn } from "node:child_process";
import path from "node:path";
const root = process.cwd(), children = [];
const start = (script, args, cwd, env) => { const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, ...env }, stdio: "inherit" }); children.push(child); child.on("error", error => { console.error(error); process.exitCode = 1; }); return child; };
start(path.join(root, "node_modules/tsx/dist/cli.mjs"), ["watch", "src/server.ts"], path.join(root, "apps/offline"), {});
start(path.join(root, "node_modules/next/dist/bin/next"), ["dev", "--webpack", "-H", "0.0.0.0", "-p", "5380"], path.join(root, "apps/boh-dashboard"), { EXA_NEXT_DIST_DIR: ".next-offline", EXA_OFFLINE_MODE: "1", EXA_DEPLOYMENT_MODE: "online", ONLINE_INTERNAL_URL: "http://127.0.0.1:5381", ONLINE_PROXY_SECRET: "", TENANT_ROUTING_MODE: "subdomain" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { for (const child of children) child.kill(); process.exit(0); });
