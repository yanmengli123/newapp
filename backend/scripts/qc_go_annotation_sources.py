#!/usr/bin/env python3
"""
QC script for GO annotation sources.

Compares annotation coverage between different sources:
- Ensembl BioMart (existing)
- NCBI GAF (new)

Output:
- Coverage statistics
- Overlap analysis
- Evidence code distribution
- Missing gene analysis
"""

import os
import sys
from collections import defaultdict

import psycopg2


def run_qc():
    """Run QC analysis on GO annotations."""
    pg_dsn = os.environ.get('GRCG6A_PG_DSN', 'postgresql://grcuser:grcpassword@127.0.0.1:5433/grcg6a')
    conn = psycopg2.connect(pg_dsn)
    cur = conn.cursor()

    try:
        print('=' * 60)
        print('GO Annotation QC Report')
        print('=' * 60)

        # 1. Overall statistics
        print('\n1. OVERALL STATISTICS')
        print('-' * 40)

        cur.execute('SELECT COUNT(*) FROM gene_go')
        total_annotations = cur.fetchone()[0]

        cur.execute('SELECT COUNT(DISTINCT gene_id) FROM gene_go')
        total_genes = cur.fetchone()[0]

        cur.execute('SELECT COUNT(*) FROM gene_xref')
        total_xref = cur.fetchone()[0]

        cur.execute('SELECT COUNT(*) FROM gene_xref WHERE ncbi_gene_id IS NOT NULL')
        with_ncbi = cur.fetchone()[0]

        print(f'Total GO annotations: {total_annotations}')
        print(f'Genes with GO: {total_genes}')
        print(f'Total gene_xref entries: {total_xref}')
        print(f'Genes with NCBI GeneID: {with_ncbi}')
        print(f'GO coverage: {total_genes/total_xref*100:.1f}%')

        # 2. Source distribution
        print('\n2. SOURCE DISTRIBUTION')
        print('-' * 40)

        cur.execute('''
            SELECT source, COUNT(*) as cnt, COUNT(DISTINCT gene_id) as genes
            FROM gene_go
            GROUP BY source
            ORDER BY cnt DESC
        ''')
        sources = cur.fetchall()
        for src, cnt, genes in sources:
            src_label = src or 'NULL'
            print(f'  {src_label}: {cnt} annotations, {genes} genes')

        # 3. Evidence code distribution
        print('\n3. EVIDENCE CODE DISTRIBUTION')
        print('-' * 40)

        cur.execute('''
            SELECT evidence_code, COUNT(*) as cnt, COUNT(DISTINCT gene_id) as genes
            FROM gene_go
            GROUP BY evidence_code
            ORDER BY cnt DESC
        ''')
        evidence = cur.fetchall()
        for ev, cnt, genes in evidence[:15]:
            print(f'  {ev}: {cnt} annotations, {genes} genes')

        # 4. Source overlap analysis
        print('\n4. SOURCE OVERLAP ANALYSIS')
        print('-' * 40)

        # Genes per source
        cur.execute('''
            SELECT source, ARRAY_AGG(DISTINCT gene_id)
            FROM gene_go
            GROUP BY source
        ''')
        source_genes = {}
        for src, genes in cur.fetchall():
            source_genes[src or 'NULL'] = set(genes)

        # Overlap between sources
        sources_list = list(source_genes.keys())
        for i, src1 in enumerate(sources_list):
            for src2 in sources_list[i+1:]:
                overlap = source_genes[src1] & source_genes[src2]
                print(f'  {src1} ∩ {src2}: {len(overlap)} genes')

        # 5. Evidence filter statistics
        print('\n5. EVIDENCE FILTER STATISTICS')
        print('-' * 40)

        cur.execute('''
            SELECT
                COUNT(DISTINCT gene_id) as total_genes,
                COUNT(DISTINCT CASE WHEN evidence_code != 'IEA' THEN gene_id END) as non_iea_genes,
                COUNT(DISTINCT CASE WHEN evidence_code IN ('IDA', 'IMP', 'IGI', 'IPI', 'IEP', 'TAS', 'NAS') THEN gene_id END) as curated_genes
            FROM gene_go
        ''')
        total, non_iea, curated = cur.fetchone()
        print(f'  All evidence: {total} genes')
        print(f'  Non-IEA: {non_iea} genes ({non_iea/total*100:.1f}%)')
        print(f'  Curated (experimental): {curated} genes ({curated/total*100:.1f}%)')

        # 6. Namespace distribution
        print('\n6. GO NAMESPACE DISTRIBUTION')
        print('-' * 40)

        # Check if aspect column exists
        cur.execute('''
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'gene_go' AND column_name = 'aspect'
        ''')
        has_aspect = cur.fetchone() is not None

        if has_aspect:
            cur.execute('''
                SELECT aspect, COUNT(*) as cnt, COUNT(DISTINCT gene_id) as genes
                FROM gene_go
                WHERE aspect IS NOT NULL
                GROUP BY aspect
            ''')
            for aspect, cnt, genes in cur.fetchall():
                namespace = {'F': 'molecular_function', 'P': 'biological_process', 'C': 'cellular_component'}.get(aspect, aspect)
                print(f'  {namespace}: {cnt} annotations, {genes} genes')
        else:
            print('  (aspect column not yet added)')

        # 7. Missing genes analysis
        print('\n7. MISSING GENES ANALYSIS')
        print('-' * 40)

        cur.execute('''
            SELECT COUNT(*)
            FROM gene_xref x
            LEFT JOIN gene_go g ON x.gene_id = g.gene_id
            WHERE g.gene_id IS NULL
        ''')
        missing = cur.fetchone()[0]
        print(f'  Genes without GO annotation: {missing}')

        cur.execute('''
            SELECT COUNT(*)
            FROM gene_xref x
            LEFT JOIN gene_go g ON x.gene_id = g.gene_id
            WHERE g.gene_id IS NULL AND x.ncbi_gene_id IS NOT NULL
        ''')
        missing_with_ncbi = cur.fetchone()[0]
        print(f'  Missing genes with NCBI GeneID: {missing_with_ncbi}')

        # 8. Top GO terms
        print('\n8. TOP 10 GO TERMS (by gene count)')
        print('-' * 40)

        cur.execute('''
            SELECT go_id, COUNT(DISTINCT gene_id) as genes
            FROM gene_go
            GROUP BY go_id
            ORDER BY genes DESC
            LIMIT 10
        ''')
        for go_id, genes in cur.fetchall():
            print(f'  {go_id}: {genes} genes')

        print('\n' + '=' * 60)
        print('QC Report Complete')
        print('=' * 60)

    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == '__main__':
    run_qc()
