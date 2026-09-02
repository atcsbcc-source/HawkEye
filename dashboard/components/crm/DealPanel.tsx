"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ArrowRight, CalendarClock, Loader2, Save, Tag } from "lucide-react";
import { ACTIVE_STAGES, fmtMoney, maxAllowableOffer, nextStage } from "@/lib/crm";
import { fmtDateTime } from "@/lib/format";
import { apiJson, fromLocalInput, toLocalInput } from "@/lib/ui/api";
import { CRM_STAGE, PRIORITY_STYLE } from "@/lib/ui/status";
import {
  CRM_STAGES,
  PRIORITIES,
  STAGE_LABEL,
  type CrmStage,
  type Priority,
  type PropertyLead,
} from "@/lib/types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";

interface DealForm {
  priority: Priority;
  assigned_to: string;
  owner_name: string;
  next_action: string;
  next_action_at: string;
  asking_price: string;
  offer_price: string;
  arv: string;
  repair_estimate: string;
  tags: string;
}

function formFrom(lead: PropertyLead): DealForm {
  const n = (v: number | null | undefined) => (v == null ? "" : String(v));
  return {
    priority: lead.priority,
    assigned_to: lead.assigned_to ?? "",
    owner_name: lead.owner_name ?? "",
    next_action: lead.next_action ?? "",
    next_action_at: toLocalInput(lead.next_action_at),
    asking_price: n(lead.asking_price),
    offer_price: n(lead.offer_price),
    arv: n(lead.arv),
    repair_estimate: n(lead.repair_estimate),
    tags: lead.tags.join(", "),
  };
}

const money = (s: string): number | null => {
  const v = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};

/**
 * Right-rail deal card: pipeline stage (with a one-click advance), priority,
 * assignee, owner, next action + due date, the deal numbers with the 70 %
 * MAO, and tags. Explicit save (the notes textarea elsewhere autosaves;
 * numbers should not).
 */
