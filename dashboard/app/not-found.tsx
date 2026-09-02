import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-16">
      <div className="panel p-6">
        <p className="kicker">Not found</p>
        <p className="mt-2 font-mono text-5xl font-semibold text-white">404</p>
        <p className="mt-3 text-sm text-slate-300">
          This parcel or route does not exist — it may have been removed, or the link is out of
          date.
        </p>
        <Link href="/" className="btn-secondary mt-6">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to Command Center
        </Link>
      </div>
    </div>
  );
}
