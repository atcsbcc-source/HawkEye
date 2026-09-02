"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowRight, Loader2, Plus, Zap } from "lucide-react";
import {
  ACTION_LABELS,
  TRIGGER_LABELS,
  type ActionType,
  type AuditEvent,
  type AutomationRule,
  type TriggerType,
} from "@/lib/ops-types";
import { fmtDateTime } from "@/lib/format";
import { AUTO_FLAG_CONFIDENCE, DISTRESS_THRESHOLD_DAYS } from "@/lib/constants";
import {
  CRM_STAGES,
  STAGE_LABEL,
  VERDICT_LABEL,
  VERIFICATION_VERDICTS,
  type CrmStage,
  type VerificationVerdict,
} from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { RefreshBadge } from "@/components/ui/RefreshBadge";
import { AuditFeed } from "./AuditFeed";

// Defaults mirror the pipeline's auto-flag confidence and the distress window.
const DEFAULT_MIN_CONFIDENCE = AUTO_FLAG_CONFIDENCE;
const DEFAULT_MIN_DAYS = DISTRESS_THRESHOLD_DAYS;

export function AutomationPanel() {
  const toast = useToast();
  const [rules, setRules] = useState<AutomationRule[] | null>(null);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [rr, er] = await Promise.all([fetch("/api/automation"), fetch("/api/audit")]);
      if (!rr.ok || !er.ok) throw new Error("refresh failed");
      const [r, e] = await Promise.all([rr.json(), er.json()]);
      setRules(r.rules ?? []);
      setEvents(e.events ?? []);
      setPollFailed(false);
      setLastOk(Date.now());
    } catch {
      setPollFailed(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  async function toggle(rule: AutomationRule) {
    const next = !rule.enabled;
    // Optimistic flip; revert on failure.
    setRules((prev) => prev?.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)) ?? prev);
    setTogglingId(rule.id);
    try {
      const res = await fetch("/api/automation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.id, enabled: next }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          msg = ((await res.json()) as { error?: string }).error ?? msg;
        } catch {
          /* non-JSON */
        }
        throw new Error(msg);
      }
      toast.success(`${rule.name} ${next ? "enabled" : "disabled"}`);
    } catch (err) {
      setRules(
        (prev) =>
          prev?.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)) ?? prev,
      );
      toast.error(
        `Could not ${next ? "enable" : "disable"} ${rule.name}: ${
          err instanceof Error ? err.message : "network error"
        }`,
      );
    } finally {
      setTogglingId(null);
      refresh();
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 className="panel-title">Automation rules</h2>
            {rules !== null && <RefreshBadge failed={pollFailed} lastOk={lastOk} />}
          </div>
          <button
            type="button"
            onClick={() => setShowBuilder((v) => !v)}
            aria-expanded={showBuilder}
            aria-controls="rule-builder"
            className="btn-secondary border-sky-500/50 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20"
          >
            <Plus className="h-3 w-3" aria-hidden /> New rule
          </button>
        </div>

        {showBuilder && (
          <RuleBuilder
            onCreated={(rule) => {
              setShowBuilder(false);
              toast.success(`Created rule ${rule.name}`);
              refresh();
            }}
            onCancel={() => setShowBuilder(false)}
          />
        )}

        {rules === null ? (
          <SkeletonRows rows={3} />
        ) : rules.length === 0 ? (
          <p className="panel p-6 text-center text-sm text-slate-400">
            No rules yet. Create one to flag, dispatch, or notify automatically when scans land.
          </p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li key={rule.id} className="panel p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Zap
                      className={clsx(
                        "h-4 w-4 shrink-0",
                        rule.enabled ? "text-amber-400" : "text-slate-500",
                      )}
                      aria-hidden
                    />
                    <p className="truncate text-sm font-medium text-white">{rule.name}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={rule.enabled}
                    disabled={togglingId === rule.id}
                    onClick={() => toggle(rule)}
                    className={clsx(
                      "relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-60",
                      rule.enabled ? "bg-emerald-500" : "bg-slate-600",
                    )}
                  >
                    <span className="sr-only">{rule.name}</span>
                    <span
                      aria-hidden
                      className={clsx(
                        "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                        rule.enabled ? "left-[18px]" : "left-0.5",
                      )}
                    />
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <Chip>
                    WHEN {TRIGGER_LABELS[rule.triggerType]}
                    {rule.triggerType === "scan_processed" &&
                      ` ≥ ${rule.triggerConfig.min_confidence ?? DEFAULT_MIN_CONFIDENCE}`}
                    {rule.triggerType === "distress_threshold" &&
                      ` ≥ ${rule.triggerConfig.min_days ?? DEFAULT_MIN_DAYS} d`}
                    {rule.triggerType === "verdict_recorded" &&
                      ` = ${verdictLabel(rule.triggerConfig.verdict)}`}
                    {rule.triggerType === "stage_changed" &&
                      ` → ${stageLabel(rule.triggerConfig.stage)}`}
                  </Chip>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                  <Chip tone="amber">
                    THEN {ACTION_LABELS[rule.actionType]}
                    {rule.actionType === "set_stage" && `: ${stageLabel(rule.actionConfig.stage)}`}
                    {rule.actionType === "create_task" &&
                      `: "${String(rule.actionConfig.title ?? "")}" +${rule.actionConfig.due_in_days ?? 3} d`}
                  </Chip>
                </div>

                <p className="mt-2 font-mono text-[11px] text-slate-400">
                  fired {rule.fireCount}×
                  {rule.lastFiredAt && ` · last ${fmtDateTime(rule.lastFiredAt)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AuditFeed events={events} pollFailed={pollFailed} lastOk={lastOk} />
    </div>
  );
}

const verdictLabel = (v: unknown) =>
  typeof v === "string" && v in VERDICT_LABEL
    ? VERDICT_LABEL[v as VerificationVerdict]
    : "any verdict";
const stageLabel = (v: unknown) =>
  typeof v === "string" && v in STAGE_LABEL ? STAGE_LABEL[v as CrmStage] : "any stage";

function Chip({ children, tone = "sky" }: { children: React.ReactNode; tone?: "sky" | "amber" }) {
  return (
    <span
      className={clsx(
        "rounded-md border px-2 py-1 font-mono text-[11px] uppercase tracking-wide",
        tone === "sky"
          ? "border-sky-500/40 bg-sky-500/10 text-sky-200"
          : "border-amber-500/40 bg-amber-500/10 text-amber-200",
      )}
    >
      {children}
    </span>
  );
}

function RuleBuilder({
  onCreated,
  onCancel,
}: {
  onCreated: (rule: AutomationRule) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("scan_processed");
  const [threshold, setThreshold] = useState(String(DEFAULT_MIN_CONFIDENCE));
  const [actionType, setActionType] = useState<ActionType>("flag_property");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [verdict, setVerdict] = useState<VerificationVerdict | "">("verified_vacant");
  const [triggerStage, setTriggerStage] = useState<CrmStage | "">("");
  const [stage, setStage] = useState<CrmStage>("researching");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDays, setTaskDays] = useState("3");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const triggerConfig =
      triggerType === "scan_processed"
        ? { min_confidence: Number(threshold) || DEFAULT_MIN_CONFIDENCE }
        : triggerType === "distress_threshold"
          ? { min_days: Number(threshold) || DEFAULT_MIN_DAYS }
          : triggerType === "verdict_recorded"
            ? verdict
              ? { verdict }
              : {}
            : triggerType === "stage_changed"
              ? triggerStage
                ? { stage: triggerStage }
                : {}
              : {};
    const actionConfig =
      actionType === "dispatch_webhook"
        ? webhookUrl
          ? { url: webhookUrl }
          : {}
        : actionType === "set_stage"
          ? { stage }
          : actionType === "create_task"
            ? { title: taskTitle.trim(), due_in_days: Math.max(0, Number(taskDays) || 0) }
            : {};
    try {
      const res = await fetch("/api/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          triggerType,
          triggerConfig,
          actionType,
          actionConfig,
        }),
      });
      let body: { rule?: AutomationRule; error?: string } = {};
      try {
        body = await res.json();
      } catch {
        /* non-JSON */
      }
      if (!res.ok || !body.rule) {
        setError(body.error ?? `Could not create rule (HTTP ${res.status})`);
        return;
      }
      onCreated(body.rule);
    } catch {
      setError("Network error — the rule was not saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      id="rule-builder"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="panel space-y-3 border-sky-500/30 p-4"
      aria-label="New rule"
    >
      <input
        className="input"
        placeholder="Rule name…"
        aria-label="Rule name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <select
          className="input"
          aria-label="Trigger"
          value={triggerType}
          onChange={(e) => {
            const t = e.target.value as TriggerType;
            setTriggerType(t);
            setThreshold(
              String(t === "distress_threshold" ? DEFAULT_MIN_DAYS : DEFAULT_MIN_CONFIDENCE),
            );
          }}
        >
          {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => (
            <option key={t} value={t}>
              WHEN: {TRIGGER_LABELS[t]}
            </option>
          ))}
        </select>
        {triggerType === "scan_processed" || triggerType === "distress_threshold" ? (
          <input
            className="input"
            type="number"
            min={0}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            aria-label={triggerType === "scan_processed" ? "Minimum confidence" : "Minimum days"}
            placeholder={triggerType === "scan_processed" ? "Min confidence" : "Min days"}
          />
        ) : triggerType === "verdict_recorded" ? (
          <select
            className="input"
            aria-label="Verdict"
            value={verdict}
            onChange={(e) => setVerdict(e.target.value as VerificationVerdict | "")}
          >
            <option value="">Any verdict</option>
            {VERIFICATION_VERDICTS.map((v) => (
              <option key={v} value={v}>
                {VERDICT_LABEL[v]}
              </option>
            ))}
          </select>
        ) : triggerType === "stage_changed" ? (
          <select
            className="input"
            aria-label="Stage entered"
            value={triggerStage}
            onChange={(e) => setTriggerStage(e.target.value as CrmStage | "")}
          >
            <option value="">Any stage</option>
            {CRM_STAGES.map((st) => (
              <option key={st} value={st}>
                Enters {STAGE_LABEL[st]}
              </option>
            ))}
          </select>
        ) : (
          <div />
        )}
        <select
          className="input"
          aria-label="Action"
          value={actionType}
          onChange={(e) => setActionType(e.target.value as ActionType)}
        >
          {(Object.keys(ACTION_LABELS) as ActionType[]).map((a) => (
            <option key={a} value={a}>
              THEN: {ACTION_LABELS[a]}
            </option>
          ))}
        </select>
      </div>
      {actionType === "dispatch_webhook" && (
        <input
          className="input"
          type="url"
          placeholder="Webhook URL (blank = CRM_WEBHOOK_URL)"
          aria-label="Webhook URL"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
        />
      )}
      {actionType === "set_stage" && (
        <select
          className="input"
          aria-label="Target stage"
          value={stage}
          onChange={(e) => setStage(e.target.value as CrmStage)}
        >
          {CRM_STAGES.map((st) => (
            <option key={st} value={st}>
              Move to {STAGE_LABEL[st]}
            </option>
          ))}
        </select>
      )}
      {actionType === "create_task" && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <input
            className="input"
            placeholder="Task title (e.g. Skip-trace the owner)"
            aria-label="Task title"
            value={taskTitle}
            maxLength={200}
            onChange={(e) => setTaskTitle(e.target.value)}
          />
          <input
            className="input"
            type="number"
            min={0}
            max={365}
            aria-label="Due in days"
            placeholder="Due in days"
            value={taskDays}
            onChange={(e) => setTaskDays(e.target.value)}
          />
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
        >
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim() || (actionType === "create_task" && !taskTitle.trim())}
          className="btn-primary"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {saving ? "Saving…" : "Create rule"}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost h-9">
          Cancel
        </button>
      </div>
    </form>
  );
}
