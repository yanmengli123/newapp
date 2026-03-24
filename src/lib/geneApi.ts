const API_BASE = 'http://localhost:8000';

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
  }>;
  rna_sequence: string | null;
}

export interface GeneTranscriptsResponse {
  gene_id: string;
  transcript_count: number;
  items: TranscriptResult[];
}

export interface GenePageResponse {
  gene: GeneResult;
  chromosome: ChromosomeResult;
  transcript_count: number;
  transcripts: TranscriptResult[];
  annotations?: {
    go: GOAnnotationsResponse;
    kegg: KEGGAnnotationsResponse;
  };
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
  const response = await fetch(`${API_BASE}/search/genes?q=${encodeURIComponent(q)}&limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Search failed: ${response.statusText}`);
  }
  return response.json();
}

export async function getGene(geneId: string): Promise<GeneDetail> {
  // First search for the gene to get the correct gene_id format
  const searchResult = await searchGenes(geneId, 1);
  if (searchResult.items.length > 0) {
    geneId = searchResult.items[0].gene_id;
  }

  const response = await fetch(`${API_BASE}/genes/${encodeURIComponent(geneId)}`);
  if (!response.ok) {
    throw new Error(`Gene not found: ${response.statusText}`);
  }
  return response.json();
}

export async function getGeneTranscripts(geneId: string): Promise<GeneTranscriptsResponse> {
  // First search for the gene to get the correct gene_id format
  const searchResult = await searchGenes(geneId, 1);
  if (searchResult.items.length > 0) {
    geneId = searchResult.items[0].gene_id;
  }

  const response = await fetch(`${API_BASE}/genes/${encodeURIComponent(geneId)}/transcripts`);
  if (!response.ok) {
    throw new Error(`Failed to get transcripts: ${response.statusText}`);
  }
  return response.json();
}

export async function getGenePage(geneId: string, includeSequences = false): Promise<GenePageResponse> {
  // First search for the gene to get the correct gene_id format
  const searchResult = await searchGenes(geneId, 1);
  if (searchResult.items.length > 0) {
    geneId = searchResult.items[0].gene_id;
  }

  const url = `${API_BASE}/genes/${encodeURIComponent(geneId)}/page${includeSequences ? '?include_sequences=true' : ''}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Gene page not found: ${response.statusText}`);
  }
  return response.json();
}

export async function getChromosomes(): Promise<ChromosomeResult[]> {
  const response = await fetch(`${API_BASE}/chromosomes`);
  if (!response.ok) {
    throw new Error(`Failed to get chromosomes: ${response.statusText}`);
  }
  return response.json();
}

export async function getChromosome(seqid: string): Promise<ChromosomeDetail> {
  const response = await fetch(`${API_BASE}/chromosomes/${encodeURIComponent(seqid)}`);
  if (!response.ok) {
    throw new Error(`Chromosome not found: ${response.statusText}`);
  }
  return response.json();
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
  let url = `${API_BASE}/chromosomes/${encodeURIComponent(seqid)}/genes?limit=${limit}&offset=${offset}`;
  if (start !== undefined) url += `&start=${start}`;
  if (end !== undefined) url += `&end=${end}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to get genes: ${response.statusText}`);
  }
  return response.json();
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
  // First search for the gene to get the correct gene_id format
  const searchResult = await searchGenes(geneId, 1);
  if (searchResult.items.length > 0) {
    geneId = searchResult.items[0].gene_id;
  }

  const response = await fetch(`${API_BASE}/annotations/go/${encodeURIComponent(geneId)}`);
  if (!response.ok) {
    throw new Error(`Failed to get GO annotations: ${response.statusText}`);
  }
  const data = await response.json();

  // Transform items into grouped go_annotations
  if (data.items && data.items.length > 0) {
    const biological_process = data.items.filter((item: GOAnnotation) => item.go_namespace === 'biological_process');
    const molecular_function = data.items.filter((item: GOAnnotation) => item.go_namespace === 'molecular_function');
    const cellular_component = data.items.filter((item: GOAnnotation) => item.go_namespace === 'cellular_component');

    data.go_annotations = {
      biological_process,
      molecular_function,
      cellular_component,
    };
  }

  return data;
}

export async function getGeneKEGGAnnotations(geneId: string): Promise<KEGGAnnotationsResponse> {
  // First search for the gene to get the correct gene_id format
  const searchResult = await searchGenes(geneId, 1);
  if (searchResult.items.length > 0) {
    geneId = searchResult.items[0].gene_id;
  }

  const response = await fetch(`${API_BASE}/annotations/kegg/${encodeURIComponent(geneId)}`);
  if (!response.ok) {
    throw new Error(`Failed to get KEGG annotations: ${response.statusText}`);
  }
  return response.json();
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
  // First search for the gene to get the correct gene_id format
  const searchResult = await searchGenes(geneId, 1);
  if (searchResult.items.length > 0) {
    geneId = searchResult.items[0].gene_id;
  }

  const params = new URLSearchParams({
    gene_id: geneId,
    include_flank: includeFlank.toString(),
    product_size_min: productSizeMin.toString(),
    product_size_max: productSizeMax.toString(),
    num_primers: numPrimers.toString(),
  });

  const response = await fetch(`${API_BASE}/tools/primer3?${params}`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || `Failed to design primers: ${response.statusText}`);
  }
  return response.json();
}

