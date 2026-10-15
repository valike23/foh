import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { verifyBusinessFlow } from "./business-browser-flow.mjs";
import { verifyServicePages } from "./service-pages-browser-flow.mjs";
import { verifyBrandingFlow } from "./branding-browser-flow.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const temp = mkdtempSync(join(tmpdir(), "exa-venue-ui-"));
const artifacts = join(temp, "screenshots"); mkdirSync(artifacts);
const db = join(temp, "hub.sqlite");
const nextEnvPath = resolve("apps/boh-dashboard/next-env.d.ts");
const tsconfigPath = resolve("apps/boh-dashboard/tsconfig.json");
const originalNextEnv = readFileSync(nextEnvPath, "utf8");
const originalTsconfig = readFileSync(tsconfigPath, "utf8");
const guestNextEnvPath = resolve("apps/guest-order/next-env.d.ts");
const guestTsconfigPath = resolve("apps/guest-order/tsconfig.json");
const originalGuestNextEnv = readFileSync(guestNextEnvPath, "utf8");
const originalGuestTsconfig = readFileSync(guestTsconfigPath, "utf8");
const children = [];
function start(args, env, cwd = process.cwd()) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  child.stdout.on("data", data => { logs += data.toString(); });
  child.stderr.on("data", data => { logs += data.toString(); });
  children.push(child);
  child.logs = () => logs;
  return child;
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(child.logs());
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not start: ${url}\n${child.logs()}`);
}
let browser;
try {
  const hub = start(["apps/hub/dist/server.js"], { HUB_DB_PATH: db, PORT: "4138", EXA_SETUP_KEY: "isolated-ui-setup-key" });
  await ready("http://127.0.0.1:4138/health", hub);
  const next = start([resolve("node_modules/next/dist/bin/next"), "dev", "--webpack", "-H", "0.0.0.0", "-p", "5188"], { HUB_INTERNAL_URL: "http://127.0.0.1:4138", NEXT_PUBLIC_GUEST_URL: "http://localhost:5189", EXA_NEXT_DIST_DIR: ".next-verify" }, resolve("apps/boh-dashboard"));
  await ready("http://localhost:5188/login", next);
  const guest = start([resolve("node_modules/next/dist/bin/next"), "dev", "--webpack", "-H", "127.0.0.1", "-p", "5189"], { HUB_INTERNAL_URL: "http://127.0.0.1:4138", NEXT_PUBLIC_HUB_URL: "http://127.0.0.1:4138", EXA_NEXT_DIST_DIR: ".next-verify" }, resolve("apps/guest-order"));
  await ready("http://localhost:5189", guest);
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto("http://localhost:5188/venues");
  await page.waitForURL("**/login?**");
  await page.getByLabel("Full name").fill("UI Test Owner");
  await page.getByLabel("Setup key").fill(readFileSync(`${db}.setup-key`, "utf8"));
  await page.getByLabel("Email", { exact: true }).fill("ui-owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("ui-test-password-1234");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/venues");
  await page.getByRole("link", { name: "New venue", exact: true }).click();
  await page.getByLabel("Venue name", { exact: true }).fill("Victoria Island Rooftop");
  await page.getByLabel("Street address").fill("14 Adeola Odeku Street");
  await page.getByLabel("City", { exact: true }).fill("Lagos");
  await page.getByLabel("Contact name").fill("Ada Okafor");
  await page.getByLabel("Guest capacity").fill("120");
  await page.getByRole("button", { name: "Create venue", exact: true }).click();
  await page.getByRole("heading", { name: "Victoria Island Rooftop" }).waitFor();
  const detailUrl = page.url().split("?")[0];
  await page.screenshot({ path: join(artifacts, "venue-desktop.png"), fullPage: true });
  await page.getByRole("link", { name: "Edit venue", exact: true }).click();
  await page.getByLabel("Phone number").fill("08012345678");
  await page.getByLabel("Monday opens").fill("17:00");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("08012345678", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page.getByText("Updated venue", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Opening hours", exact: true }).click();
  await page.getByText("17:00 - 02:00 (next day)", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await page.getByLabel("Reason", { exact: true }).fill("Ready for service");
  await page.getByRole("button", { name: "Confirm change" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByLabel("Reason", { exact: true }).fill("Temporary test closure");
  await page.getByRole("button", { name: "Confirm change" }).click();
  await page.getByRole("button", { name: "Restore to draft" }).waitFor();
  await page.getByRole("button", { name: "Restore to draft" }).click();
  await page.getByLabel("Reason", { exact: true }).fill("Continue test operation");
  await page.getByRole("button", { name: "Confirm change" }).click();
  await page.getByRole("button", { name: "Activate", exact: true }).waitFor();
  await verifyBusinessFlow(page, artifacts);
  await verifyServicePages(page, artifacts);
  await verifyBrandingFlow(page, artifacts);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://localhost:5188/venues");
  await page.getByLabel("Search venues").fill("Victoria");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL("**q=Victoria**");
  await page.getByRole("link", { name: "Victoria Island Rooftop", exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, "directory-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(detailUrl);
  await page.getByRole("heading", { name: "Victoria Island Rooftop" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "detail must not overflow mobile viewport");
  await page.screenshot({ path: join(artifacts, "venue-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Venues", exact: true }).first().click();
  await page.waitForURL("**/venues");
  await page.screenshot({ path: join(artifacts, "directory-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "directory must not overflow mobile viewport");
  await page.goto(`${detailUrl}/edit`);
  await page.getByLabel("Venue name", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "form must not overflow mobile viewport");
  await page.screenshot({ path: join(artifacts, "form-mobile.png"), fullPage: true });
  await page.goto(detailUrl);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL("**/login");
  await page.getByLabel("Email", { exact: true }).fill("ui-owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("ui-test-password-1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/venues");
  assert.deepEqual(errors, [], "browser should have no runtime errors");
  console.log(`PASS: setup, auth, directory, create/edit, hours, history, lifecycle, responsive layouts. Screenshots: ${artifacts}`);
} catch (error) {
  console.error(error);
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) console.error((await page.locator("body").innerText()).slice(0,4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null) { const stopped = once(child, "exit"); child.kill("SIGTERM"); await stopped; }
  }
  // Undo only Next's generated test-directory references, preserving other concurrent edits.
  const nextEnv = readFileSync(nextEnvPath, "utf8");
  if (nextEnv.replaceAll(".next-verify", ".next") === originalNextEnv) writeFileSync(nextEnvPath, originalNextEnv);
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
  tsconfig.include = tsconfig.include.filter(value => !value.startsWith(".next-verify/"));
  if (JSON.stringify(tsconfig) === JSON.stringify(JSON.parse(originalTsconfig))) writeFileSync(tsconfigPath, originalTsconfig);
  const guestNextEnv = readFileSync(guestNextEnvPath, "utf8");
  if (guestNextEnv.replaceAll(".next-verify", ".next") === originalGuestNextEnv) writeFileSync(guestNextEnvPath, originalGuestNextEnv);
  const guestTsconfig = JSON.parse(readFileSync(guestTsconfigPath, "utf8"));
  guestTsconfig.include = guestTsconfig.include.filter(value => !value.startsWith(".next-verify/"));
  if (JSON.stringify(guestTsconfig) === JSON.stringify(JSON.parse(originalGuestTsconfig))) writeFileSync(guestTsconfigPath, originalGuestTsconfig);
}
