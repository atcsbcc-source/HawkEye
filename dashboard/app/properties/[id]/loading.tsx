import { Skeleton } from "@/components/ui/Skeleton";

export default function LoadingProperty() {
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
