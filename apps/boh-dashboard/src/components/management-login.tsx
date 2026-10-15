"use client";
import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound } from "lucide-react";
import { Button } from "@exa-foh/ui";
import { ApiError, managementApi } from "../lib/management-api";

export function ManagementLogin() {
  const router = useRouter();
  const [setup, setSetup] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { managementApi<{ needsSetup: boolean }>("/auth/status").then(result => setSetup(result.needsSetup)).catch(error => setError(error.message)); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (typeof data.setupKey === "string") data.setupKey = data.setupKey.trim();
    try {
      await managementApi(`/auth/${setup ? "setup" : "login"}`, { method: "POST", body: JSON.stringify(data) });
      const target = new URLSearchParams(window.location.search).get("next") ?? "/venues";
      router.replace(/^\/((venues|events|vendors|storefronts|floor|operations|service)(?:\/|\?|$)|settings\/account$)/.test(target) ? target : "/venues");
    } catch (error) {
      setError(error instanceof ApiError && Object.keys(error.fields).length ? Object.entries(error.fields).map(([field, errors]) => `${field}: ${errors.join(", ")}`).join(". ") : (error as Error).message);
    } finally { setBusy(false); }
  }
  return <main className="management grid min-h-screen place-items-center p-6"><div className="w-full max-w-sm">
    <Image src="/exa-icon.svg" alt="EXA" width={42} height={42} /><p className="mt-6 text-sm text-muted-foreground">EXA Front of House</p><h1 className="mt-2 text-2xl font-semibold">{setup ? "Create your owner account" : "Welcome back"}</h1>
    <form className="mt-8 space-y-5" onSubmit={submit}>
      {setup && <><label className="field-label">Full name<input className="field" name="name" autoComplete="name" required minLength={2} maxLength={100} /></label><label className="field-label">Setup key<input className="field" name="setupKey" type="password" autoComplete="off" required /></label></>}
      <label className="field-label">Email<input className="field" type="email" name="email" autoComplete="username" required /></label>
      <label className="field-label">Password<input className="field" type="password" name="password" autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 12 : 1} maxLength={128} required /></label>
      {setup && <p className="text-xs text-muted-foreground">Minimum 12 characters</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <Button className="w-full" disabled={busy || setup === null}>{busy ? "Please wait..." : setup ? "Create account" : "Sign in"}<ArrowRight /></Button>
    </form><div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground"><KeyRound size={14} />Management access</div>
  </div></main>;
}
