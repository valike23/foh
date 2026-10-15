import { Suspense } from "react";
import { VenueScreen } from "../../../../components/venue-pages";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Suspense fallback={<p>Loading venue...</p>}><VenueScreen id={id} /></Suspense>; }
