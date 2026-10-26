import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isOnlineWorkspace } from "../lib/deployment";

export default async function Page() {
  const host = (await headers()).get("host") ?? "";
  redirect(isOnlineWorkspace(host) && host.split(":")[0] === `app.${process.env.TENANT_BASE_DOMAIN ?? "localhost"}` ? "/signup" : "/dashboard");
}
