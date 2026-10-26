import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { NextRequest, NextResponse } from "next/server";

// Connect to the private API address while retaining the browser's tenant Host.
// Node fetch can replace Host with the upstream URL's authority.
export async function proxyOnline(request: NextRequest, path: string) {
  const host = request.headers.get("host") ?? "";
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin !== `${request.nextUrl.protocol}//${host}` || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && Buffer.byteLength(body) > 1_000_000) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  const upstream = new URL(process.env.ONLINE_INTERNAL_URL ?? "http://127.0.0.1:4200");
  upstream.pathname = path; upstream.search = request.nextUrl.search;
  try {
    const result = await new Promise<{ status: number; body: Buffer; cookies: string[] }>((resolve, reject) => {
      const send = upstream.protocol === "https:" ? httpsRequest : httpRequest;
      const req = send(upstream, { method: request.method, headers: { Host: host, "Content-Type": "application/json", ...(body ? { "Content-Length": String(Buffer.byteLength(body)) } : {}), ...(request.headers.get("cookie") ? { Cookie: request.headers.get("cookie")! } : {}), ...(request.headers.get("origin") ? { Origin: request.headers.get("origin")! } : {}), ...(request.headers.get("sec-fetch-site") ? { "Sec-Fetch-Site": request.headers.get("sec-fetch-site")! } : {}) } }, res => {
        const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(chunk)); res.on("error", reject);
        res.on("end", () => resolve({ status: res.statusCode ?? 502, body: Buffer.concat(chunks), cookies: res.headers["set-cookie"] ?? [] }));
      });
      req.setTimeout(15_000, () => req.destroy(new Error("Online API timeout"))); req.on("error", reject); req.end(body);
    });
    const response = new NextResponse(result.body.toString("utf8"), { status: result.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    result.cookies.forEach(cookie => response.headers.append("Set-Cookie", cookie));
    return response;
  } catch { return NextResponse.json({ error: "The online service is unavailable. Please retry." }, { status: 503 }); }
}
