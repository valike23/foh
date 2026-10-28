import test from "node:test";
import assert from "node:assert/strict";
import { managementApi, ApiError } from "../apps/boh-dashboard/src/lib/management-api.ts";

test("API authentication failures preserve return URLs without redirecting login errors or forbidden actions", async () => {
  const originalFetch = globalThis.fetch; const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const redirects = []; const location = { pathname: "/login", search: "", replace: url => redirects.push(url) };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location } });
  try {
    globalThis.fetch = async () => Response.json({ error: "Incorrect password" }, { status: 401 });
    await assert.rejects(managementApi("/auth/login"), e => e instanceof ApiError && e.status === 401 && e.message === "Incorrect password");
    await assert.rejects(managementApi("/auth/session"));
    assert.deepEqual(redirects, [], "The login form must retain its errors");
    location.pathname = "/signup"; await assert.rejects(managementApi("/auth/signup")); assert.equal(redirects.length, 0);
    location.pathname = "/payments"; location.search = "?operation=venue-123&order=sale-456";
    globalThis.fetch = async () => Response.json({ error: "Access denied" }, { status: 403 });
    await assert.rejects(managementApi("/service/venue-123/api/payments"), e => e instanceof ApiError && e.status === 403);
    assert.equal(redirects.length, 0, "A forbidden action must not sign the user out");
    globalThis.fetch = async () => new Response("Session expired", { status: 401 });
    await Promise.all([assert.rejects(managementApi("/service/venue-123/api/snapshot"), e => e instanceof ApiError && e.status === 401), assert.rejects(managementApi("/operations"))]);
    assert.deepEqual(redirects, ["/login?next=%2Fpayments%3Foperation%3Dvenue-123%26order%3Dsale-456"], "Concurrent failures should trigger only one redirect, even for a non-JSON response");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else delete globalThis.window;
  }
});

test("actionable API errors retain local recovery links and reject unsafe destinations", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: "Pause service first", action: { label: "Manage this operation", href: "/operations?operation=venue-123" } }, { status: 409 });
    await assert.rejects(managementApi("/floor"), e => e instanceof ApiError && e.status === 409 && e.action.href === "/operations?operation=venue-123");
    for (const href of ["javascript:alert(1)", "//evil.example/operations", "https://evil.example/operations"]) {
      globalThis.fetch = async () => Response.json({ error: "Blocked", action: { label: "Fix", href } }, { status: 409 });
      await assert.rejects(managementApi("/floor"), e => e instanceof ApiError && e.action === undefined);
    }
  } finally { globalThis.fetch = originalFetch; }
});
