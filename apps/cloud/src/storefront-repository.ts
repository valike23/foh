import { Prisma, type Storefront } from "@prisma/client";
import type { ManagedStorefront } from "@exa-foh/shared";

export function storefrontRecord(s: Storefront): ManagedStorefront {
  return { id: s.id, organizationId: s.tenantId, scopeType: s.venueId ? "venue" : "event", scopeId: (s.venueId ?? s.eventId)!, vendorId: s.vendorId, name: s.name, kind: s.kind as ManagedStorefront["kind"], status: s.status, version: s.version, prepStation: s.prepStation, manualConfirmation: s.manualConfirmation, fulfillment: s.fulfillment as ManagedStorefront["fulfillment"], sectionIds: s.sectionIds, commercialTerms: s.commercialTerms, notes: s.notes, qrToken: s.qrToken, ...(s.legacyStoreId ? { legacyStoreId: s.legacyStoreId } : {}), createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() };
}
export function storefrontData(s: ManagedStorefront): Prisma.StorefrontUncheckedCreateInput {
  return { id: s.id, tenantId: s.organizationId, venueId: s.scopeType === "venue" ? s.scopeId : null, eventId: s.scopeType === "event" ? s.scopeId : null, vendorId: s.vendorId, name: s.name, kind: s.kind, status: s.status, version: s.version, prepStation: s.prepStation, manualConfirmation: s.manualConfirmation, fulfillment: s.fulfillment, sectionIds: s.sectionIds, commercialTerms: s.commercialTerms, notes: s.notes, qrToken: s.qrToken, legacyStoreId: s.legacyStoreId ?? null, createdAt: s.createdAt, updatedAt: s.updatedAt };
}
