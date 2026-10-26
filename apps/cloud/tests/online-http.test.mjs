import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createOnlineApp } from "../dist/online-app.js";
import { fetchWithHost as fetch } from "./http-helper.mjs";

test("onboarding page serves locally and rejects untrusted hosts and cross-origin writes before database access", async t => {
  // These public/validation paths must work without a PostgreSQL connection.
  const db = new PrismaClient({ datasourceUrl: "postgresql://unused:unused@127.0.0.1:1/unused" });
  const app = createOnlineApp(db, { baseDomain: "localhost", publicOrigin: "http://app.localhost:4200" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.$disconnect(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base, { headers: { host: "app.localhost:4200" } });
  assert.equal(page.status, 307); assert.equal(page.headers.get("location"), "http://app.localhost:5173");
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  const publicTenant = await fetch(`${base}/api/tenant`, { headers: { host: "app.localhost:4200", "x-forwarded-host": "club53.localhost:4200", "x-tenant-id": "spoof" } });
  assert.deepEqual(await publicTenant.json(), { tenant: null });
  const invalidHost = await fetch(base, { headers: { host: "attacker.example" } });
  assert.equal(invalidHost.status, 400);
  for (const origin of ["http://attacker.example", "http://club53.localhost:4200", ""]) {
    const denied = await fetch(`${base}/api/auth/signup`, { method: "POST", headers: { host: "app.localhost:4200", origin, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(denied.status, 403);
  }
  const wrongHost = await fetch(`${base}/api/auth/signup`, { method: "POST", headers: { host: "club53.localhost:4200", origin: "http://club53.localhost:4200", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(wrongHost.status, 400);
  const invalidSignup = await fetch(`${base}/api/auth/signup`, { method: "POST", headers: { host: "app.localhost:4200", origin: "http://app.localhost:4200", "Content-Type": "application/json" }, body: JSON.stringify({ slug: "admin" }) });
  assert.equal(invalidSignup.status, 422);
});
