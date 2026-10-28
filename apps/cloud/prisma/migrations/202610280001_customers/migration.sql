CREATE TABLE "Customer" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT, "phone" TEXT, "email" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Customer_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Customer_tenantId_id_key" ON "Customer"("tenantId", "id");
CREATE UNIQUE INDEX "Customer_tenantId_phone_key" ON "Customer"("tenantId", "phone");
CREATE UNIQUE INDEX "Customer_tenantId_email_key" ON "Customer"("tenantId", "email");
CREATE TABLE "CustomerOrder" (
 "tenantId" TEXT NOT NULL, "orderId" TEXT NOT NULL, "customerId" TEXT NOT NULL, "storefrontId" TEXT NOT NULL,
 "operationId" TEXT NOT NULL, "runtimeKind" TEXT NOT NULL DEFAULT 'runtime', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("tenantId", "orderId"),
 CONSTRAINT "CustomerOrder_runtimeKind_check" CHECK ("runtimeKind" = 'runtime'),
 CONSTRAINT "CustomerOrder_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "CustomerOrder_tenantId_storefrontId_fkey" FOREIGN KEY ("tenantId", "storefrontId") REFERENCES "Storefront"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "CustomerOrder_tenantId_runtimeKind_operationId_fkey" FOREIGN KEY ("tenantId", "runtimeKind", "operationId") REFERENCES "WorkspaceRecord"("tenantId", "kind", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CustomerOrder_tenantId_customerId_createdAt_idx" ON "CustomerOrder"("tenantId", "customerId", "createdAt");
