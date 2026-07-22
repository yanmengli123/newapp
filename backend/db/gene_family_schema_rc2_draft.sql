-- ChickenData gene-family RC2 contract schema (design draft)
-- Scientific contract: gg-gf-contract-1.0
-- IMPORTANT: create a new RC2 database; never apply this file to RC1 in place.

PRAGMA foreign_keys = ON;

CREATE TABLE gf_release (
    release_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    scientific_contract_version TEXT NOT NULL,
    release_status TEXT NOT NULL CHECK (
        release_status IN ('internal_review', 'release_candidate', 'published', 'deprecated', 'withdrawn')
    ),
    qc_status TEXT NOT NULL CHECK (qc_status IN ('pending', 'passed', 'warning', 'blocked')),
    blocking_issue_count INTEGER NOT NULL DEFAULT 0 CHECK (blocking_issue_count >= 0),
    taxon_id INTEGER NOT NULL,
    species_name TEXT NOT NULL,
    assembly_accession TEXT NOT NULL,
    assembly_name TEXT NOT NULL,
    annotation_release TEXT,
    proteome_source TEXT,
    proteome_version TEXT,
    created_at TEXT NOT NULL,
    previous_release_id TEXT,
    etl_git_commit TEXT,
    status_reason TEXT,
    notes TEXT
);

CREATE TABLE gf_source_file (
    source_file_id INTEGER PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    file_name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    source_role TEXT NOT NULL CHECK (source_role IN ('authoritative', 'supporting', 'legacy', 'derived', 'documentation')),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    row_count INTEGER CHECK (row_count >= 0),
    delimiter TEXT,
    encoding TEXT,
    header_json TEXT,
    provenance_status TEXT NOT NULL CHECK (provenance_status IN ('complete', 'inferred', 'partial', 'unknown_legacy')),
    scientific_impact TEXT NOT NULL CHECK (scientific_impact IN ('none', 'minor', 'major', 'critical')),
    validation_status TEXT NOT NULL CHECK (validation_status IN ('passed', 'warning', 'failed')),
    notes TEXT,
    UNIQUE (release_id, relative_path)
);

CREATE TABLE gf_source_record (
    source_record_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    source_file_id INTEGER NOT NULL REFERENCES gf_source_file(source_file_id),
    source_row_number INTEGER CHECK (source_row_number IS NULL OR source_row_number > 0),
    source_subject_namespace TEXT,
    source_subject_identifier TEXT,
    raw_record_hash TEXT NOT NULL CHECK (length(raw_record_hash) = 64),
    normalized_record_hash TEXT NOT NULL CHECK (length(normalized_record_hash) = 64),
    UNIQUE (source_file_id, source_row_number)
);

CREATE TABLE gf_scheme (
    scheme_id TEXT PRIMARY KEY,
    scheme_stable_id TEXT NOT NULL UNIQUE,
    scheme_name TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_version TEXT,
    subject_level TEXT NOT NULL CHECK (subject_level IN ('gene', 'protein', 'mixed')),
    assignment_cardinality TEXT NOT NULL CHECK (
        assignment_cardinality IN ('single_per_role', 'multi_per_role', 'ordered_multi')
    ),
    classification_axis TEXT,
    description TEXT NOT NULL,
    CHECK (
        (assignment_cardinality = 'single_per_role' AND classification_axis IS NOT NULL)
        OR assignment_cardinality IN ('multi_per_role', 'ordered_multi')
    ),
    CHECK (assignment_cardinality <> 'multi_per_role' OR classification_axis IS NULL)
);

CREATE TABLE gf_entry (
    entry_id TEXT PRIMARY KEY,
    entry_stable_id TEXT NOT NULL UNIQUE,
    scheme_id TEXT NOT NULL REFERENCES gf_scheme(scheme_id),
    accession TEXT NOT NULL,
    accession_version TEXT,
    name TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    definition TEXT,
    parent_entry_id TEXT REFERENCES gf_entry(entry_id),
    external_url TEXT,
    entry_status TEXT NOT NULL CHECK (entry_status IN ('active', 'deprecated', 'merged', 'retired')),
    replacement_entry_id TEXT REFERENCES gf_entry(entry_id),
    metadata_hash TEXT NOT NULL CHECK (length(metadata_hash) = 64),
    UNIQUE (scheme_id, accession, accession_version),
    CHECK (entry_id <> parent_entry_id),
    CHECK (entry_id <> replacement_entry_id),
    CHECK (entry_status <> 'merged' OR replacement_entry_id IS NOT NULL)
);

CREATE TABLE gf_subject (
    subject_pk INTEGER PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    subject_type TEXT NOT NULL CHECK (subject_type IN ('gene', 'protein')),
    source_subject_namespace TEXT NOT NULL,
    source_subject_identifier TEXT NOT NULL,
    original_source_identifier TEXT NOT NULL,
    normalization_algorithm TEXT NOT NULL,
    subject_lineage_id TEXT,
    internal_gene_id TEXT,
    internal_protein_id TEXT,
    gene_symbol TEXT,
    ncbi_gene_id TEXT,
    ensembl_gene_id TEXT,
    protein_accession TEXT,
    transcript_accession TEXT,
    protein_length INTEGER CHECK (protein_length IS NULL OR protein_length > 0),
    description TEXT,
    mapping_state TEXT NOT NULL CHECK (mapping_state IN ('exact', 'ambiguous', 'unmapped', 'not_applicable')),
    mapping_method TEXT,
    normalization_audit_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (release_id, source_subject_namespace, source_subject_identifier)
);

