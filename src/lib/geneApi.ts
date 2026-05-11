import { API_BASE, apiFetch, resolveGeneId } from './apiClient';

// Re-export for convenience
export { API_BASE };

export interface GeneResult {
  gene_id: string;
  gene_symbol: string;
  name: string | null;
  biotype: string | null;
  seqid: string;
  start: number;
  end: number;
  strand: string;
  length: number;
  // Extended from PostgreSQL gene_xref (ESC schema)
  gene_type?: string | null;
  is_canonical?: boolean | null;
  display_symbol?: string | null;
  aliases?: GeneAlias[];
  // Cross-reference IDs (from PostgreSQL gene_xref / gene_kegg)
  ncbi_gene_id?: string | null;
  ensembl_gene_id?: string | null;
  kegg_gene_id?: string | null;
}

export interface GeneAlias {
  alias: string;
  alias_type: string;
  is_primary: boolean;
  source: string | null;
}

export interface GeneSearchResponse {
  q: string;
  total: number;
  items: GeneResult[];
}

export interface ChromosomeResult {
  seqid: string;
  chr_name: string | null;
  length: number;
  description: string | null;
  gene_count: number;
}

export interface ChromosomeDetail extends ChromosomeResult {
  gene_count: number;
}

export interface GeneDetail extends GeneResult {
  chromosome?: ChromosomeResult;
}

export interface TranscriptResult {
  transcript_id: string;
  transcript_acc: string | null;
  feature_type: string;
  gene_id: string | null;
  gene_symbol: string | null;
  name: string | null;
  product: string | null;
  seqid: string;
  start: number;
  end: number;
  strand: string;
  length: number;
  has_rna_sequence: boolean;
  rna_length: number | null;
  exon_count: number;
  cds_segment_count: number;
  protein_count: number;
  exons: Array<{
    exon_id: string;
    seqid: string;
    start: number;
    end: number;
    strand: string;
    length: number;
  }>;
  cds_segments: Array<{
    cds_id: string;
    seqid: string;
    start: number;
    end: number;
    strand: string;
    length: number;
    phase: string;
    protein_id: string | null;
    product: string | null;
  }>;
  proteins: Array<{
    protein_id: string;
    has_cds_sequence: boolean;
    cds_length: number | null;
    has_protein_sequence: boolean;
    protein_length: number | null;
    protein_description: string | null;
    protein_sequence?: string | null;
    cds_sequence?: string | null;
  }>;
  rna_sequence: string | null;
}

export interface GeneTranscriptsResponse {
  gene_id: string;
  transcript_count: number;
  items: TranscriptResult[];
}

// Gene Expression data (ESC Star Schema)
// ExpressionSample — from expression_fact + dataset_sample + stage_dim join
export interface ExpressionSample {
  dataset_sample_id: number;
  sample_name: string;
  srr_run_id: string | null;
  stage: string;
  stage_label: string | null;
  stage_order: number | null;
  sex: string;
  sex_code: string | null;
  replicate: number | null;
  batch: string | null;
  tissue: string | null;
  value: number;
  z_score?: number | null;
  log2fc?: number | null;
  fold_change?: number | null;
}

// Dataset metadata from /datasets endpoint
export interface DatasetInfo {
  dataset_id: number;
  dataset_code: string;
  dataset_name: string;
  sample_scope: string | null;
  normalization_family: string | null;
  description: string | null;
  source_file: string | null;
  metrics: MetricInfo[];
}

export interface MetricInfo {
  metric_code: string;
  metric_name: string;
  unit_desc: string | null;
  is_comparable: boolean;
  gene_count?: number;
}

export type ExpressionStatus = 'available' | 'no_data' | 'unavailable';

export interface GeneExpressionResponse {
  status: ExpressionStatus;
  gene_id?: string;
  dataset?: string;
  metric?: string;
  samples: ExpressionSample[];
  summary?: {
    sample_count: number;
    mean_value: number | null;
    max_value: number | null;
    min_value: number | null;
    std_value: number | null;
    cv: number | null;
    expressed_samples: number | null;
    zero_samples: number | null;
    top_sample: string | null;
    top_stage: string | null;
    sex_bias_label: string | null;
    sex_bias_ratio: number | null;
    fold_change_top: number | null;
    fold_change_bottom: number | null;
    stage_means?: Record<string, Record<string, number> | number | null> | null;
    stage_sample_count?: Record<string, number> | null;
  };
}

