"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@exa-foh/ui";
import { managementApi } from "../lib/management-api";
import { useManagementUser } from "./management-shell";
import { useOnlineWorkspace } from "./deployment-context";

type Assignment = { role: string; venueId: string | null; storefrontId: string | null };
type Staff = { id: string; name: string; email: string; role: string; active: boolean; assignments: Assignment[] };
type Options = { venues: { id: string; name: string }[]; storefronts: { id: string; name: string }[] };
const labels: Record<string, string> = { "venue-manager": "Venue manager", "storefront-manager": "Storefront manager", cashier: "Cashier", waiter: "Waiter", prep: "Kitchen / prep", runner: "Runner (view only online)", viewer: "Viewer" };
const blank = (): Assignment => ({ role: "venue-manager", venueId: null, storefrontId: null });
export function StaffAccess() {
  const online = useOnlineWorkspace(); const user = useManagementUser();
  if (!online) return null;
  return user?.role === "owner" ? <StaffManager /> : <MyAssignments />;
}
function MyAssignments() {
  const user = useManagementUser(); const [options, setOptions] = useState<Options>(); const [error, setError] = useState("");
  useEffect(() => { let live = true; managementApi<Options>("/business/options").then(data => { if (live) setOptions(data); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
  return <section className="mt-10 max-w-3xl"><h2 className="text-lg font-semibold">Your assignments</h2><p className="my-3 text-sm text-muted-foreground">Your business owner manages access. Venue managers oversee all outlets in their venue; other roles apply to assigned storefronts.</p>{error && <p role="alert" className="text-sm text-red-400">{error}</p>}{user?.assignments?.map((a, n) => <p className="py-2 text-sm" key={n}>{labels[a.role]} · {a.venueId ? options?.venues.find(v => v.id === a.venueId)?.name ?? "Assigned venue" : options?.storefronts.find(v => v.id === a.storefrontId)?.name ?? "Assigned storefront"}</p>)}</section>;
}
function StaffManager() {
  const [items, setItems] = useState<Staff[]>([]); const [options, setOptions] = useState<Options>();
  const [editing, setEditing] = useState<Staff | "new" | null>(null); const [assignments, setAssignments] = useState<Assignment[]>([blank()]);
  const [active, setActive] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [reset, setReset] = useState<Staff | null>(null);
  const load = useCallback(async () => { try { const [staff, opts] = await Promise.all([managementApi<{ items: Staff[] }>("/staff"), managementApi<Options>("/business/options")]); setItems(staff.items); setOptions(opts); setError(""); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  function edit(item: Staff | "new") { setEditing(item); setAssignments(item === "new" ? [blank()] : item.assignments.map(a => ({ role: a.role, venueId: a.venueId, storefrontId: a.storefrontId }))); setActive(item === "new" || item.active); setError(""); setMessage(""); setReset(null); }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); const fields = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (editing === "new") await managementApi("/staff", { method: "POST", body: JSON.stringify({ name: fields.name, email: fields.email, password: fields.password, assignments }) });
      else if (editing) await managementApi(`/staff/${editing.id}`, { method: "PATCH", body: JSON.stringify({ active, assignments }) });
      setEditing(null); setMessage("Staff access saved. The staff member can sign in at this business's login page."); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function resetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!reset) return; const password = new FormData(e.currentTarget).get("password"); setBusy(true); setError("");
    try { await managementApi(`/staff/${reset.id}/password`, { method: "POST", body: JSON.stringify({ password }) }); setReset(null); setMessage("Password changed and previous sessions signed out."); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const field = "w-full rounded border border-border bg-card p-3 text-sm";
  return <section className="mt-12 max-w-4xl border-t border-border pt-8"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">Team & storefront access</h2><p className="mt-2 text-sm text-muted-foreground">Venue managers oversee every storefront in their venue. Assign outlet roles separately for each storefront.</p></div><Button disabled={!options || busy} onClick={() => edit("new")}>Add staff member</Button></div>
    {error && <p role="alert" className="my-4 text-sm text-red-400">{error}</p>}{message && <p role="status" className="my-4 text-sm text-emerald-400">{message}</p>}
    {editing && <form onSubmit={save} className="my-6 rounded border border-border p-5"><fieldset disabled={busy} className="space-y-4"><h3 className="font-semibold">{editing === "new" ? "New staff member" : `Edit ${editing.name}`}</h3>{editing === "new" && <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">Name<input name="name" minLength={2} maxLength={100} required className={field} /></label><label className="grid gap-2 text-sm">Email<input name="email" type="email" required className={field} /></label><label className="grid gap-2 text-sm sm:col-span-2">Initial password<input name="password" aria-label="Initial password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required className={field} /><span className="text-muted-foreground">At least 12 characters. Give the staff member their credentials securely.</span></label></div>}
      {assignments.map((a, index) => <div key={index} className="grid items-end gap-3 rounded border border-border p-3 sm:grid-cols-[1fr_1fr_auto]"><label className="grid gap-2 text-sm">Role<select aria-label={`Role ${index + 1}`} className={field} value={a.role} onChange={e => setAssignments(rows => rows.map((r, n) => n === index ? { role: e.target.value, venueId: null, storefrontId: null } : r))}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="grid gap-2 text-sm">Venue or storefront<select aria-label={`Assignment ${index + 1}`} className={field} required value={a.venueId ? `venue:${a.venueId}` : a.storefrontId ? `store:${a.storefrontId}` : ""} onChange={e => { const [kind, id] = e.target.value.split(":"); setAssignments(rows => rows.map((r, n) => n === index ? { ...r, venueId: kind === "venue" ? id : null, storefrontId: kind === "store" ? id : null } : r)); }}><option value="">Choose scope</option>{["venue-manager", "viewer"].includes(a.role) && <optgroup label="Venues">{options?.venues.map(v => <option key={v.id} value={`venue:${v.id}`}>{v.name}</option>)}</optgroup>}{a.role !== "venue-manager" && <optgroup label="Storefronts">{options?.storefronts.map(v => <option key={v.id} value={`store:${v.id}`}>{v.name}</option>)}</optgroup>}</select></label><Button type="button" variant="outline" disabled={assignments.length === 1} onClick={() => setAssignments(rows => rows.filter((_, n) => n !== index))}>Remove</Button></div>)}
      <Button type="button" variant="outline" onClick={() => setAssignments(rows => [...rows, blank()])}>Add another assignment</Button>{editing !== "new" && <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Account active</label>}<p className="text-sm text-muted-foreground">Saving changes to an existing account signs out its sessions. Runner delivery actions are not yet available online.</p><div className="flex gap-3"><Button type="submit">{busy ? "Saving..." : "Save access"}</Button><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button></div></fieldset></form>}
    {reset && <form onSubmit={resetPassword} className="my-6 space-y-3 rounded border border-border p-5"><label className="grid gap-2 text-sm">New password for {reset.name}<input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" className={field} /></label><Button disabled={busy} type="submit">Reset password</Button><Button variant="outline" type="button" disabled={busy} onClick={() => setReset(null)}>Cancel</Button></form>}
    <div className="mt-6 divide-y divide-border">{items.map(item => <article key={item.id} className="flex flex-wrap items-start justify-between gap-4 py-5"><div className="min-w-0"><h3 className="break-words font-medium">{item.name} {!item.active && <span className="text-sm text-amber-400">Disabled</span>}</h3><p className="break-all text-sm text-muted-foreground">{item.email}</p>{item.role === "owner" ? <p className="mt-2 text-sm">Business owner · all venues and storefronts</p> : item.assignments.map((a, n) => <p key={n} className="mt-2 text-sm">{labels[a.role]} · {a.venueId ? options?.venues.find(v => v.id === a.venueId)?.name : options?.storefronts.find(v => v.id === a.storefrontId)?.name}</p>)}</div>{item.role !== "owner" && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => edit(item)}>Edit access</Button><Button variant="ghost" disabled={busy} onClick={() => { setReset(item); setEditing(null); setError(""); }}>Reset password</Button></div>}</article>)}</div>
  </section>;
}
