import { Router, type Request, type Response, type NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { WorkspaceError, type Identity } from "./workspace-access.js";
const derive = promisify(scrypt);
const assignment = z.object({ role: z.enum(["venue-manager", "storefront-manager", "cashier", "waiter", "prep", "runner", "viewer"]), venueId: z.string().min(1).nullable(), storefrontId: z.string().min(1).nullable() }).strict().refine(a => Boolean(a.venueId) !== Boolean(a.storefrontId), "Choose either a venue or a storefront").refine(a => a.role === "viewer" || (a.role === "venue-manager" ? !!a.venueId : !!a.storefrontId), "Venue managers need a venue; other staff roles need a storefront");
const assignments = z.array(assignment).min(1).max(100).refine(a => new Set(a.map(v => `${v.role}:${v.venueId}:${v.storefrontId}`)).size === a.length, "Remove duplicate assignments");
const create = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(12).max(128), assignments }).strict();
export function createStaffApi(db: PrismaClient, authenticate: (req: Request, res: Response) => Promise<Identity>) {
  const router = Router();
  const run = (fn: (req: Request, res: Response, i: Identity) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void authenticate(req, res).then(i => { if (i.user.role !== "owner") throw new WorkspaceError(403, "Only the business owner can manage staff access"); return fn(req, res, i); }).catch(next); };
  const select = { id: true, name: true, email: true, role: true, active: true, assignments: { select: { id: true, role: true, venueId: true, storefrontId: true } } };
  async function validate(tenantId: string, values: z.infer<typeof assignments>) {
    for (const a of values) {
      const exists = a.venueId ? await db.venue.findFirst({ where: { tenantId, id: a.venueId, status: { not: "archived" } } }) : await db.storefront.findFirst({ where: { tenantId, id: a.storefrontId!, status: { not: "archived" } } });
      if (!exists) throw new WorkspaceError(422, "Choose an active workspace venue or storefront");
    }
  }
  router.get("/", run(async (_req, res, i) => res.json({ items: await db.account.findMany({ where: { tenantId: i.tenant.id }, select, orderBy: { createdAt: "asc" } }) })));
  router.post("/", run(async (req, res, i) => {
    const input = create.parse(req.body); await validate(i.tenant.id, input.assignments);
    const salt = randomBytes(16).toString("hex"); const passwordHash = ((await derive(input.password, salt, 64)) as Buffer).toString("hex");
    const saved = await db.account.create({ data: { tenantId: i.tenant.id, name: input.name, email: input.email, role: "staff", salt, passwordHash, assignments: { create: input.assignments } }, select });
    res.status(201).json(saved);
  }));
  router.patch("/:id", run(async (req, res, i) => {
    const input = z.object({ active: z.boolean(), assignments }).strict().parse(req.body);
    const account = await db.account.findFirst({ where: { tenantId: i.tenant.id, id: String(req.params.id) } });
    if (!account) throw new WorkspaceError(404, "Staff account not found");
    if (account.role === "owner") throw new WorkspaceError(403, "The owner account cannot be changed here");
    await validate(i.tenant.id, input.assignments);
    const saved = await db.$transaction(async tx => {
      await tx.staffAssignment.deleteMany({ where: { tenantId: i.tenant.id, accountId: account.id } });
      // Changing access invalidates sessions; the next sign-in uses the new assignments.
      await tx.session.deleteMany({ where: { tenantId: i.tenant.id, accountId: account.id } });
      return tx.account.update({ where: { id: account.id }, data: { active: input.active, assignments: { create: input.assignments } }, select });
    }); res.json(saved);
  }));
  router.post("/:id/password", run(async (req, res, i) => {
    const input = z.object({ password: z.string().min(12).max(128) }).strict().parse(req.body);
    const account = await db.account.findFirst({ where: { tenantId: i.tenant.id, id: String(req.params.id), role: "staff" } });
    if (!account) throw new WorkspaceError(404, "Staff account not found");
    const salt = randomBytes(16).toString("hex"); const passwordHash = ((await derive(input.password, salt, 64)) as Buffer).toString("hex");
    await db.$transaction([db.account.update({ where: { id: account.id }, data: { salt, passwordHash } }), db.session.deleteMany({ where: { tenantId: i.tenant.id, accountId: account.id } })]);
    res.json({ ok: true });
  }));
  return router;
}
