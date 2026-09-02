import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit tests live under dashboard/__tests__/** mirroring lib/ paths.
 * `server-only` is aliased to an empty stub because lib/supabase.ts imports it
 * and the real package throws outside a React Server Component.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "__tests__/stubs/server-only.ts"),
    },
  },
});
