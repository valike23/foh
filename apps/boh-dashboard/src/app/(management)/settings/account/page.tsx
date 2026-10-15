"use client";
import { useManagementUser } from "../../../../components/management-shell";
export default function Page() {
  const user = useManagementUser();
  return <><p className="eyebrow">Settings</p><h1 className="page-title">Account & access</h1><dl className="mt-8 max-w-xl divide-y divide-border">{[["Name", user?.name], ["Email", user?.email], ["Role", user?.role], ["Venue access", user?.role === "owner" ? "All venues" : `${user?.venueIds.length ?? 0} assigned venues`], ["Session duration", "12 hours"]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-5 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="break-all text-right capitalize">{value}</dd></div>)}</dl></>;
}
