"""
GO Enrichment Analysis Service (SEA)
Based on GRCg6a local GO annotation library.
Reuses gene_xref + gene_go + go_term tables.
"""

from dataclasses import dataclass, field
from typing import Optional
import math
from scipy.stats import hypergeom
from statsmodels.stats.multitest import multipletests


class GODagNotReadyError(RuntimeError):
    """Raised when GO DAG tables (go_closure, go_edge, go_alt_id) are not loaded or empty."""
    pass


@dataclass
class EnrichmentParams:
    correction: str = "bh"
    fdr_cutoff: float = 0.05
    min_overlap: int = 2
    namespace: str = "all"
    annotation_mode: str = "direct"
    evidence_filter: str = "non_iea"  # all / non_iea / experimental


@dataclass
class MappingRecord:
    input_id: str
    resolved_gene_id: Optional[str] = None
    ncbi_gene_id: Optional[str] = None
    gene_symbol: Optional[str] = None
    status: str = "not_found"  # mapped / not_found / duplicated / no_go_annotation


CORRECTION_MAP = {
    "bh": "fdr_bh",
    "by": "fdr_by",
    "bonferroni": "bonferroni",
    "none": "none",
}


def _compute_enrichment_for_namespace(
    query_go_hits: dict[str, list[str]],
    bg_go_counts: dict[str, int],
    go_names: dict[str, tuple[str, str]],
    gene_info: dict[str, tuple[Optional[str], Optional[str]]],
    N: int,
    n: int,
    params: EnrichmentParams,
) -> tuple[list[dict], list[dict]]:
    """
    Compute hypergeometric p-values and FDR-corrected enrichment results for one ontology.

    Args:
        query_go_hits: {go_id: [gene_ids]} — query gene hits per GO term
        bg_go_counts: {go_id: K} — gene count in background for each GO term
        go_names: {go_id: (term_name, namespace)}
        gene_info: {gene_id: (ncbi_id, symbol)}
        N: total background gene count
        n: total query gene count (with GO annotation, after background filter)
        params: EnrichmentParams (correction, fdr_cutoff, min_overlap)

    Returns:
        (tested_results, significant_results) where:
        - tested_results: all terms meeting min_overlap, enriched fields added
        - significant_results: FDR-significant subset, sorted by FDR
    """
    raw_results = []
    for go_id, hit_gene_ids in query_go_hits.items():
        k = len(hit_gene_ids)
        K = bg_go_counts.get(go_id, 0)
        if K == 0:
            continue

        p_value = hypergeom.sf(k - 1, N, K, n)
        if not math.isfinite(p_value):
            p_value = 1.0

        if go_id in go_names:
            term_name, namespace = go_names[go_id]
            hit_ncbi = [gene_info[g][0] for g in hit_gene_ids if g in gene_info and gene_info[g][0]]
            hit_syms = [gene_info[g][1] for g in hit_gene_ids if g in gene_info and gene_info[g][1]]

            raw_results.append({
                "go_id": go_id,
                "term_name": term_name,
                "namespace": namespace,
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

    # Step 1: filter by min_overlap BEFORE FDR correction (tested terms)
    tested_results = [
        r for r in raw_results
        if r["query_count"] >= params.min_overlap
    ]

    # Step 2: FDR correction over tested terms only
    p_values = [r["p_value"] for r in tested_results]
    if params.correction == "none":
        fdr_values = p_values
    else:
        method = CORRECTION_MAP.get(params.correction, "fdr_bh")
        _, fdr_values, _, _ = multipletests(p_values, alpha=params.fdr_cutoff, method=method) if p_values else ([], [], [], [])

    for r, fdr in zip(tested_results, fdr_values):
        r["fdr"] = fdr if math.isfinite(fdr) else 1.0

    # Step 3: significant = FDR <= cutoff
    for r in tested_results:
        r["significant"] = r["fdr"] <= params.fdr_cutoff

    significant_results = [r for r in tested_results if r["significant"]]
    significant_results.sort(key=lambda x: x["fdr"])

    return tested_results, significant_results


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
    """Resolve diverse input ID formats to canonical gene_id."""

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

                # 1. gene_id exact match
                cur.execute(
                    "SELECT gene_id, ncbi_gene_id::text, gene_symbol FROM gene_xref WHERE gene_id = %s",
                    (raw,)
                )
                row = cur.fetchone()
                if row:
                    gene_id, ncbi_id, symbol = row

                # 2. ncbi_gene_id match
                if not gene_id:
                    cur.execute(
                        "SELECT gene_id, ncbi_gene_id::text, gene_symbol FROM gene_xref WHERE ncbi_gene_id::text = %s",
                        (str(raw),)
                    )
                    row = cur.fetchone()
                    if row:
                        gene_id, ncbi_id, symbol = row

                # 3. gene_symbol / display_symbol match
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

                # 4. ensembl_gene_id match
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


def _table_exists(cur, table_name: str) -> bool:
    cur.execute("""
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = %s
        )
    """, (table_name,))
    return bool(cur.fetchone()[0])


def _go_id_expr(has_alt_table: bool) -> str:
    return "COALESCE(galt.primary_go_id, gg.go_id)" if has_alt_table else "gg.go_id"


def _go_alt_sql_parts(cur) -> tuple[str, str, bool]:
    """
    Returns (go_id_expr, alt_join, has_alt_table) for canonical GO ID queries.
    Checks once whether go_alt_id exists, then returns all SQL parts.
    """
    has_alt_table = _table_exists(cur, "go_alt_id")
    go_id_expr = _go_id_expr(has_alt_table)
    alt_join = "LEFT JOIN go_alt_id galt ON galt.alt_go_id = gg.go_id" if has_alt_table else ""
    return go_id_expr, alt_join, has_alt_table


def _ensure_go_dag_ready(cur) -> None:
    """
    Verify required GO DAG tables exist and go_closure / go_edge have data.
    Raises GODagNotReadyError if missing or empty.
    go_alt_id must exist (may be empty); go_closure and go_edge must be non-empty.
    """
    cur.execute("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('go_closure', 'go_edge', 'go_alt_id')
    """)
    found = {r[0] for r in cur.fetchall()}
    required = {"go_closure", "go_edge", "go_alt_id"}
    missing = required - found
    if missing:
        raise GODagNotReadyError(
            f"GO DAG tables not loaded: {', '.join(sorted(missing))}. "
            "Run: python -m backend.scripts.load_go_dag "
            "--obo /d/jbrowsedata/projectdata/downloads/go/go-basic.obo "
            "--dsn postgresql://grcuser:grcpassword@127.0.0.1:5433/grcg6a --replace"
        )
    for table in ("go_closure", "go_edge"):
        cur.execute(f"SELECT 1 FROM {table} LIMIT 1")
        if cur.fetchone() is None:
            raise GODagNotReadyError(
                f"GO DAG table '{table}' is empty. "
                "Run: python -m backend.scripts.load_go_dag "
                "--obo /d/jbrowsedata/projectdata/downloads/go/go-basic.obo "
                "--dsn postgresql://grcuser:grcpassword@127.0.0.1:5433/grcg6a --replace"
            )


class GOBackgroundBuilder:
    """Build background gene sets per ontology."""

    @staticmethod
    def _evidence_filter_sql(evidence_filter: str) -> tuple[str, list]:
        """
        Returns (WHERE clause fragment, list of bind values) for evidence filtering.
        'all': no filter
        'non_iea': exclude IEA
        'experimental': exclude IEA + ISS/ISA/IBA (non-curated direct annotations)
        """
        if evidence_filter == "all":
            return "", []
        elif evidence_filter == "non_iea":
            return "AND gg.evidence_code != 'IEA'", []
        elif evidence_filter == "experimental":
            return "AND gg.evidence_code NOT IN ('IEA','ISS','ISA','IBA')", []
        return "", []

    @staticmethod
    def get_background_and_terms(namespace: str, evidence_filter: str, annotation_mode: str, pg_getconn, pg_putconn) -> tuple[set[str], dict[str, int], dict[str, tuple]]:
        """
        Returns:
        - background_gene_ids: gene IDs with GO annotations and NCBI Gene IDs
        - bg_go_counts: {go_id: gene count in background} — strict definition matching N
        - go_names: {go_id: (term_name, namespace)}
        evidence_filter: "all" / "non_iea" / "experimental"
        """
        conn = pg_getconn()
        try:
            cur = conn.cursor()

            # Guard: propagated mode requires DAG tables with data
            if annotation_mode == "propagated":
                _ensure_go_dag_ready(cur)

            ev_where, ev_args = GOBackgroundBuilder._evidence_filter_sql(evidence_filter)

            # Background genes N: genes with GO annotations and NCBI Gene IDs
            go_id_expr, alt_join, has_alt_table = _go_alt_sql_parts(cur)

            if namespace == "all":
                cur.execute(f"""
                    SELECT DISTINCT gg.gene_id
                    FROM gene_go gg
                    JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                    {alt_join}
                    WHERE gx.ncbi_gene_id IS NOT NULL {ev_where}
                """, ev_args)
            else:
                cur.execute(f"""
                    SELECT DISTINCT gg.gene_id
                    FROM gene_go gg
                    JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                    {alt_join}
                    JOIN go_term gt ON gt.go_id = {go_id_expr}
                    WHERE gx.ncbi_gene_id IS NOT NULL AND gt.go_namespace = %s {ev_where}
                """, (namespace,) + tuple(ev_args))

            background_gene_ids = {r[0] for r in cur.fetchall()}

            # Each GO term's gene count K in background — must match N definition exactly
            if annotation_mode == "direct":
                if namespace == "all":
                    cur.execute(f"""
                        SELECT {go_id_expr} AS go_id,
                               COUNT(DISTINCT gg.gene_id)
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        {alt_join}
                        WHERE gx.ncbi_gene_id IS NOT NULL {ev_where}
                        GROUP BY {go_id_expr}
                    """, ev_args)
                else:
                    cur.execute(f"""
                        SELECT {go_id_expr} AS go_id,
                               COUNT(DISTINCT gg.gene_id)
                        FROM gene_go gg
                        JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                        {alt_join}
                        JOIN go_term gt ON gt.go_id = {go_id_expr}
                        WHERE gx.ncbi_gene_id IS NOT NULL AND gt.go_namespace = %s {ev_where}
                        GROUP BY {go_id_expr}
                    """, (namespace,) + tuple(ev_args))
                bg_go_counts = {r[0]: r[1] for r in cur.fetchall()}
            else:
                # propagated: genes annotated to a descendant GO term count for all ancestors
                if namespace == "all":
                    # Use UNION + COUNT(DISTINCT) to avoid double-counting genes
                    # that appear in both alt_id and direct branches
                    # alt branch: gt_ann uses galt.primary_go_id (not gg.go_id which may be alt)
                    cur.execute(f"""
                        SELECT ancestor_go_id AS go_id, COUNT(DISTINCT gene_id) AS bg_count
                        FROM (
                            SELECT DISTINCT gg.gene_id, gc.ancestor_go_id
                            FROM gene_go gg
                            JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                            JOIN go_alt_id galt ON galt.alt_go_id = gg.go_id
                            JOIN go_closure gc ON gc.descendant_go_id = galt.primary_go_id
                            JOIN go_term gt ON gt.go_id = gc.ancestor_go_id
                            WHERE gx.ncbi_gene_id IS NOT NULL {ev_where}
                            UNION
                            SELECT DISTINCT gg.gene_id, gc.ancestor_go_id
                            FROM gene_go gg
                            JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                            JOIN go_closure gc ON gc.descendant_go_id = gg.go_id
                            JOIN go_term gt ON gt.go_id = gc.ancestor_go_id
                            WHERE gx.ncbi_gene_id IS NOT NULL
                              AND gg.go_id NOT IN (SELECT alt_go_id FROM go_alt_id)
                              {ev_where}
                        ) combined
                        GROUP BY ancestor_go_id
                    """, ev_args)
                    bg_go_counts = {r[0]: r[1] for r in cur.fetchall()}
                else:
                    # specific namespace: filter by ancestor's namespace AND annotation's namespace
                    # alt branch: gt_ann uses galt.primary_go_id (not gg.go_id which may be alt)
                    cur.execute(f"""
                        SELECT ancestor_go_id AS go_id, COUNT(DISTINCT gene_id) AS bg_count
                        FROM (
                            SELECT DISTINCT gg.gene_id, gc.ancestor_go_id
                            FROM gene_go gg
                            JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                            JOIN go_alt_id galt ON galt.alt_go_id = gg.go_id
                            JOIN go_closure gc ON gc.descendant_go_id = galt.primary_go_id
                            JOIN go_term gt ON gt.go_id = gc.ancestor_go_id
                            JOIN go_term gt_ann ON gt_ann.go_id = galt.primary_go_id
                            WHERE gx.ncbi_gene_id IS NOT NULL
                              AND gt.go_namespace = %s
                              AND gt_ann.go_namespace = %s
                              {ev_where}
                            UNION
                            SELECT DISTINCT gg.gene_id, gc.ancestor_go_id
                            FROM gene_go gg
                            JOIN gene_xref gx ON gx.gene_id = gg.gene_id
                            JOIN go_closure gc ON gc.descendant_go_id = gg.go_id
                            JOIN go_term gt ON gt.go_id = gc.ancestor_go_id
                            JOIN go_term gt_ann ON gt_ann.go_id = gg.go_id
                            WHERE gx.ncbi_gene_id IS NOT NULL
                              AND gt.go_namespace = %s
                              AND gt_ann.go_namespace = %s
                              AND gg.go_id NOT IN (SELECT alt_go_id FROM go_alt_id)
                              {ev_where}
                        ) AS combined
                        GROUP BY ancestor_go_id
                    """, (namespace, namespace, namespace, namespace) + tuple(ev_args))
                    bg_go_counts = {r[0]: r[1] for r in cur.fetchall()}

            # GO term names
            cur.execute("SELECT go_id, go_name, go_namespace FROM go_term")
            go_names = {r[0]: (r[1], r[2]) for r in cur.fetchall()}

            cur.close()
            return background_gene_ids, bg_go_counts, go_names

        finally:
            pg_putconn(conn)


class GOEnrichmentAnalyzer:
    """SEA Enrichment Analyzer."""

    def __init__(self):
        self.resolver = GeneIDResolver()
        self.bg_builder = GOBackgroundBuilder()

    def _evidence_filter_sql(self, evidence_filter: str) -> tuple[str, list]:
        """
        Returns (WHERE clause fragment, list of bind values) for evidence filtering.
        'all': no filter
        'non_iea': exclude IEA
        'experimental': exclude IEA + ISS/ISA/IBA (non-curated direct annotations)
        """
        if evidence_filter == "all":
            return "", []
        elif evidence_filter == "non_iea":
            return "AND gg.evidence_code != 'IEA'", []
        elif evidence_filter == "experimental":
            return "AND gg.evidence_code NOT IN ('IEA','ISS','ISA','IBA')", []
        return "", []

    def analyze(
        self,
        raw_gene_list: list[str],
        params: EnrichmentParams,
        pg_getconn,
        pg_putconn,
    ) -> EnrichmentResponse:
        # 1. Resolve input gene IDs
        mapping = self.resolver.resolve(raw_gene_list, pg_getconn, pg_putconn)

        # Deduplicate: each gene appears once to avoid inflating n
        mapped_gene_ids_raw = [
            r.resolved_gene_id for r in mapping
            if r.status == "mapped"
        ]
        mapped_gene_ids_unique = list(dict.fromkeys(mapped_gene_ids_raw))

        if not mapped_gene_ids_unique:
            raise ValueError("No valid gene IDs found in the input list")

        # query_count = raw input size (not deduplicated; shown to user)
        query_count_total = len(raw_gene_list)

        # 2. Process per namespace
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
            bg_gene_ids, bg_go_counts, go_names = self.bg_builder.get_background_and_terms(ns, params.evidence_filter, params.annotation_mode, pg_getconn, pg_putconn)
            N = len(bg_gene_ids)
            bg_gene_ids_set = bg_gene_ids  # already a set

            if N == 0:
                ontology_stats[ns_map[ns]] = {"background_count": 0, "tested_term_count": 0, "significant_count": 0}
                continue

            # n = query genes in background for current namespace (deduplicated)
            annotated_gene_ids = [g for g in mapped_gene_ids_unique if g in bg_gene_ids_set]
            n = len(annotated_gene_ids)

            if n == 0:
                ontology_stats[ns_map[ns]] = {"background_count": N, "tested_term_count": 0, "significant_count": 0}
                continue

            # Hit GO terms (deduplicated gene set only)
            # evidence_filter applied here
            conn = pg_getconn()
            try:
                cur = conn.cursor()
                ev_where, ev_args = self._evidence_filter_sql(params.evidence_filter)

                if params.annotation_mode == "direct":
                    # Safe fallback: use canonical GO ID only when go_alt_id exists
                    go_id_expr, alt_join, has_alt_table = _go_alt_sql_parts(cur)
                    cur.execute(
                        f"""SELECT {go_id_expr} AS go_id,
                                  ARRAY_AGG(DISTINCT gg.gene_id)
                           FROM gene_go gg
                           {alt_join}
                           WHERE gg.gene_id = ANY(%s) {ev_where}
                           GROUP BY {go_id_expr}""",
                        (annotated_gene_ids,) + tuple(ev_args)
                    )
                    query_go_hits = {r[0]: list(set(r[1])) for r in cur.fetchall()}
                else:
                    # propagated: propagate query gene annotations through closure
                    # alt branch: gt_ann uses galt.primary_go_id (not gg.go_id which may be alt)
                    cur.execute(
                        f"""
                        SELECT gc.ancestor_go_id AS go_id,
                               ARRAY_AGG(DISTINCT gg.gene_id) AS hit_genes
                        FROM gene_go gg
                        JOIN go_alt_id galt ON galt.alt_go_id = gg.go_id
                        JOIN go_closure gc ON gc.descendant_go_id = galt.primary_go_id
                        JOIN go_term gt ON gt.go_id = gc.ancestor_go_id
                        JOIN go_term gt_ann ON gt_ann.go_id = galt.primary_go_id
                        WHERE gg.gene_id = ANY(%s)
                          AND gt.go_namespace = %s
                          AND gt_ann.go_namespace = %s
                          {ev_where}
                        GROUP BY gc.ancestor_go_id
                        """,
                        (annotated_gene_ids, ns, ns) + tuple(ev_args)
                    )
                    hits_alt = {r[0]: list(set(r[1])) for r in cur.fetchall()}

                    cur.execute(
                        f"""
                        SELECT gc.ancestor_go_id AS go_id,
                               ARRAY_AGG(DISTINCT gg.gene_id) AS hit_genes
                        FROM gene_go gg
                        JOIN go_closure gc ON gc.descendant_go_id = gg.go_id
                        JOIN go_term gt ON gt.go_id = gc.ancestor_go_id
                        JOIN go_term gt_ann ON gt_ann.go_id = gg.go_id
                        WHERE gg.gene_id = ANY(%s)
                          AND gt.go_namespace = %s
                          AND gt_ann.go_namespace = %s
                          AND gg.go_id NOT IN (SELECT alt_go_id FROM go_alt_id)
                          {ev_where}
                        GROUP BY gc.ancestor_go_id
                        """,
                        (annotated_gene_ids, ns, ns) + tuple(ev_args)
                    )
                    hits_direct = {r[0]: list(set(r[1])) for r in cur.fetchall()}

                    query_go_hits = dict(hits_alt)
                    for go_id, genes in hits_direct.items():
                        if go_id in query_go_hits:
                            query_go_hits[go_id] = list(set(query_go_hits[go_id] + genes))
                        else:
                            query_go_hits[go_id] = genes

                # gene_id → (ncbi_id, symbol)
                cur.execute(
                    "SELECT gene_id, ncbi_gene_id::text, gene_symbol FROM gene_xref "
                    "WHERE gene_id = ANY(%s)",
                    (annotated_gene_ids,)
                )
                gene_info = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
                cur.close()
            finally:
                pg_putconn(conn)

            # Hypergeometric test: compute p-value for all hit terms
            tested_results, significant_results = _compute_enrichment_for_namespace(
                query_go_hits=query_go_hits,
                bg_go_counts=bg_go_counts,
                go_names=go_names,
                gene_info=gene_info,
                N=N,
                n=n,
                params=params,
            )

            ontology_stats[ns_map[ns]] = {
                "background_count": N,
                "tested_term_count": len(tested_results),
                "significant_count": len(significant_results),
            }

            all_results.extend(tested_results)

            # bar chart data — significant terms only
            code = ns_map[ns]
            for r in significant_results[:20]:
                all_bar_data[code].append({
                    "go_id": r["go_id"],
                    "term_name": r["term_name"][:50] + "..." if len(r["term_name"]) > 50 else r["term_name"],
                    "neg_log10_fdr": -math.log10(r["fdr"]) if r["fdr"] > 0 else 300,
                    "query_count": r["query_count"],
                    "background_count": r["background_count"],
                })

        # Sort results by FDR
        all_results.sort(key=lambda x: x["fdr"])

        # 3. Compute annotated_count (unique genes across namespaces, matching background def)
        # evidence_filter applied consistently; uses canonical GO ID to match background definition
        conn = pg_getconn()
        try:
            cur = conn.cursor()
            go_id_expr, alt_join, has_alt_table = _go_alt_sql_parts(cur)
            ev_where, ev_args = self._evidence_filter_sql(params.evidence_filter)
            if params.namespace == "all":
                cur.execute(
                    f"SELECT COUNT(DISTINCT gg.gene_id) FROM gene_go gg "
                    f"JOIN gene_xref gx ON gx.gene_id = gg.gene_id "
                    f"{alt_join} "
                    f"WHERE gg.gene_id = ANY(%s) AND gx.ncbi_gene_id IS NOT NULL {ev_where}",
                    (mapped_gene_ids_unique,) + tuple(ev_args)
                )
            else:
                cur.execute(
                    f"SELECT COUNT(DISTINCT gg.gene_id) FROM gene_go gg "
                    f"JOIN gene_xref gx ON gx.gene_id = gg.gene_id "
                    f"{alt_join} "
                    f"JOIN go_term gt ON gt.go_id = {go_id_expr} "
                    f"WHERE gg.gene_id = ANY(%s) AND gx.ncbi_gene_id IS NOT NULL "
                    f"AND gt.go_namespace = %s {ev_where}",
                    (mapped_gene_ids_unique, params.namespace) + tuple(ev_args)
                )
            annotated_count = cur.fetchone()[0]
            cur.close()
        finally:
            pg_putconn(conn)

        # 4. mapping report — no_go_annotation detection (ncbi + evidence_filter)
        ev_where_map, ev_args_map = self._evidence_filter_sql(params.evidence_filter)
        conn = pg_getconn()
        try:
            cur = conn.cursor()
            go_id_expr, alt_join, has_alt_table = _go_alt_sql_parts(cur)

            if params.namespace == "all":
                cur_annotated_query = (
                    f"SELECT DISTINCT gg.gene_id FROM gene_go gg "
                    f"JOIN gene_xref gx ON gx.gene_id = gg.gene_id "
                    f"{alt_join} "
                    f"WHERE gg.gene_id = ANY(%s) AND gx.ncbi_gene_id IS NOT NULL {ev_where_map}"
                )
                cur_annotated_args = (mapped_gene_ids_unique,) + tuple(ev_args_map)
            else:
                cur_annotated_query = (
                    f"SELECT DISTINCT gg.gene_id FROM gene_go gg "
                    f"JOIN gene_xref gx ON gx.gene_id = gg.gene_id "
                    f"{alt_join} "
                    f"JOIN go_term gt ON gt.go_id = {go_id_expr} "
                    f"WHERE gg.gene_id = ANY(%s) AND gx.ncbi_gene_id IS NOT NULL "
                    f"AND gt.go_namespace = %s {ev_where_map}"
                )
                cur_annotated_args = (mapped_gene_ids_unique, params.namespace) + tuple(ev_args_map)

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

        # 5. Build GOEnrichmentResult objects
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

        # Total background gene count — None for "all" namespace (frontend shows "See below")
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
                "annotation_mode": params.annotation_mode,
                "evidence_filter": params.evidence_filter,
            },
            ontology_stats=ontology_stats,
            mapping=final_mapping,
            results=go_terms,
            bar_chart_data=all_bar_data,
        )
