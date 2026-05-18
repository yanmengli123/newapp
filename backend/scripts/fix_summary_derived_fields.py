#!/usr/bin/env python3
"""
Fix gene_expression_summary derived fields.
Updates: stage_means, stage_sample_count, top_stage, top_sample,
         sex_bias_label, sex_bias_ratio, fold_change_top, fold_change_bottom
"""

import os
import sys
import json
import psycopg2
import psycopg2.extras


def main():
    pg_dsn = os.environ.get('GRCG6A_PG_DSN', 'postgresql://grcuser:grcpassword@127.0.0.1:5433/grcg6a')
    conn = psycopg2.connect(pg_dsn)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        print('Step 1: Computing stage aggregations...')
        # Get stage-level stats per gene/dataset/metric
        cur.execute('''
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
            GROUP BY ef.gene_id, d.dataset_code, ef.metric_code, es.stage
        ''')
        stage_rows = cur.fetchall()
        print(f'  Got {len(stage_rows):,} stage aggregation rows')

        # Organize by (gene_id, dataset_code, metric_code)
        stage_map = {}
        for row in stage_rows:
            key = (row['gene_id'], row['dataset_code'], row['metric_code'])
            if key not in stage_map:
                stage_map[key] = {}
            stage_map[key][row['stage']] = {
                'male': float(row['male_mean'] or 0),
                'female': float(row['female_mean'] or 0),
                'mean': float(row['stage_mean'] or 0),
                'count': row['stage_count']
            }

        print(f'  Organized into {len(stage_map):,} gene/dataset/metric combinations')

        print('\nStep 2: Computing top sample per gene...')
        # Get top sample (highest value) per gene/dataset/metric
        cur.execute('''
            SELECT DISTINCT ON (ef.gene_id, d.dataset_code, ef.metric_code)
                ef.gene_id,
                d.dataset_code,
                ef.metric_code,
                es.sample_name,
                ef.value
            FROM expression_fact ef
            JOIN dataset_sample ds ON ds.dataset_sample_id = ef.dataset_sample_id
            JOIN dataset d ON d.dataset_id = ds.dataset_id
            JOIN expression_sample es ON es.id = ds.biosample_id
            ORDER BY ef.gene_id, d.dataset_code, ef.metric_code, ef.value DESC
        ''')
        top_sample_rows = cur.fetchall()
        top_sample_map = {}
        for row in top_sample_rows:
            key = (row['gene_id'], row['dataset_code'], row['metric_code'])
            top_sample_map[key] = row['sample_name']
        print(f'  Got {len(top_sample_map):,} top samples')

        print('\nStep 3: Computing sex bias...')
        # Get sex-level means per gene/dataset/metric
        cur.execute('''
            SELECT
                ef.gene_id,
                d.dataset_code,
                ef.metric_code,
                AVG(CASE WHEN es.sex = 'Male' THEN ef.value END) as male_mean,
                AVG(CASE WHEN es.sex = 'Female' THEN ef.value END) as female_mean
            FROM expression_fact ef
            JOIN dataset_sample ds ON ds.dataset_sample_id = ef.dataset_sample_id
            JOIN dataset d ON d.dataset_id = ds.dataset_id
            JOIN expression_sample es ON es.id = ds.biosample_id
            GROUP BY ef.gene_id, d.dataset_code, ef.metric_code
        ''')
        sex_rows = cur.fetchall()
        sex_map = {}
        for row in sex_rows:
            key = (row['gene_id'], row['dataset_code'], row['metric_code'])
            sex_map[key] = {
                'male': float(row['male_mean'] or 0),
                'female': float(row['female_mean'] or 0)
            }
        print(f'  Got {len(sex_map):,} sex bias rows')

        print('\nStep 4: Updating gene_expression_summary...')
        # Get all summary rows
        cur.execute('SELECT gene_id, dataset_code, metric_code, mean_value FROM gene_expression_summary')
        summary_rows = cur.fetchall()
        print(f'  Processing {len(summary_rows):,} summary rows...')

        update_count = 0
        batch_size = 1000
        batch = []

        for i, row in enumerate(summary_rows):
            key = (row['gene_id'], row['dataset_code'], row['metric_code'])

            # Stage means
            stages = stage_map.get(key, {})
            stage_means = {}
            stage_sample_count = {}
            for stage, data in stages.items():
                stage_means[stage] = {
                    'male': data['male'],
                    'female': data['female'],
                    'mean': data['mean']
                }
                stage_sample_count[stage] = data['count']

            # Top stage (stage with highest mean)
            top_stage = None
            if stages:
                top_stage = max(stages.keys(), key=lambda s: stages[s]['mean'])

            # Top sample
            top_sample = top_sample_map.get(key)

            # Sex bias
            sex_data = sex_map.get(key, {'male': 0, 'female': 0})
            male_mean = sex_data['male']
            female_mean = sex_data['female']

            if female_mean > male_mean * 1.2:
                sex_bias_label = 'Female_higher'
            elif male_mean > female_mean * 1.2:
                sex_bias_label = 'Male_higher'
            else:
                sex_bias_label = 'No_difference'

            sex_bias_ratio = female_mean / male_mean if male_mean > 0 else None

            # Fold change (stage-level max/min vs overall mean, log2 scale)
            import math
            overall_mean = float(row['mean_value'] or 0)
            fold_change_top = None
            fold_change_bottom = None
            if overall_mean > 0 and stages:
                stage_means_list = [s['mean'] for s in stages.values() if s['mean'] > 0]
                if stage_means_list:
                    max_stage = max(stage_means_list)
                    min_stage = min(stage_means_list)
                    fold_change_top = math.log2(max_stage / overall_mean)
                    fold_change_bottom = math.log2(min_stage / overall_mean)

            batch.append((
                json.dumps(stage_means) if stage_means else None,
                json.dumps(stage_sample_count) if stage_sample_count else None,
                top_stage,
                top_sample,
                sex_bias_label,
                sex_bias_ratio,
                fold_change_top,
                fold_change_bottom,
                row['gene_id'],
                row['dataset_code'],
                row['metric_code']
            ))

            if len(batch) >= batch_size:
                _execute_batch(cur, batch)
                conn.commit()
                update_count += len(batch)
                print(f'  Updated {update_count:,} / {len(summary_rows):,}', end='\r')
                batch = []

        # Final batch
        if batch:
            _execute_batch(cur, batch)
            conn.commit()
            update_count += len(batch)

        print(f'\n  Updated {update_count:,} summary rows')

        # Verify
        print('\nStep 5: Verifying...')
        cur.execute('''
            SELECT
                metric_code,
                COUNT(*) as total,
                COUNT(stage_means) as has_stage_means,
                COUNT(top_stage) as has_top_stage,
                COUNT(sex_bias_label) as has_sex_bias,
                COUNT(fold_change_top) as has_fc_top
            FROM gene_expression_summary
            GROUP BY metric_code
        ''')
        for row in cur.fetchall():
            print(f"  {row['metric_code']}: total={row['total']}, "
                  f"stage_means={row['has_stage_means']}, "
                  f"top_stage={row['has_top_stage']}, "
                  f"sex_bias={row['has_sex_bias']}, "
                  f"fc_top={row['has_fc_top']}")

        print('\nDone!')

    except Exception as e:
        conn.rollback()
        print(f'Error: {e}', file=sys.stderr)
        raise
    finally:
        cur.close()
        conn.close()


def _execute_batch(cur, batch):
    cur.executemany('''
        UPDATE gene_expression_summary
        SET
            stage_means = %s::jsonb,
            stage_sample_count = %s::jsonb,
            top_stage = %s,
            top_sample = %s,
            sex_bias_label = %s,
            sex_bias_ratio = %s,
            fold_change_top = %s,
            fold_change_bottom = %s
        WHERE gene_id = %s
          AND dataset_code = %s
          AND metric_code = %s
    ''', batch)


if __name__ == '__main__':
    main()
