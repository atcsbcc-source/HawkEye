/**
 * NOTE: no static Node imports here. instrumentation.ts (compiled for the edge
 * runtime too) reaches this module through env.ts, so DNS is loaded lazily
 * with a webpackIgnore'd import that only ever runs under NEXT_RUNTIME=nodejs,
 * and HMAC uses Web Crypto (available in Node >= 18 and on the edge).
 */

/**
 * SSRF-safe, signed, timeout-bounded outbound webhook layer.
 *
 * - `assertSafeWebhookUrlSync(raw)`  pure URL/IP-literal checks (no network),
 *                                    unit-testable offline.
 * - `assertSafeWebhookUrl(raw)`      sync checks + DNS resolution range check
 *                                    on every resolved address.
 * - `safePostJson(url, body)`        POST with redirect:'error', a hard
 *                                    timeout and an HMAC-SHA256 signature.
 * - `postJson(url, body)`            stable `{status}` signature for injection
 *                                    into lib/automation ActionDeps.
 */

export class WebhookError extends Error {
  readonly kind: "unsafe_url" | "timeout" | "network" | "http";
  readonly status?: number;
  constructor(kind: WebhookError["kind"], message: string, status?: number) {
    super(message);
    this.name = "WebhookError";
    this.kind = kind;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// IP range checks
// ---------------------------------------------------------------------------
function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  return octets;
}

function isBlockedIPv4(o: number[]): boolean {
  const [a, b] = o;
  return (
    a === 0 || // 0.0.0.0/8 "this" network
    a === 10 || // 10/8 private
    a === 127 || // 127/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGNAT
    (a === 169 && b === 254) || // 169.254/16 link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12 private
    (a === 192 && b === 168) || // 192.168/16 private
    a >= 224 // 224/4 multicast, 240/4 reserved, broadcast
  );
}

/** Expand an IPv6 textual address into 8 16-bit groups; null when invalid. */
function parseIPv6(host: string): number[] | null {
  let addr = host;
  // Zone id (fe80::1%eth0) — strip it.
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);

  // Embedded IPv4 tail (::ffff:127.0.0.1)
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups = [...head, ...rest];
  if (halves.length === 1 && groups.length !== 8) return null;
  if (halves.length === 2 && groups.length > 7) return null;
  const parsed = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  if (parsed.some((n) => Number.isNaN(n))) return null;
  if (halves.length === 1) return parsed;
  const fill = new Array<number>(8 - parsed.length).fill(0);
  const headParsed = parsed.slice(0, head.length);
  const restParsed = parsed.slice(head.length);
  return [...headParsed, ...fill, ...restParsed];
}

function isBlockedIPv6(g: number[]): boolean {
  const allZero = g.every((x) => x === 0);
  if (allZero) return true; // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped ::ffff:a.b.c.d and deprecated IPv4-compatible ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
    if (isBlockedIPv4(v4)) return true;
    if (g[5] === 0xffff) return false;
  }
  // 64:ff9b::/96 NAT64 — treat embedded v4 the same way
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isBlockedIPv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

/** 4 / 6 when `s` is an IP literal (brackets optional), else 0. */
export function ipFamily(s: string): 0 | 4 | 6 {
  const bare = s.replace(/^\[|\]$/g, "");
  if (parseIPv4(bare)) return 4;
  if (bare.includes(":") && parseIPv6(bare)) return 6;
  return 0;
}

