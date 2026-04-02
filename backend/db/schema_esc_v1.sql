-- ESC Expression Star Schema DDL v1.1
-- Phase 2: Execute after Phase 0 precheck passes

BEGIN;

-- ── gene_xref 扩展 ────────────────────────────────────────────────────────────
ALTER TABLE gene_xref ADD COLUMN IF NOT EXISTS gene_type TEXT
  DEFAULT 'unknown';
ALTER TABLE gene_xref ADD COLUMN IF NOT EXISTS display_symbol TEXT;
ALTER TABLE gene_xref ADD COLUMN IF NOT EXISTS is_canonical BOOLEAN DEFAULT FALSE;

UPDATE gene_xref SET
    is_canonical    = TRUE,
    display_symbol  = COALESCE(gene_symbol, gene_id),
    gene_type       = 'protein_coding'
WHERE is_canonical IS DISTINCT FROM TRUE
   OR display_symbol IS NULL;

CREATE INDEX IF NOT EXISTS idx_gene_xref_canonical
    ON gene_xref(is_canonical) WHERE is_canonical = TRUE;

-- ── A. gene_alias ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gene_alias (
    alias_id       BIGSERIAL PRIMARY KEY,
    canonical_id   TEXT NOT NULL,
    alias          TEXT NOT NULL,
    alias_type     TEXT NOT NULL CHECK (alias_type IN (
        'legacy_gene_id', 'loc_id', 'symbol', 'symbol_variant', 'ncbi_gene_id'
    )),
    is_primary     BOOLEAN DEFAULT FALSE,
    source_dataset TEXT,
    updated_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(alias_type, alias)
);
CREATE INDEX IF NOT EXISTS idx_alias_canonical ON gene_alias(canonical_id);
CREATE INDEX IF NOT EXISTS idx_alias_lookup   ON gene_alias(alias);

