"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Check, ChevronLeft, ChevronRight, Clock3, History, MapPin, Pencil, Plus, Search, Settings2, ShieldAlert, X } from "lucide-react";
import { Button, cn } from "@exa-foh/ui";
import { emptyVenueProfile, type ManagedVenue, type VenueDetail, type VenueProfile, type VenueStatus } from "@exa-foh/shared";
import { ApiError, managementApi } from "../lib/management-api";
import { useManagementUser } from "./management-shell";

type Directory = { items: ManagedVenue[]; total: number; page: number; pageSize: number; counts: Record<string, number>; canCreate: boolean };
const statusStyles = { draft: "border-zinc-700 bg-zinc-800/30 text-zinc-300", active: "border-emerald-900 bg-emerald-950/30 text-emerald-300", paused: "border-amber-900 bg-amber-950/30 text-amber-300", archived: "border-zinc-800 text-zinc-500" };
const date = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
export function VenueStatusChip({ status }: { status: VenueStatus }) { return <span className={cn("status-chip", statusStyles[status])}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status}</span>; }
function ErrorNotice({ error, children }: { error: string; children?: ReactNode }) { return <div role="alert" className="my-5 rounded-lg border border-red-900/60 bg-red-950/20 p-4 text-sm text-red-300">{error}{children}</div>; }

