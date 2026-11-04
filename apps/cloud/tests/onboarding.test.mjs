import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createOnlineApp } from "../dist/online-app.js";
import { fetchWithHost as fetch } from "./http-helper.mjs";

test("guided setup saves partial answers, resumes, and creates tenant-scoped records exactly once", { skip: !process.env.DATABASE_URL }, async t => {
  const db = new PrismaClient(), slugs = [];
  const server = createOnlineApp(db, { baseDomain: "localhost", publicOrigin: "http://app.localhost:4200" }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.tenant.deleteMany({ where: { slug: { in: slugs } } }); await db.$disconnect(); });
  async function request(host, path, method = "GET", body, cookie) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { host, origin: `http://${host}`, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  for (const mode of ["location", "organiser", "vendor"]) {
    const slug = `setup-${randomUUID().slice(0, 8)}`; slugs.push(slug);
    const credentials = { email: "owner@example.test", password: "onboarding-test-password" };
    assert.equal((await request("app.localhost:4200", "/auth/signup", "POST", { ...credentials, slug, name: "Setup Owner", organizationName: "Setup Business" })).status, 201);
    const host = `${slug}.localhost:4200`, login = await request(host, "/auth/login", "POST", credentials), cookie = login.cookie;
    assert.equal((await request(host, "/onboarding")).status, 401);
    assert.equal((await request(host, "/preferences", "PATCH", { navigationView: "events" })).status, 401);
    assert.equal((await request(host, "/preferences", "PATCH", { navigationView: "invalid" }, cookie)).status, 422);
    assert.equal((await request(host, "/preferences", "PATCH", { navigationView: "both" }, cookie)).status, 422);
    assert.equal((await request(host, "/preferences", "PATCH", { navigationView: "events" }, cookie)).status, 200);
    assert.equal((await request(host, "/auth/session", "GET", undefined, cookie)).data.navigationView, "events");
    const start = (await request(host, "/onboarding", "GET", undefined, cookie)).data;
    assert.equal(start.required, true); assert.equal(start.version, 1);
    // Empty names are valid drafts, even though they cannot be used to create records.
    const answers = { ...start.answers, mode, sections: [{ name: "", tables: 0 }] };
    const pause = await request(host, "/onboarding", "PATCH", { version: 1, step: 2, answers, paused: true }, cookie);
    assert.equal(pause.status, 200); assert.equal(pause.data.required, false);
    assert.equal((await request(host, "/auth/session", "GET", undefined, cookie)).data.workspaceMode, mode);
    const resumed = (await request(host, "/onboarding", "GET", undefined, cookie)).data;
    assert.equal(resumed.step, 2); assert.deepEqual(resumed.answers.sections, [{ name: "", tables: 0 }]);
    assert.equal((await request(host, "/onboarding", "PATCH", { version: 1, step: 0, answers }, cookie)).status, 409);
    assert.equal((await request(host, "/onboarding/complete", "POST", { version: resumed.version }, cookie)).status, 422);
    const completeAnswers = { ...answers, name: `First ${mode}`, address: "Lagos", startsAt: "2027-01-01T10:00:00.000Z", endsAt: "2027-01-01T20:00:00.000Z", sections: mode === "organiser" ? [] : [{ name: "Terrace", tables: 3 }, { name: "Lounge", tables: 0 }], storefronts: mode === "vendor" ? ["Food stand", "Drinks stand"] : [] };
    const saved = await request(host, "/onboarding", "PATCH", { version: resumed.version, step: 3, answers: completeAnswers }, cookie); assert.equal(saved.status, 200);
    const results = await Promise.all([1, 2].map(() => request(host, "/onboarding/complete", "POST", { version: saved.data.version }, cookie)));
    assert.equal(results[0].status, 200, JSON.stringify(results[0])); assert.equal(results[1].status, 200);
    assert.equal(results[0].data.scopeId, results[1].data.scopeId);
    const tenant = await db.tenant.findUnique({ where: { slug } }), tenantId = tenant.id;
    assert.equal(await db.venue.count({ where: { tenantId } }), mode === "location" ? 1 : 0);
    const events = await db.workspaceRecord.findMany({ where: { tenantId, kind: "events" } });
    assert.equal(events.length, mode === "location" ? 0 : 1);
    if (mode === "vendor") assert.equal(events[0].data.participation, "private-vendor");
    assert.equal(await db.storefront.count({ where: { tenantId } }), mode === "vendor" ? 2 : mode === "location" ? 1 : 0);
    assert.equal(await db.workspaceRecord.count({ where: { tenantId, kind: "floor" } }), mode === "organiser" ? 0 : 5);
    assert.equal(await db.workspaceRecord.count({ where: { tenantId, kind: "runtime" } }), 0, "onboarding never opens or publishes service");
    assert.equal((await request(host, "/onboarding", "PATCH", { version: results[0].data.version, step: 1, answers: completeAnswers }, cookie)).status, 409);
    const staff = await db.account.create({ data: { tenantId, name: "Staff", email: "staff@example.test", role: "staff", passwordHash: (await db.account.findFirst({ where: { tenantId } })).passwordHash, salt: (await db.account.findFirst({ where: { tenantId } })).salt } });
    const staffLogin = await request(host, "/auth/login", "POST", { ...credentials, email: staff.email });
    assert.equal((await request(host, "/auth/session", "GET", undefined, staffLogin.cookie)).data.workspaceMode, mode, "staff receive only the workspace mode, not private onboarding answers");
    assert.equal((await request(host, "/auth/session", "GET", undefined, staffLogin.cookie)).data.navigationView, null, "each account has its own navigation preference");
    assert.equal((await request(host, "/onboarding", "GET", undefined, staffLogin.cookie)).status, 403);
    assert.equal((await request(`${slugs[0]}.localhost:4200`, "/onboarding", "GET", undefined, cookie)).status, mode === "location" ? 200 : 401);
  }
});
