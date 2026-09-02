import { NextResponse } from "next/server";
import { listMissions } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { planGrid } from "@/lib/drone/grid";
import { buildKml, safeFileName } from "@/lib/drone/wpml";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/** GET /api/missions/[id]/kml — plain KML (AO polygon + serpentine) for Google Earth. */
export const GET = withAuth<Params>(async (req, _user, { params }) => {
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
    if (err instanceof RangeError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    console.error("[missions] kml export failed", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
});
