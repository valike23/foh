import express, { type Request, type Response, type NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { networkInterfaces, hostname } from "node:os";
import { z } from "zod";
import { createWorkspaceApi } from "../../cloud/src/workspace-api.js";
import { WorkspaceError, type Identity } from "../../cloud/src/workspace-access.js";
import { LocalStore, type Bundle } from "./store.js";
import { SyncWorker, remoteCall, type Connection, type RemoteCall } from "./sync.js";

export function createOfflineApp(store: LocalStore, options: { call?: RemoteCall; allowedHosts?: string[] } = {}) {
  const app = express(), call = options.call ?? remoteCall, worker = new SyncWorker(store, call);
  const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]", hostname().toLowerCase(), `${hostname().toLowerCase()}.local`, ...Object.values(networkInterfaces()).flatMap(n => n?.map(a => a.address.toLowerCase()) ?? []), ...(options.allowedHosts ?? [])]);
  app.disable("x-powered-by"); app.use(express.json({ limit: "1mb" }));
  const run = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void fn(req, res).catch(next);
  app.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    const host = req.headers.host?.replace(/:\d+$/, "").toLowerCase();
    if (!host || !allowedHosts.has(host)) { res.status(400).json({ error: "Use this hub's local address" }); return; }
    if (!["GET", "HEAD"].includes(req.method)) {
      const origin = req.headers.origin;
      if (!origin || !["http:", "https:"].some(protocol => origin === `${protocol}//${req.headers.host}`) || req.headers["sec-fetch-site"] === "cross-site") { res.status(403).json({ error: "Request origin is not allowed" }); return; }
      if (!req.is("application/json")) { res.status(415).json({ error: "JSON required" }); return; }
    }
    if (req.path.startsWith("/api/pos/")) { res.locals.pos = true; req.url = req.url.replace(/^\/api\/pos\//, "/api/"); }
    next();
  });
  // One SQLite connection: serialize API access across every browser and sync acknowledgement.
  app.use((req, res, next) => {
    if (["/api/offline/connect", "/api/offline/activate", "/api/sync/run", "/api/sync/release"].includes(req.path)) { next(); return; }
    void store.exclusive(() => new Promise<void>(resolve => { res.once("finish", resolve); res.once("close", resolve); next(); }));
  });
  app.get("/health", (_req, res) => res.json({ ok: true, persistence: "sqlite", configured: !!store.meta("connection"), instanceId: process.env.OFFLINE_INSTANCE_ID }));
  app.get("/api/offline/status", (_req, res) => res.json({ configured: !!store.meta("connection"), released: !!store.meta("released"), addresses: [...allowedHosts].filter(h => !h.includes(":" )).map(h => `http://${h}:${process.env.OFFLINE_UI_PORT ?? 5380}`) }));
  function setup(req: Request) {
    const value = req.body.setupKey;
    if (typeof value !== "string" || store.hash(value) !== store.hash(store.meta<string>("setupKey")!)) throw new WorkspaceError(403, "Enter the setup key from the installed hub");
    if (store.meta("connection")) throw new WorkspaceError(409, "This hub has already been activated");
  }
  let activation: { ticket: string; expires: number; connection: Connection; cookie: string; operations: any[] } | null = null;
  app.post("/api/offline/connect", run(async (req, res) => {
    setup(req);
    const input = z.object({ cloudUrl: z.string().url(), email: z.string().email(), password: z.string().min(12), setupKey: z.string() }).strict().parse(req.body);
    const connection: Connection = { cloudUrl: new URL(input.cloudUrl).origin, deviceId: store.meta("deviceId") ?? randomUUID(), deviceToken: store.meta("deviceToken") ?? randomBytes(32).toString("hex"), operationId: "", name: "" };
    store.setMeta("deviceId", connection.deviceId); store.setMeta("deviceToken", connection.deviceToken);
    const login = await call(connection, "/auth/login", { email: input.email, password: input.password });
    if (!login.cookie || login.data.user?.role !== "owner") throw new WorkspaceError(403, "Use the business owner's online account to activate this hub");
    // operations is a GET on the cloud; discovery endpoint keeps credentials server-side.
    const discovery = await call(connection, "/offline/discover", {}, login.cookie);
    activation = { ticket: randomBytes(24).toString("hex"), expires: Date.now() + 600000, connection, cookie: login.cookie, operations: discovery.data.operations };
    res.json({ ticket: activation.ticket, operations: activation.operations });
  }));
  app.post("/api/offline/activate", run(async (req, res) => {
    setup(req);
    const input = z.object({ setupKey: z.string(), ticket: z.string(), operationId: z.string().uuid(), name: z.string().trim().min(2).max(100) }).strict().parse(req.body);
    if (!activation || activation.expires < Date.now() || input.ticket !== activation.ticket || !activation.operations.some(o => o.id === input.operationId)) throw new WorkspaceError(403, "Reconnect your online account to continue activation");
    const connection = { ...activation.connection, operationId: input.operationId, name: input.name };
    const result = await call<{ bundle: Bundle }>(connection, "/offline/enroll", { deviceId: connection.deviceId, deviceToken: connection.deviceToken, operationId: input.operationId, name: input.name }, activation.cookie);
    await store.exclusive(async () => { store.applyBundle(result.data.bundle, true); store.setMeta("connection", connection); store.setMeta("lastSyncAt", new Date().toISOString()); });
    activation = null; res.json({ ready: true });
  }));
  app.post("/api/offline/refresh", (req, res) => {
    if (typeof req.body.setupKey !== "string" || store.hash(req.body.setupKey) !== store.hash(store.meta("setupKey")!)) { res.status(403).json({ error: "Use the installed server's setup key" }); return; }
    void worker.run(); res.status(202).json({ started: true });
  });
  function cookieName(res: Response) { return res.locals.pos ? "exa-pos-session" : "exa-online-session"; }
  function token(req: Request, res: Response) { return req.headers.cookie?.split(";").map(c => c.trim()).find(c => c.startsWith(`${cookieName(res)}=`))?.slice(cookieName(res).length + 1) ?? ""; }
  function accountUser(account: any) {
    const assignments = store.all("staffAssignment").filter(a => a.accountId === account.id);
    return { id: account.id, name: account.name, email: account.email, role: account.role, assignments, venueIds: assignments.filter(a => a.venueId).map(a => a.venueId) };
  }
  async function authenticate(req: Request, res: Response): Promise<Identity> {
    const session = store.db.prepare("SELECT account_id,expires_at FROM sessions WHERE token_hash=? AND kind=?").get(store.hash(token(req, res)), cookieName(res)) as any;
    if (!session || session.expires_at < Date.now()) throw new WorkspaceError(401, "Sign in to this local hub");
    if (!(Date.parse(store.meta("staffValidUntil") ?? "") > Date.now())) throw new WorkspaceError(403, "The offline staff cache has expired. Connect the hub and sync to refresh staff access.");
    const account = store.all("account").find(a => a.id === session.account_id && a.active);
    if (!account) throw new WorkspaceError(401, "This staff account is no longer active");
    return { tenant: store.meta("tenant")!, user: accountUser(account) };
  }
  app.get("/api/tenant", (_req, res) => res.json({ tenant: store.meta("tenant") }));
  app.get("/api/staff", run(async (req, res) => {
    const i = await authenticate(req, res);
    if (i.user.role !== "owner") throw new WorkspaceError(403, "Only the business owner can view the staff cache");
    res.json({ items: store.all("account").map(a => ({ ...accountUser(a), active: a.active })) });
  }));
  let attempts = 0, windowStart = Date.now();
  app.post("/api/auth/login", run(async (req, res) => {
    if (!store.meta("connection")) throw new WorkspaceError(409, "Activate this hub on the server computer first");
    if (Date.now() - windowStart > 60000) { attempts = 0; windowStart = Date.now(); }
    if (++attempts > 60) throw new WorkspaceError(429, "Too many login attempts. Wait a minute.");
    if (!(Date.parse(store.meta("staffValidUntil") ?? "") > Date.now())) throw new WorkspaceError(403, "Connect the hub and sync to refresh staff access");
    const input = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(128) }).strict().parse(req.body);
    const account = store.all("account").find(a => a.email.toLowerCase() === input.email.toLowerCase() && a.active);
    const hash = scryptSync(input.password, account?.salt ?? "missing-account", 64);
    if (!account || !timingSafeEqual(hash, Buffer.from(account.passwordHash, "hex"))) throw new WorkspaceError(401, "Email or password is incorrect");
    const value = randomBytes(32).toString("hex");
    store.db.prepare("INSERT INTO sessions(token_hash,account_id,kind,expires_at) VALUES(?,?,?,?)").run(store.hash(value), account.id, cookieName(res), Math.min(Date.now() + 12 * 3600000, Date.parse(store.meta("staffValidUntil")!)));
    res.cookie(cookieName(res), value, { httpOnly: true, sameSite: "strict", secure: req.headers.origin?.startsWith("https:"), path: "/", maxAge: 12 * 3600000 });
    res.json({ user: accountUser(account), tenant: store.meta("tenant") });
  }));
  app.get("/api/auth/session", run(async (req, res) => {
    const identity = await authenticate(req, res);
    const runtime = store.all("workspaceRecord").find(r => r.kind === "runtime");
    res.json({ ...identity, offline: true, workspaceMode: runtime?.data.event.containerType === "venue" ? "location" : "organiser", workspaceSetupStarted: false, navigationView: runtime?.data.event.containerType === "venue" ? "location" : "events" });
  }));
  app.post("/api/auth/logout", run(async (req, res) => { store.db.prepare("DELETE FROM sessions WHERE token_hash=? AND kind=?").run(store.hash(token(req, res)), cookieName(res)); res.clearCookie(cookieName(res), { path: "/" }).json({ ok: true }); }));
  app.get("/api/onboarding", run(async (req, res) => { await authenticate(req, res); res.json({ status: "completed", required: false, answers: {}, step: 3, version: 1 }); }));
  app.get("/api/sync/status", run(async (req, res) => {
    const i = await authenticate(req, res);
    res.json({ ...store.status(), running: worker.running, canSync: i.user.role === "owner" || store.all("staffAssignment").some(a => a.accountId === i.user.id && a.role === "venue-manager"), canRelease: i.user.role === "owner" });
  }));
  app.post("/api/sync/backup", run(async (req, res) => { const i = await authenticate(req, res); if (i.user.role !== "owner") throw new WorkspaceError(403, "Only the owner can create a hub backup"); store.backup(true); res.json({ saved: true }); }));
  app.post("/api/sync/run", run(async (req, res) => { const i = await authenticate(req, res); if (i.user.role !== "owner" && !store.all("staffAssignment").some(a => a.accountId === i.user.id && a.role === "venue-manager")) throw new WorkspaceError(403, "A venue manager must start sync"); void worker.run(); res.status(202).json({ started: true }); }));
  app.post("/api/sync/release", run(async (req, res) => { const i = await authenticate(req, res); if (i.user.role !== "owner") throw new WorkspaceError(403, "Only the owner can hand service back to the cloud"); await worker.release(); res.json({ released: true }); }));
  app.use("/api", (req, _res, next) => {
    if (req.method !== "GET") {
      if (store.meta("released") || store.meta("handover")) { next(new WorkspaceError(409, "This hub is handing service back to the cloud. Local sales are paused.")); return; }
      if (!/^\/operations\/[^/]+\/(lifecycle|service\/(orders(?:\/[^/]+\/status)?|payments|menu-items(?:\/[^/]+\/images)?|inventory\/[^/]+\/adjustments))$/.test(req.path)) { next(new WorkspaceError(403, "Manage business configuration and staff online, then sync this hub.")); return; }
    }
    next();
  }, createWorkspaceApi(store.adapter as PrismaClient, authenticate));
  app.use((_req, res) => res.status(404).json({ error: "Local endpoint not found" }));
  app.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (e instanceof WorkspaceError) { res.status(e.status).json({ error: e.message }); return; }
    if (e instanceof z.ZodError) { res.status(422).json({ error: e.issues.map(i => i.message).join(". ") }); return; }
    console.error("Local hub request failed", e instanceof Error ? e.message : "Unknown error"); res.status(503).json({ error: "Local hub could not complete this request. Your transaction has not been confirmed." });
  });
  return { app, worker, authenticate };
}
