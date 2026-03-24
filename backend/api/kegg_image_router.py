"""KEGG pathway image serving router."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path

from config import GRCG6A_STATIC_ROOT

# Served at /kegg-images/
kegg_image_router = APIRouter(prefix="/kegg-images", tags=["kegg-images"])

KEGG_IMAGE_DIR = GRCG6A_STATIC_ROOT / "kegg_pathways"


@kegg_image_router.get("/{pathway_id}.png")
def get_kegg_image_direct(pathway_id: str):
    """直接通过 /kegg-images/gga00603.png 访问图片"""
    image_path = KEGG_IMAGE_DIR / f"{pathway_id}.png"

    if not image_path.exists():
        raise HTTPException(status_code=404, detail=f"图片不存在：{image_path}")

    return FileResponse(
        path=image_path,
        media_type="image/png",
        filename=f"{pathway_id}.png",
        headers={"Cache-Control": "no-cache"}
    )


@kegg_image_router.get("/{pathway_id}/info")
def get_kegg_image_info(pathway_id: str):
    image_path = KEGG_IMAGE_DIR / f"{pathway_id}.png"
    return {
        "pathway_id": pathway_id,
        "image_url": f"/kegg-images/{pathway_id}.png",
        "local_image_path": str(image_path),
        "file_exists": image_path.exists(),
        "file_size": image_path.stat().st_size if image_path.exists() else 0
    }
