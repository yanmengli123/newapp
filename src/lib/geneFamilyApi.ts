import { apiFetch } from './apiClient';

const CATALOG_BASE = '/api/v1/gene-family-catalog';

export type AssertionState = 'accepted' | 'candidate' | 'unresolved' | 'rejected' | 'withdrawn';
export type AssignmentRole = 'primary' | 'secondary' | 'supplementary';
export type ReviewState = 'not_required' | 'unreviewed' | 'in_review' | 'approved' | 'rejected' | 'needs_mapping';

export interface CatalogRelease {
  release_id: string;
  schema_version: string;
  release_status: 'release_candidate' | 'published' | 'withdrawn';
  taxon_id: number;
  species_name: string;
  assembly_accession: string;
  assembly_name: string;
  created_at: string;
  qc_status: 'pending' | 'passed' | 'warning' | 'blocked';
  blocking_checks?: Array<{
    check_name: string;
    observed_value: string | null;
    expected_value: string | null;
    details: string;
  }>;
}

export interface SchemeSummary {
  scheme_id: string;
  scheme_name: string;
  source_name: string;
  source_version: string | null;
  subject_level: 'gene' | 'protein' | 'mixed';
  description: string;
  entry_count: number;
  accepted_genes: number;
  candidate_genes: number;
  unresolved_genes: number;
  accepted_proteins: number;
  candidate_proteins: number;
  annotated_proteins: number;
  domain_hits: number;
  mapping_coverage: number;
  accepted_assertions: number;
  candidate_assertions: number;
  mapping_unresolved: number;
}

export interface CatalogEntrySummary {
  entry_id: string;
  scheme_id: string;
  scheme_name?: string;
  accession: string;
  name: string;
  entry_type: string;
  definition?: string | null;
  parent_entry_id?: string | null;
  external_url?: string | null;
  accepted_genes: number;
  candidate_genes: number;
  unresolved_genes?: number;
  accepted_proteins: number;
  candidate_proteins?: number;
  evidence_coverage?: number;
  mapping_coverage?: number;
  accepted_assertions?: number;
  candidate_assertions?: number;
}

export interface CatalogSummary {
  release: CatalogRelease;
  unique_annotated_genes: number;
  schemes: SchemeSummary[];
  top_entries: CatalogEntrySummary[];
}

export interface CursorMeta {
  total: number;
  limit: number;
  next_cursor: string | null;
}

export interface EntryListResponse {
  meta: CursorMeta & {
    release_id: string;
    unit: string;
    sort: string;
    include_candidates: boolean;
  };
  data: CatalogEntrySummary[];
}

export interface CatalogEntry extends CatalogEntrySummary {
  source_name: string;
  source_version: string | null;
  subject_level: 'gene' | 'protein' | 'mixed';
  parent_name: string | null;
  children: Array<{ entry_id: string; accession: string; name: string; entry_type: string }>;
  assertion_states: Record<string, number>;
  support_tiers: Array<{ support_tier: string; count: number }>;
  available_sections: {
    domain_architecture: boolean;
    expression_profile: boolean;
    genomic_distribution: boolean;
    change_history: boolean;
  };
}

export interface CatalogMember {
  assertion_id: string;
  scheme_id: string;
  entry_id: string;
  assignment_role: AssignmentRole;
  assertion_state: AssertionState;
  support_tier: string;
  review_state: ReviewState;
  representative_protein_id: string | null;
  rule_id: string;
  subject_type: 'gene' | 'protein';
  internal_gene_id: string | null;
  gene_symbol: string | null;
  ncbi_gene_id: string | null;
  ensembl_gene_id: string | null;
  protein_accession: string | null;
  transcript_accession: string | null;
  protein_length: number | null;
  mapping_state: string;
  mapping_method: string | null;
  evidence_count: number;
  internal_url: string | null;
}

export interface MemberListResponse {
  meta: CursorMeta & { include_candidates: boolean };
  data: CatalogMember[];
}

export interface EvidenceRecord {
  evidence_id: string;
  evidence_type: string;
  source_record_id: string;
  source_file: string;
  method: string;
  model_accession: string | null;
  score: number | null;
  sequence_evalue: number | null;
  domain_ievalue: number | null;
  threshold_type: string | null;
  threshold_value: number | null;
  threshold_pass: number | null;
  description: string | null;
  evidence_role: string;
  evidence_rank: number;
  assertion_id: string;
  assertion_state: AssertionState;
  internal_gene_id: string | null;
  gene_symbol: string | null;
  protein_accession: string | null;
  protein_length: number | null;
  protein_length_status: 'observed' | 'not_reported';
  ali_from?: number | null;
  ali_to?: number | null;
  env_from?: number | null;
  env_to?: number | null;
  domain_index?: number | null;
  domain_total?: number | null;
}

export interface EvidenceListResponse {
  meta: CursorMeta;
  data: EvidenceRecord[];
}

