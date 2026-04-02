from __future__ import annotations

import sqlite3
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/annotations", tags=["annotations"])


def get_sql(request: Request) -> sqlite3.Connection:
    return request.app.state.sql


def amigo_url(go_id: str) -> str:
    return f"https://amigo.geneontology.org/amigo/term/{go_id.replace(':', '%3A')}"


def kegg_pathway_url(pathway_id: str) -> str:
    return f"https://www.kegg.jp/entry/{pathway_id}"


def load_gene_go(conn: sqlite3.Connection, gene_id: str) -> Dict[str, Any]:
    gene_row = conn.execute(
        """
        SELECT gene_id, gene_symbol, ncbi_gene_id, ensembl_gene_id
        FROM gene_xref
        WHERE gene_id = ?
        """,
        (gene_id,),
    ).fetchone()

    if gene_row is None:
        raise HTTPException(status_code=404, detail=f"gene_xref not found for {gene_id}")

    rows = conn.execute(
        """
        SELECT
            go_id,
            go_name,
            go_definition,
            go_namespace,
            evidence_code,
            source
        FROM gene_go
        WHERE gene_id = ?
        ORDER BY
            CASE go_namespace
                WHEN 'biological_process' THEN 1
                WHEN 'molecular_function' THEN 2
                WHEN 'cellular_component' THEN 3
                ELSE 9
            END,
            go_name,
            go_id
        """,
        (gene_id,),
    ).fetchall()

    items: List[Dict[str, Any]] = []
    summary = {
        "bp_count": 0,
        "mf_count": 0,
        "cc_count": 0,
        "total": 0,
    }

    for r in rows:
        ns = r["go_namespace"]
        if ns == "biological_process":
            summary["bp_count"] += 1
        elif ns == "molecular_function":
            summary["mf_count"] += 1
        elif ns == "cellular_component":
            summary["cc_count"] += 1

        items.append(
            {
                "go_id": r["go_id"],
                "go_name": r["go_name"],
                "go_definition": r["go_definition"],
                "go_namespace": r["go_namespace"],
                "evidence_code": r["evidence_code"],
                "source": r["source"],
                "official_link": amigo_url(r["go_id"]),
            }
        )

    summary["total"] = len(items)

    return {
        "gene_id": gene_row["gene_id"],
        "gene_symbol": gene_row["gene_symbol"],
        "ncbi_gene_id": gene_row["ncbi_gene_id"],
        "ensembl_gene_id": gene_row["ensembl_gene_id"],
        "summary": summary,
        "items": items,
    }


def load_gene_kegg(conn: sqlite3.Connection, gene_id: str) -> Dict[str, Any]:
    head = conn.execute(
        """
        SELECT
            x.gene_id,
            x.gene_symbol,
            x.ncbi_gene_id,
            k.kegg_gene_id
        FROM gene_xref x
        LEFT JOIN gene_kegg k ON x.gene_id = k.gene_id
        WHERE x.gene_id = ?
        """,
        (gene_id,),
    ).fetchone()

    if head is None:
        raise HTTPException(status_code=404, detail=f"gene_xref not found for {gene_id}")

    rows = conn.execute(
        """
        SELECT
            pathway_id,
            pathway_name,
            pathway_class
        FROM gene_kegg_pathway
        WHERE gene_id = ?
        ORDER BY pathway_name, pathway_id
        """,
        (gene_id,),
    ).fetchall()

    items: List[Dict[str, Any]] = []
    for r in rows:
        items.append(
            {
                "pathway_id": r["pathway_id"],
                "pathway_name": r["pathway_name"],
                "pathway_class": r["pathway_class"],
                "official_link": kegg_pathway_url(r["pathway_id"]),
            }
        )

    return {
        "gene_id": head["gene_id"],
        "gene_symbol": head["gene_symbol"],
        "ncbi_gene_id": head["ncbi_gene_id"],
        "kegg_gene_id": head["kegg_gene_id"],
        "summary": {
            "pathway_count": len(items),
        },
        "items": items,
    }


@router.get("/go/{gene_id}")
def get_gene_go(gene_id: str, request: Request):
    conn = get_sql(request)
    return load_gene_go(conn, gene_id)


@router.get("/kegg/{gene_id}")
def get_gene_kegg(gene_id: str, request: Request):
    conn = get_sql(request)
    return load_gene_kegg(conn, gene_id)


def attach_annotations_to_gene_page(
    conn: sqlite3.Connection,
    page: Dict[str, Any],
    gene_id: str,
) -> Dict[str, Any]:
    page["annotations"] = {
        "go": load_gene_go(conn, gene_id),
        "kegg": load_gene_kegg(conn, gene_id),
    }
    return page