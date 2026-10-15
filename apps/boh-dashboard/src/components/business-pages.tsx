"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DateTime } from "luxon";
import QRCode from "qrcode";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Copy, Download, Eye, Pencil, Plus, QrCode, RotateCcw, Search, X } from "lucide-react";
import { Button, cn } from "@exa-foh/ui";
import type { BusinessKind, BusinessDetail, BusinessOptions, BusinessEntity, ManagedEvent, ManagedStorefront, FloorPlace } from "@exa-foh/shared";
import { ApiError, managementApi } from "../lib/management-api";
import { useManagementUser } from "./management-shell";
import { GuestAppearanceEditor } from "./guest-appearance-editor";

export const businessLabels = { events: "Events", vendors: "Vendors", storefronts: "Storefronts", floor: "Floor & QR" };
const singular = { events: "event", vendors: "vendor", storefronts: "storefront", floor: "floor location" };
const statuses = { events: ["draft", "ready", "live", "closing", "closed", "cancelled", "archived"], vendors: ["active", "archived"], storefronts: ["draft", "active", "paused", "archived"], floor: ["active", "archived"] };
const fieldNames = {
  events: ["name", "venueId", "location", "timezone", "startsAt", "endsAt", "organizer", "notes"],
  vendors: ["name", "kind", "contactName", "email", "phone", "notes"],
  storefronts: ["name", "scopeType", "scopeId", "vendorId", "kind", "prepStation", "manualConfirmation", "fulfillment", "sectionIds", "commercialTerms", "notes"],
  floor: ["name", "scopeType", "scopeId", "kind", "parentId", "storefrontId", "capacity"]
};
type FormValues = Record<string, any>;
type Directory = { items: BusinessEntity[]; total: number; page: number; pageSize: number; canCreate: boolean; counts: { total: number; active: number; draft: number } };
function Problem({ error }: { error: string }) { return error ? <p role="alert" className="my-4 border border-red-900 bg-red-950/20 p-4 text-sm text-red-300">{error}</p> : null; }
function errorMessage(error: unknown) { return error instanceof ApiError && Object.keys(error.fields).length ? Object.entries(error.fields).map(([key, messages]) => `${key}: ${messages.join(", ")}`).join(". ") : (error as Error).message; }
function Status({ value }: { value: string }) { return <span className={cn("status-chip", ["active", "live", "ready"].includes(value) ? "border-emerald-900 text-emerald-300" : "border-border text-muted-foreground")}>{value}</span>; }
function operationName(record: BusinessEntity, options: BusinessOptions | null) {
  const ref = record as ManagedStorefront;
  return (ref.scopeType === "event" ? options?.events : options?.venues)?.find(item => item.id === ref.scopeId)?.name ?? "-";
}
function useOptions() {
  const [options, setOptions] = useState<BusinessOptions | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let live = true; managementApi<BusinessOptions>("/business/options").then(data => { if (live) setOptions(data); }).catch(error => { if (live) setError(error.message); }); return () => { live = false; }; }, []);
  return { options, error };
}
function operationOptions(options: BusinessOptions) { return [...options.venues.map(v => ({ value: `venue:${v.id}`, label: `Venue / ${v.name}` })), ...options.events.map(e => ({ value: `event:${e.id}`, label: `Event / ${e.name}` }))]; }

