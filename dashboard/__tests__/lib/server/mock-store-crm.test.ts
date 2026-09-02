import { beforeEach, describe, expect, it } from "vitest";
import {
  mockCreateActivity,
  mockCreateContact,
  mockCreateProperty,
  mockCreateTaskForRule,
  mockDeleteContact,
  mockGetProperty,
  mockListActivities,
  mockListContacts,
  mockListOpenTasks,
  mockSetStage,
  mockUpdateActivity,
  mockUpdateProperty,
  resetMockStore,
} from "@/lib/server/mock-store";

describe("mock store — CRM", () => {
  beforeEach(() => resetMockStore());

  it("seeds every lead with a stage, priority and tags", () => {
    const p = mockGetProperty("m1")!;
    expect(p.crm_stage).toBe("researching");
    expect(p.priority).toBe("high");
    expect(p.tags).toContain("tax-lien");
    expect(mockGetProperty("m5")!.crm_stage).toBe("new");
    expect(mockCreateProperty({ parcel_id: "X", address: "x", lat: 0, lng: 0 })).toMatchObject({
      crm_stage: "new",
      priority: "normal",
      tags: [],
    });
  });

  it("changes stage once, logs a stage_change activity and reports no-ops", () => {
    const first = mockSetStage("m2", "outreach", "tester", "cold call list");
    expect(first.outcome).toBe("changed");
    expect(first.previous).toBe("new");
    expect(first.property?.crm_stage).toBe("outreach");
    expect(first.property?.stage_changed_at).toBeTruthy();
    const log = mockListActivities("m2").find((a) => a.kind === "stage_change");
    expect(log?.body).toBe("new → outreach — cold call list");
    expect(log?.created_by).toBe("tester");

    expect(mockSetStage("m2", "outreach").outcome).toBe("unchanged");
    expect(mockSetStage("nope", "outreach").outcome).toBe("not_found");
    expect(mockListActivities("m2").filter((a) => a.kind === "stage_change")).toHaveLength(1);
  });

  it("manages contacts per parcel and unlinks activities on delete", () => {
    const c = mockCreateContact("m3", {
      name: "Pat Owner",
      role: "owner",
      phone: "555",
      email: null,
      mailing_address: null,
      preferred_channel: "phone",
      do_not_contact: false,
      source: null,
      notes: null,
    })!;
    expect(mockListContacts("m3").map((x) => x.id)).toEqual([c.id]);
    const call = mockCreateActivity("m3", { kind: "call", body: "hi", contact_id: c.id })!;
    expect(call.contact_id).toBe(c.id);
    expect(mockDeleteContact("m3", c.id)).toBe(true);
    expect(mockDeleteContact("m3", c.id)).toBe(false);
    expect(mockListActivities("m3").find((a) => a.id === call.id)?.contact_id).toBeNull();
    // A contact on another parcel cannot be attached.
    expect(mockCreateActivity("m3", { kind: "note", body: "x", contact_id: "m1-c1" })).toBeNull();
  });

  it("lists open tasks across parcels and closes them", () => {
    const before = mockListOpenTasks();
    expect(before.map((t) => t.property_id).sort()).toEqual(["m1", "m2", "m4"]);
    const done = mockUpdateActivity("m2", before.find((t) => t.property_id === "m2")!.id, {
      completed_at: new Date().toISOString(),
    });
    expect(done?.completed_at).toBeTruthy();
    expect(
      mockListOpenTasks()
        .map((t) => t.property_id)
        .sort(),
    ).toEqual(["m1", "m4"]);
  });

  it("rule-created tasks are idempotent per (rule, parcel)", () => {
    const due = new Date(Date.now() + 86_400_000).toISOString();
    expect(mockCreateTaskForRule("m3", "Skip-trace", due, "rule:r1")).toBe("created");
    expect(mockCreateTaskForRule("m3", "Skip-trace", due, "rule:r1")).toBe("exists");
    expect(mockCreateTaskForRule("ghost", "Skip-trace", due, "rule:r1")).toBe("not_found");
    expect(mockListOpenTasks().filter((t) => t.property_id === "m3")).toHaveLength(1);
  });

  it("patches the deal fields on a parcel", () => {
    const p = mockUpdateProperty("m3", {
      owner_name: "R. Smith",
      arv: 200_000,
      tags: ["probate"],
      next_action: "Mail letter",
    })!;
    expect(p).toMatchObject({ owner_name: "R. Smith", arv: 200_000, tags: ["probate"] });
  });
});
