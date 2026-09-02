"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  ArrowRightLeft,
  CheckSquare,
  CircleDollarSign,
  Footprints,
  ListTodo,
  Loader2,
  Mail,
  Mailbox,
  MessageSquare,
  Phone,
  Square,
  StickyNote,
} from "lucide-react";
import { dueBucket, fmtMoney } from "@/lib/crm";
import { fmtDateTime } from "@/lib/format";
import { apiJson, fromLocalInput } from "@/lib/ui/api";
import {
  ACTIVITY_KIND_LABEL,
  LOGGABLE_ACTIVITY_KINDS,
  type Activity,
  type ActivityKind,
  type Contact,
} from "@/lib/types";
import { useToast } from "@/components/ui/Toast";

const KIND_ICON: Record<ActivityKind, typeof Phone> = {
  note: StickyNote,
  call: Phone,
  text: MessageSquare,
  email: Mail,
  mailer: Mailbox,
  visit: Footprints,
  offer: CircleDollarSign,
  stage_change: ArrowRightLeft,
  task: ListTodo,
};

const OUTCOMES: Partial<Record<ActivityKind, string[]>> = {
  call: ["answered", "no answer", "left voicemail", "wrong number", "interested", "not interested"],
  text: ["sent", "replied", "opted out"],
  email: ["sent", "replied", "bounced"],
  mailer: ["sent", "returned", "responded"],
  visit: ["vacant", "occupied", "posted notice", "spoke to neighbor"],
  offer: ["sent", "accepted", "countered", "rejected"],
};

const PLACEHOLDER: Record<ActivityKind, string> = {
  note: "What did you learn?",
  call: "Who did you reach and what did they say?",
  text: "Message summary…",
  email: "Subject / summary…",
  mailer: "Letter type, batch…",
  visit: "What did you see on site?",
  offer: "Terms: price, close, contingencies…",
  stage_change: "",
  task: "What needs to happen?",
};