export function BusinessDirectory({ kind }: { kind: BusinessKind }) {
  const router = useRouter(); const params = useSearchParams(); const { options, error: optionsError } = useOptions();
  const [data, setData] = useState<Directory | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(true); const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState(params.get("q") ?? ""); const query = params.toString();
  useEffect(() => { setSearch(params.get("q") ?? ""); }, [params]);
  useEffect(() => {
    let live = true; setBusy(true); setError("");
    managementApi<Directory>(`/${kind}?${query}`).then(value => { if (live) setData(value); }).catch(error => {
      if (!live) return;
      if (error instanceof ApiError && error.status === 401) router.replace(`/login?next=/${kind}`); else setError(error.message);
    }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [kind, query, retry, router]);
  function filter(values: Record<string, string>) { const next = new URLSearchParams(query); next.delete("page"); Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); router.push(`/${kind}?${next}`); }
  const scopeQuery = new URLSearchParams(); for (const key of ["scopeType", "scopeId"]) if (params.get(key)) scopeQuery.set(key, params.get(key)!);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="eyebrow">Management</p><h1 className="page-title">{businessLabels[kind]}</h1></div>{data?.canCreate && <Button asChild><Link href={`/${kind}/new?${scopeQuery}`}><Plus />New {singular[kind]}</Link></Button>}</div>
    <div className="my-7 flex gap-12 border-y border-border py-5">{[["Total", data?.counts.total], ["Active", data?.counts.active], ...(kind === "events" || kind === "storefronts" ? [["Draft", data?.counts.draft]] : [])].map(([label, value]) => <div key={String(label)}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value ?? "-"}</p></div>)}</div>
    <div className="flex flex-wrap gap-3"><form className="relative min-w-48 flex-1 sm:max-w-sm" onSubmit={event => { event.preventDefault(); filter({ q: search }); }}><input className="field !mt-0 !pr-10" aria-label={`Search ${businessLabels[kind].toLowerCase()}`} placeholder={`Search ${businessLabels[kind].toLowerCase()}...`} value={search} onChange={event => setSearch(event.target.value)} /><button className="absolute right-0 top-0 grid h-11 w-10 place-items-center" aria-label="Search" title="Search"><Search size={17} /></button></form>
      <select aria-label="Filter status" className="field !mt-0 !w-auto" value={params.get("status") ?? "all"} onChange={event => filter({ status: event.target.value })}><option value="all">All statuses</option>{statuses[kind].map(status => <option key={status}>{status}</option>)}</select>
      {options && kind !== "vendors" && <select aria-label="Filter operation" className="field !mt-0 !w-auto max-w-full sm:max-w-sm" value={params.get("scopeId") ? `${params.get("scopeType") ?? "venue"}:${params.get("scopeId")}` : ""} onChange={event => { const [scopeType = "", scopeId = ""] = event.target.value.split(":"); filter({ scopeType, scopeId }); }}><option value="">{kind === "events" ? "All venues" : "All operations"}</option>{(kind === "events" ? operationOptions(options).filter(o => o.value.startsWith("venue:")) : operationOptions(options)).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}
    </div>
    <Problem error={error || optionsError} />{error && <Button variant="outline" onClick={() => setRetry(retry + 1)}>Retry</Button>}
    <div className="mt-5 overflow-x-auto border-y border-border" aria-busy={busy}><table className="w-full min-w-[660px] text-left text-sm"><thead className="bg-secondary/40 text-xs text-muted-foreground"><tr>{["Name", "Status", kind === "events" ? "Location" : kind === "vendors" ? "Contact" : "Operation", kind === "events" ? "Starts" : kind === "vendors" ? "Email" : "Type", ""].map((label, i) => <th key={i} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className={cn("divide-y divide-border", busy && "opacity-50")}>{data?.items.map(item => { const record = item as any; return <tr key={record.id} className="hover:bg-secondary/30"><td className="px-4 py-5"><Link className="font-medium hover:underline" href={`/${kind}/${record.id}`}>{record.name}</Link></td><td className="px-4 py-5"><Status value={record.status} /></td><td className="px-4 py-5 text-muted-foreground">{kind === "events" ? options?.venues.find(v => v.id === record.venueId)?.name ?? record.location : kind === "vendors" ? record.contactName || "Unassigned" : operationName(item, options)}</td><td className="px-4 py-5 text-muted-foreground">{kind === "events" ? record.startsAt ? DateTime.fromISO(record.startsAt).setZone(record.timezone).toFormat("dd LLL yyyy, HH:mm") : "Not set" : kind === "vendors" ? record.email || "Not provided" : record.kind}</td><td className="px-4"><Link href={`/${kind}/${record.id}`} aria-label={`Open ${record.name}`}><ArrowRight size={17} /></Link></td></tr>; })}</tbody></table>{!data && busy && <p className="p-10 text-center text-muted-foreground">Loading...</p>}{data && !busy && !data.items.length && <p className="p-10 text-center text-muted-foreground">No {businessLabels[kind].toLowerCase()} found</p>}</div>
    {data && <div className="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{data.total} results</span><div className="flex items-center gap-3"><Button variant="outline" size="icon" title="Previous page" aria-label="Previous page" disabled={busy || data.page === 1} onClick={() => filter({ page: String(data.page - 1) })}><ChevronLeft /></Button><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / 12))}</span><Button variant="outline" size="icon" title="Next page" aria-label="Next page" disabled={busy || data.page * 12 >= data.total} onClick={() => filter({ page: String(data.page + 1) })}><ChevronRight /></Button></div></div>}
  </>;
}

export function BusinessRecordPage({ kind, id, editing = false }: { kind: BusinessKind; id: string; editing?: boolean }) {
  const { options, error: optionsError } = useOptions(); const params = useSearchParams(); const router = useRouter(); const user = useManagementUser();
  const [detail, setDetail] = useState<BusinessDetail | null>(null); const [error, setError] = useState(""); const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null); const attempt = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => { let live = true; managementApi<BusinessDetail>(`/${kind}/${id}`).then(result => { if (live) { setDetail(result); setError(""); } }).catch(error => { if (live) setError(error.message); }); return () => { live = false; }; }, [kind, id, revision, editing]);
  useEffect(() => { if (action) dialog.current?.showModal(); else dialog.current?.close(); }, [action]);
  if (error || optionsError) return <><Problem error={error || optionsError} /><Button variant="outline" onClick={() => setRevision(revision + 1)}>Retry</Button></>;
  if (!detail || !options) return <p role="status" className="py-10 text-muted-foreground">Loading...</p>;
  if (editing) return detail.canEdit && detail.record.status !== "archived" ? <BusinessEditor kind={kind} record={detail.record} /> : <Problem error="This configuration is locked or you do not have edit access." />;
  const record = detail.record as any;
  const tab = params.get("tab") ?? "overview";
  const operationQuery = kind === "events" ? `scopeType=event&scopeId=${id}` : `scopeType=${record.scopeType}&scopeId=${record.scopeId}`;
  const tabs = ["overview", "activity", ...(kind === "events" ? ["appearance"] : []), ...((kind === "storefronts" || (kind === "floor" && record.kind !== "section")) ? ["qr"] : [])];
  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setActionError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      let path = `/${kind}/${id}/status`; let payload: any = { version: record.version, status: action, reason: values.reason };
      if (action === "clone") { path = `/events/${id}/clone`; payload = { name: values.name, startsAt: zonedISO(String(values.startsAt), record.timezone), endsAt: zonedISO(String(values.endsAt), record.timezone) }; }
      if (action === "rotate" || action === "disable") { path = `/${kind}/${id}/qr`; payload = { version: record.version, action }; }
      const body = JSON.stringify(payload);
      if (!attempt.current || attempt.current.payload !== body) attempt.current = { payload: body, key: crypto.randomUUID() };
      const result = await managementApi<BusinessEntity>(path, { method: "POST", body, headers: { "Idempotency-Key": attempt.current.key } });
      setAction(null); setRevision(value => value + 1);
      if (action === "clone") router.push(`/events/${result.id}`);
    } catch (error) { setActionError(errorMessage(error)); } finally { setBusy(false); }
  }
  const displayFields = kind === "events" ? [["Venue", options.venues.find(v => v.id === record.venueId)?.name ?? record.location], ["Organizer", record.organizer], ["Timezone", record.timezone], ["Starts", record.startsAt ? DateTime.fromISO(record.startsAt).setZone(record.timezone).toFormat("dd LLL yyyy, HH:mm") : "Not set"], ["Ends", record.endsAt ? DateTime.fromISO(record.endsAt).setZone(record.timezone).toFormat("dd LLL yyyy, HH:mm") : "Not set"]]
    : kind === "vendors" ? [["Type", record.kind], ["Contact", record.contactName], ["Email", record.email], ["Phone", record.phone]]
    : kind === "storefronts" ? [["Operation", operationName(record, options)], ["Vendor", options.vendors.find(v => v.id === record.vendorId)?.name], ["Type", record.kind], ["Preparation destination", record.prepStation], ["Fulfillment", record.fulfillment], ["Confirmation", record.manualConfirmation ? "Staff confirmation" : "Automatic"], ["Service sections", record.sectionIds.map((id: string) => options.floor.find(p => p.id === id)?.name ?? id).join(", ") || "All sections"]]
    : [["Operation", operationName(record, options)], ["Type", record.kind], ["Parent", options.floor.find(p => p.id === record.parentId)?.name ?? "None"], ["Storefront", options.storefronts.find(s => s.id === record.storefrontId)?.name ?? "None"], ["Capacity", String(record.capacity)]];
  return <><Link href={`/${kind}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={15} />{businessLabels[kind]}</Link>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-4"><div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold break-words">{record.name}</h1><Status value={record.status} /></div><div className="flex gap-2">{kind === "events" && user?.role !== "viewer" && <Button variant="outline" onClick={() => { setActionError(""); setAction("clone"); }}><Copy />Clone event</Button>}{detail.canEdit && !["archived", "closed", "cancelled"].includes(record.status) && <Button asChild variant="outline"><Link href={`/${kind}/${id}/edit`}><Pencil />Edit {singular[kind]}</Link></Button>}</div></div>
    <nav className="mt-7 flex flex-wrap gap-6 border-b border-border" aria-label="Record sections">{tabs.map(value => <Link key={value} href={`/${kind}/${id}?tab=${value}`} className={cn("border-b-2 py-4 text-sm capitalize", tab === value ? "border-primary" : "border-transparent text-muted-foreground")}>{value === "qr" ? "QR code" : value === "appearance" ? "Guest appearance" : value}</Link>)}</nav>
    {kind === "events" && tab === "appearance" && <GuestAppearanceEditor key={id} eventId={id} />}
    {tab === "overview" && <div className="grid gap-10 py-8 xl:grid-cols-[minmax(0,1fr)_340px]"><div><h2 className="font-semibold">Details</h2><dl className="mt-2 grid gap-x-8 sm:grid-cols-2">{displayFields.map(([label, value]) => <div className="border-b border-border py-5" key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 break-words text-sm">{value || "Not provided"}</dd></div>)}</dl>{record.notes && <section className="mt-7"><h2 className="font-semibold">Notes</h2><p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{record.notes}</p></section>}{kind === "storefronts" && <section className="mt-7"><h2 className="font-semibold">Commercial terms</h2><p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{record.commercialTerms || "Not agreed"}</p></section>}
      {kind === "events" && <div className="mt-8 flex flex-wrap gap-3"><Button asChild variant="outline"><Link href={`/storefronts?${operationQuery}`}>Storefronts<ArrowRight /></Link></Button><Button asChild variant="outline"><Link href={`/floor?${operationQuery}`}>Floor & QR<ArrowRight /></Link></Button><CustomerMenuPreview key={id} eventId={id} status={record.status} /></div>}
      {kind === "vendors" && <section className="mt-8"><h2 className="font-semibold">Storefront allocations</h2><VendorAllocations vendorId={id} /></section>}
    </div><aside className="border-t border-border pt-6 xl:border-l xl:border-t-0 xl:pl-7 xl:pt-0">{kind === "events" && <><h2 className="font-semibold">Setup checklist</h2><ul className="mt-4 space-y-4">{detail.readiness.map(check => <li key={check.label} className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">{check.label}</span><span className={check.complete ? "text-emerald-300" : "text-amber-300"}>{check.complete ? "Ready" : "Missing"}</span></li>)}</ul></>}
      <section className={kind === "events" ? "mt-7 border-t border-border pt-6" : ""}><h2 className="font-semibold">Status</h2>{detail.linkedService ? <p className="mt-3 text-sm text-muted-foreground">Published to the current service. Configuration is locked.</p> : kind === "events" && <p className="mt-3 text-sm text-muted-foreground">Service not connected. Guest ordering remains closed.</p>}{detail.canEdit && <div className="mt-4 flex flex-wrap gap-2">{detail.transitions.map(status => <Button key={status} variant="outline" size="sm" disabled={status === "archived" && detail.blockers.length > 0} onClick={() => { setActionError(""); setAction(status); }}>{status === "draft" ? "Return to draft" : status === "ready" ? "Mark ready" : status === "active" ? "Activate" : status === "paused" ? "Pause" : status === "cancelled" ? "Cancel event" : "Archive"}</Button>)}</div>}{detail.blockers.length > 0 && <ul className="mt-4 list-disc space-y-2 pl-4 text-xs text-muted-foreground">{detail.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>}</section>
    </aside></div>}
    {tab === "activity" && <ol className="max-w-4xl divide-y divide-border py-5">{detail.activity.length ? detail.activity.map(entry => <li key={entry.id} className="py-5"><p className="text-sm">{entry.action}</p><p className="mt-2 text-xs text-muted-foreground">{entry.actor} / {new Date(entry.createdAt).toLocaleString()}</p></li>) : <li className="py-5 text-sm text-muted-foreground">No changes recorded</li>}</ol>}
    {tab === "qr" && <QRPanel name={record.name} token={record.qrToken} canEdit={user?.role !== "viewer" && record.status !== "archived"} onAction={value => { setActionError(""); setAction(value); }} />}
    <dialog ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else setAction(null); }} className="management w-[calc(100%-2rem)] max-w-lg rounded-xs border border-border bg-card p-6 text-foreground backdrop:bg-black/70"><form onSubmit={submitAction}><div className="flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">{action === "clone" ? "Clone event" : action === "rotate" ? "Replace QR code" : action === "disable" ? "Disable QR code" : "Change status"}</h2><Button variant="ghost" size="icon" type="button" aria-label="Close dialog" disabled={busy} onClick={() => setAction(null)}><X /></Button></div>
      {action === "clone" ? <div className="mt-5 space-y-5"><label className="field-label">Event name<input className="field" name="name" defaultValue={`${record.name} copy`} required minLength={2} maxLength={100} /></label><label className="field-label">Starts ({record.timezone})<input className="field" name="startsAt" type="datetime-local" required /></label><label className="field-label">Ends ({record.timezone})<input className="field" name="endsAt" type="datetime-local" required /></label></div> : ["rotate", "disable"].includes(action ?? "") ? <p className="mt-5 text-sm text-muted-foreground">Existing printed copies will stop working.</p> : <label className="field-label mt-5">Reason<textarea className="field" name="reason" required minLength={3} maxLength={300} /></label>}
      <Problem error={actionError} /><div className="mt-6 flex justify-end gap-3"><Button variant="outline" type="button" disabled={busy} onClick={() => setAction(null)}>Cancel</Button><Button disabled={busy}>{busy ? "Saving..." : "Confirm"}</Button></div></form></dialog>
  </>;
}

function CustomerMenuPreview({ eventId, status }: { eventId: string; status: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true); setError(""); setToken(null);
    managementApi<{ token: string | null }>(`/events/${eventId}/menu-preview`)
      .then(data => { if (live) setToken(data.token); })
      .catch(error => { if (live) setError(error.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [eventId, retry]);
  if (error) return <div><Button variant="outline" onClick={() => setRetry(value => value + 1)}><RotateCcw />Retry menu preview</Button><Problem error={error} /></div>;
  const unavailable = ["archived", "cancelled", "closed"].includes(status);
  if (loading || !token || unavailable) return <Button variant="outline" disabled title={loading ? "Loading preview" : unavailable ? "This event's preview is closed" : "No menu preview configured for this event"}><Eye />Preview customer menu</Button>;
  const guestUrl = (process.env.NEXT_PUBLIC_GUEST_URL ?? "http://localhost:5174").replace(/\/$/, "");
  return <Button asChild variant="outline"><a href={`${guestUrl}/preview/${encodeURIComponent(token)}`} target="_blank" rel="noopener noreferrer" title="Open customer menu in a new tab"><Eye />Preview customer menu</a></Button>;
}

function VendorAllocations({ vendorId }: { vendorId: string }) {
  const [items, setItems] = useState<BusinessEntity[]>([]); const [error, setError] = useState("");
  useEffect(() => { let live = true; managementApi<Directory>(`/storefronts?vendorId=${vendorId}`).then(data => { if (live) setItems(data.items); }).catch(error => { if (live) setError(error.message); }); return () => { live = false; }; }, [vendorId]);
  return <><Problem error={error} /><div className="mt-3 divide-y divide-border">{items.length ? items.map(item => <Link className="flex justify-between py-4 text-sm" href={`/storefronts/${item.id}`} key={item.id}>{item.name}<Status value={item.status} /></Link>) : <p className="text-sm text-muted-foreground">No storefronts allocated</p>}</div></>;
}

function QRPanel({ name, token, canEdit, onAction }: { name: string; token: string | null; canEdit: boolean; onAction: (value: string) => void }) {
  const [image, setImage] = useState(""); const [url, setUrl] = useState(""); const [error, setError] = useState("");
  useEffect(() => {
    let live = true; setImage(""); setError("");
    if (!token) { setUrl(""); return; }
    const origin = process.env.NEXT_PUBLIC_GUEST_URL ?? `${window.location.protocol}//${window.location.hostname}:5174`;
    const destination = new URL(`/entry/${token}`, origin).href; setUrl(destination);
    QRCode.toDataURL(destination, { width: 600, margin: 4, errorCorrectionLevel: "M" }).then(data => { if (live) setImage(data); }).catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [token]);
  return <section className="py-8"><h2 className="flex items-center gap-2 font-semibold"><QrCode size={18} />{name}</h2><Problem error={error} />{image ? <><img src={image} alt={`QR code for ${name}`} width={260} height={260} className="mt-6 h-[260px] w-[260px] max-w-full" /><p className="mt-4 max-w-2xl break-all text-xs text-muted-foreground">{url}</p><div className="mt-5 flex flex-wrap gap-3"><Button asChild variant="outline"><a href={image} download={`${name.replace(/[^a-z0-9]/gi, "-")}-qr.png`}><Download />Download PNG</a></Button><Button asChild variant="outline"><a href={url} target="_blank" rel="noreferrer">Preview destination<ArrowRight /></a></Button></div></> : !token ? <p className="mt-5 text-sm text-muted-foreground">QR code disabled</p> : <p className="mt-5 text-sm">Generating QR code...</p>}{canEdit && <div className="mt-6 flex flex-wrap gap-3"><Button variant="outline" onClick={() => onAction("rotate")}><RotateCcw />{token ? "Replace code" : "Enable QR code"}</Button>{token && <Button variant="outline" onClick={() => onAction("disable")}><X />Disable code</Button>}</div>}</section>;
}

