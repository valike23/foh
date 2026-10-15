import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Router, type Request } from "express";
import sharp from "sharp";
import { z } from "zod";
import { defaultGuestBranding, type GuestBranding, type ManagedEvent, type ManagementUser } from "@exa-foh/shared";
import { OperationError } from "./operation-runtime.js";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const assetId = z.string().uuid().nullable();
const brandingSchema = z.object({
  theme: z.enum(["standard", "night-market", "blueprint", "club53"]).optional(),
  socialUrl: z.union([z.literal(""), z.string().url().max(500).refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; })]).optional(),
  backgroundColor: color, surfaceColor: color, accentColor: color, backgroundImageId: assetId,
  backgroundMode: z.enum(["cover", "tile"]), headerImageId: assetId, fontPreset: z.enum(["system", "serif", "mono"]),
  fontAssetId: assetId, fontName: z.string().trim().max(100),
  sponsors: z.array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(100), logoAssetId: z.string().uuid(),
    website: z.union([z.literal(""), z.string().url().max(500).refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }, "Use an HTTPS website")]) }).strict()).max(20)
    .refine(items => new Set(items.map(item => item.id)).size === items.length, "Sponsor IDs must be unique")
}).strict();

export function createGuestBranding({ db, organizationId, authorize, log }: {
  db: DatabaseSync; organizationId: string;
  authorize: (request: Request, id: string, write: boolean) => { user: ManagementUser; event: ManagedEvent };
  log: (id: string, actor: string, action: string) => void;
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS guest_branding (event_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS guest_branding_assets (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, event_id TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, name TEXT NOT NULL, content BLOB NOT NULL);`);
  const router = Router();
  function read(id: string): { branding: GuestBranding; version: number } {
    const row = db.prepare("SELECT data, version FROM guest_branding WHERE event_id = ? AND organization_id = ?").get(id, organizationId) as { data: string; version: number } | undefined;
    return row ? { branding: JSON.parse(row.data), version: row.version } : { branding: defaultGuestBranding(), version: 0 };
  }
  router.get("/events/:id/branding", (request, response) => {
    const { event, user } = authorize(request, String(request.params.id), false);
    response.json({ ...read(event.id), eventName: event.name, canEdit: user.role !== "viewer" && event.status !== "archived" });
  });
  router.patch("/events/:id/branding", (request, response) => {
    const { event, user } = authorize(request, String(request.params.id), true);
    const input = z.object({ version: z.number().int().nonnegative(), branding: brandingSchema }).strict().parse(request.body);
    if (event.status === "archived") throw new OperationError(409, "Restore the event before changing its appearance");
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = read(event.id);
      if (current.version !== input.version) throw new OperationError(409, "Appearance changed elsewhere. Reload before saving.");
      const refs: [string | null, string][] = [[input.branding.backgroundImageId, "image"], [input.branding.headerImageId, "image"], [input.branding.fontAssetId, "font"], ...input.branding.sponsors.map(s => [s.logoAssetId, "image"] as [string, string])];
      for (const [id, kind] of refs) if (id && !db.prepare("SELECT id FROM guest_branding_assets WHERE id = ? AND event_id = ? AND organization_id = ? AND kind = ?").get(id, event.id, organizationId, kind)) throw new OperationError(422, "Choose an uploaded asset belonging to this event");
      db.prepare("INSERT INTO guest_branding VALUES (?, ?, ?, ?) ON CONFLICT(event_id) DO UPDATE SET version = excluded.version, data = excluded.data")
        .run(event.id, organizationId, current.version + 1, JSON.stringify(input.branding));
      log(event.id, user.name, "Updated guest page appearance");
      db.exec("COMMIT");
      response.json({ ...read(event.id), eventName: event.name, canEdit: true });
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  });
  router.post("/events/:id/branding/assets", async (request, response, next) => {
    try {
      const id = String(request.params.id);
      const { event } = authorize(request, id, true);
      if (event.status === "archived") throw new OperationError(409, "Restore the event before uploading assets");
      const input = z.object({ kind: z.enum(["image", "font"]), name: z.string().trim().min(1).max(160), base64: z.string().min(4).max(7_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict().parse(request.body);
      let bytes = Buffer.from(input.base64, "base64");
      if (bytes.length > (input.kind === "image" ? 5_000_000 : 2_000_000)) throw new OperationError(413, "Images must be under 5 MB and fonts under 2 MB");
      let mime: string;
      if (input.kind === "image") {
        try {
          const processor = sharp(bytes, { limitInputPixels: 16_000_000, failOn: "warning" });
          const metadata = await processor.metadata();
          if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw new Error("Unsupported image");
          bytes = await processor.rotate().resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
          mime = "image/webp";
        } catch { throw new OperationError(422, "Upload a valid, static PNG, JPEG or WebP image (up to 16 megapixels)"); }
      } else {
        const signature = bytes.subarray(0, 4).toString("ascii");
        if (bytes.length < 48 || !["wOFF", "wOF2"].includes(signature) || bytes.readUInt32BE(8) !== bytes.length || bytes.readUInt32BE(16) > 20_000_000) throw new OperationError(422, "Upload a valid WOFF or WOFF2 font");
        mime = signature === "wOF2" ? "font/woff2" : "font/woff";
      }
      // Recheck access after image decoding and before persisting an upload.
      const latest = authorize(request, id, true);
      if (latest.event.status === "archived") throw new OperationError(409, "This event is archived");
      const size = db.prepare("SELECT COALESCE(SUM(length(content)), 0) AS size FROM guest_branding_assets WHERE event_id = ? AND organization_id = ?").get(id, organizationId) as { size: number };
      if (size.size + bytes.length > 100_000_000) throw new OperationError(413, "This event has reached its 100 MB asset limit");
      const asset = { id: randomUUID(), kind: input.kind, name: input.name };
      db.prepare("INSERT INTO guest_branding_assets VALUES (?, ?, ?, ?, ?, ?, ?)").run(asset.id, organizationId, id, input.kind, mime, input.name, bytes);
      response.status(201).json(asset);
    } catch (error) { next(error); }
  });
  // Branding files are public, immutable media, served without exposing storage paths.
  router.get("/branding-assets/:id", (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const asset = db.prepare("SELECT mime, content FROM guest_branding_assets WHERE id = ? AND organization_id = ?").get(id, organizationId) as { mime: string; content: Uint8Array } | undefined;
    if (!asset) throw new OperationError(404, "Asset not found");
    response.set({ "Content-Type": asset.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" });
    response.send(Buffer.from(asset.content));
  });
  return { router, getBranding: (id: string) => read(id).branding };
}