// Cross-dataset comparison response (GET /genes/{id}/expression?expand=all)
export interface GeneExpressionExpandResponse {
  gene_id: string;
  cross_comparison: {
    dataset_count: number;
    available_datasets: string[];
    trend_note: string;
    opposite_trends: boolean | null;
  };
  datasets: Array<{
    dataset_code: string;
    dataset_name: string;
    normalization_family: string;
    sample_count: number;
    metrics: Array<{
      metric_code: string;
      metric_name: string;
      unit_desc: string;
      is_comparable: boolean;
      gene_count?: number;
      summary?: GeneExpressionResponse['summary'];
      samples: ExpressionSample[];
    }>;
  }>;
}

export type AnnotationsStatus = 'available' | 'unavailable';
export type AnnotationsError = 'service_unavailable' | 'load_failed' | null;

export interface GenePageResponse {
  gene: GeneResult;
  chromosome: ChromosomeResult;
  transcript_count: number;
  transcripts: TranscriptResult[];
  annotations?: {
    go: GOAnnotationsResponse;
    kegg: KEGGAnnotationsResponse;
  };
  annotations_status?: AnnotationsStatus;
  annotations_error?: AnnotationsError;
  expression?: GeneExpressionResponse;
}

// Parse search query to determine search type
export type SearchType = 'gene_id' | 'chromosome' | 'region' | 'symbol';

export function parseSearchQuery(query: string): {
  type: SearchType;
  value: string;
  seqid?: string;
  start?: number;
  end?: number;
} {
  const trimmed = query.trim();

  // Gene ID: starts with "gene-"
  if (/^gene-/.test(trimmed)) {
    return { type: 'gene_id', value: trimmed };
  }

  // Chromosome region: NC_xxx:start-end
  const regionMatch = trimmed.match(/^(NC_\d+\.\d+):(\d+)-(\d+)$/);
  if (regionMatch) {
    return {
      type: 'region',
      value: trimmed,
      seqid: regionMatch[1],
      start: parseInt(regionMatch[2], 10),
      end: parseInt(regionMatch[3], 10),
    };
  }

  // Chromosome accession: NC_xxx
  if (/^NC_\d+\.\d+$/.test(trimmed)) {
    return { type: 'chromosome', value: trimmed };
  }

  // Default: search as gene symbol/name
  return { type: 'symbol', value: trimmed };
}

// API functions
export async function searchGenes(q: string, limit = 8): Promise<GeneSearchResponse> {
  return apiFetch<GeneSearchResponse>(`/search/genes?q=${encodeURIComponent(q)}&limit=${limit}`);
}

export async function getGene(geneId: string): Promise<GeneDetail> {
  const resolved = await resolveGeneId(geneId);
  return apiFetch<GeneDetail>(`/genes/${encodeURIComponent(resolved)}`);
}

export async function getGeneTranscripts(geneId: string): Promise<GeneTranscriptsResponse> {
  const resolved = await resolveGeneId(geneId);
  return apiFetch<GeneTranscriptsResponse>(`/genes/${encodeURIComponent(resolved)}/transcripts`);
}

export async function getGenePage(geneId: string, includeSequences = false): Promise<GenePageResponse> {
  const resolved = await resolveGeneId(geneId);
  const qs = includeSequences ? '?include_sequences=true' : '';
  return apiFetch<GenePageResponse>(`/genes/${encodeURIComponent(resolved)}/page${qs}`);
}

export async function getChromosomes(): Promise<ChromosomeResult[]> {
  return apiFetch<ChromosomeResult[]>('/chromosomes');
}

export async function getChromosome(seqid: string): Promise<ChromosomeDetail> {
  return apiFetch<ChromosomeDetail>(`/chromosomes/${encodeURIComponent(seqid)}`);
}

export async function getChromosomeGenes(
  seqid: string,
  start?: number,
  end?: number,
  limit = 50,
  offset = 0
): Promise<{
  seqid: string;
  total: number;
  offset: number;
  limit: number;
  items: GeneResult[];
}> {
  let url = `/chromosomes/${encodeURIComponent(seqid)}/genes?limit=${limit}&offset=${offset}`;
  if (start !== undefined) url += `&start=${start}`;
  if (end !== undefined) url += `&end=${end}`;
  return apiFetch(url);
}