CREATE TABLE gf_identifier_mapping (
    mapping_id INTEGER PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    source_subject_namespace TEXT NOT NULL,
    source_subject_identifier TEXT NOT NULL,
    internal_gene_id TEXT,
    internal_protein_id TEXT,
    mapping_state TEXT NOT NULL CHECK (mapping_state IN ('exact', 'ambiguous', 'unmapped', 'not_applicable')),
    mapping_method TEXT,
    candidate_internal_ids_json TEXT NOT NULL DEFAULT '[]',
    source_record_hash TEXT NOT NULL CHECK (length(source_record_hash) = 64),
    UNIQUE (release_id, source_subject_namespace, source_subject_identifier),
    CHECK (mapping_state <> 'exact' OR internal_gene_id IS NOT NULL OR internal_protein_id IS NOT NULL)
);

CREATE TABLE gf_reason_code (
    reason_code TEXT PRIMARY KEY,
    reason_code_version TEXT NOT NULL,
    category TEXT NOT NULL,
    allowed_outcomes_json TEXT NOT NULL,
    description TEXT
);

CREATE TABLE gf_trace_diagnostic_code (
    diagnostic_code TEXT PRIMARY KEY,
    diagnostic_code_version TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE gf_approval_attestation (
    attestation_id TEXT PRIMARY KEY,
    release_id TEXT REFERENCES gf_release(release_id),
    artifact_type TEXT NOT NULL CHECK (
        artifact_type IN (
            'domain_vocabulary', 'rule_bundle', 'regression_fixture_bundle',
            'rollup_policy', 'publication_policy', 'shadow_run',
            'rc2c_build', 'release'
        )
    ),
    artifact_hash_algorithm TEXT NOT NULL CHECK (
        artifact_hash_algorithm = 'gf-canonical-json-sha256-v1'
    ),
    artifact_sha256 TEXT NOT NULL CHECK (length(artifact_sha256) = 64),
    approval_scope TEXT NOT NULL CHECK (
        approval_scope IN (
            'approved_for_rule_testing', 'approved_for_shadow_run',
            'approved_for_rc2c_build', 'approved_for_release'
        )
    ),
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'changes_requested')),
    curator_name TEXT NOT NULL,
    curator_identifier TEXT NOT NULL,
    curator_identifier_scheme TEXT NOT NULL CHECK (
        curator_identifier_scheme IN ('ORCID', 'institutional', 'local')
    ),
    curator_role TEXT NOT NULL CHECK (
        curator_role IN ('scientific_curator', 'data_qc_reviewer', 'release_approver')
    ),
    organization TEXT,
    approved_at TEXT NOT NULL,
    limitations_json TEXT NOT NULL DEFAULT '[]',
    detached_signature_json TEXT,
    UNIQUE (artifact_type, artifact_sha256, approval_scope, curator_identifier, approved_at)
);

CREATE TRIGGER gf_approval_attestation_no_update
BEFORE UPDATE ON gf_approval_attestation
BEGIN SELECT RAISE(ABORT, 'approval attestations are append-only'); END;

CREATE TRIGGER gf_approval_attestation_no_delete
BEFORE DELETE ON gf_approval_attestation
BEGIN SELECT RAISE(ABORT, 'approval attestations are append-only'); END;

CREATE TABLE gf_rule (
    rule_version_id TEXT PRIMARY KEY,
    rule_stable_id TEXT NOT NULL,
    rule_version TEXT NOT NULL,
    scheme_id TEXT NOT NULL REFERENCES gf_scheme(scheme_id),
    rule_name TEXT NOT NULL,
    output_entry_id TEXT REFERENCES gf_entry(entry_id),
    output_assertion_state TEXT CHECK (
        output_assertion_state IN ('accepted', 'candidate', 'rejected', 'deprecated', 'withdrawn')
    ),
    priority INTEGER NOT NULL,
    description TEXT NOT NULL,
    biological_definition TEXT,
    references_json TEXT NOT NULL DEFAULT '[]',
    curator TEXT,
    approved_by TEXT,
    approval_date TEXT,
    effective_from_release TEXT NOT NULL,
    effective_to_release TEXT,
    rule_status TEXT NOT NULL CHECK (rule_status IN ('draft', 'approved', 'deprecated', 'retired')),
    script_commit TEXT,
    UNIQUE (rule_stable_id, rule_version)
);

CREATE TABLE gf_rule_node (
    node_id TEXT PRIMARY KEY,
    rule_version_id TEXT NOT NULL REFERENCES gf_rule(rule_version_id) ON DELETE CASCADE,
    parent_node_id TEXT REFERENCES gf_rule_node(node_id) ON DELETE CASCADE,
    node_type TEXT NOT NULL CHECK (node_type IN ('all', 'any', 'not', 'predicate')),
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (rule_version_id, parent_node_id, position),
    CHECK (node_id <> parent_node_id)
);

CREATE TABLE gf_rule_predicate (
    node_id TEXT PRIMARY KEY REFERENCES gf_rule_node(node_id) ON DELETE CASCADE,
    evidence_scope TEXT NOT NULL CHECK (
        evidence_scope IN ('same_hit', 'same_protein', 'same_gene', 'any_isoform', 'all_isoforms', 'representative_isoform')
    ),
    evidence_field TEXT NOT NULL,
    operator TEXT NOT NULL CHECK (
        operator IN (
            'exists', 'not_exists', 'eq', 'neq', 'in', 'not_in', 'contains', 'regex',
            'gt', 'gte', 'lt', 'lte', 'count_gte', 'domain_present', 'domain_absent', 'domain_order'
        )
    ),
    value_type TEXT NOT NULL,
    target_value_json TEXT,
    predicate_hash TEXT NOT NULL CHECK (length(predicate_hash) = 64)
);

