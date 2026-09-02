import { describe, expect, it } from "vitest";
import {
  ACTIVE_STAGES,
  buildWorkQueue,
  dueBucket,
  isClosedStage,
  maxAllowableOffer,
  nextStage,
  previousStage,
} from "@/lib/crm";
import { CRM_STAGES, type PropertyLead } from "@/lib/types";

const lead = (over: Partial<PropertyLead>): PropertyLead => ({
  id: "p1",
  parcel_id: "APN-1",
  address: "1 Main St",
  lat: 0,
  lng: 0,
  status: "flagged",
  first_flagged_at: null,
  notes: null,
  crm_stage: "new",
  priority: "normal",
  tags: [],
  days_distressed: null,
  latest_vacancy_confidence: null,
  latest_lawn_growth_index: null,
  latest_vehicle_present: null,
  latest_scan_at: null,
  ...over,
});

// A fixed Wednesday noon so bucket boundaries are deterministic.
const NOW = new Date(2026, 8, 2, 12, 0, 0).getTime();
const hours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

describe("stage helpers", () => {
  it("walks the happy path in order and ends at closed_won", () => {
    const walk: string[] = [];
    let s: ReturnType<typeof nextStage> = "new";
    while (s) {
      walk.push(s);
      s = nextStage(s);
    }
    expect(walk).toEqual([...ACTIVE_STAGES, "closed_won"]);
    expect(nextStage("closed_won")).toBeNull();
    expect(nextStage("closed_lost")).toBeNull();
  });

  it("steps back from a closed stage into the last working stage", () => {
    expect(previousStage("new")).toBeNull();
    expect(previousStage("verified")).toBe("new");
    expect(previousStage("closed_lost")).toBe("under_contract");
    expect(CRM_STAGES.filter(isClosedStage)).toEqual(["closed_won", "closed_lost"]);
  });
});

describe("dueBucket", () => {
  it("buckets by local day boundaries", () => {
    expect(dueBucket(null, NOW)).toBe("unscheduled");
    expect(dueBucket("not a date", NOW)).toBe("unscheduled");
    expect(dueBucket(hours(-13), NOW)).toBe("overdue"); // yesterday 23:00
    expect(dueBucket(hours(-2), NOW)).toBe("today"); // earlier today still counts as today
    expect(dueBucket(hours(11), NOW)).toBe("today"); // 23:00 tonight
    expect(dueBucket(hours(13), NOW)).toBe("week"); // tomorrow 01:00
    expect(dueBucket(hours(24 * 6 + 11), NOW)).toBe("week");
    expect(dueBucket(hours(24 * 7), NOW)).toBe("later");
  });
});

describe("buildWorkQueue", () => {
  it("merges tasks and next actions, overdue first, and drops orphan tasks", () => {
    const leads = [
      lead({ id: "a", address: "A St", next_action: "Call owner", next_action_at: hours(30) }),
      lead({ id: "b", address: "B St", crm_stage: "outreach", assigned_to: "Sam" }),
    ];
    const tasks = [
      { id: "t1", property_id: "b", body: "Mail letter", due_at: hours(-30) },
      { id: "t2", property_id: "a", body: "Pull deed", due_at: hours(2) },
      { id: "t3", property_id: "archived", body: "ghost", due_at: hours(1) },
    ];
    const q = buildWorkQueue(leads, tasks, NOW);
    expect(q.map((i) => [i.kind, i.id, i.bucket])).toEqual([
      ["task", "t1", "overdue"],
      ["task", "t2", "today"],
      ["next_action", "a", "week"],
    ]);
    expect(q[0]).toMatchObject({ address: "B St", stage: "outreach", assignedTo: "Sam" });
  });

  it("orders within a bucket by due date then address", () => {
    const leads = [
      lead({ id: "a", address: "Zed Ave", next_action: "x", next_action_at: hours(1) }),
      lead({ id: "b", address: "Alpha Ave", next_action: "y", next_action_at: hours(1) }),
      lead({ id: "c", address: "Mid Ave", next_action: "z", next_action_at: hours(0.5) }),
    ];
    expect(buildWorkQueue(leads, [], NOW).map((i) => i.address)).toEqual([
      "Mid Ave",
      "Alpha Ave",
      "Zed Ave",
    ]);
  });
});

describe("maxAllowableOffer", () => {
  it("applies the 70 % rule minus repairs and never goes negative", () => {
    expect(maxAllowableOffer(300_000, 50_000)).toBe(160_000);
    expect(maxAllowableOffer(300_000, null)).toBe(210_000);
    expect(maxAllowableOffer(100_000, 90_000)).toBe(0);
    expect(maxAllowableOffer(null, 10)).toBeNull();
    expect(maxAllowableOffer(0, 0)).toBeNull();
  });
});
