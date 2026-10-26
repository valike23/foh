import express, { type Request, type Response, type NextFunction } from "express";
import { Prisma, type PrismaClient, type Tenant } from "@prisma/client";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { tenantFromHost, validTenantSlug } from "./tenant-host.js";
import { createWorkspaceApi, WorkspaceError } from "./workspace-api.js";
import { brandingSchema, normalizeBrandLogo } from "./tenant-branding.js";

const derive = promisify(scrypt);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const cookieName = "exa-online-session";
const credentials = z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(12).max(128) });
const signup = credentials.extend({ name: z.string().trim().min(2).max(100), organizationName: z.string().trim().min(2).max(100), slug: z.string().refine(validTenantSlug, "Use 3–48 lowercase letters, digits or hyphens; start with a letter. This name may be reserved."), ...brandingSchema }).strict();
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
type Options = { baseDomain: string; publicOrigin: string };

export function createOnlineApp(db: PrismaClient, options: Options) {
  const origin = new URL(options.publicOrigin);
  if (!["http:", "https:"].includes(origin.protocol) || origin.hostname !== `app.${options.baseDomain}` || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("ONLINE_PUBLIC_ORIGIN must be the app subdomain origin");
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  const run = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
  app.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    try { res.locals.slug = tenantFromHost(req.headers.host ?? "", options.baseDomain); next(); }
    catch { res.status(400).json({ error: "Use the configured app or tenant subdomain" }); }
  });
  app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
    if (req.headers.origin !== `${origin.protocol}//${req.headers.host}` || req.headers["sec-fetch-site"] === "cross-site") { res.status(403).json({ error: "Request origin is not allowed" }); return; }
    if (!req.is("application/json")) { res.status(415).json({ error: "JSON required" }); return; }
    next();
  });
  // A bounded global throttle protects password hashing during local testing.
  let attempts = 0; let windowStart = Date.now();
  app.use("/api/auth", (req, res, next) => {
    if (req.method === "POST" && ["/signup", "/login"].includes(req.path)) {
      if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); attempts = 0; }
      if (++attempts > 60) { res.status(429).json({ error: "Too many attempts; retry in a minute" }); return; }
    }
    next();
  });
  async function tenant(res: Response): Promise<Tenant> {
    if (!res.locals.slug) throw new HttpError(400, "Open a tenant workspace first");
    const value = await db.tenant.findUnique({ where: { slug: res.locals.slug } });
    if (!value) throw new HttpError(404, "Workspace not found");
    return value;
  }
  function token(req: Request): string {
    const value = req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? "";
    return /^[a-f0-9]{64}$/.test(value) ? value : "";
  }
  async function session(req: Request, res: Response) {
    const workspace = await tenant(res);
    const value = token(req);
    const found = value ? await db.session.findFirst({ where: { tokenHash: digest(value), tenantId: workspace.id, expiresAt: { gt: new Date() } }, include: { account: { select: { id: true, name: true, email: true, role: true } } } }) : null;
    if (!found) throw new HttpError(401, "Sign in to this workspace");
    return { tenant: workspace, user: { ...found.account, venueIds: [] } };
  }
  const cookieOptions = { httpOnly: true, secure: origin.protocol === "https:", sameSite: "strict" as const, path: "/" };
  app.get("/health", run(async (_req, res) => { await db.$queryRaw`SELECT 1`; res.json({ ok: true, persistence: "postgresql", mode: "online" }); }));
  app.get("/api/tenant", run(async (_req, res) => { res.json({ tenant: res.locals.slug ? await tenant(res) : null }); }));
  app.post("/api/auth/signup", run(async (req, res) => {
    if (res.locals.slug) throw new HttpError(400, "Create workspaces on the app subdomain");
    const input = signup.parse(req.body);
    let brandLogo: string | null;
    try { brandLogo = await normalizeBrandLogo(input.brandLogo); }
    catch (error) { throw new HttpError(422, (error as Error).message); }
    const salt = randomBytes(16).toString("hex");
    const passwordHash = ((await derive(input.password, salt, 64)) as Buffer).toString("hex");
    const created = await db.tenant.create({ data: { name: input.organizationName, slug: input.slug, brandColor: input.brandColor?.toLowerCase() ?? null, brandLogo, accounts: { create: { name: input.name, email: input.email, salt, passwordHash } } }, select: { id: true, slug: true, name: true } });
    const destination = new URL(`${origin.protocol}//${req.headers.host}`); destination.hostname = `${created.slug}.${options.baseDomain}`;
    res.status(201).json({ tenant: created, workspaceUrl: destination.origin });
  }));
  app.post("/api/auth/login", run(async (req, res) => {
    const workspace = await tenant(res);
    const input = credentials.parse(req.body);
    const account = await db.account.findUnique({ where: { tenantId_email: { tenantId: workspace.id, email: input.email } } });
    const hash = (await derive(input.password, account?.salt ?? "missing-account", 64)) as Buffer;
    if (!account || !timingSafeEqual(hash, Buffer.from(account.passwordHash, "hex"))) throw new HttpError(401, "Email or password is incorrect");
    const value = randomBytes(32).toString("hex");
    await db.session.create({ data: { tokenHash: digest(value), tenantId: workspace.id, accountId: account.id, expiresAt: new Date(Date.now() + 12 * 60 * 60_000) } });
    res.cookie(cookieName, value, { ...cookieOptions, maxAge: 12 * 60 * 60_000 });
    res.json({ user: { id: account.id, name: account.name, email: account.email, role: account.role }, tenant: workspace });
  }));
  app.get("/api/auth/session", run(async (req, res) => { res.json(await session(req, res)); }));
  app.post("/api/auth/logout", run(async (req, res) => {
    const workspace = await tenant(res);
    await db.session.deleteMany({ where: { tokenHash: digest(token(req)), tenantId: workspace.id } });
    res.clearCookie(cookieName, cookieOptions).json({ ok: true });
  }));
  app.use("/api", createWorkspaceApi(db, session));
  app.get("/", run(async (_req, res) => {
    if (res.locals.slug) await tenant(res);
    const destination = new URL(process.env.DASHBOARD_PUBLIC_ORIGIN ?? `http://app.${options.baseDomain}:5173`);
    if (res.locals.slug) destination.hostname = `${res.locals.slug}.${options.baseDomain}`;
    res.redirect(307, destination.origin);
  }));
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) { res.status(422).json({ error: error.issues.map(issue => issue.message).join(". ") }); return; }
    if (error instanceof HttpError || error instanceof WorkspaceError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { res.status(409).json({ error: "That subdomain or account already exists" }); return; }
    if (error instanceof SyntaxError) { res.status(400).json({ error: "Invalid JSON" }); return; }
    console.error("Online request failed", error instanceof Error ? error.name : "Unknown error");
    res.status(503).json({ error: "Database unavailable or request failed. Check the server configuration." });
  });
  return app;
}
