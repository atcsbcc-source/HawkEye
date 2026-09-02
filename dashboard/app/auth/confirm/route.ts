import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const OTP_TYPES = new Set<EmailOtpType>(["invite", "recovery", "email", "magiclink", "signup", "email_change"]);

/**
 * GET /auth/confirm?token_hash=...&type=invite|recovery
 *
 * Target of Supabase invite / password-recovery emails (set the email
 * templates to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}`).
 * Exchanges the token for a session cookie and sends the user to set a password.
 */
export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const type = req.nextUrl.searchParams.get("type") as EmailOtpType | null;

  const fail = req.nextUrl.clone();
  fail.pathname = "/login";
  fail.search = "?error=invalid_link";

  if (!tokenHash || !type || !OTP_TYPES.has(type) || tokenHash.length > 512) {
    return NextResponse.redirect(fail);
  }
  const db = getSupabase();
  if (!db) return NextResponse.redirect(fail);

  const { error } = await db.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(fail);

  const next = req.nextUrl.clone();
  next.pathname = "/auth/set-password";
  next.search = "";
  return NextResponse.redirect(next);
}
