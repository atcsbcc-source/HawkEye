import { NextResponse } from "next/server";
import { fetchLeads } from "@/lib/data";
import { exportFileName, filterLeads, leadsToCsv, leadsToGeoJson } from "@/lib/export/leads";
import type { LeadStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: LeadStatus[] = ["active", "flagged", "dispatched"];

/**
 * GET /api/leads/export?status=&neighborhood=&minDays=&format=csv|geojson
 * Hands the current lead list to a VA / skip-tracing service. detail_url is
 * absolute, derived from the request origin.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams;
  const format = (q.get("format") ?? "csv").toLowerCase();
  if (format !== "csv" && format !== "geojson") {
    return NextResponse.json({ error: "format must be csv or geojson" }, { status: 400 });
  }
  const statusRaw = q.get("status");
  if (statusRaw && !STATUSES.includes(statusRaw as LeadStatus)) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
  }
  const minDaysRaw = q.get("minDays");
  const minDays = minDaysRaw ? Number(minDaysRaw) : null;
  if (minDays !== null && (!Number.isFinite(minDays) || minDays < 0)) {
    return NextResponse.json({ error: "minDays must be a non-negative number" }, { status: 400 });
  }

  const leads = filterLeads(await fetchLeads(), {
    status: (statusRaw as LeadStatus) || null,
    neighborhood: q.get("neighborhood"),
    minDays,
  }).sort((a, b) => (b.latest_vacancy_confidence ?? -1) - (a.latest_vacancy_confidence ?? -1));

  // Honour reverse-proxy headers so detail links point at the public host.
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const origin = `${proto}://${host}`;

  const filename = exportFileName(format);
  if (format === "geojson") {
    return new Response(JSON.stringify(leadsToGeoJson(leads, origin)), {
      headers: {
        "Content-Type": "application/geo+json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(leadsToCsv(leads, origin), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
