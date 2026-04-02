#!/usr/bin/env python3
"""
KGML 缓存导入脚本
功能：扫描本地 KGML/PNG 目录，解析后入库到 3 张表

用法：
  python scripts/import_kegg_kgml_cache.py
  python scripts/import_kegg_kgml_cache.py --pathway-id gga00603 --replace
  python scripts/import_kegg_kgml_cache.py --dry-run
  python scripts/import_kegg_kgml_cache.py --db grcg6a_nc.db

依赖：pip install Pillow
"""

import argparse
import sqlite3
import struct
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

# ================================================================
# PNG 宽高读取（不依赖 Pillow，直接读 header）
# ================================================================

def get_png_dimensions(png_path: Path) -> tuple[int, int]:
    """读取 PNG 宽高，不依赖 Pillow"""
    try:
        with open(png_path, "rb") as f:
            sig = f.read(8)
            if sig != b'\x89PNG\r\n\x1a\n':
                return 0, 0
            f.read(4)  # chunk length
            chunk_type = f.read(4)
            if chunk_type != b'IHDR':
                return 0, 0
            width, height = struct.unpack(">II", f.read(8))
            return int(width), int(height)
    except Exception:
        return 0, 0


# ================================================================
# 核心 KGML 解析
# ================================================================

def parse_coords_list(coords_str: str) -> tuple[list[int], list[int]]:
    """
    解析 KGML coords 属性
    coords="1232,2105,1232,2107,..." → xs=[1232,...], ys=[2105,...]
    """
    xs, ys = [], []
    try:
        parts = coords_str.replace(" ", ",").split(",")
        vals = [int(float(p.strip())) for p in parts if p.strip()]
        xs = vals[0::2]
        ys = vals[1::2]
    except (ValueError, TypeError):
        pass
    return xs, ys


def parse_kgml_for_pathway(kgml_path: Path, pathway_id: str) -> tuple[dict, list[dict], list[dict]]:
    """
    解析单个 KGML 文件

    Returns:
        info: 通路基本信息
        nodes: 节点列表
        node_genes: 节点-基因映射列表
    """
    try:
        tree = ET.parse(kgml_path)
    except ET.ParseError as e:
        print(f"      XML 解析失败: {e}", file=sys.stderr)
        return {}, [], []

    root = tree.getroot()

    # ---- 1. 通路基本信息 ----
    info = {
        "pathway_id":    pathway_id,
        "pathway_name":  root.get("title", ""),
        "png_url":       root.get("image", ""),
        "link_url":      root.get("link", ""),
    }

    # ---- 2. 收集所有 group entry ----
    group_entries = {}   # entry_id → entry element
    component_map = {}  # component_id → group entry_id
    for entry in root.findall("entry"):
        if entry.get("type") == "group":
            gid = entry.get("id")
            group_entries[gid] = entry
            for comp in entry.findall("component"):
                component_map[comp.get("id")] = gid

    # ---- 3. 收集所有 gene/compound entry（含 group 展开）----
    all_entries = {}  # entry_id → entry element
    for entry in root.findall("entry"):
        etype = entry.get("type")
        if etype in ("gene", "compound"):
            all_entries[entry.get("id")] = entry
        elif etype == "group":
            # group 本身也作为一个节点，展开其 component
            gid = entry.get("id")
            for comp in entry.findall("component"):
                comp_id = comp.get("id")
                if comp_id in all_entries:
                    # 避免重复，用 group id 记录
                    pass

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    nodes = []
    node_genes = []
    seen_node_keys = set()  # (pathway_id, entry_id) 去重

    for entry in root.findall("entry"):
        eid = entry.get("id")
        etype = entry.get("type")
        raw_names = entry.get("name", "")

        # 收集所有需要处理的 graphics
        graphics_list = entry.findall("graphics")
        if not graphics_list:
            continue

        for graphics in graphics_list:
            gtype = graphics.get("type", "rectangle")
            x = y = width = height = None
            left_x = top_y = right_x = bottom_y = None

            if gtype == "line":
                # line 类型：从 coords 解析边界框
                coords_str = graphics.get("coords", "")
                xs, ys = parse_coords_list(coords_str)
                if len(xs) >= 2 and len(ys) >= 2:
                    x_min, x_max = min(xs), max(xs)
                    y_min, y_max = min(ys), max(ys)
                    width  = max(x_max - x_min, 10)   # 最小宽度 10px
                    height = max(y_max - y_min, 5)    # 最小高度 5px
                    x = (x_min + x_max) // 2
                    y = (y_min + y_max) // 2
                    left_x   = x_min
                    top_y    = y_min
                    right_x  = x_max
                    bottom_y = y_max
            else:
                # rectangle / circle / roundrect 等：直接解析 x/y/width/height
                try:
                    x = int(float(graphics.get("x", 0)))
                    y = int(float(graphics.get("y", 0)))
                    width  = int(float(graphics.get("width", 0)))
                    height = int(float(graphics.get("height", 0)))
                    left_x   = x - width  // 2
                    top_y    = y - height // 2
                    right_x  = x + width  // 2
                    bottom_y = y + height // 2
                except (ValueError, TypeError):
                    continue

            # 跳过无效尺寸
            if width is None or width <= 0 or height <= 0:
                continue

            # 构建 node key（去重）
            node_key = (pathway_id, eid)
            entry_name = graphics.get("name", "")

            if node_key not in seen_node_keys:
                seen_node_keys.add(node_key)

                # link_url: 优先用 entry/@link，兜底拼 KEGG 通路页
                link_url = entry.get("link", f"https://www.kegg.jp/entry/{pathway_id}")

                node = {
                    "pathway_id":    pathway_id,
                    "entry_id":      eid,
                    "entry_type":    etype,
                    "entry_name":    entry_name,
                    "graphics_type": gtype,
                    "x":             x,
                    "y":             y,
                    "width":         width,
                    "height":        height,
                    "left_x":        left_x,
                    "top_y":         top_y,
                    "right_x":       right_x,
                    "bottom_y":      bottom_y,
                    "raw_names":     raw_names,
                    "link_url":      link_url,
                    "updated_at":    now,
                }
                nodes.append(node)

                # 提取基因映射
                for name in raw_names.replace(",", " ").split():
                    if name.startswith("gga:"):
                        node_genes.append({
                            "pathway_id":   pathway_id,
                            "kegg_gene_id": name,
                            "updated_at":   now,
                        })

    return info, nodes, node_genes


