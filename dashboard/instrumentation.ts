/**
 * Next.js instrumentation hook (needs `experimental.instrumentationHook` in
 * next.config.mjs). Validates the environment once at boot so a
 * misconfigured deployment fails loudly instead of degrading silently: in
 * production the process exits so an orchestrator notices, instead of staying
 * up and answering every request with a 500.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnv, isDevMode } = await import("./lib/server/env");
  try {
    validateEnv();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    if (process.env.NODE_ENV === "production") process.exit(1);
    throw err;
  }
  console.log(`[hawkeye] mode: ${isDevMode() ? "dev (no auth, mock data)" : "supabase"}`);

  // Self-hosted without a trusted proxy: Request.ip is absent, so per-IP rate
  // limits collapse to one shared bucket. Vercel populates req.ip itself.
  if (!isDevMode() && process.env.TRUST_PROXY !== "1" && !process.env.VERCEL) {
    console.warn(
      "[hawkeye] TRUST_PROXY is not 1 and no platform request IP is available: " +
        "per-IP login rate limiting is disabled (a shared ceiling applies). " +
        "Set TRUST_PROXY=1 behind your reverse proxy.",
    );
  }
}
