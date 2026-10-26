import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizeBrandLogo } from "../dist/tenant-branding.js";

test("optional logo defaults and image validation do not depend on PostgreSQL", async () => {
  assert.equal(await normalizeBrandLogo(undefined), null);
  assert.equal(await normalizeBrandLogo(null), null);
  for (const value of ["https://example.com/logo.png", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,bm90IGFuIGltYWdl", `data:image/png;base64,${Buffer.alloc(512 * 1024 + 1).toString("base64")}`]) await assert.rejects(() => normalizeBrandLogo(value));
  const png = await sharp({ create: { width: 500, height: 250, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const result = await normalizeBrandLogo(`data:image/png;base64,${png.toString("base64")}`);
  assert.match(result, /^data:image\/webp;base64,/);
  const image = await sharp(Buffer.from(result.split(",")[1], "base64")).metadata();
  assert.equal(image.width, 256); assert.equal(image.height, 128); assert.equal(image.hasAlpha, true);
});
