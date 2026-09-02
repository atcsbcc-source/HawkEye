import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client boundary.
 *
 * - `getSupabase()`        cookie-bound, RLS-scoped client for the signed-in user
 *                          (Server Components, route handlers). Null in DEV MODE
 *                          (no NEXT_PUBLIC_SUPABASE_URL) so callers fall back to
 *                          mock data exactly as before.
 * - `getServiceSupabase()` memoized service-role client for privileged writes.
 *
 * This module is `server-only`: importing it from a client component is a
 * build error, which is what keeps SUPABASE_SERVICE_ROLE_KEY off the wire.
 */

export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const store = cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list) {
        try {
          for (const { name, value, options } of list) {
            store.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies; middleware.ts refreshes the
          // session cookies on every request, so this is safe to ignore.
        }
      },
    },
  });
}

const g = globalThis as unknown as { __hawkeyeServiceClient?: SupabaseClient | null };

export function getServiceSupabase(): SupabaseClient | null {
  if (g.__hawkeyeServiceClient !== undefined) return g.__hawkeyeServiceClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Do not memoize the null: env may be loaded later in tests/tools.
    return null;
  }
  g.__hawkeyeServiceClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return g.__hawkeyeServiceClient;
}
