"""Chat API router — 所有回答直接来自数据库，零幻觉。"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from backend.config import GRCG6A_SAMPLE_RESULTS

logger = logging.getLogger("grcg6a_fastapi_backend.chat")

router = APIRouter(prefix="/api", tags=["Chat"])

# =============================================================================
# 核心原则：所有数字/名称必须来自数据库，禁止硬编码猜测
# =============================================================================


def _find_chromosome_by_name(request: Request, chr_name: str) -> dict | None:
    """
    通过染色体名称（如 "1"、"29"、"W"、"Z"、"MT"）查找染色体记录。
    chr_name 去头部的 "chr" 前缀后匹配数据库的 chr_name 字段。
    """
    state = request.app.state
    target = chr_name.lower()
    for row in state.chromosomes:
        if row["chr_name"].lower() == target:
            return dict(row)
    return None


def _list_available_charts(request: Request) -> list[str]:
    """查询 sample_results 目录，返回真实存在的图表 key 列表。"""
    charts_dir = GRCG6A_SAMPLE_RESULTS / "charts"
    if not charts_dir.exists():
        return []
    # 只找 .json 文件，排除 manifest.json
    keys = sorted(
        f.stem
        for f in charts_dir.glob("*.json")
        if f.stem != "manifest"
    )
    return keys


def _safe_int(value: Any) -> int:
    """安全转 int，避免 None 或类型错误。"""
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


# =============================================================================
# 数据库查询工具
# =============================================================================

def get_genome_stats(request: Request) -> dict[str, Any]:
    """从数据库获取基因组总体统计。"""
    state = request.app.state
    sql = state.sql

    gene_count = len(state.gene_index_by_id)
    chr_count = len(state.chromosomes)
    total_genome_size = sum(_safe_int(c["length"]) for c in state.chromosomes)

    go_row = sql.execute("SELECT COUNT(*) as n FROM gene_go").fetchone()
    go_term_count = _safe_int(go_row["n"]) if go_row else 0

    genes_go_row = sql.execute("SELECT COUNT(DISTINCT gene_id) as n FROM gene_go").fetchone()
    genes_with_go = _safe_int(genes_go_row["n"]) if genes_go_row else 0

    kegg_row = sql.execute("SELECT COUNT(*) as n FROM gene_kegg").fetchone()
    kegg_count = _safe_int(kegg_row["n"]) if kegg_row else 0

    genes_kegg_row = sql.execute("SELECT COUNT(DISTINCT gene_id) as n FROM gene_kegg").fetchone()
    genes_with_kegg = _safe_int(genes_kegg_row["n"]) if genes_kegg_row else 0

    pathway_row = sql.execute("SELECT COUNT(*) as n FROM gene_kegg_pathway").fetchone()
    kegg_pathway_count = _safe_int(pathway_row["n"]) if pathway_row else 0

    return {
        "genome": "GRCg6a",
        "genome_size_bp": total_genome_size,
        "genome_size_gb": round(total_genome_size / 1e9, 2),
        "chromosome_count": chr_count,
        "gene_count": gene_count,
        "genes_with_go": genes_with_go,
        "genes_with_kegg": genes_with_kegg,
        "go_term_count": go_term_count,
        "kegg_pathway_count": kegg_pathway_count,
    }


def search_genes(request: Request, q: str, limit: int = 10) -> list[dict]:
    """模糊搜索基因，返回真实匹配。"""
    state = request.app.state
    ql = q.lower().strip()
    results, seen = [], set()

    for item in state.gene_index_by_id.values():
        gene_id = (item["gene_id"] or "").lower()
        gene_symbol = (item["gene_symbol"] or "").lower()
        name = (item["name"] or "").lower()
        ncbi = str(item.get("ncbi_gene_id") or "").lower()

        if ql in {gene_id, gene_symbol, name, ncbi}:
            key = item["gene_id"]
        elif ql in gene_id or ql in gene_symbol or ql in name or ql in ncbi:
            key = item["gene_id"]
        else:
            continue

        if key in seen:
            continue
        seen.add(key)
        results.append(item)
        if len(results) >= limit:
            break

    return results


def get_gene_detail(request: Request, gene_id: str) -> dict | None:
    """从数据库获取基因详情，不存在返回 None。"""
    state = request.app.state
    resolved = gene_id
    hits = state.gene_index_by_symbol.get(gene_id.lower(), [])
    if len(hits) == 1:
        resolved = hits[0]["gene_id"]

    if resolved not in state.gene_index_by_id:
        return None

    gene = state.gene_index_by_id[resolved]
    chr_info = state.chromosome_by_seqid.get(gene["seqid"], {})
    sql = state.sql

    tx_row = sql.execute(
        "SELECT COUNT(*) as n FROM features WHERE featuretype IN ('mRNA','transcript') AND attributes LIKE ?",
        (f'%Parent={resolved}%',),
    ).fetchone()
    go_row = sql.execute(
        "SELECT COUNT(*) as n FROM gene_go WHERE gene_id = ?", (resolved,)
    ).fetchone()
    kegg_row = sql.execute(
        "SELECT COUNT(*) as n FROM gene_kegg WHERE gene_id = ?", (resolved,)
    ).fetchone()

    return {
        "gene_id": resolved,
        "gene_symbol": gene.get("gene_symbol"),
        "name": gene.get("name"),
        "biotype": gene.get("biotype"),
        "seqid": gene["seqid"],
        "chr_name": chr_info.get("chr_name", gene["seqid"]),
        "start": _safe_int(gene["start"]),
        "end": _safe_int(gene["end"]),
        "strand": gene["strand"],
        "length_bp": _safe_int(gene["length"]),
        "transcript_count": _safe_int(tx_row["n"]) if tx_row else 0,
        "go_annotation_count": _safe_int(go_row["n"]) if go_row else 0,
        "kegg_annotation_count": _safe_int(kegg_row["n"]) if kegg_row else 0,
        "ncbi_gene_id": gene.get("ncbi_gene_id"),
    }


def get_gene_go(request: Request, gene_id: str) -> list[dict]:
    """获取基因 GO 注释。"""
    state = request.app.state
    hits = state.gene_index_by_symbol.get(gene_id.lower(), [])
    resolved = hits[0]["gene_id"] if len(hits) == 1 else gene_id
    rows = state.sql.execute(
        "SELECT go_id, ontology, term FROM gene_go WHERE gene_id = ?", (resolved,)
    ).fetchall()
    return [dict(row) for row in rows]


def get_gene_kegg(request: Request, gene_id: str) -> list[dict]:
    """获取基因 KEGG 注释。"""
    state = request.app.state
    hits = state.gene_index_by_symbol.get(gene_id.lower(), [])
    resolved = hits[0]["gene_id"] if len(hits) == 1 else gene_id
    rows = state.sql.execute(
        "SELECT kegg_id, pathway_name FROM gene_kegg WHERE gene_id = ?", (resolved,)
    ).fetchall()
    return [dict(row) for row in rows]


def get_go_stats(request: Request) -> dict[str, Any]:
    """从数据库获取 GO 统计。"""
    state = request.app.state
    sql = state.sql
    total_row = sql.execute("SELECT COUNT(*) as n FROM gene_go").fetchone()
    genes_row = sql.execute("SELECT COUNT(DISTINCT gene_id) as n FROM gene_go").fetchone()
    ontology_rows = sql.execute(
        "SELECT ontology, COUNT(*) as n FROM gene_go GROUP BY ontology"
    ).fetchall()
    return {
        "total": _safe_int(total_row["n"]) if total_row else 0,
        "genes": _safe_int(genes_row["n"]) if genes_row else 0,
        "by_ontology": [dict(r) for r in ontology_rows],
    }


def get_kegg_stats(request: Request) -> dict[str, Any]:
    """从数据库获取 KEGG 统计。"""
    state = request.app.state
    sql = state.sql
    total_row = sql.execute("SELECT COUNT(*) as n FROM gene_kegg").fetchone()
    genes_row = sql.execute("SELECT COUNT(DISTINCT gene_id) as n FROM gene_kegg").fetchone()
    pathway_row = sql.execute("SELECT COUNT(*) as n FROM gene_kegg_pathway").fetchone()
    top_rows = sql.execute(
        """
        SELECT kegg_id, pathway_name, COUNT(DISTINCT gene_id) as gene_count
        FROM gene_kegg_pathway
        GROUP BY kegg_id, pathway_name
        ORDER BY gene_count DESC
        LIMIT 10
        """,
    ).fetchall()
    return {
        "total": _safe_int(total_row["n"]) if total_row else 0,
        "genes": _safe_int(genes_row["n"]) if genes_row else 0,
        "pathway_count": _safe_int(pathway_row["n"]) if pathway_row else 0,
        "top_pathways": [dict(r) for r in top_rows.fetchall()] if hasattr(top_rows, "fetchall") else [dict(r) for r in top_rows],
    }


# =============================================================================
# 意图识别
# =============================================================================

def detect_intent(message: str) -> str:
    msg_lower = message.lower().strip()

    if re.search(r"(总体|总览|概览|统计|genome|genome).?(统计|信息|大小|基因数)|有多少基因", msg_lower):
        return "genome_stats"

    gene_patterns = [
        r"基因\s*[:：]?\s*[\w-]+",
        r"gene\s*[:：]?\s*[\w-]+",
        r"(查找|搜索|找|查询)\s*基因",
        r"(给我|看看).*基因",
        r"基因信息",
    ]
    for p in gene_patterns:
        if re.search(p, msg_lower):
            return "gene_search"

    chr_patterns = [
        r"染色体",
        r"chr\d+",
        r"chr[a-z]+\d*",
        r"有多少基因在",
        r"染色体统计",
        r"染色体列表",
        r"染色体详情",
    ]
    for p in chr_patterns:
        if re.search(p, msg_lower):
            return "chromosome"

    if re.search(r"go\s*(注释|annotation)?|基因本体|biological|molecular function|cellular component", msg_lower):
        return "go"

    if re.search(r"kegg|通路|pathway", msg_lower):
        return "kegg"

    if re.search(r"(分析)?结果|图表|chart|download|下载|genome.?分析", msg_lower):
        return "analysis_results"

    return "general"


def extract_gene_id(message: str) -> str | None:
    patterns = [
        r"基因\s*[:：]?\s*([\w-]+)",
        r"gene\s*[:：]?\s*([\w-]+)",
    ]
    for p in patterns:
        m = re.search(p, message, re.IGNORECASE)
        if m and m.lastindex:
            return m.group(1)
    # 兜底：整个消息就是基因名
    cleaned = message.strip()
    if len(cleaned) >= 2 and len(cleaned) <= 30 and re.match(r"^[\w.-]+$", cleaned):
        return cleaned
    return None


def extract_chr_name(message: str) -> str | None:
    """从消息中提取染色体名称（去掉 chr 前缀）。"""
    m = re.search(r"chr([a-zA-Z0-9]+)", message, re.IGNORECASE)
    if m:
        return m.group(1)
    # "染色体 1" / "染色体 W"
    m = re.search(r"染色体\s*([a-zA-Z0-9]+)", message)
    if m:
        return m.group(1)
    return None


# =============================================================================
# 回复构建 — 全部基于真实数据库
# =============================================================================

def build_reply(request: Request, message: str) -> dict[str, Any]:
    intent = detect_intent(message)
    gene_id = extract_gene_id(message)
    chr_name = extract_chr_name(message)
    msg_lower = message.lower().strip()

    # ---------- 基因组总体统计 ----------
    if intent == "genome_stats":
        stats = get_genome_stats(request)
        return {
            "reply": (
                f"GRCg6a 基因组统计（来自数据库实时查询）：\n"
                f"• 基因组大小：{stats['genome_size_gb']} Gb（{stats['genome_size_bp']:,} bp）\n"
                f"• 染色体数量：{stats['chromosome_count']} 条\n"
                f"• 基因总数：{stats['gene_count']:,} 个\n"
                f"• 有 GO 注释的基因：{stats['genes_with_go']:,} 个（共 {stats['go_term_count']:,} 条 GO 记录）\n"
                f"• 有 KEGG 注释的基因：{stats['genes_with_kegg']:,} 个\n"
                f"• KEGG 通路总数：{stats['kegg_pathway_count']} 条"
            ),
            "type": "genome_stats",
            "data": stats,
        }

    # ---------- 基因查询 ----------
    if intent == "gene_search" and gene_id:
        gene = get_gene_detail(request, gene_id)

        if not gene:
            hits = search_genes(request, gene_id, limit=5)
            if hits:
                gene_list = "\n".join(
                    f"  • {g.get('gene_symbol') or g['gene_id']}（{g['gene_id']}）"
                    f" — chr{g.get('chr_name') or g['seqid']} {g['start']:,}-{g['end']:,}（{g['strand']}链）"
                    for g in hits
                )
                return {
                    "reply": f"数据库中未找到完全匹配 '{gene_id}' 的基因，以下为相似结果：\n{gene_list}\n\n请尝试更精确的基因名。",
                    "type": "gene_search",
                    "data": {"query": gene_id, "hits": hits, "exact_found": False},
                }
            return {
                "reply": f"数据库中未找到基因：{gene_id}。\n请检查基因名拼写，或尝试搜索基因 symbol（如 BRCA1）。",
                "type": "gene_search",
                "data": {"query": gene_id, "hits": [], "exact_found": False},
            }

        # 找到了，组装回复
        reply_lines = [
            f"基因信息（来自数据库实时查询）：",
            f"• Gene ID：{gene['gene_id']}",
            f"• Symbol：{gene['gene_symbol'] or 'N/A'}",
            f"• 名称：{gene['name'] or 'N/A'}",
            f"• 生物类型：{gene['biotype'] or 'N/A'}",
            f"• 位置：chr{gene['chr_name']}（{gene['seqid']}）：{gene['start']:,} - {gene['end']:,}（{gene['strand']}链）",
            f"• 长度：{gene['length_bp']:,} bp",
            f"• 转录本数：{gene['transcript_count']}",
            f"• GO 注释：{gene['go_annotation_count']} 条",
            f"• KEGG 注释：{gene['kegg_annotation_count']} 条",
        ]
        if gene.get("ncbi_gene_id"):
            reply_lines.append(f"• NCBI Gene ID：{gene['ncbi_gene_id']}")

        # 附加 GO 详情
        if re.search(r"go", msg_lower):
            go_rows = get_gene_go(request, gene_id)
            if go_rows:
                bp = [r for r in go_rows if r.get("ontology") == "BP"]
                mf = [r for r in go_rows if r.get("ontology") == "MF"]
                cc = [r for r in go_rows if r.get("ontology") == "CC"]
                reply_lines.append(f"\nGO 注释（共 {len(go_rows)} 条）：")
                if bp:
                    reply_lines.append(f"  生物过程(BP)：{', '.join(r['go_id'] for r in bp[:5])}")
                if mf:
                    reply_lines.append(f"  分子功能(MF)：{', '.join(r['go_id'] for r in mf[:5])}")
                if cc:
                    reply_lines.append(f"  细胞组分(CC)：{', '.join(r['go_id'] for r in cc[:5])}")
                if len(go_rows) > 5:
                    reply_lines.append(f"  ...（共 {len(go_rows)} 条，可前往基因详情页查看完整列表）")
            else:
                reply_lines.append("\n该基因暂无 GO 注释。")

        # 附加 KEGG 详情
        if re.search(r"kegg|通路", msg_lower):
            kegg_rows = get_gene_kegg(request, gene_id)
            if kegg_rows:
                reply_lines.append(f"\nKEGG 通路（共 {len(kegg_rows)} 条）：")
                for r in kegg_rows[:5]:
                    reply_lines.append(f"  • {r['kegg_id']}：{r['pathway_name']}")
                if len(kegg_rows) > 5:
                    reply_lines.append(f"  ...（共 {len(kegg_rows)} 条）")
            else:
                reply_lines.append("\n该基因暂无 KEGG 注释。")

        return {
            "reply": "\n".join(reply_lines),
            "type": "gene_detail",
            "data": gene,
        }

    # ---------- 染色体统计 ----------
    if intent == "chromosome":
        if chr_name:
            # 从数据库按 chr_name 查找，不用任何硬编码映射
            chr_row = _find_chromosome_by_name(request, chr_name)
            if chr_row:
                state = request.app.state
                gene_count = len(state.genes_by_seqid.get(chr_row["seqid"], []))
                chr_row["gene_count"] = gene_count
                return {
                    "reply": (
                        f"染色体 chr{chr_row['chr_name']}（{chr_row['seqid']}）统计（来自数据库）：\n"
                        f"• 长度：{chr_row['length']:,} bp\n"
                        f"• 基因数量：{gene_count}"
                    ),
                    "type": "chromosome",
                    "data": chr_row,
                }
            else:
                # 数据库中没有该染色体
                return {
                    "reply": f"数据库中未找到染色体：chr{chr_name}",
                    "type": "chromosome",
                    "data": {},
                }

        # 无特定染色体，返回全部列表
        state = request.app.state
        all_chrs = []
        for row in state.chromosomes:
            item = dict(row)
            item["gene_count"] = len(state.genes_by_seqid.get(row["seqid"], []))
            all_chrs.append(item)
        top5 = sorted(all_chrs, key=lambda x: x["gene_count"], reverse=True)[:5]
        reply = f"GRCg6a 共有 {len(all_chrs)} 条染色体（来自数据库）。\n\n基因数量 Top 5：\n"
        reply += "\n".join(
            f"  chr{c['chr_name']}（{c['seqid']}）：{c['gene_count']} 个基因，{c['length']:,} bp"
            for c in top5
        )
        return {"reply": reply, "type": "chromosome_list", "data": {"chromosomes": all_chrs, "total": len(all_chrs)}}

    # ---------- GO 注释统计 ----------
    if intent == "go":
        stats = get_go_stats(request)
        ontology_labels = {"BP": "生物过程", "MF": "分子功能", "CC": "细胞组分"}
        reply = f"GO 注释统计（来自数据库）：\n"
        reply += f"• 总 GO 条目：{stats['total']:,} 条\n"
        reply += f"• 有 GO 注释的基因：{stats['genes']:,} 个\n"
        for row in stats["by_ontology"]:
            label = ontology_labels.get(row["ontology"], row["ontology"])
            reply += f"• {label}（{row['ontology']}）：{row['n']:,} 条\n"
        return {"reply": reply, "type": "go_stats", "data": stats}

    # ---------- KEGG 通路统计 ----------
    if intent == "kegg":
        stats = get_kegg_stats(request)
        reply = f"KEGG 通路统计（来自数据库）：\n"
        reply += f"• 总 KEGG 注释：{stats['total']:,} 条\n"
        reply += f"• 有 KEGG 注释的基因：{stats['genes']:,} 个\n"
        reply += f"• 涉及通路数：{stats['pathway_count']} 条\n\n"
        reply += "最常见的通路（Top 10）：\n"
        for row in stats["top_pathways"]:
            reply += f"  • {row['kegg_id']} {row['pathway_name']}（{row['gene_count']} 个基因）\n"
        return {"reply": reply, "type": "kegg_stats", "data": stats}

    # ---------- 分析结果概览 ----------
    if intent == "analysis_results":
        chart_keys = _list_available_charts(request)
        if not chart_keys:
            return {
                "reply": "暂无预生成的分析结果。",
                "type": "analysis_results",
                "data": {"charts": []},
            }
        reply = f"GRCg6a 基因组分析结果（预生成，来自数据库查询）：\n"
        reply += f"• 可用图表数量：{len(chart_keys)} 种\n\n"
        reply += "包含以下分析模块：\n"
        for i, key in enumerate(chart_keys, 1):
            reply += f"  {i}. {key}\n"
        reply += "\n可在右侧导航 Genome > Results 查看，或下载 PNG/SVG/HTML/JSON 格式。"
        return {"reply": reply, "type": "analysis_results", "data": {"charts": chart_keys}}

    # ---------- 通用引导 ----------
    # 兜底：短消息当作基因搜索
    if len(message.strip()) <= 25 and re.match(r"^[\w.-]+$", message.strip()):
        hits = search_genes(request, message.strip(), limit=5)
        if hits:
            gene_list = "\n".join(
                f"  • {g.get('gene_symbol') or g['gene_id']} — "
                f"chr{g.get('chr_name') or g['seqid']} {g['start']:,}-{g['end']:,}（{g['strand']}链）"
                for g in hits
            )
            return {
                "reply": f"数据库中找到以下与 '{message.strip()}' 相关的基因：\n{gene_list}",
                "type": "gene_search",
                "data": {"query": message.strip(), "hits": hits},
            }

    return {
        "reply": (
            "我可以查询以下 GRCg6a 基因组真实数据：\n"
            "  • 基因信息（输入基因 symbol 或 gene_id）\n"
            "  • 染色体统计（输入染色体，如 chr1 / chrW）\n"
            "  • GO 注释统计\n"
            "  • KEGG 通路统计\n"
            "  • 基因组分析结果概览\n\n"
            "示例问题：\n"
            "  - '基因 BRCA1 的信息'\n"
            "  - 'chr1 有多少基因'\n"
            "  - 'GO 注释统计'\n"
            "  - 'KEGG 最常见的通路'"
        ),
        "type": "help",
        "data": {},
    }


# =============================================================================
# Chat API Endpoint
# =============================================================================

@router.post("/chat")
async def chat(request: Request, body: dict):
    """
    处理用户聊天消息。
    所有回答数据直接来自 GRCg6a SQLite 数据库，无任何硬编码数字。
    """
    user_message = body.get("message", "").strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="message is required")

    logger.info("Chat msg: %s", user_message[:80])

    try:
        result = build_reply(request, user_message)
        return {
            "reply": result["reply"],
            "type": result["type"],
            "data": result.get("data", {}),
        }
    except Exception as exc:
        logger.exception("Chat error: %s", exc)
        return {
            "reply": f"查询出错：{str(exc)}。请换个问题重试。",
            "type": "error",
            "data": {},
        }
