import { describe, expect, it } from "vitest";
import {
  fmtAge,
  fmtDate,
  fmtDateTime,
  fmtDays,
  fmtPct,
  fmtRelative,
  fmtScore,
  fmtTime,
  OPS_TZ,
} from "../../lib/format";

// 2026-08-30T23:30:00Z is Aug 30 19:30 in America/New_York but Aug 31 in UTC.
const LATE_UTC = "2026-08-30T23:30:00Z";

describe("lib/format", () => {
  it("defaults the ops timezone to America/New_York", () => {
    expect(OPS_TZ).toBe("America/New_York");
  });

  it("renders dates in the ops timezone, not the container's", () => {
    expect(fmtDate(LATE_UTC)).toBe("Aug 30");
    expect(fmtDateTime(LATE_UTC)).toBe("Aug 30 · 19:30");
    expect(fmtTime("2026-08-30T18:05:09Z")).toBe("14:05:09");
  });

  it("handles missing or invalid dates", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("not a date")).toBe("—");
    expect(fmtRelative(undefined)).toBe("—");
  });

  it("formats relative times with a fixed now", () => {
    const now = Date.parse("2026-09-02T12:00:00Z");
    expect(fmtRelative("2026-09-02T11:59:48Z", now)).toBe("12s ago");
    expect(fmtRelative("2026-09-02T11:55:00Z", now)).toBe("5m ago");
    expect(fmtRelative("2026-09-02T09:00:00Z", now)).toBe("3h ago");
    expect(fmtRelative("2026-08-31T12:00:00Z", now)).toBe("2d ago");
    // Past 30 days falls back to an absolute date.
    expect(fmtRelative("2026-06-01T12:00:00Z", now)).toBe("Jun 1");
  });

  it("formats ages, scores, percentages and days", () => {
    expect(fmtAge(2500)).toBe("2s");
    expect(fmtAge(125_000)).toBe("2m 05s");
    expect(fmtScore(91)).toBe("91 /100");
    expect(fmtScore(null)).toBe("—");
    expect(fmtPct(12.5)).toBe("12.5%");
    expect(fmtPct(3.0)).toBe("3%");
    expect(fmtDays(94)).toBe("94 d");
    expect(fmtDays(null)).toBe("—");
  });
});
