import { z } from "zod";
const text = z.string().trim(); const name = text.min(2).max(100);
const timezone = text.refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "Invalid timezone");
const clock = text.regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const scope = { scopeType: z.enum(["venue", "event"]), scopeId: text.min(1) };
export const venueSchema = z.object({ name, address: text.max(240), city: text.max(100), timezone, businessDayCutoff: clock, contactName: text.max(100), email: z.union([z.literal(""), text.email()]), phone: text.max(40), capacity: z.number().int().min(1).max(1_000_000).nullable(), notes: text.max(2000), hours: z.array(z.object({ day: text, closed: z.boolean(), opens: clock, closes: clock })).length(7).refine(v => new Set(v.map(d => d.day)).size === 7) }).strict();
export const businessSchemas = {
  events: z.object({ name, venueId: text.min(1).nullable(), location: text.max(240), timezone, startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), organizer: text.max(100), notes: text.max(2000) }).strict(),
  vendors: z.object({ name, kind: z.enum(["internal", "external"]), contactName: text.max(100), email: z.union([z.literal(""), text.email()]), phone: text.max(40), notes: text.max(2000) }).strict(),
  storefronts: z.object({ name, ...scope, vendorId: text.min(1), kind: z.enum(["bar", "kitchen", "bottle-service", "merch"]), prepStation: text.max(100), manualConfirmation: z.boolean(), fulfillment: z.enum(["pickup", "table", "seat"]), sectionIds: z.array(text.min(1)).max(100), commercialTerms: text.max(2000), notes: text.max(2000) }).strict(),
  floor: z.object({ name, ...scope, kind: z.enum(["section", "table", "seat"]), parentId: text.min(1).nullable(), storefrontId: text.min(1).nullable(), capacity: z.number().int().min(1).max(100000) }).strict()
};
