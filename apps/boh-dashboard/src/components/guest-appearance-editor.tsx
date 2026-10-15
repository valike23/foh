"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Monitor, Plus, RotateCcw, Save, Smartphone, Trash2 } from "lucide-react";
import { Button, GuestBrandingFrame, cn } from "@exa-foh/ui";
import { defaultGuestBranding, type GuestBranding, type GuestBrandingDetail } from "@exa-foh/shared";
import { managementApi } from "../lib/management-api";

type Asset = { id: string; name: string; kind: "image" | "font" };
const assetBase = "/api/manage/branding-assets";

export function GuestAppearanceEditor({ eventId }: { eventId: string }) {
  const [saved, setSaved] = useState<GuestBrandingDetail>();
  const [draft, setDraft] = useState<GuestBranding>(defaultGuestBranding);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [previewToken, setPreviewToken] = useState<string>();
  const dirty = !!saved && JSON.stringify(saved.branding) !== JSON.stringify(draft);
  async function load() {
    try { const data = await managementApi<GuestBrandingDetail>(`/events/${eventId}/branding`); setSaved(data); setDraft(data.branding); setError(""); }
    catch (error) { setError((error as Error).message); }
  }
  useEffect(() => { void load(); }, [eventId]);
  useEffect(() => { managementApi<{ token?: string }>(`/events/${eventId}/menu-preview`).then(data => setPreviewToken(data.token)).catch(() => setPreviewToken(undefined)); }, [eventId]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => { if ((event.target as HTMLElement).closest("a[href]") && !window.confirm("Discard unsaved appearance changes?")) { event.preventDefault(); event.stopPropagation(); } };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty]);
  function change<K extends keyof GuestBranding>(key: K, value: GuestBranding[K]) { setDraft(current => ({ ...current, [key]: value })); setNotice(""); }
  async function upload(file: File, kind: Asset["kind"], apply: (asset: Asset) => void) {
    setError(""); setBusy(true);
    try {
      if (file.size > (kind === "image" ? 5_000_000 : 2_000_000)) throw new Error(kind === "image" ? "Images must be under 5 MB" : "Fonts must be under 2 MB");
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("Unable to read the file")); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.readAsDataURL(file); });
      apply(await managementApi<Asset>(`/events/${eventId}/branding/assets`, { method: "POST", body: JSON.stringify({ kind, name: file.name, base64 }) })); setNotice("");
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!saved) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (draft.sponsors.some(s => !s.name.trim() || !s.logoAssetId)) throw new Error("Each sponsor needs a name and logo");
      const data = await managementApi<GuestBrandingDetail>(`/events/${eventId}/branding`, { method: "PATCH", body: JSON.stringify({ version: saved.version, branding: draft }) });
      setSaved(data); setDraft(data.branding); setNotice("Guest appearance saved");
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  function sponsorChange(id: string, values: Partial<GuestBranding["sponsors"][number]>) {
    setDraft(current => ({ ...current, sponsors: current.sponsors.map(s => s.id === id ? { ...s, ...values } : s) })); setNotice("");
  }
  function move(index: number, delta: number) {
    const sponsors = [...draft.sponsors]; [sponsors[index], sponsors[index + delta]] = [sponsors[index + delta], sponsors[index]]; change("sponsors", sponsors);
  }
  if (!saved) return <div className="py-8">{error ? <><p role="alert" className="mb-4 text-red-400">{error}</p><Button variant="outline" onClick={load}>Retry</Button></> : <p role="status">Loading appearance...</p>}</div>;
  return <div className="grid min-w-0 gap-8 py-6 xl:grid-cols-[360px_minmax(0,1fr)]">
    <form onSubmit={save} className="min-w-0">
      <fieldset disabled={busy || !saved.canEdit} className="min-w-0 space-y-7 disabled:opacity-70">
        <label className="field-label">Menu style<select className="field" value={draft.theme ?? "standard"} onChange={e => change("theme", e.target.value as GuestBranding["theme"])}><option value="standard">Standard</option><option value="night-market">Night market</option><option value="blueprint">Blueprint</option><option value="club53">Club53</option></select></label>
        <label className="field-label">Instagram link<input className="field" type="url" pattern="https://.*" value={draft.socialUrl ?? ""} onChange={e => change("socialUrl", e.target.value)} placeholder="https://www.instagram.com/" /></label>
        {previewToken && <a className="inline-block text-sm underline" href={`${process.env.NEXT_PUBLIC_GUEST_URL ?? "http://localhost:5174"}/preview/${previewToken}`} target="_blank" rel="noopener noreferrer">Open full menu preview</a>}
        <section className="border-b border-border pb-6"><h2 className="font-semibold">Colours</h2><div className="mt-4 grid grid-cols-3 gap-3">{([["backgroundColor", "Background"], ["surfaceColor", "Menu surface"], ["accentColor", "Accent"]] as const).map(([key, label]) => <label key={key} className="grid gap-2 text-xs"><span>{label}</span><input aria-label={`${label} colour`} type="color" value={draft[key]} onChange={e => change(key, e.target.value)} className="h-10 w-full cursor-pointer rounded-xs border border-border bg-transparent p-1" /><span className="font-mono text-muted-foreground">{draft[key]}</span></label>)}</div></section>
        <section className="space-y-5 border-b border-border pb-6"><h2 className="font-semibold">Images</h2>
          <AssetInput label="Header image" value={draft.headerImageId} onUpload={file => upload(file, "image", asset => change("headerImageId", asset.id))} onRemove={() => change("headerImageId", null)} />
          <AssetInput label="Background image" value={draft.backgroundImageId} onUpload={file => upload(file, "image", asset => change("backgroundImageId", asset.id))} onRemove={() => change("backgroundImageId", null)} />
          <label className="field-label">Background layout<select className="field" value={draft.backgroundMode} onChange={e => change("backgroundMode", e.target.value as GuestBranding["backgroundMode"])}><option value="cover">Cover</option><option value="tile">Tile</option></select></label>
        </section>
        <section className="space-y-5 border-b border-border pb-6"><h2 className="font-semibold">Typography</h2>
          <label className="field-label">Font family<select className="field" value={draft.fontPreset} onChange={e => change("fontPreset", e.target.value as GuestBranding["fontPreset"])} disabled={!!draft.fontAssetId}><option value="system">System sans-serif</option><option value="serif">Serif</option><option value="mono">Monospace</option></select></label>
          <AssetInput label="Custom font" kind="font" value={draft.fontAssetId} name={draft.fontName} onUpload={file => upload(file, "font", asset => setDraft(current => ({ ...current, fontAssetId: asset.id, fontName: asset.name })))} onRemove={() => { change("fontAssetId", null); change("fontName", ""); }} />
        </section>
        <section><div className="flex items-center justify-between"><h2 className="font-semibold">Sponsors</h2><Button type="button" variant="outline" size="icon" title="Add sponsor" aria-label="Add sponsor" disabled={draft.sponsors.length >= 20} onClick={() => change("sponsors", [...draft.sponsors, { id: crypto.randomUUID(), name: "", logoAssetId: "", website: "" }])}><Plus size={16} /></Button></div>
          {!draft.sponsors.length && <p className="mt-4 text-sm text-muted-foreground">No sponsors added</p>}
          <div className="divide-y divide-border">{draft.sponsors.map((sponsor, index) => <section key={sponsor.id} aria-label={`Sponsor ${index + 1}`} className="space-y-4 py-5">
            <div className="flex items-center justify-between gap-3"><h3 className="text-sm">Sponsor {index + 1}</h3><div className="flex gap-1"><Button type="button" variant="ghost" size="icon" title="Move sponsor up" aria-label="Move sponsor up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></Button><Button type="button" variant="ghost" size="icon" title="Move sponsor down" aria-label="Move sponsor down" disabled={index === draft.sponsors.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></Button><Button type="button" variant="ghost" size="icon" title="Remove sponsor" aria-label="Remove sponsor" onClick={() => change("sponsors", draft.sponsors.filter(s => s.id !== sponsor.id))}><Trash2 size={16} /></Button></div></div>
            <label className="field-label">Sponsor name<input className="field" required maxLength={100} value={sponsor.name} onChange={e => sponsorChange(sponsor.id, { name: e.target.value })} /></label>
            <AssetInput label="Sponsor logo" value={sponsor.logoAssetId || null} onUpload={file => upload(file, "image", asset => sponsorChange(sponsor.id, { logoAssetId: asset.id }))} onRemove={() => sponsorChange(sponsor.id, { logoAssetId: "" })} />
            <label className="field-label">Sponsor website<input className="field" type="url" placeholder="https://" pattern="https://.*" maxLength={500} value={sponsor.website} onChange={e => sponsorChange(sponsor.id, { website: e.target.value })} /></label>
          </section>)}</div>
        </section>
      </fieldset>
      {error && <div className="my-4"><p role="alert" className="text-sm text-red-400">{error}</p><Button className="mt-3" variant="outline" type="button" disabled={busy} onClick={() => { if (!dirty || window.confirm("Discard unsaved appearance changes?")) void load(); }}>Reload saved appearance</Button></div>}
      {notice && <p role="status" className="my-4 text-sm text-emerald-400">{notice}</p>}
      {saved.canEdit && <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5"><Button disabled={busy || !dirty}><Save size={16} />{busy ? "Saving..." : "Save appearance"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { setDraft(defaultGuestBranding()); setNotice(""); }}><RotateCcw size={16} />Reset appearance</Button></div>}
    </form>
    <section className="min-w-0 self-start xl:sticky xl:top-6"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Preview</h2><div className="flex border border-border"><Button type="button" variant={mobile ? "ghost" : "secondary"} size="icon" aria-label="Desktop preview" title="Desktop preview" aria-pressed={!mobile} onClick={() => setMobile(false)}><Monitor size={16} /></Button><Button type="button" variant={mobile ? "secondary" : "ghost"} size="icon" aria-label="Mobile preview" title="Mobile preview" aria-pressed={mobile} onClick={() => setMobile(true)}><Smartphone size={16} /></Button></div></div>
      <div className={cn("mx-auto overflow-hidden border border-border", mobile ? "max-w-[390px]" : "w-full")} aria-label="Guest appearance preview">
        <GuestBrandingFrame preview branding={{ ...draft, sponsors: draft.sponsors.filter(s => s.name && s.logoAssetId) }} assetBase={assetBase} title={saved.eventName} subtitle="Main Bar / Table 1">
          <section className="bg-card p-5"><h2 className="text-lg font-semibold">Available now</h2><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-border py-5"><div><p className="font-semibold">Still Water</p><p className="mt-1 text-sm text-muted-foreground">Drinks</p></div><span>NGN 1,500</span></div><Button type="button" className="mt-5 w-full" disabled>Send order</Button></section>
        </GuestBrandingFrame>
      </div>
    </section>
  </div>;
}

