"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  Ban,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { apiJson } from "@/lib/ui/api";
import {
  CONTACT_CHANNELS,
  CONTACT_ROLES,
  CONTACT_ROLE_LABEL,
  type Contact,
  type ContactChannel,
  type ContactRole,
} from "@/lib/types";
import { useToast } from "@/components/ui/Toast";

interface ContactForm {
  name: string;
  role: ContactRole;
  phone: string;
  email: string;
  mailing_address: string;
  preferred_channel: ContactChannel | "";
  do_not_contact: boolean;
  source: string;
  notes: string;
}

const EMPTY: ContactForm = {
  name: "",
  role: "owner",
  phone: "",
  email: "",
  mailing_address: "",
  preferred_channel: "",
  do_not_contact: false,
  source: "",
  notes: "",
};

const formFrom = (c: Contact): ContactForm => ({
  name: c.name,
  role: c.role,
  phone: c.phone ?? "",
  email: c.email ?? "",
  mailing_address: c.mailing_address ?? "",
  preferred_channel: c.preferred_channel ?? "",
  do_not_contact: c.do_not_contact,
  source: c.source ?? "",
  notes: c.notes ?? "",
});

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
const smsHref = (phone: string) => `sms:${phone.replace(/[^\d+]/g, "")}`;

/** People attached to the parcel, with click-to-call / text / email. */
export function ContactsCard({ propertyId, initial }: { propertyId: string; initial: Contact[] }) {
  const router = useRouter();
  const toast = useToast();
  const [contacts, setContacts] = useState<Contact[]>(initial);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [form, setForm] = useState<ContactForm>(EMPTY);
  const [busy, setBusy] = useState(false);

  function open(c?: Contact) {
    setForm(c ? formFrom(c) : EMPTY);
    setEditing(c ? c.id : "new");
  }

  async function submit() {
    setBusy(true);
    const body = {
      ...form,
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      mailing_address: form.mailing_address.trim() || null,
      preferred_channel: form.preferred_channel || null,
      source: form.source.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (editing === "new") {
        const res = await apiJson<{ contact: Contact }>(`/api/properties/${propertyId}/contacts`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        setContacts((cs) => [...cs, res.contact]);
        toast.success(`Added ${res.contact.name}`);
      } else if (editing) {
        const res = await apiJson<{ contact: Contact }>(
          `/api/properties/${propertyId}/contacts/${editing}`,
          { method: "PATCH", body: JSON.stringify(body) },
        );
        setContacts((cs) => cs.map((c) => (c.id === editing ? res.contact : c)));
        toast.success("Contact updated");
      }
      setEditing(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the contact");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Contact) {
    if (!window.confirm(`Delete ${c.name}? Logged calls and notes keep their text.`)) return;
    try {
      await apiJson(`/api/properties/${propertyId}/contacts/${c.id}`, { method: "DELETE" });
      setContacts((cs) => cs.filter((x) => x.id !== c.id));
      toast.info(`Deleted ${c.name}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the contact");
    }
  }

  return (
    <section className="panel p-4" aria-labelledby="contacts-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="contacts-title" className="panel-title">
          Contacts
        </h2>
        <button type="button" className="btn-ghost h-7 px-2" onClick={() => open()}>
          <UserPlus className="h-3.5 w-3.5" aria-hidden /> Add
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {contacts.length === 0 && editing === null && (
          <li className="text-xs text-slate-500">
            No contacts yet — skip-trace the owner and add them here.
          </li>
        )}
        {contacts.map((c) => (
          <li
            key={c.id}
            className={clsx(
              "rounded-lg border border-surface-border bg-surface p-3",
              c.do_not_contact && "border-red-500/40",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{c.name}</p>
                <p className="text-[11px] text-slate-400">
                  {CONTACT_ROLE_LABEL[c.role]}
                  {c.preferred_channel && ` · prefers ${c.preferred_channel}`}
                  {c.source && ` · ${c.source}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="btn-ghost h-7 w-7 px-0"
                  aria-label={`Edit ${c.name}`}
                  onClick={() => open(c)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn-ghost h-7 w-7 px-0 hover:text-red-300"
                  aria-label={`Delete ${c.name}`}
                  onClick={() => remove(c)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>
            {c.do_not_contact ? (
              <p className="mt-2 inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300">
                <Ban className="h-3 w-3" aria-hidden /> Do not contact
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {c.phone && (
                  <>
                    <a href={telHref(c.phone)} className="btn-secondary h-7">
                      <Phone className="h-3 w-3" aria-hidden /> {c.phone}
                    </a>
                    <a href={smsHref(c.phone)} className="btn-ghost h-7" title="Text">
                      <MessageSquare className="h-3 w-3" aria-hidden /> Text
                    </a>
                  </>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="btn-ghost h-7" title={c.email}>
                    <Mail className="h-3 w-3" aria-hidden /> Email
                  </a>
                )}
              </div>
            )}
            {c.mailing_address && (
              <p className="mt-2 text-[11px] text-slate-400">{c.mailing_address}</p>
            )}
            {c.notes && <p className="mt-1 text-xs text-slate-300">{c.notes}</p>}
          </li>
        ))}
      </ul>

      {editing !== null && (
        <form
          className="mt-3 space-y-2 rounded-lg border border-sky-500/30 bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          aria-label={editing === "new" ? "New contact" : "Edit contact"}
        >
          <div className="flex items-center justify-between">
            <span className="text-label text-slate-400">
              {editing === "new" ? "New contact" : "Edit contact"}
            </span>
            <button
              type="button"
              className="btn-ghost h-7 w-7 px-0"
              aria-label="Cancel"
              onClick={() => setEditing(null)}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <input
            className="input h-8 text-xs"
            placeholder="Full name"
            value={form.name}
            maxLength={120}
            required
            autoFocus
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              className="input h-8 text-xs"
              aria-label="Role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as ContactRole })}
            >
              {CONTACT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {CONTACT_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <select
              className="input h-8 text-xs"
              aria-label="Preferred channel"
              value={form.preferred_channel}
              onChange={(e) =>
                setForm({ ...form, preferred_channel: e.target.value as ContactChannel | "" })
              }
            >
              <option value="">Any channel</option>
              {CONTACT_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  Prefers {c}
                </option>
              ))}
            </select>
            <input
              className="input h-8 text-xs"
              placeholder="Phone"
              type="tel"
              value={form.phone}
              maxLength={40}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <input
              className="input h-8 text-xs"
              placeholder="Email"
              type="email"
              value={form.email}
              maxLength={254}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <input
            className="input h-8 text-xs"
            placeholder="Mailing address"
            value={form.mailing_address}
            maxLength={300}
            onChange={(e) => setForm({ ...form, mailing_address: e.target.value })}
          />
          <input
            className="input h-8 text-xs"
            placeholder="Source (county roll, skip trace, neighbor…)"
            value={form.source}
            maxLength={80}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
          />
          <textarea
            className="input h-16 py-2 text-xs"
            placeholder="Notes"
            value={form.notes}
            maxLength={2000}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={form.do_not_contact}
              onChange={(e) => setForm({ ...form, do_not_contact: e.target.checked })}
            />
            Do not contact
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost h-8" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary h-8 px-3 text-xs"
              disabled={busy || !form.name.trim()}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {editing === "new" ? "Add contact" : "Save"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
