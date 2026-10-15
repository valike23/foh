"use client";

import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, ReceiptText, Send, Wifi } from "lucide-react";
import { Button, Card, CardContent, cn, GuestBrandingFrame, ProductImage } from "@exa-foh/ui";
import {
  calculateOrderTotals,
  formatNaira,
  type HubSnapshot,
  type MenuItem,
  type Promotion
} from "@exa-foh/shared";
import type { GuestBranding } from "@exa-foh/shared";

const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL ?? "http://localhost:4000";

type Cart = Record<string, number>;
type GuestTotals = ReturnType<typeof calculateOrderTotals>;

function useSnapshot(entryToken?: string, previewSnapshot?: HubSnapshot) {
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(previewSnapshot ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (previewSnapshot) { setSnapshot(previewSnapshot); return; }
    const load = () => {
      if (!entryToken) { setError("Scan a current storefront or table QR code to order."); return; }
      fetch(`${HUB_URL}/api/guest/snapshot?entryToken=${encodeURIComponent(entryToken)}`)
        .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
        .then((next: HubSnapshot) => {
          setSnapshot(next);
          setError(null);
        })
        .catch(error => { setSnapshot(null); setError(error.message ?? "Ask a host to connect you to the venue Wi-Fi."); });
    };

    load();
    const interval = window.setInterval(load, 5000);
    return () => window.clearInterval(interval);
  }, [entryToken, previewSnapshot]);

  return { snapshot, error };
}

