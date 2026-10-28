import { GuestOrdering } from "../../../components/guest-ordering";
export const metadata = { title: "Menu & ordering", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ storefrontId: string }> }) {
  return <GuestOrdering storefrontId={(await params).storefrontId} />;
}
