import { Router, type Request, type Response, type NextFunction } from "express";
import { Prisma, type PrismaClient, type Tenant } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { calculateOrderTotals, type HubSnapshot, type Order } from "@exa-foh/shared";
import { WorkspaceError } from "./workspace-access.js";
import { linkGuestCustomer } from "./customer-records.js";
function fail(status: number, message: string): never { throw new WorkspaceError(status, message); }
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const blankToUndefined = (value: unknown) => typeof value === "string" && !value.trim() ? undefined : value;
const optionalPhone = z.preprocess(blankToUndefined, z.string().trim().max(40).regex(/^\+?[0-9\s().-]+$/, "Enter a valid phone number, or leave it blank.").refine(v => { const digits = v.replace(/\D/g, ""); return digits.length >= 7 && digits.length <= 15; }, "Use a phone number with 7–15 digits, or leave it blank.").transform(v => v.replace(/[\s().-]/g, "")).optional());
const optionalEmail = z.preprocess(blankToUndefined, z.string().trim().max(254).email("Enter a valid email address, or leave it blank.").transform(v => v.toLowerCase()).optional());
const inputSchema = z.object({ requestId: z.string().uuid(), guestId: z.string().uuid().optional(), customerName: z.string().trim().max(100), customerPhone: optionalPhone, customerEmail: optionalEmail, expectedTotal: z.number().nonnegative().max(1e12), tableId: z.string().min(1).optional(), seatId: z.string().min(1).optional(), lines: z.array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(50) }).strict();
const receipt = (o: Order) => ({ id: o.id, status: o.status, total: o.totals.total, balanceDue: o.totals.balanceDue, lines: o.lines.map(l => ({ name: l.name, quantity: l.quantity, amount: l.quantity * l.unitPrice })), payment: "pay-at-counter" });

