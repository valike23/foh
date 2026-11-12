import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { WorkspaceError, type Identity } from "./workspace-access.js";

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const json = (s: unknown) => JSON.parse(JSON.stringify(s)) as Prisma.InputJsonValue;
const key = (tenantId: string, kind: string, id: string) => ({ tenantId, kind, id });

export async function offlineBundle(db: PrismaClient | Prisma.TransactionClient, tenantId: string, operationId: string) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const runtime = await db.workspaceRecord.findUnique({ where: { tenantId_kind_id: key(tenantId, "runtime", operationId) } });
  if (!runtime) throw new WorkspaceError(404, "Publish this service before activating a hub");
  const venues = await db.venue.findMany({ where: { tenantId, id: operationId } });
  const events = await db.workspaceRecord.findMany({ where: { tenantId, kind: "events", id: operationId } });
  const event = events[0]?.data as any;
  if (event?.venueId && !venues.length) venues.push(...await db.venue.findMany({ where: { tenantId, id: event.venueId } }));
  const storefronts = await db.storefront.findMany({ where: { tenantId, OR: [{ venueId: operationId }, { eventId: operationId }] } });
  const vendorIds = new Set(storefronts.map(s => s.vendorId));
  const storeIds = new Set(storefronts.map(s => s.id));
  const venueIds = new Set(venues.map(v => v.id));
  const assignments = (await db.staffAssignment.findMany({ where: { tenantId } })).filter(a => (a.venueId && venueIds.has(a.venueId)) || (a.storefrontId && storeIds.has(a.storefrontId)));
  const accountIds = new Set(assignments.map(a => a.accountId));
  const accounts = (await db.account.findMany({ where: { tenantId, active: true } })).filter(a => a.role === "owner" || accountIds.has(a.id));
  const records = (await db.workspaceRecord.findMany({ where: { tenantId, kind: { in: ["floor", "vendors"] } } })).filter(r => r.kind === "vendors" ? vendorIds.has(r.id) : (r.data as any).scopeId === operationId);
  return { tenant, venues, storefronts, accounts, assignments, records: [...events, ...records], runtime, staffValidUntil: new Date(Date.now() + 7 * 86400_000).toISOString() };
}

