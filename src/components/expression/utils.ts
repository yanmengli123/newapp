/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ExpressionSample } from "../../lib/geneApi";

export function isValidNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function normalizeSex(s: string | null | undefined): "Male" | "Female" | null {
  if (s === "Male" || s === "M" || s === "m") return "Male";
  if (s === "Female" || s === "F" || s === "f") return "Female";
  return null;
}

export const STAGE_ORDER: Record<string, number> = {
  E0: 1, "E3.5": 2, E7: 3, "E11": 4, "E14": 5, "E18.5": 6, P0: 7, Adult: 8,
};

export function sortStages(stages: string[]): string[] {
  return [...stages].sort((a, b) => (STAGE_ORDER[a] ?? 99) - (STAGE_ORDER[b] ?? 99));
}

export function resolveStageMeans(
  stageMeans: Record<string, Record<string, number> | number | null> | null | undefined
): {
  stages: string[];
  maleValues: number[];
  femaleValues: number[];
  meanValues: number[];
} {
  if (!stageMeans || typeof stageMeans !== "object") {
    return { stages: [], maleValues: [], femaleValues: [], meanValues: [] };
  }

  const entries = Object.entries(stageMeans as Record<string, unknown>);
  entries.sort(([a], [b]) => {
    const ai = STAGE_ORDER[a] ?? 99;
    const bi = STAGE_ORDER[b] ?? 99;
    return ai - bi;
  });

  const stages: string[] = [];
  const maleValues: number[] = [];
  const femaleValues: number[] = [];
  const meanValues: number[] = [];

  for (const [stage, val] of entries) {
    if (!stage) continue;
    stages.push(stage);

    if (val != null && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      maleValues.push(isValidNumber(obj["male"]) ? (obj["male"] as number) : 0);
      femaleValues.push(isValidNumber(obj["female"]) ? (obj["female"] as number) : 0);
      const meanVal = isValidNumber(obj["mean"])
        ? (obj["mean"] as number)
        : Object.values(obj).find(isValidNumber) ?? 0;
      meanValues.push(meanVal);
    } else if (isValidNumber(val)) {
      maleValues.push(0);
      femaleValues.push(0);
      meanValues.push(val);
    } else {
      maleValues.push(0);
      femaleValues.push(0);
      meanValues.push(0);
    }
  }

  return { stages, maleValues, femaleValues, meanValues };
}

export const DATASET_DISPLAY_NAMES: Record<string, string> = {
  day_deseq2_36: "DESeq2 NC — 36 发育阶段样本",
  raw_ballgown_36: "Ballgown TPM/FPKM — 36 发育阶段样本",
  esc_srr_23: "ESC SRR Runs — 23 个 SRA Runs",
};

export function getDatasetDisplayName(code: string): string {
  return DATASET_DISPLAY_NAMES[code] ?? code;
}

export function getMetricLabel(metric: string): string {
  if (metric === "tpm" || metric === "fpkm") return metric.toUpperCase();
  if (metric === "normcount") return "Normalized Count";
  if (metric === "raw_count") return "Raw Count";
  return metric;
}

export function sortSamples(samples: ExpressionSample[]): ExpressionSample[] {
  return [...samples].sort((a, b) => {
    const sa = a.stage_order ?? STAGE_ORDER[a.stage ?? ""] ?? 99;
    const sb = b.stage_order ?? STAGE_ORDER[b.stage ?? ""] ?? 99;
    if (sa !== sb) return sa - sb;
    const sexA = a.sex === "Male" ? 0 : a.sex === "Female" ? 1 : 2;
    const sexB = b.sex === "Male" ? 0 : b.sex === "Female" ? 1 : 2;
    if (sexA !== sexB) return sexA - sexB;
    return (a.replicate ?? 0) - (b.replicate ?? 0);
  });
}

export function groupSamplesByStageSex(
  samples: ExpressionSample[]
): Record<string, { male: number[]; female: number[] }> {
  const result: Record<string, { male: number[]; female: number[] }> = {};
  for (const s of samples) {
    if (!s.stage) continue;
    if (!result[s.stage]) result[s.stage] = { male: [], female: [] };
    const canon = normalizeSex(s.sex);
    if (canon === "Male" && isValidNumber(s.value)) result[s.stage].male.push(s.value);
    if (canon === "Female" && isValidNumber(s.value)) result[s.stage].female.push(s.value);
  }
  return result;
}

export const PLOT_CONFIG: any = {
  displayModeBar: false,
  responsive: true,
  locale: "en",
};

export const PAPER_STYLE = {
  paper_bgcolor: "white" as const,
  plot_bgcolor: "white" as const,
};
