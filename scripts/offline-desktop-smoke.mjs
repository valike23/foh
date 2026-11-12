import { _electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
await mkdir("test-results", { recursive: true });
const data = await mkdtemp(resolve("test-results/desktop-smoke-"));
const env = { ...process.env, OFFLINE_SMOKE_TEST: "1", OFFLINE_USER_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: resolve("apps/offline/release/win-unpacked/Pricemate Local Hub.exe"), env, timeout: 90000 });
try {
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Connect this venue", exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByLabel(/^Hub setup key/)).not.toHaveValue("");
  const response = await fetch("http://127.0.0.1:5381/health"); const health = await response.json();
  assert.equal(health.persistence, "sqlite"); assert.equal(health.configured, false);
  await page.screenshot({ path: join(data, "startup.png") });
  console.log("Packaged desktop startup passed: bundled server, SQLite, frontend, activation screen and automatic setup key.");
} finally { await app.close(); }
