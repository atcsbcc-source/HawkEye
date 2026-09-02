import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUDIT_MEMORY_CAP } from "@/lib/constants";
import { listEvents, pushEvent } from "@/lib/server/audit";
import { resetOpsState } from "@/lib/server/state";

// Force mock mode regardless of the developer's shell. The Supabase client is
// created per call from process.env, so clearing these before the first call is enough.
const saved = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

describe("audit (mock mode)", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetOpsState();
  });
  afterAll(() => {
    resetOpsState();
    if (saved.url) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.anon) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.anon;
    if (saved.service) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.service;
  });

  it("pushEvent unshifts newest-first with an id and timestamp", async () => {
    await pushEvent({
      actor: "test",
      eventType: "a",
      subjectType: null,
      subjectId: null,
      detail: {},
    });
    await pushEvent({
      actor: "test",
      eventType: "b",
      subjectType: "x",
      subjectId: "1",
      detail: { k: 1 },
    });
    const events = await listEvents(10);
    expect(events.map((e) => e.eventType)).toEqual(["b", "a"]);
    expect(events[0].id).toMatch(/[0-9a-f-]{36}/);
    expect(Date.parse(events[0].occurredAt)).not.toBeNaN();
    expect(events[0].detail).toEqual({ k: 1 });
  });

  it("caps the in-memory store at AUDIT_MEMORY_CAP", async () => {
    for (let i = 0; i < AUDIT_MEMORY_CAP + 25; i += 1) {
      await pushEvent({
        actor: "test",
        eventType: `e${i}`,
        subjectType: null,
        subjectId: null,
        detail: {},
      });
    }
    const all = await listEvents(AUDIT_MEMORY_CAP * 2);
    expect(all).toHaveLength(AUDIT_MEMORY_CAP);
    expect(all[0].eventType).toBe(`e${AUDIT_MEMORY_CAP + 24}`);
  });

  it("listEvents honours the limit", async () => {
    expect(await listEvents(3)).toHaveLength(3);
  });
});
