import clsx from "clsx";

export function ConfidenceBar({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-xs text-slate-500">no scan</span>;
  }
  const tone =
    value >= 75 ? "bg-red-500" : value >= 50 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-700">
        <div className={clsx("h-full", tone)} style={{ width: `${value}%` }} />
      </div>
      <span className="w-7 text-right text-xs tabular-nums text-slate-300">
        {value}
      </span>
    </div>
  );
}
