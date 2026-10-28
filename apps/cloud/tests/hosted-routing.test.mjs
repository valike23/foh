import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createOnlineApp } from "../dist/online-app.js";
import { fetchWithHost as fetch } from "./http-helper.mjs";

test("single-host deployment supports secure Render proxy routing and isolated workspace sessions", { skip: !process.env.DATABASE_URL }, async t => {
  const db = new PrismaClient(); const host = "foh-rouge.vercel.app"; const secret = "test-proxy-key-".repeat(4); const slugs = [`hosted-a-${randomUUID().slice(0, 8)}`, `hosted-b-${randomUUID().slice(0, 8)}`];
  const server = createOnlineApp(db, { baseDomain: host, publicOrigin: `https://${host}`, routingMode: "single-host", proxySecret: secret }).listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.tenant.deleteMany({ where: { slug: { in: slugs } } }); await db.$disconnect(); });
  async function request(path, { method = "GET", body, cookie, headers = {}, proxy = true } = {}) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { host: "foh.onrender.com", origin: `https://${host}`, "Content-Type": "application/json", ...(proxy ? { "x-exa-workspace-host": host, "x-exa-proxy-key": secret } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json(), cookie: r.headers.get("set-cookie") };
  }
  assert.equal((await request("/health", { proxy: false })).status, 200);
  assert.equal((await request("/api/tenant", { proxy: false, headers: { "x-forwarded-host": host } })).status, 400);
  assert.equal((await request("/api/tenant", { headers: { "x-exa-proxy-key": "wrong-secret" } })).status, 403);
  assert.equal((await request("/api/tenant", { headers: { "x-exa-workspace-host": "evil.example" } })).status, 400);
  assert.equal((await request("/api/tenant?workspace=../../bad")).status, 400);
  assert.equal((await request("/api/auth/session")).status, 401);
  assert.deepEqual((await request("/api/tenant")).data, { tenant: null, routingMode: "single-host" });
  const credentials = { email: "owner@example.test", password: "hosted-test-password-123" };
  for (const slug of slugs) {
    const result = await request("/api/auth/signup", { method: "POST", body: { ...credentials, slug, name: "Hosted owner", organizationName: slug } });
    assert.equal(result.status, 201); assert.equal(result.data.loginUrl, `https://${host}/login?workspace=${slug}`); assert.equal(result.data.workspaceUrl, `https://${host}`);
  }
  const login = await request(`/api/auth/login?workspace=${slugs[0]}`, { method: "POST", body: credentials }); assert.equal(login.status, 200); assert.match(login.cookie, /Secure/);
  const cookie = `${login.cookie.match(/exa-online-session=[^;]+/)[0]}; ${login.cookie.match(/exa-workspace=[^;]+/)[0]}`;
  assert.equal((await request("/api/auth/session", { cookie })).data.tenant.slug, slugs[0]);
  assert.equal((await request("/api/tenant", { cookie })).data.tenant.slug, slugs[0]);
  assert.equal((await request("/api/tenant?central=1", { cookie })).data.tenant, null);
  assert.equal((await request(`/api/tenant?workspace=${slugs[1]}`, { cookie })).data.tenant.slug, slugs[1]);
  assert.equal((await request(`/api/venues?workspace=${slugs[1]}`, { cookie })).status, 401, "a workspace selector is not authorization to another tenant");
  assert.equal((await request("/api/venues", { method: "POST", cookie, headers: { origin: "https://evil.example" }, body: { name: "Forbidden" } })).status, 403);
  const venue = await request("/api/venues", { method: "POST", cookie, body: { name: "Hosted venue" } }); assert.equal(venue.status, 201);
  assert.equal((await request("/api/venues", { cookie })).data.total, 1);
  await request("/api/auth/logout", { method: "POST", cookie, body: {} });
  assert.equal((await request("/api/auth/session", { cookie })).status, 401);
});
