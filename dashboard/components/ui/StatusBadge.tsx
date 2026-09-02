import clsx from "clsx";
import type { StatusStyle } from "@/lib/ui/status";

/**
 * Pill badge for any status in `lib/ui/status.ts`.
 * `pulse` animates the dot (airborne aircraft / active mission).
 */
export function StatusBadge({
  status,
  size = "sm",
  dot = true,
  pulse = false,
  className,
  label,
}: {
  status: StatusStyle;
  size?: "sm" | "md";
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  /** Override the label (e.g. uppercase mono variants). */
  label?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        status.badge,
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden
          className={clsx(
            "h-1.5 w-1.5 rounded-full",
            status.dot,
            pulse && "motion-safe:animate-pulse",
          )}
        />
      )}
      {label ?? status.label}
    </span>
  );
}
