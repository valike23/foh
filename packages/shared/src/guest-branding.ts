export type GuestBranding = {
  theme?: "standard" | "night-market" | "blueprint" | "club53";
  socialUrl?: string;
  backgroundColor: string;
  surfaceColor: string;
  accentColor: string;
  backgroundImageId: string | null;
  backgroundMode: "cover" | "tile";
  headerImageId: string | null;
  fontPreset: "system" | "serif" | "mono";
  fontAssetId: string | null;
  fontName: string;
  sponsors: { id: string; name: string; logoAssetId: string; website: string }[];
};

export function defaultGuestBranding(): GuestBranding {
  return { backgroundColor: "#0a0a0a", surfaceColor: "#111111", accentColor: "#8447df", backgroundImageId: null,
    backgroundMode: "cover", headerImageId: null, fontPreset: "system", fontAssetId: null, fontName: "", sponsors: [] };
}

export type GuestBrandingDetail = { branding: GuestBranding; version: number; eventName: string; canEdit: boolean };

export function readableText(hex: string): string {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

export function colorHsl(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return `${h.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`;
}
