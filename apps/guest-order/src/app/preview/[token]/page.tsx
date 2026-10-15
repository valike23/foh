import { GuestOrderApp } from "../../../components/guest-order-app";
import { GuestBrandingFrame } from "@exa-foh/ui";
import type { HubSnapshot } from "@exa-foh/shared";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function Page({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ store?: string }> }) {
  const { token } = await params;
  const { store } = await searchParams;
  let snapshot: HubSnapshot | undefined;
  try {
    const response = await fetch(`${process.env.HUB_INTERNAL_URL ?? "http://127.0.0.1:4000"}/api/manage/menu-preview/${encodeURIComponent(token)}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (response.ok) snapshot = (await response.json()).snapshot;
  } catch { /* A preview must fail closed when the hub is unavailable. */ }
  if (!snapshot?.stores.length) return <GuestBrandingFrame assetBase="" title="Menu preview unavailable"><p>This preview is unavailable. Please ask the organizer for a current link.</p></GuestBrandingFrame>;
  const storeId = snapshot.stores.some(item => item.id === store) ? store! : snapshot.stores[0].id;
  return <GuestOrderApp key={storeId} storeId={storeId} previewSnapshot={snapshot} previewToken={token} initialBranding={snapshot.event.guestBranding} eventName={snapshot.event.name} />;
}
