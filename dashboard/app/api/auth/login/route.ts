import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { isDevMode } from "@/lib/server/auth";
import { LoginBody } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { clientIp, NO_CLIENT_IP, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** Failed/attempted sign-ins per minute from one client IP. */
const PER_IP_LIMIT = 5;
/**
 * Ceiling when no per-client identity exists (self-hosted without
 * TRUST_PROXY=1): everyone shares this bucket, so it only guards against a
 * flood; the per-email limit and Supabase Auth's own limits do the rest.
 */
const SHARED_LIMIT = 200;

/** POST { email, password } — sets the session cookies via @supabase/ssr. */
export async function POST(req: NextRequest) {
  if (isDevMode()) return apiError("Auth not configured (DEV MODE)", 503);

  const ip = clientIp(req);
  const ipLimit = rateLimit("auth:login:ip", ip, ip === NO_CLIENT_IP ? SHARED_LIMIT : PER_IP_LIMIT);
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const body = await parseJson(req, LoginBody, { maxBytes: 2_048 });
  if (!body.ok) return body.res;
  const email = body.data.email.toLowerCase();

  const emailLimit = rateLimit("auth:login:email", email, 10);
  if (!emailLimit.ok) return rateLimitResponse(emailLimit);

  const db = getSupabase();
  if (!db) return apiError("Auth not configured", 503);

  const { data, error } = await db.auth.signInWithPassword({
    email,
    password: body.data.password,
  });
  if (error || !data.user) {
    // Generic on purpose: do not reveal whether the account exists.
    return apiError("Invalid credentials", 401);
  }
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