export function DealPanel({ lead }: { lead: PropertyLead }) {
  const router = useRouter();
  const toast = useToast();
  const [stage, setStage] = useState<CrmStage>(lead.crm_stage);
  const [stageBusy, setStageBusy] = useState(false);
  const [form, setForm] = useState<DealForm>(() => formFrom(lead));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof DealForm>(k: K, v: DealForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  async function changeStage(next: CrmStage) {
    if (next === stage) return;
    setStageBusy(true);
    try {
      const res = await apiJson<{ changed: boolean; automation?: { fired: string[] } }>(
        `/api/properties/${lead.id}/stage`,
        { method: "POST", body: JSON.stringify({ stage: next }) },
      );
      setStage(next);
      const fired = res.automation?.fired ?? [];
      toast.success(
        fired.length
          ? `Moved to ${STAGE_LABEL[next]} · ${fired.length} rule${fired.length === 1 ? "" : "s"} fired`
          : `Moved to ${STAGE_LABEL[next]}`,
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the stage");
    } finally {
      setStageBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await apiJson(`/api/properties/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          priority: form.priority,
          assigned_to: form.assigned_to.trim() || null,
          owner_name: form.owner_name.trim() || null,
          next_action: form.next_action.trim() || null,
          next_action_at: fromLocalInput(form.next_action_at),
          asking_price: money(form.asking_price),
          offer_price: money(form.offer_price),
          arv: money(form.arv),
          repair_estimate: money(form.repair_estimate),
          tags: form.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 20),
        }),
      });
      setDirty(false);
      toast.success("Deal saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the deal");
    } finally {
      setSaving(false);
    }
  }

  const advance = nextStage(stage);
  const mao = maxAllowableOffer(money(form.arv), money(form.repair_estimate));
  const offer = money(form.offer_price);
  const spread = mao != null && offer != null ? mao - offer : null;
  const dueMs = form.next_action_at ? new Date(form.next_action_at).getTime() : null;
  const overdue = dueMs != null && dueMs < Date.now();

  return (
    <section className="panel p-4" aria-labelledby="deal-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="deal-title" className="panel-title">
          Deal
        </h2>
        <StatusBadge status={CRM_STAGE[stage]} />
      </div>

      {/* Stage */}
      <div className="mt-3 space-y-2">
        <ol className="flex flex-wrap gap-1" aria-label="Pipeline stages">
          {ACTIVE_STAGES.map((s, i) => {
            const idx = CRM_STAGES.indexOf(stage);
            const done = CRM_STAGES.indexOf(s) < idx;
            const current = s === stage;
            return (
              <li key={s}>
                <button
                  type="button"
                  disabled={stageBusy}
                  onClick={() => changeStage(s)}
                  title={STAGE_LABEL[s]}
                  className={clsx(
                    "h-6 rounded px-1.5 font-mono text-[10px] uppercase tracking-wide transition",
                    current
                      ? "bg-sky-600 text-white"
                      : done
                        ? "bg-sky-500/15 text-sky-300 hover:bg-sky-500/25"
                        : "bg-surface text-slate-500 hover:text-slate-200",
                  )}
                >
                  {i + 1}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap gap-2">
          <select
            className="input h-8 flex-1 text-xs"
            aria-label="Stage"
            value={stage}
            disabled={stageBusy}
            onChange={(e) => changeStage(e.target.value as CrmStage)}
          >
            {CRM_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
          {advance && (
            <button
              type="button"
              className="btn-secondary"
              disabled={stageBusy}
              onClick={() => changeStage(advance)}
              title={`Advance to ${STAGE_LABEL[advance]}`}
            >
              {stageBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              )}
              {STAGE_LABEL[advance]}
            </button>
          )}
        </div>
        {lead.stage_changed_at && (
          <p className="text-[11px] text-slate-500">
            In stage since {fmtDateTime(lead.stage_changed_at)}
          </p>
        )}
      </div>

      {/* Next action */}
      <div className="mt-4 space-y-2 rounded-lg border border-surface-border bg-surface p-3">
        <label className="flex items-center gap-1.5 text-label text-slate-400">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Next action
        </label>
        <input
          className="input h-8 text-xs"
          placeholder="What happens next on this parcel?"
          value={form.next_action}
          maxLength={200}
          onChange={(e) => set("next_action", e.target.value)}
        />
        <input
          type="datetime-local"
          className={clsx("input h-8 text-xs", overdue && "border-red-500/60 text-red-300")}
          aria-label="Next action due"
          value={form.next_action_at}
          onChange={(e) => set("next_action_at", e.target.value)}
        />
      </div>

      {/* People */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-label text-slate-400">Priority</span>
          <select
            className="input h-8 text-xs"
            value={form.priority}
            onChange={(e) => set("priority", e.target.value as Priority)}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_STYLE[p].label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-label text-slate-400">Assigned to</span>
          <input
            className="input h-8 text-xs"
            value={form.assigned_to}
            maxLength={80}
            placeholder="Operator"
            onChange={(e) => set("assigned_to", e.target.value)}
          />
        </label>
        <label className="col-span-2 space-y-1">
          <span className="text-label text-slate-400">Owner of record</span>
          <input
            className="input h-8 text-xs"
            value={form.owner_name}
            maxLength={120}
            placeholder="From the county roll / skip trace"
            onChange={(e) => set("owner_name", e.target.value)}
          />
        </label>
      </div>

      {/* Numbers */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {(
          [
            ["arv", "ARV"],
            ["repair_estimate", "Repairs"],
            ["asking_price", "Asking"],
            ["offer_price", "Our offer"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="space-y-1">
            <span className="text-label text-slate-400">{label}</span>
            <input
              className="input h-8 font-mono text-xs tabular-nums"
              inputMode="decimal"
              value={form[k]}
              placeholder="$"
              onChange={(e) => set(k, e.target.value)}
            />
          </label>
        ))}
      </div>
      <dl className="mt-2 flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-xs">
        <div>
          <dt className="text-label text-slate-400">MAO (70 % ARV − repairs)</dt>
          <dd className="font-mono text-white">{fmtMoney(mao)}</dd>
        </div>
        <div className="text-right">
          <dt className="text-label text-slate-400">Room vs offer</dt>
          <dd
            className={clsx(
              "font-mono",
              spread == null ? "text-slate-500" : spread >= 0 ? "text-emerald-300" : "text-red-300",
            )}
          >
            {spread == null ? "—" : `${spread >= 0 ? "+" : "−"}${fmtMoney(Math.abs(spread))}`}
          </dd>
        </div>
      </dl>

      {/* Tags */}
      <label className="mt-4 block space-y-1">
        <span className="flex items-center gap-1.5 text-label text-slate-400">
          <Tag className="h-3.5 w-3.5" aria-hidden /> Tags
        </span>
        <input
          className="input h-8 text-xs"
          value={form.tags}
          placeholder="probate, tax-lien, absentee"
          onChange={(e) => set("tags", e.target.value)}
        />
      </label>

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-500">{dirty ? "Unsaved changes" : "Saved"}</span>
        <button
          type="button"
          className="btn-primary h-8 px-3 text-xs"
          disabled={!dirty || saving}
          onClick={save}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Save className="h-3.5 w-3.5" aria-hidden />
          )}
          Save deal
        </button>
      </div>
    </section>
  );
}
