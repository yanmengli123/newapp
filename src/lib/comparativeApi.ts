/**
 * Comparative Genomics API Client
 */

import { API_BASE, ApiError, apiFetch } from "./apiClient";

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

export type AlignmentMode = "natural";

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
  coordinate_system: string;
  jbrowse2: {
    compatible_input: string;
    view: string;
    note: string;
  };
}

export interface EvidenceFile {
  role: string;
  path: string;
  exists: boolean;
  size_bytes: number;
}

export interface GoldStandardLayer {
  status: "available" | "missing" | "not_indexed" | "fallback_qc" | string;
  role: string;
  files: EvidenceFile[];
  best_practice: string;
}

export interface GoldStandardStatus {
  pair: {
    assembly_1: string;
    assembly_2: string;
    species: string;
    comparison_id: string;
  };
  assemblies: Record<string, Record<string, EvidenceFile>>;
  layers: {
    dna_natural_synteny: GoldStandardLayer;
    base_level_alignment: GoldStandardLayer;
    gene_collinearity: GoldStandardLayer;
  };
  fallback_policy: {
    natural_endpoint: string;
    fallback_allowed: boolean;
    fallback_dataset: string | null;
    ui_requirement: string;
  };
  recommended_pipeline: string[];
  tool_status: Record<string, { available: boolean; path?: string | null }>;
}

export interface StaticFigureItem {
  id: "dna-dotplot" | "gene-collinearity-dotplot" | "karyotype-ribbons" | "micro-synteny" | string;
  title: string;
  evidence_layer: string;
  data_sources: EvidenceFile[];
  description: string;
  status: string;
  svg_endpoint: string;
  export_formats: string[];
  coordinate_system: string;
  provenance: string;
}

export interface StaticFigureCatalog {
  pair: {
    assembly_1: string;
    assembly_2: string;
    species: string;
  };
  dynamic_layers: string[];
  figures: StaticFigureItem[];
}

export interface MicroSyntenyBlockDetails {
  status: string;
  block_id: string;
  block: Record<string, string>;
  summary: {
    block_id: string;
    anchor_count: number;
    query_chr: string;
    target_chr: string;
    query_interval: string;
    target_interval: string;
    query_span_bp: number;
    target_span_bp: number;
    orientation: string;
    mean_identity: number | null;
    mean_qcovs: number | null;
    method: string;
  };
  pairs: Record<string, string>[];
  pair_count: number;
  message: string;
}

export type StaticFigureId =
  | "dna-dotplot"
  | "gene-collinearity-dotplot"
  | "karyotype-ribbons"
  | "micro-synteny"
  | string;

export interface FigureColorScheme {
  forward: string;
  reverse: string;
  lowConfidence: string;
  background: string;
  grid: string;
  text: string;
}

export interface FigureSettings {
  width: number;
  height: number;
  dpi: number;
  colorScheme: FigureColorScheme;
  showLabels: boolean;
  labelDensity: "all" | "primary_only" | "none";
  showLegend: boolean;
  showTitle: boolean;
  title?: string;
  subtitle?: string;
  strokeWidth: number;
  pointSize: number;
  opacity: number;
  selectedBlockId?: string | null;
  showGeneArrows: boolean;
  showAnchorLines: boolean;
}

export interface FigurePreset {
  name: "publication" | "presentation" | "compact";
  label: string;
  settings: Partial<FigureSettings>;
}

const PUBLICATION_COLORS: FigureColorScheme = {
  forward: "#2166ac",
  reverse: "#b2182b",
  lowConfidence: "#d1d5db",
  background: "#ffffff",
  grid: "#e5e7eb",
  text: "#111827",
};

export const FIGURE_PRESETS: FigurePreset[] = [
  {
    name: "publication",
    label: "Publication",
    settings: {
      width: 2000,
      height: 1200,
      dpi: 300,
      colorScheme: PUBLICATION_COLORS,
      showLabels: true,
      labelDensity: "primary_only",
      showLegend: true,
      showTitle: true,
      strokeWidth: 1.5,
      pointSize: 2.2,
      opacity: 0.82,
      showGeneArrows: true,
      showAnchorLines: true,
    },
  },
  {
    name: "presentation",
    label: "Slides",
    settings: {
      width: 2400,
      height: 1400,
      dpi: 150,
      colorScheme: {
        forward: "#1976d2",
        reverse: "#d32f2f",
        lowConfidence: "#9e9e9e",
        background: "#ffffff",
        grid: "#dfe3e8",
        text: "#212121",
      },
      showLabels: true,
      labelDensity: "all",
      showLegend: true,
      showTitle: true,
      strokeWidth: 2,
      pointSize: 2.8,
      opacity: 0.9,
      showGeneArrows: true,
      showAnchorLines: true,
    },
  },
  {
    name: "compact",
    label: "Compact",
    settings: {
      width: 1200,
      height: 800,
      dpi: 150,
      colorScheme: PUBLICATION_COLORS,
      showLabels: false,
      labelDensity: "none",
      showLegend: false,
      showTitle: false,
      strokeWidth: 1,
      pointSize: 1.8,
      opacity: 0.72,
      showGeneArrows: true,
      showAnchorLines: true,
    },
  },
];

