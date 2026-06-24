"""
Import Comparative Genomics Data
- BLAST alignments -> synteny_block + paf_alignment
- Gene coordinates -> gene_coordinate_mapping
- Chromosome mapping -> chromosome_mapping
"""

import sys
import os
import csv
import gzip
from dataclasses import dataclass
from pathlib import Path
import psycopg2
from psycopg2.extras import execute_values

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import GRCG6A_PG_DSN as PG_DSN


# Legacy fallback mapping: GRCg6a -> GRCg7b shared chromosome names.
# Prefer NCBI sequence_report.tsv inputs for chromosome authority.
CHR_MAPPING = {
    'NC_006088.5': ('1', 'NC_052532.1'),
    'NC_006089.5': ('2', 'NC_052533.1'),
    'NC_006090.5': ('3', 'NC_052534.1'),
    'NC_006091.5': ('4', 'NC_052535.1'),
    'NC_006092.5': ('5', 'NC_052536.1'),
    'NC_006093.5': ('6', 'NC_052537.1'),
    'NC_006094.5': ('7', 'NC_052538.1'),
    'NC_006095.5': ('8', 'NC_052539.1'),
    'NC_006096.5': ('9', 'NC_052540.1'),
    'NC_006097.5': ('10', 'NC_052541.1'),
    'NC_006098.5': ('11', 'NC_052542.1'),
    'NC_006099.5': ('12', 'NC_052543.1'),
    'NC_006100.5': ('13', 'NC_052544.1'),
    'NC_006101.5': ('14', 'NC_052545.1'),
    'NC_006102.5': ('15', 'NC_052546.1'),
    'NC_006103.5': ('16', 'NC_052547.1'),
    'NC_006104.5': ('17', 'NC_052548.1'),
    'NC_006105.5': ('18', 'NC_052549.1'),
    'NC_006106.5': ('19', 'NC_052550.1'),
    'NC_006107.5': ('20', 'NC_052551.1'),
    'NC_006108.5': ('21', 'NC_052552.1'),
    'NC_006109.5': ('22', 'NC_052553.1'),
    'NC_006110.5': ('23', 'NC_052554.1'),
    'NC_006111.5': ('24', 'NC_052555.1'),
    'NC_006112.4': ('25', 'NC_052556.1'),
    'NC_006113.5': ('26', 'NC_052557.1'),
    'NC_006114.5': ('27', 'NC_052558.1'),
    'NC_006115.5': ('28', 'NC_052559.1'),
    'NC_008465.4': ('33', 'NC_052564.1'),
    'NC_028739.2': ('30', 'NC_052561.1'),
    'NC_028740.2': ('31', 'NC_052562.1'),
    'NC_006119.4': ('32', 'NC_052563.1'),
    'NC_006126.5': ('W', 'NC_052571.1'),
    'NC_006127.5': ('Z', 'NC_052572.1'),
    'NC_040902.1': ('MT', 'NC_053523.1'),
}

GRCG7B_REFSEQ_TO_CHR = {
    'NC_052560.1': '29',
    'NC_052564.1': '33',
    'NC_052565.1': '34',
    'NC_052566.1': '35',
    'NC_052567.1': '36',
    'NC_052568.1': '37',
    'NC_052569.1': '38',
    'NC_052570.1': '39',
    'NC_053523.1': 'MT',
}


@dataclass(frozen=True)
class PrimaryMolecule:
    chr_name: str
    refseq_accession: str
    genbank_accession: str
    seq_length: int


MappingRow = tuple[str, str, str, str, str, str, str | None, str | None, str, float]


def chromosome_sort_key(chr_name: str) -> tuple[int, int | str]:
    if chr_name.isdigit():
        return (0, int(chr_name))
    special_order = {"W": 1, "Z": 2, "MT": 3}
    return (1, special_order.get(chr_name, chr_name))