function AssetInput({ label, value, kind = "image", name, onUpload, onRemove }: {
  label: string; value: string | null; kind?: "image" | "font"; name?: string; onUpload: (file: File) => Promise<void>; onRemove: () => void;
}) {
  return <div className="min-w-0 space-y-2"><label className="grid gap-2 text-sm"><span>{label}</span><input aria-label={label} type="file" accept={kind === "font" ? ".woff,.woff2" : "image/png,image/jpeg,image/webp"} className="w-full min-w-0 text-xs file:mr-3 file:rounded-xs file:border file:border-border file:bg-secondary file:px-3 file:py-2 file:text-foreground" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void onUpload(file); }} /><span className="text-xs text-muted-foreground">{kind === "font" ? "WOFF / WOFF2, up to 2 MB" : "PNG / JPEG / WebP, up to 5 MB"}</span></label>{value && <div className="flex items-center justify-between gap-3">{kind === "image" ? <img src={`${assetBase}/${value}`} alt={label} className="h-20 min-w-0 max-w-[220px] object-contain" /> : <span className="min-w-0 break-all text-sm">{name || "Custom font"}</span>}<Button type="button" variant="outline" size="icon" aria-label={`Remove ${label.toLowerCase()}`} title={`Remove ${label.toLowerCase()}`} onClick={onRemove}><Trash2 size={16} /></Button></div>}</div>;
}
