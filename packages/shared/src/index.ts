export * from "./management.js";
export * from "./guest-branding.js";

export type Id = string;

export type CurrencyCode = "NGN";

export type Vendor = {
  id: Id;
  name: string;
  kind: "organizer" | "third-party";
};

export type RoleName = "admin" | "vendor-manager" | "store-operator" | "prep" | "waiter" | "cashier" | "runner";

export type User = {
  id: Id;
  name: string;
  role: RoleName;
  status: "active" | "disabled";
};

export type StaffAssignment = {
  id: Id;
  userId: Id;
  vendorId?: Id;
  storeIds: Id[];
  tableIds?: Id[];
};

export type DeviceSession = {
  id: Id;
  userId: Id;
  deviceName: string;
  role: RoleName;
  storeId?: Id;
  createdAt: string;
  lastSeenAt: string;
};

export type Event = {
  guestBranding?: import("./guest-branding.js").GuestBranding;
  id: Id;
  name: string;
  venue: string;
  dateLabel: string;
  currency: CurrencyCode;
  containerType: "event" | "venue";
  status: "setup" | "live" | "closed" | "archived" | "paused";
  reportingCadence: "event-closeout" | "shift" | "daily" | "weekly" | "monthly";
  defaultChargeRuleIds: Id[];
};

export type OperatingPeriod = {
  id: Id;
  eventId: Id;
  type: "event-run" | "venue-day" | "shift" | "register-session";
  label: string;
  status: "open" | "closed";
  openedAt: string;
  openedBy: string;
  closedAt?: string;
  closedBy?: string;
  openingCash?: number;
  closingCash?: number;
  notes?: string;
};

export type ChargeRule = {
  id: Id;
  name: string;
  type: "vat" | "consumption-tax" | "service-charge" | "custom";
  rate: number;
  scope: "event" | "store";
  appliesTo: "subtotal" | "running-total";
  sortOrder: number;
};

export type Store = {
  id: Id;
  eventId: Id;
  vendorId: Id;
  name: string;
  kind: "bar" | "kitchen" | "bottle-service" | "merch";
  chargeRuleIds?: Id[];
  manualConfirmation: boolean;
  prepStation?: string;
  fulfillment?: "pickup" | "table" | "seat";
};

export type Table = {
  id: Id;
  storeId: Id;
  label: string;
  section: string;
  status: "open" | "occupied" | "settled";
  assignedWaiter: string;
};

export type Section = {
  id: Id;
  eventId: Id;
  label: string;
  zone: string;
  storeIds: Id[];
};

export type Seat = {
  id: Id;
  sectionId: Id;
  label: string;
  row?: string;
  seatNumber?: string;
  tableId?: Id;
  status: "available" | "occupied" | "blocked";
};

export type MenuCategory = "Drinks" | "Food" | "Bottle Service" | "Merch";

export type MenuItem = {
  description?: string;
  menuSection?: string;
  imageId?: string;
  id: Id;
  storeId: Id;
  name: string;
  category: MenuCategory;
  price: number;
  stockItemId: Id;
  available: boolean;
  modifiers?: Modifier[];
};

export type Modifier = {
  id: Id;
  label: string;
  priceDelta: number;
};

export type InventoryItem = {
  id: Id;
  storeId: Id;
  name: string;
  unit: string;
  quantity: number;
  lowStockThreshold: number;
};

export type StockMovement = {
  id: Id;
  stockItemId: Id;
  orderId?: Id;
  type: "sale" | "waste" | "restock" | "transfer";
  quantityDelta: number;
  createdAt: string;
  note: string;
};

export type Deposit = {
  id: Id;
  tableId: Id;
  amount: number;
  status: "active" | "applied" | "refunded";
  paymentReference: string;
  createdAt: string;
  appliedOrderId?: Id;
};

export type OrderOrigin = "waiter" | "cashier" | "guest-self-order";

export type OrderStatus =
  | "draft"
  | "sent"
  | "confirmed"
  | "preparing"
  | "ready"
  | "served"
  | "settled"
  | "void"
  | "rejected";

