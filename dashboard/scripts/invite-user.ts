/**
 * Invite an operator or admin to HawkEye (invite-only auth; sign-ups are off).
 *
 * Usage (from dashboard/, with SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
 * + SITE_URL in the environment):
 *
 *   npx tsx scripts/invite-user.ts ops@example.com operator
 *   npx tsx scripts/invite-user.ts lead@example.com admin
 *
 * Sends the Supabase invite email whose link lands on /auth/confirm, which
 * exchanges the token and forwards to /auth/set-password. The role is stored
 * in app_metadata.role (only writable with the service role, never by the
 * user) and read by lib/server/auth.ts.
 *
 * Supabase dashboard settings to flip once (Authentication → Providers/Settings):
 *   - Email provider ON; "Allow new users to sign up" OFF
 *   - Leaked-password protection ON; minimum password length 12
 *   - Site URL = deployed origin; Redirect URLs += <origin>/auth/confirm
 *   - Email templates: link = {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}
 */
import { createClient } from "@supabase/supabase-js";

async function main(): Promise<void> {
  const [email, roleArg = "operator"] = process.argv.slice(2);
  const role = roleArg === "admin" ? "admin" : roleArg === "operator" ? "operator" : null;
  if (!email || !email.includes("@") || !role) {
    console.error("usage: invite-user.ts <email> [operator|admin]");
    process.exit(2);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const site = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!url || !key || !site) {
    console.error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SITE_URL are required");
    process.exit(2);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${site.replace(/\/$/, "")}/auth/confirm`,
    data: {},
  });
  if (error || !data.user) {
    console.error("invite failed:", error?.message ?? "unknown error");
    process.exit(1);
  }

  const { error: roleError } = await admin.auth.admin.updateUserById(data.user.id, {
    app_metadata: { role },
  });
  if (roleError) {
    console.error("invite sent but role update failed:", roleError.message);
    process.exit(1);
  }
  console.log(`invited ${email} as ${role} (user ${data.user.id})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
