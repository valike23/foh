import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes, createHash, randomUUID } from "node:crypto";

type Row = Record<string, any>;
export type Bundle = { tenant: Row; venues: Row[]; storefronts: Row[]; accounts: Row[]; assignments: Row[]; records: Row[]; runtime?: Row; staffValidUntil: string; customers?: Row[] };
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((part: Row) => matches(row, part));
    if (key === "AND") return value.every((part: Row) => matches(row, part));
    if (!(key in row) && value && typeof value === "object") return matches(row, value);
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("not" in value) return row[key] !== value.not;
      if ("in" in value) return value.in.includes(row[key]);
      if ("gt" in value) return new Date(row[key]).getTime() > new Date(value.gt).getTime();
    }
    return row[key] === value;
  });
}
const clone = (row: Row) => {
  const copy = JSON.parse(JSON.stringify(row));
  for (const field of ["createdAt", "updatedAt", "expiresAt"]) if (copy[field]) copy[field] = new Date(copy[field]);
  return copy;
};

/** Narrow repository bridge for the shared workspace API. No Prisma engine runs locally. */
export class LocalStore {
  readonly db: DatabaseSync;
  readonly adapter: any;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(public path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents(model TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(model,id));
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL, snapshot TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, changes INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(status,sequence);`);
    if (!(this.db.prepare("PRAGMA table_info(outbox)").all() as Row[]).some(r => r.name === "changes")) this.db.exec("ALTER TABLE outbox ADD COLUMN changes INTEGER NOT NULL DEFAULT 1");
    if (!this.meta("setupKey")) this.setMeta("setupKey", randomBytes(24).toString("hex"));
    this.adapter = Object.fromEntries(["tenant", "venue", "storefront", "account", "staffAssignment", "workspaceRecord", "customer", "customerBrowser", "customerOrder"].map(model => [model, {
      create: async (args: Row) => { const row = { id: randomUUID(), createdAt: new Date().toISOString(), ...args.data }; this.put(model, row); return clone(row); },
      update: async (args: Row) => { const row = this.all(model).find(r => matches(r, args.where)); if (!row) throw new Error("Record not found"); const result = { ...row, ...args.data }; this.put(model, result); return clone(result); },
      findMany: async (args: Row = {}) => this.all(model).filter(r => matches(r, args.where)).map(clone),
      findFirst: async (args: Row = {}) => { const row = this.all(model).find(r => matches(r, args.where)); return row ? clone(row) : null; },
      findUnique: async (args: Row) => { const row = this.all(model).find(r => matches(r, args.where)); return row ? clone(row) : null; },
      findUniqueOrThrow: async (args: Row) => { const row = this.all(model).find(r => matches(r, args.where)); if (!row) throw new Error("Local record not found"); return clone(row); },
      updateMany: async (args: Row) => {
        const rows = this.all(model).filter(r => matches(r, args.where));
        for (const row of rows) {
          const result = { ...row };
          for (const [key, value] of Object.entries(args.data)) result[key] = value && typeof value === "object" && "increment" in value ? Number(row[key]) + Number((value as Row).increment) : value;
          this.put(model, result);
          if (model === "workspaceRecord" && result.kind === "runtime") {
            // Coalesce unsent revisions; never change a frozen/failed in-flight batch.
            const pending = this.db.prepare("SELECT sequence FROM outbox WHERE operation_id=? AND status='pending' ORDER BY sequence DESC LIMIT 1").get(result.id) as Row | undefined;
            if (pending) this.db.prepare("UPDATE outbox SET snapshot=?,changes=changes+1 WHERE sequence=?").run(JSON.stringify(result.data), pending.sequence);
            else this.db.prepare("INSERT INTO outbox(operation_id,snapshot,created_at) VALUES(?,?,?)").run(result.id, JSON.stringify(result.data), new Date().toISOString());
          }
        }
        return { count: rows.length };
      },
    }]));
    this.adapter.$transaction = async (fn: (tx: any) => Promise<unknown>) => {
      this.db.exec("BEGIN IMMEDIATE");
      try { const result = await fn(this.adapter); this.db.exec("COMMIT"); return result; } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    };
    this.adapter.$queryRaw = async () => [];
    this.adapter.$executeRaw = async () => 0; // Requests are serialized on the local connection.
  }
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(fn); this.tail = next.catch(() => {}); return next;
  }
  all(model: string): Row[] { return (this.db.prepare("SELECT data FROM documents WHERE model=?").all(model) as { data: string }[]).map(r => JSON.parse(r.data)); }
  put(model: string, row: Row) {
    const id = model === "workspaceRecord" ? `${row.tenantId}:${row.kind}:${row.id}` : row.id;
    this.db.prepare("INSERT INTO documents(model,id,data) VALUES(?,?,?) ON CONFLICT(model,id) DO UPDATE SET data=excluded.data").run(model, id, JSON.stringify(row));
  }
  meta<T = any>(key: string): T | null { const row = this.db.prepare("SELECT value FROM metadata WHERE key=?").get(key) as { value: string } | undefined; return row ? JSON.parse(row.value) : null; }
  setMeta(key: string, value: unknown) { this.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value)); }
  applyBundle(bundle: Bundle, initial = false) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const customer of bundle.customers ?? []) {
        for (const local of this.all("customer")) if (local.id !== customer.id && ((customer.phone && local.phone === customer.phone) || (customer.email && local.email === customer.email))) {
          for (const row of this.all("workspaceRecord").filter(r => r.kind === "runtime")) {
            for (const order of row.data.orders) if (order.customerId === local.id) order.customerId = customer.id;
            this.put("workspaceRecord", row);
          }
          this.db.prepare("DELETE FROM documents WHERE model='customer' AND id=?").run(local.id);
        }
        this.put("customer", customer);
      }
      const previous = new Map(this.all("account").map(a => [a.id, JSON.stringify(a)]));
      for (const model of ["tenant", "venue", "storefront", "account", "staffAssignment"]) this.db.prepare("DELETE FROM documents WHERE model=?").run(model);
      this.put("tenant", bundle.tenant);
      for (const [model, rows] of [["venue", bundle.venues], ["storefront", bundle.storefronts], ["account", bundle.accounts], ["staffAssignment", bundle.assignments]] as [string, Row[]][]) for (const row of rows) this.put(model, row);
      this.db.prepare("DELETE FROM documents WHERE model='workspaceRecord' AND json_extract(data,'$.kind') IN ('events','floor','vendors')").run();
      for (const row of bundle.records) this.put("workspaceRecord", row);
      if (initial && bundle.runtime) { this.put("workspaceRecord", bundle.runtime); this.setMeta("cloudVersion", bundle.runtime.version); }
      for (const [id, data] of previous) if (JSON.stringify(bundle.accounts.find(a => a.id === id)) !== data) this.db.prepare("DELETE FROM sessions WHERE account_id=?").run(id);
      this.setMeta("staffValidUntil", bundle.staffValidUntil); this.setMeta("tenant", bundle.tenant);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  pending(): Row[] { return this.db.prepare("SELECT * FROM outbox WHERE status!='sent' ORDER BY sequence").all() as Row[]; }
  backup(force = false) {
    const directory = join(dirname(this.path), "backups"); mkdirSync(directory, { recursive: true, mode: 0o700 });
    const filename = join(directory, `${new Date().toISOString().slice(0, 10)}${force ? "-" + Date.now() : ""}.sqlite`);
    if (!existsSync(filename)) { this.db.prepare("VACUUM INTO ?").run(filename); try { chmodSync(filename, 0o600); } catch {} }
    this.setMeta("lastBackupAt", new Date().toISOString()); return filename;
  }
  status() {
    const counts = this.db.prepare("SELECT status, SUM(changes) AS count FROM outbox GROUP BY status").all() as Row[];
    return { configured: !!this.meta("connection"), released: !!this.meta("released"), handover: !!this.meta("handover"), name: this.meta("connection")?.name, operationId: this.meta("connection")?.operationId,
      pending: counts.filter(r => r.status !== "sent").reduce((s, r) => s + Number(r.count), 0), failed: Number(counts.find(r => r.status === "failed")?.count ?? 0),
      lastSyncAt: this.meta("lastSyncAt"), lastBackupAt: this.meta("lastBackupAt"), lastError: this.meta("lastError"), staffValidUntil: this.meta("staffValidUntil"), progress: this.meta("progress") ?? { phase: "idle", completed: 0, total: 0 } };
  }
  hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
  close() { this.db.close(); }
}
