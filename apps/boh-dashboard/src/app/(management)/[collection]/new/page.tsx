import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BusinessEditor } from "../../../../components/business-pages";
import type { BusinessKind } from "@exa-foh/shared";
export default async function Page({ params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  if (!["events", "vendors", "storefronts", "floor"].includes(collection)) notFound();
  return <Suspense fallback={<p>Loading...</p>}><BusinessEditor kind={collection as BusinessKind} /></Suspense>;
}
