#!/usr/bin/env python3
"""
Import expression data from update data directory into PostgreSQL.

Replaces expression-related tables while preserving GO/KEGG/genome annotations.

Usage:
    python import_update_data.py --data-dir "D:/jbrowsedata/projectdata/update data" [--dry-run]
"""

import argparse
import csv
import os
import sys
from datetime import datetime

import psycopg2
from psycopg2.extras import execute_values

# Stage mapping: file column prefix -> database stage
STAGE_MAP = {
    'E0': 'E0',
    'E3_5': 'E3.5',
    'E4_5': 'E4.5',
    'E5_5': 'E5.5',
    'E6_5': 'E6.5',
    'E18_5': 'E18.5',
}

# Stage order
STAGE_ORDER = {
    'E0': 1,
    'E3.5': 2,
    'E4.5': 3,
    'E5.5': 4,
    'E6.5': 5,
    'E18.5': 6,
}

STAGE_LABEL = {
    'E0': 'Stage 0',
    'E3.5': 'Stage 3.5',
    'E4.5': 'Stage 4.5',
    'E5.5': 'Stage 5.5',
    'E6.5': 'Stage 6.5',
    'E18.5': 'Stage 18.5',
}


def parse_sample_col(col_name: str) -> tuple[str, str, int]:
    """Parse 'E0_Female1' -> ('E0', 'Female', 1)"""
    # Extract stage
    if col_name.startswith('E18_5'):
        stage_raw = 'E18_5'
    elif col_name.startswith('E6_5'):
        stage_raw = 'E6_5'
    elif col_name.startswith('E5_5'):
        stage_raw = 'E5_5'
    elif col_name.startswith('E4_5'):
        stage_raw = 'E4_5'
    elif col_name.startswith('E3_5'):
        stage_raw = 'E3_5'
    else:
        stage_raw = 'E0'

    stage = STAGE_MAP[stage_raw]
    sex = 'Female' if 'Female' in col_name else 'Male'
    replicate = int(col_name[-1])

    return stage, sex, replicate


def load_matrix_file(filepath: str, metric_code: str) -> list[tuple[str, str, str, int, str, float]]:
    """Load a matrix TSV file and return (gene_id, stage, sex, replicate, metric, value) tuples."""
    records = []
    skipped = 0

    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter='\t')
        header = next(reader)  # ['gene_id', 'E0_Female1', ...]

        # Parse sample columns
        sample_info = []
        for col in header[1:]:
            stage, sex, rep = parse_sample_col(col)
            sample_info.append((stage, sex, rep))

        for line_num, row in enumerate(reader, 2):
            gene_id = row[0].strip()

            # Skip invalid rows
            if not gene_id or gene_id == '.' or gene_id.startswith('#'):
                skipped += 1
                continue

            for i, (stage, sex, rep) in enumerate(sample_info, 1):
                try:
                    value = float(row[i]) if row[i] and row[i] != 'NA' else 0.0
                except (ValueError, IndexError):
                    value = 0.0

                records.append((gene_id, stage, sex, rep, metric_code, value))

    print(f'  Loaded {len(records):,} records from {os.path.basename(filepath)} (skipped {skipped} invalid rows)')
    return records


