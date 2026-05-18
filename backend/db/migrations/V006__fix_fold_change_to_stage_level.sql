-- V006: Fix fold_change to use stage-level means and NULL sentinel
-- Replaces sample-level max/min with stage-level max/min for fold_change calculation
-- Changes -999 sentinel to NULL for uncomputable values
-- Uses LN(x)/LN(2) for log2 to avoid PostgreSQL LOG() type issues

-- Step 1: Create stage aggregation temp table
DROP TABLE IF EXISTS _v006_stage_agg;

CREATE TABLE _v006_stage_agg AS
SELECT
    ef.gene_id,
    d.dataset_code,
    ef.metric_code,
    es.stage,
    AVG(ef.value) as stage_mean
FROM expression_fact ef
JOIN dataset_sample ds ON ds.dataset_sample_id = ef.dataset_sample_id
JOIN dataset d ON d.dataset_id = ds.dataset_id
JOIN expression_sample es ON es.id = ds.biosample_id
GROUP BY ef.gene_id, d.dataset_code, ef.metric_code, es.stage;

CREATE INDEX ON _v006_stage_agg (gene_id, dataset_code, metric_code);

-- Step 2: Update fold_change_top and fold_change_bottom
-- Uses stage-level max/min means, not sample-level max/min
-- NULL when mean_value <= 0 or no positive stage means
UPDATE gene_expression_summary ges
SET
    fold_change_top = CASE
        WHEN ges.mean_value > 0 AND sub.max_stage > 0
        THEN LN(sub.max_stage / ges.mean_value) / LN(2)
        ELSE NULL
    END,
    fold_change_bottom = CASE
        WHEN ges.mean_value > 0 AND sub.min_stage > 0
        THEN LN(sub.min_stage / ges.mean_value) / LN(2)
        ELSE NULL
    END
FROM (
    SELECT
        gene_id, dataset_code, metric_code,
        MAX(stage_mean) as max_stage,
        MIN(CASE WHEN stage_mean > 0 THEN stage_mean END) as min_stage
    FROM _v006_stage_agg
    GROUP BY gene_id, dataset_code, metric_code
) sub
WHERE ges.gene_id = sub.gene_id
  AND ges.dataset_code = sub.dataset_code
  AND ges.metric_code = sub.metric_code;

-- Step 3: Cleanup
DROP TABLE IF EXISTS _v006_stage_agg;

-- Step 4: Verify
SELECT
    metric_code,
    COUNT(*) as total,
    COUNT(fold_change_top) as has_fc_top,
    COUNT(fold_change_bottom) as has_fc_bottom,
    MIN(fold_change_top) as min_fc_top,
    MAX(fold_change_top) as max_fc_top,
    MIN(fold_change_bottom) as min_fc_bottom,
    MAX(fold_change_bottom) as max_fc_bottom
FROM gene_expression_summary
GROUP BY metric_code
ORDER BY metric_code;
