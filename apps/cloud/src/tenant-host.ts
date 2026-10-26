const reserved = new Set(["app", "www", "api", "admin", "auth", "cloud", "static", "assets", "mail", "support", "localhost"]);

export function validTenantSlug(slug: string): boolean {
  return /^[a-z][a-z0-9-]{1,46}[a-z0-9]$/.test(slug) && !reserved.has(slug);
}

// Deliberately ignores X-Forwarded-Host and caller-selected tenant headers.
export function tenantFromHost(host: string, baseDomain: string): string | null {
  if (!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host)) throw new Error("Invalid host");
  const hostname = host.toLowerCase().split(":")[0];
  if (hostname === baseDomain || hostname === `app.${baseDomain}`) return null;
  const suffix = `.${baseDomain}`;
  if (!hostname.endsWith(suffix)) throw new Error("Host is outside the configured domain");
  const slug = hostname.slice(0, -suffix.length);
  if (!validTenantSlug(slug)) throw new Error("Invalid tenant subdomain");
  return slug;
}