// GO Annotation types
export interface GOAnnotation {
  go_id: string;
  go_name: string;
  go_definition?: string;
  go_namespace: string;
  evidence_code?: string;
  source?: string;
  official_link?: string;
  qualifier?: string;
  reference?: string;
  pubmed_ids?: string;
  assigned_by?: string;
  aspect?: string;
}

export interface GOAnnotationsResponse {
  gene_id: string;
  gene_symbol: string;
  ncbi_gene_id?: string;
  ensembl_gene_id?: string;
  summary?: {
    bp_count: number;
    mf_count: number;
    cc_count: number;
    total: number;
  };
  items?: GOAnnotation[];
  go_annotations?: {
    biological_process: GOAnnotation[];
    molecular_function: GOAnnotation[];
    cellular_component: GOAnnotation[];
  };
  total: number;
}

// KEGG Pathway: used in gene KEGG annotations and pathway list
export interface KEGGPathway {
  pathway_id: string;
  pathway_name: string;
  pathway_class: string | null;
  official_link: string;
  // Asset fields (from kegg_pathway_asset table)
  png_url?: string;
  png_width?: number;
  png_height?: number;
  kgml_url?: string;
  mapdata_api?: string;
  interactive_api?: string;
  // Legacy/compat
  kegg_link?: string;
}

export interface KEGGAnnotationsResponse {
  gene_id: string;
  gene_symbol: string;
  ncbi_gene_id?: string | null;
  kegg_gene_id: string | null;
  summary?: {
    pathway_count: number;
  };
  items?: KEGGPathway[];
  pathways?: KEGGPathway[];
  total: number;
}

// GO/KEGG API functions
export async function getGeneGOAnnotations(geneId: string): Promise<GOAnnotationsResponse> {
  const resolved = await resolveGeneId(geneId);
  const data = await apiFetch<GOAnnotationsResponse>(`/annotations/go/${encodeURIComponent(resolved)}`);

  // Transform items into grouped go_annotations
  if (data.items && data.items.length > 0) {
    const biological_process = data.items.filter((item) => item.go_namespace === 'biological_process');
    const molecular_function = data.items.filter((item) => item.go_namespace === 'molecular_function');
    const cellular_component = data.items.filter((item) => item.go_namespace === 'cellular_component');

    data.go_annotations = {
      biological_process,
      molecular_function,
      cellular_component,
    };
  }

  return data;
}

export async function getGeneKEGGAnnotations(geneId: string): Promise<KEGGAnnotationsResponse> {
  const resolved = await resolveGeneId(geneId);
  return apiFetch<KEGGAnnotationsResponse>(`/annotations/kegg/${encodeURIComponent(resolved)}`);
}

// ========== Tools API ==========

export interface Primer3Result {
  success: boolean;
  gene_id: string;
  gene_info?: {
    gene_id: string;
    seqid: string;
    gene_start: number;
    gene_end: number;
    strand: string;
    region_start: number;
    region_end: number;
    region_length: number;
  };
  sequence_length?: number;
  num_primers_found?: number;
  primers?: Array<{
    primer_num: number;
    forward_seq: string;
    reverse_seq: string;
    forward_tm: number;
    reverse_tm: number;
    product_size: number;
    forward_start: number;
    forward_end: number;
    reverse_start: number;
    reverse_end: number;
  }>;
  error?: string;
}

export interface DomainSearchResult {
  gene_id: string;
  protein_id: string;
  protein_length: number;
  success: boolean;
  domains: Array<{
    accession: string;
    name: string;
    database: string;
    start: number;
    end: number;
    evalue: number | null;
    score: number | null;
  }>;
  message: string | null;
  error: string | null;
  method: string;
}

export async function designPrimers(
  geneId: string,
  includeFlank = 100,
  productSizeMin = 150,
  productSizeMax = 300,
  numPrimers = 5
): Promise<Primer3Result> {
  const resolved = await resolveGeneId(geneId);

  const params = new URLSearchParams({
    gene_id: resolved,
    include_flank: includeFlank.toString(),
    product_size_min: productSizeMin.toString(),
    product_size_max: productSizeMax.toString(),
    num_primers: numPrimers.toString(),
  });

  return apiFetch<Primer3Result>(`/tools/primer3?${params}`, { method: 'POST' });
}

export async function searchDomains(geneId: string): Promise<DomainSearchResult> {
  const resolved = await resolveGeneId(geneId);
  const params = new URLSearchParams({ gene_id: resolved });
  return apiFetch<DomainSearchResult>(`/tools/domain-search?${params}`);
}