export type OrderLine = {
  id: Id;
  menuItemId: Id;
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: Modifier[];
};

export type Order = {
  id: Id;
  eventId: Id;
  operatingPeriodId?: Id;
  storeId: Id;
  tableId?: Id;
  seatId?: Id;
  origin: OrderOrigin;
  status: OrderStatus;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerId?: string;
  customerLinkStatus?: "created" | "matched" | "anonymous" | "conflict";
  customerProfileId?: Id;
  promotionId?: Id;
  deliveryStatus?: DeliveryRoute["status"];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lines: OrderLine[];
  totals: OrderTotals;
  auditTrail: AuditEntry[];
};

export type PaymentMethod = "cash" | "pos" | "bank-transfer" | "paga-card" | "paga-transfer" | "deposit-offset";

export type Payment = {
  id: Id;
  orderId: Id;
  eventId: Id;
  operatingPeriodId?: Id;
  storeId: Id;
  vendorId: Id;
  amount: number;
  method: PaymentMethod;
  status: "pending-network" | "validated" | "failed" | "manually-confirmed";
  gatewayReference?: string;
  confirmedBy?: string;
  note?: string;
  createdAt: string;
};

export type PaymentConfirmation = {
  id: Id;
  paymentId: Id;
  source: "gateway" | "pos-terminal" | "staff-transfer" | "staff-pos" | "staff-cash" | "system-deposit";
  status: "confirmed" | "failed" | "pending";
  confirmedAt: string;
  confirmedBy: string;
  providerReference?: string;
  note?: string;
};

export type PaymentProviderEvent = {
  id: Id;
  provider: "paga" | "manual-pos" | "manual-transfer";
  eventType: string;
  providerReference: string;
  paymentId?: Id;
  status: "received" | "processed" | "ignored" | "failed";
  receivedAt: string;
  processedAt?: string;
  payload: Record<string, unknown>;
};

export type VendorLedgerAccount = {
  id: Id;
  vendorId: Id;
  currency: CurrencyCode;
  status: "active" | "closed";
};

export type LedgerEntry = {
  id: Id;
  accountId: Id;
  vendorId: Id;
  eventId: Id;
  operatingPeriodId?: Id;
  orderId?: Id;
  paymentId?: Id;
  settlementBatchId?: Id;
  type: "revenue" | "deposit-offset" | "platform-fee" | "refund" | "payout" | "manual-adjustment";
  direction: "credit" | "debit";
  amount: number;
  memo: string;
  createdAt: string;
};

export type RegisterSession = {
  id: Id;
  operatingPeriodId?: Id;
  cashierUserId?: Id;
  status: "open" | "closed";
  openedAt: string;
  openedBy: string;
  openingCash: number;
  closedAt?: string;
  closedBy?: string;
  declaredCash?: number;
  expectedCash?: number;
  variance?: number;
  notes?: string;
};

export type SettlementBatch = {
  id: Id;
  vendorId: Id;
  status: "draft" | "approved" | "paid";
  total: number;
  createdAt: string;
  approvedAt?: string;
  paidAt?: string;
  notes?: string;
};

export type Payout = {
  id: Id;
  settlementBatchId: Id;
  vendorId: Id;
  amount: number;
  method: "manual-transfer" | "paga-payout";
  status: "pending" | "paid" | "failed";
  createdAt: string;
  paidAt?: string;
  reference?: string;
};

export type RunnerAssignment = {
  id: Id;
  userId: Id;
  name: string;
  zone: string;
  sectionIds: Id[];
  status: "available" | "busy" | "off-duty";
};

export type DeliveryRoute = {
  id: Id;
  orderId: Id;
  seatId?: Id;
  sectionId?: Id;
  runnerUserId?: Id;
  status: "queued" | "assigned" | "picked-up" | "delivered" | "issue";
  createdAt: string;
  updatedAt: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  notes?: string;
};

export type CustomerProfile = {
  id: Id;
  name?: string;
  phone?: string;
  consent: boolean;
  createdAt: string;
  lastSeenAt: string;
};

export type LoyaltyAccount = {
  id: Id;
  customerProfileId: Id;
  points: number;
  status: "active" | "paused";
};

