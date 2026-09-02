import Link from "next/link";
import { redirect } from "next/navigation";
import { SetPasswordForm } from "@/components/auth/SetPasswordForm";
import { getUser, isDevMode } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Reached from /auth/confirm after an invite or recovery link. */
export default async function SetPasswordPage() {
  if (isDevMode()) {
    return (
      <div className="mx-auto max-w-sm rounded-xl border border-surface-border bg-surface-raised p-6">
        <p className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          DEV MODE: auth disabled, mock data.
        </p>
        <Link href="/" className="mt-3 inline-block text-sm text-amber-400 hover:underline">
          Back to the console →
        </Link>
      </div>
    );
  }
  const user = await getUser();
  if (!user) redirect("/login?error=invalid_link");

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center">
      <div className="rounded-xl border border-surface-border bg-surface-raised p-6">
        <p className="text-sm font-semibold text-white">Set your password</p>
        <p className="mb-4 mt-1 text-xs text-slate-400">Signed in as {user.email}</p>
        <SetPasswordForm />
      </div>
    </div>
  );
}
