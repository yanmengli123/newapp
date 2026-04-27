/**
 * GO Enrichment API client
 * Wraps /go-enrichment/* endpoints
 */

import { apiFetch } from './apiClient';

export interface MappingRecord {
  input_id: string;
  resolved_gene_id: string | null;
  ncbi_gene_id: string | null;
  gene_symbol: string | null;
  status: 'mapped' | 'not_found' | 'duplicated' | 'no_go_annotation';
}

export interface GOEnrichmentResult {
  go_id: string;
  term_name: string;
  namespace: 'biological_process' | 'molecular_function' | 'cellular_component';
  ontology: 'P' | 'C' | 'F';
  query_count: number;
  query_total: number;
  background_count: number;
  background_total: number;
  gene_ratio: string;
  background_ratio: string;
  p_value: number;
  fdr: number;
  hit_genes: string[];
  hit_ncbi_ids: string[];
  hit_symbols: string[];
}

export interface BarChartEntry {
  go_id: string;
  term_name: string;
  neg_log10_fdr: number;
  query_count: number;
  background_count: number;
}

export interface OntologyStats {
  background_count: number;
  tested_term_count: number;
  significant_count: number;
}

export interface EnrichmentResponse {
  query_count: number;
  mapped_count: number;
  annotated_count: number;
  background_count: number;
  tested_term_count: number;
  significant_count: number;
  annotation_source: string;
  annotation_mode: string;
  background_mode: string;
  parameters: Record<string, unknown>;
  ontology_stats: Record<string, OntologyStats>;
  mapping: MappingRecord[];
  results: GOEnrichmentResult[];
  bar_chart_data: { P: BarChartEntry[]; C: BarChartEntry[]; F: BarChartEntry[] };
}

export interface GOEnrichmentParams {
  gene_list: string[];
  correction?: string;
  fdr_cutoff?: number;
  min_overlap?: number;
  namespace?: string;
  annotation_mode?: string;
}

export interface ExampleGeneSet {
  name: string;
  description: string;
  genes: string[];
}

export interface ExampleSetsResponse {
  sets: ExampleGeneSet[];
}

export async function analyzeGOEnrichment(params: GOEnrichmentParams): Promise<EnrichmentResponse> {
  return apiFetch<EnrichmentResponse>('/go-enrichment/analyze', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getExampleSets(): Promise<ExampleSetsResponse> {
  return apiFetch<ExampleSetsResponse>('/go-enrichment/example-sets');
}

export async function getGOTermDetail(goId: string): Promise<Record<string, unknown>> {
  return apiFetch(`/go-enrichment/term/${goId}`);
}