/**
 * Comparative Genomics API Client
 */

import { apiFetch } from "./apiClient";

export interface Assembly {
  assembly_name: string;
  species: string;
  accession: string;
  version: string;
  chromosome_count: number;
  total_length: number;
  gene_count: number;
  description: string;
}

export interface ChromosomeMapping {
  mapping_id: number;
  assembly_from: string;
  assembly_to: string;
  chr_from: string;
  chr_to: string;
  refseq_from: string;
  refseq_to: string;
  strand: string;
  score: number;
}

export interface SyntenyBlock {
  block_id: number;
  assembly_1: string;
  assembly_2: string;
  chr_1: string;
  start_1: number;
  end_1: number;
  chr_2: string;
  start_2: number;
  end_2: number;
  strand: string;
  score: number;
  e_value: number;
  identity: number;
  alignment_length: number;
  gene_count: number;
}

export interface GeneCoordinateMapping {
  mapping_id: number;
  gene_id: string;
  gene_symbol: string;
  assembly_from: string;
  assembly_to: string;
  chr_from: string;
  start_from: number;
  end_from: number;
  strand_from: string;
  chr_to: string;
  start_to: number;
  end_to: number;
  strand_to: string;
  mapping_method: string;
  confidence: number;
}

export interface PafAlignment {
  query_name: string;
  query_length: number;
  query_start: number;
  query_end: number;
  strand: string;
  target_name: string;
  target_length: number;
  target_start: number;
  target_end: number;
  residue_matches: number;
  alignment_length: number;
  mapping_quality: number;
  score: number;
}

export type AlignmentMode = "natural" | "windowed";

export interface AlignmentBlock {
  block_id: string;
  query_name: string;
  query_length: number;
  query_start: number;
  query_end: number;
  strand: string;
  target_name: string;
  target_length: number;
  target_start: number;
  target_end: number;
  residue_matches: number;
  alignment_length: number;
  mapping_quality: number;
  identity: number;
  chr_1: string;
  start_1: number;
  end_1: number;
  chr_2: string;
  start_2: number;
  end_2: number;
  score: number;
  is_primary_chromosome_pair: boolean;
  is_same_chromosome: boolean;
  is_windowed_1mb: boolean;
}

export interface AlignmentStats {
  dataset: AlignmentMode;
  source_path: string;
  source_exists: boolean;
  file_size_bytes: number;
  block_count: number;
  dataset_classification: string;
  coordinate_system: string;
  total_alignment_bases?: number;
  residue_matches?: number;
  weighted_identity?: number;
  avg_identity?: number;
  min_identity?: number;
  max_identity?: number;
  avg_mapq?: number;
  chromosomes_1?: number;
  chromosomes_2?: number;
  same_chromosome_blocks?: number;
  off_diagonal_blocks?: number;
  reverse_strand_blocks?: number;
  primary_chromosome_blocks?: number;
  one_mb_windowed_blocks?: number;
  rounded_query_start_fraction?: number;
  query_covered_bases?: number;
  target_covered_bases?: number;
  query_total_bases?: number;
  target_total_bases?: number;
  query_coverage_fraction?: number;
  target_coverage_fraction?: number;
  query_coverage_by_chr?: Record<string, number>;
  target_coverage_by_chr?: Record<string, number>;
  filters?: {
    min_quality: number;
    min_identity: number;
    min_alignment_length: number;
  };
}

export interface ComparativeMethods {
  primary_dataset: AlignmentMode;
  assemblies: {
    assembly_1: string;
    assembly_2: string;
    species: string;
  };
  natural_alignment: {
    status: string;
    path: string;
    provenance_path: string;
    provenance: Record<string, string | number | undefined>;
    default_filters: Record<string, string | number>;
    interpretation: string;
  };
  windowed_alignment_qc: {
    status: string;
    path: string;
    interpretation: string;
  };
  coordinate_system: string;
  jbrowse2: {
    compatible_input: string;
    view: string;
    note: string;
  };
}