# ================================================================
# 数据库操作
# ================================================================

def upsert_asset(conn: sqlite3.Connection, pathway_id: str,
                png_dir: Path, kgml_dir: Path, info: dict,
                png_width: int, png_height: int) -> dict:
    """Upsert 通路资产表"""
    png_path  = png_dir  / f"{pathway_id}.png"
    kgml_path = kgml_dir / f"{pathway_id}.kgml"

    png_size = int(png_path.stat().st_size)  if png_path.exists()  else 0
    kgml_size = int(kgml_path.stat().st_size) if kgml_path.exists() else 0

    cursor = conn.execute(
        "SELECT id FROM kegg_pathway_asset WHERE pathway_id = ?", (pathway_id,)
    )
    exists = cursor.fetchone() is not None

    png_relpath = str(png_path)
    kgml_relpath = str(kgml_path)

    if exists:
        conn.execute("""
            UPDATE kegg_pathway_asset SET
                pathway_name   = ?,
                pathway_class  = ?,
                png_filename   = ?,
                png_relpath    = ?,
                png_url        = ?,
                png_file_size  = ?,
                png_width      = ?,
                png_height     = ?,
                kgml_filename  = ?,
                kgml_relpath   = ?,
                kgml_file_size = ?
            WHERE pathway_id = ?
        """, (
            info.get("pathway_name", ""),
            info.get("pathway_class", ""),
            png_path.name,
            png_relpath,
            f"/static/kegg_pathways/{pathway_id}.png",
            png_size, png_width, png_height,
            kgml_path.name,
            kgml_relpath,
            kgml_size,
            pathway_id,
        ))
    else:
        conn.execute("""
            INSERT INTO kegg_pathway_asset (
                pathway_id, pathway_name, pathway_class,
                png_filename, png_relpath, png_url,
                png_file_size, png_width, png_height,
                kgml_filename, kgml_relpath, kgml_file_size
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            pathway_id,
            info.get("pathway_name", ""),
            info.get("pathway_class", ""),
            png_path.name,
            png_relpath,
            f"/static/kegg_pathways/{pathway_id}.png",
            png_size, png_width, png_height,
            kgml_path.name,
            kgml_relpath,
            kgml_size,
        ))


def import_pathway(conn: sqlite3.Connection, pathway_id: str,
                   png_dir: Path, kgml_dir: Path,
                   replace: bool) -> dict:
    """导入单个通路"""
    kgml_path = kgml_dir / f"{pathway_id}.kgml"
    png_path  = png_dir  / f"{pathway_id}.png"

    if not kgml_path.exists():
        return {"status": "skip", "reason": "KGML not found"}

    # 1. 解析 KGML
    info, nodes, node_genes = parse_kgml_for_pathway(kgml_path, pathway_id)
    if not info:
        return {"status": "error", "reason": "parse failed"}

    # 2. 读取 PNG 尺寸
    png_w, png_h = get_png_dimensions(png_path)

    # 3. Upsert 资产表
    upsert_asset(conn, pathway_id, png_dir, kgml_dir, info, png_w, png_h)

    # 4. 清理旧数据
    if replace:
        conn.execute(
            "DELETE FROM kegg_pathway_node_gene WHERE pathway_id = ?",
            (pathway_id,)
        )
        conn.execute(
            "DELETE FROM kegg_pathway_node WHERE pathway_id = ?",
            (pathway_id,)
        )

    # 5. 写入节点表
    node_id_map = {}  # entry_id → node_id
    for node in nodes:
        cursor = conn.execute("""
            INSERT INTO kegg_pathway_node (
                pathway_id, entry_id, entry_type, entry_name,
                graphics_type, x, y, width, height,
                left_x, top_y, right_x, bottom_y,
                raw_names, link_url, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            node["pathway_id"], node["entry_id"], node["entry_type"], node["entry_name"],
            node["graphics_type"], node["x"], node["y"], node["width"], node["height"],
            node["left_x"], node["top_y"], node["right_x"], node["bottom_y"],
            node["raw_names"], node["link_url"], node["updated_at"],
        ))
        node_id_map[node["entry_id"]] = cursor.lastrowid

    # 6. 写入基因映射表（需要 node_id）
    for ng in node_genes:
        # 从 raw_names 找到对应的 entry_id
        for entry in nodes:
            if ng["kegg_gene_id"] in (entry["raw_names"] or "").replace(",", " ").split():
                node_id = node_id_map.get(entry["entry_id"])
                if node_id:
                    try:
                        conn.execute("""
                            INSERT OR IGNORE INTO kegg_pathway_node_gene (
                                pathway_id, node_id, kegg_gene_id, gene_symbol, updated_at
                            ) VALUES (?, ?, ?, NULL, ?)
                        """, (
                            ng["pathway_id"], node_id,
                            ng["kegg_gene_id"], ng["updated_at"],
                        ))
                    except sqlite3.IntegrityError:
                        pass
                break

    # 7. 更新统计
    conn.execute("""
        UPDATE kegg_pathway_asset SET
            node_count = ?,
            gene_count = (
                SELECT COUNT(DISTINCT kegg_gene_id)
                FROM kegg_pathway_node_gene
                WHERE pathway_id = ?
            ),
            updated_at = datetime('now')
        WHERE pathway_id = ?
    """, (len(nodes), pathway_id, pathway_id))

    conn.commit()
    return {
        "status": "ok",
        "nodes": len(nodes),
        "genes": len(node_genes),
        "png_w": png_w,
        "png_h": png_h,
    }


