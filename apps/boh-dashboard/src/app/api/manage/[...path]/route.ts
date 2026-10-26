import { NextRequest, NextResponse } from "next/server";
import { isOnlineWorkspace } from "../../../../lib/deployment";
import { proxyOnline } from "../../../../lib/online-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cookieName = "exa-management-session";

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || request.headers.get("sec-fetch-site") === "cross-site") return false;
  try {
    // Next may use its bind address in request.url; Host is the browser-facing authority.
    const expected = new URL(`${request.nextUrl.protocol}//${host}`);
    const actual = new URL(origin);
    return actual.origin === origin && actual.origin === expected.origin;
  } catch {
    return false;
  }
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.some(part => !/^[a-zA-Z0-9-]+$/.test(part))) return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  if (isOnlineWorkspace(request.headers.get("host") ?? "")) {
    const service = path[0] === "service" && path[2] === "api" && path.length > 3;
    return proxyOnline(request, service ? `/api/operations/${path[1]}/service/${path.slice(3).join("/")}` : `/api/${path.join("/")}`);
  }
  if (request.method !== "GET") {
    if (!isSameOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  }
  try {
    const token = request.cookies.get(cookieName)?.value;
    const service = path[0] === "service" && path[2] === "api" && path.length > 3;
    const upstreamPath = service ? `/api/${path.slice(3).join("/")}` : `/api/manage/${path.join("/")}`;
    const response = await fetch(`${process.env.HUB_INTERNAL_URL ?? "http://127.0.0.1:4000"}${upstreamPath}${request.nextUrl.search}`, {
      method: request.method, cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", ...(service ? { "X-Operation-Id": path[1] } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(request.headers.has("idempotency-key") ? { "Idempotency-Key": request.headers.get("idempotency-key")! } : {}) },
      ...(request.method !== "GET" ? { body: await request.text() } : {})
    });
    if (((path[0] === "branding-assets" && path.length === 2) || (service && path[3] === "menu-images" && path.length === 5)) && response.ok && ["image/webp", "font/woff", "font/woff2"].includes(response.headers.get("content-type") ?? "")) {
      return new NextResponse(await response.arrayBuffer(), { headers: { "Content-Type": response.headers.get("content-type")!, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
    }
    if (!response.headers.get("content-type")?.includes("application/json")) {
      return NextResponse.json({ error: response.status === 404
        ? "This endpoint is missing from the running venue hub. Restart the hub with the latest build."
        : "The venue hub returned an unexpected response. Please retry." }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    const data = await response.json();
    // Only authentication endpoints issue session tokens; preview tokens are response data.
    const authenticating = request.method === "POST" && path.length === 2 && path[0] === "auth" && (path[1] === "login" || path[1] === "setup");
    const sessionToken = authenticating ? data.token : undefined;
    if (authenticating) delete data.token;
    const result = NextResponse.json(data, { status: response.status, headers: { "Cache-Control": "no-store" } });
    if (typeof sessionToken === "string" && sessionToken && response.ok) result.cookies.set(cookieName, sessionToken, {
      httpOnly: true, sameSite: "strict", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 12 * 60 * 60
    });
    if (path.join("/") === "auth/logout" || response.status === 401) result.cookies.delete(cookieName);
    return result;
  } catch {
    return NextResponse.json({ error: "The venue hub is unavailable. Your changes have not been confirmed." }, { status: 503 });
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH };
