// Pure formatters only — safe to import from Server Components. The
// companion `useNow` hook lives in lib/ui/useNow.ts.

/** Fixed operations timezone so server and browser render identical strings. */
export const OPS_TZ = process.env.NEXT_PUBLIC_OPS_TZ ?? "America/New_York";

const LOCALE = "en-US";
const cache = new Map<string, Intl.DateTimeFormat>();

function dtf(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, { timeZone: OPS_TZ, ...opts });
    cache.set(key, f);
  }
  return f;
}

let rtf: Intl.RelativeTimeFormat | null = null;
function relFmt(): Intl.RelativeTimeFormat {
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "always", style: "narrow" });
  }
  return rtf;
}

export type DateInput = string | number | Date | null | undefined;

function toMs(d: DateInput): number | null {
  if (d == null) return null;
  const t = d instanceof Date ? d.getTime() : typeof d === "number" ? d : Date.parse(d);
  return Number.isFinite(t) ? t : null;
}

/** `Aug 31` */
export function fmtDate(d: DateInput): string {
  const t = toMs(d);
  if (t === null) return "—";
  return dtf("date", { month: "short", day: "numeric" }).format(t);
}

/** `Mon, Aug 31, 2026` — used by the header. */
export function fmtLongDate(d: DateInput): string {
  const t = toMs(d);
  if (t === null) return "—";
  return dtf("long", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(t);
}

/** `Aug 31, 2026` — tables and snooze dates where the year matters. */
export function fmtFullDate(d: DateInput): string {
  const t = toMs(d);
  if (t === null) return "—";
  return dtf("full", { month: "short", day: "numeric", year: "numeric" }).format(t);
}

/** `Aug 31 · 14:05` */
export function fmtDateTime(d: DateInput): string {
  const t = toMs(d);
  if (t === null) return "—";
  const date = fmtDate(t);
  const time = dtf("hm", { hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
  return `${date} · ${time}`;
}

/** `14:05:09` */
export function fmtTime(d: DateInput): string {
  const t = toMs(d);
  if (t === null) return "—";
  return dtf("hms", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(t);
}

/**
 * `12s ago` / `5m ago` / `3h ago` / `2d ago`; falls back to `fmtDate` past
 * 30 days. Pass `now` to keep renders deterministic (see `useNow`).
 */
export function fmtRelative(d: DateInput, now: number = Date.now()): string {
  const t = toMs(d);
  if (t === null) return "—";
  const diffS = Math.round((t - now) / 1000);
  const abs = Math.abs(diffS);
  const f = relFmt();
  if (diffS === 0) return "now";
  if (abs < 60) return f.format(diffS, "second");
  if (abs < 3600) return f.format(Math.round(diffS / 60), "minute");
  if (abs < 86_400) return f.format(Math.round(diffS / 3600), "hour");
  if (abs < 86_400 * 30) return f.format(Math.round(diffS / 86_400), "day");
  return fmtDate(t);
}

/** Age in whole seconds as `3s` / `2m 05s`. */
export function fmtAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${String(rem).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/** `91 /100` */
export function fmtScore(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v)} /100`;
}

/** `12.5%` (default one decimal, trailing zeros trimmed). */
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const n = Number(v.toFixed(digits));
  return `${n}%`;
}

/** `94 d` */
export function fmtDays(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v)} d`;
}
