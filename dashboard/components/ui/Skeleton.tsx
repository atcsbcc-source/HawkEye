import clsx from "clsx";

/** Pulsing placeholder block. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx("rounded-lg bg-surface-hover motion-safe:animate-pulse", className)}
    />
  );
}

/** Three row skeletons for list panels waiting on their first response. */
export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={clsx("space-y-2", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
