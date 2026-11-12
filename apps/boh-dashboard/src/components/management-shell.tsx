"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Building2, CalendarDays, Store, Users, Map, ChevronRight, LogOut, Menu, ReceiptText, ShieldCheck, X, LayoutDashboard, CreditCard, ClipboardList, Package, ArrowRight, LoaderCircle, RefreshCw } from "lucide-react";
import { Button, cn } from "@exa-foh/ui";
import type { ManagementUser } from "@exa-foh/shared";
import { ApiError, managementApi, isTemporaryApiError } from "../lib/management-api";
import { OperationalProvider } from "./operational-context";
import { tenantBrandStyle, type TenantBrand } from "../lib/tenant-branding";

import { useOnlineWorkspace, useOfflineWorkspace } from "./deployment-context";
import { OfflineSyncBadge } from "./offline-sync";
import type { OnboardingState } from "./workspace-onboarding";
import { workspaceNavigation, resolveNavigationView, type WorkspaceMode, type NavigationView } from "../lib/workspace-navigation";
import { OnboardingModal } from "./onboarding-modal";

const SessionContext = createContext<ManagementUser | null>(null);
const TenantContext = createContext<TenantBrand | null>(null);
const ModeContext = createContext<WorkspaceMode>(null);
export const useWorkspaceMode = () => useContext(ModeContext);
const SetupContext = createContext<{ setup: OnboardingState | null; open: () => void }>({ setup: null, open: () => {} });
export const useWorkspaceSetup = () => useContext(SetupContext);
const NavigationContext = createContext<ReturnType<typeof workspaceNavigation>>(workspaceNavigation(null, false));
export const useWorkspaceNavigation = () => useContext(NavigationContext);
export const useManagementUser = () => useContext(SessionContext);
export const useManagementTenant = () => useContext(TenantContext);

