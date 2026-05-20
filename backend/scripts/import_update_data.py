#!/usr/bin/env python3
"""
Import expression data from update data directory into PostgreSQL.

Three-layer architecture:
  Layer 1 (Staging):  100% raw data in staging tables — no loss
  Layer 2 (Mapping):  Full audit trail in gene_source_mapping — every source gene_id tracked
  Layer 3 (Curated):  Only mapped data in expression_fact — product-ready

All 8 files in the update data directory are staged.

Usage:
    python import_update_data.py --data-dir "D:/jbrowsedata/projectdata/update data" [--dry-run]
"""

import argparse
import csv
import hashlib
import json
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

STAGE_ORDER = {
    'E0': 1, 'E3.5': 2, 'E4.5': 3, 'E5.5': 4, 'E6.5': 5, 'E18.5': 6,
}

STAGE_LABEL = {
    'E0': 'Stage 0', 'E3.5': 'Stage 3.5', 'E4.5': 'Stage 4.5',
    'E5.5': 'Stage 5.5', 'E6.5': 'Stage 6.5', 'E18.5': 'Stage 18.5',
}

MATRIX_FILES = {
    'tpm': 'gene_TPM_matrix.tsv',
    'fpkm': 'gene_FPKM_matrix.tsv',
    'normcount': 'day_DESeq2_normalized_counts.tsv',
    'raw_count': 'day_gene_count_matrix.tsv',
}

NON_MATRIX_FILES = {
    'gene_annotation': 'day_gene_annotation.tsv',
    'featurecounts_raw': 'day_featureCounts.txt',
    'featurecounts_summary': 'day_featureCounts.txt.summary',
    'master_expression': 'day_master_expression_table.tsv',
}

ALL_FILES = {**MATRIX_FILES, **NON_MATRIX_FILES}

DATASET_MAP = {
    'tpm': 'raw_ballgown_36',
    'fpkm': 'raw_ballgown_36',
    'normcount': 'day_deseq2_36',
    'raw_count': 'day_featurecounts_36',
}

# Mapping status enum
STATUS_MAPPED_EXACT = 'mapped_exact_symbol'
STATUS_MAPPED_DISPLAY = 'mapped_display_symbol'
STATUS_MAPPED_ALIAS = 'mapped_alias'
STATUS_AMBIGUOUS = 'ambiguous_symbol'
STATUS_UNMAPPED = 'unmapped'
STATUS_INVALID = 'invalid_source_id'


def parse_sample_col(col_name: str) -> tuple[str, str, int]:
    """Parse 'E0_Female1' -> ('E0', 'Female', 1)"""
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


def file_hash(filepath: str) -> str:
    """Compute SHA256 hash of a file."""
    h = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            h.update(chunk)
    return h.hexdigest()


def normalize_gene_id(raw: str) -> tuple[str, bool, str]:
    """Normalize source gene_id. Returns (normalized, is_valid, invalid_reason)."""
    s = raw.strip()
    if not s:
        return '.', False, 'empty_gene_id'
    if s == '.':
        return '.', False, 'dot_gene_id'
    if s.startswith('#'):
        return '.', False, 'comment_gene_id'
    return s, True, None


def load_matrix_file(filepath: str, metric_code: str) -> tuple[list, list]:
    """
    Load matrix TSV. Returns (records, invalid_rows).
    records: list of (source_gene_id_raw, source_gene_id, sample_name, raw_value_text, value_numeric, source_row_number)
    invalid_rows: list of (source_gene_id_raw, source_gene_id, sample_name, raw_value_text, reason)
    """
    records = []
    invalid_rows = []

    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter='\t')
        header = next(reader)
        sample_cols = header[1:]

        for line_num, row in enumerate(reader, 2):
            raw_gene_id = row[0] if row else ''
            source_gene_id, is_valid, reason = normalize_gene_id(raw_gene_id)

            if not is_valid:
                for i, col in enumerate(sample_cols, 1):
                    raw_val = row[i] if i < len(row) else ''
                    invalid_rows.append((raw_gene_id, source_gene_id, col, raw_val, reason))
                continue

            for i, col in enumerate(sample_cols, 1):
                raw_val = row[i] if i < len(row) else ''

                try:
                    if raw_val == '' or raw_val == 'NA':
                        value = 0.0
                    else:
                        value = float(raw_val)
                except (ValueError, TypeError):
                    invalid_rows.append((raw_gene_id, source_gene_id, col, raw_val, 'non_numeric_value'))
                    continue

                records.append((raw_gene_id, source_gene_id, col, raw_val, value, line_num))

    return records, invalid_rows


def load_gene_annotation(filepath: str) -> list:
    """
    Load day_gene_annotation.tsv. Returns list of tuples:
    (source_gene_id_raw, source_gene_id, row_num, chr, start, end, strand, length, raw_line, is_valid, invalid_reason)
    """
    rows = []
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter='\t')
        header = next(reader)  # gene_id, chr, start, end, strand, length

        for line_num, row in enumerate(reader, 2):
            raw_gene_id = row[0] if row else ''
            gene_id, is_valid, reason = normalize_gene_id(raw_gene_id)
            raw_line = '\t'.join(row)

            gene_length = None
            if len(row) >= 6:
                try:
                    gene_length = int(row[5])
                except (ValueError, TypeError):
                    pass

            rows.append((
                raw_gene_id, gene_id, line_num,
                row[1] if len(row) > 1 else None,
                row[2] if len(row) > 2 else None,
                row[3] if len(row) > 3 else None,
                row[4] if len(row) > 4 else None,
                gene_length, raw_line, is_valid, reason,
            ))

    return rows


