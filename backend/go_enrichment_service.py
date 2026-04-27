"""
GO Enrichment Analysis Service (SEA)
基于 GRCg6a 本地 GO 注释库的富集分析，复用 gene_xref + gene_go + go_term
"""

from dataclasses import dataclass, field
from typing import Optional
import math
from scipy.stats import hypergeom
from statsmodels.stats.multitest import multipletests


@dataclass
class EnrichmentParams:
    correction: str = "bh"
    fdr_cutoff: float = 0.05
    min_overlap: int = 2
    namespace: str = "all"
    annotation_mode: str = "direct"


@dataclass
class MappingRecord:
    input_id: str
    resolved_gene_id: Optional[str] = None
    ncbi_gene_id: Optional[str] = None
    gene_symbol: Optional[str] = None
    status: str = "not_found"  # mapped / not_found / duplicated / no_go_annotation


@dataclass
class GOEnrichmentResult:
    go_id: str
    term_name: str
    namespace: str
    ontology: str  # P / C / F
    query_count: int
    query_total: int
    background_count: int
    background_total: int
    gene_ratio: str
    background_ratio: str
    p_value: float
    fdr: float
    significant: bool
    hit_genes: list[str] = field(default_factory=list)
    hit_ncbi_ids: list[str] = field(default_factory=list)
    hit_symbols: list[str] = field(default_factory=list)


@dataclass
class EnrichmentResponse:
    query_count: int
    mapped_count: int
    annotated_count: int
    background_count: Optional[int]  # None when namespace="all" (per-ontology)
    tested_term_count: int
    significant_count: int
    annotation_source: str
    annotation_mode: str
    background_mode: str
    parameters: dict
    ontology_stats: dict
    mapping: list[MappingRecord]
    results: list[GOEnrichmentResult]
    bar_chart_data: dict


class GeneIDResolver:
    """将用户输入的多种 ID 格式解析为 gene_id"""

    def resolve(self, raw_ids: list[str], pg_getconn, pg_putconn) -> list[MappingRecord]:
        conn = pg_getconn()
        try:
            cur = conn.cursor()
            results = []

            for raw in raw_ids:
                raw = raw.strip()
                if not raw:
                    continue

                gene_id = None
                ncbi_id = None
                symbol = None

                # 1. gene_id 精确匹配
                cur.execute(
                    "SELECT gene_id, ncbi_gene_id::text, gene_symbol FROM gene_xref WHERE gene_id = %s",
                    (raw,)
                )
                row = cur.fetchone()
                if row:
                    gene_id, ncbi_id, symbol = row

                # 2. ncbi_gene_id 匹配
                if not gene_id:
                    cur.execute(
                        "SELECT gene_id, ncbi_gene_id::text, gene_symbol FROM gene_xref WHERE ncbi_gene_id::text = %s",
                        (str(raw),)
                    )
                    row = cur.fetchone()
                    if row:
                        gene_id, ncbi_id, symbol = row

                # 3. gene_symbol / display_symbol 匹配
                if not gene_id:
                    cur.execute(
                        "SELECT gene_id, ncbi_gene_id::text, gene_symbol FROM gene_xref "
                        "WHERE gene_symbol = %s OR display_symbol = %s",
                        (raw, raw)
                    )
                    rows = cur.fetchall()
                    if len(rows) == 1:
                        gene_id, ncbi_id, symbol = rows[0]
                    elif len(rows) > 1:
                        results.append(MappingRecord(
                            input_id=raw, resolved_gene_id=None,
                            ncbi_gene_id=None, gene_symbol=None,
                            status="duplicated"
                        ))
                        continue

                # 4. ensembl_gene_id 匹配
                if not gene_id:
                    cur.execute(
                        "SELECT gene_id, ncbi_gene_id::text, gene_symbol FROM gene_xref WHERE ensembl_gene_id = %s",
                        (raw,)
                    )
                    row = cur.fetchone()
                    if row:
                        gene_id, ncbi_id, symbol = row

                if gene_id:
                    results.append(MappingRecord(
                        input_id=raw,
                        resolved_gene_id=gene_id,
                        ncbi_gene_id=ncbi_id,
                        gene_symbol=symbol,
                        status="mapped"
                    ))
                else:
                    results.append(MappingRecord(
                        input_id=raw,
                        resolved_gene_id=None,
                        ncbi_gene_id=None,
                        gene_symbol=None,
                        status="not_found"
                    ))

            cur.close()
            return results

        finally:
            pg_putconn(conn)


