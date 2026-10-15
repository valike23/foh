"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { servicePages, servicePageUrl, type ServicePage } from "../lib/service-pages";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  BarChart3,
  BellRing,
  Boxes,
  Check,
  ChefHat,
  ClipboardList,
  CloudOff,
  CreditCard,
  History,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
  ReceiptText,
  Send,
  Settings2,
  Table2,
  TicketPercent,
  Truck,
  UserRound,
  Wifi,
  X
} from "lucide-react";
import { Badge, Button, Card, CardContent, cn, ProductImage } from "@exa-foh/ui";
import {
  calculateOrderTotals,
  formatNaira,
  type CloudSyncStatus,
  type HubSnapshot,
  type MenuItem,
  type Order,
  type OrderStatus,
  type Payment,
  type PaymentMethod,
  type RoleName,
  type Store,
  type User
} from "@exa-foh/shared";

function serviceBase() {
  const operationId = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("operation") ?? "";
  return `/api/manage/service/${encodeURIComponent(operationId)}`;
}

type Cart = Record<string, number>;

type CloseoutReport = {
  period: {
    id: string;
    label: string;
    type: string;
    status: string;
  };
  orders: number;
  revenue: number;
  settled: number;
  outstanding: number;
  stockMovements: number;
  openingCash: number;
  closingCash?: number;
  expectedCash: number;
};

type SettlementReport = {
  vendorId: string;
  vendorName: string;
  accountId?: string;
  credits: number;
  debits: number;
  balance: number;
  pendingPayouts: number;
  entries: HubSnapshot["ledgerEntries"];
};

type CloudOverview = {
  organizations: number;
  operatingUnits: number;
  orders: number;
  payments: number;
  revenue: number;
  ledgerBalance: number;
  lastIngestedAt?: string;
};

type LocalBackup = {
  sourceHubId: string;
  tenantId: string;
  organizationId: string;
  createdAt: string;
  payloadHash: string;
};

type AdvancedReport = {
  itemPerformance: Array<{ itemId: string; itemName: string; storeId: string; quantity: number; revenue: number }>;
  vendorComparison: Array<{ vendorId: string; vendorName: string; orders: number; revenue: number }>;
  routeStatus: Record<string, number>;
  customerProfiles: number;
  repeatCustomers: number;
  forecastMetrics: HubSnapshot["forecastMetrics"];
};

type CustomerHistory = {
  profile: HubSnapshot["customerProfiles"][number] | null;
  loyalty: HubSnapshot["loyaltyAccounts"][number] | null;
  orders: Order[];
};

