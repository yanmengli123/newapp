# ========== 1. from __future__ 必须是文件第一行（核心修复语法错误） ==========
from __future__ import annotations
# 务必先导入 FileResponse
from fastapi.responses import FileResponse
# ========== 2. 统一导入（删除重复，按规范排序） ==========
import logging
import os
import sys
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

import psycopg2.extras
import requests
from fastapi import APIRouter, HTTPException, Request

# 添加 backend 目录到 sys.path 以便导入 config
_backend_dir = Path(__file__).parent.parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from config import KEGG_IMAGE_DIR, GRCG6A_STATIC_ROOT

# ========== 3. 全局配置（只定义一次，删除重复） ==========
router = APIRouter(prefix="/annotations", tags=["annotations"])
logger = logging.getLogger("grcg6a_fastapi_backend.annotations")

# KEGG基础配置
KEGG_BASE = "https://rest.kegg.jp"
KEGG_REQ_INTERVAL = 0.35  # <= 3 req/sec
KEGG_IMAGE_URL_PREFIX = "/static/kegg_pathways"

# ========== 4. 工具函数（dual-DB: PostgreSQL 专用） ==========

def get_pg(request: Request):
    """获取 PostgreSQL 连接（从连接池）。Layer 2 运行时保护：连接失败返回 503。"""
    try:
        return request.app.state.pg_getconn()
    except Exception as e:
        logger.warning("PG connection failed in get_pg: %s", e)
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")

def put_pg(request: Request, conn):
    """归还 PostgreSQL 连接到池"""
    request.app.state.pg_putconn(conn)

def get_image_dir(request: Request) -> Path:
    return request.app.state.kegg_image_dir

def get_sqlite(request: Request):
    """保留 SQLite 连接（仅用于 gffutils 相关的 features 查询）"""
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

# ========== 5. KEGG通路图片接口（返回PNG） ==========

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

# ========== 7. GO注释加载（dual-DB: PostgreSQL） ==========
def load_gene_go(request: Request, gene_id: str) -> Dict[str, Any]:
    pg_conn = get_pg(request)
    try:
        with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT gene_id, gene_symbol, ncbi_gene_id, ensembl_gene_id
                FROM gene_xref
                WHERE gene_id = %s
                """,
                (gene_id,),
            )
            gene_row = cur.fetchone()

        if gene_row is None:
            raise HTTPException(status_code=404, detail=f"gene_xref not found for {gene_id}")

        with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    g.go_id,
                    gt.go_name,
                    gt.go_definition,
                    gt.go_namespace,
                    g.evidence_code,
                    g.source
                FROM gene_go g
                JOIN go_term gt ON g.go_id = gt.go_id
                WHERE g.gene_id = %s
                ORDER BY
                    CASE gt.go_namespace
                        WHEN 'biological_process'   THEN 1
                        WHEN 'molecular_function'   THEN 2
                        WHEN 'cellular_component'  THEN 3
                        ELSE 9
                    END,
                    LOWER(REPLACE(gt.go_name, '-', ' ')),
                    g.go_id
                """,
                (gene_id,),
            )
            rows = cur.fetchall()

        items: List[Dict[str, Any]] = []
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
    finally:
        put_pg(request, pg_conn)

