const key = "exa-guest-browser-id";
let memoryId: string | undefined;
const valid = (v: string | null): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

// First-party random identity only: no hardware fingerprint or contact data.
export function guestBrowserId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  for (const kind of ["localStorage", "sessionStorage"] as const) {
    try {
      const storage = window[kind]; const saved = storage.getItem(key);
      if (valid(saved)) { memoryId = saved; return saved; }
      memoryId ??= window.crypto.randomUUID(); storage.setItem(key, memoryId); return memoryId;
    } catch { /* Storage may be blocked; continue without interrupting checkout. */ }
  }
  try { memoryId ??= window.crypto.randomUUID(); return memoryId; } catch { return undefined; }
}
