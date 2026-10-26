import test from "node:test";
import assert from "node:assert/strict";
import { tenantFromHost, validTenantSlug } from "../dist/tenant-host.js";

test("tenant resolution matches exactly one subdomain and ignores port", () => {
  assert.equal(tenantFromHost("app.localhost:4200", "localhost"), null);
  assert.equal(tenantFromHost("localhost:4200", "localhost"), null);
  assert.equal(tenantFromHost("CLUB53.localhost:4200", "localhost"), "club53");
  assert.equal(tenantFromHost("club53.example.com", "example.com"), "club53");
  for (const value of ["evil.com", "club53.localhost.evil.com", "one.two.localhost", "api.localhost", "club53.localhost@evil.com", "club53.localhost/path", "-club.localhost"]) assert.throws(() => tenantFromHost(value, "localhost"), value);
});
test("tenant slugs exclude reserved names and malformed labels", () => {
  assert.equal(validTenantSlug("club53"), true);
  assert.equal(validTenantSlug("harbour-point"), true);
  for (const value of ["app", "www", "admin", "ab", "Club53", "-club", "club-", "club.name", "a".repeat(49)]) assert.equal(validTenantSlug(value), false, value);
});
