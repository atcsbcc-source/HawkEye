import { NextResponse } from "next/server";
import { listMissions } from "@/lib/server/ops";
import { planGrid } from "@/lib/drone/grid";
import { buildKmz, safeFileName } from "@/lib/drone/wpml";

export const dynamic = "force-dynamic";

/**
 * GET /api/missions/[id]/kmz[?altitude=90&front=0.75&side=0.65]
 * DJI WPML package for DJI Fly / DJI Pilot 2 (wpmz/template.kml + wpmz/waylines.wpml).
 */
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
    const bytes = buildKmz(mission, plan);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/vnd.google-earth.kmz",
        "Content-Disposition": `attachment; filename="${safeFileName(mission.name)}.kmz"`,
        "Cache-Control": "no-store",
        "X-HawkEye-Waypoints": String(plan.waypoints.length),
        "X-HawkEye-GSD-cm": String(plan.gsdCmPerPx),
      },
    });
  } catch (err) {
    const status = err instanceof RangeError ? 422 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Export failed" }, { status });
  }
}
