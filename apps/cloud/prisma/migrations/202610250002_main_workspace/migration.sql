-- Preserve existing tenant accounts and venues while adding main-app configuration.
ALTER TABLE "Venue"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "profile" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "activity" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "WorkspaceRecord" (
  "tenantId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "data" JSONB NOT NULL,
  CONSTRAINT "WorkspaceRecord_pkey" PRIMARY KEY ("tenantId", "kind", "id"),
  CONSTRAINT "WorkspaceRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
