import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { fetchLead, fetchNeighborhoods } from "@/lib/data";
import { PropertyForm } from "@/components/leads/PropertyForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit property" };

export default async function EditPropertyPage({ params }: { params: { id: string } }) {
  const [lead, neighborhoods] = await Promise.all([fetchLead(params.id), fetchNeighborhoods()]);
  if (!lead) notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={`/properties/${lead.id}`}
        className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back to {lead.address}
      </Link>
      <div>
        <h2 className="text-2xl font-semibold text-white">Edit property</h2>
        <p className="mt-1 text-sm text-slate-400">APN {lead.parcel_id} · status {lead.status}</p>
      </div>
      <PropertyForm initial={lead} neighborhoods={neighborhoods} />
    </div>
  );
}
