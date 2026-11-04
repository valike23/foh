"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkspaceSetup } from "../../../components/management-shell";

export default function Page() {
  const router = useRouter();
  const { open } = useWorkspaceSetup();
  useEffect(() => { open(); router.replace("/dashboard"); }, [router]);
  return null;
}
