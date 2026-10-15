import { redirect } from "next/navigation";
import { servicePageUrl } from "../../lib/service-pages";
export default async function Page({ searchParams }: { searchParams: Promise<{ operation?: string }> }) {
  const { operation } = await searchParams;
  if (!operation) redirect("/operations");
  redirect(servicePageUrl("command", operation));
}
