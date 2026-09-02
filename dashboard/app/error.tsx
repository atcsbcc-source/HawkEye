"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16">
      <div className="panel border-red-500/40 p-6">
        <p className="kicker text-red-300">Route error</p>
        <p className="mt-2 font-mono text-5xl font-semibold text-white">ERR</p>
        <p className="mt-3 text-sm text-slate-300">
          {error.message || "Something went wrong while rendering this view."}
        </p>
        {error.digest && (
          <p className="mt-1 font-mono text-label normal-case tracking-normal text-slate-400">
            digest {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={() => reset()} className="btn-primary">
            <RefreshCw className="h-4 w-4" aria-hidden /> Retry
          </button>
          <Link href="/" className="btn-secondary h-9 text-sm">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to Command Center
          </Link>
        </div>
      </div>
    </div>
  );
}
