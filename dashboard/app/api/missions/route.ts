import { NextResponse } from "next/server";
import {
  abortMission,
  createMission,
  launchMission,
  listMissions,
  syncMissionProgress,
} from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { MissionCreate, MissionPatch } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const MAX_QUEUED = 20;
const MAX_MISSIONS = 200;

export const GET = withAuth(async () => {
  syncMissionProgress();
  return NextResponse.json({ missions: listMissions() });
});

/** POST { name, polygon: [lat,lng][] } — queue a new mapping mission. */
export const POST = withAuth(async (req, user) => {
  const rl = rateLimit("missions:post", user.id, 20);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, MissionCreate);
  if (!body.ok) return body.res;

  const existing = listMissions();
  if (existing.length >= MAX_MISSIONS) {
    return apiError("Mission list is full; abort or complete existing missions", 409);
  }
  if (existing.filter((m) => m.status === "queued").length >= MAX_QUEUED) {
    return apiError(`At most ${MAX_QUEUED} missions may be queued`, 409);
  }

  const mission = createMission(body.data.name, body.data.polygon);
  return NextResponse.json({ mission });
});

/** PATCH { id, action: "launch" | "abort" } — admin only. */
export const PATCH = withAuth(
  async (req, user) => {
    const rl = rateLimit("missions:patch", user.id, 10);
    if (!rl.ok) return rateLimitResponse(rl);

    const body = await parseJson(req, MissionPatch);
    if (!body.ok) return body.res;
    const { id, action } = body.data;

    try {
      const mission = action === "launch" ? await launchMission(id) : await abortMission(id);
      if (!mission) {
        return apiError("Mission not actionable (already active elsewhere, or wrong state)", 409);
      }
      return NextResponse.json({ mission });
    } catch (err) {
      console.error(`[missions] ${action} failed`, (err as Error)?.message);
      return apiError(`Aircraft adapter rejected ${action}`, 502);
    }
  },
  { role: "admin" },
);
