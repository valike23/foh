import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest } from "next/server.js";

const source = new URL("../apps/boh-dashboard/src/app/api/manage/[...path]/route.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const exports = {};
let upstream = {};
let upstreamStatus = 200;
let forwardedAuthorization;
vm.runInNewContext(compiled, {
  exports, require: createRequire(source), process, URL, AbortSignal,
  fetch: async (_url, options) => {
    forwardedAuthorization = options.headers.Authorization;
    return Response.json(upstream, { status: upstreamStatus });
  }
});

async function request(path, method = "GET", cookie = "existing-session") {
  return exports[method](new NextRequest(`http://localhost:5173/api/manage/${path}`, {
    method,
    headers: { host: "localhost:5173", origin: "http://localhost:5173", "content-type": "application/json", cookie: `exa-management-session=${cookie}` },
    ...(method === "POST" ? { body: "{}" } : {})
  }), { params: Promise.resolve({ path: path.split("/") }) });
}

for (const action of ["login", "setup"]) {
  upstream = { token: "new-session", user: { name: "Test owner" } };
  const response = await request(`auth/${action}`, "POST");
  assert.equal(response.cookies.get("exa-management-session")?.value, "new-session");
  assert.equal((await response.json()).token, undefined, "session secrets must not reach client JavaScript");
}
upstream = { token: "public-menu-preview" };
const preview = await request("events/event-dine-at-night/menu-preview");
assert.equal((await preview.json()).token, "public-menu-preview");
assert.equal(preview.headers.get("set-cookie"), null, "preview must not replace the session");
assert.equal(forwardedAuthorization, "Bearer existing-session");
upstream = { user: { name: "Test owner" } };
const me = await request("auth/me");
assert.equal(me.status, 200);
assert.equal(forwardedAuthorization, "Bearer existing-session");
upstreamStatus = 401;
upstream = { error: "Email or password is incorrect" };
const rejected = await request("auth/login", "POST");
assert.equal(rejected.status, 401);
assert.equal(rejected.cookies.get("exa-management-session")?.value, "");
console.log("PASS: login/setup sessions, preview token isolation, authenticated follow-up, rejected login.");
