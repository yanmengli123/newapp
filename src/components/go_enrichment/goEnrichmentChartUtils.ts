/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GOEnrichmentResult } from "../../lib/goEnrichmentApi";

// ── Ontology metadata ──────────────────────────────────────────────────────

export const ONTOLOGY_META: Record<string, { label: string; color: string }> = {
  P: { label: "Biological Process", color: "#1A8CFF" },
  C: { label: "Cellular Component", color: "#FF9933" },
  F: { label: "Molecular Function", color: "#33CC66" },
};

// ── Chart term (derived from GOEnrichmentResult) ───────────────────────────

export interface ChartTerm {
  goId: string;
  name: string;
  geneRatio: number;
  geneRatioText: string;
  count: number;
  negLog10Fdr: number;
  fdr: number;
  pValue: number;
  hitGenes: string[];
  hitSymbols: string[];
  _original: GOEnrichmentResult;
}

// ── Ratio parsing ──────────────────────────────────────────────────────────

export function parseRatio(ratio: string): number {
  const [a, b] = ratio.split("/").map(Number);
  return b > 0 ? a / b : 0;
}

// ── Top N extraction ───────────────────────────────────────────────────────

export function getTopTerms(
  results: GOEnrichmentResult[],
  ontology: "P" | "C" | "F",
  topN: number,
  significantOnly: boolean,
): ChartTerm[] {
  return results
    .filter((t) => t.ontology === ontology)
    .filter((t) => !significantOnly || t.significant)
    .sort((a, b) => a.fdr - b.fdr || b.query_count - a.query_count)
    .slice(0, topN)
    .reverse() // most significant on top in ECharts horizontal layout
    .map((t) => ({
      goId: t.go_id,
      name: t.term_name,
      geneRatio: parseRatio(t.gene_ratio),
      geneRatioText: t.gene_ratio,
      count: t.query_count,
      negLog10Fdr: -Math.log10(Math.max(t.fdr, 1e-300)),
      fdr: t.fdr,
      pValue: t.p_value,
      hitGenes: t.hit_genes,
      hitSymbols: t.hit_symbols,
      _original: t,
    }));
}

// ── Global max -log10(FDR) across all ontologies ───────────────────────────

export function globalMaxNegLog10Fdr(
  results: GOEnrichmentResult[],
  significantOnly: boolean,
): number {
  let max = 0;
  for (const t of results) {
    if (significantOnly && !t.significant) continue;
    const v = -Math.log10(Math.max(t.fdr, 1e-300));
    if (v > max) max = v;
  }
  return max || 1;
}

// ── Significance color scale (warm → cool, matches enrichplot convention) ──

export const SIG_COLOR_RANGE = ["#fee08b", "#66c2a5", "#3288bd", "#253494"];

// ── Color interpolation for significance ───────────────────────────────────

const SIG_STOPS: Array<{ pos: number; r: number; g: number; b: number }> = [
  { pos: 0.00, r: 254, g: 224, b: 139 }, // #fee08b
  { pos: 0.33, r: 102, g: 194, b: 165 }, // #66c2a5
  { pos: 0.66, r: 50, g: 136, b: 189 },  // #3288bd
  { pos: 1.00, r: 37, g: 52, b: 148 },   // #253494
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function sigColor(negLog10Fdr: number, max: number): string {
  const t = max > 0 ? Math.min(1, Math.max(0, negLog10Fdr / max)) : 0;
  let lo = SIG_STOPS[0];
  let hi = SIG_STOPS[SIG_STOPS.length - 1];
  for (let i = 0; i < SIG_STOPS.length - 1; i++) {
    if (t >= SIG_STOPS[i].pos && t <= SIG_STOPS[i + 1].pos) {
      lo = SIG_STOPS[i];
      hi = SIG_STOPS[i + 1];
      break;
    }
  }
  const segLen = hi.pos - lo.pos || 1;
  const local = (t - lo.pos) / segLen;
  const r = lerp(lo.r, hi.r, local);
  const g = lerp(lo.g, hi.g, local);
  const b = lerp(lo.b, hi.b, local);
  return `rgb(${r},${g},${b})`;
}

// ── Dynamic panel height ───────────────────────────────────────────────────

export function panelHeight(termCount: number): number {
  return Math.min(620, Math.max(280, termCount * 30 + 110));
}

// ── Tooltip formatter (shared) ─────────────────────────────────────────────

const TOOLTIP_GENE_LIMIT = 20;

function truncateGeneList(genes: string[]): string {
  if (genes.length <= TOOLTIP_GENE_LIMIT) return genes.join(", ");
  const shown = genes.slice(0, TOOLTIP_GENE_LIMIT).join(", ");
  return `${shown} ... +${genes.length - TOOLTIP_GENE_LIMIT} more`;
}

export function buildTooltipHtml(t: ChartTerm): string {
  const genes = t.hitSymbols.length > 0 ? t.hitSymbols : t.hitGenes;
  return [
    `<b>${t.goId}</b>`,
    `${t.name}`,
    "",
    `GeneRatio: ${t.geneRatioText} (${t.geneRatio.toFixed(3)})`,
    `Count: ${t.count}`,
    `p-value: ${t.pValue.toExponential(2)}`,
    `FDR: ${t.fdr.toExponential(2)}`,
    "",
    `Hit genes: ${truncateGeneList(genes)}`,
  ].join("<br/>");
}

// ── Truncate long labels ───────────────────────────────────────────────────

export function truncateLabel(label: string, maxLen = 45): string {
  return label.length > maxLen ? label.slice(0, maxLen - 1) + "…" : label;
}
