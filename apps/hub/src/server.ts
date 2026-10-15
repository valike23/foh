import cors from "cors";
import express, { type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { AsyncLocalStorage } from "node:async_hooks";
import type { OperationRuntime } from "./operation-runtime.js";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { z } from "zod";
import { createHubDatabase } from "./db.js";
import { createManagementRouter } from "./management.js";
import {
  calculateOrderTotals,
  createSeedSnapshot,
  type AuditEntry,
  type ChargeRule,
  type CloudIngestSummary,
  type CloudSyncStatus,
  type CreateOrderInput,
  type CustomerProfile,
  type Deposit,
  type DeliveryRoute,
  type ForecastMetric,
  type InventoryItem,
  type HubSnapshot,
  type MenuCategory,
  type MenuItem,
  type Order,
  type OrderLine,
  type OrderStatus,
  type OperatingPeriod,
  type Payment,
  type PaymentConfirmation,
  type PaymentProviderEvent,
  type RecordPaymentInput,
  type RegisterSession,
  type RoleName,
  type RunnerAssignment,
  type Seat,
  type Section,
  type SettlementBatch,
  type StaffAssignment,
  type StockMovement,
  type SyncQueueItem,
  type User,
  type Vendor
} from "@exa-foh/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.HUB_DB_PATH ?? join(__dirname, "../data/hub.sqlite");
const legacyStatePath = process.env.HUB_STATE_PATH ?? join(__dirname, "../data/hub-state.json");
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";
const cloudSyncUrl = process.env.CLOUD_SYNC_URL;
const tenantId = process.env.EXA_TENANT_ID ?? "tenant-exa-demo";
const organizationId = process.env.EXA_ORGANIZATION_ID ?? "org-exa-demo";
const sourceHubId = process.env.EXA_HUB_ID ?? "hub-local-demo";
const hubDb = createHubDatabase(dbPath, legacyStatePath);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*"
  }
});

app.use(cors());
app.use("/api/menu-items/:menuItemId/image", express.json({ limit: "8mb" }));
app.use("/api/manage/events/:id/branding/assets", express.json({ limit: "8mb" }));
app.use(express.json());

const createOrderSchema = z.object({
  entryToken: z.string().optional(),
  storeId: z.string(),
  tableId: z.string().optional(),
  origin: z.enum(["waiter", "cashier", "guest-self-order"]),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  seatId: z.string().optional(),
  promotionCode: z.string().optional(),
  createdBy: z.string(),
  lines: z.array(
    z.object({
      menuItemId: z.string(),
      quantity: z.number().int().positive(),
      modifierIds: z.array(z.string()).optional()
    })
  ).min(1)
});

const statusSchema = z.object({
  status: z.enum(["draft", "sent", "confirmed", "preparing", "ready", "served", "settled", "void", "rejected"]),
  actor: z.string().default("BOH")
});

const paymentSchema = z.object({
  orderId: z.string(),
  amount: z.number().positive(),
  method: z.enum(["cash", "pos", "bank-transfer", "paga-card", "paga-transfer", "deposit-offset"]),
  gatewayReference: z.string().optional(),
  confirmedBy: z.string().optional(),
  note: z.string().optional()
});

const createVendorSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["organizer", "third-party"]).default("third-party")
});

const createStoreSchema = z.object({
  vendorId: z.string().optional(),
  name: z.string().min(1),
  kind: z.enum(["bar", "kitchen", "bottle-service", "merch"]),
  manualConfirmation: z.boolean().default(true)
});

const createTableSchema = z.object({
  storeId: z.string(),
  label: z.string().min(1),
  section: z.string().min(1).default("Floor"),
  assignedWaiter: z.string().min(1).default("Unassigned")
});

const createMenuItemSchema = z.object({
  storeId: z.string(),
  name: z.string().min(1),
  category: z.enum(["Drinks", "Food", "Bottle Service", "Merch"]),
  price: z.number().int().nonnegative(),
  unit: z.string().min(1).default("units"),
  quantity: z.number().int().nonnegative().default(0),
  lowStockThreshold: z.number().int().nonnegative().default(0)
});

const inventoryAdjustmentSchema = z.object({
  quantityDelta: z.number().int(),
  note: z.string().min(1),
  type: z.enum(["waste", "restock", "transfer"]).default("restock"),
  actor: z.string().default("BOH")
});

const menuAvailabilitySchema = z.object({
  available: z.boolean(),
  actor: z.string().default("BOH")
});

const createChargeRuleSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["vat", "consumption-tax", "service-charge", "custom"]),
  rate: z.number().min(0).max(1),
  scope: z.enum(["event", "store"]).default("event"),
  appliesTo: z.enum(["subtotal", "running-total"]).default("subtotal"),
  sortOrder: z.number().int().nonnegative().default(40),
  storeId: z.string().optional()
});

const deviceSessionSchema = z.object({
  userId: z.string(),
  deviceName: z.string().min(1).default("BOH device"),
  storeId: z.string().optional()
});

const updateOperatingUnitSchema = z.object({
  containerType: z.enum(["event", "venue"]).optional(),
  status: z.enum(["setup", "live", "closed", "archived", "paused"]).optional(),
  reportingCadence: z.enum(["event-closeout", "shift", "daily", "weekly", "monthly"]).optional(),
  name: z.string().min(1).optional(),
  venue: z.string().min(1).optional(),
  dateLabel: z.string().min(1).optional()
});

const openPeriodSchema = z.object({
  type: z.enum(["event-run", "venue-day", "shift", "register-session"]),
  label: z.string().min(1),
  openingCash: z.number().nonnegative().optional(),
  notes: z.string().optional()
});

const closePeriodSchema = z.object({
  closingCash: z.number().nonnegative().optional(),
  notes: z.string().optional()
});

const providerEventSchema = z.object({
  provider: z.literal("paga").default("paga"),
  eventType: z.string().min(1),
  providerReference: z.string().min(1),
  paymentId: z.string().optional(),
  status: z.enum(["confirmed", "failed", "pending"]).default("confirmed"),
  payload: z.record(z.unknown()).default({})
});

const closeRegisterSchema = z.object({
  declaredCash: z.number().nonnegative(),
  notes: z.string().optional()
});

const settlementBatchSchema = z.object({
  vendorId: z.string(),
  notes: z.string().optional()
});

const payoutSchema = z.object({
  method: z.enum(["manual-transfer", "paga-payout"]).default("manual-transfer"),
  reference: z.string().optional()
});

const createSectionSchema = z.object({
  label: z.string().min(1),
  zone: z.string().min(1),
  storeIds: z.array(z.string()).min(1)
});

const createSeatSchema = z.object({
  sectionId: z.string(),
  label: z.string().min(1),
  row: z.string().optional(),
  seatNumber: z.string().optional(),
  tableId: z.string().optional(),
  status: z.enum(["available", "occupied", "blocked"]).default("available")
});

const createRunnerAssignmentSchema = z.object({
  userId: z.string(),
  name: z.string().min(1),
  zone: z.string().min(1),
  sectionIds: z.array(z.string()).min(1),
  status: z.enum(["available", "busy", "off-duty"]).default("available")
});

const deliveryStatusSchema = z.object({
  status: z.enum(["queued", "assigned", "picked-up", "delivered", "issue"]),
  runnerUserId: z.string().optional(),
  notes: z.string().optional()
});

const createPromotionSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["percentage", "fixed"]),
  value: z.number().positive(),
  scope: z.enum(["event", "store"]).default("event"),
  storeId: z.string().optional(),
  active: z.boolean().default(true)
});

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

const legacySnapshot = hubDb.loadSnapshot();
const operationContext = new AsyncLocalStorage<{ runtime: OperationRuntime; actor: ActorContext; guest?: boolean }>();
// Existing domain handlers access the request's runtime, including after awaited I/O.
const currentSnapshot = () => operationContext.getStore()?.runtime.snapshot ?? legacySnapshot;
const snapshot = new Proxy({} as HubSnapshot, {
  get: (_target, key) => Reflect.get(currentSnapshot(), key),
  set: (_target, key, value) => Reflect.set(currentSnapshot(), key, value),
  ownKeys: () => Reflect.ownKeys(currentSnapshot()),
  getOwnPropertyDescriptor: (_target, key) => ({ ...Object.getOwnPropertyDescriptor(currentSnapshot(), key), configurable: true })
});
const management = createManagementRouter(dbPath, organizationId, () => legacySnapshot, () => hubDb.saveSnapshot(legacySnapshot));
app.use("/api/manage", management);

if (!snapshot.auditLog) {
  snapshot.auditLog = [];
}
if (!snapshot.users?.length || !snapshot.staffAssignments?.length) {
  const seed = createSeedSnapshot();
  snapshot.users = snapshot.users?.length ? snapshot.users : seed.users;
  snapshot.staffAssignments = snapshot.staffAssignments?.length ? snapshot.staffAssignments : seed.staffAssignments;
  snapshot.deviceSessions = snapshot.deviceSessions ?? [];
  hubDb.saveSnapshot(snapshot);
}
if (!snapshot.event.containerType || !snapshot.operatingPeriods?.length) {
  const now = new Date().toISOString();
  snapshot.event = {
    ...snapshot.event,
    containerType: snapshot.event.containerType ?? "event",
    status: snapshot.event.status ?? "live",
    reportingCadence: snapshot.event.reportingCadence ?? "event-closeout"
  };
  snapshot.operatingPeriods = snapshot.operatingPeriods?.length ? snapshot.operatingPeriods : [
    {
      id: id("period"),
      eventId: snapshot.event.id,
      type: "event-run",
      label: `${snapshot.event.name} Run`,
      status: "open",
      openedAt: now,
      openedBy: "System",
      openingCash: 0
    }
  ];
  hubDb.saveSnapshot(snapshot);
}
if (!snapshot.vendorLedgerAccounts?.length || !snapshot.paymentConfirmations || !snapshot.ledgerEntries || !snapshot.registerSessions) {
  snapshot.vendorLedgerAccounts = snapshot.vendorLedgerAccounts?.length
    ? snapshot.vendorLedgerAccounts
    : snapshot.vendors.map((vendor) => ({
      id: `ledger-${vendor.id}`,
      vendorId: vendor.id,
      currency: snapshot.event.currency,
      status: "active" as const
    }));
  snapshot.paymentConfirmations = snapshot.paymentConfirmations ?? [];
  snapshot.paymentProviderEvents = snapshot.paymentProviderEvents ?? [];
  snapshot.ledgerEntries = snapshot.ledgerEntries ?? [];
  snapshot.registerSessions = snapshot.registerSessions ?? [];
  snapshot.settlementBatches = snapshot.settlementBatches ?? [];
  snapshot.payouts = snapshot.payouts ?? [];
  hubDb.saveSnapshot(snapshot);
}
if (!snapshot.sections?.length || !snapshot.seats?.length || !snapshot.runnerAssignments?.length || !snapshot.promotions?.length || !snapshot.deliveryRoutes || !snapshot.customerProfiles) {
  const seed = createSeedSnapshot();
  snapshot.sections = snapshot.sections?.length ? snapshot.sections : seed.sections;
  snapshot.seats = snapshot.seats?.length ? snapshot.seats : seed.seats;
  snapshot.runnerAssignments = snapshot.runnerAssignments?.length ? snapshot.runnerAssignments : seed.runnerAssignments;
  snapshot.deliveryRoutes = snapshot.deliveryRoutes ?? [];
  snapshot.customerProfiles = snapshot.customerProfiles ?? [];
  snapshot.loyaltyAccounts = snapshot.loyaltyAccounts ?? [];
  snapshot.promotions = snapshot.promotions?.length ? snapshot.promotions : seed.promotions;
  snapshot.forecastMetrics = snapshot.forecastMetrics ?? [];
  hubDb.saveSnapshot(snapshot);
}

