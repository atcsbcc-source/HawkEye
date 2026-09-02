import { describe, expect, it } from "vitest";
import {
  dedupeParcels,
  detectFormat,
  parseCsv,
  parseGeoJson,
  parseParcels,
  polygonCentroid,
  splitCsv,
} from "../../lib/import/parse";

describe("parseCsv", () => {
  it("rejects a header missing required columns", () => {
    const res = parseCsv("parcel_id,address,lat\nA,1 Main St,35.2\n");
    expect(res.error).toMatch(/missing: lng/);
    expect(res.rows).toHaveLength(0);
  });

  it("accepts columns in any order / case and optional neighborhood", () => {
    const csv = "Address,LNG,LAT,Parcel_ID,Neighborhood\n1 Main St,-80.84,35.22,042-1,Oakwood\n";
    const res = parseCsv(csv);
    expect(res.error).toBeUndefined();
    expect(res.invalid).toEqual([]);
    expect(res.rows).toEqual([
      { row: 1, parcel_id: "042-1", address: "1 Main St", lat: 35.22, lng: -80.84, neighborhood: "Oakwood", notes: null },
    ]);
  });

  it("reports lat/lng range failures with 1-based data row numbers", () => {
    const csv = [
      "parcel_id,address,lat,lng",
      "A,ok,35.2,-80.8",
      "B,bad lat,95,-80.8",
      "C,bad lng,35.2,-181",
      "D,not a number,abc,-80.8",
      "E,ok too,35.3,-80.9",
    ].join("\n");
    const res = parseCsv(csv);
    expect(res.rows.map((r) => r.parcel_id)).toEqual(["A", "E"]);
    expect(res.invalid.map((i) => i.row)).toEqual([2, 3, 4]);
    expect(res.invalid[0].reason).toMatch(/lat/);
    expect(res.invalid[1].reason).toMatch(/lng/);
    expect(res.invalid[2].reason).toMatch(/lat/);
  });

  it("handles quoted fields with commas, doubled quotes and CRLF", () => {
    const csv = 'parcel_id,address,lat,lng\r\n"X,1","12 ""Oak"" Ct, Apt 2",35.2,-80.8\r\n';
    const res = parseCsv(csv);
    expect(res.rows[0].parcel_id).toBe("X,1");
    expect(res.rows[0].address).toBe('12 "Oak" Ct, Apt 2');
    expect(splitCsv("a,b\n\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("flags blank parcel ids and addresses", () => {
    const res = parseCsv("parcel_id,address,lat,lng\n,1 Main,35,-80\nB,,35,-80\n");
    expect(res.rows).toHaveLength(0);
    expect(res.invalid).toHaveLength(2);
  });
});

describe("parseGeoJson", () => {
  it("uses Point coordinates directly and Polygon centroids", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-80.84, 35.22] },
          properties: { APN: "P1", ADDRESS: "1 Point St" },
        },
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-80.85, 35.2],
                [-80.83, 35.2],
                [-80.83, 35.22],
                [-80.85, 35.22],
                [-80.85, 35.2],
              ],
            ],
          },
          properties: { parcel_id: "P2", address: "2 Polygon Ave", neighborhood: "Oakwood" },
        },
      ],
    };
    const res = parseGeoJson(fc);
    expect(res.error).toBeUndefined();
    expect(res.invalid).toEqual([]);
    expect(res.rows[0]).toMatchObject({ row: 1, parcel_id: "P1", lat: 35.22, lng: -80.84 });
    expect(res.rows[1].parcel_id).toBe("P2");
    expect(res.rows[1].lng).toBeCloseTo(-80.84, 9);
    expect(res.rows[1].lat).toBeCloseTo(35.21, 9);
    expect(res.rows[1].neighborhood).toBe("Oakwood");
  });

  it("rejects non-FeatureCollections and unsupported geometries by feature index", () => {
    expect(parseGeoJson({ type: "Feature" }).error).toMatch(/FeatureCollection/);
    expect(parseGeoJson("not json").error).toMatch(/JSON/);
    const res = parseGeoJson({
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: { parcel_id: "L" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [-80.8, 35.2] }, properties: {} },
      ],
    });
    expect(res.rows).toHaveLength(0);
    expect(res.invalid.map((i) => i.row)).toEqual([1, 2]);
    expect(res.invalid[0].reason).toMatch(/geometry/);
    expect(res.invalid[1].reason).toMatch(/parcel_id/);
  });
});

describe("polygonCentroid", () => {
  it("computes the area-weighted centroid of a square", () => {
    const [x, y] = polygonCentroid([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(1);
  });
  it("falls back to the vertex mean for degenerate rings", () => {
    const [x, y] = polygonCentroid([
      [0, 0],
      [2, 0],
    ]);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(0);
  });
});

describe("detectFormat / dedupeParcels", () => {
  it("sniffs by filename, content type, then content", () => {
    expect(detectFormat("", "parcels.geojson")).toBe("geojson");
    expect(detectFormat("", "parcels.csv")).toBe("csv");
    expect(detectFormat("", undefined, "application/json")).toBe("geojson");
    expect(detectFormat('{"type":"FeatureCollection"}')).toBe("geojson");
    expect(detectFormat("parcel_id,address")).toBe("csv");
    expect(parseParcels("parcel_id,address,lat,lng\nA,x,1,2").rows).toHaveLength(1);
  });

  it("keeps the last occurrence of a duplicated parcel_id", () => {
    const { rows } = parseCsv("parcel_id,address,lat,lng\nA,first,1,2\nA,second,3,4\n");
    const d = dedupeParcels(rows);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].address).toBe("second");
    expect(d.duplicates[0].row).toBe(1);
  });
});
