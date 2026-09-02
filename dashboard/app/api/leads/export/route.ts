import { NextResponse } from "next/server";
import { fetchLeads } from "@/lib/data";
import { exportFileName, filterLeads, leadsToCsv, leadsToGeoJson } from "@/lib/export/leads";
import { withAuth } from "@/lib/server/auth";
import { trustProxy } from "@/lib/server/rate-limit";
import type { LeadStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: LeadStatus[] = ["active", "flagged", "dispatched"];

/**
 * Public origin for absolute detail links. Prefers the configured SITE_URL;
 * otherwise honours x-forwarded-* only behind a trusted proxy (TRUST_PROXY=1,
 * like middleware.ts and rate-limit.ts) and only for http/https, so a direct
 * client cannot inject an arbitrary scheme or host into the exported file.
 */
function publicOrigin(req: Request): string {
  const site = process.env.SITE_URL;
  if (site) {
    try {
      return new URL(site).origin;
    } catch {
      /* fall through to the request */
    }
  }
  const url = new URL(req.url);
  let proto = url.protocol.replace(":", "");
  let host = req.headers.get("host") ?? url.host;
  if (trustProxy()) {
    const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    if (fwdProto === "http" || fwdProto === "https") proto = fwdProto;
    const fwdHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (fwdHost) host = fwdHost;
  }
  return `${proto}://${host}`;
}

/**
 * GET /api/leads/export?status=&neighborhood=&minDays=&format=csv|geojson
 * Hands the current lead list to a VA / skip-tracing service. detail_url is
 * absolute, derived from SITE_URL or the (trusted) request origin.
 */
export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams;
  const format = (q.get("format") ?? "csv").toLowerCase();
  if (format !== "csv" && format !== "geojson") {
    return NextResponse.json({ error: "format must be csv or geojson" }, { status: 400 });
  }
  const statusRaw = q.get("status");
  if (statusRaw && !STATUSES.includes(statusRaw as LeadStatus)) {
    return NextResponse.json(
      { error: `status must be one of ${STATUSES.join(", ")}` },
      { status: 400 },
    );
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

  const origin = publicOrigin(req);
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
});
