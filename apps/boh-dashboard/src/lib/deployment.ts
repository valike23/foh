export function isOnlineWorkspace(host: string): boolean {
  if (process.env.EXA_DEPLOYMENT_MODE === "onsite") return false;
  const domain = process.env.TENANT_BASE_DOMAIN ?? "localhost";
  const hostname = host.toLowerCase().split(":")[0];
  return process.env.EXA_DEPLOYMENT_MODE === "online" || hostname.endsWith(`.${domain}`);
}
