import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

type Contact = { customerName: string; customerPhone?: string; customerEmail?: string; guestId?: string };
export async function linkGuestCustomer(tx: Prisma.TransactionClient, tenantId: string, input: Contact): Promise<{ customerId?: string; customerLinkStatus: "created" | "matched" | "anonymous" | "conflict" }> {
  const phone = input.customerPhone; const email = input.customerEmail;
  const browserHash = input.guestId ? createHash("sha256").update(`${tenantId}\0${input.guestId}`).digest("hex") : undefined;
  if (!phone && !email && !browserHash) return { customerLinkStatus: "anonymous" };
  // Serialize matching contacts, including submissions to different storefronts,
  // so simultaneous orders cannot create duplicate customer profiles.
  const keys = [phone && `phone:${phone}`, email && `email:${email}`, browserHash && `browser:${browserHash}`].filter((v): v is string => !!v).sort();
  for (const key of keys) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${key}))::text`;
  const browser = browserHash ? await tx.customerBrowser.findUnique({ where: { tenantId_browserHash: { tenantId, browserHash } }, include: { customer: true } }) : null;
  const matches = phone || email ? await tx.customer.findMany({ where: { tenantId, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] } }) : [];
  if (matches.length > 1) return { customerLinkStatus: "conflict" };
  if (browser && matches.some(c => c.id !== browser.customerId)) return { customerLinkStatus: "conflict" };
  const current = browser?.customer ?? matches[0];
  if (current) {
    if ((phone && current.phone && current.phone !== phone) || (email && current.email && current.email !== email)) return { customerLinkStatus: "conflict" };
    // Keep established profile values. Historical order snapshots never change.
    if ((!current.phone && phone) || (!current.email && email) || (!current.name && input.customerName)) await tx.customer.update({ where: { id: current.id }, data: { ...(!current.phone && phone ? { phone } : {}), ...(!current.email && email ? { email } : {}), ...(!current.name && input.customerName ? { name: input.customerName } : {}) } });
    if (browserHash) await tx.customerBrowser.upsert({ where: { tenantId_browserHash: { tenantId, browserHash } }, create: { tenantId, browserHash, customerId: current.id }, update: { lastSeenAt: new Date() } });
    return { customerId: current.id, customerLinkStatus: "matched" };
  }
  const saved = await tx.customer.create({ data: { tenantId, name: input.customerName || null, phone: phone ?? null, email: email ?? null } });
  if (browserHash) await tx.customerBrowser.create({ data: { tenantId, browserHash, customerId: saved.id } });
  return { customerId: saved.id, customerLinkStatus: "created" };
}
