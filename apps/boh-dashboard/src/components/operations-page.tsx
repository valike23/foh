"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Upload, Play, Pause, Square, RefreshCw, X } from "lucide-react";
import { Button } from "@exa-foh/ui";
import { managementApi, isTemporaryApiError } from "../lib/management-api";
import { useSearchParams } from "next/navigation";

type Operation = {
  id: string; name: string; scopeType: "venue" | "event"; status: string; version: number; revision: number;
  canManage?: boolean; published: boolean; orders: number; openingBlockers: string[]; closeoutBlockers: string[];
};
type Action = "publish" | "open" | "pause" | "close";
const labels: Record<Action, string> = { publish: "Publish configuration", open: "Open service", pause: "Pause orders", close: "Close service" };

export function OperationsPage() {
  const operationId = useSearchParams().get("operation");
  const [data, setData] = useState<{ items: Operation[]; canManage: boolean }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [pending, setPending] = useState<{ operation: Operation; action: Action }>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryable, setRetryable] = useState(false); const retries = useRef(0);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await managementApi("/operations")); setError(""); setRetryable(false); retries.current = 0; }
    catch (error) { setError((error as Error).message); setRetryable(isTemporaryApiError(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!error || !retryable || loading || retries.current >= 3) return;
    const timer = setTimeout(() => { retries.current++; void load(); }, 3000 * (retries.current + 1));
    return () => clearTimeout(timer);
  }, [error, retryable, loading, load]);
  function choose(operation: Operation, action: Action) { setPending({ operation, action }); setReason(""); setError(""); }
  async function submit() {
    if (!pending) return;
    setBusy(true);
    try {
      const { operation, action } = pending;
      await managementApi(`/operations/${operation.id}/${action === "publish" ? "publish" : "lifecycle"}`, { method: "POST", body: JSON.stringify(action === "publish" ? { scopeType: operation.scopeType, version: operation.version } : { revision: operation.revision, action, reason }) });
      setPending(undefined); await load();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  const items = data?.items.filter(o => (!operationId || o.id === operationId) && (type === "all" || o.scopeType === type) && o.name.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <>
    <header className="flex items-center justify-between gap-4 border-b border-border pb-6"><div><p className="text-sm text-muted-foreground">Operations</p><h1 className="mt-2 text-2xl font-semibold">Service operations</h1></div><Button variant="outline" size="icon" aria-label="Refresh operations" title="Refresh operations" onClick={load}><RefreshCw size={16} /></Button></header>
    {error && <p role="alert" className="my-4 text-sm text-red-400">{error}</p>}
    {operationId && <div className="mt-5 rounded border border-border bg-card p-4 text-sm"><p>Pause live service before editing its floor layout. Floor changes are available during setup, while paused, or after service closes. Return to your Floor & QR form to save, then resume service here.</p><Link className="mt-2 inline-flex items-center gap-2 text-primary underline" href="/operations">Show all operations<ArrowRight size={14} /></Link></div>}
    <div className="flex flex-wrap gap-3 py-6"><input aria-label="Search operations" className="h-10 w-full rounded-xs border border-border bg-card px-3 text-sm sm:w-80" placeholder="Search operations..." value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="Operation type" value={type} onChange={e => setType(e.target.value)} className="h-10 rounded-xs border border-border bg-card px-3 text-sm"><option value="all">All operations</option><option value="event">Events</option><option value="venue">Venues</option></select></div>
    {!data ? loading ? <p role="status">Loading operations...</p> : <Button variant="outline" onClick={load}><RefreshCw size={16} />Retry loading operations</Button> : !items.length ? <p className="py-8 text-muted-foreground">No matching operations.</p> : <div className="divide-y divide-border border-y border-border">{items.map(operation => <section key={operation.id} className="grid gap-5 py-6 xl:grid-cols-[minmax(0,1fr)_minmax(260px,1fr)_auto]">
      <div className="min-w-0"><Link className="break-words font-medium hover:underline" href={`/${operation.scopeType === "event" ? "events" : "venues"}/${operation.id}`}>{operation.name}</Link><p className="mt-2 text-sm capitalize text-muted-foreground">{operation.scopeType} · {operation.status} · {operation.orders} orders</p></div>
      <div className="text-sm text-muted-foreground">{!operation.published ? <span>Not published</span> : operation.status === "closed" ? <span>Service closed</span> : <ul className="space-y-2">{(operation.status === "live" ? operation.closeoutBlockers : operation.openingBlockers).map(blocker => <li key={blocker}>{blocker}</li>)}{operation.status === "setup" && !operation.openingBlockers.length && <li>Ready to open</li>}</ul>}</div>
      <div className="flex flex-wrap items-start gap-2 xl:justify-end">
        {operation.published && <Button variant="outline" asChild><Link href={`/service/${operation.status === "setup" ? "setup" : "command"}?operation=${encodeURIComponent(operation.id)}`}>{operation.status === "setup" ? "Menu & stock" : "Service console"}<ArrowRight size={16} /></Link></Button>}
        {(operation.canManage ?? data.canManage) && <>
          {!operation.published && <Button onClick={() => choose(operation, "publish")}><Upload size={16} />Publish</Button>}
          {operation.published && (["setup", "paused"].includes(operation.status) || operation.status === "closed" && operation.scopeType === "venue") && <Button disabled={operation.openingBlockers.length > 0} onClick={() => choose(operation, "open")}><Play size={16} />{operation.status === "paused" ? "Resume" : "Open"}</Button>}
          {operation.status === "live" && <Button variant="outline" onClick={() => choose(operation, "pause")}><Pause size={16} />Pause</Button>}
          {["live", "paused"].includes(operation.status) && <Button variant="outline" onClick={() => choose(operation, "close")}><Square size={16} />Close-out</Button>}
        </>}
      </div>
    </section>)}</div>}
    {pending && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"><section role="dialog" aria-modal="true" aria-labelledby="operation-action-title" className="w-full max-w-lg rounded-xs border border-border bg-background p-6"><div className="flex items-center justify-between gap-4"><h2 id="operation-action-title" className="text-lg font-semibold">{labels[pending.action]}</h2><Button variant="ghost" size="icon" disabled={busy} title="Cancel" aria-label="Cancel" onClick={() => setPending(undefined)}><X size={16} /></Button></div><p className="my-4 break-words text-sm">{pending.operation.name}</p>
      {pending.action === "publish" ? <p className="text-sm text-muted-foreground">Published storefront configuration will be locked. Floor changes require service to be paused or closed. Orders, stock and payments start empty.</p> : <label className="grid gap-2 text-sm">Reason<textarea autoFocus value={reason} maxLength={300} onChange={e => setReason(e.target.value)} className="min-h-24 rounded-xs border border-border bg-card p-3" /></label>}
      {pending.action === "close" && pending.operation.closeoutBlockers.length > 0 && <ul className="my-4 space-y-2 text-sm text-amber-400">{pending.operation.closeoutBlockers.map(b => <li key={b}>{b}</li>)}</ul>}
      {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
      <div className="mt-6 flex justify-end gap-3"><Button variant="outline" disabled={busy} onClick={() => setPending(undefined)}>Cancel</Button><Button disabled={busy || pending.action !== "publish" && reason.trim().length < 3 || pending.action === "close" && pending.operation.closeoutBlockers.length > 0} onClick={submit}>{busy ? "Saving..." : labels[pending.action]}</Button></div>
    </section></div>}
  </>;
}