CREATE TABLE gf_assertion (
    assertion_version_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    assertion_key TEXT NOT NULL,
    assertion_key_algorithm TEXT NOT NULL CHECK (assertion_key_algorithm = 'gf-assertion-key-v1'),
    assignment_slot_key TEXT,
    scheme_id TEXT NOT NULL REFERENCES gf_scheme(scheme_id),
    entry_id TEXT NOT NULL REFERENCES gf_entry(entry_id),
    subject_pk INTEGER NOT NULL REFERENCES gf_subject(subject_pk),
    assignment_role TEXT NOT NULL CHECK (assignment_role IN ('primary', 'secondary', 'supplementary')),
    assertion_state TEXT NOT NULL CHECK (
        assertion_state IN ('accepted', 'candidate', 'rejected', 'deprecated', 'withdrawn')
    ),
    decision_basis_type TEXT NOT NULL CHECK (
        decision_basis_type IN ('executable_local_rule', 'external_curated_source', 'manual_review', 'legacy_source_assertion')
    ),
    reason_code TEXT NOT NULL REFERENCES gf_reason_code(reason_code),
    review_state TEXT NOT NULL CHECK (review_state IN ('unreviewed', 'confirmed', 'needs_review', 'resolved')),
    mapped_internal_gene_id TEXT,
    mapped_internal_protein_id TEXT,
    representative_protein_id TEXT,
    rule_version_id TEXT REFERENCES gf_rule(rule_version_id),
    primary_source_record_id TEXT REFERENCES gf_source_record(source_record_id),
    evidence_bundle_hash TEXT NOT NULL CHECK (length(evidence_bundle_hash) = 64),
    created_at TEXT NOT NULL,
    UNIQUE (release_id, assertion_key),
    CHECK (decision_basis_type <> 'executable_local_rule' OR rule_version_id IS NOT NULL)
);

CREATE TRIGGER gf_assertion_slot_insert
BEFORE INSERT ON gf_assertion
BEGIN
    SELECT CASE
        WHEN (SELECT assignment_cardinality FROM gf_scheme WHERE scheme_id = NEW.scheme_id) = 'single_per_role'
             AND NEW.assignment_slot_key IS NULL
        THEN RAISE(ABORT, 'single_per_role assertion requires assignment_slot_key')
        WHEN (SELECT assignment_cardinality FROM gf_scheme WHERE scheme_id = NEW.scheme_id) = 'multi_per_role'
             AND NEW.assignment_slot_key IS NOT NULL
        THEN RAISE(ABORT, 'multi_per_role assertion forbids universal assignment_slot_key')
    END;
END;

CREATE TRIGGER gf_assertion_slot_update
BEFORE UPDATE OF assignment_slot_key, scheme_id ON gf_assertion
BEGIN
    SELECT CASE
        WHEN (SELECT assignment_cardinality FROM gf_scheme WHERE scheme_id = NEW.scheme_id) = 'single_per_role'
             AND NEW.assignment_slot_key IS NULL
        THEN RAISE(ABORT, 'single_per_role assertion requires assignment_slot_key')
        WHEN (SELECT assignment_cardinality FROM gf_scheme WHERE scheme_id = NEW.scheme_id) = 'multi_per_role'
             AND NEW.assignment_slot_key IS NOT NULL
        THEN RAISE(ABORT, 'multi_per_role assertion forbids universal assignment_slot_key')
    END;
END;

CREATE TABLE gf_evidence (
    evidence_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    evidence_type TEXT NOT NULL,
    source_file_id INTEGER NOT NULL REFERENCES gf_source_file(source_file_id),
    source_record_id TEXT NOT NULL REFERENCES gf_source_record(source_record_id),
    method TEXT NOT NULL,
    model_accession TEXT,
    model_version TEXT,
    provenance_status TEXT NOT NULL CHECK (provenance_status IN ('complete', 'inferred', 'partial', 'unknown_legacy')),
    scientific_impact TEXT NOT NULL CHECK (scientific_impact IN ('none', 'minor', 'major', 'critical')),
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    description TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (release_id, source_file_id, source_record_id, evidence_type, content_hash)
);