type ActorContext = {
  user: User;
  assignment?: StaffAssignment;
  storeIds: string[];
  isAdmin: boolean;
};

function publish(): void {
  const current = operationContext.getStore();
  if (!current) throw new Error("Service mutations require an operation context");
  management.persistRuntime(current.runtime);
}

function appendAuditLog(actor: string, action: string): AuditEntry {
  const entry: AuditEntry = {
    id: id("audit"),
    actor,
    action,
    createdAt: new Date().toISOString()
  };

  snapshot.auditLog = [entry, ...(snapshot.auditLog ?? [])].slice(0, 250);
  return entry;
}

function getContextFromUserId(userId = "user-admin"): ActorContext {
  const user = snapshot.users.find((candidate) => candidate.id === userId && candidate.status === "active")
    ?? snapshot.users.find((candidate) => candidate.role === "admin" && candidate.status === "active")
    ?? { id: "user-admin", name: "EXA Admin", role: "admin", status: "active" as const };
  const assignment = snapshot.staffAssignments.find((candidate) => candidate.userId === user.id);
  const isAdmin = user.role === "admin";

  return {
    user,
    assignment,
    isAdmin,
    storeIds: isAdmin ? snapshot.stores.map((store) => store.id) : assignment?.storeIds ?? []
  };
}

function getContext(request: Request): ActorContext {
  const context = operationContext.getStore();
  if (!context) throw new Error("Authenticated operation context required");
  return context.actor;
}

function actorName(context: ActorContext): string {
  return `${context.user.name} (${context.user.role})`;
}

function canAccessStore(context: ActorContext, storeId: string): boolean {
  return context.isAdmin || context.storeIds.includes(storeId);
}

function canAccessOrder(context: ActorContext, order: Order): boolean {
  return canAccessStore(context, order.storeId);
}

function currentOperatingPeriod(): OperatingPeriod {
  const open = snapshot.operatingPeriods.find((period) => period.status === "open");
  if (open) return open;

  const now = new Date().toISOString();
  const fallback: OperatingPeriod = {
    id: id("period"),
    eventId: snapshot.event.id,
    type: snapshot.event.containerType === "venue" ? "venue-day" : "event-run",
    label: snapshot.event.containerType === "venue" ? `${snapshot.event.name} Day` : `${snapshot.event.name} Run`,
    status: "open",
    openedAt: now,
    openedBy: "System",
    openingCash: 0
  };
  snapshot.operatingPeriods = [fallback, ...snapshot.operatingPeriods];
  return fallback;
}

function ledgerAccountForVendor(vendorId: string) {
  let account = snapshot.vendorLedgerAccounts.find((candidate) => candidate.vendorId === vendorId && candidate.status === "active");
  if (!account) {
    account = {
      id: `ledger-${vendorId}`,
      vendorId,
      currency: snapshot.event.currency,
      status: "active"
    };
    snapshot.vendorLedgerAccounts = [account, ...snapshot.vendorLedgerAccounts];
  }
  return account;
}

function confirmationSource(method: Payment["method"], status: Payment["status"]): PaymentConfirmation["source"] {
  if (method === "cash") return "staff-cash";
  if (method === "pos") return "staff-pos";
  if (method === "bank-transfer") return "staff-transfer";
  if (method === "deposit-offset") return "system-deposit";
  return status === "pending-network" ? "gateway" : "gateway";
}

function createPaymentConfirmation(payment: Payment, actor: string, status: PaymentConfirmation["status"], note?: string): PaymentConfirmation {
  const existing = snapshot.paymentConfirmations.find((candidate) =>
    candidate.paymentId === payment.id &&
    candidate.source === confirmationSource(payment.method, payment.status) &&
    candidate.providerReference === payment.gatewayReference
  );
  if (existing) return existing;

  const confirmation: PaymentConfirmation = {
    id: id("confirm"),
    paymentId: payment.id,
    source: confirmationSource(payment.method, payment.status),
    status,
    confirmedAt: new Date().toISOString(),
    confirmedBy: actor,
    providerReference: payment.gatewayReference,
    note
  };
  snapshot.paymentConfirmations = [confirmation, ...snapshot.paymentConfirmations];
  return confirmation;
}

function createLedgerEntriesForPayment(payment: Payment, order: Order): void {
  if (payment.status !== "validated" && payment.status !== "manually-confirmed") return;
  if (snapshot.ledgerEntries.some((entry) => entry.paymentId === payment.id && entry.type !== "manual-adjustment")) return;

  const account = ledgerAccountForVendor(payment.vendorId);
  const now = new Date().toISOString();
  const revenueAmount = Math.min(payment.amount, order.totals.total);
  if (revenueAmount > 0) {
    snapshot.ledgerEntries = [
      {
        id: id("ledger"),
        accountId: account.id,
        vendorId: payment.vendorId,
        eventId: payment.eventId,
        operatingPeriodId: payment.operatingPeriodId,
        orderId: payment.orderId,
        paymentId: payment.id,
        type: payment.method === "deposit-offset" ? "deposit-offset" : "revenue",
        direction: "credit",
        amount: revenueAmount,
        memo: `${payment.method} payment for ${order.id}`,
        createdAt: now
      },
      ...snapshot.ledgerEntries
    ];
  }
}

function settleOrderIfPaid(order: Order): void {
  const paid = snapshot.payments
    .filter((candidate) =>
      candidate.orderId === order.id &&
      (candidate.status === "validated" || candidate.status === "manually-confirmed")
    )
    .reduce((sum, candidate) => sum + candidate.amount, 0);

  if (paid < order.totals.balanceDue) return;

  snapshot.orders = snapshot.orders.map((candidate) =>
    candidate.id === order.id && candidate.status !== "settled"
      ? appendAudit({ ...candidate, status: "settled" }, "Hub", "Payment settled order")
      : candidate
  );
  if (order.tableId) {
    snapshot.tables = snapshot.tables.map((table) =>
      table.id === order.tableId ? { ...table, status: "settled" } : table
    );
  }
}

function settlementReport(context: ActorContext, vendorId?: string) {
  const scoped = scopeSnapshot(snapshot, context);
  const vendorIds = vendorId ? [vendorId] : scoped.vendors.map((vendor) => vendor.id);

  return vendorIds.map((id) => {
    const vendor = snapshot.vendors.find((candidate) => candidate.id === id);
    const account = snapshot.vendorLedgerAccounts.find((candidate) => candidate.vendorId === id);
    const entries = scoped.ledgerEntries.filter((entry) => entry.vendorId === id);
    const credits = entries.filter((entry) => entry.direction === "credit").reduce((sum, entry) => sum + entry.amount, 0);
    const debits = entries.filter((entry) => entry.direction === "debit").reduce((sum, entry) => sum + entry.amount, 0);
    const pendingPayouts = snapshot.payouts.filter((payout) => payout.vendorId === id && payout.status === "pending").reduce((sum, payout) => sum + payout.amount, 0);
    return {
      vendorId: id,
      vendorName: vendor?.name ?? "Unknown vendor",
      accountId: account?.id,
      credits,
      debits,
      balance: credits - debits,
      pendingPayouts,
      entries: entries.slice(0, 100)
    };
  });
}

function expectedCashForPeriod(operatingPeriodId?: string): number {
  return snapshot.payments
    .filter((payment) =>
      payment.method === "cash" &&
      payment.status === "validated" &&
      (!operatingPeriodId || payment.operatingPeriodId === operatingPeriodId)
    )
    .reduce((sum, payment) => sum + payment.amount, 0);
}

function activeRegisterSession(context: ActorContext): RegisterSession {
  const period = currentOperatingPeriod();
  let register = snapshot.registerSessions.find((session) =>
    session.status === "open" &&
    session.operatingPeriodId === period.id &&
    session.cashierUserId === context.user.id
  );
  if (!register) {
    register = {
      id: id("register"),
      operatingPeriodId: period.id,
      cashierUserId: context.user.id,
      status: "open",
      openedAt: new Date().toISOString(),
      openedBy: actorName(context),
      openingCash: period.openingCash ?? 0
    };
    snapshot.registerSessions = [register, ...snapshot.registerSessions];
  }
  return register;
}

function sectionForSeat(seatId?: string): Section | undefined {
  if (!seatId) return undefined;
  const seat = snapshot.seats.find((candidate) => candidate.id === seatId);
  return seat ? snapshot.sections.find((section) => section.id === seat.sectionId) : undefined;
}

function canStoreServeSeat(storeId: string, seatId?: string): boolean {
  const section = sectionForSeat(seatId);
  return !section || section.storeIds.includes(storeId);
}

function profileForCustomer(input: CreateOrderInput): CustomerProfile | undefined {
  const phone = input.customerPhone?.trim();
  const name = input.customerName?.trim();
  if (!phone && !name) return undefined;

  const now = new Date().toISOString();
  const existing = phone
    ? snapshot.customerProfiles.find((profile) => profile.phone === phone)
    : undefined;

  if (existing) {
    const updated: CustomerProfile = {
      ...existing,
      name: name || existing.name,
      lastSeenAt: now
    };
    snapshot.customerProfiles = snapshot.customerProfiles.map((profile) => profile.id === updated.id ? updated : profile);
    return updated;
  }

  const profile: CustomerProfile = {
    id: id("customer"),
    name,
    phone,
    consent: Boolean(phone),
    createdAt: now,
    lastSeenAt: now
  };
  snapshot.customerProfiles = [profile, ...snapshot.customerProfiles];
  if (profile.consent) {
    snapshot.loyaltyAccounts = [
      {
        id: id("loyalty"),
        customerProfileId: profile.id,
        points: 0,
        status: "active"
      },
      ...snapshot.loyaltyAccounts
    ];
  }
  return profile;
}

