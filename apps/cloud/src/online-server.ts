import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createOnlineApp } from "./online-app.js";

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in apps/cloud/.env before starting the online server");
const db = new PrismaClient();
await db.$connect();
const port = Number(process.env.PORT ?? process.env.ONLINE_PORT ?? 4200);
const baseDomain = process.env.TENANT_BASE_DOMAIN ?? "localhost";
const publicOrigin = process.env.ONLINE_PUBLIC_ORIGIN ?? `http://app.${baseDomain}:${port}`;
const routingMode = process.env.TENANT_ROUTING_MODE ?? "subdomain";
if (routingMode !== "subdomain" && routingMode !== "single-host") throw new Error("TENANT_ROUTING_MODE must be subdomain or single-host");
const app = createOnlineApp(db, { baseDomain, publicOrigin, routingMode, proxySecret: process.env.ONLINE_PROXY_SECRET });
const server = app.listen(port, process.env.ONLINE_HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1"), () => console.log(`EXA online API: ${publicOrigin}\nMain app: ${process.env.DASHBOARD_PUBLIC_ORIGIN ?? "http://app.localhost:5173"}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  server.close(() => { void db.$disconnect().finally(() => process.exit(0)); });
});