def import_all(png_dir: Path, kgml_dir: Path, db_path: Path,
               pathway_id: str = None, replace: bool = False,
               dry_run: bool = False, batch_interval: float = 0.1):
    """批量导入"""

    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA busy_timeout = 10000")
    conn.row_factory = sqlite3.Row

    # 确定要处理的 pathway_id 列表
    if pathway_id:
        targets = [pathway_id]
    else:
        kgml_files = list(kgml_dir.glob("*.kgml"))
        targets = sorted([f.stem for f in kgml_files])

    total = len(targets)
    ok = skip = err = 0

    print(f"[KGML 导入] 共 {total} 个通路 | PNG={png_dir} | KGML={kgml_dir}")
    print("-" * 60)

    for i, pid in enumerate(targets, 1):
        if dry_run:
            print(f"  [{i:3d}/{total}] DRY-RUN: {pid}")
            continue

        try:
            result = import_pathway(conn, pid, png_dir, kgml_dir, replace)
            if result["status"] == "ok":
                ok += 1
                if ok <= 5 or ok % 50 == 0:
                    print(f"  [{i:3d}/{total}] OK   {pid}: "
                          f"nodes={result['nodes']:4d}  "
                          f"genes={result['genes']:4d}  "
                          f"png={result['png_w']}x{result['png_h']}")
            elif result["status"] == "skip":
                skip += 1
                print(f"  [{i:3d}/{total}] SKIP {pid}: {result['reason']}")
            else:
                err += 1
                print(f"  [{i:3d}/{total}] ERR  {pid}: {result['reason']}")
        except Exception as e:
            err += 1
            print(f"  [{i:3d}/{total}] ERR  {pid}: {e}")

        if not dry_run and i % 100 == 0:
            time.sleep(batch_interval)

    conn.close()
    print("-" * 60)
    print(f"[完成] 成功={ok}  跳过={skip}  错误={err}  总计={total}")


# ================================================================
# 入口
# ================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KGML 缓存导入工具")
    parser.add_argument("--db",         default="./grcg6a_nc.db", help="SQLite 数据库路径")
    parser.add_argument("--png-dir",    default="./static/kegg_pathways", help="PNG 目录")
    parser.add_argument("--kgml-dir",   default="./static/kegg_kgml",     help="KGML 目录")
    parser.add_argument("--pathway-id", help="只处理单个通路")
    parser.add_argument("--replace",   action="store_true", help="替换已有数据")
    parser.add_argument("--dry-run",   action="store_true", help="只打印不写入")
    args = parser.parse_args()

    import_all(
        png_dir=Path(args.png_dir),
        kgml_dir=Path(args.kgml_dir),
        db_path=Path(args.db),
        pathway_id=args.pathway_id,
        replace=args.replace,
        dry_run=args.dry_run,
    )