function promotionForOrder(code: string | undefined, storeId: string) {
  if (!code) return undefined;
  const normalized = code.trim().toUpperCase();
  const now = new Date().toISOString();
  return snapshot.promotions.find((promotion) =>
    promotion.active &&
    promotion.code.toUpperCase() === normalized &&
    (promotion.scope === "event" || promotion.storeId === storeId) &&
    (!promotion.startsAt || promotion.startsAt <= now) &&
    (!promotion.endsAt || promotion.endsAt >= now)
  );
}

function applyPromotion(totals: Order["totals"], promotion: NonNullable<ReturnType<typeof promotionForOrder>>): Order["totals"] {
  const discount = promotion.type === "percentage"
    ? Math.round(totals.subtotal * promotion.value)
    : Math.round(promotion.value);
  const applied = Math.min(discount, totals.balanceDue);
  if (applied <= 0) return totals;

  return {
    ...totals,
    charges: [
      ...totals.charges,
      {
        chargeRuleId: promotion.id,
        name: promotion.label,
        amount: -applied
      }
    ],
    total: Math.max(0, totals.total - applied),
    balanceDue: Math.max(0, totals.balanceDue - applied)
  };
}

function createDeliveryRouteForOrder(order: Order): DeliveryRoute | undefined {
  if (!order.seatId) return undefined;
  const seat = snapshot.seats.find((candidate) => candidate.id === order.seatId);
  if (!seat) return undefined;
  const section = snapshot.sections.find((candidate) => candidate.id === seat.sectionId);
  const runner = snapshot.runnerAssignments.find((candidate) =>
    candidate.status !== "off-duty" &&
    candidate.sectionIds.includes(seat.sectionId)
  );
  const now = new Date().toISOString();
  const route: DeliveryRoute = {
    id: id("route"),
    orderId: order.id,
    seatId: seat.id,
    sectionId: section?.id,
    runnerUserId: runner?.userId,
    status: runner ? "assigned" : "queued",
    createdAt: now,
    updatedAt: now
  };
  snapshot.deliveryRoutes = [route, ...snapshot.deliveryRoutes];
  snapshot.runnerAssignments = snapshot.runnerAssignments.map((assignment) =>
    assignment.id === runner?.id ? { ...assignment, status: "busy" } : assignment
  );
  snapshot.orders = snapshot.orders.map((candidate) =>
    candidate.id === order.id ? { ...candidate, deliveryStatus: route.status } : candidate
  );
  return route;
}

function updateForecastMetrics(): ForecastMetric[] {
  const now = new Date().toISOString();
  const itemTotals = new Map<string, number>();
  const storeTotals = new Map<string, number>();

  for (const order of snapshot.orders) {
    storeTotals.set(order.storeId, (storeTotals.get(order.storeId) ?? 0) + order.totals.total);
    for (const line of order.lines) {
      itemTotals.set(line.menuItemId, (itemTotals.get(line.menuItemId) ?? 0) + line.quantity);
    }
  }

  const itemMetrics = [...itemTotals.entries()].map(([itemId, quantity]) => {
    const item = snapshot.menuItems.find((candidate) => candidate.id === itemId);
    return {
      id: `forecast-item-${itemId}`,
      scope: "item" as const,
      subjectId: itemId,
      label: `${item?.name ?? itemId} units sold`,
      value: quantity,
      unit: "units",
      generatedAt: now
    };
  });
  const storeMetrics = [...storeTotals.entries()].map(([storeId, revenue]) => {
    const store = snapshot.stores.find((candidate) => candidate.id === storeId);
    return {
      id: `forecast-store-${storeId}`,
      scope: "store" as const,
      subjectId: storeId,
      label: `${store?.name ?? storeId} revenue`,
      value: revenue,
      unit: snapshot.event.currency,
      generatedAt: now
    };
  });

  snapshot.forecastMetrics = [...itemMetrics, ...storeMetrics];
  return snapshot.forecastMetrics;
}

function periodReport(period: OperatingPeriod, context: ActorContext) {
  const scoped = scopeSnapshot(snapshot, context);
  const periodOrders = scoped.orders.filter((order) =>
    order.operatingPeriodId
      ? order.operatingPeriodId === period.id
      : order.createdAt >= period.openedAt && (!period.closedAt || order.createdAt <= period.closedAt)
  );
  const periodPayments = scoped.payments.filter((payment) =>
    payment.operatingPeriodId
      ? payment.operatingPeriodId === period.id
      : payment.createdAt >= period.openedAt && (!period.closedAt || payment.createdAt <= period.closedAt)
  );
  const stockItemIds = new Set(scoped.inventory.map((item) => item.id));
  const periodStockMovements = scoped.stockMovements.filter((movement) =>
    stockItemIds.has(movement.stockItemId) &&
    movement.createdAt >= period.openedAt &&
    (!period.closedAt || movement.createdAt <= period.closedAt)
  );
  const revenue = periodOrders.reduce((sum, order) => sum + order.totals.total, 0);
  const settled = periodPayments
    .filter((payment) => payment.status === "validated" || payment.status === "manually-confirmed")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const outstanding = periodOrders.reduce((sum, order) => {
    const paid = periodPayments
      .filter((payment) => payment.orderId === order.id && (payment.status === "validated" || payment.status === "manually-confirmed"))
      .reduce((paymentSum, payment) => paymentSum + payment.amount, 0);
    return sum + Math.max(0, order.totals.balanceDue - paid);
  }, 0);

  return {
    period,
    containerType: snapshot.event.containerType,
    event: snapshot.event,
    orders: periodOrders.length,
    revenue,
    settled,
    outstanding,
    paymentsByMethod: periodPayments.reduce<Record<string, number>>((totals, payment) => {
      totals[payment.method] = (totals[payment.method] ?? 0) + payment.amount;
      return totals;
    }, {}),
    stockMovements: periodStockMovements.length,
    openingCash: period.openingCash ?? 0,
    closingCash: period.closingCash,
    expectedCash: (period.openingCash ?? 0) + periodPayments
      .filter((payment) => payment.method === "cash" && payment.status === "validated")
      .reduce((sum, payment) => sum + payment.amount, 0)
  };
}

function requireRoles(response: Response, context: ActorContext, roles: RoleName[]): boolean {
  if (context.isAdmin || roles.includes(context.user.role)) return true;
  response.status(403).json({ error: `Role ${context.user.role} cannot perform this action` });
  return false;
}

function requireStoreAccess(response: Response, context: ActorContext, storeId: string): boolean {
  if (canAccessStore(context, storeId)) return true;
  response.status(403).json({ error: "Store is outside this user's assignment" });
  return false;
}

function zeroTotals() {
  return {
    subtotal: 0,
    charges: [],
    depositApplied: 0,
    total: 0,
    balanceDue: 0
  };
}

function redactFinancialOrder(order: Order): Order {
  return {
    ...order,
    lines: order.lines.map((line) => ({ ...line, unitPrice: 0, modifiers: line.modifiers.map((modifier) => ({ ...modifier, priceDelta: 0 })) })),
    totals: zeroTotals()
  };
}

function scopeSnapshot(source: HubSnapshot, context: ActorContext): HubSnapshot {
  if (context.isAdmin) {
    return source;
  }

  const storeIds = new Set(context.storeIds);
  const tableIds = new Set(source.tables.filter((table) => storeIds.has(table.storeId)).map((table) => table.id));
  const stockItemIds = new Set(source.inventory.filter((item) => storeIds.has(item.storeId)).map((item) => item.id));
  const visibleStores = source.stores.filter((store) => storeIds.has(store.id));
  const visibleVendorIds = new Set(visibleStores.map((store) => store.vendorId));
  const canSeeFinancials = context.user.role === "vendor-manager" || context.user.role === "cashier";

  return {
    ...source,
    vendors: source.vendors.filter((vendor) => visibleVendorIds.has(vendor.id)),
    operatingPeriods: source.operatingPeriods,
    users: source.users.filter((user) => user.id === context.user.id),
    staffAssignments: source.staffAssignments.filter((assignment) => assignment.userId === context.user.id),
    deviceSessions: source.deviceSessions.filter((session) => session.userId === context.user.id),
    stores: visibleStores,
    tables: source.tables.filter((table) => storeIds.has(table.storeId)),
    sections: source.sections.filter((section) => section.storeIds.some((storeId) => storeIds.has(storeId))),
    seats: source.seats.filter((seat) => {
      const section = source.sections.find((candidate) => candidate.id === seat.sectionId);
      return Boolean(section && section.storeIds.some((storeId) => storeIds.has(storeId)));
    }),
    menuItems: source.menuItems.filter((item) => storeIds.has(item.storeId)),
    inventory: source.inventory.filter((item) => storeIds.has(item.storeId)),
    deposits: canSeeFinancials ? source.deposits.filter((deposit) => tableIds.has(deposit.tableId)) : [],
    orders: source.orders
      .filter((order) => storeIds.has(order.storeId))
      .map((order) => canSeeFinancials ? order : redactFinancialOrder(order)),
    payments: canSeeFinancials ? source.payments.filter((payment) => storeIds.has(payment.storeId)) : [],
    paymentConfirmations: canSeeFinancials ? source.paymentConfirmations.filter((confirmation) => {
      const payment = source.payments.find((candidate) => candidate.id === confirmation.paymentId);
      return Boolean(payment && storeIds.has(payment.storeId));
    }) : [],
    paymentProviderEvents: canSeeFinancials ? source.paymentProviderEvents.filter((event) => {
      if (!event.paymentId) return true;
      const payment = source.payments.find((candidate) => candidate.id === event.paymentId);
      return Boolean(payment && storeIds.has(payment.storeId));
    }) : [],
    vendorLedgerAccounts: canSeeFinancials ? source.vendorLedgerAccounts.filter((account) => visibleVendorIds.has(account.vendorId)) : [],
    ledgerEntries: canSeeFinancials ? source.ledgerEntries.filter((entry) => visibleVendorIds.has(entry.vendorId)) : [],
    registerSessions: canSeeFinancials ? source.registerSessions.filter((session) => !session.cashierUserId || session.cashierUserId === context.user.id || context.user.role === "vendor-manager") : [],
    settlementBatches: canSeeFinancials ? source.settlementBatches.filter((batch) => visibleVendorIds.has(batch.vendorId)) : [],
    payouts: canSeeFinancials ? source.payouts.filter((payout) => visibleVendorIds.has(payout.vendorId)) : [],
    runnerAssignments: source.runnerAssignments.filter((assignment) => context.user.role === "runner" ? assignment.userId === context.user.id : assignment.sectionIds.some((sectionId) => source.sections.find((section) => section.id === sectionId)?.storeIds.some((storeId) => storeIds.has(storeId)))),
    deliveryRoutes: source.deliveryRoutes.filter((route) => {
      const order = source.orders.find((candidate) => candidate.id === route.orderId);
      return Boolean(order && storeIds.has(order.storeId));
    }),
    customerProfiles: canSeeFinancials ? source.customerProfiles : [],
    loyaltyAccounts: canSeeFinancials ? source.loyaltyAccounts : [],
    promotions: source.promotions.filter((promotion) => promotion.scope === "event" || Boolean(promotion.storeId && storeIds.has(promotion.storeId))),
    forecastMetrics: source.forecastMetrics.filter((metric) => metric.scope === "event" || storeIds.has(metric.subjectId) || source.menuItems.some((item) => item.id === metric.subjectId && storeIds.has(item.storeId))),
    chargeRules: source.chargeRules,
    stockMovements: source.stockMovements.filter((movement) => stockItemIds.has(movement.stockItemId)),
    auditLog: source.auditLog.filter((entry) => entry.actor.includes(context.user.name) || entry.action.includes("order")).slice(0, 100),
    syncQueue: source.syncQueue
  };
}

