"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Eye, EyeOff, Layers3, LoaderCircle, Palette, ShieldCheck, Upload, X } from "lucide-react";
import { Button } from "@exa-foh/ui";
import { managementApi } from "../lib/management-api";
import { brandPresets, tenantBrandStyle, type TenantBrand } from "../lib/tenant-branding";
import { useOnlineWorkspace, useSingleHostWorkspace } from "./deployment-context";
import "./tenant-auth.css";

export function OnlineAuth({ signup = false }: { signup?: boolean }) {
  const router = useRouter(); const online = useOnlineWorkspace(); const singleHost = useSingleHostWorkspace(); const params = useSearchParams();
  const selectedWorkspace = params.get("workspace"); const centralRequested = signup || params.get("central") === "1";
  const [tenant, setTenant] = useState<TenantBrand | null>(null);
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [workspace, setWorkspace] = useState("");
  const [destination, setDestination] = useState(""); const [organizationName, setOrganizationName] = useState("");
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [brandLogo, setBrandLogo] = useState<string | null>(null);
  const [logoName, setLogoName] = useState(""); const [uploading, setUploading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null); const logoRead = useRef(0);
  useEffect(() => {
    if (!online) { router.replace("/login"); return; }
    let active = true;
    const query = singleHost ? centralRequested ? "?central=1" : selectedWorkspace ? `?workspace=${encodeURIComponent(selectedWorkspace)}` : "" : "";
    managementApi<{ tenant: TenantBrand | null }>(`/tenant${query}`).then(value => {
      if (!active) return;
      if (signup && value.tenant) { router.replace("/login"); return; }
      setTenant(value.tenant); setReady(true);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; logoRead.current++; };
  }, [online, router, signup, singleHost, selectedWorkspace, centralRequested]);

  async function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    const readId = ++logoRead.current; setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 512 * 1024) {
      setUploading(false); setError("Choose a PNG, JPEG or WebP logo up to 512 KB."); event.target.value = ""; return;
    }
    setUploading(true);
    try {
      const value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("We couldn’t read that logo. Please try another image.")); reader.readAsDataURL(file);
      });
      if (readId === logoRead.current) { setBrandLogo(value); setLogoName(file.name); }
    } catch (error) { if (readId === logoRead.current) setError((error as Error).message); }
    finally { if (readId === logoRead.current) setUploading(false); }
  }
  function removeLogo() { logoRead.current++; setUploading(false); setBrandLogo(null); setLogoName(""); if (fileInput.current) fileInput.current.value = ""; }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      if (signup) {
        const result = await managementApi<{ workspaceUrl: string; loginUrl?: string }>("/auth/signup", {
          method: "POST", body: JSON.stringify({ ...data, ...(brandColor ? { brandColor } : {}), ...(brandLogo ? { brandLogo } : {}) })
        });
        setDestination(result.loginUrl ?? `${result.workspaceUrl}/login`);
      } else {
        await managementApi(`/auth/login${singleHost && selectedWorkspace ? `?workspace=${encodeURIComponent(selectedWorkspace)}` : ""}`, { method: "POST", body: JSON.stringify(data) });
        const next = new URLSearchParams(window.location.search).get("next") ?? "/dashboard";
        router.replace(/^\/((dashboard|venues|events|vendors|storefronts|floor|operations|service|overview|sales|payments|orders|stock|floor-control)(?:\/|\?|$)|settings\/account$)/.test(next) ? next : "/dashboard"); router.refresh();
      }
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  function openWorkspace(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!/^[a-z][a-z0-9-]{1,46}[a-z0-9]$/.test(workspace)) { setError("Enter your workspace subdomain, for example gwx."); return; }
    const destination = new URL(window.location.href);
    if (singleHost) { destination.pathname = "/login"; destination.search = ""; destination.searchParams.set("workspace", workspace); window.location.assign(destination); return; }
    destination.hostname = `${workspace}.${window.location.hostname.replace(/^app\./, "")}`;
    destination.pathname = "/login"; destination.search = ""; window.location.assign(destination);
  }
  const color = signup ? brandColor : tenant?.brandColor;
  const logo = signup ? brandLogo : tenant?.brandLogo;
  const name = signup ? organizationName || "Your business" : tenant?.name ?? "EXA Hospitality";
  const central = ready && !signup && !tenant;
  if (!ready && !error) return <main className="tenant-auth-loading" role="status"><LoaderCircle size={20} /><span>Loading your workspace…</span></main>;
  return <main className="management tenant-auth" style={tenantBrandStyle(color)}>
    <section className="tenant-auth-story" aria-label="Workspace branding">
      <Link href="/" className="tenant-auth-platform"><Image src="/exa-icon.svg" alt="EXA" width={28} height={28} /><strong>EXA</strong><span>Front of house, connected.</span></Link>
      <div className="tenant-auth-editorial">
        <p className="tenant-auth-eyebrow"><span />{signup ? "MAKE ROOM FOR WHAT’S NEXT" : "YOUR TEAM. YOUR SPACE."}</p>
        <h2>{signup ? <>Great service.<br />Your signature.</> : <>A familiar place.<br />A fresh start.</>}</h2>
        <p className="tenant-auth-intro">{signup ? "One home for your venues, your people, and every service worth remembering." : "Everything you need to bring your next service together. Welcome back."}</p>
        <div className="tenant-identity-preview">
          <div className="tenant-preview-top"><span><Layers3 size={13} />{signup ? "YOUR WORKSPACE" : "YOUR ORGANIZATION"}</span><i><span />Connected</i></div>
          <div className="tenant-preview-identity"><span className="tenant-logo-stage">{logo ? <img src={logo} alt={signup ? "Your logo preview" : `${name} logo`} width={46} height={46} /> : <Image src="/exa-icon.svg" alt="EXA default logo" width={42} height={42} />}</span><div><strong>{name}</strong><span>Front of house</span></div><ArrowUpRight size={20} /></div>
          <div className="tenant-preview-links"><span className="active">Venues</span><span>Events</span><span>Operations</span></div>
        </div>
        <div className="tenant-auth-benefits"><span><Check size={14} />Your team in one place</span><span><Check size={14} />Ready for every service</span></div>
      </div>
      <footer className="tenant-auth-story-footer"><span>Made for the way hospitality moves.</span><span>EXA Hospitality</span></footer>
    </section>
    <section className="tenant-auth-form-panel">
      <div className="tenant-auth-form-wrap">
        <div className="tenant-auth-form-brand">{logo ? <img src={logo} alt={`${name} logo`} width={36} height={36} /> : <Image src="/exa-icon.svg" alt="EXA" width={32} height={32} />}<span>{tenant?.name ?? "EXA Hospitality"}</span></div>
        <p className="tenant-auth-step">{destination ? "YOU’RE ALL SET" : signup ? "YOUR NEXT CHAPTER" : "GOOD TO SEE YOU"}</p>
        <h1>{destination ? "Your workspace is ready" : signup ? "Create your workspace" : central ? "Find your workspace" : "Welcome back"}</h1>
        <p className="tenant-auth-description">{destination ? "Your business now has a home on EXA. Open your workspace to sign in and get started." : signup ? "Start with your business. Make it yours as you go." : central ? "Enter your organization’s workspace name to sign in." : <>Sign in to <strong>{name}</strong> and pick up where you left off.</>}</p>
        {destination ? <div className="tenant-auth-success"><span><Check size={24} /></span><p>{organizationName || "Your organization"} is ready for its first great service.</p><Button asChild><a href={destination}>Open workspace<ArrowRight size={16} /></a></Button></div> : central ? <form className="tenant-auth-fields" onSubmit={openWorkspace}>
          <label className="field-label">Workspace name<input className="field" value={workspace} onChange={e => setWorkspace(e.target.value)} placeholder="gwx" required autoComplete="organization" /></label>
          <Button className="tenant-auth-submit">Continue<ArrowRight size={16} /></Button><p className="tenant-auth-switch">New to EXA? <Link href="/signup">Create a workspace</Link></p>
        </form> : <form className="tenant-auth-fields" onSubmit={submit}>
          <fieldset disabled={busy}>
            {signup && <><label className="field-label">Organization name<input name="organizationName" className="field" placeholder="Your business name" autoComplete="organization" required minLength={2} maxLength={100} value={organizationName} onChange={e => setOrganizationName(e.target.value)} /></label><label className="field-label">{singleHost ? "Workspace name" : "Workspace subdomain"}<input name="slug" className="field" placeholder="e.g. gwx" required pattern="[a-z][a-z0-9-]{1,46}[a-z0-9]" minLength={3} maxLength={48} autoComplete="off" /><span className="tenant-auth-hint">Your unique workspace address. Lowercase letters, numbers and hyphens.</span></label><label className="field-label">Full name<input name="name" className="field" placeholder="Your full name" autoComplete="name" required minLength={2} maxLength={100} /></label></>}
            <label className="field-label">Email<input name="email" type="email" className="field" placeholder="you@yourbusiness.com" autoComplete="username" required maxLength={254} /></label>
            <label className="field-label">Password<span className="tenant-password-field"><input name="password" type={showPassword ? "text" : "password"} className="field" placeholder={signup ? "Create a strong password" : "Enter your password"} autoComplete={signup ? "new-password" : "current-password"} minLength={12} maxLength={128} required /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
            {signup && <><p className="tenant-auth-hint">Use at least 12 characters for your password.</p><details className="tenant-branding-options"><summary><span><Palette size={17} /><span>Make it yours <small>Optional branding</small></span></span><ChevronDown size={15} /></summary><div className="tenant-branding-body"><p>A little you, everywhere. Preview your login and workspace branding on the left.</p>
              <div className="tenant-colour-heading"><strong>Brand colour</strong><button type="button" onClick={() => setBrandColor(null)}>Use default</button></div>
              <div className="tenant-colour-presets" role="group" aria-label="Brand colour presets">{brandPresets.map(preset => <button key={preset.name} type="button" aria-label={preset.name} aria-pressed={brandColor === preset.color} style={{ backgroundColor: preset.color }} onClick={() => setBrandColor(preset.color)}>{brandColor === preset.color && <Check size={15} />}</button>)}</div>
              <div className="tenant-colour-custom"><input type="color" aria-label="Pick a custom colour" value={brandColor && /^#[a-f0-9]{6}$/i.test(brandColor) ? brandColor : "#8b5cf6"} onChange={e => setBrandColor(e.target.value)} /><label>Brand colour<input type="text" aria-label="Brand colour" value={brandColor ?? ""} placeholder="Default EXA colour" maxLength={7} pattern="#[0-9a-fA-F]{6}" onChange={e => setBrandColor(e.target.value || null)} /></label></div>
              <div className="tenant-logo-heading"><strong>Business logo</strong><span>Optional</span></div><div className="tenant-logo-upload"><span className="tenant-upload-preview">{brandLogo ? <img src={brandLogo} alt="Uploaded logo" width={40} height={40} /> : <Upload size={20} />}</span><div><button type="button" onClick={() => fileInput.current?.click()}>{uploading ? "Reading logo…" : brandLogo ? "Replace logo" : "Upload a logo"}</button><span>{logoName || "PNG, JPEG or WebP · up to 512 KB"}</span></div>{brandLogo && <button type="button" className="tenant-remove-logo" aria-label="Remove logo" onClick={removeLogo}><X size={15} /></button>}</div>
              <input ref={fileInput} className="sr-only" type="file" aria-label="Business logo" accept="image/png,image/jpeg,image/webp" onChange={chooseLogo} />
              <p className="tenant-branding-defaults">No colour or logo? We’ll use the EXA defaults. You can start right away.</p>
            </div></details></>}
            <Button className="tenant-auth-submit" disabled={busy || !ready || uploading}>{busy ? "Please wait…" : signup ? "Create workspace" : "Sign in"}<ArrowRight size={16} /></Button>
          </fieldset>
          {signup ? <p className="tenant-auth-switch">Already have a workspace? <Link href="/login">Sign in</Link></p> : <><p className="tenant-auth-help"><ShieldCheck size={13} />Your organization’s secure workspace</p>{singleHost && <p className="tenant-auth-switch"><Link href="/login?central=1">Switch workspace</Link></p>}</>}
        </form>}
        {error && <p role="alert" className="tenant-auth-error">{error}</p>}
        <footer className="tenant-auth-form-footer">Powered by EXA <span>Built for your business.</span></footer>
      </div>
    </section>
  </main>;
}
