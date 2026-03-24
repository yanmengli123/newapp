# ========== 1. from __future__ 必须是文件第一行（核心修复语法错误） ==========
from __future__ import annotations
# 务必先导入 FileResponse
from fastapi.responses import FileResponse
# ========== 2. 统一导入（删除重复，按规范排序） ==========
import logging
import sqlite3
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

import requests
from fastapi import APIRouter, HTTPException, Request

from config import GRCG6A_STATIC_ROOT

# ========== 3. 全局配置（只定义一次，删除重复） ==========
router = APIRouter(prefix="/annotations", tags=["annotations"])
logger = logging.getLogger("grcg6a_fastapi_backend.annotations")

# KEGG基础配置
KEGG_BASE = "https://rest.kegg.jp"
KEGG_REQ_INTERVAL = 0.35  # <= 3 req/sec
KEGG_IMAGE_DIR = GRCG6A_STATIC_ROOT / "kegg_pathways"
KEGG_IMAGE_URL_PREFIX = "/static/kegg_pathways"

# ========== 4. 工具函数（删除重复，保留核心） ==========
def get_image_dir(request: Request) -> Path:
    return request.app.state.kegg_image_dir

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

# ========== 5. KEGG通路图片接口（仅读本地，返回 PNG 文件） ==========
# 注意：实际图片服务由 /kegg-images/{pathway_id}.png 提供（kegg_image_router.py）
# 此处通过 annotations 前缀提供元信息，由后续 /info 接口处理

# ========== 6. KEGG通路分类获取（保留原有逻辑，禁用写入） ==========
@lru_cache(maxsize=2048)
def fetch_kegg_pathway_class(pathway_id: str) -> str | None:
    url = f"https://rest.kegg.jp/get/{pathway_id}"
    logger.info("Fetching KEGG pathway class from %s", url)
    try:
        with urlopen(url, timeout=5) as response:
            body = response.read().decode("utf-8", errors="replace")
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
        logger.warning("KEGG response missing CLASS for pathway_id=%s", pathway_id)
        return None
    return " | ".join(collected)

def hydrate_kegg_pathway_class(
    read_conn: sqlite3.Connection,
    write_conn: sqlite3.Connection | None,
    pathway_id: str,
    current_value: str | None,
) -> str | None:
    """禁用数据库写入，仅返回已有的分类信息"""
    if current_value:
        return current_value
    # 仅读取，不写入数据库（避免只读权限错误）
    return fetch_kegg_pathway_class(pathway_id)

# ========== 7. GO注释加载（保留原有逻辑） ==========
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