// ========== KEGG Pathways API ==========

export interface KEGGPathwayItem {
  pathway_id: string;
  pathway_name: string;
  pathway_class: string;
  gene_count: number;
  node_count?: number;
  annotated_gene_count?: number;
  official_link: string;
  png_url: string;
  png_width?: number;
  png_height?: number;
  image_api?: string;
  mapdata_api?: string;
  info_api?: string;
}

export interface KEGGPathwaysResponse {
  total: number;
  items: KEGGPathwayItem[];
}

export interface KEGGPathwayDetail {
  pathway_id: string;
  pathway_name: string;
  pathway_class: string | null;
  gene_count: number;
  node_count?: number;
  annotated_gene_count?: number;
  png_width?: number;
  png_height?: number;
  genes: Array<{
    gene_id: string;
    gene_symbol: string;
    ncbi_gene_id: string | null;
    kegg_gene_id: string | null;
    gene_link: string;
  }>;
  official_link: string;
  png_url: string;
  image_api?: string;
  kgml_url?: string;
  mapdata_api?: string;
  interactive_api?: string;
  info_api?: string;
}

export interface KEGGPathwayInfo {
  pathway_id: string;
  pathway_name: string;
  pathway_class: string | null;
  png: {
    filename: string;
    url: string;
    file_size: number;
    width: number;
    height: number;
  };
  kgml: {
    filename: string;
    relpath: string;
    file_size: number;
  };
  stats: {
    node_count: number;
    gene_count: number;
  };
  official_link: string;
  image_api: string;
  mapdata_api: string;
  interactive_api: string;
  created_at: string;
  updated_at: string;
}

// KEGGPathwayMapdata node — matches backend /mapdata response
// Backend: url, image_width, image_height, node_count, no genes array
export interface KEGGPathwayMapdataNode {
  node_id: string;
  entry_id: string;
  entry_type: string;
  kegg_gene_id: string;
  label: string;
  url: string;           // Backend uses 'url' (not 'link_url')
  graphics_type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;         // left = x - width/2 (KGML coords are center-based)
  top: number;           // top = y - height/2
  right: number;         // right = left + width
  bottom: number;        // bottom = top + height
  highlighted: boolean;
}

export interface KEGGPathwayMapdata {
  pathway_id: string;
  pathway_name: string;
  png_url?: string;       // from parse_kgml_hotspots
  kegg_url?: string;
  node_count?: number;    // backend uses 'node_count'
  image_width?: number;   // backend uses 'image_width' (not 'png_width')
  image_height?: number;   // backend uses 'image_height' (not 'png_height')
  total_nodes?: number;   // frontend alias for node_count
  highlighted_nodes?: number;
  pathway_gene_count?: number;
  nodes: KEGGPathwayMapdataNode[];
  source?: string;
  // highlight info
  target_gene?: {
    ncbi_gene_id: string;
    kegg_gene_id: string;
    symbol: string;
    highlighted_count: number;
  };
  highlight_ncbi?: string;
}

export interface KEGGPathwayInteractive {
  pathway_id: string;
  pathway_name: string;
  png_width: number;
  png_height: number;
  target_gene?: string;
  static_image: string;
  official_link: string;
  mapdata_api: string;
  detail_api: string;
  info_api: string;
  kgml_available: boolean;
  kgml_preview: string | null;
  message: string;
}

// List all KEGG pathways
export async function getKEGGPathways(): Promise<KEGGPathwaysResponse> {
  return apiFetch<KEGGPathwaysResponse>('/annotations/kegg/pathways');
}

// Get KEGG pathway detail (genes in pathway)
export async function getKEGGPathwayDetail(pathwayId: string): Promise<KEGGPathwayDetail> {
  return apiFetch<KEGGPathwayDetail>(`/annotations/kegg/pathway/${encodeURIComponent(pathwayId)}`);
}

// Get KEGG pathway info
export async function getKEGGPathwayInfo(pathwayId: string): Promise<KEGGPathwayInfo> {
  return apiFetch<KEGGPathwayInfo>(`/annotations/kegg/pathway/${encodeURIComponent(pathwayId)}/info`);
}

