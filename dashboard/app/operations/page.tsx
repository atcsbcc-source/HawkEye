import type { Metadata } from "next";
import { fetchLeads } from "@/lib/data";
import { OpsConsole } from "@/components/ops/OpsConsole";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Operations" };

export default async function OperationsPage() {
  const leads = await fetchLeads();
  return <OpsConsole leads={leads} />;
}
