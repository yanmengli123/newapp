from __future__ import annotations

import argparse
import re
import sqlite3

import gffutils


def first_attr(feature, key: str):
    vals = feature.attributes.get(key)
    return vals[0] if vals else None


def extract_ncbi_gene_id(feature) -> str | None:
    dbx = feature.attributes.get("Dbxref", [])
    for item in dbx:
        m = re.search(r"GeneID:(\d+)", item)
        if m:
            return m.group(1)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, help="Path to grcg6a_nc.db")
    args = parser.parse_args()

    db = gffutils.FeatureDB(args.db, keep_order=True)
    conn = sqlite3.connect(args.db)
    cur = conn.cursor()

    inserted = 0
    updated = 0

    for gene in db.features_of_type("gene"):
        gene_id = gene.id
        gene_symbol = first_attr(gene, "gene") or first_attr(gene, "Name") or gene.id
        ncbi_gene_id = extract_ncbi_gene_id(gene)

        row = cur.execute(
            "SELECT gene_id FROM gene_xref WHERE gene_id = ?",
            (gene_id,),
        ).fetchone()

        if row:
            cur.execute(
                """
                UPDATE gene_xref
                SET gene_symbol = ?, ncbi_gene_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE gene_id = ?
                """,
                (gene_symbol, ncbi_gene_id, gene_id),
            )
            updated += 1
        else:
            cur.execute(
                """
                INSERT INTO gene_xref (gene_id, gene_symbol, ncbi_gene_id)
                VALUES (?, ?, ?)
                """,
                (gene_id, gene_symbol, ncbi_gene_id),
            )
            inserted += 1

    conn.commit()
    conn.close()

    print(f"inserted={inserted} updated={updated}")


if __name__ == "__main__":
    main()