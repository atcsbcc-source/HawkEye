import type { Metadata } from "next";
import { AutomationPanel } from "@/components/ops/AutomationPanel";
import { SweepBar } from "@/components/automation/SweepBar";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Automation" };

export default function AutomationPage() {
  return (
    <div className="space-y-4">
      <SweepBar />
      <AutomationPanel />
    </div>
  );
}