function useHubSnapshot() {
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(`${serviceBase()}/api/snapshot`, { cache: "no-store" });
        const data = await response.json();
        if (response.status === 401) { window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
        if (!response.ok) throw new Error(data.error ?? "Service unavailable");
        if (active) { setSnapshot(data); setConnected(true); setError(null); }
      } catch (error) { if (active) { setConnected(false); setError((error as Error).message); setSnapshot(null); } }
      if (active) timer = setTimeout(load, 2000);
    }
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, []);

  return { snapshot, connected, error };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${serviceBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${serviceBase()}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function updateOrderStatus(orderId: string, status: OrderStatus, actor = "BOH") {
  await patchJson(`/api/orders/${orderId}/status`, { status, actor });
}

async function recordPayment(order: Order, snapshot: HubSnapshot, method: PaymentMethod, actor: string, note?: string) {
  const amount = outstandingBalance(order, snapshot);
  if (amount <= 0) return;

  await postJson("/api/payments", {
    orderId: order.id,
    amount,
    method,
    confirmedBy: actor,
    note
  });
}

function storeName(snapshot: HubSnapshot, storeId: string): string {
  return snapshot.stores.find((store) => store.id === storeId)?.name ?? "Unknown storefront";
}

function vendorName(snapshot: HubSnapshot, storeId: string): string {
  const store = snapshot.stores.find((candidate) => candidate.id === storeId);
  return snapshot.vendors.find((vendor) => vendor.id === store?.vendorId)?.name ?? "Unassigned vendor";
}

function chargeRulesForStore(snapshot: HubSnapshot, store: Store) {
  const ruleIds = store.chargeRuleIds?.length ? store.chargeRuleIds : snapshot.event.defaultChargeRuleIds;
  return snapshot.chargeRules.filter((rule) => ruleIds.includes(rule.id));
}

function paidAmount(order: Order, snapshot: HubSnapshot): number {
  return snapshot.payments
    .filter((payment) =>
      payment.orderId === order.id &&
      (payment.status === "validated" || payment.status === "manually-confirmed")
    )
    .reduce((sum, payment) => sum + payment.amount, 0);
}

function outstandingBalance(order: Order, snapshot: HubSnapshot): number {
  return Math.max(0, order.totals.balanceDue - paidAmount(order, snapshot));
}

function statusVariant(status: OrderStatus | Payment["status"] | "open" | "occupied" | "settled") {
  if (status === "sent" || status === "pending-network") return "warning";
  if (status === "rejected" || status === "void" || status === "failed") return "danger";
  if (status === "settled" || status === "validated" || status === "manually-confirmed" || status === "open") return "success";
  return "default";
}

export function BohDashboardApp({ page = "command" }: { page?: ServicePage }) {
  const { snapshot, connected, error } = useHubSnapshot();
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      setNotice(success);
      window.setTimeout(() => setNotice(null), 3000);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Action failed");
    }
  }

  const metrics = useMemo(() => {
    if (!snapshot) return null;

    const gross = snapshot.orders.reduce((sum, order) => sum + order.totals.total, 0);
    const balanceDue = snapshot.orders.reduce((sum, order) => sum + outstandingBalance(order, snapshot), 0);
    const localPayments = snapshot.payments
      .filter((payment) => payment.status === "validated" || payment.status === "manually-confirmed")
      .reduce((sum, payment) => sum + payment.amount, 0);
    const pendingOrders = snapshot.orders.filter((order) => order.status === "sent").length;
    const lowStock = snapshot.inventory.filter((item) => item.quantity <= item.lowStockThreshold).length;

    return { gross, balanceDue, localPayments, pendingOrders, lowStock };
  }, [snapshot]);

  if (!snapshot || !metrics) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-5">
        <Card className="w-full max-w-md">
          <CardContent className="grid min-h-44 place-items-center gap-2 p-8 text-center text-muted-foreground">
            <Wifi size={30} className="text-primary" />
            <h1 className="text-xl font-semibold text-foreground">Connecting to EXA FOH hub</h1>
            <p>{error ?? "Waiting for the local venue server on port 4000."}</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const sentOrders = snapshot.orders.filter((order) => order.status === "sent");
  const activeOrders = snapshot.orders.filter((order) => !["settled", "void", "rejected"].includes(order.status));
  const prepOrders = snapshot.orders.filter((order) => ["sent", "confirmed", "preparing", "ready"].includes(order.status));
  const payableOrders = snapshot.orders.filter((order) => !["settled", "void", "rejected"].includes(order.status) && outstandingBalance(order, snapshot) > 0);
  const selectedUser = snapshot.users[0];
  const role = selectedUser?.role ?? "admin";
  const canSetup = role === "admin" || role === "vendor-manager" || role === "store-operator";
  const canStaffOrder = role === "admin" || role === "waiter" || role === "cashier";
  const canPrep = role === "admin" || role === "vendor-manager" || role === "store-operator" || role === "prep" || role === "waiter";
  const canInventory = role === "admin" || role === "vendor-manager" || role === "store-operator" || role === "prep";
  const canPay = role === "admin" || role === "cashier";
  const canSeeFinancials = role === "admin" || role === "vendor-manager" || role === "cashier";
  const vendorTotals = snapshot.stores.map((store) => {
    const vendor = snapshot.vendors.find((candidate) => candidate.id === store.vendorId);
    const total = snapshot.orders
      .filter((order) => order.storeId === store.id)
      .reduce((sum, order) => sum + order.totals.total, 0);
    return { store, vendor: vendor?.name ?? "Unassigned", total };
  });

  return (
    <main className="grid min-h-screen grid-cols-1 bg-background text-foreground lg:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="flex min-w-0 border-b border-border bg-sidebar p-3 lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:justify-between lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="w-full min-w-0">
          <div className="mb-8 flex items-center gap-2.5 px-2 py-3">
            <Image src="/exa-icon.svg" alt="EXA" width={36} height={36} priority />
            <div className="leading-tight">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-foreground">EXA</p>
                <span className="rounded-full bg-white px-1.5 py-px text-[8px] font-semibold tracking-wide text-black">
                  Service
                </span>
              </div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">FOH Command</p>
            </div>
          </div>

          <nav aria-label="Service navigation" className="flex gap-1 overflow-x-auto lg:grid lg:overflow-visible">
            <Link href="/venues" className="mb-3 flex shrink-0 items-center gap-3 whitespace-nowrap rounded-lg px-3 py-3 text-sm text-foreground hover:bg-secondary"><MapPin size={20} />Venue management</Link>
            {(Object.keys(servicePages) as ServicePage[]).map(section => {
              const icons = { command: ReceiptText, sessions: RotateCcw, setup: Settings2, "staff-order": Send, prep: ChefHat, inventory: Boxes, payments: CreditCard, ledger: Banknote, cloud: CloudOff, runner: Truck, advanced: BarChart3, tables: Table2, audit: History };
              const Icon = icons[section];
              return <SidebarLink key={section} active={page === section} icon={<Icon size={20} />} label={servicePages[section]} href={servicePageUrl(section, snapshot.event.id)} />;
            })}
          </nav>
        </div>

        <Card className="mt-4 hidden lg:block">
          <CardContent className="p-4">
            <div className={cn("mb-2 flex items-center gap-2 font-semibold", connected ? "text-emerald-400" : "text-amber-300")}>
              {connected ? <Wifi size={17} /> : <CloudOff size={17} />}
              {connected ? "LAN hub live" : "Reconnecting"}
            </div>
            <p className="text-sm text-muted-foreground">Cloud sync is a queue, not a blocker. Local service keeps moving.</p>
          </CardContent>
        </Card>
      </aside>

      <section className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-border/80 bg-background/85 px-4 py-4 backdrop-blur-md md:px-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="break-words text-sm text-muted-foreground">{snapshot.event.name}</p>
              <h1 className="text-xl font-semibold text-foreground sm:text-2xl">{servicePages[page]}</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/operations" className="px-3 py-2 text-sm underline">Change operation</Link>
              <span className="px-3 py-2 text-sm">{selectedUser?.name}</span>
              {notice && <Badge variant="outline" className="rounded-xl px-3 py-2 text-sm">{notice}</Badge>}
              <Badge variant="outline" className="gap-2 rounded-xl px-3 py-2 text-sm">
                <BellRing size={16} className="text-primary" />
                {snapshot.syncQueue.filter((item) => item.status === "queued").length} queued sync tasks
              </Badge>
            </div>
          </div>
        </header>

        <div className="grid w-full min-w-0 gap-6 p-4 md:p-6 2xl:p-10">
          {page === "command" && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" id="command">
            <Metric title="Gross sales" value={formatNaira(metrics.gross)} icon={<ReceiptText />} />
            <Metric title="Outstanding" value={formatNaira(metrics.balanceDue)} icon={<ClipboardList />} intent={metrics.balanceDue > 0 ? "warn" : "ok"} />
            <Metric title="Local payments" value={formatNaira(metrics.localPayments)} icon={<Banknote />} />
            <Metric title="Orders pending" value={String(metrics.pendingOrders)} icon={<Send />} intent={metrics.pendingOrders > 0 ? "warn" : "ok"} />
            <Metric title="Low stock" value={String(metrics.lowStock)} icon={<AlertTriangle />} intent={metrics.lowStock > 0 ? "warn" : "ok"} />
          </section>}

          {page === "sessions" && canSeeFinancials && (
            <Card id="periods">
              <CardContent className="p-5">
                <PanelHeader title="Service Sessions" detail={`${snapshot.event.containerType} - ${snapshot.event.status}`} />
                <OperatingPeriodConsole snapshot={snapshot} run={run} />
              </CardContent>
            </Card>
          )}

          <div className="contents">
            {page === "setup" && canSetup && (
              <Card id="setup">
                <CardContent className="p-5">
                  <PanelHeader title="Setup console" detail="Role-scoped setup" />
                  <SetupConsole snapshot={snapshot} run={run} role={role} />
                </CardContent>
              </Card>
            )}

            {page === "command" && canSeeFinancials && <Card id="stores">
              <CardContent className="p-5">
                <PanelHeader title="Vendor revenue" detail="Local attribution" />
                <div className="grid gap-1">
                  {vendorTotals.map(({ store, vendor, total }) => (
                    <div className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-b-0" key={store.id}>
                      <div className="grid gap-1">
                        <strong>{store.name}</strong>
                        <span className="text-sm text-muted-foreground">{vendor}</span>
                      </div>
                      <strong>{formatNaira(total)}</strong>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>}
          </div>

          <div className="contents">
            {page === "staff-order" && canStaffOrder && <Card id="staff-order">
              <CardContent className="p-5">
                <PanelHeader title="Waiter/cashier order" detail="Manual order entry" />
                <StaffOrderForm snapshot={snapshot} run={run} />
              </CardContent>
            </Card>}

            {page === "prep" && canPrep && <Card id="prep">
              <CardContent className="p-5">
                <PanelHeader title="Kitchen/bar prep" detail={`${prepOrders.length} active tickets`} />
                <div className="grid max-h-[620px] gap-2 overflow-auto pr-1">
                  {prepOrders.length === 0 ? (
                    <EmptyState text="No active prep tickets." />
                  ) : (
                    prepOrders.map((order) => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        snapshot={snapshot}
                        actions={
                          <>
                            {order.status === "sent" && <Button size="sm" onClick={() => run(() => updateOrderStatus(order.id, "confirmed", "Prep"), "Order accepted")}><Check size={15} />Accept</Button>}
                            {order.status === "confirmed" && <Button size="sm" variant="outline" onClick={() => run(() => updateOrderStatus(order.id, "preparing", "Prep"), "Prep started")}>Preparing</Button>}
                            {order.status === "preparing" && <Button size="sm" variant="outline" onClick={() => run(() => updateOrderStatus(order.id, "ready", "Prep"), "Order ready")}>Ready</Button>}
                            {order.status === "ready" && <Button size="sm" variant="outline" onClick={() => run(() => updateOrderStatus(order.id, "served", "Runner"), "Order served")}>Served</Button>}
                            <Button size="icon" variant="outline" title="Void order" onClick={() => run(() => updateOrderStatus(order.id, "void", "BOH"), "Order voided")}><X size={16} /></Button>
                          </>
                        }
                      />
                    ))
                  )}
                </div>
              </CardContent>
            </Card>}
          </div>

          <div className="contents">
            {page === "command" && <Card>
              <CardContent className="p-5">
                <PanelHeader title="Order confirmation" detail={`${sentOrders.length} waiting`} />
                <div className="grid gap-2">
                  {sentOrders.length === 0 ? (
                    <EmptyState text="No orders need confirmation right now." />
                  ) : (
                    sentOrders.map((order) => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        snapshot={snapshot}
                        actions={
                          <>
                            <Button size="sm" onClick={() => run(() => updateOrderStatus(order.id, "confirmed", "BOH"), "Order accepted")}><Check size={15} />Accept</Button>
                            <Button size="sm" variant="outline" onClick={() => run(() => updateOrderStatus(order.id, "rejected", "BOH"), "Order rejected")}>Reject</Button>
                          </>
                        }
                      />
                    ))
                  )}
                </div>
              </CardContent>
            </Card>}

            {page === "inventory" && canInventory && <Card id="inventory">
              <CardContent className="p-5">
                <PanelHeader title="Inventory control" detail="Stock and availability" />
                <InventoryControl snapshot={snapshot} run={run} role={role} />
              </CardContent>
            </Card>}
          </div>

          <div className="contents">
            {page === "payments" && canPay && <Card id="payments">
              <CardContent className="p-5">
                <PanelHeader title="Payment confirmation" detail={`${payableOrders.length} open balances`} />
                <PaymentConsole snapshot={snapshot} orders={payableOrders} run={run} />
              </CardContent>
            </Card>}

            {page === "command" && <Card>
              <CardContent className="p-5">
                <PanelHeader title="Live order feed" detail={`${activeOrders.length} active`} />
                <div className="grid max-h-[520px] gap-2 overflow-auto pr-1">
                  {activeOrders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      snapshot={snapshot}
                      actions={
                        <>
                          {order.status === "served" && (
                            <Button size="sm" onClick={() => run(() => recordPayment(order, snapshot, "cash", "Cashier"), "Cash payment recorded")}>
                              Settle cash
                            </Button>
                          )}
                        </>
                      }
                    />
                  ))}
                </div>
              </CardContent>
            </Card>}
          </div>

          {page === "ledger" && canSeeFinancials && <Card id="ledger">
            <CardContent className="p-5">
              <PanelHeader title="Ledger and settlement" detail={`${snapshot.ledgerEntries.length} entries`} />
              <FinanceLedgerConsole snapshot={snapshot} run={run} />
            </CardContent>
          </Card>}

          {page === "cloud" && canSeeFinancials && <Card id="cloud">
            <CardContent className="p-5">
              <PanelHeader title="Cloud platform sync" detail={`${snapshot.syncQueue.filter((item) => item.status !== "sent").length} open tasks`} />
              <CloudSyncConsole snapshot={snapshot} run={run} />
            </CardContent>
          </Card>}

          <div className="contents">
            {page === "runner" && (canPrep || canStaffOrder) && <Card id="runner">
              <CardContent className="p-5">
                <PanelHeader title="Runner fulfillment" detail={`${snapshot.deliveryRoutes.filter((route) => route.status !== "delivered").length} open routes`} />
                <RunnerQueueConsole snapshot={snapshot} run={run} />
              </CardContent>
            </Card>}

            {page === "advanced" && canSeeFinancials && <Card id="advanced">
              <CardContent className="p-5">
                <PanelHeader title="Advanced venue" detail={`${snapshot.seats.length} seats`} />
                <AdvancedVenueConsole snapshot={snapshot} run={run} />
              </CardContent>
            </Card>}
          </div>

          <div className="contents">
            {page === "tables" && <Card>
              <CardContent className="p-5">
                <PanelHeader title="Tables" detail="Deposits and sections" />
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {snapshot.tables.map((table) => {
                    const deposit = snapshot.deposits.find((candidate) => candidate.tableId === table.id && candidate.status === "active");
                    return (
                      <div className="grid gap-2 rounded-xl border border-border bg-white/[0.03] p-3" key={table.id}>
                        <strong>{table.label}</strong>
                        <span className="text-sm text-muted-foreground">{table.section} - {table.assignedWaiter}</span>
                        <Badge variant={statusVariant(table.status)}>{table.status}</Badge>
                        {deposit && <small className="text-muted-foreground">{formatNaira(deposit.amount)} deposit active</small>}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>}

            {page === "cloud" && <Card>
              <CardContent className="p-5">
                <PanelHeader title="Sync queue" detail="Cloud and Paga" />
                <div className="grid gap-2">
                  {snapshot.syncQueue.slice(0, 6).map((item) => (
                    <div className="flex items-start gap-3 border-b border-border py-3 last:border-b-0" key={item.id}>
                      <BadgeCheck size={17} className="mt-0.5 text-accent" />
                      <div className="grid gap-1">
                        <strong>{item.kind === "paga-confirmation" ? "Paga pending" : "Cloud backup"}</strong>
                        <span className="text-sm text-muted-foreground">{item.summary}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>}
          </div>

          {page === "audit" && canSeeFinancials && <Card id="audit">
            <CardContent className="p-5">
              <PanelHeader title="Local audit log" detail={`${snapshot.auditLog?.length ?? 0} actions`} />
              <div className="grid max-h-[440px] gap-2 overflow-auto pr-1">
                {(snapshot.auditLog ?? []).slice(0, 80).map((entry) => (
                  <div className="grid gap-1 rounded-xl border border-border bg-white/[0.03] p-3 sm:grid-cols-[180px_minmax(0,1fr)_220px] sm:items-center" key={entry.id}>
                    <strong>{entry.actor}</strong>
                    <span className="text-sm text-foreground/85">{entry.action}</span>
                    <span className="text-sm text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                ))}
                {(snapshot.auditLog?.length ?? 0) === 0 && <EmptyState text="No manual actions recorded yet." />}
              </div>
            </CardContent>
          </Card>}
        </div>
      </section>
    </main>
  );
}

function SetupConsole({ snapshot, run, role }: { snapshot: HubSnapshot; run: (action: () => Promise<unknown>, success: string) => Promise<void>; role: RoleName }) {
  const firstStoreId = snapshot.stores[0]?.id ?? "";
  const [menuStoreId, setMenuStoreId] = useState(firstStoreId);
  const [menuName, setMenuName] = useState("");
  const [menuCategory, setMenuCategory] = useState("Drinks");
  const [menuPrice, setMenuPrice] = useState("");
  const [menuQty, setMenuQty] = useState("0");
  const [menuUnit, setMenuUnit] = useState("units");
  const [chargeName, setChargeName] = useState("");
  const [chargeRate, setChargeRate] = useState("");

  useEffect(() => {
    if (!menuStoreId && firstStoreId) setMenuStoreId(firstStoreId);
  }, [firstStoreId, menuStoreId]);

  return (
    <div className="grid gap-4 2xl:grid-cols-2">
      <MiniForm
        title="Menu item"
        onSubmit={() => run(async () => {
          await postJson("/api/menu-items", {
            storeId: menuStoreId,
            name: menuName,
            category: menuCategory,
            price: Number(menuPrice),
            unit: menuUnit,
            quantity: Number(menuQty),
            lowStockThreshold: Math.max(1, Math.floor(Number(menuQty) * 0.2))
          });
          setMenuName("");
          setMenuPrice("");
          setMenuQty("0");
        }, "Menu item created")}
      >
        <SelectInput label="Storefront" value={menuStoreId} onChange={setMenuStoreId} options={snapshot.stores.map((store) => ({ value: store.id, label: store.name }))} />
        <TextInput label="Item name" value={menuName} onChange={setMenuName} placeholder="e.g. Chapman" required />
        <SelectInput label="Category" value={menuCategory} onChange={setMenuCategory} options={["Drinks", "Food", "Bottle Service", "Merch"].map((category) => ({ value: category, label: category }))} />
        <TextInput label="Price" value={menuPrice} onChange={setMenuPrice} placeholder="5000" type="number" required />
        <TextInput label="Opening stock" value={menuQty} onChange={setMenuQty} placeholder="30" type="number" />
        <TextInput label="Unit" value={menuUnit} onChange={setMenuUnit} placeholder="cups" />
        <Button disabled={!menuStoreId || !menuName.trim() || Number(menuPrice) < 0}><Plus size={16} />Add menu item</Button>
      </MiniForm>

      {role === "admin" && <MiniForm
        title="Charge"
        onSubmit={() => run(async () => {
          await postJson("/api/charge-rules", {
            name: chargeName,
            type: "custom",
            rate: Number(chargeRate) / 100,
            scope: "event",
            appliesTo: "subtotal",
            sortOrder: 40
          });
          setChargeName("");
          setChargeRate("");
        }, "Charge created")}
      >
        <TextInput label="Charge name" value={chargeName} onChange={setChargeName} placeholder="e.g. Service Levy" required />
        <TextInput label="Rate %" value={chargeRate} onChange={setChargeRate} placeholder="5" type="number" required />
        <Button disabled={!chargeName.trim() || Number(chargeRate) <= 0}><Plus size={16} />Add event charge</Button>
      </MiniForm>}
    </div>
  );
}

function OperatingPeriodConsole({ snapshot, run }: { snapshot: HubSnapshot; run: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const openPeriod = snapshot.operatingPeriods.find((period) => period.status === "open") ?? snapshot.operatingPeriods[0];
  const [report, setReport] = useState<CloseoutReport | null>(null);

  async function loadReport() {
    if (!openPeriod) return;
    const response = await fetch(`${serviceBase()}/api/reports/closeout?periodId=${openPeriod.id}`, {
      headers: {  }
    });
    if (!response.ok) throw new Error("Close-out report unavailable");
    setReport(await response.json() as CloseoutReport);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
      <div><p className="mb-4 text-sm capitalize">{snapshot.event.containerType} · {snapshot.event.status}</p><Button variant="outline" asChild><Link href="/operations">Service operations</Link></Button></div>

      <div className="grid gap-3 rounded-xl border border-border bg-white/[0.03] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <strong>{openPeriod?.label ?? "No service session"}</strong>
            <p className="text-sm text-muted-foreground">{openPeriod?.type ?? "n/a"} - {openPeriod?.status ?? "closed"}</p>
          </div>
          <Button size="sm" variant="outline" disabled={!openPeriod} onClick={() => run(loadReport, "Close-out report loaded")}>Report</Button>
        </div>
        {report ? (
          <div className="grid gap-2 border-t border-border pt-3 text-sm">
            <TotalRow label="Revenue" value={report.revenue} />
            <TotalRow label="Settled" value={report.settled} />
            <TotalRow label="Outstanding" value={report.outstanding} />
            <TotalRow label="Expected cash" value={report.expectedCash} />
            <span className="text-muted-foreground">{report.orders} orders - {report.stockMovements} stock movements</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{snapshot.operatingPeriods.length} recorded service sessions</p>
        )}
      </div>
    </div>
  );
}

function StaffOrderForm({ snapshot, run }: { snapshot: HubSnapshot; run: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [storeId, setStoreId] = useState(snapshot.stores[0]?.id ?? "");
  const [tableId, setTableId] = useState("");
  const [origin, setOrigin] = useState<"waiter" | "cashier">("waiter");
  const [actor, setActor] = useState("Staff");
  const [customerName, setCustomerName] = useState("");
  const [cart, setCart] = useState<Cart>({});
  const store = snapshot.stores.find((candidate) => candidate.id === storeId);
  const menu = snapshot.menuItems.filter((item) => item.storeId === storeId);
  const tables = snapshot.tables.filter((table) => table.storeId === storeId);
  const deposits = snapshot.deposits.filter((deposit) => deposit.tableId === tableId && deposit.status === "active");
  const lines = menu
    .map((item) => {
      const quantity = cart[item.id] ?? 0;
      return quantity > 0
        ? { id: `staff-${item.id}`, menuItemId: item.id, name: item.name, quantity, unitPrice: item.price, modifiers: [] }
        : null;
    })
    .filter(Boolean) as Array<{ id: string; menuItemId: string; name: string; quantity: number; unitPrice: number; modifiers: [] }>;
  const totals = store ? calculateOrderTotals(lines, chargeRulesForStore(snapshot, store), deposits) : null;

  async function submit() {
    await postJson("/api/orders", {
      storeId,
      tableId: tableId || undefined,
      origin,
      customerName: customerName || undefined,
      createdBy: actor || "Staff",
      lines: lines.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity }))
    });
    setCart({});
    setCustomerName("");
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectInput label="Storefront" value={storeId} onChange={(value) => { setStoreId(value); setTableId(""); setCart({}); }} options={snapshot.stores.map((candidate) => ({ value: candidate.id, label: candidate.name }))} />
        <SelectInput label="Table or walk-up" value={tableId} onChange={setTableId} options={[{ value: "", label: "Walk-up" }, ...tables.map((table) => ({ value: table.id, label: table.label }))]} />
        <SelectInput label="Origin" value={origin} onChange={(value) => setOrigin(value as "waiter" | "cashier")} options={[{ value: "waiter", label: "Waiter" }, { value: "cashier", label: "Cashier" }]} />
        <TextInput label="Actor" value={actor} onChange={setActor} placeholder="Staff name" />
        <TextInput label="Customer" value={customerName} onChange={setCustomerName} placeholder="Optional" />
      </div>

      <div className="grid max-h-[360px] gap-2 overflow-auto pr-1">
        {menu.map((item) => (
          <QuantityRow
            key={item.id}
            item={item}
            quantity={cart[item.id] ?? 0}
            onChange={(quantity) => setCart((current) => ({ ...current, [item.id]: quantity }))}
          />
        ))}
      </div>

      {totals && (
        <div className="grid gap-2 rounded-xl border border-border bg-white/[0.03] p-3">
          <TotalRow label="Subtotal" value={totals.subtotal} />
          {totals.charges.map((charge) => <TotalRow key={charge.chargeRuleId} label={charge.name} value={charge.amount} />)}
          <TotalRow label="Deposit" value={-totals.depositApplied} muted />
          <TotalRow label="Balance" value={totals.balanceDue} strong />
        </div>
      )}

      <Button disabled={!storeId || lines.length === 0} onClick={() => run(submit, "Staff order sent")}>
        <Send size={17} />
        Send order
      </Button>
    </div>
  );
}

function InventoryControl({ snapshot, run, role }: { snapshot: HubSnapshot; run: (action: () => Promise<unknown>, success: string) => Promise<void>; role: RoleName }) {
  const [stockItemId, setStockItemId] = useState(snapshot.inventory[0]?.id ?? "");
  const [quantityDelta, setQuantityDelta] = useState("1");
  const [type, setType] = useState("restock");
  const [note, setNote] = useState("Phase 1 adjustment");
  const lowStock = snapshot.inventory.filter((item) => item.quantity <= item.lowStockThreshold);

  async function submitAdjustment() {
    const signedQuantity = type === "waste" ? -Math.abs(Number(quantityDelta)) : Number(quantityDelta);
    await postJson(`/api/inventory/${stockItemId}/adjustments`, {
      quantityDelta: signedQuantity,
      type,
      note,
      actor: "Inventory"
    });
  }

  return (
    <div className="grid gap-4">
      {role !== "prep" && <div className="grid gap-3">
        <SelectInput label="Stock item" value={stockItemId} onChange={setStockItemId} options={snapshot.inventory.map((item) => ({ value: item.id, label: `${item.name} - ${storeName(snapshot, item.storeId)}` }))} />
        <SelectInput label="Movement" value={type} onChange={setType} options={[{ value: "restock", label: "Restock/receive" }, { value: "waste", label: "Wastage" }, { value: "transfer", label: "Transfer/manual" }]} />
        <TextInput label="Quantity" value={quantityDelta} onChange={setQuantityDelta} type="number" />
        <TextInput label="Note" value={note} onChange={setNote} />
        <Button disabled={!stockItemId || Number(quantityDelta) <= 0} onClick={() => run(submitAdjustment, "Inventory adjusted")}>Record movement</Button>
      </div>}

      <div className="grid gap-2">
        <strong className="text-sm">Low stock</strong>
        {lowStock.length === 0 ? <p className="text-sm text-muted-foreground">No low stock alerts.</p> : lowStock.map((item) => (
          <div className="grid gap-2 rounded-xl border border-border bg-white/[0.03] p-3" key={item.id}>
            <div className="flex items-center justify-between gap-2">
              <span>{item.name}</span>
              <strong className="text-amber-300">{item.quantity} {item.unit}</strong>
            </div>
            <span className="text-sm text-muted-foreground">{storeName(snapshot, item.storeId)}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-2">
        <strong className="text-sm">Menu items</strong>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {snapshot.menuItems.map((item) => (
          <div className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-[2px] border border-border p-3" key={item.id}>
            <ProductImage src={item.imageId ? `${serviceBase()}/api/menu-images/${item.imageId}` : undefined} name={item.name} />
            <strong className="break-words">{item.name}</strong>
            <span className="text-sm text-muted-foreground">{storeName(snapshot, item.storeId)} · {formatNaira(item.price)}</span>
            {role !== "prep" && <MenuPhotoEditor item={item} run={run} />}
            <Button
              size="sm"
              variant={item.available ? "outline" : "default"}
              onClick={() => run(() => patchJson(`/api/menu-items/${item.id}/availability`, { available: !item.available, actor: "Inventory" }), item.available ? "Item marked unavailable" : "Item restored")}
            >
              {item.available ? "Mark unavailable" : "Restore"}
            </Button>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}

function MenuPhotoEditor({ item, run }: { item: MenuItem; run: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function save(file: File | null) {
    setBusy(true);
    try {
      await run(async () => {
        if (file && file.size > 5 * 1024 * 1024) throw new Error("Images must be 5 MB or smaller");
        const base64 = file ? await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("Unable to read image"));
          reader.readAsDataURL(file);
        }) : null;
        await patchJson(`/api/menu-items/${item.id}/image`, { base64, expectedImageId: item.imageId ?? null });
      }, file ? "Product photo updated" : "Product photo removed");
    } finally { setBusy(false); }
  }
  return <div className="mt-auto grid gap-2">
    <label className="grid gap-1 text-sm">
      <span>{busy ? "Saving photo..." : item.imageId ? "Replace photo" : "Add photo"}</span>
      <input aria-label={`Photo for ${item.name}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} className="w-full min-w-0 text-xs" onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void save(file);
      }} />
    </label>
    {item.imageId && <Button size="sm" variant="outline" disabled={busy} onClick={() => void save(null)}>Remove photo</Button>}
  </div>;
}

function PaymentConsole({ snapshot, orders, run }: { snapshot: HubSnapshot; orders: Order[]; run: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [actor, setActor] = useState("Cashier");
  const [note, setNote] = useState("");
  const order = orders.find((candidate) => candidate.id === orderId) ?? orders[0];

  useEffect(() => {
    if (!orderId && orders[0]) setOrderId(orders[0].id);
  }, [orderId, orders]);

  return (
    <div className="grid gap-4">
      {orders.length === 0 ? (
        <EmptyState text="No open balances to confirm." />
      ) : (
        <>
          <SelectInput
            label="Order"
            value={order?.id ?? ""}
            onChange={setOrderId}
            options={orders.map((candidate) => ({
              value: candidate.id,
              label: `${candidate.id} - ${storeName(snapshot, candidate.storeId)} - ${formatNaira(outstandingBalance(candidate, snapshot))}`
            }))}
          />
          <SelectInput
            label="Method"
            value={method}
            onChange={(value) => setMethod(value as PaymentMethod)}
            options={[
              { value: "cash", label: "Cash" },
              { value: "pos", label: "POS terminal" },
              { value: "bank-transfer", label: "Bank transfer" },
              { value: "paga-card", label: "Paga card pending" },
              { value: "paga-transfer", label: "Paga transfer pending" }
            ]}
          />
          <TextInput label="Confirmed by" value={actor} onChange={setActor} />
          <TextInput label="Note/reference" value={note} onChange={setNote} placeholder="Optional" />
          {order && (
            <div className="rounded-xl border border-border bg-white/[0.03] p-3">
              <TotalRow label="Outstanding" value={outstandingBalance(order, snapshot)} strong />
            </div>
          )}
          <Button disabled={!order} onClick={() => order && run(() => recordPayment(order, snapshot, method, actor, note), "Payment recorded")}>
            <Banknote size={17} />
            Confirm payment
          </Button>
        </>
      )}
    </div>
  );
}

function FinanceLedgerConsole({ snapshot, run }: { snapshot: HubSnapshot; run: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const firstVendorId = snapshot.vendors[0]?.id ?? "";
  const [vendorId, setVendorId] = useState(firstVendorId);
  const [declaredCash, setDeclaredCash] = useState("");
  const [settlementReports, setSettlementReports] = useState<SettlementReport[]>([]);
  const [settlementNote, setSettlementNote] = useState("Period settlement");
  const openRegister = snapshot.registerSessions.find((session) => session.status === "open");
  const latestBatch = snapshot.settlementBatches.find((batch) => batch.vendorId === vendorId && batch.status !== "paid");
  const recentEntries = snapshot.ledgerEntries.slice(0, 8);
  const recentConfirmations = snapshot.paymentConfirmations.slice(0, 6);

  useEffect(() => {
    if (!vendorId && firstVendorId) setVendorId(firstVendorId);
  }, [firstVendorId, vendorId]);

  async function loadSettlementReport() {
    const query = vendorId ? `?vendorId=${encodeURIComponent(vendorId)}` : "";
    const response = await fetch(`${serviceBase()}/api/reports/settlement${query}`, {
      headers: {  }
    });
    if (!response.ok) throw new Error("Settlement report unavailable");
    setSettlementReports(await response.json() as SettlementReport[]);
  }

  async function createSettlementBatch() {
    await postJson("/api/settlement-batches", {
      vendorId,
      notes: settlementNote
    });
  }

  async function markBatchPaid() {
    if (!latestBatch) return;
    await postJson(`/api/settlement-batches/${latestBatch.id}/payout`, {
      method: "manual-transfer",
      reference: `manual-${Date.now()}`
    });
  }

  async function closeRegister() {
    if (!openRegister) return;
    await patchJson(`/api/register-sessions/${openRegister.id}/close`, {
      declaredCash: Number(declaredCash),
      notes: "Closed from BOH finance console"
    });
    setDeclaredCash("");
  }

  const selectedReport = settlementReports.find((report) => report.vendorId === vendorId) ?? settlementReports[0];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
      <div className="grid gap-4">
        <div className="grid gap-3 rounded-xl border border-border bg-white/[0.03] p-4 lg:grid-cols-4">
          <SelectInput
            label="Vendor"
            value={vendorId}
            onChange={setVendorId}
            options={snapshot.vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))}
          />
          <TextInput label="Batch note" value={settlementNote} onChange={setSettlementNote} />
          <Button variant="outline" disabled={!vendorId} onClick={() => run(loadSettlementReport, "Settlement report loaded")}>Load report</Button>
          <Button disabled={!vendorId} onClick={() => run(createSettlementBatch, "Settlement batch drafted")}>Draft batch</Button>
        </div>

        <div className="grid gap-3 rounded-xl border border-border bg-white/[0.03] p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <strong>{selectedReport?.vendorName ?? "No settlement loaded"}</strong>
              <p className="text-sm text-muted-foreground">Credits, payouts, and balance are regenerated from ledger entries.</p>
            </div>
            <Button size="sm" variant="outline" disabled={!latestBatch} onClick={() => run(markBatchPaid, "Payout recorded")}>
              Mark payout paid
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <FinanceStat label="Credits" value={formatNaira(selectedReport?.credits ?? 0)} />
            <FinanceStat label="Debits" value={formatNaira(selectedReport?.debits ?? 0)} />
            <FinanceStat label="Balance" value={formatNaira(selectedReport?.balance ?? 0)} />
            <FinanceStat label="Pending payouts" value={formatNaira(selectedReport?.pendingPayouts ?? 0)} />
          </div>
          {latestBatch && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">Open batch {latestBatch.id}</span>
              <Badge variant="warning">{formatNaira(latestBatch.total)} {latestBatch.status}</Badge>
            </div>
          )}
        </div>

        <div className="grid gap-2">
          <strong className="text-sm">Recent ledger entries</strong>
          {recentEntries.length === 0 ? <EmptyState text="No ledger entries yet." /> : recentEntries.map((entry) => (
            <div className="grid gap-2 rounded-xl border border-border bg-white/[0.03] p-3 sm:grid-cols-[110px_minmax(0,1fr)_140px] sm:items-center" key={entry.id}>
              <Badge variant={entry.direction === "credit" ? "success" : "warning"}>{entry.direction}</Badge>
              <div className="min-w-0">
                <strong className="block truncate">{entry.memo}</strong>
                <span className="text-sm text-muted-foreground">{entry.type} - {new Date(entry.createdAt).toLocaleString()}</span>
              </div>
              <strong className="sm:text-right">{formatNaira(entry.amount)}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-3 rounded-xl border border-border bg-white/[0.03] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <strong>{openRegister ? "Open register" : "No open register"}</strong>
              <p className="text-sm text-muted-foreground">{openRegister ? `${openRegister.openedBy} - ${new Date(openRegister.openedAt).toLocaleString()}` : "Cash registers open automatically on cash settlement."}</p>
            </div>
            {openRegister && <Badge variant="success">open</Badge>}
          </div>
          {openRegister && (
            <>
              <TextInput label="Declared cash" value={declaredCash} onChange={setDeclaredCash} type="number" />
              <Button disabled={Number(declaredCash) < 0 || declaredCash === ""} onClick={() => run(closeRegister, "Register closed")}>Close register</Button>
            </>
          )}
          {snapshot.registerSessions.slice(0, 4).map((session) => (
            <div className="grid gap-1 border-t border-border pt-3 text-sm" key={session.id}>
              <div className="flex items-center justify-between gap-2">
                <span>{session.openedBy}</span>
                <Badge variant={session.status === "open" ? "success" : Math.abs(session.variance ?? 0) > 0 ? "warning" : "outline"}>{session.status}</Badge>
              </div>
              {session.status === "closed" && <span className="text-muted-foreground">Expected {formatNaira(session.expectedCash ?? 0)} / declared {formatNaira(session.declaredCash ?? 0)} / variance {formatNaira(session.variance ?? 0)}</span>}
            </div>
          ))}
        </div>

        <div className="grid gap-2">
          <strong className="text-sm">Payment confirmations</strong>
          {recentConfirmations.length === 0 ? <EmptyState text="No confirmations recorded yet." /> : recentConfirmations.map((confirmation) => (
            <div className="grid gap-2 rounded-xl border border-border bg-white/[0.03] p-3" key={confirmation.id}>
              <div className="flex items-center justify-between gap-2">
                <strong>{confirmation.source}</strong>
                <Badge variant={confirmation.status === "confirmed" ? "success" : confirmation.status === "failed" ? "danger" : "warning"}>{confirmation.status}</Badge>
              </div>
              <span className="text-sm text-muted-foreground">{confirmation.confirmedBy} - {new Date(confirmation.confirmedAt).toLocaleString()}</span>
              {confirmation.providerReference && <span className="break-all text-xs text-muted-foreground">{confirmation.providerReference}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FinanceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-xl border border-border bg-background p-3">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <strong className="text-lg">{value}</strong>
    </div>
  );
}

function CloudSyncConsole({ snapshot, run }: { snapshot: HubSnapshot; run: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [status, setStatus] = useState<CloudSyncStatus | null>(null);
  const [overview, setOverview] = useState<CloudOverview | null>(null);
  const [backup, setBackup] = useState<LocalBackup | null>(null);
  const cloudItems = snapshot.syncQueue.filter((item) => item.kind === "cloud-sync" || item.kind === "cloud-backup");
  const failedItems = cloudItems.filter((item) => item.status === "failed");

  async function loadStatus() {
    const response = await fetch(`${serviceBase()}/api/sync/status`, {
      headers: {  }
    });
    if (!response.ok) throw new Error("Sync status unavailable");
    setStatus(await response.json() as CloudSyncStatus);
  }

  async function runCloudSync() {
    const payload = await postJson<{ status: CloudSyncStatus }>("/api/sync/run", {});
    setStatus(payload.status);
    await loadOverview().catch(() => undefined);
  }

  async function retryFailed() {
    const payload = await postJson<{ status: CloudSyncStatus }>("/api/sync/retry-failed", {});
    setStatus(payload.status);
  }

  async function loadOverview() {
    const response = await fetch(`${serviceBase()}/api/cloud/reports/overview`, {
      headers: {  }
    });
    if (!response.ok) throw new Error("Cloud overview unavailable");
    setOverview(await response.json() as CloudOverview);
  }

  async function loadBackup() {
    const response = await fetch(`${serviceBase()}/api/backups/local`, {
      headers: {  }
    });
    if (!response.ok) throw new Error("Local backup unavailable");
    const payload = await response.json() as LocalBackup;
    setBackup(payload);
  }

  useEffect(() => {
    void loadStatus().catch(() => undefined);
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
      <div className="grid gap-4">
        <div className="grid gap-3 rounded-xl border border-border bg-white/[0.03] p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <strong>{status?.configured ? "Cloud endpoint configured" : "Cloud endpoint offline"}</strong>
              <p className="break-all text-sm text-muted-foreground">{status?.cloudUrl ?? "Set CLOUD_SYNC_URL on the hub to enable push sync."}</p>
            </div>
            <Badge variant={status?.configured ? "success" : "warning"}>{status?.configured ? "ready" : "local only"}</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <FinanceStat label="Queued" value={String(status?.queued ?? cloudItems.filter((item) => item.status === "queued").length)} />
            <FinanceStat label="Sent" value={String(status?.sent ?? cloudItems.filter((item) => item.status === "sent").length)} />
            <FinanceStat label="Failed" value={String(status?.failed ?? failedItems.length)} />
          </div>
          {status?.lastError && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{status.lastError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => run(loadStatus, "Sync status refreshed")}><RotateCcw size={16} />Refresh</Button>
            <Button disabled={!status?.configured} onClick={() => run(runCloudSync, "Cloud sync completed")}><Wifi size={16} />Run sync</Button>
            <Button variant="outline" disabled={failedItems.length === 0} onClick={() => run(retryFailed, "Failed sync items requeued")}>Retry failed</Button>
            <Button variant="outline" onClick={() => run(loadBackup, "Local backup generated")}>Backup hash</Button>
          </div>
          {backup && (
            <div className="grid gap-1 border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">Local backup {backup.sourceHubId}</span>
              <span className="break-all font-mono text-xs text-foreground/80">{backup.payloadHash}</span>
            </div>
          )}
        </div>

        <div className="grid gap-2">
          <strong className="text-sm">Cloud queue</strong>
          {cloudItems.length === 0 ? <EmptyState text="No cloud sync tasks yet." /> : cloudItems.slice(0, 8).map((item) => (
            <div className="grid gap-2 rounded-xl border border-border bg-white/[0.03] p-3" key={item.id}>
              <div className="flex items-center justify-between gap-2">
                <strong>{item.summary}</strong>
                <Badge variant={item.status === "sent" ? "success" : item.status === "failed" ? "danger" : "warning"}>{item.status}</Badge>
              </div>
              <span className="text-sm text-muted-foreground">
                {item.attempts ?? 0} attempts - {new Date(item.updatedAt ?? item.createdAt).toLocaleString()}
              </span>
              {item.error && <span className="text-sm text-red-200">{item.error}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-3 rounded-xl border border-border bg-white/[0.03] p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <strong>Cloud admin overview</strong>
              <p className="text-sm text-muted-foreground">Cross-event reporting from ingested records.</p>
            </div>
            <Button size="sm" variant="outline" disabled={!status?.configured} onClick={() => run(loadOverview, "Cloud overview loaded")}>Load</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FinanceStat label="Organizations" value={String(overview?.organizations ?? 0)} />
            <FinanceStat label="Operating units" value={String(overview?.operatingUnits ?? 0)} />
            <FinanceStat label="Orders" value={String(overview?.orders ?? 0)} />
            <FinanceStat label="Payments" value={String(overview?.payments ?? 0)} />
            <FinanceStat label="Revenue" value={formatNaira(overview?.revenue ?? 0)} />
            <FinanceStat label="Ledger balance" value={formatNaira(overview?.ledgerBalance ?? 0)} />
          </div>
          <span className="text-sm text-muted-foreground">
            Last cloud ingest: {overview?.lastIngestedAt ? new Date(overview.lastIngestedAt).toLocaleString() : "not loaded"}
          </span>
        </div>

        <div className="grid gap-2 rounded-xl border border-border bg-white/[0.03] p-4">
          <strong>Sync identity</strong>
          <div className="grid gap-2 text-sm text-muted-foreground">
            <span>Tenant: {status?.tenantId ?? "tenant-exa-demo"}</span>
            <span>Organization: {status?.organizationId ?? "org-exa-demo"}</span>
            <span>Hub: {status?.sourceHubId ?? "hub-local-demo"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RunnerQueueConsole({ snapshot, run }: { snapshot: HubSnapshot; run: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const routes = snapshot.deliveryRoutes.filter((route) => route.status !== "delivered").slice(0, 10);

  async function updateRoute(routeId: string, status: "assigned" | "picked-up" | "delivered" | "issue") {
    await patchJson(`/api/delivery-routes/${routeId}/status`, { status });
  }

  return (
    <div className="grid gap-3">
      {routes.length === 0 ? <EmptyState text="No active delivery routes." /> : routes.map((route) => {
        const order = snapshot.orders.find((candidate) => candidate.id === route.orderId);
        const seat = snapshot.seats.find((candidate) => candidate.id === route.seatId);
        const section = snapshot.sections.find((candidate) => candidate.id === route.sectionId);
        const runner = snapshot.runnerAssignments.find((candidate) => candidate.userId === route.runnerUserId);

        return (
          <div className="grid gap-3 rounded-xl border border-border bg-white/[0.03] p-4" key={route.id}>
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{seat?.label ?? "Seat pending"}</strong>
                  <Badge variant={route.status === "issue" ? "danger" : route.status === "picked-up" ? "warning" : "success"}>{route.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{section?.label ?? "No section"} - {runner?.name ?? "Unassigned runner"}</p>
              </div>
              <strong>{order ? formatNaira(order.totals.total) : formatNaira(0)}</strong>
            </div>
            {order && <p className="text-sm text-foreground/85">{order.lines.map((line) => `${line.quantity}x ${line.name}`).join(", ")}</p>}
            <div className="flex flex-wrap gap-2">
              {route.status === "queued" && <Button size="sm" onClick={() => run(() => updateRoute(route.id, "assigned"), "Route assigned")}><Truck size={15} />Assign</Button>}
              {(route.status === "queued" || route.status === "assigned") && <Button size="sm" variant="outline" onClick={() => run(() => updateRoute(route.id, "picked-up"), "Route picked up")}>Pick up</Button>}
              {route.status === "picked-up" && <Button size="sm" onClick={() => run(() => updateRoute(route.id, "delivered"), "Route delivered")}><Check size={15} />Delivered</Button>}
              <Button size="sm" variant="outline" onClick={() => run(() => updateRoute(route.id, "issue"), "Route issue flagged")}>Issue</Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AdvancedVenueConsole({ snapshot, run }: { snapshot: HubSnapshot; run: (action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [promoCode, setPromoCode] = useState("");
  const [promoLabel, setPromoLabel] = useState("");
  const [promoValue, setPromoValue] = useState("10");
  const [customerPhone, setCustomerPhone] = useState("");
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [report, setReport] = useState<AdvancedReport | null>(null);

  async function createPromotion() {
    await postJson("/api/promotions", {
      code: promoCode,
      label: promoLabel,
      type: "percentage",
      value: Number(promoValue) / 100,
      scope: "event",
      active: true
    });
    setPromoCode("");
    setPromoLabel("");
  }

  async function loadCustomerHistory() {
    const response = await fetch(`${serviceBase()}/api/customers/history?phone=${encodeURIComponent(customerPhone)}`, {
      headers: {  }
    });
    if (!response.ok) throw new Error("Customer history unavailable");
    setHistory(await response.json() as CustomerHistory);
  }

  async function loadAdvancedReport() {
    const response = await fetch(`${serviceBase()}/api/reports/advanced`, {
      headers: {  }
    });
    if (!response.ok) throw new Error("Advanced report unavailable");
    setReport(await response.json() as AdvancedReport);
  }

  return (
    <div className="grid gap-4">
      <Button variant="outline" asChild><Link href={`/floor?scopeType=${snapshot.event.containerType}&scopeId=${snapshot.event.id}`}>Floor & QR</Link></Button>

      <div className="grid gap-3 rounded-xl border border-border bg-white/[0.03] p-4">
        <strong className="flex items-center gap-2"><TicketPercent size={16} />Promotion</strong>
        <TextInput label="Code" value={promoCode} onChange={(value) => setPromoCode(value.toUpperCase())} placeholder="WELCOME10" />
        <TextInput label="Label" value={promoLabel} onChange={setPromoLabel} placeholder="Welcome 10%" />
        <TextInput label="Discount %" value={promoValue} onChange={setPromoValue} type="number" />
        <Button disabled={!promoCode.trim() || !promoLabel.trim() || Number(promoValue) <= 0} onClick={() => run(createPromotion, "Promotion created")}>Create promo</Button>
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-white/[0.03] p-4">
        <strong className="flex items-center gap-2"><UserRound size={16} />Customer history</strong>
        <TextInput label="Phone" value={customerPhone} onChange={setCustomerPhone} placeholder="080..." />
        <Button variant="outline" disabled={!customerPhone.trim()} onClick={() => run(loadCustomerHistory, "Customer history loaded")}>Lookup</Button>
        {history && (
          <div className="grid gap-2 border-t border-border pt-3 text-sm">
            <span>{history.profile?.name ?? "No profile"} - {history.loyalty?.points ?? 0} points</span>
            <span className="text-muted-foreground">{history.orders.length} previous orders</span>
          </div>
        )}
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-white/[0.03] p-4">
        <div className="flex items-center justify-between gap-3">
          <strong className="flex items-center gap-2"><BarChart3 size={16} />Analytics</strong>
          <Button size="sm" variant="outline" onClick={() => run(loadAdvancedReport, "Advanced report loaded")}>Load</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FinanceStat label="Customers" value={String(report?.customerProfiles ?? snapshot.customerProfiles.length)} />
          <FinanceStat label="Repeat" value={String(report?.repeatCustomers ?? 0)} />
        </div>
        {(report?.itemPerformance ?? []).slice(0, 3).map((item) => (
          <div className="flex items-center justify-between gap-3 border-t border-border pt-2 text-sm" key={item.itemId}>
            <span className="truncate">{item.itemName}</span>
            <strong>{item.quantity} sold</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function SidebarLink({ active = false, href, icon, label }: { active?: boolean; href: string; icon: ReactNode; label: string }) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex shrink-0 cursor-pointer items-center gap-3 whitespace-nowrap rounded-xs px-3 py-2.5 text-sm font-medium transition-colors",
        active ? "bg-[#181818] text-white" : "text-muted-foreground hover:bg-[#181818] hover:text-foreground"
      )}
      href={href}
    >
      <span className={cn("transition-colors duration-200", active ? "text-white" : "text-muted-foreground group-hover:text-foreground")}>{icon}</span>
      {label}
    </Link>
  );
}

function Metric({ title, value, icon, intent = "neutral" }: { title: string; value: string; icon: ReactNode; intent?: "neutral" | "warn" | "ok" }) {
  return (
    <Card className="transition-transform duration-200 hover:-translate-y-0.5">
      <CardContent className="flex min-h-36 flex-col justify-between p-6">
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", intent === "warn" ? "bg-amber-500/15 text-amber-300" : intent === "ok" ? "bg-emerald-500/15 text-emerald-400" : "bg-primary/10 text-primary")}>
          {icon}
        </div>
        <div>
          <strong className="text-2xl font-semibold tracking-tight text-foreground">{value}</strong>
          <p className="mt-1.5 text-sm text-muted-foreground">{title}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PanelHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <header className="mb-4 flex items-center justify-between gap-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <span className="text-sm text-muted-foreground">{detail}</span>
    </header>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground">{text}</div>;
}

function MiniForm({ title, children, onSubmit }: { title: string; children: ReactNode; onSubmit: () => void }) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className="grid gap-3 rounded-xl border border-border bg-white/[0.03] p-4" onSubmit={handleSubmit}>
      <strong>{title}</strong>
      {children}
    </form>
  );
}

function TextInput({ label, value, onChange, placeholder, type = "text", required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; required?: boolean }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <input
        className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        required={required}
      />
    </label>
  );
}

function SelectInput({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <select
        className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function QuantityRow({ item, quantity, onChange }: { item: MenuItem; quantity: number; onChange: (quantity: number) => void }) {
  return (
    <article className={cn("grid gap-3 rounded-xl border border-border bg-white/[0.03] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", !item.available && "opacity-50")}>
      <div className="grid gap-1">
        <strong>{item.name}</strong>
        <span className="text-sm text-muted-foreground">{item.category} - {formatNaira(item.price)}</span>
      </div>
      <div className="grid w-fit grid-cols-[34px_32px_34px] items-center justify-items-center rounded-full border border-border p-1">
        <button className="grid h-8 w-8 place-items-center rounded-full bg-secondary text-foreground disabled:opacity-40" disabled={!item.available || quantity === 0} onClick={() => onChange(Math.max(0, quantity - 1))} type="button" title="Remove one">
          <Minus size={15} />
        </button>
        <output className="font-semibold">{quantity}</output>
        <button className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40" disabled={!item.available} onClick={() => onChange(quantity + 1)} type="button" title="Add one">
          <Plus size={15} />
        </button>
      </div>
    </article>
  );
}

function TotalRow({ label, value, strong = false, muted = false }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", strong && "border-t border-border pt-3 text-lg", muted && "text-muted-foreground")}>
      <span>{label}</span>
      <strong>{formatNaira(value)}</strong>
    </div>
  );
}

function OrderRow({ order, snapshot, actions }: { order: Order; snapshot: HubSnapshot; actions: ReactNode }) {
  const table = snapshot.tables.find((candidate) => candidate.id === order.tableId);
  const store = snapshot.stores.find((candidate) => candidate.id === order.storeId);
  const outstanding = outstandingBalance(order, snapshot);

  return (
    <div className="grid gap-4 rounded-xl border border-border bg-white/[0.03] p-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong>{table?.label ?? "Walk-up"}</strong>
          <Badge variant={statusVariant(order.status)}>{order.status}</Badge>
        </div>
        <span className="text-sm text-muted-foreground">{store?.name ?? "Unknown storefront"} - {vendorName(snapshot, order.storeId)} - {order.origin}</span>
        <p className="break-words text-sm text-foreground/85">{order.lines.map((line) => `${line.quantity}x ${line.name}`).join(", ")}</p>
      </div>
      <div className="grid gap-1 lg:justify-items-end">
        <strong>{formatNaira(order.totals.total)}</strong>
        <span className="text-sm text-muted-foreground">{formatNaira(outstanding)} due</span>
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">{actions}</div>
    </div>
  );
}
