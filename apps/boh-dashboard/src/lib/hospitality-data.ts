import type { HubSnapshot, Order } from "@exa-foh/shared";
export const money = (amount: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
export function serviceOrders(s: HubSnapshot): Order[] {
  const period = s.operatingPeriods.find(p => p.status === "open") ?? s.operatingPeriods[0];
  return s.orders.filter(o => (!period || o.operatingPeriodId === period.id) && !["void", "rejected", "draft"].includes(o.status));
}
export function paid(s: HubSnapshot, orderId: string) { return s.payments.filter(p => p.orderId === orderId && ["validated", "manually-confirmed"].includes(p.status)).reduce((sum, p) => sum + p.amount, 0); }
export function remaining(s: HubSnapshot, order: Order) { return Math.max(0, order.totals.total - paid(s, order.id)); }
export function dashboardData(s: HubSnapshot) {
  const orders = serviceOrders(s); const confirmed = orders.filter(o => o.status !== "sent");
  const orderIds = new Set(orders.map(o => o.id));
  const payments = s.payments.filter(p => orderIds.has(p.orderId) && ["validated", "manually-confirmed"].includes(p.status));
  const gross = confirmed.reduce((sum, o) => sum + o.totals.total, 0);
  const methodTotal = (method: string) => payments.filter(p => p.method === method).reduce((sum, p) => sum + p.amount, 0);
  const waiters = [...new Set(confirmed.map(o => o.createdBy))].map(name => { const own = confirmed.filter(o => o.createdBy === name); return { name, total: own.reduce((sum, o) => sum + o.totals.total, 0), orders: own.length, tables: new Set(own.flatMap(o => o.tableId ? [o.tableId] : [])).size }; }).sort((a, b) => b.total - a.total);
  const fast = s.menuItems.map(item => ({ item, sold: confirmed.flatMap(o => o.lines).filter(l => l.menuItemId === item.id).reduce((sum, l) => sum + l.quantity, 0), stock: s.inventory.find(i => i.id === item.stockItemId)?.quantity ?? 0 })).filter(v => v.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 5);
  return { orders, gross, payments, card: methodTotal("pos"), transfer: methodTotal("bank-transfer"), credit: methodTotal("deposit-offset"), average: confirmed.length ? gross / confirmed.length : 0, waiters, fast, lowStock: s.inventory.filter(i => i.quantity <= i.lowStockThreshold), outstanding: orders.reduce((sum, o) => sum + remaining(s, o), 0) };
}