def load_primary_molecules(report_tsv: str | Path) -> dict[str, PrimaryMolecule]:
    """Load assembled chromosome/mitochondrial molecules from NCBI sequence_report.tsv."""
    molecules: dict[str, PrimaryMolecule] = {}
    with Path(report_tsv).open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            if row.get("Role", "").strip() != "assembled-molecule":
                continue
            if row.get("Molecule type", "").strip() not in {"Chromosome", "Mitochondrion"}:
                continue
            chr_name = row.get("Chromosome name", "").strip()
            refseq = row.get("RefSeq seq accession", "").strip()
            if not chr_name or not refseq:
                continue
            molecules[chr_name] = PrimaryMolecule(
                chr_name=chr_name,
                refseq_accession=refseq,
                genbank_accession=row.get("GenBank seq accession", "").strip(),
                seq_length=int(row.get("Seq length", "0")),
            )
    return molecules


def build_chromosome_mapping_rows(
    grcg6a_report: str | Path | None = None,
    grcg7b_report: str | Path | None = None,
) -> list[MappingRow]:
    """Build chromosome_mapping rows, preferably from NCBI sequence reports."""
    if bool(grcg6a_report) != bool(grcg7b_report):
        raise ValueError("Provide both GRCg6a and GRCg7b sequence reports, or neither.")

    if grcg6a_report and grcg7b_report:
        grcg6a = load_primary_molecules(grcg6a_report)
        grcg7b = load_primary_molecules(grcg7b_report)
        shared_chr_names = sorted(set(grcg6a) & set(grcg7b), key=chromosome_sort_key)
        return [
            (
                "GRCg6a",
                "GRCg7b",
                chr_name,
                chr_name,
                grcg6a[chr_name].refseq_accession,
                grcg7b[chr_name].refseq_accession,
                grcg6a[chr_name].genbank_accession or None,
                grcg7b[chr_name].genbank_accession or None,
                "+",
                1.0,
            )
            for chr_name in shared_chr_names
        ]

    rows: list[MappingRow] = []
    for nc6a, (chr_name, nc7b) in sorted(
        CHR_MAPPING.items(),
        key=lambda item: chromosome_sort_key(item[1][0]),
    ):
        rows.append((
            "GRCg6a",
            "GRCg7b",
            chr_name,
            normalize_chr7b(nc7b),
            nc6a,
            nc7b,
            None,
            None,
            "+",
            1.0,
        ))
    return rows


def normalize_chr(nc_accession: str) -> str:
    """Convert NC_ accession to chromosome name"""
    if nc_accession in CHR_MAPPING:
        return CHR_MAPPING[nc_accession][0]
    # Try partial match
    for nc, (chr_name, _) in CHR_MAPPING.items():
        if nc.split('.')[0] == nc_accession.split('.')[0]:
            return chr_name
    return nc_accession


def normalize_chr7b(nc_accession: str) -> str:
    """Convert GRCg7b NC_ accession to chromosome name"""
    for refseq, chr_name in GRCG7B_REFSEQ_TO_CHR.items():
        if refseq == nc_accession or refseq.split('.')[0] == nc_accession.split('.')[0]:
            return chr_name
    for nc, (chr_name, refseq) in CHR_MAPPING.items():
        if refseq.split('.')[0] == nc_accession.split('.')[0]:
            return chr_name
        if refseq == nc_accession:
            return chr_name
    return nc_accession


def import_chromosome_mapping(
    conn,
    *,
    reset_mapping_table: bool = False,
    grcg6a_report: str | Path | None = None,
    grcg7b_report: str | Path | None = None,
):
    """Import chromosome mapping between assemblies"""
    print("Importing chromosome mapping...")
    cur = conn.cursor()

    rows = build_chromosome_mapping_rows(grcg6a_report, grcg7b_report)
    if reset_mapping_table:
        cur.execute(
            """
            DELETE FROM chromosome_mapping
            WHERE assembly_from = %s AND assembly_to = %s
            """,
            ("GRCg6a", "GRCg7b"),
        )
        print(f"  Deleted {cur.rowcount} existing GRCg6a -> GRCg7b chromosome mappings")

    execute_values(cur, """
        INSERT INTO chromosome_mapping (
            assembly_from, assembly_to,
            chr_from, chr_to,
            refseq_from, refseq_to,
            genbank_from, genbank_to,
            strand, score
        ) VALUES %s
        ON CONFLICT DO NOTHING
    """, rows, page_size=100)

    conn.commit()
    cur.close()
    print(f"  Imported {len(rows)} chromosome mappings")


