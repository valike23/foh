"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Building2, CalendarDays, Store, Users, Map, ChevronRight, LogOut, Menu, ReceiptText, ShieldCheck, X } from "lucide-react";
import { Button, cn } from "@exa-foh/ui";
import type { ManagementUser } from "@exa-foh/shared";
import { ApiError, managementApi } from "../lib/management-api";

const SessionContext = createContext<ManagementUser | null>(null);
export const useManagementUser = () => useContext(SessionContext);

export function ManagementShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<ManagementUser | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    managementApi<{ user: ManagementUser }>("/auth/session").then(result => { if (active) setUser(result.user); }).catch(error => {
      if (!active) return;
      if (error instanceof ApiError && error.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      else setError(error.message);
    });
    return () => { active = false; };
  }, [pathname, router]);
  useEffect(() => { setOpen(false); }, [pathname]);
  async function logout() {
    try { await managementApi("/auth/logout", { method: "POST", body: "{}" }); router.replace("/login"); }
    catch (error) { setError((error as Error).message); }
  }
  if (!user) return <main className="management min-h-screen grid place-items-center p-6"><div role="status">{error || "Loading workspace..."}{error && <Button className="ml-4" onClick={() => window.location.reload()}>Retry</Button>}</div></main>;
  return <SessionContext.Provider value={user}><div className="management min-h-screen">
    {open && <button className="fixed inset-0 z-30 bg-black/70 lg:hidden" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-sidebar transition-transform lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex h-20 items-center gap-3 px-6"><Image src="/exa-icon.svg" alt="EXA" width={34} height={34} /><div><p className="font-semibold">EXA</p><p className="text-xs text-muted-foreground">Front of house</p></div><Button variant="ghost" size="icon" className="ml-auto lg:hidden" aria-label="Close navigation" onClick={() => setOpen(false)}><X /></Button></div>
      <nav className="flex-1 px-3 py-6" aria-label="Main navigation"><p className="px-3 pb-3 text-xs text-muted-foreground">Management</p>
        <NavLink href="/venues" active={pathname.startsWith("/venues")} icon={<Building2 size={18} />}>Venues</NavLink>
        <NavLink href="/events" active={pathname.startsWith("/events")} icon={<CalendarDays size={18} />}>Events</NavLink>
        <NavLink href="/vendors" active={pathname.startsWith("/vendors")} icon={<Users size={18} />}>Vendors</NavLink>
        <NavLink href="/storefronts" active={pathname.startsWith("/storefronts")} icon={<Store size={18} />}>Storefronts</NavLink>
        <NavLink href="/floor" active={pathname.startsWith("/floor")} icon={<Map size={18} />}>Floor & QR</NavLink>
        <NavLink href="/settings/account" active={pathname.startsWith("/settings")} icon={<ShieldCheck size={18} />}>Account & access</NavLink>
        <p className="px-3 pb-3 pt-8 text-xs text-muted-foreground">Operations</p>
        <NavLink href="/operations" active={pathname.startsWith("/operations")} icon={<ReceiptText size={18} />}>Service operations</NavLink>
      </nav>
      <div className="border-t border-border p-5"><p className="truncate text-sm font-medium">{user.name}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{user.role}</p><Button variant="ghost" size="sm" className="mt-3 -ml-2" onClick={logout}><LogOut />Sign out</Button></div>
    </aside>
    <div className="lg:pl-60"><header className="flex h-16 items-center gap-3 border-b border-border px-4 sm:px-8"><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu /></Button><span className="text-sm text-muted-foreground">EXA Hospitality</span><ChevronRight size={14} className="text-muted-foreground" /><span className="text-sm">{({ venues: "Venues", events: "Events", vendors: "Vendors", storefronts: "Storefronts", floor: "Floor & QR" } as Record<string, string>)[pathname.split("/")[1]] ?? "Account & access"}</span></header>
      {error && <div className="m-6 text-sm text-red-400" role="alert">{error}</div>}
      <main className="w-full min-w-0 p-4 sm:p-8">{children}</main>
    </div>
  </div></SessionContext.Provider>;
}
function NavLink({ href, active, icon, children }: { href: string; active: boolean; icon: ReactNode; children: ReactNode }) {
  return <Link href={href} aria-current={active ? "page" : undefined} className={cn("mb-1 flex items-center gap-3 rounded-lg px-3 py-3 text-sm", active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground")}>{icon}{children}</Link>;
}