export function createDefaultFigureSettings(
  figureId: StaticFigureId,
  selectedBlockId?: string | null,
): FigureSettings {
  const isKaryotype = figureId === "karyotype-ribbons";
  const isMicro = figureId === "micro-synteny";
  return {
    width: isMicro ? 1200 : 960,
    height: isMicro ? 720 : isKaryotype ? 500 : 560,
    dpi: 150,
    colorScheme: PUBLICATION_COLORS,
    showLabels: true,
    labelDensity: "primary_only",
    showLegend: true,
    showTitle: true,
    title: undefined,
    subtitle: undefined,
    strokeWidth: 1.7,
    pointSize: 1.8,
    opacity: 0.75,
    selectedBlockId: isMicro ? selectedBlockId || null : undefined,
    showGeneArrows: true,
    showAnchorLines: true,
  };
}

export interface BaseLevelRecord extends AlignmentBlock {
  has_cs: boolean;
  has_cigar: boolean;
  cs_preview: string;
  cigar_preview: string;
}

export interface BaseLevelResponse {
  status: string;
  query: {
    side: "query" | "target";
    chr: string;
    start: number;
    end: number;
    limit: number;
  };
  records: BaseLevelRecord[];
  count: number;
  scanned_records?: number;
  message: string;
}

export interface GeneCollinearityResponse {
  status: string;
  files: EvidenceFile[];
  pairs: Record<string, string>[];
  blocks: Record<string, string>[];
  pair_count: number;
  block_count: number;
  message: string;
}

export interface PafLayerStatus {
  status: string;
  mode: AlignmentMode;
  source_path: string;
  warning: string;
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

export async function getGoldStandardStatus(): Promise<GoldStandardStatus> {
  return apiFetch<GoldStandardStatus>("/comparative/gold-standard");
}

export async function getStaticFigureCatalog(): Promise<StaticFigureCatalog> {
  return apiFetch<StaticFigureCatalog>("/comparative/static-figures");
}

export async function renderStaticFigureSvg(
  figureId: StaticFigureId,
  settings: FigureSettings,
): Promise<string> {
  const response = await fetch(`${API_BASE}/comparative/static-figures/${encodeURIComponent(figureId)}/svg`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
    throw new ApiError(err.detail || "Static figure rendering failed", response.status);
  }
  return response.text();
}

export async function getMicroSyntenyBlockDetails(blockId: string): Promise<MicroSyntenyBlockDetails> {
  return apiFetch<MicroSyntenyBlockDetails>(`/comparative/micro-synteny/${encodeURIComponent(blockId)}`);
}

export async function getBaseLevelRecords(params: {
  side?: "query" | "target";
  chr?: string;
  start?: number;
  end?: number;
  limit?: number;
} = {}): Promise<BaseLevelResponse> {
  const searchParams = new URLSearchParams();
  if (params.side) searchParams.set("side", params.side);
  if (params.chr) searchParams.set("chr", params.chr);
  if (params.start !== undefined) searchParams.set("start", String(params.start));
  if (params.end !== undefined) searchParams.set("end", String(params.end));
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  return apiFetch<BaseLevelResponse>(`/comparative/base-level?${searchParams.toString()}`);
}

export async function getGeneCollinearity(params: {
  chr?: string;
  limit?: number;
  block_limit?: number;
} = {}): Promise<GeneCollinearityResponse> {
  const searchParams = new URLSearchParams();
  if (params.chr) searchParams.set("chr", params.chr);
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  if (params.block_limit !== undefined) searchParams.set("block_limit", String(params.block_limit));
  return apiFetch<GeneCollinearityResponse>(`/comparative/gene-collinearity?${searchParams.toString()}`);
}

export async function getPafLayerStatus(mode: AlignmentMode = "natural"): Promise<PafLayerStatus> {
  return apiFetch<PafLayerStatus>(`/comparative/paf/status?mode=${mode}`);
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
