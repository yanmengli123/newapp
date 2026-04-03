/**
 * ESC Atlas Overview API — global aggregate data for homepage charts.
 * All calls go through apiFetch, which uses VITE_API_BASE (relative path in prod).
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

export const getSampleComposition = () =>
  apiFetch<{ status: string } & SampleComposition>("/overview/sample_composition");

export const getSexBiasedGenes = () =>
  apiFetch<{ status: string } & SexBiasedGenes>("/overview/sex_biased_genes");

export const getFemaleMaleScatter = (stage?: string) =>
  apiFetch<{ status: string } & FemaleMaleScatter>(
    stage ? `/overview/female_male_scatter?stage=${encodeURIComponent(stage)}` : "/overview/female_male_scatter"
  );

export const getStageDEGCount = () =>
  apiFetch<{ status: string } & StageDEGCount>("/overview/stage_deg_count");

export const getTop50Heatmap = () =>
  apiFetch<{ status: string } & Top50Heatmap>("/overview/top50_heatmap");

export const getPCA = () =>
  apiFetch<{ status: string } & PCA>("/overview/pca");

export const getExpressionDistribution = () =>
  apiFetch<{ status: string } & ExpressionDistribution>("/overview/expression_distribution");

export const getTrajectoryClusters = () =>
  apiFetch<{ status: string } & TrajectoryClusters>("/overview/trajectory_clusters");
