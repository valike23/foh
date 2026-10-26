import sharp from "sharp";
import { z } from "zod";

export const brandingSchema = {
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a valid six-digit hex colour").nullable().optional(),
  brandLogo: z.string().max(710000, "Logo must be 512 KB or smaller").nullable().optional()
};

export async function normalizeBrandLogo(value?: string | null): Promise<string | null> {
  if (!value) return null;
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error("Upload a static PNG, JPEG or WebP logo");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length > 512 * 1024 || bytes.toString("base64") !== match[1]) throw new Error("Logo must be a valid image of 512 KB or smaller");
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, animated: true });
    const metadata = await image.metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw new Error("Unsupported image");
    const content = await image.rotate().resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    return `data:image/webp;base64,${content.toString("base64")}`;
  } catch { throw new Error("Upload a valid, static PNG, JPEG or WebP logo under 16 megapixels"); }
}
