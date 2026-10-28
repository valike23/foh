import test from "node:test";
import assert from "node:assert/strict";
import { guestBrowserId } from "../apps/boh-dashboard/src/lib/guest-browser.ts";

test("guest identity survives repeated calls and falls back when browser storage is blocked", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const id = "ae3bc203-6d49-4aae-bda1-9b7fa6a89e75"; const local = new Map(); const session = new Map();
  const store = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) });
  const win = { crypto: { randomUUID: () => id }, localStorage: store(local), sessionStorage: store(session) };
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  try {
    assert.equal(guestBrowserId(), id); assert.equal(guestBrowserId(), id); assert.equal(local.get("exa-guest-browser-id"), id);
    Object.defineProperty(win, "localStorage", { configurable: true, get() { throw new Error("Storage blocked"); } });
    assert.equal(guestBrowserId(), id); assert.equal(session.get("exa-guest-browser-id"), id);
    Object.defineProperty(win, "sessionStorage", { configurable: true, get() { throw new Error("Storage blocked"); } });
    assert.equal(guestBrowserId(), id, "in-memory fallback keeps checkout working");
    assert.equal(guestBrowserId(), id);
  } finally { if (original) Object.defineProperty(globalThis, "window", original); else delete globalThis.window; }
});