-- ── B. unmapped_feature ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unmapped_feature (
    feature_id     BIGSERIAL PRIMARY KEY,
    feature_name  TEXT NOT NULL UNIQUE,
    feature_type  TEXT NOT NULL CHECK (feature_type IN ('tRNA','miRNA','other')),
    source_dataset TEXT NOT NULL,
    gene_id_guess TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── C. dataset ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dataset (
    dataset_id           BIGSERIAL PRIMARY KEY,
    dataset_code         TEXT NOT NULL UNIQUE,
    dataset_name         TEXT NOT NULL,
    sample_scope         TEXT NOT NULL,
    normalization_family TEXT NOT NULL,
    description          TEXT,
    source_file          TEXT,
    metric_codes         TEXT[] NOT NULL,
    row_count            INTEGER,
    created_at           TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO dataset (dataset_code, dataset_name, sample_scope, normalization_family, description, metric_codes)
VALUES
    ('raw_ballgown_36', 'Ballgown TPM/FPKM — 36 发育阶段样本',
     'development_36', 'ballgown',
     '现有库：鸡胚胎 6 阶段 × 2 性别 × 3 重复，TPM+FPKM 两种 metric',
     ARRAY['tpm','fpkm']),
    ('day_deseq2_36',  'DESeq2 NC — 36 发育阶段样本',
     'development_36', 'deseq2',
     'ESC day 数据：同 36 发育样本，DESeq2 归一化计数；可与 raw_ballgown_36 同轴对比',
     ARRAY['normcount']),
    ('esc_srr_23',     'ESC SRR Runs — 23 个 SRA Runs',
     'esc_srr_23',      'ballgown',
     '23 个独立 SRA Run，Ballgown TPM/FPKM/NORMCOUNT；raw_count 暂不入库，SRR metadata 待补',
     ARRAY['tpm','fpkm','normcount'])
ON CONFLICT (dataset_code) DO NOTHING;

-- ── D. expr_metric ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expr_metric (
    metric_code    TEXT PRIMARY KEY,
    metric_name   TEXT NOT NULL,
    unit_desc     TEXT,
    display_order INTEGER NOT NULL,
    is_comparable BOOLEAN DEFAULT TRUE
);
INSERT INTO expr_metric (metric_code, metric_name, unit_desc, display_order, is_comparable) VALUES
    ('tpm',        'TPM (Transcripts Per Million)',          'TPM',   1, TRUE),
    ('fpkm',       'FPKM (Fragments Per Kilobase Million)',   'FPKM',  2, TRUE),
    ('normcount',   'DESeq2 Normalized Count',                'count', 3, FALSE),
    ('raw_count',  'Raw Read Count',                          'count', 4, FALSE)
ON CONFLICT (metric_code) DO NOTHING;

-- ── E. dataset_sample ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dataset_sample (
    dataset_sample_id BIGSERIAL PRIMARY KEY,
    dataset_id       INTEGER NOT NULL REFERENCES dataset(dataset_id) ON DELETE CASCADE,
    biosample_id    INTEGER REFERENCES expression_sample(id) ON DELETE SET NULL,
    sample_name      TEXT NOT NULL,
    srr_run_id      TEXT,
    stage           TEXT,
    sex             TEXT,
    replicate       INTEGER,
    batch           TEXT,
    tissue          TEXT,
    stage_order     INTEGER,
    -- TSV 原始列名（用于 expression_fact 导入时列名查找）
    tpm_col        TEXT,
    fpkm_col       TEXT,
    nc_col          TEXT,
    raw_col         TEXT,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(dataset_id, sample_name)
);
CREATE INDEX IF NOT EXISTS idx_ds_sample_dataset ON dataset_sample(dataset_id);
CREATE INDEX IF NOT EXISTS idx_ds_sample_bio    ON dataset_sample(biosample_id);
CREATE INDEX IF NOT EXISTS idx_ds_sample_srr    ON dataset_sample(srr_run_id);

-- ── F. expression_fact ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expression_fact (
    fact_id            BIGSERIAL PRIMARY KEY,
    gene_id           TEXT NOT NULL,
    dataset_sample_id INTEGER NOT NULL REFERENCES dataset_sample(dataset_sample_id) ON DELETE CASCADE,
    metric_code       TEXT NOT NULL REFERENCES expr_metric(metric_code),
    value             DOUBLE PRECISION NOT NULL,
    source_row        TEXT,
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(gene_id, dataset_sample_id, metric_code)
);
CREATE INDEX IF NOT EXISTS idx_fact_gene ON expression_fact(gene_id);
CREATE INDEX IF NOT EXISTS idx_fact_sample ON expression_fact(dataset_sample_id);
CREATE INDEX IF NOT EXISTS idx_fact_metric ON expression_fact(metric_code);
CREATE INDEX IF NOT EXISTS idx_fact_gm    ON expression_fact(gene_id, metric_code);
CREATE INDEX IF NOT EXISTS idx_fact_sm    ON expression_fact(dataset_sample_id, metric_code);

-- ── G. stg_esc_master ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stg_esc_master (
    gene_id           TEXT NOT NULL,
    gene_name         TEXT,
    "TPM_SRR16929068"  DOUBLE PRECISION, "TPM_SRR16929069"  DOUBLE PRECISION,
    "TPM_SRR16929070"  DOUBLE PRECISION, "TPM_SRR16929071"  DOUBLE PRECISION,
    "TPM_SRR16929072"  DOUBLE PRECISION, "TPM_SRR16929073"  DOUBLE PRECISION,
    "TPM_SRR16929074"  DOUBLE PRECISION, "TPM_SRR16929075"  DOUBLE PRECISION,
    "TPM_SRR16929076"  DOUBLE PRECISION, "TPM_SRR16929077"  DOUBLE PRECISION,
    "TPM_SRR16929078"  DOUBLE PRECISION, "TPM_SRR20047277"  DOUBLE PRECISION,
    "TPM_SRR24477490"  DOUBLE PRECISION, "TPM_SRR24477492"  DOUBLE PRECISION,
    "TPM_SRR24477493"  DOUBLE PRECISION, "TPM_SRR24477494"  DOUBLE PRECISION,
    "TPM_SRR24477495"  DOUBLE PRECISION, "TPM_SRR24477497"  DOUBLE PRECISION,
    "TPM_SRR24477498"  DOUBLE PRECISION, "TPM_SRR28390558"  DOUBLE PRECISION,
    "TPM_SRR28390561"  DOUBLE PRECISION, "TPM_SRR28390562"  DOUBLE PRECISION,
    "TPM_SRR28390563"  DOUBLE PRECISION,
    "FPKM_SRR16929068" DOUBLE PRECISION, "FPKM_SRR16929069" DOUBLE PRECISION,
    "FPKM_SRR16929070" DOUBLE PRECISION, "FPKM_SRR16929071" DOUBLE PRECISION,
    "FPKM_SRR16929072" DOUBLE PRECISION, "FPKM_SRR16929073" DOUBLE PRECISION,
    "FPKM_SRR16929074" DOUBLE PRECISION, "FPKM_SRR16929075" DOUBLE PRECISION,
    "FPKM_SRR16929076" DOUBLE PRECISION, "FPKM_SRR16929077" DOUBLE PRECISION,
    "FPKM_SRR16929078" DOUBLE PRECISION, "FPKM_SRR20047277" DOUBLE PRECISION,
    "FPKM_SRR24477490" DOUBLE PRECISION, "FPKM_SRR24477492" DOUBLE PRECISION,
    "FPKM_SRR24477493" DOUBLE PRECISION, "FPKM_SRR24477494" DOUBLE PRECISION,
    "FPKM_SRR24477495" DOUBLE PRECISION, "FPKM_SRR24477497" DOUBLE PRECISION,
    "FPKM_SRR24477498" DOUBLE PRECISION, "FPKM_SRR28390558" DOUBLE PRECISION,
    "FPKM_SRR28390561" DOUBLE PRECISION, "FPKM_SRR28390562" DOUBLE PRECISION,
    "FPKM_SRR28390563" DOUBLE PRECISION,
    "NORMCOUNT_SRR16929068" DOUBLE PRECISION, "NORMCOUNT_SRR16929069" DOUBLE PRECISION,
    "NORMCOUNT_SRR16929070" DOUBLE PRECISION, "NORMCOUNT_SRR16929071" DOUBLE PRECISION,
    "NORMCOUNT_SRR16929072" DOUBLE PRECISION, "NORMCOUNT_SRR16929073" DOUBLE PRECISION,
    "NORMCOUNT_SRR16929074" DOUBLE PRECISION, "NORMCOUNT_SRR16929075" DOUBLE PRECISION,
    "NORMCOUNT_SRR16929076" DOUBLE PRECISION, "NORMCOUNT_SRR16929077" DOUBLE PRECISION,
    "NORMCOUNT_SRR16929078" DOUBLE PRECISION, "NORMCOUNT_SRR20047277" DOUBLE PRECISION,
    "NORMCOUNT_SRR24477490" DOUBLE PRECISION, "NORMCOUNT_SRR24477492" DOUBLE PRECISION,
    "NORMCOUNT_SRR24477493" DOUBLE PRECISION, "NORMCOUNT_SRR24477494" DOUBLE PRECISION,
    "NORMCOUNT_SRR24477495" DOUBLE PRECISION, "NORMCOUNT_SRR24477497" DOUBLE PRECISION,
    "NORMCOUNT_SRR24477498" DOUBLE PRECISION, "NORMCOUNT_SRR28390558" DOUBLE PRECISION,
    "NORMCOUNT_SRR28390561" DOUBLE PRECISION, "NORMCOUNT_SRR28390562" DOUBLE PRECISION,
    "NORMCOUNT_SRR28390563" DOUBLE PRECISION,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── H. stg_day_deseq2 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stg_day_deseq2 (
    gene_id             TEXT NOT NULL,
    "E0_Female1"    DOUBLE PRECISION, "E0_Female2"    DOUBLE PRECISION,
    "E0_Female3"    DOUBLE PRECISION, "E0_Male1"      DOUBLE PRECISION,
    "E0_Male2"      DOUBLE PRECISION, "E0_Male3"      DOUBLE PRECISION,
    "E18_5_Female1" DOUBLE PRECISION, "E18_5_Female2" DOUBLE PRECISION,
    "E18_5_Female3" DOUBLE PRECISION, "E18_5_Male1"   DOUBLE PRECISION,
    "E18_5_Male2"   DOUBLE PRECISION, "E18_5_Male3"   DOUBLE PRECISION,
    "E3_5_Female1"  DOUBLE PRECISION, "E3_5_Female2"  DOUBLE PRECISION,
    "E3_5_Female3"  DOUBLE PRECISION, "E3_5_Male1"    DOUBLE PRECISION,
    "E3_5_Male2"    DOUBLE PRECISION, "E3_5_Male3"    DOUBLE PRECISION,
    "E4_5_Female1"  DOUBLE PRECISION, "E4_5_Female2"  DOUBLE PRECISION,
    "E4_5_Female3"  DOUBLE PRECISION, "E4_5_Male1"    DOUBLE PRECISION,
    "E4_5_Male2"    DOUBLE PRECISION, "E4_5_Male3"    DOUBLE PRECISION,
    "E5_5_Female1"  DOUBLE PRECISION, "E5_5_Female2"  DOUBLE PRECISION,
    "E5_5_Female3"  DOUBLE PRECISION, "E5_5_Male1"    DOUBLE PRECISION,
    "E5_5_Male2"    DOUBLE PRECISION, "E5_5_Male3"    DOUBLE PRECISION,
    "E6_5_Female1"  DOUBLE PRECISION, "E6_5_Female2"  DOUBLE PRECISION,
    "E6_5_Female3"  DOUBLE PRECISION, "E6_5_Male1"    DOUBLE PRECISION,
    "E6_5_Male2"    DOUBLE PRECISION, "E6_5_Male3"    DOUBLE PRECISION,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── I. stage_dim ──────────────────────────────────────────────────────────────
-- Canonical developmental stage dimension table.
-- All datasets (day_deseq2_36, esc_srr_23, etc.) join via dataset_sample.stage → stage_code.
-- Replaces per-dataset stage_label/stage_order duplication.
CREATE TABLE IF NOT EXISTS stage_dim (
    stage_code   TEXT PRIMARY KEY,   -- E0, E3.5, E4.5, E5.5, E6.5, E18.5
    stage_order  INTEGER NOT NULL,   -- 1..6 (developmental sequence)
    stage_label  TEXT NOT NULL,      -- 'Embryo Day 0 (Fertilized egg)', 'Embryo Day 3.5', ...
    short_label  TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO stage_dim (stage_code, stage_order, stage_label, short_label) VALUES
    ('E0',   1, 'Embryo Day 0 (Fertilized egg)', 'E0'),
    ('E3.5', 2, 'Embryo Day 3.5', 'E3.5'),
    ('E4.5', 3, 'Embryo Day 4.5', 'E4.5'),
    ('E5.5', 4, 'Embryo Day 5.5', 'E5.5'),
    ('E6.5', 5, 'Embryo Day 6.5', 'E6.5'),
    ('E18.5', 6, 'Embryo Day 18.5', 'E18.5')
ON CONFLICT (stage_code) DO UPDATE SET
    stage_order = EXCLUDED.stage_order,
    stage_label = EXCLUDED.stage_label,
    short_label = EXCLUDED.short_label,
    updated_at  = NOW();

-- ── J. gene_expression_summary ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gene_expression_summary (
    gene_id        TEXT NOT NULL,
    dataset_code   TEXT NOT NULL,
    metric_code    TEXT NOT NULL,
    sample_count   INTEGER NOT NULL,
    mean_value     DOUBLE PRECISION,
    max_value      DOUBLE PRECISION,
    min_value      DOUBLE PRECISION,
    std_value      DOUBLE PRECISION,
    top_sample     TEXT,
    top_stage      TEXT,
    sex_bias       TEXT,
    cv             DOUBLE PRECISION,
    expressed_samples INTEGER,
    zero_samples   INTEGER,
    top_sample     TEXT,
    top_stage      TEXT,
    sex_bias_label TEXT,
    sex_bias_ratio DOUBLE PRECISION,
    fold_change_top    DOUBLE PRECISION,
    fold_change_bottom DOUBLE PRECISION,
    stage_means    JSONB,
    stage_sample_count JSONB,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (gene_id, dataset_code, metric_code)
);
CREATE INDEX IF NOT EXISTS idx_ges_gene ON gene_expression_summary(gene_id);
CREATE INDEX IF NOT EXISTS idx_ges_ds   ON gene_expression_summary(dataset_code);

-- ── Phase 9: Deprecation markers ───────────────────────────────────────────────
-- v_gene_expression_wide and v_gene_expression_development are Phase 8 legacy
-- compatibility snapshots. They are NOT used by any API runtime route or
-- service layer. Safe to drop after v1.0 release.
-- NOTE: Views must exist before COMMENT ON VIEW runs. If they were never created
-- in this database, skip the two COMMENT ON VIEW lines below.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_views WHERE viewname = 'v_gene_expression_wide') THEN
        COMMENT ON VIEW v_gene_expression_wide IS
            'DEPRECATED: legacy wide-table compatibility snapshot; not used by API runtime';
    END IF;
    IF EXISTS (SELECT FROM pg_views WHERE viewname = 'v_gene_expression_development') THEN
        COMMENT ON VIEW v_gene_expression_development IS
            'DEPRECATED: legacy developmental-stage aggregation; not used by API runtime';
    END IF;
END $$;

-- dataset.metric_codes is a display field only.
-- The authoritative capability registry is mv_dataset_metric.
COMMENT ON COLUMN dataset.metric_codes IS
    'DEPRECATED from logic: use mv_dataset_metric for (dataset, metric) capability checks';

COMMIT;
