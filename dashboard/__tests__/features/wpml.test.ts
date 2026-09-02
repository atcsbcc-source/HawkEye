import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { planGrid, type LatLng } from "../../lib/drone/grid";
import { buildKml, buildKmz, buildTemplateKml, buildWaylinesWpml, safeFileName, xmlEscape } from "../../lib/drone/wpml";
import type { Mission } from "../../lib/ops-types";

const polygon: LatLng[] = [
  [35.218, -80.852],
  [35.218, -80.846],
  [35.224, -80.846],
  [35.224, -80.852],
];

const mission: Mission = {
  id: "11111111-2222-4333-8444-555555555555",
  name: "Oakwood <weekly> & test",
  polygon,
  status: "queued",
  droneSerial: null,
  progress: 0,
  createdAt: "2026-09-02T12:00:00.000Z",
  launchedAt: null,
  completedAt: null,
};

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("buildKmz", () => {
  it("zips exactly wpmz/template.kml and wpmz/waylines.wpml", () => {
    const plan = planGrid(polygon);
    const bytes = buildKmz(mission, plan, new Date("2026-09-02T12:00:00Z"));
    expect(bytes.length).toBeGreaterThan(100);
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual(["wpmz/template.kml", "wpmz/waylines.wpml"]);

    const template = strFromU8(entries["wpmz/template.kml"]);
    const waylines = strFromU8(entries["wpmz/waylines.wpml"]);
    expect(template).toContain('xmlns:wpml="http://www.dji.com/wpmz/1.0.2"');
    expect(template).toContain("<wpml:waylineCoordinateSysParam>");
    expect(waylines).toContain("<wpml:waylineCoordinateSysParam>");
  });

  it("emits one Placemark per waypoint with index, height and speed", () => {
    const plan = planGrid(polygon);
    const waylines = buildWaylinesWpml(mission, plan);
    expect(count(waylines, "<Placemark>")).toBe(plan.waypoints.length);
    expect(count(waylines, "<wpml:index>")).toBe(plan.waypoints.length);
    expect(count(waylines, `<wpml:height>${plan.altitudeM}</wpml:height>`)).toBe(plan.waypoints.length);
    expect(count(waylines, `<wpml:waypointSpeed>${plan.speedMps}</wpml:waypointSpeed>`)).toBe(plan.waypoints.length);
    expect(waylines).toContain("<wpml:actionTriggerType>multipleTiming</wpml:actionTriggerType>");
    expect(waylines).toContain(`<wpml:actionTriggerParam>${plan.photoIntervalS}</wpml:actionTriggerParam>`);
    // Coordinates are lng,lat in KML order.
    const first = plan.waypoints[0];
    expect(waylines).toContain(`<coordinates>${first[1].toFixed(7)},${first[0].toFixed(7)}</coordinates>`);

    const template = buildTemplateKml(mission, plan);
    expect(count(template, "<Placemark>")).toBe(plan.waypoints.length);
  });

  it("escapes the mission name in XML", () => {
    const plan = planGrid(polygon);
    const template = buildTemplateKml(mission, plan);
    expect(template).toContain("<name>Oakwood &lt;weekly&gt; &amp; test</name>");
    expect(template).not.toContain("<weekly>");
    expect(xmlEscape(`"a" & 'b'`)).toBe("&quot;a&quot; &amp; &apos;b&apos;");
  });
});

describe("buildKml", () => {
  it("contains the AO polygon, the path and a waypoint folder", () => {
    const plan = planGrid(polygon);
    const kml = buildKml(mission, plan);
    expect(kml).toContain("<Polygon>");
    expect(kml).toContain("<LineString>");
    expect(count(kml, "<Placemark>")).toBe(plan.waypoints.length + 2);
    expect(kml).toContain("Area of operations");
  });
});

describe("safeFileName", () => {
  it("strips unsafe characters", () => {
    expect(safeFileName("Oakwood <weekly> & test")).toBe("Oakwood_weekly_test");
    expect(safeFileName("   ")).toBe("mission");
  });
});
