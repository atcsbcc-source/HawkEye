"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowRight, Plus, Zap } from "lucide-react";
import {
  ACTION_LABELS,
  TRIGGER_LABELS,
  type ActionType,
  type AuditEvent,
  type AutomationRule,
  type TriggerType,
} from "@/lib/ops-types";
import { AuditFeed } from "./AuditFeed";

export function AutomationPanel() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [r, e] = await Promise.all([
        fetch("/api/automation").then((x) => x.json()),
        fetch("/api/audit").then((x) => x.json()),
      ]);
      setRules(r.rules ?? []);
      setEvents(e.events ?? []);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  async function toggle(rule: AutomationRule) {
    await fetch("/api/automation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }),
    }).catch(() => undefined);
    refresh();
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            Automation rules
          </p>
          <button
            onClick={() => setShowBuilder((v) => !v)}
            className="flex items-center gap-1 rounded-md border border-sky-500/50 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-300 transition hover:bg-sky-500/20"
          >
            <Plus className="h-3 w-3" /> NEW RULE
          </button>
        </div>

        {showBuilder && (
          <RuleBuilder
            onCreated={() => {
              setShowBuilder(false);
              refresh();
            }}
          />
        )}

        <ul className="space-y-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="rounded-xl border border-surface-border bg-surface-raised p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Zap
                    className={clsx(
                      "h-4 w-4 shrink-0",
                      rule.enabled ? "text-amber-400" : "text-slate-600"
                    )}
                  />
                  <p className="truncate text-sm font-medium text-white">{rule.name}</p>
                </div>
                <button
                  onClick={() => toggle(rule)}
                  className={clsx(
                    "relative h-5 w-9 shrink-0 rounded-full transition",
                    rule.enabled ? "bg-emerald-500" : "bg-slate-600"
                  )}
                  aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
                >
                  <span
                    className={clsx(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                      rule.enabled ? "left-[18px]" : "left-0.5"
                    )}
                  />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <Chip>
                  WHEN {TRIGGER_LABELS[rule.triggerType]}
                  {rule.triggerType === "scan_processed" &&
                    ` ≥ ${rule.triggerConfig.min_confidence ?? 75}`}
                  {rule.triggerType === "distress_threshold" &&
                    ` ≥ ${rule.triggerConfig.min_days ?? 60}d`}
                </Chip>
                <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
                <Chip tone="amber">THEN {ACTION_LABELS[rule.actionType]}</Chip>
              </div>

              <p className="mt-2 font-mono text-[10px] text-slate-500">
                fired {rule.fireCount}×
                {rule.lastFiredAt &&
                  ` · last ${new Date(rule.lastFiredAt).toLocaleString()}`}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <AuditFeed events={events} />
    </div>
  );
}

function Chip({
  children,
  tone = "sky",
}: {
  children: React.ReactNode;
  tone?: "sky" | "amber";
}) {
  return (
    <span
      className={clsx(
        "rounded-md border px-2 py-1 font-mono text-[11px] uppercase tracking-wide",
        tone === "sky"
          ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
          : "border-amber-500/40 bg-amber-500/10 text-amber-300"
      )}
    >
      {children}
    </span>
  );
}

function RuleBuilder({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("scan_processed");
  const [threshold, setThreshold] = useState("75");
  const [actionType, setActionType] = useState<ActionType>("flag_property");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    const triggerConfig =
      triggerType === "scan_processed"
        ? { min_confidence: Number(threshold) || 75 }
        : triggerType === "distress_threshold"
          ? { min_days: Number(threshold) || 60 }
          : {};
    const actionConfig =
      actionType === "dispatch_webhook" && webhookUrl ? { url: webhookUrl } : {};
    await fetch("/api/automation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, triggerType, triggerConfig, actionType, actionConfig }),
    }).catch(() => undefined);
    setSaving(false);
    onCreated();
  }

  const input =
    "w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-sky-500";

  return (
    <div className="space-y-3 rounded-xl border border-sky-500/30 bg-surface-raised p-4">
      <input
        className={input}
        placeholder="Rule name…"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <select
          className={input}
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value as TriggerType)}
        >
          {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => (
            <option key={t} value={t}>
              WHEN: {TRIGGER_LABELS[t]}
            </option>
          ))}
        </select>
        {triggerType !== "mission_completed" ? (
          <input
            className={input}
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder={triggerType === "scan_processed" ? "Min confidence" : "Min days"}
          />
        ) : (
          <div />
        )}
        <select
          className={input}
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
          className={input}
          placeholder="Webhook URL (blank = CRM_WEBHOOK_URL)"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
        />
      )}
      <button
        onClick={save}
        disabled={saving || !name.trim()}
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Create rule"}
      </button>
    </div>
  );
}
