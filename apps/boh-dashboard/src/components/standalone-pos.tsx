"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Search, Plus, Minus, Maximize, LockKeyhole, ShoppingBag, Coffee, Utensils, RefreshCw, Check, CreditCard, Banknote, Landmark, X } from "./pos-icons";
import { calculateOrderTotals, type HubSnapshot, type ManagementUser, type Order } from "@exa-foh/shared";
import { canStore } from "../lib/storefront-access";
import { paid, remaining } from "../lib/hospitality-data";
import { useOnlineWorkspace } from "./deployment-context";
import "./standalone-pos.css";
import { localUuid } from "../lib/local-uuid";
import { OfflineSyncBadge } from "./offline-sync";

class PosError extends Error { constructor(message: string, public status: number) { super(message); } }
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/manage/pos${path}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, cache: "no-store", ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new PosError(data.error ?? "Unable to reach the POS service. Retry when connected.", response.status);
  return data;
}
type Operation = { id: string; name: string; published: boolean; status: string };
type Customer = { id: string; name: string | null; phone: string | null; email: string | null; spent: number; orders: number };
type Tenant = { name: string; brandLogo?: string | null };
type PendingSale = { payload: { requestId: string; storeId: string; tableId?: string; customerName?: string; customerId?: string; customerPhone?: string; customerEmail?: string; lines: { menuItemId: string; quantity: number }[] }; operation: string };
const currency = (amount: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);