def build_gene_mapping(cur, source_gene_ids: set[str]) -> dict[str, dict]:
    """Build mapping from source gene_id to canonical gene_id."""
    mapping = {}

    # Method 1: gene_symbol exact match
    id_list = sorted(source_gene_ids)
    for i in range(0, len(id_list), 1000):
        batch = id_list[i:i+1000]
        placeholders = ','.join(['%s'] * len(batch))
        cur.execute(f'''
            SELECT DISTINCT gene_symbol, gene_id
            FROM gene_xref
            WHERE gene_symbol IN ({placeholders})
        ''', batch)
        for symbol, gene_id in cur.fetchall():
            if symbol not in mapping:
                mapping[symbol] = {
                    'canonical_gene_id': gene_id,
                    'match_method': 'gene_symbol',
                    'match_status': 'mapped'
                }

    # Method 2: display_symbol match (for unmapped)
    unmapped = source_gene_ids - set(mapping.keys())
    if unmapped:
        id_list = sorted(unmapped)
        for i in range(0, len(id_list), 1000):
            batch = id_list[i:i+1000]
            placeholders = ','.join(['%s'] * len(batch))
            cur.execute(f'''
                SELECT DISTINCT display_symbol, gene_id
                FROM gene_xref
                WHERE display_symbol IN ({placeholders})
            ''', batch)
            for symbol, gene_id in cur.fetchall():
                if symbol not in mapping:
                    mapping[symbol] = {
                        'canonical_gene_id': gene_id,
                        'match_method': 'display_symbol',
                        'match_status': 'mapped'
                    }

    # Method 3: gene_alias match (for unmapped)
    unmapped = source_gene_ids - set(mapping.keys())
    if unmapped:
        id_list = sorted(unmapped)
        for i in range(0, len(id_list), 1000):
            batch = id_list[i:i+1000]
            placeholders = ','.join(['%s'] * len(batch))
            cur.execute(f'''
                SELECT DISTINCT alias, canonical_id
                FROM gene_alias
                WHERE alias IN ({placeholders})
            ''', batch)
            for alias, canonical_id in cur.fetchall():
                if alias not in mapping:
                    mapping[alias] = {
                        'canonical_gene_id': canonical_id,
                        'match_method': 'alias',
                        'match_status': 'mapped'
                    }

    # Mark unmapped
    unmapped = source_gene_ids - set(mapping.keys())
    for gene_id in unmapped:
        mapping[gene_id] = {
            'canonical_gene_id': None,
            'match_method': 'unmapped',
            'match_status': 'unmapped'
        }

    return mapping