def import_blast_to_synteny(conn, blast_file: str):
    """Import BLAST output to synteny_block table"""
    print(f"Importing BLAST alignments from {blast_file}...")
    cur = conn.cursor()

    # BLAST outfmt 6 columns:
    # qseqid qlen qstart qend sseqid slen sstart send evalue bitscore length pident

    blocks = []
    paf_rows = []
    count = 0

    with open(blast_file, 'r') as f:
        for line in f:
            if line.startswith('#'):
                continue
            parts = line.strip().split('\t')
            if len(parts) < 12:
                continue

            qseqid = parts[0]
            qlen = int(parts[1])
            qstart = int(parts[2])
            qend = int(parts[3])
            sseqid = parts[4]
            slen = int(parts[5])
            sstart = int(parts[6])
            send = int(parts[7])
            evalue = float(parts[8])
            bitscore = float(parts[9])
            length = int(parts[10])
            pident = float(parts[11])

            # Normalize chromosome names
            chr_from = normalize_chr(qseqid)
            chr_to = normalize_chr7b(sseqid)

            # Determine strand
            strand = '+' if sstart <= send else '-'
            if strand == '-':
                sstart, send = send, sstart

            # Synteny block
            blocks.append((
                'GRCg6a', 'GRCg7b',
                chr_from, qstart, qend,
                chr_to, sstart, send,
                strand, bitscore, evalue, pident, length, 0
            ))

            # PAF alignment
            residue_matches = int(length * pident / 100)
            mapq = min(60, int(bitscore / 10))

            paf_rows.append((
                'GRCg6a', 'GRCg7b',
                qseqid, qlen, qstart, qend,
                strand,
                sseqid, slen, sstart, send,
                residue_matches, length, mapq, bitscore
            ))

            count += 1
            if count % 10000 == 0:
                print(f"  Processed {count:,} alignments...")

    # Insert synteny blocks
    print(f"  Inserting {len(blocks):,} synteny blocks...")
    execute_values(cur, """
        INSERT INTO synteny_block (
            assembly_1, assembly_2,
            chr_1, start_1, end_1,
            chr_2, start_2, end_2,
            strand, score, e_value, identity, alignment_length, gene_count
        ) VALUES %s
    """, blocks, page_size=5000)

    # Insert PAF alignments
    print(f"  Inserting {len(paf_rows):,} PAF alignments...")
    execute_values(cur, """
        INSERT INTO paf_alignment (
            assembly_1, assembly_2,
            query_name, query_length, query_start, query_end,
            strand,
            target_name, target_length, target_start, target_end,
            residue_matches, alignment_length, mapping_quality, score
        ) VALUES %s
    """, paf_rows, page_size=5000)

    conn.commit()
    cur.close()
    print(f"  Total: {count:,} alignments imported")


