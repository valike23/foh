import { OnlineAuth } from "../../components/online-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Page() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:5173";
  const domain = process.env.TENANT_BASE_DOMAIN ?? "localhost";
  const authority = new URL(`http://${host}`);
  const protocol = process.env.WORKSPACE_PUBLIC_ORIGIN?.startsWith("https:") ? "https:" : "http:";
  const signup = new URL("/signup", process.env.WORKSPACE_PUBLIC_ORIGIN ?? `${protocol}//app.${domain}${authority.port ? `:${authority.port}` : ""}`);
  if (authority.host !== signup.host) redirect(signup.href);
  return <OnlineAuth signup />;
}