class GOBackgroundBuilder:
    """按 ontology 构建背景基因集"""

    @staticmethod
    def get_background_and_terms(namespace: str, annotation_mode: str, pg_getconn, pg_putconn) -> tuple[set[str], dict[str, int], dict[str, tuple]]:
        """
        返回:
        - background_gene_ids: 背景基因 ID 集合（有 GO 注释且有 ncbi_gene_id 的基因）
        - bg_go_counts: {go_id: 在背景中的基因数}  — 与 N 的定义严格一致
        - go_names: {go_id: (term_name, namespace)}
        annotation_mode: "direct" 时排除 IEA 电子注释
        """
        conn = pg_getconn()
        try:
            cur = conn.cursor()

            # 背景基因 N：有 GO 注释且有 ncbi_gene_id 的基因
            # annotation_mode=direct 时排除 IEA 电子注释
            if namespace == "all":
                if annotation_mode == "direct":
                    cur.execute("""
                        SELECT DISTINCT gg.gene_id
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        WHERE gx.ncbi_gene_id IS NOT NULL AND gg.evidence_code != 'IEA'
                    """)
                else:
                    cur.execute("""
                        SELECT DISTINCT gg.gene_id
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        WHERE gx.ncbi_gene_id IS NOT NULL
                    """)
            else:
                if annotation_mode == "direct":
                    cur.execute("""
                        SELECT DISTINCT gg.gene_id
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        JOIN go_term gt ON gt.go_id = gg.go_id
                        WHERE gx.ncbi_gene_id IS NOT NULL AND gt.go_namespace = %s AND gg.evidence_code != 'IEA'
                    """, (namespace,))
                else:
                    cur.execute("""
                        SELECT DISTINCT gg.gene_id
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        JOIN go_term gt ON gt.go_id = gg.go_id
                        WHERE gx.ncbi_gene_id IS NOT NULL AND gt.go_namespace = %s
                    """, (namespace,))

            background_gene_ids = {r[0] for r in cur.fetchall()}

            # 每个 GO term 在背景中的基因数 K — 必须与 N 的定义严格一致（join gene_xref 限制 ncbi_gene_id）
            # annotation_mode=direct 时排除 IEA
            if namespace == "all":
                if annotation_mode == "direct":
                    cur.execute("""
                        SELECT gg.go_id, COUNT(DISTINCT gg.gene_id)
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        WHERE gx.ncbi_gene_id IS NOT NULL AND gg.evidence_code != 'IEA'
                        GROUP BY gg.go_id
                    """)
                else:
                    cur.execute("""
                        SELECT gg.go_id, COUNT(DISTINCT gg.gene_id)
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        WHERE gx.ncbi_gene_id IS NOT NULL
                        GROUP BY gg.go_id
                    """)
            else:
                if annotation_mode == "direct":
                    cur.execute("""
                        SELECT gg.go_id, COUNT(DISTINCT gg.gene_id)
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        JOIN go_term gt ON gt.go_id = gg.go_id
                        WHERE gx.ncbi_gene_id IS NOT NULL AND gt.go_namespace = %s AND gg.evidence_code != 'IEA'
                        GROUP BY gg.go_id
                    """, (namespace,))
                else:
                    cur.execute("""
                        SELECT gg.go_id, COUNT(DISTINCT gg.gene_id)
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        JOIN go_term gt ON gt.go_id = gg.go_id
                        WHERE gx.ncbi_gene_id IS NOT NULL AND gt.go_namespace = %s
                        GROUP BY gg.go_id
                    """, (namespace,))
            bg_go_counts = {r[0]: r[1] for r in cur.fetchall()}

            # GO term 名称
            cur.execute("SELECT go_id, go_name, go_namespace FROM go_term")
            go_names = {r[0]: (r[1], r[2]) for r in cur.fetchall()}

            cur.close()
            return background_gene_ids, bg_go_counts, go_names

        finally:
            pg_putconn(conn)


