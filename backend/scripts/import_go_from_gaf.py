#!/usr/bin/env python3
"""
Import GO annotations from GAF file into PostgreSQL gene_go table.

Usage:
    python import_go_from_gaf.py --gaf path/to/file.gaf [--dry-run] [--batch-size 10000]

GAF Format (2.2):
    Column 1: DB (NCBIGene)
    Column 2: GeneID
    Column 3: Symbol
    Column 4: Qualifier (enables/involved_in/located_in)
    Column 5: GO_ID
    Column 6: Reference
    Column 7: Evidence_Code
    Column 8: With,From
    Column 9: Aspect (F/P/C)
    Column 10: Gene_Name
    Column 11: Gene_Synonym
    Column 12: Type
    Column 13: Taxon
    Column 14: Date
    Column 15: Assigned_By
    Column 16: Annot_Ext
    Column 17: Gene_Product_Form_ID
"""

import argparse
import gzip
import os
import sys
from collections import defaultdict
from datetime import datetime

import psycopg2
from psycopg2.extras import execute_values

# GAF column indices (0-based)
COL_DB = 0
COL_GENE_ID = 1
COL_SYMBOL = 2
COL_QUALIFIER = 3
COL_GO_ID = 4
COL_REFERENCE = 5
COL_EVIDENCE = 6
COL_WITH_FROM = 7
COL_ASPECT = 8
COL_GENE_NAME = 9
COL_GENE_SYNONYM = 10
COL_TYPE = 11
COL_TAXON = 12
COL_DATE = 13
COL_ASSIGNED_BY = 14
COL_ANNOT_EXT = 15
COL_GENE_PRODUCT_FORM = 16

# Aspect to namespace mapping
ASPECT_MAP = {
    'F': 'molecular_function',
    'P': 'biological_process',
    'C': 'cellular_component',
}


def parse_gaf_line(line: str) -> dict | None:
    """Parse a single GAF line into a record dict."""
    if line.startswith('!') or not line.strip():
        return None

    parts = line.rstrip('\n').split('\t')
    if len(parts) < 15:
        return None

    gene_id = parts[COL_GENE_ID].strip()
    if not gene_id.isdigit():
        return None

    go_id = parts[COL_GO_ID].strip()
    if not go_id.startswith('GO:'):
        return None

    aspect = parts[COL_ASPECT].strip() if len(parts) > COL_ASPECT else ''
    namespace = ASPECT_MAP.get(aspect, '')

    # Extract PubMed IDs from reference
    reference = parts[COL_REFERENCE].strip() if len(parts) > COL_REFERENCE else ''
    pubmed_ids = ''
    if reference.startswith('PMID:'):
        pubmed_ids = reference.replace('PMID:', '')

    return {
        'ncbi_gene_id': gene_id,
        'go_id': go_id,
        'qualifier': parts[COL_QUALIFIER].strip() if len(parts) > COL_QUALIFIER else '',
        'reference': reference,
        'evidence_code': parts[COL_EVIDENCE].strip() if len(parts) > COL_EVIDENCE else '',
        'aspect': aspect,
        'namespace': namespace,
        'assigned_by': parts[COL_ASSIGNED_BY].strip() if len(parts) > COL_ASSIGNED_BY else '',
        'pubmed_ids': pubmed_ids,
        'symbol': parts[COL_SYMBOL].strip() if len(parts) > COL_SYMBOL else '',
    }


def load_gaf_file(gaf_path: str) -> list[dict]:
    """Load and parse GAF file."""
    records = []
    open_func = gzip.open if gaf_path.endswith('.gz') else open
    mode = 'rt' if gaf_path.endswith('.gz') else 'r'

    with open_func(gaf_path, mode, encoding='utf-8', errors='replace') as f:
        for line_num, line in enumerate(f, 1):
            record = parse_gaf_line(line)
            if record:
                records.append(record)
            if line_num % 10000 == 0:
                print(f'  Parsed {line_num} lines...', end='\r')

    print(f'  Parsed {len(records)} valid GO annotations')
    return records


def get_gene_mapping(cur, ncbi_gene_ids: set[str]) -> dict[str, dict]:
    """Get gene_id mapping from ncbi_gene_id."""
    if not ncbi_gene_ids:
        return {}

    # Batch query for efficiency
    id_list = list(ncbi_gene_ids)
    gene_map = {}

    for i in range(0, len(id_list), 1000):
        batch = id_list[i:i+1000]
        placeholders = ','.join(['%s'] * len(batch))
        cur.execute(f'''
            SELECT ncbi_gene_id, gene_id, gene_symbol, ensembl_gene_id
            FROM gene_xref
            WHERE ncbi_gene_id IN ({placeholders})
        ''', batch)
        for row in cur.fetchall():
            gene_map[row[0]] = {
                'gene_id': row[1],
                'gene_symbol': row[2],
                'ensembl_gene_id': row[3],
            }

    return gene_map


def get_existing_annotations(cur) -> set[tuple]:
    """Get existing (gene_id, go_id, evidence_code) tuples."""
    cur.execute('''
        SELECT DISTINCT gene_id, go_id, evidence_code
        FROM gene_go
    ''')
    return set(cur.fetchall())