CREATE TABLE gf_evidence_value (
    evidence_id TEXT NOT NULL REFERENCES gf_evidence(evidence_id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    canonical_value TEXT,
    value_type TEXT NOT NULL CHECK (value_type IN ('string', 'integer', 'decimal', 'boolean', 'json')),
    value_status TEXT NOT NULL CHECK (
        value_status IN ('observed', 'derived', 'not_reported', 'not_applicable', 'unknown_legacy')
    ),
    derivation_id TEXT,
    PRIMARY KEY (evidence_id, field_name),
    CHECK (value_status NOT IN ('observed', 'derived') OR canonical_value IS NOT NULL),
    CHECK (value_status <> 'derived' OR derivation_id IS NOT NULL)
) WITHOUT ROWID;

CREATE TABLE gf_domain_hit (
    evidence_id TEXT PRIMARY KEY REFERENCES gf_evidence(evidence_id) ON DELETE CASCADE,
    subject_pk INTEGER NOT NULL REFERENCES gf_subject(subject_pk),
    pfam_accession TEXT NOT NULL,
    pfam_accession_version TEXT,
    pfam_model_release TEXT,
    pfam_name TEXT NOT NULL,
    domain_index INTEGER CHECK (domain_index IS NULL OR domain_index > 0),
    domain_total INTEGER CHECK (domain_total IS NULL OR domain_total > 0),
    hmm_from INTEGER,
    hmm_to INTEGER,
    ali_from INTEGER,
    ali_to INTEGER,
    env_from INTEGER,
    env_to INTEGER,
    hit_identity_key TEXT NOT NULL,
    hit_content_key TEXT NOT NULL,
    CHECK (hmm_from IS NULL OR hmm_to IS NULL OR hmm_from <= hmm_to),
    CHECK (ali_from IS NULL OR ali_to IS NULL OR ali_from <= ali_to),
    CHECK (env_from IS NULL OR env_to IS NULL OR env_from <= env_to)
);

CREATE TABLE gf_scan_run (
    scan_run_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    evidence_source_id TEXT NOT NULL,
    proteome_source TEXT,
    proteome_version TEXT,
    proteome_sha256 TEXT CHECK (proteome_sha256 IS NULL OR length(proteome_sha256) = 64),
    expected_subject_count INTEGER CHECK (expected_subject_count IS NULL OR expected_subject_count > 0),
    subject_universe_value_status TEXT NOT NULL CHECK (
        subject_universe_value_status IN (
            'observed', 'derived', 'not_reported', 'not_applicable', 'unknown_legacy'
        )
    ),
    pfam_release TEXT,
    pfam_hmm_sha256 TEXT CHECK (pfam_hmm_sha256 IS NULL OR length(pfam_hmm_sha256) = 64),
    hmmer_version TEXT,
    command_json TEXT,
    threshold_policy TEXT CHECK (
        threshold_policy IS NULL OR threshold_policy IN (
            'pfam_ga', 'explicit_model_thresholds', 'other_versioned_policy'
        )
    ),
    provenance_status TEXT NOT NULL CHECK (
        provenance_status IN ('complete', 'partial', 'unknown_legacy')
    ),
    started_at TEXT,
    completed_at TEXT,
    scan_status TEXT NOT NULL CHECK (scan_status IN ('completed', 'partial', 'failed')),
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    CHECK (
        provenance_status <> 'complete'
        OR (
            proteome_source IS NOT NULL AND proteome_version IS NOT NULL
            AND proteome_sha256 IS NOT NULL AND expected_subject_count IS NOT NULL
            AND subject_universe_value_status IN ('observed', 'derived')
            AND pfam_release IS NOT NULL AND pfam_hmm_sha256 IS NOT NULL
            AND hmmer_version IS NOT NULL AND command_json IS NOT NULL
            AND threshold_policy IS NOT NULL
        )
    )
);

CREATE TABLE gf_scan_subject (
    scan_run_id TEXT NOT NULL REFERENCES gf_scan_run(scan_run_id) ON DELETE CASCADE,
    source_protein_id TEXT NOT NULL,
    subject_pk INTEGER REFERENCES gf_subject(subject_pk),
    scan_attempted INTEGER NOT NULL CHECK (scan_attempted IN (0, 1)),
    scan_completed INTEGER NOT NULL CHECK (scan_completed IN (0, 1)),
    hit_count INTEGER NOT NULL CHECK (hit_count >= 0),
    no_hit_confirmed INTEGER NOT NULL CHECK (no_hit_confirmed IN (0, 1)),
    failure_diagnostic_code TEXT REFERENCES gf_trace_diagnostic_code(diagnostic_code),
    evidence_completeness TEXT NOT NULL CHECK (
        evidence_completeness IN ('complete', 'partial', 'unknown_legacy')
    ),
    PRIMARY KEY (scan_run_id, source_protein_id),
    CHECK (no_hit_confirmed = 0 OR (scan_completed = 1 AND hit_count = 0))
) WITHOUT ROWID;

CREATE TABLE gf_threshold_provenance (
    scan_run_id TEXT NOT NULL REFERENCES gf_scan_run(scan_run_id) ON DELETE CASCADE,
    pfam_accession TEXT NOT NULL,
    threshold_type TEXT CHECK (
        threshold_type IS NULL OR threshold_type IN ('GA', 'explicit_score', 'other_versioned')
    ),
    sequence_threshold TEXT,
    sequence_threshold_value_status TEXT NOT NULL CHECK (
        sequence_threshold_value_status IN (
            'observed', 'derived', 'not_reported', 'not_applicable', 'unknown_legacy'
        )
    ),
    domain_threshold TEXT,
    domain_threshold_value_status TEXT NOT NULL CHECK (
        domain_threshold_value_status IN (
            'observed', 'derived', 'not_reported', 'not_applicable', 'unknown_legacy'
        )
    ),
    threshold_source TEXT,
    threshold_version TEXT,
    provenance_status TEXT NOT NULL CHECK (
        provenance_status IN ('complete', 'inferred', 'partial', 'unknown_legacy')
    ),
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    PRIMARY KEY (scan_run_id, pfam_accession),
    CHECK (
        provenance_status <> 'complete'
        OR (
            threshold_type IS NOT NULL AND sequence_threshold IS NOT NULL
            AND sequence_threshold_value_status IN ('observed', 'derived')
            AND domain_threshold IS NOT NULL
            AND domain_threshold_value_status IN ('observed', 'derived')
            AND threshold_source IS NOT NULL AND threshold_version IS NOT NULL
        )
    )
) WITHOUT ROWID;

CREATE TABLE gf_evidence_admissibility (
    admissibility_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    evidence_source_id TEXT NOT NULL,
    evidence_source_hash TEXT NOT NULL CHECK (length(evidence_source_hash) = 64),
    supports_presence INTEGER NOT NULL CHECK (supports_presence IN (0, 1)),
    supports_absence INTEGER NOT NULL CHECK (supports_absence IN (0, 1)),
    supports_domain_order INTEGER NOT NULL CHECK (supports_domain_order IN (0, 1)),
    supports_accepted_classification INTEGER NOT NULL CHECK (supports_accepted_classification IN (0, 1)),
    supports_candidate_classification INTEGER NOT NULL CHECK (supports_candidate_classification IN (0, 1)),
    diagnostic_code TEXT NOT NULL REFERENCES gf_trace_diagnostic_code(diagnostic_code),
    assessment_status TEXT NOT NULL CHECK (
        assessment_status IN ('engineering_assessment', 'curator_approved', 'deprecated')
    ),
    approval_attestation_id TEXT REFERENCES gf_approval_attestation(attestation_id),
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    UNIQUE (release_id, evidence_source_id, evidence_source_hash)
);

CREATE TABLE gf_assertion_evidence (
    assertion_version_id TEXT NOT NULL REFERENCES gf_assertion(assertion_version_id) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL REFERENCES gf_evidence(evidence_id) ON DELETE CASCADE,
    evidence_role TEXT NOT NULL CHECK (evidence_role IN ('classification', 'supporting', 'conflicting', 'mapping', 'review')),
    evidence_rank INTEGER NOT NULL DEFAULT 1 CHECK (evidence_rank > 0),
    PRIMARY KEY (assertion_version_id, evidence_id)
) WITHOUT ROWID;

CREATE TABLE gf_assertion_source_record (
    assertion_version_id TEXT NOT NULL REFERENCES gf_assertion(assertion_version_id) ON DELETE CASCADE,
    source_record_id TEXT NOT NULL REFERENCES gf_source_record(source_record_id),
    source_relation TEXT NOT NULL CHECK (source_relation IN ('authoritative', 'supporting', 'duplicate')),
    PRIMARY KEY (assertion_version_id, source_record_id)
) WITHOUT ROWID;

CREATE TABLE gf_rule_evaluation (
    evaluation_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    rule_version_id TEXT NOT NULL REFERENCES gf_rule(rule_version_id),
    source_subject_namespace TEXT NOT NULL,
    source_subject_identifier TEXT NOT NULL,
    source_record_id TEXT REFERENCES gf_source_record(source_record_id),
    evaluation_outcome TEXT NOT NULL CHECK (
        evaluation_outcome IN (
            'matched', 'not_matched', 'excluded', 'conflicted',
            'insufficient_evidence', 'not_evaluable'
        )
    ),
    reason_code TEXT REFERENCES gf_reason_code(reason_code),
    emitted_assertion_version_id TEXT REFERENCES gf_assertion(assertion_version_id),
    evidence_snapshot_hash TEXT NOT NULL CHECK (length(evidence_snapshot_hash) = 64),
    evaluation_context_hash TEXT NOT NULL CHECK (length(evaluation_context_hash) = 64),
    evaluated_at TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    UNIQUE (release_id, rule_version_id, source_subject_namespace,
            source_subject_identifier, evidence_snapshot_hash,
            evaluation_context_hash)
);

CREATE TABLE gf_rule_node_trace (
    trace_id TEXT PRIMARY KEY,
    evaluation_id TEXT NOT NULL REFERENCES gf_rule_evaluation(evaluation_id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES gf_rule_node(node_id),
    node_result TEXT NOT NULL CHECK (node_result IN ('true', 'false', 'unknown')),
    observed_value_json TEXT,
    failure_reason_code TEXT REFERENCES gf_trace_diagnostic_code(diagnostic_code),
    UNIQUE (evaluation_id, node_id)
);

CREATE TABLE gf_rule_trace_evidence (
    trace_id TEXT NOT NULL REFERENCES gf_rule_node_trace(trace_id) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL REFERENCES gf_evidence(evidence_id) ON DELETE CASCADE,
    evidence_role TEXT NOT NULL CHECK (
        evidence_role IN ('matched', 'conflicting', 'completeness', 'context')
    ),
    PRIMARY KEY (trace_id, evidence_id, evidence_role)
) WITHOUT ROWID;

CREATE TABLE gf_regression_fixture (
    fixture_version_id TEXT PRIMARY KEY,
    fixture_id TEXT NOT NULL,
    fixture_version TEXT NOT NULL,
    fixture_class TEXT NOT NULL CHECK (
        fixture_class IN ('synthetic_engine', 'biological_regression', 'release_regression')
    ),
    fixture_type TEXT NOT NULL CHECK (
        fixture_type IN (
            'positive', 'negative', 'boundary', 'missing_evidence',
            'conflicting_evidence', 'exclusion', 'mapping'
        )
    ),
    fixture_status TEXT NOT NULL CHECK (fixture_status IN ('draft', 'approved', 'deprecated')),
    source_subject_namespace TEXT NOT NULL,
    source_subject_identifier TEXT NOT NULL,
    evidence_snapshot_hash TEXT NOT NULL CHECK (length(evidence_snapshot_hash) = 64),
    evaluation_context_hash TEXT NOT NULL CHECK (length(evaluation_context_hash) = 64),
    expected_node_results_json TEXT NOT NULL,
    expected_rule_outcome TEXT NOT NULL CHECK (
        expected_rule_outcome IN (
            'matched', 'not_matched', 'excluded', 'conflicted',
            'insufficient_evidence', 'not_evaluable'
        )
    ),
    expected_emitted_entry_id TEXT REFERENCES gf_entry(entry_id),
    expected_assertion_state TEXT CHECK (
        expected_assertion_state IN ('accepted', 'candidate', 'rejected')
    ),
    expected_reason_codes_json TEXT NOT NULL DEFAULT '[]',
    must_not_emit_json TEXT NOT NULL DEFAULT '{}',
    approval_attestation_id TEXT REFERENCES gf_approval_attestation(attestation_id),
    UNIQUE (fixture_id, fixture_version)
);

CREATE TABLE gf_shadow_run (
    shadow_run_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    shadow_kind TEXT NOT NULL CHECK (
        shadow_kind IN ('engineering_dry_run', 'rc1_reassessment', 'proteome_wide_discovery')
    ),
    subject_universe_hash TEXT NOT NULL CHECK (length(subject_universe_hash) = 64),
    evaluation_context_hash TEXT NOT NULL CHECK (length(evaluation_context_hash) = 64),
    rule_bundle_hash TEXT NOT NULL CHECK (length(rule_bundle_hash) = 64),
    domain_vocabulary_hash TEXT NOT NULL CHECK (length(domain_vocabulary_hash) = 64),
    scan_run_id TEXT REFERENCES gf_scan_run(scan_run_id),
    approval_attestation_id TEXT REFERENCES gf_approval_attestation(attestation_id),
    shadow_status TEXT NOT NULL CHECK (
        shadow_status IN ('engineering_only', 'authorized', 'completed', 'failed')
    ),
    scientific_shadow_authorized INTEGER NOT NULL CHECK (scientific_shadow_authorized IN (0, 1)),
    manifest_hash TEXT CHECK (manifest_hash IS NULL OR length(manifest_hash) = 64),
    CHECK (scientific_shadow_authorized = 0 OR approval_attestation_id IS NOT NULL)
);

CREATE TABLE gf_rollup_policy (
    rollup_policy_version_id TEXT PRIMARY KEY,
    rollup_policy_id TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    policy_status TEXT NOT NULL CHECK (policy_status IN ('draft', 'approved', 'deprecated')),
    positive_isoform_policy TEXT NOT NULL CHECK (
        positive_isoform_policy IN ('any_admissible_isoform', 'all_evaluated_isoforms', 'representative_isoform_only')
    ),
    conflict_policy TEXT NOT NULL CHECK (
        conflict_policy IN ('needs_curator_review', 'candidate_with_conflict', 'no_publication')
    ),
    representative_protein_policy TEXT NOT NULL CHECK (
        representative_protein_policy IN ('highest_evidence_rank', 'longest_admissible_isoform', 'curator_selected')
    ),
    unresolved_mapping_policy TEXT NOT NULL CHECK (
        unresolved_mapping_policy IN ('needs_curator_review', 'source_level_candidate', 'no_publication')
    ),
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    approval_attestation_id TEXT REFERENCES gf_approval_attestation(attestation_id),
    UNIQUE (rollup_policy_id, policy_version)
);

CREATE TABLE gf_gene_rollup_proposal (
    rollup_proposal_id TEXT PRIMARY KEY,
    shadow_run_id TEXT NOT NULL REFERENCES gf_shadow_run(shadow_run_id) ON DELETE CASCADE,
    source_gene_namespace TEXT NOT NULL,
    source_gene_identifier TEXT NOT NULL,
    entry_id TEXT REFERENCES gf_entry(entry_id),
    rollup_outcome TEXT NOT NULL CHECK (
        rollup_outcome IN ('supported', 'not_supported', 'conflicted', 'insufficient_evidence', 'mapping_unresolved')
    ),
    representative_protein_id TEXT,
    rollup_policy_version_id TEXT NOT NULL REFERENCES gf_rollup_policy(rollup_policy_version_id),
    policy_disposition TEXT CHECK (
        policy_disposition IN (
            'needs_curator_review', 'candidate_with_conflict', 'no_publication',
            'source_level_candidate'
        )
    ),
    diagnostic_code TEXT REFERENCES gf_trace_diagnostic_code(diagnostic_code),
    input_evaluation_set_hash TEXT NOT NULL CHECK (length(input_evaluation_set_hash) = 64),
    accepted_classification_admissible INTEGER NOT NULL CHECK (
        accepted_classification_admissible IN (0, 1)
    ),
    candidate_classification_admissible INTEGER NOT NULL CHECK (
        candidate_classification_admissible IN (0, 1)
    ),
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    UNIQUE (shadow_run_id, source_gene_namespace, source_gene_identifier, entry_id)
);

CREATE TABLE gf_gene_rollup_protein (
    rollup_proposal_id TEXT NOT NULL REFERENCES gf_gene_rollup_proposal(rollup_proposal_id) ON DELETE CASCADE,
    source_protein_id TEXT NOT NULL,
    evaluation_id TEXT REFERENCES gf_rule_evaluation(evaluation_id),
    protein_role TEXT NOT NULL CHECK (
        protein_role IN ('supporting', 'conflicting', 'insufficient', 'not_evaluable', 'representative')
    ),
    PRIMARY KEY (rollup_proposal_id, source_protein_id, protein_role)
) WITHOUT ROWID;

CREATE TABLE gf_publication_policy (
    publication_policy_version_id TEXT PRIMARY KEY,
    publication_policy_id TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    policy_status TEXT NOT NULL CHECK (policy_status IN ('draft', 'approved', 'deprecated')),
    shadow_only INTEGER NOT NULL CHECK (shadow_only = 1),
    policy_json TEXT NOT NULL,
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    approval_attestation_id TEXT REFERENCES gf_approval_attestation(attestation_id),
    UNIQUE (publication_policy_id, policy_version)
);

CREATE TABLE gf_shadow_publication_proposal (
    publication_proposal_id TEXT PRIMARY KEY,
    shadow_run_id TEXT NOT NULL REFERENCES gf_shadow_run(shadow_run_id) ON DELETE CASCADE,
    rollup_proposal_id TEXT NOT NULL REFERENCES gf_gene_rollup_proposal(rollup_proposal_id),
    publication_policy_version_id TEXT NOT NULL REFERENCES gf_publication_policy(publication_policy_version_id),
    publication_decision TEXT NOT NULL CHECK (
        publication_decision IN ('proposed_accepted', 'proposed_candidate', 'no_publication', 'needs_curator_review')
    ),
    proposed_assertion_state TEXT CHECK (
        proposed_assertion_state IN ('accepted', 'candidate')
    ),
    proposed_entry_id TEXT REFERENCES gf_entry(entry_id),
    decision_reason_code TEXT REFERENCES gf_reason_code(reason_code),
    diagnostic_code TEXT REFERENCES gf_trace_diagnostic_code(diagnostic_code),
    selected_evaluation_id TEXT REFERENCES gf_rule_evaluation(evaluation_id),
    alternative_evaluation_ids_json TEXT NOT NULL DEFAULT '[]',
    decision_input_hash TEXT NOT NULL CHECK (length(decision_input_hash) = 64),
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    CHECK (
        (publication_decision = 'proposed_accepted' AND proposed_assertion_state = 'accepted')
        OR (publication_decision = 'proposed_candidate' AND proposed_assertion_state = 'candidate')
        OR (publication_decision IN ('no_publication', 'needs_curator_review') AND proposed_assertion_state IS NULL)
    )
);

CREATE TRIGGER gf_shadow_publication_proposal_no_update
BEFORE UPDATE ON gf_shadow_publication_proposal
BEGIN SELECT RAISE(ABORT, 'shadow publication proposals are immutable'); END;

CREATE TRIGGER gf_shadow_publication_proposal_no_delete
BEFORE DELETE ON gf_shadow_publication_proposal
BEGIN SELECT RAISE(ABORT, 'shadow publication proposals are immutable'); END;

CREATE TABLE gf_review_event (
    review_event_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    assertion_key TEXT NOT NULL,
    base_assertion_version_id TEXT,
    base_assertion_hash TEXT NOT NULL CHECK (length(base_assertion_hash) = 64),
    previous_review_state TEXT CHECK (previous_review_state IN ('unreviewed', 'confirmed', 'needs_review', 'resolved')),
    new_review_state TEXT NOT NULL CHECK (new_review_state IN ('unreviewed', 'confirmed', 'needs_review', 'resolved')),
    review_decision TEXT NOT NULL CHECK (review_decision IN ('approve', 'reject', 'retain_candidate', 'remap', 'insufficient_evidence')),
    reviewer TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    reason_code TEXT NOT NULL REFERENCES gf_reason_code(reason_code),
    comment TEXT,
    supporting_reference TEXT
);

CREATE TRIGGER gf_review_event_no_update
BEFORE UPDATE ON gf_review_event
BEGIN SELECT RAISE(ABORT, 'review events are append-only'); END;

CREATE TRIGGER gf_review_event_no_delete
BEFORE DELETE ON gf_review_event
BEGIN SELECT RAISE(ABORT, 'review events are append-only'); END;

CREATE TABLE gf_mapping_disposition (
    disposition_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    assertion_key TEXT NOT NULL,
    assertion_version_id TEXT REFERENCES gf_assertion(assertion_version_id),
    source_subject_namespace TEXT NOT NULL,
    source_subject_identifier TEXT NOT NULL,
    mapping_state TEXT NOT NULL CHECK (mapping_state IN ('ambiguous', 'unmapped')),
    candidate_internal_ids_json TEXT NOT NULL DEFAULT '[]',
    scientific_impact TEXT NOT NULL CHECK (scientific_impact IN ('none', 'minor', 'major', 'critical')),
    review_decision TEXT NOT NULL CHECK (review_decision IN ('approve', 'reject', 'retain_candidate', 'remap', 'insufficient_evidence')),
    reviewer TEXT NOT NULL,
    reason_code TEXT NOT NULL REFERENCES gf_reason_code(reason_code),
    reason TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    source_record_hash TEXT NOT NULL CHECK (length(source_record_hash) = 64),
    UNIQUE (release_id, assertion_key)
);

CREATE TABLE gf_metric_definition (
    metric_id TEXT NOT NULL,
    metric_version TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL,
    scheme_id TEXT REFERENCES gf_scheme(scheme_id),
    subject_level TEXT NOT NULL,
    unit TEXT NOT NULL,
    denominator_unit TEXT,
    base_relation TEXT NOT NULL,
    eligible_assertion_states_json TEXT NOT NULL,
    eligible_assignment_roles_json TEXT NOT NULL,
    mapping_requirement TEXT NOT NULL CHECK (mapping_requirement IN ('none', 'any', 'exact')),
    deduplication_fields_json TEXT NOT NULL,
    dimension_fields_json TEXT NOT NULL,
    implementation_id TEXT NOT NULL,
    denominator_metric_id TEXT,
    definition_hash TEXT NOT NULL CHECK (length(definition_hash) = 64),
    PRIMARY KEY (metric_id, metric_version)
) WITHOUT ROWID;

CREATE TABLE gf_metric_value (
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    metric_id TEXT NOT NULL,
    metric_version TEXT NOT NULL,
    dimension_json TEXT NOT NULL DEFAULT '{}',
    numeric_value TEXT NOT NULL,
    denominator_value TEXT,
    excluded_json TEXT NOT NULL DEFAULT '{}',
    computed_at TEXT NOT NULL,
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    PRIMARY KEY (release_id, metric_id, metric_version, dimension_json),
    FOREIGN KEY (metric_id, metric_version) REFERENCES gf_metric_definition(metric_id, metric_version)
) WITHOUT ROWID;

CREATE TABLE gf_qc_result (
    qc_result_id INTEGER PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    gate_id TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'blocker')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'passed', 'warning', 'failed')),
    observed_value_json TEXT,
    expected_value_json TEXT,
    issue_reference TEXT,
    details TEXT,
    UNIQUE (release_id, gate_id)
);