function getActiveDeposits(tableId?: string): Deposit[] {
  if (!tableId) return [];
  return snapshot.deposits.filter((deposit) => deposit.tableId === tableId && deposit.status === "active");
}

function chargeRulesForStore(storeId: string) {
  const store = snapshot.stores.find((candidate) => candidate.id === storeId);
  const ruleIds = store?.chargeRuleIds?.length ? store.chargeRuleIds : snapshot.event.defaultChargeRuleIds;
  return snapshot.chargeRules.filter((rule) => ruleIds.includes(rule.id));
}

function buildOrderLines(input: CreateOrderInput): OrderLine[] {
  const requested = new Map<string, number>();
  return input.lines.map((line) => {
    const menuItem = snapshot.menuItems.find((candidate) => candidate.id === line.menuItemId);
    if (!menuItem || menuItem.storeId !== input.storeId) {
      throw new Error(`Unknown menu item ${line.menuItemId}`);
    }

    const stock = snapshot.inventory.find((candidate) => candidate.id === menuItem.stockItemId);
    const quantity = (requested.get(menuItem.stockItemId) ?? 0) + line.quantity;
    requested.set(menuItem.stockItemId, quantity);
    if (!menuItem.available || !stock || stock.storeId !== input.storeId || stock.quantity < quantity) {
      throw new Error(`${menuItem.name} is unavailable or low on stock`);
    }

    const modifiers = menuItem.modifiers?.filter((modifier) => line.modifierIds?.includes(modifier.id)) ?? [];

    return {
      id: id("line"),
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity: line.quantity,
      unitPrice: menuItem.price,
      modifiers
    };
  });
}

function appendAudit(order: Order, actor: string, action: string): Order {
  const entry: AuditEntry = {
    id: id("audit"),
    actor,
    action,
    createdAt: new Date().toISOString()
  };

  return {
    ...order,
    auditTrail: [...order.auditTrail, entry],
    updatedAt: entry.createdAt
  };
}

function deductInventory(order: Order): void {
  const movements: StockMovement[] = [];

  for (const line of order.lines) {
    const menuItem = snapshot.menuItems.find((candidate) => candidate.id === line.menuItemId);
    if (!menuItem) continue;

    snapshot.inventory = snapshot.inventory.map((stock) => {
      if (stock.id !== menuItem.stockItemId) return stock;

      movements.push({
        id: id("stock"),
        stockItemId: stock.id,
        orderId: order.id,
        type: "sale",
        quantityDelta: -line.quantity,
        createdAt: new Date().toISOString(),
        note: `Confirmed ${order.id}`
      });

      return {
        ...stock,
        quantity: Math.max(0, stock.quantity - line.quantity)
      };
    });
  }

  snapshot.stockMovements = [...snapshot.stockMovements, ...movements];
  snapshot.menuItems = snapshot.menuItems.map((item) => {
    const stock = snapshot.inventory.find((candidate) => candidate.id === item.stockItemId);
    return stock && stock.quantity <= 0 ? { ...item, available: false } : item;
  });
}

function enqueueSync(summary: string, kind: SyncQueueItem["kind"] = "cloud-sync"): void {
  const now = new Date().toISOString();
  const item: SyncQueueItem = {
    id: id("sync"),
    kind,
    status: "queued",
    summary,
    createdAt: now,
    updatedAt: now,
    attempts: 0
  };

  snapshot.syncQueue = [
    item,
    ...snapshot.syncQueue
  ].slice(0, 100);
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function cloudSnapshot(): HubSnapshot {
  return {
    ...snapshot,
    auditLog: (snapshot.auditLog ?? []).filter((entry) =>
      !entry.action.startsWith("Synced local hub to cloud") &&
      !entry.action.startsWith("Cloud sync failed")
    ),
    syncQueue: []
  };
}

function syncQueueItems(): SyncQueueItem[] {
  return snapshot.syncQueue.filter((item) => item.kind === "cloud-sync" || item.kind === "cloud-backup");
}

function syncStatus(): CloudSyncStatus {
  const items = syncQueueItems();
  const failed = items.filter((item) => item.status === "failed");
  const sentItems = items.filter((item) => item.status === "sent");
  const attempted = items.filter((item) => item.lastAttemptAt);
  const retryable = failed.filter((item) => item.nextAttemptAt);

  return {
    configured: Boolean(cloudSyncUrl),
    cloudUrl: cloudSyncUrl,
    tenantId,
    organizationId,
    sourceHubId,
    queued: items.filter((item) => item.status === "queued").length,
    sent: sentItems.length,
    failed: failed.length,
    lastAttemptAt: attempted.map((item) => item.lastAttemptAt).filter(Boolean).sort().at(-1),
    lastSuccessAt: sentItems.map((item) => item.updatedAt ?? item.createdAt).sort().at(-1),
    nextRetryAt: retryable.map((item) => item.nextAttemptAt).filter(Boolean).sort()[0],
    lastError: failed[0]?.error
  };
}

function markCloudSyncFailed(error: string): void {
  const now = new Date().toISOString();
  const nextAttemptAt = new Date(Date.now() + 60_000).toISOString();
  const hasOpenItem = snapshot.syncQueue.some((item) => item.kind === "cloud-sync" && item.status !== "sent");

  snapshot.syncQueue = snapshot.syncQueue.map((item) => {
    if (item.kind !== "cloud-sync" && item.kind !== "cloud-backup") return item;
    if (item.status === "sent") return item;
    return {
      ...item,
      status: "failed",
      attempts: (item.attempts ?? 0) + 1,
      lastAttemptAt: now,
      nextAttemptAt,
      updatedAt: now,
      error
    };
  });

  if (!hasOpenItem) {
    snapshot.syncQueue = [
      {
        id: id("sync"),
        kind: "cloud-sync" as const,
        status: "failed" as const,
        summary: "Cloud sync failed",
        createdAt: now,
        updatedAt: now,
        attempts: 1,
        lastAttemptAt: now,
        nextAttemptAt,
        error
      },
      ...snapshot.syncQueue
    ].slice(0, 100);
  }
}

async function pushSnapshotToCloud(actor: string): Promise<CloudIngestSummary> {
  if (!cloudSyncUrl) {
    throw new Error("CLOUD_SYNC_URL is not configured for this hub");
  }

  const payloadSnapshot = cloudSnapshot();
  const payloadHash = hashPayload(payloadSnapshot);
  const response = await fetch(`${cloudSyncUrl}/api/ingest/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantId,
      organizationId,
      organizationName: "EXA Demo Organization",
      organizationKind: "organizer",
      sourceHubId,
      idempotencyKey: `${sourceHubId}:${payloadSnapshot.event.id}:${payloadHash}`,
      snapshot: payloadSnapshot
    })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Cloud sync failed with ${response.status}`);
  }

  const result = await response.json() as CloudIngestSummary;
  const now = new Date().toISOString();
  snapshot.syncQueue = snapshot.syncQueue.map((item) => {
    if ((item.kind !== "cloud-sync" && item.kind !== "cloud-backup") || item.status === "sent") return item;
    return {
      ...item,
      status: "sent",
      attempts: (item.attempts ?? 0) + 1,
      lastAttemptAt: now,
      updatedAt: now,
      cloudId: result.runId,
      error: undefined,
      nextAttemptAt: undefined
    };
  });
  snapshot.syncQueue = [
    {
      id: id("sync"),
      kind: "cloud-sync" as const,
      status: "sent" as const,
      summary: `Cloud accepted ${result.recordsUpserted} records`,
      createdAt: now,
      updatedAt: now,
      attempts: 1,
      lastAttemptAt: now,
      cloudId: result.runId
    },
    ...snapshot.syncQueue
  ].slice(0, 100);
  appendAuditLog(actor, `Synced local hub to cloud run ${result.runId}`);
  return result;
}

const imageDb = new DatabaseSync(dbPath);
imageDb.exec("CREATE TABLE IF NOT EXISTS menu_images (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, content BLOB NOT NULL)");
app.get("/api/menu-images/:id", (request, response) => {
  const row = imageDb.prepare("SELECT content FROM menu_images WHERE id = ?").get(request.params.id) as { content: Uint8Array } | undefined;
  if (!row) { response.status(404).json({ error: "Image not found" }); return; }
  response.set({ "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" }).send(Buffer.from(row.content));
});

