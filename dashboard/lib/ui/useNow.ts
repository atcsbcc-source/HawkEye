"use client";

import { useEffect, useState } from "react";

/**
 * Ticking clock that is `null` on the server and during hydration, then the
 * current epoch ms every `ms` milliseconds. Render an absolute date while it
 * is null to avoid hydration mismatches on relative strings.
 *
 * Lives apart from lib/format.ts so server components can import the
 * formatters without pulling React hooks.
 */
export function useNow(ms = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(iv);
  }, [ms]);
  return now;
}