class GOEnrichmentAnalyzer:
    """SEA 富集分析器"""

    CORRECTION_MAP = {
        "bh": "fdr_bh",
        "by": "fdr_by",
        "bonferroni": "bonferroni",
        "none": "none",
    }

    def __init__(self):
        self.resolver = GeneIDResolver()
        self.bg_builder = GOBackgroundBuilder()

    def analyze(
        self,
        raw_gene_list: list[str],
        params: EnrichmentParams,
        pg_getconn,
        pg_putconn,
    ) -> EnrichmentResponse:
        # 1. 解析基因 ID
        mapping = self.resolver.resolve(raw_gene_list, pg_getconn, pg_putconn)

        # 去重：用 set 确保每个基因只出现一次，避免 n 被放大
        mapped_gene_ids_raw = [
            r.resolved_gene_id for r in mapping
            if r.status == "mapped"
        ]
        mapped_gene_ids_unique = list(dict.fromkeys(mapped_gene_ids_raw))  # 保留顺序去重

        if not mapped_gene_ids_unique:
            raise ValueError("No valid gene IDs found in the input list")

        # query_count = 原始输入数（不去重，显示给用户看原始输入量）
        query_count_total = len(raw_gene_list)

        # 2. 按 namespace 分开处理
        ns_map = {
            "biological_process": "P",
            "cellular_component": "C",
            "molecular_function": "F",
        }

        all_results = []
        all_bar_data = {"P": [], "C": [], "F": []}
        ontology_stats = {}

        namespaces = ["biological_process", "cellular_component", "molecular_function"] if params.namespace == "all" else [params.namespace]

        for ns in namespaces:
            bg_gene_ids, bg_go_counts, go_names = self.bg_builder.get_background_and_terms(ns, params.annotation_mode, pg_getconn, pg_putconn)
            N = len(bg_gene_ids)
            bg_gene_ids_set = bg_gene_ids  # 已经是 set

            if N == 0:
                ontology_stats[ns_map[ns]] = {"background_count": 0, "tested_term_count": 0, "significant_count": 0}
                continue

            # n = 查询基因中唯一且在当前 namespace 背景中的基因数（去重后）
            annotated_gene_ids = [g for g in mapped_gene_ids_unique if g in bg_gene_ids_set]
            n = len(annotated_gene_ids)

            if n == 0:
                ontology_stats[ns_map[ns]] = {"background_count": N, "tested_term_count": 0, "significant_count": 0}
                continue

            # 命中的 GO terms（只统计去重后的基因）
            # annotation_mode=direct 时，排除 IEA（电子注释）
            conn = pg_getconn()
            try:
                cur = conn.cursor()
                if params.annotation_mode == "direct":
                    cur.execute(
                        "SELECT go_id, ARRAY_AGG(DISTINCT gene_id) FROM gene_go "
                        "WHERE gene_id = ANY(%s) AND evidence_code != 'IEA' GROUP BY go_id",
                        (annotated_gene_ids,)
                    )
                else:
                    cur.execute(
                        "SELECT go_id, ARRAY_AGG(DISTINCT gene_id) FROM gene_go "
                        "WHERE gene_id = ANY(%s) GROUP BY go_id",
                        (annotated_gene_ids,)
                    )
                query_go_hits = {r[0]: list(set(r[1])) for r in cur.fetchall()}

                # 基因 ID → (ncbi_id, symbol)
                cur.execute(
                    "SELECT gene_id, ncbi_gene_id::text, gene_symbol FROM gene_xref "
                    "WHERE gene_id = ANY(%s)",
                    (annotated_gene_ids,)
                )
                gene_info = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
                cur.close()
            finally:
                pg_putconn(conn)

            # 超几何检验 — 先对所有命中 term 计算 p-value（不过滤）
            raw_results = []
            for go_id, hit_gene_ids in query_go_hits.items():
                k = len(hit_gene_ids)
                K = bg_go_counts.get(go_id, 0)
                if K == 0:
                    continue

                p_value = hypergeom.sf(k - 1, N, K, n)

                if go_id in go_names:
                    term_name, _ = go_names[go_id]
                    hit_ncbi = [gene_info[g][0] for g in hit_gene_ids if g in gene_info and gene_info[g][0]]
                    hit_syms = [gene_info[g][1] for g in hit_gene_ids if g in gene_info and gene_info[g][1]]

                    raw_results.append({
                        "go_id": go_id,
                        "term_name": term_name,
                        "namespace": ns,
                        "query_count": k,
                        "query_total": n,
                        "background_count": K,
                        "background_total": N,
                        "gene_ratio": f"{k}/{n}",
                        "background_ratio": f"{K}/{N}",
                        "p_value": p_value,
                        "hit_genes": hit_gene_ids,
                        "hit_ncbi_ids": hit_ncbi,
                        "hit_symbols": hit_syms,
                    })

            # FDR 校正 — 对全部命中的 term 一起做
            p_values = [r["p_value"] for r in raw_results]
            if params.correction == "none":
                fdr_values = p_values
            else:
                method = self.CORRECTION_MAP.get(params.correction, "fdr_bh")
                _, fdr_values, _, _ = multipletests(p_values, alpha=params.fdr_cutoff, method=method) if p_values else ([], [], [], [])

            for r, fdr in zip(raw_results, fdr_values):
                r["fdr"] = fdr

            # min_overlap 和 fdr_cutoff 过滤 — 过滤后才算作 significant
            tested_results = [
                r for r in raw_results
                if r["query_count"] >= params.min_overlap
            ]
            significant_results = [r for r in tested_results if r["fdr"] < params.fdr_cutoff]
            significant_results.sort(key=lambda x: x["fdr"])

            ontology_stats[ns_map[ns]] = {
                "background_count": N,
                "tested_term_count": len(tested_results),
                "significant_count": len(significant_results),
            }

            # 返回全部 tested terms，标记 significant
            for r in tested_results:
                r["significant"] = r["fdr"] < params.fdr_cutoff
            all_results.extend(tested_results)

            # bar chart data — 只用 significant
            code = ns_map[ns]
            for r in significant_results[:20]:
                all_bar_data[code].append({
                    "go_id": r["go_id"],
                    "term_name": r["term_name"][:50] + "..." if len(r["term_name"]) > 50 else r["term_name"],
                    "neg_log10_fdr": -math.log10(r["fdr"]) if r["fdr"] > 0 else 300,
                    "query_count": r["query_count"],
                    "background_count": r["background_count"],
                })

        # 排序
        all_results.sort(key=lambda x: x["fdr"])

        # 3. 计算 annotated_count（跨所有 namespace，唯一基因，与背景口径一致）
        # 必须：join gene_xref（ncbi_gene_id）+ evidence_code 过滤（direct 模式）
        conn = pg_getconn()
        try:
            cur = conn.cursor()
            if params.annotation_mode == "direct":
                if params.namespace == "all":
                    cur.execute("""
                        SELECT COUNT(DISTINCT gg.gene_id)
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        WHERE gg.gene_id = ANY(%s) AND gx.ncbi_gene_id IS NOT NULL AND gg.evidence_code != 'IEA'
                    """, (mapped_gene_ids_unique,))
                else:
                    cur.execute("""
                        SELECT COUNT(DISTINCT gg.gene_id)
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        JOIN go_term gt ON gt.go_id = gg.go_id
                        WHERE gg.gene_id = ANY(%s) AND gx.ncbi_gene_id IS NOT NULL
                          AND gt.go_namespace = %s AND gg.evidence_code != 'IEA'
                    """, (mapped_gene_ids_unique, params.namespace))
            else:
                if params.namespace == "all":
                    cur.execute("""
                        SELECT COUNT(DISTINCT gg.gene_id)
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        WHERE gg.gene_id = ANY(%s) AND gx.ncbi_gene_id IS NOT NULL
                    """, (mapped_gene_ids_unique,))
                else:
                    cur.execute("""
                        SELECT COUNT(DISTINCT gg.gene_id)
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        JOIN go_term gt ON gt.go_id = gg.go_id
                        WHERE gg.gene_id = ANY(%s) AND gx.ncbi_gene_id IS NOT NULL AND gt.go_namespace = %s
                    """, (mapped_gene_ids_unique, params.namespace))
            annotated_count = cur.fetchone()[0]
            cur.close()
        finally:
            pg_putconn(conn)

        # 4. mapping report — no_go_annotation 判断，与背景口径一致（ncbi + IEA 过滤）
        if params.annotation_mode == "direct":
            if params.namespace == "all":
                cur_annotated_query = """
                    SELECT DISTINCT gg.gene_id
                    FROM gene_go gg
                    JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                    WHERE gg.gene_id = ANY(%s) AND gx.ncbi_gene_id IS NOT NULL AND gg.evidence_code != 'IEA'
                """
                cur_annotated_args = (mapped_gene_ids_unique,)
            else:
                cur_annotated_query = """
                    SELECT DISTINCT gg.gene_id
                    FROM gene_go gg
                    JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                    JOIN go_term gt ON gt.go_id = gg.go_id
                    WHERE gg.gene_id = ANY(%s) AND gx.ncbi_gene_id IS NOT NULL
                      AND gt.go_namespace = %s AND gg.evidence_code != 'IEA'
                """
                cur_annotated_args = (mapped_gene_ids_unique, params.namespace)
        else:
            if params.namespace == "all":
                cur_annotated_query = """
                    SELECT DISTINCT gg.gene_id
                    FROM gene_go gg
                    JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                    WHERE gg.gene_id = ANY(%s) AND gx.ncbi_gene_id IS NOT NULL
                """
                cur_annotated_args = (mapped_gene_ids_unique,)
            else:
                cur_annotated_query = """
                    SELECT DISTINCT gg.gene_id
                    FROM gene_go gg
                    JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                    JOIN go_term gt ON gt.go_id = gg.go_id
                    WHERE gg.gene_id = ANY(%s) AND gx.ncbi_gene_id IS NOT NULL AND gt.go_namespace = %s
                """
                cur_annotated_args = (mapped_gene_ids_unique, params.namespace)

        conn = pg_getconn()
        try:
            cur = conn.cursor()
            cur.execute(cur_annotated_query, cur_annotated_args)
            all_annotated = {r[0] for r in cur.fetchall()}
            cur.close()
        finally:
            pg_putconn(conn)

        final_mapping = []
        for r in mapping:
            if r.status == "mapped":
                if r.resolved_gene_id not in all_annotated:
                    final_mapping.append(MappingRecord(
                        input_id=r.input_id,
                        resolved_gene_id=r.resolved_gene_id,
                        ncbi_gene_id=r.ncbi_gene_id,
                        gene_symbol=r.gene_symbol,
                        status="no_go_annotation"
                    ))
                else:
                    final_mapping.append(r)
            else:
                final_mapping.append(r)

        # 5. 构建 GOEnrichmentResult
        go_terms = [
            GOEnrichmentResult(
                go_id=r["go_id"],
                term_name=r["term_name"],
                namespace=r["namespace"],
                ontology=ns_map[r["namespace"]],
                query_count=r["query_count"],
                query_total=r["query_total"],
                background_count=r["background_count"],
                background_total=r["background_total"],
                gene_ratio=r["gene_ratio"],
                background_ratio=r["background_ratio"],
                p_value=r["p_value"],
                fdr=r["fdr"],
                significant=r["significant"],
                hit_genes=r["hit_genes"],
                hit_ncbi_ids=r["hit_ncbi_ids"],
                hit_symbols=r["hit_symbols"],
            )
            for r in all_results
        ]

        # 背景基因总数 — "all" 模式返回 None，前端已展示为 "See below"
        if params.namespace == "all":
            total_bg = None
        else:
            total_bg = max(s["background_count"] for s in ontology_stats.values()) if ontology_stats else 0

        return EnrichmentResponse(
            query_count=query_count_total,
            mapped_count=len(mapped_gene_ids_unique),
            annotated_count=annotated_count,
            background_count=total_bg,
            tested_term_count=sum(s["tested_term_count"] for s in ontology_stats.values()),
            significant_count=sum(s["significant_count"] for s in ontology_stats.values()),
            annotation_source="local_gallus_gallus_agrigo_grcg6a",
            annotation_mode=params.annotation_mode,
            background_mode="annotated_grcg6a_ncbi_genes",
            parameters={
                "correction": params.correction,
                "fdr_cutoff": params.fdr_cutoff,
                "min_overlap": params.min_overlap,
                "namespace": params.namespace,
            },
            ontology_stats=ontology_stats,
            mapping=final_mapping,
            results=go_terms,
            bar_chart_data=all_bar_data,
        )