export interface ComparisonStats {
  synteny: {
    block_count: number;
    total_aligned_bases: number;
    avg_identity: number;
    avg_score: number;
    chromosomes_1: number;
    chromosomes_2: number;
  };
  gene_mapping: {
    mapped_genes: number;
    chr_from_count: number;
    chr_to_count: number;
    avg_confidence: number;
  };
  alignments: {
    alignment_count: number;
    total_alignment_bases: number;
    avg_mapq: number;
  };
}

export interface OrthologTableResult {
  total: number;
  limit: number;
  offset: number;
  data: GeneCoordinateMapping[];
}

// API Functions

export async function getAssemblies(): Promise<Assembly[]> {
  const data = await apiFetch<{ assemblies: Assembly[] }>("/comparative/assemblies");
  return data.assemblies;
}

export async function getChromosomeMapping(
  assemblyFrom = "GRCg6a",
  assemblyTo = "GRCg7b"
): Promise<ChromosomeMapping[]> {
  const data = await apiFetch<{ mapping: ChromosomeMapping[] }>(
    `/comparative/chromosome-mapping?assembly_from=${assemblyFrom}&assembly_to=${assemblyTo}`
  );
  return data.mapping;
}

export async function getSyntenyBlocks(params: {
  assembly_1?: string;
  assembly_2?: string;
  chr_1?: string;
  start_1?: number;
  end_1?: number;
  chr_2?: string;
  min_score?: number;
  min_identity?: number;
  limit?: number;
} = {}): Promise<SyntenyBlock[]> {
  const searchParams = new URLSearchParams();
  if (params.assembly_1) searchParams.set("assembly_1", params.assembly_1);
  if (params.assembly_2) searchParams.set("assembly_2", params.assembly_2);
  if (params.chr_1) searchParams.set("chr_1", params.chr_1);
  if (params.start_1 !== undefined) searchParams.set("start_1", String(params.start_1));
  if (params.end_1 !== undefined) searchParams.set("end_1", String(params.end_1));
  if (params.chr_2) searchParams.set("chr_2", params.chr_2);
  if (params.min_score !== undefined) searchParams.set("min_score", String(params.min_score));
  if (params.min_identity !== undefined) searchParams.set("min_identity", String(params.min_identity));
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));

  const data = await apiFetch<{ blocks: SyntenyBlock[] }>(
    `/comparative/synteny?${searchParams.toString()}`
  );
  return data.blocks;
}

export async function mapCoordinates(
  geneId: string,
  assemblyFrom = "GRCg6a",
  assemblyTo = "GRCg7b"
): Promise<GeneCoordinateMapping> {
  return apiFetch<GeneCoordinateMapping>(
    `/comparative/map?gene_id=${encodeURIComponent(geneId)}&assembly_from=${assemblyFrom}&assembly_to=${assemblyTo}`
  );
}

export async function getDotplotData(params: {
  assembly_1?: string;
  assembly_2?: string;
  chr_1?: string;
  chr_2?: string;
  min_score?: number;
} = {}): Promise<SyntenyBlock[]> {
  const searchParams = new URLSearchParams();
  if (params.assembly_1) searchParams.set("assembly_1", params.assembly_1);
  if (params.assembly_2) searchParams.set("assembly_2", params.assembly_2);
  if (params.chr_1) searchParams.set("chr_1", params.chr_1);
  if (params.chr_2) searchParams.set("chr_2", params.chr_2);
  if (params.min_score !== undefined) searchParams.set("min_score", String(params.min_score));

  const data = await apiFetch<{ data: SyntenyBlock[] }>(
    `/comparative/dotplot?${searchParams.toString()}`
  );
  return data.data;
}

