import { describe, expect, it } from "vitest";
import { PRIOR_MODEL, scoreFactors } from "@/lib/intel/score";
import { MOCK_LEADS, mockScansFor } from "@/lib/mock";

// Mirrors pipeline/tests/test_intel.py so the two scorers stay in lock-step.
describe("scoreFactors (TypeScript twin of intel/model.py)", () => {
  it("loads the prior with a gate factor", () => {
    expect(PRIOR_MODEL.version).toBe("prior-1");
    expect(PRIOR_MODEL.factors.some((f) => f.gate)).toBe(true);
  });

  it("separates a vacant parcel from an occupied one like the Python prior", () => {
    const vacant = scoreFactors({
      lawn_growth: 1.0,
      vehicle_static: 1,
      vehicle_absent: 0,
      stillness: 1.0,
      persistence_weeks: 0,
      alignment_quality: 0.97,
    });
    const occupied = scoreFactors({
      lawn_growth: -0.2,
      vehicle_static: 0,
      vehicle_absent: 0,
      stillness: 0.7,
      persistence_weeks: 0,
      alignment_quality: 0.99,
    });
    expect(vacant.confidence).toBe(96);
    expect(occupied.confidence).toBe(4);
    expect(vacant.top_drivers[0]).toMatch(/^Lawn overgrowth/);
  });

  it("caps the score when registration is poor", () => {
    const gated = scoreFactors({ lawn_growth: 1.0, vehicle_static: 1, stillness: 1, alignment_quality: 0.1 });
    expect(gated.gated).toBe(true);
    expect(gated.confidence).toBe(40);
    expect(gated.top_drivers.at(-1)).toMatch(/Registration too poor/);
  });

  it("treats missing factors as neutral", () => {
    const a = scoreFactors({ lawn_growth: 0.1, stillness: 0.5 });
    const b = scoreFactors({ lawn_growth: 0.1, stillness: 0.5, clutter: null, texture_level: undefined });
    expect(a.confidence).toBe(b.confidence);
    expect(b.factors.filter((f) => f.value === null).every((f) => f.contribution === 0)).toBe(true);
  });

  it("keeps the mock grid and the mock scans in agreement", () => {
    for (const lead of MOCK_LEADS) {
      const scans = mockScansFor(lead.id);
      expect(scans[0].factor_scores?.model_version).toBe("prior-1");
      expect(lead.latest_vacancy_confidence).toBe(scans[0].vacancy_confidence);
    }
    // The occupied home never looks vacant; the dispatched one clearly does.
    expect(mockScansFor("m5")[0].vacancy_confidence).toBeLessThan(30);
    expect(mockScansFor("m4")[0].vacancy_confidence).toBeGreaterThanOrEqual(75);
  });
});
