PRAGMA foreign_keys = ON;

CREATE TABLE gf_release (
    release_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    release_status TEXT NOT NULL CHECK (release_status IN ('release_candidate', 'published', 'withdrawn')),
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
    qc_status TEXT NOT NULL CHECK (qc_status IN ('pending', 'passed', 'warning', 'blocked')),
    notes TEXT
);

CREATE TABLE gf_source_file (
    source_file_id INTEGER PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    file_name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    row_count INTEGER,
    delimiter TEXT,
    encoding TEXT,
    header_json TEXT,
    validation_status TEXT NOT NULL CHECK (validation_status IN ('passed', 'warning', 'failed')),
    notes TEXT,
    UNIQUE (release_id, relative_path)
);

CREATE TABLE gf_scheme (
    scheme_id TEXT PRIMARY KEY,
    scheme_name TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_version TEXT,
    subject_level TEXT NOT NULL CHECK (subject_level IN ('gene', 'protein', 'mixed')),
    description TEXT NOT NULL
);

CREATE TABLE gf_entry (
    entry_id TEXT PRIMARY KEY,
    scheme_id TEXT NOT NULL REFERENCES gf_scheme(scheme_id),
    accession TEXT NOT NULL,
    name TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    definition TEXT,
    parent_entry_id TEXT REFERENCES gf_entry(entry_id),
    external_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    UNIQUE (scheme_id, accession)
);

CREATE TABLE gf_subject (
    subject_pk INTEGER PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    subject_key TEXT NOT NULL,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('gene', 'protein')),
    source_namespace TEXT NOT NULL,
    source_accession TEXT NOT NULL,
    internal_gene_id TEXT,
    gene_symbol TEXT,
    ncbi_gene_id TEXT,
    ensembl_gene_id TEXT,
    protein_accession TEXT,
    transcript_accession TEXT,
    protein_length INTEGER,
    description TEXT,
    mapping_state TEXT NOT NULL CHECK (mapping_state IN ('exact', 'ambiguous', 'unmapped', 'not_applicable')),
    mapping_method TEXT,
    UNIQUE (release_id, subject_key)
);

CREATE TABLE gf_subject_gene (
    subject_pk INTEGER NOT NULL REFERENCES gf_subject(subject_pk) ON DELETE CASCADE,
    internal_gene_id TEXT NOT NULL DEFAULT '',
    external_gene_id TEXT NOT NULL DEFAULT '',
    relationship TEXT NOT NULL DEFAULT 'encoded_by',
    mapping_state TEXT NOT NULL CHECK (mapping_state IN ('exact', 'ambiguous', 'unmapped')),
    PRIMARY KEY (subject_pk, external_gene_id, internal_gene_id)
) WITHOUT ROWID;

CREATE TABLE gf_identifier_mapping (
    mapping_id INTEGER PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    source_namespace TEXT NOT NULL,
    source_accession TEXT NOT NULL,
    internal_gene_id TEXT,
    mapping_state TEXT NOT NULL CHECK (mapping_state IN ('exact', 'ambiguous', 'unmapped')),
    mapping_method TEXT,
    candidate_gene_ids_json TEXT NOT NULL DEFAULT '[]',
    UNIQUE (release_id, source_namespace, source_accession)
);

CREATE TABLE gf_rule (
    rule_id TEXT PRIMARY KEY,
    scheme_id TEXT NOT NULL REFERENCES gf_scheme(scheme_id),
    rule_version TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    rule_definition TEXT NOT NULL,
    parameter_json TEXT NOT NULL,
    script_commit TEXT,
    effective_from_release TEXT NOT NULL REFERENCES gf_release(release_id)
);

CREATE TABLE gf_assertion (
    assertion_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    scheme_id TEXT NOT NULL REFERENCES gf_scheme(scheme_id),
    entry_id TEXT NOT NULL REFERENCES gf_entry(entry_id),
    subject_pk INTEGER NOT NULL REFERENCES gf_subject(subject_pk),
    assignment_role TEXT NOT NULL CHECK (assignment_role IN ('primary', 'secondary', 'supplementary')),
    assertion_state TEXT NOT NULL CHECK (assertion_state IN ('accepted', 'candidate', 'unresolved', 'rejected', 'withdrawn')),
    support_tier TEXT NOT NULL,
    review_state TEXT NOT NULL CHECK (review_state IN ('not_required', 'unreviewed', 'in_review', 'approved', 'rejected', 'needs_mapping')),
    representative_protein_id TEXT,
    rule_id TEXT REFERENCES gf_rule(rule_id),
    source_record_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (release_id, scheme_id, entry_id, subject_pk, assignment_role)
);

