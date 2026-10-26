import type { CSSProperties } from "react";

export type TenantBrand = { name: string; slug?: string; brandColor?: string | null; brandLogo?: string | null };
export const brandPresets = [
  { name: "Violet", color: "#8b5cf6" }, { name: "Ocean", color: "#2563eb" },
  { name: "Forest", color: "#16805d" }, { name: "Rose", color: "#be3455" },
  { name: "Amber", color: "#d49a25" }
];

export function tenantBrandStyle(color?: string | null): CSSProperties {
  if (!color || !/^#[a-f0-9]{6}$/i.test(color)) return {};
  const [r, g, b] = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255);
  const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low;
  const lightness = (high + low) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = delta === 0 ? 0 : high === r ? ((g - b) / delta) % 6 : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  const linear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const ink = luminance > 0.179 ? "#111318" : "#ffffff";
  return { "--tenant-brand-color": color, "--tenant-brand-ink": ink, "--primary": `${hue.toFixed(1)} ${(saturation * 100).toFixed(1)}% ${(lightness * 100).toFixed(1)}%`, "--primary-foreground": ink === "#ffffff" ? "0 0% 100%" : "0 0% 7%", "--ring": `${hue.toFixed(1)} ${(saturation * 100).toFixed(1)}% ${(lightness * 100).toFixed(1)}%` } as CSSProperties;
}
