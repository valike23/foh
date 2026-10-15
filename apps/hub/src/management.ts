import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { createBusinessManagement, BusinessError } from "./business-management.js";
import { OperationError } from "./operation-runtime.js";
import { emptyVenueProfile, WEEKDAYS, type HubSnapshot, type ManagedVenue, type ManagementUser, type VenueActivity } from "@exa-foh/shared";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters").max(100),
  address: z.string().trim().max(240), city: z.string().trim().max(100),
  timezone: z.string().max(100).refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Choose a valid timezone"),
  businessDayCutoff: clock, contactName: z.string().trim().max(100),
  email: z.union([z.literal(""), z.string().trim().email()]), phone: z.string().trim().max(40),
  capacity: z.number().int().min(1).max(1000000).nullable(), notes: z.string().trim().max(2000),
  hours: z.array(z.object({ day: z.enum(WEEKDAYS as [string, ...string[]]), closed: z.boolean(), opens: clock, closes: clock }))
    .length(7).refine(hours => new Set(hours.map(hour => hour.day)).size === 7, "Include every day once")
}).strict();
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) });
const setupSchema = loginSchema.extend({ password: z.string().min(12).max(128), name: z.string().trim().min(2).max(100), setupKey: z.string().min(1).max(200) });
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
type Account = ManagementUser & { organizationId: string; salt: string; passwordHash: string; active: boolean };
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