const inTwoDays = () => {
  const d = new Date(Date.now() + 2 * 86_400_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
};

/**
 * Timeline + composer. Tasks are activities with a due date; ticking the box
 * completes them (they stay in the timeline, struck through).
 */
export function ActivityFeed({
  propertyId,
  initial,
  contacts,
}: {
  propertyId: string;
  initial: Activity[];
  contacts: Contact[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<Activity[]>(initial);
  const [kind, setKind] = useState<ActivityKind>("note");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState("");
  const [amount, setAmount] = useState("");
  const [contactId, setContactId] = useState("");
  const [dueAt, setDueAt] = useState(inTwoDays);
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const contactName = (id: string | null) => contacts.find((c) => c.id === id)?.name ?? null;

  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const res = await apiJson<{ activity: Activity }>(
        `/api/properties/${propertyId}/activities`,
        {
          method: "POST",
          body: JSON.stringify({
            kind,
            body: body.trim(),
            outcome: outcome || null,
            amount: kind === "offer" && amount ? Number(amount.replace(/[$,\s]/g, "")) : null,
            contact_id: contactId || null,
            due_at: kind === "task" ? fromLocalInput(dueAt) : null,
          }),
        },
      );
      setItems((xs) => [res.activity, ...xs]);
      setBody("");
      setOutcome("");
      setAmount("");
      toast.success(kind === "task" ? "Task opened" : `${ACTIVITY_KIND_LABEL[kind]} logged`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not log the activity");
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(a: Activity) {
    setToggling(a.id);
    try {
      const res = await apiJson<{ activity: Activity }>(
        `/api/properties/${propertyId}/activities/${a.id}`,
        { method: "PATCH", body: JSON.stringify({ completed: !a.completed_at }) },
      );
      setItems((xs) => xs.map((x) => (x.id === a.id ? res.activity : x)));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the task");
    } finally {
      setToggling(null);
    }
  }

  const openTasks = items.filter((a) => a.kind === "task" && !a.completed_at).length;

  return (
    <section className="panel p-4" aria-labelledby="activity-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="activity-title" className="panel-title">
          Activity
        </h2>
        <span className="font-mono text-[11px] text-slate-400">
          {items.length} entries · {openTasks} open task{openTasks === 1 ? "" : "s"}
        </span>
      </div>

      {/* Composer */}
      <form
        className="mt-3 space-y-2 rounded-lg border border-surface-border bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        aria-label="Log activity"
      >
        <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-1">
          {LOGGABLE_ACTIVITY_KINDS.map((k) => {
            const Icon = KIND_ICON[k];
            const on = k === kind;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setKind(k);
                  setOutcome("");
                }}
                className={clsx(
                  "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition",
                  on
                    ? "bg-sky-700 text-white"
                    : "text-slate-400 hover:bg-surface-hover hover:text-white",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {ACTIVITY_KIND_LABEL[k]}
              </button>
            );
          })}
        </div>
        <textarea
          className="input min-h-[64px] py-2 text-sm"
          placeholder={PLACEHOLDER[kind]}
          value={body}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
        />
        <div className="flex flex-wrap gap-2">
          {OUTCOMES[kind] && (
            <select
              className="input h-8 w-auto text-xs"
              aria-label="Outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            >
              <option value="">Outcome…</option>
              {OUTCOMES[kind]!.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
          {kind === "offer" && (
            <input
              className="input h-8 w-32 font-mono text-xs"
              inputMode="decimal"
              placeholder="$ amount"
              aria-label="Offer amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
          {kind === "task" && (
            <input
              type="datetime-local"
              className="input h-8 w-auto text-xs"
              aria-label="Due"
              value={dueAt}
              required
              onChange={(e) => setDueAt(e.target.value)}
            />
          )}
          {contacts.length > 0 && kind !== "task" && (
            <select
              className="input h-8 w-auto text-xs"
              aria-label="Contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
            >
              <option value="">No contact</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="submit"
            className="btn-primary ml-auto h-8 px-3 text-xs"
            disabled={busy || !body.trim()}
            title="⌘/Ctrl + Enter"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {kind === "task" ? "Open task" : "Log"}
          </button>
        </div>
      </form>

      {/* Timeline */}
      <ol className="mt-4 space-y-2">
        {items.length === 0 && <li className="text-xs text-slate-500">Nothing logged yet.</li>}
        {items.map((a) => {
          const Icon = KIND_ICON[a.kind] ?? StickyNote;
          const isTask = a.kind === "task";
          const done = Boolean(a.completed_at);
          const bucket = isTask && !done ? dueBucket(a.due_at) : null;
          return (
            <li
              key={a.id}
              className={clsx(
                "flex gap-3 rounded-lg border border-surface-border/60 px-3 py-2",
                bucket === "overdue" && "border-red-500/40 bg-red-500/5",
              )}
            >
              {isTask ? (
                <button
                  type="button"
                  className="mt-0.5 shrink-0 text-slate-300 hover:text-white"
                  aria-label={done ? "Reopen task" : "Complete task"}
                  disabled={toggling === a.id}
                  onClick={() => toggleTask(a)}
                >
                  {toggling === a.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : done ? (
                    <CheckSquare className="h-4 w-4 text-emerald-400" aria-hidden />
                  ) : (
                    <Square className="h-4 w-4" aria-hidden />
                  )}
                </button>
              ) : (
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={clsx("text-sm text-slate-100", done && "text-slate-500 line-through")}
                >
                  {a.body}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[11px] text-slate-400">
                  <span>{ACTIVITY_KIND_LABEL[a.kind] ?? a.kind}</span>
                  {a.outcome && <span className="text-sky-300">{a.outcome}</span>}
                  {a.amount != null && (
                    <span className="text-emerald-300">{fmtMoney(a.amount)}</span>
                  )}
                  {contactName(a.contact_id) && <span>with {contactName(a.contact_id)}</span>}
                  {isTask && a.due_at && (
                    <span className={clsx(bucket === "overdue" && "text-red-300")}>
                      due {fmtDateTime(a.due_at)}
                    </span>
                  )}
                  <span>{fmtDateTime(a.created_at)}</span>
                  {a.created_by && <span>· {a.created_by}</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