export function GuestOrderApp({ storeId, tableId, seatId, entryToken, initialBranding, eventName = "Guest menu", initialPhone = "", initialPromo = "", previewSnapshot, previewToken }: { storeId: string; tableId?: string; seatId?: string; entryToken?: string; initialBranding?: GuestBranding; eventName?: string; initialPhone?: string; initialPromo?: string; previewSnapshot?: HubSnapshot; previewToken?: string }) {
  const { snapshot, error } = useSnapshot(entryToken, previewSnapshot);
  const preview = !!previewSnapshot;
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Cart>({});
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState(initialPhone);
  const [promotionCode, setPromotionCode] = useState(initialPromo);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const context = useMemo(() => {
    if (!snapshot) return null;
    const store = snapshot.stores.find((candidate) => candidate.id === storeId);
    const seat = seatId ? snapshot.seats.find((candidate) => candidate.id === seatId) : undefined;
    const section = seat ? snapshot.sections.find((candidate) => candidate.id === seat.sectionId) : undefined;
    const table = (tableId ?? seat?.tableId) ? snapshot.tables.find((candidate) => candidate.id === (tableId ?? seat?.tableId)) : undefined;
    const menu = snapshot.menuItems.filter((item) => item.storeId === storeId);
    const deposits = table?.id ? snapshot.deposits.filter((deposit) => deposit.tableId === table.id && deposit.status === "active") : [];
    const promotion = promotionCode.trim()
      ? snapshot.promotions.find((candidate) =>
        candidate.active &&
        candidate.code.toUpperCase() === promotionCode.trim().toUpperCase() &&
        (candidate.scope === "event" || candidate.storeId === storeId)
      )
      : undefined;
    return { store, table, seat, section, menu, deposits, promotion };
  }, [snapshot, storeId, tableId, seatId, promotionCode]);

  const lines = useMemo(() => {
    if (!context) return [];
    return Object.entries(cart)
      .map(([menuItemId, quantity]) => {
        const item = context.menu.find((candidate) => candidate.id === menuItemId);
        if (!item || quantity <= 0) return null;
        return {
          id: `cart-${menuItemId}`,
          menuItemId: item.id,
          name: item.name,
          quantity,
          unitPrice: item.price,
          modifiers: []
        };
      })
      .filter(Boolean);
  }, [cart, context]) as Array<{
    id: string;
    menuItemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    modifiers: [];
  }>;

  const totals = snapshot && context ? applyGuestPromotion(calculateOrderTotals(lines, snapshot.chargeRules, context.deposits), context.promotion) : null;
  const canSubmit = !preview && lines.length > 0 && Boolean(context?.store) && !submitted && !submitting;

  async function submitOrder() {
    if (!canSubmit || !context) return;

    setSubmitting(true);
    setSubmitError("");
    try {
    const response = await fetch(`${HUB_URL}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        entryToken,
        tableId: context.table?.id,
        seatId: context.seat?.id,
        origin: "guest-self-order",
        customerName: customerName || context.table?.label || "Walk-up guest",
        customerPhone: customerPhone || undefined,
        promotionCode: promotionCode || undefined,
        createdBy: customerName || "Guest",
        lines: lines.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.quantity
        }))
      })
    });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error ?? "Order was not accepted. Please try again.");
    }
    setSubmitted(true);
    setCart({});
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to submit the order");
    } finally { setSubmitting(false); }
  }

  if (!snapshot || !context) {
    return (
      <GuestBrandingFrame branding={initialBranding} assetBase={`${HUB_URL}/api/manage/branding-assets`} title={eventName}>
        <Card className="w-full max-w-md">
          <CardContent className="grid min-h-44 place-items-center gap-2 p-8 text-center text-muted-foreground">
            <Wifi size={30} className="text-primary" />
            <h1 className="text-xl font-semibold text-foreground">Joining table menu</h1>
            <p>{error ?? "Connecting to the EXA FOH local hub."}</p>
          </CardContent>
        </Card>
      </GuestBrandingFrame>
    );
  }

  return (
    <GuestBrandingFrame branding={snapshot.event.guestBranding} assetBase={`${HUB_URL}/api/manage/branding-assets`} title={snapshot.event.name}
      subtitle={`${snapshot.event.dateLabel ? `${snapshot.event.dateLabel} / ` : ""}${context.store?.name ?? "Storefront menu"} / ${context.seat?.label ?? context.table?.label ?? (preview ? "" : "Walk-up order / ")}${context.table || context.seat ? " / " : ""}${context.section?.label ?? snapshot.event.venue}`}>

        {preview && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 text-sm"><span className="font-semibold text-primary">Menu preview · Ordering is not open</span><span className="text-muted-foreground">Sample food imagery · Reference menu prices</span></div>}
        {previewToken && <nav aria-label="Storefront menus" className="flex flex-wrap gap-2">{snapshot.stores.map(store => <a key={store.id} href={`/preview/${encodeURIComponent(previewToken)}?store=${encodeURIComponent(store.id)}`} aria-current={store.id === storeId ? "page" : undefined} className={cn("border-b-2 px-4 py-3 text-sm font-semibold", store.id === storeId ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>{store.name}</a>)}</nav>}

        {submitted && (
          <section className="flex flex-wrap gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-300">
            <strong>Order sent.</strong>
            <span>The storefront will confirm it before it is prepared.</span>
          </section>
        )}

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:items-start">
          <section className="min-w-0 bg-card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-tight">{preview ? (snapshot.event.guestBranding?.theme === "night-market" ? "Dessert menu" : "Menu") : "Available now"}</h2>
                <span className="text-sm text-muted-foreground">{context.menu.filter((item) => item.available).length} items</span>
              </div>
              {preview && <input aria-label="Search menu" placeholder="Search the menu..." value={search} onChange={e => setSearch(e.target.value)} className="mb-5 h-11 w-full border border-border bg-background px-3 text-sm outline-none focus:border-primary" />}
              {preview && search && !context.menu.some(item => item.name.toLowerCase().includes(search.toLowerCase())) && <p role="status" className="py-8 text-muted-foreground">No matching items.</p>}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {context.menu.filter(item => !preview || item.name.toLowerCase().includes(search.toLowerCase())).map((item) => (
                  <MenuRow
                    key={item.id}
                    item={item}
                    quantity={cart[item.id] ?? 0}
                    onChange={(quantity) => {
                      setSubmitted(false);
                      setCart((current) => ({ ...current, [item.id]: quantity }));
                    }}
                  />
                ))}
              </div>
          </section>

          <Card className="rounded-sm lg:sticky lg:top-5">
            <CardContent className="grid gap-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-tight">{context.table ? "Running tab" : "Your selection"}</h2>
                <ReceiptText size={19} className="text-primary" />
              </div>

              {!preview && <><label className="grid gap-2">
                <span className="text-sm text-muted-foreground">Name for this order</span>
                <input
                  className="h-11 rounded-lg border border-border bg-background px-3 text-foreground outline-none transition focus:border-primary"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="Optional"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm text-muted-foreground">Phone for history and points</span>
                <input
                  className="h-11 rounded-lg border border-border bg-background px-3 text-foreground outline-none transition focus:border-primary"
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  placeholder="Optional"
                  inputMode="tel"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm text-muted-foreground">Promo code</span>
                <input
                  className="h-11 rounded-lg border border-border bg-background px-3 text-foreground outline-none transition focus:border-primary"
                  value={promotionCode}
                  onChange={(event) => setPromotionCode(event.target.value.toUpperCase())}
                  placeholder="Optional"
                />
              </label>
              </>}
              <div className="grid gap-2">
                {lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Add an item to start your order.</p>
                ) : (
                  lines.map((line) => (
                    <div className="flex items-center justify-between gap-3 border-b border-border pb-2" key={line.menuItemId}>
                      <span>{line.quantity}x {line.name}</span>
                      <strong>{formatNaira(line.unitPrice * line.quantity)}</strong>
                    </div>
                  ))
                )}
              </div>

              {totals && (
                <div className="grid gap-2 border-t border-border pt-3">
                  <TotalRow label="Subtotal" value={totals.subtotal} />
                  {totals.charges.map((charge) => <TotalRow key={charge.chargeRuleId} label={charge.name} value={charge.amount} />)}
                  {preview && totals.charges.length === 0 && <>
                    <TotalRow label="Consumption Tax" value={0} />
                    <TotalRow label="Service Charge" value={0} />
                    <TotalRow label="VAT" value={0} />
                  </>}
                  {context.table && <TotalRow label="Active deposit" value={-totals.depositApplied} muted />}
                  <TotalRow label="Balance due" value={totals.balanceDue} strong />
                  {preview && totals.charges.length === 0 && <p className="text-xs text-muted-foreground">Taxes and service charges are not yet configured.</p>}
                </div>
              )}

              {submitError && <p role="alert" className="text-sm text-red-400">{submitError}</p>}
              <Button disabled={!canSubmit} onClick={submitOrder}>
                <Send size={18} />
                {preview ? "Ordering not open" : submitting ? "Sending..." : "Send order"}
              </Button>
            </CardContent>
          </Card>
        </section>
    </GuestBrandingFrame>
  );
}

function MenuRow({ item, quantity, onChange }: { item: MenuItem; quantity: number; onChange: (quantity: number) => void }) {
  return (
    <article data-menu-card className={cn("flex min-w-0 flex-col overflow-hidden rounded-[2px] border border-border", !item.available && "opacity-50")}>
      <ProductImage src={item.imageId ? `${HUB_URL}/api/menu-images/${item.imageId}` : undefined} name={item.name} />
      <div className="grid flex-1 gap-1 p-4">
        <span data-menu-section className="text-sm text-muted-foreground">{item.menuSection ?? item.category}</span>
        <strong className="break-words">{item.name}</strong>
        {item.description && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.description}</p>}
        <span data-menu-price className="mt-2 font-semibold">{formatNaira(item.price)}</span>
      </div>
      <div className="m-4 mt-0 grid w-fit grid-cols-[36px_32px_36px] items-center justify-items-center rounded-[2px] border border-border p-1">
        <button
          className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground disabled:bg-secondary disabled:text-muted-foreground"
          disabled={!item.available || quantity === 0}
          onClick={() => onChange(Math.max(0, quantity - 1))}
          title="Remove one"
        >
          <Minus size={16} />
        </button>
        <output className="font-semibold">{quantity}</output>
        <button
          className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground disabled:bg-secondary disabled:text-muted-foreground"
          disabled={!item.available}
          onClick={() => onChange(quantity + 1)}
          title="Add one"
        >
          <Plus size={16} />
        </button>
      </div>
    </article>
  );
}

function applyGuestPromotion(totals: GuestTotals, promotion?: Promotion): GuestTotals {
  if (!promotion) return totals;
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

function TotalRow({ label, value, strong = false, muted = false }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", strong && "border-t border-border pt-3 text-lg", muted && "text-muted-foreground")}>
      <span>{label}</span>
      <strong>{formatNaira(value)}</strong>
    </div>
  );
}
