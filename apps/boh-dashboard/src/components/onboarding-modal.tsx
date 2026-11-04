"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { WorkspaceOnboarding } from "./workspace-onboarding";

export function OnboardingModal({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current!; node.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { node.close(); document.body.style.overflow = previous; }; }, []);
  function saveAndClose() {
    const exit = dialog.current?.querySelector<HTMLButtonElement>("[data-onboarding-exit]");
    if (exit) exit.click(); else close();
  }
  return <dialog ref={dialog} aria-label="Business onboarding" onCancel={event => { event.preventDefault(); saveAndClose(); }} className="management fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none overflow-y-auto border-0 bg-background p-0 text-foreground backdrop:bg-background">
    <div className="flex justify-end px-4 pt-4 sm:px-8"><button type="button" aria-label="Save and close onboarding" onClick={saveAndClose} className="rounded-lg border border-border p-2"><X size={20} /></button></div>
    <div className="px-4 py-6 sm:px-8"><WorkspaceOnboarding onClose={close} /></div>
  </dialog>;
}