export interface GeneClassification {
  assertion_id: string;
  scheme_id: string;
  scheme_name: string;
  entry_id: string;
  accession: string;
  entry_name: string;
  entry_type: string;
  assignment_role: AssignmentRole;
  assertion_state: AssertionState;
  support_tier: string;
  review_state: ReviewState;
  representative_protein_id: string | null;
  evidence_count: number;
}

export interface DomainHit {
  entry_id: string;
  pfam_accession: string;
  pfam_name: string;
  definition: string | null;
  assertion_id: string;
  domain_index: number | null;
  domain_total: number | null;
  ali_from: number | null;
  ali_to: number | null;
  env_from: number | null;
  env_to: number | null;
  independent_evalue: number | null;
  domain_score: number | null;
  accuracy: number | null;
  threshold_pass: number | null;
}

export interface ProteinDomainArchitecture {
  protein_id: string;
  protein_length: number | null;
  transcript_accession: string | null;
  domain_hits: DomainHit[];
}

export type ProteinLengthStatus = 'observed' | 'not_reported';

export interface GeneFamilyAnnotations {
  release_id: string;
  internal_gene_id: string;
  summary: {
    classification_count: number;
    protein_count: number;
    domain_hit_count: number;
    candidate_count: number;
  };
  classifications: GeneClassification[];
  proteins: ProteinDomainArchitecture[];
}

export interface CatalogSearchResponse {
  query: string;
  entries: CatalogEntrySummary[];
  genes: Array<{
    internal_gene_id: string;
    gene_symbol: string | null;
    ncbi_gene_id: string | null;
    ensembl_gene_id: string | null;
    internal_url: string;
  }>;
  proteins: Array<{
    protein_accession: string;
    protein_length: number | null;
    internal_gene_id: string | null;
    gene_symbol: string | null;
  }>;
  source_assertions: Array<{
    assertion_id: string;
    subject_key: string;
    gene_symbol: string | null;
    ncbi_gene_id: string | null;
    source_namespace: string;
    source_accession: string;
    scheme_id: string;
    entry_id: string;
    entry_name: string;
    assertion_state: AssertionState;
    mapping_state: 'ambiguous' | 'unmapped';
    review_state: ReviewState;
    internal_gene_id: null;
    entry_url: string;
  }>;
}

export interface ReleaseAsset {
  asset_id: number;
  release_id: string;
  asset_name: string;
  relative_path: string;
  media_type: string;
  sha256: string | null;
  byte_size: number | null;
  description: string;
  download_url: string;
}

function params(values: Record<string, string | number | boolean | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function getCatalogSummary(): Promise<CatalogSummary> {
  return apiFetch<CatalogSummary>(`${CATALOG_BASE}/summary`);
}

export function getCatalogRelease(): Promise<CatalogRelease> {
  return apiFetch<CatalogRelease>(`${CATALOG_BASE}/releases/current`);
}

export function searchCatalog(query: string, limit = 12): Promise<CatalogSearchResponse> {
  return apiFetch<CatalogSearchResponse>(`${CATALOG_BASE}/search${params({ q: query, limit })}`);
}

export function getEntries(options: {
  scheme?: string;
  entryType?: string;
  query?: string;
  includeCandidates?: boolean;
  sort?: 'accepted_genes' | 'candidate_genes' | 'name';
  cursor?: string | null;
  limit?: number;
}): Promise<EntryListResponse> {
  return apiFetch<EntryListResponse>(`${CATALOG_BASE}/entries${params({
    scheme: options.scheme,
    entry_type: options.entryType,
    query: options.query,
    include_candidates: options.includeCandidates,
    sort: options.sort,
    cursor: options.cursor,
    limit: options.limit,
  })}`);
}

export function getEntry(entryId: string): Promise<CatalogEntry> {
  return apiFetch<CatalogEntry>(`${CATALOG_BASE}/entries/${encodeURIComponent(entryId)}`);
}

export function getEntryMembers(entryId: string, options: {
  includeCandidates?: boolean;
  assertionState?: AssertionState;
  query?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<MemberListResponse> {
  return apiFetch<MemberListResponse>(`${CATALOG_BASE}/entries/${encodeURIComponent(entryId)}/members${params({
    include_candidates: options.includeCandidates,
    assertion_state: options.assertionState,
    query: options.query,
    cursor: options.cursor,
    limit: options.limit,
  })}`);
}

export function getEntryEvidence(entryId: string, cursor?: string | null, limit = 50): Promise<EvidenceListResponse> {
  return apiFetch<EvidenceListResponse>(`${CATALOG_BASE}/entries/${encodeURIComponent(entryId)}/evidence${params({ cursor, limit })}`);
}

export function getGeneFamilyAnnotations(internalGeneId: string): Promise<GeneFamilyAnnotations> {
  return apiFetch<GeneFamilyAnnotations>(`/api/v1/genes/${encodeURIComponent(internalGeneId)}/family-annotations`);
}

export function getReleaseAssets(releaseId: string): Promise<{ release_id: string; data: ReleaseAsset[] }> {
  return apiFetch<{ release_id: string; data: ReleaseAsset[] }>(
    `${CATALOG_BASE}/releases/${encodeURIComponent(releaseId)}/downloads`,
  );
}
