import { AutomationPanel } from "@/components/ops/AutomationPanel";
import { SweepBar } from "@/components/automation/SweepBar";

export const dynamic = "force-dynamic";

export default function AutomationPage() {
  return (
    <div className="space-y-4">
      <SweepBar />
      <AutomationPanel />
    </div>
  );
}
