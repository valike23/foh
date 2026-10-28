import type { Metadata } from "next";
import "./globals.css";
import { headers } from "next/headers";
import { isOnlineWorkspace } from "../lib/deployment";
import { DeploymentProvider } from "../components/deployment-context";

export const metadata: Metadata = {
  title: "EXA FOH Dashboard",
  description: "Local-network-first front-of-house dashboard for EXA events."
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const online = isOnlineWorkspace((await headers()).get("host") ?? "");
  return (
    <html lang="en" className="dark">
      <body><DeploymentProvider online={online} singleHost={process.env.TENANT_ROUTING_MODE === "single-host"}>{children}</DeploymentProvider></body>
    </html>
  );
}