export type Promotion = {
  id: Id;
  code: string;
  label: string;
  type: "percentage" | "fixed";
  value: number;
  scope: "event" | "store";
  storeId?: Id;
  active: boolean;
  startsAt?: string;
  endsAt?: string;
};

export type ForecastMetric = {
  id: Id;
  scope: "event" | "store" | "item";
  subjectId: Id;
  label: string;
  value: number;
  unit: string;
  generatedAt: string;
};

export type AuditEntry = {
  id: Id;
  actor: string;
  action: string;
  createdAt: string;
};

export type OrderTotals = {
  subtotal: number;
  charges: ChargeLine[];
  depositApplied: number;
  total: number;
  balanceDue: number;
};

export type ChargeLine = {
  chargeRuleId: Id;
  name: string;
  amount: number;
};

export type HubSnapshot = {
  onlinePermissions?: Record<string, string[]>;
  event: Event;
  operatingPeriods: OperatingPeriod[];
  vendors: Vendor[];
  users: User[];
  staffAssignments: StaffAssignment[];
  deviceSessions: DeviceSession[];
  stores: Store[];
  tables: Table[];
  sections: Section[];
  seats: Seat[];
  menuItems: MenuItem[];
  inventory: InventoryItem[];
  deposits: Deposit[];
  orders: Order[];
  payments: Payment[];
  paymentConfirmations: PaymentConfirmation[];
  paymentProviderEvents: PaymentProviderEvent[];
  vendorLedgerAccounts: VendorLedgerAccount[];
  ledgerEntries: LedgerEntry[];
  registerSessions: RegisterSession[];
  settlementBatches: SettlementBatch[];
  payouts: Payout[];
  runnerAssignments: RunnerAssignment[];
  deliveryRoutes: DeliveryRoute[];
  customerProfiles: CustomerProfile[];
  loyaltyAccounts: LoyaltyAccount[];
  promotions: Promotion[];
  forecastMetrics: ForecastMetric[];
  chargeRules: ChargeRule[];
  stockMovements: StockMovement[];
  auditLog: AuditEntry[];
  syncQueue: SyncQueueItem[];
};

export type SyncQueueItem = {
  id: Id;
  kind: "cloud-sync" | "paga-confirmation" | "cloud-backup";
  status: "queued" | "sent" | "failed";
  summary: string;
  createdAt: string;
  updatedAt?: string;
  attempts?: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  cloudId?: string;
  error?: string;
};

export type CloudSyncStatus = {
  configured: boolean;
  cloudUrl?: string;
  tenantId: string;
  organizationId: string;
  sourceHubId: string;
  queued: number;
  sent: number;
  failed: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  nextRetryAt?: string;
  lastError?: string;
};

export type CloudIngestSummary = {
  runId: Id;
  status: "accepted" | "replayed";
  recordsReceived: number;
  recordsUpserted: number;
  backupId: Id;
  receivedAt: string;
};

export type CreateOrderInput = {
  entryToken?: string;
  storeId: Id;
  tableId?: Id;
  origin: OrderOrigin;
  customerName?: string;
  customerPhone?: string;
  seatId?: Id;
  promotionCode?: string;
  createdBy: string;
  lines: Array<{
    menuItemId: Id;
    quantity: number;
    modifierIds?: Id[];
  }>;
};

export type RecordPaymentInput = {
  orderId: Id;
  amount: number;
  method: PaymentMethod;
  gatewayReference?: string;
  confirmedBy?: string;
  note?: string;
};

export function formatNaira(amount: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0
  }).format(amount);
}

