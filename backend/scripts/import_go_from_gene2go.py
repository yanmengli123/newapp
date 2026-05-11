#!/usr/bin/env python3
"""
Import GO annotations from NCBI gene2go file into PostgreSQL gene_go table.

gene2go.gz format (NCBI Gene tabular, NOT GAF 2.2):
    Column 1: tax_id (9031 for chicken)
    Column 2: GeneID (NCBI Gene ID)
    Column 3: GO_ID
    Column 4: Evidence (e.g., IEA, IDA, IMP)
    Column 5: Qualifier (e.g., enables, involved_in, located_in)
    Column 6: GO_term (term name)
    Column 7: PubMed (pipe-separated PubMed IDs)
    Column 8: Category (F/P/C for Function/Process/Component)

Usage:
    python import_go_from_gene2go.py --gene2go path/to/gene2go.gz [--dry-run] [--batch-size 10000] [--taxon 9031]
"""

import argparse
import gzip
import os
import sys
from collections import defaultdict
from datetime import datetime

import psycopg2
from psycopg2.extras import execute_values

# gene2go column indices (0-based)
COL_TAX_ID = 0
COL_GENE_ID = 1
COL_GO_ID = 2
COL_EVIDENCE = 3
COL_QUALIFIER = 4
COL_GO_TERM = 5
COL_PUBMED = 6
COL_CATEGORY = 7

# Category to aspect mapping
CATEGORY_MAP = {
    'F': 'molecular_function',
    'P': 'biological_process',
    'C': 'cellular_component',
}


def parse_gene2go_line(line: str, taxon_filter: str | None = None) -> dict | None:
    """Parse a single gene2go line into a record dict."""
    if line.startswith('#') or not line.strip():
        return None

    parts = line.rstrip('\n').split('\t')
    if len(parts) < 8:
        return None

    tax_id = parts[COL_TAX_ID].strip()
    gene_id = parts[COL_GENE_ID].strip()
    go_id = parts[COL_GO_ID].strip()

    # Validate
    if not gene_id.isdigit():
        return None
    if not go_id.startswith('GO:'):
        return None

    # Filter by taxon if specified
    if taxon_filter and tax_id != taxon_filter:
        return None

    # Extract category (aspect)
    category = parts[COL_CATEGORY].strip() if len(parts) > COL_CATEGORY else ''
    namespace = CATEGORY_MAP.get(category, '')

    # Extract PubMed IDs (pipe-separated, take first)
    pubmed_raw = parts[COL_PUBMED].strip() if len(parts) > COL_PUBMED else ''
    pubmed_ids = pubmed_raw.split('|')[0].strip() if pubmed_raw else ''

    # Extract qualifier
    qualifier = parts[COL_QUALIFIER].strip() if len(parts) > COL_QUALIFIER else ''

    return {
        'tax_id': tax_id,
        'ncbi_gene_id': gene_id,
        'go_id': go_id,
        'evidence_code': parts[COL_EVIDENCE].strip() if len(parts) > COL_EVIDENCE else '',
        'qualifier': qualifier,
        'go_term': parts[COL_GO_TERM].strip() if len(parts) > COL_GO_TERM else '',
        'pubmed_ids': pubmed_ids,
        'category': category,
        'namespace': namespace,
    }


def load_gene2go_file(gene2go_path: str, taxon_filter: str | None = None) -> list[dict]:
    """Load and parse gene2go file."""
    records = []
    open_func = gzip.open if gene2go_path.endswith('.gz') else open
    mode = 'rt' if gene2go_path.endswith('.gz') else 'r'

    with open_func(gene2go_path, mode, encoding='utf-8', errors='replace') as f:
        for line_num, line in enumerate(f, 1):
            record = parse_gene2go_line(line, taxon_filter)
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


def run_import(gene2go_path: str, dry_run: bool = False, batch_size: int = 10000, taxon: str = '9031'):
    """Main import function."""
    print(f'Loading gene2go file: {gene2go_path}')
    print(f'Taxon filter: {taxon}')
    records = load_gene2go_file(gene2go_path, taxon_filter=taxon)

    if not records:
        print('No valid records found')
        return

    # Get unique GeneIDs
    ncbi_gene_ids = {r['ncbi_gene_id'] for r in records}
    print(f'Unique NCBI GeneIDs in gene2go: {len(ncbi_gene_ids)}')

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

        # Prepare new records
        source = f'ncbi_gene2go_{datetime.now().strftime("%Y%m%d")}'
        now = datetime.now()

        new_records = []
        skipped = 0
        for rec in records:
            ncbi_id = rec['ncbi_gene_id']
            if ncbi_id not in gene_map:
                skipped += 1
                continue

            gene_info = gene_map[ncbi_id]
            gene_id = gene_info['gene_id']
            go_id = rec['go_id']
            evidence_code = rec['evidence_code']

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
                f'NCBI:{ncbi_id}',
                rec['pubmed_ids'],
                'NCBI',
                rec['category'],
                ncbi_id,
            ))

        print(f'New annotations to insert: {len(new_records)}')
        print(f'Skipped (no mapping): {skipped}')

        if dry_run:
            print('\n[DRY RUN] No changes made')
            # Print statistics
            print('\n--- Statistics ---')
            print(f'Total records parsed: {len(records)}')
            print(f'Unique GeneIDs: {len(ncbi_gene_ids)}')
            print(f'Mapped to gene_xref: {len(gene_map)} ({len(gene_map)/len(ncbi_gene_ids)*100:.1f}%)')
            print(f'Skipped (no mapping): {skipped}')
            print(f'Duplicate with existing: {len(records) - len(new_records) - skipped}')
            print(f'New annotations: {len(new_records)}')

            # Evidence distribution in new records
            evidence_dist = defaultdict(int)
            for rec in new_records:
                evidence_dist[rec[2]] += 1
            print('\nEvidence distribution in new records:')
            for ev, cnt in sorted(evidence_dist.items(), key=lambda x: -x[1])[:10]:
                print(f'  {ev}: {cnt}')

            # Sample new records
            if new_records:
                print('\nSample new records (first 5):')
                for rec in new_records[:5]:
                    print(f'  gene_id={rec[0]} -> {rec[1]} ({rec[2]})')

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

    except Exception as e:
        conn.rollback()
        print(f'Error: {e}', file=sys.stderr)
        raise
    finally:
        cur.close()
        conn.close()


def main():
    parser = argparse.ArgumentParser(description='Import GO annotations from NCBI gene2go file')
    parser.add_argument('--gene2go', required=True, help='Path to gene2go file (.gz or plain)')
    parser.add_argument('--dry-run', action='store_true', help='Parse and validate only, no DB changes')
    parser.add_argument('--batch-size', type=int, default=10000, help='Insert batch size')
    parser.add_argument('--taxon', type=str, default='9031', help='Taxon ID filter (default: 9031 for chicken)')
    args = parser.parse_args()

    if not os.path.exists(args.gene2go):
        print(f'Error: gene2go file not found: {args.gene2go}', file=sys.stderr)
        sys.exit(1)

    run_import(args.gene2go, dry_run=args.dry_run, batch_size=args.batch_size, taxon=args.taxon)


if __name__ == '__main__':
    main()
