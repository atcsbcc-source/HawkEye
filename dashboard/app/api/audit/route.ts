import { NextResponse } from "next/server";
import { listEvents } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { AuditQuery } from "@/lib/server/schemas";
import { parseQuery } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

/** GET /api/audit?limit=60 */
export const GET = withAuth(async (req) => {
  const q = parseQuery(req, AuditQuery);
  if (!q.ok) return q.res;
  return NextResponse.json({ events: await listEvents(q.data.limit ?? 60) });
});
