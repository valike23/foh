import { GuestOrderApp } from "../components/guest-order-app";

type PageProps = {
  searchParams?: Promise<{
    store?: string;
    table?: string;
    seat?: string;
    phone?: string;
    promo?: string;
  }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  return <GuestOrderApp storeId={params?.store ?? "store-main-bar"} tableId={params?.table} seatId={params?.seat} initialPhone={params?.phone} initialPromo={params?.promo} />;
}