CREATE TABLE gf_evidence (
    evidence_id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    evidence_type TEXT NOT NULL,
    source_file_id INTEGER NOT NULL REFERENCES gf_source_file(source_file_id),
    source_record_id TEXT NOT NULL,
    method TEXT NOT NULL,
    model_accession TEXT,
    score REAL,
    sequence_evalue REAL,
    domain_ievalue REAL,
    threshold_type TEXT,
    threshold_value REAL,
    threshold_pass INTEGER CHECK (threshold_pass IN (0, 1)),
    description TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE gf_assertion_evidence (
    assertion_id TEXT NOT NULL REFERENCES gf_assertion(assertion_id) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL REFERENCES gf_evidence(evidence_id) ON DELETE CASCADE,
    evidence_role TEXT NOT NULL CHECK (evidence_role IN ('classification', 'supporting', 'conflicting', 'mapping', 'review')),
    evidence_rank INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (assertion_id, evidence_id)
) WITHOUT ROWID;

CREATE TABLE gf_domain_hit (
    evidence_id TEXT PRIMARY KEY REFERENCES gf_evidence(evidence_id) ON DELETE CASCADE,
    subject_pk INTEGER NOT NULL REFERENCES gf_subject(subject_pk),
    pfam_accession TEXT NOT NULL,
    pfam_accession_version TEXT,
    pfam_name TEXT NOT NULL,
    domain_index INTEGER,
    domain_total INTEGER,
    hmm_from INTEGER,
    hmm_to INTEGER,
    ali_from INTEGER,
    ali_to INTEGER,
    env_from INTEGER,
    env_to INTEGER,
    conditional_evalue REAL,
    independent_evalue REAL,
    domain_score REAL,
    accuracy REAL,
    threshold_pass INTEGER CHECK (threshold_pass IN (0, 1))
);

CREATE TABLE gf_review_event (
    review_event_id TEXT PRIMARY KEY,
    assertion_id TEXT NOT NULL REFERENCES gf_assertion(assertion_id),
    previous_state TEXT,
    new_state TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    comment TEXT,
    supporting_reference TEXT
);

CREATE TABLE gf_entry_summary (
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    entry_id TEXT NOT NULL REFERENCES gf_entry(entry_id),
    accepted_genes INTEGER NOT NULL,
    candidate_genes INTEGER NOT NULL,
    unresolved_genes INTEGER NOT NULL,
    accepted_proteins INTEGER NOT NULL,
    candidate_proteins INTEGER NOT NULL,
    evidence_coverage REAL NOT NULL,
    mapping_coverage REAL NOT NULL,
    PRIMARY KEY (release_id, entry_id)
) WITHOUT ROWID;

CREATE TABLE gf_scheme_summary (
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    scheme_id TEXT NOT NULL REFERENCES gf_scheme(scheme_id),
    entry_count INTEGER NOT NULL,
    accepted_genes INTEGER NOT NULL,
    candidate_genes INTEGER NOT NULL,
    unresolved_genes INTEGER NOT NULL,
    accepted_proteins INTEGER NOT NULL,
    candidate_proteins INTEGER NOT NULL,
    annotated_proteins INTEGER NOT NULL,
    domain_hits INTEGER NOT NULL,
    mapping_coverage REAL NOT NULL,
    PRIMARY KEY (release_id, scheme_id)
) WITHOUT ROWID;

CREATE TABLE gf_qc_result (
    qc_result_id INTEGER PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    check_name TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
    status TEXT NOT NULL CHECK (status IN ('passed', 'warning', 'failed')),
    observed_value TEXT,
    expected_value TEXT,
    details TEXT
);

CREATE TABLE gf_release_asset (
    asset_id INTEGER PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES gf_release(release_id),
    asset_name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    media_type TEXT NOT NULL,
    sha256 TEXT,
    byte_size INTEGER,
    description TEXT NOT NULL,
    UNIQUE (release_id, asset_name)
);

CREATE INDEX idx_entry_scheme_name ON gf_entry(scheme_id, name, entry_id);
CREATE INDEX idx_subject_internal_gene ON gf_subject(release_id, internal_gene_id);
CREATE INDEX idx_subject_protein ON gf_subject(release_id, protein_accession);
CREATE INDEX idx_subject_gene_internal ON gf_subject_gene(internal_gene_id, subject_pk);
CREATE INDEX idx_mapping_external ON gf_identifier_mapping(release_id, source_namespace, source_accession);
CREATE INDEX idx_assertion_entry_state ON gf_assertion(release_id, entry_id, assertion_state, subject_pk);
CREATE INDEX idx_assertion_subject ON gf_assertion(release_id, subject_pk, scheme_id);
CREATE INDEX idx_assertion_filters ON gf_assertion(release_id, scheme_id, assertion_state, support_tier, review_state, assignment_role);
CREATE INDEX idx_evidence_source ON gf_evidence(release_id, source_file_id, source_record_id);
CREATE INDEX idx_domain_subject ON gf_domain_hit(subject_pk, pfam_accession, ali_from);
CREATE INDEX idx_domain_pfam ON gf_domain_hit(pfam_accession, subject_pk);

CREATE VIEW gf_catalog_member AS
SELECT
    a.assertion_id,
    a.release_id,
    a.scheme_id,
    a.entry_id,
    e.accession AS entry_accession,
    e.name AS entry_name,
    e.entry_type,
    a.assignment_role,
    a.assertion_state,
    a.support_tier,
    a.review_state,
    a.representative_protein_id,
    s.subject_pk,
    s.subject_type,
    s.internal_gene_id,
    s.gene_symbol,
    s.ncbi_gene_id,
    s.ensembl_gene_id,
    s.protein_accession,
    s.transcript_accession,
    s.mapping_state,
    s.mapping_method
FROM gf_assertion a
JOIN gf_entry e ON e.entry_id = a.entry_id
JOIN gf_subject s ON s.subject_pk = a.subject_pk;

PRAGMA user_version = 1;
