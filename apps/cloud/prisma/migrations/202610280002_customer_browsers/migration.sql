CREATE TABLE "CustomerBrowser" (
 "tenantId" TEXT NOT NULL, "browserHash" TEXT NOT NULL, "customerId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CustomerBrowser_pkey" PRIMARY KEY ("tenantId", "browserHash"),
 CONSTRAINT "CustomerBrowser_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CustomerBrowser_tenantId_customerId_idx" ON "CustomerBrowser"("tenantId", "customerId");
