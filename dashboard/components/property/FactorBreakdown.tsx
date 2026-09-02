import { BrainCircuit, ShieldAlert } from "lucide-react";
import clsx from "clsx";
import type { FactorScore, PropertyScan } from "@/lib/types";

/**
 * Why the model scored the latest sortie the way it did: probability, the
 * drivers, and a diverging bar per factor (evidence for vacancy in amber,
 * counter-evidence in emerald). Server component — data only.
 */
export function FactorBreakdown({ scan }: { scan: PropertyScan | undefined }) {
  const scores = scan?.factor_scores;
  if (!scan || !scores || !Array.isArray(scores.factors) || scores.factors.length === 0) {
    return (
      <section className="panel p-4" aria-labelledby="intel-title">
        <h2 id="intel-title" className="panel-title flex items-center gap-1.5">
          <BrainCircuit className="h-3.5 w-3.5" aria-hidden /> Intelligence
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          No factor breakdown for this scan yet — it appears once the pipeline scores the next
          sortie with the vacancy model.
        </p>
      </section>
    );
  }

  const weighted = scores.factors.filter((f) => f.weight !== 0);
  const observed = weighted
    .filter((f) => f.value !== null)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const unobserved = weighted.filter((f) => f.value === null);
  const maxAbs = Math.max(1, ...observed.map((f) => Math.abs(f.contribution)));
  const pct = Math.round(scores.probability * 100);

  return (
    <section className="panel p-4" aria-labelledby="intel-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="intel-title" className="panel-title flex items-center gap-1.5">
            <BrainCircuit className="h-3.5 w-3.5" aria-hidden /> Intelligence
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            {scores.top_drivers.length > 0 ? (
              <>
                Driven by <span className="text-white">{scores.top_drivers.join(", ")}</span>.
              </>
            ) : (
              "No factor argues for vacancy on this sortie."
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold tabular-nums text-white">
            {pct}
            <span className="text-sm text-slate-400">%</span>
          </p>
          <p className="text-label text-slate-400" title="Model that produced this score">
            {scores.model_version}
            {scores.model_version.startsWith("prior") && " · untrained"}
          </p>
        </div>
      </div>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-700"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Vacancy probability"
      >
        <div
          className={clsx("h-full", pct >= 75 ? "bg-red-500" : pct >= 50 ? "bg-amber-400" : "bg-emerald-500")}
          style={{ width: `${pct}%` }}
        />
      </div>

      {scores.gated && (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          The two crops did not register well, so the score is capped — treat every factor below as
          low confidence and re-fly if it matters.
        </p>
      )}

      <ul className="mt-4 space-y-2" aria-label="Factor contributions">
        {observed.map((f) => (
          <FactorRow key={f.name} factor={f} maxAbs={maxAbs} />
        ))}
      </ul>

      {unobserved.length > 0 && (
        <p className="mt-3 text-label text-slate-500">
          Not observed this sortie: {unobserved.map((f) => f.label.toLowerCase()).join(", ")}.
        </p>
      )}
      <p className="mt-2 text-label text-slate-500">
        Amber pushes toward vacancy, emerald against. Bar length = weight × z-score.
      </p>
    </section>
  );
}

function FactorRow({ factor, maxAbs }: { factor: FactorScore; maxAbs: number }) {
  const positive = factor.contribution >= 0;
  const width = Math.min(100, (Math.abs(factor.contribution) / maxAbs) * 100);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs">
      <span className="truncate text-slate-200">{factor.label}</span>
      <span className="font-mono tabular-nums text-slate-400">{fmtValue(factor.value)}</span>
      <div className="col-span-2 grid grid-cols-2 gap-1" aria-hidden>
        <div className="flex justify-end">
          {!positive && (
            <div className="h-1.5 rounded-l bg-emerald-400/80" style={{ width: `${width}%` }} />
          )}
        </div>
        <div className="flex justify-start">
          {positive && factor.contribution > 0 && (
            <div className="h-1.5 rounded-r bg-amber-400/90" style={{ width: `${width}%` }} />
          )}
        </div>
      </div>
      <span className="sr-only">
        contribution {factor.contribution >= 0 ? "+" : ""}
        {factor.contribution.toFixed(2)}
      </span>
    </li>
  );
}

function fmtValue(v: number | null): string {
  if (v === null) return "—";
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
