-- Optional branding: existing organizations retain the EXA defaults.
ALTER TABLE "Tenant"
  ADD COLUMN "brandColor" TEXT,
  ADD COLUMN "brandLogo" TEXT;
