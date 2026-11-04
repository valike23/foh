export type WorkspaceMode = "location" | "organiser" | "vendor" | null;
export type NavigationView = "location" | "events";
export function resolveNavigationView(mode: WorkspaceMode, view?: string | null): NavigationView {
  return view === "events" || (view !== "location" && (mode === "organiser" || mode === "vendor")) ? "events" : "location";
}

// Business relevance supplements, rather than replaces, the user's role checks.
// Workspaces created before guided setup keep their existing navigation.
export function workspaceNavigation(mode: WorkspaceMode, setupStarted: boolean, view?: NavigationView | null) {
  const selected = resolveNavigationView(mode, view);
  const ready = !!view || !!mode || !setupStarted;
  return {
    venues: ready && selected === "location",
    events: ready && selected === "events",
    vendors: ready && selected === "events" && mode !== "vendor",
    storefronts: ready && selected === "events",
    sections: ready,
    operations: ready,
  };
}
