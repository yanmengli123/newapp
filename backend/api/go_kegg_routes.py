from __future__ import annotations

import logging
import sqlite3
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from config import GRCG6A_STATIC_ROOT

router = APIRouter(prefix="/annotations", tags=["annotations"])
logger = logging.getLogger("grcg6a_fastapi_backend")

# KEGG 基础配置
KEGG_BASE = "https://rest.kegg.jp"
KEGG_REQ_INTERVAL = 0.35
KEGG_PNG_DIR = GRCG6A_STATIC_ROOT / "kegg_pathways"
KEGG_KGML_DIR = GRCG6A_STATIC_ROOT / "kegg_kgml"
KEGG_IMAGE_URL_PREFIX = "/static/kegg_pathways"


# ========== 工具函数 ==========

def get_sql(request: Request) -> sqlite3.Connection:
    return request.app.state.sql


def resolve_gene_id(request: Request, gene_id: str) -> str:
    state = request.app.state
    if gene_id in state.gene_index_by_id:
        return gene_id
    hits = state.gene_index_by_symbol.get(gene_id.lower(), [])
    if len(hits) == 1:
        resolved = hits[0]["gene_id"]
        logger.info("Resolved annotation gene alias %s -> %s", gene_id, resolved)
        return resolved
    return gene_id


def amigo_url(go_id: str) -> str:
    return f"https://amigo.geneontology.org/amigo/term/{go_id.replace(':', '%3A')}"


def kegg_pathway_url(pathway_id: str) -> str:
    return f"https://www.kegg.jp/entry/{pathway_id}"


# ========== KEGG 通路 PNG 图片（静态文件） ==========

