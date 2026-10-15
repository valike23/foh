import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { defaultGuestBranding } from "../packages/shared/dist/index.js";
import { ensureMenuPreviews } from "../apps/hub/dist/menu-preview.js";

const db = new DatabaseSync(process.env.HUB_DB_PATH ?? "apps/hub/data/hub.sqlite");
const organizationId = process.env.EXA_ORGANIZATION_ID ?? "org-exa-demo";
const eventId = "event-dine-at-night";
ensureMenuPreviews(db);
const existing = db.prepare("SELECT data FROM business_records WHERE kind = 'events' AND id = ?").get(eventId);
if (existing) {
  const preview = db.prepare("SELECT token FROM event_menu_previews WHERE event_id = ?").get(eventId);
  console.log(`Dine at Night already exists. No records changed. Preview: http://localhost:5174/preview/${preview?.token ?? ""}`);
  db.close();
} else {
  const now = new Date().toISOString();
  const base = (id, name, status = "draft") => ({ id, name, status, organizationId, version: 1, createdAt: now, updatedAt: now });
  const event = { ...base(eventId, "Dine at Night"), venueId: null, location: "Lagos, Nigeria", timezone: "Africa/Lagos",
    startsAt: "2026-12-17T00:00:00+01:00", endsAt: "2026-12-18T00:00:00+01:00", organizer: "Dine at Night",
    notes: "Date and city confirmed by owner: 17 December 2026, Lagos. All-day planning placeholder; exact service hours and venue remain unconfirmed. Draft menus and prices transcribed from supplied historical references, not confirmed for the 2026 edition. Photos and banner are AI-generated mock assets. Confirm vendor participation, menu, add-ons, tax and stock before opening. No sponsors confirmed." };
  const vendors = [
    { ...base("vendor-dan-aep", "An Eaters Playground", "active"), kind: "external", contactName: "", email: "", phone: "", notes: "Reference menu: @aneatersplayground. 2026 participation unconfirmed." },
    { ...base("vendor-dan-chu", "Chu Chu Churro Bar", "active"), kind: "external", contactName: "", email: "", phone: "", notes: "Reference menu: @chuchuchurro.bar. 2026 participation unconfirmed." }
  ];
  const stores = vendors.map((vendor, index) => ({ ...base(index ? "store-dan-chu" : "store-dan-aep", vendor.name, "active"), scopeType: "event", scopeId: eventId, vendorId: vendor.id, kind: "kitchen", prepStation: vendor.name, manualConfirmation: true, fulfillment: "pickup", sectionIds: [], commercialTerms: "", notes: "Reference menu draft. Confirm allocation before service.", qrToken: randomBytes(24).toString("hex") }));
  const product = (slug, name, price, menuSection, description, storeId = stores[0].id, image = slug) => ({ id: `item-dan-${slug}`, storeId, name, price, menuSection, description, category: "Food", available: true, stockItemId: `stock-dan-${slug}`, imageId: `dan-${image}-v1` });
  const items = [
    product("cookies-cream-cake", "Cookies & Cream Salted Caramel Cake Slice", 7000, "Cake slices", "Cookies & cream with salted caramel."),
    product("cinnamon-cake", "Cinnamon Crunch Brown Sugar Cake Slice", 7000, "Cake slices", "Brown sugar cake with a cinnamon crunch."),
    product("cinnamon-roll", "Cinnamon Rolls", 5000, "Bakery", "A cinnamon favourite."),
    product("brownie", "AEP's Fudgey Brownies", 4540, "Chocolate", "Reference add-on: ice cream scoop, NGN 2,500 (limited availability)."),
    product("cookie", "Toffee Crisp Mixed Chocolate Chunk", 4000, "Cookies", "Toffee crisp and mixed chocolate chunks."),
    product("crumble", "AEP's Holiday Crumble Station", 8500, "Warm desserts", "Spiced apple crumble with creme anglaise. Reference add-on: any two toppings, NGN 500."),
    product("chu-xl", "Chu Chu XL", 6500, "Churros", "Golden, crisp. Comes with one dip. Dip options to be confirmed.", stores[1].id, "churros"),
    product("chu-classic", "The Classic", 7500, "Churros", "Simple, golden. Comes with one dip. Reference extras: chocolate / condensed milk NGN 1,200; dulce de leche NGN 1,500; extra sugar NGN 500.", stores[1].id, "churros")
  ];
  const headerId = randomUUID();
  const branding = { ...defaultGuestBranding(), theme: "night-market", socialUrl: "https://www.instagram.com/dineatnight.ng/", backgroundColor: "#000000", surfaceColor: "#050805", accentColor: "#24bf79", headerImageId: headerId };
  const token = randomBytes(24).toString("hex");
  const asset = file => readFileSync(new URL(`../apps/hub/assets/dine-at-night/${file}.webp`, import.meta.url));
  db.exec("BEGIN IMMEDIATE");
  try {
    const insert = db.prepare("INSERT INTO business_records VALUES (?, ?, ?, ?)");
    insert.run(event.id, "events", organizationId, JSON.stringify(event));
    vendors.forEach(record => insert.run(record.id, "vendors", organizationId, JSON.stringify(record)));
    stores.forEach(record => insert.run(record.id, "storefronts", organizationId, JSON.stringify(record)));
    db.prepare("INSERT INTO guest_branding_assets VALUES (?, ?, ?, ?, ?, ?, ?)").run(headerId, organizationId, eventId, "image", "image/webp", "Dine at Night draft banner.webp", asset("header"));
    db.prepare("INSERT INTO guest_branding VALUES (?, ?, ?, ?)").run(eventId, organizationId, 1, JSON.stringify(branding));
    for (const slug of ["cookies-cream-cake", "cinnamon-cake", "cinnamon-roll", "brownie", "cookie", "crumble", "churros"]) db.prepare("INSERT INTO menu_images VALUES (?, ?, ?)").run(`dan-${slug}-v1`, eventId, asset(slug));
    db.prepare("INSERT INTO event_menu_previews VALUES (?, ?, ?, ?)").run(eventId, organizationId, token, JSON.stringify(items));
    const activity = { id: randomUUID(), actor: "Local setup", action: "Created Dine at Night draft and reference menu preview at owner's request", createdAt: now };
    db.prepare("INSERT INTO business_activity VALUES (?, ?, ?, ?)").run(activity.id, eventId, "events", JSON.stringify(activity));
    db.exec("COMMIT");
    console.log(`Created Dine at Night: 17 December 2026, Lagos (draft).\nManagement: http://localhost:5173/events/${eventId}?tab=appearance\nPreview: http://localhost:5174/preview/${token}`);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}
