import Link from "next/link";
import { redirect } from "next/navigation";
import { Crosshair } from "lucide-react";
import { LoginForm } from "@/components/auth/LoginForm";
import { getUser, isDevMode } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string; error?: string };
}) {
  const dev = isDevMode();
  if (!dev && (await getUser())) redirect("/");

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center">
      <div className="rounded-xl border border-surface-border bg-surface-raised p-6">
        <div className="mb-6 flex items-center gap-2">
          <Crosshair className="h-6 w-6 text-amber-400" />
          <div>
            <p className="text-sm font-bold tracking-widest text-white">HAWKEYE</p>
            <p className="text-[11px] text-slate-400">Operator sign-in</p>
          </div>
        </div>

        {dev ? (
          <div className="flex flex-col gap-3">
            <p className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
              DEV MODE: auth disabled, mock data. Set NEXT_PUBLIC_SUPABASE_URL to enable
              sign-in.
            </p>
            <Link href="/" className="text-sm text-amber-400 hover:underline">
              Continue to the console →
            </Link>
          </div>
        ) : (
          <>
            {searchParams?.error === "invalid_link" && (
              <p className="mb-4 rounded-md border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-300">
                That invitation or recovery link is invalid or has expired.
              </p>
            )}
            <LoginForm next={searchParams?.next ?? null} />
          </>
        )}
      </div>
    </div>
  );
}
