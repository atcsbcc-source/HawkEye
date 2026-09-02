import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST — sign out and redirect to /login. Called from the SessionChip
 * `<form method="post">`; this route sits outside the middleware matcher so
 * it does its own same-origin check.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      /* fallthrough */
    }
    const host = (req.headers.get("host") ?? req.nextUrl.host).toLowerCase();
    if (originHost !== host && originHost !== req.nextUrl.host.toLowerCase()) {
      return NextResponse.json({ error: "Request blocked: origin mismatch" }, { status: 403 });
    }
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Request blocked: cross-site request" }, { status: 403 });
  }

  const db = getSupabase();
  if (db) await db.auth.signOut();

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login, { status: 303 });
}
