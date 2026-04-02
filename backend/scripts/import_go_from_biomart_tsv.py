from __future__ import annotations

import argparse
import csv
import sqlite3


def clean(v):
    if v is None:
        return None
    v = str(v).strip()
    return v or None


def pick(row: dict, *names: str):
    for name in names:
        if name in row:
            v = clean(row.get(name))
            if v is not None:
                return v
    return None


def ensure_go_definition_column(cur: sqlite3.Cursor):
    cols = cur.execute("PRAGMA table_info(gene_go)").fetchall()
    col_names = {c[1] for c in cols}
    if "go_definition" not in col_names:
        cur.execute("ALTER TABLE gene_go ADD COLUMN go_definition TEXT")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, help="Path to grcg6a_nc.db")
    parser.add_argument("--tsv", required=True, help="BioMart GO TSV")
    parser.add_argument("--replace", action="store_true", help="Delete old GO rows before import")
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    cur = conn.cursor()

    ensure_go_definition_column(cur)

    if args.replace:
        cur.execute("DELETE FROM gene_go")

    inserted = 0
    unresolved = 0
    skipped_no_go = 0
    total_rows = 0

    with open(args.tsv, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")

        print("detected_headers=", reader.fieldnames)

        for row in reader:
            total_rows += 1

            ensembl_gene_id = pick(
                row,
                "ensembl_gene_id",
                "Ensembl Gene ID",
                "Gene stable ID",
            )
            gene_symbol = pick(
                row,
                "gene_symbol",
                "Gene name",
                "Gene Name",
            )
            ncbi_gene_id = pick(
                row,
                "ncbi_gene_id",
                "NCBI gene ID",
                "NCBI gene (formerly Entrezgene) ID",
            )
            go_id = pick(
                row,
                "go_id",
                "GO term accession",
                "GO ID",
            )
            go_name = pick(
                row,
                "go_name",
                "GO term name",
                "GO name",
            )
            go_definition = pick(
                row,
                "go_definition",
                "GO term definition",
            )
            go_namespace = pick(
                row,
                "go_namespace",
                "GO domain",
            )
            evidence_code = pick(
                row,
                "evidence_code",
                "GO term evidence code",
            )

            if not go_id:
                skipped_no_go += 1
                continue

            match = None

            if ensembl_gene_id:
                match = cur.execute(
                    """
                    SELECT gene_id, gene_symbol, ncbi_gene_id, ensembl_gene_id
                    FROM gene_xref
                    WHERE ensembl_gene_id = ?
                    """,
                    (ensembl_gene_id,),
                ).fetchone()

            if match is None and ncbi_gene_id:
                match = cur.execute(
                    """
                    SELECT gene_id, gene_symbol, ncbi_gene_id, ensembl_gene_id
                    FROM gene_xref
                    WHERE ncbi_gene_id = ?
                    """,
                    (ncbi_gene_id,),
                ).fetchone()

            if match is None and gene_symbol:
                match = cur.execute(
                    """
                    SELECT gene_id, gene_symbol, ncbi_gene_id, ensembl_gene_id
                    FROM gene_xref
                    WHERE gene_symbol = ?
                    """,
                    (gene_symbol,),
                ).fetchone()

            if match is None:
                unresolved += 1
                continue

            gene_id_db, gene_symbol_db, ncbi_gene_id_db, ensembl_gene_id_db = match

            if ensembl_gene_id and not ensembl_gene_id_db:
                cur.execute(
                    """
                    UPDATE gene_xref
                    SET ensembl_gene_id = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE gene_id = ?
                    """,
                    (ensembl_gene_id, gene_id_db),
                )

            exists = cur.execute(
                """
                SELECT 1
                FROM gene_go
                WHERE gene_id = ?
                  AND go_id = ?
                  AND COALESCE(go_namespace, '') = COALESCE(?, '')
                  AND COALESCE(evidence_code, '') = COALESCE(?, '')
                LIMIT 1
                """,
                (gene_id_db, go_id, go_namespace, evidence_code),
            ).fetchone()

            if exists:
                continue

            cur.execute(
                """
                INSERT INTO gene_go (
                    gene_id, gene_symbol, ncbi_gene_id, ensembl_gene_id,
                    go_id, go_name, go_definition, go_namespace, evidence_code, source
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ensembl_biomart')
                """,
                (
                    gene_id_db,
                    gene_symbol_db or gene_symbol,
                    ncbi_gene_id_db or ncbi_gene_id,
                    ensembl_gene_id_db or ensembl_gene_id,
                    go_id,
                    go_name,
                    go_definition,
                    go_namespace,
                    evidence_code,
                ),
            )
            inserted += 1

    conn.commit()
    conn.close()

    print(
        f"total_rows={total_rows} inserted={inserted} "
        f"unresolved={unresolved} skipped_no_go={skipped_no_go}"
    )


if __name__ == "__main__":
    main()