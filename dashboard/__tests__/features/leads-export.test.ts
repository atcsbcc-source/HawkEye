import { describe, expect, it } from "vitest";
import {
  LEAD_EXPORT_COLUMNS,
  csvEscape,
  exportFileName,
  filterLeads,
  leadsToCsv,
  leadsToGeoJson,
} from "../../lib/export/leads";
import type { PropertyLead } from "../../lib/types";

const lead = (over: Partial<PropertyLead>): PropertyLead => ({
  id: "m1",
  parcel_id: "042-115-008",
  address: "1418 Ashwood Ct",
  lat: 35.2271,
  lng: -80.8431,
  status: "flagged",
  first_flagged_at: "2026-06-01T00:00:00.000Z",
  notes: null,
  neighborhood: "Oakwood",
  verification: "verified_vacant",
  days_distressed: 94,
  latest_vacancy_confidence: 91,
  latest_lawn_growth_index: 0.62,
  latest_vehicle_present: false,
  latest_scan_at: "2026-08-31T00:00:00.000Z",
  ...over,
});

describe("csvEscape", () => {
  it("quotes commas, quotes and newlines and doubles embedded quotes", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape("cr\rlf")).toBe('"cr\rlf"');
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
    expect(csvEscape(0)).toBe("0");
    expect(csvEscape(false)).toBe("false");
  });
});

describe("leadsToCsv", () => {
  it("emits the header and one escaped row per lead with an absolute detail_url", () => {
    const csv = leadsToCsv(
      [lead({ address: 'Unit "B", 12 Oak St' })],
      "https://hawkeye.example.com/",
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(LEAD_EXPORT_COLUMNS.join(","));
    expect(lines[1]).toContain('"Unit ""B"", 12 Oak St"');
    expect(lines[1]).toContain("https://hawkeye.example.com/properties/m1");
    expect(lines[1].startsWith("042-115-008,")).toBe(true);
    expect(lines[1]).toContain(",Oakwood,flagged,verified_vacant,94,91,0.62,false,");
    expect(csv.endsWith("\r\n")).toBe(true);
    // Header + 1 row + trailing newline.
    expect(lines).toHaveLength(3);
  });

  it("renders nulls as empty fields", () => {
    const csv = leadsToCsv(
      [
        lead({
          neighborhood: null,
          verification: null,
          days_distressed: null,
          latest_scan_at: null,
        }),
      ],
      "http://localhost:3000",
    );
    const row = csv.split("\r\n")[1];
    expect(row).toContain(",-80.8431,,flagged,,,91,");
  });
});

describe("leadsToGeoJson", () => {
  it("produces Point features with [lng, lat] and the same properties", () => {
    const fc = leadsToGeoJson([lead({})], "http://localhost:3000");
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features[0].geometry).toEqual({ type: "Point", coordinates: [-80.8431, 35.2271] });
    expect(fc.features[0].properties.detail_url).toBe("http://localhost:3000/properties/m1");
    expect(Object.keys(fc.features[0].properties)).toEqual([...LEAD_EXPORT_COLUMNS]);
  });
});

describe("filterLeads", () => {
  const leads = [
    lead({ id: "a", status: "flagged", neighborhood: "Oakwood", days_distressed: 94 }),
    lead({ id: "b", status: "active", neighborhood: "Elmwood", days_distressed: null }),
    lead({ id: "c", status: "flagged", neighborhood: "oakwood", days_distressed: 30 }),
  ];
  it("filters by status, neighborhood (case-insensitive) and minDays", () => {
    expect(filterLeads(leads, { status: "active" }).map((l) => l.id)).toEqual(["b"]);
    expect(filterLeads(leads, { neighborhood: "OAKWOOD" }).map((l) => l.id)).toEqual(["a", "c"]);
    expect(filterLeads(leads, { minDays: 60 }).map((l) => l.id)).toEqual(["a"]);
    expect(filterLeads(leads, {}).length).toBe(3);
  });
});

describe("exportFileName", () => {
  it("dates the file", () => {
    expect(exportFileName("csv", new Date("2026-09-02T15:00:00Z"))).toBe(
      "hawkeye-leads-2026-09-02.csv",
    );
    expect(exportFileName("geojson", new Date("2026-09-02T15:00:00Z"))).toBe(
      "hawkeye-leads-2026-09-02.geojson",
    );
  });
});