export function StandalonePos() {
  const online = useOnlineWorkspace();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<ManagementUser | null>(null), [tenant, setTenant] = useState<Tenant | null>(null);
  const [brandReady, setBrandReady] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const [operations, setOperations] = useState<Operation[]>([]), [operation, setOperation] = useState("");
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null), [storeId, setStoreId] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({}), [search, setSearch] = useState(""), [category, setCategory] = useState("All items");
  const [tableId, setTableId] = useState(""), [customerName, setCustomerName] = useState(""), [tab, setTab] = useState<"sell" | "orders">("sell");
  const [customerId, setCustomerId] = useState(""), [customerPhone, setCustomerPhone] = useState(""), [customerEmail, setCustomerEmail] = useState(""), [customers, setCustomers] = useState<Customer[]>([]), [customerError, setCustomerError] = useState("");
  const [receipt, setReceipt] = useState<Order | null>(null), [method, setMethod] = useState<"cash" | "pos" | "bank-transfer">("cash");
  const [cash, setCash] = useState(""), [confirmed, setConfirmed] = useState(false), [notice, setNotice] = useState("");
  const pendingSale = useRef<PendingSale | null>(null), pendingPayment = useRef<{ requestId: string; orderId: string; amount: number; method: string } | null>(null);
  const inFlight = useRef(false);
  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (!online) return;
    let active = true;
    api<{ tenant: Tenant | null }>("/tenant").then(result => { if (active) setTenant(result.tenant); }).catch(() => {}).finally(() => { if (active) setBrandReady(true); });
    return () => { active = false; };
  }, [online]);
  useEffect(() => { const update = () => setFullscreen(!!document.fullscreenElement); update(); document.addEventListener("fullscreenchange", update); return () => document.removeEventListener("fullscreenchange", update); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (pendingSale.current || pendingPayment.current || Object.values(cart).some(Boolean)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [cart]);
  function problem(e: unknown) {
    setError((e as Error).message);
    if (e instanceof PosError && e.status === 401) { setUser(null); setSnapshot(null); setCart({}); pendingSale.current = null; pendingPayment.current = null; setReceipt(null); }
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: ManagementUser; tenant: Tenant }>("/auth/login", { email: form.get("email"), password: form.get("password") });
      const data = await api<{ items: Operation[] }>("/operations");
      setUser(result.user); setTenant(result.tenant); setOperations(data.items.filter(o => o.published)); setOperation(data.items.find(o => o.published && o.status === "live")?.id ?? data.items.find(o => o.published)?.id ?? "");
    } catch (e) { problem(e); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!user || !operation) return;
    let active = true;
    async function load() {
      try { const s = await api<HubSnapshot>(`/operations/${operation}/service/snapshot`); if (active) { setSnapshot(s); setStoreId(current => s.stores.some(store => store.id === current && canStore(s, store.id, "order")) ? current : s.stores.find(store => canStore(s, store.id, "order"))?.id ?? ""); } }
      catch (e) { if (active) problem(e); }
    }
    void load(); const timer = setInterval(() => { if (document.visibilityState === "visible" && !inFlight.current) void load(); }, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [user, operation]);
  useEffect(() => {
    setCustomers([]); setCustomerError("");
    if (!user || !operation || customerId || customerName.trim().length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      api<{ items: Customer[] }>('/operations/' + operation + '/service/customers?q=' + encodeURIComponent(customerName)).then(result => { if (active) setCustomers(result.items); }).catch(e => { if (active) setCustomerError(e.message); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [customerName, customerId, operation, user]);
  async function refresh() {
    try { const data = await api<{ items: Operation[] }>("/operations"); setOperations(data.items.filter(o => o.published)); if (operation) setSnapshot(await api<HubSnapshot>(`/operations/${operation}/service/snapshot`)); setNotice("Service refreshed"); }
    catch (e) { problem(e); }
  }
  async function enterFullscreen() { try { await document.documentElement.requestFullscreen(); setError(""); } catch { setError("Your browser could not enter full-screen mode. Allow full-screen access and try again."); } }
  async function lock() {
    if (Object.values(cart).some(Boolean) || pendingSale.current || pendingPayment.current) { setError("Finish the current sale or clear the basket before locking the POS."); return; }
    setBusy(true); try { await api("/auth/logout", {}); setUser(null); setSnapshot(null); setReceipt(null); setError(""); } catch (e) { problem(e); } finally { setBusy(false); }
  }
  const stores = snapshot?.stores.filter(s => canStore(snapshot, s.id, "order")) ?? [];
  const menu = snapshot?.menuItems.filter(item => item.storeId === storeId) ?? [];
  const lines = Object.entries(cart).filter(([, quantity]) => quantity > 0).flatMap(([id, quantity]) => { const item = menu.find(m => m.id === id); return item ? [{ id, menuItemId: id, name: item.name, quantity, unitPrice: item.price, modifiers: [] }] : []; });
  const totals = calculateOrderTotals(lines, snapshot?.chargeRules ?? []);
  const live = snapshot?.event.status === "live";
  const blocked = busy || !!pendingSale.current || !!pendingPayment.current || !!receipt;
  function quantity(id: string, delta: number) {
    if (blocked || !live) return;
    const item = menu.find(m => m.id === id), stock = snapshot?.inventory.find(s => s.id === item?.stockItemId);
    setCart(current => ({ ...current, [id]: Math.max(0, Math.min(1000, stock?.quantity ?? 0, (current[id] ?? 0) + delta)) }));
    setNotice("");
  }
  async function submitSale() {
    if (inFlight.current || !snapshot || !lines.length || !fullscreen) return;
    inFlight.current = true; setBusy(true); setError("");
    const attempt = pendingSale.current ?? { operation, payload: { requestId: localUuid(), storeId, tableId: tableId || undefined, customerName: customerName.trim() || undefined, customerId: customerId || undefined, customerPhone: customerId ? undefined : customerPhone.trim() || undefined, customerEmail: customerId ? undefined : customerEmail.trim() || undefined, lines: lines.map(line => ({ menuItemId: line.menuItemId, quantity: line.quantity })) } };
    pendingSale.current = attempt;
    try {
      const order = await api<Order>(`/operations/${attempt.operation}/service/orders`, attempt.payload);
      pendingSale.current = null; setCart({}); setTableId(""); setCustomerName(""); setCustomerId(""); setCustomerPhone(""); setCustomerEmail(""); setCustomers([]); setReceipt(order); setCash(""); setConfirmed(false); setNotice("Sale saved");
      setSnapshot(await api<HubSnapshot>(`/operations/${operation}/service/snapshot`));
    } catch (e) { if (e instanceof PosError && e.status < 500 && !e.message.includes("Service changed")) pendingSale.current = null; problem(e); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function pay() {
    if (inFlight.current || !snapshot || !receipt || !fullscreen) return;
    const balance = remaining(snapshot, receipt);
    if (method !== "cash" && !confirmed) { setError("Confirm the payment on your card terminal or bank account first."); return; }
    if (method === "cash" && (!cash || Number(cash) < balance)) { setError("Enter the cash received. It must cover the outstanding balance."); return; }
    inFlight.current = true; setBusy(true); setError("");
    const attempt = pendingPayment.current ?? { requestId: localUuid(), orderId: receipt.id, amount: balance, method };
    pendingPayment.current = attempt;
    try {
      await api(`/operations/${operation}/service/payments`, attempt);
      const s = await api<HubSnapshot>(`/operations/${operation}/service/snapshot`); setSnapshot(s); setReceipt(s.orders.find(o => o.id === receipt.id) ?? receipt); pendingPayment.current = null; setNotice("Payment recorded. Sale complete.");
    } catch (e) { if (e instanceof PosError && e.status < 500 && !e.message.includes("Service changed")) pendingPayment.current = null; problem(e); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (!online) return <main className="pos-login"><h1>Open POS from your online business workspace.</h1></main>;
  if (!user) return <main className="pos-login"><section aria-label="Staff sign in"><div className="pos-login-business" aria-busy={!brandReady}>{brandReady && <><img src={tenant?.brandLogo || "/exa-icon.svg"} alt={`${tenant?.name ?? "EXA"} logo`} width={64} height={64} /><h1>{tenant?.name ?? "EXA"}</h1></>}</div><form method="post" onSubmit={login}><label>Email<input name="email" type="email" autoComplete="username" required autoFocus /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label>{error && <p role="alert" className="pos-error">{error}</p>}<button className="pos-primary" disabled={busy || !ready}>{busy ? "Signing in…" : "Sign in"}</button></form></section></main>;
  const activeReceipt = receipt && (snapshot?.orders.find(o => o.id === receipt.id) ?? receipt);
  const balance = activeReceipt && snapshot ? remaining(snapshot, activeReceipt) : 0;
  return <main className="pos-app">
    <header className="pos-header"><div className="pos-brand"><ShoppingBag size={24} /><div><strong>{tenant?.name}</strong><small>POINT OF SALE</small></div></div><label>Service<select aria-label="POS service" disabled={blocked || lines.length > 0} value={operation} onChange={e => { setOperation(e.target.value); setSnapshot(null); setStoreId(""); setCart({}); }}>{operations.map(o => <option key={o.id} value={o.id}>{o.name} · {o.status}</option>)}</select></label><OfflineSyncBadge pos /><span className={`pos-service-status ${live ? "open" : ""}`}>{live ? "Service open" : snapshot ? `Service ${snapshot.event.status}` : "No service"}</span><button aria-label="Refresh POS" onClick={refresh} disabled={busy}><RefreshCw size={20} /></button><button onClick={lock} disabled={busy}><LockKeyhole size={18} />{user.name.split(" ")[0]} · Lock</button></header>
    {error && <div role="alert" className="pos-alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}><X size={18} /></button></div>}
    {notice && <p role="status" className="pos-notice">{notice}</p>}
    <div className="pos-workspace"><section className="pos-catalog"><div className="pos-toolbar"><div className="pos-tabs"><button aria-pressed={tab === "sell"} onClick={() => setTab("sell")}>New sale</button><button aria-pressed={tab === "orders"} onClick={() => setTab("orders")}>Open orders</button></div><label>Selling point<select aria-label="POS selling point" disabled={blocked || lines.length > 0} value={storeId} onChange={e => { setStoreId(e.target.value); setCategory("All items"); setTableId(""); }}>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
      {!operations.length ? <div className="pos-empty"><ShoppingBag size={40} /><h1>No published services yet</h1><p>Ask your manager to publish a service, add menu items and stock, and open it.</p><button onClick={refresh}>Refresh services</button></div> : !snapshot ? <div className="pos-empty">Loading service…</div> : !stores.length ? <div className="pos-empty"><LockKeyhole size={36} /><h1>No POS access for this service</h1><p>Ask your manager to assign you a cashier or selling role.</p></div> : tab === "sell" ? <><div className="pos-search"><Search size={20} /><input aria-label="Search products" placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)} /></div><h2 className="pos-section-label">Categories</h2><nav className="pos-categories" aria-label="Product categories">{["All items", ...new Set(menu.map(m => m.category))].map(c => <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{menu.find(m => m.category === c)?.categoryImage ? <img src={menu.find(m => m.category === c)?.categoryImage} alt="" width={28} height={28} style={{ objectFit: "cover", borderRadius: 6 }} /> : c === "Food" ? <Utensils size={21} /> : c === "Drinks" ? <Coffee size={21} /> : <ShoppingBag size={21} />}{c}</button>)}</nav>{!live && <p className="pos-warning">Service is {snapshot.event.status}. Your manager needs to open it before you can sell.</p>}<div className="pos-products">{menu.filter(m => (category === "All items" || m.category === category) && m.name.toLowerCase().includes(search.toLowerCase())).map(item => { const stock = snapshot.inventory.find(s => s.id === item.stockItemId)?.quantity ?? 0; const available = item.available && stock > 0; return <button key={item.id} className={`pos-product ${item.category === "Food" ? "food" : "drink"}`} aria-label={`Add ${item.name}`} disabled={!available || !live || blocked || (cart[item.id] ?? 0) >= stock} onClick={() => quantity(item.id, 1)}><span className="pos-product-art">{item.image ? <img src={item.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 11 }} /> : item.category === "Food" ? <Utensils size={30} /> : <Coffee size={30} />}{cart[item.id] > 0 && <b>{cart[item.id]}</b>}</span><strong>{item.name}</strong><span>{currency(item.price)}</span><small>{available ? `${stock} in stock` : "Sold out"}</small><span className="pos-product-add"><Plus size={14} />Add</span></button>; })}</div>{!menu.length && <p className="pos-empty">No menu items for this selling point. Ask your manager to configure the menu.</p>}</> : <div className="pos-order-list"><h1>Open orders</h1>{snapshot.orders.filter(o => o.storeId === storeId && !["settled", "void", "rejected"].includes(o.status)).map(o => <button key={o.id} disabled={busy || lines.length > 0 || !!pendingPayment.current} onClick={() => { setReceipt(o); setCash(""); setConfirmed(false); }}><span><strong>#{o.id.slice(-8).toUpperCase()}</strong><small>{snapshot.tables.find(t => t.id === o.tableId)?.label ?? "Walk-in"} · {o.status}</small></span><strong>{currency(remaining(snapshot, o))}</strong></button>)}</div>}
    </section><aside className="pos-basket" aria-label="POS checkout">{activeReceipt && snapshot ? <><div className="pos-print-only"><h1>{tenant?.name}</h1><p>{snapshot.event.name}</p><strong>{balance > 0 ? "UNPAID RECEIPT" : "PAID RECEIPT"}</strong></div><div className="pos-basket-title"><h1>Receipt #{activeReceipt.id.slice(-8).toUpperCase()}</h1><span>{activeReceipt.status}</span></div><div className="pos-receipt-details"><p>{new Date(activeReceipt.createdAt).toLocaleString("en-GB")}</p><p>Served by {activeReceipt.createdBy}</p><p>{snapshot.tables.find(t => t.id === activeReceipt.tableId)?.label ?? "Walk-in"}{activeReceipt.customerName ? ` · ${activeReceipt.customerName}` : ""}</p></div><div className="pos-cart-lines">{activeReceipt.lines.map(line => <div className="pos-receipt-line" key={line.id}><span>{line.quantity} × {line.name}</span><strong>{currency((line.unitPrice + line.modifiers.reduce((sum, m) => sum + m.priceDelta, 0)) * line.quantity)}</strong></div>)}</div><div className="pos-checkout"><div className="pos-summary"><span>Subtotal</span><strong>{currency(activeReceipt.totals.subtotal)}</strong></div>{activeReceipt.totals.charges.map(charge => <div className="pos-summary" key={charge.chargeRuleId}><span>{charge.name}</span><strong>{currency(charge.amount)}</strong></div>)}<div className="pos-total"><span>Total</span><strong>{currency(activeReceipt.totals.total)}</strong></div><p className="pos-summary">Paid {currency(paid(snapshot, activeReceipt.id))} · Due {currency(balance)}</p>{snapshot.payments.filter(p => p.orderId === activeReceipt.id && ["validated", "manually-confirmed"].includes(p.status)).map(p => <div className="pos-summary" key={p.id}><span>{p.method === "pos" ? "Card" : p.method === "bank-transfer" ? "Bank transfer" : p.method}</span><strong>{currency(p.amount)}</strong></div>)}{activeReceipt.status === "sent" && !canStore(snapshot, activeReceipt.storeId, "pay") ? <p className="pos-warning">This order is waiting for approval. A manager or preparation team member must accept it before payment.</p> : balance > 0 && canStore(snapshot, activeReceipt.storeId, "pay") && snapshot.event.status !== "closed" ? <><div className="pos-methods">{([{ value: "cash", label: "Cash", Icon: Banknote }, { value: "pos", label: "Card", Icon: CreditCard }, { value: "bank-transfer", label: "Transfer", Icon: Landmark }] as const).map(m => <button key={m.value} disabled={busy || !!pendingPayment.current} aria-pressed={method === m.value} onClick={() => { setMethod(m.value); setConfirmed(false); }}><m.Icon size={21} />{m.label}</button>)}</div>{method === "cash" ? <label>Cash received<input aria-label="Cash received" inputMode="decimal" type="number" min={0} step="0.01" value={cash} disabled={busy || !!pendingPayment.current} onChange={e => setCash(e.target.value)} /><span className="pos-summary">Change: {currency(Math.max(0, Number(cash) - balance))}</span></label> : <label className="pos-confirm"><input type="checkbox" checked={confirmed} disabled={busy || !!pendingPayment.current} onChange={e => setConfirmed(e.target.checked)} />I verified this payment on the terminal or bank account.</label>}<button className="pos-primary" disabled={busy} onClick={pay}>{busy ? "Recording…" : pendingPayment.current ? "Retry same payment" : `Record ${currency(balance)} payment`}</button><p className="pos-fine">Card and transfer payments are recorded after you confirm them externally.</p></> : balance > 0 ? <p className="pos-warning">Your role cannot collect payment here, or the service is closed.</p> : <p className="pos-success"><Check size={22} />Paid in full</p>}<button disabled={busy || !!pendingPayment.current} onClick={() => window.print()}>Print receipt</button><button disabled={busy || !!pendingPayment.current} onClick={() => { setReceipt(null); setNotice(""); }}>Next sale</button></div></> : <><div className="pos-basket-title"><h1>Current sale</h1><button disabled={blocked} onClick={() => setCart({})}>Clear</button></div><div className="pos-cart-lines">{lines.length ? lines.map(line => <article className="pos-cart-line" key={line.id}><div><strong>{line.name}</strong><span>{currency(line.unitPrice)}</span></div><div className="pos-quantity"><button aria-label={`Decrease ${line.name}`} disabled={blocked} onClick={() => quantity(line.id, -1)}><Minus size={18} /></button><strong>{line.quantity}</strong><button aria-label={`Increase ${line.name}`} disabled={blocked} onClick={() => quantity(line.id, 1)}><Plus size={18} /></button></div><b>{currency(line.unitPrice * line.quantity)}</b></article>) : <div className="pos-empty"><ShoppingBag size={36} /><h2>Your basket is empty</h2><p>Tap an item or click to start a sale.</p></div>}</div><div className="pos-checkout"><label>Table<select aria-label="POS table" value={tableId} disabled={blocked} onChange={e => setTableId(e.target.value)}><option value="">Walk-in / pickup</option>{snapshot?.tables.filter(t => t.storeId === storeId).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label><label>Customer name, phone or code (optional)<input aria-label="POS customer name" maxLength={100} value={customerName} disabled={blocked} onChange={e => { setCustomerName(e.target.value); setCustomerId(""); setCustomerPhone(""); setCustomerEmail(""); }} /></label>{customerError && <p role="alert" className="pos-fine">{customerError}</p>}{customers.length > 0 && <div className="pos-customer-results" aria-label="Matching customers">{customers.map(c => <button type="button" key={c.id} disabled={blocked} onClick={() => { setCustomerId(c.id); setCustomerName(c.name ?? "Customer"); setCustomerPhone(c.phone ?? ""); setCustomerEmail(c.email ?? ""); setCustomers([]); }}><strong>{c.name ?? "Customer"}</strong><span>{c.phone ?? c.email ?? c.id}</span><small>{currency(c.spent)} paid ? {c.orders} orders in your accessible sales</small></button>)}</div>}{customerId ? <p className="pos-fine">Selected: {customerPhone || customerEmail || customerId}<button type="button" disabled={blocked} onClick={() => { setCustomerId(""); setCustomerName(""); setCustomerPhone(""); setCustomerEmail(""); }}>Clear customer</button></p> : <><label>Customer phone (optional)<input aria-label="POS customer phone" inputMode="tel" maxLength={24} value={customerPhone} disabled={blocked} onChange={e => setCustomerPhone(e.target.value)} /></label><label>Customer email (optional)<input aria-label="POS customer email" type="email" maxLength={254} value={customerEmail} disabled={blocked} onChange={e => setCustomerEmail(e.target.value)} /></label></>}<div className="pos-summary"><span>Subtotal</span><strong>{currency(totals.subtotal)}</strong></div>{totals.charges.map(charge => <div className="pos-summary" key={charge.chargeRuleId}><span>{charge.name}</span><strong>{currency(charge.amount)}</strong></div>)}<div className="pos-total"><span>Total</span><strong>{currency(totals.total)}</strong></div><button className="pos-primary" disabled={busy || !lines.length || !live || !storeId} onClick={submitSale}>{busy ? "Saving sale…" : pendingSale.current ? "Retry same sale" : "Save sale & checkout"}</button></div></>}</aside></div>
    {!fullscreen && <div className="pos-fullscreen-gate"><Maximize size={44} /><h1>{snapshot ? "POS is paused" : "Your terminal is ready"}</h1><p>This terminal runs in full-screen mode for clear, focused service.</p><button className="pos-primary" onClick={enterFullscreen}>Enter full-screen POS</button><button onClick={lock} disabled={busy}>Lock terminal</button>{error && <p role="alert" className="pos-error">{error}</p>}</div>}
  </main>;
}
