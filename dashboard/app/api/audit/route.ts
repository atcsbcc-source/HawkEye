import { NextResponse } from "next/server";
import { listEvents } from "@/lib/server/ops";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ events: await listEvents(60) });
}
