import { NextResponse } from "next/server";
import { createRule, listRules, setRuleEnabled } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { RuleCreate, RulePatch } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { assertSafeWebhookUrl, WebhookError } from "@/lib/server/safe-fetch";

export const dynamic = "force-dynamic";

const MAX_RULES = 100;

export const GET = withAuth(async () => {
  return NextResponse.json({ rules: await listRules() });
});

/** POST { name, triggerType, triggerConfig, actionType, actionConfig } */
export const POST = withAuth(async (req, user) => {
  const rl = rateLimit("automation:post", user.id, 20);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, RuleCreate);
  if (!body.ok) return body.res;
  const input = body.data;

  if (input.actionConfig.url) {
    try {
      await assertSafeWebhookUrl(input.actionConfig.url);
    } catch (err) {
      const reason = err instanceof WebhookError ? err.message : "invalid webhook url";
      return apiError(`actionConfig.url rejected: ${reason}`, 400);
    }
  }

  if ((await listRules()).length >= MAX_RULES) {
    return apiError(`At most ${MAX_RULES} automation rules are allowed`, 409);
  }

  const rule = await createRule({
    name: input.name,
    triggerType: input.triggerType,
    triggerConfig: input.triggerConfig,
    actionType: input.actionType,
    actionConfig: input.actionConfig.url ? { url: input.actionConfig.url } : {},
  });
  return NextResponse.json({ rule });
});

/** PATCH { id, enabled } */
export const PATCH = withAuth(async (req, user) => {
  const rl = rateLimit("automation:patch", user.id, 30);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, RulePatch);
  if (!body.ok) return body.res;
  const { id, enabled } = body.data;

  // setRuleEnabled returns void today; integrator may swap to its boolean return.
  const exists = (await listRules()).some((r) => r.id === id);
  if (!exists) return apiError("Rule not found", 404);

  await setRuleEnabled(id, enabled);
  return NextResponse.json({ ok: true });
});