# ========== 8. KEGG注释加载（dual-DB: PostgreSQL） ==========
def load_gene_kegg(request: Request, gene_id: str) -> Dict[str, Any]:
    pg_conn = get_pg(request)
    try:
        with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    x.gene_id,
                    x.gene_symbol,
                    x.ncbi_gene_id,
                    k.kegg_gene_id
                FROM gene_xref x
                LEFT JOIN gene_kegg k ON x.gene_id = k.gene_id
                WHERE x.gene_id = %s
                """,
                (gene_id,),
            )
            head = cur.fetchone()

        if head is None:
            raise HTTPException(status_code=404, detail=f"gene_xref not found for {gene_id}")

        with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    a.pathway_id,
                    a.pathway_name,
                    a.pathway_class,
                    a.png_width,
                    a.png_height,
                    a.node_count,
                    a.kgml_filename
                FROM gene_kegg_pathway gkp
                LEFT JOIN kegg_pathway_asset a ON gkp.pathway_id = a.pathway_id
                WHERE gkp.gene_id = %s
                ORDER BY a.pathway_name, a.pathway_id
                """,
                (gene_id,),
            )
            rows = cur.fetchall()

        items: List[Dict[str, Any]] = []
        for r in rows:
            pathway_class = r["pathway_class"]  # 直接取已有值
            if not pathway_class:
                pathway_class = fetch_kegg_pathway_class(r["pathway_id"])
            pid = r["pathway_id"]
            items.append({
                "pathway_id": pid,
                "pathway_name": r["pathway_name"],
                "pathway_class": pathway_class,
                "official_link": kegg_pathway_url(pid),
                "png_url": f"/static/kegg_pathways/{pid}.png",
                "png_width": r["png_width"] or 0,
                "png_height": r["png_height"] or 0,
                "node_count": r["node_count"] or 0,
                "kgml_url": f"/static/kegg_kgml/{pid}.kgml",
                "image_api": f"/annotations/kegg/pathway/{pid}/image",
                "mapdata_api": f"/annotations/kegg/pathway/{pid}/mapdata",
                "interactive_api": f"/annotations/kegg/pathway/{pid}/interactive",
            })

        return {
            "gene_id": head["gene_id"],
            "gene_symbol": head["gene_symbol"],
            "ncbi_gene_id": head["ncbi_gene_id"],
            "kegg_gene_id": head["kegg_gene_id"],
            "summary": {"pathway_count": len(items)},
            "items": items,
        }
    finally:
        put_pg(request, pg_conn)


# go_kegg_routes.py 完整替换该函数
from fastapi.responses import FileResponse
from pathlib import Path
from fastapi import HTTPException
import xml.etree.ElementTree as ET
@router.get("/kegg/pathway/{pathway_id}/image", response_class=FileResponse)
def get_kegg_pathway_image(pathway_id: str):
    """强制返回图片，不依赖任何数据库/状态"""
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


# 新增JSON信息接口（PostgreSQL）
@router.get("/kegg/pathway/{pathway_id}/info")
def get_kegg_pathway_info(pathway_id: str, request: Request):
    pg_conn = get_pg(request)
    try:
        with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT pathway_name, png_width, png_height, node_count, gene_count "
                "FROM kegg_pathway_asset WHERE pathway_id = %s LIMIT 1",
                (pathway_id,)
            )
            row = cur.fetchone()
        if row:
            pathway_name = row["pathway_name"] or "Unknown"
            png_width    = row["png_width"]    or 0
            png_height   = row["png_height"]   or 0
            node_count   = row["node_count"]   or 0
            gene_count   = row["gene_count"]  or 0
        else:
            raise HTTPException(
                status_code=404,
                detail=f"KEGG pathway '{pathway_id}' not found"
            )

        return {
            "pathway_id": pathway_id,
            "pathway_name": pathway_name,
            "png_url": f"/static/kegg_pathways/{pathway_id}.png",
            "kgml_url": f"/static/kegg_kgml/{pathway_id}.kgml",
            "official_link": f"https://www.kegg.jp/entry/{pathway_id}",
            "png_width": png_width,
            "png_height": png_height,
            "node_count": node_count,
            "gene_count": gene_count,
            "local_image_path": str(KEGG_IMAGE_DIR / f"{pathway_id}.png")
        }
    finally:
        put_pg(request, pg_conn)


# ========== 10.5 通路列表和详情接口 ==========
@lru_cache(maxsize=1)
def get_all_pathways_cached() -> list:
    """缓存所有通路列表"""
    url = f"{KEGG_BASE}/list/pathway/gga"
    try:
        with urlopen(url, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return []

    pathways = []
    for line in body.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 1)
        if len(parts) == 2:
            pathway_id = parts[0].replace("path:gga", "gga")
            pathway_name = parts[1]
            pathways.append({
                "pathway_id": pathway_id,
                "pathway_name": pathway_name,
                "kegg_url": f"https://www.kegg.jp/entry/{pathway_id}",
                "image_url": f"/static/kegg_pathways/{pathway_id}.png"
            })
    return pathways


@router.get("/kegg/pathways")
def get_all_kegg_pathways(request: Request):
    """
    获取所有 KEGG 通路列表

    返回：通路ID、名称、KEGG链接、本地图片链接
    """
    pathways = get_all_pathways_cached()
    return {
        "total": len(pathways),
        "pathways": pathways[:200]  # 限制返回数量
    }


