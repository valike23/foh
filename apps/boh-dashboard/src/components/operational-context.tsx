"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { HubSnapshot } from "@exa-foh/shared";
import { managementApi } from "../lib/management-api";

export type OperationChoice = { id: string; name: string; published: boolean; status: string; scopeType: string };
type OperationalState = { operations: OperationChoice[]; snapshot: HubSnapshot | null; selected: string; loading: boolean; error: string; refreshedAt: Date | null; select: (id: string) => void; reload: () => Promise<void> };
const Context = createContext<OperationalState | null>(null);
export function useOperations() { const value = useContext(Context); if (!value) throw new Error("Operational workspace is missing"); return value; }
export function OperationalProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname(); const params = useSearchParams(); const router = useRouter();
  const requested = params.get("operation") ?? "";
  const [operations, setOperations] = useState<OperationChoice[]>([]); const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null);
  const [selected, setSelected] = useState(""); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const latestRequest = useRef(0);
  const reload = useCallback(async () => {
    const requestId = ++latestRequest.current;
    try {
      const data = await managementApi<{ items: OperationChoice[] }>("/operations");
      const saved = requested || localStorage.getItem("exa-selected-operation") || "";
      const operation = data.items.find(v => v.id === saved && v.published) ?? data.items.find(v => v.published && v.status === "live") ?? data.items.find(v => v.published);
      const nextSnapshot = operation ? await managementApi<HubSnapshot>(`/service/${operation.id}/api/snapshot`) : null;
      if (requestId !== latestRequest.current) return;
      setOperations(data.items);
      setSelected(operation?.id ?? "");
      setSnapshot(nextSnapshot);
      setRefreshedAt(new Date()); setError("");
    } catch (error) { if (requestId === latestRequest.current) setError((error as Error).message); }
    finally { if (requestId === latestRequest.current) setLoading(false); }
  }, [requested]);
  useEffect(() => { void reload(); const timer = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, 12000); return () => { latestRequest.current++; clearInterval(timer); }; }, [reload]);
  function select(id: string) { localStorage.setItem("exa-selected-operation", id); setSnapshot(null); setLoading(true); const query = new URLSearchParams(params.toString()); query.set("operation", id); router.replace(`${pathname}?${query}`); }
  return <Context.Provider value={{ operations, snapshot, selected, loading, error, refreshedAt, select, reload }}>{children}</Context.Provider>;
}
