"""Typed HTTP contract models for the read-only gene-family catalog API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


AssertionState = Literal["accepted", "candidate", "unresolved", "rejected", "withdrawn"]
AssignmentRole = Literal["primary", "secondary", "supplementary"]
ReviewState = Literal["not_required", "unreviewed", "in_review", "approved", "rejected", "needs_mapping"]
MappingState = Literal["exact", "ambiguous", "unmapped"]
ReleaseStatus = Literal["release_candidate", "published", "withdrawn"]
QcStatus = Literal["pending", "passed", "warning", "blocked"]
ProteinLengthStatus = Literal["observed", "not_reported"]


class CatalogModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class ErrorResponse(CatalogModel):
    detail: str


class BlockingCheck(CatalogModel):
    check_name: str
    observed_value: str | None = None
    expected_value: str | None = None
    details: str | None = None


class CatalogRelease(CatalogModel):
    release_id: str
    schema_version: str
    release_status: ReleaseStatus
    taxon_id: int
    species_name: str
    assembly_accession: str
    assembly_name: str
    annotation_release: str | None = None
    proteome_source: str
    proteome_version: str | None = None
    created_at: str
    previous_release_id: str | None = None
    etl_git_commit: str
    qc_status: QcStatus
    notes: str | None = None
    qc: dict[str, int] | None = None
    blocking_checks: list[BlockingCheck] = Field(default_factory=list)


class SchemeSummary(CatalogModel):
    scheme_id: str
    scheme_name: str
    source_name: str
    source_version: str | None = None
    subject_level: Literal["gene", "protein", "mixed"]
    description: str
    entry_count: int
    accepted_genes: int
    candidate_genes: int
    unresolved_genes: int
    accepted_proteins: int
    candidate_proteins: int
    annotated_proteins: int
    domain_hits: int
    mapping_coverage: float
    accepted_assertions: int
    candidate_assertions: int
    mapping_unresolved: int


class TopEntry(CatalogModel):
    entry_id: str
    scheme_id: str
    accession: str
    name: str
    entry_type: str
    accepted_genes: int
    candidate_genes: int
    accepted_proteins: int


class CatalogSummary(CatalogModel):
    release: CatalogRelease
    unique_annotated_genes: int
    schemes: list[SchemeSummary]
    top_entries: list[TopEntry]


class SearchEntry(CatalogModel):
    entry_id: str
    scheme_id: str
    accession: str
    name: str
    entry_type: str
    accepted_genes: int
    accepted_proteins: int


class SearchGene(CatalogModel):
    internal_gene_id: str
    gene_symbol: str | None = None
    ncbi_gene_id: str | None = None
    ensembl_gene_id: str | None = None
    subject_count: int
    internal_url: str


class SearchProtein(CatalogModel):
    protein_accession: str
    protein_length: int | None = None
    internal_gene_id: str | None = None
    gene_symbol: str | None = None


class SearchSourceAssertion(CatalogModel):
    assertion_id: str
    subject_key: str
    gene_symbol: str | None = None
    ncbi_gene_id: str | None = None
    source_namespace: str
    source_accession: str
    scheme_id: str
    entry_id: str
    entry_name: str
    assertion_state: AssertionState
    mapping_state: Literal["ambiguous", "unmapped"]
    review_state: ReviewState
    internal_gene_id: None = None
    entry_url: str


class CatalogSearchResponse(CatalogModel):
    query: str
    entries: list[SearchEntry]
    genes: list[SearchGene]
    proteins: list[SearchProtein]
    source_assertions: list[SearchSourceAssertion]


class CursorMeta(CatalogModel):
    total: int
    limit: int
    next_cursor: str | None = None


class EntryListMeta(CursorMeta):
    release_id: str
    unit: Literal["catalog_entries"]
    sort: Literal["accepted_genes", "candidate_genes", "name"]
    include_candidates: bool


class EntrySummary(CatalogModel):
    entry_id: str
    scheme_id: str
    scheme_name: str
    accession: str
    name: str
    entry_type: str
    definition: str | None = None
    parent_entry_id: str | None = None
    external_url: str | None = None
    accepted_genes: int
    candidate_genes: int
    unresolved_genes: int
    accepted_proteins: int
    candidate_proteins: int
    evidence_coverage: float
    mapping_coverage: float
    accepted_assertions: int
    candidate_assertions: int


class EntryListResponse(CatalogModel):
    meta: EntryListMeta
    data: list[EntrySummary]


class EntryChild(CatalogModel):
    entry_id: str
    accession: str
    name: str
    entry_type: str


class SupportTierCount(CatalogModel):
    support_tier: str
    count: int


class AvailableSections(CatalogModel):
    domain_architecture: bool
    expression_profile: bool
    genomic_distribution: bool
    change_history: bool


class CatalogEntry(CatalogModel):
    entry_id: str
    scheme_id: str
    accession: str
    name: str
    entry_type: str
    definition: str | None = None
    parent_entry_id: str | None = None
    external_url: str | None = None
    is_active: int
    scheme_name: str
    source_name: str
    source_version: str | None = None
    subject_level: Literal["gene", "protein", "mixed"]
    accepted_genes: int
    candidate_genes: int
    unresolved_genes: int
    accepted_proteins: int
    candidate_proteins: int
    evidence_coverage: float
    mapping_coverage: float
    parent_name: str | None = None
    children: list[EntryChild]
    assertion_states: dict[AssertionState, int]
    support_tiers: list[SupportTierCount]
    available_sections: AvailableSections


class CatalogMember(CatalogModel):
    assertion_id: str
    scheme_id: str
    entry_id: str
    assignment_role: AssignmentRole
    assertion_state: AssertionState
    support_tier: str
    review_state: ReviewState
    representative_protein_id: str | None = None
    rule_id: str | None = None
    subject_type: Literal["gene", "protein"]
    internal_gene_id: str | None = None
    gene_symbol: str | None = None
    ncbi_gene_id: str | None = None
    ensembl_gene_id: str | None = None
    protein_accession: str | None = None
    transcript_accession: str | None = None
    protein_length: int | None = None
    mapping_state: MappingState
    mapping_method: str | None = None
    evidence_count: int
    internal_url: str | None = None


class MemberListMeta(CursorMeta):
    include_candidates: bool


class MemberListResponse(CatalogModel):
    meta: MemberListMeta
    data: list[CatalogMember]


class EvidenceRecord(CatalogModel):
    evidence_id: str
    evidence_type: str
    source_record_id: str
    source_file: str
    method: str
    model_accession: str | None = None
    score: float | None = None
    sequence_evalue: float | None = None
    domain_ievalue: float | None = None
    threshold_type: str | None = None
    threshold_value: float | None = None
    threshold_pass: int | None = None
    description: str | None = None
    evidence_role: str
    evidence_rank: int
    assertion_id: str
    assertion_state: AssertionState
    internal_gene_id: str | None = None
    gene_symbol: str | None = None
    protein_accession: str | None = None
    protein_length: int | None = None
    protein_length_status: ProteinLengthStatus
    ali_from: int | None = None
    ali_to: int | None = None
    env_from: int | None = None
    env_to: int | None = None
    domain_index: int | None = None
    domain_total: int | None = None


class EvidenceListResponse(CatalogModel):
    meta: CursorMeta
    data: list[EvidenceRecord]


class AssertionEvidence(CatalogModel):
    evidence_id: str
    release_id: str
    evidence_type: str
    source_file_id: int
    source_record_id: str
    method: str
    model_accession: str | None = None
    score: float | None = None
    sequence_evalue: float | None = None
    domain_ievalue: float | None = None
    threshold_type: str | None = None
    threshold_value: float | None = None
    threshold_pass: int | None = None
    description: str | None = None
    payload_json: str
    source_file: str
    evidence_role: str
    evidence_rank: int


class AssertionDetail(CatalogModel):
    assertion_id: str
    release_id: str
    scheme_id: str
    entry_id: str
    entry_accession: str
    entry_name: str
    entry_type: str
    assignment_role: AssignmentRole
    assertion_state: AssertionState
    support_tier: str
    review_state: ReviewState
    representative_protein_id: str | None = None
    subject_pk: int
    subject_type: Literal["gene", "protein"]
    internal_gene_id: str | None = None
    gene_symbol: str | None = None
    ncbi_gene_id: str | None = None
    ensembl_gene_id: str | None = None
    protein_accession: str | None = None
    transcript_accession: str | None = None
    mapping_state: MappingState
    mapping_method: str | None = None
    evidence: list[AssertionEvidence]
    review_events: list[dict[str, Any]]


class GeneClassification(CatalogModel):
    assertion_id: str
    scheme_id: str
    scheme_name: str
    entry_id: str
    accession: str
    entry_name: str
    entry_type: str
    assignment_role: AssignmentRole
    assertion_state: AssertionState
    support_tier: str
    review_state: ReviewState
    representative_protein_id: str | None = None
    gene_symbol: str | None = None
    ncbi_gene_id: str | None = None
    ensembl_gene_id: str | None = None
    evidence_count: int


class DomainHit(CatalogModel):
    entry_id: str | None = None
    pfam_accession: str
    pfam_name: str
    definition: str | None = None
    assertion_id: str | None = None
    domain_index: int | None = None
    domain_total: int | None = None
    ali_from: int | None = None
    ali_to: int | None = None
    env_from: int | None = None
    env_to: int | None = None
    independent_evalue: float | None = None
    domain_score: float | None = None
    accuracy: float | None = None
    threshold_pass: int | None = None
    protein_accession: str | None = None
    protein_length: int | None = None
    internal_gene_id: str | None = None


class ProteinArchitecture(CatalogModel):
    protein_id: str
    protein_length: int | None = None
    transcript_accession: str | None = None
    domain_hits: list[DomainHit]


class GeneAnnotationSummary(CatalogModel):
    classification_count: int
    protein_count: int
    domain_hit_count: int
    candidate_count: int


class GeneFamilyAnnotations(CatalogModel):
    release_id: str
    internal_gene_id: str
    summary: GeneAnnotationSummary
    classifications: list[GeneClassification]
    proteins: list[ProteinArchitecture]


class ProteinDomainHits(CatalogModel):
    protein_id: str
    total: int
    data: list[DomainHit]


class ReleaseAsset(CatalogModel):
    asset_id: int
    release_id: str
    asset_name: str
    relative_path: str
    media_type: str
    sha256: str | None = None
    byte_size: int | None = None
    description: str
    download_url: str


class ReleaseDownloads(CatalogModel):
    release_id: str
    data: list[ReleaseAsset]