@router.get("/kegg/pathway/{pathway_id}")
def get_kegg_pathway_detail(pathway_id: str, request: Request):
    """
    获取 KEGG 通路详情（PostgreSQL）
    返回：通路基本信息、所有成员基因列表
    """
    pg_conn = get_pg(request)
    try:
        with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    gkp.pathway_id,
                    a.pathway_name,
                    gkp.gene_id,
                    x.gene_symbol,
                    x.ncbi_gene_id,
                    k.kegg_gene_id
                FROM gene_kegg_pathway gkp
                LEFT JOIN gene_xref x ON gkp.gene_id = x.gene_id
                LEFT JOIN gene_kegg k ON gkp.gene_id = k.gene_id
                LEFT JOIN kegg_pathway_asset a ON gkp.pathway_id = a.pathway_id
                WHERE gkp.pathway_id = %s
                ORDER BY x.gene_symbol
                """,
                (pathway_id,)
            )
            rows = cur.fetchall()

        if not rows:
            raise HTTPException(status_code=404, detail=f"Pathway not found: {pathway_id}")

        pathway_name = rows[0]["pathway_name"]
        genes = []
        for row in rows:
            genes.append({
                "gene_id": row["gene_id"],
                "gene_symbol": row["gene_symbol"],
                "ncbi_gene_id": row["ncbi_gene_id"],
                "kegg_gene_id": row["kegg_gene_id"]
            })

        return {
            "pathway_id": pathway_id,
            "pathway_name": pathway_name,
            "gene_count": len(genes),
            "genes": genes,
            "image_url": f"/static/kegg_pathways/{pathway_id}.png",
            "official_link": f"https://www.kegg.jp/entry/{pathway_id}"
        }
    finally:
        put_pg(request, pg_conn)


# ========== 11. KGML热区数据接口 ==========

# KGML缓存（简单内存缓存）
KGML_CACHE: dict[str, str] = {}

# KGML本地文件缓存目录
KGML_CACHE_DIR = GRCG6A_STATIC_ROOT / "kegg_kgml"

# 确保目录存在
KGML_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def get_local_kgml_path(pathway_id: str) -> Path:
    """获取KGML本地文件路径"""
    return KGML_CACHE_DIR / f"{pathway_id}.kgml"


def is_kgml_cache_valid(pathway_id: str, max_age_days: int = 7) -> bool:
    """检查本地KGML缓存是否有效（未过期）"""
    local_path = get_local_kgml_path(pathway_id)
    if not local_path.exists():
        return False
    # 检查文件修改时间
    file_age_days = (time.time() - os.path.getmtime(local_path)) / 86400
    return file_age_days < max_age_days


def fetch_and_cache_kgml(pathway_id: str, force_refresh: bool = False) -> str:
    """
    获取KGML XML数据（混合方案：本地缓存 + KEGG API）

    优先级：
    1. 内存缓存（最快）
    2. 本地文件缓存（快，稳定）
    3. KEGG API（慢，可能超时）

    Args:
        pathway_id: KEGG通路ID
        force_refresh: 是否强制从API刷新
    """
    # 1. 先检查内存缓存
    if pathway_id in KGML_CACHE and not force_refresh:
        return KGML_CACHE[pathway_id]

    # 2. 检查本地文件缓存
    local_path = get_local_kgml_path(pathway_id)
    if local_path.exists() and not force_refresh:
        try:
            kgml_content = local_path.read_text(encoding="utf-8")
            KGML_CACHE[pathway_id] = kgml_content
            logger.info(f"Loaded KGML from local cache: {pathway_id}")
            return kgml_content
        except Exception as e:
            logger.warning(f"Failed to read local KGML: {e}")

    # 3. 从KEGG API下载
    url = f"https://rest.kegg.jp/get/{pathway_id}/kgml"
    logger.info(f"Fetching KGML from {url}")

    try:
        response = requests.get(url, timeout=30)
        if response.status_code != 200:
            raise HTTPException(
                status_code=404,
                detail=f"无法获取KGML数据: {pathway_id}, HTTP {response.status_code}"
            )
        kgml_content = response.text

        # 保存到本地文件
        try:
            local_path.write_text(kgml_content, encoding="utf-8")
            logger.info(f"Saved KGML to local: {local_path}")
        except Exception as e:
            logger.warning(f"Failed to save KGML locally: {e}")

        # 存入内存缓存
        KGML_CACHE[pathway_id] = kgml_content
        return kgml_content

    except requests.RequestException as e:
        # 如果下载失败，尝试读取本地缓存（即使过期）
        if local_path.exists():
            try:
                kgml_content = local_path.read_text(encoding="utf-8")
                KGML_CACHE[pathway_id] = kgml_content
                logger.warning(f"Using expired local KGML cache due to API error: {pathway_id}")
                return kgml_content
            except Exception:
                pass

        logger.error(f"KGML请求失败: {e}")
        raise HTTPException(status_code=500, detail=f"KGML请求失败: {str(e)}")


def parse_kgml_hotspots(
    kgml_xml: str,
    highlight_ncbi: str | None = None,
    highlight_gene_id: str | None = None,
    pg_conn=None,
) -> dict:
    """
    解析KGML XML，生成热区数据

    Args:
        kgml_xml: KGML XML字符串
        highlight_ncbi: 要高亮的NCBI基因ID（如 "418223"）
        highlight_gene_id: 要高亮的内部基因ID（如 "gene-A4GALT"）
        conn: 数据库连接（用于查询kegg_gene_id）

    Returns:
        包含通路信息和热区列表的字典
    """
    try:
        root = ET.fromstring(kgml_xml)
    except ET.ParseError as e:
        raise HTTPException(status_code=500, detail=f"KGML XML解析失败: {str(e)}")

    pathway_id = root.get("name", "").replace("path:", "")
    pathway_name = root.get("title", "")
    image_url = root.get("image", "")
    kegg_url = f"https://www.kegg.jp/entry/{pathway_id}"

    # 如果提供了内部gene_id，需要先转换成kegg_gene_id
    target_kegg_gene_id = None
    if highlight_gene_id and pg_conn:
        with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT kegg_gene_id FROM gene_kegg WHERE gene_id = %s",
                (highlight_gene_id,)
            )
            row = cur.fetchone()
        if row and row["kegg_gene_id"]:
            target_kegg_gene_id = row["kegg_gene_id"]

    # 如果提供了NCBI ID，需要转换成kegg_gene_id格式
    if highlight_ncbi:
        target_kegg_gene_id = f"gga:{highlight_ncbi}"

    hotspots = []

    for entry in root.findall("entry"):
        entry_type = entry.get("type", "")
        entry_id = entry.get("id", "")
        names = entry.get("name", "").split()

        # 只处理gene类型
        if entry_type != "gene":
            continue

        # 处理多个graphics（一个entry可能有多个图形元素）
        graphics_list = entry.findall("graphics")
        if not graphics_list:
            continue

        # 取第一个graphics作为主要显示
        graphics = graphics_list[0]
        gtype = graphics.get("type", "rectangle")

        # line 类型: 从 coords 属性解析边界框
        x = y = width = height = None
        if gtype == "line":
            coords_str = graphics.get("coords", "")
            coords = []
            for pair in coords_str.split(","):
                try:
                    coords.append(int(float(pair)))
                except (ValueError, TypeError):
                    continue
            if len(coords) >= 4:  # 至少2个点
                xs = coords[0::2]
                ys = coords[1::2]
                x_min, x_max = min(xs), max(xs)
                y_min, y_max = min(ys), max(ys)
                x = (x_min + x_max) // 2      # 中心点
                y = (y_min + y_max) // 2
                width = max(x_max - x_min, 10)  # 最小宽度10
                height = max(y_max - y_min, 5)  # 最小高度5
            if width is None or width <= 0:
                continue
        else:
            # rectangle 类型: 解析 x/y/width/height
            try:
                x = int(float(graphics.get("x", 0)))
                y = int(float(graphics.get("y", 0)))
                width = int(float(graphics.get("width", 0)))
                height = int(float(graphics.get("height", 0)))
            except (ValueError, TypeError):
                continue
            if width <= 0 or height <= 0:
                continue

        # 计算左上角坐标（KGML的x,y是中心点）
        left = x - width // 2
        top = y - height // 2

        # 获取显示名称
        display_name = graphics.get("name", "")

        # 处理多个基因：每个基因创建一个独立的热区
        # 这样可以支持单独高亮多基因entry中的每个基因
        kegg_gene_ids = [n for n in names if n.startswith("gga:")]
        if not kegg_gene_ids:
            continue

        # 显示名称可能包含多个基因，用逗号分隔
        display_names = []
        if display_name:
            # 从graphics的name中提取显示名（可能有省略号）
            raw_names = display_name.split(",")
            for rn in raw_names:
                display_names.append(rn.strip())

        # 为每个基因创建独立的热区
        for i, kegg_gene_id in enumerate(kegg_gene_ids):
            # 取对应的显示名称，或用基因ID
            gene_display = display_names[i] if i < len(display_names) else kegg_gene_id.replace("gga:", "")

            # 判断是否高亮
            highlighted = False
            if target_kegg_gene_id and kegg_gene_id == target_kegg_gene_id:
                highlighted = True

            # 生成KEGG链接
            gene_kegg_url = f"https://www.kegg.jp/entry/{kegg_gene_id}"

            hotspots.append({
                "node_id": entry_id,
                "entry_id": entry_id,
                "entry_type": entry_type,
                "kegg_gene_id": kegg_gene_id,
                "label": gene_display,
                "url": gene_kegg_url,
                "graphics_type": gtype,
                # 中心点
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                # 左上角（前端直接用）
                "left": left,
                "top": top,
                # 右下角（前端直接用）
                "right": left + width,
                "bottom": top + height,
                "highlighted": highlighted,
            })

    # 按top排序，便于前端渲染
    hotspots.sort(key=lambda h: (h["top"], h["left"]))

    return {
        "pathway_id": pathway_id,
        "pathway_name": pathway_name,
        "png_url": image_url,
        "kegg_url": kegg_url,
        "nodes": hotspots,
        "node_count": len(hotspots),
    }


@router.get("/kegg/pathway/{pathway_id}/mapdata")
def get_pathway_mapdata(
    pathway_id: str,
    request: Request,
    highlight_ncbi: str | None = None,
    highlight_gene: str | None = None,
):
    """
    获取KEGG通路图热区数据（用于交互式展示）

    **参数：**
    - `highlight_ncbi`: 要高亮的NCBI基因ID（如 "418223"）
    - `highlight_gene`: 要高亮的内部基因ID（如 "gene-A4GALT"）

    **返回：**
    - 通路基本信息
    - 所有基因热区列表（包含坐标和是否高亮）

    **用途：**
    前端获取此数据后，可叠加到KEGG官方PNG图片上，
    实现：当前基因红色高亮 + 所有基因可点击跳转KEGG官网
    """
    # 获取数据库连接
    pg_conn = get_pg(request)

    # 解析highlight_gene（内部gene_id → NCBI ID）
    resolved_ncbi = highlight_ncbi
    if highlight_gene and not highlight_ncbi:
        resolved_ncbi = _gene_id_to_ncbi(request, highlight_gene)

    # 获取并解析KGML
    kgml_xml = fetch_and_cache_kgml(pathway_id)
    result = parse_kgml_hotspots(
        kgml_xml,
        highlight_ncbi=resolved_ncbi,
        highlight_gene_id=highlight_gene,
        pg_conn=pg_conn
    )

    # 添加高亮基因详情
    if resolved_ncbi:
        kegg_gene_id = f"gga:{resolved_ncbi}"
        highlighted_count = sum(
            1 for n in result.get("nodes", []) if n.get("highlighted")
        )
        result["target_gene"] = {
            "ncbi_gene_id": resolved_ncbi,
            "kegg_gene_id": kegg_gene_id,
            "symbol": _ncbi_to_symbol(request, resolved_ncbi),
            "highlighted_count": highlighted_count,
        }
        # 兼容旧字段名
        result["highlight_ncbi"] = resolved_ncbi

    # 从数据库获取图片宽高（PostgreSQL）
    with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT png_width, png_height FROM kegg_pathway_asset WHERE pathway_id = %s",
            (pathway_id,)
        )
        asset_row = cur.fetchone()
    put_pg(request, pg_conn)

    if asset_row:
        result["image_width"]  = asset_row["png_width"]  or 0
        result["image_height"] = asset_row["png_height"] or 0

    return result


# ========== KGML 缓存管理接口 ==========

@router.get("/kegg/kgml-cache/status")
def get_kgml_cache_status():
    """
    获取KGML本地缓存状态
    """
    import os

    cache_files = list(KGML_CACHE_DIR.glob("*.kgml"))
    total_size = sum(f.stat().st_size for f in cache_files)

    # 获取缓存统计
    memory_cache_count = len(KGML_CACHE)

    # 获取缓存文件列表
    files_info = []
    for f in sorted(cache_files)[:20]:  # 只返回前20个
        age_days = (time.time() - os.path.getmtime(f)) / 86400
        files_info.append({
            "pathway_id": f.stem,
            "size_bytes": f.stat().st_size,
            "age_days": round(age_days, 1),
            "filename": f.name
        })

    return {
        "cache_dir": str(KGML_CACHE_DIR),
        "total_files": len(cache_files),
        "total_size_bytes": total_size,
        "total_size_mb": round(total_size / 1024 / 1024, 2),
        "memory_cache_count": memory_cache_count,
        "cache_age_days": 7,  # 缓存有效期
        "sample_files": files_info
    }


@router.post("/kegg/kgml-cache/refresh/{pathway_id}")
def refresh_single_kgml_cache(pathway_id: str):
    """
    刷新单个通路的KGML缓存

    从KEGG API重新下载并更新本地缓存
    """
    local_path = get_local_kgml_path(pathway_id)

    # 强制从API刷新
    try:
        kgml_content = fetch_and_cache_kgml(pathway_id, force_refresh=True)

        # 验证文件已保存
        if local_path.exists():
            size = local_path.stat().st_size
            return {
                "success": True,
                "pathway_id": pathway_id,
                "size_bytes": size,
                "local_path": str(local_path),
                "message": "Cache refreshed successfully"
            }
        else:
            return {
                "success": True,
                "pathway_id": pathway_id,
                "message": "Cached in memory only (local save failed)"
            }
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/kegg/kgml-cache/refresh")
def refresh_all_kgml_cache(request: Request):
    """
    刷新所有KGML缓存

    从数据库获取所有有KEGG通路注释的基因涉及的唯一通路，
    然后逐个刷新缓存。
    """
    pg_conn = get_pg(request)
    try:
        with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT DISTINCT pathway_id FROM gene_kegg_pathway")
            pathways = cur.fetchall()
    finally:
        put_pg(request, pg_conn)

    pathway_ids = [p["pathway_id"] for p in pathways]
    total = len(pathway_ids)

    refreshed = 0
    failed = []
    skipped = 0

    for pathway_id in pathway_ids:
        try:
            kgml_content = fetch_and_cache_kgml(pathway_id, force_refresh=True)
            refreshed += 1
        except Exception as e:
            failed.append({"pathway_id": pathway_id, "error": str(e)})

    return {
        "success": True,
        "total_pathways": total,
        "refreshed": refreshed,
        "failed": len(failed),
        "failed_details": failed[:10],  # 只返回前10个失败
        "message": f"Refreshed {refreshed}/{total} KGML caches"
    }


def _gene_id_to_ncbi(request: Request, gene_id: str) -> str | None:
    """将内部基因ID转换为NCBI基因ID（PostgreSQL）"""
    pg_conn = get_pg(request)
    try:
        with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT ncbi_gene_id FROM gene_xref WHERE gene_id = %s",
                (gene_id,)
            )
            row = cur.fetchone()
        return row["ncbi_gene_id"] if row else None
    finally:
        put_pg(request, pg_conn)


def _ncbi_to_symbol(request: Request, ncbi_id: str) -> str | None:
    """将NCBI基因ID转换为基因符号（PostgreSQL）"""
    pg_conn = get_pg(request)
    try:
        with pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT gene_symbol FROM gene_xref WHERE ncbi_gene_id = %s",
                (ncbi_id,)
            )
            row = cur.fetchone()
        return row["gene_symbol"] if row else None
    finally:
        put_pg(request, pg_conn)


# ========== 12. 交互式HTML接口（可选，用于调试/备用） ==========
from fastapi.responses import HTMLResponse


@router.get("/kegg/pathway/{pathway_id}/interactive")
def get_interactive_pathway(
    pathway_id: str,
    request: Request,
    highlight_ncbi: str | None = None,
    highlight_gene: str | None = None,
):
    """
    返回交互式通路图HTML页面（调试用）

    正式使用建议：
    - 前端调用 /mapdata 获取JSON数据
    - 前端自行渲染图片 + 叠加层
    """
    # 获取mapdata
    mapdata = get_pathway_mapdata(
        pathway_id, request, highlight_ncbi, highlight_gene
    )

    # 生成HTML
    html = _generate_interactive_html(mapdata)

    return HTMLResponse(content=html)


def _generate_interactive_html(mapdata: dict) -> str:
    """生成交互式HTML页面"""
    pathway_name = mapdata.get("pathway_name", "")
    image_url = mapdata.get("png_url", "")
    kegg_url = mapdata.get("kegg_url", "")
    img_width  = mapdata.get("image_width",  0) or 0
    img_height = mapdata.get("image_height", 0) or 0
    target = mapdata.get("target_gene")

    # 生成热区SVG
    nodes_svg = ""
    for h in mapdata.get("nodes", []):
        is_rect = h.get("graphics_type") == "rectangle"
        is_highlighted = h.get("highlighted", False)

        if is_highlighted:
            if is_rect:
                # 矩形: 红色边框+半透明填充+脉冲动画
                style = 'fill="rgba(255,0,0,0.3)" stroke="#e74c3c" stroke-width="2"'
                cls = "hotspot highlighted"
            else:
                # 线条: 透明但仍可点击（不渲染无效的热区框）
                style = 'fill="transparent" stroke="transparent" pointer-events="stroke"'
                cls = "hotspot"
        else:
            # 非高亮: 透明不可见，但可点击
            style = 'fill="transparent" stroke="transparent"'
            cls = "hotspot"

        nodes_svg += f'''
        <a href="{h["url"]}" target="_blank" title="{h.get("label", h.get("entry_id", ""))}">
            <rect
                x="{h["left"]}"
                y="{h["top"]}"
                width="{h["width"]}"
                height="{h["height"]}"
                {style}
                class="{cls}"
            />
        </a>'''

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{pathway_name}</title>
    <style>
        body {{
            font-family: Arial, sans-serif;
            margin: 20px;
            background: #f5f5f5;
        }}
        .container {{
            max-width: 1200px;
            margin: 0 auto;
        }}
        h2 {{
            color: #2c3e50;
            margin-bottom: 10px;
        }}
        .pathway-wrapper {{
            position: relative;
            display: inline-block;
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            overflow: hidden;
        }}
        .pathway-image {{
            display: block;
            max-width: 100%;
            height: auto;
        }}
        .pathway-overlay {{
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        }}
        .pathway-overlay a {{
            pointer-events: all;
            cursor: pointer;
        }}
        .hotspot {{
            transition: all 0.2s;
        }}
        .hotspot:hover {{
            filter: brightness(1.1);
        }}
        .hotspot.highlighted {{
            animation: pulse 2s infinite;
        }}
        @keyframes pulse {{
            0%, 100% {{ opacity: 1; }}
            50% {{ opacity: 0.7; }}
        }}
        .kegg-link {{
            display: inline-block;
            margin-top: 15px;
            padding: 10px 20px;
            background: #3498db;
            color: white;
            text-decoration: none;
            border-radius: 5px;
        }}
        .kegg-link:hover {{
            background: #2980b9;
        }}
        .legend {{
            margin-top: 15px;
            font-size: 14px;
            color: #7f8c8d;
        }}
        .legend .highlight {{
            color: #e74c3c;
            font-weight: bold;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h2>{pathway_name}</h2>
        <div class="pathway-wrapper">
            <img src="{image_url}" alt="{pathway_name}" class="pathway-image">
            <svg class="pathway-overlay" viewBox="0 0 {img_width} {img_height}" preserveAspectRatio="xMidYMid meet">
                {nodes_svg}
            </svg>
        </div>
        <a href="{kegg_url}" target="_blank" class="kegg-link">View on KEGG</a>
        <div class="legend">
            <span class="highlight">Highlighted</span> = Current gene (clickable){f' ({target["highlighted_count"]} positions)' if target else ''} |
            Other genes = Clickable to KEGG entry
        </div>
    </div>
</body>
</html>'''


# ========== 9. 路由接口（dual-DB: PostgreSQL） ==========
@router.get("/go/{gene_id}")
def get_gene_go(gene_id: str, request: Request):
    gene_id = resolve_gene_id(request, gene_id)
    return load_gene_go(request, gene_id)

@router.get("/kegg/{gene_id}")
def get_gene_kegg(gene_id: str, request: Request):
    gene_id = resolve_gene_id(request, gene_id)
    return load_gene_kegg(request, gene_id)

# ========== 10. 基因页面注释附加函数（保留原有） ==========
def attach_annotations_to_gene_page(request: Request, page: Dict[str, Any], gene_id: str) -> Dict[str, Any]:
    """附加GO/KEGG注释到基因页面数据（PostgreSQL）"""
    page["annotations"] = {
        "go": load_gene_go(request, gene_id),
        "kegg": load_gene_kegg(request, gene_id),
    }
    return page








