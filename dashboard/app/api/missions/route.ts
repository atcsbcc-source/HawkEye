import { NextResponse } from "next/server";
import {
  abortMission,
  createMission,
  launchMission,
  listMissions,
  syncMissionProgress,
} from "@/lib/server/ops";

export const dynamic = "force-dynamic";

export async function GET() {
  syncMissionProgress();
  return NextResponse.json({ missions: listMissions() });
}

/** POST { name, polygon: [lat,lng][] } — queue a new mapping mission. */
export async function POST(req: Request) {
  let body: { name?: string; polygon?: [number, number][] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.name || !Array.isArray(body.polygon) || body.polygon.length < 3) {
    return NextResponse.json(
      { error: "name and polygon (>= 3 [lat,lng] points) required" },
      { status: 400 }
    );
  }
  return NextResponse.json({ mission: createMission(body.name, body.polygon) });
}

/** PATCH { id, action: "launch" | "abort" } */
export async function PATCH(req: Request) {
  let body: { id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.id || !["launch", "abort"].includes(body.action ?? "")) {
    return NextResponse.json({ error: "id and action required" }, { status: 400 });
  }
  const mission =
    body.action === "launch"
      ? await launchMission(body.id)
      : await abortMission(body.id);
  if (!mission) {
    return NextResponse.json(
      { error: "Mission not actionable (already active elsewhere, or wrong state)" },
      { status: 409 }
    );
  }
  return NextResponse.json({ mission });
}
