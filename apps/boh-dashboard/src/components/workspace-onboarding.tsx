"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, Store, ArrowRight, Check, Plus, X } from "lucide-react";
import { Button } from "@exa-foh/ui";
import { managementApi } from "../lib/management-api";
import { useOnlineWorkspace } from "./deployment-context";
import { useManagementUser } from "./management-shell";

type Answers = {
  mode?: "location" | "organiser" | "vendor";
  businessType: "restaurant" | "hotel" | "lounge" | "eatery" | "other";
  name: string; address: string; timezone: string; startsAt: string; endsAt: string;
  sections: { name: string; tables: number }[]; storefronts: string[];
};
export type OnboardingState = { status: "in-progress" | "completed"; required: boolean; step: number; version: number; answers: Answers; scopeType?: string; scopeId?: string; storefrontIds?: string[] };
const choices = [
  { mode: "location" as const, icon: Building2, title: "A physical location", text: "Run a restaurant, hotel, lounge, eatery, or another branch." },
  { mode: "organiser" as const, icon: CalendarDays, title: "An event I organise", text: "Set up an event, then add the vendors taking part." },
  { mode: "vendor" as const, icon: Store, title: "My business at an event", text: "Create a private event entry and your own selling points." },
];
const inputClass = "mt-2 w-full rounded-lg border border-border bg-background px-3 py-3 text-sm";
const steps = ["Your business", "The basics", "Your layout", "Review"];
function localDate(value: string) { if (!value) return ""; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }

