"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Clock, Loader2, Search } from "lucide-react";
import { dueBucket, fmtMoney, isClosedStage, nextStage, previousStage } from "@/lib/crm";
import { fmtDate } from "@/lib/format";
import { apiJson } from "@/lib/ui/api";
import { CRM_STAGE } from "@/lib/ui/status";
import { CRM_STAGES, STAGE_LABEL, type CrmStage, type PropertyLead } from "@/lib/types";

/**
 * Kanban of every tracked parcel by pipeline stage. Cards move with the
 * ‹ › buttons (POST /stage); closed columns collapse behind a toggle.
 */
export function PipelineBoard({ leads }: { leads: PropertyLead[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, CrmStage>>({});

  const stageOf = (l: PropertyLead) => local[l.id] ?? l.crm_stage;

  const columns = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = leads.filter(
      (l) =>
        !q ||
        l.address.toLowerCase().includes(q) ||
        l.parcel_id.toLowerCase().includes(q) ||
        (l.owner_name ?? "").toLowerCase().includes(q) ||
        l.tags.some((t) => t.includes(q)),
    );
    return CRM_STAGES.filter((s) => showClosed || !isClosedStage(s)).map((stage) => ({
      stage,
      cards: filtered
        .filter((l) => stageOf(l) === stage)
        .sort((a, b) => {
          const pa = a.priority === "high" ? 0 : a.priority === "normal" ? 1 : 2;
          const pb = b.priority === "high" ? 0 : b.priority === "normal" ? 1 : 2;
          if (pa !== pb) return pa - pb;
          return (b.latest_vacancy_confidence ?? -1) - (a.latest_vacancy_confidence ?? -1);
        }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, query, showClosed, local]);

  async function move(lead: PropertyLead, to: CrmStage | null) {
    if (!to) return;
    setBusy(lead.id);
    try {
      await apiJson(`/api/properties/${lead.id}/stage`, {
        method: "POST",
        body: JSON.stringify({ stage: to }),
      });
      setLocal((m) => ({ ...m, [lead.id]: to }));
      router.refresh();
    } catch {
      /* toast lives on the detail page; the card simply stays put */
    } finally {
      setBusy(null);
    }
  }

  const closedCount = leads.filter((l) => isClosedStage(stageOf(l))).length;

  return (
    <section className="panel" aria-labelledby="board-title">
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-border p-4">
        <h2 id="board-title" className="sr-only">
          Pipeline board
        </h2>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Address, APN, owner, tag…"
            aria-label="Search the pipeline"
            className="input w-full pl-8 sm:w-64"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowClosed((v) => !v)}
          aria-pressed={showClosed}
          className={clsx(
            "btn h-9 border px-3 text-xs",
            showClosed ? "border-sky-500/50 text-sky-300" : "border-surface-border text-slate-400",
          )}
        >
          Closed ({closedCount})
        </button>
        <span className="ml-auto font-mono text-[11px] text-slate-400">{leads.length} parcels</span>
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-max gap-3 p-4">
          {columns.map(({ stage, cards }) => (
            <div key={stage} className="w-64 shrink-0">
              <div className="mb-2 flex items-center justify-between">
                <span
                  className={clsx(
                    "inline-flex items-center gap-1.5 text-label font-semibold uppercase",
                    CRM_STAGE[stage].badge.split(" ").find((c) => c.startsWith("text-")),
                  )}
                >
                  <span
                    className={clsx("h-1.5 w-1.5 rounded-full", CRM_STAGE[stage].dot)}
                    aria-hidden
                  />
                  {STAGE_LABEL[stage]}
                </span>
                <span className="font-mono text-[11px] text-slate-500">{cards.length}</span>
              </div>
              <ul className="space-y-2">
                {cards.map((l) => {
                  const bucket = l.next_action ? dueBucket(l.next_action_at) : null;
                  const prev = previousStage(stage);
                  const next = nextStage(stage);
                  return (
                    <li
                      key={l.id}
                      className={clsx(
                        "rounded-lg border border-surface-border bg-surface p-3 transition hover:border-sky-500/40",
                        l.priority === "high" && "border-l-2 border-l-red-500",
                      )}
                    >
                      <Link
                        href={`/properties/${l.id}`}
                        className="block truncate text-sm font-medium text-white hover:text-sky-300"
                      >
                        {l.address}
                      </Link>
                      <p className="font-mono text-[11px] text-slate-400">
                        APN {l.parcel_id}
                        {l.latest_vacancy_confidence != null &&
                          ` · ${l.latest_vacancy_confidence}/100`}
                        {l.days_distressed != null && ` · ${l.days_distressed} d`}
                      </p>
                      {l.owner_name && (
                        <p className="mt-1 truncate text-xs text-slate-300">{l.owner_name}</p>
                      )}
                      {(l.offer_price != null || l.arv != null) && (
                        <p className="mt-1 font-mono text-[11px] text-slate-400">
                          {l.offer_price != null && `offer ${fmtMoney(l.offer_price)}`}
                          {l.offer_price != null && l.arv != null && " · "}
                          {l.arv != null && `ARV ${fmtMoney(l.arv)}`}
                        </p>
                      )}
                      {l.next_action && (
                        <p
                          className={clsx(
                            "mt-1.5 inline-flex items-center gap-1 text-[11px]",
                            bucket === "overdue"
                              ? "text-red-300"
                              : bucket === "today"
                                ? "text-amber-300"
                                : "text-slate-400",
                          )}
                        >
                          <Clock className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">
                            {l.next_action}
                            {l.next_action_at && ` · ${fmtDate(l.next_action_at)}`}
                          </span>
                        </p>
                      )}
                      {l.tags.length > 0 && (
                        <p className="mt-1.5 flex flex-wrap gap-1">
                          {l.tags.map((t) => (
                            <span
                              key={t}
                              className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                            >
                              {t}
                            </span>
                          ))}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <button
                          type="button"
                          className="btn-ghost h-6 px-1.5"
                          aria-label={prev ? `Back to ${STAGE_LABEL[prev]}` : "No earlier stage"}
                          disabled={!prev || busy === l.id}
                          onClick={() => move(l, prev)}
                        >
                          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        {busy === l.id ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin text-slate-400"
                            aria-hidden
                          />
                        ) : (
                          l.assigned_to && (
                            <span className="truncate text-[11px] text-slate-500">
                              {l.assigned_to}
                            </span>
                          )
                        )}
                        <button
                          type="button"
                          className="btn-ghost h-6 px-1.5"
                          aria-label={next ? `Advance to ${STAGE_LABEL[next]}` : "No later stage"}
                          disabled={!next || busy === l.id}
                          onClick={() => move(l, next)}
                        >
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
                {cards.length === 0 && (
                  <li className="rounded-lg border border-dashed border-surface-border p-3 text-center text-[11px] text-slate-500">
                    Empty
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