def load_featurecounts_raw(filepath: str) -> tuple[list, list, list]:
    """
    Load day_featureCounts.txt (2 header lines).
    Returns (sample_names, records, invalid_rows).
    records: list of (gene_id, row_num, chr, start, end, strand, length,
                      sample_name, sample_column_raw, raw_count_text, raw_count_value, raw_line)
    """
    records = []
    invalid_rows = []
    sample_column_raw_names = []

    with open(filepath, 'r', encoding='utf-8') as f:
        # Skip comment line (line 1)
        comment_line = f.readline()

        # Read header (line 2)
        reader = csv.reader(f, delimiter='\t')
        header = next(reader)
        # header: Geneid, Chr, Start, End, Strand, Length, sample1.bam, sample2.bam, ...
        sample_names = []
        for col in header[6:]:
            basename = os.path.basename(col)
            sample_name = basename.replace('.bam', '')
            sample_names.append(sample_name)
            sample_column_raw_names.append(col)  # preserve original column name

        for line_num, row in enumerate(reader, 3):
            if len(row) < 7:
                continue
            raw_line = '\t'.join(row)
            gene_id = row[0].strip()
            chr_val = row[1]
            start_val = row[2]
            end_val = row[3]
            strand_val = row[4]
            length_val = None
            try:
                length_val = int(row[5])
            except (ValueError, TypeError):
                pass

            for i, sample_name in enumerate(sample_names):
                col_idx = 6 + i
                raw_val = row[col_idx] if col_idx < len(row) else ''
                count_val = None
                try:
                    count_val = int(raw_val)
                except (ValueError, TypeError):
                    invalid_rows.append((gene_id, sample_name, raw_val, 'non_integer_count'))
                    continue

                records.append((
                    gene_id, line_num, chr_val, start_val, end_val, strand_val, length_val,
                    sample_name, sample_column_raw_names[i], raw_val, count_val, raw_line,
                ))

    return sample_names, records, invalid_rows


def load_featurecounts_summary(filepath: str) -> list:
    """
    Load day_featureCounts.txt.summary. Returns list of (status, sample_values_dict, raw_line).
    """
    rows = []
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter='\t')
        header = next(reader)
        sample_names = []
        for col in header[1:]:
            basename = os.path.basename(col)
            sample_name = basename.replace('.bam', '')
            sample_names.append(sample_name)

        for row in reader:
            if not row:
                continue
            raw_line = '\t'.join(row)
            status = row[0].strip()
            values = {}
            for i, sample_name in enumerate(sample_names):
                col_idx = 1 + i
                val = row[col_idx] if col_idx < len(row) else '0'
                values[sample_name] = val
            rows.append((status, values, raw_line))

    return rows


def load_master_expression(filepath: str) -> list:
    """
    Load day_master_expression_table.tsv (wide format: gene_id, gene_name, all sample cols).
    Returns list of (raw_gene_id, gene_id, line_num, gene_name, values_dict, raw_line, is_valid, invalid_reason).
    """
    rows = []
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter='\t')
        header = next(reader)

        for line_num, row in enumerate(reader, 2):
            raw_gene_id = row[0] if row else ''
            gene_id, is_valid, reason = normalize_gene_id(raw_gene_id)
            gene_name = row[1] if len(row) > 1 else ''
            raw_line = '\t'.join(row)

            values = {}
            for i, col in enumerate(header[2:], 2):
                if i < len(row):
                    values[col] = row[i]
            rows.append((raw_gene_id, gene_id, line_num, gene_name, values, raw_line, is_valid, reason))

    return rows


