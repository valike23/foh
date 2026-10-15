import type { DatabaseSync } from "node:sqlite";
import { createSeedSnapshot, type GuestBranding, type HubSnapshot, type ManagedEvent, type ManagedStorefront, type MenuItem } from "@exa-foh/shared";

export function ensureMenuPreviews(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS event_menu_previews (event_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, data TEXT NOT NULL)");
}

export function readMenuPreview(db: DatabaseSync, organizationId: string, eventId: string) {
  const row = db.prepare("SELECT token, data FROM event_menu_previews WHERE event_id = ? AND organization_id = ?").get(eventId, organizationId) as { token: string; data: string } | undefined;
  return row ? { token: row.token, items: JSON.parse(row.data) as MenuItem[] } : undefined;
}

export function menuPreviewSnapshot(event: ManagedEvent, stores: ManagedStorefront[], items: MenuItem[], branding: GuestBranding): HubSnapshot {
  const snapshot = createSeedSnapshot();
  for (const key of Object.keys(snapshot) as (keyof HubSnapshot)[]) if (key !== "event") (snapshot[key] as unknown[]) = [];
  snapshot.event = { id: event.id, name: event.name, venue: event.location, currency: "NGN", containerType: "event", status: "setup", reportingCadence: "event-closeout", defaultChargeRuleIds: [], guestBranding: branding,
    dateLabel: event.startsAt ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: event.timezone }).format(new Date(event.startsAt)) : "Date to be confirmed" };
  snapshot.stores = stores.map(s => ({ id: s.id, eventId: event.id, vendorId: s.vendorId, name: s.name, kind: s.kind, manualConfirmation: s.manualConfirmation }));
  snapshot.menuItems = items.filter(item => stores.some(store => store.id === item.storeId)).map(item => ({ id: item.id, storeId: item.storeId, name: item.name, category: item.category, menuSection: item.menuSection, description: item.description, price: item.price, imageId: item.imageId, stockItemId: item.stockItemId, available: item.available }));
  return snapshot;
}
