"""KEGG pathway image serving router — 从 kegg_pathway_asset 表读取实际路径"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path

from config import GRCG6A_DB_PATH, GRCG6A_STATIC_ROOT

kegg_image_router = APIRouter(prefix="/kegg-images", tags=["kegg-images"])

KEGG_PNG_DIR = GRCG6A_STATIC_ROOT / "kegg_pathways"


def _get_asset_path(pathway_id: str) -> tuple[Path, bool]:
    """从 kegg_pathway_asset 表获取实际 PNG 路径，返回 (Path, exists)"""
    from config import GRCG6A_STATIC_ROOT
    conn = sqlite3.connect(str(GRCG6A_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT png_relpath FROM kegg_pathway_asset WHERE pathway_id = ?",
        (pathway_id,),
    ).fetchone()
    conn.close()

    if row and row["png_relpath"]:
        # png_relpath 格式: "static\kegg_pathways\{id}.png"，相对路径
        # 拼接 GRCG6A_STATIC_ROOT 的父目录（项目根目录）
        project_root = GRCG6A_STATIC_ROOT.parent
        relpath = row["png_relpath"].replace("\\", "/")
        return project_root / relpath, True
    return KEGG_PNG_DIR / f"{pathway_id}.png", False


@kegg_image_router.get("/{pathway_id}.png")
def get_kegg_image_direct(pathway_id: str):
    """通过 /kegg-images/gga00603.png 访问图片（从 asset 表读取路径）"""
    image_path, from_asset = _get_asset_path(pathway_id)

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
    """返回图片元信息（来自 kegg_pathway_asset 表）"""
    conn = sqlite3.connect(str(GRCG6A_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        """
        SELECT png_relpath, png_url, png_file_size, png_width, png_height
        FROM kegg_pathway_asset WHERE pathway_id = ?
        """,
        (pathway_id,),
    ).fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail=f"Pathway asset not found: {pathway_id}")

    image_path = Path(row["png_relpath"]) if row["png_relpath"] else KEGG_PNG_DIR / f"{pathway_id}.png"

    return {
        "pathway_id": pathway_id,
        "image_url": row["png_url"] or f"/kegg-images/{pathway_id}.png",
        "local_image_path": str(image_path),
        "file_exists": image_path.exists(),
        "file_size": row["png_file_size"] or (image_path.stat().st_size if image_path.exists() else 0),
        "width": row["png_width"] or 0,
        "height": row["png_height"] or 0,
    }