def run_import(data_dir: str, dry_run: bool = False):
    """Main import function."""
    print('=' * 70)
    print('Update Data Import - Expression Tables Replacement')
    print('=' * 70)
    print(f'Data directory: {data_dir}')
    print(f'Dry run: {dry_run}')
    print()

    # Define file paths
    files = {
        'tpm': os.path.join(data_dir, 'gene_TPM_matrix.tsv'),
        'fpkm': os.path.join(data_dir, 'gene_FPKM_matrix.tsv'),
        'normcount': os.path.join(data_dir, 'day_DESeq2_normalized_counts.tsv'),
        'raw_count': os.path.join(data_dir, 'day_gene_count_matrix.tsv'),
    }

    # Verify files exist
    for metric, filepath in files.items():
        if not os.path.exists(filepath):
            print(f'Error: File not found: {filepath}', file=sys.stderr)
            sys.exit(1)

    # Step 1: Load all matrix files
    print('Step 1: Loading matrix files...')
    all_records = []
    for metric, filepath in files.items():
        records = load_matrix_file(filepath, metric)
        all_records.extend(records)

    # Get unique gene_ids
    source_gene_ids = {r[0] for r in all_records}
    print(f'  Total records: {len(all_records):,}')
    print(f'  Unique gene_ids: {len(source_gene_ids):,}')
    print()

    if dry_run:
        print('[DRY RUN] Would import the following:')
        print(f'  TPM records: {sum(1 for r in all_records if r[4] == "tpm"):,}')
        print(f'  FPKM records: {sum(1 for r in all_records if r[4] == "fpkm"):,}')
        print(f'  normcount records: {sum(1 for r in all_records if r[4] == "normcount"):,}')
        print(f'  raw_count records: {sum(1 for r in all_records if r[4] == "raw_count"):,}')
        return

    # Connect to PostgreSQL
    pg_dsn = os.environ.get('GRCG6A_PG_DSN', 'postgresql://grcuser:grcpassword@127.0.0.1:5433/grcg6a')
    conn = psycopg2.connect(pg_dsn)
    cur = conn.cursor()

    try:
        # Step 2: Build gene_id mapping
        print('Step 2: Building gene_id mapping...')
        mapping = build_gene_mapping(cur, source_gene_ids)

        mapped_count = sum(1 for m in mapping.values() if m['match_status'] == 'mapped')
        unmapped_count = sum(1 for m in mapping.values() if m['match_status'] == 'unmapped')
        print(f'  Mapped: {mapped_count:,}')
        print(f'  Unmapped: {unmapped_count:,}')
        print()

        # Step 3: Truncate expression tables (in correct order for foreign keys)
        print('Step 3: Truncating expression tables...')
        cur.execute('DELETE FROM gene_expression_summary')
        cur.execute('DELETE FROM expression_fact')
        cur.execute('DELETE FROM dataset_sample')
        cur.execute('DELETE FROM expression_sample')
        cur.execute('DELETE FROM gene_expression')
        conn.commit()
        print('  Truncated expression tables')
        print()

        # Step 4: Insert expression_sample (36 samples)
        print('Step 4: Inserting expression_sample...')
        samples = []
        for stage_raw, stage in STAGE_MAP.items():
            for sex in ['Female', 'Male']:
                for rep in range(1, 4):
                    sample_name = f'{stage_raw}_{sex}{rep}'
                    samples.append((
                        sample_name, stage, STAGE_LABEL[stage],
                        STAGE_ORDER[stage], sex, rep
                    ))

        execute_values(cur, '''
            INSERT INTO expression_sample (sample_name, stage, stage_label, stage_order, sex, replicate)
            VALUES %s
        ''', samples, page_size=50)

        # Get the inserted IDs
        cur.execute('SELECT id, sample_name FROM expression_sample ORDER BY id')
        sample_id_map = {name: sid for sid, name in cur.fetchall()}
        conn.commit()
        print(f'  Inserted {len(samples)} expression samples')
        print()

        # Step 5: Update dataset table
        print('Step 5: Updating dataset table...')

        # Check if day_featurecounts_36 exists
        cur.execute("SELECT dataset_id FROM dataset WHERE dataset_code = 'day_featurecounts_36'")
        if not cur.fetchone():
            cur.execute('''
                INSERT INTO dataset (dataset_code, dataset_name, sample_scope, normalization_family,
                    description, source_file, metric_codes, row_count)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ''', (
                'day_featurecounts_36',
                'featureCounts Raw Count - 36 developmental stage samples',
                'developmental_36',
                'raw_count',
                'Raw read counts from featureCounts - 36 developmental stage samples',
                'day_gene_count_matrix.tsv',
                ['raw_count'],
                len(source_gene_ids)
            ))

        # Update existing datasets
        cur.execute('''
            UPDATE dataset
            SET source_file = 'gene_TPM_matrix.tsv;gene_FPKM_matrix.tsv',
                row_count = %s,
                metric_codes = ARRAY['tpm', 'fpkm'],
                description = 'Ballgown TPM/FPKM - 36 developmental stage samples (updated 2026-05-18)'
            WHERE dataset_code = 'raw_ballgown_36'
        ''', (len(source_gene_ids),))

        cur.execute('''
            UPDATE dataset
            SET source_file = 'day_DESeq2_normalized_counts.tsv',
                row_count = %s,
                metric_codes = ARRAY['normcount'],
                description = 'DESeq2 Normalized Count - 36 developmental stage samples (updated 2026-05-18)'
            WHERE dataset_code = 'day_deseq2_36'
        ''', (len(source_gene_ids),))

        conn.commit()
        print('  Updated dataset table')
        print()

        # Step 6: Rebuild dataset_sample
        print('Step 6: Rebuilding dataset_sample...')

        # Get dataset IDs
        cur.execute('SELECT dataset_id, dataset_code FROM dataset')
        dataset_ids = {code: did for did, code in cur.fetchall()}

        dataset_samples = []
        for dataset_code, dataset_id in dataset_ids.items():
            for sample_name, sample_id in sample_id_map.items():
                stage, sex, rep = parse_sample_col(sample_name)
                dataset_samples.append((
                    dataset_id, sample_id, sample_name,
                    stage, sex, rep, STAGE_ORDER[stage],
                    sample_name,  # tpm_col
                    sample_name,  # fpkm_col
                    sample_name,  # nc_col
                    sample_name,  # raw_col
                ))

        execute_values(cur, '''
            INSERT INTO dataset_sample (dataset_id, biosample_id, sample_name, stage, sex, replicate,
                stage_order, tpm_col, fpkm_col, nc_col, raw_col)
            VALUES %s
        ''', dataset_samples, page_size=200)
        conn.commit()
        print(f'  Inserted {len(dataset_samples)} dataset samples')
        print()

        # Step 7: Build dataset_sample mapping
        print('Step 7: Building dataset_sample mapping...')
        cur.execute('''
            SELECT ds.dataset_sample_id, d.dataset_code, es.sample_name
            FROM dataset_sample ds
            JOIN dataset d ON d.dataset_id = ds.dataset_id
            JOIN expression_sample es ON es.id = ds.biosample_id
        ''')
        ds_map = {}
        for dsid, dcode, sname in cur.fetchall():
            ds_map[(dcode, sname)] = dsid
        print(f'  Mapped {len(ds_map)} dataset_sample combinations')
        print()

        # Step 8: Rebuild expression_fact
        print('Step 8: Rebuilding expression_fact...')

        # Build expression_fact data
        fact_data = []
        skipped_unmapped = 0
        skipped_nomap = 0

        for gene_id, stage, sex, rep, metric, value in all_records:
            # Get canonical gene_id
            m = mapping.get(gene_id)
            if not m or m['match_status'] != 'mapped':
                skipped_unmapped += 1
                continue

            canonical_gene_id = m['canonical_gene_id']

            # Build sample_name (e.g., 'E3_5_Female1')
            stage_raw = stage.replace('.', '_')
            sample_name = f'{stage_raw}_{sex}{rep}'

            # Determine dataset_code
            if metric in ('tpm', 'fpkm'):
                dataset_code = 'raw_ballgown_36'
            elif metric == 'normcount':
                dataset_code = 'day_deseq2_36'
            elif metric == 'raw_count':
                dataset_code = 'day_featurecounts_36'
            else:
                continue

            dsid = ds_map.get((dataset_code, sample_name))
            if dsid:
                fact_data.append((canonical_gene_id, dsid, metric, value))
            else:
                skipped_nomap += 1

        print(f'  Prepared {len(fact_data):,} expression_fact records')
        print(f'  Skipped (unmapped gene): {skipped_unmapped:,}')
        print(f'  Skipped (no dataset_sample): {skipped_nomap:,}')

        # Batch insert
        batch_size = 100000
        for i in range(0, len(fact_data), batch_size):
            batch = fact_data[i:i+batch_size]
            execute_values(cur, '''
                INSERT INTO expression_fact (gene_id, dataset_sample_id, metric_code, value, updated_at)
                VALUES %s
            ''', [(g, ds, m, v, datetime.now()) for g, ds, m, v in batch], page_size=batch_size)
            conn.commit()
            print(f'  Inserted {min(i+batch_size, len(fact_data)):,} / {len(fact_data):,}', end='\r')
        print()
        print()

        # Step 9: Rebuild gene_expression_summary
        print('Step 9: Rebuilding gene_expression_summary...')

        cur.execute('''
            INSERT INTO gene_expression_summary (
                gene_id, dataset_code, metric_code, sample_count,
                mean_value, max_value, min_value, std_value, cv,
                expressed_samples, zero_samples,
                top_sample, top_stage,
                sex_bias_label, sex_bias_ratio,
                fold_change_top, fold_change_bottom,
                stage_means, stage_sample_count, updated_at
            )
            SELECT
                ef.gene_id,
                d.dataset_code,
                ef.metric_code,
                COUNT(*) as sample_count,
                AVG(ef.value) as mean_value,
                MAX(ef.value) as max_value,
                MIN(ef.value) as min_value,
                COALESCE(STDDEV(ef.value), 0) as std_value,
                CASE WHEN AVG(ef.value) > 0
                     THEN COALESCE(STDDEV(ef.value), 0) / AVG(ef.value)
                     ELSE 0 END as cv,
                COUNT(CASE WHEN ef.value > 0 THEN 1 END) as expressed_samples,
                COUNT(CASE WHEN ef.value = 0 THEN 1 END) as zero_samples,
                NULL as top_sample,
                NULL as top_stage,
                NULL as sex_bias_label,
                NULL as sex_bias_ratio,
                NULL as fold_change_top,
                NULL as fold_change_bottom,
                NULL as stage_means,
                NULL as stage_sample_count,
                NOW()
            FROM expression_fact ef
            JOIN dataset_sample ds ON ds.dataset_sample_id = ef.dataset_sample_id
            JOIN dataset d ON d.dataset_id = ds.dataset_id
            GROUP BY ef.gene_id, d.dataset_code, ef.metric_code
        ''')
        conn.commit()

        cur.execute('SELECT COUNT(*) FROM gene_expression_summary')
        summary_count = cur.fetchone()[0]
        print(f'  Inserted {summary_count:,} summary records')
        print()

        # Step 10: Update gene_alias
        print('Step 10: Updating gene_alias...')
        alias_count = 0
        for src, m in mapping.items():
            if m['match_status'] != 'mapped':
                continue
            canonical = m['canonical_gene_id']
            if src == canonical:
                continue

            # Check if alias already exists
            cur.execute('''
                SELECT 1 FROM gene_alias
                WHERE canonical_id = %s AND alias = %s
            ''', (canonical, src))
            if cur.fetchone():
                continue

            cur.execute('''
                INSERT INTO gene_alias (canonical_id, alias, alias_type, source_dataset, updated_at)
                VALUES (%s, %s, %s, %s, %s)
            ''', (canonical, src, 'symbol', 'update_data_20260518', datetime.now()))
            alias_count += 1

        conn.commit()
        print(f'  Inserted {alias_count} new aliases')
        print()

        # Step 11: Record unmapped_feature
        print('Step 11: Recording unmapped features...')
        unmapped_inserted = 0
        for src, m in mapping.items():
            if m['match_status'] != 'unmapped':
                continue

            cur.execute('''
                INSERT INTO unmapped_feature (feature_name, feature_type, source_dataset, gene_id_guess, updated_at)
                VALUES (%s, %s, %s, %s, %s)
            ''', (src, 'gene', 'update_data_20260518', None, datetime.now()))
            unmapped_inserted += 1

        conn.commit()
        print(f'  Inserted {unmapped_inserted} unmapped features')
        print()

        # Final statistics
        print('=' * 70)
        print('Import Complete - Final Statistics')
        print('=' * 70)

        cur.execute('SELECT COUNT(*) FROM expression_fact')
        print(f'  expression_fact: {cur.fetchone()[0]:,}')

        cur.execute('SELECT COUNT(DISTINCT gene_id) FROM expression_fact')
        print(f'  Unique genes in expression: {cur.fetchone()[0]:,}')

        cur.execute("SELECT COUNT(*) FROM expression_fact WHERE metric_code = 'tpm'")
        print(f'  TPM rows: {cur.fetchone()[0]:,}')

        cur.execute("SELECT COUNT(*) FROM expression_fact WHERE metric_code = 'fpkm'")
        print(f'  FPKM rows: {cur.fetchone()[0]:,}')

        cur.execute("SELECT COUNT(*) FROM expression_fact WHERE metric_code = 'normcount'")
        print(f'  normcount rows: {cur.fetchone()[0]:,}')

        cur.execute("SELECT COUNT(*) FROM expression_fact WHERE metric_code = 'raw_count'")
        print(f'  raw_count rows: {cur.fetchone()[0]:,}')

        cur.execute('SELECT COUNT(*) FROM expression_sample')
        print(f'  expression_sample: {cur.fetchone()[0]}')

        cur.execute('SELECT COUNT(*) FROM dataset_sample')
        print(f'  dataset_sample: {cur.fetchone()[0]}')

        cur.execute('SELECT COUNT(*) FROM dataset')
        print(f'  dataset: {cur.fetchone()[0]}')

        cur.execute("SELECT COUNT(*) FROM gene_alias WHERE source_dataset = 'update_data_20260518'")
        print(f'  New aliases: {cur.fetchone()[0]}')

        cur.execute("SELECT COUNT(*) FROM unmapped_feature WHERE source_dataset = 'update_data_20260518'")
        print(f'  Unmapped features: {cur.fetchone()[0]}')

        # Verify GO/KEGG preserved
        cur.execute('SELECT COUNT(DISTINCT gene_id) FROM gene_go')
        print(f'  GO genes (should be ~14,835): {cur.fetchone()[0]:,}')

        cur.execute('SELECT COUNT(DISTINCT gene_id) FROM gene_kegg')
        print(f'  KEGG genes (should be ~23,640): {cur.fetchone()[0]:,}')

    except Exception as e:
        conn.rollback()
        print(f'Error: {e}', file=sys.stderr)
        import traceback
        traceback.print_exc()
        raise
    finally:
        cur.close()
        conn.close()


def main():
    parser = argparse.ArgumentParser(description='Import expression data from update data directory')
    parser.add_argument('--data-dir', required=True, help='Path to update data directory')
    parser.add_argument('--dry-run', action='store_true', help='Validate only, no DB changes')
    args = parser.parse_args()

    if not os.path.exists(args.data_dir):
        print(f'Error: Data directory not found: {args.data_dir}', file=sys.stderr)
        sys.exit(1)

    run_import(args.data_dir, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