def import_gene_coordinates(conn, gff6a: str, gff7b: str):
    """Import gene coordinate mapping via gene symbols"""
    print("Importing gene coordinate mapping...")
    cur = conn.cursor()

    # Parse GRCg6a GFF for gene coordinates
    print("  Parsing GRCg6a GFF...")
    genes_6a = {}
    with open(gff6a, 'r') as f:
        for line in f:
            if line.startswith('#'):
                continue
            parts = line.strip().split('\t')
            if len(parts) < 9:
                continue
            if parts[2] != 'gene':
                continue

            chr_name = normalize_chr(parts[0])
            start = int(parts[3])
            end = int(parts[4])
            strand = parts[6]

            # Extract gene_id from attributes
            attrs = parts[8]
            gene_id = None
            for attr in attrs.split(';'):
                if attr.startswith('Dbxref=GeneID:'):
                    gene_id = 'gene-' + attr.split(':')[1]
                    break
                elif attr.startswith('ID=gene-'):
                    gene_id = attr.split('=')[1].split(';')[0]

            if gene_id:
                genes_6a[gene_id] = {
                    'chr': chr_name,
                    'start': start,
                    'end': end,
                    'strand': strand
                }

    print(f"    Found {len(genes_6a):,} genes in GRCg6a")

    # Parse GRCg7b GFF for gene coordinates
    print("  Parsing GRCg7b GFF...")
    genes_7b = {}
    gff7b_path = gff7b
    opener = gzip.open if gff7b.endswith('.gz') else open
    mode = 'rt' if gff7b.endswith('.gz') else 'r'

    with opener(gff7b_path, mode) as f:
        for line in f:
            if line.startswith('#'):
                continue
            parts = line.strip().split('\t')
            if len(parts) < 9:
                continue
            if parts[2] != 'gene':
                continue

            chr_name = normalize_chr7b(parts[0])
            start = int(parts[3])
            end = int(parts[4])
            strand = parts[6]

            # Extract gene_id from attributes
            attrs = parts[8]
            gene_id = None
            for attr in attrs.split(';'):
                if attr.startswith('Dbxref=GeneID:'):
                    gene_id = 'gene-' + attr.split(':')[1]
                    break
                elif attr.startswith('ID=gene-'):
                    gene_id = attr.split('=')[1].split(';')[0]

            if gene_id:
                genes_7b[gene_id] = {
                    'chr': chr_name,
                    'start': start,
                    'end': end,
                    'strand': strand
                }

    print(f"    Found {len(genes_7b):,} genes in GRCg7b")

    # Find matching genes
    common_genes = set(genes_6a.keys()) & set(genes_7b.keys())
    print(f"  Common genes: {len(common_genes):,}")

    # Build mapping rows
    rows = []
    for gene_id in common_genes:
        g6a = genes_6a[gene_id]
        g7b = genes_7b[gene_id]

        # Extract symbol from gene_id
        symbol = gene_id.replace('gene-', '')

        rows.append((
            gene_id, symbol,
            'GRCg6a', 'GRCg7b',
            g6a['chr'], g6a['start'], g6a['end'], g6a['strand'],
            g7b['chr'], g7b['start'], g7b['end'], g7b['strand'],
            'gene_symbol', 1.0
        ))

    print(f"  Inserting {len(rows):,} gene coordinate mappings...")
    execute_values(cur, """
        INSERT INTO gene_coordinate_mapping (
            gene_id, gene_symbol,
            assembly_from, assembly_to,
            chr_from, start_from, end_from, strand_from,
            chr_to, start_to, end_to, strand_to,
            mapping_method, confidence
        ) VALUES %s
    """, rows, page_size=5000)

    conn.commit()
    cur.close()
    print(f"  Done! {len(rows):,} gene mappings imported")


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Import comparative genomics data')
    parser.add_argument('--blast', help='BLAST output file (outfmt 6)')
    parser.add_argument('--gff6a', help='GRCg6a GFF file')
    parser.add_argument('--gff7b', help='GRCg7b GFF file')
    parser.add_argument('--chr-only', action='store_true', help='Only import chromosome mapping')
    parser.add_argument(
        '--reset-mapping-table',
        action='store_true',
        help='Delete existing GRCg6a -> GRCg7b chromosome mappings before import',
    )
    parser.add_argument('--grcg6a-report', help='NCBI GRCg6a sequence_report.tsv')
    parser.add_argument('--grcg7b-report', help='NCBI GRCg7b sequence_report.tsv')
    parser.add_argument('--dsn', default=PG_DSN, help='PostgreSQL DSN')
    args = parser.parse_args()

    conn = psycopg2.connect(args.dsn)

    # Always import chromosome mapping
    import_chromosome_mapping(
        conn,
        reset_mapping_table=args.reset_mapping_table,
        grcg6a_report=args.grcg6a_report,
        grcg7b_report=args.grcg7b_report,
    )

    if not args.chr_only:
        if args.blast:
            import_blast_to_synteny(conn, args.blast)
        if args.gff6a and args.gff7b:
            import_gene_coordinates(conn, args.gff6a, args.gff7b)

    conn.close()
    print("\nImport complete!")


if __name__ == '__main__':
    main()
