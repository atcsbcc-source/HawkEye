import { getUser, isDevMode } from "@/lib/server/auth";

/**
 * Server component. The ONLY data-source / dev badge in the header:
 * amber DEV MODE badge when auth is disabled, otherwise the signed-in
 * operator's email + a sign-out form.
 */
export async function SessionChip() {
  if (isDevMode()) {
    return (
      <span
        title="No NEXT_PUBLIC_SUPABASE_URL: authentication is disabled and the console shows mock data"
        className="rounded-md border border-amber-400/50 bg-amber-400/10 px-2 py-1 text-[11px] font-semibold tracking-wide text-amber-300"
      >
        DEV MODE · no auth · mock data
      </span>
    );
  }

  const user = await getUser();
  if (!user) return null;

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-slate-300">
        {user.email}
        {user.role === "admin" && (
          <span className="ml-2 rounded border border-surface-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
            admin
          </span>
        )}
      </span>
      <form method="post" action="/api/auth/signout">
        <button
          type="submit"
          className="rounded-md border border-surface-border bg-surface px-2 py-1 text-[11px] text-slate-300 transition hover:border-amber-400 hover:text-white"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
