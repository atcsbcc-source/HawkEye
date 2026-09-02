import { NextResponse } from "next/server";
import { evaluateRules } from "@/lib/server/ops";
import type { TriggerType } from "@/lib/ops-types";

export const dynamic = "force-dynamic";

const TRIGGERS: TriggerType[] = ["scan_processed", "distress_threshold", "mission_completed"];

/**
 * POST { trigger, payload } — fire the automation engine for an external
 * event. The CV pipeline calls this after each scan upsert
 * (payload: { property_id, vacancy_confidence, ... }).
 */
export async function POST(req: Request) {
  let body: { trigger?: TriggerType; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.trigger || !TRIGGERS.includes(body.trigger)) {
    return NextResponse.json({ error: "valid trigger required" }, { status: 400 });
  }
  const result = await evaluateRules(body.trigger, body.payload ?? {});
  return NextResponse.json(result);
}
