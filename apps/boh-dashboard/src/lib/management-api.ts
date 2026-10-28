export class ApiError extends Error {
  constructor(message: string, public status: number, public fields: Record<string, string[]> = {}, public action?: { label: string; href: string }) { super(message); }
}
export const isTemporaryApiError = (error: unknown) => error instanceof ApiError ? error.status >= 500 : error instanceof TypeError;
let redirectingToLogin = false;
export async function managementApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/manage${path}`, { ...options, headers: { "Content-Type": "application/json", ...options.headers }, cache: "no-store" });
  if (response.status === 401 && typeof window !== "undefined" && !["/login", "/signup"].includes(window.location.pathname) && !["/auth/login", "/auth/signup", "/auth/setup"].includes(path) && !redirectingToLogin) {
    redirectingToLogin = true;
    const next = window.location.pathname + window.location.search;
    window.location.replace(`/login?next=${encodeURIComponent(next)}`);
  }
  const body = await response.json().catch(() => { if (response.ok) throw new Error("Invalid server response"); return {}; });
  if (!response.ok) throw new ApiError(body.error ?? "Request failed", response.status, body.fields, body.action && typeof body.action.label === "string" && typeof body.action.href === "string" && /^\/(operations|floor|storefronts|venues|events|vendors)(\/|\?|$)/.test(body.action.href) ? body.action : undefined);
  return body;
}
