import type { Metadata } from "next";
import { AutomationPanel } from "@/components/ops/AutomationPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Automation" };

export default function AutomationPage() {
  return <AutomationPanel />;
}
