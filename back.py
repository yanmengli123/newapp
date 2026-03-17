from __future__ import annotations

import os
import sqlite3
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import gffutils
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from api.go_kegg_routes import router as go_kegg_router
from api.go_kegg_routes import attach_annotations_to_gene_page
# ------------------------------------------------------------
# Config
# ------------------------------------------------------------
# Set GRCG6A_DB_PATH to your SQLite file, for example:
#   set GRCG6A_DB_PATH=D:\jbrowsedata\projectdata\grcg6a_nc.db
# Or on PowerShell:
#   $env:GRCG6A_DB_PATH = 'D:\jbrowsedata\projectdata\grcg6a_nc.db'
DB_PATH = Path(os.getenv("GRCG6A_DB_PATH", "./grcg6a_nc.db")).resolve()
APP_TITLE = "GRCg6a Gene API"
APP_VERSION = "0.1.0"


# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------
def decode_value(value: str | None) -> str | None:
    if value is None:
        return None
    return unquote(value)


def first_attr(feature: Any, key: str) -> str | None:
    vals = feature.attributes.get(key)
    if not vals:
        return None
    return decode_value(vals[0])


def normalize_transcript_acc(raw_id: str | None) -> str | None:
    if not raw_id:
        return None
    raw_id = raw_id.strip()
    if raw_id.startswith("rna-"):
        raw_id = raw_id[4:]
    return raw_id


def transcript_acc_from_feature(feature: Any) -> str | None:
    for key in ("transcript_id", "Name"):
        val = first_attr(feature, key)
        val = normalize_transcript_acc(val)
        if val:
            return val

    fid = normalize_transcript_acc(feature.id)
    if fid:
        return fid

    return None


def feature_length(feature: Any) -> int:
    return int(feature.end) - int(feature.start) + 1


def feature_to_range(feature: Any) -> dict[str, Any]:
    return {
        "seqid": feature.seqid,
        "start": int(feature.start),
        "end": int(feature.end),
        "strand": feature.strand,
        "length": feature_length(feature),
    }


def open_sqlite_ro(db_path: Path) -> sqlite3.Connection:
    # Use SQLite read-only mode for safety.
    uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


def gene_summary_from_feature(gene: Any) -> dict[str, Any]:
    gene_symbol = first_attr(gene, "gene") or first_attr(gene, "Name") or gene.id
    name = first_attr(gene, "Name") or gene_symbol
    biotype = first_attr(gene, "gene_biotype")
    return {
        "gene_id": gene.id,
        "gene_symbol": gene_symbol,
        "name": name,
        "biotype": biotype,
        "seqid": gene.seqid,
        "start": int(gene.start),
        "end": int(gene.end),
        "strand": gene.strand,
        "length": feature_length(gene),
    }


def order_segments_for_display(segments: list[dict[str, Any]], strand: str) -> list[dict[str, Any]]:
    # Database and GFF are coordinate-based, but for display it is usually more natural
    # to show negative-strand transcripts in transcription order.
    if strand == "-":
        return list(reversed(segments))
    return segments


# ------------------------------------------------------------
# App startup / shutdown
# ------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    if not DB_PATH.exists():
        raise RuntimeError(f"Database file not found: {DB_PATH}")

    gff_db = gffutils.FeatureDB(str(DB_PATH), keep_order=True)
    sql_conn = open_sqlite_ro(DB_PATH)

    # Build lightweight in-memory indexes for fast search and list endpoints.
    gene_index_by_id: dict[str, dict[str, Any]] = {}
    gene_index_by_symbol: dict[str, list[dict[str, Any]]] = defaultdict(list)
    genes_by_seqid: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for gene in gff_db.features_of_type("gene"):
        summary = gene_summary_from_feature(gene)
        gene_index_by_id[summary["gene_id"]] = summary
        genes_by_seqid[summary["seqid"]].append(summary)

        for key in {summary["gene_symbol"], summary["name"], summary["gene_id"]}:
            if key:
                gene_index_by_symbol[key.lower()].append(summary)

    for seqid, items in genes_by_seqid.items():
        items.sort(key=lambda x: x["start"])

    chromosome_rows = sql_conn.execute(
        "SELECT seqid, chr_name, length, description FROM chromosome ORDER BY length DESC"
    ).fetchall()
    chromosomes = [dict(row) for row in chromosome_rows]
    chromosome_by_seqid = {row["seqid"]: dict(row) for row in chromosome_rows}

    app.state.gff = gff_db
    app.state.sql = sql_conn
    app.state.gene_index_by_id = gene_index_by_id
    app.state.gene_index_by_symbol = gene_index_by_symbol
    app.state.genes_by_seqid = genes_by_seqid
    app.state.chromosomes = chromosomes
    app.state.chromosome_by_seqid = chromosome_by_seqid

    yield

    sql_conn.close()