app.use("/api", (request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const guestToken = request.path === "/guest/snapshot" ? String(request.query.entryToken ?? "") : request.path === "/orders" && request.method === "POST" ? request.body?.entryToken : undefined;
    if (guestToken) {
      const entry = management.resolveEntry(guestToken);
      if (!entry.open || !entry.operationId || !entry.storeId) { response.status(409).json({ error: "Service is not open. Scan the current QR code." }); return; }
      const runtime = management.runtimeFor(entry.operationId)!;
      if (request.method === "POST" && (request.body.origin !== "guest-self-order" || request.body.storeId !== entry.storeId || request.body.tableId !== entry.tableId || request.body.seatId !== entry.seatId)) {
        response.status(403).json({ error: "Order does not match the QR destination" }); return;
      }
      const actor: ActorContext = { user: { id: "guest", name: "Guest", role: "waiter", status: "active" }, storeIds: [entry.storeId], isAdmin: false };
      operationContext.run({ runtime, actor, guest: true }, () => {
        if (request.path === "/guest/snapshot") {
          const safe = Object.fromEntries(Object.keys(snapshot).map(key => [key, []])) as unknown as HubSnapshot;
          safe.event = { ...snapshot.event, guestBranding: management.getBranding(runtime.id) };
          safe.stores = snapshot.stores.filter(s => s.id === entry.storeId);
          safe.menuItems = snapshot.menuItems.filter(m => m.storeId === entry.storeId).map(m => ({ ...m, available: m.available && snapshot.inventory.some(i => i.id === m.stockItemId && i.quantity > 0) }));
          safe.chargeRules = chargeRulesForStore(entry.storeId!);
          safe.tables = snapshot.tables.filter(t => t.id === entry.tableId).map(t => ({ ...t, assignedWaiter: "" }));
          safe.seats = snapshot.seats.filter(s => s.id === entry.seatId);
          safe.sections = snapshot.sections.filter(s => safe.seats.some(seat => seat.sectionId === s.id));
          response.json(safe);
        } else next();
      });
      return;
    }
    const operationId = request.header("x-operation-id");
    const { user, runtime } = management.authorizeRuntime(request, operationId ?? legacySnapshot.event.id, request.method !== "GET");
    if (!operationId) { response.status(400).json({ error: "Select an operation first" }); return; }
    const forbidden = ["/admin/reset-seed", "/auth/device-sessions", "/operating-unit", "/operating-periods", "/vendors", "/stores", "/tables", "/sections", "/seats"];
    if (request.method !== "GET" && forbidden.some(path => request.path === path || request.path.startsWith(`${path}/`))) {
      response.status(409).json({ error: "Use management configuration and Operations lifecycle controls" }); return;
    }
    if (request.path === "/cloud/reports/overview" && user.role !== "owner") { response.status(403).json({ error: "Owner access required for organization reports" }); return; }
    if (runtime.snapshot.event.status === "closed" && request.method !== "GET" && !request.path.startsWith("/sync/") && !request.path.startsWith("/settlement-batches")) {
      response.status(409).json({ error: "This operation is closed and read-only" }); return;
    }
    const actor: ActorContext = { user: { id: user.id, name: user.name, role: "admin", status: "active" }, storeIds: runtime.snapshot.stores.map(s => s.id), isAdmin: true };
    operationContext.run({ runtime, actor }, next);
  } catch (error) {
    response.status(typeof (error as any)?.status === "number" ? (error as any).status : 400).json({ error: error instanceof Error ? error.message : "Operation access denied" });
  }
});

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    mode: "local-hub",
    persistence: "sqlite",
    dbPath: hubDb.dbPath,
    eventId: snapshot.event.id,
    orders: snapshot.orders.length
  });
});

app.get("/api/users", (_request, response) => {
  response.json([operationContext.getStore()!.actor.user]);
});

app.post("/api/auth/device-sessions", (request, response) => {
  try {
    const input = deviceSessionSchema.parse(request.body);
    const context = getContextFromUserId(input.userId);
    if (input.storeId && !requireStoreAccess(response, context, input.storeId)) return;

    const now = new Date().toISOString();
    const session = {
      id: id("session"),
      userId: context.user.id,
      deviceName: input.deviceName,
      role: context.user.role,
      storeId: input.storeId,
      createdAt: now,
      lastSeenAt: now
    };

    snapshot.deviceSessions = [session, ...(snapshot.deviceSessions ?? [])].slice(0, 50);
    appendAuditLog(actorName(context), `Unlocked device ${session.deviceName}`);
    publish();
    response.status(201).json({ session, user: context.user, assignment: context.assignment });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid session" });
  }
});

app.get("/api/session", (request, response) => {
  const context = getContext(request);
  response.json({ user: context.user, assignment: context.assignment, storeIds: context.storeIds });
});

app.get("/api/snapshot", (request, response) => {
  response.json({ ...scopeSnapshot(snapshot, getContext(request)), users: [getContext(request).user] });
});

app.get("/api/setup", (request, response) => {
  const context = getContext(request);
  const scoped = scopeSnapshot(snapshot, context);
  response.json({
    event: scoped.event,
    operatingPeriods: scoped.operatingPeriods,
    vendors: scoped.vendors,
    stores: scoped.stores,
    tables: scoped.tables,
    menuItems: scoped.menuItems,
    inventory: scoped.inventory,
    chargeRules: scoped.chargeRules,
    users: context.isAdmin ? snapshot.users : scoped.users,
    staffAssignments: context.isAdmin ? snapshot.staffAssignments : scoped.staffAssignments
  });
});

app.patch("/api/operating-unit", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin"])) return;
    const input = updateOperatingUnitSchema.parse(request.body);

    snapshot.event = {
      ...snapshot.event,
      ...input
    };
    appendAuditLog(actorName(context), `Updated operating unit to ${snapshot.event.containerType}/${snapshot.event.status}`);
    enqueueSync(`Operating unit ${snapshot.event.name} updated`);
    publish();
    response.json(snapshot.event);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid operating unit update" });
  }
});

app.post("/api/operating-periods", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "cashier"])) return;
    const input = openPeriodSchema.parse(request.body);
    const now = new Date().toISOString();

    snapshot.operatingPeriods = snapshot.operatingPeriods.map((period) =>
      period.status === "open"
        ? { ...period, status: "closed", closedAt: now, closedBy: actorName(context), notes: period.notes ?? "Auto-closed by new period" }
        : period
    );

    const period: OperatingPeriod = {
      id: id("period"),
      eventId: snapshot.event.id,
      type: input.type,
      label: input.label,
      status: "open",
      openedAt: now,
      openedBy: actorName(context),
      openingCash: input.openingCash,
      notes: input.notes
    };

    snapshot.operatingPeriods = [period, ...snapshot.operatingPeriods];
    snapshot.event = {
      ...snapshot.event,
      status: "live",
      containerType: input.type === "venue-day" || input.type === "shift" || input.type === "register-session" ? "venue" : snapshot.event.containerType,
      reportingCadence: input.type === "event-run" ? "event-closeout" : input.type === "shift" || input.type === "register-session" ? "shift" : "daily"
    };
    appendAuditLog(actorName(context), `Opened ${period.type} ${period.label}`);
    enqueueSync(`Operating period ${period.label} opened`);
    publish();
    response.status(201).json(period);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid operating period" });
  }
});

app.patch("/api/operating-periods/:periodId/close", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "cashier"])) return;
    const input = closePeriodSchema.parse(request.body);
    const period = snapshot.operatingPeriods.find((candidate) => candidate.id === request.params.periodId);

    if (!period) {
      response.status(404).json({ error: "Operating period not found" });
      return;
    }

    const closed: OperatingPeriod = {
      ...period,
      status: "closed",
      closedAt: new Date().toISOString(),
      closedBy: actorName(context),
      closingCash: input.closingCash,
      notes: input.notes ?? period.notes
    };

    snapshot.operatingPeriods = snapshot.operatingPeriods.map((candidate) => candidate.id === closed.id ? closed : candidate);
    snapshot.event = {
      ...snapshot.event,
      status: snapshot.event.containerType === "event" ? "closed" : snapshot.event.status
    };
    appendAuditLog(actorName(context), `Closed ${closed.type} ${closed.label}`);
    enqueueSync(`Operating period ${closed.label} closed`);
    publish();
    response.json(periodReport(closed, context));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid close-out" });
  }
});

app.get("/api/reports/closeout", (request, response) => {
  const context = getContext(request);
  if (!requireRoles(response, context, ["admin", "vendor-manager", "cashier"])) return;
  const periodId = String(request.query.periodId ?? "");
  const period = snapshot.operatingPeriods.find((candidate) => candidate.id === periodId) ?? snapshot.operatingPeriods[0];
  if (!period) { response.status(404).json({ error: "No operating period has been opened" }); return; }
  response.json(periodReport(period, context));
});

app.get("/api/sync/status", (request, response) => {
  const context = getContext(request);
  if (!requireRoles(response, context, ["admin", "vendor-manager", "cashier"])) return;
  response.json(syncStatus());
});

