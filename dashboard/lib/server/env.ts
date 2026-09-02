import { z } from "zod";
import { assertSafeWebhookUrlSync } from "./safe-fetch";

/**
 * Runtime configuration. `isDevMode()` is the single switch the whole app
 * keys on: no NEXT_PUBLIC_SUPABASE_URL means mock data and no auth.
 *
 * `validateEnv()` is called once from instrumentation.ts at boot and refuses
 * to start an unauthenticated console in production by accident.
 *
 * Deliberately free of `server-only`/next imports so it is unit-testable.
 */
export function isDevMode(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

const optionalString = z.string().trim().min(1).optional();

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).optional(),
    NEXT_PUBLIC_SUPABASE_URL: z
      .string()
      .url()
      .refine((u) => {
        const { protocol, hostname } = new URL(u);
        return (
          protocol === "https:" &&
          (hostname.endsWith(".supabase.co") || hostname.endsWith(".supabase.in"))
        );
      }, "must be an https://*.supabase.co URL")
      .optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    CRM_WEBHOOK_URL: z
      .string()
      .trim()
      .min(1)
      .refine(
        (u) => {
          try {
            assertSafeWebhookUrlSync(u);
            return true;
          } catch {
            return false;
          }
        },
        { message: "must be a public https URL (see WEBHOOK_ALLOWED_HOSTS)" }
      )
      .optional(),
    HAWKEYE_PIPELINE_TOKEN: z.string().min(32, "must be at least 32 characters").optional(),
    CRON_SECRET: z.string().min(16, "must be at least 16 characters").optional(),
    WEBHOOK_SIGNING_SECRET: z.string().min(16, "must be at least 16 characters").optional(),
    WEBHOOK_ALLOWED_HOSTS: optionalString,
    TRUST_PROXY: z.enum(["0", "1"]).optional(),
    HAWKEYE_ALLOW_DEV_MODE: z.enum(["0", "1"]).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NEXT_PUBLIC_SUPABASE_URL) {
      if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
          message: "required when NEXT_PUBLIC_SUPABASE_URL is set",
        });
      }
      if (!env.SUPABASE_SERVICE_ROLE_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["SUPABASE_SERVICE_ROLE_KEY"],
          message: "required when NEXT_PUBLIC_SUPABASE_URL is set",
        });
      }
    } else if (env.NODE_ENV === "production" && env.HAWKEYE_ALLOW_DEV_MODE !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_SUPABASE_URL"],
        message:
          "refusing to boot an unauthenticated console in production; set NEXT_PUBLIC_SUPABASE_URL or HAWKEYE_ALLOW_DEV_MODE=1",
      });
    }
  });

export type HawkeyeEnv = z.infer<typeof EnvSchema>;

function pick(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  // Empty strings in .env files mean "unset".
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(EnvSchema.shape)) {
    const v = source[key];
    out[key] = v === "" ? undefined : v;
  }
  return out;
}

let cached: HawkeyeEnv | null = null;

/** Parse and cache process.env. Throws a readable error on misconfiguration. */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): HawkeyeEnv {
  const result = EnvSchema.safeParse(pick(source));
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".") || "env"}: ${i.message}`);
    throw new Error(`[hawkeye] invalid environment:\n${lines.join("\n")}`);
  }
  cached = result.data;
  return result.data;
}

export function getEnv(): HawkeyeEnv {
  return cached ?? validateEnv();
}