app = FastAPI(
    title=APP_TITLE,
    version=APP_VERSION,
    description="FastAPI backend for NC_-only GRCg6a gene browsing built on grcg6a_nc.db",
    lifespan=lifespan,
)


app.include_router(go_kegg_router)



app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------
# Internal accessors
# ------------------------------------------------------------
def get_state(request: Request):
    return request.app.state


def get_gene_feature_or_404(state: Any, gene_id: str):
    try:
        feature = state.gff[gene_id]
    except Exception:
        raise HTTPException(status_code=404, detail=f"Gene not found: {gene_id}")
    if feature.featuretype != "gene":
        raise HTTPException(status_code=404, detail=f"Not a gene feature: {gene_id}")
    return feature


def get_chromosome_or_404(state: Any, seqid: str) -> dict[str, Any]:
    row = state.chromosome_by_seqid.get(seqid)
    if not row:
        raise HTTPException(status_code=404, detail=f"Chromosome not found: {seqid}")
    return row


def get_transcript_seq_row(sql_conn: sqlite3.Connection, transcript_acc: str | None) -> dict[str, Any] | None:
    if not transcript_acc:
        return None
    row = sql_conn.execute(
        "SELECT transcript_acc, transcript_id, gene_id, seqid, length, description, seq FROM transcript_seq WHERE transcript_acc = ?",
        (transcript_acc,),
    ).fetchone()
    return row_to_dict(row)


def get_cds_seq_row(sql_conn: sqlite3.Connection, protein_id: str | None) -> dict[str, Any] | None:
    if not protein_id:
        return None
    row = sql_conn.execute(
        "SELECT protein_id, gene_symbol, seqid, length, description, seq FROM cds_seq WHERE protein_id = ?",
        (protein_id,),
    ).fetchone()
    return row_to_dict(row)


def get_protein_seq_row(sql_conn: sqlite3.Connection, protein_id: str | None) -> dict[str, Any] | None:
    if not protein_id:
        return None
    row = sql_conn.execute(
        "SELECT protein_id, length, description, seq FROM protein_seq WHERE protein_id = ?",
        (protein_id,),
    ).fetchone()
    return row_to_dict(row)


def build_transcript_payload(state: Any, tx: Any, include_sequences: bool = False) -> dict[str, Any]:
    sql_conn = state.sql
    transcript_acc = transcript_acc_from_feature(tx)
    rna_row = get_transcript_seq_row(sql_conn, transcript_acc)

    exons = [
        {
            "exon_id": exon.id,
            **feature_to_range(exon),
        }
        for exon in state.gff.children(tx, featuretype="exon", order_by="start")
    ]
    exons = order_segments_for_display(exons, tx.strand)

    cds_features = list(state.gff.children(tx, featuretype="CDS", order_by="start"))
    cds_segments = [
        {
            "cds_id": cds.id,
            **feature_to_range(cds),
            "phase": cds.frame,
            "protein_id": first_attr(cds, "protein_id"),
            "product": first_attr(cds, "product"),
        }
        for cds in cds_features
    ]
    cds_segments = order_segments_for_display(cds_segments, tx.strand)

    protein_ids: list[str] = []
    for cds in cds_features:
        pid = first_attr(cds, "protein_id")
        if pid and pid not in protein_ids:
            protein_ids.append(pid)

    proteins: list[dict[str, Any]] = []
    for pid in protein_ids:
        cds_row = get_cds_seq_row(sql_conn, pid)
        protein_row = get_protein_seq_row(sql_conn, pid)

        protein_item = {
            "protein_id": pid,
            "has_cds_sequence": cds_row is not None,
            "cds_length": cds_row["length"] if cds_row else None,
            "has_protein_sequence": protein_row is not None,
            "protein_length": protein_row["length"] if protein_row else None,
            "protein_description": protein_row["description"] if protein_row else None,
        }

        if include_sequences:
            protein_item["cds_sequence"] = cds_row["seq"] if cds_row else None
            protein_item["protein_sequence"] = protein_row["seq"] if protein_row else None

        proteins.append(protein_item)

    payload = {
        "transcript_id": tx.id,
        "transcript_acc": transcript_acc,
        "feature_type": tx.featuretype,
        "gene_id": first_attr(tx, "Parent"),
        "gene_symbol": first_attr(tx, "gene"),
        "name": first_attr(tx, "Name"),
        "product": first_attr(tx, "product"),
        **feature_to_range(tx),
        "has_rna_sequence": rna_row is not None,
        "rna_length": rna_row["length"] if rna_row else None,
        "exon_count": len(exons),
        "cds_segment_count": len(cds_segments),
        "protein_count": len(proteins),
        "exons": exons,
        "cds_segments": cds_segments,
        "proteins": proteins,
    }

    if include_sequences:
        payload["rna_sequence"] = rna_row["seq"] if rna_row else None

    return payload


