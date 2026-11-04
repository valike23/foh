import { Router, type Request, type Response, type NextFunction } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { emptyVenueProfile } from "@exa-foh/shared";
import { WorkspaceError, type Identity } from "./workspace-access.js";

const label = z.string().trim().min(2).max(100);
export const onboardingAnswers = z.object({
  mode: z.enum(["location", "organiser", "vendor"]).optional(),
  businessType: z.enum(["restaurant", "hotel", "lounge", "eatery", "other"]).default("restaurant"),
  name: z.string().trim().max(100).default(""),
  address: z.string().trim().max(240).default(""),
  timezone: z.string().refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }).default("Africa/Lagos"),
  startsAt: z.string().max(40).default(""), endsAt: z.string().max(40).default(""),
  sections: z.array(z.object({ name: z.string().trim().max(100), tables: z.number().int().min(0).max(50) }).strict()).max(20).default([]),
  storefronts: z.array(z.string().trim().max(100)).max(20).default([]),
}).strict();
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const initialOnboarding = { status: "in-progress", step: 0, required: true, answers: onboardingAnswers.parse({}) };
const key = (tenantId: string) => ({ tenantId, kind: "onboarding", id: "setup" });

export function createOnboardingApi(db: PrismaClient, authenticate: (req: Request, res: Response) => Promise<Identity>) {
  const router = Router();
  const run = (fn: (req: Request, res: Response, identity: Identity) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    void authenticate(req, res).then(i => { if (i.user.role !== "owner") throw new WorkspaceError(403, "Only the business owner can configure onboarding"); return fn(req, res, i); }).catch(next);
  };
  router.get("/", run(async (_req, res, i) => {
    const row = await db.workspaceRecord.findUnique({ where: { tenantId_kind_id: key(i.tenant.id) } });
    res.json(row ? { ...row.data as object, version: row.version } : { ...initialOnboarding, required: false, version: 0 });
  }));
  router.patch("/", run(async (req, res, i) => {
    const input = z.object({ version: z.number().int().min(0), step: z.number().int().min(0).max(3), answers: onboardingAnswers, paused: z.boolean().default(false) }).strict().parse(req.body);
    const data = { status: "in-progress", required: !input.paused, step: input.step, answers: input.answers };
    if (input.version === 0) {
      try { await db.workspaceRecord.create({ data: { ...key(i.tenant.id), data: json(data) } }); }
      catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new WorkspaceError(409, "Setup changed in another tab. Reload to continue."); throw error; }
    } else {
      const row = await db.workspaceRecord.findUnique({ where: { tenantId_kind_id: key(i.tenant.id) } });
      if ((row?.data as any)?.status === "completed") throw new WorkspaceError(409, "Setup is already complete. Manage your locations or events from the dashboard.");
      const changed = await db.workspaceRecord.updateMany({ where: { ...key(i.tenant.id), version: input.version }, data: { data: json(data), version: { increment: 1 } } });
      if (!changed.count) throw new WorkspaceError(409, "Setup changed in another tab. Reload to continue.");
    }
    res.json({ ...data, version: input.version + 1 });
  }));
  router.post("/complete", run(async (req, res, i) => {
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
    const result = await db.$transaction(async tx => {
      // Serialize creation and retries; a lost HTTP response must not duplicate a business setup.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${i.tenant.id + ":onboarding"}))`;
      const row = await tx.workspaceRecord.findUnique({ where: { tenantId_kind_id: key(i.tenant.id) } });
      if (!row) throw new WorkspaceError(422, "Save your setup answers first");
      const current = row.data as any;
      if (current.status === "completed") return { ...current, version: row.version };
      if (row.version !== version) throw new WorkspaceError(409, "Setup changed in another tab. Reload to continue.");
      const answers = onboardingAnswers.parse(current.answers);
      if (!answers.mode) throw new WorkspaceError(422, "Choose what you want to manage");
      label.parse(answers.name);
      answers.sections.forEach(section => label.parse(section.name));
      answers.storefronts.forEach(name => label.parse(name));
      if (answers.mode !== "location") {
        z.string().datetime({ offset: true }).parse(answers.startsAt); z.string().datetime({ offset: true }).parse(answers.endsAt);
        if (Date.parse(answers.endsAt) <= Date.parse(answers.startsAt)) throw new WorkspaceError(422, "The event must end after it starts");
        if (!answers.address) throw new WorkspaceError(422, "Enter the event location");
      }
      if (answers.mode === "location" && !answers.sections.length) throw new WorkspaceError(422, "Add at least one section");
      if (answers.mode === "vendor" && !answers.storefronts.length) throw new WorkspaceError(422, "Add at least one storefront");
      if (answers.sections.reduce((total, s) => total + s.tables, 0) > 200) throw new WorkspaceError(422, "Create up to 200 tables during setup. You can add more later.");
      if (answers.mode === "organiser" && answers.sections.some(s => s.tables > 0) && !answers.storefronts.length) throw new WorkspaceError(422, "Set up storefronts before assigning event tables");
      const id = randomUUID(), stamp = new Date().toISOString();
      const base = (name: string) => ({ id: randomUUID(), organizationId: i.tenant.id, name, status: "active", version: 1, createdAt: stamp, updatedAt: stamp });
      const createRecord = async (kind: string, record: any) => tx.workspaceRecord.create({ data: { tenantId: i.tenant.id, kind, id: record.id, data: json(record) } });
      const scopeType = answers.mode === "location" ? "venue" : "event";
      if (scopeType === "venue") {
        const profile = { ...emptyVenueProfile(), name: answers.name, address: answers.address, timezone: answers.timezone };
        await tx.venue.create({ data: { tenantId: i.tenant.id, id, name: answers.name, address: answers.address, status: "active", profile: json(profile), activity: json([{ id: randomUUID(), actor: i.user.name, action: "Created through guided setup", changes: [], createdAt: stamp }]) } });
      } else {
        await createRecord("events", { ...base(answers.name), id, venueId: null, location: answers.address, timezone: answers.timezone, startsAt: answers.startsAt, endsAt: answers.endsAt, organizer: i.tenant.name, notes: "", participation: answers.mode === "vendor" ? "private-vendor" : "organiser" });
      }
      const sections: any[] = [];
      for (const section of answers.sections) {
        const record = { ...base(section.name), scopeType, scopeId: id, kind: "section", parentId: null, storefrontId: null, capacity: Math.max(1, section.tables * 4), qrToken: null };
        await createRecord("floor", record); sections.push(record);
      }
      // The existing ordering engine needs an operator and outlet. Create these internally
      // for locations so a restaurant owner never has to answer vendor setup questions.
      const names = answers.mode === "location" ? [answers.name] : answers.storefronts;
      const stores: string[] = [];
      if (names.length) {
        const vendor = base(i.tenant.name);
        await createRecord("vendors", { ...vendor, kind: "internal", contactName: i.user.name, email: "", phone: "", notes: "" });
        for (const name of names) {
          const storeId = randomUUID(); stores.push(storeId);
          await tx.storefront.create({ data: { tenantId: i.tenant.id, id: storeId, venueId: scopeType === "venue" ? id : null, eventId: scopeType === "event" ? id : null, vendorId: vendor.id, name, kind: "kitchen", status: "active", fulfillment: sections.length ? "table" : "pickup", sectionIds: sections.map(s => s.id), prepStation: "Kitchen" } });
        }
      }
      if (stores.length) for (let n = 0; n < sections.length; n++) for (let table = 1; table <= answers.sections[n].tables; table++) {
        await createRecord("floor", { ...base(`${answers.sections[n].name.slice(0, 80)} — Table ${table}`), scopeType, scopeId: id, kind: "table", parentId: sections[n].id, storefrontId: stores[0], capacity: 4, qrToken: null });
      }
      const data = { ...current, required: false, status: "completed", completedAt: stamp, scopeType, scopeId: id, storefrontIds: stores };
      const changed = await tx.workspaceRecord.updateMany({ where: { ...key(i.tenant.id), version: row.version }, data: { version: { increment: 1 }, data: json(data) } });
      if (!changed.count) throw new WorkspaceError(409, "Your answers changed while creating setup. Review them and try again.");
      return { ...data, version: row.version + 1 };
    }, { timeout: 30_000 });
    res.json(result);
  }));
  return router;
}
