import { notFound, redirect } from "next/navigation";
import { BohDashboardApp } from "../../../components/boh-dashboard-app";
import { isServicePage } from "../../../lib/service-pages";

export default async function Page({ params, searchParams }: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ operation?: string }>;
}) {
  const { section } = await params;
  if (!isServicePage(section)) notFound();
  const { operation } = await searchParams;
  if (!operation) redirect("/operations");
  return <BohDashboardApp key={`${operation}:${section}`} page={section} />;
}
