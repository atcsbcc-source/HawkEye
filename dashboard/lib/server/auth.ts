import "server-only";
import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "../supabase";
import { isDevMode } from "./env";

export { isDevMode };

/**
 * Auth primitives. Every route handler calls these directly — middleware.ts
 * is the first line, this is the second (defense in depth against
 * middleware-bypass bugs of the CVE-2025-29927 family).
 */

export type Role = "admin" | "operator";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export const DEV_USER: AuthUser = { id: "dev", email: "dev@local", role: "admin" };

function roleOf(meta: unknown): Role {
  const role = (meta as { role?: unknown } | null)?.role;
  return role === "admin" ? "admin" : "operator";
}

/** Signed-in user or null. Uses auth.getUser() (JWT verified server-side). */
export async function getUser(): Promise<AuthUser | null> {
  if (isDevMode()) return DEV_USER;
  const db = getSupabase();
  if (!db) return null;
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? "",
    role: roleOf(user.app_metadata),
  };
}

/** Resolve the current user or throw AuthError(401/403). */
export async function requireUser(opts: { role?: Role } = {}): Promise<AuthUser> {
  if (!isDevMode() && !getSupabase()) {
    throw new AuthError(503, "Auth not configured");
  }
  const user = await getUser();
  if (!user) throw new AuthError(401, "Authentication required");
  if (opts.role === "admin" && user.role !== "admin") {
    throw new AuthError(403, "Admin role required");
  }
  return user;
}

export function authErrorResponse(err: AuthError): NextResponse {
  return NextResponse.json({ error: err.message }, { status: err.status });
}

type Handler<C> = (req: NextRequest, user: AuthUser, ctx: C) => Promise<Response> | Response;

/**
 * Wrap a route handler: 401/403 JSON unless a user (with `role`) is present.
 * The route's second argument (`{ params }` on dynamic segments) is forwarded
 * untouched as the handler's third parameter.
 */
export function withAuth<C = unknown>(handler: Handler<C>, opts: { role?: Role } = {}) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    let user: AuthUser;
    try {
      user = await requireUser(opts);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      throw err;
    }
    return handler(req, user, ctx);
  };
}

// ---------------------------------------------------------------------------
// Bearer tokens (pipeline / cron)
// ---------------------------------------------------------------------------
export const PIPELINE_TOKEN_VARS = ["HAWKEYE_PIPELINE_TOKEN", "CRON_SECRET"] as const;
export type PipelineTokenVar = (typeof PIPELINE_TOKEN_VARS)[number];

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Compare against self to keep timing flat, then reject.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

/**
 * Validate `Authorization: Bearer` against one or more env vars using a
 * constant-time comparison. Returns the matching var name (use it as the
 * rate-limit subject) or null. Unset env vars never match.
 */
export function requirePipelineToken(
  req: Request,
  envVar: PipelineTokenVar | readonly PipelineTokenVar[] = PIPELINE_TOKEN_VARS,
): { name: PipelineTokenVar } | null {
  const token = bearerToken(req);
  if (!token) return null;
  const names = typeof envVar === "string" ? [envVar] : envVar;
  for (const name of names) {
    const expected = process.env[name];
    if (expected && expected.length >= 16 && safeEqual(token, expected)) return { name };
  }
  return null;
}
