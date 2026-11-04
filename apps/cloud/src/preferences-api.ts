import { Router, type Request, type Response, type NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Identity } from "./workspace-access.js";

export function createPreferencesApi(db: PrismaClient, authenticate: (req: Request, res: Response) => Promise<Identity>) {
  const router = Router();
  router.patch("/", (req: Request, res: Response, next: NextFunction) => {
    void authenticate(req, res).then(async i => {
      const input = z.object({ navigationView: z.enum(["location", "events"]) }).strict().parse(req.body);
      const key = { tenantId: i.tenant.id, kind: "user-preferences", id: i.user.id };
      await db.workspaceRecord.upsert({ where: { tenantId_kind_id: key }, create: { ...key, data: input }, update: { data: input, version: { increment: 1 } } });
      res.json(input);
    }).catch(next);
  });
  return router;
}
