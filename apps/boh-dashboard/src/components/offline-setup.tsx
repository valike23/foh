"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { managementApi } from "../lib/management-api";
import { useOfflineWorkspace } from "./deployment-context";

type Operation = { id: string; name: string; status: string; managedByHub: boolean };
export function OfflineSetup() {
  const offline = useOfflineWorkspace();
  const [configured, setConfigured] = useState(false), [addresses, setAddresses] = useState<string[]>([]);
  const [key, setKey] = useState(""), [ticket, setTicket] = useState(""), [operations, setOperations] = useState<Operation[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), setupKey = params.get("setupKey");
    if (setupKey) { setKey(setupKey); window.history.replaceState(null, "", window.location.pathname); }
    if (offline) managementApi<{ configured: boolean; addresses: string[] }>("/offline/status").then(s => { setConfigured(s.configured); setAddresses(s.addresses); }).catch(e => setError(e.message)).finally(() => setLoaded(true));
  }, [offline]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (!ticket) { const result = await managementApi<{ ticket: string; operations: Operation[] }>("/offline/connect", { method: "POST", body: JSON.stringify({ ...values, setupKey: key }) }); setTicket(result.ticket); setOperations(result.operations); }
      else { await managementApi("/offline/activate", { method: "POST", body: JSON.stringify({ ...values, ticket, setupKey: key }) }); setConfigured(true); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function refreshStaff() { setBusy(true); setError(""); try { await managementApi("/offline/refresh", { method: "POST", body: JSON.stringify({ setupKey: key }) }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  if (!offline) return <main className="management p-10">Open this page on the installed local hub.</main>;
  if (!loaded) return <main className="management grid min-h-screen place-items-center" role="status">Loading local hub…</main>;
  return <main className="management grid min-h-screen place-items-center bg-background p-6"><section className="w-full max-w-xl space-y-6 rounded-2xl border border-border bg-card p-8"><p className="text-sm text-muted-foreground">Pricemate Local Hub</p><h1 className="text-2xl font-semibold">{configured ? "Your local workspace is ready" : "Connect this venue"}</h1>{configured ? <><p className="text-sm text-muted-foreground">Staff can use these addresses on the same Wi-Fi or wired network. Internet is only needed for sync.</p><div className="flex flex-wrap gap-3"><Link className="rounded-lg bg-primary px-4 py-3 text-primary-foreground" href="/pos">Open POS</Link><Link className="rounded-lg border border-border px-4 py-3" href="/login">Staff / kitchen login</Link><Link className="rounded-lg border border-border px-4 py-3" href="/sync">Sync status</Link></div><ul className="space-y-2 text-sm text-muted-foreground">{addresses.map(a => <li key={a}>{a}</li>)}</ul>{key && <button className="text-sm underline" disabled={busy} onClick={refreshStaff}>Reconnect and refresh staff access</button>}<p className="text-xs text-muted-foreground">Keep this computer and the local network running during service.</p></> : <><p className="text-sm text-muted-foreground">Initial activation needs internet and the business owner's online account. It downloads the selected service, menus, stock, staff, and permissions to SQLite.</p><form method="post" className="space-y-5" onSubmit={submit}><fieldset key={ticket ? "service" : "account"} disabled={busy} className="space-y-5">{!ticket ? <><label className="block text-sm">Hub setup key<input className="field mt-2" type="password" value={key} required onChange={e => setKey(e.target.value)} /><span className="mt-1 block text-xs text-muted-foreground">Available on the installed server. Do not share it with other devices.</span></label><label className="block text-sm">Online business URL<input className="field mt-2" name="cloudUrl" type="url" placeholder="https://yourbusiness.pricemate.com.ng" required /></label><label className="block text-sm">Owner email<input className="field mt-2" name="email" type="email" autoComplete="username" required /></label><label className="block text-sm">Owner password<input className="field mt-2" name="password" type="password" autoComplete="current-password" required /></label></> : <><label className="block text-sm">Venue or event<select className="field mt-2" name="operationId" required><option value="">Choose a published service</option>{operations.map(o => <option key={o.id} value={o.id}>{o.name} · {o.status}{o.managedByHub ? " · already linked to a hub" : ""}</option>)}</select></label><label className="block text-sm">Name this hub<input className="field mt-2" name="name" defaultValue="Venue hub" minLength={2} maxLength={100} required /></label><p className="text-xs text-muted-foreground">This hub becomes the transaction authority for this service. Cloud sales and stock edits pause until you sync and hand service back.</p></>}<button className="w-full rounded-lg bg-primary px-5 py-3 text-primary-foreground" disabled={busy}>{busy ? "Connecting…" : ticket ? "Download and activate" : "Connect online account"}</button>{ticket && <button type="button" onClick={() => setTicket("")} className="text-sm underline">Use another account</button>}</fieldset></form></>}{error && <p role="alert" className="text-sm text-red-400">{error}</p>}</section></main>;
}
