import { NextResponse } from "next/server";
import { listMissions } from "@/lib/server/ops";
import { planGrid } from "@/lib/drone/grid";
import { buildKml, safeFileName } from "@/lib/drone/wpml";

export const dynamic = "force-dynamic";

/** GET /api/missions/[id]/kml — plain KML (AO polygon + serpentine) for Google Earth. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const mission = listMissions().find((m) => m.id === params.id);
  if (!mission) return NextResponse.json({ error: "Mission not found" }, { status: 404 });

  const q = new URL(req.url).searchParams;
  const num = (k: string) => (q.get(k) === null ? undefined : Number(q.get(k)));
  try {
    const plan = planGrid(mission.polygon, {
      altitudeM: num("altitude"),
      frontOverlap: num("front"),
      sideOverlap: num("side"),
    });
    return new Response(buildKml(mission, plan), {
      headers: {
        "Content-Type": "application/vnd.google-earth.kml+xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeFileName(mission.name)}.kml"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const status = err instanceof RangeError ? 422 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status },
    );
  }
}