export function VenueDirectory() {
  const params = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<Directory | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [retry, setRetry] = useState(0);
  const query = params.toString();
  useEffect(() => { setSearch(params.get("q") ?? ""); }, [params]);
  useEffect(() => {
    let live = true; setLoading(true); setError("");
    managementApi<Directory>(`/venues?${query}`).then(result => { if (live) setData(result); }).catch(error => {
      if (!live) return;
      if (error instanceof ApiError && error.status === 401) router.replace("/login?next=/venues");
      else setError(error.message);
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [query, retry, router]);
  function filter(values: Record<string, string>) {
    const next = new URLSearchParams(query); next.delete("page");
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    router.push(`/venues?${next}`);
  }
  const status = params.get("status") ?? "all";
  return <>
    <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="eyebrow">Management</p><h1 className="page-title">Venues</h1></div>{data?.canCreate && <Button asChild><Link href="/venues/new"><Plus />New venue</Link></Button>}</div>
    <div className="mt-8 flex flex-wrap gap-x-10 gap-y-5 border-y border-border py-5">{[["all", "Total venues"], ["active", "Active"], ["draft", "Draft"], ["paused", "Paused"]].map(([key, label]) => <div key={key} className="min-w-24"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{data?.counts[key] ?? "-"}</p></div>)}</div>
    <div className="mt-7 flex flex-wrap items-center justify-between gap-4"><div className="flex max-w-full gap-1 overflow-x-auto" aria-label="Venue status">{["all", "active", "draft", "paused", "archived"].map(value => <button key={value} onClick={() => filter({ status: value })} aria-pressed={status === value} className={cn("rounded-md px-3 py-2 text-sm capitalize", status === value ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>{value}</button>)}</div>
      <div className="flex w-full flex-wrap gap-3 sm:w-auto"><form onSubmit={event => { event.preventDefault(); filter({ q: search }); }} className="relative min-w-0 flex-1 sm:w-64"><input aria-label="Search venues" placeholder="Search venues..." className="field !mt-0 !pr-10" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} /><button type="submit" title="Search" aria-label="Search" className="absolute right-0 top-0 grid h-11 w-10 place-items-center text-muted-foreground"><Search size={17} /></button></form><select aria-label="Sort venues" className="field !mt-0 !w-auto" value={params.get("sort") ?? "updated"} onChange={event => filter({ sort: event.target.value })}><option value="updated">Recently updated</option><option value="name">Name A-Z</option></select></div>
    </div>
    {error && <ErrorNotice error={error}><Button variant="ghost" size="sm" onClick={() => setRetry(retry + 1)}>Retry</Button></ErrorNotice>}
    <div className="mt-5 overflow-x-auto border-y border-border" aria-busy={loading}>
      <table className="w-full min-w-[660px] text-left text-sm"><thead className="bg-secondary/40 text-xs text-muted-foreground"><tr>{["Venue", "Status", "Contact", "Timezone", "Updated", ""].map((title, index) => <th className="px-4 py-3 font-medium" key={index}>{title}</th>)}</tr></thead>
        <tbody className={cn("divide-y divide-border", loading && "opacity-50")}>{data?.items.map(venue => <tr key={venue.id} className="hover:bg-secondary/30"><td className="px-4 py-5"><Link className="font-medium hover:underline" href={`/venues/${venue.id}`}>{venue.name}</Link><p className="mt-1 text-xs text-muted-foreground">{venue.city || "Location not set"}</p></td><td className="px-4 py-5"><VenueStatusChip status={venue.status} /></td><td className="px-4 py-5 text-muted-foreground">{venue.contactName || "Unassigned"}</td><td className="px-4 py-5 text-muted-foreground">{venue.timezone}</td><td className="px-4 py-5 text-xs text-muted-foreground">{date(venue.updatedAt)}</td><td className="px-4 py-5"><Link href={`/venues/${venue.id}`} title={`Open ${venue.name}`} aria-label={`Open ${venue.name}`}><ArrowRight size={18} /></Link></td></tr>)}</tbody>
      </table>
      {loading && !data && <p role="status" className="p-12 text-center text-muted-foreground">Loading venues...</p>}
      {!loading && !error && data?.items.length === 0 && <div className="grid justify-items-center gap-3 p-12 text-center"><Building2 className="text-muted-foreground" size={28} /><h2 className="font-medium">{data.total ? "No venues on this page" : "No venues found"}</h2><Button variant="outline" onClick={() => router.push("/venues")}>Clear filters</Button></div>}
    </div>
    {data && <div className="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{data.total} venue{data.total === 1 ? "" : "s"}</span><div className="flex items-center gap-3"><Button variant="outline" size="icon" disabled={data.page <= 1 || loading} aria-label="Previous page" title="Previous page" onClick={() => filter({ page: String(data.page - 1) })}><ChevronLeft /></Button><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><Button variant="outline" size="icon" disabled={data.page * data.pageSize >= data.total || loading} aria-label="Next page" title="Next page" onClick={() => filter({ page: String(data.page + 1) })}><ChevronRight /></Button></div></div>}
  </>;
}

export function VenueScreen({ id, editing = false }: { id: string; editing?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [data, setData] = useState<VenueDetail | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [target, setTarget] = useState<VenueStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let live = true;
    managementApi<VenueDetail>(`/venues/${id}`).then(result => { if (live) { setData(result); setError(""); } }).catch(error => {
      if (!live) return;
      if (error instanceof ApiError && error.status === 401) router.replace(`/login?next=${encodeURIComponent(`/venues/${id}`)}`);
      else setError(error.message);
    });
    return () => { live = false; };
  }, [id, revision, editing, router]);
  useEffect(() => { if (target) dialog.current?.showModal(); else dialog.current?.close(); }, [target]);
  if (error) return <><Link href="/venues" className="text-sm text-muted-foreground">Venues</Link><ErrorNotice error={error} /><Button variant="outline" onClick={() => setRevision(revision + 1)}>Retry</Button></>;
  if (!data) return <p role="status" className="py-12 text-muted-foreground">Loading venue...</p>;
  if (editing) return data.canEdit && data.venue.status !== "archived" ? <VenueEditor key={`${id}-${data.venue.version}`} venue={data.venue} /> : <ErrorNotice error="You cannot edit this venue." />;
  const { venue, activity, archiveBlockers, linkedService } = data;
  const tab = ["overview", "hours", "activity"].includes(params.get("tab") ?? "") ? params.get("tab")! : "overview";
  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setActionError("");
    try {
      await managementApi(`/venues/${id}/status`, { method: "POST", body: JSON.stringify({ version: venue.version, status: target, reason: new FormData(event.currentTarget).get("reason") }) });
      setTarget(null); setRevision(value => value + 1);
    } catch (error) { setActionError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <Link href="/venues" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={15} />Venues</Link>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-4"><div><div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold break-words">{venue.name}</h1><VenueStatusChip status={venue.status} /></div><p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><MapPin size={15} />{[venue.address, venue.city].filter(Boolean).join(", ") || "Address not set"}</p></div>{data.canEdit && venue.status !== "archived" && <Button asChild variant="outline"><Link href={`/venues/${id}/edit`}><Pencil />Edit venue</Link></Button>}</div>
    <nav className="mt-8 flex gap-6 border-b border-border" aria-label="Venue pages">{[["overview", "Overview"], ["hours", "Opening hours"], ["activity", "Activity"]].map(([value, label]) => <Link key={value} href={`/venues/${id}?tab=${value}`} aria-current={tab === value ? "page" : undefined} className={cn("border-b-2 py-4 text-sm", tab === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}>{label}</Link>)}</nav>
    {tab === "overview" && <div className="grid gap-10 py-8 xl:grid-cols-[minmax(0,1fr)_320px]"><div>
      <h2 className="text-base font-semibold">Venue profile</h2><dl className="mt-3 grid gap-x-8 sm:grid-cols-2">{[["Contact", venue.contactName || "Unassigned"], ["Email", venue.email || "Not provided"], ["Phone", venue.phone || "Not provided"], ["Capacity", venue.capacity ? `${venue.capacity} guests` : "Not set"], ["Timezone", venue.timezone], ["Business-day cutoff", venue.businessDayCutoff]].map(([label, value]) => <div key={label} className="border-b border-border py-5"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 break-words text-sm">{value}</dd></div>)}</dl>
      {venue.notes && <section className="mt-8"><h2 className="text-base font-semibold">Notes</h2><p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{venue.notes}</p></section>}
      <section className="mt-8 border-t border-border pt-7"><h2 className="text-base font-semibold">Venue operations</h2><div className="mt-4 flex flex-wrap gap-3"><Button asChild variant="outline"><Link href={`/events?scopeType=venue&scopeId=${id}`}>Hosted events<ArrowRight /></Link></Button><Button asChild variant="outline"><Link href={`/storefronts?scopeType=venue&scopeId=${id}`}>Storefronts<ArrowRight /></Link></Button><Button asChild variant="outline"><Link href={`/floor?scopeType=venue&scopeId=${id}`}>Floor & QR<ArrowRight /></Link></Button></div></section>
      <section className="mt-8 border-t border-border pt-7"><h2 className="text-base font-semibold">Linked service</h2>{linkedService ? <div className="mt-4 flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm">{linkedService.name}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{linkedService.type} / {linkedService.status}</p></div><Button asChild variant="outline" size="sm"><Link href="/service">Open service<ArrowRight /></Link></Button></div> : <p className="mt-3 text-sm text-muted-foreground">No service linked</p>}</section>
    </div><div className="border-t border-border pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0"><h2 className="flex items-center gap-2 text-base font-semibold"><Check size={18} />Profile readiness</h2><ul className="mt-4 space-y-4 text-sm">{[["Venue name", !!venue.name], ["Address and city", !!venue.address && !!venue.city], ["Opening hours", venue.hours.some(day => !day.closed)], ["Contact assigned", !!venue.contactName]].map(([label, ready]) => <li key={String(label)} className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className={ready ? "text-emerald-300" : "text-amber-300"}>{ready ? "Complete" : "Missing"}</span></li>)}</ul>
      {data.canEdit && <section className="mt-8 border-t border-border pt-6"><h2 className="text-base font-semibold">Venue status</h2><div className="mt-4 flex flex-wrap gap-2">{(venue.status === "archived" ? ["draft"] : venue.status === "active" ? ["paused", "archived"] : ["active", "archived"]).map(value => <Button key={value} variant="outline" size="sm" disabled={value === "archived" && archiveBlockers.length > 0} onClick={() => { setActionError(""); setTarget(value as VenueStatus); }}>{value === "draft" ? "Restore to draft" : value === "active" ? "Activate" : value === "paused" ? "Pause" : "Archive"}</Button>)}</div>{archiveBlockers.length > 0 && <div className="mt-5 text-xs text-muted-foreground"><p className="flex items-center gap-2 text-amber-300"><ShieldAlert size={15} />Archive blocked</p><ul className="mt-3 list-disc space-y-2 pl-4">{archiveBlockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></div>}</section>}
    </div></div>}
    {tab === "hours" && <section className="max-w-2xl py-8"><h2 className="flex items-center gap-2 text-base font-semibold"><Clock3 size={18} />Weekly schedule</h2><p className="mt-2 text-sm text-muted-foreground">{venue.timezone}</p><dl className="mt-5 divide-y divide-border">{venue.hours.map(day => <div className="flex items-center justify-between gap-3 py-4 text-sm" key={day.day}><dt>{day.day}</dt><dd className={day.closed ? "text-muted-foreground" : ""}>{day.closed ? "Closed" : `${day.opens} - ${day.closes}${day.closes <= day.opens ? " (next day)" : ""}`}</dd></div>)}</dl></section>}
    {tab === "activity" && <section className="max-w-3xl py-8"><h2 className="flex items-center gap-2 text-base font-semibold"><History size={18} />Activity history</h2><ol className="mt-5 divide-y divide-border">{activity.map(entry => <li key={entry.id} className="py-5"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium">{entry.action}</p><time className="text-xs text-muted-foreground">{date(entry.createdAt)}</time></div><p className="mt-2 text-xs text-muted-foreground">{entry.actor}</p>{entry.changes.length > 0 && <p className="mt-2 break-words text-sm text-muted-foreground">{entry.changes.join(", ")}</p>}</li>)}</ol></section>}
    <dialog ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else setTarget(null); }} className="management w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-card p-6 text-foreground backdrop:bg-black/70"><form onSubmit={changeStatus}><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{target === "draft" ? "Restore venue" : `Set venue to ${target}`}</h2><Button type="button" variant="ghost" size="icon" aria-label="Close" disabled={busy} onClick={() => setTarget(null)}><X /></Button></div><label className="field-label mt-5">Reason<textarea key={target} className="field min-h-24" name="reason" required minLength={3} maxLength={300} autoFocus /></label>{actionError && <ErrorNotice error={actionError} />}<div className="mt-6 flex justify-end gap-3"><Button type="button" variant="outline" disabled={busy} onClick={() => setTarget(null)}>Cancel</Button><Button disabled={busy}>{busy ? "Saving..." : "Confirm change"}</Button></div></form></dialog>
  </>;
}

export function VenueEditor({ venue }: { venue?: ManagedVenue }) {
  const router = useRouter();
  const user = useManagementUser();
  const initial: VenueProfile = venue ? Object.fromEntries(Object.keys(emptyVenueProfile()).map(key => [key, venue[key as keyof VenueProfile]])) as VenueProfile : emptyVenueProfile();
  const [form, setForm] = useState<VenueProfile>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [conflict, setConflict] = useState(false);
  const createAttempt = useRef<{ payload: string; key: string } | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty && !busy) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    const onLink = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest("a");
      if (dirty && !busy && anchor && !window.confirm("Discard unsaved venue changes?")) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener("click", onLink, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", onLink, true); };
  }, [dirty, busy]);
  if (!venue && user?.role !== "owner") return <ErrorNotice error="Only the owner can create venues." />;
  function change<K extends keyof VenueProfile>(key: K, value: VenueProfile[K]) { setForm(current => ({ ...current, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setFields({}); setConflict(false);
    try {
      const payload = JSON.stringify({ ...form, ...(venue ? { version: venue.version } : {}) });
      if (!createAttempt.current || createAttempt.current.payload !== payload) createAttempt.current = { payload, key: crypto.randomUUID() };
      const saved = await managementApi<ManagedVenue>(venue ? `/venues/${venue.id}` : "/venues", { method: venue ? "PATCH" : "POST", headers: venue ? {} : { "Idempotency-Key": createAttempt.current.key }, body: payload });
      router.push(`/venues/${saved.id}?saved=1`);
    } catch (error) { setError((error as Error).message); if (error instanceof ApiError) { setFields(error.fields); setConflict(error.status === 409); } setBusy(false); }
  }
  function input(key: keyof VenueProfile, label: string, type = "text", required = false) {
    return <label className="field-label" key={key}>{label}<input className="field" name={key} type={type} value={String(form[key] ?? "")} required={required} min={type === "number" ? 1 : undefined} max={type === "number" ? 1000000 : undefined} maxLength={key === "address" ? 240 : key === "email" ? 254 : 100} aria-invalid={!!fields[key]} onChange={event => change(key, key === "capacity" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value)} />{fields[key] && <span className="mt-1 block text-xs text-red-400">{fields[key].join(", ")}</span>}</label>;
  }
  return <><Link href={venue ? `/venues/${venue.id}` : "/venues"} className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={15} />{venue?.name ?? "Venues"}</Link><h1 className="page-title mt-5">{venue ? "Edit venue" : "New venue"}</h1>
    <form onSubmit={submit} className="mt-8 max-w-4xl"><fieldset disabled={busy}>
      <section className="border-t border-border py-7"><h2 className="mb-6 flex items-center gap-2 text-base font-semibold"><Building2 size={18} />Venue details</h2><div className="grid gap-5 sm:grid-cols-2">{input("name", "Venue name", "text", true)}{input("capacity", "Guest capacity", "number")}{input("address", "Street address")}{input("city", "City")}</div></section>
      <section className="border-t border-border py-7"><h2 className="mb-6 text-base font-semibold">Contact</h2><div className="grid gap-5 sm:grid-cols-2">{input("contactName", "Contact name")}{input("phone", "Phone number", "tel")}{input("email", "Email", "email")}</div></section>
      <section className="border-t border-border py-7"><h2 className="mb-6 flex items-center gap-2 text-base font-semibold"><Settings2 size={18} />Service schedule</h2><div className="grid gap-5 sm:grid-cols-2"><label className="field-label">Timezone<select className="field" value={form.timezone} onChange={event => change("timezone", event.target.value)}>{Array.from(new Set([form.timezone, "Africa/Lagos", "Africa/Accra", "Africa/Johannesburg", "Europe/London", "UTC", ...Intl.supportedValuesOf("timeZone")])).map(zone => <option key={zone}>{zone}</option>)}</select>{fields.timezone && <span className="text-xs text-red-400">{fields.timezone.join(", ")}</span>}</label>{input("businessDayCutoff", "Business-day cutoff", "time", true)}</div>
        <div className="mt-7 divide-y divide-border">{form.hours.map((day, index) => <div key={day.day} className="grid grid-cols-[1fr_auto] items-center gap-3 py-4 sm:grid-cols-[110px_100px_1fr]">
          <span className="text-sm">{day.day}</span><label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={!day.closed} aria-label={`${day.day} open`} onChange={event => change("hours", form.hours.map((item, i) => i === index ? { ...item, closed: !event.target.checked } : item))} />Open</label>
          <div className="col-span-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:col-span-1"><input className="field !mt-0 min-w-0" type="time" aria-label={`${day.day} opens`} disabled={day.closed || busy} required={!day.closed} value={day.opens} onChange={event => change("hours", form.hours.map((item, i) => i === index ? { ...item, opens: event.target.value } : item))} /><span className="text-xs text-muted-foreground">to</span><input className="field !mt-0 min-w-0" type="time" aria-label={`${day.day} closes`} disabled={day.closed || busy} required={!day.closed} value={day.closes} onChange={event => change("hours", form.hours.map((item, i) => i === index ? { ...item, closes: event.target.value } : item))} /></div>
        </div>)}</div>{fields.hours && <p className="mt-2 text-sm text-red-400">{fields.hours.join(", ")}</p>}
      </section>
      <section className="border-t border-border py-7"><label className="field-label">Notes<textarea className="field min-h-28" value={form.notes} maxLength={2000} onChange={event => change("notes", event.target.value)} /></label></section>
      {error && <ErrorNotice error={error}>{conflict && <Button variant="ghost" type="button" onClick={() => { if (window.confirm("Discard your changes and reload the latest venue?")) window.location.reload(); }}>Reload latest</Button>}</ErrorNotice>}
      <div className="flex justify-end gap-3 border-t border-border py-6"><Button asChild variant="outline"><Link href={venue ? `/venues/${venue.id}` : "/venues"}>Cancel</Link></Button><Button type="submit" disabled={busy || (!!venue && !dirty)}><Check />{busy ? "Saving..." : venue ? "Save changes" : "Create venue"}</Button></div>
    </fieldset></form></>;
}
