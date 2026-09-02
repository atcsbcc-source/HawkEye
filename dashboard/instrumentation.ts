/**
 * Next.js instrumentation hook (needs `experimental.instrumentationHook` in
 * next.config.mjs). Validates the environment once at boot so a
 * misconfigured deployment fails loudly instead of degrading silently.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnv, isDevMode } = await import("./lib/server/env");
  validateEnv();
  console.log(`[hawkeye] mode: ${isDevMode() ? "dev (no auth, mock data)" : "supabase"}`);
}