# ========== 8. KEGG注释加载（禁用写入，避免只读错误） ==========
def load_gene_kegg(
    conn: sqlite3.Connection,
    gene_id: str,
    write_conn: sqlite3.Connection | None = None,
) -> Dict[str, Any]:
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
            p.pathway_id,
            p.pathway_name,
            p.pathway_class,
            i.image_url
        FROM gene_kegg_pathway p
        LEFT JOIN kegg_pathway_image i
          ON p.pathway_id = i.pathway_id
        WHERE p.gene_id = ?
        ORDER BY p.pathway_name, p.pathway_id
        """,
        (gene_id,),
    ).fetchall()

    items: List[Dict[str, Any]] = []
    for r in rows:
        # 禁用数据库写入，仅读取已有分类
        pathway_class = hydrate_kegg_pathway_class(
            conn,
            None,  # 强制传入None，禁用写入
            r["pathway_id"],
            r["pathway_class"],
        )
        items.append(
            {
                "pathway_id": r["pathway_id"],
                "pathway_name": r["pathway_name"],
                "pathway_class": pathway_class,
                "official_link": kegg_pathway_url(r["pathway_id"]),
                "image_url": r["image_url"],
                "image_api": f"/annotations/kegg/pathway/{r['pathway_id']}/image",
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


# go_kegg_routes.py 完整替换该函数
from fastapi.responses import FileResponse
from pathlib import Path
from fastapi import HTTPException


# 放在所有导入之后，路由定义之前
@router.get("/kegg/pathway/{pathway_id}/image", response_class=FileResponse)
def get_kegg_pathway_image(pathway_id: str):
    """强制返回图片，不依赖任何数据库/状态"""
    # 硬编码图片路径（避免app.state依赖问题）
    image_path = KEGG_IMAGE_DIR / f"{pathway_id}.png"

    # 1. 检查文件是否存在
    if not image_path.exists():
        raise HTTPException(status_code=404, detail=f"图片不存在：{image_path}")

    # 2. 检查文件是否是有效PNG（可选）
    if not image_path.suffix.lower() == ".png":
        raise HTTPException(status_code=400, detail="仅支持PNG格式图片")

    # 3. 强制返回图片
    return FileResponse(
        path=image_path,
        media_type="image/png",
        filename=f"{pathway_id}.png",
        # 禁用缓存（避免浏览器缓存旧数据）
        headers={"Cache-Control": "no-cache"}
    )


# 新增JSON信息接口（单独路由，避免冲突）
@router.get("/kegg/pathway/{pathway_id}/info")
def get_kegg_pathway_info(pathway_id: str, request: Request):
    conn = request.app.state.sql
    row = conn.execute(
        "SELECT pathway_name FROM gene_kegg_pathway WHERE pathway_id = ? LIMIT 1",
        (pathway_id,)
    ).fetchone()
    pathway_name = row["pathway_name"] if row else "Unknown"

    return {
        "pathway_id": pathway_id,
        "pathway_name": pathway_name,
        "image_url": f"/static/kegg_pathways/{pathway_id}.png",
        "official_link": f"https://www.kegg.jp/entry/{pathway_id}",
        "local_image_path": str(KEGG_IMAGE_DIR / f"{pathway_id}.png")
    }
# ========== 9. 路由接口（保留原有） ==========
@router.get("/go/{gene_id}")
def get_gene_go(gene_id: str, request: Request):
    conn = get_sql(request)
    gene_id = resolve_gene_id(request, gene_id)
    return load_gene_go(conn, gene_id)

# ========== 10. KEGG Annotations 接口（按优先级排序，静态路由优先） ==========

@router.get("/kegg/pathways")
def list_all_kegg_pathways(request: Request):
    """获取所有 KEGG 通路列表"""
    conn = get_sql(request)
    rows = conn.execute(
        """
        SELECT DISTINCT
            p.pathway_id,
            p.pathway_name,
            p.pathway_class,
            COUNT(DISTINCT p.gene_id) AS gene_count
        FROM gene_kegg_pathway p
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
            "official_link": kegg_pathway_url(r["pathway_id"]),
            "image_url": f"/annotations/kegg/pathway/{r['pathway_id']}/image",
        })

    return {
        "total": len(items),
        "items": items,
    }


@router.get("/kegg/{gene_id}")
def get_gene_kegg(gene_id: str, request: Request):
    conn = get_sql(request)
    gene_id = resolve_gene_id(request, gene_id)
    return load_gene_kegg(conn, gene_id, write_conn=None)