// Get KEGG pathway mapdata (hotspot coordinates)
export async function getKEGGPathwayMapdata(pathwayId: string, geneId?: string): Promise<KEGGPathwayMapdata> {
  const qs = geneId ? `?highlight_gene=${encodeURIComponent(geneId)}` : '';
  return apiFetch<KEGGPathwayMapdata>(`/annotations/kegg/pathway/${encodeURIComponent(pathwayId)}/mapdata${qs}`);
}

// Get KEGG pathway interactive data
export async function getKEGGPathwayInteractive(pathwayId: string): Promise<KEGGPathwayInteractive> {
  return apiFetch<KEGGPathwayInteractive>(`/annotations/kegg/pathway/${encodeURIComponent(pathwayId)}/interactive`);
}

/** 带 gene_id 参数，获取目标基因高亮信息 */
export async function getKEGGPathwayInteractiveForGene(
  pathwayId: string,
  geneId: string
): Promise<KEGGPathwayInteractive & { target_gene?: string }> {
  return apiFetch<KEGGPathwayInteractive & { target_gene?: string }>(
    `/annotations/kegg/pathway/${encodeURIComponent(pathwayId)}/interactive?highlight_gene=${encodeURIComponent(geneId)}`
  );
}

// Build KEGG pathway image URL
export function buildKEGGPathwayImageUrl(pathwayId: string): string {
  return `${API_BASE}/annotations/kegg/pathway/${encodeURIComponent(pathwayId)}/image`;
}

// Build KEGG pathway image URL (kegg-images router)
export function buildKEGGImageUrl(pathwayId: string): string {
  return `${API_BASE}/kegg-images/${encodeURIComponent(pathwayId)}.png`;
}

// Get KEGG image info
export async function getKEGGImageInfo(pathwayId: string): Promise<{
  pathway_id: string;
  image_url: string;
  local_image_path: string;
  file_exists: boolean;
  file_size: number;
  width: number;
  height: number;
}> {
  return apiFetch(`/kegg-images/${encodeURIComponent(pathwayId)}/info`);
}

// ========== KGML Cache API ==========

export interface KGMLCacheStatus {
  cache_enabled: boolean;
  cache_dir: string;
  cached_count: number;
  total_size_bytes: number;
  cached_files: string[];
}

export async function getKGMLCacheStatus(): Promise<KGMLCacheStatus> {
  return apiFetch<KGMLCacheStatus>('/annotations/kegg/kgml-cache/status');
}

export async function refreshKGMLCache(pathwayId?: string): Promise<{
  success?: boolean;
  pathway_id?: string;
  refreshed?: number;
  total?: number;
  failed?: string[];
}> {
  const url = pathwayId
    ? `/annotations/kegg/kgml-cache/refresh/${encodeURIComponent(pathwayId)}`
    : '/annotations/kegg/kgml-cache/refresh';
  return apiFetch(url, { method: 'POST' });
}

// ========== Gene Sequences API ==========

export interface GeneSequencesResponse {
  gene_id: string;
  transcript_sequences: Array<{
    transcript_id: string;
    transcript_acc: string | null;
    feature_type: string;
    product: string | null;
    rna_sequence: string | null;
    proteins: Array<{
      protein_id: string;
      has_cds_sequence: boolean;
      cds_length: number | null;
      has_protein_sequence: boolean;
      protein_length: number | null;
      protein_description: string | null;
      cds_sequence?: string | null;
      protein_sequence?: string | null;
    }>;
  }>;
}

export async function getGeneSequences(geneId: string): Promise<GeneSequencesResponse> {
  const resolved = await resolveGeneId(geneId);
  return apiFetch<GeneSequencesResponse>(`/genes/${encodeURIComponent(resolved)}/sequences`);
}

// ========== Datasets API ==========

export async function getDatasets(): Promise<{ datasets: DatasetInfo[] }> {
  return apiFetch<{ datasets: DatasetInfo[] }>('/datasets');
}

// ========== Expression API ==========

export async function getGeneExpression(
  geneId: string,
  options?: {
    dataset?: string;
    metric?: string;
    expand?: boolean;
  }
): Promise<GeneExpressionResponse | GeneExpressionExpandResponse> {
  const resolved = await resolveGeneId(geneId);

  const params = new URLSearchParams();
  if (options?.dataset) params.set('dataset', options.dataset);
  if (options?.metric) params.set('metric', options.metric);
  if (options?.expand) params.set('expand', 'true');

  const qs = params.toString();
  return apiFetch(`/genes/${encodeURIComponent(resolved)}/expression${qs ? `?${qs}` : ''}`);
}