def build_gene_mapping(cur, source_gene_ids: set[str]) -> dict[str, dict]:
    """
    Build mapping with full audit trail.
    Returns dict: source_gene_id -> {canonical_gene_id, status, method, confidence, ambiguity_count, reason}
    """
    mapping = {}

    # Method 1: gene_symbol exact match (check for ambiguity)
    id_list = sorted(source_gene_ids)
    for i in range(0, len(id_list), 1000):
        batch = id_list[i:i+1000]
        placeholders = ','.join(['%s'] * len(batch))
        cur.execute(f'''
            SELECT gene_symbol, gene_id
            FROM gene_xref
            WHERE gene_symbol IN ({placeholders})
        ''', batch)
        symbol_matches: dict[str, list[str]] = {}
        for symbol, gene_id in cur.fetchall():
            symbol_matches.setdefault(symbol, []).append(gene_id)

        for symbol, gene_ids in symbol_matches.items():
            if len(gene_ids) == 1:
                mapping[symbol] = {
                    'canonical_gene_id': gene_ids[0],
                    'status': STATUS_MAPPED_EXACT,
                    'method': 'gene_symbol',
                    'confidence': 1.0,
                    'ambiguity_count': 1,
                    'reason': None,
                }
            else:
                mapping[symbol] = {
                    'canonical_gene_id': gene_ids[0],
                    'status': STATUS_AMBIGUOUS,
                    'method': 'gene_symbol',
                    'confidence': 0.5,
                    'ambiguity_count': len(gene_ids),
                    'reason': f'multiple_genes: {",".join(gene_ids)}',
                    'ambiguity_details': gene_ids,
                }

    # Method 2: display_symbol (for still-unmapped)
    unmapped = source_gene_ids - set(mapping.keys())
    if unmapped:
        id_list = sorted(unmapped)
        for i in range(0, len(id_list), 1000):
            batch = id_list[i:i+1000]
            placeholders = ','.join(['%s'] * len(batch))
            cur.execute(f'''
                SELECT display_symbol, gene_id
                FROM gene_xref
                WHERE display_symbol IN ({placeholders})
            ''', batch)
            symbol_matches: dict[str, list[str]] = {}
            for symbol, gene_id in cur.fetchall():
                symbol_matches.setdefault(symbol, []).append(gene_id)

            for symbol, gene_ids in symbol_matches.items():
                if symbol in mapping:
                    continue
                if len(gene_ids) == 1:
                    mapping[symbol] = {
                        'canonical_gene_id': gene_ids[0],
                        'status': STATUS_MAPPED_DISPLAY,
                        'method': 'display_symbol',
                        'confidence': 0.9,
                        'ambiguity_count': 1,
                        'reason': None,
                    }
                else:
                    mapping[symbol] = {
                        'canonical_gene_id': gene_ids[0],
                        'status': STATUS_AMBIGUOUS,
                        'method': 'display_symbol',
                        'confidence': 0.4,
                        'ambiguity_count': len(gene_ids),
                        'reason': f'multiple_genes: {",".join(gene_ids)}',
                        'ambiguity_details': gene_ids,
                    }

    # Method 3: gene_alias (for still-unmapped)
    unmapped = source_gene_ids - set(mapping.keys())
    if unmapped:
        id_list = sorted(unmapped)
        for i in range(0, len(id_list), 1000):
            batch = id_list[i:i+1000]
            placeholders = ','.join(['%s'] * len(batch))
            cur.execute(f'''
                SELECT alias, canonical_id
                FROM gene_alias
                WHERE alias IN ({placeholders})
            ''', batch)
            for alias, canonical_id in cur.fetchall():
                if alias in mapping:
                    continue
                mapping[alias] = {
                    'canonical_gene_id': canonical_id,
                    'status': STATUS_MAPPED_ALIAS,
                    'method': 'gene_alias',
                    'confidence': 0.8,
                    'ambiguity_count': 1,
                    'reason': None,
                }

    # Mark remaining as unmapped
    unmapped = source_gene_ids - set(mapping.keys())
    for gene_id in unmapped:
        mapping[gene_id] = {
            'canonical_gene_id': None,
            'status': STATUS_UNMAPPED,
            'method': 'none',
            'confidence': 0.0,
            'ambiguity_count': 0,
            'reason': 'no_match_found',
        }

    return mapping


def record_qc(cur, batch_id: int, file_name: str, file_hash_val: str,
              qc_type: str, qc_name: str, expected: str, actual: str,
              passed: bool, details: dict = None):
    """Insert a QC result row."""
    cur.execute('''
        INSERT INTO import_qc_result
            (batch_id, file_name, file_hash, qc_type, qc_name,
             expected_value, actual_value, passed, details)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
    ''', (
        batch_id, file_name, file_hash_val, qc_type, qc_name,
        expected, actual, passed,
        json.dumps(details) if details else None,
    ))