def run_import(gaf_path: str, dry_run: bool = False, batch_size: int = 10000):
    """Main import function."""
    print(f'Loading GAF file: {gaf_path}')
    records = load_gaf_file(gaf_path)

    if not records:
        print('No valid records found')
        return

    # Filter out NOT qualifiers (these are negative annotations, not suitable for enrichment)
    not_count = sum(1 for r in records if 'NOT' in r['qualifier'].upper())
    records = [r for r in records if 'NOT' not in r['qualifier'].upper()]
    print(f'Filtered out {not_count} NOT-qualifier records')
    print(f'Remaining records: {len(records)}')

    # Get unique GeneIDs
    ncbi_gene_ids = {r['ncbi_gene_id'] for r in records}
    print(f'Unique NCBI GeneIDs in GAF: {len(ncbi_gene_ids)}')

    # Connect to PostgreSQL
    pg_dsn = os.environ.get('GRCG6A_PG_DSN', 'postgresql://grcuser:grcpassword@127.0.0.1:5433/grcg6a')
    conn = psycopg2.connect(pg_dsn)
    cur = conn.cursor()

    try:
        # Get gene mapping
        print('Mapping GeneIDs to database...')
        gene_map = get_gene_mapping(cur, ncbi_gene_ids)
        print(f'Mapped {len(gene_map)} / {len(ncbi_gene_ids)} GeneIDs ({len(gene_map)/len(ncbi_gene_ids)*100:.1f}%)')

        # Get existing annotations
        print('Checking existing annotations...')
        existing = get_existing_annotations(cur)
        print(f'Existing annotations: {len(existing)}')

        # Get valid GO IDs from go_term table
        print('Loading valid GO IDs from go_term...')
        cur.execute('SELECT go_id FROM go_term')
        valid_go_ids = set(row[0] for row in cur.fetchall())
        print(f'Valid GO IDs in go_term: {len(valid_go_ids)}')

        # Prepare new records
        source = 'ncbi_gaf_gcf_016699485.2'
        source_version = '2023-09-15'
        now = datetime.now()

        new_records = []
        skipped = 0
        missing_go = 0
        for rec in records:
            ncbi_id = rec['ncbi_gene_id']
            if ncbi_id not in gene_map:
                skipped += 1
                continue

            gene_info = gene_map[ncbi_id]
            gene_id = gene_info['gene_id']
            go_id = rec['go_id']
            evidence_code = rec['evidence_code']

            # Check if GO ID exists in go_term
            if go_id not in valid_go_ids:
                missing_go += 1
                continue

            # Check for duplicates
            if (gene_id, go_id, evidence_code) in existing:
                continue

            new_records.append((
                gene_id,
                go_id,
                evidence_code,
                source,
                now,
                rec['qualifier'],
                rec['reference'],
                rec['pubmed_ids'],
                rec['assigned_by'],
                rec['aspect'],
                ncbi_id,
            ))

        print(f'New annotations to insert: {len(new_records)}')
        print(f'Skipped (no mapping): {skipped}')
        print(f'Skipped (GO ID not in go_term): {missing_go}')

        if dry_run:
            print('\n[DRY RUN] No changes made')
            # Print sample
            if new_records:
                print('\nSample new records:')
                for rec in new_records[:5]:
                    print(f'  {rec[0]} -> {rec[1]} ({rec[2]})')
            return

        # Insert in batches
        print(f'Inserting in batches of {batch_size}...')
        insert_sql = '''
            INSERT INTO gene_go (
                gene_id, go_id, evidence_code, source, updated_at,
                qualifier, reference, pubmed_ids, assigned_by, aspect, source_gene_id
            ) VALUES %s
            ON CONFLICT DO NOTHING
        '''

        # Get count before import
        cur.execute('SELECT COUNT(*) FROM gene_go')
        count_before = cur.fetchone()[0]

        for i in range(0, len(new_records), batch_size):
            batch = new_records[i:i+batch_size]
            execute_values(cur, insert_sql, batch, page_size=batch_size)
            conn.commit()
            print(f'  Processed {min(i+batch_size, len(new_records))} / {len(new_records)}', end='\r')

        # Get actual inserted count from DB
        cur.execute('SELECT COUNT(*) FROM gene_go')
        count_after = cur.fetchone()[0]
        inserted = count_after - count_before

        print(f'\nImport complete: {inserted} new annotations (verified by DB count)')

        # Final statistics
        cur.execute('SELECT COUNT(DISTINCT gene_id) FROM gene_go')
        genes = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM gene_go WHERE source = %s", (source,))
        from_source = cur.fetchone()[0]

        print(f'\nFinal statistics:')
        print(f'  Total annotations: {count_after}')
        print(f'  Genes with GO: {genes}')
        print(f'  From this import: {from_source}')

        print(f'\nFinal statistics:')
        print(f'  Total annotations: {total}')
        print(f'  Genes with GO: {genes}')
        print(f'  From this import: {from_source}')

    except Exception as e:
        conn.rollback()
        print(f'Error: {e}', file=sys.stderr)
        raise
    finally:
        cur.close()
        conn.close()


def main():
    parser = argparse.ArgumentParser(description='Import GO annotations from GAF file')
    parser.add_argument('--gaf', required=True, help='Path to GAF file (.gaf or .gaf.gz)')
    parser.add_argument('--dry-run', action='store_true', help='Parse and validate only, no DB changes')
    parser.add_argument('--batch-size', type=int, default=10000, help='Insert batch size')
    args = parser.parse_args()

    if not os.path.exists(args.gaf):
        print(f'Error: GAF file not found: {args.gaf}', file=sys.stderr)
        sys.exit(1)

    run_import(args.gaf, dry_run=args.dry_run, batch_size=args.batch_size)


if __name__ == '__main__':
    main()
