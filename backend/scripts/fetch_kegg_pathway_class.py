"""
预填充 kegg_pathway_asset.pathway_class

用法：
    python scripts/fetch_kegg_pathway_class.py

行为：
    1. 从 kegg_pathway_asset 读取所有 pathway_id
    2. 使用 lru_cache 缓存每个通路的 class 查询结果（避免重复请求）
    3. 批量更新 kegg_pathway_asset 表的 pathway_class 字段
    4. 已存在的非空 class 不会被覆盖

输出示例：
    [1/195] gga00010  → Glycolysis / Gluconeogenesis
    [2/195] gga00020  → None (no class)
    ...
    Done: 189 updated, 6 skipped (already had class), 0 failed
"""

from __future__ import annotations

import sqlite3
import time
import logging
import re
from functools import lru_cache
from pathlib import Path
from urllib.request import urlopen
from urllib.error import HTTPError, URLError

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("fetch_kegg_class")

# ========== 配置 ==========
# 始终使用 D:\jbrowsedata\projectdata 下的实际数据库
DB_PATH = Path(r"D:\jbrowsedata\projectdata\grcg6a_nc.db")
KEGG_BASE = "https://rest.kegg.jp"
REQUEST_INTERVAL = 0.35  # KEGG API 要求 ≥ 0.2s 间隔
KEGG_BASE = "https://rest.kegg.jp"
REQUEST_INTERVAL = 0.35  # KEGG API 要求 ≥ 0.2s 间隔


@lru_cache(maxsize=500)
def fetch_pathway_class(pathway_id: str) -> str | None:
    """从 KEGG REST API 获取通路分类（带内存缓存，进程内只请求一次）"""
    url = f"{KEGG_BASE}/get/{pathway_id}"
    try:
        with urlopen(url, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except HTTPError:
        logger.warning("  HTTP %d for %s", getattr(resp, "code", "?"), pathway_id)
        return None
    except (URLError, Exception) as e:
        logger.warning("  Network error for %s: %s", pathway_id, e)
        return None

    # 解析 CLASS 行（支持多行续接）
    # 格式: CLASS       1. Carbohydrate Metabolism
    #       CLASS       1. Carbohydrate Metabolism; Energy Metabolism
    collected: list[str] = []
    in_class = False

    for raw_line in body.splitlines():
        if raw_line.startswith("CLASS"):
            in_class = True
            value = raw_line[12:].strip()
            if value:
                collected.append(value)
            continue
        if in_class:
            # 续接行：前导空格或制表符开头
            if raw_line and raw_line[0] in (" ", "\t"):
                continuation = raw_line.strip()
                if continuation:
                    collected.append(continuation)
            else:
                # 遇到非续接行，CLASS 块结束
                break

    if not collected:
        return None
    return " | ".join(collected)


def main():
    db_path = DB_PATH

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    # 读取所有需要补充的 pathway
    rows = conn.execute("""
        SELECT pathway_id, pathway_class
        FROM kegg_pathway_asset
        WHERE pathway_class IS NULL OR pathway_class = ''
        ORDER BY pathway_id
    """).fetchall()

    if not rows:
        logger.info("所有通路已有 pathway_class，无需更新。")
        conn.close()
        return

    total = len(rows)
    updated = 0
    skipped = 0
    failed = 0

    logger.info("开始获取 %d 个通路的 pathway_class ...\n", total)

    for idx, row in enumerate(rows, 1):
        pathway_id = row["pathway_id"]
        current_class = row["pathway_class"] or ""

        # 跳过已有 class 的（理论上不应该有，但防御一下）
        if current_class.strip():
            skipped += 1
            logger.info("[%d/%d] %s  → (已有) %s", idx, total, pathway_id, current_class[:40])
            continue

        pathway_class = fetch_pathway_class(pathway_id)
        time.sleep(REQUEST_INTERVAL)  # 遵守 KEGG API 频率限制

        if pathway_class:
            conn.execute(
                "UPDATE kegg_pathway_asset SET pathway_class = ? WHERE pathway_id = ?",
                (pathway_class, pathway_id),
            )
            updated += 1
            logger.info("[%d/%d] %s  → %s", idx, total, pathway_id, pathway_class[:60])
        else:
            # 标记为已尝试但无结果，避免下次再请求
            conn.execute(
                "UPDATE kegg_pathway_asset SET pathway_class = ? WHERE pathway_id = ?",
                ("", pathway_id),
            )
            failed += 1
            logger.info("[%d/%d] %s  → (无 class)", idx, total, pathway_id)

        # 每 20 条 commit 一次，避免长事务
        if idx % 20 == 0:
            conn.commit()
            logger.info("  -- 已 commit %d 条 --\n", idx)

    conn.commit()

    logger.info("\n完成：%d updated, %d skipped, %d failed (无 class)", updated, skipped, failed)
    conn.close()


if __name__ == "__main__":
    main()
