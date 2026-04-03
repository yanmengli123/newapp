/**
 * ESC Atlas Overview API — single merged endpoint with in-memory cache.
 * All overview data fetched via GET /overview/summary in one request,
 * cached for the lifetime of the page session.
 */
import { apiFetch } from "./apiClient";

export interface SampleComposition {
  stages: string[];
  male: number[];
  female: number[];
}

export interface SexBiasedGenes {
  stages: string[];
  female: number[];
  male: number[];
}

export interface FemaleMaleScatter {
  genes: Array<{
    gene_id: string;
    stage: string;
    female_mean: number;
    male_mean: number;
    sex_bias_label: string | null;
  }>;
  count: number;
}

export interface StageDEGCount {
  stages: string[];
  up: number[];
  down: number[];
}

export interface Top50Heatmap {
  genes: string[];
  samples: string[];
  matrix: number[][];
  zmatrix: number[][];
}

export interface PCA {
  samples: Array<{ sample_name: string; stage: string; sex: string }>;
  pc1: number[];
  pc2: number[];
  explained_variance_ratio: number[];
}

export interface ExpressionDistribution {
  stages: string[];
  q1: number[];
  median: number[];
  q3: number[];
  gene_count: number[];
}

export interface TrajectoryClusters {
  stages: string[];
  centroids: number[][];
  clusters: Array<{
    cluster_id: number;
    gene_count: number;
    gene_ids: string[];
  }>;
}

export interface OverviewSummary {
  status: string;
  sample_composition: SampleComposition;
  sex_biased_genes: SexBiasedGenes;
  female_male_scatter: FemaleMaleScatter;
  stage_deg_count: StageDEGCount;
  expression_distribution: ExpressionDistribution;
  pca: PCA;
  top50_heatmap: Top50Heatmap;
  trajectory_clusters: TrajectoryClusters;
}

// ── Session cache ─────────────────────────────────────────────────────────────

let _cache: OverviewSummary | null = null;
let _promise: Promise<OverviewSummary> | null = null;

/**
 * Fetch all overview data in a single request.
 * Result is cached for the browser session — subsequent calls return the
 * cached Promise, so multiple simultaneous callers get the same data.
 */
export function getOverviewSummary(): Promise<OverviewSummary> {
  if (_cache) return Promise.resolve(_cache);
  if (_promise) return _promise;

  _promise = apiFetch<OverviewSummary>("/overview/summary").then((data) => {
    _cache = data;
    return data;
  });

  return _promise;
}
