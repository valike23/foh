import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BusinessDirectory } from "../../../components/business-pages";
import type { BusinessKind } from "@exa-foh/shared";
export default async function Page({ params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  if (!["events", "vendors", "storefronts", "floor"].includes(collection)) notFound();
  return <Suspense fallback={<p>Loading...</p>}><BusinessDirectory kind={collection as BusinessKind} /></Suspense>;
}
