/** Pure helpers shared by the flight form (client) and /api/flights (server). */

/** ISO-8601 week number and week-based year for a date. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** `FLT-YYYY-Www-NEIGHBORHOOD`, e.g. FLT-2026-W35-OAKWOOD. */
export function suggestFlightCode(flownAt: Date | string, neighborhood: string): string {
  const date = typeof flownAt === "string" ? new Date(flownAt) : flownAt;
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const { year, week } = isoWeek(safe);
  const hood =
    neighborhood
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "")
      .slice(0, 24) || "GRID";
  return `FLT-${year}-W${String(week).padStart(2, "0")}-${hood}`;
}
