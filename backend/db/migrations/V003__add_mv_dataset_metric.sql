-- V003: Add mv_dataset_metric materialized view
-- Capability registry: which (dataset, metric) combinations are enabled.
-- ExpressionService validates user queries against this view.
-- Idempotent: skips if MV already exists.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dataset_metric AS
SELECT
    d.dataset_code,
    m.metric_code,
    m.metric_name,
    m.unit_desc,
    COUNT(DISTINCT f.gene_id)                          AS gene_count,
    COUNT(DISTINCT f.dataset_sample_id)                AS sample_count,
    COUNT(*)                                           AS fact_row_count,
    MAX(e.sample_date)                                 AS last_updated,
    TRUE                                               AS is_enabled
FROM expression_fact f
JOIN dataset d ON f.dataset_id = d.dataset_id
JOIN expr_metric m ON f.metric_id = m.metric_id
GROUP BY d.dataset_code, m.metric_code, m.metric_name, m.unit_desc;

-- Index for fast (dataset, metric) lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_dm_ds_metric
    ON mv_dataset_metric(dataset_code, metric_code);

-- Index for enabled filter
CREATE INDEX IF NOT EXISTS idx_mv_dm_enabled
    ON mv_dataset_metric(is_enabled) WHERE is_enabled = TRUE;

COMMENT ON MATERIALIZED VIEW mv_dataset_metric IS
    'Capability registry: enabled (dataset, metric) combinations with row counts. '
    'ExpressionService validates queries against is_enabled=TRUE rows.';