export function ManagementShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const online = useOnlineWorkspace();
  const offline = useOfflineWorkspace();
  const pathname = usePathname();
  const [user, setUser] = useState<ManagementUser | null>(null);
  const [tenant, setTenant] = useState<TenantBrand | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [mode, setMode] = useState<WorkspaceMode>(null);
  const [setupStarted, setSetupStarted] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false), [revision, setRevision] = useState(0);
  const [navigationView, setNavigationView] = useState<NavigationView | null>(null), [switching, setSwitching] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<NavigationView>("location");
  useEffect(() => {
    let active = true; let retries = 0; let retryTimer: ReturnType<typeof setTimeout> | undefined;
    function loadSession() {
      managementApi<{ user: ManagementUser; tenant?: TenantBrand; workspaceMode?: WorkspaceMode; workspaceSetupStarted?: boolean; navigationView?: NavigationView | null }>("/auth/session").then(async result => {
        const setup = online && result.user.role === "owner" ? await managementApi<OnboardingState>("/onboarding") : null;
        if (active) { setUser(result.user); setTenant(result.tenant ?? null); setOnboarding(setup); setMode(result.workspaceMode ?? null); setSetupStarted(result.workspaceSetupStarted ?? false); setNavigationView(result.navigationView === "location" || result.navigationView === "events" ? result.navigationView : null); setError(""); }
      }).catch(error => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) return; // The API client redirects with the full return URL.
        setError(error.message);
        if (isTemporaryApiError(error) && retries < 3) retryTimer = setTimeout(loadSession, 3000 * ++retries);
      });
    }
    loadSession();
    return () => { active = false; clearTimeout(retryTimer); };
  }, [pathname, router, online, revision]);
  useEffect(() => { setOpen(false); }, [pathname]);
  async function logout() {
    try { await managementApi("/auth/logout", { method: "POST", body: "{}" }); router.replace("/login"); }
    catch (error) { setError((error as Error).message); }
  }
  async function switchView(view: NavigationView) {
    setSwitching(true);
    setSwitchTarget(view);
    try {
      await Promise.all([managementApi("/preferences", { method: "PATCH", body: JSON.stringify({ navigationView: view }) }), new Promise(resolve => setTimeout(resolve, 1000))]);
      window.location.assign("/dashboard");
      return;
    }
    catch (e) { setError((e as Error).message); setSwitching(false); }
  }
  if (!user) return <main className="management min-h-screen grid place-items-center p-6"><div role="status">{error || "Loading workspace..."}{error && <Button className="ml-4" onClick={() => window.location.reload()}>Retry</Button>}</div></main>;
  const fullMenu = !online || user.role === "owner";
  const roles = user.assignments?.map(a => a.role) ?? [];
  const manager = roles.some(r => ["venue-manager", "storefront-manager"].includes(r));
  const management = fullMenu || manager;
  const sell = fullMenu || manager || roles.some(r => ["cashier", "waiter"].includes(r));
  const payments = fullMenu || manager || roles.includes("cashier");
  const stock = fullMenu || manager || roles.some(r => ["prep", "viewer"].includes(r));
  const floor = fullMenu || manager || roles.some(r => ["waiter", "runner", "viewer"].includes(r));
  const activeView = resolveNavigationView(mode, navigationView);
  const relevant = workspaceNavigation(mode, online && setupStarted, navigationView);
  return <SessionContext.Provider value={user}><TenantContext.Provider value={tenant}><ModeContext.Provider value={mode}><NavigationContext.Provider value={relevant}><SetupContext.Provider value={{ setup: onboarding, open: () => setSetupOpen(true) }}><div className={cn("management min-h-screen", tenant?.brandColor && "tenant-branded")} style={tenantBrandStyle(tenant?.brandColor)}>
    {open && <button className="fixed inset-0 z-30 bg-black/70 lg:hidden" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-sidebar transition-transform lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex h-20 shrink-0 items-center gap-3 px-6">{tenant?.brandLogo ? <img src={tenant.brandLogo} alt={`${tenant.name} logo`} width={34} height={34} className="h-9 w-9 shrink-0 rounded-md object-contain" /> : <Image src="/exa-icon.svg" alt="EXA" width={34} height={34} />}<div className="min-w-0"><p className="truncate font-semibold" title={tenant?.name}>{tenant?.name ?? "EXA"}</p><p className="text-xs text-muted-foreground">{activeView === "events" ? "Events workspace" : "Locations workspace"}</p></div><Button variant="ghost" size="icon" className="ml-auto lg:hidden" aria-label="Close navigation" onClick={() => setOpen(false)}><X /></Button></div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-6" aria-label="Main navigation"><p className="px-3 pb-3 text-xs text-muted-foreground">Management</p>
        <NavLink href="/dashboard" active={pathname.startsWith("/dashboard")} icon={<LayoutDashboard size={18} />}>Dashboard</NavLink>
        {management && relevant.venues && <NavLink href="/venues" active={pathname.startsWith("/venues")} icon={<Building2 size={18} />}>Venues</NavLink>}
        {management && relevant.events && <NavLink href="/events" active={pathname.startsWith("/events")} icon={<CalendarDays size={18} />}>Events</NavLink>}
        {management && relevant.vendors && <NavLink href="/vendors" active={pathname.startsWith("/vendors")} icon={<Users size={18} />}>Vendors</NavLink>}
        {management && relevant.storefronts && <NavLink href="/storefronts" active={pathname.startsWith("/storefronts")} icon={<Store size={18} />}>Storefronts</NavLink>}
        {management && relevant.sections && <NavLink href="/floor" active={pathname === "/floor" || pathname.startsWith("/floor/")} icon={<Map size={18} />}>Sections</NavLink>}
        <NavLink href="/settings/account" active={pathname.startsWith("/settings")} icon={<ShieldCheck size={18} />}>{fullMenu ? "Account & access" : "My account"}</NavLink>
        <p className="px-3 pb-3 pt-8 text-xs text-muted-foreground">Operations</p>
        {management && relevant.operations && <NavLink href="/operations" active={pathname.startsWith("/operations")} icon={<ReceiptText size={18} />}>Service operations</NavLink>}
        {sell && <NavLink href="/sales" active={pathname === "/sales"} icon={<ReceiptText size={18} />}>Sales</NavLink>}
        {online && sell && <Link href="/pos" target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-muted-foreground hover:bg-secondary/60 hover:text-foreground" title="Open standalone POS in a new tab"><CreditCard size={18} />POS<ArrowRight size={14} className="ml-auto -rotate-45" /></Link>}
        {payments && <NavLink href="/payments" active={pathname === "/payments"} icon={<CreditCard size={18} />}>Payments</NavLink>}
        <NavLink href="/orders" active={pathname === "/orders"} icon={<ClipboardList size={18} />}>Orders</NavLink>
        {stock && <NavLink href="/stock" active={pathname === "/stock"} icon={<Package size={18} />}>Stock</NavLink>}
        {offline && <NavLink href="/sync" active={pathname === "/sync"} icon={<RefreshCw size={18} />}>Sync status</NavLink>}
        {floor && !management && relevant.sections && <NavLink href="/floor-control" active={pathname === "/floor-control"} icon={<Map size={18} />}>Table service</NavLink>}
      </nav>
      {online && !offline && management && <details className="shrink-0 border-t border-border px-5 py-3"><summary className="cursor-pointer text-xs text-muted-foreground">Switch workspace</summary><div className="mt-3 space-y-3"><p className="text-xs text-muted-foreground">You’re in {activeView === "events" ? "Events" : "Physical locations"}. Save any edits before switching.</p><Button variant="outline" size="sm" className="w-full" disabled={switching} onClick={() => void switchView(activeView === "events" ? "location" : "events")}>{activeView === "events" ? <Building2 size={15} /> : <CalendarDays size={15} />}Enter {activeView === "events" ? "Physical locations" : "Events"}<ArrowRight size={14} /></Button></div></details>}
      <div className="shrink-0 border-t border-border p-5"><p className="truncate text-sm font-medium">{user.name}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{user.role}</p><Button variant="ghost" size="sm" className="mt-3 -ml-2" onClick={logout}><LogOut />Sign out</Button></div>
    </aside>
    <div className="lg:pl-60"><header className="flex h-16 items-center gap-3 border-b border-border px-4 sm:px-8"><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu /></Button><span className="flex items-center gap-2 text-sm text-muted-foreground">{activeView === "events" ? <CalendarDays size={16} className="text-amber-400" /> : <Building2 size={16} className="text-sky-400" />}{activeView === "events" ? "Events" : "Physical locations"}</span><ChevronRight size={14} className="text-muted-foreground" /><span className="text-sm">{({ sync: "Sync status", onboarding: "Guided setup", dashboard: "Dashboard", venues: "Venues", events: "Events", vendors: "Vendors", storefronts: "Storefronts", floor: "Sections", sales: "Sales", payments: "Payments", orders: "Orders", stock: "Stock", operations: "Service operations" } as Record<string, string>)[pathname.split("/")[1]] ?? (fullMenu ? "Account & access" : "My account")}</span></header>
      {offline && <div className="px-4 pt-4 sm:px-8"><OfflineSyncBadge /></div>}
      {error && <div className="m-6 text-sm text-red-400" role="alert">{error}</div>}
      <main className="w-full min-w-0 p-4 sm:p-8">{["/overview", "/sales", "/payments", "/orders", "/stock", "/floor-control"].includes(pathname) ? <OperationalProvider>{children}</OperationalProvider> : children}</main>
    </div>
    {online && user.role === "owner" && setupOpen && <OnboardingModal close={() => { setSetupOpen(false); setRevision(value => value + 1); }} />}
    {switching && <div role="status" aria-live="polite" aria-label="Switching workspace" className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center bg-background p-8 text-center"><div className="max-w-md space-y-6"><div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-card">{switchTarget === "events" ? <CalendarDays size={36} className="text-amber-400" /> : <Building2 size={36} className="text-sky-400" />}</div><p className="text-sm text-muted-foreground">Leaving {activeView === "events" ? "Events" : "Physical locations"}</p><h1 className="text-3xl font-semibold">Entering {switchTarget === "events" ? "Events" : "Physical locations"}</h1><p className="text-sm text-muted-foreground">{switchTarget === "events" ? "Preparing your events, vendors, and storefronts." : "Preparing your venues, sections, and tables."}</p><LoaderCircle className="mx-auto animate-spin text-primary" size={24} /></div></div>}
  </div></SetupContext.Provider></NavigationContext.Provider></ModeContext.Provider></TenantContext.Provider></SessionContext.Provider>;
}
function NavLink({ href, active, icon, children }: { href: string; active: boolean; icon: ReactNode; children: ReactNode }) {
  return <Link href={href} aria-current={active ? "page" : undefined} className={cn("mb-1 flex items-center gap-3 rounded-lg px-3 py-3 text-sm", active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground")}>{icon}{children}</Link>;
}