export function createManagementRouter(dbPath: string, organizationId: string, getSnapshot: () => HubSnapshot, saveLegacy?: () => void) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS management_accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS management_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS managed_venues (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS venue_activity (id TEXT PRIMARY KEY, venue_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS management_migrations (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS venue_service_links (venue_id TEXT NOT NULL, unit_id TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS venue_create_requests (account_id TEXT NOT NULL, request_key TEXT NOT NULL, payload_hash TEXT NOT NULL, venue_id TEXT NOT NULL, PRIMARY KEY(account_id, request_key));
  `);
  const setupKeyPath = `${dbPath}.setup-key`;
  const accountCount = () => Number((db.prepare("SELECT COUNT(*) AS n FROM management_accounts").get() as { n: number }).n);
  if (!accountCount() && !existsSync(setupKeyPath)) writeFileSync(setupKeyPath, process.env.EXA_SETUP_KEY ?? randomBytes(24).toString("hex"), { mode: 0o600 });
  const router = Router();
  const now = () => new Date().toISOString();
  const transaction = <T,>(action: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try { const result = action(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const audit = (venueId: string, actor: string, action: string, changes: string[]) => {
    const entry: VenueActivity = { id: randomUUID(), venueId, actor, action, changes, createdAt: now() };
    db.prepare("INSERT INTO venue_activity (id, venue_id, data) VALUES (?, ?, ?)").run(entry.id, venueId, JSON.stringify(entry));
  };
  const insertVenue = (venue: ManagedVenue) => db.prepare("INSERT INTO managed_venues VALUES (?, ?, ?, ?)")
    .run(venue.id, venue.organizationId, venue.version, JSON.stringify(venue));

  // Add a venue identity without replacing the existing event or transactional records.
  if (!db.prepare("SELECT id FROM management_migrations WHERE id = 'venue-registry-v1'").get()) {
    transaction(() => {
      const current = getSnapshot().event;
      if (current.venue.trim()) {
        const venue: ManagedVenue = {
          ...emptyVenueProfile(), id: randomUUID(), organizationId, name: current.venue,
          status: "draft", version: 1, createdAt: now(), updatedAt: now()
        };
        insertVenue(venue);
        db.prepare("INSERT INTO venue_service_links VALUES (?, ?)").run(venue.id, current.id);
        audit(venue.id, "System", "Imported venue identity", ["Existing service records preserved"]);
      }
      db.prepare("INSERT INTO management_migrations VALUES ('venue-registry-v1')").run();
    });
  }
  function session(request: Request): Account {
    const token = request.header("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token) throw new HttpError(401, "Sign in to continue");
    const row = db.prepare(`SELECT a.data FROM management_sessions s JOIN management_accounts a ON a.id = s.account_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(digest(token), Date.now()) as { data: string } | undefined;
    if (!row) throw new HttpError(401, "Your session has expired. Sign in again.");
    const account = JSON.parse(row.data) as Account;
    if (!account.active || account.organizationId !== organizationId) throw new HttpError(403, "Access has been removed");
    return account;
  }
  function publicUser(account: Account): ManagementUser {
    const { id, name, email, role, venueIds } = account;
    return { id, name, email, role, venueIds };
  }
  function authorize(account: Account, venueId?: string, write = false) {
    if (account.role === "owner") return;
    if (!venueId || !account.venueIds.includes(venueId) || (write && account.role === "viewer")) throw new HttpError(403, "You do not have permission for this action");
  }
  function findVenue(id: string): ManagedVenue {
    const row = db.prepare("SELECT data FROM managed_venues WHERE id = ? AND organization_id = ?").get(id, organizationId) as { data: string } | undefined;
    if (!row) throw new HttpError(404, "Venue not found");
    return JSON.parse(row.data);
  }
  function linkedService(id: string) {
    const current = getSnapshot().event;
    const link = db.prepare("SELECT unit_id FROM venue_service_links WHERE venue_id = ? AND unit_id = ?").get(id, current.id);
    return link ? { id: current.id, name: current.name, type: current.containerType, status: current.status } : null;
  }
  function blockers(id: string) {
    const dependencies = business.venueDependencies(id);
    if (!linkedService(id)) return dependencies;
    const snapshot = getSnapshot();
    const result: string[] = [];
    if (["live", "paused"].includes(snapshot.event.status)) result.push("Linked service has not closed");
    if (snapshot.operatingPeriods.some(period => period.status === "open")) result.push("Open business periods must be closed");
    if (snapshot.orders.some(order => !["settled", "void", "rejected"].includes(order.status))) result.push("Orders remain unresolved");
    if (snapshot.deposits.some(deposit => deposit.status === "active")) result.push("Active deposits must be resolved");
    if (snapshot.registerSessions.some(register => register.status === "open")) result.push("Registers remain open");
    if (snapshot.inventory.some(item => item.quantity !== 0)) result.push("Linked service stock must be reconciled and transferred out");
    if (snapshot.settlementBatches.some(batch => batch.status !== "paid")) result.push("Vendor settlement batches remain unpaid");
    const balances = new Map<string, number>();
    snapshot.ledgerEntries.forEach(entry => balances.set(entry.vendorId, (balances.get(entry.vendorId) ?? 0) + (entry.direction === "credit" ? entry.amount : -entry.amount)));
    if ([...balances.values()].some(balance => balance !== 0)) result.push("Vendor ledger balances must be reconciled");
    if (snapshot.payouts.some(payout => payout.status === "pending")) result.push("Payouts remain pending");
    return [...result, ...dependencies];
  }
  function startSession(account: Account) {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM management_sessions WHERE expires_at <= ?").run(Date.now());
    db.prepare("INSERT INTO management_sessions VALUES (?, ?, ?)").run(digest(token), account.id, Date.now() + 12 * 60 * 60 * 1000);
    return { user: publicUser(account), token };
  }
  const business = createBusinessManagement({ db, organizationId, session, findVenue, getSnapshot, saveLegacy });
  // Fixed-window throttling bounds password hashing work without retaining unbounded caller keys.
  let authAttempts = 0;
  let authWindow = Date.now();
  router.use((request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "POST" && ["/auth/login", "/auth/setup"].includes(request.path)) {
      if (Date.now() - authWindow > 60_000) { authAttempts = 0; authWindow = Date.now(); }
      if (++authAttempts > 20) { response.status(429).json({ error: "Too many attempts. Try again in a minute." }); return; }
    }
    next();
  });
  router.get("/auth/status", (_request, response) => response.json({ needsSetup: accountCount() === 0 }));
  router.post("/auth/setup", (request, response) => {
    if (accountCount()) throw new HttpError(409, "The owner account has already been created");
    const input = setupSchema.parse(request.body);
    const key = readFileSync(setupKeyPath, "utf8").trim();
    if (!timingSafeEqual(Buffer.from(digest(input.setupKey)), Buffer.from(digest(key)))) throw new HttpError(403, "Invalid setup key");
    const salt = randomBytes(16).toString("hex");
    const account: Account = {
      id: randomUUID(), name: input.name, email: input.email.toLowerCase(), organizationId,
      role: "owner", venueIds: [], salt, passwordHash: scryptSync(input.password, salt, 64).toString("hex"), active: true
    };
    transaction(() => {
      if (accountCount()) throw new HttpError(409, "The owner account has already been created");
      db.prepare("INSERT INTO management_accounts VALUES (?, ?, ?)").run(account.id, account.email, JSON.stringify(account));
    });
    unlinkSync(setupKeyPath);
    response.status(201).json(startSession(account));
  });
  router.post("/auth/login", (request, response) => {
    const input = loginSchema.parse(request.body);
    const row = db.prepare("SELECT data FROM management_accounts WHERE email = ?").get(input.email.toLowerCase()) as { data: string } | undefined;
    const account = row ? JSON.parse(row.data) as Account : undefined;
    const hash = scryptSync(input.password, account?.salt ?? "missing-account", 64);
    if (!account || !account.active || !timingSafeEqual(hash, Buffer.from(account.passwordHash, "hex"))) throw new HttpError(401, "Email or password is incorrect");
    response.json(startSession(account));
  });
  router.get("/auth/session", (request, response) => response.json({ user: publicUser(session(request)), organizationId }));
  router.post("/auth/logout", (request, response) => {
    const token = request.header("authorization")?.replace(/^Bearer /, "") ?? "";
    db.prepare("DELETE FROM management_sessions WHERE token_hash = ?").run(digest(token));
    response.json({ ok: true });
  });
  router.get("/venues", (request, response) => {
    const account = session(request);
    const query = z.object({ q: z.string().max(100).default(""), status: z.enum(["all", "draft", "active", "paused", "archived"]).default("all"), page: z.coerce.number().int().min(1).default(1), sort: z.enum(["name", "updated"]).default("updated") }).parse(request.query);
    const rows = db.prepare("SELECT data FROM managed_venues WHERE organization_id = ?").all(organizationId) as { data: string }[];
    const venues = rows.map(row => JSON.parse(row.data) as ManagedVenue)
      .filter(venue => account.role === "owner" || account.venueIds.includes(venue.id));
    const counts = Object.fromEntries(["all", "draft", "active", "paused", "archived"].map(status => [status, venues.filter(venue => status === "all" || venue.status === status).length]));
    const filtered = venues.filter(venue => (query.status === "all" || venue.status === query.status)
      && `${venue.name} ${venue.city} ${venue.address} ${venue.contactName}`.toLowerCase().includes(query.q.toLowerCase()));
    filtered.sort((a, b) => query.sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    response.json({ items: filtered.slice((query.page - 1) * 12, query.page * 12), total: filtered.length, page: query.page, pageSize: 12, counts, canCreate: account.role === "owner" });
  });
  router.post("/venues", (request, response) => {
    const account = session(request); authorize(account);
    const input = profileSchema.parse(request.body);
    const requestKey = z.string().uuid().optional().parse(request.header("idempotency-key"));
    const payloadHash = digest(JSON.stringify(input));
    const venue = transaction(() => {
      if (requestKey) {
        const prior = db.prepare("SELECT payload_hash, venue_id FROM venue_create_requests WHERE account_id = ? AND request_key = ?").get(account.id, requestKey) as { payload_hash: string; venue_id: string } | undefined;
        if (prior) {
          if (prior.payload_hash !== payloadHash) throw new HttpError(409, "This request key was already used for different venue details");
          return findVenue(prior.venue_id);
        }
      }
      const created: ManagedVenue = { ...input, id: randomUUID(), organizationId, status: "draft", version: 1, createdAt: now(), updatedAt: now() };
      insertVenue(created); audit(created.id, account.name, "Created venue", []);
      if (requestKey) db.prepare("INSERT INTO venue_create_requests VALUES (?, ?, ?, ?)").run(account.id, requestKey, payloadHash, created.id);
      return created;
    });
    response.status(201).json(venue);
  });
  router.get("/venues/:id", (request, response) => {
    const account = session(request); const id = String(request.params.id); authorize(account, id);
    const venue = findVenue(id);
    const rows = db.prepare("SELECT data FROM venue_activity WHERE venue_id = ? ORDER BY rowid DESC LIMIT 100").all(id) as { data: string }[];
    response.json({ venue, activity: rows.map(row => JSON.parse(row.data)), canEdit: account.role !== "viewer", archiveBlockers: blockers(id), linkedService: linkedService(id) });
  });
  router.patch("/venues/:id", (request, response) => {
    const account = session(request); const id = String(request.params.id); authorize(account, id, true);
    const input = profileSchema.extend({ version: z.number().int().positive() }).parse(request.body);
    const venue = transaction(() => {
      const current = findVenue(id);
      if (current.status === "archived") throw new HttpError(409, "Restore this venue before editing");
      if (current.version !== input.version) throw new HttpError(409, "This venue changed elsewhere. Reload before saving.");
      if (current.status === "active" && (!input.address || !input.city || input.hours.every(day => day.closed))) throw new HttpError(422, "Active venues need an address, city and at least one open day");
      const updated = { ...current, ...input, version: current.version + 1, updatedAt: now() };
      const changes = Object.keys(profileSchema.shape).filter(key => JSON.stringify(current[key as keyof ManagedVenue]) !== JSON.stringify(updated[key as keyof ManagedVenue]));
      db.prepare("UPDATE managed_venues SET version = ?, data = ? WHERE id = ?").run(updated.version, JSON.stringify(updated), id);
      audit(id, account.name, "Updated venue", changes);
      return updated;
    });
    response.json(venue);
  });
  router.post("/venues/:id/status", (request, response) => {
    const account = session(request); const id = String(request.params.id); authorize(account, id, true);
    const input = z.object({ version: z.number().int().positive(), status: z.enum(["active", "paused", "archived", "draft"]), reason: z.string().trim().min(3).max(300) }).parse(request.body);
    const venue = transaction(() => {
      const current = findVenue(id);
      if (current.version !== input.version) throw new HttpError(409, "This venue changed elsewhere. Reload before saving.");
      const allowed: Record<string, string[]> = { draft: ["active", "archived"], active: ["paused", "archived"], paused: ["active", "archived"], archived: ["draft"] };
      if (!allowed[current.status].includes(input.status)) throw new HttpError(409, "That status change is not available");
      if (input.status === "paused" && linkedService(id)?.status === "live") throw new HttpError(409, "Close or pause the linked service before pausing this venue");
      if (input.status === "active" && (!current.address || !current.city || current.hours.every(day => day.closed))) throw new HttpError(422, "Add an address, city and at least one open day before activating");
      if (input.status === "archived" && blockers(id).length) throw new HttpError(409, blockers(id).join(". "));
      const updated = { ...current, status: input.status, version: current.version + 1, updatedAt: now() };
      db.prepare("UPDATE managed_venues SET version = ?, data = ? WHERE id = ?").run(updated.version, JSON.stringify(updated), id);
      audit(id, account.name, `Status changed from ${current.status} to ${input.status}`, [input.reason]);
      return updated;
    });
    response.json(venue);
  });
  router.use(business.router);
  router.use("/entry", business.publicRouter);
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) { response.status(422).json({ error: "Check the highlighted fields", fields: error.flatten().fieldErrors }); return; }
    if (error instanceof HttpError || error instanceof BusinessError || error instanceof OperationError) { response.status(error.status).json({ error: error.message }); return; }
    console.error("Management request failed", error);
    response.status(500).json({ error: "Unable to save changes. Please try again." });
  });
  return Object.assign(router, { resolveEntry: business.resolveEntry, authorizeRuntime: business.authorizeRuntime, runtimeFor: business.runtimeFor, persistRuntime: business.persistRuntime, getBranding: business.getBranding });
}
