import prior from "./prior.json";
import type { FactorScore, FactorScores } from "@/lib/types";

/**
 * TypeScript twin of pipeline/intel/model.py's scorer, driven by the same
 * prior.json (a pytest asserts the two copies are identical). Used to score
 * mock-mode scans so the console shows exactly what the pipeline would emit;
 * production scans carry the pipeline's own `factor_scores`.
 */
export interface FactorSpec {
  name: string;
  label: string;
  description?: string;
  center: number;
  scale: number;
  weight: number;
  gate?: boolean;
  threshold?: number;
  cap?: number;
}

export interface ModelDoc {
  version: string;
  bias: number;
  factors: FactorSpec[];
}

export const PRIOR_MODEL = prior as ModelDoc;

const Z_CLIP = 5;
const TOP_DRIVER_MIN = 0.15;

export type FactorValues = Record<string, number | null | undefined>;

export function scoreFactors(values: FactorValues, model: ModelDoc = PRIOR_MODEL): FactorScores {
  const factors: FactorScore[] = [];
  let logit = model.bias;
  for (const spec of model.factors) {
    if (spec.gate) continue;
    const raw = values[spec.name];
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    const z =
      value === null ? 0 : Math.max(-Z_CLIP, Math.min(Z_CLIP, (value - spec.center) / spec.scale));
    const contribution = spec.weight * z;
    logit += contribution;
    factors.push({
      name: spec.name,
      label: spec.label,
      value,
      z: round3(z),
      weight: spec.weight,
      contribution: round3(contribution),
    });
  }

  let probability = 1 / (1 + Math.exp(-logit));
  let gated = false;
  for (const spec of model.factors) {
    if (!spec.gate) continue;
    const raw = values[spec.name];
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    if (value !== null && spec.threshold !== undefined && value < spec.threshold) {
      probability = Math.min(probability, spec.cap ?? 0.4);
      gated = true;
    }
    factors.push({ name: spec.name, label: spec.label, value, z: 0, weight: 0, contribution: 0 });
  }

  const top_drivers = factors
    .filter((f) => f.contribution > TOP_DRIVER_MIN)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((f) => f.label);
  if (gated) top_drivers.push("Registration too poor — score capped");

  return {
    model_version: model.version,
    probability: Math.round(probability * 1e4) / 1e4,
    confidence: Math.round(probability * 100),
    gated,
    factors,
    top_drivers,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
