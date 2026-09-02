import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { forwardedHop } from "@/lib/server/rate-limit";

/**
 * Edge middleware: session refresh + first-line auth gate + CSRF checks.
 *
 * DEV MODE (no NEXT_PUBLIC_SUPABASE_URL): pass everything through untouched
 * (plus an `x-hawkeye-dev-mode: 1` header) so the mock console keeps working.
 *
 * Route handlers re-check auth themselves (lib/server/auth.ts) — this layer
 * is deliberately not the only guard.
 */

/**
 * Routes a machine bearer token may call without a cookie session, each bound
 * to exactly one env var: the pipeline token never opens the sweep and the
 * cron secret never opens the evaluator.
 */
export const BEARER_ROUTES: Record<string, "HAWKEYE_PIPELINE_TOKEN" | "CRON_SECRET"> = {
  "/api/automation/evaluate": "HAWKEYE_PIPELINE_TOKEN",
  "/api/automation/sweep": "CRON_SECRET",
};

/**
 * Non-JSON request bodies the UI legitimately sends, per route. Everything
 * else that is not application/json is rejected (a cross-site <form> can only
 * produce urlencoded / multipart / text-plain bodies, so the JSON requirement
 * is the CSRF backstop behind the Origin / Sec-Fetch-Site checks).
 */
const NON_JSON_BODIES: Record<string, string[]> = {
  "/api/properties/import": ["multipart/form-data", "text/csv", "application/geo+json"],
};

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

function hasValidBearer(req: NextRequest, pathname: string): boolean {
  const envVar = BEARER_ROUTES[pathname];
  if (!envVar) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const token = m[1].trim();
  const expected = process.env[envVar];
  return Boolean(expected && expected.length >= 16 && safeEqual(token, expected));
}

function requestHosts(req: NextRequest): string[] {
  const hosts = new Set<string>();
  const host = req.headers.get("host");
  if (host) hosts.add(host.toLowerCase());
  if (process.env.TRUST_PROXY === "1") {
    // Same hop rule as clientIp(): the entry our own proxy wrote, never the first.
    const fwd = forwardedHop(req.headers.get("x-forwarded-host"));
    if (fwd) hosts.add(fwd.toLowerCase());
  }
  hosts.add(req.nextUrl.host.toLowerCase());
  return Array.from(hosts);
}

/**
 * Content-type backstop for mutating methods. Body-less DELETEs (the archive
 * button) carry no content-type and cannot be produced by a cross-site form;
 * the import route additionally accepts the upload types the dialog sends.
 */
function contentTypeViolation(req: NextRequest, method: string, pathname: string): string | null {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.startsWith("application/json")) return null;
  if (method === "DELETE" && ct === "") return null;
  const allowed = NON_JSON_BODIES[pathname] ?? [];
  if (allowed.some((t) => ct.startsWith(t))) return null;
  return allowed.length > 0
    ? `content-type must be application/json or ${allowed.join(" / ")}`
    : "content-type must be application/json";
}

/** Returns a reason string when a cookie-authenticated mutation looks cross-site. */
export function csrfViolation(req: NextRequest): string | null {
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

  return contentTypeViolation(req, method, req.nextUrl.pathname);
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
  if (hasValidBearer(req, pathname)) {
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
          response.cookies.set(name, value, options),
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
    // Everything except static assets, the generated icons, the web-app manifest, and the auth surface.
    "/((?!_next/static|_next/image|favicon\\.ico|icon|apple-icon|manifest\\.webmanifest|login|auth/|api/auth/).*)",
  ],
};
