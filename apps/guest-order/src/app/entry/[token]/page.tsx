import { GuestBrandingFrame } from "@exa-foh/ui";
import type { GuestBranding } from "@exa-foh/shared";
import { GuestOrderApp } from "../../../components/guest-order-app";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let entry: { name?: string; eventName?: string; guestBranding?: GuestBranding; storefrontName?: string; open?: boolean; storeId?: string; tableId?: string; seatId?: string; error?: string };
  try {
    const response = await fetch(`${process.env.HUB_INTERNAL_URL ?? "http://127.0.0.1:4000"}/api/manage/entry/${encodeURIComponent(token)}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    entry = await response.json();
    if (!response.ok) entry = { error: entry.error ?? "QR code unavailable" };
  } catch { entry = { error: "Unable to reach the venue. Please try again shortly." }; }
  if (entry.open && entry.storeId) return <GuestOrderApp storeId={entry.storeId} tableId={entry.tableId} seatId={entry.seatId} entryToken={token} initialBranding={entry.guestBranding} eventName={entry.eventName} />;
  return <GuestBrandingFrame branding={entry.guestBranding} assetBase={`${process.env.NEXT_PUBLIC_HUB_URL ?? "http://localhost:4000"}/api/manage/branding-assets`} title={entry.error ? "QR code unavailable" : entry.eventName ?? entry.storefrontName ?? entry.name ?? "Guest menu"} subtitle={entry.error ? undefined : entry.storefrontName}>
    <main className="bg-card p-6"><p>{entry.error ?? "Service is not open for this location."}</p></main>
  </GuestBrandingFrame>;
}