CREATE TABLE gf_rejected_source_record (
    rejected_record_id INTEGER PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    source_file_id INTEGER NOT NULL REFERENCES gf_source_file(source_file_id),
    source_row_number INTEGER,
    source_record_id TEXT,
    reason_code TEXT NOT NULL,
    error_detail TEXT NOT NULL,
    raw_record_hash TEXT NOT NULL CHECK (length(raw_record_hash) = 64)
);

CREATE TABLE gf_content_hash (
    hash_record_id INTEGER PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    hash_scope TEXT NOT NULL CHECK (
        hash_scope IN ('source', 'normalized', 'semantic_table', 'database_semantic_root', 'binary', 'manifest')
    ),
    object_name TEXT NOT NULL,
    row_count INTEGER CHECK (row_count IS NULL OR row_count >= 0),
    algorithm TEXT NOT NULL CHECK (algorithm IN ('SHA-256', 'RFC8785-JCS+SHA-256')),
    digest TEXT NOT NULL CHECK (length(digest) = 64),
    canonicalization_version TEXT,
    UNIQUE (release_id, hash_scope, object_name)
);

CREATE TABLE gf_limitation (
    limitation_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    affected_scheme TEXT,
    affected_metrics_json TEXT NOT NULL DEFAULT '[]',
    affected_assertions_json TEXT NOT NULL DEFAULT '[]',
    scientific_impact TEXT NOT NULL CHECK (scientific_impact IN ('none', 'minor', 'major', 'critical')),
    workaround TEXT,
    owner TEXT NOT NULL,
    target_release TEXT,
    status TEXT NOT NULL CHECK (status IN ('open', 'mitigated', 'resolved', 'accepted'))
);