export function createOfflineApi(db: PrismaClient, authenticate: (req: Request, res: Response) => Promise<Identity>) {
  const router = Router();
  const run = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void fn(req, res).catch(next);
  const deviceInput = z.object({ deviceId: z.string().uuid(), deviceToken: z.string().regex(/^[a-f0-9]{64}$/), operationId: z.string().uuid(), name: z.string().trim().min(2).max(100) }).strict();
  router.post("/discover", run(async (req, res) => {
    const i = await authenticate(req, res);
    if (i.user.role !== "owner") throw new WorkspaceError(403, "Only the business owner can activate a hub");
    const rows = await db.workspaceRecord.findMany({ where: { tenantId: i.tenant.id, kind: "runtime" } });
    const leases = await db.workspaceRecord.findMany({ where: { tenantId: i.tenant.id, kind: "offline-lease" } });
    res.json({ operations: rows.map(r => ({ id: r.id, name: (r.data as any).event.name, scopeType: (r.data as any).event.containerType, status: (r.data as any).event.status, managedByHub: leases.some(l => l.id === r.id && (l.data as any).active) })) });
  }));
  router.post("/enroll", run(async (req, res) => {
    const i = await authenticate(req, res);
    if (i.user.role !== "owner") throw new WorkspaceError(403, "Only the business owner can activate a hub");
    const input = deviceInput.parse(req.body), tenantId = i.tenant.id;
    await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId + ":offline:" + input.operationId}))`;
      const device = await tx.workspaceRecord.findUnique({ where: { tenantId_kind_id: key(tenantId, "offline-device", input.deviceId) } });
      const previousDevice = device?.data as any;
      if (previousDevice?.active && (previousDevice.operationId !== input.operationId || previousDevice.tokenHash !== digest(input.deviceToken))) throw new WorkspaceError(409, "This installation already controls another service. Complete its activation or hand it back before selecting another.");
      const where = { tenantId_kind_id: key(tenantId, "offline-lease", input.operationId) };
      const existing = await tx.workspaceRecord.findUnique({ where });
      const lease = existing?.data as any;
      if (lease?.active) {
        if (lease.deviceId !== input.deviceId || lease.tokenHash !== digest(input.deviceToken)) throw new WorkspaceError(409, "This operation already has an active local hub. Release it from that hub before activating another.");
        return;
      }
      const runtime = await tx.workspaceRecord.findUnique({ where: { tenantId_kind_id: key(tenantId, "runtime", input.operationId) } });
      if (!runtime) throw new WorkspaceError(422, "Publish this service before activating a hub");
      const bumped = await tx.workspaceRecord.updateMany({ where: { ...key(tenantId, "runtime", input.operationId), version: runtime.version }, data: { version: { increment: 1 } } });
      if (!bumped.count) throw new WorkspaceError(409, "Service changed during activation. Try again.");
      const data = { deviceId: input.deviceId, tokenHash: digest(input.deviceToken), name: input.name, operationId: input.operationId, active: true, revision: runtime.version + 1, lastSequence: 0, lastHash: "", enrolledBy: i.user.id, enrolledAt: new Date().toISOString() };
      await tx.workspaceRecord.upsert({ where, create: { ...key(tenantId, "offline-lease", input.operationId), data }, update: { data, version: { increment: 1 } } });
      await tx.workspaceRecord.upsert({ where: { tenantId_kind_id: key(tenantId, "offline-device", input.deviceId) }, create: { ...key(tenantId, "offline-device", input.deviceId), data }, update: { data } });
    });
    res.json({ bundle: await offlineBundle(db, tenantId, input.operationId) });
  }));
  async function device(req: Request, res: Response, allowReleased = false) {
    const slug = res.locals.slug;
    const tenant = slug ? await db.tenant.findUnique({ where: { slug } }) : null;
    const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const id = req.headers["x-exa-device-id"];
    if (!tenant || !token || typeof id !== "string") throw new WorkspaceError(401, "Invalid hub credentials");
    const row = await db.workspaceRecord.findUnique({ where: { tenantId_kind_id: key(tenant.id, "offline-device", id) } });
    const data = row?.data as any;
    if (!data || data.tokenHash !== digest(token) || (!allowReleased && !data.active)) throw new WorkspaceError(401, "Hub access has been released or revoked");
    const lease = await db.workspaceRecord.findUnique({ where: { tenantId_kind_id: key(tenant.id, "offline-lease", data.operationId) } });
    if (!allowReleased && (!(lease?.data as any)?.active || (lease?.data as any)?.deviceId !== id)) throw new WorkspaceError(409, "This hub no longer controls the operation");
    return { tenantId: tenant.id, id, data };
  }
  router.post("/pull", run(async (req, res) => {
    const d = await device(req, res);
    const bundle = await offlineBundle(db, d.tenantId, d.data.operationId);
    // Runtime transactions belong to the hub until it hands service back.
    const { runtime: _runtime, ...configuration } = bundle;
    res.json({ bundle: configuration });
  }));
  router.post("/push", run(async (req, res) => {
    const d = await device(req, res);
    const input = z.object({ sequence: z.number().int().positive(), baseVersion: z.number().int().positive(), snapshot: z.record(z.unknown()) }).strict().parse(req.body);
    if ((input.snapshot.event as any)?.id !== d.data.operationId) throw new WorkspaceError(403, "Snapshot is outside this hub's operation");
    const hash = digest(JSON.stringify(input.snapshot));
    const result = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${d.tenantId + ":offline:" + d.data.operationId}))`;
      const leaseKey = key(d.tenantId, "offline-lease", d.data.operationId);
      const row = await tx.workspaceRecord.findUniqueOrThrow({ where: { tenantId_kind_id: leaseKey } });
      const lease = row.data as any;
      if (!lease.active || lease.deviceId !== d.id) throw new WorkspaceError(409, "Hub ownership changed");
      if (input.sequence === lease.lastSequence && hash === lease.lastHash) return { version: lease.revision, sequence: input.sequence };
      if (input.sequence <= lease.lastSequence || input.baseVersion !== lease.revision) throw new WorkspaceError(409, "Sync conflict: the cloud revision differs. Local records have been kept. Contact the business owner.");
      const changed = await tx.workspaceRecord.updateMany({ where: { ...key(d.tenantId, "runtime", d.data.operationId), version: input.baseVersion }, data: { data: json(input.snapshot), version: { increment: 1 } } });
      if (!changed.count) throw new WorkspaceError(409, "Cloud service changed unexpectedly. Local records have been kept.");
      const version = input.baseVersion + 1;
      await tx.workspaceRecord.update({ where: { tenantId_kind_id: leaseKey }, data: { data: { ...lease, revision: version, lastSequence: input.sequence, lastHash: hash, lastSyncAt: new Date().toISOString() } } });
      return { version, sequence: input.sequence };
    });
    res.json(result);
  }));
  router.post("/release", run(async (req, res) => {
    const d = await device(req, res, true);
    await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${d.tenantId + ":offline:" + d.data.operationId}))`;
      const where = { tenantId_kind_id: key(d.tenantId, "offline-lease", d.data.operationId) };
      const row = await tx.workspaceRecord.findUniqueOrThrow({ where });
      const lease = row.data as any;
      if (lease.deviceId !== d.id) throw new WorkspaceError(409, "Another hub owns this operation");
      await tx.workspaceRecord.update({ where, data: { data: { ...lease, active: false } } });
      await tx.workspaceRecord.update({ where: { tenantId_kind_id: key(d.tenantId, "offline-device", d.id) }, data: { data: { ...d.data, active: false } } });
    });
    res.json({ released: true });
  }));
  return router;
}

export async function assertCloudWriteAllowed(db: PrismaClient | Prisma.TransactionClient, tenantId: string, operationId: string) {
  const row = await db.workspaceRecord.findUnique({ where: { tenantId_kind_id: key(tenantId, "offline-lease", operationId) } });
  if ((row?.data as any)?.active) throw new WorkspaceError(409, "This service is controlled by its local hub. Make sales and stock changes on the venue's local network until the hub syncs and releases service.");
}