export function WorkspaceOnboarding({ onClose }: { onClose?: () => void } = {}) {
  const online = useOnlineWorkspace(), user = useManagementUser(), router = useRouter();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [step, setStep] = useState(0), [error, setError] = useState(""), [saving, setSaving] = useState(false), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const version = useRef(0), queue = useRef<Promise<unknown>>(Promise.resolve()), timer = useRef<ReturnType<typeof setTimeout> | null>(null), dirty = useRef(false), mounted = useRef(true);
  const generation = useRef(0), latest = useRef<{ answers: Answers | null; step: number }>({ answers: null, step: 0 });
  latest.current = { answers, step };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); if (dirty.current && latest.current.answers) void persist(latest.current.answers, latest.current.step).catch(() => {}); }; }, []);
  async function load() {
    setError("");
    try { const result = await managementApi<OnboardingState>("/onboarding"); version.current = result.version; setState(result); setAnswers(result.answers); setStep(result.step); setSaved(result.version > 0); dirty.current = false; }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { if (online && user?.role === "owner") void load(); }, [online, user?.id]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function persist(value: Answers, nextStep: number, paused = false) {
    const savedGeneration = generation.current;
    if (timer.current) clearTimeout(timer.current);
    setSaving(true); setSaved(false);
    const task = queue.current.catch(() => {}).then(async () => {
      const result = await managementApi<OnboardingState>("/onboarding", { method: "PATCH", body: JSON.stringify({ version: version.current, step: nextStep, answers: value, paused }) });
      version.current = result.version;
      if (mounted.current) { setState(result); setError(""); }
      return result;
    });
    queue.current = task;
    void task.then(() => { if (queue.current === task && generation.current === savedGeneration) { dirty.current = false; if (mounted.current) { setSaving(false); setSaved(true); } } }, e => { if (mounted.current) { setSaving(false); setError((e as Error).message); } });
    return task;
  }
  function change(value: Answers) {
    generation.current++;
    setAnswers(value); setSaved(false); dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist(value, step).catch(() => {}); }, 650);
  }
  function validate() {
    if (!answers) return "";
    if (step === 0 && !answers.mode) return "Choose what you want to manage.";
    if (step === 1) {
      if (answers.name.trim().length < 2) return "Please enter a name with at least two characters.";
      if (answers.mode !== "location" && (!answers.address.trim() || !answers.startsAt || !answers.endsAt || Date.parse(answers.endsAt) <= Date.parse(answers.startsAt))) return "Enter the event location and an end time after its start.";
    }
    if (step === 2) {
      if (answers.mode === "location" && !answers.sections.length) return "Add at least one section. Main dining is a good place to start.";
      if (answers.mode === "vendor" && !answers.storefronts.length) return "Add at least one selling point.";
      if (answers.sections.some(s => s.name.trim().length < 2) || answers.storefronts.some(name => name.trim().length < 2)) return "Give each section and selling point a name with at least two characters.";
    }
    return "";
  }
  async function move(nextStep: number) {
    if (!answers) return;
    const problem = nextStep > step ? validate() : "";
    if (problem) { setError(problem); return; }
    setBusy(true);
    try { await persist(answers, nextStep); setStep(nextStep); } catch {} finally { setBusy(false); }
  }
  async function exit() {
    if (!answers) return;
    setBusy(true); try { await persist(answers, step, true); if (onClose) onClose(); else router.push("/dashboard"); } catch {} finally { setBusy(false); }
  }
  async function complete() {
    if (!answers) return;
    setBusy(true);
    try { await persist(answers, step); const result = await managementApi<OnboardingState>("/onboarding/complete", { method: "POST", body: JSON.stringify({ version: version.current }) }); dirty.current = false; setState(result); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!online) return <p>Guided setup is available in the online workspace.</p>;
  if (user?.role !== "owner") return <p>Your business owner manages workspace setup.</p>;
  if (!state || !answers) return <div role="status">{error ? <><p role="alert">{error}</p><Button onClick={load}>Retry</Button></> : "Loading your saved setup…"}</div>;
  if (state.status === "completed") return <section onClick={event => { if ((event.target as HTMLElement).closest("a")) onClose?.(); }} className="mx-auto max-w-2xl space-y-6 py-10"><Check className="text-emerald-400" size={36} /><h1 className="text-3xl font-semibold">Your starting setup is ready</h1><p className="text-muted-foreground">We created {answers.mode === "location" ? "your location, sections, tables, and a selling point for orders" : answers.mode === "vendor" ? "your private event entry and storefronts" : "your event"}. Service is closed until you finish preparing and open it.</p><div className="flex flex-wrap gap-3"><Link className="underline" href={`/${state.scopeType === "venue" ? "venues" : "events"}/${state.scopeId}`}>Review {state.scopeType === "venue" ? "location" : "event"}</Link><Link className="underline" href={answers.mode === "organiser" ? "/vendors" : "/operations"}>{answers.mode === "organiser" ? "Add participating vendors" : "Continue to service setup"}</Link><Link className="underline" href="/settings/account">Add your team</Link><Link className="underline" href="/dashboard">Go to dashboard</Link></div><p className="text-sm text-muted-foreground">Next: {answers.mode === "organiser" ? "add vendors and storefronts, then " : ""}publish your setup in Service operations, add menu items and opening stock in Stock, then open service when you are ready.</p></section>;
  const location = answers.mode === "location";
  return <section className="mx-auto max-w-3xl space-y-7 pb-12">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">Let’s get you ready</p><h1 className="mt-2 text-3xl font-semibold">A few questions. Your setup, sorted.</h1><p className="mt-3 max-w-xl text-sm text-muted-foreground">Start with one location or event. You can add more later. Save and leave whenever you need to.</p></div><Button data-onboarding-exit variant="outline" onClick={exit} disabled={busy}>Save & finish later</Button></div>
    <ol aria-label="Setup progress" className="grid grid-cols-4 gap-2">{steps.map((title, n) => <li key={title} aria-current={step === n ? "step" : undefined} className={`border-t-2 pt-3 text-xs sm:text-sm ${n <= step ? "border-primary" : "border-border text-muted-foreground"}`}>{n + 1}. {title}</li>)}</ol>
    <div className="min-h-72 rounded-xl border border-border bg-card p-5 sm:p-7">
      <fieldset disabled={busy} className="space-y-5">
      {step === 0 && <><legend className="text-xl font-semibold">What would you like to manage first?</legend><p className="text-sm text-muted-foreground">This helps us ask the right questions. You can set up another type later.</p><div className="grid gap-3">{choices.map(c => <button key={c.mode} type="button" aria-pressed={answers.mode === c.mode} onClick={() => change({ ...answers, mode: c.mode, sections: c.mode === "location" ? [{ name: "Main dining", tables: 0 }] : [], storefronts: c.mode === "vendor" ? ["My stand"] : [] })} className={`flex items-start gap-4 rounded-xl border p-5 text-left ${answers.mode === c.mode ? "border-primary bg-primary/10" : "border-border hover:bg-secondary"}`}><c.icon className="mt-1 shrink-0" /><span><strong className="block">{c.title}</strong><span className="mt-1 block text-sm text-muted-foreground">{c.text}</span></span></button>)}</div></>}
      {step === 1 && <><legend className="text-xl font-semibold">{location ? "Tell us about your first location" : "Tell us about the event"}</legend>{answers.mode === "vendor" && <p className="rounded-lg bg-secondary p-3 text-sm">This is a private entry for your business. It does not make you the event organiser or give you access to other vendors.</p>}{location && <label className="block text-sm">What kind of place is it?<select className={inputClass} value={answers.businessType} onChange={e => change({ ...answers, businessType: e.target.value as Answers["businessType"] })}>{["restaurant", "hotel", "lounge", "eatery", "other"].map(type => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></label>}<label className="block text-sm">{location ? "What is this branch or location called?" : "What is the event called?"}<input className={inputClass} value={answers.name} maxLength={100} placeholder={location ? "e.g. Lekki branch" : "e.g. Summer food festival"} onChange={e => change({ ...answers, name: e.target.value })} /></label><label className="block text-sm">{location ? "Where is it? (optional)" : "Where is the event?"}<input className={inputClass} value={answers.address} maxLength={240} onChange={e => change({ ...answers, address: e.target.value })} /></label>{!location && <div className="grid gap-4 sm:grid-cols-2">{(["startsAt", "endsAt"] as const).map(key => <label key={key} className="block text-sm">{key === "startsAt" ? "When does it start?" : "When does it end?"}<input type="datetime-local" className={inputClass} value={localDate(answers[key])} onChange={e => change({ ...answers, [key]: e.target.value ? new Date(e.target.value).toISOString() : "" })} /></label>)}</div>}<label className="block text-sm">Time zone<select className={inputClass} value={answers.timezone} onChange={e => change({ ...answers, timezone: e.target.value })}>{Array.from(new Set([answers.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone, "Africa/Lagos", "Africa/Accra", "Africa/Nairobi", "Europe/London", "UTC"])).map(zone => <option key={zone}>{zone}</option>)}</select></label>{!location && <p className="text-xs text-muted-foreground">Event times above use your device’s time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). The event time zone controls reporting.</p>}</>}
      {step === 2 && <><legend className="text-xl font-semibold">{location ? "How is your space arranged?" : answers.mode === "vendor" ? "Where will you sell?" : "You’re ready to set up your event"}</legend>{answers.mode === "organiser" ? <p className="text-muted-foreground">We’ll create the event first. You can then add participating vendors and their storefronts. You don’t need to invent their details now.</p> : <>{!location && <><p className="text-sm text-muted-foreground">A storefront is one selling point, such as a food stand or drinks bar.</p>{answers.storefronts.map((name, index) => <div key={index} className="flex items-center gap-2"><label className="flex-1 text-sm">Selling point {index + 1}<input className={inputClass} maxLength={100} value={name} onChange={e => change({ ...answers, storefronts: answers.storefronts.map((v, n) => n === index ? e.target.value : v) })} /></label><Button variant="ghost" size="icon" aria-label={`Remove selling point ${index + 1}`} onClick={() => change({ ...answers, storefronts: answers.storefronts.filter((_, n) => n !== index) })}><X size={16} /></Button></div>)}<Button variant="outline" disabled={answers.storefronts.length >= 20} onClick={() => change({ ...answers, storefronts: [...answers.storefronts, `Stand ${answers.storefronts.length + 1}`] })}><Plus size={16} />Add selling point</Button></>}<p className="text-sm text-muted-foreground">{location ? "Name your sections, such as Main dining, Terrace, or Lounge." : "Have a seating area? Add sections and tables below, or leave this empty."} Tables are optional; you can add them later. We’ll start each table with four seats of capacity.</p>{answers.sections.map((section, index) => <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4" key={index}><label className="min-w-40 flex-1 text-sm">Section name<input className={inputClass} maxLength={100} value={section.name} onChange={e => change({ ...answers, sections: answers.sections.map((v, n) => n === index ? { ...v, name: e.target.value } : v) })} /></label><label className="w-24 text-sm">Tables<input className={inputClass} type="number" min={0} max={50} value={section.tables} onChange={e => change({ ...answers, sections: answers.sections.map((v, n) => n === index ? { ...v, tables: Number(e.target.value) } : v) })} /></label><Button variant="ghost" size="icon" aria-label={`Remove section ${index + 1}`} onClick={() => change({ ...answers, sections: answers.sections.filter((_, n) => n !== index) })}><X size={16} /></Button></div>)}<Button variant="outline" disabled={answers.sections.length >= 20} onClick={() => change({ ...answers, sections: [...answers.sections, { name: `Section ${answers.sections.length + 1}`, tables: 0 }] })}><Plus size={16} />Add section</Button>{!location && answers.storefronts.length > 1 && <p className="text-xs text-muted-foreground">Tables initially belong to your first selling point. You can change their assignments in Sections.</p>}</>}</>}
      {step === 3 && <><legend className="text-xl font-semibold">Here’s what we’ll create for you</legend><div className="space-y-4"><div><p className="text-xs text-muted-foreground">{location ? "Location" : answers.mode === "vendor" ? "Private event entry" : "Event"}</p><p className="mt-1 font-medium">{answers.name}</p><p className="text-sm text-muted-foreground">{answers.address || "Address can be added later"}</p></div>{location && <p className="text-sm">A selling point named {answers.name} will handle orders for this location.</p>}{answers.storefronts.length > 0 && <p className="text-sm">Selling points: {answers.storefronts.join(", ")}</p>}{answers.sections.length > 0 && <ul className="space-y-2 text-sm">{answers.sections.map((section, n) => <li key={n}>{section.name} · {section.tables} tables</li>)}</ul>}<p className="rounded-lg bg-secondary p-4 text-sm">Your answers have been saved. Creating this setup adds real records to your workspace. It won’t open service or start accepting orders.</p><p className="text-sm text-muted-foreground">After this, you can add menus, opening stock, and staff. Separate or shared menu configuration is not part of this setup yet.</p></div></>}
      </fieldset>
    </div>
    {error && <div role="alert" className="rounded-lg border border-red-400/40 p-4 text-sm text-red-400">{error}<button className="ml-3 underline" onClick={load}>Reload saved setup</button></div>}
    <div className="flex flex-wrap items-center justify-between gap-4"><span role="status" className="text-xs text-muted-foreground">{saving ? "Saving your progress…" : saved ? "Progress saved to your workspace" : "Your answers will be saved as you go"}</span><div className="flex gap-3">{step > 0 && <Button variant="outline" onClick={() => move(step - 1)} disabled={busy}>Back</Button>}{step < 3 ? <Button onClick={() => move(step + 1)} disabled={busy}>Continue<ArrowRight size={16} /></Button> : <Button onClick={complete} disabled={busy}>{busy ? "Creating your setup…" : "Create my setup"}<Check size={16} /></Button>}</div></div>
  </section>;
}
