import { NextResponse } from "next/server";
import {
  abortMission,
  createMission,
  launchMission,
  listMissions,
  MissionQueueFullError,
  syncMissionProgress,
} from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { MissionCreate, MissionPatch } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  syncMissionProgress();
  return NextResponse.json({ missions: listMissions() });
});

/**
 * POST { name, polygon: [lat,lng][] } — queue a new mapping mission. The store
 * owns the caps (MISSION_QUEUE_CAP queued, MISSION_KEEP_CAP retained with
 * finished missions pruned), so the route only maps its error to 409.
 */
export const POST = withAuth(async (req, user) => {
  const rl = rateLimit("missions:post", user.id, 20);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, MissionCreate);
  if (!body.ok) return body.res;

  try {
    const mission = createMission(body.data.name, body.data.polygon);
    return NextResponse.json({ mission });
  } catch (err) {
    if (err instanceof MissionQueueFullError) return apiError(err.message, 409);
    throw err;
  }
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
