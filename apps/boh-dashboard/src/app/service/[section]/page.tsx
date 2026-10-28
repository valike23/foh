import { notFound, redirect } from "next/navigation";
import { BohDashboardApp } from "../../../components/boh-dashboard-app";
import { isServicePage } from "../../../lib/service-pages";
import { headers } from "next/headers";
import { isOnlineWorkspace } from "../../../lib/deployment";

export default async function Page({ params, searchParams }: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ operation?: string }>;
}) {
  const { section } = await params;
  if (!isServicePage(section)) notFound();
  const { operation } = await searchParams;
  if (!operation) redirect("/operations");
  if (isOnlineWorkspace((await headers()).get("host") ?? "")) {
    const target = ["setup", "inventory"].includes(section) ? "stock" : ["payments", "ledger"].includes(section) ? "payments" : section === "prep" ? "orders" : section === "staff-order" ? "sales" : ["tables", "runner"].includes(section) ? "floor-control" : "overview";
    redirect(`/${target}?operation=${encodeURIComponent(operation)}`);
  }
  return <BohDashboardApp key={`${operation}:${section}`} page={section} />;
}
