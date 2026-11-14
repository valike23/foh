"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "./pos-icons";

export type PosCustomer = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  spent: number;
  orders: number;
};

export type CustomerSelection = { id: string; name: string; phone: string; email: string };

type Props = {
  operation: string;
  initial: CustomerSelection;
  search: (operation: string, query: string) => Promise<{ items: PosCustomer[] }>;
  onSelect: (customer: CustomerSelection) => void;
  onClose: () => void;
};

export function PosCustomerDialog({ operation, initial, search, onSelect, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [creating, setCreating] = useState(!!initial.name && !initial.id);
  const [draft, setDraft] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    setCustomers([]);
    setError("");
    setLoading(false);
    if (creating || query.trim().length < 2) return;
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      search(operation, query.trim())
        .then(result => { if (active) setCustomers(result.items); })
        .catch(problem => { if (active) setError((problem as Error).message); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, creating, operation, search]);

  function addCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim() && !draft.phone.trim() && !draft.email.trim()) {
      setError("Enter a name, phone number or email.");
      return;
    }
    onSelect({ id: "", name: draft.name.trim(), phone: draft.phone.trim(), email: draft.email.trim() });
  }

  return <dialog ref={dialog} className="pos-customer-dialog" aria-labelledby="pos-customer-title" onCancel={onClose}>
    <header>
      <h2 id="pos-customer-title">{creating ? "New customer" : "Add customer"}</h2>
      <button type="button" aria-label="Close customer popup" onClick={onClose}><X size={20} /></button>
    </header>
    {creating ? <form onSubmit={addCustomer}>
      <label>Name<input aria-label="POS customer name" autoFocus maxLength={100} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Phone (optional)<input aria-label="POS customer phone" type="tel" minLength={7} maxLength={24} value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })} /></label>
      <label>Email (optional)<input aria-label="POS customer email" type="email" maxLength={254} value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} /></label>
      {error && <p role="alert" className="pos-error">{error}</p>}
      <footer><button type="button" onClick={() => { setCreating(false); setError(""); }}>Back to search</button><button className="pos-primary" type="submit">Use customer</button></footer>
    </form> : <>
      <label>Search customers<input aria-label="Search customers" autoFocus placeholder="Name, phone, email or customer code" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} /></label>
      {loading && <p role="status" className="pos-fine">Searching customers…</p>}
      {error && <p role="alert" className="pos-error">{error}</p>}
      {!loading && !error && query.trim().length >= 2 && !customers.length && <p className="pos-fine">No matching customers.</p>}
      <div className="pos-customer-results" aria-label="Matching customers">{customers.map(customer => <button type="button" key={customer.id} onClick={() => onSelect({ id: customer.id, name: customer.name ?? "", phone: customer.phone ?? "", email: customer.email ?? "" })}>
        <strong>{customer.name || "Customer"}</strong>
        <span>{customer.phone || customer.email || customer.id}</span>
        <small>{new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(customer.spent)} paid · {customer.orders} orders in your accessible sales</small>
      </button>)}</div>
      <footer><button type="button" onClick={onClose}>Cancel</button><button type="button" className="pos-primary" onClick={() => { setDraft({ id: "", name: "", phone: "", email: "" }); setCreating(true); setError(""); }}>Add new customer</button></footer>
    </>}
  </dialog>;
}