CREATE TABLE gf_release_signoff (
    signoff_event_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    signoff_role TEXT NOT NULL CHECK (signoff_role IN ('builder', 'data_qc_reviewer', 'scientific_curator', 'release_approver')),
    person TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'changes_requested')),
    signed_at TEXT NOT NULL,
    comment TEXT,
    UNIQUE (release_id, signoff_role, person, signed_at)
);

CREATE TRIGGER gf_release_signoff_no_update
BEFORE UPDATE ON gf_release_signoff
BEGIN SELECT RAISE(ABORT, 'release sign-offs are append-only'); END;

CREATE TRIGGER gf_release_signoff_no_delete
BEFORE DELETE ON gf_release_signoff
BEGIN SELECT RAISE(ABORT, 'release sign-offs are append-only'); END;

CREATE TABLE gf_prov_entity (
    entity_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    entity_type TEXT NOT NULL,
    label TEXT NOT NULL,
    uri TEXT,
    content_hash TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE gf_prov_activity (
    activity_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    activity_type TEXT NOT NULL,
    label TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    command_json TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE gf_prov_agent (
    agent_id TEXT PRIMARY KEY,
    agent_type TEXT NOT NULL CHECK (agent_type IN ('SoftwareAgent', 'Person', 'Organization')),
    label TEXT NOT NULL,
    uri TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE gf_prov_relation (
    relation_id INTEGER PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    subject_id TEXT NOT NULL,
    predicate TEXT NOT NULL CHECK (
        predicate IN ('wasGeneratedBy', 'wasDerivedFrom', 'used', 'wasAssociatedWith', 'wasAttributedTo', 'actedOnBehalfOf')
    ),
    object_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE gf_release_asset (
    asset_id INTEGER PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    asset_name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    media_type TEXT NOT NULL,
    sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
    byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
    description TEXT NOT NULL,
    UNIQUE (release_id, asset_name)
);

CREATE INDEX idx_entry_scheme_name ON gf_entry(scheme_id, name, entry_id);
CREATE INDEX idx_subject_internal_gene ON gf_subject(release_id, internal_gene_id);
CREATE INDEX idx_subject_protein ON gf_subject(release_id, protein_accession);
CREATE INDEX idx_assertion_entry_state ON gf_assertion(release_id, entry_id, assertion_state, subject_pk);
CREATE INDEX idx_assertion_subject ON gf_assertion(release_id, subject_pk, scheme_id);
CREATE INDEX idx_assertion_slot ON gf_assertion(release_id, assignment_slot_key);
CREATE UNIQUE INDEX uq_assertion_slot_accepted ON gf_assertion(release_id, assignment_slot_key)
WHERE assignment_slot_key IS NOT NULL AND assertion_state = 'accepted';
CREATE UNIQUE INDEX uq_assertion_slot_candidate ON gf_assertion(release_id, assignment_slot_key)
WHERE assignment_slot_key IS NOT NULL AND assertion_state = 'candidate';
CREATE INDEX idx_evidence_source ON gf_evidence(release_id, source_file_id, source_record_id);
CREATE INDEX idx_source_record_subject ON gf_source_record(release_id, source_subject_namespace, source_subject_identifier);
CREATE INDEX idx_domain_subject ON gf_domain_hit(subject_pk, pfam_accession, ali_from);
CREATE INDEX idx_scan_subject_status ON gf_scan_subject(scan_run_id, scan_completed, evidence_completeness);
CREATE INDEX idx_threshold_scan_accession ON gf_threshold_provenance(scan_run_id, pfam_accession);
CREATE INDEX idx_rule_node_parent ON gf_rule_node(rule_version_id, parent_node_id, position);
CREATE INDEX idx_rule_evaluation_subject ON gf_rule_evaluation(
    release_id, source_subject_namespace, source_subject_identifier, evaluation_outcome
);
CREATE INDEX idx_rule_evaluation_assertion ON gf_rule_evaluation(emitted_assertion_version_id);
CREATE INDEX idx_rule_node_trace_evaluation ON gf_rule_node_trace(evaluation_id, node_result);
CREATE INDEX idx_rollup_shadow_outcome ON gf_gene_rollup_proposal(shadow_run_id, rollup_outcome);
CREATE INDEX idx_publication_shadow_decision ON gf_shadow_publication_proposal(shadow_run_id, publication_decision);
CREATE INDEX idx_mapping_disposition_state ON gf_mapping_disposition(release_id, mapping_state);
CREATE INDEX idx_metric_value_release ON gf_metric_value(release_id, metric_id, metric_version);
CREATE INDEX idx_qc_release_status ON gf_qc_result(release_id, severity, status);

CREATE VIEW gf_catalog_member AS
SELECT
    a.assertion_version_id,
    a.assertion_key,
    a.assignment_slot_key,
    a.release_id,
    a.scheme_id,
    a.entry_id,
    e.entry_stable_id,
    e.accession AS entry_accession,
    e.name AS entry_name,
    e.entry_type,
    a.assignment_role,
    a.assertion_state,
    a.decision_basis_type,
    a.reason_code,
    a.review_state,
    a.mapped_internal_gene_id,
    a.mapped_internal_protein_id,
    a.representative_protein_id,
    s.subject_pk,
    s.subject_type,
    s.source_subject_namespace,
    s.source_subject_identifier,
    s.gene_symbol,
    s.protein_accession,
    s.transcript_accession,
    s.mapping_state,
    s.mapping_method
FROM gf_assertion a
JOIN gf_entry e ON e.entry_id = a.entry_id
JOIN gf_subject s ON s.subject_pk = a.subject_pk;

PRAGMA user_version = 2;