function zonedISO(value: string, zone: string) {
  const date = DateTime.fromISO(value, { zone });
  if (!date.isValid || date.toFormat("yyyy-MM-dd'T'HH:mm") !== value.slice(0, 16)) throw new Error("That local time is not valid in the selected timezone");
  if (date.getPossibleOffsets().length > 1) throw new Error("That time occurs twice because of daylight saving. Choose an unambiguous time.");
  return date.toUTC().toISO()!;
}

export function BusinessEditor({ kind, record }: { kind: BusinessKind; record?: BusinessEntity }) {
  const { options, error: optionsError } = useOptions(); const params = useSearchParams(); const router = useRouter(); const user = useManagementUser();
  const defaults: FormValues = kind === "events" ? { name: "", venueId: params.get("scopeId") ?? null, location: "", timezone: "Africa/Lagos", startsAt: "", endsAt: "", organizer: "", notes: "" }
    : kind === "vendors" ? { name: "", kind: "external", contactName: "", email: "", phone: "", notes: "" }
    : kind === "storefronts" ? { name: "", scopeType: params.get("scopeType") ?? "venue", scopeId: params.get("scopeId") ?? "", vendorId: "", kind: "bar", prepStation: "", manualConfirmation: true, fulfillment: "pickup", sectionIds: [], commercialTerms: "", notes: "" }
    : { name: "", scopeType: params.get("scopeType") ?? "venue", scopeId: params.get("scopeId") ?? "", kind: "section", parentId: null, storefrontId: null, capacity: 4 };
  const initial = record ? Object.fromEntries(fieldNames[kind].map(key => [key, (record as any)[key]])) : defaults;
  if (kind === "events" && record) { initial.startsAt = initial.startsAt ? DateTime.fromISO(initial.startsAt).setZone(initial.timezone).toFormat("yyyy-MM-dd'T'HH:mm") : ""; initial.endsAt = initial.endsAt ? DateTime.fromISO(initial.endsAt).setZone(initial.timezone).toFormat("yyyy-MM-dd'T'HH:mm") : ""; }
  const [values, setValues] = useState<FormValues>(initial); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [step, setStep] = useState(0);
  const attempt = useRef<{ payload: string; key: string } | null>(null); const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty && !busy) event.preventDefault(); };
    const link = (event: MouseEvent) => { if (dirty && !busy && (event.target as Element).closest("a") && !window.confirm("Discard unsaved changes?")) { event.preventDefault(); event.stopPropagation(); } };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", link, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", link, true); };
  }, [dirty, busy]);
  if (optionsError) return <Problem error={optionsError} />;
  if (!options) return <p role="status">Loading setup...</p>;
  if (user?.role === "viewer" || (kind === "vendors" && user?.role !== "owner")) return <Problem error="You do not have edit permission." />;
  function change(key: string, value: any) { setValues(current => ({ ...current, [key]: value, ...(kind === "floor" && key === "kind" ? { parentId: null, storefrontId: null, capacity: value === "seat" ? 1 : 4 } : {}) })); }
  const input = (key: string, label: string, type = "text", required = false) => <label className="field-label" key={key}>{label}<input name={key} className="field" type={type} required={required} value={values[key] ?? ""} min={type === "number" ? 1 : undefined} maxLength={type === "text" ? 240 : undefined} onChange={event => change(key, type === "number" ? Number(event.target.value) : event.target.value)} /></label>;
  const select = (key: string, label: string, choices: { value: string; label: string }[], required = true, disabled = false) => <label className="field-label" key={key}>{label}<select className="field" name={key} aria-label={label} value={values[key] ?? ""} required={required} disabled={disabled} onChange={event => change(key, event.target.value || null)}><option value="">Select...</option>{choices.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  const choice = (items: string[]) => items.map(value => ({ value, label: value }));
  const matchingFloor = options.floor.filter(p => p.scopeId === values.scopeId && p.scopeType === values.scopeType && p.status === "active");
  const notes = (key = "notes", label = "Notes") => <label className="field-label mt-6">{label}<textarea className="field min-h-28" value={values[key] ?? ""} maxLength={2000} onChange={event => change(key, event.target.value)} /></label>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (kind === "events" && !record && step < 2) { setStep(step + 1); return; }
    setBusy(true);
    try {
      const payload: FormValues = { ...values, ...(record ? { version: record.version } : {}) };
      if (kind === "events") { payload.startsAt = zonedISO(values.startsAt, values.timezone); payload.endsAt = zonedISO(values.endsAt, values.timezone); }
      const body = JSON.stringify(payload);
      if (!attempt.current || attempt.current.payload !== body) attempt.current = { payload: body, key: crypto.randomUUID() };
      const result = await managementApi<BusinessEntity>(`/${kind}${record ? `/${record.id}` : ""}`, { method: record ? "PATCH" : "POST", body, headers: { "Idempotency-Key": attempt.current.key } });
      router.push(`/${kind}/${result.id}`);
    } catch (error) { setError(errorMessage(error)); setBusy(false); }
  }
  const eventIdentity = <div className="grid gap-5 sm:grid-cols-2">{input("name", "Event name", "text", true)}{select("venueId", "Host venue", options.venues.filter(v => v.status !== "archived").map(v => ({ value: v.id, label: v.name })), false)}{!values.venueId && input("location", "Temporary site address", "text", true)}{input("organizer", "Organizer / responsible manager", "text", true)}</div>;
  const eventSchedule = <><div className="grid gap-5 sm:grid-cols-2">{select("timezone", "Timezone", Array.from(new Set([values.timezone, ...Intl.supportedValuesOf("timeZone"), "UTC"])).map(value => ({ value, label: value })))}{input("startsAt", "Starts", "datetime-local", true)}{input("endsAt", "Ends", "datetime-local", true)}</div>{notes()}</>;
  return <><Link className="inline-flex items-center gap-2 text-sm text-muted-foreground" href={record ? `/${kind}/${record.id}` : `/${kind}`}><ArrowLeft size={15} />{record?.name ?? businessLabels[kind]}</Link><h1 className="page-title mt-5">{record ? "Edit" : "New"} {singular[kind]}</h1>
    {kind === "events" && !record && <div className="mt-7 flex flex-wrap gap-6 border-b border-border pb-4">{["Identity & location", "Schedule", "Review"].map((label, i) => <span key={label} className={cn("text-sm", i === step ? "text-foreground" : "text-muted-foreground")}>{i + 1}. {label}</span>)}</div>}
    <form onSubmit={submit} className="mt-8"><fieldset disabled={busy} className="max-w-5xl">
      {kind === "events" ? record ? <>{eventIdentity}<section className="mt-8 border-t border-border pt-8">{eventSchedule}</section></> : step === 0 ? eventIdentity : step === 1 ? eventSchedule : <dl className="grid gap-5 sm:grid-cols-2">{[["Name", values.name], ["Location", options.venues.find(v => v.id === values.venueId)?.name ?? values.location], ["Organizer", values.organizer], ["Timezone", values.timezone], ["Starts", values.startsAt], ["Ends", values.endsAt]].map(([label, value]) => <div key={label} className="border-b border-border pb-4"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 break-words text-sm">{value}</dd></div>)}</dl> : <>
        <div className="grid gap-5 sm:grid-cols-2">{input("name", kind === "vendors" ? "Vendor name" : kind === "storefronts" ? "Storefront name" : "Location label", "text", true)}
          {kind === "vendors" ? <>{select("kind", "Vendor type", choice(["internal", "external"]))}{input("contactName", "Contact name")}{input("email", "Email", "email")}{input("phone", "Phone", "tel")}</> : <><label className="field-label">Operation<select className="field" required disabled={!!record} value={values.scopeId ? `${values.scopeType}:${values.scopeId}` : ""} onChange={event => { const [scopeType, scopeId] = event.target.value.split(":"); setValues(current => ({ ...current, scopeType, scopeId, ...(kind === "floor" ? { parentId: null, storefrontId: null } : { sectionIds: [] }) })); }}><option value="">Select operation...</option>{operationOptions(options).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          {kind === "storefronts" ? <>{select("vendorId", "Vendor", options.vendors.filter(v => v.status === "active").map(v => ({ value: v.id, label: v.name })))}{select("kind", "Storefront type", choice(["bar", "kitchen", "bottle-service", "merch"]))}{input("prepStation", "Preparation destination", "text", true)}{select("fulfillment", "Fulfillment", choice(["pickup", "table", "seat"]))}<label className="flex items-center gap-3 py-3 text-sm"><input type="checkbox" checked={values.manualConfirmation} onChange={event => change("manualConfirmation", event.target.checked)} />Require staff order confirmation</label></>
            : <>{select("kind", "Location type", choice(["section", "table", "seat"]), true, !!record)}{input("capacity", "Capacity", "number", true)}{values.kind !== "section" && <>{select("parentId", values.kind === "table" ? "Section" : "Table", matchingFloor.filter(p => p.kind === (values.kind === "table" ? "section" : "table")).map(p => ({ value: p.id, label: p.name })))}{select("storefrontId", "Storefront", options.storefronts.filter(s => s.scopeId === values.scopeId && s.scopeType === values.scopeType && s.status !== "archived").map(s => ({ value: s.id, label: s.name })))}</>}</>}</>}
        </div>
        {kind === "storefronts" && <><section className="mt-7 border-t border-border pt-6"><h2 className="font-semibold">Service sections</h2><div className="mt-4 flex flex-wrap gap-5">{matchingFloor.filter(p => p.kind === "section").map(section => <label className="flex items-center gap-2 text-sm" key={section.id}><input type="checkbox" checked={values.sectionIds.includes(section.id)} onChange={event => change("sectionIds", event.target.checked ? [...values.sectionIds, section.id] : values.sectionIds.filter((id: string) => id !== section.id))} />{section.name}</label>)}{!matchingFloor.some(p => p.kind === "section") && <p className="text-sm text-muted-foreground">No sections configured</p>}</div></section>{notes("commercialTerms", "Commercial terms / settlement agreement")}</>}
        {kind !== "floor" && notes()}
      </>}
      <Problem error={error} /><div className="mt-8 flex flex-wrap justify-end gap-3 border-t border-border py-6">{kind === "events" && !record && step > 0 ? <Button type="button" variant="outline" onClick={() => setStep(step - 1)}><ChevronLeft />Back</Button> : <Button variant="outline" asChild><Link href={record ? `/${kind}/${record.id}` : `/${kind}`}>Cancel</Link></Button>}<Button disabled={busy}><Check />{busy ? "Saving..." : kind === "events" && !record && step < 2 ? "Continue" : record ? "Save changes" : `Create ${singular[kind]}`}</Button></div>
    </fieldset></form>
  </>;
}
