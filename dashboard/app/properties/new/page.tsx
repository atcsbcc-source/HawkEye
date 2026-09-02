import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { fetchNeighborhoods } from "@/lib/data";
import { PropertyForm } from "@/components/leads/PropertyForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add property" };

export default async function NewPropertyPage() {
  const neighborhoods = await fetchNeighborhoods();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Command Center
      </Link>
      <div>
        <h2 className="text-2xl font-semibold text-white">Add property</h2>
        <p className="mt-1 text-sm text-slate-400">
          Track a new parcel. It starts <span className="text-slate-200">active</span> and is
          flagged automatically once a scan crosses the confidence threshold.
        </p>
      </div>
      <PropertyForm neighborhoods={neighborhoods} />
    </div>
  );
}