@router.get("/kegg/pathway/{pathway_id}")
def get_kegg_pathway_detail(pathway_id: str, request: Request):
    """获取 KEGG 通路详情（含成员基因列表）"""
    conn = get_sql(request)

    # 查询通路基本信息
    pathway_rows = conn.execute(
        """
        SELECT DISTINCT
            pathway_id,
            pathway_name,
            pathway_class
        FROM gene_kegg_pathway
        WHERE pathway_id = ?
        """,
        (pathway_id,),
    ).fetchall()

    if not pathway_rows:
        raise HTTPException(status_code=404, detail=f"Pathway not found: {pathway_id}")

    pathway_info = pathway_rows[0]

    # 查询通路成员基因
    gene_rows = conn.execute(
        """
        SELECT DISTINCT
            x.gene_id,
            x.gene_symbol,
            x.ncbi_gene_id,
            k.pathway_id,
            k.pathway_name
        FROM gene_kegg_pathway k
        JOIN gene_xref x ON k.gene_id = x.gene_id
        WHERE k.pathway_id = ?
        ORDER BY x.gene_symbol
        """,
        (pathway_id,),
    ).fetchall()

    genes = []
    for r in gene_rows:
        genes.append({
            "gene_id": r["gene_id"],
            "gene_symbol": r["gene_symbol"],
            "ncbi_gene_id": r["ncbi_gene_id"],
            "gene_link": f"/genes/{r['gene_id']}",
        })

    return {
        "pathway_id": pathway_id,
        "pathway_name": pathway_info["pathway_name"],
        "pathway_class": pathway_info["pathway_class"],
        "gene_count": len(genes),
        "genes": genes,
        "official_link": kegg_pathway_url(pathway_id),
        "image_url": f"/annotations/kegg/pathway/{pathway_id}/image",
        "mapdata_url": f"/annotations/kegg/pathway/{pathway_id}/mapdata",
        "interactive_url": f"/annotations/kegg/pathway/{pathway_id}/interactive",
    }


@router.get("/kegg/pathway/{pathway_id}/mapdata")
def get_kegg_pathway_mapdata(pathway_id: str, request: Request):
    """获取 KEGG 通路热区坐标数据（JSON）"""
    conn = get_sql(request)

    # 验证通路是否存在
    pathway_row = conn.execute(
        "SELECT pathway_id, pathway_name FROM gene_kegg_pathway WHERE pathway_id = ? LIMIT 1",
        (pathway_id,),
    ).fetchone()

    if not pathway_row:
        raise HTTPException(status_code=404, detail=f"Pathway not found: {pathway_id}")

    # 查询通路成员基因用于热区标注
    gene_rows = conn.execute(
        """
        SELECT
            x.gene_id,
            x.gene_symbol,
            g.start,
            g.end,
            g.strand,
            g.seqid
        FROM gene_kegg_pathway k
        JOIN gene_xref x ON k.gene_id = x.gene_id
        JOIN features g ON x.gene_id = g.id
        WHERE k.pathway_id = ?
        ORDER BY g.start
        """,
        (pathway_id,),
    ).fetchall()

    # 生成热区数据（基于基因位置分布）
    hotspots = []
    for r in gene_rows:
        # 简化的热区坐标：使用基因位置
        hotspots.append({
            "gene_id": r["gene_id"],
            "gene_symbol": r["gene_symbol"],
            "start": r["start"],
            "end": r["end"],
            "seqid": r["seqid"],
            "strand": r["strand"],
            "color": "#FF6B6B",  # 标注为通路相关基因
        })

    return {
        "pathway_id": pathway_id,
        "pathway_name": pathway_row["pathway_name"],
        "gene_count": len(hotspots),
        "hotspots": hotspots,
        "source": "grcg6a_annotation",
    }


@router.get("/kegg/pathway/{pathway_id}/interactive")
def get_kegg_pathway_interactive(pathway_id: str, request: Request):
    """获取 KEGG 通路可交互 HTML 页面数据"""
    conn = get_sql(request)

    # 验证通路是否存在
    pathway_row = conn.execute(
        "SELECT pathway_id, pathway_name FROM gene_kegg_pathway WHERE pathway_id = ? LIMIT 1",
        (pathway_id,),
    ).fetchone()

    if not pathway_row:
        raise HTTPException(status_code=404, detail=f"Pathway not found: {pathway_id}")

    # 返回交互页面所需的完整数据
    return {
        "pathway_id": pathway_id,
        "pathway_name": pathway_row["pathway_name"],
        "static_image": f"/annotations/kegg/pathway/{pathway_id}/image",
        "official_link": kegg_pathway_url(pathway_id),
        "api_data": f"/annotations/kegg/pathway/{pathway_id}",
        "message": "使用 image_url 加载静态图片，使用 api_data 获取基因数据",
    }