export async function searchDomains(geneId: string): Promise<DomainSearchResult> {
  // First search for the gene to get the correct gene_id format
  const searchResult = await searchGenes(geneId, 1);
  if (searchResult.items.length > 0) {
    geneId = searchResult.items[0].gene_id;
  }

  const params = new URLSearchParams({ gene_id: geneId });
  const response = await fetch(`${API_BASE}/tools/domain-search?${params}`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || `Failed to search domains: ${response.statusText}`);
  }
  return response.json();
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

export interface KEGGPathwayNodeGene {
  kegg_gene_id: string;
  gene_symbol: string | null;
  in_pathway: boolean;
}

export interface KEGGPathwayNode {
  entry_id: string;
  entry_type: string;
  label: string;
  graphics_type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  genes: KEGGPathwayNodeGene[];
  highlighted: boolean;
  link_url: string;
}

export interface KEGGPathwayMapdata {
  pathway_id: string;
  pathway_name: string;
  png_width: number;
  png_height: number;
  total_nodes: number;
  highlighted_nodes: number;
  pathway_gene_count: number;
  nodes: KEGGPathwayNode[];
  source: string;
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
  const response = await fetch(`${API_BASE}/annotations/kegg/pathways`);
  if (!response.ok) {
    throw new Error(`Failed to get KEGG pathways: ${response.statusText}`);
  }
  return response.json();
}

// Get KEGG pathway detail (genes in pathway)
export async function getKEGGPathwayDetail(pathwayId: string): Promise<KEGGPathwayDetail> {
  const response = await fetch(`${API_BASE}/annotations/kegg/pathway/${encodeURIComponent(pathwayId)}`);
  if (!response.ok) {
    throw new Error(`Pathway not found: ${pathwayId}`);
  }
  return response.json();
}

// Get KEGG pathway info
export async function getKEGGPathwayInfo(pathwayId: string): Promise<KEGGPathwayInfo> {
  const response = await fetch(`${API_BASE}/annotations/kegg/pathway/${encodeURIComponent(pathwayId)}/info`);
  if (!response.ok) {
    throw new Error(`Pathway info not found: ${pathwayId}`);
  }
  return response.json();
}

// Get KEGG pathway mapdata (hotspot coordinates)
export async function getKEGGPathwayMapdata(pathwayId: string): Promise<KEGGPathwayMapdata> {
  const response = await fetch(`${API_BASE}/annotations/kegg/pathway/${encodeURIComponent(pathwayId)}/mapdata`);
  if (!response.ok) {
    throw new Error(`Pathway mapdata not found: ${pathwayId}`);
  }
  return response.json();
}

// Get KEGG pathway interactive data
export async function getKEGGPathwayInteractive(pathwayId: string): Promise<KEGGPathwayInteractive> {
  const response = await fetch(`${API_BASE}/annotations/kegg/pathway/${encodeURIComponent(pathwayId)}/interactive`);
  if (!response.ok) {
    throw new Error(`Pathway interactive data not found: ${pathwayId}`);
  }
  return response.json();
}

/** 带 gene_id 参数，获取目标基因高亮信息 */
export async function getKEGGPathwayInteractiveForGene(pathwayId: string, geneId: string): Promise<KEGGPathwayInteractive & { target_gene?: string }> {
  const response = await fetch(
    `${API_BASE}/annotations/kegg/pathway/${encodeURIComponent(pathwayId)}/interactive?gene_id=${encodeURIComponent(geneId)}`
  );
  if (!response.ok) {
    throw new Error(`Pathway interactive data not found: ${pathwayId}`);
  }
  return response.json();
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
  const response = await fetch(`${API_BASE}/kegg-images/${encodeURIComponent(pathwayId)}/info`);
  if (!response.ok) {
    throw new Error(`KEGG image info not found: ${pathwayId}`);
  }
  return response.json();
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
  const response = await fetch(`${API_BASE}/annotations/kegg/kgml-cache/status`);
  if (!response.ok) {
    throw new Error(`Failed to get KGML cache status: ${response.statusText}`);
  }
  return response.json();
}

export async function refreshKGMLCache(pathwayId?: string): Promise<{
  success?: boolean;
  pathway_id?: string;
  refreshed?: number;
  total?: number;
  failed?: string[];
}> {
  const url = pathwayId
    ? `${API_BASE}/annotations/kegg/kgml-cache/refresh/${encodeURIComponent(pathwayId)}`
    : `${API_BASE}/annotations/kegg/kgml-cache/refresh`;
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`KGML cache refresh failed: ${response.statusText}`);
  }
  return response.json();
}

// ========== Gene Sequences API ==========

export interface GeneSequencesResponse {
  gene_id: string;
  mrna_sequence: string | null;
  cds_sequence: string | null;
  protein_sequence: string | null;
}

export async function getGeneSequences(geneId: string): Promise<GeneSequencesResponse> {
  const searchResult = await searchGenes(geneId, 1);
  if (searchResult.items.length > 0) {
    geneId = searchResult.items[0].gene_id;
  }
  const response = await fetch(`${API_BASE}/genes/${encodeURIComponent(geneId)}/sequences`);
  if (!response.ok) {
    throw new Error(`Failed to get sequences: ${response.statusText}`);
  }
  return response.json();
}

