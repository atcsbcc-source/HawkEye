import { Suspense } from "react";
import type { Metadata } from "next";
import { fetchLeads, fetchScans } from "@/lib/data";
import { ReviewQueue, type ReviewItem } from "@/components/crm/ReviewQueue";
import { Skeleton } from "@/components/ui/Skeleton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review" };

/** Cap so a big flight does not sign hundreds of imagery URLs per page load. */
const QUEUE_LIMIT = 25;
const SCANS_PER_PARCEL = 3;

/**
 * Verification queue: flagged parcels with no verdict (or `needs_recheck`),
 * highest confidence first.
 */
export default function ReviewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ReviewBody />
    </Suspense>
  );
}

async function ReviewBody() {
  const leads = await fetchLeads();
  const pending = leads
    .filter(
      (l) => l.status === "flagged" && (!l.verification || l.verification === "needs_recheck"),
    )
    .sort((a, b) => (b.latest_vacancy_confidence ?? -1) - (a.latest_vacancy_confidence ?? -1))
    .slice(0, QUEUE_LIMIT);
  const items: ReviewItem[] = await Promise.all(
    pending.map(async (lead) => ({
      lead,
      scans: (await fetchScans(lead.id)).slice(0, SCANS_PER_PARCEL),
    })),
  );
  return <ReviewQueue items={items} />;
}
