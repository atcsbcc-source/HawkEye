import { NextResponse } from "next/server";
import { createRule, listRules, setRuleEnabled } from "@/lib/server/ops";
import type { ActionType, TriggerType } from "@/lib/ops-types";

export const dynamic = "force-dynamic";

const TRIGGERS: TriggerType[] = ["scan_processed", "distress_threshold", "mission_completed"];
const ACTIONS: ActionType[] = ["flag_property", "dispatch_webhook", "notify"];

export async function GET() {
  return NextResponse.json({ rules: await listRules() });
}

/** POST { name, triggerType, triggerConfig, actionType, actionConfig } */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (
    !body.name ||
    !TRIGGERS.includes(body.triggerType) ||
    !ACTIONS.includes(body.actionType)
  ) {
    return NextResponse.json(
      { error: "name, valid triggerType and actionType required" },
      { status: 400 }
    );
  }
  const rule = await createRule({
    name: String(body.name),
    triggerType: body.triggerType,
    triggerConfig: body.triggerConfig ?? {},
    actionType: body.actionType,
    actionConfig: body.actionConfig ?? {},
  });
  return NextResponse.json({ rule });
}

/** PATCH { id, enabled } */
export async function PATCH(req: Request) {
  let body: { id?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.id || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "id and enabled required" }, { status: 400 });
  }
  await setRuleEnabled(body.id, body.enabled);
  return NextResponse.json({ ok: true });
}
