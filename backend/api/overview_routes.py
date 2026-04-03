"""
Overview API Routes — ESC Atlas Global Charts

Prefix: /overview
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from overview_service import (
    SexBiasedGenesService,
    FemaleMaleScatterService,
    StageDEGCountService,
    Top50HeatmapService,
    PCAService,
    SampleCompositionService,
    ExpressionDistributionService,
    TrajectoryClustersService,
)

router = APIRouter(prefix="/overview", tags=["overview"])


def pg_conn(request: Request):
    """Get PG connection from app state or raise 503."""
    state = request.app.state
    get_conn = getattr(state, "pg_getconn", None)
    if get_conn is None:
        raise HTTPException(status_code=503, detail="PostgreSQL not configured")
    conn = get_conn()
    if conn is None:
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    return conn, state


def _ok(data: dict[str, Any]) -> JSONResponse:
    return JSONResponse(content={"status": "ok", **data})


@router.get("/sample_composition")
def sample_composition(request: Request):
    """Sample counts per stage × sex."""
    conn, state = pg_conn(request)
    try:
        svc = SampleCompositionService(conn)
        data = svc.load()
        return _ok(data)
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "detail": str(e)})
    finally:
        state.pg_putconn(conn)


@router.get("/sex_biased_genes")
def sex_biased_genes(request: Request):
    """Per-stage counts of Female_higher / Male_higher genes."""
    conn, state = pg_conn(request)
    try:
        svc = SexBiasedGenesService(conn)
        data = svc.load()
        return _ok(data)
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "detail": str(e)})
    finally:
        state.pg_putconn(conn)


@router.get("/female_male_scatter")
def female_male_scatter(
    request: Request,
    stage: str | None = Query(default=None, description="Filter by specific stage"),
):
    """All genes female_mean vs male_mean per stage."""
    conn, state = pg_conn(request)
    try:
        svc = FemaleMaleScatterService(conn)
        data = svc.load(stage=stage)
        return _ok(data)
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "detail": str(e)})
    finally:
        state.pg_putconn(conn)


@router.get("/stage_deg_count")
def stage_deg_count(request: Request):
    """Up/down DEG counts per stage transition."""
    conn, state = pg_conn(request)
    try:
        svc = StageDEGCountService(conn)
        data = svc.load()
        return _ok(data)
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "detail": str(e)})
    finally:
        state.pg_putconn(conn)


@router.get("/top50_heatmap")
def top50_heatmap(request: Request):
    """Top-50 most variable genes × 36 samples expression matrix."""
    conn, state = pg_conn(request)
    try:
        svc = Top50HeatmapService(conn)
        data = svc.load()
        return _ok(data)
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "detail": str(e)})
    finally:
        state.pg_putconn(conn)


@router.get("/pca")
def pca(request: Request):
    """Sample PCA coordinates (PC1, PC2)."""
    conn, state = pg_conn(request)
    try:
        svc = PCAService(conn)
        data = svc.load()
        return _ok(data)
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "detail": str(e)})
    finally:
        state.pg_putconn(conn)


@router.get("/expression_distribution")
def expression_distribution(request: Request):
    """Per-stage expression distribution quartiles."""
    conn, state = pg_conn(request)
    try:
        svc = ExpressionDistributionService(conn)
        data = svc.load()
        return _ok(data)
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "detail": str(e)})
    finally:
        state.pg_putconn(conn)


@router.get("/trajectory_clusters")
def trajectory_clusters(request: Request):
    """Gene trajectory clusters (k-means on stage-wise expression vectors)."""
    conn, state = pg_conn(request)
    try:
        svc = TrajectoryClustersService(conn)
        data = svc.load()
        return _ok(data)
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "detail": str(e)})
    finally:
        state.pg_putconn(conn)
