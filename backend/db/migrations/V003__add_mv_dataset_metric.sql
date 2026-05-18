-- V003: Add mv_dataset_metric materialized view
-- Capability registry: which (dataset, metric) combinations are enabled.
-- ExpressionService validates user queries against this view.
-- Updated 2026-05-18: Fixed schema references to match current expression_fact structure.
-- Idempotent: skips if MV already exists.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dataset_metric AS
SELECT
    d.dataset_code,
    ef.metric_code,
    CASE ef.metric_code
        WHEN 'tpm' THEN 'TPM (Transcripts Per Million)'
        WHEN 'fpkm' THEN 'FPKM (Fragments Per Kilobase Million)'
        WHEN 'normcount' THEN 'DESeq2 Normalized Count'
        WHEN 'raw_count' THEN 'Raw Read Count'
        ELSE ef.metric_code
    END AS metric_name,
    CASE ef.metric_code
        WHEN 'tpm' THEN 'TPM'
        WHEN 'fpkm' THEN 'FPKM'
        ELSE 'count'
    END AS unit_desc,
    COUNT(DISTINCT ef.gene_id)                          AS gene_count,
    COUNT(DISTINCT ef.dataset_sample_id)                AS sample_count,
    COUNT(*)                                           AS fact_row_count,
    MAX(ef.updated_at)                                 AS last_updated,
    TRUE                                               AS is_enabled
FROM expression_fact ef
JOIN dataset_sample ds ON ds.dataset_sample_id = ef.dataset_sample_id
JOIN dataset d ON d.dataset_id = ds.dataset_id
GROUP BY d.dataset_code, ef.metric_code;

-- Index for fast (dataset, metric) lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_dm_ds_metric
    ON mv_dataset_metric(dataset_code, metric_code);

-- Index for enabled filter
CREATE INDEX IF NOT EXISTS idx_mv_dm_enabled
    ON mv_dataset_metric(is_enabled) WHERE is_enabled = TRUE;

COMMENT ON MATERIALIZED VIEW mv_dataset_metric IS
    'Capability registry: enabled (dataset, metric) combinations with row counts. '
    'ExpressionService validates queries against is_enabled=TRUE rows.';