export function createGuestApi(db: PrismaClient, tenant: (res: Response) => Promise<Tenant>) {
  const router = Router();
  const run = (fn: (req: Request, res: Response, t: Tenant) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void tenant(res).then(t => fn(req, res, t)).catch(next); };
  async function source(tenantId: string, id: string) {
    const store = await db.storefront.findFirst({ where: { tenantId, id, status: "active" } });
    if (!store) fail(404, "This menu is unavailable. Ask the venue for a current menu link.");
    const runtime = await db.workspaceRecord.findUnique({ where: { tenantId_kind_id: { tenantId, kind: "runtime", id: (store.venueId ?? store.eventId)! } } });
    if (!runtime) fail(404, "This menu has not been published yet.");
    const s = runtime.data as unknown as HubSnapshot;
    const published = s.stores.find(v => v.id === store.id);
    if (!published) fail(404, "This storefront is not available in the published menu.");
    return { runtime, s, store: published };
  }
  router.get("/storefronts/:id", run(async (req, res, t) => {
    const { s, store } = await source(t.id, String(req.params.id));
    const tables = s.tables.filter(v => v.storeId === store.id);
    res.json({ business: { name: t.name, brandColor: t.brandColor, brandLogo: t.brandLogo }, storefront: { id: store.id, name: store.name, fulfillment: store.fulfillment, manualConfirmation: store.manualConfirmation }, service: { name: s.event.name, status: s.event.status }, items: s.menuItems.filter(v => v.storeId === store.id).map(v => {
      const stock = s.inventory.find(i => i.id === v.stockItemId); const maxQuantity = Math.min(100, stock?.quantity ?? 0);
      return { id: v.id, name: v.name, description: v.description ?? "", category: v.menuSection ?? v.category, price: v.price, available: v.available && maxQuantity > 0, maxQuantity };
    }), tables: tables.map(v => ({ id: v.id, label: v.label })), seats: s.seats.filter(v => tables.some(t => t.id === v.tableId)).map(v => ({ id: v.id, tableId: v.tableId, label: v.label })), chargeRules: s.chargeRules });
  }));
  // Bounded protection for unauthenticated order submission; deployments can add edge rate limits.
  let count = 0; let start = Date.now();
  router.post("/storefronts/:id/orders", (req, res, next) => {
    if (Date.now() - start > 60_000) { start = Date.now(); count = 0; }
    if (++count > 120) { res.status(429).json({ error: "Too many orders. Please try again shortly." }); return; } next();
  }, run(async (req, res, t) => {
    const input = inputSchema.parse(req.body); const storeId = String(req.params.id);
    const { runtime } = await source(t.id, storeId);
    const hash = createHash("sha256").update(JSON.stringify({ ...input, storeId })).digest("hex");
    try {
      const result = await db.$transaction(async tx => {
        const current = await tx.workspaceRecord.findUniqueOrThrow({ where: { tenantId_kind_id: { tenantId: t.id, kind: "runtime", id: runtime.id } } });
        const s = current.data as unknown as HubSnapshot;
        const previous = await tx.workspaceRecord.findUnique({ where: { tenantId_kind_id: { tenantId: t.id, kind: "guest-request", id: input.requestId } } });
        if (previous) {
          const data = previous.data as { hash: string; orderId: string };
          if (data.hash !== hash) fail(409, "This request was already used for a different order.");
          return receipt(s.orders.find(o => o.id === data.orderId) ?? fail(409, "Please ask the venue to check your previous order."));
        }
        if (s.event.status !== "live") fail(409, "Ordering is paused or service has not opened. Please ask a member of staff.");
        const store = s.stores.find(v => v.id === storeId) ?? fail(404, "Storefront unavailable");
        if (input.tableId && !s.tables.some(v => v.id === input.tableId && v.storeId === storeId)) fail(422, "Choose a table at this storefront.");
        if (store.fulfillment !== "pickup" && !input.tableId) fail(422, "Choose your table before ordering.");
        if (input.seatId && !s.seats.some(v => v.id === input.seatId && v.tableId === input.tableId)) fail(422, "Choose a seat at your table.");
        if (store.fulfillment === "seat" && !input.seatId) fail(422, "Choose your seat before ordering.");
        const requested = new Map<string, number>();
        const lines = input.lines.map(line => {
          const item = s.menuItems.find(v => v.id === line.menuItemId && v.storeId === storeId && v.available) ?? fail(409, "An item is no longer available. Refresh the menu.");
          const quantity = (requested.get(item.stockItemId) ?? 0) + line.quantity; requested.set(item.stockItemId, quantity);
          if (quantity > 100 || (s.inventory.find(v => v.id === item.stockItemId)?.quantity ?? 0) < quantity) fail(409, `Not enough ${item.name} remains. Update your order.`);
          return { id: randomUUID(), menuItemId: item.id, name: item.name, quantity: line.quantity, unitPrice: item.price, modifiers: [] };
        });
        const totals = calculateOrderTotals(lines, s.chargeRules);
        if (Math.abs(totals.total - input.expectedTotal) > 0.01) fail(409, "Menu prices changed. Review the updated total and place your order again.");
        const customer = await linkGuestCustomer(tx, t.id, input);
        const stamp = new Date().toISOString();
        const order: Order = { id: randomUUID(), eventId: s.event.id, operatingPeriodId: s.operatingPeriods.find(v => v.status === "open")?.id, storeId, tableId: input.tableId, seatId: input.seatId, origin: "guest-self-order", ...customer, customerName: input.customerName || "Guest", ...(input.customerPhone ? { customerPhone: input.customerPhone } : {}), ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}), createdBy: input.customerName || "Guest", createdAt: stamp, updatedAt: stamp, status: store.manualConfirmation ? "sent" : "confirmed", lines, totals, auditTrail: [{ id: randomUUID(), actor: "Guest", action: "Submitted guest order; payment due at counter", createdAt: stamp }] };
        if (order.status === "confirmed") for (const [stockId, quantity] of requested) {
          s.inventory.find(v => v.id === stockId)!.quantity -= quantity;
          s.stockMovements.push({ id: randomUUID(), stockItemId: stockId, orderId: order.id, type: "sale", quantityDelta: -quantity, note: "Guest order", createdAt: stamp });
        }
        s.orders.unshift(order); s.tables = s.tables.map(v => v.id === input.tableId ? { ...v, status: "occupied" } : v);
        const saved = await tx.workspaceRecord.updateMany({ where: { tenantId: t.id, kind: "runtime", id: runtime.id, version: current.version }, data: { data: json(s), version: { increment: 1 } } });
        if (!saved.count) fail(409, "The menu changed while ordering. Please retry your order.");
        if (customer.customerId) await tx.customerOrder.create({ data: { tenantId: t.id, orderId: order.id, customerId: customer.customerId, storefrontId: storeId, operationId: runtime.id } });
        await tx.workspaceRecord.create({ data: { tenantId: t.id, kind: "guest-request", id: input.requestId, data: { hash, orderId: order.id } } });
        return receipt(order);
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") fail(409, "This order is being processed. Retry to retrieve its confirmation.");
      throw error;
    }
  }));
  return router;
}
