export type VenueStatus = "draft" | "active" | "paused" | "archived";
export type VenueHours = { day: string; closed: boolean; opens: string; closes: string };
export type VenueProfile = {
  name: string;
  address: string;
  city: string;
  timezone: string;
  businessDayCutoff: string;
  contactName: string;
  email: string;
  phone: string;
  capacity: number | null;
  notes: string;
  hours: VenueHours[];
};
export type ManagedVenue = VenueProfile & {
  id: string;
  organizationId: string;
  status: VenueStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type VenueActivity = {
  id: string;
  venueId: string;
  actor: string;
  action: string;
  changes: string[];
  createdAt: string;
};
export type ManagementUser = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "manager" | "viewer";
  venueIds: string[];
};
export type VenueDetail = {
  venue: ManagedVenue;
  activity: VenueActivity[];
  canEdit: boolean;
  archiveBlockers: string[];
  linkedService: { id: string; name: string; type: "event" | "venue"; status: string } | null;
};
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export type BusinessKind = "events" | "vendors" | "storefronts" | "floor";
export type ScopeRef = { scopeType: "venue" | "event"; scopeId: string };
export type BusinessRecord = {
  id: string; organizationId: string; version: number; createdAt: string; updatedAt: string;
  name: string; status: string;
};
export type ManagedEvent = BusinessRecord & {
  venueId: string | null; location: string; timezone: string; startsAt: string; endsAt: string;
  organizer: string; notes: string; legacyUnitId?: string;
};
export type ManagedVendor = BusinessRecord & {
  kind: "internal" | "external"; contactName: string; email: string; phone: string; notes: string;
};
export type ManagedStorefront = BusinessRecord & ScopeRef & {
  vendorId: string; kind: "bar" | "kitchen" | "bottle-service" | "merch";
  prepStation: string; manualConfirmation: boolean; fulfillment: "pickup" | "table" | "seat";
  sectionIds: string[]; commercialTerms: string; notes: string; qrToken: string | null; legacyStoreId?: string;
};
export type FloorPlace = BusinessRecord & ScopeRef & {
  kind: "section" | "table" | "seat"; parentId: string | null; storefrontId: string | null;
  capacity: number; qrToken: string | null; legacyPlaceId?: string;
};
export type BusinessEntity = ManagedEvent | ManagedVendor | ManagedStorefront | FloorPlace;
export type BusinessOption = { id: string; name: string; status: string; scopeType?: "venue" | "event"; scopeId?: string; kind?: string; parentId?: string | null };
export type BusinessOptions = { venues: BusinessOption[]; events: BusinessOption[]; vendors: BusinessOption[]; storefronts: BusinessOption[]; floor: BusinessOption[] };
export type BusinessDetail = {
  record: BusinessEntity; activity: { id: string; actor: string; action: string; createdAt: string }[];
  canEdit: boolean; blockers: string[]; readiness: { label: string; complete: boolean }[];
  transitions: string[]; linkedService: boolean;
};
export function emptyVenueProfile(): VenueProfile {
  return {
    name: "", address: "", city: "", timezone: "Africa/Lagos", businessDayCutoff: "04:00",
    contactName: "", email: "", phone: "", capacity: null, notes: "",
    hours: WEEKDAYS.map(day => ({ day, closed: false, opens: "16:00", closes: "02:00" }))
  };
}
