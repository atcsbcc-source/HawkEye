import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Page-level skeletons rendered as in-page <Suspense> fallbacks. They live
 * here rather than as `loading.tsx` files on purpose: a segment `loading.tsx`
 * streams the shell before the page resolves, which forces a 200 status even
 * when the page then calls notFound(). Placing the boundary inside the page,
 * after the existence check, keeps the skeleton AND the real 404.
 */
export function CommandCenterSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading command center">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="panel">
        <div className="flex items-center gap-3 border-b border-surface-border p-4">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="ml-auto h-8 w-40" />
        </div>
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function PropertySkeleton() {
  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
      aria-busy="true"
      aria-label="Loading property"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="ml-auto h-8 w-52" />
        </div>
        <Skeleton className="aspect-[4/3] w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    </div>
  );
}