def build_gene_page(state: Any, gene_id: str, include_sequences: bool = False) -> dict[str, Any]:
    gene = get_gene_feature_or_404(state, gene_id)
    gene_summary = gene_summary_from_feature(gene)
    chromosome = get_chromosome_or_404(state, gene.seqid)

    transcripts = list(
        state.gff.children(gene, level=1, featuretype=("mRNA", "transcript"), order_by="start")
    )
    transcript_payloads = [
        build_transcript_payload(state, tx, include_sequences=include_sequences) for tx in transcripts
    ]

    return {
        "gene": gene_summary,
        "chromosome": chromosome,
        "transcript_count": len(transcript_payloads),
        "transcripts": transcript_payloads,
    }



from fastapi import HTTPException, Request


def _extract_gene_id_from_symbol_hit(hit):
    if hit is None:
        return None

    if isinstance(hit, str):
        return hit

    if isinstance(hit, dict):
        return hit.get("gene_id") or hit.get("id")

    gene_id = getattr(hit, "gene_id", None)
    if gene_id:
        return gene_id

    gene_id = getattr(hit, "id", None)
    if gene_id:
        return gene_id

    return None



# ------------------------------------------------------------
# Routes
# ------------------------------------------------------------
@app.get("/")
def root(request: Request):
    state = get_state(request)
    return {
        "name": APP_TITLE,
        "version": APP_VERSION,
        "db_path": str(DB_PATH),
        "gene_count": len(state.gene_index_by_id),
        "chromosome_count": len(state.chromosomes),
        "docs": "/docs",
    }


@app.get("/health")
def health(request: Request):
    state = get_state(request)
    row = state.sql.execute("SELECT COUNT(*) AS n FROM chromosome").fetchone()
    return {
        "ok": True,
        "db_path": str(DB_PATH),
        "chromosome_rows": row["n"],
        "gene_count": len(state.gene_index_by_id),
    }


@app.get("/chromosomes")
def list_chromosomes(request: Request):
    state = get_state(request)
    out = []
    for row in state.chromosomes:
        item = dict(row)
        item["gene_count"] = len(state.genes_by_seqid.get(row["seqid"], []))
        out.append(item)
    return out


@app.get("/chromosomes/{seqid}")
def get_chromosome(seqid: str, request: Request):
    state = get_state(request)
    row = get_chromosome_or_404(state, seqid)
    row = dict(row)
    row["gene_count"] = len(state.genes_by_seqid.get(seqid, []))
    return row


