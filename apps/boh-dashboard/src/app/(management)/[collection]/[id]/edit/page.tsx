import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BusinessRecordPage } from "../../../../../components/business-pages";
import type { BusinessKind } from "@exa-foh/shared";
export default async function Page({ params }: { params: Promise<{ collection: string; id: string }> }) {
  const { collection, id } = await params;
  if (!["events", "vendors", "storefronts", "floor"].includes(collection)) notFound();
  return <Suspense fallback={<p>Loading...</p>}><BusinessRecordPage kind={collection as BusinessKind} id={id} editing /></Suspense>;
}