def run_import(data_dir: str, dry_run: bool = False):
    """Main import function with 3-layer architecture."""
    print('=' * 70)
    print('Update Data Import — 3-Layer Architecture (All 8 Files)')
    print('=' * 70)
    print(f'Data directory: {data_dir}')
    print(f'Dry run: {dry_run}')
    print()

    # Compute file hashes for ALL files
    file_hashes = {}
    for key, filename in ALL_FILES.items():
        filepath = os.path.join(data_dir, filename)
        if not os.path.exists(filepath):
            print(f'Error: File not found: {filepath}', file=sys.stderr)
            sys.exit(1)
        file_hashes[filename] = file_hash(filepath)

    # ──────────────────────────────────────────────────────────────────────────
    # Layer 1: Load ALL raw data (staging)
    # ──────────────────────────────────────────────────────────────────────────
    print('Layer 1: Loading raw matrix data (staging)...')
    all_records = []
    all_invalid = []
    source_gene_ids = set()
    per_metric_gene_ids = {}

    for metric, filename in MATRIX_FILES.items():
        filepath = os.path.join(data_dir, filename)
        records, invalid = load_matrix_file(filepath, metric)
        metric_genes = set()
        for r in records:
            all_records.append((*r, metric, filename))
            source_gene_ids.add(r[1])
            metric_genes.add(r[1])
        for inv in invalid:
            all_invalid.append((*inv, metric, filename))
        per_metric_gene_ids[metric] = metric_genes
        print(f'  {metric}: {len(records):,} valid, {len(invalid):,} invalid, {len(metric_genes):,} genes')

    print(f'  Total valid records: {len(all_records):,}')
    print(f'  Total invalid rows: {len(all_invalid):,}')
    print(f'  Unique source gene_ids (union): {len(source_gene_ids):,}')
    print()

    # Count per metric
    metric_counts = {}
    for r in all_records:
        m = r[6]
        metric_counts[m] = metric_counts.get(m, 0) + 1

    if dry_run:
        print('[DRY RUN] Would import:')
        print(f'  Matrix staging rows: {len(all_records) + len(all_invalid):,}')
        print(f'  Source genes (union): {len(source_gene_ids):,}')
        for m, genes in sorted(per_metric_gene_ids.items()):
            print(f'  {m}: {len(genes):,} genes')
        print(f'  Matrix files: {len(MATRIX_FILES)}')
        print(f'  Non-matrix files: {len(NON_MATRIX_FILES)}')
        return

    # Connect to PostgreSQL
    pg_dsn = os.environ.get('GRCG6A_PG_DSN', 'postgresql://grcuser:grcpassword@127.0.0.1:5433/grcg6a')
    conn = psycopg2.connect(pg_dsn)
    cur = conn.cursor()

    try:
        # Create import_batch
        print('Creating import batch record...')
        cur.execute('''
            INSERT INTO import_batch (data_dir, files_imported, file_hashes, status, import_script)
            VALUES (%s, %s, %s::jsonb, 'running', %s)
            RETURNING batch_id
        ''', (
            data_dir,
            list(ALL_FILES.values()),
            json.dumps(file_hashes),
            os.path.basename(__file__),
        ))
        batch_id = cur.fetchone()[0]
        conn.commit()
        print(f'  batch_id: {batch_id}')
        print()

        matrix_staging_rows = 0

        # ──────────────────────────────────────────────────────────────────────
        # Layer 1a: Write matrix staging (100% raw, no loss)
        # ──────────────────────────────────────────────────────────────────────
        print('Layer 1a: Writing matrix staging table (100% raw data)...')

        staging_data = []
        for source_gene_id_raw, source_gene_id, sample_name, raw_text, value, row_num, metric, source_file in all_records:
            staging_data.append((
                batch_id, source_file, metric, source_gene_id_raw, source_gene_id,
                row_num, sample_name, raw_text, value, True, None,
            ))

        for source_gene_id_raw, source_gene_id, sample_name, raw_text, reason, metric, source_file in all_invalid:
            staging_data.append((
                batch_id, source_file, metric, source_gene_id_raw, source_gene_id,
                None, sample_name, raw_text, None, False, reason,
            ))

        matrix_staging_rows = len(staging_data)

        staging_batch_size = 100000
        for i in range(0, len(staging_data), staging_batch_size):
            batch = staging_data[i:i+staging_batch_size]
            execute_values(cur, '''
                INSERT INTO stg_update_expression_matrix
                    (batch_id, source_file, source_metric, source_gene_id_raw, source_gene_id,
                     source_row_number, sample_name, raw_value_text, value_numeric, is_valid, invalid_reason)
                VALUES %s
            ''', batch, page_size=staging_batch_size)
            conn.commit()
            print(f'  Staged {min(i+staging_batch_size, len(staging_data)):,} / {len(staging_data):,}', end='\r')
        print()
        print(f'  Total matrix staging rows: {matrix_staging_rows:,}')
        print()

        # ──────────────────────────────────────────────────────────────────────
        # Layer 1b: Stage gene annotation file (raw/normalized/valid)
        # ──────────────────────────────────────────────────────────────────────
        print('Layer 1b: Staging gene annotation file...')
        filepath = os.path.join(data_dir, NON_MATRIX_FILES['gene_annotation'])
        gene_annot_rows = load_gene_annotation(filepath)
        annot_data = [
            (batch_id, NON_MATRIX_FILES['gene_annotation'],
             r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10])
            for r in gene_annot_rows
        ]
        execute_values(cur, '''
            INSERT INTO stg_update_gene_annotation
                (batch_id, source_file, source_gene_id_raw, source_gene_id, source_row_number,
                 chromosome, start_pos, end_pos, strand, gene_length, raw_line, is_valid, invalid_reason)
            VALUES %s
        ''', annot_data, page_size=10000)
        conn.commit()
        print(f'  Staged {len(annot_data):,} gene annotation rows')
        print()

        # ──────────────────────────────────────────────────────────────────────
        # Layer 1c: Stage featureCounts raw file (with raw_line and sample_column_raw)
        # ──────────────────────────────────────────────────────────────────────
        print('Layer 1c: Staging featureCounts raw file...')
        filepath = os.path.join(data_dir, NON_MATRIX_FILES['featurecounts_raw'])
        fc_sample_names, fc_records, fc_invalid = load_featurecounts_raw(filepath)
        fc_data = [
            (batch_id, NON_MATRIX_FILES['featurecounts_raw'], r[0], r[1], r[2], r[3], r[4], r[5], r[6],
             r[7], r[8], r[9], r[10], r[11], True, None)
            for r in fc_records
        ]
        # Add invalid rows
        for gene_id, sample, raw, reason in fc_invalid:
            fc_data.append((
                batch_id, NON_MATRIX_FILES['featurecounts_raw'], gene_id, None,
                None, None, None, None, None,
                sample, None, raw, None, None, False, reason,
            ))

        for i in range(0, len(fc_data), 100000):
            batch = fc_data[i:i+100000]
            execute_values(cur, '''
                INSERT INTO stg_featurecounts_raw
                    (batch_id, source_file, source_gene_id, source_row_number,
                     chromosome, start_pos, end_pos, strand, gene_length,
                     sample_name, sample_column_raw, raw_count_text, raw_count_value, raw_line,
                     is_valid, invalid_reason)
                VALUES %s
            ''', batch, page_size=100000)
            conn.commit()
            print(f'  Staged {min(i+100000, len(fc_data)):,} / {len(fc_data):,}', end='\r')
        print()
        print(f'  Total featureCounts raw rows: {len(fc_data):,}')
        print()

        # ──────────────────────────────────────────────────────────────────────
        # Layer 1d: Stage featureCounts summary file (with raw_line)
        # ──────────────────────────────────────────────────────────────────────
        print('Layer 1d: Staging featureCounts summary file...')
        filepath = os.path.join(data_dir, NON_MATRIX_FILES['featurecounts_summary'])
        fc_summary_rows = load_featurecounts_summary(filepath)
        summary_data = [
            (batch_id, NON_MATRIX_FILES['featurecounts_summary'], status, json.dumps(values), raw_line)
            for status, values, raw_line in fc_summary_rows
        ]
        execute_values(cur, '''
            INSERT INTO stg_featurecounts_summary
                (batch_id, source_file, status_category, sample_values, raw_line)
            VALUES %s
        ''', summary_data, page_size=50)
        conn.commit()
        print(f'  Staged {len(summary_data):,} featureCounts summary rows')
        print()

        # ──────────────────────────────────────────────────────────────────────
        # Layer 1e: Stage master expression table (raw/normalized/valid/raw_line)
        # ──────────────────────────────────────────────────────────────────────
        print('Layer 1e: Staging master expression table...')
        filepath = os.path.join(data_dir, NON_MATRIX_FILES['master_expression'])
        master_rows = load_master_expression(filepath)
        master_data = [
            (batch_id, NON_MATRIX_FILES['master_expression'],
             r[0], r[1], r[2], r[3], json.dumps(r[4]), r[5], r[6], r[7])
            for r in master_rows
        ]
        for i in range(0, len(master_data), 10000):
            batch = master_data[i:i+10000]
            execute_values(cur, '''
                INSERT INTO stg_master_expression_table
                    (batch_id, source_file, source_gene_id_raw, source_gene_id, source_row_number,
                     gene_name, raw_values, raw_line, is_valid, invalid_reason)
                VALUES %s
            ''', batch, page_size=10000)
            conn.commit()
            print(f'  Staged {min(i+10000, len(master_data)):,} / {len(master_data):,}', end='\r')
        print()
        print(f'  Total master expression rows: {len(master_data):,}')
        print()

        # Compute total staging rows across ALL tables
        total_staging_all = (matrix_staging_rows + len(annot_data) + len(fc_data)
                             + len(summary_data) + len(master_data))
        print(f'  Total staging rows (all files): {total_staging_all:,}')
        print()

        # ──────────────────────────────────────────────────────────────────────
        # Layer 2: Build gene mapping with full audit (per-metric)
        # ──────────────────────────────────────────────────────────────────────
        print('Layer 2: Building gene mapping (audit trail)...')
        mapping = build_gene_mapping(cur, source_gene_ids)

        # Count by status
        status_counts = {}
        for m in mapping.values():
            s = m['status']
            status_counts[s] = status_counts.get(s, 0) + 1

        for status, count in sorted(status_counts.items()):
            print(f'  {status}: {count:,}')

        mapped_count = sum(1 for m in mapping.values() if 'mapped' in m['status'] and 'unmapped' not in m['status'])
        unmapped_count = sum(1 for m in mapping.values() if m['status'] == STATUS_UNMAPPED)
        ambiguous_count = sum(1 for m in mapping.values() if m['status'] == STATUS_AMBIGUOUS)
        print()

        # Write mapping audit to gene_source_mapping (per-metric entries)
        print('Layer 2: Writing mapping audit table (per-metric)...')
        mapping_data = []
        for source_gene_id, m in mapping.items():
            # Find which metrics this gene appears in
            gene_metrics = [metric for metric, genes in per_metric_gene_ids.items() if source_gene_id in genes]
            metric_str = ','.join(sorted(gene_metrics)) if gene_metrics else None

            mapping_data.append((
                batch_id,
                source_gene_id,
                m['canonical_gene_id'],
                m['status'],
                m['method'],
                m['confidence'],
                m['ambiguity_count'],
                psycopg2.extras.Json({'details': m.get('ambiguity_details', [])}) if m.get('ambiguity_details') else None,
                m['reason'],
                'update_data',
                metric_str,
            ))

        execute_values(cur, '''
            INSERT INTO gene_source_mapping
                (batch_id, source_gene_id, canonical_gene_id, mapping_status, mapping_method,
                 confidence, ambiguity_count, ambiguity_details, reason, source_dataset, metric_code)
            VALUES %s
        ''', mapping_data, page_size=5000)
        conn.commit()
        print(f'  Written {len(mapping_data):,} mapping records')
        print()

        # Per-metric mapping stats
        for metric in MATRIX_FILES:
            metric_genes = per_metric_gene_ids.get(metric, set())
            m_mapped = sum(1 for g in metric_genes if mapping.get(g, {}).get('status', '').startswith('mapped'))
            m_unmapped = sum(1 for g in metric_genes if mapping.get(g, {}).get('status') == STATUS_UNMAPPED)
            m_ambiguous = sum(1 for g in metric_genes if mapping.get(g, {}).get('status') == STATUS_AMBIGUOUS)
            print(f'  {metric}: mapped={m_mapped}, unmapped={m_unmapped}, ambiguous={m_ambiguous}')

        print()

        # ──────────────────────────────────────────────────────────────────────
        # Layer 3: Truncate and rebuild curated tables
        # ──────────────────────────────────────────────────────────────────────
        print('Layer 3: Rebuilding curated expression tables...')
        cur.execute('DELETE FROM gene_expression_summary')
        cur.execute('DELETE FROM expression_fact')
        cur.execute('DELETE FROM dataset_sample')
        cur.execute('DELETE FROM expression_sample')
        cur.execute('DELETE FROM gene_expression')
        conn.commit()

        # Insert expression_sample (36 samples)
        print('  Inserting expression_sample...')
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

        cur.execute('SELECT id, sample_name FROM expression_sample ORDER BY id')
        sample_id_map = {name: sid for sid, name in cur.fetchall()}
        conn.commit()
        print(f'    {len(samples)} expression samples')

        # Update dataset table with PER-METRIC gene counts
        print('  Updating dataset table (per-metric gene counts)...')

        # Ensure day_featurecounts_36 dataset exists
        cur.execute("SELECT dataset_id FROM dataset WHERE dataset_code = 'day_featurecounts_36'")
        if not cur.fetchone():
            cur.execute('''
                INSERT INTO dataset (dataset_code, dataset_name, sample_scope, normalization_family,
                    description, source_file, metric_codes, row_count)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ''', (
                'day_featurecounts_36',
                'featureCounts Raw Count - 36 developmental stage samples',
                'developmental_36', 'raw_count',
                'Raw read counts from featureCounts',
                NON_MATRIX_FILES['featurecounts_raw'], ['raw_count'],
                len(per_metric_gene_ids.get('raw_count', set())),
            ))

        # raw_ballgown_36: uses TPM + FPKM
        ballgown_genes = len(per_metric_gene_ids.get('tpm', set()))
        ballgown_curated = sum(
            1 for g in per_metric_gene_ids.get('tpm', set())
            if mapping.get(g, {}).get('status', '').startswith('mapped')
        )

        cur.execute('''
            UPDATE dataset SET
                source_file = %s,
                row_count = %s,
                source_gene_count = %s,
                curated_gene_count = %s,
                metric_codes = ARRAY['tpm', 'fpkm'],
                description = 'Ballgown TPM/FPKM - 36 developmental stage samples'
            WHERE dataset_code = 'raw_ballgown_36'
        ''', (
            f"{MATRIX_FILES['tpm']};{MATRIX_FILES['fpkm']}",
            ballgown_genes,
            ballgown_genes,
            ballgown_curated,
        ))

        # day_deseq2_36: uses normcount
        normcount_genes = len(per_metric_gene_ids.get('normcount', set()))
        normcount_curated = sum(
            1 for g in per_metric_gene_ids.get('normcount', set())
            if mapping.get(g, {}).get('status', '').startswith('mapped')
        )

        cur.execute('''
            UPDATE dataset SET
                source_file = %s,
                row_count = %s,
                source_gene_count = %s,
                curated_gene_count = %s,
                metric_codes = ARRAY['normcount'],
                description = 'DESeq2 Normalized Count - 36 developmental stage samples'
            WHERE dataset_code = 'day_deseq2_36'
        ''', (
            MATRIX_FILES['normcount'],
            normcount_genes,
            normcount_genes,
            normcount_curated,
        ))

        # day_featurecounts_36: uses raw_count
        raw_count_genes = len(per_metric_gene_ids.get('raw_count', set()))
        raw_count_curated = sum(
            1 for g in per_metric_gene_ids.get('raw_count', set())
            if mapping.get(g, {}).get('status', '').startswith('mapped')
        )

        cur.execute('''
            UPDATE dataset SET
                source_file = %s,
                row_count = %s,
                source_gene_count = %s,
                curated_gene_count = %s,
                metric_codes = ARRAY['raw_count'],
                description = 'featureCounts Raw Count - 36 developmental stage samples'
            WHERE dataset_code = 'day_featurecounts_36'
        ''', (
            MATRIX_FILES['raw_count'],
            raw_count_genes,
            raw_count_genes,
            raw_count_curated,
        ))

        conn.commit()

        # Rebuild dataset_sample
        print('  Rebuilding dataset_sample...')
        cur.execute('SELECT dataset_id, dataset_code FROM dataset')
        dataset_ids = {code: did for did, code in cur.fetchall()}

        dataset_samples = []
        for dataset_code, dataset_id in dataset_ids.items():
            for sample_name, sample_id in sample_id_map.items():
                stage, sex, rep = parse_sample_col(sample_name)
                dataset_samples.append((
                    dataset_id, sample_id, sample_name,
                    stage, sex, rep, STAGE_ORDER[stage],
                    sample_name, sample_name, sample_name, sample_name,
                ))

        execute_values(cur, '''
            INSERT INTO dataset_sample (dataset_id, biosample_id, sample_name, stage, sex, replicate,
                stage_order, tpm_col, fpkm_col, nc_col, raw_col)
            VALUES %s
        ''', dataset_samples, page_size=200)
        conn.commit()
        print(f'    {len(dataset_samples)} dataset samples')

        # Build dataset_sample mapping
        cur.execute('''
            SELECT ds.dataset_sample_id, d.dataset_code, es.sample_name
            FROM dataset_sample ds
            JOIN dataset d ON d.dataset_id = ds.dataset_id
            JOIN expression_sample es ON es.id = ds.biosample_id
        ''')
        ds_map = {(dcode, sname): dsid for dsid, dcode, sname in cur.fetchall()}

        # Build expression_fact (only mapped genes)
        print('  Building expression_fact (mapped genes only)...')
        fact_data = []
        skipped_ambiguous = 0

        for source_gene_id_raw, source_gene_id, sample_name, raw_text, value, row_num, metric, source_file in all_records:
            m = mapping.get(source_gene_id)
            if not m:
                continue

            if m['status'] not in (STATUS_MAPPED_EXACT, STATUS_MAPPED_DISPLAY, STATUS_MAPPED_ALIAS):
                if m['status'] == STATUS_AMBIGUOUS:
                    skipped_ambiguous += 1
                continue

            canonical_gene_id = m['canonical_gene_id']
            dataset_code = DATASET_MAP.get(metric)
            if not dataset_code:
                continue

            dsid = ds_map.get((dataset_code, sample_name))
            if dsid:
                fact_data.append((canonical_gene_id, dsid, metric, value))

        batch_size = 100000
        for i in range(0, len(fact_data), batch_size):
            batch = fact_data[i:i+batch_size]
            execute_values(cur, '''
                INSERT INTO expression_fact (gene_id, dataset_sample_id, metric_code, value, updated_at)
                VALUES %s
            ''', [(g, ds, m, v, datetime.now()) for g, ds, m, v in batch], page_size=batch_size)
            conn.commit()
            print(f'    Inserted {min(i+batch_size, len(fact_data)):,} / {len(fact_data):,}', end='\r')
        print()

        # Build gene_expression_summary
        print('  Building gene_expression_summary...')
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
                ef.gene_id, d.dataset_code, ef.metric_code,
                COUNT(*), AVG(ef.value), MAX(ef.value), MIN(ef.value),
                COALESCE(STDDEV(ef.value), 0),
                CASE WHEN AVG(ef.value) > 0
                     THEN COALESCE(STDDEV(ef.value), 0) / AVG(ef.value)
                     ELSE 0 END,
                COUNT(CASE WHEN ef.value > 0 THEN 1 END),
                COUNT(CASE WHEN ef.value = 0 THEN 1 END),
                NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NOW()
            FROM expression_fact ef
            JOIN dataset_sample ds ON ds.dataset_sample_id = ef.dataset_sample_id
            JOIN dataset d ON d.dataset_id = ds.dataset_id
            GROUP BY ef.gene_id, d.dataset_code, ef.metric_code
        ''')
        conn.commit()

        cur.execute('SELECT COUNT(*) FROM gene_expression_summary')
        print(f'    {cur.fetchone()[0]:,} summary records')

        # Update gene_alias
        print('  Updating gene_alias...')
        alias_count = 0
        for src, m in mapping.items():
            if 'mapped' not in m['status'] or 'unmapped' in m['status']:
                continue
            canonical = m['canonical_gene_id']
            if src == canonical:
                continue
            cur.execute('SELECT 1 FROM gene_alias WHERE canonical_id = %s AND alias = %s', (canonical, src))
            if cur.fetchone():
                continue
            cur.execute('''
                INSERT INTO gene_alias (canonical_id, alias, alias_type, source_dataset, updated_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (alias_type, alias) DO NOTHING
            ''', (canonical, src, 'symbol', f'update_data_batch_{batch_id}', datetime.now()))
            alias_count += 1
        conn.commit()
        print(f'    {alias_count} new aliases')

        # Update batch record
        cur.execute('''
            UPDATE import_batch SET
                source_gene_count = %s,
                mapped_gene_count = %s,
                unmapped_gene_count = %s,
                ambiguous_gene_count = %s,
                matrix_staging_rows = %s,
                total_staging_rows = %s,
                total_staging_rows_all_files = %s,
                total_fact_rows = %s,
                status = 'completed',
                completed_at = NOW()
            WHERE batch_id = %s
        ''', (
            len(source_gene_ids), mapped_count, unmapped_count, ambiguous_count,
            matrix_staging_rows, matrix_staging_rows, total_staging_all,
            len(fact_data), batch_id,
        ))
        conn.commit()

        # ──────────────────────────────────────────────────────────────────────
        # QC Assertions
        # ──────────────────────────────────────────────────────────────────────
        print()
        print('=' * 70)
        print('QC ASSERTIONS')
        print('=' * 70)

        # QC 1: Matrix staging row counts
        cur.execute('SELECT COUNT(*) FROM stg_update_expression_matrix WHERE batch_id = %s AND is_valid = TRUE', (batch_id,))
        staging_valid = cur.fetchone()[0]
        cur.execute('SELECT COUNT(*) FROM stg_update_expression_matrix WHERE batch_id = %s AND is_valid = FALSE', (batch_id,))
        staging_invalid = cur.fetchone()[0]

        expected_staging = len(all_records) + len(all_invalid)
        record_qc(cur, batch_id, 'stg_update_expression_matrix', file_hashes.get(MATRIX_FILES['tpm'], ''),
                  'row_count', 'matrix_staging_total',
                  str(expected_staging), str(staging_valid + staging_invalid),
                  staging_valid + staging_invalid == expected_staging)
        print(f'  Matrix staging valid:    {staging_valid:,}')
        print(f'  Matrix staging invalid:  {staging_invalid:,}')

        # QC 2: Per-metric gene counts
        for metric in MATRIX_FILES:
            cur.execute('''
                SELECT COUNT(DISTINCT source_gene_id) FROM stg_update_expression_matrix
                WHERE batch_id = %s AND source_metric = %s AND is_valid = TRUE
            ''', (batch_id, metric))
            staged_genes = cur.fetchone()[0]
            expected_genes = len(per_metric_gene_ids.get(metric, set()))

            cur.execute('''
                SELECT COUNT(DISTINCT gene_id) FROM expression_fact WHERE metric_code = %s
            ''', (metric,))
            fact_genes = cur.fetchone()[0]

            record_qc(cur, batch_id, MATRIX_FILES[metric], file_hashes.get(MATRIX_FILES[metric], ''),
                      'gene_count', f'{metric}_staged_vs_expected',
                      str(expected_genes), str(staged_genes),
                      staged_genes == expected_genes,
                      {'metric': metric, 'fact_genes': fact_genes})
            print(f'  {metric}: staged={staged_genes}, expected={expected_genes}, fact={fact_genes}')

        # QC 3: Per-metric 36-sample completeness
        for metric in MATRIX_FILES:
            cur.execute('''
                SELECT source_gene_id, COUNT(DISTINCT sample_name) as sample_cnt
                FROM stg_update_expression_matrix
                WHERE batch_id = %s AND source_metric = %s AND is_valid = TRUE
                GROUP BY source_gene_id
                HAVING COUNT(DISTINCT sample_name) < 36
            ''', (batch_id, metric))
            incomplete = cur.fetchall()
            record_qc(cur, batch_id, MATRIX_FILES[metric], file_hashes.get(MATRIX_FILES[metric], ''),
                      'sample_completeness', f'{metric}_36_sample_check',
                      '36', str(len(incomplete)),
                      len(incomplete) == 0,
                      {'incomplete_genes': [r[0] for r in incomplete[:10]]})
            status = 'PASS' if len(incomplete) == 0 else f'FAIL ({len(incomplete)} genes)'
            print(f'  {metric} 36-sample completeness: {status}')

        # QC 4: Non-matrix file staging counts
        cur.execute('SELECT COUNT(*) FROM stg_update_gene_annotation WHERE batch_id = %s', (batch_id,))
        annot_count = cur.fetchone()[0]
        record_qc(cur, batch_id, NON_MATRIX_FILES['gene_annotation'],
                  file_hashes.get(NON_MATRIX_FILES['gene_annotation'], ''),
                  'row_count', 'gene_annotation_staged',
                  str(len(gene_annot_rows)), str(annot_count),
                  annot_count == len(gene_annot_rows))
        print(f'  Gene annotation staged: {annot_count:,}')

        cur.execute('SELECT COUNT(*) FROM stg_featurecounts_raw WHERE batch_id = %s AND is_valid = TRUE', (batch_id,))
        fcraw_count = cur.fetchone()[0]
        record_qc(cur, batch_id, NON_MATRIX_FILES['featurecounts_raw'],
                  file_hashes.get(NON_MATRIX_FILES['featurecounts_raw'], ''),
                  'row_count', 'featurecounts_raw_staged',
                  str(len(fc_records)), str(fcraw_count),
                  fcraw_count == len(fc_records))
        print(f'  featureCounts raw staged: {fcraw_count:,}')

        cur.execute('SELECT COUNT(*) FROM stg_featurecounts_summary WHERE batch_id = %s', (batch_id,))
        fcsumm_count = cur.fetchone()[0]
        record_qc(cur, batch_id, NON_MATRIX_FILES['featurecounts_summary'],
                  file_hashes.get(NON_MATRIX_FILES['featurecounts_summary'], ''),
                  'row_count', 'featurecounts_summary_staged',
                  str(len(fc_summary_rows)), str(fcsumm_count),
                  fcsumm_count == len(fc_summary_rows))
        print(f'  featureCounts summary staged: {fcsumm_count:,}')

        cur.execute('SELECT COUNT(*) FROM stg_master_expression_table WHERE batch_id = %s', (batch_id,))
        master_count = cur.fetchone()[0]
        record_qc(cur, batch_id, NON_MATRIX_FILES['master_expression'],
                  file_hashes.get(NON_MATRIX_FILES['master_expression'], ''),
                  'row_count', 'master_expression_staged',
                  str(len(master_rows)), str(master_count),
                  master_count == len(master_rows))
        print(f'  Master expression staged: {master_count:,}')

        # QC 5: Mapping completeness
        cur.execute('SELECT COUNT(*) FROM gene_source_mapping WHERE batch_id = %s', (batch_id,))
        mapping_rows = cur.fetchone()[0]
        record_qc(cur, batch_id, 'gene_source_mapping', '',
                  'mapping_count', 'all_source_genes_mapped',
                  str(len(source_gene_ids)), str(mapping_rows),
                  mapping_rows == len(source_gene_ids))
        print(f'  Mapping audit rows: {mapping_rows:,} (expected {len(source_gene_ids):,})')

        # QC 6: Total staging rows all files
        record_qc(cur, batch_id, 'ALL_FILES', '',
                  'row_count', 'total_staging_all_files',
                  str(total_staging_all), str(total_staging_all),
                  True,
                  {'matrix': matrix_staging_rows, 'annot': len(annot_data),
                   'fcraw': len(fc_data), 'fcsumm': len(summary_data), 'master': len(master_data)})
        print(f'  Total staging rows (all files): {total_staging_all:,}')

        # QC 7: Fact row count
        cur.execute('SELECT COUNT(*) FROM expression_fact')
        fact_rows = cur.fetchone()[0]
        print(f'  Fact rows: {fact_rows:,}')

        # Check for any QC failures
        cur.execute('SELECT COUNT(*) FROM import_qc_result WHERE batch_id = %s AND passed = FALSE', (batch_id,))
        failed_qc = cur.fetchone()[0]
        conn.commit()

        print()
        if failed_qc > 0:
            print(f'  WARNING: {failed_qc} QC checks FAILED')
        else:
            print('  All QC checks PASSED')

        print()
        print('=' * 70)
        print('Import Complete')
        print('=' * 70)

    except Exception as e:
        conn.rollback()
        try:
            cur.execute('''
                UPDATE import_batch SET status = 'failed', error_message = %s, completed_at = NOW()
                WHERE batch_id = %s
            ''', (str(e), batch_id))
            conn.commit()
        except Exception:
            pass
        print(f'Error: {e}', file=sys.stderr)
        import traceback
        traceback.print_exc()
        raise
    finally:
        cur.close()
        conn.close()


def main():
    parser = argparse.ArgumentParser(description='Import expression data (3-layer architecture)')
    parser.add_argument('--data-dir', required=True, help='Path to update data directory')
    parser.add_argument('--dry-run', action='store_true', help='Validate only, no DB changes')
    args = parser.parse_args()

    if not os.path.exists(args.data_dir):
        print(f'Error: Data directory not found: {args.data_dir}', file=sys.stderr)
        sys.exit(1)

    run_import(args.data_dir, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
