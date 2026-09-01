import clsx from "clsx";

export function StatCard({
  label,
  value,
  icon,
  accent = false,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border p-4",
        accent
          ? "border-red-500/40 bg-red-500/5"
          : "border-surface-border bg-surface-raised"
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
        {icon}
      </div>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
    </div>
  );
}