/** True when the literal address (v4 or v6, brackets optional) is private/reserved. */
export function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "");
  const family = ipFamily(bare);
  if (family === 4) {
    const v4 = parseIPv4(bare);
    return !v4 || isBlockedIPv4(v4);
  }
  if (family === 6) {
    const v6 = parseIPv6(bare);
    return !v6 || isBlockedIPv6(v6);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Hostname checks
// ---------------------------------------------------------------------------
const BLOCKED_SUFFIXES = [".local", ".internal", ".arpa", ".localhost", ".home", ".lan"];

function allowedHosts(): string[] {
  return (process.env.WEBHOOK_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function hostAllowed(hostname: string): boolean {
  const list = allowedHosts();
  if (list.length === 0) return true;
  return list.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

/**
 * Sync checks: https only, no credentials, default port, no local/reserved
 * hostnames or IP literals, optional WEBHOOK_ALLOWED_HOSTS allowlist.
 * Returns the parsed URL on success; throws WebhookError('unsafe_url').
 */
export function assertSafeWebhookUrlSync(raw: string): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    throw new WebhookError("unsafe_url", "webhook url must be a string of at most 2048 chars");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookError("unsafe_url", "webhook url is not a valid absolute URL");
  }
  if (url.protocol !== "https:") {
    throw new WebhookError("unsafe_url", "webhook url must use https");
  }
  if (url.username || url.password) {
    throw new WebhookError("unsafe_url", "webhook url must not embed credentials");
  }
  if (url.port !== "" && url.port !== "443") {
    throw new WebhookError("unsafe_url", "webhook url must use port 443");
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname) throw new WebhookError("unsafe_url", "webhook url has no host");
  if (hostname === "localhost" || BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new WebhookError("unsafe_url", "webhook host resolves to a local network");
  }
  if (isBlockedAddress(hostname)) {
    throw new WebhookError("unsafe_url", "webhook host is a private or reserved IP address");
  }
  if (!hostAllowed(hostname)) {
    throw new WebhookError("unsafe_url", "webhook host is not in WEBHOOK_ALLOWED_HOSTS");
  }
  return url;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Sync checks plus a DNS resolution range check on every resolved address.
 * Returns the vetted addresses too so the caller can PIN the connection to
 * them — resolving again at connect time would reopen a DNS-rebinding window.
 */
export async function resolveSafeWebhookUrl(
  raw: string,
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  const url = assertSafeWebhookUrlSync(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literal = ipFamily(hostname);
  if (literal) return { url, addresses: [{ address: hostname, family: literal }] };
  let addresses: { address: string; family: number }[];
  try {
    const dns = await import(/* webpackIgnore: true */ "node:dns/promises");
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new WebhookError("unsafe_url", "webhook host does not resolve");
  }
  if (addresses.length === 0) {
    throw new WebhookError("unsafe_url", "webhook host does not resolve");
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new WebhookError(
        "unsafe_url",
        "webhook host resolves to a private or reserved address",
      );
    }
  }
  return {
    url,
    addresses: addresses.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 })),
  };
}

/** Sync checks plus a DNS resolution range check on every resolved address. */
export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  return (await resolveSafeWebhookUrl(raw)).url;
}

// ---------------------------------------------------------------------------
// Signed POST
// ---------------------------------------------------------------------------
export async function signPayload(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${body}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface SafePostResult {
  status: number;
  ms: number;
}

/**
 * Node `lookup` hook that answers only from the vetted address list, so the
 * TLS connection goes to an address that passed isBlockedAddress() while SNI
 * and certificate validation still use the original hostname.
 */
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

function pinnedLookup(addresses: ResolvedAddress[]) {
  return (_hostname: string, options: unknown, callback: LookupCallback) => {
    const wantAll =
      typeof options === "object" && options !== null && (options as { all?: boolean }).all;
    if (wantAll) {
      callback(
        null,
        addresses.map((a) => ({ address: a.address, family: a.family })),
      );
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  };
}

/**
 * POST JSON to a validated webhook URL. Never follows redirects, aborts after
 * `timeoutMs`, and signs the body with WEBHOOK_SIGNING_SECRET when set:
 *   x-hawkeye-timestamp: <unix ms>
 *   x-hawkeye-signature: hex(HMAC-SHA256(secret, `${ts}.${body}`))
 * The connection is pinned to the addresses the SSRF check vetted (no second
 * DNS resolution at connect time). Resolves with `{status, ms}` (any status);
 * throws WebhookError otherwise.
 */
export async function safePostJson(
  url: string,
  body: unknown,
  opts: { timeoutMs?: number; skipDns?: boolean } = {},
): Promise<SafePostResult> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const { url: target, addresses } = opts.skipDns
    ? { url: assertSafeWebhookUrlSync(url), addresses: [] as ResolvedAddress[] }
    : await resolveSafeWebhookUrl(url);
  const payload = JSON.stringify(body);
  const ts = String(Date.now());
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "content-length": String(new TextEncoder().encode(payload).byteLength),
    "user-agent": "hawkeye-webhook/1.0",
    "x-hawkeye-timestamp": ts,
  };
  const secret = process.env.WEBHOOK_SIGNING_SECRET;
  if (secret) headers["x-hawkeye-signature"] = await signPayload(secret, ts, payload);

  const https = await import(/* webpackIgnore: true */ "node:https");
  const hostname = target.hostname.replace(/^\[|\]$/g, "");
  const started = Date.now();
  return new Promise<SafePostResult>((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname,
        port: 443,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers,
        servername: ipFamily(hostname) ? undefined : hostname,
        ...(addresses.length > 0 ? { lookup: pinnedLookup(addresses) } : {}),
      },
      (res) => {
        // https.request never follows redirects; report the status as-is.
        // Drain so the socket is released; we never read webhook bodies.
        res.resume();
        resolve({ status: res.statusCode ?? 0, ms: Date.now() - started });
      },
    );
    const timer = setTimeout(() => {
      req.destroy(new WebhookError("timeout", `webhook timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(
        err instanceof WebhookError ? err : new WebhookError("network", "webhook request failed"),
      );
    });
    req.on("response", () => clearTimeout(timer));
    req.end(payload);
  });
}

/** Stable injectable signature for lib/automation ActionDeps.postJson. */
export const postJson = async (url: string, body: unknown): Promise<{ status: number }> => {
  const { status } = await safePostJson(url, body);
  return { status };
};
