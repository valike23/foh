export class ApiError extends Error {
  constructor(message: string, public status: number, public fields: Record<string, string[]> = {}) { super(message); }
}
export async function managementApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/manage${path}`, { ...options, headers: { "Content-Type": "application/json", ...options.headers }, cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error ?? "Request failed", response.status, body.fields);
  return body;
}
