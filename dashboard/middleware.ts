import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware: session refresh + first-line auth gate + CSRF checks.
 *
 * DEV MODE (no NEXT_PUBLIC_SUPABASE_URL): pass everything through untouched
 * (plus an `x-hawkeye-dev-mode: 1` header) so the mock console keeps working.
 *
 * Route handlers re-check auth themselves (lib/server/auth.ts) — this layer
 * is deliberately not the only guard.
 */

/** Routes a valid pipeline/cron bearer token may call without a cookie session. */
export const BEARER_ROUTES = ["/api/automation/evaluate", "/api/automation/sweep"] as const;

const BEARER_ENV_VARS = ["HAWKEYE_PIPELINE_TOKEN", "CRON_SECRET"] as const;
const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function isDevMode(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/** Constant-time string compare (edge runtime has no timingSafeEqual). */
function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function hasValidBearer(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const token = m[1].trim();
  return BEARER_ENV_VARS.some((name) => {
    const expected = process.env[name];
    return Boolean(expected && expected.length >= 16 && safeEqual(token, expected));
  });
}

function requestHosts(req: NextRequest): string[] {
  const hosts = new Set<string>();
  const host = req.headers.get("host");
  if (host) hosts.add(host.toLowerCase());
  if (process.env.TRUST_PROXY === "1") {
    const fwd = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (fwd) hosts.add(fwd.toLowerCase());
  }
  hosts.add(req.nextUrl.host.toLowerCase());
  return Array.from(hosts);
}

/** Returns a reason string when a cookie-authenticated mutation looks cross-site. */
function csrfViolation(req: NextRequest): string | null {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;

  if (req.headers.get("sec-fetch-site") === "cross-site") return "cross-site request";

  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return "malformed origin";
    }
    if (!requestHosts(req).includes(originHost)) return "origin mismatch";
  } else if (origin === "null") {
    return "opaque origin";
  }

  if (MUTATING.has(method)) {
    const ct = (req.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.startsWith("application/json")) return "content-type must be application/json";
  }
  return null;
}

function json(status: number, body: Record<string, unknown>, from?: NextResponse): NextResponse {
  const res = NextResponse.json(body, { status });
  from?.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}

export async function middleware(req: NextRequest) {
  if (isDevMode()) {
    const res = NextResponse.next();
    res.headers.set("x-hawkeye-dev-mode", "1");
    return res;
  }

  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Pipeline / cron bearer routes: token auth, no cookies -> no CSRF surface.
  if (BEARER_ROUTES.some((r) => pathname === r) && hasValidBearer(req)) {
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    return isApi
      ? json(503, { error: "Auth not configured" })
      : new NextResponse("Auth not configured: set NEXT_PUBLIC_SUPABASE_ANON_KEY", { status: 503 });
  }

  // @supabase/ssr request/response cookie bridge (refreshes expiring sessions).
  let response = NextResponse.next({ request: req });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        response = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (isApi) return json(401, { error: "Authentication required" }, response);
    const login = req.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(login);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  const violation = csrfViolation(req);
  if (violation) return json(403, { error: `Request blocked: ${violation}` }, response);

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, the generated icons, and the auth surface.
    "/((?!_next/static|_next/image|favicon\\.ico|icon|apple-icon|login|auth/|api/auth/).*)",
  ],
};
