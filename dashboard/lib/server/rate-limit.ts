/**
 * In-memory sliding-window rate limiter.
 *
 * Keyed `${route}:${subject}` where subject is a user id, a token name or a
 * client IP. Per-process only — when running more than one instance swap in
 * @upstash/ratelimit or a Postgres `rate_limits` table behind the same API.
 */

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the next request would be accepted (0 when ok). */
  retryAfter: number;
  remaining: number;
}

interface Bucket {
  hits: number[];
}

const g = globalThis as unknown as { __hawkeyeRateLimits?: Map<string, Bucket> };
function store(): Map<string, Bucket> {
  if (!g.__hawkeyeRateLimits) g.__hawkeyeRateLimits = new Map();
  return g.__hawkeyeRateLimits;
}

const MAX_KEYS = 10_000;

function prune(map: Map<string, Bucket>, now: number, windowMs: number): void {
  map.forEach((w, key) => {
    w.hits = w.hits.filter((t) => now - t < windowMs);
    if (w.hits.length === 0) map.delete(key);
  });
}

/**
 * Record a hit for `route`/`subject` and report whether it is within
 * `limit` per `windowMs` (default one minute).
 */
export function rateLimit(
  route: string,
  subject: string,
  limit: number,
  windowMs = 60_000,
  now: number = Date.now(),
): RateLimitResult {
  const map = store();
  prune(map, now, windowMs);
  const key = `${route}:${subject}`;
  let w: Bucket | undefined = map.get(key);
  if (!w) {
    if (map.size >= MAX_KEYS) {
      // Under key-flood, shed the oldest entry rather than grow unbounded.
      const first = map.keys().next().value;
      if (first !== undefined) map.delete(first);
    }
    w = { hits: [] };
    map.set(key, w);
  }
  if (w.hits.length >= limit) {
    const oldest = w.hits[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { ok: false, retryAfter, remaining: 0 };
  }
  w.hits.push(now);
  return { ok: true, retryAfter: 0, remaining: limit - w.hits.length };
}

/** Test/ops hook: clear all windows. */
export function resetRateLimits(): void {
  store().clear();
}

/** True only when the operator opted in to trusting x-forwarded-* headers. */
export function trustProxy(): boolean {
  return process.env.TRUST_PROXY === "1";
}

/**
 * Sentinel returned by `clientIp` when no per-client identity is available
 * (self-hosted `next start` without TRUST_PROXY=1). Callers must not apply a
 * tight shared cap to this subject — it would be one bucket for everyone.
 */
export const NO_CLIENT_IP = "direct";

/**
 * Number of reverse proxies in front of the app that APPEND to
 * `x-forwarded-for` (TRUST_PROXY_HOPS, default 1). The client controls every
 * hop before the ones our own proxies add, so only the N-th entry from the
 * right is trustworthy.
 */
export function trustedProxyHops(): number {
  const n = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * The `x-forwarded-for` hop written by our own proxy: the last entry when one
 * proxy appends (nginx `$proxy_add_x_forwarded_for`, Cloudflare, ALB) or
 * overwrites (Vercel); the N-th from the right with TRUST_PROXY_HOPS=N. The
 * FIRST entry is never used — a client can send any value there.
 */
export function forwardedHop(header: string | null, hops = trustedProxyHops()): string | null {
  if (!header) return null;
  const entries = header
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;
  return entries[Math.max(0, entries.length - hops)] ?? null;
}

/**
 * Best-effort client IP. Only the hop our own proxy appended to
 * `x-forwarded-for` is trusted (see `forwardedHop`) and only when
 * TRUST_PROXY=1; otherwise the platform-provided `req.ip` (Vercel) is used,
 * and `NO_CLIENT_IP` when there is none (there is no socket address on a
 * web-standard Request).
 */
export function clientIp(req: Request): string {
  if (trustProxy()) {
    const hop = forwardedHop(req.headers.get("x-forwarded-for"));
    if (hop) return hop.slice(0, 64);
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real.slice(0, 64);
  }
  const ip = (req as { ip?: string }).ip;
  return ip && ip.length > 0 ? ip.slice(0, 64) : NO_CLIENT_IP;
}

/** 429 response with Retry-After. */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests", retryAfter: result.retryAfter }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(result.retryAfter),
        "cache-control": "no-store",
      },
    },
  );
}
