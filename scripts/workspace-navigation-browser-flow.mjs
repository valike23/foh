import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
config({ path: "apps/cloud/.env", quiet: true });
const db = new PrismaClient(), slugs = [];
const origin = process.env.BROWSER_APP_ORIGIN ?? "http://app.localhost:5173";
const browser = await chromium.launch({ headless: true });
try {
  for (const [choice, visible, hidden] of [
    ["A physical location", ["Venues", "Sections"], ["Events", "Vendors", "Storefronts"]],
    ["An event I organise", ["Events", "Vendors", "Storefronts", "Sections"], ["Venues"]],
    ["My business at an event", ["Events", "Storefronts", "Sections"], ["Venues", "Vendors"]],
  ]) {
    const slug = `nav-${randomUUID().slice(0, 8)}`; slugs.push(slug);
    const context = await browser.newContext(), page = await context.newPage();
    page.setDefaultTimeout(30_000);
    try {
      await page.goto(`${origin}/signup`);
      const result = await page.evaluate(async slug => {
        const response = await fetch("/api/manage/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, name: "Navigation Owner", organizationName: "Navigation test", email: "owner@example.test", password: "navigation-test-password" }) });
        if (!response.ok) throw new Error(await response.text()); return response.json();
      }, slug);
      const tenantOrigin = origin.replace("app.localhost", `${slug}.localhost`);
      await page.goto(`${tenantOrigin}/login`);
      await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
      await page.getByLabel("Password", { exact: true }).fill("navigation-test-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL("**/dashboard"); await page.getByRole("button", { name: "Continue onboarding", exact: true }).click(); await expect(page.getByRole("dialog", { name: "Business onboarding", exact: true })).toBeVisible();
      await page.getByRole("button", { name: new RegExp(choice) }).click();
      await page.getByRole("button", { name: "Save & finish later", exact: true }).click();
      await page.waitForURL("**/dashboard");
      const navigation = page.getByRole("navigation", { name: "Main navigation", exact: true });
      for (const name of visible) await expect(navigation.getByRole("link", { name, exact: true })).toBeVisible();
      for (const name of [...hidden, "Floor & QR", "Floor control"]) await expect(navigation.getByRole("link", { name, exact: true })).toHaveCount(0);
      await navigation.getByRole("link", { name: "Sections", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Sections", exact: true })).toBeVisible();
      await page.reload();
      for (const name of hidden) await expect(navigation.getByRole("link", { name, exact: true })).toHaveCount(0);
      await expect(navigation.getByRole("link", { name: /onboarding|setup/i })).toHaveCount(0);
      const target = choice === "A physical location" ? "Events" : "Physical locations";
      const enter = page.getByRole("button", { name: `Enter ${target}`, exact: true });
      await expect(enter).toBeHidden();
      await page.getByText("Switch workspace", { exact: true }).click();
      await enter.click();
      await expect(page.getByRole("status", { name: "Switching workspace", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: `Entering ${target}`, exact: true })).toBeVisible();
      await page.waitForURL("**/dashboard");
      await expect(page.getByRole("status", { name: "Switching workspace", exact: true })).toHaveCount(0);
      const targetLink = target === "Events" ? "Events" : "Venues";
      await expect(navigation.getByRole("link", { name: targetLink, exact: true })).toBeVisible();
      await expect(navigation.getByRole("link", { name: target === "Events" ? "Venues" : "Events", exact: true })).toHaveCount(0);
      await page.reload();
      await expect(navigation.getByRole("link", { name: targetLink, exact: true })).toBeVisible();
      await expect(page.getByLabel("Workspace view", { exact: true })).toHaveCount(0);
    } finally { await context.close(); }
  }
  console.log("All three workspace flows show relevant sidebar links and the Sections screen; choices persist after reload.");
} finally { await browser.close(); await db.tenant.deleteMany({ where: { slug: { in: slugs } } }); await db.$disconnect(); }
