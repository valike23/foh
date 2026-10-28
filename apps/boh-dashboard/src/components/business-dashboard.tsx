"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Building2, CalendarDays, Check, ChevronDown, CircleDollarSign, ClipboardList, Clock3, Package, Plus, Radio, RefreshCw, Store, TriangleAlert } from "lucide-react";
import { managementApi } from "../lib/management-api";
import { dashboardData, money, remaining } from "../lib/hospitality-data";
import { servicePageUrl } from "../lib/service-pages";
import { useManagementTenant, useManagementUser } from "./management-shell";
import { OperationalProvider, useOperations } from "./operational-context";
import "./business-dashboard.css";

import { canStore } from "../lib/storefront-access";

type Directory = { total: number; counts: { total: number; active: number; draft: number } };
export function BusinessDashboard() { return <OperationalProvider><DashboardContent /></OperationalProvider>; }
function DashboardContent() {
  const user = useManagementUser(); const tenant = useManagementTenant();
  const { operations, snapshot, selected, select, loading, error: serviceError, reload, refreshedAt } = useOperations();
  const [counts, setCounts] = useState<{ venues: Directory; events: Directory } | null>(null);
  const [error, setError] = useState(""); const [refreshing, setRefreshing] = useState(false);
  const loadCounts = useCallback(async () => {
    try { const [venues, events] = await Promise.all([managementApi<Directory>("/venues"), managementApi<Directory>("/events")]); setCounts({ venues, events }); setError(""); }
    catch (error) { setError((error as Error).message); }
  }, []);
  useEffect(() => { void loadCounts(); }, [loadCounts]);
  async function refresh() { setRefreshing(true); try { await Promise.all([loadCounts(), reload()]); } finally { setRefreshing(false); } }
  const data = snapshot ? dashboardData(snapshot) : null;
  const live = operations.filter(o => o.status === "live");
  const confirmed = data?.orders.filter(o => o.status !== "sent" && snapshot && canStore(snapshot, o.storeId, "finance")) ?? [];
  const open = data?.orders.filter(o => !["settled", "void", "rejected"].includes(o.status)) ?? [];
  const pending = data?.orders.filter(o => o.status === "sent") ?? [];
  const collected = data?.payments.reduce((sum, p) => sum + p.amount, 0) ?? 0;
  const financialAccess = !snapshot || snapshot.stores.some(v => canStore(snapshot, v.id, "finance"));
  const published = operations.filter(o => o.published);
  const now = new Date();
  const stamp = Math.floor(now.getTime() / 900000) * 900000;
  const bars = Array.from({ length: 6 }, (_, index) => {
    const start = stamp - (5 - index) * 900000;
    return { start, amount: confirmed.filter(o => Date.parse(o.createdAt) >= start && Date.parse(o.createdAt) < start + 900000).reduce((sum, o) => sum + o.totals.total, 0) };
  });
  const peak = Math.max(1, ...bars.map(bar => bar.amount));
  const operationLink = (page: "command" | "payments" | "inventory" | "tables" | "staff-order") => selected ? page === "command" ? `/orders?operation=${encodeURIComponent(selected)}` : servicePageUrl(page, selected) : "/operations";
  const sales = data?.orders.slice(0, 5) ?? [];
  return <div className="business-dashboard">
    <header className="bd-heading"><div><p className="bd-eyebrow">{tenant?.name ?? "YOUR BUSINESS"}</p><h1>Dashboard<span>.</span></h1><p>Welcome back, {user?.name.split(" ")[0] ?? "there"}. Here’s your business at a glance.</p></div><div className="bd-heading-actions"><span><CalendarDays size={14} />{now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" })}</span><button type="button" aria-label="Refresh dashboard" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={15} className={refreshing ? "animate-spin" : ""} /></button></div></header>
    {(error || serviceError) && <div className="bd-error" role="alert">{error || serviceError}<button type="button" onClick={() => void refresh()}>Retry</button></div>}
    <section className="bd-business-metrics" aria-label="Business totals">
      <Metric title="Total venues" value={counts ? String(counts.venues.counts.total ?? counts.venues.total) : "—"} detail={counts ? `${counts.venues.counts.active ?? 0} active venues` : "Loading venues"} icon={<Building2 size={18} />} href="/venues" />
      <Metric title="Total events" value={counts ? String(counts.events.counts.total ?? counts.events.total) : "—"} detail={counts ? `${counts.events.counts.draft ?? 0} in draft` : "Loading events"} icon={<CalendarDays size={18} />} href="/events" />
      <Metric title="Live services" value={loading && !operations.length ? "—" : String(live.length)} detail={live.length ? "Open and taking orders" : "No service currently open"} icon={<Radio size={18} />} href="/operations" active={live.length > 0} />
      <Metric title="Open orders" value={loading ? "—" : String(open.length)} detail="In the selected service" icon={<ClipboardList size={18} />} href={operationLink("command")} />
    </section>
    <section className="bd-service-heading"><div><h2>Service overview</h2><p>{snapshot ? "Sales and stock for your selected operation." : "Choose a published operation to see how service is moving."}</p></div>{published.length > 0 && <label><span className="sr-only">Dashboard operation</span><select value={selected} onChange={event => select(event.target.value)}>{published.map(operation => <option key={operation.id} value={operation.id}>{operation.name}</option>)}</select><ChevronDown size={14} /></label>}</section>
    {!snapshot ? <section className="bd-first-service"><div className="bd-first-icon"><Store size={28} /></div><div><p className="bd-eyebrow">{loading ? "LOADING SERVICE" : "READY WHEN YOU ARE"}</p><h2>{loading ? "Getting your service overview…" : "Your next great service starts here."}</h2><p>{operations.length ? "Add your storefronts and floor plan, then publish your operation. Your sales, orders and stock will appear here." : "Create a venue or event, bring your vendors together and set up your first operation."}</p><div className="bd-first-actions"><Link href={operations.length ? "/operations" : "/venues/new"} className="bd-primary">{operations.length ? "Set up service" : "Create a venue"}<ArrowRight size={15} /></Link><Link href="/events/new" className="bd-text-link">Create an event<ArrowUpRight size={14} /></Link></div></div></section> : <>
      <div className="bd-service-label"><span className={`bd-service-status ${snapshot.event.status === "live" ? "live" : ""}`}><i />{snapshot.event.status}</span><strong>{snapshot.event.name}</strong><span>Current or most recent operating period</span></div>
      {snapshot.onlinePermissions && <p className="mb-4 text-sm text-muted-foreground">{financialAccess ? "Financial totals include only storefronts where your role permits financial access." : "Your role does not include financial access. You can view assigned orders and stock."}</p>}
      {financialAccess && <section className="bd-financial-metrics" aria-label="Selected service totals"><article><span>Sales total</span><strong>{money(data!.gross)}</strong><small>{confirmed.length} confirmed orders</small></article><article><span>Collected</span><strong>{money(collected)}</strong><small>Recorded confirmed payments</small></article><article><span>Outstanding</span><strong>{money(data!.outstanding)}</strong><small>Still to collect</small></article><article><span>Average sale</span><strong>{money(confirmed.length ? data!.gross / confirmed.length : 0)}</strong><small>Per confirmed order</small></article></section>}
      <div className="bd-service-grid"><section className="bd-panel"><PanelHeading title="Sales activity" detail={financialAccess ? "Last 90 minutes" : "Financial access restricted"} /><div className="bd-chart" aria-label="Sales by quarter-hour">{bars.map(bar => <div className="bd-chart-column" key={bar.start}><strong>{money(bar.amount)}</strong><div style={{ height: `${Math.max(4, bar.amount / peak * 130)}px` }} className={bar.amount === peak ? "peak" : ""} /><span>{new Date(bar.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}</span></div>)}</div></section>
      <section className="bd-panel"><PanelHeading title="Needs attention" detail={`${pending.length + data!.lowStock.length} alerts`} /><div className="bd-attention"><Link href={operationLink("command")}><span className="bd-attention-icon"><ClipboardList size={16} /></span><div><strong>{pending.length ? `${pending.length} orders to confirm` : "Order queue is clear"}</strong><span>{pending.length ? "Review orders before preparation" : "New orders will appear here"}</span></div><ArrowUpRight size={14} /></Link><Link href={operationLink("inventory")}><span className="bd-attention-icon amber"><Package size={16} /></span><div><strong>{data!.lowStock.length ? `${data!.lowStock.length} items need stock` : "Stock is looking good"}</strong><span>{data!.lowStock.slice(0, 2).map(item => item.name).join(", ") || "No low-stock alerts"}</span></div><ArrowUpRight size={14} /></Link><Link href={operationLink("payments")}><span className="bd-attention-icon"><CircleDollarSign size={16} /></span><div><strong>{data!.outstanding ? `${money(data!.outstanding)} outstanding` : "Payments are up to date"}</strong><span>Review recorded payments and balances</span></div><ArrowUpRight size={14} /></Link></div></section></div>
    </>}
    <div className="bd-bottom-grid"><section className="bd-panel"><PanelHeading title="Latest sales" link={{ href: operationLink("payments"), label: "View sales" }} />{sales.length && snapshot ? <div className="bd-table-wrap"><table className="bd-sales-table"><thead><tr><th>Receipt / table</th><th>Recorded by</th><th>Amount</th><th>Status</th></tr></thead><tbody>{sales.map(order => <tr key={order.id}><td><Link href={`/sales?operation=${encodeURIComponent(selected)}&order=${encodeURIComponent(order.id)}`}>{snapshot.tables.find(table => table.id === order.tableId)?.label ?? "Walk-in"}<span>{order.id.slice(-8).toUpperCase()}</span></Link></td><td>{order.createdBy}</td><td>{canStore(snapshot, order.storeId, "finance") ? money(order.totals.total) : "Restricted"}</td><td><span className={`bd-order-status ${order.status === "settled" ? "paid" : ""}`}>{order.status === "settled" ? "Paid" : order.status}</span></td></tr>)}</tbody></table></div> : <div className="bd-empty"><ClipboardList size={26} /><h3>No sales to show yet</h3><p>Once service opens, your recent orders and payments will be right here.</p></div>}</section>
    <section className="bd-panel"><PanelHeading title="Quick actions" /><div className="bd-quick-actions">{user?.role === "owner" && <Link href="/venues/new"><Building2 size={17} /><span>Add a venue</span><Plus size={14} /></Link>}{(user?.role !== "staff" || user.assignments?.some(a => a.role === "venue-manager")) && <Link href="/events/new"><CalendarDays size={17} /><span>Create an event</span><Plus size={14} /></Link>}{(user?.role !== "staff" || user.assignments?.some(a => ["venue-manager", "storefront-manager"].includes(a.role))) ? <><Link href="/storefronts"><Store size={17} /><span>Manage storefronts</span><ArrowRight size={14} /></Link><Link href="/operations"><Radio size={17} /><span>Service operations</span><ArrowRight size={14} /></Link></> : <><Link href={operationLink("command")}><ClipboardList size={17} /><span>View orders</span><ArrowRight size={14} /></Link>{user.assignments?.some(a => ["cashier", "waiter"].includes(a.role)) && <Link href={operationLink("staff-order")}><Store size={17} /><span>New sale</span><ArrowRight size={14} /></Link>}{user.assignments?.some(a => a.role === "cashier") && <Link href={operationLink("payments")}><CircleDollarSign size={17} /><span>Payments</span><ArrowRight size={14} /></Link>}</>}</div><p className="bd-quick-note"><Check size={12} />Your workspace, ready for what’s next.</p></section></div>
    <footer className="bd-footer"><span>{refreshedAt ? `Updated ${refreshedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })} · Africa/Lagos` : "Loading your workspace"}</span><span>Figures reflect locally available service records.</span></footer>
  </div>;
}
function Metric({ title, value, detail, icon, href, active = false }: { title: string; value: string; detail: string; icon: ReactNode; href: string; active?: boolean }) { return <Link className="bd-metric" href={href}><div><span>{title}</span><i className={active ? "active" : ""}>{icon}</i></div><strong>{value}</strong><p>{active && <span className="bd-live-dot" />}{detail}</p></Link>; }
function PanelHeading({ title, detail, link }: { title: string; detail?: string; link?: { href: string; label: string } }) { return <header className="bd-panel-heading"><h2>{title}</h2>{link ? <Link href={link.href}>{link.label}<ArrowUpRight size={12} /></Link> : detail ? <span>{detail}</span> : null}</header>; }
