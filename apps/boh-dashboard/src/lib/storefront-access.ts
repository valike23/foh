import type { HubSnapshot } from "@exa-foh/shared";
const managers = ["venue-manager", "storefront-manager"];
export function canStore(s: HubSnapshot, id: string, action: "order" | "accept" | "prep" | "pay" | "menu" | "stock" | "finance") {
  if (!s.onlinePermissions) return true;
  const allowed = action === "order" ? [...managers, "cashier", "waiter"] : action === "accept" ? [...managers, "prep"] : action === "prep" ? [...managers, "prep", "waiter"] : action === "pay" || action === "finance" ? [...managers, "cashier"] : action === "stock" ? [...managers, "prep"] : managers;
  return (s.onlinePermissions[id] ?? []).some(role => allowed.includes(role));
}
