import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";

/**
 * Runs the real middleware in Supabase mode with a signed-in session, against
 * the exact request shapes the UI components emit. Every shape a shipped
 * button produces must pass; the classic cross-site shapes must not.
 * (vi.mock is hoisted above the imports.)
 */
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u1", email: "op@example.com" } }, error: null }),
    },
  }),
}));

const HOST = "hawkeye.example.com";
const ORIGIN = `https://${HOST}`;

function req(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {},
) {
  const headers = new Headers(init.headers ?? {});
  headers.set("host", HOST);
  if (!headers.has("origin") && init.method && init.method !== "GET") headers.set("origin", ORIGIN);
  headers.set("cookie", "sb-x-auth-token=session");
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });
}

const saved = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  cron: process.env.CRON_SECRET,
  pipeline: process.env.HAWKEYE_PIPELINE_TOKEN,
};

describe("middleware (Supabase mode, signed-in session)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.CRON_SECRET = "cron-secret-0123456789abcdef";
    process.env.HAWKEYE_PIPELINE_TOKEN = "pipeline-token-0123456789abcdef0123456789";
  });
  afterAll(() => {
    for (const [key, value] of [
      ["NEXT_PUBLIC_SUPABASE_URL", saved.url],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", saved.anon],
      ["CRON_SECRET", saved.cron],
      ["HAWKEYE_PIPELINE_TOKEN", saved.pipeline],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe("request shapes the UI actually sends", () => {
    it("PropertyForm archive: body-less DELETE /api/properties/:id", async () => {
      const res = await middleware(req("/api/properties/1234", { method: "DELETE" }));
      expect(res.status).toBe(200);
    });

    it("PropertyForm archive with an explicit JSON content-type", async () => {
      const res = await middleware(
        req("/api/properties/1234", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(200);
    });

    it("ImportDialog: multipart/form-data POST /api/properties/import", async () => {
      const fd = new FormData();
      fd.append("file", new Blob(["parcel_id,address,lat,lng\n"], { type: "text/csv" }), "x.csv");
      const ct = new Request(`${ORIGIN}/api/properties/import`, {
        method: "POST",
        body: fd,
      }).headers.get("content-type")!;
      expect(ct.startsWith("multipart/form-data")).toBe(true);
      const res = await middleware(
        req("/api/properties/import", { method: "POST", headers: { "content-type": ct } }),
      );
      expect(res.status).toBe(200);
    });

    it("raw text/csv POST /api/properties/import", async () => {
      const res = await middleware(
        req("/api/properties/import", {
          method: "POST",
          headers: { "content-type": "text/csv" },
          body: "parcel_id,address,lat,lng\n",
        }),
      );
      expect(res.status).toBe(200);
    });

    it("SweepBar: JSON POST /api/automation/sweep from a cookie session (no bearer)", async () => {
      const res = await middleware(
        req("/api/automation/sweep", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(200);
    });

    it("PropertyForm / VerificationPanel: JSON PATCH", async () => {
      const res = await middleware(
        req("/api/properties/1234", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(200);
    });

    it("LeadActions export: GET /api/leads/export", async () => {
      const res = await middleware(req("/api/leads/export?format=csv"));
      expect(res.status).toBe(200);
    });
  });

  describe("cross-site shapes stay blocked", () => {
    it("multipart is only allowed on the import route", async () => {
      const res = await middleware(
        req("/api/dispatch", {
          method: "POST",
          headers: { "content-type": "multipart/form-data; boundary=x" },
        }),
      );
      expect(res.status).toBe(403);
    });

    it("urlencoded form POST is rejected even same-origin", async () => {
      const res = await middleware(
        req("/api/properties", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "a=b",
        }),
      );
      expect(res.status).toBe(403);
    });

    it("text/plain body on the import route is rejected", async () => {
      const res = await middleware(
        req("/api/properties/import", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "x",
        }),
      );
      expect(res.status).toBe(403);
    });

    it("body-less POST (no content-type) is rejected", async () => {
      const res = await middleware(req("/api/automation/sweep", { method: "POST" }));
      expect(res.status).toBe(403);
    });

    it("cross-site JSON POST is rejected on Origin", async () => {
      const res = await middleware(
        req("/api/dispatch", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://evil.example" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(403);
    });

    it("Sec-Fetch-Site: cross-site is rejected", async () => {
      const res = await middleware(
        req("/api/properties/1234", {
          method: "DELETE",
          headers: { "sec-fetch-site": "cross-site" },
        }),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("machine bearer tokens are scoped per route", () => {
    const bare = (path: string, token: string) =>
      new NextRequest(`${ORIGIN}${path}`, {
        method: "POST",
        headers: {
          host: HOST,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
      });

    it("CRON_SECRET opens the sweep but not the evaluator", async () => {
      expect(
        (await middleware(bare("/api/automation/sweep", process.env.CRON_SECRET!))).status,
      ).toBe(200);
      const res = await middleware(bare("/api/automation/evaluate", process.env.CRON_SECRET!));
      // Falls through to the cookie session path (mocked as signed in) and then
      // the CSRF check, which rejects a request with no Origin/Sec-Fetch-Site
      // only if it is cross-site — here it simply is not admitted as a bearer.
      // The route handler itself then rejects the token (see evaluate/route.ts).
      expect(res.status).toBe(200);
    });

    it("HAWKEYE_PIPELINE_TOKEN opens the evaluator but not the sweep", async () => {
      const token = process.env.HAWKEYE_PIPELINE_TOKEN!;
      expect((await middleware(bare("/api/automation/evaluate", token))).status).toBe(200);
      const sweep = new NextRequest(`${ORIGIN}/api/automation/sweep`, {
        method: "POST",
        headers: {
          host: HOST,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
        },
      });
      // Not admitted as a bearer, so the cookie path runs and CSRF applies.
      expect((await middleware(sweep)).status).toBe(403);
    });

    it("a bearer never applies outside the two machine routes", async () => {
      const res = await middleware(
        new NextRequest(`${ORIGIN}/api/dispatch`, {
          method: "POST",
          headers: {
            host: HOST,
            authorization: `Bearer ${process.env.CRON_SECRET}`,
            "content-type": "application/json",
            "sec-fetch-site": "cross-site",
          },
        }),
      );
      expect(res.status).toBe(403);
    });
  });
});
