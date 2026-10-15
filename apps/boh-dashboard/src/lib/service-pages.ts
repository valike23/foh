export const servicePages = {
  command: "Command",
  sessions: "Service Sessions",
  setup: "Setup",
  "staff-order": "Staff order",
  prep: "Prep",
  inventory: "Inventory",
  payments: "Payments",
  ledger: "Ledger",
  cloud: "Cloud",
  runner: "Runner",
  advanced: "Advanced",
  tables: "Tables",
  audit: "Audit"
} as const;

export type ServicePage = keyof typeof servicePages;
export function isServicePage(value: string): value is ServicePage {
  return Object.prototype.hasOwnProperty.call(servicePages, value);
}
export function servicePageUrl(page: ServicePage, operationId: string) {
  return `/service/${page}?operation=${encodeURIComponent(operationId)}`;
}
