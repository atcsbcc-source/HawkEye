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

/**
 * Best-effort client IP. Only the first `x-forwarded-for` hop is trusted and
 * only when TRUST_PROXY=1; otherwise every direct client shares one bucket
 * (there is no socket address on a web-standard Request).
 */
export function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY === "1") {
    const xff = req.headers.get("x-forwarded-for");
    const first = xff?.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real.slice(0, 64);
  }
  const ip = (req as { ip?: string }).ip;
  return ip && ip.length > 0 ? ip.slice(0, 64) : "direct";
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
