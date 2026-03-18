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

// KEGG Annotation types
export interface KEGGPathway {
  pathway_id: string;
  pathway_name: string;
  pathway_class: string | null;
  kegg_link: string;
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