export function calculateOrderTotals(
  lines: OrderLine[],
  chargeRules: ChargeRule[],
  activeDeposits: Deposit[] = []
): OrderTotals {
  const subtotal = lines.reduce((sum, line) => {
    const modifierTotal = line.modifiers.reduce((modSum, modifier) => modSum + modifier.priceDelta, 0);
    return sum + (line.unitPrice + modifierTotal) * line.quantity;
  }, 0);

  const charges: ChargeLine[] = [];
  let runningTotal = subtotal;

  for (const rule of [...chargeRules].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const base = rule.appliesTo === "running-total" ? runningTotal : subtotal;
    const amount = Math.round(base * rule.rate);
    charges.push({
      chargeRuleId: rule.id,
      name: rule.name,
      amount
    });
    runningTotal += amount;
  }

  const depositApplied = Math.min(
    activeDeposits.reduce((sum, deposit) => sum + deposit.amount, 0),
    runningTotal
  );

  return {
    subtotal,
    charges,
    depositApplied,
    total: runningTotal,
    balanceDue: runningTotal - depositApplied
  };
}

export function createSeedSnapshot(now = new Date().toISOString()): HubSnapshot {
  const event: Event = {
    id: "event-exa-launch-night",
    name: "EXA Launch Night",
    venue: "Harbour Point, Lagos",
    dateLabel: "Tonight",
    currency: "NGN",
    containerType: "event",
    status: "live",
    reportingCadence: "event-closeout",
    defaultChargeRuleIds: ["charge-consumption", "charge-service", "charge-vat"]
  };

  const operatingPeriods: OperatingPeriod[] = [
    {
      id: "period-exa-launch-run",
      eventId: event.id,
      type: "event-run",
      label: "EXA Launch Night Run",
      status: "open",
      openedAt: now,
      openedBy: "System",
      openingCash: 0
    }
  ];

  const vendors: Vendor[] = [
    { id: "vendor-exa", name: "EXA Hospitality", kind: "organizer" },
    { id: "vendor-smokehaus", name: "Smokehaus Grill", kind: "third-party" }
  ];

  const vendorLedgerAccounts: VendorLedgerAccount[] = vendors.map((vendor) => ({
    id: `ledger-${vendor.id}`,
    vendorId: vendor.id,
    currency: "NGN",
    status: "active"
  }));

  const users: User[] = [
    { id: "user-admin", name: "EXA Admin", role: "admin", status: "active" },
    { id: "user-vendor-main-bar", name: "Main Bar Manager", role: "vendor-manager", status: "active" },
    { id: "user-prep-main-bar", name: "Main Bar Prep", role: "prep", status: "active" },
    { id: "user-waiter-tomi", name: "Tomi Waiter", role: "waiter", status: "active" },
    { id: "user-cashier", name: "Floor Cashier", role: "cashier", status: "active" },
    { id: "user-runner-ade", name: "Ade Runner", role: "runner", status: "active" },
    { id: "user-vendor-grill", name: "Smokehaus Manager", role: "vendor-manager", status: "active" }
  ];

  const stores: Store[] = [
    {
      id: "store-main-bar",
      eventId: event.id,
      vendorId: "vendor-exa",
      name: "Main Bar",
      kind: "bar",
      manualConfirmation: true
    },
    {
      id: "store-grill",
      eventId: event.id,
      vendorId: "vendor-smokehaus",
      name: "Grill Station",
      kind: "kitchen",
      manualConfirmation: true
    }
  ];

  const staffAssignments: StaffAssignment[] = [
    { id: "assign-admin", userId: "user-admin", storeIds: [] },
    { id: "assign-main-bar-manager", userId: "user-vendor-main-bar", vendorId: "vendor-exa", storeIds: ["store-main-bar"] },
    { id: "assign-main-bar-prep", userId: "user-prep-main-bar", vendorId: "vendor-exa", storeIds: ["store-main-bar"] },
    { id: "assign-tomi", userId: "user-waiter-tomi", vendorId: "vendor-exa", storeIds: ["store-main-bar"], tableIds: ["table-14"] },
    { id: "assign-cashier", userId: "user-cashier", vendorId: "vendor-exa", storeIds: ["store-main-bar", "store-grill"] },
    { id: "assign-runner-ade", userId: "user-runner-ade", vendorId: "vendor-exa", storeIds: ["store-main-bar", "store-grill"], tableIds: ["table-14", "table-09"] },
    { id: "assign-grill-manager", userId: "user-vendor-grill", vendorId: "vendor-smokehaus", storeIds: ["store-grill"] }
  ];

  const chargeRules: ChargeRule[] = [
    {
      id: "charge-consumption",
      name: "Consumption Tax",
      type: "consumption-tax",
      rate: 0.05,
      scope: "event",
      appliesTo: "subtotal",
      sortOrder: 10
    },
    {
      id: "charge-service",
      name: "Service Charge",
      type: "service-charge",
      rate: 0.1,
      scope: "event",
      appliesTo: "subtotal",
      sortOrder: 20
    },
    {
      id: "charge-vat",
      name: "VAT",
      type: "vat",
      rate: 0.075,
      scope: "event",
      appliesTo: "running-total",
      sortOrder: 30
    }
  ];

  const tables: Table[] = [
    { id: "table-14", storeId: "store-main-bar", label: "Table 14", section: "VIP", status: "occupied", assignedWaiter: "Tomi" },
    { id: "table-09", storeId: "store-main-bar", label: "Table 9", section: "Terrace", status: "open", assignedWaiter: "Ife" },
    { id: "table-g1", storeId: "store-grill", label: "Grill Counter", section: "Walk-up", status: "open", assignedWaiter: "Counter" }
  ];

  const sections: Section[] = [
    { id: "section-vip", eventId: event.id, label: "VIP Bowl", zone: "VIP", storeIds: ["store-main-bar", "store-grill"] },
    { id: "section-terrace", eventId: event.id, label: "Terrace", zone: "Terrace", storeIds: ["store-main-bar"] },
    { id: "section-walkup", eventId: event.id, label: "Walk-up Counter", zone: "Counter", storeIds: ["store-main-bar", "store-grill"] }
  ];

  const seats: Seat[] = [
    { id: "seat-vip-a1", sectionId: "section-vip", label: "VIP A1", row: "A", seatNumber: "1", tableId: "table-14", status: "occupied" },
    { id: "seat-vip-a2", sectionId: "section-vip", label: "VIP A2", row: "A", seatNumber: "2", tableId: "table-14", status: "available" },
    { id: "seat-terrace-b4", sectionId: "section-terrace", label: "Terrace B4", row: "B", seatNumber: "4", tableId: "table-09", status: "available" },
    { id: "seat-counter-1", sectionId: "section-walkup", label: "Counter 1", row: "C", seatNumber: "1", tableId: "table-g1", status: "available" }
  ];

  const inventory: InventoryItem[] = [
    { id: "stock-moet", storeId: "store-main-bar", name: "Moet Brut 75cl", unit: "bottles", quantity: 18, lowStockThreshold: 6 },
    { id: "stock-heineken", storeId: "store-main-bar", name: "Heineken 33cl", unit: "bottles", quantity: 96, lowStockThreshold: 24 },
    { id: "stock-water", storeId: "store-main-bar", name: "Still Water", unit: "bottles", quantity: 12, lowStockThreshold: 18 },
    { id: "stock-jollof", storeId: "store-grill", name: "Jollof Rice Plate", unit: "plates", quantity: 42, lowStockThreshold: 12 },
    { id: "stock-suya", storeId: "store-grill", name: "Beef Suya", unit: "plates", quantity: 8, lowStockThreshold: 10 }
  ];

  const menuItems: MenuItem[] = [
    { id: "item-moet", storeId: "store-main-bar", name: "Moet Brut", category: "Bottle Service", price: 150000, stockItemId: "stock-moet", available: true },
    { id: "item-heineken", storeId: "store-main-bar", name: "Heineken 33cl", category: "Drinks", price: 3500, stockItemId: "stock-heineken", available: true },
    { id: "item-water", storeId: "store-main-bar", name: "Still Water", category: "Drinks", price: 1500, stockItemId: "stock-water", available: true },
    { id: "item-jollof", storeId: "store-grill", name: "Jollof Rice Plate", category: "Food", price: 9500, stockItemId: "stock-jollof", available: true },
    { id: "item-suya", storeId: "store-grill", name: "Beef Suya", category: "Food", price: 12000, stockItemId: "stock-suya", available: true }
  ];

  const deposits: Deposit[] = [
    {
      id: "deposit-table-14",
      tableId: "table-14",
      amount: 500000,
      status: "active",
      paymentReference: "DEP-EXA-0014",
      createdAt: now
    }
  ];

  const seedLine: OrderLine = {
    id: "line-seed-1",
    menuItemId: "item-moet",
    name: "Moet Brut",
    quantity: 2,
    unitPrice: 150000,
    modifiers: []
  };

  const orders: Order[] = [
    {
      id: "order-seed-vip",
      eventId: event.id,
      operatingPeriodId: "period-exa-launch-run",
      storeId: "store-main-bar",
      tableId: "table-14",
      seatId: "seat-vip-a1",
      origin: "waiter",
      status: "preparing",
      customerName: "VIP Table",
      deliveryStatus: "assigned",
      createdBy: "Tomi",
      createdAt: now,
      updatedAt: now,
      lines: [seedLine],
      totals: calculateOrderTotals([seedLine], chargeRules, deposits),
      auditTrail: [
        { id: "audit-seed-1", actor: "Tomi", action: "Created order", createdAt: now },
        { id: "audit-seed-2", actor: "Main Bar", action: "Confirmed order", createdAt: now }
      ]
    }
  ];

  const runnerAssignments: RunnerAssignment[] = [
    {
      id: "runner-ade-vip",
      userId: "user-runner-ade",
      name: "Ade Runner",
      zone: "VIP",
      sectionIds: ["section-vip", "section-terrace"],
      status: "available"
    }
  ];

  const deliveryRoutes: DeliveryRoute[] = [
    {
      id: "route-seed-vip",
      orderId: "order-seed-vip",
      seatId: "seat-vip-a1",
      sectionId: "section-vip",
      runnerUserId: "user-runner-ade",
      status: "assigned",
      createdAt: now,
      updatedAt: now
    }
  ];

  const customerProfiles: CustomerProfile[] = [
    {
      id: "customer-demo-ada",
      name: "Ada",
      phone: "08000000000",
      consent: true,
      createdAt: now,
      lastSeenAt: now
    }
  ];

  const loyaltyAccounts: LoyaltyAccount[] = [
    { id: "loyalty-demo-ada", customerProfileId: "customer-demo-ada", points: 120, status: "active" }
  ];

  const promotions: Promotion[] = [
    {
      id: "promo-welcome10",
      code: "WELCOME10",
      label: "Welcome 10%",
      type: "percentage",
      value: 0.1,
      scope: "event",
      active: true
    }
  ];

  const forecastMetrics: ForecastMetric[] = [
    {
      id: "forecast-peak-drinks",
      scope: "store",
      subjectId: "store-main-bar",
      label: "Expected drinks peak",
      value: 21,
      unit: "hour",
      generatedAt: now
    }
  ];

  return {
    event,
    operatingPeriods,
    vendors,
    users,
    staffAssignments,
    deviceSessions: [],
    stores,
    tables,
    sections,
    seats,
    menuItems,
    inventory,
    deposits,
    orders,
    payments: [],
    paymentConfirmations: [],
    paymentProviderEvents: [],
    vendorLedgerAccounts,
    ledgerEntries: [],
    registerSessions: [
      {
        id: "register-seed-main",
        operatingPeriodId: "period-exa-launch-run",
        cashierUserId: "user-cashier",
        status: "open",
        openedAt: now,
        openedBy: "System",
        openingCash: 0
      }
    ],
    settlementBatches: [],
    payouts: [],
    runnerAssignments,
    deliveryRoutes,
    customerProfiles,
    loyaltyAccounts,
    promotions,
    forecastMetrics,
    chargeRules,
    stockMovements: [],
    auditLog: [
      {
        id: "audit-seed-hub",
        actor: "System",
        action: "Seeded local hub for Phase 1 pilot operations",
        createdAt: now
      }
    ],
    syncQueue: [
      {
        id: "sync-seed-1",
        kind: "cloud-sync",
        status: "queued",
        summary: "Initial live-event snapshot awaiting cloud backup",
        createdAt: now
      }
    ]
  };
}
