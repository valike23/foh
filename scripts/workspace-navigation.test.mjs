import test from "node:test";
import assert from "node:assert/strict";
import { workspaceNavigation } from "../apps/boh-dashboard/src/lib/workspace-navigation.ts";

test("sidebar features follow the selected business flow", () => {
  const visible = mode => Object.entries(workspaceNavigation(mode, true)).filter(([, enabled]) => enabled).map(([key]) => key);
  assert.deepEqual(visible("location"), ["venues", "sections", "operations"]);
  assert.deepEqual(visible("vendor"), ["events", "storefronts", "sections", "operations"]);
  assert.deepEqual(visible("organiser"), ["events", "vendors", "storefronts", "sections", "operations"]);
  assert.deepEqual(visible(null), [], "unselected onboarding should not show every business feature");
  assert.equal(workspaceNavigation(null, false).venues, true);
  assert.equal(workspaceNavigation(null, false).events, false);
  assert.equal(workspaceNavigation("location", true, "events").venues, false);
  assert.equal(workspaceNavigation("location", true, "events").events, true);
  assert.equal(workspaceNavigation("organiser", true, "location").events, false);
  assert.equal(workspaceNavigation("vendor", true, "events").vendors, false, "a vendor's own event flow does not manage participating vendors");
});
