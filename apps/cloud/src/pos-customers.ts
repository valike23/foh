import type { Prisma } from "@prisma/client";
import { linkGuestCustomer } from "./customer-records.js";
import { WorkspaceError } from "./workspace-access.js";
export async function linkPosCustomer(tx: Prisma.TransactionClient, tenantId: string, input: { customerId?: string; customerName?: string; customerPhone?: string; customerEmail?: string }) {
  if (input.customerId) {
    const customer = await tx.customer.findFirst({ where: { tenantId, id: input.customerId } });
    if (!customer) throw new WorkspaceError(422, "Select an existing customer or clear the selection.");
    return customer;
  }
  if (!input.customerName && !input.customerPhone && !input.customerEmail) return null;
  if (input.customerPhone || input.customerEmail) {
    const result = await linkGuestCustomer(tx, tenantId, { ...input, customerName: input.customerName ?? "" });
    if (!result.customerId) throw new WorkspaceError(409, "These contact details belong to different customers. Select the correct customer.");
    return tx.customer.findFirst({ where: { tenantId, id: result.customerId } });
  }
  return tx.customer.create({ data: { tenantId, name: input.customerName } });
}