@router.get("/kegg/pathway/{pathway_id}/image", response_class=FileResponse)
def get_kegg_pathway_image(pathway_id: str):
    """返回 KEGG 通路 PNG 图片，从 kegg_pathway_asset 表读取实际路径"""
    # 查询 kegg_pathway_asset 获取实际文件路径
    from config import GRCG6A_DB_PATH
    conn = sqlite3.connect(str(GRCG6A_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT png_relpath FROM kegg_pathway_asset WHERE pathway_id = ?",
        (pathway_id,),
    ).fetchone()
    conn.close()

    if row and row["png_relpath"]:
        # png_relpath 格式: "static\kegg_pathways\{id}.png"，相对项目根目录
        project_root = GRCG6A_STATIC_ROOT.parent
        relpath = row["png_relpath"].replace("\\", "/")
        image_path = project_root / relpath
    else:
        image_path = KEGG_PNG_DIR / f"{pathway_id}.png"

    if not image_path.exists():
        raise HTTPException(status_code=404, detail=f"图片不存在：{image_path}")

    return FileResponse(
        path=image_path,
        media_type="image/png",
        filename=f"{pathway_id}.png",
        headers={"Cache-Control": "no-cache"},
    )


# ========== GO Annotations ==========

def load_gene_go(conn: sqlite3.Connection, gene_id: str) -> dict[str, Any]:
    gene_row = conn.execute(
        """
        SELECT gene_id, gene_symbol, ncbi_gene_id, ensembl_gene_id
        FROM gene_xref WHERE gene_id = ?
        """,
        (gene_id,),
    ).fetchone()

    if gene_row is None:
        raise HTTPException(status_code=404, detail=f"gene_xref not found for {gene_id}")

    rows = conn.execute(
        """
        SELECT go_id, go_name, go_definition, go_namespace,
               evidence_code, source
        FROM gene_go
        WHERE gene_id = ?
        ORDER BY
            CASE go_namespace
                WHEN 'biological_process' THEN 1
                WHEN 'molecular_function' THEN 2
                WHEN 'cellular_component' THEN 3
                ELSE 9
            END,
            go_name, go_id
        """,
        (gene_id,),
    ).fetchall()

    items: list[dict[str, Any]] = []
    summary = {"bp_count": 0, "mf_count": 0, "cc_count": 0, "total": 0}

    for r in rows:
        ns = r["go_namespace"]
        if ns == "biological_process":
            summary["bp_count"] += 1
        elif ns == "molecular_function":
            summary["mf_count"] += 1
        elif ns == "cellular_component":
            summary["cc_count"] += 1

        items.append({
            "go_id": r["go_id"],
            "go_name": r["go_name"],
            "go_definition": r["go_definition"],
            "go_namespace": r["go_namespace"],
            "evidence_code": r["evidence_code"],
            "source": r["source"],
            "official_link": amigo_url(r["go_id"]),
        })

    summary["total"] = len(items)

    return {
        "gene_id": gene_row["gene_id"],
        "gene_symbol": gene_row["gene_symbol"],
        "ncbi_gene_id": gene_row["ncbi_gene_id"],
        "ensembl_gene_id": gene_row["ensembl_gene_id"],
        "summary": summary,
        "items": items,
    }


# ========== KEGG Annotations ==========

def fetch_kegg_pathway_class(pathway_id: str) -> str | None:
    """从 KEGG REST API 获取通路分类"""
    url = f"{KEGG_BASE}/get/{pathway_id}"
    try:
        with urlopen(url, timeout=5) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except (HTTPError, URLError, Exception):
        logger.exception("Failed to fetch KEGG pathway class for %s", pathway_id)
        return None

    current_value: str | None = None
    collected: list[str] = []
    for raw_line in body.splitlines():
        if raw_line.startswith("CLASS"):
            current_value = raw_line[12:].strip()
            if current_value:
                collected.append(current_value)
            continue
        if collected and raw_line.startswith("            "):
            continuation = raw_line.strip()
            if continuation:
                collected.append(continuation)
            continue
        if collected:
            break

    if not collected:
        return None
    return " | ".join(collected)


def load_gene_kegg(conn: sqlite3.Connection, gene_id: str) -> dict[str, Any]:
    """加载基因的 KEGG 通路注释，带 png_url/kgml_url/mapdata_api（来自 kegg_pathway_asset）"""
    head = conn.execute(
        """
        SELECT x.gene_id, x.gene_symbol, x.ncbi_gene_id, k.kegg_gene_id
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
        SELECT DISTINCT
            p.pathway_id,
            p.pathway_name,
            p.pathway_class,
            a.png_url,
            a.png_width,
            a.png_height,
            a.kgml_filename
        FROM gene_kegg_pathway p
        LEFT JOIN kegg_pathway_asset a ON p.pathway_id = a.pathway_id
        WHERE p.gene_id = ?
        ORDER BY p.pathway_name, p.pathway_id
        """,
        (gene_id,),
    ).fetchall()

    items: list[dict[str, Any]] = []
    for r in rows:
        pathway_class = r["pathway_class"]
        if not pathway_class:
            pathway_class = fetch_kegg_pathway_class(r["pathway_id"])

        kgml_filename = r["kgml_filename"] or f"{r['pathway_id']}.kgml"

        items.append({
            "pathway_id": r["pathway_id"],
            "pathway_name": r["pathway_name"],
            "pathway_class": pathway_class,
            "official_link": kegg_pathway_url(r["pathway_id"]),
            "png_url": r["png_url"] or f"/static/kegg_pathways/{r['pathway_id']}.png",
            "png_width": r["png_width"] or 0,
            "png_height": r["png_height"] or 0,
            "kgml_url": f"/static/kegg_kgml/{kgml_filename}",
            "mapdata_api": f"/annotations/kegg/pathway/{r['pathway_id']}/mapdata",
            "interactive_api": f"/annotations/kegg/pathway/{r['pathway_id']}/interactive",
        })

    return {
        "gene_id": head["gene_id"],
        "gene_symbol": head["gene_symbol"],
        "ncbi_gene_id": head["ncbi_gene_id"],
        "kegg_gene_id": head["kegg_gene_id"],
        "summary": {"pathway_count": len(items)},
        "items": items,
    }


# ========== 路由接口（静态路由优先，参数路由在后） ==========

@router.get("/go/{gene_id}")
def get_gene_go(gene_id: str, request: Request):
    conn = get_sql(request)
    gene_id = resolve_gene_id(request, gene_id)
    return load_gene_go(conn, gene_id)


# === KEGG 静态路由（必须在参数路由之前） ===

@router.get("/kegg/pathways")
def list_all_kegg_pathways(request: Request):
    """获取所有 KEGG 通路列表（含 png_url/宽高，来自 kegg_pathway_asset）"""
    conn = get_sql(request)
    rows = conn.execute(
        """
        SELECT DISTINCT
            p.pathway_id,
            p.pathway_name,
            p.pathway_class,
            COUNT(DISTINCT p.gene_id) AS gene_count,
            a.png_url,
            a.png_width,
            a.png_height,
            a.node_count,
            a.gene_count AS annotated_gene_count
        FROM gene_kegg_pathway p
        LEFT JOIN kegg_pathway_asset a ON p.pathway_id = a.pathway_id
        GROUP BY p.pathway_id, p.pathway_name, p.pathway_class
        ORDER BY p.pathway_class, p.pathway_name
        """
    ).fetchall()

    items = []
    for r in rows:
        items.append({
            "pathway_id": r["pathway_id"],
            "pathway_name": r["pathway_name"],
            "pathway_class": r["pathway_class"] or "Unclassified",
            "gene_count": r["gene_count"],
            "node_count": r["node_count"] or 0,
            "annotated_gene_count": r["annotated_gene_count"] or 0,
            "official_link": kegg_pathway_url(r["pathway_id"]),
            "png_url": r["png_url"] or f"/static/kegg_pathways/{r['pathway_id']}.png",
            "png_width": r["png_width"] or 0,
            "png_height": r["png_height"] or 0,
            "image_api": f"/annotations/kegg/pathway/{r['pathway_id']}/image",
            "mapdata_api": f"/annotations/kegg/pathway/{r['pathway_id']}/mapdata",
            "info_api": f"/annotations/kegg/pathway/{r['pathway_id']}/info",
        })

    return {"total": len(items), "items": items}


@router.get("/kegg/pathway/{pathway_id}")
def get_kegg_pathway_detail(pathway_id: str, request: Request):
    """获取 KEGG 通路详情（含成员基因列表 + 资产信息）"""
    conn = get_sql(request)

    pathway_rows = conn.execute(
        """
        SELECT DISTINCT p.pathway_id, p.pathway_name, p.pathway_class,
               a.png_url, a.png_width, a.png_height,
               a.kgml_filename, a.node_count, a.gene_count AS annotated_gene_count
        FROM gene_kegg_pathway p
        LEFT JOIN kegg_pathway_asset a ON p.pathway_id = a.pathway_id
        WHERE p.pathway_id = ?
        """,
        (pathway_id,),
    ).fetchall()

    if not pathway_rows:
        raise HTTPException(status_code=404, detail=f"Pathway not found: {pathway_id}")

    p = pathway_rows[0]
    kgml_filename = p["kgml_filename"] or f"{pathway_id}.kgml"

    gene_rows = conn.execute(
        """
        SELECT DISTINCT x.gene_id, x.gene_symbol, x.ncbi_gene_id,
               k.kegg_gene_id
        FROM gene_kegg_pathway k
        JOIN gene_xref x ON k.gene_id = x.gene_id
        WHERE k.pathway_id = ?
        ORDER BY x.gene_symbol
        """,
        (pathway_id,),
    ).fetchall()

    genes = [{
        "gene_id": r["gene_id"],
        "gene_symbol": r["gene_symbol"],
        "ncbi_gene_id": r["ncbi_gene_id"],
        "kegg_gene_id": r["kegg_gene_id"],
        "gene_link": f"/genes/{r['gene_id']}",
    } for r in gene_rows]

    return {
        "pathway_id": pathway_id,
        "pathway_name": p["pathway_name"],
        "pathway_class": p["pathway_class"],
        "gene_count": len(genes),
        "node_count": p["node_count"] or 0,
        "annotated_gene_count": p["annotated_gene_count"] or 0,
        "png_width": p["png_width"] or 0,
        "png_height": p["png_height"] or 0,
        "genes": genes,
        "official_link": kegg_pathway_url(pathway_id),
        "png_url": p["png_url"] or f"/static/kegg_pathways/{pathway_id}.png",
        "image_api": f"/annotations/kegg/pathway/{pathway_id}/image",
        "kgml_url": f"/static/kegg_kgml/{kgml_filename}",
        "mapdata_api": f"/annotations/kegg/pathway/{pathway_id}/mapdata",
        "interactive_api": f"/annotations/kegg/pathway/{pathway_id}/interactive",
        "info_api": f"/annotations/kegg/pathway/{pathway_id}/info",
    }


@router.get("/kegg/pathway/{pathway_id}/info")
def get_kegg_pathway_info(pathway_id: str, request: Request):
    """获取通路元信息（来自 kegg_pathway_asset 表）"""
    conn = get_sql(request)
    row = conn.execute(
        """
        SELECT pathway_id, pathway_name, pathway_class,
               png_filename, png_url, png_file_size, png_width, png_height,
               kgml_filename, kgml_relpath, kgml_file_size,
               node_count, gene_count, created_at, updated_at
        FROM kegg_pathway_asset
        WHERE pathway_id = ?
        """,
        (pathway_id,),
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Pathway asset not found: {pathway_id}")

    return {
        "pathway_id": row["pathway_id"],
        "pathway_name": row["pathway_name"],
        "pathway_class": row["pathway_class"],
        "png": {
            "filename": row["png_filename"],
            "url": row["png_url"],
            "file_size": row["png_file_size"],
            "width": row["png_width"],
            "height": row["png_height"],
        },
        "kgml": {
            "filename": row["kgml_filename"],
            "relpath": row["kgml_relpath"],
            "file_size": row["kgml_file_size"],
        },
        "stats": {
            "node_count": row["node_count"],
            "gene_count": row["gene_count"],
        },
        "official_link": kegg_pathway_url(pathway_id),
        "image_api": f"/annotations/kegg/pathway/{pathway_id}/image",
        "mapdata_api": f"/annotations/kegg/pathway/{pathway_id}/mapdata",
        "interactive_api": f"/annotations/kegg/pathway/{pathway_id}/interactive",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.get("/kegg/pathway/{pathway_id}/mapdata")
def get_kegg_pathway_mapdata(pathway_id: str, request: Request):
    """
    获取通路节点坐标数据（来自 kegg_pathway_node + kegg_pathway_node_gene 表）。
    返回 nodes 数组，每项含 left/top/right/bottom/label/graphics_type/highlighted。
    highlighted=true 表示该节点包含通路注释基因。
    """
    conn = get_sql(request)

    # 验证通路
    asset_row = conn.execute(
        "SELECT pathway_id, pathway_name, png_width, png_height FROM kegg_pathway_asset WHERE pathway_id = ?",
        (pathway_id,),
    ).fetchone()

    if not asset_row:
        raise HTTPException(status_code=404, detail=f"Pathway not found: {pathway_id}")

    # 获取通路注释基因列表（来自 gene_kegg_pathway）用于高亮判断
    pathway_gene_ids: set[str] = set()
    kegg_gene_id_to_symbol: dict[str, str] = {}

    gene_rows = conn.execute(
        "SELECT gene_id, kegg_gene_id FROM gene_kegg_pathway WHERE pathway_id = ?",
        (pathway_id,),
    ).fetchall()
    for gr in gene_rows:
        if gr["kegg_gene_id"]:
            pathway_gene_ids.add(gr["kegg_gene_id"])

    # 从 gene_kegg 表解析 gene_symbol
    if pathway_gene_ids:
        placeholders = ",".join(["?"] * len(pathway_gene_ids))
        symbol_rows = conn.execute(
            f"SELECT kegg_gene_id, gene_symbol FROM gene_kegg WHERE kegg_gene_id IN ({placeholders})",
            list(pathway_gene_ids),
        ).fetchall()
        for sr in symbol_rows:
            kegg_gene_id_to_symbol[sr["kegg_gene_id"]] = sr["gene_symbol"]

    # 获取节点列表
    node_rows = conn.execute(
        """
        SELECT n.entry_id, n.entry_type, n.entry_name, n.graphics_type,
               n.x, n.y, n.width, n.height,
               n.left_x, n.top_y, n.right_x, n.bottom_y,
               n.raw_names, n.link_url,
               GROUP_CONCAT(ng.kegg_gene_id, ',') AS kegg_gene_ids
        FROM kegg_pathway_node n
        LEFT JOIN kegg_pathway_node_gene ng ON n.id = ng.node_id
        WHERE n.pathway_id = ?
        GROUP BY n.entry_id
        ORDER BY n.id
        """,
        (pathway_id,),
    ).fetchall()

    nodes = []
    for r in node_rows:
        kegg_ids = [k for k in (r["kegg_gene_ids"] or "").split(",") if k]
        highlighted = any(kid in pathway_gene_ids for kid in kegg_ids)

        gene_items = []
        for kid in kegg_ids:
            gene_items.append({
                "kegg_gene_id": kid,
                "gene_symbol": kegg_gene_id_to_symbol.get(kid),
                "in_pathway": kid in pathway_gene_ids,
            })

        nodes.append({
            "entry_id": r["entry_id"],
            "entry_type": r["entry_type"],
            "label": r["entry_name"],
            "graphics_type": r["graphics_type"],
            "x": r["x"],
            "y": r["y"],
            "width": r["width"],
            "height": r["height"],
            "left": r["left_x"],
            "top": r["top_y"],
            "right": r["right_x"],
            "bottom": r["bottom_y"],
            "genes": gene_items,
            "highlighted": highlighted,
            "link_url": r["link_url"],
        })

    # 统计高亮节点数
    highlighted_count = sum(1 for n in nodes if n["highlighted"])

    return {
        "pathway_id": pathway_id,
        "pathway_name": asset_row["pathway_name"],
        "png_width": asset_row["png_width"] or 0,
        "png_height": asset_row["png_height"] or 0,
        "total_nodes": len(nodes),
        "highlighted_nodes": highlighted_count,
        "pathway_gene_count": len(pathway_gene_ids),
        "nodes": nodes,
        "source": "kegg_pathway_node + kegg_pathway_node_gene",
    }


@router.get("/kegg/pathway/{pathway_id}/interactive")
def get_kegg_pathway_interactive(pathway_id: str, request: Request, gene_id: str | None = None):
    """获取通路可交互 HTML 渲染所需的完整数据。gene_id 用于返回目标基因信息。"""
    conn = get_sql(request)

    asset_row = conn.execute(
        "SELECT pathway_id, pathway_name FROM kegg_pathway_asset WHERE pathway_id = ?",
        (pathway_id,),
    ).fetchone()

    if not asset_row:
        raise HTTPException(status_code=404, detail=f"Pathway not found: {pathway_id}")

    # 解析目标基因
    target_gene: str | None = None
    if gene_id:
        row = conn.execute(
            "SELECT gene_symbol FROM gene_xref WHERE gene_id = ?",
            (gene_id,),
        ).fetchone()
        if row:
            target_gene = row["gene_symbol"]

    kgml_file = KEGG_KGML_DIR / f"{pathway_id}.kgml"
    kgml_content: str | None = None
    if kgml_file.exists():
        kgml_content = kgml_file.read_text(encoding="utf-8", errors="replace")

    return {
        "pathway_id": pathway_id,
        "pathway_name": asset_row["pathway_name"],
        "png_width": 0,   # 前端从 mapdata 获取实际宽高
        "png_height": 0,
        "target_gene": target_gene,
        "static_image": f"/annotations/kegg/pathway/{pathway_id}/image",
        "official_link": kegg_pathway_url(pathway_id),
        "mapdata_api": f"/annotations/kegg/pathway/{pathway_id}/mapdata",
        "detail_api": f"/annotations/kegg/pathway/{pathway_id}",
        "info_api": f"/annotations/kegg/pathway/{pathway_id}/info",
        "kgml_available": kgml_content is not None,
        "kgml_preview": kgml_content[:500] + "..." if kgml_content and len(kgml_content) > 500 else kgml_content,
        "message": "使用 mapdata_api 获取节点坐标进行 SVG 叠加渲染",
    }


# ========== KGML 缓存管理 ==========

@router.get("/kegg/kgml-cache/status")
def get_kgml_cache_status(request: Request):
    """获取 KGML 缓存状态"""
    kgml_dir = KEGG_KGML_DIR
    kgml_dir.mkdir(parents=True, exist_ok=True)

    cached_files = []
    total_size = 0
    for f in kgml_dir.glob("*.kgml"):
        cached_files.append(f.name)
        total_size += f.stat().st_size

    return {
        "cache_enabled": True,
        "cache_dir": str(kgml_dir),
        "cached_count": len(cached_files),
        "total_size_bytes": total_size,
        "cached_files": sorted(cached_files)[:20],
    }


@router.post("/kegg/kgml-cache/refresh/{pathway_id}")
def refresh_single_kgml_cache(pathway_id: str):
    """刷新单个通路的 KGML 缓存"""
    kgml_dir = KEGG_KGML_DIR
    kgml_dir.mkdir(parents=True, exist_ok=True)

    kgml_url = f"{KEGG_BASE}/get/{pathway_id}/kgml"
    cache_file = kgml_dir / f"{pathway_id}.kgml"

    try:
        with urlopen(kgml_url, timeout=10) as resp:
            kgml_content = resp.read().decode("utf-8", errors="replace")
        cache_file.write_text(kgml_content, encoding="utf-8")
        return {
            "success": True,
            "pathway_id": pathway_id,
            "cache_file": str(cache_file),
            "file_size": cache_file.stat().st_size,
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch KGML: {e}")


@router.post("/kegg/kgml-cache/refresh")
def refresh_all_kgml_cache(request: Request):
    """批量刷新所有通路的 KGML 缓存"""
    conn = get_sql(request)
    rows = conn.execute(
        "SELECT DISTINCT pathway_id FROM gene_kegg_pathway"
    ).fetchall()
    pathway_ids = [r["pathway_id"] for r in rows]

    kgml_dir = KEGG_KGML_DIR
    kgml_dir.mkdir(parents=True, exist_ok=True)

    refreshed: list[str] = []
    failed: list[str] = []
    for pid in pathway_ids:
        kgml_url = f"{KEGG_BASE}/get/{pid}/kgml"
        cache_file = kgml_dir / f"{pid}.kgml"
        try:
            with urlopen(kgml_url, timeout=10) as resp:
                kgml_content = resp.read().decode("utf-8", errors="replace")
            cache_file.write_text(kgml_content, encoding="utf-8")
            refreshed.append(pid)
        except Exception:
            failed.append(pid)

    return {
        "total": len(pathway_ids),
        "refreshed": len(refreshed),
        "failed": len(failed),
        "failed_ids": failed[:10],
    }


# === KEGG 参数路由（必须在所有静态路由之后） ===

@router.get("/kegg/{gene_id}")
def get_gene_kegg(gene_id: str, request: Request):
    """加载基因的 KEGG 通路注释（含 png_url/kgml_url/mapdata_api）"""
    conn = get_sql(request)
    gene_id = resolve_gene_id(request, gene_id)
    return load_gene_kegg(conn, gene_id)


# ========== 基因页面注释附加 ==========

def attach_annotations_to_gene_page(
    conn: sqlite3.Connection,
    page: dict[str, Any],
    gene_id: str,
    write_conn: sqlite3.Connection | None = None,  # 已禁用写入，仅保留兼容性
) -> dict[str, Any]:
    """附加 GO/KEGG 注释到基因页面数据，KEGG 项含 png_url/kgml_url/mapdata_api"""
    page["annotations"] = {
        "go": load_gene_go(conn, gene_id),
        "kegg": load_gene_kegg(conn, gene_id),
    }
    return page