@app.get("/chromosomes/{seqid}/genes")
def list_genes_on_chromosome(
    seqid: str,
    request: Request,
    start: int | None = Query(default=None, ge=1),
    end: int | None = Query(default=None, ge=1),
    q: str | None = Query(default=None, description="Filter by gene_id / symbol / name"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    state = get_state(request)
    get_chromosome_or_404(state, seqid)

    genes = state.genes_by_seqid.get(seqid, [])

    def matches(item: dict[str, Any]) -> bool:
        if start is not None and item["end"] < start:
            return False
        if end is not None and item["start"] > end:
            return False
        if q:
            ql = q.lower()
            hay = " ".join([
                item["gene_id"] or "",
                item["gene_symbol"] or "",
                item["name"] or "",
            ]).lower()
            if ql not in hay:
                return False
        return True

    filtered = [g for g in genes if matches(g)]
    total = len(filtered)
    page = filtered[offset: offset + limit]

    return {
        "seqid": seqid,
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": page,
    }


@app.get("/search/genes")
def search_genes(
    request: Request,
    q: str = Query(..., min_length=1, description="Search gene_id / gene_symbol / name"),
    limit: int = Query(default=20, ge=1, le=200),
):
    state = get_state(request)
    ql = q.lower()

    exact: list[dict[str, Any]] = []
    startswith_hits: list[dict[str, Any]] = []
    contains_hits: list[dict[str, Any]] = []

    seen: set[str] = set()
    for item in state.gene_index_by_id.values():
        gene_id = (item["gene_id"] or "").lower()
        gene_symbol = (item["gene_symbol"] or "").lower()
        name = (item["name"] or "").lower()

        rank = None
        if ql in {gene_id, gene_symbol, name}:
            rank = "exact"
        elif gene_id.startswith(ql) or gene_symbol.startswith(ql) or name.startswith(ql):
            rank = "startswith"
        elif ql in gene_id or ql in gene_symbol or ql in name:
            rank = "contains"

        if rank is None or item["gene_id"] in seen:
            continue

        seen.add(item["gene_id"])
        if rank == "exact":
            exact.append(item)
        elif rank == "startswith":
            startswith_hits.append(item)
        else:
            contains_hits.append(item)

    results = exact + startswith_hits + contains_hits
    return {
        "q": q,
        "total": len(results),
        "items": results[:limit],
    }


@app.get("/genes/{gene_id}")
def get_gene(gene_id: str, request: Request):
    state = get_state(request)
    gene = get_gene_feature_or_404(state, gene_id)
    summary = gene_summary_from_feature(gene)
    summary["chromosome"] = get_chromosome_or_404(state, gene.seqid)
    return summary


@app.get("/genes/{gene_id}/transcripts")
def get_gene_transcripts(
    gene_id: str,
    request: Request,
    include_sequences: bool = Query(default=False),
):
    state = get_state(request)
    gene = get_gene_feature_or_404(state, gene_id)

    transcripts = list(
        state.gff.children(gene, level=1, featuretype=("mRNA", "transcript"), order_by="start")
    )
    items = [build_transcript_payload(state, tx, include_sequences=include_sequences) for tx in transcripts]

    return {
        "gene_id": gene_id,
        "transcript_count": len(items),
        "items": items,
    }


@app.get("/genes/{gene_id}/sequences")
def get_gene_sequences(gene_id: str, request: Request):
    state = get_state(request)
    gene = get_gene_feature_or_404(state, gene_id)

    transcripts = list(
        state.gff.children(gene, level=1, featuretype=("mRNA", "transcript"), order_by="start")
    )

    items = []
    for tx in transcripts:
        tx_payload = build_transcript_payload(state, tx, include_sequences=True)
        items.append(
            {
                "transcript_id": tx_payload["transcript_id"],
                "transcript_acc": tx_payload["transcript_acc"],
                "feature_type": tx_payload["feature_type"],
                "product": tx_payload["product"],
                "rna_sequence": tx_payload.get("rna_sequence"),
                "proteins": tx_payload["proteins"],
            }
        )

    return {
        "gene_id": gene_id,
        "transcript_sequences": items,
    }


# @app.get("/genes/{gene_id}/page")
# def get_gene_page(
#     gene_id: str,
#     request: Request,
#     include_sequences: bool = Query(default=False),
# ):
#     state = get_state(request)
#     return build_gene_page(state, gene_id, include_sequences=include_sequences)
@app.get("/genes/{gene_id}/page")
def get_gene_page(
    gene_id: str,
    request: Request,
    include_sequences: bool = Query(default=False),
):
    state = get_state(request)

    page = build_gene_page(state, gene_id, include_sequences=include_sequences)

    conn = getattr(state, "sql", None) or request.app.state.sql
    page = attach_annotations_to_gene_page(conn, page, gene_id)

    return page

# ------------------------------------------------------------
# Local dev entrypoint
# ------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "grcg6a_fastapi_backend:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
    )
