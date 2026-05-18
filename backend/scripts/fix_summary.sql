-- Fix gene_expression_summary derived fields
-- Run with: docker exec -i grc_postgres psql -U grcuser -d grcg6a < backend/scripts/fix_summary.sql

-- Step 1: Create stage aggregation table
DROP TABLE IF EXISTS _fix_stage_agg;

CREATE TABLE _fix_stage_agg AS
SELECT
    ef.gene_id,
    d.dataset_code,
    ef.metric_code,
    es.stage,
    AVG(CASE WHEN es.sex = 'Male' THEN ef.value END) as male_mean,
    AVG(CASE WHEN es.sex = 'Female' THEN ef.value END) as female_mean,
    AVG(ef.value) as stage_mean,
    COUNT(*) as stage_count
FROM expression_fact ef
JOIN dataset_sample ds ON ds.dataset_sample_id = ef.dataset_sample_id
JOIN dataset d ON d.dataset_id = ds.dataset_id
JOIN expression_sample es ON es.id = ds.biosample_id
GROUP BY ef.gene_id, d.dataset_code, ef.metric_code, es.stage;

CREATE INDEX ON _fix_stage_agg (gene_id, dataset_code, metric_code);

-- Step 2: Update stage_means and stage_sample_count
UPDATE gene_expression_summary ges
SET
    stage_means = sub.sm,
    stage_sample_count = sub.ssc
FROM (
    SELECT
        gene_id, dataset_code, metric_code,
        jsonb_object_agg(stage, jsonb_build_object(
            'male', COALESCE(male_mean, 0),
            'female', COALESCE(female_mean, 0),
            'mean', COALESCE(stage_mean, 0)
        )) as sm,
        jsonb_object_agg(stage, stage_count) as ssc
    FROM _fix_stage_agg
    GROUP BY gene_id, dataset_code, metric_code
) sub
WHERE ges.gene_id = sub.gene_id
  AND ges.dataset_code = sub.dataset_code
  AND ges.metric_code = sub.metric_code;

-- Step 3: Update top_stage (stage with highest mean)
UPDATE gene_expression_summary ges
SET top_stage = sub.top_stage
FROM (
    SELECT DISTINCT ON (gene_id, dataset_code, metric_code)
        gene_id, dataset_code, metric_code, stage as top_stage
    FROM _fix_stage_agg
    WHERE stage_mean IS NOT NULL
    ORDER BY gene_id, dataset_code, metric_code, stage_mean DESC
) sub
WHERE ges.gene_id = sub.gene_id
  AND ges.dataset_code = sub.dataset_code
  AND ges.metric_code = sub.metric_code;

-- Step 4: Update top_sample
UPDATE gene_expression_summary ges
SET top_sample = sub.sample_name
FROM (
    SELECT DISTINCT ON (ef.gene_id, d.dataset_code, ef.metric_code)
        ef.gene_id, d.dataset_code, ef.metric_code, es.sample_name
    FROM expression_fact ef
    JOIN dataset_sample ds ON ds.dataset_sample_id = ef.dataset_sample_id
    JOIN dataset d ON d.dataset_id = ds.dataset_id
    JOIN expression_sample es ON es.id = ds.biosample_id
    ORDER BY ef.gene_id, d.dataset_code, ef.metric_code, ef.value DESC
) sub
WHERE ges.gene_id = sub.gene_id
  AND ges.dataset_code = sub.dataset_code
  AND ges.metric_code = sub.metric_code;

-- Step 5: Update sex_bias_label and sex_bias_ratio
UPDATE gene_expression_summary ges
SET
    sex_bias_label = CASE
        WHEN sub.female_mean > sub.male_mean * 1.2 THEN 'Female_higher'
        WHEN sub.male_mean > sub.female_mean * 1.2 THEN 'Male_higher'
        ELSE 'No_difference'
    END,
    sex_bias_ratio = CASE
        WHEN sub.male_mean > 0 THEN sub.female_mean / sub.male_mean
        ELSE NULL
    END
FROM (
    SELECT
        ef.gene_id, d.dataset_code, ef.metric_code,
        AVG(CASE WHEN es.sex = 'Male' THEN ef.value END) as male_mean,
        AVG(CASE WHEN es.sex = 'Female' THEN ef.value END) as female_mean
    FROM expression_fact ef
    JOIN dataset_sample ds ON ds.dataset_sample_id = ef.dataset_sample_id
    JOIN dataset d ON d.dataset_id = ds.dataset_id
    JOIN expression_sample es ON es.id = ds.biosample_id
    GROUP BY ef.gene_id, d.dataset_code, ef.metric_code
) sub
WHERE ges.gene_id = sub.gene_id
  AND ges.dataset_code = sub.dataset_code
  AND ges.metric_code = sub.metric_code;

-- Step 6: Update fold_change_top and fold_change_bottom (log2 fold change)
-- Uses stage-level max/min means, not sample-level max/min
UPDATE gene_expression_summary ges
SET
    fold_change_top = CASE
        WHEN sub.max_stage > 0 AND ges.mean_value > 0
        THEN LN(sub.max_stage / ges.mean_value) / LN(2)
        ELSE NULL
    END,
    fold_change_bottom = CASE
        WHEN sub.min_stage > 0 AND ges.mean_value > 0
        THEN LN(sub.min_stage / ges.mean_value) / LN(2)
        ELSE NULL
    END
FROM (
    SELECT
        gene_id, dataset_code, metric_code,
        MAX(stage_mean) as max_stage,
        MIN(CASE WHEN stage_mean > 0 THEN stage_mean END) as min_stage
    FROM _fix_stage_agg
    GROUP BY gene_id, dataset_code, metric_code
) sub
WHERE ges.gene_id = sub.gene_id
  AND ges.dataset_code = sub.dataset_code
  AND ges.metric_code = sub.metric_code;

-- Cleanup
DROP TABLE IF EXISTS _fix_stage_agg;

-- Verify results
SELECT
    metric_code,
    COUNT(*) as total,
    COUNT(stage_means) as has_stage_means,
    COUNT(top_stage) as has_top_stage,
    COUNT(top_sample) as has_top_sample,
    COUNT(sex_bias_label) as has_sex_bias,
    COUNT(fold_change_top) as has_fc_top
FROM gene_expression_summary
GROUP BY metric_code
ORDER BY metric_code;
