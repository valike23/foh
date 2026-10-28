ALTER TABLE "Account" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX "Venue_tenantId_id_key" ON "Venue"("tenantId", "id");
CREATE TABLE "Storefront" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "venueId" TEXT, "eventId" TEXT, "vendorId" TEXT NOT NULL,
 "name" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft', "version" INTEGER NOT NULL DEFAULT 1,
 "prepStation" TEXT NOT NULL DEFAULT '', "manualConfirmation" BOOLEAN NOT NULL DEFAULT false, "fulfillment" TEXT NOT NULL,
 "sectionIds" TEXT[] NOT NULL, "commercialTerms" TEXT NOT NULL DEFAULT '', "notes" TEXT NOT NULL DEFAULT '',
 "qrToken" TEXT, "legacyStoreId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Storefront_scope_check" CHECK (("venueId" IS NOT NULL)::integer + ("eventId" IS NOT NULL)::integer = 1),
 CONSTRAINT "Storefront_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "Storefront_tenantId_venueId_fkey" FOREIGN KEY ("tenantId", "venueId") REFERENCES "Venue"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Storefront_tenantId_id_key" ON "Storefront"("tenantId", "id");
CREATE INDEX "Storefront_tenantId_venueId_idx" ON "Storefront"("tenantId", "venueId");
CREATE INDEX "Storefront_tenantId_eventId_idx" ON "Storefront"("tenantId", "eventId");
-- Preserve existing IDs so floor locations, orders and published snapshots remain linked.
INSERT INTO "Storefront" ("id", "tenantId", "venueId", "eventId", "vendorId", "name", "kind", "status", "version", "prepStation", "manualConfirmation", "fulfillment", "sectionIds", "commercialTerms", "notes", "qrToken", "legacyStoreId", "createdAt", "updatedAt")
SELECT "id", "tenantId", CASE WHEN data->>'scopeType' = 'venue' THEN data->>'scopeId' END, CASE WHEN data->>'scopeType' = 'event' THEN data->>'scopeId' END,
 data->>'vendorId', data->>'name', data->>'kind', data->>'status', "version", COALESCE(data->>'prepStation',''), COALESCE((data->>'manualConfirmation')::boolean,false), data->>'fulfillment',
 ARRAY(SELECT jsonb_array_elements_text(COALESCE(data->'sectionIds','[]'::jsonb))), COALESCE(data->>'commercialTerms',''), COALESCE(data->>'notes',''), data->>'qrToken', data->>'legacyStoreId', (data->>'createdAt')::timestamp, (data->>'updatedAt')::timestamp
FROM "WorkspaceRecord" WHERE kind = 'storefronts';
DELETE FROM "WorkspaceRecord" WHERE kind = 'storefronts';
CREATE TABLE "StaffAssignment" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "role" TEXT NOT NULL, "venueId" TEXT, "storefrontId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "StaffAssignment_scope_check" CHECK (("venueId" IS NOT NULL)::integer + ("storefrontId" IS NOT NULL)::integer = 1),
 CONSTRAINT "StaffAssignment_role_check" CHECK (("role" = 'venue-manager' AND "venueId" IS NOT NULL) OR ("role" IN ('storefront-manager','cashier','waiter','prep','runner') AND "storefrontId" IS NOT NULL) OR "role" = 'viewer'),
 CONSTRAINT "StaffAssignment_tenantId_accountId_fkey" FOREIGN KEY ("tenantId", "accountId") REFERENCES "Account"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "StaffAssignment_tenantId_venueId_fkey" FOREIGN KEY ("tenantId", "venueId") REFERENCES "Venue"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "StaffAssignment_tenantId_storefrontId_fkey" FOREIGN KEY ("tenantId", "storefrontId") REFERENCES "Storefront"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StaffAssignment_tenantId_accountId_idx" ON "StaffAssignment"("tenantId", "accountId");
CREATE UNIQUE INDEX "StaffAssignment_venue_role_key" ON "StaffAssignment"("tenantId", "accountId", "venueId", "role");
CREATE UNIQUE INDEX "StaffAssignment_storefront_role_key" ON "StaffAssignment"("tenantId", "accountId", "storefrontId", "role");