app.post("/api/sync/run", async (request, response) => {
  const context = getContext(request);
  if (!requireRoles(response, context, ["admin"])) return;

  try {
    const result = await pushSnapshotToCloud(actorName(context));
    publish();
    response.status(202).json({ status: syncStatus(), result });
  } catch (error) {
    markCloudSyncFailed(error instanceof Error ? error.message : "Cloud sync failed");
    appendAuditLog(actorName(context), `Cloud sync failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    publish();
    response.status(502).json({ error: error instanceof Error ? error.message : "Cloud sync failed", status: syncStatus() });
  }
});

app.post("/api/sync/retry-failed", (request, response) => {
  const context = getContext(request);
  if (!requireRoles(response, context, ["admin"])) return;
  const now = new Date().toISOString();
  let retried = 0;

  snapshot.syncQueue = snapshot.syncQueue.map((item) => {
    if ((item.kind !== "cloud-sync" && item.kind !== "cloud-backup") || item.status !== "failed") return item;
    retried += 1;
    return {
      ...item,
      status: "queued",
      updatedAt: now,
      nextAttemptAt: undefined,
      error: undefined
    };
  });

  appendAuditLog(actorName(context), `Queued ${retried} failed cloud sync item${retried === 1 ? "" : "s"} for retry`);
  publish();
  response.json({ retried, status: syncStatus() });
});

app.get("/api/backups/local", (request, response) => {
  const context = getContext(request);
  if (!requireRoles(response, context, ["admin"])) return;
  const payload = cloudSnapshot();
  response.json({
    sourceHubId,
    tenantId,
    organizationId,
    createdAt: new Date().toISOString(),
    payloadHash: hashPayload(payload),
    snapshot: payload
  });
});

app.get("/api/cloud/reports/overview", async (request, response) => {
  const context = getContext(request);
  if (!requireRoles(response, context, ["admin", "vendor-manager", "cashier"])) return;
  if (!cloudSyncUrl) {
    response.status(503).json({ error: "CLOUD_SYNC_URL is not configured for this hub" });
    return;
  }

  try {
    const cloudResponse = await fetch(`${cloudSyncUrl}/api/admin/reports/overview`);
    if (!cloudResponse.ok) {
      throw new Error(`Cloud report failed with ${cloudResponse.status}`);
    }
    response.json(await cloudResponse.json());
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Cloud report unavailable" });
  }
});

app.post("/api/admin/reset-seed", (request, response) => {
  response.status(403).json({ error: "Seed reset is disabled" });
});

app.post("/api/vendors", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin"])) return;
    const input = createVendorSchema.parse(request.body);
    const vendor: Vendor = {
      id: id("vendor"),
      name: input.name,
      kind: input.kind
    };

    snapshot.vendors = [...snapshot.vendors, vendor];
    appendAuditLog(actorName(context), `Created vendor ${vendor.name}`);
    enqueueSync(`Vendor ${vendor.name} created`);
    publish();
    response.status(201).json(vendor);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid vendor" });
  }
});

app.post("/api/stores", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin"])) return;
    const input = createStoreSchema.parse(request.body);
    const vendorId = input.vendorId ?? snapshot.vendors.find((vendor) => vendor.kind === "organizer")?.id;

    if (!vendorId || !snapshot.vendors.some((vendor) => vendor.id === vendorId)) {
      response.status(400).json({ error: "Vendor not found" });
      return;
    }

    const store = {
      id: id("store"),
      eventId: snapshot.event.id,
      vendorId,
      name: input.name,
      kind: input.kind,
      manualConfirmation: input.manualConfirmation
    };

    snapshot.stores = [...snapshot.stores, store];
    appendAuditLog(actorName(context), `Created store ${store.name}`);
    enqueueSync(`Store ${store.name} created`);
    publish();
    response.status(201).json(store);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid store" });
  }
});

app.post("/api/tables", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "cashier", "waiter"])) return;
    const input = createTableSchema.parse(request.body);
    const store = snapshot.stores.find((candidate) => candidate.id === input.storeId);

    if (!store) {
      response.status(404).json({ error: "Store not found" });
      return;
    }
    if (!requireStoreAccess(response, context, store.id)) return;

    const table = {
      id: id("table"),
      storeId: store.id,
      label: input.label,
      section: input.section,
      status: "open" as const,
      assignedWaiter: input.assignedWaiter
    };

    snapshot.tables = [...snapshot.tables, table];
    appendAuditLog(actorName(context), `Created table ${table.label} for ${store.name}`);
    enqueueSync(`Table ${table.label} created`);
    publish();
    response.status(201).json(table);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid table" });
  }
});

app.post("/api/sections", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "vendor-manager"])) return;
    const input = createSectionSchema.parse(request.body);
    if (!input.storeIds.every((storeId) => snapshot.stores.some((store) => store.id === storeId))) {
      response.status(400).json({ error: "One or more stores were not found" });
      return;
    }
    const section: Section = {
      id: id("section"),
      eventId: snapshot.event.id,
      label: input.label,
      zone: input.zone,
      storeIds: input.storeIds
    };
    snapshot.sections = [section, ...snapshot.sections];
    appendAuditLog(actorName(context), `Created section ${section.label}`);
    enqueueSync(`Section ${section.label} created`);
    publish();
    response.status(201).json(section);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid section" });
  }
});

app.post("/api/seats", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "vendor-manager", "cashier"])) return;
    const input = createSeatSchema.parse(request.body);
    const section = snapshot.sections.find((candidate) => candidate.id === input.sectionId);
    if (!section) {
      response.status(404).json({ error: "Section not found" });
      return;
    }
    const seat: Seat = {
      id: id("seat"),
      sectionId: section.id,
      label: input.label,
      row: input.row,
      seatNumber: input.seatNumber,
      tableId: input.tableId,
      status: input.status
    };
    snapshot.seats = [seat, ...snapshot.seats];
    appendAuditLog(actorName(context), `Created seat ${seat.label}`);
    enqueueSync(`Seat ${seat.label} created`);
    publish();
    response.status(201).json(seat);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid seat" });
  }
});

app.post("/api/runner-assignments", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "vendor-manager"])) return;
    const input = createRunnerAssignmentSchema.parse(request.body);
    const user = snapshot.users.find((candidate) => candidate.id === input.userId);
    if (!user) {
      response.status(404).json({ error: "Runner user not found" });
      return;
    }
    const assignment: RunnerAssignment = {
      id: id("runner"),
      userId: input.userId,
      name: input.name,
      zone: input.zone,
      sectionIds: input.sectionIds,
      status: input.status
    };
    snapshot.runnerAssignments = [assignment, ...snapshot.runnerAssignments];
    appendAuditLog(actorName(context), `Assigned runner ${assignment.name} to ${assignment.zone}`);
    enqueueSync(`Runner ${assignment.name} assigned`);
    publish();
    response.status(201).json(assignment);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid runner assignment" });
  }
});

app.post("/api/promotions", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "vendor-manager"])) return;
    const input = createPromotionSchema.parse(request.body);
    const promotion = {
      id: id("promo"),
      code: input.code.trim().toUpperCase(),
      label: input.label,
      type: input.type,
      value: input.value,
      scope: input.scope,
      storeId: input.storeId,
      active: input.active
    };
    snapshot.promotions = [promotion, ...snapshot.promotions];
    appendAuditLog(actorName(context), `Created promotion ${promotion.code}`);
    enqueueSync(`Promotion ${promotion.code} created`);
    publish();
    response.status(201).json(promotion);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid promotion" });
  }
});

app.post("/api/charge-rules", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin"])) return;
    const input = createChargeRuleSchema.parse(request.body);
    const chargeRule: ChargeRule = {
      id: id("charge"),
      name: input.name,
      type: input.type,
      rate: input.rate,
      scope: input.scope,
      appliesTo: input.appliesTo,
      sortOrder: input.sortOrder
    };

    snapshot.chargeRules = [...snapshot.chargeRules, chargeRule];

    if (input.scope === "event") {
      snapshot.event = {
        ...snapshot.event,
        defaultChargeRuleIds: [...snapshot.event.defaultChargeRuleIds, chargeRule.id]
      };
    } else if (input.storeId) {
      snapshot.stores = snapshot.stores.map((store) =>
        store.id === input.storeId
          ? { ...store, chargeRuleIds: [...(store.chargeRuleIds ?? []), chargeRule.id] }
          : store
      );
    }

    appendAuditLog(actorName(context), `Created charge rule ${chargeRule.name}`);
    enqueueSync(`Charge rule ${chargeRule.name} created`);
    publish();
    response.status(201).json(chargeRule);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid charge rule" });
  }
});

app.post("/api/menu-items", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "vendor-manager", "store-operator"])) return;
    const input = createMenuItemSchema.parse(request.body);
    const store = snapshot.stores.find((candidate) => candidate.id === input.storeId);

    if (!store) {
      response.status(404).json({ error: "Store not found" });
      return;
    }
    if (!requireStoreAccess(response, context, store.id)) return;

    const stockItem: InventoryItem = {
      id: id("stock"),
      storeId: store.id,
      name: input.name,
      unit: input.unit,
      quantity: input.quantity,
      lowStockThreshold: input.lowStockThreshold
    };

    const menuItem: MenuItem = {
      id: id("item"),
      storeId: store.id,
      name: input.name,
      category: input.category as MenuCategory,
      price: input.price,
      stockItemId: stockItem.id,
      available: input.quantity > 0
    };

    snapshot.inventory = [...snapshot.inventory, stockItem];
    snapshot.menuItems = [...snapshot.menuItems, menuItem];
    appendAuditLog(actorName(context), `Created menu item ${menuItem.name} at ${store.name}`);
    enqueueSync(`Menu item ${menuItem.name} created at ${store.name}`);
    publish();
    response.status(201).json({ menuItem, stockItem });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid menu item" });
  }
});

app.patch("/api/menu-items/:menuItemId/image", async (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "vendor-manager", "store-operator"])) return;
    const input = z.object({ base64: z.string().max(7_000_000).nullable(), expectedImageId: z.string().nullable() }).strict().parse(request.body);
    const item = snapshot.menuItems.find(candidate => candidate.id === request.params.menuItemId);
    if (!item) { response.status(404).json({ error: "Menu item not found" }); return; }
    if (!requireStoreAccess(response, context, item.storeId)) return;
    let content: Buffer | undefined;
    if (input.base64 !== null) {
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)) throw new Error("Invalid image data");
      const buffer = Buffer.from(input.base64, "base64");
      if (buffer.length > 5 * 1024 * 1024) throw new Error("Images must be 5 MB or smaller");
      const image = sharp(buffer, { limitInputPixels: 16_000_000 });
      const metadata = await image.metadata();
      if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw new Error("Use a static PNG, JPEG or WebP image");
      content = await image.rotate().resize(1000, 1000, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    }
    const operationId = request.header("x-operation-id")!;
    const { runtime } = management.authorizeRuntime(request, operationId, true);
    if (runtime.snapshot.event.status === "closed") { response.status(409).json({ error: "This operation is closed" }); return; }
    const current = snapshot.menuItems.find(candidate => candidate.id === item.id)!;
    if ((current.imageId ?? null) !== input.expectedImageId) { response.status(409).json({ error: "Photo changed. Refresh and try again." }); return; }
    const imageId = content ? randomUUID() : undefined;
    if (content) {
      const usage = imageDb.prepare("SELECT COALESCE(SUM(length(content)), 0) AS bytes FROM menu_images WHERE operation_id = ?").get(operationId) as { bytes: number };
      if (usage.bytes + content.length > 100 * 1024 * 1024) throw new Error("Operation photo storage limit reached");
      imageDb.prepare("INSERT INTO menu_images VALUES (?, ?, ?)").run(imageId!, operationId, content);
    }
    const updated = { ...current, imageId };
    snapshot.menuItems = snapshot.menuItems.map(candidate => candidate.id === item.id ? updated : candidate);
    appendAuditLog(actorName(context), `${item.name} photo ${imageId ? "updated" : "removed"}`);
    publish();
    response.json(updated);
  } catch (error) {
    response.status(typeof (error as any)?.status === "number" ? (error as any).status : 400).json({ error: error instanceof Error ? error.message : "Image upload failed" });
  }
});

app.patch("/api/menu-items/:menuItemId/availability", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "vendor-manager", "store-operator", "prep"])) return;
    const input = menuAvailabilitySchema.parse(request.body);
    const menuItem = snapshot.menuItems.find((candidate) => candidate.id === request.params.menuItemId);

    if (!menuItem) {
      response.status(404).json({ error: "Menu item not found" });
      return;
    }
    if (!requireStoreAccess(response, context, menuItem.storeId)) return;

    const updated: MenuItem = { ...menuItem, available: input.available };
    snapshot.menuItems = snapshot.menuItems.map((candidate) => (candidate.id === updated.id ? updated : candidate));
    appendAuditLog(actorName(context), `${updated.name} marked ${updated.available ? "available" : "unavailable"}`);
    enqueueSync(`${updated.name} availability changed to ${updated.available ? "available" : "unavailable"}`);
    publish();
    response.json(updated);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid availability update" });
  }
});

app.post("/api/inventory/:stockItemId/adjustments", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "vendor-manager", "store-operator"])) return;
    const input = inventoryAdjustmentSchema.parse(request.body);
    const stockItem = snapshot.inventory.find((candidate) => candidate.id === request.params.stockItemId);

    if (!stockItem) {
      response.status(404).json({ error: "Inventory item not found" });
      return;
    }
    if (!requireStoreAccess(response, context, stockItem.storeId)) return;

    const movement: StockMovement = {
      id: id("stock"),
      stockItemId: stockItem.id,
      type: input.type,
      quantityDelta: input.quantityDelta,
      createdAt: new Date().toISOString(),
      note: input.note
    };

    snapshot.inventory = snapshot.inventory.map((candidate) =>
      candidate.id === stockItem.id
        ? { ...candidate, quantity: Math.max(0, candidate.quantity + input.quantityDelta) }
        : candidate
    );
    snapshot.stockMovements = [movement, ...snapshot.stockMovements];
    snapshot.menuItems = snapshot.menuItems.map((item) => {
      if (item.stockItemId !== stockItem.id) return item;
      const updatedStock = snapshot.inventory.find((candidate) => candidate.id === stockItem.id);
      return { ...item, available: Boolean(updatedStock && updatedStock.quantity > 0) };
    });

    appendAuditLog(actorName(context), `Recorded ${input.type} movement for ${stockItem.name}: ${input.quantityDelta}`);
    enqueueSync(`Inventory adjusted for ${stockItem.name}`);
    publish();
    response.status(201).json(movement);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid inventory adjustment" });
  }
});

app.post("/api/orders", (request, response) => {
  try {
    const context = getContext(request);
    const input = createOrderSchema.parse(request.body) as CreateOrderInput;
    if (snapshot.event.status !== "live") { response.status(409).json({ error: "Service is not open for new orders" }); return; }
    if (!operationContext.getStore()?.guest) input.createdBy = context.user.name;
    if (!input.lines.length) { response.status(422).json({ error: "Add at least one item" }); return; }
    if (input.entryToken) {
      const entry = management.resolveEntry(input.entryToken);
      if (!entry.open || entry.storeId !== input.storeId || entry.tableId !== input.tableId || entry.seatId !== input.seatId) {
        response.status(403).json({ error: "This QR destination is closed or has changed. Scan the current code." });
        return;
      }
    }
    const store = snapshot.stores.find((candidate) => candidate.id === input.storeId);
    if (!store) {
      response.status(404).json({ error: "Store not found" });
      return;
    }
    if (input.tableId && !snapshot.tables.some(t => t.id === input.tableId && t.storeId === store.id)) {
      response.status(422).json({ error: "Table does not belong to this storefront" }); return;
    }
    if (input.seatId && input.tableId && !snapshot.seats.some(s => s.id === input.seatId && s.tableId === input.tableId)) {
      response.status(422).json({ error: "Seat does not belong to this table" }); return;
    }
    if (input.origin !== "guest-self-order") {
      if (!requireRoles(response, context, ["admin", "waiter", "cashier"])) return;
      if (!requireStoreAccess(response, context, store.id)) return;
      if (context.user.role === "waiter" && input.tableId && context.assignment?.tableIds?.length && !context.assignment.tableIds.includes(input.tableId)) {
        response.status(403).json({ error: "Table is outside this waiter's assignment" });
        return;
      }
    }
    if (input.seatId && !canStoreServeSeat(store.id, input.seatId)) {
      response.status(403).json({ error: "This store is not available for the selected seat section" });
      return;
    }

    const now = new Date().toISOString();
    const period = currentOperatingPeriod();
    const seat = input.seatId ? snapshot.seats.find((candidate) => candidate.id === input.seatId) : undefined;
    const tableId = input.tableId ?? seat?.tableId;
    const lines = buildOrderLines(input);
    const baseTotals = calculateOrderTotals(lines, chargeRulesForStore(input.storeId), getActiveDeposits(tableId));
    const promotion = promotionForOrder(input.promotionCode, store.id);
    const customerProfile = profileForCustomer(input);
    const order: Order = {
      id: id("order"),
      eventId: snapshot.event.id,
      operatingPeriodId: period.id,
      storeId: input.storeId,
      tableId,
      seatId: seat?.id,
      origin: input.origin,
      status: store.manualConfirmation ? "sent" : "confirmed",
      customerName: input.customerName,
      customerProfileId: customerProfile?.id,
      promotionId: promotion?.id,
      createdBy: input.origin === "guest-self-order" ? input.createdBy : actorName(context),
      createdAt: now,
      updatedAt: now,
      lines,
      totals: promotion ? applyPromotion(baseTotals, promotion) : baseTotals,
      auditTrail: [
        {
          id: id("audit"),
          actor: input.origin === "guest-self-order" ? input.createdBy : actorName(context),
          action: `Created ${input.origin} order`,
          createdAt: now
        }
      ]
    };

    snapshot.orders = [order, ...snapshot.orders];
    const route = createDeliveryRouteForOrder(order);
    if (order.tableId) {
      snapshot.tables = snapshot.tables.map((table) =>
        table.id === order.tableId ? { ...table, status: "occupied" } : table
      );
    }
    if (order.seatId) {
      snapshot.seats = snapshot.seats.map((candidate) =>
        candidate.id === order.seatId ? { ...candidate, status: "occupied" } : candidate
      );
    }
    if (customerProfile) {
      snapshot.loyaltyAccounts = snapshot.loyaltyAccounts.map((account) =>
        account.customerProfileId === customerProfile.id
          ? { ...account, points: account.points + Math.max(1, Math.floor(order.totals.total / 1000)) }
          : account
      );
    }
    appendAuditLog(input.origin === "guest-self-order" ? input.createdBy : actorName(context), `Created ${input.origin} order ${order.id}`);
    if (route) {
      appendAuditLog("Hub", `Created delivery route ${route.id} for ${order.id}`);
    }
    if (order.status === "confirmed") {
      deductInventory(order);
    }
    enqueueSync(`Order ${order.id} created at ${store.name}`);
    publish();
    response.status(201).json(order);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid order" });
  }
});

app.patch("/api/orders/:orderId/status", (request, response) => {
  try {
    const context = getContext(request);
    const { status, actor } = statusSchema.parse(request.body);
    const order = snapshot.orders.find((candidate) => candidate.id === request.params.orderId);

    if (!order) {
      response.status(404).json({ error: "Order not found" });
      return;
    }
    if (!canAccessOrder(context, order)) {
      response.status(403).json({ error: "Order is outside this user's assignment" });
      return;
    }
    if (status === "settled" && !requireRoles(response, context, ["admin", "cashier"])) return;
    if (["confirmed", "preparing", "ready", "served", "void", "rejected"].includes(status) && !requireRoles(response, context, ["admin", "vendor-manager", "store-operator", "prep", "waiter"])) return;

    const wasConfirmed = order.status === "confirmed" || order.status === "preparing" || order.status === "ready" || order.status === "served" || order.status === "settled";
    const willConfirm = status === "confirmed" || status === "preparing" || status === "ready" || status === "served" || status === "settled";
    if (["settled", "void", "rejected"].includes(order.status)) { response.status(409).json({ error: "A terminal order cannot change status" }); return; }
    if (wasConfirmed && ["draft", "sent"].includes(status)) { response.status(409).json({ error: "A confirmed order cannot return to draft" }); return; }
    if (status === "settled" && snapshot.payments.filter(p => p.orderId === order.id && ["validated", "manually-confirmed"].includes(p.status)).reduce((sum, p) => sum + p.amount, 0) < order.totals.total) {
      response.status(409).json({ error: "Record payment before settling this order" }); return;
    }
    if (!wasConfirmed && willConfirm) buildOrderLines({ storeId: order.storeId, origin: order.origin, createdBy: context.user.name, lines: order.lines });
    const updated = appendAudit({ ...order, status: status as OrderStatus }, actorName(context), `Moved order to ${status}`);

    snapshot.orders = snapshot.orders.map((candidate) => (candidate.id === order.id ? updated : candidate));
    appendAuditLog(actorName(context), `Moved order ${order.id} to ${status}`);

    if (!wasConfirmed && willConfirm) {
      deductInventory(updated);
    }

    enqueueSync(`Order ${order.id} moved to ${status}`);
    publish();
    response.json(updated);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid status update" });
  }
});

app.get("/api/runner/routes", (request, response) => {
  const context = getContext(request);
  if (!requireRoles(response, context, ["admin", "runner", "waiter", "cashier", "vendor-manager", "store-operator", "prep"])) return;
  const scoped = scopeSnapshot(snapshot, context);
  response.json(scoped.deliveryRoutes.map((route) => ({
    ...route,
    order: scoped.orders.find((order) => order.id === route.orderId),
    seat: scoped.seats.find((seat) => seat.id === route.seatId),
    section: scoped.sections.find((section) => section.id === route.sectionId)
  })));
});

app.patch("/api/delivery-routes/:routeId/status", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "runner", "waiter", "cashier"])) return;
    const input = deliveryStatusSchema.parse(request.body);
    const route = snapshot.deliveryRoutes.find((candidate) => candidate.id === request.params.routeId);
    if (!route) {
      response.status(404).json({ error: "Delivery route not found" });
      return;
    }
    const order = snapshot.orders.find((candidate) => candidate.id === route.orderId);
    if (!order || !canAccessOrder(context, order)) {
      response.status(403).json({ error: "Delivery route is outside this user's assignment" });
      return;
    }

    const now = new Date().toISOString();
    const updated: DeliveryRoute = {
      ...route,
      status: input.status,
      runnerUserId: input.runnerUserId ?? route.runnerUserId ?? context.user.id,
      updatedAt: now,
      pickedUpAt: input.status === "picked-up" ? now : route.pickedUpAt,
      deliveredAt: input.status === "delivered" ? now : route.deliveredAt,
      notes: input.notes ?? route.notes
    };
    snapshot.deliveryRoutes = snapshot.deliveryRoutes.map((candidate) => candidate.id === updated.id ? updated : candidate);
    snapshot.orders = snapshot.orders.map((candidate) =>
      candidate.id === order.id
        ? appendAudit({ ...candidate, deliveryStatus: updated.status, status: updated.status === "delivered" ? "served" : candidate.status }, actorName(context), `Delivery ${updated.status}`)
        : candidate
    );
    if (updated.status === "delivered" && updated.seatId) {
      snapshot.seats = snapshot.seats.map((seat) => seat.id === updated.seatId ? { ...seat, status: "available" } : seat);
    }
    snapshot.runnerAssignments = snapshot.runnerAssignments.map((assignment) =>
      assignment.userId === updated.runnerUserId
        ? { ...assignment, status: updated.status === "delivered" || updated.status === "issue" ? "available" : "busy" }
        : assignment
    );
    appendAuditLog(actorName(context), `Updated delivery route ${updated.id} to ${updated.status}`);
    enqueueSync(`Delivery route ${updated.id} updated to ${updated.status}`);
    publish();
    response.json(updated);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid route status" });
  }
});

app.get("/api/customers/history", (request, response) => {
  const context = getContext(request);
  if (!requireRoles(response, context, ["admin", "cashier", "waiter"])) return;
  const phone = String(request.query.phone ?? "").trim();
  if (!phone) {
    response.status(400).json({ error: "phone query is required" });
    return;
  }
  const profile = snapshot.customerProfiles.find((candidate) => candidate.phone === phone && candidate.consent);
  if (!profile) {
    response.json({ profile: null, loyalty: null, orders: [] });
    return;
  }
  const scoped = scopeSnapshot(snapshot, context);
  response.json({
    profile,
    loyalty: snapshot.loyaltyAccounts.find((account) => account.customerProfileId === profile.id) ?? null,
    orders: scoped.orders.filter((order) => order.customerProfileId === profile.id).slice(0, 20)
  });
});

app.get("/api/reports/advanced", (request, response) => {
  const context = getContext(request);
  if (!requireRoles(response, context, ["admin", "vendor-manager", "cashier"])) return;
  const scoped = scopeSnapshot(snapshot, context);
  const metrics = updateForecastMetrics();
  const itemPerformance = scoped.menuItems.map((item) => {
    const quantity = scoped.orders.reduce((sum, order) =>
      sum + order.lines.filter((line) => line.menuItemId === item.id).reduce((lineSum, line) => lineSum + line.quantity, 0), 0);
    return {
      itemId: item.id,
      itemName: item.name,
      storeId: item.storeId,
      quantity,
      revenue: quantity * item.price
    };
  }).sort((a, b) => b.quantity - a.quantity);
  const vendorComparison = scoped.vendors.map((vendor) => {
    const storeIds = scoped.stores.filter((store) => store.vendorId === vendor.id).map((store) => store.id);
    return {
      vendorId: vendor.id,
      vendorName: vendor.name,
      orders: scoped.orders.filter((order) => storeIds.includes(order.storeId)).length,
      revenue: scoped.orders.filter((order) => storeIds.includes(order.storeId)).reduce((sum, order) => sum + order.totals.total, 0)
    };
  });
  const routeStatus = scoped.deliveryRoutes.reduce<Record<string, number>>((totals, route) => {
    totals[route.status] = (totals[route.status] ?? 0) + 1;
    return totals;
  }, {});

  response.json({
    itemPerformance,
    vendorComparison,
    routeStatus,
    customerProfiles: scoped.customerProfiles.length,
    repeatCustomers: scoped.customerProfiles.filter((profile) => scoped.orders.filter((order) => order.customerProfileId === profile.id).length > 1).length,
    forecastMetrics: metrics
  });
});

app.post("/api/payments", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "cashier"])) return;
    const input = paymentSchema.parse(request.body) as RecordPaymentInput;
    const order = snapshot.orders.find((candidate) => candidate.id === input.orderId);

    if (!order) {
      response.status(404).json({ error: "Order not found" });
      return;
    }
    if (!canAccessOrder(context, order)) {
      response.status(403).json({ error: "Order is outside this user's assignment" });
      return;
    }

    const store = snapshot.stores.find((candidate) => candidate.id === order.storeId);
    if (!store) {
      response.status(400).json({ error: "Order store missing" });
      return;
    }
    if (input.gatewayReference) {
      const existing = snapshot.payments.find((candidate) => candidate.gatewayReference === input.gatewayReference);
      if (existing) {
        response.json(existing);
        return;
      }
    }

    const status: Payment["status"] =
      input.method === "paga-card" || input.method === "paga-transfer"
        ? "pending-network"
        : input.method === "cash" || input.method === "deposit-offset"
          ? "validated"
          : "manually-confirmed";

    const payment: Payment = {
      id: id("payment"),
      orderId: order.id,
      eventId: order.eventId,
      operatingPeriodId: order.operatingPeriodId,
      storeId: order.storeId,
      vendorId: store.vendorId,
      amount: input.amount,
      method: input.method,
      status,
      gatewayReference: input.gatewayReference,
      confirmedBy: actorName(context),
      note: input.note,
      createdAt: new Date().toISOString()
    };

    snapshot.payments = [payment, ...snapshot.payments];
    createPaymentConfirmation(
      payment,
      actorName(context),
      status === "pending-network" ? "pending" : "confirmed",
      input.note
    );
    createLedgerEntriesForPayment(payment, order);

    if (payment.method === "cash" && payment.status === "validated") {
      activeRegisterSession(context);
    }

    if (input.method === "deposit-offset" && order.tableId) {
      let remaining = input.amount;
      snapshot.deposits = snapshot.deposits.map((deposit) => {
        if (deposit.tableId !== order.tableId || deposit.status !== "active" || remaining <= 0) return deposit;
        remaining -= deposit.amount;
        return {
          ...deposit,
          status: "applied",
          appliedOrderId: order.id
        };
      });
    }

    settleOrderIfPaid(order);

    appendAuditLog(actorName(context), `Recorded ${input.method} payment for ${order.id}`);
    enqueueSync(
      status === "pending-network"
        ? `Paga confirmation pending for ${order.id}`
        : `Payment recorded for ${order.id}`,
      status === "pending-network" ? "paga-confirmation" : "cloud-sync"
    );
    publish();
    response.status(201).json(payment);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid payment" });
  }
});

app.post("/api/payments/provider-events/paga", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "cashier"])) return;
    const input = providerEventSchema.parse(request.body);

    const existingEvent = snapshot.paymentProviderEvents.find((event) =>
      event.provider === "paga" && event.providerReference === input.providerReference && event.eventType === input.eventType
    );
    if (existingEvent) {
      response.json(existingEvent);
      return;
    }

    const payment = input.paymentId
      ? snapshot.payments.find((candidate) => candidate.id === input.paymentId)
      : snapshot.payments.find((candidate) => candidate.gatewayReference === input.providerReference);

    const providerEvent: PaymentProviderEvent = {
      id: id("provider"),
      provider: "paga",
      eventType: input.eventType,
      providerReference: input.providerReference,
      paymentId: payment?.id,
      status: payment ? "processed" : "received",
      receivedAt: new Date().toISOString(),
      processedAt: payment ? new Date().toISOString() : undefined,
      payload: input.payload
    };
    snapshot.paymentProviderEvents = [providerEvent, ...snapshot.paymentProviderEvents];

    if (payment && input.status === "confirmed") {
      const updatedPayment: Payment = { ...payment, status: "validated" };
      snapshot.payments = snapshot.payments.map((candidate) => candidate.id === payment.id ? updatedPayment : candidate);
      const order = snapshot.orders.find((candidate) => candidate.id === payment.orderId);
      if (order) {
        createPaymentConfirmation(updatedPayment, "Paga", "confirmed", input.eventType);
        createLedgerEntriesForPayment(updatedPayment, order);
        settleOrderIfPaid(order);
      }
    }

    appendAuditLog(actorName(context), `Processed Paga event ${input.eventType}`);
    enqueueSync(`Paga provider event ${input.providerReference} processed`, "paga-confirmation");
    publish();
    response.status(201).json(providerEvent);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid provider event" });
  }
});

app.get("/api/ledger/entries", (request, response) => {
  const context = getContext(request);
  if (!requireRoles(response, context, ["admin", "vendor-manager", "cashier"])) return;
  const vendorId = String(request.query.vendorId ?? "");
  const scoped = scopeSnapshot(snapshot, context);
  response.json(vendorId ? scoped.ledgerEntries.filter((entry) => entry.vendorId === vendorId) : scoped.ledgerEntries);
});

app.get("/api/reports/settlement", (request, response) => {
  const context = getContext(request);
  if (!requireRoles(response, context, ["admin", "vendor-manager", "cashier"])) return;
  const vendorId = request.query.vendorId ? String(request.query.vendorId) : undefined;
  response.json(settlementReport(context, vendorId));
});

app.post("/api/settlement-batches", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin"])) return;
    const input = settlementBatchSchema.parse(request.body);
    const report = settlementReport(context, input.vendorId)[0];
    if (!report) {
      response.status(404).json({ error: "Vendor settlement report not found" });
      return;
    }

    const batch: SettlementBatch = {
      id: id("settlement"),
      vendorId: input.vendorId,
      status: "draft",
      total: Math.max(0, report.balance),
      createdAt: new Date().toISOString(),
      notes: input.notes
    };
    snapshot.settlementBatches = [batch, ...snapshot.settlementBatches];
    appendAuditLog(actorName(context), `Created settlement batch for ${report.vendorName}`);
    publish();
    response.status(201).json(batch);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid settlement batch" });
  }
});

app.post("/api/settlement-batches/:batchId/payout", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin"])) return;
    const input = payoutSchema.parse(request.body);
    const batch = snapshot.settlementBatches.find((candidate) => candidate.id === request.params.batchId);
    if (!batch) {
      response.status(404).json({ error: "Settlement batch not found" });
      return;
    }

    const payout = {
      id: id("payout"),
      settlementBatchId: batch.id,
      vendorId: batch.vendorId,
      amount: batch.total,
      method: input.method,
      status: "paid" as const,
      createdAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
      reference: input.reference
    };
    const account = ledgerAccountForVendor(batch.vendorId);
    snapshot.payouts = [payout, ...snapshot.payouts];
    snapshot.settlementBatches = snapshot.settlementBatches.map((candidate) =>
      candidate.id === batch.id ? { ...candidate, status: "paid", paidAt: payout.paidAt } : candidate
    );
    snapshot.ledgerEntries = [
      {
        id: id("ledger"),
        accountId: account.id,
        vendorId: batch.vendorId,
        eventId: snapshot.event.id,
        settlementBatchId: batch.id,
        type: "payout",
        direction: "debit",
        amount: batch.total,
        memo: `Payout for settlement ${batch.id}`,
        createdAt: payout.paidAt
      },
      ...snapshot.ledgerEntries
    ];
    appendAuditLog(actorName(context), `Marked settlement ${batch.id} paid`);
    publish();
    response.status(201).json(payout);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid payout" });
  }
});

app.patch("/api/register-sessions/:registerId/close", (request, response) => {
  try {
    const context = getContext(request);
    if (!requireRoles(response, context, ["admin", "cashier"])) return;
    const input = closeRegisterSchema.parse(request.body);
    const register = snapshot.registerSessions.find((candidate) => candidate.id === request.params.registerId);
    if (!register) {
      response.status(404).json({ error: "Register session not found" });
      return;
    }
    const expectedCash = register.openingCash + expectedCashForPeriod(register.operatingPeriodId);
    const closed: RegisterSession = {
      ...register,
      status: "closed",
      closedAt: new Date().toISOString(),
      closedBy: actorName(context),
      declaredCash: input.declaredCash,
      expectedCash,
      variance: input.declaredCash - expectedCash,
      notes: input.notes
    };
    snapshot.registerSessions = snapshot.registerSessions.map((candidate) => candidate.id === closed.id ? closed : candidate);
    appendAuditLog(actorName(context), `Closed register ${closed.id} with variance ${closed.variance ?? 0}`);
    publish();
    response.json(closed);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid register close" });
  }
});

// Authenticated same-origin polling replaces the legacy caller-selected socket identity.
io.use((_socket, next) => next(new Error("Use the authenticated service API")));

httpServer.listen(port, host, () => {
  const address = httpServer.address();
  console.log(`EXA FOH local hub running on http://${host}:${typeof address === "object" && address ? address.port : port}`);
});
