"""Versioned API routes for the ChickenData family/domain annotation catalog."""

from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query
from starlette.responses import FileResponse

from backend.config import GRCG6A_GENE_FAMILY_DB, GRCG6A_GENE_FAMILY_RELEASE_ROOT
from backend.gene_family_service import GeneFamilyCatalogService


catalog_router = APIRouter(
    prefix="/api/v1/gene-family-catalog",
    tags=["Gene Family Catalog"],
)
gene_annotation_router = APIRouter(prefix="/api/v1", tags=["Gene Family Catalog"])


@lru_cache(maxsize=1)
def service() -> GeneFamilyCatalogService:
    return GeneFamilyCatalogService(GRCG6A_GENE_FAMILY_DB, GRCG6A_GENE_FAMILY_RELEASE_ROOT)


def _service_or_503() -> GeneFamilyCatalogService:
    instance = service()
    if not instance.available():
        raise HTTPException(status_code=503, detail="Gene-family catalog release is not available")
    return instance


def _bad_cursor(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


@catalog_router.get("/releases/current")
def current_release():
    return _service_or_503().current_release()


@catalog_router.get("/summary")
def catalog_summary():
    return _service_or_503().summary()


@catalog_router.get("/search")
def catalog_search(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=12, ge=1, le=25),
):
    return _service_or_503().search(q, limit)


@catalog_router.get("/entries")
def entries(
    scheme: str | None = None,
    entry_type: str | None = None,
    query: str | None = Query(default=None, max_length=200),
    include_candidates: bool = False,
    sort: str = Query(default="accepted_genes", pattern="^(accepted_genes|candidate_genes|name)$"),
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
):
    try:
        return _service_or_503().list_entries(
            scheme=scheme,
            entry_type=entry_type,
            query=query,
            include_candidates=include_candidates,
            sort=sort,
            cursor=cursor,
            limit=limit,
        )
    except ValueError as exc:
        raise _bad_cursor(exc) from exc


@catalog_router.get("/entries/{entry_id}")
def entry(entry_id: str):
    result = _service_or_503().entry(entry_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Catalog entry not found: {entry_id}")
    return result


@catalog_router.get("/entries/{entry_id}/members")
def entry_members(
    entry_id: str,
    include_candidates: bool = False,
    assertion_state: str | None = Query(
        default=None, pattern="^(accepted|candidate|unresolved|rejected|withdrawn)$"
    ),
    support_tier: str | None = None,
    review_state: str | None = Query(
        default=None, pattern="^(not_required|unreviewed|in_review|approved|rejected|needs_mapping)$"
    ),
    assignment_role: str | None = Query(default=None, pattern="^(primary|secondary|supplementary)$"),
    query: str | None = Query(default=None, max_length=200),
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
):
    if _service_or_503().entry(entry_id) is None:
        raise HTTPException(status_code=404, detail=f"Catalog entry not found: {entry_id}")
    try:
        return _service_or_503().entry_members(
            entry_id,
            include_candidates=include_candidates,
            assertion_state=assertion_state,
            support_tier=support_tier,
            review_state=review_state,
            assignment_role=assignment_role,
            query=query,
            cursor=cursor,
            limit=limit,
        )
    except ValueError as exc:
        raise _bad_cursor(exc) from exc


@catalog_router.get("/entries/{entry_id}/evidence")
def entry_evidence(
    entry_id: str,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
):
    if _service_or_503().entry(entry_id) is None:
        raise HTTPException(status_code=404, detail=f"Catalog entry not found: {entry_id}")
    try:
        return _service_or_503().entry_evidence(entry_id, cursor=cursor, limit=limit)
    except ValueError as exc:
        raise _bad_cursor(exc) from exc


@catalog_router.get("/assertions/{assertion_id}")
def assertion(assertion_id: str):
    result = _service_or_503().assertion(assertion_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Assertion not found: {assertion_id}")
    return result


@catalog_router.get("/releases/{release_id}/downloads")
def release_downloads(release_id: str):
    assets = _service_or_503().downloads(release_id)
    if not assets:
        raise HTTPException(status_code=404, detail=f"Catalog release not found: {release_id}")
    return {"release_id": release_id, "data": assets}


@catalog_router.get("/releases/{release_id}/downloads/{asset_name}")
def release_download(release_id: str, asset_name: str):
    path = _service_or_503().download_path(release_id, asset_name)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Release asset not found: {asset_name}")
    return FileResponse(path, filename=path.name, media_type="application/octet-stream")


@gene_annotation_router.get("/genes/{internal_gene_id}/family-annotations")
def gene_family_annotations(internal_gene_id: str):
    return _service_or_503().gene_annotations(internal_gene_id)


@gene_annotation_router.get("/proteins/{protein_id}/domain-hits")
def protein_domain_hits(protein_id: str):
    result = _service_or_503().protein_domain_hits(protein_id)
    if result["total"] == 0:
        raise HTTPException(status_code=404, detail=f"Protein domain hits not found: {protein_id}")
    return result

