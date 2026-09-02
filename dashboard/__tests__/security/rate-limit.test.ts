import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientIp,
  rateLimit,
  rateLimitResponse,
  resetRateLimits,
} from "../../lib/server/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit then rejects with retryAfter", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      const r = rateLimit("r", "u1", 3, 60_000, t0 + i);
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(2 - i);
    }
    const blocked = rateLimit("r", "u1", 3, 60_000, t0 + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfter).toBeLessThanOrEqual(60);
  });

  it("slides the window", () => {
    const t0 = 1_000_000;
    rateLimit("r", "u1", 2, 60_000, t0);
    rateLimit("r", "u1", 2, 60_000, t0 + 1_000);
    expect(rateLimit("r", "u1", 2, 60_000, t0 + 2_000).ok).toBe(false);
    // first hit expires at t0 + 60_000
    expect(rateLimit("r", "u1", 2, 60_000, t0 + 60_001).ok).toBe(true);
  });

  it("isolates routes and subjects", () => {
    const t0 = 5_000_000;
    rateLimit("a", "u1", 1, 60_000, t0);
    expect(rateLimit("a", "u1", 1, 60_000, t0).ok).toBe(false);
    expect(rateLimit("a", "u2", 1, 60_000, t0).ok).toBe(true);
    expect(rateLimit("b", "u1", 1, 60_000, t0).ok).toBe(true);
  });

  it("builds a 429 with Retry-After", async () => {
    const res = rateLimitResponse({ ok: false, retryAfter: 7, remaining: 0 });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(await res.json()).toMatchObject({ error: "Too many requests", retryAfter: 7 });
  });
});

describe("clientIp", () => {
  const prev = process.env.TRUST_PROXY;
  afterEach(() => {
    if (prev === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prev;
  });

  it("ignores x-forwarded-for unless TRUST_PROXY=1", () => {
    delete process.env.TRUST_PROXY;
    const req = new Request("https://h.example/api", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(clientIp(req)).toBe("direct");
  });

  it("uses only the first hop when TRUST_PROXY=1", () => {
    process.env.TRUST_PROXY = "1";
    const req = new Request("https://h.example/api", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(clientIp(req)).toBe("203.0.113.9");
  });
});
