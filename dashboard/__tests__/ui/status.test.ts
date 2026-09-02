import { describe, expect, it } from "vitest";
import { AIRBORNE_STATES, DRONE_STATE, LEAD_STATUS, MISSION_STATUS } from "../../lib/ui/status";

const HEX = /^#[0-9a-f]{6}$/;

describe("lib/ui/status", () => {
  it("covers every lead, mission and drone state", () => {
    expect(Object.keys(LEAD_STATUS).sort()).toEqual(["active", "dispatched", "flagged"]);
    expect(Object.keys(MISSION_STATUS).sort()).toEqual([
      "aborted",
      "active",
      "completed",
      "queued",
    ]);
    expect(Object.keys(DRONE_STATE).sort()).toEqual([
      "enroute",
      "idle",
      "mapping",
      "offline",
      "rtb",
    ]);
  });

  it("gives every entry a label, badge, dot and canvas hex", () => {
    for (const table of [LEAD_STATUS, MISSION_STATUS, DRONE_STATE]) {
      for (const s of Object.values(table)) {
        expect(s.label.length).toBeGreaterThan(0);
        expect(s.badge).toMatch(/text-/);
        expect(s.dot).toMatch(/^bg-/);
        expect(s.hex).toMatch(HEX);
      }
    }
  });

  it("follows the colour rule: amber flagged, cyan activity, emerald done, red abort", () => {
    expect(LEAD_STATUS.flagged.badge).toContain("amber");
    expect(LEAD_STATUS.dispatched.badge).toContain("emerald");
    expect(MISSION_STATUS.active.badge).toContain("cyan");
    expect(MISSION_STATUS.aborted.badge).toContain("red");
    expect(DRONE_STATE.mapping.badge).toContain("cyan");
    expect(DRONE_STATE.idle.badge).toContain("emerald");
  });

  it("marks only airborne states as pulsing", () => {
    expect(AIRBORNE_STATES.has("mapping")).toBe(true);
    expect(AIRBORNE_STATES.has("idle")).toBe(false);
    expect(AIRBORNE_STATES.has("offline")).toBe(false);
  });
});
