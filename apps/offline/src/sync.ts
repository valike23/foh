import type { LocalStore, Bundle } from "./store.js";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export type Connection = { cloudUrl: string; deviceId: string; deviceToken: string; operationId: string; name: string; apiPrefix?: string };
export type RemoteCall = <T = any>(connection: Connection, path: string, body: unknown, cookie?: string) => Promise<{ data: T; cookie?: string }>;
export const remoteCall: RemoteCall = async (connection, path, body, cookie) => {
  const origin = new URL(connection.cloudUrl);
  if (origin.protocol !== "https:" && !(origin.protocol === "http:" && (["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || origin.hostname.endsWith(".localhost")))) throw new Error("Use your HTTPS business workspace URL");
  if (origin.username || origin.password) throw new Error("Do not put credentials in the workspace URL");
  const destination = new URL(`${connection.apiPrefix ?? "/api/manage"}${path}`, origin);
  if (origin.hostname.endsWith(".localhost")) destination.hostname = "127.0.0.1";
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = (destination.protocol === "https:" ? httpsRequest : httpRequest)(destination, { method: "POST", headers: { Host: origin.host, Origin: origin.origin, "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(payload)), ...(cookie ? { Cookie: cookie } : { Authorization: `Bearer ${connection.deviceToken}`, "X-Exa-Device-Id": connection.deviceId }) } }, response => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", chunk => { bytes += chunk.length; if (bytes > 64_000_000) request.destroy(new Error("Cloud response exceeded the sync size limit")); else chunks.push(chunk); });
      response.on("error", reject);
      response.on("end", () => {
        let data: any; try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { reject(new Error("The cloud returned an invalid response. Check the business workspace URL.")); return; }
        if (!response.statusCode || response.statusCode >= 300) { reject(new Error(data.error ?? `Cloud returned ${response.statusCode}`)); return; }
        resolve({ data, cookie: response.headers["set-cookie"]?.map(c => c.split(";")[0]).join("; ") });
      });
    });
    request.setTimeout(30000, () => request.destroy(new Error("Cloud sync timed out"))); request.on("error", reject); request.end(payload);
  });
};

export class SyncWorker {
  running = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(public store: LocalStore, private call: RemoteCall = remoteCall) {}
  start(interval = 300000) { this.timer = setInterval(() => void this.run(), interval); this.timer.unref(); if (this.store.meta("connection") && !this.store.meta("released")) void this.run(); }
  stop() { if (this.timer) clearInterval(this.timer); }
  async run() {
    if (this.running || this.store.meta("released")) return;
    const connection = this.store.meta<Connection>("connection"); if (!connection) return;
    this.running = true;
    let current: number | null = null, completed = 0, total = 0;
    const progress = (phase: string) => this.store.setMeta("progress", { phase, completed, total, updatedAt: new Date().toISOString() });
    try {
      await this.store.exclusive(async () => { this.store.backup(); total = this.store.status().pending; progress("Downloading staff and configuration"); });
      const pull = await this.call<{ bundle: Bundle }>(connection, "/offline/pull", {});
      await this.store.exclusive(async () => this.store.applyBundle(pull.data.bundle));
      const batch = await this.store.exclusive(async () => this.store.pending());
      total = batch.reduce((sum, row) => sum + Number(row.changes), 0);
      for (const row of batch) {
        current = row.sequence;
        const frozen = await this.store.exclusive(async () => {
          const latest = this.store.db.prepare("SELECT * FROM outbox WHERE sequence=?").get(row.sequence) as any;
          this.store.db.prepare("UPDATE outbox SET status='uploading' WHERE sequence=?").run(row.sequence);
          total = Math.max(total, completed + Number(latest.changes)); progress("Uploading local changes");
          return { ...latest, baseVersion: this.store.meta("cloudVersion") };
        });
        const result = await this.call<{ version: number; sequence: number }>(connection, "/offline/push", { sequence: row.sequence, baseVersion: frozen.baseVersion, snapshot: JSON.parse(frozen.snapshot) });
        if (result.data.sequence !== row.sequence) throw new Error("Cloud did not acknowledge this change");
        await this.store.exclusive(async () => {
          this.store.db.exec("BEGIN IMMEDIATE");
          try {
            this.store.db.prepare("UPDATE outbox SET status='sent',snapshot='',error=NULL,attempts=attempts+1 WHERE sequence=?").run(row.sequence);
            this.store.setMeta("cloudVersion", result.data.version); this.store.db.exec("COMMIT");
          } catch (e) { this.store.db.exec("ROLLBACK"); throw e; }
          completed += Number(frozen.changes); progress("Uploading local changes");
        });
        current = null;
      }
      await this.store.exclusive(async () => { this.store.setMeta("lastSyncAt", new Date().toISOString()); this.store.setMeta("lastError", null); progress("Up to date"); });
    } catch (e) {
      await this.store.exclusive(async () => {
        const message = e instanceof Error ? e.message : "Sync failed";
        this.store.setMeta("lastError", message);
        if (current !== null) this.store.db.prepare("UPDATE outbox SET status='failed',attempts=attempts+1,error=? WHERE sequence=?").run(message, current);
        progress("Waiting to retry");
      });
    } finally { this.running = false; }
  }
  async release() {
    if (this.running) throw new Error("Wait for the current sync to finish");
    if (this.store.meta("handover") && !this.store.pending().length) {
      // A release can succeed remotely before its response reaches this hub.
      await this.call(this.store.meta("connection")!, "/offline/release", {});
      await this.store.exclusive(async () => { this.store.setMeta("released", true); this.store.setMeta("lastError", null); });
      return;
    }
    await this.store.exclusive(async () => this.store.setMeta("handover", true));
    await this.run();
    if (this.store.pending().length || this.store.meta("lastError")) throw new Error("Sync must finish successfully before this operation can return to the cloud");
    await this.call(this.store.meta("connection")!, "/offline/release", {});
    await this.store.exclusive(async () => this.store.setMeta("released", true));
  }
}
