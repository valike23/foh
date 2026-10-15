import { Suspense } from "react";
import { VenueDirectory } from "../../../components/venue-pages";
export default function Page() { return <Suspense fallback={<p>Loading venues...</p>}><VenueDirectory /></Suspense>; }
