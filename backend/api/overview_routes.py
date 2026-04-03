"""
Overview API Routes — ESC Atlas Global Charts

Prefix: /overview
"""

from __future__ import annotations

from typing import Any

import csv
import io
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

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


@router.get("/summary")
def overview_summary(request: Request):
    """
    All overview data in a single request — one DB round-trip.
    Returns all 8 chart data sets keyed by name.
    """
    conn, state = pg_conn(request)
    try:
        services = {
            "sample_composition":   SampleCompositionService(conn).load,
            "sex_biased_genes":     SexBiasedGenesService(conn).load,
            "female_male_scatter":  lambda: FemaleMaleScatterService(conn).load(),
            "stage_deg_count":      StageDEGCountService(conn).load,
            "expression_distribution": ExpressionDistributionService(conn).load,
            "pca":                 lambda: PCAService(conn).load(),
            "top50_heatmap":       Top50HeatmapService(conn).load,
            "trajectory_clusters":  TrajectoryClustersService(conn).load,
        }
        result = {}
        for key, loader in services.items():
            try:
                result[key] = loader()
            except Exception as e:
                result[key] = {"error": str(e)}
        return _ok(result)
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


# ─── CSV Export Endpoints ──────────────────────────────────────────────────────

@router.get("/sample_composition/csv")
def sample_composition_csv(request: Request):
    """Download Sample Composition data as CSV."""
    conn, state = pg_conn(request)
    try:
        svc = SampleCompositionService(conn)
        data = svc.load()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Stage", "Male", "Female"])
        for i, stage in enumerate(data["stages"]):
            writer.writerow([stage, data["male"][i], data["female"][i]])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=sample_composition.csv"},
        )
    finally:
        state.pg_putconn(conn)


@router.get("/sex_biased_genes/csv")
def sex_biased_genes_csv(request: Request):
    """Download Sex-Biased Genes data as CSV."""
    conn, state = pg_conn(request)
    try:
        svc = SexBiasedGenesService(conn)
        data = svc.load()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Stage", "Female_higher", "Male_higher"])
        for i, stage in enumerate(data["stages"]):
            writer.writerow([stage, data["female"][i], data["male"][i]])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=sex_biased_genes.csv"},
        )
    finally:
        state.pg_putconn(conn)


@router.get("/female_male_scatter/csv")
def female_male_scatter_csv(request: Request):
    """Download Female vs Male scatter data as CSV."""
    conn, state = pg_conn(request)
    try:
        svc = FemaleMaleScatterService(conn)
        data = svc.load()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Gene_ID", "Stage", "Female_Mean", "Male_Mean", "Sex_Bias_Label"])
        for g in data["genes"]:
            writer.writerow([g["gene_id"], g["stage"], g["female_mean"], g["male_mean"], g["sex_bias_label"]])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=female_male_scatter.csv"},
        )
    finally:
        state.pg_putconn(conn)


@router.get("/stage_deg_count/csv")
def stage_deg_count_csv(request: Request):
    """Download Stage DEG Count data as CSV."""
    conn, state = pg_conn(request)
    try:
        svc = StageDEGCountService(conn)
        data = svc.load()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Stage", "Up_regulated", "Down_regulated"])
        for i, stage in enumerate(data["stages"]):
            writer.writerow([stage, data["up"][i], data["down"][i]])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=stage_deg_count.csv"},
        )
    finally:
        state.pg_putconn(conn)


@router.get("/expression_distribution/csv")
def expression_distribution_csv(request: Request):
    """Download Expression Distribution data as CSV."""
    conn, state = pg_conn(request)
    try:
        svc = ExpressionDistributionService(conn)
        data = svc.load()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Stage", "Q1", "Median", "Q3", "Gene_Count"])
        for i, stage in enumerate(data["stages"]):
            writer.writerow([stage, data["q1"][i], data["median"][i], data["q3"][i], data["gene_count"][i]])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=expression_distribution.csv"},
        )
    finally:
        state.pg_putconn(conn)


@router.get("/pca/csv")
def pca_csv(request: Request):
    """Download PCA data as CSV."""
    conn, state = pg_conn(request)
    try:
        svc = PCAService(conn)
        data = svc.load()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Sample_Name", "Stage", "Sex", "PC1", "PC2"])
        for i, s in enumerate(data["samples"]):
            writer.writerow([s["sample_name"], s["stage"], s["sex"], data["pc1"][i], data["pc2"][i]])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=pca.csv"},
        )
    finally:
        state.pg_putconn(conn)


@router.get("/top50_heatmap/csv")
def top50_heatmap_csv(request: Request):
    """Download Top 50 Heatmap data as CSV."""
    conn, state = pg_conn(request)
    try:
        svc = Top50HeatmapService(conn)
        data = svc.load()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Gene_ID"] + data["samples"])
        for i, gene in enumerate(data["genes"]):
            writer.writerow([gene] + [data["matrix"][i][j] for j in range(len(data["samples"]))])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=top50_heatmap.csv"},
        )
    finally:
        state.pg_putconn(conn)


@router.get("/trajectory_clusters/csv")
def trajectory_clusters_csv(request: Request):
    """Download Trajectory Clusters data as CSV."""
    conn, state = pg_conn(request)
    try:
        svc = TrajectoryClustersService(conn)
        data = svc.load()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Cluster_ID", "Gene_Count", "Centroid"] + data["stages"])
        for c in data["clusters"]:
            centroid = data["centroids"][c["cluster_id"]]
            writer.writerow([c["cluster_id"], c["gene_count"]] + centroid)
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=trajectory_clusters.csv"},
        )
    finally:
        state.pg_putconn(conn)