export async function getAlignmentBlocks(params: {
  assembly_1?: string;
  assembly_2?: string;
  mode?: AlignmentMode;
  chr_1?: string;
  chr_2?: string;
  min_quality?: number;
  min_identity?: number;
  min_alignment_length?: number;
  limit?: number;
  order?: "coordinate" | "score";
} = {}): Promise<AlignmentBlock[]> {
  const searchParams = new URLSearchParams();
  if (params.assembly_1) searchParams.set("assembly_1", params.assembly_1);
  if (params.assembly_2) searchParams.set("assembly_2", params.assembly_2);
  if (params.mode) searchParams.set("mode", params.mode);
  if (params.chr_1) searchParams.set("chr_1", params.chr_1);
  if (params.chr_2) searchParams.set("chr_2", params.chr_2);
  if (params.min_quality !== undefined) searchParams.set("min_quality", String(params.min_quality));
  if (params.min_identity !== undefined) searchParams.set("min_identity", String(params.min_identity));
  if (params.min_alignment_length !== undefined) searchParams.set("min_alignment_length", String(params.min_alignment_length));
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  if (params.order) searchParams.set("order", params.order);

  const data = await apiFetch<{ blocks: AlignmentBlock[] }>(
    `/comparative/alignment-blocks?${searchParams.toString()}`
  );
  return data.blocks;
}

export async function getAlignmentStats(params: {
  assembly_1?: string;
  assembly_2?: string;
  mode?: AlignmentMode;
  min_quality?: number;
  min_identity?: number;
  min_alignment_length?: number;
} = {}): Promise<AlignmentStats> {
  const searchParams = new URLSearchParams();
  if (params.assembly_1) searchParams.set("assembly_1", params.assembly_1);
  if (params.assembly_2) searchParams.set("assembly_2", params.assembly_2);
  if (params.mode) searchParams.set("mode", params.mode);
  if (params.min_quality !== undefined) searchParams.set("min_quality", String(params.min_quality));
  if (params.min_identity !== undefined) searchParams.set("min_identity", String(params.min_identity));
  if (params.min_alignment_length !== undefined) searchParams.set("min_alignment_length", String(params.min_alignment_length));

  return apiFetch<AlignmentStats>(
    `/comparative/alignment-stats?${searchParams.toString()}`
  );
}

export async function getComparativeMethods(): Promise<ComparativeMethods> {
  return apiFetch<ComparativeMethods>("/comparative/methods");
}

export async function getComparisonStats(
  assembly1 = "GRCg6a",
  assembly2 = "GRCg7b"
): Promise<ComparisonStats> {
  return apiFetch<ComparisonStats>(
    `/comparative/stats?assembly_1=${assembly1}&assembly_2=${assembly2}`
  );
}

export async function getOrthologTable(params: {
  assembly_1?: string;
  assembly_2?: string;
  chr?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<OrthologTableResult> {
  const searchParams = new URLSearchParams();
  if (params.assembly_1) searchParams.set("assembly_1", params.assembly_1);
  if (params.assembly_2) searchParams.set("assembly_2", params.assembly_2);
  if (params.chr) searchParams.set("chr", params.chr);
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  if (params.offset !== undefined) searchParams.set("offset", String(params.offset));

  return apiFetch<OrthologTableResult>(
    `/comparative/orthologs?${searchParams.toString()}`
  );
}

export async function getPafAlignments(params: {
  assembly_1?: string;
  assembly_2?: string;
  mode?: AlignmentMode;
  query_chr?: string;
  target_chr?: string;
  min_quality?: number;
  min_alignment_length?: number;
  limit?: number;
} = {}): Promise<PafAlignment[]> {
  const searchParams = new URLSearchParams();
  if (params.assembly_1) searchParams.set("assembly_1", params.assembly_1);
  if (params.assembly_2) searchParams.set("assembly_2", params.assembly_2);
  if (params.mode) searchParams.set("mode", params.mode);
  if (params.query_chr) searchParams.set("query_chr", params.query_chr);
  if (params.target_chr) searchParams.set("target_chr", params.target_chr);
  if (params.min_quality !== undefined) searchParams.set("min_quality", String(params.min_quality));
  if (params.min_alignment_length !== undefined) searchParams.set("min_alignment_length", String(params.min_alignment_length));
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));

  const data = await apiFetch<{ alignments: PafAlignment[] }>(
    `/comparative/paf?${searchParams.toString()}`
  );
  return data.alignments;
}
