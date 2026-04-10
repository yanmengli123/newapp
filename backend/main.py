"""
GRCg6a Gene API — FastAPI backend entry point.
Only start with: uvicorn backend.main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import logging
import os
import sqlite3
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras
import psycopg2.pool
from urllib.parse import unquote

import gffutils
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import (
    GRCG6A_DB_PATH as DB_PATH,
    GRCG6A_PG_DSN as PG_DSN,
    GRCG6A_STATIC_ROOT as STATIC_ROOT,
    GRCG6A_RAWDATA_ROOT as RAWDATA_ROOT,
    KEGG_IMAGE_DIR,
    GRCG6A_GENOME_OUTPUT as GENOME_OUTPUT_DIR,
)
from backend.expression_service import ExpressionService, DatasetRegistry
from backend.api.go_kegg_routes import router as go_kegg_router
from backend.api.go_kegg_routes import attach_annotations_to_gene_page

APP_TITLE = "GRCg6a Gene API"
APP_VERSION = "0.1.0"

KEGG_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
GENOME_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=os.getenv("GRCG6A_LOG_LEVEL", "DEBUG").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("grcg6a_fastapi_backend")

# ─────────────────────────────────────────────
# PostgreSQL 连接池
# ─────────────────────────────────────────────
_pg_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def init_pg_pool(minconn=2, maxconn=10) -> psycopg2.pool.ThreadedConnectionPool:
    global _pg_pool
    if _pg_pool is None:
        _pg_pool = psycopg2.pool.ThreadedConnectionPool(minconn, maxconn, dsn=PG_DSN)
        logger.info("PostgreSQL pool initialized: min=%d max=%d", minconn, maxconn)
    return _pg_pool


def pg_getconn() -> psycopg2.extensions.connection:
    if _pg_pool is None:
        init_pg_pool()
    return _pg_pool.getconn()


def pg_putconn(conn: psycopg2.extensions.connection) -> None:
    if _pg_pool is not None:
        _pg_pool.putconn(conn)


def pg_getconn_with_fallback():
    if _pg_pool is None:
        return None
    if not getattr(pg_getconn, "_pg_available", True):
        return None
    try:
        return _pg_pool.getconn()
    except Exception:
        return None


def row_to_dict_pg(row) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


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
    uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def open_sqlite_rw(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
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
        "ncbi_gene_id": None,
        "seqid": gene.seqid,
        "start": int(gene.start),
        "end": int(gene.end),
        "strand": gene.strand,
        "length": feature_length(gene),
    }


def order_segments_for_display(segments: list[dict[str, Any]], strand: str) -> list[dict[str, Any]]:
    if strand == "-":
        return list(reversed(segments))
    return segments


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not DB_PATH.exists():
        raise RuntimeError(f"Database file not found: {DB_PATH}")

    pg_pool = init_pg_pool(minconn=2, maxconn=10)
    pg_conn = pg_getconn()
    pg_available = True
    try:
        with pg_conn.cursor() as cur:
            cur.execute("SELECT 1")
    except Exception:
        logger.warning("PostgreSQL not available — some endpoints may fail")
        pg_available = False
    finally:
        pg_putconn(pg_conn)

    pg_getconn._pg_available = pg_available

    gff_conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    gff_db = gffutils.FeatureDB(gff_conn, keep_order=True)
    sql_conn = open_sqlite_ro(DB_PATH)
    sql_write_conn = None
    try:
        sql_write_conn = open_sqlite_rw(DB_PATH)
    except Exception:
        logger.exception("Failed to open writable SQLite connection for %s", DB_PATH)

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

    xref_rows = sql_conn.execute(
        "SELECT gene_id, ncbi_gene_id FROM gene_xref WHERE ncbi_gene_id IS NOT NULL AND TRIM(ncbi_gene_id) != ''"
    ).fetchall()
    gene_xref_ncbi = {row["gene_id"]: row["ncbi_gene_id"] for row in xref_rows}
    for gene_id, summary in gene_index_by_id.items():
        summary["ncbi_gene_id"] = gene_xref_ncbi.get(gene_id)

    app.state.pg_pool = pg_pool
    app.state.pg_getconn = pg_getconn
    app.state.pg_putconn = pg_putconn
    app.state.pg_available = pg_available
    app.state.gff = gff_db
    app.state.gff_conn = gff_conn
    app.state.sql = sql_conn
    app.state.sql_write = sql_write_conn
    app.state.gene_index_by_id = gene_index_by_id
    app.state.gene_index_by_symbol = gene_index_by_symbol
    app.state.genes_by_seqid = genes_by_seqid
    app.state.chromosomes = chromosomes
    app.state.chromosome_by_seqid = chromosome_by_seqid
    app.state.kegg_image_dir = KEGG_IMAGE_DIR

    logger.info("App startup complete — gene_count=%d chromosome_count=%d pg_available=%s",
                len(gene_index_by_id), len(chromosomes), pg_available)

    yield

    sql_conn.close()
    gff_conn.close()
    if sql_write_conn is not None:
        sql_write_conn.close()
    global _pg_pool
    if _pg_pool is not None:
        _pg_pool.closeall()
        _pg_pool = None


app = FastAPI(
    title=APP_TITLE,
    version=APP_VERSION,
    description="FastAPI backend for GRCg6a gene browsing",
    lifespan=lifespan,
)

# ─────────────────────────────────────────────
# 静态文件挂载
# ─────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=str(STATIC_ROOT)), name="static")
# Genome files (FASTA/GFF/aliases) — JBrowse 用
app.mount("/genome", StaticFiles(directory=str(RAWDATA_ROOT.parent)), name="genome")

# ─────────────────────────────────────────────
# 路由注册（唯一入口）
# ─────────────────────────────────────────────
app.include_router(go_kegg_router)

from backend.api.kegg_image_router import kegg_image_router
from backend.api.tool_routes import router as tool_router
from backend.api.chat_router import router as chat_router
from backend.api.genome_analysis_routes import router as genome_router
from backend.api.overview_routes import router as overview_router

app.include_router(kegg_image_router)
app.include_router(tool_router)
app.include_router(chat_router)
app.include_router(genome_router)
app.include_router(overview_router)

# ─────────────────────────────────────────────
# CORS（可配置来源）
# ─────────────────────────────────────────────
_allowed_origins_str = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:5174")
_allowed_origins = [o.strip() for o in _allowed_origins_str.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# 异常处理器
# ─────────────────────────────────────────────
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    logger.warning("HTTPException %s %s status=%s", request.method, request.url.path, exc.status_code)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# ─────────────────────────────────────────────
# 内部访问器
# ─────────────────────────────────────────────
def get_state(request: Request):
    return request.app.state


def resolve_gene_id(state: Any, gene_id: str) -> str:
    if gene_id in state.gene_index_by_id:
        return gene_id
    hits = state.gene_index_by_symbol.get(gene_id.lower(), [])
    if len(hits) == 1:
        resolved = hits[0]["gene_id"]
        logger.info("Resolved gene alias %s -> %s", gene_id, resolved)
        return resolved
    return gene_id


def get_gene_feature_or_404(state: Any, gene_id: str):
    gene_id = resolve_gene_id(state, gene_id)
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
    candidates = [transcript_acc]
    normalized = normalize_transcript_acc(transcript_acc)
    if normalized and normalized not in candidates:
        candidates.append(normalized)
    prefixed = f"rna-{normalized}" if normalized else None
    if prefixed and prefixed not in candidates:
        candidates.append(prefixed)
    for candidate in candidates:
        row = sql_conn.execute(
            "SELECT transcript_acc, transcript_id, gene_id, seqid, length, description, seq "
            "FROM transcript_seq WHERE transcript_acc = ? OR transcript_id = ? LIMIT 1",
            (candidate, candidate),
        ).fetchone()
        if row is not None:
            return row_to_dict(row)
    return None


def get_cds_seq_row(sql_conn: sqlite3.Connection, protein_id: str | None) -> dict[str, Any] | None:
    if not protein_id:
        return None
    candidates = [protein_id]
    if protein_id.startswith("cds-"):
        stripped = protein_id[4:]
        if stripped not in candidates:
            candidates.append(stripped)
    else:
        prefixed = f"cds-{protein_id}"
        if prefixed not in candidates:
            candidates.append(prefixed)
    for candidate in candidates:
        row = sql_conn.execute(
            "SELECT protein_id, gene_symbol, seqid, length, description, seq "
            "FROM cds_seq WHERE protein_id = ? LIMIT 1",
            (candidate,),
        ).fetchone()
        if row is not None:
            return row_to_dict(row)
    return None


def get_protein_seq_row(sql_conn: sqlite3.Connection, protein_id: str | None) -> dict[str, Any] | None:
    if not protein_id:
        return None
    candidates = [protein_id]
    if protein_id.startswith("cds-"):
        stripped = protein_id[4:]
        if stripped not in candidates:
            candidates.append(stripped)
    for candidate in candidates:
        row = sql_conn.execute(
            "SELECT protein_id, length, description, seq FROM protein_seq WHERE protein_id = ? LIMIT 1",
            (candidate,),
        ).fetchone()
        if row is not None:
            return row_to_dict(row)
    return None


def build_transcript_payload(state: Any, tx: Any, include_sequences: bool = False) -> dict[str, Any]:
    sql_conn = state.sql
    transcript_acc = transcript_acc_from_feature(tx)
    rna_row = get_transcript_seq_row(sql_conn, transcript_acc)

    exons = [
        {"exon_id": exon.id, **feature_to_range(exon)}
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
    gene_id = resolve_gene_id(state, gene_id)
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


def load_gene_expression(pg_conn, gene_id: str, dataset: str | None = None, metric: str | None = None) -> dict[str, Any] | None:
    svc = ExpressionService(pg_conn)
    result = svc.load(gene_id, dataset=dataset, metric=metric)
    if result.get("status") == "no_data":
        return None
    return result


def unavailable_expression_response(gene_id: str) -> dict[str, Any]:
    return {
        "status": "unavailable",
        "gene_id": gene_id,
        "dataset": None,
        "metric": None,
        "samples": [],
        "summary": None
    }


def _build_unavailable_go_response(gene_id: str, gene_symbol: str) -> dict[str, Any]:
    return {
        "gene_id": gene_id,
        "gene_symbol": gene_symbol,
        "summary": {"bp_count": 0, "mf_count": 0, "cc_count": 0, "total": 0},
        "items": []
    }


def _build_unavailable_kegg_response(gene_id: str, gene_symbol: str) -> dict[str, Any]:
    return {
        "gene_id": gene_id,
        "gene_symbol": gene_symbol,
        "summary": {"pathway_count": 0},
        "items": []
    }


def safe_attach_xref_and_aliases(pg_conn, page: dict[str, Any]) -> None:
    try:
        with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT gene_type, is_canonical, display_symbol, ncbi_gene_id, ensembl_gene_id "
                "FROM gene_xref WHERE gene_id = %s",
                (page["gene"]["gene_id"],)
            )
            xref_row = cur.fetchone()
            if xref_row:
                page["gene"]["gene_type"] = xref_row["gene_type"]
                page["gene"]["is_canonical"] = xref_row["is_canonical"]
                page["gene"]["display_symbol"] = xref_row["display_symbol"]
                page["gene"]["ncbi_gene_id"] = xref_row["ncbi_gene_id"]
                page["gene"]["ensembl_gene_id"] = xref_row["ensembl_gene_id"]
            cur.execute("SELECT kegg_gene_id FROM gene_kegg WHERE gene_id = %s", (page["gene"]["gene_id"],))
            kegg_row = cur.fetchone()
            if kegg_row:
                page["gene"]["kegg_gene_id"] = kegg_row["kegg_gene_id"]
            cur.execute(
                "SELECT alias, alias_type, is_primary, source_dataset FROM gene_alias "
                "WHERE canonical_id = %s ORDER BY is_primary DESC, alias_type, alias",
                (page["gene"]["gene_id"],)
            )
            alias_rows = cur.fetchall()
            page["gene"]["aliases"] = [
                {"alias": r["alias"], "alias_type": r["alias_type"],
                 "is_primary": r["is_primary"], "source": r["source_dataset"]}
                for r in alias_rows
            ]
    except Exception:
        page["gene"]["aliases"] = []


def safe_attach_annotations(request: Request, page: dict[str, Any], gene_id: str) -> None:
    gene_id = page["gene"]["gene_id"]
    gene_sym = page["gene"].get("gene_symbol") or gene_id
    try:
        attach_annotations_to_gene_page(request, page, gene_id)
        page["annotations_status"] = "available"
        page["annotations_error"] = None
    except HTTPException:
        page["annotations"] = {
            "go": _build_unavailable_go_response(gene_id, gene_sym),
            "kegg": _build_unavailable_kegg_response(gene_id, gene_sym)
        }
        page["annotations_status"] = "unavailable"
        page["annotations_error"] = "service_unavailable"
    except Exception as e:
        page["annotations"] = {
            "go": _build_unavailable_go_response(gene_id, gene_sym),
            "kegg": _build_unavailable_kegg_response(gene_id, gene_sym)
        }
        page["annotations_status"] = "unavailable"
        page["annotations_error"] = "load_failed"
        logger.warning("Annotations load failed for %s: %s", gene_id, e)


def safe_attach_expression(pg_conn, gene_id: str) -> dict[str, Any]:
    try:
        expr = load_gene_expression(pg_conn, gene_id)
        if expr is None:
            return {"status": "no_data", "gene_id": gene_id, "dataset": None,
                    "metric": None, "samples": [], "summary": None}
        return expr
    except Exception:
        return unavailable_expression_response(gene_id)


# ─────────────────────────────────────────────
# 核心路由（保留在 main.py 的内联路由）
# ─────────────────────────────────────────────
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
    q: str | None = Query(default=None),
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
            hay = " ".join([item["gene_id"] or "", item["gene_symbol"] or "", item["name"] or ""]).lower()
            if ql not in hay:
                return False
        return True

    filtered = [g for g in genes if matches(g)]
    return {"seqid": seqid, "total": len(filtered), "offset": offset, "limit": limit, "items": filtered[offset:offset + limit]}


@app.get("/search/genes")
def search_genes(request: Request, q: str = Query(..., min_length=1), limit: int = Query(default=20, ge=1, le=200)):
    state = get_state(request)
    ql = q.lower()
    ranked_hits: list[tuple[int, str, str, dict[str, Any]]] = []
    seen: set[str] = set()
    for item in state.gene_index_by_id.values():
        gene_id = (item["gene_id"] or "").lower()
        gene_symbol = (item["gene_symbol"] or "").lower()
        name = (item["name"] or "").lower()
        ncbi_gene_id = str(item.get("ncbi_gene_id") or "").lower()
        rank = None
        if ql in {gene_id, gene_symbol, name, ncbi_gene_id}:
            rank = 0
        elif gene_id.startswith(ql) or gene_symbol.startswith(ql) or name.startswith(ql) or ncbi_gene_id.startswith(ql):
            rank = 1
        elif ql in gene_id or ql in gene_symbol or ql in name or ql in ncbi_gene_id:
            rank = 2
        if rank is None or item["gene_id"] in seen:
            continue
        seen.add(item["gene_id"])
        ranked_hits.append((rank, item.get("gene_symbol") or "", item.get("gene_id") or "", item))
    ranked_hits.sort(key=lambda entry: (entry[0], entry[1].lower(), entry[2].lower()))
    results = [entry[3] for entry in ranked_hits]
    return {"q": q, "total": len(results), "items": results[:limit]}


@app.get("/genes/{gene_id}")
def get_gene(gene_id: str, request: Request, include_sequences: bool = Query(default=False)):
    state = get_state(request)
    return build_gene_page(state, gene_id=gene_id, include_sequences=include_sequences)


@app.get("/genes/{gene_id}/transcripts")
def get_gene_transcripts(gene_id: str, request: Request, include_sequences: bool = Query(default=False)):
    state = get_state(request)
    gene = get_gene_feature_or_404(state, gene_id)
    transcripts = list(state.gff.children(gene, level=1, featuretype=("mRNA", "transcript"), order_by="start"))
    items = [build_transcript_payload(state, tx, include_sequences=include_sequences) for tx in transcripts]
    return {"gene_id": gene.id, "transcript_count": len(items), "items": items}


@app.get("/genes/{gene_id}/sequences")
def get_gene_sequences(gene_id: str, request: Request):
    state = get_state(request)
    gene = get_gene_feature_or_404(state, gene_id)
    transcripts = list(state.gff.children(gene, level=1, featuretype=("mRNA", "transcript"), order_by="start"))
    items = []
    for tx in transcripts:
        tx_payload = build_transcript_payload(state, tx, include_sequences=True)
        items.append({
            "transcript_id": tx_payload["transcript_id"],
            "transcript_acc": tx_payload["transcript_acc"],
            "feature_type": tx_payload["feature_type"],
            "product": tx_payload["product"],
            "rna_sequence": tx_payload.get("rna_sequence"),
            "proteins": tx_payload["proteins"],
        })
    return {"gene_id": gene.id, "transcript_sequences": items}


@app.get("/datasets")
def get_datasets(request: Request):
    state = get_state(request)
    pg_conn = pg_getconn_with_fallback()
    if pg_conn is None:
        return {"datasets": [], "status": "unavailable"}
    try:
        reg = DatasetRegistry(pg_conn)
        return {"datasets": reg.list_datasets()}
    finally:
        state.pg_putconn(pg_conn)


@app.get("/genes/{gene_id}/expression")
def get_gene_expression(
    gene_id: str,
    request: Request,
    dataset: str | None = Query(default=None),
    metric: str | None = Query(default=None),
    expand: bool = Query(default=False),
):
    state = get_state(request)
    resolved = resolve_gene_id(state, gene_id)
    get_gene_feature_or_404(state, resolved)
    pg_conn = pg_getconn_with_fallback()
    if pg_conn is None:
        return unavailable_expression_response(gene_id)
    try:
        svc = ExpressionService(pg_conn)
        if expand:
            return svc.load_all(resolved)
        return svc.load(resolved, dataset=dataset, metric=metric)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        state.pg_putconn(pg_conn)


@app.get("/genes/{gene_id}/page")
def get_gene_page(gene_id: str, request: Request, include_sequences: bool = Query(default=False)):
    state = get_state(request)
    logger.info("Building gene page for gene_id=%s include_sequences=%s", gene_id, include_sequences)
    try:
        page = build_gene_page(state, gene_id, include_sequences=include_sequences)
        pg_conn = pg_getconn_with_fallback()
        if pg_conn is not None:
            safe_attach_xref_and_aliases(pg_conn, page)
            state.pg_putconn(pg_conn)
        safe_attach_annotations(request, page, page["gene"]["gene_id"])
        pg_conn = pg_getconn_with_fallback()
        if pg_conn is not None:
            expr = safe_attach_expression(pg_conn, page["gene"]["gene_id"])
            state.pg_putconn(pg_conn)
        else:
            expr = unavailable_expression_response(page["gene"]["gene_id"])
        page["expression"] = expr
        return page
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to build gene page for gene_id=%s", gene_id)
        raise


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=False)