# ========== 10. KGML 缓存管理接口 ==========

@router.get("/kegg/kgml-cache/status")
def get_kgml_cache_status(request: Request):
    """获取 KGML 缓存状态"""
    cache_dir = KEGG_IMAGE_DIR / "kgml"
    if not cache_dir.exists():
        cache_dir.mkdir(parents=True, exist_ok=True)

    cached_files = []
    total_size = 0
    if cache_dir.exists():
        for f in cache_dir.glob("*.xml"):
            cached_files.append(f.name)
            total_size += f.stat().st_size

    return {
        "cache_enabled": True,
        "cache_dir": str(cache_dir),
        "cached_count": len(cached_files),
        "total_size_bytes": total_size,
        "cached_files": sorted(cached_files)[:20],  # 仅返回前20个
    }


@router.post("/kegg/kgml-cache/refresh/{pathway_id}")
def refresh_single_kgml_cache(pathway_id: str):
    """刷新单个通路的 KGML 缓存"""
    cache_dir = KEGG_IMAGE_DIR / "kgml"
    cache_dir.mkdir(parents=True, exist_ok=True)

    kgml_url = f"https://rest.kegg.jp/get/{pathway_id}/kgml"
    cache_file = cache_dir / f"{pathway_id}.xml"

    try:
        with urlopen(kgml_url, timeout=10) as response:
            kgml_content = response.read().decode("utf-8", errors="replace")
        with open(cache_file, "w", encoding="utf-8") as f:
            f.write(kgml_content)
        return {
            "success": True,
            "pathway_id": pathway_id,
            "cache_file": str(cache_file),
            "file_size": cache_file.stat().st_size,
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch KGML: {str(e)}")


@router.post("/kegg/kgml-cache/refresh")
def refresh_all_kgml_cache():
    """刷新所有通路的 KGML 缓存"""
    import sqlite3 as sql
    from config import GRCG6A_DB_PATH

    conn = sql.connect(str(GRCG6A_DB_PATH), check_same_thread=False)
    conn.row_factory = sql.Row
    rows = conn.execute("SELECT DISTINCT pathway_id FROM gene_kegg_pathway").fetchall()
    conn.close()

    pathway_ids = [r["pathway_id"] for r in rows]
    cache_dir = KEGG_IMAGE_DIR / "kgml"
    cache_dir.mkdir(parents=True, exist_ok=True)

    refreshed = []
    failed = []
    for pid in pathway_ids:
        kgml_url = f"https://rest.kegg.jp/get/{pid}/kgml"
        cache_file = cache_dir / f"{pid}.xml"
        try:
            with urlopen(kgml_url, timeout=10) as response:
                kgml_content = response.read().decode("utf-8", errors="replace")
            with open(cache_file, "w", encoding="utf-8") as f:
                f.write(kgml_content)
            refreshed.append(pid)
        except Exception:
            failed.append(pid)

    return {
        "total": len(pathway_ids),
        "refreshed": len(refreshed),
        "failed": len(failed),
        "failed_ids": failed[:10],  # 最多返回10个失败ID
    }


# ========== 11. 基因页面注释附加函数（保留原有） ==========
def attach_annotations_to_gene_page(
    conn: sqlite3.Connection,
    page: Dict[str, Any],
    gene_id: str,
    write_conn: sqlite3.Connection | None = None,
) -> Dict[str, Any]:
    """附加GO/KEGG注释到基因页面数据"""
    page["annotations"] = {
        "go": load_gene_go(conn, gene_id),
        "kegg": load_gene_kegg(conn, gene_id, write_conn=None),  # 禁用写入
    }
    return page








